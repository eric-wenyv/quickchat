// =============================================================================
// Quick-Chat — IPC 指令字典
// =============================================================================
// 本文件定义前端通过 `invoke()` 调用的所有 Tauri Rust 命令。
// 这是一份纯声明性契约，不包含任何实现代码。
//
// 前端调用示例：
//   import { invoke } from "@tauri-apps/api/core";
//   const result = await invoke<IpcResult<Conversation>>("create_conversation", { payload });
//
// Rust 端签名对应示例：
//   #[tauri::command]
//   async fn create_conversation(payload: CreateConversationPayload) -> Result<Conversation, IpcError>
//
// 事件监听示例（流式输出）：
//   import { listen } from "@tauri-apps/api/event";
//   const unlisten = await listen<StreamChunkEvent>("stream:chunk", (event) => { ... });
// =============================================================================

import type {
  // 实体类型
  Conversation,
  ConversationSummary,
  Message,
  ModelConfig,
  SearchResultItem,
  // Payload 类型
  CreateConversationPayload,
  UpdateConversationPayload,
  GetConversationsPayload,
  SaveMessagePayload,
  UpdateMessagePayload,
  GetMessagesPayload,
  SearchMessagesPayload,
  SaveModelConfigPayload,
  UpdateModelConfigPayload,
  // 响应包装
  IpcResult,
  // 标量
  UUID,
  EpochMillis,
} from "./types";

// =============================================================================
// 一、会话管理 (Conversation)
// =============================================================================

/**
 * 指令名: "create_conversation"
 * 描述:   创建一个新的对话会话
 *
 * @param payload CreateConversationPayload
 * @returns IpcResult<Conversation>
 *
 * Rust 签名:
 *   #[tauri::command]
 *   async fn create_conversation(
 *       db: State<'_, DbPool>,
 *       payload: CreateConversationPayload,
 *   ) -> Result<Conversation, IpcError>
 */
export type CreateConversationCmd = {
  command: "create_conversation";
  args: { payload: CreateConversationPayload };
  returns: IpcResult<Conversation>;
};

/**
 * 指令名: "get_conversations"
 * 描述:   分页获取会话列表，按 last_message_at 降序排列
 *
 * @param payload GetConversationsPayload
 * @returns IpcResult<ConversationSummary[]>
 *
 * Rust 签名:
 *   #[tauri::command]
 *   async fn get_conversations(
 *       db: State<'_, DbPool>,
 *       payload: GetConversationsPayload,
 *   ) -> Result<Vec<ConversationSummary>, IpcError>
 */
export type GetConversationsCmd = {
  command: "get_conversations";
  args: { payload: GetConversationsPayload };
  returns: IpcResult<ConversationSummary[]>;
};

/**
 * 指令名: "get_conversation"
 * 描述:   获取单个会话完整信息
 *
 * @param id UUID — 会话 ID
 * @returns IpcResult<Conversation>
 *
 * Rust 签名:
 *   #[tauri::command]
 *   async fn get_conversation(
 *       db: State<'_, DbPool>,
 *       id: String,
 *   ) -> Result<Conversation, IpcError>
 */
export type GetConversationCmd = {
  command: "get_conversation";
  args: { id: UUID };
  returns: IpcResult<Conversation>;
};

/**
 * 指令名: "update_conversation"
 * 描述:   更新会话标题、模型或系统提示词
 *
 * @param payload UpdateConversationPayload
 * @returns IpcResult<Conversation>
 *
 * Rust 签名:
 *   #[tauri::command]
 *   async fn update_conversation(
 *       db: State<'_, DbPool>,
 *       payload: UpdateConversationPayload,
 *   ) -> Result<Conversation, IpcError>
 */
export type UpdateConversationCmd = {
  command: "update_conversation";
  args: { payload: UpdateConversationPayload };
  returns: IpcResult<Conversation>;
};

/**
 * 指令名: "delete_conversation"
 * 描述:   删除会话及其所有消息（级联删除）
 *
 * @param id UUID — 会话 ID
 * @returns IpcResult<null>
 *
 * Rust 签名:
 *   #[tauri::command]
 *   async fn delete_conversation(
 *       db: State<'_, DbPool>,
 *       id: String,
 *   ) -> Result<(), IpcError>
 */
export type DeleteConversationCmd = {
  command: "delete_conversation";
  args: { id: UUID };
  returns: IpcResult<null>;
};

// =============================================================================
// 二、消息管理 (Message)
// =============================================================================

/**
 * 指令名: "save_message"
 * 描述:   持久化一条消息（用户消息或 AI 最终响应）
 *         前端在用户发送消息时调用，以及在流式完成后调用。
 *
 * @param payload SaveMessagePayload
 * @returns IpcResult<Message>
 *
 * Rust 签名:
 *   #[tauri::command]
 *   async fn save_message(
 *       db: State<'_, DbPool>,
 *       payload: SaveMessagePayload,
 *   ) -> Result<Message, IpcError>
 */
export type SaveMessageCmd = {
  command: "save_message";
  args: { payload: SaveMessagePayload };
  returns: IpcResult<Message>;
};

/**
 * 指令名: "update_message"
 * 描述:   更新消息内容或状态（如流式完成后更新最终内容和 token_count）
 *
 * @param payload UpdateMessagePayload
 * @returns IpcResult<Message>
 *
 * Rust 签名:
 *   #[tauri::command]
 *   async fn update_message(
 *       db: State<'_, DbPool>,
 *       payload: UpdateMessagePayload,
 *   ) -> Result<Message, IpcError>
 */
export type UpdateMessageCmd = {
  command: "update_message";
  args: { payload: UpdateMessagePayload };
  returns: IpcResult<Message>;
};

/**
 * 指令名: "get_messages"
 * 描述:   分页加载某会话的消息历史，按 created_at 升序，支持游标分页
 *
 * @param payload GetMessagesPayload
 * @returns IpcResult<Message[]>
 *
 * Rust 签名:
 *   #[tauri::command]
 *   async fn get_messages(
 *       db: State<'_, DbPool>,
 *       payload: GetMessagesPayload,
 *   ) -> Result<Vec<Message>, IpcError>
 */
export type GetMessagesCmd = {
  command: "get_messages";
  args: { payload: GetMessagesPayload };
  returns: IpcResult<Message[]>;
};

/**
 * 指令名: "delete_message"
 * 描述:   删除单条消息
 *
 * @param id UUID — 消息 ID
 * @returns IpcResult<null>
 *
 * Rust 签名:
 *   #[tauri::command]
 *   async fn delete_message(
 *       db: State<'_, DbPool>,
 *       id: String,
 *   ) -> Result<(), IpcError>
 */
export type DeleteMessageCmd = {
  command: "delete_message";
  args: { id: UUID };
  returns: IpcResult<null>;
};

/**
 * 指令名: "search_messages"
 * 描述:   全文检索消息内容，利用 SQLite FTS5 索引
 *
 * @param payload SearchMessagesPayload
 * @returns IpcResult<SearchResultItem[]>
 *
 * Rust 签名:
 *   #[tauri::command]
 *   async fn search_messages(
 *       db: State<'_, DbPool>,
 *       payload: SearchMessagesPayload,
 *   ) -> Result<Vec<SearchResultItem>, IpcError>
 */
export type SearchMessagesCmd = {
  command: "search_messages";
  args: { payload: SearchMessagesPayload };
  returns: IpcResult<SearchResultItem[]>;
};

// =============================================================================
// 三、AI 对话 (Chat Completion)
// =============================================================================

/**
 * 指令名: "send_chat_message"
 * 描述:   向 AI 发送消息并启动流式响应。
 *         Rust 后端将通过 Tauri Event 推送流式数据，前端通过 listen() 接收。
 *         此命令本身立即返回，仅确认请求已被接受。
 *
 * @param conversation_id UUID — 会话 ID
 * @param message_id      UUID — 前端为 AI 响应消息预分配的 ID
 * @returns IpcResult<null>   — 仅表示请求已接受，实际内容通过事件推送
 *
 * Rust 签名:
 *   #[tauri::command]
 *   async fn send_chat_message(
 *       app_handle: AppHandle,
 *       db: State<'_, DbPool>,
 *       conversation_id: String,
 *       message_id: String,
 *   ) -> Result<(), IpcError>
 *
 * 关联事件:
 *   - "stream:chunk" → StreamChunkEvent   — 增量 Token
 *   - "stream:done"  → StreamDoneEvent    — 流式完成
 *   - "stream:error" → StreamErrorEvent   — 流式错误
 */
export type SendChatMessageCmd = {
  command: "send_chat_message";
  args: {
    conversation_id: UUID;
    message_id: UUID;
  };
  returns: IpcResult<null>;
};

/**
 * 指令名: "stop_chat_stream"
 * 描述:   中止当前正在进行的流式 AI 响应
 *
 * @param message_id UUID — 需要中止的消息 ID
 * @returns IpcResult<null>
 *
 * Rust 签名:
 *   #[tauri::command]
 *   async fn stop_chat_stream(
 *       app_handle: AppHandle,
 *       message_id: String,
 *   ) -> Result<(), IpcError>
 */
export type StopChatStreamCmd = {
  command: "stop_chat_stream";
  args: { message_id: UUID };
  returns: IpcResult<null>;
};

// =============================================================================
// 四、模型配置管理 (Model Config)
// =============================================================================

/**
 * 指令名: "get_model_configs"
 * 描述:   获取所有已保存的模型配置
 *
 * @returns IpcResult<ModelConfig[]>
 *
 * Rust 签名:
 *   #[tauri::command]
 *   async fn get_model_configs(
 *       db: State<'_, DbPool>,
 *   ) -> Result<Vec<ModelConfig>, IpcError>
 */
export type GetModelConfigsCmd = {
  command: "get_model_configs";
  args: Record<string, never>;
  returns: IpcResult<ModelConfig[]>;
};

/**
 * 指令名: "save_model_config"
 * 描述:   新增一个模型配置
 *
 * @param payload SaveModelConfigPayload
 * @returns IpcResult<ModelConfig>
 *
 * Rust 签名:
 *   #[tauri::command]
 *   async fn save_model_config(
 *       db: State<'_, DbPool>,
 *       payload: SaveModelConfigPayload,
 *   ) -> Result<ModelConfig, IpcError>
 */
export type SaveModelConfigCmd = {
  command: "save_model_config";
  args: { payload: SaveModelConfigPayload };
  returns: IpcResult<ModelConfig>;
};

/**
 * 指令名: "update_model_config"
 * 描述:   更新已有模型配置
 *
 * @param payload UpdateModelConfigPayload
 * @returns IpcResult<ModelConfig>
 *
 * Rust 签名:
 *   #[tauri::command]
 *   async fn update_model_config(
 *       db: State<'_, DbPool>,
 *       payload: UpdateModelConfigPayload,
 *   ) -> Result<ModelConfig, IpcError>
 */
export type UpdateModelConfigCmd = {
  command: "update_model_config";
  args: { payload: UpdateModelConfigPayload };
  returns: IpcResult<ModelConfig>;
};

/**
 * 指令名: "delete_model_config"
 * 描述:   删除一个模型配置
 *
 * @param id UUID — 配置 ID
 * @returns IpcResult<null>
 *
 * Rust 签名:
 *   #[tauri::command]
 *   async fn delete_model_config(
 *       db: State<'_, DbPool>,
 *       id: String,
 *   ) -> Result<(), IpcError>
 */
export type DeleteModelConfigCmd = {
  command: "delete_model_config";
  args: { id: UUID };
  returns: IpcResult<null>;
};

// =============================================================================
// 五、Tauri Event 名称常量
// =============================================================================

/** 所有 Tauri Event 名称的集中定义 */
export const TAURI_EVENTS = {
  /** AI 流式输出 — 增量 Token 推送 */
  STREAM_CHUNK: "stream:chunk",
  /** AI 流式输出 — 完成 */
  STREAM_DONE: "stream:done",
  /** AI 流式输出 — 错误 */
  STREAM_ERROR: "stream:error",
} as const;

// =============================================================================
// 六、指令名称常量（防止硬编码字符串）
// =============================================================================

/** 所有 invoke 指令名的集中定义 */
export const IPC_COMMANDS = {
  // 会话
  CREATE_CONVERSATION: "create_conversation",
  GET_CONVERSATIONS: "get_conversations",
  GET_CONVERSATION: "get_conversation",
  UPDATE_CONVERSATION: "update_conversation",
  DELETE_CONVERSATION: "delete_conversation",
  // 消息
  SAVE_MESSAGE: "save_message",
  UPDATE_MESSAGE: "update_message",
  GET_MESSAGES: "get_messages",
  DELETE_MESSAGE: "delete_message",
  SEARCH_MESSAGES: "search_messages",
  // AI 对话
  SEND_CHAT_MESSAGE: "send_chat_message",
  STOP_CHAT_STREAM: "stop_chat_stream",
  // 模型配置
  GET_MODEL_CONFIGS: "get_model_configs",
  SAVE_MODEL_CONFIG: "save_model_config",
  UPDATE_MODEL_CONFIG: "update_model_config",
  DELETE_MODEL_CONFIG: "delete_model_config",
} as const;

// =============================================================================
// 七、类型安全的 invoke 包装器签名映射
// =============================================================================

/**
 * 全部 IPC 命令的联合类型，用于构建类型安全的 invoke 包装器。
 *
 * 使用示例（在 ipc-client.ts 中实现）：
 *
 * ```ts
 * type CommandMap = {
 *   [K in IpcCommandUnion["command"]]: Extract<IpcCommandUnion, { command: K }>;
 * };
 *
 * async function typedInvoke<C extends keyof CommandMap>(
 *   command: C,
 *   args: CommandMap[C]["args"]
 * ): Promise<CommandMap[C]["returns"]> {
 *   return invoke(command, args);
 * }
 * ```
 */
export type IpcCommandUnion =
  | CreateConversationCmd
  | GetConversationsCmd
  | GetConversationCmd
  | UpdateConversationCmd
  | DeleteConversationCmd
  | SaveMessageCmd
  | UpdateMessageCmd
  | GetMessagesCmd
  | DeleteMessageCmd
  | SearchMessagesCmd
  | SendChatMessageCmd
  | StopChatStreamCmd
  | GetModelConfigsCmd
  | SaveModelConfigCmd
  | UpdateModelConfigCmd
  | DeleteModelConfigCmd;
