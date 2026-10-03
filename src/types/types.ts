// =============================================================================
// Quick-Chat — 前后端交互契约 · 类型系统
// =============================================================================
// 设计原则:
//   1. 时间戳一律使用 **毫秒级 Unix Epoch Number**（`Date.now()`），
//      禁止 ISO-8601 字符串，以防 Rust serde 反序列化失败。
//   2. 所有 ID 使用 UUIDv4 字符串，由前端生成后传入后端。
//   3. 枚举值与 Rust 端 #[serde(rename_all = "snake_case")] 对齐。
// =============================================================================

// ---------------------------------------------------------------------------
// 0. 基础标量类型别名
// ---------------------------------------------------------------------------

/** 毫秒级 Unix 时间戳（自 1970-01-01T00:00:00Z 起的毫秒数） */
export type EpochMillis = number;

/** UUIDv4 格式字符串 */
export type UUID = string;

// ---------------------------------------------------------------------------
// 1. 会话 (Conversation)
// ---------------------------------------------------------------------------

/** 会话摘要 — 侧边栏列表使用 */
export interface ConversationSummary {
  /** 会话唯一 ID (UUIDv4) */
  id: UUID;
  /** 用户为会话设置的标题，可为空则由后端自动生成 */
  title: string;
  /** 创建时间 (ms) */
  created_at: EpochMillis;
  /** 最后一条消息的时间 (ms)，用于排序 */
  last_message_at: EpochMillis;
  /** 最后一条消息的文本预览（截断至 120 字符） */
  last_message_preview: string;
  /** 会话内消息总数 */
  message_count: number;
  /** 是否固定置顶 */
  pinned?: number | null;
}

/** 会话完整对象 — 进入会话详情时加载 */
export interface Conversation {
  id: UUID;
  title: string;
  /** AI 模型标识符，如 "gemini-3-flash-preview" */
  model_id: string;
  /** 系统提示词（可选） */
  system_prompt: string | null;
  /** 思考强度（per-conversation 独立保存；取值为模型支持的档位，如 low/high/max，Gemini 为 LOW/MEDIUM/HIGH） */
  thinking_level: string | null;
  /** 上次查看的消息 ID（用于切换会话时恢复滚动位置） */
  last_viewed_message_id: UUID | null;
  created_at: EpochMillis;
  updated_at: EpochMillis;
  /** 是否固定置顶 */
  pinned?: number | null;
}

// ---------------------------------------------------------------------------
// 2. 消息 (Message)
// ---------------------------------------------------------------------------

/** 消息角色枚举 — 与 Rust 端 serde 对齐 */
export type MessageRole = "user" | "assistant" | "system";

/** 消息状态枚举 */
export type MessageStatus =
  | "pending"    // 已发送、等待 AI 响应
  | "streaming"  // AI 正在流式输出中
  | "completed"  // AI 响应完毕
  | "error";     // 出错

/** 前端临时活动状态，仅用于 UI，不写入数据库或模型历史 */
export interface MessageActivity {
  kind: "thinking" | "tool";
  label: string;
}

/** 文件附件 */
export interface FileAttachment {
  /** 附件唯一 ID (UUIDv4) */
  id: UUID;
  /** 原始文件名 */
  name: string;
  /** MIME type */
  type: string;
  /** 文件大小（字节） */
  size: number;
  /** base64 data URL（用于下载/展示） */
  data: string;
  /** 纯文本文件的内容（用于发送给 AI） */
  textContent?: string;
}

/** 单条消息 */
export interface Message {
  /** 消息唯一 ID (UUIDv4) */
  id: UUID;
  /** 所属会话 ID */
  conversation_id: UUID;
  /** 角色 */
  role: MessageRole;
  /** 纯文本内容（Markdown 格式） */
  content: string;
  /** 思考模型返回的推理内容（需要回传给 API，UI 以可折叠区块展示） */
  reasoning_content?: string | null;
  /** 思考阶段耗时（毫秒，仅 assistant 消息；首个推理分片到首个正文分片的间隔） */
  thinking_ms?: number | null;
  /** 消息状态 */
  status: MessageStatus;
  /** Token 用量（仅 assistant 消息有值，总 token 数） */
  token_count: number | null;
  /** 输入 Token 用量（prompt tokens） */
  input_tokens: number | null;
  /** 输出 Token 用量（completion tokens） */
  output_tokens: number | null;
  /** 模型标识（仅 assistant 消息有值），记录实际使用的模型 */
  model_id: string | null;
  /** 创建时间 (ms) */
  created_at: EpochMillis;
  /** 最后更新时间 (ms)，流式输出时持续更新 */
  updated_at: EpochMillis;
  /** 当前 assistant 消息的临时 UI 活动状态 */
  activity?: MessageActivity | null;
}

// ---------------------------------------------------------------------------
// 3. 系统提示词预设 (System Prompt Preset)
// ---------------------------------------------------------------------------

export interface SystemPrompt {
  id: UUID;
  title: string;
  content: string;
  created_at: EpochMillis;
  updated_at: EpochMillis;
}

// ---------------------------------------------------------------------------
// 4. AI 模型配置 (Model Config)
// ---------------------------------------------------------------------------

/** AI 供应商：已统一为 OpenAI 兼容端点（历史库中的旧值由 migrateModelProviders 迁移） */
export type AIProvider = "openai_compatible";

/** 模型配置 — 持久化到 SQLite */
export interface ModelConfig {
  /** 配置唯一 ID (UUIDv4) */
  id: UUID;
  /** 供应商 */
  provider: AIProvider;
  /** 模型标识符，如 "gemini-3-flash-preview" */
  model_id: string;
  /** 用户自定义的显示名称 */
  display_name: string;
  /** API Key（加密存储） */
  api_key: string;
  /** API 请求端点（可选，用于自定义代理） */
  api_endpoint: string | null;
  /** 温度参数 0.0 ~ 2.0 */
  temperature: number;
  /** 最大输出 Token 数；null = 不限制（请求不发 max_tokens 字段，由 provider 取模型默认最大输出） */
  max_tokens: number | null;
  /** Top-P 采样参数 0.0 ~ 1.0 */
  top_p: number;
  /** 上次使用的思考强度（供新对话继承；取值为模型支持的档位字符串） */
  thinking_level: string | null;
  /** 是否支持图片输入（vision） */
  supports_vision: boolean;
  /** 是否为当前激活的默认模型 */
  is_default: boolean;
  created_at: EpochMillis;
  updated_at: EpochMillis;
}

// ---------------------------------------------------------------------------
// 4. IPC 指令 Payload 类型
// ---------------------------------------------------------------------------

// — 会话相关 —

export interface CreateConversationPayload {
  title: string | null;
  model_id: string;
  system_prompt: string | null;
}

export interface UpdateConversationPayload {
  id: UUID;
  title?: string;
  model_id?: string;
  system_prompt?: string | null;
  thinking_level?: string | null;
  last_viewed_message_id?: UUID | null;
}

export interface GetConversationsPayload {
  /** 分页偏移量（从 0 开始） */
  offset: number;
  /** 每页数量，默认 50 */
  limit: number;
}

// — 消息相关 —

export interface SaveMessagePayload {
  id: UUID;
  conversation_id: UUID;
  role: MessageRole;
  content: string;
  reasoning_content?: string | null;
  thinking_ms?: number | null;
  status: MessageStatus;
  token_count: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  model_id: string | null;
  created_at: EpochMillis;
}

export interface UpdateMessagePayload {
  id: UUID;
  content?: string;
  reasoning_content?: string | null;
  thinking_ms?: number | null;
  status?: MessageStatus;
  token_count?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  updated_at: EpochMillis;
}

export interface GetMessagesPayload {
  conversation_id: UUID;
  /** 分页：返回 before_timestamp 之前的消息 */
  before_timestamp: EpochMillis | null;
  limit: number;
}

export interface SearchMessagesPayload {
  /** 全文检索关键词 */
  query: string;
  /** 可选：限定在某个会话内搜索 */
  conversation_id: UUID | null;
  offset: number;
  limit: number;
}

/** 搜索结果条目 */
export interface SearchResultItem {
  message: Message;
  /** 会话标题 */
  conversation_title: string;
  /** FTS 匹配片段（高亮标记） */
  snippet: string;
  /** FTS 排名分数 */
  rank: number;
}

// — 模型配置相关 —

export interface SaveModelConfigPayload {
  provider: AIProvider;
  model_id: string;
  display_name: string;
  api_key: string;
  api_endpoint: string | null;
  temperature: number;
  max_tokens: number | null;
  top_p: number;
  supports_vision: boolean;
  is_default: boolean;
}

export interface UpdateModelConfigPayload {
  id: UUID;
  display_name?: string;
  api_key?: string;
  api_endpoint?: string | null;
  temperature?: number;
  max_tokens?: number | null;
  top_p?: number;
  supports_vision?: boolean;
  is_default?: boolean;
}
