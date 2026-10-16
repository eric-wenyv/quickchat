// =============================================================================
// Quick-Chat — 运行平台检测
// =============================================================================
// Electron 下优先用 preload 注入的 process.platform（window.__QC_BRIDGE__），
// 比 UA 嗅探可靠；dev:web 纯浏览器回退 UA（移动浏览器仍走移动端 UI 分支）。
// 仅用于 UI 层门控（窗口控制按钮、侧栏抽屉化、backdrop-filter 等）；
// 业务逻辑应保持平台无关。
// =============================================================================

const bridgePlatform =
  typeof window !== 'undefined' && '__QC_BRIDGE__' in window
    ? (window.__QC_BRIDGE__?.platform ?? null)
    : null;

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

/** 移动端（移动浏览器；Electron 桌面壳恒为 false） */
export const isMobilePlatform: boolean =
  bridgePlatform !== null ? false : /Android|iPhone|iPad|iPod|Mobile/.test(ua);

/** 桌面端 */
export const isDesktopPlatform: boolean = !isMobilePlatform;

/** Linux 桌面（ opaque 窗口底色 + backdrop-filter 可用的平台特例） */
export const isLinuxPlatform: boolean =
  bridgePlatform !== null ? bridgePlatform === 'linux' : !isMobilePlatform && /Linux/.test(ua);

/** macOS 桌面 */
export const isMacPlatform: boolean =
  bridgePlatform !== null ? bridgePlatform === 'darwin' : !isMobilePlatform && /Macintosh|Mac OS X/.test(ua);
