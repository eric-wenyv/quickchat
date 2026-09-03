// =============================================================================
// Quick-Chat — 运行平台检测
// =============================================================================
// 通过 UA 区分 Tauri 移动壳（Android WebView / iOS WKWebView）与桌面壳，
// 仅用于 UI 层门控（窗口控制按钮、全局快捷键、侧栏抽屉化等）；
// 业务逻辑应保持平台无关。

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

export const isAndroid = /Android/.test(ua);
export const isIos = /iPhone|iPad|iPod/.test(ua);

/** 移动端（Tauri Android/iOS 壳或移动浏览器） */
export const isMobilePlatform: boolean = isAndroid || isIos || /Mobile/.test(ua);

/** 桌面端（Tauri 桌面壳或桌面浏览器） */
export const isDesktopPlatform: boolean = !isMobilePlatform;
