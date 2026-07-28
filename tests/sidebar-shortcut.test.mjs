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
  assert.match(appLayout, /if \(!isTauriRuntime\) \{[\s\S]*window\.addEventListener\('keydown', handleKeyDown\)/);

  assert.match(rustRuntime, /get_webview_window\("main"\)[\s\S]*is_focused\(\)[\s\S]*unwrap_or\(false\)/);
  const focusGuard = rustRuntime.indexOf('if !is_main_window_focused');
  const sidebarEmit = rustRuntime.indexOf('app.emit("shortcut-toggle-sidebar"');
  const conversationEmit = rustRuntime.indexOf('app.emit("shortcut-new-conversation"');
  assert.ok(focusGuard >= 0 && focusGuard < sidebarEmit);
  assert.ok(focusGuard < conversationEmit);
});
