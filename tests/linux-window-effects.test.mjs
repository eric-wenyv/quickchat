import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Linux glass fallbacks are platform-scoped and keep Windows defaults unchanged', async () => {
  const [main, appCss, appLayout, mainChat, tauriConfigSource] = await Promise.all([
    source('src/main.tsx'),
    source('src/App.css'),
    source('src/components/layout/AppLayout.tsx'),
    source('src/components/chat/MainChatArea.tsx'),
    source('src-tauri/tauri.conf.json'),
  ]);
  const tauriConfig = JSON.parse(tauriConfigSource);

  assert.match(main, /navigator\.userAgent\.includes\(['"]Linux['"]\)/);
  assert.match(main, /document\.documentElement\.dataset\.platform\s*=\s*['"]linux['"]/);
  assert.doesNotMatch(main, /dataset\.platform\s*=\s*['"]windows['"]/);

  assert.match(appLayout, /app-content-shell/);
  assert.match(mainChat, /quick-jump-nav/);
  assert.match(mainChat, /WebkitBackdropFilter/);
  assert.match(mainChat, /rgba\(24, 24, 24, 0\.42\)/);

  assert.match(appCss, /html\[data-platform=['"]linux['"]\][\s\S]*\.app-content-shell/);
  assert.match(appCss, /html\[data-platform=['"]linux['"]\][\s\S]*\.codex-glass-chrome/);
  assert.match(appCss, /html\[data-platform=['"]linux['"]\][\s\S]*--quick-jump-expanded-bg:/);
  assert.doesNotMatch(appCss, /html\[data-platform=['"]windows['"]\]/);

  const mainWindow = tauriConfig.app.windows.find((window) => window.label === 'main');
  assert.deepEqual(mainWindow.windowEffects, {
    effects: ['acrylic'],
    color: [30, 30, 30, 210],
  });
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
