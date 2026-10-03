// =============================================================================
// Quick-Chat — URL Content Service (read_url 工具)
// =============================================================================
// 抓取走 Electron 主进程（避免渲染进程 CORS 限制），HTML 正文提取在主进程
// 完成，前端只负责格式化注入对话上下文。实现见 electron/ipc.ts（阶段 2
// 补齐 fetch_url handler，当前调用会抛 "not implemented yet"）。
// =============================================================================

import { invoke } from '@/services/bridge';

export interface UrlContent {
  url: string;
  title?: string | null;
  content: string;
  truncated: boolean;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '未知错误';
}

/**
 * 抓取 URL 并提取可读正文。
 * 由主进程 fetch_url 命令实现（HTML → 纯文本，正文超长时截断）。
 */
export async function fetchUrlContent(url: string): Promise<UrlContent> {
  try {
    return await invoke<UrlContent>('fetch_url', { url });
  } catch (error) {
    throw new Error(getErrorMessage(error));
  }
}

/**
 * 将抓取结果格式化为文本，作为 read_url 工具的返回注入对话上下文。
 */
export function formatUrlContent(result: UrlContent): string {
  const lines = [`以下是从 ${result.url} 抓取的网页内容：`, ''];

  if (result.title) {
    lines.push(`标题: ${result.title}`, '');
  }

  lines.push(result.content.trim());

  if (result.truncated) {
    lines.push('', '（正文过长，已截断，以上内容仅为开头部分。）');
  }

  lines.push('', '请基于以上网页内容回答用户的问题。');
  return lines.join('\n');
}
