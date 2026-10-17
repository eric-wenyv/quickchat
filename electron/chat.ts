// =============================================================================
// Quick-Chat — 对话编排（Electron 主进程）
// =============================================================================
// 一次「发送消息」的完整 AI 管线：Skill 目录注入、tool-calling 循环
// （read_url / web_search / use_skill 的执行就在主进程，不再经桥来回）、
// 混合响应（正文后又触发工具）、空回复自动补发。
// 流式增量经 emit 回调以事件形式交出去（ipc.ts 转发给渲染进程）；
// 本模块不直接依赖 Electron 对象，便于测试。
// =============================================================================

import {
  appendCitationList,
  buildSkillCatalogPrompt,
  chatCompletion,
  ReasoningEffortError,
  READ_URL_TOOL,
  USE_SKILL_TOOL,
  WEB_SEARCH_TOOL,
  type AiModelConfig,
  type ChatMessage,
  type TokenUsage,
  type ToolCall,
  type ToolDefinition,
  type UrlCitation,
} from './ai.js';
import { fetchUrl, formatSearchResults, formatUrlContent, normalizeTavilySearchResponse, searchWeb } from './commands.js';
import * as skills from './skills.js';

// ---------------------------------------------------------------------------
// 事件与结果类型（经 IPC 发给渲染进程）
// ---------------------------------------------------------------------------

export type ChatStreamEvent =
  | { type: 'reasoning'; delta: string; accumulated: string }
  | { type: 'text'; delta: string; accumulated: string }
  /** 一轮工具调用开始；names 为工具名（UI 标签映射在前端） */
  | { type: 'tool_start'; names: string[] }
  /** 工具轮结束、即将发起下一轮请求：UI 应恢复「思考中」状态 */
  | { type: 'round_reset' };

export type ChatLoopErrorCode = 'aborted' | 'reasoning_effort' | 'error';

export interface ChatLoopOutcome {
  ok: boolean;
  /** 最终正文（ok 时已附引用列表；aborted 时为中断前的部分正文） */
  content: string;
  /** 跨工具轮次累计的思考内容 */
  reasoningContent: string;
  usage: TokenUsage | null;
  citations: UrlCitation[];
  finishReason: string | null;
  errorCode?: ChatLoopErrorCode;
  errorMessage?: string;
}

export interface ChatLoopParams {
  model: AiModelConfig;
  /** 前端构建好的对话历史（含内置 artifact 提示与会话系统提示） */
  messages: ChatMessage[];
  thinkingLevel?: string | null;
  signal?: AbortSignal;
}

export type ChatLoopEmit = (event: ChatStreamEvent) => void;

// ---------------------------------------------------------------------------
// 工具执行
// ---------------------------------------------------------------------------

async function executeToolCall(call: ToolCall, autoSkills: skills.SkillMeta[]): Promise<string> {
  if (call.function.name === 'read_url') {
    try {
      const args = JSON.parse(call.function.arguments || '{}');
      const url = String(args.url || '').trim();
      if (!url) return '读取网页失败: 未提供有效的 url 参数';
      const page = await fetchUrl(url);
      return formatUrlContent(page);
    } catch (e: any) {
      return `读取网页失败: ${e?.message ?? e}`;
    }
  }

  if (call.function.name === 'web_search') {
    try {
      const args = JSON.parse(call.function.arguments || '{}');
      const query = String(args.query || '').trim();
      if (!query) return '搜索失败: 未提供有效的 query 参数';
      const data = (await searchWeb(query)) as { error?: string };
      if (data?.error) return `搜索失败: ${data.error}`;
      return formatSearchResults(query, normalizeTavilySearchResponse(data));
    } catch (e: any) {
      return `搜索失败: ${e?.message ?? e}`;
    }
  }

  if (call.function.name === 'use_skill') {
    try {
      const args = JSON.parse(call.function.arguments || '{}');
      const requested = String(args.name || '').trim();
      const skill = autoSkills.find(s => s.id === requested || s.name === requested);
      if (skill) {
        const skillMarkdown = await skills.readSkill(skill.id);
        return `# Skill: ${skill.name}\n\n${skillMarkdown}\n\n---\n以上是 Skill「${skill.name}」的完整指引，请遵循它回应用户的请求。`;
      }
      return `Skill "${requested}" 不存在或未允许自主调用。可调用的 Skill: ${autoSkills.map(s => s.id).join(', ') || '(无)'}`;
    } catch (e: any) {
      return `加载 Skill 失败: ${e?.message ?? e}`;
    }
  }

  return `未知工具: ${call.function.name}`;
}

async function runToolCalls(
  calls: ToolCall[],
  chatHistory: ChatMessage[],
  autoSkills: skills.SkillMeta[],
  emit: ChatLoopEmit,
): Promise<void> {
  emit({ type: 'tool_start', names: calls.map(tc => tc.function.name) });

  for (const call of calls) {
    const toolResult = await executeToolCall(call, autoSkills);
    chatHistory.push({
      role: 'tool',
      content: toolResult,
      tool_call_id: call.id,
    });
  }
}

// ---------------------------------------------------------------------------
// 主循环
// ---------------------------------------------------------------------------

function isAbortError(e: unknown): boolean {
  return (e as any)?.name === 'AbortError' || String((e as any)?.message ?? '').toLowerCase().includes('abort');
}

export async function runChatLoop(params: ChatLoopParams, emit: ChatLoopEmit): Promise<ChatLoopOutcome> {
  const { model, thinkingLevel, signal } = params;

  // Skill：向系统提示注入 AI 可自主调用的目录（排除 disable-model-invocation），
  // 模型通过 use_skill 工具按需加载完整指引。
  // 发送前重扫一遍：用户可能在应用外手改了 SKILL.md（增删 disable-model-invocation 等），
  // 使改动无需重启即可在本条消息生效；扫描失败则不注入目录。
  let autoSkills: skills.SkillMeta[] = [];
  try {
    autoSkills = (await skills.listSkills()).filter(s => !s.disable_model_invocation);
  } catch (e) {
    console.warn('[chat] 扫描 Skill 列表失败，本轮不注入 Skill 目录:', e);
  }

  const chatHistory: ChatMessage[] = [...params.messages];
  if (autoSkills.length > 0) {
    chatHistory.splice(1, 0, { role: 'system', content: buildSkillCatalogPrompt(autoSkills) });
  }

  // read_url 不依赖搜索开关，始终可用（模型需要时自主抓取网页）；
  // web_search 由 Tavily 提供，模型需要实时信息时自主搜索
  const tools: ToolDefinition[] = [READ_URL_TOOL, WEB_SEARCH_TOOL];
  if (autoSkills.length > 0) tools.push(USE_SKILL_TOOL);

  // 跨轮次累计：正文可能跨「前言 → 工具 → 正式回答」多轮拼接
  let accumulated = '';
  let accumulatedReasoning = '';
  let lastUsage: TokenUsage | null = null;

  const completion = (maxTokens?: number | null) => chatCompletion({
    model,
    messages: chatHistory,
    tools,
    thinkingLevel,
    signal,
    maxTokens,
    onReasoningDelta: (delta, acc) => {
      accumulatedReasoning = acc;
      emit({ type: 'reasoning', delta, accumulated: acc });
    },
  });

  const baseOutcome = () => ({
    content: accumulated,
    reasoningContent: accumulatedReasoning,
    usage: lastUsage,
    citations: [] as UrlCitation[],
    finishReason: null as string | null,
  });

  try {
    let result = await completion();

    // 空正文自动补发一次：上游瞬时返回空 completion、或思考模型把 max_tokens 全部
    // 耗在推理阶段（finish_reason=length），都表现为"流正常结束但没有正文"——
    // 这与 API Key 失效不同（那种会在 HTTP 检查处抛"API 请求失败"）。length 截断的
    // 补发放开 max_tokens 上限；工具轮次的 assistant/tool 历史已在 chatHistory 中，
    // 补发等价于带着工具结果再要一次正式回答。
    let generationAttempt = 0;
    while (true) {
      generationAttempt++;

      while (true) {
        // 纯工具调用响应：正文尚未流出，直接进入工具循环
        if (result.type === 'tool_calls') {
          chatHistory.push({
            role: 'assistant',
            content: result.assistantMessage || '',
            tool_calls: result.toolCalls,
            reasoning_content: result.reasoningContent,
          });

          await runToolCalls(result.toolCalls, chatHistory, autoSkills, emit);
          emit({ type: 'round_reset' });

          result = await completion();
          continue;
        }

        // 流式文本回复（增量累加：混合响应跨多轮时正文需要拼接）
        for await (const chunk of result.stream) {
          accumulated += chunk.delta;
          if (chunk.delta) {
            emit({ type: 'text', delta: chunk.delta, accumulated });
          }
          if (chunk.usage) {
            lastUsage = chunk.usage;
          }
        }

        // 混合响应：正文流出后模型又触发了工具调用（GLM 等思考模型会先输出一段
        // 前言再调工具）。把已流出的正文连同工具调用写回历史并继续工具循环，
        // 否则工具调用会被静默丢弃、空回复被误报为"返回了空内容"
        if (result.lateToolCalls && result.lateToolCalls.length > 0) {
          chatHistory.push({
            role: 'assistant',
            content: accumulated,
            tool_calls: result.lateToolCalls,
            reasoning_content: result.reasoningContent,
          });

          await runToolCalls(result.lateToolCalls, chatHistory, autoSkills, emit);
          emit({ type: 'round_reset' });

          result = await completion();
          continue;
        }
        break;
      }

      if (accumulated.trim() || generationAttempt > 1) break;

      accumulated = '';
      result = await completion(result.type === 'text' && result.finishReason === 'length' ? null : undefined);
    }

    const finishReason = result.type === 'text' ? (result.finishReason ?? null) : null;
    const citations = result.type === 'text' ? (result.citations ?? []) : [];
    const usage = lastUsage ?? result.usage;

    if (!accumulated.trim()) {
      // 补发后仍为空：报真实原因而不是误导性的"检查 API Key"
      const reasoning = accumulatedReasoning || (result.type === 'text' ? result.reasoningContent : '');
      const completionTokens = usage?.completion_tokens ?? null;
      let hint: string;
      if (finishReason === 'length') {
        hint = '输出被长度截断（思考阶段耗尽了输出上限，不设上限补发后仍为空），多为模型自身的最大输出限制，请重试或换用输出上限更高的模型。';
      } else if (reasoning.trim()) {
        hint = `模型只输出了思考内容（${reasoning.length} 字符）而未生成正文，多为上游瞬时故障，请重试。`;
      } else if (completionTokens === 0) {
        hint = '上游返回了空回复（completion_tokens=0），多为瞬时故障，请重试。';
      } else {
        hint = `模型未返回任何正文（finish_reason=${finishReason ?? '未知'}，completion_tokens=${completionTokens ?? '未知'}）。`;
      }
      return {
        ...baseOutcome(),
        ok: false,
        reasoningContent: reasoning,
        usage,
        finishReason,
        errorCode: 'error',
        errorMessage: `模型 ${model.model_id} 返回了空内容：${hint}`,
      };
    }

    return {
      ok: true,
      content: appendCitationList(accumulated, citations),
      reasoningContent: accumulatedReasoning || (result.type === 'text' ? result.reasoningContent : ''),
      usage,
      citations,
      finishReason,
    };
  } catch (e: any) {
    if (isAbortError(e) || signal?.aborted) {
      return { ...baseOutcome(), ok: false, errorCode: 'aborted', errorMessage: 'aborted' };
    }
    if (e instanceof ReasoningEffortError) {
      return { ...baseOutcome(), ok: false, errorCode: 'reasoning_effort', errorMessage: e.message };
    }
    return { ...baseOutcome(), ok: false, errorCode: 'error', errorMessage: String(e?.message ?? e) };
  }
}
