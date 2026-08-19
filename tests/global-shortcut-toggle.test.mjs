import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

// Transpile the service and swap its Tauri imports for controllable mocks.
async function importGlobalShortcut({ isVisibleDelayMs = 0 } = {}) {
  const raw = await readFile(new URL('../src/services/globalShortcut.ts', import.meta.url), 'utf8');
  const source = raw
    .replace("import { getCurrentWindow } from '@tauri-apps/api/window';", '')
    .replace("import { register, unregister } from '@tauri-apps/plugin-global-shortcut';", '');

  const prelude = `
    const handlers = [];
    let visible = false;
    const calls = [];
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const getCurrentWindow = () => ({
      isVisible: async () => { await delay(${isVisibleDelayMs}); return visible; },
      show: async () => { calls.push('show'); visible = true; },
      hide: async () => { calls.push('hide'); visible = false; },
      unminimize: async () => {},
      setFocus: async () => {},
    });
    const register = async (shortcut, handler) => { handlers.push(handler); };
    const unregister = async () => {};
    const localStorage = { getItem: () => null, setItem: () => {} };
    export const __mock = { handlers, calls, visible: () => visible };
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
  const handler = module.__mock.handlers[0];
  for (let i = 0; i < times; i += 1) handler({ state: 'Pressed' });
};

const settle = () => new Promise(resolve => setTimeout(resolve, 50));

test('repeated presses from key auto-repeat toggle the window only once', async () => {
  const module = await importGlobalShortcut();
  await module.initializeGlobalShortcut();

  press(module, 5);
  await settle();

  assert.deepEqual(module.__mock.calls, ['show']);
  assert.equal(module.__mock.visible(), true);
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
