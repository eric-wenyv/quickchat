import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Linux keeps an opaque shell while all platforms get backdrop-filter blur', async () => {
  const [main, appCss, appLayout, mainChat, messageHeader, mainTs] = await Promise.all([
    source('src/main.tsx'),
    source('src/App.css'),
    source('src/components/layout/AppLayout.tsx'),
    source('src/components/chat/MainChatArea.tsx'),
    source('src/components/chat/MessageHeader.tsx'),
    source('electron/main.ts'),
  ]);

  // 平台标记来自 preload 注入的 process.platform（Electron），不再 UA 嗅探
  assert.match(main, /isLinuxPlatform/);
  assert.match(main, /dataset\.platform\s*=\s*['"]linux['"]/);
  assert.doesNotMatch(main, /navigator\.userAgent/);
  assert.doesNotMatch(main, /dataset\.platform\s*=\s*['"]windows['"]/);

  assert.match(appLayout, /app-content-shell/);
  assert.match(appLayout, /codex-menu-bar codex-glass-chrome/);
  assert.match(mainChat, /quick-jump-nav/);
  assert.match(mainChat, /WebkitBackdropFilter/);
  assert.match(mainChat, /rgba\(24, 24, 24, 0\.42\)/);
  // Chromium 全平台支持 backdrop-filter：悬浮导航条毛玻璃不再有 Linux 例外
  assert.match(mainChat, /isNavHovered \? 'blur\(28px\) saturate\(1\.35\)' : 'none'/);
  assert.doesNotMatch(mainChat, /isLinuxPlatform/);
  // 顶栏同样全平台使用半透明底 + 毛玻璃
  assert.match(messageHeader, /bg-linear-bg\/72 backdrop-blur-xl/);
  assert.doesNotMatch(messageHeader, /isLinuxPlatform/);

  // Linux 窗口保持不透明底色（保守方案：毛玻璃由内部元素承担）
  assert.match(appCss, /html\[data-platform='linux['"]\][\s\S]*--quick-jump-expanded-bg:/);
  assert.doesNotMatch(appCss, /html\[data-platform='windows['"]\]/);
  const linuxWindowShell = appCss.match(
    /html\[data-platform='linux['"]\] \.app-window-shell \{([^}]*)\}/,
  )?.[1];
  assert.ok(linuxWindowShell);
  assert.match(linuxWindowShell, /background: var\(--color-linear-bg\);/);
  assert.doesNotMatch(linuxWindowShell, /background: transparent;/);
  assert.doesNotMatch(linuxWindowShell, /backdrop-filter:/);

  // 窗口透明 + acrylic 材质仅 Windows（对齐旧版桌面配置的 windowEffects）
  assert.match(mainTs, /const isWindows = process\.platform === ['"]win32['"];/);
  assert.match(mainTs, /transparent: isWindows/);
  assert.match(mainTs, /backgroundMaterial: "acrylic"/);
});
