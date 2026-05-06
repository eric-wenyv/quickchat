// =============================================================================
// Quick-Chat — 统一 AI Service（OpenAI 兼容格式）
// =============================================================================
// 设计原则：
//   1. 所有 Provider 统一走 OpenAI Chat Completions API 格式。
//   2. Gemini 通过其 OpenAI 兼容 endpoint 调用，不再依赖 @google/genai。
//   3. 流式响应统一使用 fetch + ReadableStream SSE 解析。
// =============================================================================

import type { ModelConfig, Message, UUID } from '@/types/types';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const DEFAULT_ENDPOINTS: Record<string, string> = {
  google_gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  openrouter: 'https://openrouter.ai/api/v1/',
  openai_compatible: '',
};

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface StreamChunk {
  /** 本次增量文本 */
  delta: string;
  /** 截至目前累计的完整文本 */
  accumulated: string;
}

export interface ChatCompletionParams {
  model: ModelConfig;
  conversationId: UUID;
  systemPrompt: string | null;
  messages: Message[];
  userContent: string;
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function getApiEndpoint(model: ModelConfig): string {
  if (model.api_endpoint) return model.api_endpoint;
  const base = DEFAULT_ENDPOINTS[model.provider];
  if (!base && model.provider === 'openai_compatible') {
    throw new Error('自定义 OpenAI 兼容 API 必须填写 API Endpoint');
  }
  return base;
}

function buildHeaders(model: ModelConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${model.api_key}`,
  };

  // OpenRouter 需要额外标识
  if (model.provider === 'openrouter') {
    headers['HTTP-Referer'] = typeof window !== 'undefined' ? window.location.href : 'https://quick-chat.app';
    headers['X-Title'] = 'Quick Chat';
  }

  return headers;
}

function buildRequestBody(
  model: ModelConfig,
  systemPrompt: string | null,
  history: Message[],
  userContent: string
): unknown {
  const messages: Array<{ role: string; content: string }> = [];

  if (systemPrompt?.trim()) {
    messages.push({ role: 'system', content: systemPrompt.trim() });
  }

  for (const msg of history) {
    if (!msg.content.trim()) continue;
    if (msg.role === 'assistant') {
      messages.push({ role: 'assistant', content: msg.content });
    } else if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.content });
    }
  }

  messages.push({ role: 'user', content: userContent });

  const body: Record<string, unknown> = {
    model: model.model_id,
    messages,
    stream: true,
    temperature: model.temperature,
    max_tokens: model.max_tokens,
    top_p: model.top_p,
  };

  // Gemini thinking level → reasoning_effort (OpenAI 兼容映射)
  if (model.provider === 'google_gemini' && model.thinking_level && model.model_id.includes('gemini-3')) {
    // Gemini OpenAI 兼容端点暂时不暴露 thinkingConfig，保留原有 temperature/top_p 控制即可
    // 如果将来支持，可在此扩展
  }

  return body;
}

// ---------------------------------------------------------------------------
// SSE 解析器
// ---------------------------------------------------------------------------

async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<string, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === 'string') {
            yield delta;
          }
        } catch {
          // 忽略无法解析的行
        }
      }
    }

    // 处理剩余缓冲
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6);
        if (data !== '[DONE]') {
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === 'string') {
              yield delta;
            }
          } catch {
            // ignore
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// 主入口：流式对话
// ---------------------------------------------------------------------------

export async function* streamChatCompletion(
  params: ChatCompletionParams
): AsyncGenerator<StreamChunk, void, unknown> {
  const { model, systemPrompt, messages, userContent } = params;

  const endpoint = getApiEndpoint(model);
  const url = `${endpoint.replace(/\/$/, '')}/chat/completions`;
  const headers = buildHeaders(model);
  const body = buildRequestBody(model, systemPrompt, messages, userContent);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errorText = '';
    try {
      const errorJson = await response.json();
      errorText = errorJson.error?.message || JSON.stringify(errorJson);
    } catch {
      errorText = await response.text();
    }
    throw new Error(`API 请求失败 (${response.status}): ${errorText || response.statusText}`);
  }

  if (!response.body) {
    throw new Error('API 返回了空的响应体');
  }

  let accumulated = '';
  for await (const delta of parseSSE(response.body)) {
    accumulated += delta;
    yield { delta, accumulated };
  }
}
