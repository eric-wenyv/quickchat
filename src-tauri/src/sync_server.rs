// src-tauri/src/sync_server.rs
//
// 桌面端同步服务：移动端（同一产品的 Tauri Android 壳）通过局域网
// 推送/拉取数据。这是一个"哑"数据通道：
//   • 只做搬运 + last-write-wins（按 updated_at）合并；
//   • 不含任何 AI 调用逻辑（AI 由前端 ai.ts 直连 provider）；
//   • API Key 属于桌面端配置，仅在 桌面端 → 移动端 方向同步（LAN + token 鉴权）。
// 同步协议（数据方向）：
//   GET  /api/sync/health           连接测试
//   GET  /api/sync/export           桌面端 → 移动端：模型 / 系统提示词 / Skills / 对话历史（增量）
//   POST /api/sync/push             移动端 → 桌面端：对话历史（增量）
// 删除不传播（tombstone 同步留待后续；增量水位线保证已删除项不会被重新推送）。

use axum::extract::{Request, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::{get, post};
use axum::Router;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Emitter;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::Row;
use sqlx::SqlitePool;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

pub const DEFAULT_PORT: u16 = 8975;

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncServerConfig {
    pub enabled: bool,
    pub port: u16,
}

#[derive(Serialize, Clone)]
pub struct SyncInfo {
    pub enabled: bool,
    pub running: bool,
    pub port: u16,
    pub token: String,
}

pub struct SyncServer {
    pub db: SqlitePool,
    pub app: tauri::AppHandle,
    token: RwLock<String>,
    config_path: PathBuf,
    token_path: PathBuf,
    config: RwLock<SyncServerConfig>,
    task: RwLock<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl SyncServer {
    pub async fn info(&self) -> SyncInfo {
        let config = self.config.read().await.clone();
        SyncInfo {
            enabled: config.enabled,
            running: self.task.read().await.is_some(),
            port: config.port,
            token: self.token.read().await.clone(),
        }
    }

    pub async fn set_config(self: &Arc<Self>, enabled: bool, port: u16) -> Result<SyncInfo, String> {
        {
            let mut guard = self.config.write().await;
            *guard = SyncServerConfig { enabled, port };
            save_config(&self.config_path, &guard)?;
        }
        self.stop().await;
        if enabled {
            self.start().await?;
        }
        Ok(self.info().await)
    }

    pub async fn regenerate_token(&self) -> Result<SyncInfo, String> {
        let token = new_token();
        std::fs::write(&self.token_path, &token).map_err(|e| format!("写入 Token 失败: {e}"))?;
        *self.token.write().await = token;
        Ok(self.info().await)
    }

    async fn start(self: &Arc<Self>) -> Result<(), String> {
        let mut guard = self.task.write().await;
        if guard.is_some() {
            return Ok(());
        }
        let port = self.config.read().await.port;
        let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
            .await
            .map_err(|e| format!("绑定端口 {port} 失败: {e}"))?;
        let app = build_router(self.clone());
        let handle = tauri::async_runtime::spawn(async move {
            if let Err(e) = axum::serve(listener, app).await {
                eprintln!("[quick-chat] sync server error: {e}");
            }
        });
        *guard = Some(handle);
        eprintln!("[quick-chat] sync server listening on 0.0.0.0:{port}");
        Ok(())
    }

    async fn stop(&self) {
        if let Some(handle) = self.task.write().await.take() {
            handle.abort();
        }
    }
}

fn new_token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

fn load_or_create_token(path: &PathBuf) -> Result<String, String> {
    if let Ok(existing) = std::fs::read_to_string(path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    let token = new_token();
    std::fs::write(path, &token).map_err(|e| format!("写入 Token 失败: {e}"))?;
    Ok(token)
}

fn load_config(path: &PathBuf) -> SyncServerConfig {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(SyncServerConfig { enabled: true, port: DEFAULT_PORT })
}

fn save_config(path: &PathBuf, config: &SyncServerConfig) -> Result<(), String> {
    let body = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(path, body).map_err(|e| format!("写入同步配置失败: {e}"))
}

pub async fn init(
    app_config_dir: PathBuf,
    db_file: &str,
    app: tauri::AppHandle,
) -> Result<Arc<SyncServer>, String> {
    std::fs::create_dir_all(&app_config_dir).map_err(|e| e.to_string())?;

    // 与前端 plugin-sql 共享同一个 SQLite 文件（WAL 支持多连接并发）
    let db_path = app_config_dir.join(db_file);
    let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", db_path.display()))
        .map_err(|e| format!("无效的数据库路径: {e}"))?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(10));
    let db = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await
        .map_err(|e| format!("打开数据库失败: {e}"))?;

    ensure_schema(&db).await?;

    let token_path = app_config_dir.join("sync_token");
    let config_path = app_config_dir.join("sync_config.json");
    let token = load_or_create_token(&token_path)?;
    let config = load_config(&config_path);

    let server = Arc::new(SyncServer {
        db,
        app,
        token: RwLock::new(token),
        config_path,
        token_path,
        config: RwLock::new(config),
        task: RwLock::new(None),
    });

    if server.config.read().await.enabled {
        if let Err(e) = server.start().await {
            eprintln!("[quick-chat] sync server start failed: {e}");
        }
    }

    Ok(server)
}

// ---------------------------------------------------------------------------
// Schema bootstrap（与 src/services/db.ts 保持一致；仅同步涉及的表与列）
// ---------------------------------------------------------------------------

async fn ensure_column(db: &SqlitePool, table: &str, column: &str, ddl: &str) -> Result<(), String> {
    let rows = sqlx::query(&format!("PRAGMA table_info({table})"))
        .fetch_all(db)
        .await
        .map_err(|e| e.to_string())?;
    let exists = rows.iter().any(|r| r.get::<String, _>("name") == column);
    if !exists {
        sqlx::query(ddl).execute(db).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

async fn ensure_schema(db: &SqlitePool) -> Result<(), String> {
    let statements = [
        "CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            model_id TEXT NOT NULL,
            system_prompt TEXT DEFAULT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );",
        "CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY NOT NULL,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
            content TEXT NOT NULL DEFAULT '',
            reasoning_content TEXT DEFAULT NULL,
            thinking_ms INTEGER DEFAULT NULL,
            status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'streaming', 'completed', 'error')),
            token_count INTEGER DEFAULT NULL,
            input_tokens INTEGER DEFAULT NULL,
            output_tokens INTEGER DEFAULT NULL,
            model_id TEXT DEFAULT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );",
        "CREATE INDEX IF NOT EXISTS idx_messages_conversation_time ON messages(conversation_id, created_at ASC);",
        "CREATE TABLE IF NOT EXISTS system_prompts (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );",
        "CREATE TABLE IF NOT EXISTS model_configs (
            id TEXT PRIMARY KEY NOT NULL,
            provider TEXT NOT NULL CHECK (provider IN ('google_gemini', 'openrouter', 'openai_compatible')),
            model_id TEXT NOT NULL,
            display_name TEXT NOT NULL,
            api_key TEXT NOT NULL,
            api_endpoint TEXT DEFAULT NULL,
            temperature REAL NOT NULL DEFAULT 0.6,
            max_tokens INTEGER NOT NULL DEFAULT 16384,
            top_p REAL NOT NULL DEFAULT 1.0,
            thinking_level TEXT DEFAULT NULL,
            supports_vision INTEGER NOT NULL DEFAULT 0,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_model_configs_provider_model ON model_configs(provider, model_id);",
    ];
    for statement in statements {
        sqlx::query(statement)
            .execute(db)
            .await
            .map_err(|e| format!("初始化同步数据库结构失败: {e}"))?;
    }

    ensure_column(
        db,
        "conversations",
        "pinned",
        "ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
    )
    .await?;
    ensure_column(
        db,
        "conversations",
        "thinking_level",
        "ALTER TABLE conversations ADD COLUMN thinking_level TEXT DEFAULT NULL",
    )
    .await?;
    ensure_column(
        db,
        "conversations",
        "last_viewed_message_id",
        "ALTER TABLE conversations ADD COLUMN last_viewed_message_id TEXT DEFAULT NULL",
    )
    .await?;
    ensure_column(
        db,
        "messages",
        "reasoning_content",
        "ALTER TABLE messages ADD COLUMN reasoning_content TEXT DEFAULT NULL",
    )
    .await?;
    ensure_column(
        db,
        "messages",
        "thinking_ms",
        "ALTER TABLE messages ADD COLUMN thinking_ms INTEGER DEFAULT NULL",
    )
    .await?;
    ensure_column(
        db,
        "messages",
        "token_count",
        "ALTER TABLE messages ADD COLUMN token_count INTEGER DEFAULT NULL",
    )
    .await?;
    ensure_column(
        db,
        "messages",
        "input_tokens",
        "ALTER TABLE messages ADD COLUMN input_tokens INTEGER DEFAULT NULL",
    )
    .await?;
    ensure_column(
        db,
        "messages",
        "output_tokens",
        "ALTER TABLE messages ADD COLUMN output_tokens INTEGER DEFAULT NULL",
    )
    .await?;
    ensure_column(
        db,
        "messages",
        "model_id",
        "ALTER TABLE messages ADD COLUMN model_id TEXT DEFAULT NULL",
    )
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Router & middleware
// ---------------------------------------------------------------------------

fn build_router(server: Arc<SyncServer>) -> Router {
    let api = Router::new()
        .route("/sync/health", get(health))
        .route("/sync/export", get(export_sync))
        .route("/sync/push", post(push_sync))
        .route_layer(middleware::from_fn_with_state(server.clone(), auth_middleware))
        .with_state(server);

    // 客户端契约：/api/sync/*。CORS 中间件挂最外层——浏览器/WebView 的预检
    // OPTIONS 请求不携带 Authorization，在这里直接短路返回，不能进入鉴权层。
    Router::new()
        .nest("/api", api)
        .layer(middleware::from_fn(cors_middleware))
}

async fn cors_middleware(req: Request, next: Next) -> Response {
    let is_preflight = req.method() == axum::http::Method::OPTIONS;
    let mut res = if is_preflight {
        StatusCode::OK.into_response()
    } else {
        next.run(req).await
    };
    let headers = res.headers_mut();
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Authorization, Content-Type"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    res
}

async fn auth_middleware(
    State(server): State<Arc<SyncServer>>,
    req: Request,
    next: Next,
) -> Response {
    let expected = server.token.read().await.clone();
    let authorized = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|t| t.trim() == expected)
        .unwrap_or(false);
    if !authorized {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "未授权：Token 无效或缺失" })),
        )
            .into_response();
    }
    next.run(req).await
}

fn err(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(json!({ "error": message.into() }))).into_response()
}

// ---------------------------------------------------------------------------
// GET /api/sync/export — 桌面端 → 移动端：对话历史（增量）
// ---------------------------------------------------------------------------

async fn health() -> impl IntoResponse {
    Json(json!({ "ok": true, "app": "quick-chat", "role": "sync-server" }))
}

#[derive(Deserialize)]
struct ExportQuery {
    since: Option<i64>,
}

fn conversation_from_row(row: &sqlx::sqlite::SqliteRow) -> Value {
    json!({
        "id": row.get::<String, _>("id"),
        "title": row.get::<String, _>("title"),
        "model_id": row.get::<String, _>("model_id"),
        "system_prompt": row.get::<Option<String>, _>("system_prompt"),
        "pinned": row.get::<i64, _>("pinned"),
        "thinking_level": row.get::<Option<String>, _>("thinking_level"),
        "last_viewed_message_id": row.get::<Option<String>, _>("last_viewed_message_id"),
        "created_at": row.get::<i64, _>("created_at"),
        "updated_at": row.get::<i64, _>("updated_at"),
    })
}

fn message_from_row(row: &sqlx::sqlite::SqliteRow) -> Value {
    json!({
        "id": row.get::<String, _>("id"),
        "conversation_id": row.get::<String, _>("conversation_id"),
        "role": row.get::<String, _>("role"),
        "content": row.get::<String, _>("content"),
        "reasoning_content": row.get::<Option<String>, _>("reasoning_content"),
        "thinking_ms": row.get::<Option<i64>, _>("thinking_ms"),
        "status": row.get::<String, _>("status"),
        "token_count": row.get::<Option<i64>, _>("token_count"),
        "input_tokens": row.get::<Option<i64>, _>("input_tokens"),
        "output_tokens": row.get::<Option<i64>, _>("output_tokens"),
        "model_id": row.get::<Option<String>, _>("model_id"),
        "created_at": row.get::<i64, _>("created_at"),
        "updated_at": row.get::<i64, _>("updated_at"),
    })
}

fn model_from_row(row: &sqlx::sqlite::SqliteRow) -> Value {
    json!({
        "id": row.get::<String, _>("id"),
        "provider": row.get::<String, _>("provider"),
        "model_id": row.get::<String, _>("model_id"),
        "display_name": row.get::<String, _>("display_name"),
        "api_key": row.get::<String, _>("api_key"),
        "api_endpoint": row.get::<Option<String>, _>("api_endpoint"),
        "temperature": row.get::<f64, _>("temperature"),
        "max_tokens": row.get::<i64, _>("max_tokens"),
        "top_p": row.get::<f64, _>("top_p"),
        "thinking_level": row.get::<Option<String>, _>("thinking_level"),
        "supports_vision": row.get::<i64, _>("supports_vision"),
        "is_default": row.get::<i64, _>("is_default"),
        "created_at": row.get::<i64, _>("created_at"),
        "updated_at": row.get::<i64, _>("updated_at"),
    })
}

fn prompt_from_row(row: &sqlx::sqlite::SqliteRow) -> Value {
    json!({
        "id": row.get::<String, _>("id"),
        "title": row.get::<String, _>("title"),
        "content": row.get::<String, _>("content"),
        "created_at": row.get::<i64, _>("created_at"),
        "updated_at": row.get::<i64, _>("updated_at"),
    })
}

async fn export_sync(
    State(server): State<Arc<SyncServer>>,
    axum::extract::Query(query): axum::extract::Query<ExportQuery>,
) -> Response {
    let since = query.since.unwrap_or(0);

    // 会话：本身有更新，或包含更新的消息（移动端合并消息需要父会话存在）
    let conv_rows = match sqlx::query(
        "SELECT * FROM conversations
         WHERE updated_at > ?1
            OR id IN (SELECT DISTINCT conversation_id FROM messages WHERE updated_at > ?1)
         ORDER BY created_at ASC",
    )
    .bind(since)
    .fetch_all(&server.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    };

    // 新建会话（created_at > since）需要携带其全部消息，否则移动端得到残缺会话
    let msg_rows = match sqlx::query(
        "SELECT * FROM messages
         WHERE updated_at > ?1
            OR conversation_id IN (SELECT id FROM conversations WHERE created_at > ?1)
         ORDER BY created_at ASC",
    )
    .bind(since)
    .fetch_all(&server.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    };

    // 配置类全量导出（模型 / 系统提示词按 LWW 合并，Skills 按内容覆盖）
    let model_rows = match sqlx::query("SELECT * FROM model_configs ORDER BY created_at ASC")
        .fetch_all(&server.db)
        .await
    {
        Ok(rows) => rows,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    };
    let prompt_rows = match sqlx::query("SELECT * FROM system_prompts ORDER BY updated_at ASC")
        .fetch_all(&server.db)
        .await
    {
        Ok(rows) => rows,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    };

    let skills = crate::skills::export_skills_for_sync(&server.app).unwrap_or_default();

    let convs: Vec<Value> = conv_rows.iter().map(conversation_from_row).collect();
    let msgs: Vec<Value> = msg_rows.iter().map(message_from_row).collect();
    let models: Vec<Value> = model_rows.iter().map(model_from_row).collect();
    let prompts: Vec<Value> = prompt_rows.iter().map(prompt_from_row).collect();

    Json(json!({
        "generated_at": now_millis(),
        "conversations": convs,
        "messages": msgs,
        "models": models,
        "system_prompts": prompts,
        "skills": skills,
    }))
    .into_response()
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// POST /api/sync/push — 移动端 → 桌面端：对话历史（增量）
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct SyncPushBody {
    #[serde(default)]
    conversations: Vec<Value>,
    #[serde(default)]
    messages: Vec<Value>,
}

#[derive(Default)]
struct SyncStats {
    conversations: i64,
    messages: i64,
    skipped: i64,
}

async fn push_sync(
    State(server): State<Arc<SyncServer>>,
    Json(body): Json<SyncPushBody>,
) -> Response {
    let mut stats = SyncStats::default();

    for conv in &body.conversations {
        match upsert_conversation(&server.db, conv).await {
            Ok(true) => stats.conversations += 1,
            _ => stats.skipped += 1,
        }
    }

    for msg in &body.messages {
        match upsert_message(&server.db, msg).await {
            Ok(true) => stats.messages += 1,
            _ => stats.skipped += 1,
        }
    }

    // 通知桌面端前端刷新内存状态（否则新会话要重启应用才能看到）
    let applied = stats.conversations + stats.messages;
    if applied > 0 {
        let _ = server.app.emit("quick-chat-sync-pushed", applied);
    }

    Json(json!({
        "ok": true,
        "stats": {
            "conversations": stats.conversations,
            "messages": stats.messages,
            "skipped": stats.skipped,
        }
    }))
    .into_response()
}

// ---- JSON 字段访问器（缺字段 / null / 类型不符一律回退默认值）----

fn jstr(v: &Value, k: &str) -> Option<String> {
    match v.get(k) {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

fn jstr_null(v: &Value, k: &str) -> Option<String> {
    match v.get(k) {
        Some(Value::Null) | None => None,
        _ => jstr(v, k),
    }
}

fn ji64(v: &Value, k: &str) -> Option<i64> {
    v.get(k).and_then(|x| x.as_i64())
}

fn ji64_null(v: &Value, k: &str) -> Option<i64> {
    match v.get(k) {
        Some(Value::Null) | None => None,
        _ => ji64(v, k),
    }
}

/// LWW：仅当传入记录的 updated_at 更新时才合并，返回是否实际写入
async fn upsert_conversation(db: &SqlitePool, v: &Value) -> Result<bool, String> {
    let Some(id) = jstr(v, "id") else { return Ok(false) };
    let Some(created_at) = ji64(v, "created_at") else { return Ok(false) };
    let Some(updated_at) = ji64(v, "updated_at") else { return Ok(false) };
    let result = sqlx::query(
        "INSERT INTO conversations
            (id, title, model_id, system_prompt, pinned, thinking_level, last_viewed_message_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            model_id = excluded.model_id,
            system_prompt = excluded.system_prompt,
            pinned = excluded.pinned,
            thinking_level = excluded.thinking_level,
            last_viewed_message_id = excluded.last_viewed_message_id,
            updated_at = excluded.updated_at
         WHERE excluded.updated_at > conversations.updated_at",
    )
    .bind(&id)
    .bind(jstr(v, "title").unwrap_or_default())
    .bind(jstr(v, "model_id").unwrap_or_default())
    .bind(jstr_null(v, "system_prompt"))
    .bind(ji64(v, "pinned").unwrap_or(0))
    .bind(jstr_null(v, "thinking_level"))
    .bind(jstr_null(v, "last_viewed_message_id"))
    .bind(created_at)
    .bind(updated_at)
    .execute(db)
    .await
    .map_err(|e| e.to_string())?;
    Ok(result.rows_affected() > 0)
}

async fn upsert_message(db: &SqlitePool, v: &Value) -> Result<bool, String> {
    let Some(id) = jstr(v, "id") else { return Ok(false) };
    let Some(conversation_id) = jstr(v, "conversation_id") else { return Ok(false) };
    let Some(created_at) = ji64(v, "created_at") else { return Ok(false) };
    let Some(updated_at) = ji64(v, "updated_at") else { return Ok(false) };
    let result = sqlx::query(
        "INSERT INTO messages
            (id, conversation_id, role, content, reasoning_content, thinking_ms, status,
             token_count, input_tokens, output_tokens, model_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
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
         WHERE excluded.updated_at > messages.updated_at",
    )
    .bind(&id)
    .bind(&conversation_id)
    .bind(jstr(v, "role").unwrap_or_else(|| "user".into()))
    .bind(jstr(v, "content").unwrap_or_default())
    .bind(jstr_null(v, "reasoning_content"))
    .bind(ji64_null(v, "thinking_ms"))
    .bind(jstr(v, "status").unwrap_or_else(|| "completed".into()))
    .bind(ji64_null(v, "token_count"))
    .bind(ji64_null(v, "input_tokens"))
    .bind(ji64_null(v, "output_tokens"))
    .bind(jstr_null(v, "model_id"))
    .bind(created_at)
    .bind(updated_at)
    .execute(db)
    .await
    .map_err(|e| e.to_string())?;
    Ok(result.rows_affected() > 0)
}

