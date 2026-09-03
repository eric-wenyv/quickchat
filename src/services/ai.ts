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

const TITLE_MAX_LENGTH = 20;
const PLACEHOLDER_TITLES = new Set(['', 'new chat', 'untitled', '新对话']);


// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface StreamChunk {
  delta: string;
  accumulated: string;
  citations?: UrlCitation[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export type FunctionToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type OpenRouterWebSearchTool = {
  type: 'openrouter:web_search';
  parameters?: {
    engine?: 'auto' | 'native' | 'exa' | 'firecrawl' | 'parallel' | 'perplexity';
    max_results?: number;
    max_total_results?: number;
    search_context_size?: 'low' | 'medium' | 'high';
    allowed_domains?: string[];
    excluded_domains?: string[];
    max_characters?: number;
  };
};

export type ToolDefinition = FunctionToolDefinition | OpenRouterWebSearchTool;

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
  webSearch?: WebSearchOptions;
  thinkingLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  signal?: AbortSignal;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface WebSearchOptions {
  enabled: boolean;
  mode: 'official' | 'legacy_tavily' | 'disabled';
}

export interface UrlCitation {
  url: string;
  title?: string;
  content?: string;
  start_index?: number;
  end_index?: number;
}

export type ChatCompletionResult =
  | { type: 'text'; stream: AsyncGenerator<StreamChunk, void, unknown>; reasoningContent: string; usage: TokenUsage | null; citations?: UrlCitation[]; lateToolCalls?: ToolCall[] }
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

/**
 * AI 阅读网页内容的工具：当用户消息包含 URL、要求阅读/总结某个页面，
 * 或回答需要引用页面具体内容时，模型传入 URL，工具返回抓取到的正文文本。
 */
export const READ_URL_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_url',
    description:
      'Fetch and read the text content of a web page. Use this when the user shares a URL, asks to read or summarize a page, or when answering requires the actual content of a specific web page.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The full http/https URL of the page to read',
        },
      },
      required: ['url'],
    },
  },
};

/**
 * AI 自主调用 Skill 的工具：模型从系统提示中的可用 Skill 目录选择一个名称，
 * 工具返回该 Skill 的完整指引（SKILL.md 内容），模型随后遵循其指引回答。
 * 标注了 disable-model-invocation 的 Skill 不出现在目录中，此工具也拒绝加载。
 */
export const USE_SKILL_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'use_skill',
    description:
      'Load the full instructions of an available skill by name. Call this only when the user\'s request clearly matches a skill\'s described purpose from the available skills list, then follow the returned instructions.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The exact skill name from the available skills list',
        },
      },
      required: ['name'],
    },
  },
};

/** 构造注入系统提示的可用 Skill 目录（仅 AI 可自主调用的部分） */
export function buildSkillCatalogPrompt(skills: Array<{ id: string; name: string; description: string }>): string {
  const lines = skills.map(s => `- ${s.id}: ${s.description || s.name}`);
  return [
    '## 可调用的 Skill 列表 / Available Skills',
    '',
    '当用户的请求与下列某个 Skill 的用途明确匹配时，调用 use_skill 工具加载其完整指引，并严格遵循返回的指引完成任务。',
    'When the user\'s request clearly matches one of the skills below, call the use_skill tool to load its full instructions and follow them.',
    '仅在有明确匹配时调用；不要为无关请求调用；同一条回复不要重复加载同一个 Skill。',
    '',
    ...lines,
  ].join('\n');
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

  if (model.provider === 'openrouter') {
    headers['HTTP-Referer'] = typeof window !== 'undefined' ? window.location.href : 'https://quick-chat.app';
    headers['X-Title'] = 'Quick Chat';
  }

  return headers;
}

export function getWebSearchOptions(model: ModelConfig): WebSearchOptions {
  if (model.provider === 'openrouter') {
    return { enabled: true, mode: 'official' };
  }
  if (model.provider === 'google_gemini' || model.provider === 'openai_compatible') {
    return { enabled: true, mode: 'legacy_tavily' };
  }
  return { enabled: false, mode: 'disabled' };
}

export function buildOpenRouterWebSearchTool(): OpenRouterWebSearchTool {
  return {
    type: 'openrouter:web_search',
    parameters: {
      engine: 'auto',
      max_results: 5,
      max_total_results: 10,
      search_context_size: 'medium',
    },
  };
}

export function dedupeCitations(citations?: UrlCitation[]): UrlCitation[] {
  if (!citations?.length) return [];

  const seen = new Set<string>();
  const unique: UrlCitation[] = [];
  for (const citation of citations) {
    const url = citation.url.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    unique.push({ ...citation, url });
  }
  return unique;
}

export function appendCitationList(content: string, citations?: UrlCitation[]): string {
  const unique = dedupeCitations(citations);
  if (unique.length === 0) return content;

  const sources = unique.map((citation, index) => {
    const label = citation.title?.trim() || citation.url;
    return `${index + 1}. [${label}](${citation.url})`;
  });

  return `${content.trimEnd()}\n\n来源：\n${sources.join('\n')}`;
}

export function isPlaceholderConversationTitle(title: string | null | undefined): boolean {
  return PLACEHOLDER_TITLES.has((title ?? '').trim().toLowerCase());
}

function cleanTitleText(title: string): string | null {
  const cleaned = title
    .replace(/^(?:标题|题目)\s*[:：]\s*/i, '')
    .replace(/^["'\u201c\u2018「『《]+|["'\u201d\u2019」』》]+$/g, '')
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

function buildRequestBody(
  model: ModelConfig,
  messages: ChatMessage[],
  tools?: ToolDefinition[],
  webSearch?: WebSearchOptions,
  thinkingLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | null
): unknown {
  // 思考模型官方建议不干预采样参数（temperature/top_p 固定为 1），由推理力度控制行为
  const thinkingEnabled = thinkingLevel != null;
  const body: Record<string, unknown> = {
    model: model.model_id,
    messages,
    stream: true,
    temperature: thinkingEnabled ? 1.0 : model.temperature,
    max_tokens: model.max_tokens,
    top_p: thinkingEnabled ? 1.0 : model.top_p,
    stream_options: { include_usage: true },
  };

  if (thinkingEnabled) {
    // OpenAI 风格的 reasoning_effort；OpenRouter 会将其归一化（两种格式只能发其一）
    body.reasoning_effort = thinkingLevel.toLowerCase();
  }

  if (model.provider === 'openrouter' && webSearch?.enabled && webSearch.mode === 'official') {
    // OpenRouter 官方网页搜索工具与本地 function tools（如 use_skill）可以并存
    body.tools = [buildOpenRouterWebSearchTool(), ...(tools ?? [])];
    body.tool_choice = 'auto';
  } else if (tools && tools.length > 0) {
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
  citations: UrlCitation[];
}

function createAccumulator(): SSEAccumulator {
  return { text: '', reasoningContent: '', toolCalls: new Map(), finishReason: null, usage: null, citations: [] };
}

interface SSEReaderState {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  buffer: string;
  done: boolean;
}

function createReaderState(stream: ReadableStream<Uint8Array>): SSEReaderState {
  return {
    reader: stream.getReader(),
    decoder: new TextDecoder('utf-8'),
    buffer: '',
    done: false,
  };
}

function parseUsage(usage: any): TokenUsage {
  return {
    prompt_tokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
    completion_tokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
    total_tokens: usage.total_tokens ?? 0,
  };
}

function normalizeUrlCitation(annotation: any): UrlCitation | null {
  if (!annotation || typeof annotation !== 'object') return null;
  const source = annotation.url_citation && typeof annotation.url_citation === 'object'
    ? annotation.url_citation
    : annotation;
  const url = typeof source.url === 'string' ? source.url : '';
  if (!url) return null;

  return {
    url,
    ...(typeof source.title === 'string' ? { title: source.title } : {}),
    ...(typeof source.content === 'string' ? { content: source.content } : {}),
    ...(typeof source.start_index === 'number' ? { start_index: source.start_index } : {}),
    ...(typeof source.end_index === 'number' ? { end_index: source.end_index } : {}),
    ...(typeof source.startIndex === 'number' ? { start_index: source.startIndex } : {}),
    ...(typeof source.endIndex === 'number' ? { end_index: source.endIndex } : {}),
  };
}

function mergeCitationAnnotations(acc: SSEAccumulator, annotations: unknown): void {
  if (!Array.isArray(annotations)) return;

  const next = annotations
    .filter((annotation) => {
      if (!annotation || typeof annotation !== 'object') return false;
      const type = (annotation as { type?: unknown }).type;
      return type === undefined || type === 'url_citation';
    })
    .map(normalizeUrlCitation)
    .filter((citation): citation is UrlCitation => citation !== null);

  if (next.length > 0) {
    acc.citations = dedupeCitations([...acc.citations, ...next]);
  }
}

function collectCitationsFromParsed(acc: SSEAccumulator, parsed: any): void {
  const choice = parsed.choices?.[0];
  mergeCitationAnnotations(acc, choice?.delta?.annotations);
  mergeCitationAnnotations(acc, choice?.message?.annotations);
  mergeCitationAnnotations(acc, choice?.annotations);
  mergeCitationAnnotations(acc, parsed.annotations);
}

function mergeDelta(acc: SSEAccumulator, delta: any): void {
  if (typeof delta.content === 'string') {
    acc.text += delta.content;
  }

  if (typeof delta.reasoning_content === 'string') {
    acc.reasoningContent += delta.reasoning_content;
  } else if (typeof delta.reasoning === 'string') {
    // OpenRouter 归一化的思考分片使用 delta.reasoning 字段
    acc.reasoningContent += delta.reasoning;
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

function applyParsedEvent(acc: SSEAccumulator, parsed: any): void {
  // OpenRouter 会在流内下发错误事件（如上游 500）；若静默忽略，
  // 用户只会看到误导性的"模型返回了空内容"而不是真实原因
  if (parsed && typeof parsed === 'object' && parsed.error) {
    const err = parsed.error;
    if (typeof err === 'string') {
      throw new Error(`API 流式响应错误: ${err}`);
    }
    const code = err?.code != null ? ` (${err.code})` : '';
    const message = typeof err?.message === 'string' && err.message ? err.message : JSON.stringify(err);
    throw new Error(`API 流式响应错误${code}: ${message}`);
  }
  collectCitationsFromParsed(acc, parsed);
  const delta = parsed.choices?.[0]?.delta;
  const finishReason = parsed.choices?.[0]?.finish_reason;
  if (finishReason) acc.finishReason = finishReason;
  if (delta) mergeDelta(acc, delta);
  if (parsed.usage) {
    acc.usage = parseUsage(parsed.usage);
  }
}

async function readNextSSEData(state: SSEReaderState): Promise<string | null> {
  while (true) {
    const newlineIndex = state.buffer.indexOf('\n');
    if (newlineIndex >= 0) {
      const line = state.buffer.slice(0, newlineIndex);
      state.buffer = state.buffer.slice(newlineIndex + 1);
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      return data === '[DONE]' ? null : data;
    }

    if (state.done) {
      const trimmed = state.buffer.trim();
      state.buffer = '';
      if (!trimmed.startsWith('data: ')) return null;
      const data = trimmed.slice(6);
      return data === '[DONE]' ? null : data;
    }

    const { done, value } = await state.reader.read();
    if (done) {
      state.done = true;
      state.buffer += state.decoder.decode();
    } else {
      state.buffer += state.decoder.decode(value, { stream: true });
    }
  }
}

async function readNextParsedEvent(state: SSEReaderState): Promise<any | null> {
  while (true) {
    const data = await readNextSSEData(state);
    if (data === null) return null;
    try {
      return JSON.parse(data);
    } catch {
      // ignore malformed SSE payloads and continue reading
    }
  }
}

async function consumeRemainingParsedStream(state: SSEReaderState, acc: SSEAccumulator): Promise<void> {
  while (true) {
    const parsed = await readNextParsedEvent(state);
    if (parsed === null) return;
    applyParsedEvent(acc, parsed);
  }
}

function hasToolCallDelta(parsed: any): boolean {
  const toolCalls = parsed.choices?.[0]?.delta?.tool_calls;
  return Array.isArray(toolCalls) && toolCalls.length > 0;
}

function textDeltaFromParsed(parsed: any): string | null {
  const delta = parsed.choices?.[0]?.delta?.content;
  return typeof delta === 'string' ? delta : null;
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

async function* continueTextStream(
  state: SSEReaderState,
  acc: SSEAccumulator,
  result: Extract<ChatCompletionResult, { type: 'text' }>,
  firstDelta: string | null
): AsyncGenerator<StreamChunk, void, unknown> {
  try {
    if (firstDelta !== null) {
      yield { delta: firstDelta, accumulated: acc.text };
    }

    // 混合响应：正文开始后又出现 tool_calls（GLM 等思考模型先输出一段前言再调工具，
    // OpenAI 规范允许 content 与 tool_calls 并存）。此时停止产出文本增量，
    // 继续累积事件；流结束后经 result.lateToolCalls 交给调用方续跑工具循环。
    let mixedToolCalls = false;

    while (true) {
      const parsed = await readNextParsedEvent(state);
      if (parsed === null) return;

      if (hasToolCallDelta(parsed)) {
        mixedToolCalls = true;
      }

      applyParsedEvent(acc, parsed);
      result.reasoningContent = acc.reasoningContent;
      result.usage = acc.usage;
      result.citations = acc.citations;

      if (mixedToolCalls) continue;

      const delta = textDeltaFromParsed(parsed);
      if (delta !== null) {
        yield { delta, accumulated: acc.text };
      }
      if (parsed.usage) {
        const chunk: StreamChunk = { delta: '', accumulated: acc.text, usage: acc.usage ?? undefined };
        if (acc.citations.length > 0) {
          chunk.citations = acc.citations;
        }
        yield chunk;
      }
    }
  } finally {
    result.reasoningContent = acc.reasoningContent;
    result.usage = acc.usage;
    result.citations = acc.citations;
    if (acc.toolCalls.size > 0) {
      result.lateToolCalls = accumulatorToToolCalls(acc);
    }
    state.reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// 主入口：带 tool calling 的对话
// ---------------------------------------------------------------------------

export async function chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
  const { model, messages, tools, webSearch, thinkingLevel, signal } = params;

  const endpoint = getApiEndpoint(model);
  const url = `${endpoint.replace(/\/$/, '')}/chat/completions`;
  const headers = buildHeaders(model);
  const body = buildRequestBody(model, messages, tools, webSearch, thinkingLevel);

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

  const state = createReaderState(response.body);
  const acc = createAccumulator();

  try {
    while (true) {
      const parsed = await readNextParsedEvent(state);
      if (parsed === null) {
        state.reader.releaseLock();
        return {
          type: 'text',
          stream: (async function* () {
            if (acc.usage) {
              yield { delta: '', accumulated: acc.text, usage: acc.usage };
            }
          })(),
          reasoningContent: acc.reasoningContent,
          usage: acc.usage,
          citations: acc.citations,
        };
      }

      applyParsedEvent(acc, parsed);

      if (hasToolCallDelta(parsed) || acc.finishReason === 'tool_calls' || acc.toolCalls.size > 0) {
        await consumeRemainingParsedStream(state, acc);
        state.reader.releaseLock();

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

      const firstDelta = textDeltaFromParsed(parsed);
      // 只有非空正文分片才提交文本分支：思考模型的 reasoning 总是先于 content /
      // tool_calls 到达，若凭 reasoning 就提交，随后的 tool_calls 会被 continueTextStream
      // 当成"文本后又触发工具"的混合响应；而 OpenRouter web_search 的引用分片 content
      // 为空字符串，若据其提交，随后的 tool_calls 会全部挂进 lateToolCalls 被调用方丢弃，
      // 最终误报"返回了空内容"。
      if (firstDelta) {
        const result: Extract<ChatCompletionResult, { type: 'text' }> = {
          type: 'text',
          stream: undefined as unknown as AsyncGenerator<StreamChunk, void, unknown>,
          reasoningContent: acc.reasoningContent,
          usage: acc.usage,
          citations: acc.citations,
        };
        result.stream = continueTextStream(state, acc, result, firstDelta);
        return result;
      }
    }
  } catch (error) {
    state.reader.releaseLock();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// 纯文本流式对话（不带 tools，用于显示最终结果）
// ---------------------------------------------------------------------------

export async function streamTextCompletion(
  params: Omit<ChatCompletionParams, 'tools'>
): Promise<AsyncGenerator<StreamChunk, void, unknown>> {
  const { model, messages, thinkingLevel, signal } = params;

  const endpoint = getApiEndpoint(model);
  const url = `${endpoint.replace(/\/$/, '')}/chat/completions`;
  const headers = buildHeaders(model);
  const body = buildRequestBody(model, messages, undefined, undefined, thinkingLevel);

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
  titleModel: ModelConfig
): Promise<string | null> {
  const endpoint = getApiEndpoint(titleModel);
  const url = `${endpoint.replace(/\/$/, '')}/chat/completions`;
  const headers = buildHeaders(titleModel);

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
    model: titleModel.model_id,
    messages: promptMessages,
    stream: false,
    temperature: Math.min(titleModel.temperature, 0.5),
    max_tokens: 40,
    top_p: titleModel.top_p,
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

  return cleanTitleText(title);
}

// ---------------------------------------------------------------------------
// 图片描述（非流式，用 vision 模型解析图片内容为文本）
// ---------------------------------------------------------------------------

/**
 * 使用指定的 vision 模型描述图片内容。
 * 非流式调用，返回纯文本描述。
 *
 * @param imageDataUrl 图片的 data URL（base64 编码）
 * @param visionModel 支持 vision 的模型配置
 * @returns 图片的文字描述，失败时返回 null
 */
export async function describeImage(
  imageDataUrl: string,
  visionModel: ModelConfig
): Promise<string | null> {
  const endpoint = getApiEndpoint(visionModel);
  const url = `${endpoint.replace(/\/$/, '')}/chat/completions`;
  const headers = buildHeaders(visionModel);

  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: '请详细描述这张图片的内容。包括图片中的文字、场景、人物、物体等关键信息。用中文回复。' },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    },
  ];

  const body = {
    model: visionModel.model_id,
    messages,
    stream: false,
    temperature: 0.3,
    max_tokens: 1024,
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
    throw new Error(`图片描述 API 请求失败 (${response.status}): ${errorText || response.statusText}`);
  }

  const data = await response.json();
  const description =
    data.choices?.[0]?.message?.content?.trim() ||
    data.choices?.[0]?.text?.trim() ||
    null;

  return description;
}
