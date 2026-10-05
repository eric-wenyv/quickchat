import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('fixed shortcuts use global events plus a DOM keydown fallback with dedupe', async () => {
  const [appLayout, mainTs] = await Promise.all([
    source('src/components/layout/AppLayout.tsx'),
    source('electron/main.ts'),
  ]);

  // 主进程 globalShortcut 转发（X11/macOS/Windows 可用）之外必须有 DOM keydown
  // 兜底：Wayland 不允许应用全局抢键，globalShortcut 在那里静默失效。
  // 两条通道可能同时触发同一次按键，需要短时去重。
  assert.match(appLayout, /if \(isElectron\(\)\) \{/);
  assert.match(appLayout, /onEvent\('shortcut-toggle-sidebar'/);
  assert.match(appLayout, /onEvent\('shortcut-new-conversation'/);
  assert.match(appLayout, /addEventListener\('keydown'/);
  assert.match(appLayout, /DEDUPE_MS/);

  // 主进程注册固定快捷键，且焦点守卫必须先于事件发送
  assert.match(mainTs, /registerFixedShortcuts\(\)/);
  assert.match(mainTs, /shortcut-toggle-sidebar/);
  assert.match(mainTs, /shortcut-new-conversation/);
  const guard = mainTs.indexOf('!win.isFocused()');
  const emitCall = mainTs.indexOf('sendEventTo(win, event)');
  assert.ok(guard >= 0 && emitCall > guard, 'focus guard must precede event emission');
});
