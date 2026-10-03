// =============================================================================
// Quick-Chat — 桌面端 LAN 同步服务（Electron 主进程）
// =============================================================================
// 逐条移植自旧 Rust sync_server 模块（axum → node:http，零新依赖）。
// 这是一个"哑"数据通道：
//   • 只做搬运 + last-write-wins（按 updated_at）合并；
//   • 不含任何 AI 调用逻辑（AI 由前端 ai.ts 直连 provider）；
//   • API Key 属于桌面端配置，仅在 桌面端 → 移动端 方向同步（LAN + token 鉴权）。
// 同步协议（数据方向）：
//   GET  /api/sync/health           连接测试
//   GET  /api/sync/export           桌面端 → 移动端：模型 / 系统提示词 / Skills / 对话历史（增量）
//   POST /api/sync/push             移动端 → 桌面端：对话历史（增量）
// 删除不传播（tombstone 同步留待后续；增量水位线保证已删除项不会被重新推送）。
//
// 与 Rust 版的关键差异：Rust 用独立 sqlx 连接池访问同一 SQLite 文件（WAL），
// Electron 版直接复用主进程唯一的 better-sqlite3 连接（同步驱动，天然串行）。
// =============================================================================

import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

import type Database from "better-sqlite3";

export const DEFAULT_PORT = 8975;

export interface SyncServerConfig {
  enabled: boolean;
  port: number;
}

export interface SyncInfo {
  enabled: boolean;
  running: boolean;
  port: number;
  token: string;
}

export interface SkillExport {
  id: string;
  content: string;
}

export interface SyncServerDeps {
  /** 共享的 better-sqlite3 连接（electron/db.ts 单例） */
  db: Database.Database;
  /** 配置/令牌持久化目录（app.getPath('userData')） */
  configDir: string;
  /** 向主窗口推送事件（quick-chat-sync-pushed 等） */
  emit: (name: string, payload?: unknown) => void;
  /** Skill 导出（electron/skills.ts 注入，避免相对依赖） */
  exportSkills: () => Promise<SkillExport[]>;
}

export interface SyncServer {
  info(): Promise<SyncInfo>;
  setConfig(enabled: boolean, port: number): Promise<SyncInfo>;
  regenerateToken(): Promise<SyncInfo>;
  shutdown(): Promise<void>;
  /** 实际绑定的端口（配置端口为 0 时用于取随机端口；未启动返回 null） */
  actualPort(): number | null;
}

function newToken(): string {
  // uuid v4 simple（无连字符 hex），对齐 Rust uuid::Uuid::new_v4().simple()
  return crypto.randomUUID().replaceAll("-", "");
}

function loadOrCreateToken(tokenPath: string): string {
  try {
    const existing = fs.readFileSync(tokenPath, "utf8").trim();
    if (existing.length > 0) {
      return existing;
    }
  } catch {
    // 无令牌文件：生成新的
  }
  const token = newToken();
  fs.writeFileSync(tokenPath, token);
  return token;
}

function loadConfig(configPath: string): SyncServerConfig {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      return {
        enabled: typeof obj.enabled === "boolean" ? obj.enabled : true,
        port: typeof obj.port === "number" && Number.isInteger(obj.port) ? obj.port : DEFAULT_PORT,
      };
    }
  } catch {
    // 读取/解析失败回退默认配置
  }
  return { enabled: true, port: DEFAULT_PORT };
}

function saveConfig(configPath: string, config: SyncServerConfig): void {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// ---------------------------------------------------------------------------
// Schema bootstrap（与 src/services/db.ts 保持一致；仅同步涉及的表与列）
// ---------------------------------------------------------------------------

function ensureColumn(db: Database.Database, table: string, column: string, ddl: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((r) => r.name === column)) {
    db.exec(ddl);
  }
}

function ensureModelMaxTokensNullable(db: Database.Database): void {
  const rows = db.prepare("PRAGMA table_info(model_configs)").all() as Array<{
    name: string;
    notnull: number;
  }>;
  const isOld = rows.some((r) => r.name === "max_tokens" && r.notnull === 1);
  if (!isOld) {
    return;
  }

  const statements = [
    `CREATE TABLE model_configs_new (
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
        supports_vision INTEGER NOT NULL DEFAULT 0,
        is_default    INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );`,
    `INSERT INTO model_configs_new
        (id, provider, model_id, display_name, api_key, api_endpoint,
         temperature, max_tokens, top_p, thinking_level, supports_vision, is_default,
         created_at, updated_at)
      SELECT id, provider, model_id, display_name, api_key, api_endpoint,
             temperature, NULL, top_p, thinking_level, supports_vision, is_default,
             created_at, updated_at
      FROM model_configs;`,
    "DROP TABLE model_configs;",
    "ALTER TABLE model_configs_new RENAME TO model_configs;",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_model_configs_provider_model ON model_configs(provider, model_id);",
  ];
  for (const statement of statements) {
    db.exec(statement);
  }
  console.log("[quick-chat] sync server migrated model_configs.max_tokens to nullable/unlimited");
}

function ensureSchema(db: Database.Database): void {
  const statements = [
    `CREATE TABLE IF NOT EXISTS conversations (
        id          TEXT    PRIMARY KEY NOT NULL,
        title       TEXT    NOT NULL DEFAULT '',
        model_id    TEXT    NOT NULL,
        system_prompt TEXT  DEFAULT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );`,
    `CREATE TABLE IF NOT EXISTS messages (
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
      );`,
    "CREATE INDEX IF NOT EXISTS idx_messages_conversation_time ON messages(conversation_id, created_at ASC);",
    `CREATE TABLE IF NOT EXISTS system_prompts (
        id          TEXT    PRIMARY KEY NOT NULL,
        title       TEXT    NOT NULL,
        content     TEXT    NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );`,
    `CREATE TABLE IF NOT EXISTS model_configs (
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
        supports_vision INTEGER NOT NULL DEFAULT 0,
        is_default    INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );`,
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_model_configs_provider_model ON model_configs(provider, model_id);",
  ];
  for (const statement of statements) {
    db.exec(statement);
  }

  ensureColumn(db, "conversations", "pinned", "ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "conversations", "thinking_level", "ALTER TABLE conversations ADD COLUMN thinking_level TEXT DEFAULT NULL");
  ensureColumn(db, "conversations", "last_viewed_message_id", "ALTER TABLE conversations ADD COLUMN last_viewed_message_id TEXT DEFAULT NULL");
  ensureColumn(db, "messages", "reasoning_content", "ALTER TABLE messages ADD COLUMN reasoning_content TEXT DEFAULT NULL");
  ensureColumn(db, "messages", "thinking_ms", "ALTER TABLE messages ADD COLUMN thinking_ms INTEGER DEFAULT NULL");
  ensureColumn(db, "messages", "token_count", "ALTER TABLE messages ADD COLUMN token_count INTEGER DEFAULT NULL");
  ensureColumn(db, "messages", "input_tokens", "ALTER TABLE messages ADD COLUMN input_tokens INTEGER DEFAULT NULL");
  ensureColumn(db, "messages", "output_tokens", "ALTER TABLE messages ADD COLUMN output_tokens INTEGER DEFAULT NULL");
  ensureColumn(db, "messages", "model_id", "ALTER TABLE messages ADD COLUMN model_id TEXT DEFAULT NULL");

  ensureModelMaxTokensNullable(db);
}

// ---------------------------------------------------------------------------
// JSON 字段访问器（缺字段 / null / 类型不符一律回退默认值）
// ---------------------------------------------------------------------------

function jstr(v: Record<string, unknown>, k: string): string | undefined {
  const value = v[k];
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

function jstrNull(v: Record<string, unknown>, k: string): string | null {
  const value = v[k];
  if (value === null || value === undefined) {
    return null;
  }
  return jstr(v, k) ?? null;
}

function ji64(v: Record<string, unknown>, k: string): number | undefined {
  const value = v[k];
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  return undefined;
}

function ji64Null(v: Record<string, unknown>, k: string): number | null {
  const value = v[k];
  if (value === null || value === undefined) {
    return null;
  }
  return ji64(v, k) ?? null;
}

// ---------------------------------------------------------------------------
// LWW 合并：仅当传入记录的 updated_at 更新时才写入，返回是否实际写入
// ---------------------------------------------------------------------------

const UPSERT_CONVERSATION_SQL = `INSERT INTO conversations
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
  WHERE excluded.updated_at > conversations.updated_at`;

const UPSERT_MESSAGE_SQL = `INSERT INTO messages
    (id, conversation_id, role, content, reasoning_content, thinking_ms, status,
     token_count, input_tokens, output_tokens, model_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    content = excluded.content,
    reasoning_content = excluded.reasoning_content,
    thinking_ms = excluded.thinking_ms,
    status = excluded.status,
    token_count = excluded.token_count,
    input_tokens = excluded.input_tokens,
    output_tokens = excluded.output_tokens,
    model_id = excluded.model_id,
    updated_at = excluded.updated_at
  WHERE excluded.updated_at > messages.updated_at`;

function upsertConversation(db: Database.Database, v: Record<string, unknown>): boolean {
  const id = jstr(v, "id");
  const createdAt = ji64(v, "created_at");
  const updatedAt = ji64(v, "updated_at");
  if (id === undefined || createdAt === undefined || updatedAt === undefined) {
    return false;
  }
  const result = db
    .prepare(UPSERT_CONVERSATION_SQL)
    .run(
      id,
      jstr(v, "title") ?? "",
      jstr(v, "model_id") ?? "",
      jstrNull(v, "system_prompt"),
      ji64(v, "pinned") ?? 0,
      jstrNull(v, "thinking_level"),
      jstrNull(v, "last_viewed_message_id"),
      createdAt,
      updatedAt,
    );
  return result.changes > 0;
}

function upsertMessage(db: Database.Database, v: Record<string, unknown>): boolean {
  const id = jstr(v, "id");
  const conversationId = jstr(v, "conversation_id");
  const createdAt = ji64(v, "created_at");
  const updatedAt = ji64(v, "updated_at");
  if (id === undefined || conversationId === undefined || createdAt === undefined || updatedAt === undefined) {
    return false;
  }
  const result = db
    .prepare(UPSERT_MESSAGE_SQL)
    .run(
      id,
      conversationId,
      jstr(v, "role") ?? "user",
      jstr(v, "content") ?? "",
      jstrNull(v, "reasoning_content"),
      ji64Null(v, "thinking_ms"),
      jstr(v, "status") ?? "completed",
      ji64Null(v, "token_count"),
      ji64Null(v, "input_tokens"),
      ji64Null(v, "output_tokens"),
      jstrNull(v, "model_id"),
      createdAt,
      updatedAt,
    );
  return result.changes > 0;
}

function nowMillis(): number {
  return Date.now();
}

// ---------------------------------------------------------------------------
// 服务器实现
// ---------------------------------------------------------------------------

function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(payload);
}

export function createSyncServer(deps: SyncServerDeps): SyncServer {
  const { db, configDir, emit, exportSkills } = deps;
  fs.mkdirSync(configDir, { recursive: true });
  ensureSchema(db);

  const tokenPath = path.join(configDir, "sync_token");
  const configPath = path.join(configDir, "sync_config.json");
  let token = loadOrCreateToken(tokenPath);
  let config = loadConfig(configPath);
  let httpServer: http.Server | null = null;

  function info(): SyncInfo {
    return {
      enabled: config.enabled,
      running: httpServer !== null,
      port: config.port,
      token,
    };
  }

  async function start(): Promise<void> {
    if (httpServer !== null) {
      return;
    }
    const server = http.createServer((req, res) => {
      try {
        handleRequest(req, res);
      } catch (e) {
        jsonResponse(res, 500, { error: (e as Error).message });
      }
    });
    // 同步占位（对齐 Rust：spawn 后立即视为 running）；绑定失败时清除并抛错
    httpServer = server;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, "0.0.0.0", () => {
          server.removeListener("error", reject);
          const address = server.address();
          const actual = typeof address === "object" && address ? address.port : config.port;
          console.log(`[quick-chat] sync server listening on 0.0.0.0:${actual}`);
          resolve();
        });
      });
    } catch (e) {
      httpServer = null;
      throw new Error(`绑定端口 ${config.port} 失败: ${(e as Error).message}`);
    }
  }

  async function stop(): Promise<void> {
    const server = httpServer;
    httpServer = null;
    if (!server) {
      return;
    }
    // listen 尚未完成时先等其落定（成功或失败），否则 close 会拿到
    // ERR_SERVER_NOT_RUNNING 而句柄泄漏
    if (!server.listening) {
      await new Promise<void>((resolve) => {
        server.once("listening", resolve);
        server.once("error", resolve);
        setTimeout(resolve, 1000).unref();
      });
    }
    if (!server.listening) {
      return;
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // 主动断开 keep-alive 连接，让 close 回调尽快触发；兜底 500ms 不等
      server.closeAllConnections?.();
      setTimeout(resolve, 500).unref();
    });
  }

  function isAuthorized(req: http.IncomingMessage): boolean {
    const header = req.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      return false;
    }
    return header.slice("Bearer ".length).trim() === token;
  }

  function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 64 * 1024 * 1024) {
          reject(new Error("请求体过大"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS 中间件挂最外层——浏览器/WebView 的预检 OPTIONS 请求不携带
    // Authorization，在这里直接短路返回，不能进入鉴权层。
    if (req.method === "OPTIONS") {
      jsonResponse(res, 200, {});
      return;
    }

    if (!isAuthorized(req)) {
      jsonResponse(res, 401, { error: "未授权：Token 无效或缺失" });
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/api/sync/health" && req.method === "GET") {
      jsonResponse(res, 200, { ok: true, app: "quick-chat", role: "sync-server" });
      return;
    }

    if (url.pathname === "/api/sync/export" && req.method === "GET") {
      const sinceParam = url.searchParams.get("since");
      const since = sinceParam !== null && /^\d+$/.test(sinceParam) ? Number(sinceParam) : 0;

      // 会话：本身有更新，或包含更新的消息（移动端合并消息需要父会话存在）
      const convRows = db
        .prepare(
          `SELECT id, title, model_id, system_prompt, pinned, thinking_level,
                  last_viewed_message_id, created_at, updated_at
           FROM conversations
           WHERE updated_at > ?
              OR id IN (SELECT DISTINCT conversation_id FROM messages WHERE updated_at > ?)
           ORDER BY created_at ASC`,
        )
        .all(since, since);
      // 新建会话（created_at > since）需要携带其全部消息，否则移动端得到残缺会话
      const msgRows = db
        .prepare(
          `SELECT id, conversation_id, role, content, reasoning_content, thinking_ms, status,
                  token_count, input_tokens, output_tokens, model_id, created_at, updated_at
           FROM messages
           WHERE updated_at > ?
              OR conversation_id IN (SELECT id FROM conversations WHERE created_at > ?)
           ORDER BY created_at ASC`,
        )
        .all(since, since);
      // 配置类全量导出（模型 / 系统提示词按 LWW 合并，Skills 按内容覆盖）
      const modelRows = db
        .prepare(
          `SELECT id, provider, model_id, display_name, api_key, api_endpoint,
                  temperature, max_tokens, top_p, thinking_level, supports_vision,
                  is_default, created_at, updated_at
           FROM model_configs ORDER BY created_at ASC`,
        )
        .all();
      const promptRows = db
        .prepare("SELECT id, title, content, created_at, updated_at FROM system_prompts ORDER BY updated_at ASC")
        .all();
      const skills = await exportSkills().catch(() => [] as SkillExport[]);

      jsonResponse(res, 200, {
        generated_at: nowMillis(),
        conversations: convRows,
        messages: msgRows,
        models: modelRows,
        system_prompts: promptRows,
        skills,
      });
      return;
    }

    if (url.pathname === "/api/sync/push" && req.method === "POST") {
      const raw = await readBody(req);
      let body: { conversations?: unknown; messages?: unknown };
      try {
        body = JSON.parse(raw);
      } catch {
        jsonResponse(res, 400, { error: "请求体不是合法 JSON" });
        return;
      }

      let stats = { conversations: 0, messages: 0, skipped: 0 };
      const convs = Array.isArray(body.conversations) ? body.conversations : [];
      const msgs = Array.isArray(body.messages) ? body.messages : [];
      for (const conv of convs) {
        if (conv && typeof conv === "object" && upsertConversation(db, conv as Record<string, unknown>)) {
          stats.conversations += 1;
        } else {
          stats.skipped += 1;
        }
      }
      for (const msg of msgs) {
        if (msg && typeof msg === "object" && upsertMessage(db, msg as Record<string, unknown>)) {
          stats.messages += 1;
        } else {
          stats.skipped += 1;
        }
      }

      // 通知桌面端前端刷新内存状态（否则新会话要重启应用才能看到）
      const applied = stats.conversations + stats.messages;
      if (applied > 0) {
        emit("quick-chat-sync-pushed", applied);
      }

      jsonResponse(res, 200, { ok: true, stats });
      return;
    }

    res.writeHead(404, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    });
    res.end();
  }

  const server: SyncServer = {
    info: async () => info(),

    setConfig: async (enabled: boolean, port: number) => {
      config = { enabled, port };
      saveConfig(configPath, config);
      await stop();
      if (enabled) {
        await start();
      }
      return info();
    },

    regenerateToken: async () => {
      token = newToken();
      fs.writeFileSync(tokenPath, token);
      return info();
    },

    shutdown: async () => {
      await stop();
    },

    actualPort: () => {
      const address = httpServer?.address();
      return typeof address === "object" && address ? address.port : null;
    },
  };

  // app ready 后按配置启动
  if (config.enabled) {
    start().catch((e) => {
      console.error(`[quick-chat] sync server start failed: ${(e as Error).message}`);
    });
  }

  return server;
}
