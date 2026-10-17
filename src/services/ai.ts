// =============================================================================
// Quick-Chat — AI Service 前端客户端（薄封装）
// =============================================================================
// AI 管线（SSE 解析、tool-calling 循环、标题生成、图片描述）都在 Electron
// 主进程（electron/ai.ts、electron/chat.ts）。本模块负责：
//   - runChat/abortChat：发起主进程对话循环，流式增量经 qc:event:ai:stream 分发
//   - generateConversationTitle / describeImage / fetchModelThinkingEfforts：invoke 包装
//   - 前端 UI 仍需要的纯函数（标题兜底、OpenRouter 判定、思考档位 key）
// =============================================================================

import { invoke, onEvent } from '@/services/bridge';
import type { ModelConfig, ThinkingEfforts } from '@/types/types';

// ---------------------------------------------------------------------------
// 类型（与 electron/ai.ts、electron/chat.ts 的 IPC 载荷结构对齐）
// ---------------------------------------------------------------------------

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface UrlCitation {
  url: string;
  title?: string;
  content?: string;
  start_index?: number;
  end_index?: number;
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentPart[];
  reasoning_content?: string;
  tool_call_id?: string;
  name?: string;
}

export type ChatErrorCode = 'aborted' | 'reasoning_effort' | 'error';

/** 主进程对话循环的最终结果（runChatLoop 的 ChatLoopOutcome） */
export interface ChatOutcome {
  ok: boolean;
  /** 最终正文（ok 时已附引用列表；aborted 时为中断前的部分正文） */
  content: string;
  /** 跨工具轮次累计的思考内容 */
  reasoningContent: string;
  usage: TokenUsage | null;
  citations: UrlCitation[];
  finishReason: string | null;
  errorCode?: ChatErrorCode;
  errorMessage?: string;
}

export interface ChatStreamHandlers {
  onReasoning?: (delta: string, accumulated: string) => void;
  onText?: (delta: string, accumulated: string) => void;
  /** 一轮工具调用开始；names 为工具名（UI 标签由调用方映射） */
  onToolStart?: (names: string[]) => void;
  /** 工具轮结束、即将发起下一轮请求：UI 应恢复「思考中」状态 */
  onRoundReset?: () => void;
}

// ---------------------------------------------------------------------------
// 流式对话
// ---------------------------------------------------------------------------

type StreamPayload = {
  requestId?: string;
  type?: string;
  delta?: string;
  accumulated?: string;
  names?: string[];
};

const streamHandlers = new Map<string, ChatStreamHandlers>();
let streamSubscribed = false;

function ensureStreamSubscription(): void {
  if (streamSubscribed) return;
  streamSubscribed = true;
  onEvent('ai:stream', (payload) => {
    const p = payload as StreamPayload;
    if (!p || typeof p.requestId !== 'string') return;
    const handlers = streamHandlers.get(p.requestId);
    if (!handlers) return;
    switch (p.type) {
      case 'reasoning':
        handlers.onReasoning?.(p.delta ?? '', p.accumulated ?? '');
        break;
      case 'text':
        handlers.onText?.(p.delta ?? '', p.accumulated ?? '');
        break;
      case 'tool_start':
        handlers.onToolStart?.(Array.isArray(p.names) ? p.names : []);
        break;
      case 'round_reset':
        handlers.onRoundReset?.();
        break;
    }
  });
}

/**
 * 发起一轮完整对话（含工具循环与空回复补发）。
 * 流式增量经 handlers 回调；resolve 为最终 ChatOutcome（业务失败也 resolve，
 * 以 ok/errorCode 区分；仅桥本身不可用时 reject）。
 */
export async function runChat(
  requestId: string,
  params: { model: ModelConfig; messages: ChatMessage[]; thinkingLevel?: string | null },
  handlers: ChatStreamHandlers
): Promise<ChatOutcome> {
  ensureStreamSubscription();
  streamHandlers.set(requestId, handlers);
  try {
    return await invoke<ChatOutcome>('ai:chat', { requestId, ...params });
  } finally {
    streamHandlers.delete(requestId);
  }
}

export const abortChat = (requestId: string) =>
  invoke<void>('ai:abort', { requestId });

// ---------------------------------------------------------------------------
// 非流式调用
// ---------------------------------------------------------------------------

export const generateConversationTitle = (
  messages: { role: string; content: string }[],
  titleModel: ModelConfig
) => invoke<string | null>('ai:generate_title', { messages, model: titleModel });

export const describeImage = (imageDataUrl: string, visionModel: ModelConfig) =>
  invoke<string | null>('ai:describe_image', { imageDataUrl, model: visionModel });

export const fetchModelThinkingEfforts = (model: ModelConfig) =>
  invoke<ThinkingEfforts | null>('ai:thinking_efforts', { model });

// ---------------------------------------------------------------------------
// 前端 UI 仍需要的纯函数（与 electron/ai.ts 保持一致的小份拷贝）
// ---------------------------------------------------------------------------

/** 是否 OpenRouter 端点：provider 已统一为 openai_compatible，按 endpoint 域名识别 */
export function isOpenRouterModel(model: Pick<ModelConfig, 'api_endpoint'>): boolean {
  return (model.api_endpoint ?? '').includes('openrouter.ai');
}

/** 思考强度缓存的 key：OpenRouter 模型即官方 slug（provider:model_id） */
export function thinkingEffortsKey(model: Pick<ModelConfig, 'provider' | 'model_id'>): string {
  return `${model.provider}:${model.model_id}`;
}

const TITLE_MAX_LENGTH = 20;
const PLACEHOLDER_TITLES = new Set(['', 'new chat', 'untitled', '新对话']);

export function isPlaceholderConversationTitle(title: string | null | undefined): boolean {
  return PLACEHOLDER_TITLES.has((title ?? '').trim().toLowerCase());
}

function cleanTitleText(title: string): string | null {
  const cleaned = title
    .replace(/^(?:标题|题目)\s*[:：]\s*/i, '')
    .replace(/^["'“‘「『《]+|["'”’」』》]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[。.!！?？,，、;；:：\s]+$/g, '')
    .trim();

  if (!cleaned || isPlaceholderConversationTitle(cleaned)) return null;
  return Array.from(cleaned).slice(0, TITLE_MAX_LENGTH).join('') || null;
}

function stripTitleNoise(content: string): string {
  return content
    .replace(/<!--\s*(?:attachments|image-descriptions):[\s\S]*?-->/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^[\s>*-]+/gm, '')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function generateFallbackConversationTitle(
  messages: { role: string; content: string }[]
): string | null {
  const source =
    messages.find((m) => m.role === 'user' && stripTitleNoise(m.content)) ??
    messages.find((m) => stripTitleNoise(m.content));
  if (!source) return null;

  const cleaned = stripTitleNoise(source.content);
  if (!cleaned) return null;

  const topicPrefix = cleaned.match(/^(.{6,18})[：:]/u)?.[1];
  const firstSentence = cleaned.split(/[。！？!?]/)[0] || cleaned;

  return cleanTitleText(topicPrefix || firstSentence);
}
