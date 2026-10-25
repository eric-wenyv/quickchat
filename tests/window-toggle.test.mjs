import assert from 'node:assert/strict';
import test from 'node:test';
import { importElectronModule } from './lib/import-electron.mjs';

const { toggleMainWindow, createQuickOpenHandler } = await importElectronModule('window-toggle');

function mockWindow({ visible = false, focused = false, minimized = false } = {}) {
  const calls = [];
  return {
    calls,
    isVisible: () => visible,
    isFocused: () => focused,
    isMinimized: () => minimized,
    restore: () => { calls.push('restore'); minimized = false; },
    show: () => { calls.push('show'); visible = true; },
    focus: () => { calls.push('focus'); focused = true; },
    hide: () => { calls.push('hide'); visible = false; focused = false; },
  };
}

test('quick-open shows a hidden window without contacting its renderer', () => {
  const win = mockWindow();
  toggleMainWindow(win);
  assert.deepEqual(win.calls, ['show', 'focus']);
  toggleMainWindow(win);
  assert.deepEqual(win.calls, ['show', 'focus', 'hide']);
});

test('quick-open focuses a visible window behind another app', () => {
  const win = mockWindow({ visible: true });
  toggleMainWindow(win);
  assert.deepEqual(win.calls, ['show', 'focus']);
});

test('a minimized window is restored even if Electron reports it as visible', () => {
  const win = mockWindow({ visible: true, minimized: true });
  toggleMainWindow(win);
  assert.deepEqual(win.calls, ['restore', 'show', 'focus']);
});

test('key auto-repeat is ignored, and a later deliberate press hides the window', t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const win = mockWindow();
  const press = createQuickOpenHandler(() => win);
  for (let i = 0; i < 5; i += 1) press();
  assert.deepEqual(win.calls, ['show', 'focus']);
  now += 401;
  press();
  assert.deepEqual(win.calls, ['show', 'focus', 'hide']);
});

test('a press before the window exists does not suppress the next valid press', () => {
  let win = null;
  const press = createQuickOpenHandler(() => win);
  press();
  win = mockWindow();
  press();
  assert.deepEqual(win.calls, ['show', 'focus']);
});
