// =============================================================================
// Quick-Chat — 数据访问客户端（薄封装）
// =============================================================================
// 全部 SQL 与 schema 迁移在 Electron 主进程（electron/db-service.ts），
// 本模块只把调用转发到 db:* 语义桥命令，保持导出签名不变。
// 数据库文件由主进程管理：app.getPath('userData')/quick_chat.db；
// QUICK_CHAT_DEV_DB / VITE_FRESH_DB 环境变量时为 quick_chat_dev.db，
// 并在启动时清空（对应原 dev:fresh 模式）。
// =============================================================================

import { invoke } from '@/services/bridge';
import type {
  Conversation,
  ConversationSummary,
  Message,
  ModelConfig,
  SystemPrompt,
  ThinkingEfforts,
  UUID,
  EpochMillis,
} from '@/types/types';

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------

export async function initDatabase(): Promise<void> {
  await invoke('db:init');
}

export async function runDatabaseMaintenance(): Promise<void> {
  await invoke('db:maintenance');
}

// ---------------------------------------------------------------------------
// 系统提示词预设 (System Prompt Preset)
// ---------------------------------------------------------------------------

export const getSystemPrompts = () => invoke<SystemPrompt[]>('db:get_system_prompts');

export const saveSystemPrompt = (prompt: SystemPrompt) =>
  invoke<void>('db:save_system_prompt', { prompt });

export const deleteSystemPrompt = (id: UUID) =>
  invoke<void>('db:delete_system_prompt', { id });

// ---------------------------------------------------------------------------
// 模型配置 (Model Config)
// ---------------------------------------------------------------------------

export const getModelConfigs = () => invoke<ModelConfig[]>('db:get_model_configs');

export const saveModelConfig = (config: ModelConfig) =>
  invoke<void>('db:save_model_config', { config });

export const updateModelConfig = (id: UUID, updates: Partial<Omit<ModelConfig, 'id' | 'created_at'>>) =>
  invoke<void>('db:update_model_config', { id, updates });

export const deleteModelConfig = (id: UUID) =>
  invoke<void>('db:delete_model_config', { id });

// ---------------------------------------------------------------------------
// 应用设置 (App Settings)
// ---------------------------------------------------------------------------

export const getAppSetting = (key: string) =>
  invoke<string | null>('db:get_app_setting', { key });

export const setAppSetting = (key: string, value: string) =>
  invoke<void>('db:set_app_setting', { key, value });

// ---------------------------------------------------------------------------
// 思考强度缓存（OpenRouter 模型档位元数据）
// ---------------------------------------------------------------------------

export const getThinkingEffortsCache = () =>
  invoke<Record<string, ThinkingEfforts>>('db:get_thinking_efforts_cache');

export const saveThinkingEffortsCache = (modelKey: string, efforts: ThinkingEfforts) =>
  invoke<void>('db:save_thinking_efforts_cache', { modelKey, efforts });

// ---------------------------------------------------------------------------
// 会话 (Conversation)
// ---------------------------------------------------------------------------

export const createConversation = (conv: Conversation) =>
  invoke<void>('db:create_conversation', { conv });

export const getConversation = (id: UUID) =>
  invoke<Conversation | null>('db:get_conversation', { id });

export const updateConversation = (
  id: UUID,
  updates: Partial<Pick<Conversation, 'title' | 'model_id' | 'system_prompt' | 'pinned' | 'thinking_level' | 'last_viewed_message_id' | 'updated_at'>>
) => invoke<void>('db:update_conversation', { id, updates });

export const deleteConversation = (id: UUID) =>
  invoke<void>('db:delete_conversation', { id });

export const getConversations = (limit = 100, offset = 0) =>
  invoke<ConversationSummary[]>('db:get_conversations', { limit, offset });

export const searchConversations = (query: string, limit = 100, offset = 0) =>
  invoke<ConversationSummary[]>('db:search_conversations', { query, limit, offset });

// ---------------------------------------------------------------------------
// 消息 (Message)
// ---------------------------------------------------------------------------

export const saveMessage = (msg: Message) =>
  invoke<void>('db:save_message', { msg });

export const updateMessage = (
  id: UUID,
  updates: Partial<Pick<Message, 'content' | 'reasoning_content' | 'thinking_ms' | 'status' | 'token_count' | 'input_tokens' | 'output_tokens' | 'updated_at'>>
) => invoke<void>('db:update_message', { id, updates });

export const getMessages = (
  conversationId: UUID,
  limit = 200,
  beforeTimestamp: EpochMillis | null = null
) => invoke<Message[]>('db:get_messages', { conversationId, limit, beforeTimestamp });

export const deleteMessage = (id: UUID) =>
  invoke<void>('db:delete_message', { id });

export const searchMessages = (
  query: string,
  conversationId: UUID | null = null,
  limit = 50,
  offset = 0
) => invoke<Array<{ message: Message; conversation_title: string; snippet: string; rank: number }>>(
  'db:search_messages',
  { query, conversationId, limit, offset }
);

// ---------------------------------------------------------------------------
// Mermaid SVG 缓存：(主题, 源码) → SVG。渲染确定性输出，重开会话零渲染成本
// ---------------------------------------------------------------------------

export const getMermaidSvgCache = (cacheKey: string) =>
  invoke<string | null>('db:get_mermaid_svg', { cacheKey });

export const setMermaidSvgCache = (cacheKey: string, svg: string) =>
  invoke<void>('db:set_mermaid_svg', { cacheKey, svg });

// ---------------------------------------------------------------------------
// 数据迁移：localStorage → SQLite
// （localStorage 只在渲染进程可读，迁移编排留在前端，写入走语义命令）
// ---------------------------------------------------------------------------

export async function migrateFromLocalStorage(): Promise<boolean> {
  const hasMigrated = localStorage.getItem('quick_chat_db_migrated');
  if (hasMigrated) return false;

  const convs = JSON.parse(localStorage.getItem('quick_chat_conversations') || '[]');
  const msgs = JSON.parse(localStorage.getItem('quick_chat_messages') || '[]');
  const models = JSON.parse(localStorage.getItem('quick_chat_models') || '[]');

  if (models.length === 0 && convs.length === 0 && msgs.length === 0) {
    localStorage.setItem('quick_chat_db_migrated', 'true');
    return false;
  }

  // 迁移模型配置（provider 已统一为 openai_compatible；按旧 provider 回填默认端点）
  for (const m of models) {
    try {
      const legacyEndpoint =
        m.provider === 'google_gemini'
          ? 'https://generativelanguage.googleapis.com/v1beta/openai/'
          : m.provider === 'openrouter'
            ? 'https://openrouter.ai/api/v1/'
            : null;
      await saveModelConfig({
        id: m.id,
        provider: 'openai_compatible',
        model_id: m.model_id,
        display_name: m.display_name,
        api_key: m.api_key,
        api_endpoint: m.api_endpoint ?? legacyEndpoint,
        temperature: m.temperature ?? 0.6,
        max_tokens: m.max_tokens ?? null,
        top_p: m.top_p ?? 1.0,
        thinking_level: m.thinking_level ?? null,
        supports_vision: Boolean(m.supports_vision),
        is_default: Boolean(m.is_default),
        created_at: m.created_at ?? Date.now(),
        updated_at: m.updated_at ?? Date.now(),
      });
    } catch (e) {
      console.warn('模型配置迁移失败:', m.id, e);
    }
  }

  // 迁移会话
  const convDetails = JSON.parse(localStorage.getItem('quick_chat_conv_details') || '{}');
  for (const c of convs) {
    try {
      const details = convDetails[c.id] || {};
      const now = c.created_at || Date.now();
      const existing = await getConversation(c.id);
      if (existing) continue;
      await createConversation({
        id: c.id,
        title: c.title || 'New Chat',
        model_id: details.model_id || '',
        system_prompt: details.system_prompt ?? null,
        thinking_level: null,
        last_viewed_message_id: null,
        created_at: now,
        updated_at: c.last_message_at ?? now,
      });
    } catch (e) {
      console.warn('会话迁移失败:', c.id, e);
    }
  }

  // 迁移消息
  for (const m of msgs) {
    try {
      await saveMessage({
        id: m.id,
        conversation_id: m.conversation_id,
        role: m.role,
        content: m.content,
        reasoning_content: m.reasoning_content ?? null,
        thinking_ms: m.thinking_ms ?? null,
        status: m.status || 'completed',
        token_count: m.token_count ?? null,
        input_tokens: m.input_tokens ?? null,
        output_tokens: m.output_tokens ?? null,
        model_id: m.model_id ?? null,
        created_at: m.created_at,
        updated_at: m.updated_at ?? m.created_at,
      });
    } catch (e) {
      console.warn('消息迁移失败:', m.id, e);
    }
  }

  localStorage.setItem('quick_chat_db_migrated', 'true');
  return true;
}
