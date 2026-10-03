// =============================================================================
// Quick-Chat — Electron 桥封装（前端统一入口）
// =============================================================================
// preload（electron/preload.cts）向主世界暴露 window.__QC_BRIDGE__；本模块
// 是对外统一调用面：invoke 走 ipcRenderer.invoke('qc:invoke', ...)，onEvent
// 订阅主进程 qc:event:<name> 事件并返回取消订阅函数。
//
// dev:web（纯浏览器）下 isElectron() 为 false：onEvent 退化为 no-op，
// invoke 抛出明确错误 —— 与原桌面壳行为一致，桌面能力仅桌面壳可用。
// =============================================================================

export function isElectron(): boolean {
  return typeof window !== 'undefined' && '__QC_BRIDGE__' in window;
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isElectron()) {
    throw new Error(`[bridge] ${cmd} 仅在 Electron 环境可用（dev:web 模式无桌面桥）`);
  }
  return window.__QC_BRIDGE__!.invoke<T>(cmd, args);
}

/** 订阅主进程事件；非 Electron 环境返回 no-op，订阅方无需自行判空 */
export function onEvent(event: string, callback: (payload: unknown) => void): () => void {
  if (!isElectron()) return () => {};
  return window.__QC_BRIDGE__!.onEvent(event, callback);
}
