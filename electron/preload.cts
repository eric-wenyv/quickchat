import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return ipcRenderer.invoke("qc:invoke", cmd, args);
}

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
