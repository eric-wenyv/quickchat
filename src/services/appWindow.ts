// =============================================================================
// Quick-Chat — 窗口句柄封装（替代旧版桌面壳 window API 的调用面）
// =============================================================================
// 保持与原 getCurrentWindow() 一致的调用形状（minimize/toggleMaximize/close/
// isMaximized/onResized/show/hide 等），底层走 bridge 的 window:* 命令与
// window:resized 事件（electron/main.ts 在 resize/maximize/unmaximize 时推送）。
// 阶段 3 重写窗口控制 UI 时可直接复用本模块。
// =============================================================================

import { invoke, onEvent } from './bridge';

export interface AppWindowHandle {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  show(): Promise<void>;
  hide(): Promise<void>;
  isVisible(): Promise<boolean>;
  isMaximized(): Promise<boolean>;
  setFocus(): Promise<void>;
  unminimize(): Promise<void>;
  /** 窗口尺寸/最大化状态变化；resolve 为取消订阅函数 */
  onResized(callback: () => void): Promise<() => void>;
}

export function getCurrentWindow(): AppWindowHandle {
  return {
    minimize: () => invoke('window:minimize'),
    toggleMaximize: () => invoke('window:toggle-maximize'),
    close: () => invoke('window:close'),
    show: () => invoke('window:show'),
    hide: () => invoke('window:hide'),
    isVisible: () => invoke('window:is-visible'),
    isMaximized: () => invoke('window:is-maximized'),
    setFocus: () => invoke('window:focus'),
    unminimize: () => invoke('window:unmaximize'),
    onResized: async (callback) => onEvent('window:resized', callback),
  };
}
