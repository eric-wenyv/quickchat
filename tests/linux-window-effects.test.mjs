import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Linux uses an opaque shell while Windows Acrylic defaults stay unchanged', async () => {
  const [main, appCss, appLayout, mainChat, tauriConfigSource, linuxConfigSource] = await Promise.all([
    source('src/main.tsx'),
    source('src/App.css'),
    source('src/components/layout/AppLayout.tsx'),
    source('src/components/chat/MainChatArea.tsx'),
    source('src-tauri/tauri.conf.json'),
    source('src-tauri/tauri.linux.conf.json').catch(() => null),
  ]);
  const tauriConfig = JSON.parse(tauriConfigSource);
  assert.ok(linuxConfigSource, 'Linux needs a platform-specific opaque window config');
  const linuxConfig = JSON.parse(linuxConfigSource);

  assert.match(main, /navigator\.userAgent\.includes\(['"]Linux['"]\)/);
  assert.match(main, /document\.documentElement\.dataset\.platform\s*=\s*['"]linux['"]/);
  assert.doesNotMatch(main, /dataset\.platform\s*=\s*['"]windows['"]/);

  assert.match(appLayout, /app-content-shell/);
  assert.match(mainChat, /quick-jump-nav/);
  assert.match(mainChat, /WebkitBackdropFilter/);
  assert.match(mainChat, /rgba\(24, 24, 24, 0\.42\)/);
  // WebKitGTK 合成 backdrop-filter 开销大，悬浮导航条时延迟明显，Linux 必须禁用
  assert.match(mainChat, /isLinuxPlatform \? 'blur\(28px\) saturate\(1\.35\)' : 'none'/);

  assert.match(appCss, /html\[data-platform=['"]linux['"]\][\s\S]*--quick-jump-expanded-bg:/);
  assert.doesNotMatch(appCss, /html\[data-platform=['"]windows['"]\]/);

  assert.match(appLayout, /className="app-window-shell [^"]*bg-transparent/);
  assert.match(appLayout, /codex-menu-bar codex-glass-chrome/);
  assert.match(appLayout, /main-chat-shell min-w-0/);
  assert.match(mainChat, /main-chat-area/);

  const linuxWindowShell = appCss.match(
    /html\[data-platform=['"]linux['"]\] \.app-window-shell \{([^}]*)\}/,
  )?.[1];
  assert.ok(linuxWindowShell);
  assert.match(linuxWindowShell, /background: var\(--color-linear-bg\);/);
  assert.doesNotMatch(linuxWindowShell, /background: transparent;/);
  assert.doesNotMatch(linuxWindowShell, /backdrop-filter:/);
  assert.doesNotMatch(appCss, /html\[data-platform=['"]linux['"]\] \.app-window-shell::before/);
  assert.doesNotMatch(appCss, /html\[data-platform=['"]linux['"]\] \.app-content-shell \{/);
  assert.doesNotMatch(appCss, /html\[data-platform=['"]linux['"]\] \.codex-glass-chrome \{/);
  assert.doesNotMatch(appCss, /html\[data-platform=['"]linux['"]\] :is\(\.main-chat-shell/);

  const mainWindow = tauriConfig.app.windows.find((window) => window.label === 'main');
  assert.equal(mainWindow.transparent, true);
  assert.deepEqual(mainWindow.windowEffects, {
    effects: ['acrylic'],
    color: [30, 30, 30, 210],
  });

  const linuxMainWindow = linuxConfig.app.windows.find((window) => window.label === 'main');
  assert.equal(linuxMainWindow.transparent, false);
  assert.equal(linuxMainWindow.windowEffects, undefined);
});

test('native Wayland blur integration is compiled for Linux only', async () => {
  const [cargoToml, libRs] = await Promise.all([
    source('src-tauri/Cargo.toml'),
    source('src-tauri/src/lib.rs'),
  ]);

  assert.match(cargoToml, /\[target\.'cfg\(target_os = "linux"\)'\.dependencies\]/);
  assert.match(cargoToml, /wayland-client/);
  assert.match(cargoToml, /wayland-protocols/);
  assert.match(cargoToml, /wayland-protocols-plasma/);
  assert.match(cargoToml, /gdkwayland-sys/);

  assert.match(libRs, /#\[cfg\(target_os = "linux"\)\]\s*mod linux_blur;/);
  assert.match(libRs, /linux_blur::install/);
});
