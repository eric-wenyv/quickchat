// =============================================================================
// Quick-Chat — Web Search Service
// =============================================================================
// 支持 Tavily Search API
// =============================================================================

import { invoke } from '@tauri-apps/api/core';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface TavilySearchResponse {
  query?: string;
  answer?: string;
  response_time?: number;
  error?: string;
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    raw_content?: string;
  }>;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '未知错误';
}

export function normalizeTavilySearchResponse(data: TavilySearchResponse): SearchResult[] {
  if (!data.results || !Array.isArray(data.results)) {
    return [];
  }

  return data.results.slice(0, 5).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.content || r.raw_content || '',
  }));
}

/**
 * 使用 Tavily Search API 搜索网页。
 * API Key 由 Tauri 后端从环境变量或项目根目录 .env 的 TAVILY_API_KEY 读取。
 */
export async function searchWeb(query: string): Promise<SearchResult[]> {
  let data: TavilySearchResponse;
  try {
    data = await invoke<TavilySearchResponse>('search_web', {
      query,
    });
  } catch (error) {
    throw new Error(`Tavily 本地转发失败: ${getErrorMessage(error)}`);
  }

  if (data?.error) {
    throw new Error(`Tavily 搜索失败: ${data.error}`);
  }

  return normalizeTavilySearchResponse(data);
}

/**
 * 将搜索结果格式化为文本，注入到对话上下文中
 */
export function formatSearchResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return `搜索 "${query}" 未返回结果。`;
  }

  const lines = [
    `以下是通过网络搜索 "${query}" 获得的实时信息：`,
    '',
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`${i + 1}. ${r.title}`);
    if (r.url) lines.push(`   来源: ${r.url}`);
    if (r.snippet) lines.push(`   摘要: ${r.snippet}`);
    lines.push('');
  }

  lines.push('请基于以上搜索结果回答用户的问题，并在适当的地方引用来源。');
  return lines.join('\n');
}
