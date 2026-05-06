-- =============================================================================
-- Quick-Chat — SQLite 数据库表结构
-- =============================================================================
-- 设计原则:
--   1. 时间戳一律存储为 INTEGER（毫秒级 Unix Epoch），禁止 TEXT 格式的时间。
--   2. 主键使用 UUIDv4 TEXT，由应用层生成。
--   3. 通过 FTS5 虚拟表实现全文检索，使用触发器保持 FTS 索引与主表同步。
--   4. 所有 TEXT 字段默认 NOT NULL，可空字段显式标注。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 启用 WAL 模式（提升并发读写性能）
-- ---------------------------------------------------------------------------
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- =============================================================================
-- 1. 会话表 (conversations)
-- =============================================================================
CREATE TABLE IF NOT EXISTS conversations (
    -- 主键：UUIDv4
    id          TEXT    PRIMARY KEY NOT NULL,
    -- 会话标题
    title       TEXT    NOT NULL DEFAULT '',
    -- AI 模型标识符，如 "gemini-3-flash-preview"
    model_id    TEXT    NOT NULL,
    -- 系统提示词（可选）
    system_prompt TEXT  DEFAULT NULL,
    -- 创建时间（毫秒级 Unix 时间戳）
    created_at  INTEGER NOT NULL,
    -- 最后更新时间（毫秒级 Unix 时间戳）
    updated_at  INTEGER NOT NULL
);

-- 按更新时间降序索引（用于会话列表排序）
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
    ON conversations(updated_at DESC);

-- =============================================================================
-- 2. 消息表 (messages)
-- =============================================================================
CREATE TABLE IF NOT EXISTS messages (
    -- 主键：UUIDv4
    id              TEXT    PRIMARY KEY NOT NULL,
    -- 外键：所属会话
    conversation_id TEXT    NOT NULL
        REFERENCES conversations(id) ON DELETE CASCADE,
    -- 角色：'user' | 'assistant' | 'system'
    role            TEXT    NOT NULL
        CHECK (role IN ('user', 'assistant', 'system')),
    -- 消息内容（Markdown 文本）
    content         TEXT    NOT NULL DEFAULT '',
    -- 消息状态：'pending' | 'streaming' | 'completed' | 'error'
    status          TEXT    NOT NULL DEFAULT 'completed'
        CHECK (status IN ('pending', 'streaming', 'completed', 'error')),
    -- Token 用量（仅 assistant 消息有值）
    token_count     INTEGER DEFAULT NULL,
    -- 实际使用的模型标识（仅 assistant 消息有值）
    model_id        TEXT    DEFAULT NULL,
    -- 创建时间（毫秒级 Unix 时间戳）
    created_at      INTEGER NOT NULL,
    -- 最后更新时间（毫秒级 Unix 时间戳）
    updated_at      INTEGER NOT NULL
);

-- 按会话 + 创建时间索引（用于分页加载消息历史）
CREATE INDEX IF NOT EXISTS idx_messages_conversation_time
    ON messages(conversation_id, created_at ASC);

-- 按状态索引（用于查找未完成的流式消息）
CREATE INDEX IF NOT EXISTS idx_messages_status
    ON messages(status)
    WHERE status IN ('pending', 'streaming');

-- =============================================================================
-- 3. 全文检索虚拟表 (messages_fts) — 基于 FTS5
-- =============================================================================
-- FTS5 配置说明：
--   - content='messages'      → 内容表模式，引用 messages 主表
--   - content_rowid='rowid'   → 使用 messages 的隐式 rowid
--   - tokenize='unicode61 remove_diacritics 2'
--       → unicode61 分词器，支持中英文混合检索
--       → remove_diacritics=2 移除变音符号以提升匹配率
--   - 仅索引 content 列，减少索引体积
-- =============================================================================
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    content='messages',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
);

-- ---------------------------------------------------------------------------
-- FTS 同步触发器
-- ---------------------------------------------------------------------------
-- 注意：FTS5 content= 模式下，需要手动通过触发器同步数据。
-- INSERT 时插入 FTS 索引
CREATE TRIGGER IF NOT EXISTS trg_messages_fts_insert
    AFTER INSERT ON messages
BEGIN
    INSERT INTO messages_fts(rowid, content)
    VALUES (NEW.rowid, NEW.content);
END;

-- UPDATE 时先删除旧索引再插入新索引
CREATE TRIGGER IF NOT EXISTS trg_messages_fts_update
    AFTER UPDATE OF content ON messages
BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content)
    VALUES ('delete', OLD.rowid, OLD.content);
    INSERT INTO messages_fts(rowid, content)
    VALUES (NEW.rowid, NEW.content);
END;

-- DELETE 时删除 FTS 索引
CREATE TRIGGER IF NOT EXISTS trg_messages_fts_delete
    AFTER DELETE ON messages
BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content)
    VALUES ('delete', OLD.rowid, OLD.content);
END;

-- =============================================================================
-- 4. 模型配置表 (model_configs)
-- =============================================================================
CREATE TABLE IF NOT EXISTS model_configs (
    -- 主键：UUIDv4
    id            TEXT    PRIMARY KEY NOT NULL,
    -- AI 供应商：'google_gemini'
    provider      TEXT    NOT NULL
        CHECK (provider IN ('google_gemini')),
    -- 模型标识符
    model_id      TEXT    NOT NULL,
    -- 用户自定义显示名称
    display_name  TEXT    NOT NULL,
    -- API Key（应用层负责加密/解密）
    api_key       TEXT    NOT NULL,
    -- 自定义 API 端点（用于代理）
    api_endpoint  TEXT    DEFAULT NULL,
    -- 温度参数 (0.0 ~ 2.0)
    temperature   REAL    NOT NULL DEFAULT 1.0
        CHECK (temperature >= 0.0 AND temperature <= 2.0),
    -- 最大输出 Token 数
    max_tokens    INTEGER NOT NULL DEFAULT 4096
        CHECK (max_tokens > 0),
    -- Top-P 采样参数 (0.0 ~ 1.0)
    top_p         REAL    NOT NULL DEFAULT 0.95
        CHECK (top_p >= 0.0 AND top_p <= 1.0),
    -- 是否为默认模型（全局仅一个为 1）
    is_default    INTEGER NOT NULL DEFAULT 0
        CHECK (is_default IN (0, 1)),
    -- 创建时间（毫秒级 Unix 时间戳）
    created_at    INTEGER NOT NULL,
    -- 最后更新时间（毫秒级 Unix 时间戳）
    updated_at    INTEGER NOT NULL
);

-- 唯一约束：同一供应商 + 模型 ID 不可重复
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_configs_provider_model
    ON model_configs(provider, model_id);

-- =============================================================================
-- 5. 全文检索查询示例（供 Rust 端参考，非执行语句）
-- =============================================================================
--
-- 基础全文搜索（返回消息 + 会话标题 + 高亮片段 + 排名分数）：
--
--   SELECT
--       m.*,
--       c.title AS conversation_title,
--       snippet(messages_fts, 0, '<mark>', '</mark>', '...', 32) AS snippet,
--       rank
--   FROM messages_fts
--   JOIN messages m ON m.rowid = messages_fts.rowid
--   JOIN conversations c ON c.id = m.conversation_id
--   WHERE messages_fts MATCH ?1
--   ORDER BY rank
--   LIMIT ?2 OFFSET ?3;
--
-- 限定会话内搜索：
--
--   SELECT
--       m.*,
--       c.title AS conversation_title,
--       snippet(messages_fts, 0, '<mark>', '</mark>', '...', 32) AS snippet,
--       rank
--   FROM messages_fts
--   JOIN messages m ON m.rowid = messages_fts.rowid
--   JOIN conversations c ON c.id = m.conversation_id
--   WHERE messages_fts MATCH ?1
--     AND m.conversation_id = ?2
--   ORDER BY rank
--   LIMIT ?3 OFFSET ?4;
--
-- 获取会话摘要列表（含最后消息预览）：
--
--   SELECT
--       c.id,
--       c.title,
--       c.created_at,
--       COALESCE(last_msg.created_at, c.created_at) AS last_message_at,
--       COALESCE(SUBSTR(last_msg.content, 1, 120), '') AS last_message_preview,
--       COALESCE(msg_count.cnt, 0) AS message_count
--   FROM conversations c
--   LEFT JOIN (
--       SELECT conversation_id, content, created_at,
--              ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY created_at DESC) AS rn
--       FROM messages
--   ) last_msg ON last_msg.conversation_id = c.id AND last_msg.rn = 1
--   LEFT JOIN (
--       SELECT conversation_id, COUNT(*) AS cnt
--       FROM messages
--       GROUP BY conversation_id
--   ) msg_count ON msg_count.conversation_id = c.id
--   ORDER BY last_message_at DESC
--   LIMIT ?1 OFFSET ?2;
-- =============================================================================
