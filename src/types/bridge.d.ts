// =============================================================================
// Quick-Chat — Electron preload 桥的全局类型声明
// =============================================================================
// 与 electron/preload.cts 的 exposeInMainWorld('__QC_BRIDGE__', ...) 保持同步。
// dev:web 纯浏览器下 window.__QC_BRIDGE__ 不存在（可选属性）。
// =============================================================================

export interface QcBridgeVersions {
  chrome?: string;
  node?: string;
  electron?: string;
  [key: string]: string | undefined;
}

export interface QcBridge {
  platform: string;
  versions: QcBridgeVersions;
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  onEvent(event: string, callback: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    /** Electron preload 注入的桌面桥；dev:web 纯浏览器下不存在 */
    __QC_BRIDGE__?: QcBridge;
  }
}

export {};
