// =============================================================================
// Quick-Chat — 统一 AI Service（OpenAI 兼容格式 + Tool Calling）
// =============================================================================

import type { ModelConfig } from '@/types/types';

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
  delta: string;
  accumulated: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
  extra_content?: Record<string, unknown>;
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentPart[];
  reasoning_content?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  name?: string;
}

export interface ChatCompletionParams {
  model: ModelConfig;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export type ChatCompletionResult =
  | { type: 'text'; stream: AsyncGenerator<StreamChunk, void, unknown>; reasoningContent: string; usage: TokenUsage | null }
  | { type: 'tool_calls'; toolCalls: ToolCall[]; assistantMessage: string; reasoningContent: string; usage: TokenUsage | null };

// ---------------------------------------------------------------------------
// 内置工具定义
// ---------------------------------------------------------------------------

export const WEB_SEARCH_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      'Search the web for current, real-time information. Use this when the user asks about recent events, news, weather, stock prices, sports results, or any information that may have changed after your knowledge cutoff.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query in Chinese or English',
        },
      },
      required: ['query'],
    },
  },
};

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

  if (model.provider === 'openrouter') {
    headers['HTTP-Referer'] = typeof window !== 'undefined' ? window.location.href : 'https://quick-chat.app';
    headers['X-Title'] = 'Quick Chat';
  }

  return headers;
}

function buildRequestBody(
  model: ModelConfig,
  messages: ChatMessage[],
  tools?: ToolDefinition[]
): unknown {
  const body: Record<string, unknown> = {
    model: model.model_id,
    messages,
    stream: true,
    temperature: model.temperature,
    max_tokens: model.max_tokens,
    top_p: model.top_p,
    stream_options: { include_usage: true },
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  return body;
}

// ---------------------------------------------------------------------------
// SSE 解析器（支持 tool_calls）
// ---------------------------------------------------------------------------

interface AccumulatedToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
  extra_content?: Record<string, unknown>;
}

interface SSEAccumulator {
  text: string;
  reasoningContent: string;
  toolCalls: Map<number, AccumulatedToolCall>;
  finishReason: string | null;
  usage: TokenUsage | null;
}

function createAccumulator(): SSEAccumulator {
  return { text: '', reasoningContent: '', toolCalls: new Map(), finishReason: null, usage: null };
}

function mergeDelta(acc: SSEAccumulator, delta: any): void {
  if (typeof delta.content === 'string') {
    acc.text += delta.content;
  }

  if (typeof delta.reasoning_content === 'string') {
    acc.reasoningContent += delta.reasoning_content;
  }

  if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
    for (const tc of delta.tool_calls) {
      const idx = tc.index ?? 0;
      if (!acc.toolCalls.has(idx)) {
        acc.toolCalls.set(idx, { id: tc.id, type: tc.type, function: {} });
      }
      const existing = acc.toolCalls.get(idx)!;
      if (tc.id) existing.id = tc.id;
      if (tc.type) existing.type = tc.type;
      if (tc.extra_content && typeof tc.extra_content === 'object') {
        existing.extra_content = tc.extra_content;
      }
      if (tc.function) {
        if (!existing.function) existing.function = {};
        if (tc.function.name) existing.function.name = tc.function.name;
        if (tc.function.arguments) {
          existing.function.arguments = (existing.function.arguments || '') + tc.function.arguments;
        }
      }
    }
  }
}

async function consumeStream(stream: ReadableStream<Uint8Array>): Promise<SSEAccumulator> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const acc = createAccumulator();

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
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          const finishReason = parsed.choices?.[0]?.finish_reason;
          if (finishReason) acc.finishReason = finishReason;
          if (delta) mergeDelta(acc, delta);
          if (parsed.usage) {
            acc.usage = {
              prompt_tokens: parsed.usage.prompt_tokens ?? parsed.usage.input_tokens ?? 0,
              completion_tokens: parsed.usage.completion_tokens ?? parsed.usage.output_tokens ?? 0,
              total_tokens: parsed.usage.total_tokens ?? 0,
            };
          }
          if (parsed.usage) {
            acc.usage = {
              prompt_tokens: parsed.usage.prompt_tokens ?? parsed.usage.input_tokens ?? 0,
              completion_tokens: parsed.usage.completion_tokens ?? parsed.usage.output_tokens ?? 0,
              total_tokens: parsed.usage.total_tokens ?? 0,
            };
          }
        } catch {
          // ignore
        }
      }
    }

    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6);
        if (data !== '[DONE]') {
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            const finishReason = parsed.choices?.[0]?.finish_reason;
            if (finishReason) acc.finishReason = finishReason;
            if (delta) mergeDelta(acc, delta);
            if (parsed.usage) {
              acc.usage = {
                prompt_tokens: parsed.usage.prompt_tokens ?? parsed.usage.input_tokens ?? 0,
                completion_tokens: parsed.usage.completion_tokens ?? parsed.usage.output_tokens ?? 0,
                total_tokens: parsed.usage.total_tokens ?? 0,
              };
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

  return acc;
}

function accumulatorToToolCalls(acc: SSEAccumulator): ToolCall[] {
  const calls: ToolCall[] = [];
  const indices = Array.from(acc.toolCalls.keys()).sort((a, b) => a - b);
  for (const idx of indices) {
    const tc = acc.toolCalls.get(idx)!;
    const fn = tc.function ?? {};
    calls.push({
      id: tc.id || `call_${idx}`,
      type: (tc.type as 'function') || 'function',
      function: {
        name: fn.name || '',
        arguments: fn.arguments || '',
      },
      ...(tc.extra_content ? { extra_content: tc.extra_content } : {}),
    });
  }
  return calls;
}

// ---------------------------------------------------------------------------
// 对外暴露的文本流式生成器（用于第二轮无 tool 的回复）
// ---------------------------------------------------------------------------

async function* parseTextStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<StreamChunk, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let accumulated = '';

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
            accumulated += delta;
            yield { delta, accumulated };
          }
          if (parsed.usage) {
            yield {
              delta: '',
              accumulated,
              usage: {
                prompt_tokens: parsed.usage.prompt_tokens ?? parsed.usage.input_tokens ?? 0,
                completion_tokens: parsed.usage.completion_tokens ?? parsed.usage.output_tokens ?? 0,
                total_tokens: parsed.usage.total_tokens ?? 0,
              },
            };
          }
        } catch {
          // ignore
        }
      }
    }

    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6);
        if (data !== '[DONE]') {
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === 'string') {
              accumulated += delta;
              yield { delta, accumulated };
            }
            if (parsed.usage) {
              yield {
                delta: '',
                accumulated,
                usage: {
                  prompt_tokens: parsed.usage.prompt_tokens ?? parsed.usage.input_tokens ?? 0,
                  completion_tokens: parsed.usage.completion_tokens ?? parsed.usage.output_tokens ?? 0,
                  total_tokens: parsed.usage.total_tokens ?? 0,
                },
              };
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
// 主入口：带 tool calling 的对话
// ---------------------------------------------------------------------------

export async function chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
  const { model, messages, tools, signal } = params;

  const endpoint = getApiEndpoint(model);
  const url = `${endpoint.replace(/\/$/, '')}/chat/completions`;
  const headers = buildHeaders(model);
  const body = buildRequestBody(model, messages, tools);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
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

  // 先消费完整流以判断是文本还是 tool call
  const acc = await consumeStream(response.body);

  // 如果是 tool call
  if (acc.finishReason === 'tool_calls' || acc.toolCalls.size > 0) {
    const toolCalls = accumulatorToToolCalls(acc);
    if (toolCalls.length > 0) {
      return {
        type: 'tool_calls',
        toolCalls,
        assistantMessage: acc.text,
        reasoningContent: acc.reasoningContent,
        usage: acc.usage,
      };
    }
  }

  // 否则是纯文本，但我们已经消费完了流，需要模拟一个 stream
  // 为了兼容现有 UI，将完整文本包装成单 chunk stream
  return {
    type: 'text',
    stream: (async function* () {
      if (acc.text) {
        yield { delta: acc.text, accumulated: acc.text };
      }
      if (acc.usage) {
        yield { delta: '', accumulated: acc.text, usage: acc.usage };
      }
    })(),
    reasoningContent: acc.reasoningContent,
    usage: acc.usage,
  };
}

// ---------------------------------------------------------------------------
// 纯文本流式对话（不带 tools，用于显示最终结果）
// ---------------------------------------------------------------------------

export async function streamTextCompletion(
  params: Omit<ChatCompletionParams, 'tools'>
): Promise<AsyncGenerator<StreamChunk, void, unknown>> {
  const { model, messages, signal } = params;

  const endpoint = getApiEndpoint(model);
  const url = `${endpoint.replace(/\/$/, '')}/chat/completions`;
  const headers = buildHeaders(model);
  const body = buildRequestBody(model, messages);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
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

  return parseTextStream(response.body);
}

// ---------------------------------------------------------------------------
// 对话标题生成（后台静默调用）
// ---------------------------------------------------------------------------

export async function generateConversationTitle(
  messages: { role: string; content: string }[],
  openrouterModel: ModelConfig
): Promise<string | null> {
  const endpoint = getApiEndpoint(openrouterModel);
  const url = `${endpoint.replace(/\/$/, '')}/chat/completions`;
  const headers = buildHeaders(openrouterModel);

  const promptMessages: ChatMessage[] = [
    {
      role: 'system',
      content:
        '你是一个对话标题生成助手。请根据对话内容生成一个简洁的中文标题（不超过15个字）。只输出标题文本，不要加引号，不要有任何解释。',
    },
    ...messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-6)
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content.slice(0, 500),
      })),
    {
      role: 'user',
      content: '请为以上对话生成一个简洁的中文标题（不超过15个字）：',
    },
  ];

  const body = {
    model: 'openai/gpt-oss-120b:free',
    messages: promptMessages,
    stream: false,
    temperature: 0.5,
    max_tokens: 30,
  };

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

  const data = await response.json();

  const title =
    data.choices?.[0]?.message?.content?.trim() ||
    data.choices?.[0]?.text?.trim() ||
    '';

  if (!title) return null;

  return (
    title
      .replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '')
      .replace(/\n+/g, ' ')
      .trim()
      .slice(0, 20) || null
  );
}
