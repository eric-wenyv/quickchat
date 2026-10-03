import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

// Transpile the service and swap its bridge imports for controllable mocks.
async function importGlobalShortcut({ isVisibleDelayMs = 0 } = {}) {
  const raw = await readFile(new URL('../src/services/globalShortcut.ts', import.meta.url), 'utf8');
  const source = raw
    .replace("import { invoke, onEvent, isElectron } from '@/services/bridge';", '')
    .replace("import { getCurrentWindow } from '@/services/appWindow';", '');

  const prelude = `
    const firedHandlers = [];
    let visible = false;
    const calls = [];
    const registered = [];
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const invoke = async (cmd, args) => {
      if (cmd === 'window:is-visible') { await delay(${isVisibleDelayMs}); return visible; }
      if (cmd === 'window:show') { calls.push('show'); visible = true; }
      if (cmd === 'window:hide') { calls.push('hide'); visible = false; }
      if (cmd === 'shortcut:register') { registered.push(args.accelerator); }
      if (cmd === 'shortcut:unregister') { calls.push('unregister:' + args.accelerator); }
      return null;
    };
    const onEvent = (event, handler) => { firedHandlers.push(handler); return () => {}; };
    const isElectron = () => true;
    const getCurrentWindow = () => ({
      isVisible: async () => { await delay(${isVisibleDelayMs}); return visible; },
      show: async () => { calls.push('show'); visible = true; },
      hide: async () => { calls.push('hide'); visible = false; },
    });
    const localStorage = { getItem: () => null, setItem: () => {} };
    export const __mock = { firedHandlers, calls, registered, visible: () => visible };
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

const press = (module, times) => {
  // 主进程回传的 accelerator 是注册时传入的归一化形式
  const handler = module.__mock.firedHandlers[0];
  for (let i = 0; i < times; i += 1) handler({ accelerator: 'Control+Alt+Space' });
};

const settle = () => new Promise(resolve => setTimeout(resolve, 50));

test('repeated presses from key auto-repeat toggle the window only once', async () => {
  const module = await importGlobalShortcut();
  await module.initializeGlobalShortcut();

  press(module, 5);
  await settle();

  assert.deepEqual(module.__mock.calls, ['show']);
  assert.equal(module.__mock.visible(), true);
  assert.deepEqual(module.__mock.registered, ['Control+Alt+Space']);
});

test('overlapping toggles are serialized so a stale isVisible cannot re-show', async () => {
  const module = await importGlobalShortcut({ isVisibleDelayMs: 20 });
  await module.initializeGlobalShortcut();

  press(module, 2);
  await settle();

  // Without serialization both toggles would read "hidden" and double-show,
  // or interleave into show-then-hide. Exactly one show must win.
  assert.deepEqual(module.__mock.calls, ['show']);
  assert.equal(module.__mock.visible(), true);
});

test('a deliberate second press after the debounce window hides the window', async () => {
  const module = await importGlobalShortcut();
  await module.initializeGlobalShortcut();

  press(module, 1);
  await settle();
  assert.equal(module.__mock.visible(), true);

  // Wait out the debounce window, then press again.
  await new Promise(resolve => setTimeout(resolve, 450));
  press(module, 1);
  await settle();

  assert.deepEqual(module.__mock.calls, ['show', 'hide']);
  assert.equal(module.__mock.visible(), false);
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

test('setConfiguredGlobalShortcut 注册前归一化，注册值与过滤值一致', async () => {
  const module = await importGlobalShortcut();
  const { setConfiguredGlobalShortcut } = module;

  // 先走启动初始化（注册默认快捷键并订阅 fired 事件），再换键
  await module.initializeGlobalShortcut();
  assert.deepEqual(module.__mock.registered, ['Control+Alt+Space']);

  await setConfiguredGlobalShortcut('cmdorctrl+alt+space');
  assert.deepEqual(module.__mock.registered, ['Control+Alt+Space', 'CommandOrControl+Alt+Space']);
  // 主进程回传归一化 accelerator 时能被正确匹配触发
  // （mock 的 calls 还包含换键时的 unregister:Control+Alt+Space 记录）
  const handler = module.__mock.firedHandlers[0];
  handler({ accelerator: 'CommandOrControl+Alt+Space' });
  await settle();
  assert.ok(module.__mock.calls.includes('show'));
  assert.equal(module.__mock.visible(), true);
});
