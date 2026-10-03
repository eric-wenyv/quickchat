/**
 * 剪贴板图片读取工具
 *
 * Electron（Chromium）下 Async Clipboard API 可直接读图；按可靠性分层：
 *   1. paste 事件自带的 DataTransfer（粘贴动作同步可取）
 *   2. Async Clipboard API（navigator.clipboard.read）
 *   3. Electron 主进程 clipboard.readImage 兜底（X11 / 权限受限场景）
 */

export interface DataTransferItemLike {
  kind: string;
  type: string;
}

/**
 * 从 DataTransferItemList 中挑出图片项。
 * 同为图片时优先 PNG——Wayland 截图（grim/hyprshot）的常态类型，无损。
 * 泛型保留调用方的 item 类型（如 DataTransferItem 的 getAsFile 能力）。
 */
export function findClipboardImageItem<T extends DataTransferItemLike>(items: T[]): T | null {
  let firstImage: T | null = null;
  for (const item of items) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    if (item.type === 'image/png') return item;
    firstImage ??= item;
  }
  return firstImage;
}

/** Blob → data URL；读取失败返回 null */
export function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

/** 将 paste 事件中的图片项转成 data URL；getAsFile 失败返回 null */
export function readClipboardItemAsDataUrl(item: DataTransferItem): Promise<string | null> {
  const file = item.getAsFile();
  if (!file) return Promise.resolve(null);
  return blobToDataUrl(file);
}

/**
 * 从系统剪贴板异步读取图片 data URL。
 * 剪贴板不含图片或所有读取路径都失败时返回 null。
 */
export async function readSystemClipboardImageDataUrl(): Promise<string | null> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.read) {
      const clipboardItems = await navigator.clipboard.read();
      for (const clipboardItem of clipboardItems) {
        const imageType = clipboardItem.types.find(t => t.startsWith('image/'));
        if (!imageType) continue;
        const dataUrl = await blobToDataUrl(await clipboardItem.getType(imageType));
        if (dataUrl) return dataUrl;
      }
    }
  } catch {
    // 无剪贴板权限或剪贴板不含图片：交给主进程兜底
  }

  try {
    // 直接读 preload 暴露的全局桥，避免静态依赖（本模块会被转译到临时目录测试）
    if (typeof window !== 'undefined' && '__QC_BRIDGE__' in window) {
      const base64 = await window.__QC_BRIDGE__!.invoke<string | null>('clipboard:read-image');
      if (base64) return `data:image/png;base64,${base64}`;
    }
  } catch {
    // 主进程读图失败（剪贴板无图/平台不支持）
  }
  return null;
}
