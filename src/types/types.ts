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
}

/** 会话完整对象 — 进入会话详情时加载 */
export interface Conversation {
  id: UUID;
  title: string;
  /** AI 模型标识符，如 "gemini-3-flash-preview" */
  model_id: string;
  /** 系统提示词（可选） */
  system_prompt: string | null;
  created_at: EpochMillis;
  updated_at: EpochMillis;
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
  /** 思考模型返回的推理内容（不展示给用户，但需要回传给 API） */
  reasoning_content?: string | null;
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

/** AI 供应商枚举 */
export type AIProvider = "google_gemini" | "openrouter" | "openai_compatible";

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
  /** 最大输出 Token 数 */
  max_tokens: number;
  /** Top-P 采样参数 0.0 ~ 1.0 */
  top_p: number;
  /** 思考模式级别 (Gemini 3.x: LOW/MEDIUM/HIGH) */
  thinking_level: 'LOW' | 'MEDIUM' | 'HIGH' | null;
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
  max_tokens: number;
  top_p: number;
  is_default: boolean;
}

export interface UpdateModelConfigPayload {
  id: UUID;
  display_name?: string;
  api_key?: string;
  api_endpoint?: string | null;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  is_default?: boolean;
}

// — AI 流式响应事件（Tauri Event，非 invoke） —

/** 流式 Token 事件 — 通过 Tauri event 推送到前端 */
export interface StreamChunkEvent {
  /** 关联的消息 ID */
  message_id: UUID;
  /** 本次增量文本片段 */
  delta: string;
  /** 目前累计的完整文本（便于前端直接替换渲染） */
  accumulated: string;
}

/** 流式完成事件 */
export interface StreamDoneEvent {
  message_id: UUID;
  /** 最终完整文本 */
  full_content: string;
  /** 总 Token 用量 */
  token_count: number;
  finished_at: EpochMillis;
}

/** 流式错误事件 */
export interface StreamErrorEvent {
  message_id: UUID;
  /** 错误码 */
  error_code: string;
  /** 人类可读错误信息 */
  error_message: string;
  occurred_at: EpochMillis;
}

// — 通用 IPC 响应包装 —

/** 所有 invoke 命令的统一返回包装 */
export interface IpcResult<T> {
  success: boolean;
  data: T | null;
  error: IpcError | null;
}

export interface IpcError {
  /** 机器可读错误码 */
  code: string;
  /** 人类可读错误信息 */
  message: string;
}
