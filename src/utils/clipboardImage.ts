/**
 * 剪贴板图片读取工具
 *
 * Omarchy（Wayland/Hyprland）下截图经 wl-copy 写入 Wayland 剪贴板。
 * tauri-plugin-clipboard-manager 依赖的 arboard 在纯 Wayland 会话中
 * 无法读取图片（其 Wayland 后端只支持文本，XWayland 剪贴板不同步
 * Wayland 图片），导致旧的 readImage() 兜底路径粘贴无反应。
 *
 * 因此按可靠性分层读取：
 *   1. paste 事件自带的 DataTransfer（WebKitGTK 能直接从 Wayland 剪贴板取图）
 *   2. Async Clipboard API（navigator.clipboard.read）
 *   3. tauri 剪贴板插件（X11 / 其他平台兜底）
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
    // 无剪贴板权限或剪贴板不含图片：交给插件兜底
  }

  try {
    // 动态引入：该插件在纯 Wayland 下读图会抛错，仅作 X11/其他平台兜底，
    // 顶层引入会让非 Tauri 环境的测试/调试页面无法加载本模块
    const { readImage } = await import('@tauri-apps/plugin-clipboard-manager');
    const image = await readImage();
    const [rgba, size] = await Promise.all([image.rgba(), image.size()]);
    return rgbaToPngDataUrl(rgba, size.width, size.height);
  } catch {
    return null;
  }
}

/** RGBA 像素经 canvas 编码为 PNG data URL；非浏览器环境或编码失败返回 null */
export function rgbaToPngDataUrl(
  rgba: Uint8Array | number[],
  width: number,
  height: number,
): string | null {
  if (width <= 0 || height <= 0 || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const imgData = ctx.createImageData(width, height);
  imgData.data.set(rgba as Uint8Array);
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}
