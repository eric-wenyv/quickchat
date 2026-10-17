// Electron preload bridge global type

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
    __QC_BRIDGE__?: QcBridge;
  }
}

export { };
