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

export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;
  dbInstance = await Database.load('sqlite:quick_chat.db');
  return dbInstance;
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

  // FTS5 全文检索
  await db.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      content='messages',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );
  `);

  // FTS 同步触发器
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
      temperature   REAL    NOT NULL DEFAULT 1.0 CHECK (temperature >= 0.0 AND temperature <= 2.0),
      max_tokens    INTEGER NOT NULL DEFAULT 4096 CHECK (max_tokens > 0),
      top_p         REAL    NOT NULL DEFAULT 0.95 CHECK (top_p >= 0.0 AND top_p <= 1.0),
      is_default    INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
  `);
  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_model_configs_provider_model
      ON model_configs(provider, model_id);
  `);
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

    if (!colNames.has('agent_url')) {
      await db.execute('ALTER TABLE conversations ADD COLUMN agent_url TEXT DEFAULT NULL;');
      console.log('[DB] Added column: agent_url');
    }
  } catch (e) {
    console.error('[DB] ensureConversationColumns failed:', e);
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
    is_default: number;
    created_at: number;
    updated_at: number;
  }[]>('SELECT * FROM model_configs ORDER BY created_at ASC');

  return rows.map(r => ({
    id: r.id,
    provider: r.provider as ModelConfig['provider'],
    model_id: r.model_id,
    display_name: r.display_name,
    api_key: r.api_key,
    api_endpoint: r.api_endpoint,
    temperature: r.temperature,
    max_tokens: r.max_tokens,
    top_p: r.top_p,
    thinking_level: r.model_id.includes('gemini-3') ? 'MEDIUM' as const : null,
    is_default: Boolean(r.is_default),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export async function saveModelConfig(config: ModelConfig): Promise<void> {
  const db = await getDb();
  if (config.is_default) {
    await db.execute('UPDATE model_configs SET is_default = 0');
  }
  await db.execute(
    `INSERT INTO model_configs (id, provider, model_id, display_name, api_key, api_endpoint, temperature, max_tokens, top_p, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider = excluded.provider,
       model_id = excluded.model_id,
       display_name = excluded.display_name,
       api_key = excluded.api_key,
       api_endpoint = excluded.api_endpoint,
       temperature = excluded.temperature,
       max_tokens = excluded.max_tokens,
       top_p = excluded.top_p,
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
    'INSERT INTO conversations (id, title, model_id, system_prompt, agent_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [conv.id, conv.title, conv.model_id, conv.system_prompt, conv.agent_url ?? null, conv.created_at, conv.updated_at]
  );
}

export async function getConversation(id: UUID): Promise<Conversation | null> {
  const db = await getDb();
  const rows = await db.select<Conversation[]>('SELECT * FROM conversations WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function updateConversation(
  id: UUID,
  updates: Partial<Pick<Conversation, 'title' | 'model_id' | 'system_prompt' | 'agent_url' | 'updated_at'>>
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  if (updates.title !== undefined) { sets.push('title = ?'); vals.push(updates.title); }
  if (updates.model_id !== undefined) { sets.push('model_id = ?'); vals.push(updates.model_id); }
  if (updates.system_prompt !== undefined) { sets.push('system_prompt = ?'); vals.push(updates.system_prompt); }
  if (updates.agent_url !== undefined) { sets.push('agent_url = ?'); vals.push(updates.agent_url); }
  sets.push('updated_at = ?');
  vals.push(updates.updated_at ?? Date.now());
  vals.push(id);

  await db.execute(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`, vals);
}

export async function deleteConversation(id: UUID): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM conversations WHERE id = ?', [id]);
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
    agent_url: string | null;
  }[]>(
    `SELECT
      c.id,
      c.title,
      c.created_at,
      c.agent_url,
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
    ORDER BY last_message_at DESC
    LIMIT ? OFFSET ?`,
    [limit, offset]
  );

  return rows.map(r => ({
    id: r.id,
    title: r.title,
    created_at: r.created_at,
    last_message_at: r.last_message_at ?? r.created_at,
    last_message_preview: r.last_message_preview ?? '',
    message_count: r.message_count,
    agent_url: r.agent_url,
  }));
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
      'SELECT * FROM messages WHERE conversation_id = ? AND created_at < ? ORDER BY created_at ASC LIMIT ?',
      [conversationId, beforeTimestamp, limit]
    );
  }
  return db.select<Message[]>(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?',
    [conversationId, limit]
  );
}

export async function deleteMessage(id: UUID): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM messages WHERE id = ?', [id]);
}

export async function searchMessages(
  query: string,
  conversationId: UUID | null = null,
  limit = 50,
  offset = 0
): Promise<Array<{ message: Message; conversation_title: string; snippet: string; rank: number }>> {
  const db = await getDb();
  const likeQuery = query
    .trim()
    .split(/\s+/)
    .map(w => `"${w.replace(/"/g, '""')}"`)
    .join(' ');

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
          m.temperature ?? 0.7,
          m.max_tokens ?? 4096,
          m.top_p ?? 0.95,
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
