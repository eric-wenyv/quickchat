import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

// Transpile the service and swap its bridge imports for controllable mocks.
async function importGlobalShortcut({ saved = null, failAccelerator = null } = {}) {
  const raw = await readFile(new URL('../src/services/globalShortcut.ts', import.meta.url), 'utf8');
  const source = raw
    .replace("import { invoke, isElectron } from '@/services/bridge';", '');

  const prelude = `
    const calls = [];
    const registered = [];
    let saved = ${JSON.stringify(saved)};
    let failAccelerator = ${JSON.stringify(failAccelerator)};
    const invoke = async (cmd, args) => {
      if (cmd === 'shortcut:register') {
        if (args.accelerator === failAccelerator) throw new Error('shortcut unavailable');
        registered.push(args.accelerator);
      }
      if (cmd === 'shortcut:unregister') { calls.push('unregister:' + args.accelerator); }
      return null;
    };
    const isElectron = () => true;
    const localStorage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
    export const __mock = { calls, registered, saved: () => saved, allowRegistration: () => { failAccelerator = null; } };
  `;

  const transformed = ts.transpileModule(prelude + source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;

  const dir = join(tmpdir(), 'quick-chat-tests');
  await mkdir(dir, { recursive: true });
  const modulePath = join(dir, `global-shortcut-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(modulePath, transformed);
  return import(`file:///${modulePath.replaceAll('\\', '/')}`);
}

test('startup registers the default shortcut once', async () => {
  const module = await importGlobalShortcut();
  await module.initializeGlobalShortcut();
  await module.initializeGlobalShortcut();
  assert.deepEqual(module.__mock.registered, ['Control+Alt+Space']);
});

test('a shortcut can be enabled after starting with it disabled', async () => {
  const module = await importGlobalShortcut({ saved: '' });
  await module.initializeGlobalShortcut();
  assert.deepEqual(module.__mock.registered, []);
  await module.setConfiguredGlobalShortcut('Ctrl+Alt+Space');
  assert.deepEqual(module.__mock.registered, ['Control+Alt+Space']);
});

test('registration can be retried after startup failure', async () => {
  const module = await importGlobalShortcut({ failAccelerator: 'Control+Alt+Space' });
  await assert.rejects(module.initializeGlobalShortcut(), /shortcut unavailable/);
  module.__mock.allowRegistration();
  await module.setConfiguredGlobalShortcut('Ctrl+Alt+Space');
  assert.deepEqual(module.__mock.registered, ['Control+Alt+Space']);
});

test('normalizeAccelerator 归一化旧桌面壳写法为 Electron 格式', async () => {
  const module = await importGlobalShortcut();
  const { normalizeAccelerator } = module;

  // 已规范的 Electron 写法原样通过（幂等）
  assert.equal(normalizeAccelerator('Ctrl+Alt+Space'), 'Control+Alt+Space');
  assert.equal(normalizeAccelerator('Control+Shift+S'), 'Control+Shift+S');

  // CommandOrControl / CmdOrCtrl 家族
  assert.equal(normalizeAccelerator('CommandOrControl+Alt+Space'), 'CommandOrControl+Alt+Space');
  assert.equal(normalizeAccelerator('cmdorctrl+shift+p'), 'CommandOrControl+Shift+P');

  // command/cmd/option/super/win/meta 别名
  assert.equal(normalizeAccelerator('cmd+shift+k'), 'Command+Shift+K');
  assert.equal(normalizeAccelerator('Command+K'), 'Command+K');
  assert.equal(normalizeAccelerator('option+space'), 'Alt+Space');
  assert.equal(normalizeAccelerator('Super+Space'), 'Super+Space');
  assert.equal(normalizeAccelerator('win+shift+left'), 'Super+Shift+Left');

  // 单字符键大写化；常见命名键规范大小写
  assert.equal(normalizeAccelerator('ctrl+shift+s'), 'Control+Shift+S');
  assert.equal(normalizeAccelerator('ctrl+space'), 'Control+Space');
  assert.equal(normalizeAccelerator('F5'), 'F5');
  assert.equal(normalizeAccelerator('shift+escape'), 'Shift+Escape');
});

test('setConfiguredGlobalShortcut normalizes accelerators before registration', async () => {
  const module = await importGlobalShortcut();
  const { setConfiguredGlobalShortcut } = module;

  // Register the default, then swap to a normalized custom shortcut.
  await module.initializeGlobalShortcut();
  assert.deepEqual(module.__mock.registered, ['Control+Alt+Space']);

  await setConfiguredGlobalShortcut('cmdorctrl+alt+space');
  assert.deepEqual(module.__mock.registered, ['Control+Alt+Space', 'CommandOrControl+Alt+Space']);
  assert.deepEqual(module.__mock.calls, ['unregister:Control+Alt+Space']);
  assert.equal(module.__mock.saved(), 'cmdorctrl+alt+space');
});

test('a failed shortcut change restores the old binding and saved preference', async () => {
  const module = await importGlobalShortcut({ saved: 'Ctrl+Alt+Space', failAccelerator: 'Control+Alt+P' });
  await module.initializeGlobalShortcut();
  await assert.rejects(module.setConfiguredGlobalShortcut('Ctrl+Alt+P'), /shortcut unavailable/);
  assert.deepEqual(module.__mock.registered, ['Control+Alt+Space', 'Control+Alt+Space']);
  assert.equal(module.__mock.saved(), 'Ctrl+Alt+Space');
});

test('isReservedGlobalShortcut 按平台拦截固定快捷键（含 mac Super≡Command 写法）', async () => {
  const module = await importGlobalShortcut();
  const { isReservedGlobalShortcut } = module;

  // mac：录入 UI 把 Cmd 记为 Super，必须拦截，否则会抢占侧栏/新建会话快捷键
  assert.equal(isReservedGlobalShortcut('Super+Shift+S', true), true);
  assert.equal(isReservedGlobalShortcut('Super+Shift+N', true), true);
  assert.equal(isReservedGlobalShortcut('cmd+shift+s', true), true);
  // mac 上固定快捷键是 Command+Shift，真正的 Ctrl 组合不冲突
  assert.equal(isReservedGlobalShortcut('Ctrl+Shift+S', true), false);
  assert.equal(isReservedGlobalShortcut('Super+Shift+P', true), false);

  // Windows / Linux：Ctrl+Shift+S/N 保留，其余放行
  assert.equal(isReservedGlobalShortcut('Ctrl+Shift+S', false), true);
  assert.equal(isReservedGlobalShortcut('ctrl+shift+n', false), true);
  assert.equal(isReservedGlobalShortcut('Super+Shift+S', false), false);
  assert.equal(isReservedGlobalShortcut('Ctrl+Shift+P', false), false);
});
