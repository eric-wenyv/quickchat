import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('fixed shortcuts use one runtime source and require desktop window focus', async () => {
  const [appLayout, rustRuntime] = await Promise.all([
    source('src/components/layout/AppLayout.tsx'),
    source('src-tauri/src/lib.rs'),
  ]);

  assert.match(appLayout, /const isTauriRuntime = ['"]__TAURI_INTERNALS__['"] in window/);
  assert.match(appLayout, /if \(isTauriRuntime\) \{[\s\S]*listen\('shortcut-toggle-sidebar'/);
  // Tauri 事件与 DOM keydown 两个通道都常驻注册（Wayland 下全局热键不可用，
  // keydown 是唯一路径；其他平台同一次按键会走两条通道），由 fireOnce 短时去重
  // 保证单次触发，因此不再存在 if (!isTauriRuntime) 的分支。
  assert.match(appLayout, /window\.addEventListener\('keydown', handleKeyDown\)/);
  assert.doesNotMatch(appLayout, /if \(!isTauriRuntime\)/);
  assert.match(appLayout, /const DEDUPE_MS = 100/);
  assert.match(appLayout, /if \(now - lastFiredAt < DEDUPE_MS\) return;/);

  assert.match(rustRuntime, /get_webview_window\("main"\)[\s\S]*is_focused\(\)[\s\S]*unwrap_or\(false\)/);
  const focusGuard = rustRuntime.indexOf('if !is_main_window_focused');
  const sidebarEmit = rustRuntime.indexOf('app.emit("shortcut-toggle-sidebar"');
  const conversationEmit = rustRuntime.indexOf('app.emit("shortcut-new-conversation"');
  assert.ok(focusGuard >= 0 && focusGuard < sidebarEmit);
  assert.ok(focusGuard < conversationEmit);
});
