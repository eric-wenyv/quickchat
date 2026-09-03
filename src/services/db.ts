// =============================================================================
// Quick-Chat — SQLite 数据库操作封装
// =============================================================================
// 基于 tauri-plugin-sql，前端直接执行 SQL。
// =============================================================================

import Database from '@tauri-apps/plugin-sql';
import type {
  Conversation,
  ConversationSummary,
  Message,
  ModelConfig,
  SystemPrompt,
  UUID,
  EpochMillis,
} from '@/types/types';

let dbInstance: Database | null = null;
let hasTrigramMessageSearchIndex: boolean | null = null;

// dev:fresh 模式（npm run dev:fresh）：改用独立的开发数据库文件，与真实数据
// 完全隔离。Rust 侧每次启动前会删除该文件（见 lib.rs），因此每次启动都等价于
// 全新安装的空白首启。
const DB_FILE = import.meta.env.VITE_FRESH_DB === '1' ? 'quick_chat_dev.db' : 'quick_chat.db';

export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;
  dbInstance = await Database.load(`sqlite:${DB_FILE}`);
  return dbInstance;
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

async function createMessageFtsIndex(db: Database): Promise<void> {
  await db.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      content='messages',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );
  `);
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS trg_messages_fts_insert
      AFTER INSERT ON messages
    BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
    END;
  `);
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS trg_messages_fts_update
      AFTER UPDATE OF content ON messages
    BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
      INSERT INTO messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
    END;
  `);
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS trg_messages_fts_delete
      AFTER DELETE ON messages
    BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
    END;
  `);
}

async function createTrigramMessageSearchIndex(db: Database): Promise<void> {
  await db.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_search_fts USING fts5(
      content,
      content='messages',
      content_rowid='rowid',
      tokenize='trigram'
    );
  `);
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS trg_messages_search_fts_insert
      AFTER INSERT ON messages
    BEGIN
      INSERT INTO messages_search_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
    END;
  `);
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS trg_messages_search_fts_update
      AFTER UPDATE OF content ON messages
    BEGIN
      INSERT INTO messages_search_fts(messages_search_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
      INSERT INTO messages_search_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
    END;
  `);
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS trg_messages_search_fts_delete
      AFTER DELETE ON messages
    BEGIN
      INSERT INTO messages_search_fts(messages_search_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
    END;
  `);
}

async function dropMessageSearchIndexObjects(db: Database): Promise<void> {
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
    await db.execute(statement);
  }
}

async function rebuildMessageSearchIndexes(db: Database): Promise<void> {
  await dropMessageSearchIndexObjects(db);

  await createMessageFtsIndex(db);
  await db.execute(`INSERT INTO messages_fts(messages_fts) VALUES ('rebuild');`);

  try {
    await createTrigramMessageSearchIndex(db);
    await db.execute(`INSERT INTO messages_search_fts(messages_search_fts) VALUES ('rebuild');`);
    hasTrigramMessageSearchIndex = true;
  } catch (e) {
    hasTrigramMessageSearchIndex = false;
    console.warn('[DB] Failed to rebuild trigram message search index; unicode FTS remains available:', e);
  }
}

async function executeWithMessageSearchIndexRepair<T>(
  db: Database,
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  try {
    return await operation();
  } catch (e) {
    if (!isSqliteCorruptionError(e)) throw e;

    console.warn(`[DB] ${operationName} failed with SQLite corruption; rebuilding message search indexes and retrying:`, e);
    await rebuildMessageSearchIndexes(db);
    return operation();
  }
}

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------

export async function initDatabase(): Promise<void> {
  const db = await getDb();

  // WAL 模式与外键
  await db.execute('PRAGMA journal_mode = WAL;');
  await db.execute('PRAGMA foreign_keys = ON;');

  // 会话表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS conversations (
      id          TEXT    PRIMARY KEY NOT NULL,
      title       TEXT    NOT NULL DEFAULT '',
      model_id    TEXT    NOT NULL,
      system_prompt TEXT  DEFAULT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
      ON conversations(updated_at DESC);
  `);

  // 消息表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT    PRIMARY KEY NOT NULL,
      conversation_id TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role            TEXT    NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content         TEXT    NOT NULL DEFAULT '',
      reasoning_content TEXT  DEFAULT NULL,
      status          TEXT    NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'streaming', 'completed', 'error')),
      token_count     INTEGER DEFAULT NULL,
      input_tokens    INTEGER DEFAULT NULL,
      output_tokens   INTEGER DEFAULT NULL,
      model_id        TEXT    DEFAULT NULL,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );
  `);
  await ensureMessageColumns(db);
  await ensureConversationColumns(db);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_time
      ON messages(conversation_id, created_at ASC);
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_messages_status
      ON messages(status) WHERE status IN ('pending', 'streaming');
  `);

  // ── 同步预留（Sync reservation）─────────────────────────────────────────
  // 桌面端与移动端各自持有本地库，通过 LAN 同步通道双向合并（见
  // src/services/sync.ts 与 src-tauri/src/sync_server.rs）：
  //
  // 1. deleted_at（conversations / messages）：软删除墓碑占位。当前同步的
  //    增量水位线保证已删除项不会被重新推送，但删除本身暂不传播（v1 限制）。
  // 2. sync_meta：设备级元数据（device_id、同步开关等），预留未用。
  //
  // 设计约定：
  // - 主键全局唯一（UUIDv4），直接作为同步标识；模型配置按 (provider, model_id)
  //   自然键匹配（两端 id 独立生成）；
  // - 冲突策略 last-write-wins（按 updated_at，毫秒精度）；
  // - api_key 属于桌面端配置：随 export（桌面 → 移动）方向同步，
  //   仅限用户自己的设备、经局域网 + Token 鉴权传输；
  // - 传输通道为桌面端 sync_server（HTTP + Bearer Token），移动端为客户端。
  await ensureSyncColumns(db);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sync_meta (
      key        TEXT PRIMARY KEY NOT NULL,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // FTS5 全文检索。只创建结构，耗时的同步/重建放到首屏之后后台执行。
  await createMessageFtsIndex(db);
  try {
    await createTrigramMessageSearchIndex(db);
    hasTrigramMessageSearchIndex = true;
  } catch (e) {
    hasTrigramMessageSearchIndex = false;
    console.warn('[DB] Trigram message search index is unavailable; falling back to unicode FTS:', e);
  }

  // 系统提示词预设表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS system_prompts (
      id          TEXT    PRIMARY KEY NOT NULL,
      title       TEXT    NOT NULL,
      content     TEXT    NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_system_prompts_updated_at
      ON system_prompts(updated_at DESC);
  `);

  // 模型配置表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS model_configs (
      id            TEXT    PRIMARY KEY NOT NULL,
      provider      TEXT    NOT NULL CHECK (provider IN ('google_gemini', 'openrouter', 'openai_compatible')),
      model_id      TEXT    NOT NULL,
      display_name  TEXT    NOT NULL,
      api_key       TEXT    NOT NULL,
      api_endpoint  TEXT    DEFAULT NULL,
      temperature   REAL    NOT NULL DEFAULT 0.6 CHECK (temperature >= 0.0 AND temperature <= 2.0),
      max_tokens    INTEGER NOT NULL DEFAULT 16384 CHECK (max_tokens > 0),
      top_p         REAL    NOT NULL DEFAULT 1.0 CHECK (top_p >= 0.0 AND top_p <= 1.0),
      thinking_level TEXT    DEFAULT NULL,
      supports_vision INTEGER NOT NULL DEFAULT 0 CHECK (supports_vision IN (0, 1)),
      is_default    INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
  `);
  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_model_configs_provider_model
      ON model_configs(provider, model_id);
  `);
  await ensureModelColumns(db);
}

export async function runDatabaseMaintenance(): Promise<void> {
  const db = await getDb();
  await ensureFtsIndexSynced(db, 'messages_fts');
  await ensureTrigramMessageSearchIndex(db);
}

async function ensureFtsIndexSynced(db: Database, tableName: 'messages_fts' | 'messages_search_fts'): Promise<void> {
  try {
    const rows = await db.select<{ message_count: number; index_count: number }[]>(`
      SELECT
        (SELECT COUNT(*) FROM messages) AS message_count,
        (SELECT COUNT(*) FROM ${tableName}) AS index_count
    `);
    const counts = rows[0];
    if (counts && counts.message_count !== counts.index_count) {
      await db.execute(`INSERT INTO ${tableName}(${tableName}) VALUES ('rebuild');`);
      console.log(`[DB] Rebuilt ${tableName} (${counts.index_count} -> ${counts.message_count})`);
    }
  } catch (e) {
    if (isSqliteCorruptionError(e)) {
      console.warn(`[DB] ${tableName} appears corrupt; rebuilding message search indexes:`, e);
      try {
        await rebuildMessageSearchIndexes(db);
      } catch (repairError) {
        console.warn(`[DB] Failed to rebuild message search indexes after ${tableName} corruption:`, repairError);
      }
      return;
    }

    console.warn(`[DB] Failed to sync ${tableName}:`, e);
  }
}

async function ensureTrigramMessageSearchIndex(db: Database): Promise<void> {
  try {
    await createTrigramMessageSearchIndex(db);
    await ensureFtsIndexSynced(db, 'messages_search_fts');
    hasTrigramMessageSearchIndex = true;
  } catch (e) {
    hasTrigramMessageSearchIndex = false;
    console.warn('[DB] Trigram message search index is unavailable; falling back to unicode FTS:', e);
  }
}

async function ensureMessageColumns(db: Database): Promise<void> {
  try {
    const columns = await db.select<{ name: string }[]>('PRAGMA table_info(messages);');
    const colNames = new Set(columns.map((c: any) => c.name));
    console.log('[DB] messages table columns:', Array.from(colNames));

    if (!colNames.has('reasoning_content')) {
      await db.execute('ALTER TABLE messages ADD COLUMN reasoning_content TEXT DEFAULT NULL;');
      console.log('[DB] Added column: reasoning_content');
    }
    if (!colNames.has('input_tokens')) {
      await db.execute('ALTER TABLE messages ADD COLUMN input_tokens INTEGER DEFAULT NULL;');
      console.log('[DB] Added column: input_tokens');
    }
    if (!colNames.has('output_tokens')) {
      await db.execute('ALTER TABLE messages ADD COLUMN output_tokens INTEGER DEFAULT NULL;');
      console.log('[DB] Added column: output_tokens');
    }
  } catch (e) {
    console.error('[DB] ensureMessageColumns failed:', e);
  }
}

async function ensureConversationColumns(db: Database): Promise<void> {
  try {
    const columns = await db.select<{ name: string }[]>('PRAGMA table_info(conversations);');
    const colNames = new Set(columns.map((c: any) => c.name));
    console.log('[DB] conversations table columns:', Array.from(colNames));

    if (!colNames.has('pinned')) {
      await db.execute('ALTER TABLE conversations ADD COLUMN pinned INTEGER DEFAULT 0;');
      console.log('[DB] Added column: pinned');
    }
    if (!colNames.has('thinking_level')) {
      await db.execute("ALTER TABLE conversations ADD COLUMN thinking_level TEXT DEFAULT NULL;");
      console.log('[DB] Added column: thinking_level');
    }
    if (!colNames.has('last_viewed_message_id')) {
      await db.execute('ALTER TABLE conversations ADD COLUMN last_viewed_message_id TEXT DEFAULT NULL;');
      console.log('[DB] Added column: last_viewed_message_id');
    }
  } catch (e) {
    console.error('[DB] ensureConversationColumns failed:', e);
  }
}

/** 同步预留列：deleted_at 软删除墓碑（当前不参与任何查询行为） */
async function ensureSyncColumns(db: Database): Promise<void> {
  try {
    const conversations = await db.select<{ name: string }[]>('PRAGMA table_info(conversations);');
    if (!conversations.map((c: any) => c.name).includes('deleted_at')) {
      await db.execute('ALTER TABLE conversations ADD COLUMN deleted_at INTEGER DEFAULT NULL;');
      console.log('[DB] Added column: conversations.deleted_at');
    }
    const messages = await db.select<{ name: string }[]>('PRAGMA table_info(messages);');
    if (!messages.map((c: any) => c.name).includes('deleted_at')) {
      await db.execute('ALTER TABLE messages ADD COLUMN deleted_at INTEGER DEFAULT NULL;');
      console.log('[DB] Added column: messages.deleted_at');
    }
  } catch (e) {
    console.error('[DB] ensureSyncColumns failed:', e);
  }
}

async function ensureModelColumns(db: Database): Promise<void> {
  try {
    const columns = await db.select<{ name: string }[]>('PRAGMA table_info(model_configs);');
    const colNames = new Set(columns.map((c: any) => c.name));
    console.log('[DB] model_configs table columns:', Array.from(colNames));

    if (!colNames.has('thinking_level')) {
      await db.execute("ALTER TABLE model_configs ADD COLUMN thinking_level TEXT DEFAULT NULL;");
      console.log('[DB] Added column: model_configs.thinking_level');
      // 为已存在的 Gemini 3.x 模型初始化默认 thinking_level
      await db.execute(
        "UPDATE model_configs SET thinking_level = 'MEDIUM' WHERE thinking_level IS NULL AND model_id LIKE '%gemini-3%';"
      );
    }
    if (!colNames.has('supports_vision')) {
      await db.execute("ALTER TABLE model_configs ADD COLUMN supports_vision INTEGER NOT NULL DEFAULT 0;");
      console.log('[DB] Added column: model_configs.supports_vision');
      // 为已知的支持图片的模型自动启用
      await db.execute(
        "UPDATE model_configs SET supports_vision = 1 WHERE model_id LIKE '%gemini%' OR model_id LIKE '%gpt-4o%' OR model_id LIKE '%claude-3%' OR model_id LIKE '%vision%' OR model_id LIKE '%llava%';"
      );
    }
  } catch (e) {
    console.error('[DB] ensureModelColumns failed:', e);
  }
}

// ---------------------------------------------------------------------------
// 系统提示词预设 (System Prompt Preset)
// ---------------------------------------------------------------------------

export async function getSystemPrompts(): Promise<SystemPrompt[]> {
  const db = await getDb();
  const rows = await db.select<{
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

export async function saveSystemPrompt(prompt: SystemPrompt): Promise<void> {
  const db = await getDb();
  // 确保同一标题只保留一条记录（去重）
  await db.execute('DELETE FROM system_prompts WHERE title = ? AND id != ?', [prompt.title, prompt.id]);
  await db.execute(
    `INSERT INTO system_prompts (id, title, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       content = excluded.content,
       updated_at = excluded.updated_at`,
    [prompt.id, prompt.title, prompt.content, prompt.created_at, prompt.updated_at]
  );
}

export async function deleteSystemPrompt(id: UUID): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM system_prompts WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// 模型配置 (Model Config)
// ---------------------------------------------------------------------------

export async function getModelConfigs(): Promise<ModelConfig[]> {
  const db = await getDb();
  const rows = await db.select<{
    id: string;
    provider: string;
    model_id: string;
    display_name: string;
    api_key: string;
    api_endpoint: string | null;
    temperature: number;
    max_tokens: number;
    top_p: number;
    thinking_level: string | null;
    supports_vision: number;
    is_default: number;
    created_at: number;
    updated_at: number;
  }[]>('SELECT * FROM model_configs ORDER BY created_at ASC');

  return rows.map(r => {
    const isGemini3 = r.model_id.includes('gemini-3');
    // 从 DB 读取 thinking_level；旧数据 fallback 到 Gemini 3.x 默认 MEDIUM
    let thinkingLevel: 'LOW' | 'MEDIUM' | 'HIGH' | null = null;
    if (r.thinking_level === 'LOW' || r.thinking_level === 'MEDIUM' || r.thinking_level === 'HIGH') {
      thinkingLevel = r.thinking_level;
    } else if (isGemini3) {
      thinkingLevel = 'MEDIUM';
    }
    return {
      id: r.id,
      provider: r.provider as ModelConfig['provider'],
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

export async function saveModelConfig(config: ModelConfig): Promise<void> {
  const db = await getDb();
  if (config.is_default) {
    await db.execute('UPDATE model_configs SET is_default = 0');
  }
  await db.execute(
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

export async function updateModelConfig(
  id: UUID,
  updates: Partial<Omit<ModelConfig, 'id' | 'created_at'>>
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

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
      await db.execute('UPDATE model_configs SET is_default = 0');
    }
    sets.push('is_default = ?');
    vals.push(updates.is_default ? 1 : 0);
  }
  sets.push('updated_at = ?');
  vals.push(Date.now());
  vals.push(id);

  await db.execute(`UPDATE model_configs SET ${sets.join(', ')} WHERE id = ?`, vals);
}

export async function deleteModelConfig(id: UUID): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM model_configs WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// 会话 (Conversation)
// ---------------------------------------------------------------------------

export async function createConversation(conv: Conversation): Promise<void> {
  const db = await getDb();
  await db.execute(
    'INSERT INTO conversations (id, title, model_id, system_prompt, pinned, thinking_level, last_viewed_message_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [conv.id, conv.title, conv.model_id, conv.system_prompt, conv.pinned ?? 0, conv.thinking_level ?? null, conv.last_viewed_message_id ?? null, conv.created_at, conv.updated_at]
  );
}

export async function getConversation(id: UUID): Promise<Conversation | null> {
  const db = await getDb();
  const rows = await db.select<{
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
  // 验证 thinking_level 值，只接受合法枚举
  const validLevels = ['LOW', 'MEDIUM', 'HIGH'] as const;
  const thinkingLevel = r.thinking_level && (validLevels as readonly string[]).includes(r.thinking_level)
    ? (r.thinking_level as 'LOW' | 'MEDIUM' | 'HIGH')
    : null;

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

export async function updateConversation(
  id: UUID,
  updates: Partial<Pick<Conversation, 'title' | 'model_id' | 'system_prompt' | 'pinned' | 'thinking_level' | 'last_viewed_message_id' | 'updated_at'>>
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  if (updates.title !== undefined) { sets.push('title = ?'); vals.push(updates.title); }
  if (updates.model_id !== undefined) { sets.push('model_id = ?'); vals.push(updates.model_id); }
  if (updates.system_prompt !== undefined) { sets.push('system_prompt = ?'); vals.push(updates.system_prompt); }
  if (updates.pinned !== undefined) { sets.push('pinned = ?'); vals.push(updates.pinned); }
  if (updates.thinking_level !== undefined) { sets.push('thinking_level = ?'); vals.push(updates.thinking_level); }
  if (updates.last_viewed_message_id !== undefined) { sets.push('last_viewed_message_id = ?'); vals.push(updates.last_viewed_message_id); }
  sets.push('updated_at = ?');
  vals.push(updates.updated_at ?? Date.now());
  vals.push(id);

  await db.execute(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`, vals);
}

export async function deleteConversation(id: UUID): Promise<void> {
  const db = await getDb();
  await executeWithMessageSearchIndexRepair(
    db,
    () => db.execute('DELETE FROM conversations WHERE id = ?', [id]),
    'deleteConversation'
  );
}

export async function getConversations(limit = 100, offset = 0): Promise<ConversationSummary[]> {
  const db = await getDb();
  const rows = await db.select<{
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

async function searchConversationsWithFtsTable(
  db: Database,
  ftsTable: MessageFtsTable,
  ftsQuery: string,
  likeQuery: string,
  limit: number,
  offset: number
): Promise<ConversationSummary[]> {
  const rows = await db.select<ConversationSearchRow[]>(
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

async function searchConversationsByTitle(
  db: Database,
  likeQuery: string,
  limit: number,
  offset: number
): Promise<ConversationSummary[]> {
  const rows = await db.select<ConversationSearchRow[]>(
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
      FROM messages
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

export async function searchConversations(query: string, limit = 100, offset = 0): Promise<ConversationSummary[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const db = await getDb();
  const likeQuery = buildLikeQuery(trimmed);
  const compactLength = Array.from(trimmed.replace(/\s+/g, '')).length;

  if (compactLength >= 3 && hasTrigramMessageSearchIndex !== false) {
    try {
      return await searchConversationsWithFtsTable(
        db,
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
      return await searchConversationsWithFtsTable(db, 'messages_fts', tokenQuery, likeQuery, limit, offset);
    } catch (e) {
      console.warn('[DB] Unicode FTS conversation search failed; falling back to title search:', e);
    }
  }

  return searchConversationsByTitle(db, likeQuery, limit, offset);
}

// ---------------------------------------------------------------------------
// 消息 (Message)
// ---------------------------------------------------------------------------

export async function saveMessage(msg: Message): Promise<void> {
  const db = await getDb();
  try {
    await db.execute(
      'INSERT INTO messages (id, conversation_id, role, content, reasoning_content, status, token_count, input_tokens, output_tokens, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [msg.id, msg.conversation_id, msg.role, msg.content, msg.reasoning_content ?? null, msg.status, msg.token_count, msg.input_tokens, msg.output_tokens, msg.model_id, msg.created_at, msg.updated_at]
    );
  } catch (e: any) {
    // Fallback: 如果新列不存在，使用旧版 SQL
    if (e?.message?.includes('input_tokens') || e?.message?.includes('output_tokens') || e?.message?.includes('no column named')) {
      console.warn('[DB] saveMessage fallback (old schema):', e.message);
      await db.execute(
        'INSERT INTO messages (id, conversation_id, role, content, reasoning_content, status, token_count, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [msg.id, msg.conversation_id, msg.role, msg.content, msg.reasoning_content ?? null, msg.status, msg.token_count, msg.model_id, msg.created_at, msg.updated_at]
      );
    } else {
      throw e;
    }
  }
}

export async function updateMessage(
  id: UUID,
  updates: Partial<Pick<Message, 'content' | 'reasoning_content' | 'status' | 'token_count' | 'input_tokens' | 'output_tokens' | 'updated_at'>>
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  if (updates.content !== undefined) { sets.push('content = ?'); vals.push(updates.content); }
  if (updates.reasoning_content !== undefined) { sets.push('reasoning_content = ?'); vals.push(updates.reasoning_content); }
  if (updates.status !== undefined) { sets.push('status = ?'); vals.push(updates.status); }
  if (updates.token_count !== undefined) { sets.push('token_count = ?'); vals.push(updates.token_count); }
  if (updates.input_tokens !== undefined) { sets.push('input_tokens = ?'); vals.push(updates.input_tokens); }
  if (updates.output_tokens !== undefined) { sets.push('output_tokens = ?'); vals.push(updates.output_tokens); }
  sets.push('updated_at = ?');
  vals.push(updates.updated_at ?? Date.now());
  vals.push(id);

  const sql = `UPDATE messages SET ${sets.join(', ')} WHERE id = ?`;
  try {
    await db.execute(sql, vals);
  } catch (e: any) {
    // Fallback: 如果新列不存在，移除相关 set 子句后重试
    if (e?.message?.includes('input_tokens') || e?.message?.includes('output_tokens') || e?.message?.includes('no column named')) {
      console.warn('[DB] updateMessage fallback (old schema):', e.message);
      const fallbackSets: string[] = [];
      const fallbackVals: (string | number | null)[] = [];
      if (updates.content !== undefined) { fallbackSets.push('content = ?'); fallbackVals.push(updates.content); }
      if (updates.reasoning_content !== undefined) { fallbackSets.push('reasoning_content = ?'); fallbackVals.push(updates.reasoning_content); }
      if (updates.status !== undefined) { fallbackSets.push('status = ?'); fallbackVals.push(updates.status); }
      if (updates.token_count !== undefined) { fallbackSets.push('token_count = ?'); fallbackVals.push(updates.token_count); }
      fallbackSets.push('updated_at = ?');
      fallbackVals.push(updates.updated_at ?? Date.now());
      fallbackVals.push(id);
      await db.execute(`UPDATE messages SET ${fallbackSets.join(', ')} WHERE id = ?`, fallbackVals);
    } else {
      throw e;
    }
  }
}

export async function getMessages(
  conversationId: UUID,
  limit = 200,
  beforeTimestamp: EpochMillis | null = null
): Promise<Message[]> {
  const db = await getDb();
  if (beforeTimestamp) {
    return db.select<Message[]>(
      `SELECT * FROM (
        SELECT * FROM messages
        WHERE conversation_id = ? AND created_at < ?
        ORDER BY created_at DESC
        LIMIT ?
      ) ORDER BY created_at ASC`,
      [conversationId, beforeTimestamp, limit]
    );
  }
  return db.select<Message[]>(
    `SELECT * FROM (
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    ) ORDER BY created_at ASC`,
    [conversationId, limit]
  );
}

export async function deleteMessage(id: UUID): Promise<void> {
  const db = await getDb();
  await executeWithMessageSearchIndexRepair(
    db,
    () => db.execute('DELETE FROM messages WHERE id = ?', [id]),
    'deleteMessage'
  );
}

export async function searchMessages(
  query: string,
  conversationId: UUID | null = null,
  limit = 50,
  offset = 0
): Promise<Array<{ message: Message; conversation_title: string; snippet: string; rank: number }>> {
  const db = await getDb();
  const likeQuery = buildFtsTokenQuery(query);
  if (!likeQuery) return [];

  if (conversationId) {
    return db.select(
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

  return db.select(
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

// ---------------------------------------------------------------------------
// 数据迁移：localStorage → SQLite
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

  const db = await getDb();

  // 迁移模型配置
  for (const m of models) {
    try {
      await db.execute(
        `INSERT OR IGNORE INTO model_configs (id, provider, model_id, display_name, api_key, api_endpoint, temperature, max_tokens, top_p, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          m.id,
          m.provider || 'google_gemini',
          m.model_id,
          m.display_name,
          m.api_key,
          m.api_endpoint ?? null,
          m.temperature ?? 0.6,
          m.max_tokens ?? 16384,
          m.top_p ?? 1.0,
          m.is_default ? 1 : 0,
          m.created_at ?? Date.now(),
          m.updated_at ?? Date.now(),
        ]
      );
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
      await db.execute(
        `INSERT OR IGNORE INTO conversations (id, title, model_id, system_prompt, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          c.id,
          c.title || 'New Chat',
          details.model_id || '',
          details.system_prompt ?? null,
          now,
          c.last_message_at ?? now,
        ]
      );
    } catch (e) {
      console.warn('会话迁移失败:', c.id, e);
    }
  }

  // 迁移消息
  for (const m of msgs) {
    try {
      await db.execute(
        `INSERT OR IGNORE INTO messages (id, conversation_id, role, content, reasoning_content, status, token_count, input_tokens, output_tokens, model_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          m.id,
          m.conversation_id,
          m.role,
          m.content,
          m.reasoning_content ?? null,
          m.status || 'completed',
          m.token_count ?? null,
          m.input_tokens ?? null,
          m.output_tokens ?? null,
          m.model_id ?? null,
          m.created_at,
          m.updated_at ?? m.created_at,
        ]
      );
    } catch (e) {
      console.warn('消息迁移失败:', m.id, e);
    }
  }

  localStorage.setItem('quick_chat_db_migrated', 'true');
  return true;
}

// ---------------------------------------------------------------------------
// 设备间同步（LAN 同步通道的数据面，供 src/services/sync.ts 使用）
// 同步协议采用 last-write-wins（按 updated_at），见 initDatabase 内的同步预留注释
// ---------------------------------------------------------------------------

export interface SyncConversationRow {
  id: string;
  title: string;
  model_id: string;
  system_prompt: string | null;
  pinned: number;
  thinking_level: string | null;
  last_viewed_message_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface SyncMessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  reasoning_content: string | null;
  status: string;
  token_count: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  model_id: string | null;
  created_at: number;
  updated_at: number;
}

/** 水位线之后有更新的会话（原始行，保留 0/1 整数与 null 语义） */
export async function getConversationsUpdatedSince(since: number): Promise<SyncConversationRow[]> {
  const db = await getDb();
  return db.select<SyncConversationRow[]>(
    'SELECT id, title, model_id, system_prompt, pinned, thinking_level, last_viewed_message_id, created_at, updated_at FROM conversations WHERE updated_at > ?',
    [since]
  );
}

/** 水位线之后有更新的消息（原始行） */
export async function getMessagesUpdatedSince(since: number): Promise<SyncMessageRow[]> {
  const db = await getDb();
  return db.select<SyncMessageRow[]>(
    `SELECT id, conversation_id, role, content, reasoning_content, status,
            token_count, input_tokens, output_tokens, model_id, created_at, updated_at
     FROM messages WHERE updated_at > ?`,
    [since]
  );
}

export async function getConversationRowById(id: string): Promise<SyncConversationRow | null> {
  const db = await getDb();
  const rows = await db.select<SyncConversationRow[]>(
    'SELECT id, title, model_id, system_prompt, pinned, thinking_level, last_viewed_message_id, created_at, updated_at FROM conversations WHERE id = ?',
    [id]
  );
  return rows[0] ?? null;
}

/**
 * 合并对端推送/拉取的会话与消息：仅当对端 updated_at 更新时覆盖（LWW）。
 * 消息的外键依赖父会话，因此先合并会话；孤儿消息逐条跳过并计数。
 */
export async function mergeSyncedConversations(
  convs: SyncConversationRow[],
  messages: SyncMessageRow[]
): Promise<{ conversations: number; messages: number; skipped: number }> {
  const db = await getDb();
  let convCount = 0;
  let msgCount = 0;
  let skipped = 0;

  for (const c of convs) {
    try {
      const res = await db.execute(
        `INSERT INTO conversations
           (id, title, model_id, system_prompt, pinned, thinking_level, last_viewed_message_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           model_id = excluded.model_id,
           system_prompt = excluded.system_prompt,
           pinned = excluded.pinned,
           thinking_level = excluded.thinking_level,
           last_viewed_message_id = excluded.last_viewed_message_id,
           updated_at = excluded.updated_at
         WHERE excluded.updated_at > conversations.updated_at`,
        [
          c.id,
          c.title ?? '',
          c.model_id ?? '',
          c.system_prompt ?? null,
          c.pinned ? 1 : 0,
          c.thinking_level ?? null,
          c.last_viewed_message_id ?? null,
          c.created_at,
          c.updated_at,
        ]
      );
      if (res.rowsAffected > 0) convCount++;
    } catch {
      skipped++;
    }
  }

  for (const m of messages) {
    try {
      const res = await db.execute(
        `INSERT INTO messages
           (id, conversation_id, role, content, reasoning_content, status,
            token_count, input_tokens, output_tokens, model_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           content = excluded.content,
           reasoning_content = excluded.reasoning_content,
           status = excluded.status,
           token_count = excluded.token_count,
           input_tokens = excluded.input_tokens,
           output_tokens = excluded.output_tokens,
           model_id = excluded.model_id,
           updated_at = excluded.updated_at
         WHERE excluded.updated_at > messages.updated_at`,
        [
          m.id,
          m.conversation_id,
          m.role,
          m.content ?? '',
          m.reasoning_content ?? null,
          m.status || 'completed',
          m.token_count ?? null,
          m.input_tokens ?? null,
          m.output_tokens ?? null,
          m.model_id ?? null,
          m.created_at,
          m.updated_at,
        ]
      );
      if (res.rowsAffected > 0) msgCount++;
    } catch {
      skipped++;
    }
  }

  return { conversations: convCount, messages: msgCount, skipped };
}

/** 同步载荷中的模型配置行（桌面端导出） */
export interface SyncModelRow {
  id: string;
  provider: string;
  model_id: string;
  display_name: string;
  api_key: string;
  api_endpoint: string | null;
  temperature: number;
  max_tokens: number;
  top_p: number;
  thinking_level: string | null;
  supports_vision: number;
  is_default: number;
  created_at: number;
  updated_at: number;
}

export interface SyncSystemPromptRow {
  id: string;
  title: string;
  content: string;
  created_at: number;
  updated_at: number;
}

/**
 * 合并对端（桌面端）推送的模型配置：
 * 按 (provider, model_id) 自然键匹配（两端 id 独立生成），再按 LWW（updated_at）合并。
 */
export async function mergeSyncedModels(models: SyncModelRow[]): Promise<{ applied: number; skipped: number }> {
  const db = await getDb();
  let applied = 0;
  let skipped = 0;
  for (const m of models) {
    try {
      const existing = await db.select<{ id: string; updated_at: number }[]>(
        'SELECT id, updated_at FROM model_configs WHERE provider = ? AND model_id = ?',
        [m.provider, m.model_id]
      );
      const row = existing[0];
      if (row && row.updated_at >= m.updated_at) {
        skipped++;
        continue;
      }
      const targetId = row?.id ?? m.id;
      await db.execute(
        `INSERT INTO model_configs
           (id, provider, model_id, display_name, api_key, api_endpoint,
            temperature, max_tokens, top_p, thinking_level, supports_vision, is_default,
            created_at, updated_at)
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
           updated_at = excluded.updated_at
         WHERE excluded.updated_at > model_configs.updated_at`,
        [
          targetId,
          m.provider,
          m.model_id,
          m.display_name || m.model_id,
          m.api_key ?? '',
          m.api_endpoint ?? null,
          m.temperature ?? 0.6,
          m.max_tokens ?? 16384,
          m.top_p ?? 1.0,
          m.thinking_level ?? null,
          m.supports_vision ? 1 : 0,
          m.is_default ? 1 : 0,
          m.created_at ?? m.updated_at,
          m.updated_at,
        ]
      );
      applied++;
    } catch {
      skipped++;
    }
  }
  return { applied, skipped };
}

/** 合并对端（桌面端）推送的系统提示词预设：按 id + LWW（updated_at） */
export async function mergeSyncedSystemPrompts(
  prompts: SyncSystemPromptRow[]
): Promise<{ applied: number; skipped: number }> {
  const db = await getDb();
  let applied = 0;
  let skipped = 0;
  for (const p of prompts) {
    try {
      const res = await db.execute(
        `INSERT INTO system_prompts (id, title, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           content = excluded.content,
           updated_at = excluded.updated_at
         WHERE excluded.updated_at > system_prompts.updated_at`,
        [p.id, p.title ?? '', p.content ?? '', p.created_at, p.updated_at]
      );
      if (res.rowsAffected > 0) applied++;
    } catch {
      skipped++;
    }
  }
  return { applied, skipped };
}
