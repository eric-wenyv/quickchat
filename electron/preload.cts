// 故意使用 .cts：tsconfig 的 module: NodeNext 会把它编译为 CJS 的 preload.cjs。
// CJS preload 不依赖 Electron 的 ESM preload 限制（.mjs 扩展名 / sandbox 必须关闭），最稳妥。
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

// 统一命令分发：主进程 ipcMain.handle('qc:invoke', ...) 按 cmd 路由（见 electron/ipc.ts）
function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return ipcRenderer.invoke("qc:invoke", cmd, args);
}

// 订阅主进程事件，返回取消订阅函数（contextIsolation 下函数返回值会被代理，可用）
function onEvent(event: string, callback: (payload: unknown) => void): () => void {
  const channel = `qc:event:${event}`;
  const listener = (_event: IpcRendererEvent, payload: unknown) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld("__QC_BRIDGE__", {
  platform: process.platform,
  versions: process.versions,
  invoke,
  onEvent,
});
