// =============================================================================
// Quick-Chat — SQLite 数据访问层（Electron 主进程）
// =============================================================================
// 全部建表/迁移/FTS/CRUD SQL 集中在主进程，渲染进程只经 db:* 语义命令访问
// （见 ipc.ts）。数据库文件：app.getPath('userData')/quick_chat.db；
// QUICK_CHAT_DEV_DB / VITE_FRESH_DB 环境变量时为 quick_chat_dev.db，
// 并在启动时清空（对应原 dev:fresh 模式）。
// =============================================================================

import { getDb } from "./db.js";

// ---------------------------------------------------------------------------
// 类型（与 src/types/types.ts 结构对齐；IPC 传 JSON，主进程侧独立声明）
// ---------------------------------------------------------------------------

type UUID = string;
type EpochMillis = number;

export interface ConversationSummary {
  id: UUID;
  title: string;
  created_at: EpochMillis;
  last_message_at: EpochMillis;
  last_message_preview: string;
  message_count: number;
  pinned?: number | null;
}

export interface Conversation {
  id: UUID;
  title: string;
  model_id: string;
  system_prompt: string | null;
  thinking_level: string | null;
  last_viewed_message_id: UUID | null;
  created_at: EpochMillis;
  updated_at: EpochMillis;
  pinned?: number | null;
}

export interface Message {
  id: UUID;
  conversation_id: UUID;
  role: "user" | "assistant" | "system";
  content: string;
  reasoning_content?: string | null;
  thinking_ms?: number | null;
  status: "pending" | "streaming" | "completed" | "error";
  token_count: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  model_id: string | null;
  created_at: EpochMillis;
  updated_at: EpochMillis;
}

export interface SystemPrompt {
  id: UUID;
  title: string;
  content: string;
  created_at: EpochMillis;
  updated_at: EpochMillis;
}

export interface ModelConfig {
  id: UUID;
  provider: string;
  model_id: string;
  display_name: string;
  api_key: string;
  api_endpoint: string | null;
  temperature: number;
  max_tokens: number | null;
  top_p: number;
  thinking_level: string | null;
  supports_vision: boolean;
  is_default: boolean;
  created_at: EpochMillis;
  updated_at: EpochMillis;
}

export interface ThinkingEfforts {
  efforts: string[];
  defaultEffort: string | null;
}

// ---------------------------------------------------------------------------
// 内部执行器（同步 better-sqlite3）
// ---------------------------------------------------------------------------

type SqlParam = string | number | null;

let hasTrigramMessageSearchIndex: boolean | null = null;

function execute(sql: string, params: SqlParam[] = []): { rowsAffected: number } {
  const database = getDb();
  try {
    const result = database.prepare(sql).run(...params);
    return { rowsAffected: result.changes };
  } catch (error) {
    if (params.length === 0 && error instanceof Error && /one statement/i.test(error.message)) {
      database.exec(sql);
      return { rowsAffected: 0 };
    }
    throw error;
  }
}

function select<T>(sql: string, params: SqlParam[] = []): T {
  return getDb().prepare(sql).all(...params) as T;
}

export function buildFtsPhraseQuery(query: string): string {
  const trimmed = query.trim().replace(/\s+/g, ' ');
  return `"${trimmed.replace(/"/g, '""')}"`;
}

export function buildFtsTokenQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `"${word.replace(/"/g, '""')}"`)
    .join(' ');
}

function escapeLikeQuery(query: string): string {
  return query.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function buildLikeQuery(query: string): string {
  return `%${escapeLikeQuery(query.trim().toLowerCase())}%`;
}

const SQLITE_CORRUPTION_ERROR_PATTERNS = [
  'database disk image is malformed',
  'sqlite_corrupt',
  'code: 11',
  'code: 267',
];

function stringifyDbError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    return `${error.name} ${error.message} ${error.stack ?? ''}`;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function isSqliteCorruptionError(error: unknown): boolean {
  const text = stringifyDbError(error).toLowerCase();
  return SQLITE_CORRUPTION_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
}

function createMessageFtsIndex(): void {
  execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      content='messages',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );
  `);
  execute(`
    CREATE TRIGGER IF NOT EXISTS trg_messages_fts_insert
      AFTER INSERT ON messages
    BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
    END;
  `);
  execute(`
    CREATE TRIGGER IF NOT EXISTS trg_messages_fts_update
      AFTER UPDATE OF content ON messages
    BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
      INSERT INTO messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
    END;
  `);
  execute(`
    CREATE TRIGGER IF NOT EXISTS trg_messages_fts_delete
      AFTER DELETE ON messages
    BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
    END;
  `);
}

function createTrigramMessageSearchIndex(): void {
  execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_search_fts USING fts5(
      content,
      content='messages',
      content_rowid='rowid',
      tokenize='trigram'
    );
  `);
  execute(`
    CREATE TRIGGER IF NOT EXISTS trg_messages_search_fts_insert
      AFTER INSERT ON messages
    BEGIN
      INSERT INTO messages_search_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
    END;
  `);
  execute(`
    CREATE TRIGGER IF NOT EXISTS trg_messages_search_fts_update
      AFTER UPDATE OF content ON messages
    BEGIN
      INSERT INTO messages_search_fts(messages_search_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
      INSERT INTO messages_search_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
    END;
  `);
  execute(`
    CREATE TRIGGER IF NOT EXISTS trg_messages_search_fts_delete
      AFTER DELETE ON messages
    BEGIN
      INSERT INTO messages_search_fts(messages_search_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
    END;
  `);
}

function dropMessageSearchIndexObjects(): void {
  const statements = [
    'DROP TRIGGER IF EXISTS trg_messages_fts_insert;',
    'DROP TRIGGER IF EXISTS trg_messages_fts_update;',
    'DROP TRIGGER IF EXISTS trg_messages_fts_delete;',
    'DROP TRIGGER IF EXISTS trg_messages_search_fts_insert;',
    'DROP TRIGGER IF EXISTS trg_messages_search_fts_update;',
    'DROP TRIGGER IF EXISTS trg_messages_search_fts_delete;',
    'DROP TABLE IF EXISTS messages_fts;',
    'DROP TABLE IF EXISTS messages_search_fts;',
  ];

  for (const statement of statements) {
    execute(statement);
  }
}

function rebuildMessageSearchIndexes(): void {
  dropMessageSearchIndexObjects();

  createMessageFtsIndex();
  execute(`INSERT INTO messages_fts(messages_fts) VALUES ('rebuild');`);

  try {
    createTrigramMessageSearchIndex();
    execute(`INSERT INTO messages_search_fts(messages_search_fts) VALUES ('rebuild');`);
    hasTrigramMessageSearchIndex = true;
  } catch (e) {
    hasTrigramMessageSearchIndex = false;
    console.warn('[DB] Failed to rebuild trigram message search index; unicode FTS remains available:', e);
  }
}

function executeWithMessageSearchIndexRepair<T>(
  operation: () => T,
  operationName: string
): T {
  try {
    return operation();
  } catch (e) {
    if (!isSqliteCorruptionError(e)) throw e;

    console.warn(`[DB] ${operationName} failed with SQLite corruption; rebuilding message search indexes and retrying:`, e);
    rebuildMessageSearchIndexes();
    return operation();
  }
}

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------

export function initDatabase(): void {
  // WAL 模式与外键
  execute('PRAGMA journal_mode = WAL;');
  execute('PRAGMA foreign_keys = ON;');

  // 会话表
  execute(`
    CREATE TABLE IF NOT EXISTS conversations (
      id          TEXT    PRIMARY KEY NOT NULL,
      title       TEXT    NOT NULL DEFAULT '',
      model_id    TEXT    NOT NULL,
      system_prompt TEXT  DEFAULT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
  `);
  execute(`
    CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
      ON conversations(updated_at DESC);
  `);

  // 消息表
  execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT    PRIMARY KEY NOT NULL,
      conversation_id TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role            TEXT    NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content         TEXT    NOT NULL DEFAULT '',
      reasoning_content TEXT  DEFAULT NULL,
      thinking_ms     INTEGER DEFAULT NULL,
      status          TEXT    NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'streaming', 'completed', 'error')),
      token_count     INTEGER DEFAULT NULL,
      input_tokens    INTEGER DEFAULT NULL,
      output_tokens   INTEGER DEFAULT NULL,
      model_id        TEXT    DEFAULT NULL,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );
  `);
  ensureMessageColumns();
  ensureConversationColumns();
  execute(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_time
      ON messages(conversation_id, created_at ASC);
  `);
  execute(`
    CREATE INDEX IF NOT EXISTS idx_messages_status
      ON messages(status) WHERE status IN ('pending', 'streaming');
  `);

  // FTS5 全文检索。只创建结构，耗时的同步/重建放到首屏之后后台执行。
  createMessageFtsIndex();
  try {
    createTrigramMessageSearchIndex();
    hasTrigramMessageSearchIndex = true;
  } catch (e) {
    hasTrigramMessageSearchIndex = false;
    console.warn('[DB] Trigram message search index is unavailable; falling back to unicode FTS:', e);
  }

  // 系统提示词预设表
  execute(`
    CREATE TABLE IF NOT EXISTS system_prompts (
      id          TEXT    PRIMARY KEY NOT NULL,
      title       TEXT    NOT NULL,
      content     TEXT    NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
  `);
  execute(`
    CREATE INDEX IF NOT EXISTS idx_system_prompts_updated_at
      ON system_prompts(updated_at DESC);
  `);

  // Mermaid 渲染结果缓存：mermaid.render 是全量布局计算，
  // 但同一份图源码的输出是确定的——按 (主题, 源码) 缓存 SVG，重开会话零渲染成本
  execute(`
    CREATE TABLE IF NOT EXISTS mermaid_svgs (
      cache_key   TEXT    PRIMARY KEY NOT NULL,
      svg         TEXT    NOT NULL,
      created_at  INTEGER NOT NULL,
      last_hit_at INTEGER NOT NULL
    );
  `);

  // 应用设置（键值对）：Tavily API Key 等全局配置存这里，
  // 由设置页读写，主进程按需读取
  execute(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT    PRIMARY KEY NOT NULL,
      value      TEXT    NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // 模型配置表
  execute(`
    CREATE TABLE IF NOT EXISTS model_configs (
      id            TEXT    PRIMARY KEY NOT NULL,
      provider      TEXT    NOT NULL CHECK (provider IN ('google_gemini', 'openrouter', 'openai_compatible')),
      model_id      TEXT    NOT NULL,
      display_name  TEXT    NOT NULL,
      api_key       TEXT    NOT NULL,
      api_endpoint  TEXT    DEFAULT NULL,
      temperature   REAL    NOT NULL DEFAULT 0.6 CHECK (temperature >= 0.0 AND temperature <= 2.0),
      max_tokens    INTEGER DEFAULT NULL CHECK (max_tokens IS NULL OR max_tokens > 0),
      top_p         REAL    NOT NULL DEFAULT 1.0 CHECK (top_p >= 0.0 AND top_p <= 1.0),
      thinking_level TEXT    DEFAULT NULL,
      supports_vision INTEGER NOT NULL DEFAULT 0 CHECK (supports_vision IN (0, 1)),
      is_default    INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
  `);
  execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_model_configs_provider_model
      ON model_configs(provider, model_id);
  `);
  ensureModelColumns();
  relaxModelMaxTokensConstraint();
  migrateModelProviders();

  // 思考强度缓存表：档位元数据来自 OpenRouter 官方模型接口，变更极少，
  // 拉取成功后直接持久化；模型档位变化时由 API 报错触发重拉覆盖
  execute(`
    CREATE TABLE IF NOT EXISTS thinking_efforts_cache (
      model_key      TEXT PRIMARY KEY NOT NULL,
      efforts        TEXT NOT NULL,
      default_effort TEXT DEFAULT NULL,
      updated_at     INTEGER NOT NULL
    );
  `);
}

export function runDatabaseMaintenance(): void {
  ensureFtsIndexSynced('messages_fts');
  ensureTrigramMessageSearchIndex();
}

function ensureFtsIndexSynced(tableName: 'messages_fts' | 'messages_search_fts'): void {
  try {
    const rows = select<{ message_count: number; index_count: number }[]>(`
      SELECT
        (SELECT COUNT(*) FROM messages) AS message_count,
        (SELECT COUNT(*) FROM ${tableName}) AS index_count
    `);
    const counts = rows[0];
    if (counts && counts.message_count !== counts.index_count) {
      execute(`INSERT INTO ${tableName}(${tableName}) VALUES ('rebuild');`);
      console.log(`[DB] Rebuilt ${tableName} (${counts.index_count} -> ${counts.message_count})`);
    }
  } catch (e) {
    if (isSqliteCorruptionError(e)) {
      console.warn(`[DB] ${tableName} appears corrupt; rebuilding message search indexes:`, e);
      try {
        rebuildMessageSearchIndexes();
      } catch (repairError) {
        console.warn(`[DB] Failed to rebuild message search indexes after ${tableName} corruption:`, repairError);
      }
      return;
    }

    console.warn(`[DB] Failed to sync ${tableName}:`, e);
  }
}

function ensureTrigramMessageSearchIndex(): void {
  try {
    createTrigramMessageSearchIndex();
    ensureFtsIndexSynced('messages_search_fts');
    hasTrigramMessageSearchIndex = true;
  } catch (e) {
    hasTrigramMessageSearchIndex = false;
    console.warn('[DB] Trigram message search index is unavailable; falling back to unicode FTS:', e);
  }
}

function ensureMessageColumns(): void {
  try {
    const columns = select<{ name: string }[]>('PRAGMA table_info(messages);');
    const colNames = new Set(columns.map((c) => c.name));
    console.log('[DB] messages table columns:', Array.from(colNames));

    if (!colNames.has('reasoning_content')) {
      execute('ALTER TABLE messages ADD COLUMN reasoning_content TEXT DEFAULT NULL;');
      console.log('[DB] Added column: reasoning_content');
    }
    if (!colNames.has('thinking_ms')) {
      execute('ALTER TABLE messages ADD COLUMN thinking_ms INTEGER DEFAULT NULL;');
      console.log('[DB] Added column: thinking_ms');
    }
    if (!colNames.has('input_tokens')) {
      execute('ALTER TABLE messages ADD COLUMN input_tokens INTEGER DEFAULT NULL;');
      console.log('[DB] Added column: input_tokens');
    }
    if (!colNames.has('output_tokens')) {
      execute('ALTER TABLE messages ADD COLUMN output_tokens INTEGER DEFAULT NULL;');
      console.log('[DB] Added column: output_tokens');
    }
  } catch (e) {
    console.error('[DB] ensureMessageColumns failed:', e);
  }
}

function ensureConversationColumns(): void {
  try {
    const columns = select<{ name: string }[]>('PRAGMA table_info(conversations);');
    const colNames = new Set(columns.map((c) => c.name));
    console.log('[DB] conversations table columns:', Array.from(colNames));

    if (!colNames.has('pinned')) {
      execute('ALTER TABLE conversations ADD COLUMN pinned INTEGER DEFAULT 0;');
      console.log('[DB] Added column: pinned');
    }
    if (!colNames.has('thinking_level')) {
      execute("ALTER TABLE conversations ADD COLUMN thinking_level TEXT DEFAULT NULL;");
      console.log('[DB] Added column: thinking_level');
    }
    if (!colNames.has('last_viewed_message_id')) {
      execute('ALTER TABLE conversations ADD COLUMN last_viewed_message_id TEXT DEFAULT NULL;');
      console.log('[DB] Added column: last_viewed_message_id');
    }
  } catch (e) {
    console.error('[DB] ensureConversationColumns failed:', e);
  }
}

function ensureModelColumns(): void {
  try {
    const columns = select<{ name: string }[]>('PRAGMA table_info(model_configs);');
    const colNames = new Set(columns.map((c) => c.name));
    console.log('[DB] model_configs table columns:', Array.from(colNames));

    if (!colNames.has('thinking_level')) {
      execute("ALTER TABLE model_configs ADD COLUMN thinking_level TEXT DEFAULT NULL;");
      console.log('[DB] Added column: model_configs.thinking_level');
      // 为已存在的 Gemini 3.x 模型初始化默认 thinking_level
      execute(
        "UPDATE model_configs SET thinking_level = 'MEDIUM' WHERE thinking_level IS NULL AND model_id LIKE '%gemini-3%';"
      );
    }
    if (!colNames.has('supports_vision')) {
      execute("ALTER TABLE model_configs ADD COLUMN supports_vision INTEGER NOT NULL DEFAULT 0;");
      console.log('[DB] Added column: model_configs.supports_vision');
      // 为已知的支持图片的模型自动启用
      execute(
        "UPDATE model_configs SET supports_vision = 1 WHERE model_id LIKE '%gemini%' OR model_id LIKE '%gpt-4o%' OR model_id LIKE '%claude-3%' OR model_id LIKE '%vision%' OR model_id LIKE '%llava%';"
      );
    }
  } catch (e) {
    console.error('[DB] ensureModelColumns failed:', e);
  }
}

/**
 * provider 统一迁移：历史库中的 google_gemini / openrouter 全部归一为
 * openai_compatible（三者本来就都走 OpenAI 兼容端点）；迁移前为空 endpoint 的
 * 旧 provider 模型按原供应商回填默认端点，保证已导入模型继续可用。
 * CHECK 约束保留三值以兼容旧库，此处仅 UPDATE 列值。
 */
function migrateModelProviders(): void {
  try {
    execute(`
      UPDATE model_configs SET api_endpoint = CASE provider
        WHEN 'google_gemini' THEN 'https://generativelanguage.googleapis.com/v1beta/openai/'
        WHEN 'openrouter' THEN 'https://openrouter.ai/api/v1/'
        ELSE api_endpoint END
      WHERE provider != 'openai_compatible' AND (api_endpoint IS NULL OR TRIM(api_endpoint) = '')
    `);
    const result = execute(
      "UPDATE model_configs SET provider = 'openai_compatible' WHERE provider != 'openai_compatible'"
    );
    if (result.rowsAffected > 0) {
      console.log(`[DB] Migrated ${result.rowsAffected} model_configs rows to openai_compatible`);
    }
  } catch (e) {
    console.error('[DB] migrateModelProviders failed:', e);
  }
}

/**
 * max_tokens 旧 schema 为 NOT NULL DEFAULT 16384 CHECK(max_tokens > 0)，无法表达"不限制"。
 * SQLite 不能就地修改列约束，需整表重建；存量行一并迁移为 NULL（不限制），
 * 与"新模型默认不限制"的行为保持一致。以 PRAGMA table_info 的 notnull 标记识别旧表，
 * 迁移幂等：新表（notnull=0）直接跳过。
 */
function relaxModelMaxTokensConstraint(): void {
  try {
    const columns = select<{ name: string; notnull: number }[]>('PRAGMA table_info(model_configs);');
    const maxTokensCol = columns.find((c) => c.name === 'max_tokens');
    if (!maxTokensCol || maxTokensCol.notnull === 0) return;

    console.log('[DB] Rebuilding model_configs: max_tokens -> nullable/unlimited');
    execute(`
      CREATE TABLE model_configs_new (
        id            TEXT    PRIMARY KEY NOT NULL,
        provider      TEXT    NOT NULL CHECK (provider IN ('google_gemini', 'openrouter', 'openai_compatible')),
        model_id      TEXT    NOT NULL,
        display_name  TEXT    NOT NULL,
        api_key       TEXT    NOT NULL,
        api_endpoint  TEXT    DEFAULT NULL,
        temperature   REAL    NOT NULL DEFAULT 0.6 CHECK (temperature >= 0.0 AND temperature <= 2.0),
        max_tokens    INTEGER DEFAULT NULL CHECK (max_tokens IS NULL OR max_tokens > 0),
        top_p         REAL    NOT NULL DEFAULT 1.0 CHECK (top_p >= 0.0 AND top_p <= 1.0),
        thinking_level TEXT    DEFAULT NULL,
        supports_vision INTEGER NOT NULL DEFAULT 0 CHECK (supports_vision IN (0, 1)),
        is_default    INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
    `);
    execute(`
      INSERT INTO model_configs_new
        (id, provider, model_id, display_name, api_key, api_endpoint,
         temperature, max_tokens, top_p, thinking_level, supports_vision, is_default,
         created_at, updated_at)
      SELECT id, provider, model_id, display_name, api_key, api_endpoint,
             temperature, NULL, top_p, thinking_level, supports_vision, is_default,
             created_at, updated_at
      FROM model_configs;
    `);
    execute('DROP TABLE model_configs;');
    execute('ALTER TABLE model_configs_new RENAME TO model_configs;');
    // 旧表索引随 DROP 一并删除，重建唯一索引
    execute(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_model_configs_provider_model
        ON model_configs(provider, model_id);
    `);
    console.log('[DB] model_configs rebuilt; existing rows migrated to unlimited max_tokens');
  } catch (e) {
    console.error('[DB] relaxModelMaxTokensConstraint failed:', e);
  }
}

// ---------------------------------------------------------------------------
// 系统提示词预设 (System Prompt Preset)
// ---------------------------------------------------------------------------

export function getSystemPrompts(): SystemPrompt[] {
  const rows = select<{
    id: string;
    title: string;
    content: string;
    created_at: number;
    updated_at: number;
  }[]>('SELECT * FROM system_prompts ORDER BY updated_at DESC');

  return rows.map(r => ({
    id: r.id,
    title: r.title,
    content: r.content,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export function saveSystemPrompt(prompt: SystemPrompt): void {
  // 确保同一标题只保留一条记录（去重）
  execute('DELETE FROM system_prompts WHERE title = ? AND id != ?', [prompt.title, prompt.id]);
  execute(
    `INSERT INTO system_prompts (id, title, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       content = excluded.content,
       updated_at = excluded.updated_at`,
    [prompt.id, prompt.title, prompt.content, prompt.created_at, prompt.updated_at]
  );
}

export function deleteSystemPrompt(id: UUID): void {
  execute('DELETE FROM system_prompts WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// 模型配置 (Model Config)
// ---------------------------------------------------------------------------

export function getModelConfigs(): ModelConfig[] {
  const rows = select<{
    id: string;
    provider: string;
    model_id: string;
    display_name: string;
    api_key: string;
    api_endpoint: string | null;
    temperature: number;
    max_tokens: number | null;
    top_p: number;
    thinking_level: string | null;
    supports_vision: number;
    is_default: number;
    created_at: number;
    updated_at: number;
  }[]>('SELECT * FROM model_configs ORDER BY created_at ASC');

  return rows.map(r => {
    const isGemini3 = r.model_id.includes('gemini-3');
    // 从 DB 读取 thinking_level（动态档位字符串，如 low/high/max）；
    // 旧数据为空时 Gemini 3.x fallback 到 MEDIUM
    let thinkingLevel: string | null = r.thinking_level || null;
    if (!thinkingLevel && isGemini3) {
      thinkingLevel = 'MEDIUM';
    }
    return {
      id: r.id,
      provider: r.provider,
      model_id: r.model_id,
      display_name: r.display_name,
      api_key: r.api_key,
      api_endpoint: r.api_endpoint,
      temperature: r.temperature,
      max_tokens: r.max_tokens,
      top_p: r.top_p,
      thinking_level: thinkingLevel,
      supports_vision: Boolean(r.supports_vision),
      is_default: Boolean(r.is_default),
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  });
}

export function saveModelConfig(config: ModelConfig): void {
  if (config.is_default) {
    execute('UPDATE model_configs SET is_default = 0');
  }
  execute(
    `INSERT INTO model_configs (id, provider, model_id, display_name, api_key, api_endpoint, temperature, max_tokens, top_p, thinking_level, supports_vision, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider = excluded.provider,
       model_id = excluded.model_id,
       display_name = excluded.display_name,
       api_key = excluded.api_key,
       api_endpoint = excluded.api_endpoint,
       temperature = excluded.temperature,
       max_tokens = excluded.max_tokens,
       top_p = excluded.top_p,
       thinking_level = excluded.thinking_level,
       supports_vision = excluded.supports_vision,
       is_default = excluded.is_default,
       updated_at = excluded.updated_at`,
    [
      config.id,
      config.provider,
      config.model_id,
      config.display_name,
      config.api_key,
      config.api_endpoint,
      config.temperature,
      config.max_tokens,
      config.top_p,
      config.thinking_level,
      config.supports_vision ? 1 : 0,
      config.is_default ? 1 : 0,
      config.created_at,
      config.updated_at,
    ]
  );
}

export function updateModelConfig(
  id: UUID,
  updates: Partial<Omit<ModelConfig, 'id' | 'created_at'>>
): void {
  const sets: string[] = [];
  const vals: SqlParam[] = [];

  if (updates.provider !== undefined) { sets.push('provider = ?'); vals.push(updates.provider); }
  if (updates.model_id !== undefined) { sets.push('model_id = ?'); vals.push(updates.model_id); }
  if (updates.display_name !== undefined) { sets.push('display_name = ?'); vals.push(updates.display_name); }
  if (updates.api_key !== undefined) { sets.push('api_key = ?'); vals.push(updates.api_key); }
  if (updates.api_endpoint !== undefined) { sets.push('api_endpoint = ?'); vals.push(updates.api_endpoint); }
  if (updates.temperature !== undefined) { sets.push('temperature = ?'); vals.push(updates.temperature); }
  if (updates.max_tokens !== undefined) { sets.push('max_tokens = ?'); vals.push(updates.max_tokens); }
  if (updates.top_p !== undefined) { sets.push('top_p = ?'); vals.push(updates.top_p); }
  if (updates.thinking_level !== undefined) { sets.push('thinking_level = ?'); vals.push(updates.thinking_level); }
  if (updates.supports_vision !== undefined) { sets.push('supports_vision = ?'); vals.push(updates.supports_vision ? 1 : 0); }
  if (updates.is_default !== undefined) {
    if (updates.is_default) {
      execute('UPDATE model_configs SET is_default = 0');
    }
    sets.push('is_default = ?');
    vals.push(updates.is_default ? 1 : 0);
  }
  sets.push('updated_at = ?');
  vals.push(Date.now());
  vals.push(id);

  execute(`UPDATE model_configs SET ${sets.join(', ')} WHERE id = ?`, vals);
}

export function deleteModelConfig(id: UUID): void {
  execute('DELETE FROM model_configs WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// 应用设置 (App Settings)
// ---------------------------------------------------------------------------

/** 读取全局设置；不存在时返回 null。 */
export function getAppSetting(key: string): string | null {
  const rows = select<Array<{ value: string }>>(
    'SELECT value FROM app_settings WHERE key = ?',
    [key]
  );
  return rows[0]?.value ?? null;
}

/** 写入全局设置；空值表示删除该设置。 */
export function setAppSetting(key: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    execute('DELETE FROM app_settings WHERE key = ?', [key]);
    return;
  }
  execute(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, trimmed, Date.now()]
  );
}

// ---------------------------------------------------------------------------
// 思考强度缓存（OpenRouter 模型档位元数据）
// ---------------------------------------------------------------------------

/** 启动时整表加载缓存；model_key 对 OpenRouter 为模型 slug（provider:model_id） */
export function getThinkingEffortsCache(): Record<string, ThinkingEfforts> {
  const rows = select<{ model_key: string; efforts: string; default_effort: string | null }[]>(
    'SELECT model_key, efforts, default_effort FROM thinking_efforts_cache'
  );
  const cache: Record<string, ThinkingEfforts> = {};
  for (const row of rows) {
    try {
      const efforts = JSON.parse(row.efforts);
      if (Array.isArray(efforts)) {
        cache[row.model_key] = {
          efforts: efforts.filter((e): e is string => typeof e === 'string'),
          defaultEffort: row.default_effort || null,
        };
      }
    } catch {
      // 损坏的缓存行直接跳过，下次使用时会重新拉取
    }
  }
  return cache;
}

export function saveThinkingEffortsCache(modelKey: string, efforts: ThinkingEfforts): void {
  execute(
    `INSERT INTO thinking_efforts_cache (model_key, efforts, default_effort, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(model_key) DO UPDATE SET
       efforts = excluded.efforts,
       default_effort = excluded.default_effort,
       updated_at = excluded.updated_at`,
    [modelKey, JSON.stringify(efforts.efforts), efforts.defaultEffort, Date.now()]
  );
}

// ---------------------------------------------------------------------------
// 会话 (Conversation)
// ---------------------------------------------------------------------------

export function createConversation(conv: Conversation): void {
  execute(
    'INSERT INTO conversations (id, title, model_id, system_prompt, pinned, thinking_level, last_viewed_message_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [conv.id, conv.title, conv.model_id, conv.system_prompt, conv.pinned ?? 0, conv.thinking_level ?? null, conv.last_viewed_message_id ?? null, conv.created_at, conv.updated_at]
  );
}

export function getConversation(id: UUID): Conversation | null {
  const rows = select<{
    id: string;
    title: string;
    model_id: string;
    system_prompt: string | null;
    thinking_level: string | null;
    last_viewed_message_id: string | null;
    created_at: number;
    updated_at: number;
    pinned: number | null;
  }[]>('SELECT * FROM conversations WHERE id = ?', [id]);

  if (!rows[0]) return null;
  const r = rows[0];
  // thinking_level 为动态档位字符串（如 low/high/max），保留任意非空值
  const thinkingLevel: string | null = r.thinking_level || null;

  return {
    id: r.id,
    title: r.title,
    model_id: r.model_id,
    system_prompt: r.system_prompt,
    thinking_level: thinkingLevel,
    last_viewed_message_id: r.last_viewed_message_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
    pinned: r.pinned,
  };
}

export function updateConversation(
  id: UUID,
  updates: Partial<Pick<Conversation, 'title' | 'model_id' | 'system_prompt' | 'pinned' | 'thinking_level' | 'last_viewed_message_id' | 'updated_at'>>
): void {
  const sets: string[] = [];
  const vals: SqlParam[] = [];

  if (updates.title !== undefined) { sets.push('title = ?'); vals.push(updates.title); }
  if (updates.model_id !== undefined) { sets.push('model_id = ?'); vals.push(updates.model_id); }
  if (updates.system_prompt !== undefined) { sets.push('system_prompt = ?'); vals.push(updates.system_prompt); }
  if (updates.pinned !== undefined) { sets.push('pinned = ?'); vals.push(updates.pinned); }
  if (updates.thinking_level !== undefined) { sets.push('thinking_level = ?'); vals.push(updates.thinking_level); }
  if (updates.last_viewed_message_id !== undefined) { sets.push('last_viewed_message_id = ?'); vals.push(updates.last_viewed_message_id); }
  sets.push('updated_at = ?');
  vals.push(updates.updated_at ?? Date.now());
  vals.push(id);

  execute(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`, vals);
}

export function deleteConversation(id: UUID): void {
  executeWithMessageSearchIndexRepair(
    () => execute('DELETE FROM conversations WHERE id = ?', [id]),
    'deleteConversation'
  );
}

export function getConversations(limit = 100, offset = 0): ConversationSummary[] {
  const rows = select<{
    id: string;
    title: string;
    created_at: number;
    last_message_at: number | null;
    last_message_preview: string | null;
    message_count: number;
    pinned: number | null;
  }[]>(
    `WITH ranked_conversations AS (
      SELECT
        c.id,
        c.title,
        c.created_at,
        COALESCE(c.pinned, 0) AS pinned,
        COALESCE((
          SELECT m.created_at
          FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ), c.created_at) AS last_message_at,
        COALESCE((
          SELECT SUBSTR(m.content, 1, 120)
          FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ), '') AS last_message_preview
      FROM conversations c
      ORDER BY pinned DESC, last_message_at DESC
      LIMIT ? OFFSET ?
    )
    SELECT
      rc.*,
      COALESCE((
        SELECT COUNT(*)
        FROM messages m
        WHERE m.conversation_id = rc.id
      ), 0) AS message_count
    FROM ranked_conversations rc
    ORDER BY rc.pinned DESC, rc.last_message_at DESC`,
    [limit, offset]
  );

  return rows.map(r => ({
    id: r.id,
    title: r.title,
    created_at: r.created_at,
    last_message_at: r.last_message_at ?? r.created_at,
    last_message_preview: r.last_message_preview ?? '',
    message_count: r.message_count,
    pinned: r.pinned,
  }));
}

type MessageFtsTable = 'messages_fts' | 'messages_search_fts';

type ConversationSearchRow = {
  id: string;
  title: string;
  created_at: number;
  last_message_at: number | null;
  last_message_preview: string | null;
  message_count: number;
  pinned: number | null;
};

function mapConversationRows(rows: ConversationSearchRow[]): ConversationSummary[] {
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    created_at: r.created_at,
    last_message_at: r.last_message_at ?? r.created_at,
    last_message_preview: r.last_message_preview ?? '',
    message_count: r.message_count,
    pinned: r.pinned,
  }));
}

function searchConversationsWithFtsTable(
  ftsTable: MessageFtsTable,
  ftsQuery: string,
  likeQuery: string,
  limit: number,
  offset: number
): ConversationSummary[] {
  const rows = select<ConversationSearchRow[]>(
    `WITH message_matches AS (
      SELECT
        m.conversation_id,
        MIN(rank) AS search_rank,
        MAX(m.created_at) AS matched_message_at
      FROM ${ftsTable}
      JOIN messages m ON m.rowid = ${ftsTable}.rowid
      WHERE ${ftsTable} MATCH ?
      GROUP BY m.conversation_id
    ),
    last_msg AS (
      SELECT conversation_id, content, created_at,
             ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY created_at DESC) AS rn
      FROM messages
    ),
    msg_count AS (
      SELECT conversation_id, COUNT(*) AS cnt FROM messages GROUP BY conversation_id
    )
    SELECT
      c.id,
      c.title,
      c.created_at,
      c.pinned,
      COALESCE(last_msg.created_at, c.created_at) AS last_message_at,
      COALESCE(SUBSTR(last_msg.content, 1, 120), '') AS last_message_preview,
      COALESCE(msg_count.cnt, 0) AS message_count
    FROM conversations c
    LEFT JOIN message_matches ON message_matches.conversation_id = c.id
    LEFT JOIN last_msg ON last_msg.conversation_id = c.id AND last_msg.rn = 1
    LEFT JOIN msg_count ON msg_count.conversation_id = c.id
    WHERE LOWER(c.title) LIKE ? ESCAPE '\\' OR message_matches.conversation_id IS NOT NULL
    ORDER BY
      c.pinned DESC,
      CASE WHEN LOWER(c.title) LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END,
      COALESCE(message_matches.search_rank, 999999.0),
      COALESCE(message_matches.matched_message_at, last_message_at) DESC,
      last_message_at DESC
    LIMIT ? OFFSET ?`,
    [ftsQuery, likeQuery, likeQuery, limit, offset]
  );

  return mapConversationRows(rows);
}

function searchConversationsByTitle(
  likeQuery: string,
  limit: number,
  offset: number
): ConversationSummary[] {
  const rows = select<ConversationSearchRow[]>(
    `SELECT
      c.id,
      c.title,
      c.created_at,
      c.pinned,
      COALESCE(last_msg.created_at, c.created_at) AS last_message_at,
      COALESCE(SUBSTR(last_msg.content, 1, 120), '') AS last_message_preview,
      COALESCE(msg_count.cnt, 0) AS message_count
    FROM conversations c
    LEFT JOIN (
      SELECT conversation_id, content, created_at,
             ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY created_at DESC) AS rn
    ) last_msg ON last_msg.conversation_id = c.id AND last_msg.rn = 1
    LEFT JOIN (
      SELECT conversation_id, COUNT(*) AS cnt FROM messages GROUP BY conversation_id
    ) msg_count ON msg_count.conversation_id = c.id
    WHERE LOWER(c.title) LIKE ? ESCAPE '\\'
    ORDER BY c.pinned DESC, last_message_at DESC
    LIMIT ? OFFSET ?`,
    [likeQuery, limit, offset]
  );

  return mapConversationRows(rows);
}

export function searchConversations(query: string, limit = 100, offset = 0): ConversationSummary[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const likeQuery = buildLikeQuery(trimmed);
  const compactLength = Array.from(trimmed.replace(/\s+/g, '')).length;

  if (compactLength >= 3 && hasTrigramMessageSearchIndex !== false) {
    try {
      return searchConversationsWithFtsTable(
        'messages_search_fts',
        buildFtsPhraseQuery(trimmed),
        likeQuery,
        limit,
        offset
      );
    } catch (e) {
      hasTrigramMessageSearchIndex = false;
      console.warn('[DB] Trigram conversation search failed; falling back to unicode FTS:', e);
    }
  }

  const tokenQuery = buildFtsTokenQuery(trimmed);
  if (tokenQuery) {
    try {
      return searchConversationsWithFtsTable('messages_fts', tokenQuery, likeQuery, limit, offset);
    } catch (e) {
      console.warn('[DB] Unicode FTS conversation search failed; falling back to title search:', e);
    }
  }

  return searchConversationsByTitle(likeQuery, limit, offset);
}

// ---------------------------------------------------------------------------
// 消息 (Message)
// ---------------------------------------------------------------------------

export function saveMessage(msg: Message): void {
  try {
    execute(
      'INSERT INTO messages (id, conversation_id, role, content, reasoning_content, thinking_ms, status, token_count, input_tokens, output_tokens, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [msg.id, msg.conversation_id, msg.role, msg.content, msg.reasoning_content ?? null, msg.thinking_ms ?? null, msg.status, msg.token_count, msg.input_tokens, msg.output_tokens, msg.model_id, msg.created_at, msg.updated_at]
    );
  } catch (e: any) {
    // Fallback: 如果新列不存在，使用旧版 SQL
    if (e?.message?.includes('input_tokens') || e?.message?.includes('output_tokens') || e?.message?.includes('no column named')) {
      console.warn('[DB] saveMessage fallback (old schema):', e.message);
      execute(
        'INSERT INTO messages (id, conversation_id, role, content, reasoning_content, status, token_count, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [msg.id, msg.conversation_id, msg.role, msg.content, msg.reasoning_content ?? null, msg.status, msg.token_count, msg.model_id, msg.created_at, msg.updated_at]
      );
    } else {
      throw e;
    }
  }
}

export function updateMessage(
  id: UUID,
  updates: Partial<Pick<Message, 'content' | 'reasoning_content' | 'thinking_ms' | 'status' | 'token_count' | 'input_tokens' | 'output_tokens' | 'updated_at'>>
): void {
  const sets: string[] = [];
  const vals: SqlParam[] = [];

  if (updates.content !== undefined) { sets.push('content = ?'); vals.push(updates.content); }
  if (updates.reasoning_content !== undefined) { sets.push('reasoning_content = ?'); vals.push(updates.reasoning_content); }
  if (updates.thinking_ms !== undefined) { sets.push('thinking_ms = ?'); vals.push(updates.thinking_ms); }
  if (updates.status !== undefined) { sets.push('status = ?'); vals.push(updates.status); }
  if (updates.token_count !== undefined) { sets.push('token_count = ?'); vals.push(updates.token_count); }
  if (updates.input_tokens !== undefined) { sets.push('input_tokens = ?'); vals.push(updates.input_tokens); }
  if (updates.output_tokens !== undefined) { sets.push('output_tokens = ?'); vals.push(updates.output_tokens); }
  sets.push('updated_at = ?');
  vals.push(updates.updated_at ?? Date.now());
  vals.push(id);

  const sql = `UPDATE messages SET ${sets.join(', ')} WHERE id = ?`;
  try {
    execute(sql, vals);
  } catch (e: any) {
    // Fallback: 如果新列不存在，移除相关 set 子句后重试
    if (e?.message?.includes('input_tokens') || e?.message?.includes('output_tokens') || e?.message?.includes('no column named')) {
      console.warn('[DB] updateMessage fallback (old schema):', e.message);
      const fallbackSets: string[] = [];
      const fallbackVals: SqlParam[] = [];
      if (updates.content !== undefined) { fallbackSets.push('content = ?'); fallbackVals.push(updates.content); }
      if (updates.reasoning_content !== undefined) { fallbackSets.push('reasoning_content = ?'); fallbackVals.push(updates.reasoning_content); }
      if (updates.status !== undefined) { fallbackSets.push('status = ?'); fallbackVals.push(updates.status); }
      if (updates.token_count !== undefined) { fallbackSets.push('token_count = ?'); fallbackVals.push(updates.token_count); }
      fallbackSets.push('updated_at = ?');
      fallbackVals.push(updates.updated_at ?? Date.now());
      fallbackVals.push(id);
      execute(`UPDATE messages SET ${fallbackSets.join(', ')} WHERE id = ?`, fallbackVals);
    } else {
      throw e;
    }
  }
}

export function getMessages(
  conversationId: UUID,
  limit = 200,
  beforeTimestamp: EpochMillis | null = null
): Message[] {
  if (beforeTimestamp) {
    return select<Message[]>(
      `SELECT * FROM (
        SELECT * FROM messages
        WHERE conversation_id = ? AND created_at < ?
        ORDER BY created_at DESC
        LIMIT ?
      ) ORDER BY created_at ASC`,
      [conversationId, beforeTimestamp, limit]
    );
  }
  return select<Message[]>(
    `SELECT * FROM (
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    ) ORDER BY created_at ASC`,
    [conversationId, limit]
  );
}

export function deleteMessage(id: UUID): void {
  executeWithMessageSearchIndexRepair(
    () => execute('DELETE FROM messages WHERE id = ?', [id]),
    'deleteMessage'
  );
}

// ---------------------------------------------------------------------------
// Mermaid SVG 缓存：(主题, 源码) → SVG。渲染确定性输出，重开会话零渲染成本
// ---------------------------------------------------------------------------

const MERMAID_SVG_CACHE_LIMIT = 200;

export function getMermaidSvgCache(cacheKey: string): string | null {
  const rows = select<Array<{ svg: string }>>(
    'SELECT svg FROM mermaid_svgs WHERE cache_key = ?',
    [cacheKey]
  );
  const svg = rows[0]?.svg ?? null;
  if (svg !== null) {
    // 更新命中时间（供 LRU 清理），失败不影响读取结果
    try {
      execute('UPDATE mermaid_svgs SET last_hit_at = ? WHERE cache_key = ?', [Date.now(), cacheKey]);
    } catch { /* 忽略命中时间更新失败 */ }
  }
  return svg;
}

export function setMermaidSvgCache(cacheKey: string, svg: string): void {
  const now = Date.now();
  execute(
    `INSERT INTO mermaid_svgs (cache_key, svg, created_at, last_hit_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET svg = excluded.svg, last_hit_at = excluded.last_hit_at`,
    [cacheKey, svg, now, now]
  );
  // LRU：超出上限时删除最久未命中的
  execute(
    `DELETE FROM mermaid_svgs WHERE cache_key NOT IN (
      SELECT cache_key FROM mermaid_svgs ORDER BY last_hit_at DESC LIMIT ?
    )`,
    [MERMAID_SVG_CACHE_LIMIT]
  );
}

export function searchMessages(
  query: string,
  conversationId: UUID | null = null,
  limit = 50,
  offset = 0
): Array<{ message: Message; conversation_title: string; snippet: string; rank: number }> {
  const likeQuery = buildFtsTokenQuery(query);
  if (!likeQuery) return [];

  type SearchRow = { message: Message; conversation_title: string; snippet: string; rank: number };

  if (conversationId) {
    return select<SearchRow[]>(
      `SELECT
        m.*,
        c.title AS conversation_title,
        snippet(messages_fts, 0, '<mark>', '</mark>', '...', 32) AS snippet,
        rank
      FROM messages_fts
      JOIN messages m ON m.rowid = messages_fts.rowid
      JOIN conversations c ON c.id = m.conversation_id
      WHERE messages_fts MATCH ? AND m.conversation_id = ?
      ORDER BY rank
      LIMIT ? OFFSET ?`,
      [likeQuery, conversationId, limit, offset]
    );
  }

  return select<SearchRow[]>(
    `SELECT
      m.*,
      c.title AS conversation_title,
      snippet(messages_fts, 0, '<mark>', '</mark>', '...', 32) AS snippet,
      rank
    FROM messages_fts
    JOIN messages m ON m.rowid = messages_fts.rowid
    JOIN conversations c ON c.id = m.conversation_id
    WHERE messages_fts MATCH ?
    ORDER BY rank
    LIMIT ? OFFSET ?`,
    [likeQuery, limit, offset]
  );
}
