// =============================================================================
// Quick-Chat — Web Search Service
// =============================================================================
// 支持 SerpApi Google Search API
// =============================================================================

import { invoke } from '@tauri-apps/api/core';

const SEARCH_API_KEY_STORAGE_KEY = 'quick_chat_serpapi_key';

function readStoredSearchApiKey(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(SEARCH_API_KEY_STORAGE_KEY)?.trim() || '';
}

function persistSearchApiKey(key: string): void {
  if (typeof window === 'undefined') return;
  if (key) {
    window.localStorage.setItem(SEARCH_API_KEY_STORAGE_KEY, key);
  } else {
    window.localStorage.removeItem(SEARCH_API_KEY_STORAGE_KEY);
  }
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface SerpApiSearchResponse {
  search_metadata?: {
    status?: string;
    error?: string;
  };
  error?: string;
  organic_results?: Array<{
    title?: string;
    link?: string;
    url?: string;
    snippet?: string;
    description?: string;
  }>;
  knowledge_graph?: {
    title?: string;
    description?: string;
    website?: string;
    link?: string;
  };
  answer_box?: {
    title?: string;
    link?: string;
    answer?: string;
    snippet?: string;
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '未知错误';
}

let searchApiKey: string = readStoredSearchApiKey();

export function setSearchApiKey(key: string) {
  searchApiKey = key.trim();
  persistSearchApiKey(searchApiKey);
}

export function getSearchApiKey(): string {
  if (!searchApiKey) {
    searchApiKey = readStoredSearchApiKey();
  }
  return searchApiKey;
}

export function hasSearchConfigured(): boolean {
  return !!searchApiKey.trim();
}

/**
 * 使用 SerpApi Google Search API 搜索网页
 * https://serpapi.com/search-api
 */
export async function searchWeb(query: string): Promise<SearchResult[]> {
  const apiKey = getSearchApiKey();
  if (!apiKey) {
    throw new Error('SerpApi Key 未配置');
  }

  let data: SerpApiSearchResponse;
  try {
    data = await invoke<SerpApiSearchResponse>('search_web', {
      query,
      apiKey: apiKey,
    });
  } catch (error) {
    throw new Error(`SerpApi 本地转发失败: ${getErrorMessage(error)}`);
  }

  const searchStatus = data?.search_metadata?.status;
  if (searchStatus && searchStatus !== 'Success') {
    const errorMessage = data?.error || data?.search_metadata?.error || '未知错误';
    throw new Error(`SerpApi 搜索失败: ${errorMessage}`);
  }

  const results: SearchResult[] = [];

  if (data.organic_results && Array.isArray(data.organic_results)) {
    for (const r of data.organic_results.slice(0, 5)) {
      results.push({
        title: r.title || '',
        url: r.link || r.url || '',
        snippet: r.snippet || r.description || '',
      });
    }
  }

  if (results.length === 0 && data.knowledge_graph?.description) {
    results.push({
      title: data.knowledge_graph.title || '搜索结果摘要',
      url: data.knowledge_graph.website || data.knowledge_graph.link || '',
      snippet: data.knowledge_graph.description,
    });
  }

  if (results.length === 0 && data.answer_box) {
    results.push({
      title: data.answer_box.title || '搜索结果摘要',
      url: data.answer_box.link || '',
      snippet: data.answer_box.answer || data.answer_box.snippet || JSON.stringify(data.answer_box),
    });
  }

  return results;
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
