import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('fixed shortcuts use one runtime source and require desktop window focus', async () => {
  const [appLayout, mainTs] = await Promise.all([
    source('src/components/layout/AppLayout.tsx'),
    source('electron/main.ts'),
  ]);

  // 前端只订阅主进程转发的全局快捷键事件（Electron globalShortcut 在
  // Wayland/X11/macOS/Windows 均可用），不再有 DOM keydown 兜底与双通道去重
  assert.match(appLayout, /if \(isElectron\(\)\) \{/);
  assert.match(appLayout, /onEvent\('shortcut-toggle-sidebar'/);
  assert.match(appLayout, /onEvent\('shortcut-new-conversation'/);
  assert.doesNotMatch(appLayout, /addEventListener\('keydown'/);
  assert.doesNotMatch(appLayout, /DEDUPE_MS/);

  // 主进程注册固定快捷键，且焦点守卫必须先于事件发送
  assert.match(mainTs, /registerFixedShortcuts\(\)/);
  assert.match(mainTs, /shortcut-toggle-sidebar/);
  assert.match(mainTs, /shortcut-new-conversation/);
  const guard = mainTs.indexOf('!win.isFocused()');
  const emitCall = mainTs.indexOf('sendEventTo(win, event)');
  assert.ok(guard >= 0 && emitCall > guard, 'focus guard must precede event emission');
});
