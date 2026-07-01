/**
 * 图片描述序列化/解析工具
 *
 * 图片描述以 HTML 注释形式嵌入消息内容，与 attachments 类似：
 *   <!-- image-descriptions:[{"url":"data:image/...","description":"..."}] -->
 *
 * UI 渲染时剥离此注释（不显示描述文本），但发送给 API 时可以提取描述。
 */

export interface ImageDescription {
  /** 图片的 data URL（base64） */
  url: string;
  /** 图片的文字描述 */
  description: string;
}

const IMAGE_DESCRIPTIONS_REGEX = /<!--\s*image-descriptions:(\[.*?\])\s*-->/s;

/** 将图片描述列表序列化为 HTML 注释，追加到消息内容末尾 */
export function serializeImageDescriptions(descriptions: ImageDescription[]): string {
  if (descriptions.length === 0) return '';
  return `\n\n<!-- image-descriptions:${JSON.stringify(descriptions)} -->`;
}

/** 从消息内容中提取图片描述，并返回剥离注释后的纯文本 */
export function parseImageDescriptions(content: string): {
  text: string;
  descriptions: ImageDescription[];
} {
  const match = content.match(IMAGE_DESCRIPTIONS_REGEX);
  if (!match) {
    return { text: content, descriptions: [] };
  }
  try {
    const descriptions: ImageDescription[] = JSON.parse(match[1]);
    const text = content.replace(IMAGE_DESCRIPTIONS_REGEX, '').trimEnd();
    return { text, descriptions };
  } catch {
    return { text: content, descriptions: [] };
  }
}
