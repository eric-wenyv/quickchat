// src-tauri/src/server.rs
//
// LAN relay server embedded in the Tauri desktop app.
// Exposes the local SQLite conversation history and proxies AI provider
// calls (SSE streaming, tool-calling loop with Tavily web search) so the
// Android client can connect over the local network with a bearer token.

use axum::{
    extract::{Path, Query, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Json, Response,
    },
    routing::{get, post},
    Router,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::collections::{HashMap, HashSet, VecDeque};
use std::convert::Infallible;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::{broadcast, mpsc, RwLock};
use tokio_stream::wrappers::{BroadcastStream, ReceiverStream};

use crate::get_tavily_api_key;

pub const DEFAULT_PORT: u16 = 8975;

// ---------------------------------------------------------------------------
// Server state & lifecycle
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub enabled: bool,
    pub port: u16,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            port: DEFAULT_PORT,
        }
    }
}

#[derive(Serialize, Clone)]
pub struct ServerInfo {
    pub enabled: bool,
    pub running: bool,
    pub port: u16,
    pub token: String,
    pub addresses: Vec<String>,
}

pub struct LanServer {
    pub db: SqlitePool,
    pub http: reqwest::Client,
    pub token: RwLock<String>,
    pub events: broadcast::Sender<Value>,
    config_path: PathBuf,
    token_path: PathBuf,
    task: RwLock<Option<tauri::async_runtime::JoinHandle<()>>>,
    watcher: RwLock<Option<tauri::async_runtime::JoinHandle<()>>>,
    config: RwLock<ServerConfig>,
}

impl LanServer {
    pub async fn info(&self) -> ServerInfo {
        let config = self.config.read().await.clone();
        let running = self.task.read().await.is_some();
        ServerInfo {
            enabled: config.enabled,
            running,
            port: config.port,
            token: self.token.read().await.clone(),
            addresses: lan_addresses(),
        }
    }

    pub async fn set_config(
        self: &Arc<Self>,
        enabled: bool,
        port: u16,
    ) -> Result<ServerInfo, String> {
        {
            let mut guard = self.config.write().await;
            *guard = ServerConfig { enabled, port };
            save_config(&self.config_path, &guard)?;
        }
        self.stop().await;
        if enabled {
            self.start().await?;
        }
        Ok(self.info().await)
    }

    pub async fn regenerate_token(&self) -> Result<ServerInfo, String> {
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
                eprintln!("[quick-chat] LAN server error: {e}");
            }
        });
        *guard = Some(handle);
        let watcher = tauri::async_runtime::spawn(watch_db(self.clone()));
        *self.watcher.write().await = Some(watcher);
        eprintln!("[quick-chat] LAN server listening on 0.0.0.0:{port}");
        Ok(())
    }

    async fn stop(&self) {
        if let Some(handle) = self.task.write().await.take() {
            handle.abort();
        }
        if let Some(handle) = self.watcher.write().await.take() {
            handle.abort();
        }
    }
}

fn lan_addresses() -> Vec<String> {
    let mut addrs: Vec<String> = local_ip_address::list_afinet_netifas()
        .map(|interfaces| {
            interfaces
                .into_iter()
                .filter(|(_, ip)| ip.is_ipv4() && !ip.is_loopback())
                .map(|(_, ip)| ip.to_string())
                .collect()
        })
        .unwrap_or_default();
    addrs.sort();
    addrs.dedup();
    addrs
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

fn load_config(path: &PathBuf) -> ServerConfig {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_config(path: &PathBuf, config: &ServerConfig) -> Result<(), String> {
    let body = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(path, body).map_err(|e| format!("写入服务器配置失败: {e}"))
}

pub async fn init(app_config_dir: PathBuf) -> Result<Arc<LanServer>, String> {
    // tauri-plugin-sql resolves relative `sqlite:` paths against the app
    // config dir, so the shared database lives there too.
    let app_data_dir = app_config_dir.clone();
    std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_config_dir).map_err(|e| e.to_string())?;

    let db_path = app_data_dir.join("quick_chat.db");
    let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", db_path.display()))
        .map_err(|e| format!("无效的数据库路径: {e}"))?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(10));
    let db = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await
        .map_err(|e| format!("打开数据库失败: {e}"))?;

    ensure_schema(&db).await?;

    let token_path = app_config_dir.join("server_token");
    let config_path = app_config_dir.join("server_config.json");
    let token = load_or_create_token(&token_path)?;
    let config = load_config(&config_path);

    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let server = Arc::new(LanServer {
        db,
        http,
        token: RwLock::new(token),
        events: broadcast::channel(128).0,
        config_path,
        token_path,
        task: RwLock::new(None),
        watcher: RwLock::new(None),
        config: RwLock::new(config),
    });

    if server.config.read().await.enabled {
        if let Err(e) = server.start().await {
            eprintln!("[quick-chat] LAN server start failed: {e}");
        }
    }

    Ok(server)
}

// ---------------------------------------------------------------------------
// Schema bootstrap (mirrors src/services/db.ts)
// ---------------------------------------------------------------------------

async fn ensure_column(
    db: &SqlitePool,
    table: &str,
    column: &str,
    ddl: &str,
) -> Result<(), String> {
    let rows = sqlx::query(&format!("PRAGMA table_info({table})"))
        .fetch_all(db)
        .await
        .map_err(|e| e.to_string())?;
    let exists = rows.iter().any(|r| r.get::<String, _>("name") == column);
    if !exists {
        sqlx::query(ddl)
            .execute(db)
            .await
            .map_err(|e| e.to_string())?;
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
        "CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);",
        "CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY NOT NULL,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
            content TEXT NOT NULL DEFAULT '',
            reasoning_content TEXT DEFAULT NULL,
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
        "CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
            content, content='messages', content_rowid='rowid',
            tokenize='unicode61 remove_diacritics 2'
        );",
        "CREATE TRIGGER IF NOT EXISTS trg_messages_fts_insert AFTER INSERT ON messages
         BEGIN INSERT INTO messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content); END;",
        "CREATE TRIGGER IF NOT EXISTS trg_messages_fts_update AFTER UPDATE OF content ON messages
         BEGIN
           INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
           INSERT INTO messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
         END;",
        "CREATE TRIGGER IF NOT EXISTS trg_messages_fts_delete AFTER DELETE ON messages
         BEGIN INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content); END;",
    ];
    for statement in statements {
        sqlx::query(statement)
            .execute(db)
            .await
            .map_err(|e| format!("初始化数据库结构失败: {e}"))?;
    }

    // Trigram FTS for CJK search may be unavailable on some SQLite builds.
    let trigram = [
        "CREATE VIRTUAL TABLE IF NOT EXISTS messages_search_fts USING fts5(
            content, content='messages', content_rowid='rowid', tokenize='trigram'
        );",
        "CREATE TRIGGER IF NOT EXISTS trg_messages_search_fts_insert AFTER INSERT ON messages
         BEGIN INSERT INTO messages_search_fts(rowid, content) VALUES (NEW.rowid, NEW.content); END;",
        "CREATE TRIGGER IF NOT EXISTS trg_messages_search_fts_update AFTER UPDATE OF content ON messages
         BEGIN
           INSERT INTO messages_search_fts(messages_search_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
           INSERT INTO messages_search_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
         END;",
        "CREATE TRIGGER IF NOT EXISTS trg_messages_search_fts_delete AFTER DELETE ON messages
         BEGIN INSERT INTO messages_search_fts(messages_search_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content); END;",
    ];
    for statement in trigram {
        let _ = sqlx::query(statement).execute(db).await;
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
// Router & auth
// ---------------------------------------------------------------------------

fn build_router(server: Arc<LanServer>) -> Router {
    let api = Router::new()
        .route("/health", get(health))
        .route(
            "/conversations",
            get(list_conversations).post(create_conversation),
        )
        .route(
            "/conversations/{id}",
            post(update_conversation).delete(delete_conversation),
        )
        .route(
            "/conversations/{id}/messages",
            get(list_messages).post(create_message),
        )
        .route("/messages/{id}", post(update_message))
        .route("/models", get(list_models))
        .route("/system-prompts", get(list_system_prompts))
        .route("/search", get(search_messages))
        .route("/title", post(generate_title))
        .route("/describe-image", post(describe_image))
        .route("/chat/completions", post(chat_completions))
        .route("/events", get(sync_events))
        .route_layer(middleware::from_fn_with_state(
            server.clone(),
            auth_middleware,
        ));

    Router::new().nest("/api", api).with_state(server)
}

async fn auth_middleware(
    State(server): State<Arc<LanServer>>,
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

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

async fn health() -> impl IntoResponse {
    Json(json!({ "ok": true, "app": "quick-chat", "version": 1 }))
}

// ---------------------------------------------------------------------------
// Change events (SSE) — lets LAN clients (Android) see writes made by either
// side. The desktop frontend writes SQLite directly, so instead of hooking
// each HTTP handler we poll the DB for rows whose updated_at moved forward.
// ---------------------------------------------------------------------------

async fn sync_events(State(server): State<Arc<LanServer>>) -> Response {
    let rx = server.events.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|item| async move {
        match item {
            Ok(value) => Some(Ok::<_, Infallible>(
                Event::default().data(value.to_string()),
            )),
            Err(_) => None,
        }
    });
    Sse::new(stream)
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("ping"),
        )
        .into_response()
}

async fn watch_db(server: Arc<LanServer>) {
    let mut watermark = now_millis() - 2000;
    let mut conv_sig: Option<(i64, i64, i64)> = None;
    let mut recent: VecDeque<(String, i64)> = VecDeque::new();

    loop {
        tokio::time::sleep(Duration::from_millis(800)).await;

        let rows = sqlx::query(
            "SELECT * FROM messages WHERE updated_at > ?1 ORDER BY updated_at ASC LIMIT 500",
        )
        .bind(watermark)
        .fetch_all(&server.db)
        .await;
        if let Ok(rows) = rows {
            for row in &rows {
                let id = row.get::<String, _>("id");
                let updated_at = row.get::<i64, _>("updated_at");
                if recent
                    .iter()
                    .any(|(rid, rupd)| *rid == id && *rupd == updated_at)
                {
                    continue;
                }
                recent.push_back((id, updated_at));
                let _ = server.events.send(json!({
                    "type": "message",
                    "message": message_from_row(row),
                }));
            }
            while recent.len() > 512 {
                recent.pop_front();
            }
        }
        watermark = now_millis() - 2000;

        let sig = sqlx::query(
            "SELECT COUNT(*) AS c, COALESCE(MAX(updated_at), 0) AS u, COALESCE(SUM(pinned), 0) AS p
             FROM conversations",
        )
        .fetch_one(&server.db)
        .await
        .map(|row| {
            (
                row.get::<i64, _>("c"),
                row.get::<i64, _>("u"),
                row.get::<i64, _>("p"),
            )
        })
        .ok();
        if let Some(sig) = sig {
            if conv_sig.is_some() && conv_sig != Some(sig) {
                let _ = server
                    .events
                    .send(json!({ "type": "conversations_changed" }));
            }
            conv_sig = Some(sig);
        }
    }
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

fn conversation_from_row(row: &sqlx::sqlite::SqliteRow) -> Value {
    json!({
        "id": row.get::<String, _>("id"),
        "title": row.get::<String, _>("title"),
        "model_id": row.get::<String, _>("model_id"),
        "system_prompt": row.get::<Option<String>, _>("system_prompt"),
        "pinned": row.get::<i64, _>("pinned") != 0,
        "thinking_level": row.get::<Option<String>, _>("thinking_level"),
        "created_at": row.get::<i64, _>("created_at"),
        "updated_at": row.get::<i64, _>("updated_at"),
        "message_count": row.get::<i64, _>("message_count"),
    })
}

async fn list_conversations(State(server): State<Arc<LanServer>>) -> Response {
    let rows = match sqlx::query(
        "SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c
         ORDER BY c.pinned DESC, c.updated_at DESC",
    )
    .fetch_all(&server.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    };
    Json(json!({ "conversations": rows.iter().map(conversation_from_row).collect::<Vec<_>>() }))
        .into_response()
}

#[derive(Deserialize)]
struct CreateConversationBody {
    id: Option<String>,
    title: Option<String>,
    model_id: String,
    system_prompt: Option<String>,
}

async fn create_conversation(
    State(server): State<Arc<LanServer>>,
    Json(body): Json<CreateConversationBody>,
) -> Response {
    let id = body.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let now = now_millis();
    let result = sqlx::query(
        "INSERT INTO conversations (id, title, model_id, system_prompt, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
    )
    .bind(&id)
    .bind(body.title.unwrap_or_default())
    .bind(&body.model_id)
    .bind(&body.system_prompt)
    .bind(now)
    .execute(&server.db)
    .await;

    match result {
        Ok(_) => {
            let row =
                sqlx::query("SELECT c.*, 0 AS message_count FROM conversations c WHERE c.id = ?1")
                    .bind(&id)
                    .fetch_one(&server.db)
                    .await;
            match row {
                Ok(row) => {
                    Json(json!({ "conversation": conversation_from_row(&row) })).into_response()
                }
                Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
            }
        }
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

#[derive(Deserialize)]
struct UpdateConversationBody {
    title: Option<String>,
    pinned: Option<bool>,
    system_prompt: Option<Value>,
    model_id: Option<String>,
}

async fn update_conversation(
    State(server): State<Arc<LanServer>>,
    Path(id): Path<String>,
    Json(body): Json<UpdateConversationBody>,
) -> Response {
    if let Some(title) = body.title {
        if let Err(e) =
            sqlx::query("UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3")
                .bind(title)
                .bind(now_millis())
                .bind(&id)
                .execute(&server.db)
                .await
        {
            return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string());
        }
    }
    if let Some(pinned) = body.pinned {
        if let Err(e) = sqlx::query("UPDATE conversations SET pinned = ?1 WHERE id = ?2")
            .bind(if pinned { 1 } else { 0 })
            .bind(&id)
            .execute(&server.db)
            .await
        {
            return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string());
        }
    }
    if let Some(system_prompt) = body.system_prompt {
        let value: Option<String> = if system_prompt.is_null() {
            None
        } else {
            system_prompt.as_str().map(|s| s.to_string())
        };
        if let Err(e) = sqlx::query("UPDATE conversations SET system_prompt = ?1 WHERE id = ?2")
            .bind(value)
            .bind(&id)
            .execute(&server.db)
            .await
        {
            return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string());
        }
    }
    if let Some(model_id) = body.model_id {
        if let Err(e) = sqlx::query("UPDATE conversations SET model_id = ?1 WHERE id = ?2")
            .bind(model_id)
            .bind(&id)
            .execute(&server.db)
            .await
        {
            return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string());
        }
    }

    let row = sqlx::query(
        "SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c WHERE c.id = ?1",
    )
    .bind(&id)
    .fetch_optional(&server.db)
    .await;
    match row {
        Ok(Some(row)) => {
            Json(json!({ "conversation": conversation_from_row(&row) })).into_response()
        }
        Ok(None) => err(StatusCode::NOT_FOUND, "会话不存在"),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

async fn delete_conversation(
    State(server): State<Arc<LanServer>>,
    Path(id): Path<String>,
) -> Response {
    match sqlx::query("DELETE FROM conversations WHERE id = ?1")
        .bind(&id)
        .execute(&server.db)
        .await
    {
        Ok(result) if result.rows_affected() > 0 => Json(json!({ "ok": true })).into_response(),
        Ok(_) => err(StatusCode::NOT_FOUND, "会话不存在"),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

fn message_from_row(row: &sqlx::sqlite::SqliteRow) -> Value {
    json!({
        "id": row.get::<String, _>("id"),
        "conversation_id": row.get::<String, _>("conversation_id"),
        "role": row.get::<String, _>("role"),
        "content": row.get::<String, _>("content"),
        "reasoning_content": row.get::<Option<String>, _>("reasoning_content"),
        "status": row.get::<String, _>("status"),
        "token_count": row.get::<Option<i64>, _>("token_count"),
        "input_tokens": row.get::<Option<i64>, _>("input_tokens"),
        "output_tokens": row.get::<Option<i64>, _>("output_tokens"),
        "model_id": row.get::<Option<String>, _>("model_id"),
        "created_at": row.get::<i64, _>("created_at"),
        "updated_at": row.get::<i64, _>("updated_at"),
    })
}

#[derive(Deserialize)]
struct ListMessagesQuery {
    limit: Option<i64>,
    before: Option<i64>,
}

async fn list_messages(
    State(server): State<Arc<LanServer>>,
    Path(id): Path<String>,
    Query(query): Query<ListMessagesQuery>,
) -> Response {
    let limit = query.limit.unwrap_or(200).clamp(1, 500);
    let before = query.before.unwrap_or(i64::MAX);

    let rows = match sqlx::query(
        "SELECT * FROM messages
         WHERE conversation_id = ?1 AND created_at < ?2
         ORDER BY created_at DESC LIMIT ?3",
    )
    .bind(&id)
    .bind(before)
    .bind(limit)
    .fetch_all(&server.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    };

    let mut messages: Vec<Value> = rows.iter().map(message_from_row).collect();
    messages.reverse();
    Json(json!({ "messages": messages })).into_response()
}

#[derive(Deserialize)]
struct CreateMessageBody {
    id: Option<String>,
    role: String,
    content: Option<String>,
    reasoning_content: Option<String>,
    status: Option<String>,
    token_count: Option<i64>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    model_id: Option<String>,
    created_at: Option<i64>,
}

async fn create_message(
    State(server): State<Arc<LanServer>>,
    Path(conversation_id): Path<String>,
    Json(body): Json<CreateMessageBody>,
) -> Response {
    if !["user", "assistant", "system"].contains(&body.role.as_str()) {
        return err(
            StatusCode::BAD_REQUEST,
            "role 必须是 user / assistant / system",
        );
    }
    let id = body.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let now = now_millis();
    let created_at = body.created_at.unwrap_or(now);
    let status = body.status.unwrap_or_else(|| "completed".to_string());

    let result = sqlx::query(
        "INSERT INTO messages
           (id, conversation_id, role, content, reasoning_content, status,
            token_count, input_tokens, output_tokens, model_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
    )
    .bind(&id)
    .bind(&conversation_id)
    .bind(&body.role)
    .bind(body.content.unwrap_or_default())
    .bind(&body.reasoning_content)
    .bind(&status)
    .bind(body.token_count)
    .bind(body.input_tokens)
    .bind(body.output_tokens)
    .bind(&body.model_id)
    .bind(created_at)
    .bind(now)
    .execute(&server.db)
    .await;

    if let Err(e) = result {
        return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string());
    }
    let _ = sqlx::query("UPDATE conversations SET updated_at = ?1 WHERE id = ?2")
        .bind(now)
        .bind(&conversation_id)
        .execute(&server.db)
        .await;

    match sqlx::query("SELECT * FROM messages WHERE id = ?1")
        .bind(&id)
        .fetch_one(&server.db)
        .await
    {
        Ok(row) => Json(json!({ "message": message_from_row(&row) })).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

#[derive(Deserialize)]
struct UpdateMessageBody {
    content: Option<String>,
    reasoning_content: Option<Value>,
    status: Option<String>,
    token_count: Option<i64>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
}

async fn update_message(
    State(server): State<Arc<LanServer>>,
    Path(id): Path<String>,
    Json(body): Json<UpdateMessageBody>,
) -> Response {
    if let Some(content) = body.content {
        if let Err(e) =
            sqlx::query("UPDATE messages SET content = ?1, updated_at = ?2 WHERE id = ?3")
                .bind(content)
                .bind(now_millis())
                .bind(&id)
                .execute(&server.db)
                .await
        {
            return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string());
        }
    }
    if let Some(reasoning) = body.reasoning_content {
        let value: Option<String> = if reasoning.is_null() {
            None
        } else {
            reasoning.as_str().map(|s| s.to_string())
        };
        if let Err(e) = sqlx::query("UPDATE messages SET reasoning_content = ?1 WHERE id = ?2")
            .bind(value)
            .bind(&id)
            .execute(&server.db)
            .await
        {
            return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string());
        }
    }
    if let Some(status) = body.status {
        if let Err(e) =
            sqlx::query("UPDATE messages SET status = ?1, updated_at = ?2 WHERE id = ?3")
                .bind(status)
                .bind(now_millis())
                .bind(&id)
                .execute(&server.db)
                .await
        {
            return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string());
        }
    }
    if let Some(token_count) = body.token_count {
        let _ = sqlx::query("UPDATE messages SET token_count = ?1 WHERE id = ?2")
            .bind(token_count)
            .bind(&id)
            .execute(&server.db)
            .await;
    }
    if let Some(input_tokens) = body.input_tokens {
        let _ = sqlx::query("UPDATE messages SET input_tokens = ?1 WHERE id = ?2")
            .bind(input_tokens)
            .bind(&id)
            .execute(&server.db)
            .await;
    }
    if let Some(output_tokens) = body.output_tokens {
        let _ = sqlx::query("UPDATE messages SET output_tokens = ?1 WHERE id = ?2")
            .bind(output_tokens)
            .bind(&id)
            .execute(&server.db)
            .await;
    }

    match sqlx::query("SELECT * FROM messages WHERE id = ?1")
        .bind(&id)
        .fetch_optional(&server.db)
        .await
    {
        Ok(Some(row)) => Json(json!({ "message": message_from_row(&row) })).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "消息不存在"),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Models & system prompts
// ---------------------------------------------------------------------------

async fn list_models(State(server): State<Arc<LanServer>>) -> Response {
    let rows = match sqlx::query(
        "SELECT id, provider, model_id, display_name, api_endpoint, temperature,
                max_tokens, top_p, thinking_level, supports_vision, is_default,
                created_at, updated_at
         FROM model_configs
         ORDER BY is_default DESC, created_at ASC",
    )
    .fetch_all(&server.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    };

    let models: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.get::<String, _>("id"),
                "provider": row.get::<String, _>("provider"),
                "model_id": row.get::<String, _>("model_id"),
                "display_name": row.get::<String, _>("display_name"),
                "api_endpoint": row.get::<Option<String>, _>("api_endpoint"),
                "temperature": row.get::<f64, _>("temperature"),
                "max_tokens": row.get::<i64, _>("max_tokens"),
                "top_p": row.get::<f64, _>("top_p"),
                "thinking_level": row.get::<Option<String>, _>("thinking_level"),
                "supports_vision": row.get::<i64, _>("supports_vision") != 0,
                "is_default": row.get::<i64, _>("is_default") != 0,
            })
        })
        .collect();
    Json(json!({ "models": models })).into_response()
}

async fn list_system_prompts(State(server): State<Arc<LanServer>>) -> Response {
    let rows = match sqlx::query(
        "SELECT id, title, content, created_at, updated_at FROM system_prompts ORDER BY updated_at DESC",
    )
    .fetch_all(&server.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    };
    let prompts: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.get::<String, _>("id"),
                "title": row.get::<String, _>("title"),
                "content": row.get::<String, _>("content"),
                "created_at": row.get::<i64, _>("created_at"),
                "updated_at": row.get::<i64, _>("updated_at"),
            })
        })
        .collect();
    Json(json!({ "system_prompts": prompts })).into_response()
}

// ---------------------------------------------------------------------------
// Full-text search
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct SearchQuery {
    q: Option<String>,
    limit: Option<i64>,
}

fn build_snippet(content: &str, query: &str, radius: usize) -> String {
    let lower = content.to_lowercase();
    let needle = query.trim().to_lowercase();
    let chars: Vec<(usize, char)> = content.char_indices().collect();
    let pos = if needle.is_empty() {
        None
    } else {
        lower.find(&needle)
    };
    let (start_byte, end_byte) = match pos {
        Some(byte_pos) => {
            let idx = chars.partition_point(|(b, _)| *b < byte_pos);
            let start = idx.saturating_sub(radius);
            let end = (idx + needle.chars().count() + radius).min(chars.len());
            (
                chars[start].0,
                chars.get(end).map(|(b, _)| *b).unwrap_or(content.len()),
            )
        }
        None => (
            0,
            chars
                .get(radius * 2)
                .map(|(b, _)| *b)
                .unwrap_or(content.len()),
        ),
    };
    content[start_byte..end_byte].replace('\n', " ")
}

async fn search_messages(
    State(server): State<Arc<LanServer>>,
    Query(query): Query<SearchQuery>,
) -> Response {
    let q = query.q.unwrap_or_default().trim().to_string();
    if q.is_empty() {
        return Json(json!({ "results": [] })).into_response();
    }
    let limit = query.limit.unwrap_or(50).clamp(1, 200);

    // Trigram FTS needs at least 3 characters; otherwise use LIKE.
    let rows = if q.chars().count() >= 3 {
        let phrase = format!("\"{}\"", q.replace('"', "\"\""));
        sqlx::query(
            "SELECT m.id, m.conversation_id, m.role, m.content, m.created_at, c.title AS conversation_title
             FROM messages_search_fts f
             JOIN messages m ON m.rowid = f.rowid
             JOIN conversations c ON c.id = m.conversation_id
             WHERE messages_search_fts MATCH ?1
             ORDER BY m.created_at DESC LIMIT ?2",
        )
        .bind(&phrase)
        .bind(limit)
        .fetch_all(&server.db)
        .await
    } else {
        Err(sqlx::Error::Protocol("skip fts".into()))
    };

    let rows = match rows {
        Ok(rows) => rows,
        Err(_) => {
            let like = format!(
                "%{}%",
                q.to_lowercase()
                    .replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_")
            );
            match sqlx::query(
                "SELECT m.id, m.conversation_id, m.role, m.content, m.created_at, c.title AS conversation_title
                 FROM messages m JOIN conversations c ON c.id = m.conversation_id
                 WHERE LOWER(m.content) LIKE ?1 ESCAPE '\\'
                 ORDER BY m.created_at DESC LIMIT ?2",
            )
            .bind(&like)
            .bind(limit)
            .fetch_all(&server.db)
            .await
            {
                Ok(rows) => rows,
                Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
            }
        }
    };

    let results: Vec<Value> = rows
        .iter()
        .map(|row| {
            let content = row.get::<String, _>("content");
            json!({
                "message_id": row.get::<String, _>("id"),
                "conversation_id": row.get::<String, _>("conversation_id"),
                "conversation_title": row.get::<String, _>("conversation_title"),
                "role": row.get::<String, _>("role"),
                "snippet": build_snippet(&content, &q, 40),
                "created_at": row.get::<i64, _>("created_at"),
            })
        })
        .collect();
    Json(json!({ "results": results })).into_response()
}

// ---------------------------------------------------------------------------
// AI provider proxy
// ---------------------------------------------------------------------------

fn default_endpoint(provider: &str) -> &'static str {
    match provider {
        "google_gemini" => "https://generativelanguage.googleapis.com/v1beta/openai/",
        "openrouter" => "https://openrouter.ai/api/v1/",
        _ => "",
    }
}

struct ModelConfigFull {
    provider: String,
    model_id: String,
    api_key: String,
    api_endpoint: Option<String>,
    temperature: f64,
    max_tokens: i64,
    top_p: f64,
    thinking_level: Option<String>,
}

impl ModelConfigFull {
    fn endpoint(&self) -> Result<String, String> {
        if let Some(endpoint) = &self.api_endpoint {
            if !endpoint.trim().is_empty() {
                return Ok(endpoint.trim().to_string());
            }
        }
        let base = default_endpoint(&self.provider);
        if base.is_empty() {
            return Err("自定义 OpenAI 兼容 API 必须填写 API Endpoint".to_string());
        }
        Ok(base.to_string())
    }

    fn completions_url(&self) -> Result<String, String> {
        Ok(format!(
            "{}/chat/completions",
            self.endpoint()?.trim_end_matches('/')
        ))
    }
}

async fn load_model_config(db: &SqlitePool, id: &str) -> Result<ModelConfigFull, String> {
    let row = sqlx::query(
        "SELECT provider, model_id, api_key, api_endpoint, temperature, max_tokens, top_p, thinking_level
         FROM model_configs WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "模型配置不存在".to_string())?;

    Ok(ModelConfigFull {
        provider: row.get("provider"),
        model_id: row.get("model_id"),
        api_key: row.get("api_key"),
        api_endpoint: row.get("api_endpoint"),
        temperature: row.get("temperature"),
        max_tokens: row.get("max_tokens"),
        top_p: row.get("top_p"),
        thinking_level: row.get("thinking_level"),
    })
}

fn provider_request_builder(
    http: &reqwest::Client,
    model: &ModelConfigFull,
    body: &Value,
) -> Result<reqwest::RequestBuilder, String> {
    let url = model.completions_url()?;
    let mut request = http
        .post(&url)
        .header("Content-Type", "application/json")
        .bearer_auth(&model.api_key)
        .json(body);
    if model.provider == "openrouter" {
        request = request
            .header("HTTP-Referer", "https://quick-chat.app")
            .header("X-Title", "Quick Chat");
    }
    Ok(request)
}

async fn extract_api_error(response: reqwest::Response) -> String {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if let Ok(parsed) = serde_json::from_str::<Value>(&body) {
        if let Some(message) = parsed
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
        {
            return format!("API 请求失败 ({status}): {message}");
        }
    }
    format!("API 请求失败 ({status}): {body}")
}

fn web_search_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for current, real-time information. Use this when the user asks about recent events, news, weather, stock prices, sports results, or any information that may have changed after your knowledge cutoff.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query in Chinese or English"
                    }
                },
                "required": ["query"]
            }
        }
    })
}

fn openrouter_web_search_tool() -> Value {
    json!({
        "type": "openrouter:web_search",
        "parameters": {
            "engine": "auto",
            "max_results": 5,
            "max_total_results": 10,
            "search_context_size": "medium"
        }
    })
}

async fn tavily_search(http: &reqwest::Client, query: &str) -> Result<Value, String> {
    let api_key = get_tavily_api_key()?;
    let response = http
        .post("https://api.tavily.com/search")
        .bearer_auth(api_key.trim())
        .json(&json!({
            "query": query,
            "search_depth": "basic",
            "max_results": 5,
            "include_answer": false,
            "include_raw_content": false
        }))
        .send()
        .await
        .map_err(|e| format!("Tavily 搜索请求失败: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Tavily 搜索请求失败 ({status}): {body}"));
    }
    response
        .json::<Value>()
        .await
        .map_err(|e| format!("Tavily 响应解析失败: {e}"))
}

fn format_search_results(query: &str, data: &Value) -> String {
    let results = data
        .get("results")
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();
    if results.is_empty() {
        return format!("搜索 \"{query}\" 未返回结果。");
    }
    let mut lines = vec![
        format!("以下是通过网络搜索 \"{query}\" 获得的实时信息："),
        String::new(),
    ];
    for (i, r) in results.iter().take(5).enumerate() {
        let title = r.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let url = r.get("url").and_then(|v| v.as_str()).unwrap_or("");
        let snippet = r
            .get("content")
            .or_else(|| r.get("raw_content"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        lines.push(format!("{}. {}", i + 1, title));
        if !url.is_empty() {
            lines.push(format!("   来源: {url}"));
        }
        if !snippet.is_empty() {
            lines.push(format!("   摘要: {snippet}"));
        }
        lines.push(String::new());
    }
    lines.push("请基于以上搜索结果回答用户的问题，并在适当的地方引用来源。".to_string());
    lines.join("\n")
}

// ---- streaming round ------------------------------------------------------

#[derive(Default)]
struct ToolCallAcc {
    id: Option<String>,
    name: Option<String>,
    arguments: String,
    extra_content: Option<Value>,
}

#[derive(Default)]
struct RoundResult {
    text: String,
    reasoning: String,
    tool_calls: Vec<ToolCallAcc>,
    usage: Option<Value>,
    citations: Vec<Value>,
    finish_reason: Option<String>,
}

type EventSender = mpsc::Sender<Result<Event, Infallible>>;

async fn send_event(tx: &EventSender, payload: Value) -> Result<(), String> {
    tx.send(Ok(Event::default().data(payload.to_string())))
        .await
        .map_err(|_| "客户端连接已关闭".to_string())
}

fn merge_citations(acc: &mut Vec<Value>, annotations: &Value) {
    let Some(list) = annotations.as_array() else {
        return;
    };
    let mut seen: HashSet<String> = acc
        .iter()
        .filter_map(|c| c.get("url").and_then(|u| u.as_str()).map(|s| s.to_string()))
        .collect();
    for annotation in list {
        let source = annotation
            .get("url_citation")
            .filter(|v| v.is_object())
            .unwrap_or(annotation);
        let Some(url) = source.get("url").and_then(|u| u.as_str()) else {
            continue;
        };
        if url.is_empty() || seen.contains(url) {
            continue;
        }
        seen.insert(url.to_string());
        let mut citation = Map::new();
        citation.insert("url".into(), json!(url));
        for key in ["title", "content"] {
            if let Some(v) = source.get(key).and_then(|v| v.as_str()) {
                citation.insert(key.into(), json!(v));
            }
        }
        acc.push(Value::Object(citation));
    }
}

fn apply_stream_event(
    parsed: &Value,
    round: &mut RoundResult,
    tool_acc: &mut HashMap<i64, ToolCallAcc>,
) -> (Option<String>, Option<String>) {
    // Returns (text_delta, reasoning_delta)
    if let Some(choice) = parsed.get("choices").and_then(|c| c.get(0)) {
        for holder in [
            choice.get("delta").and_then(|d| d.get("annotations")),
            choice.get("message").and_then(|m| m.get("annotations")),
            choice.get("annotations"),
        ]
        .into_iter()
        .flatten()
        {
            merge_citations(&mut round.citations, holder);
        }
        if let Some(finish) = choice.get("finish_reason").and_then(|f| f.as_str()) {
            round.finish_reason = Some(finish.to_string());
        }
    }
    if let Some(annotations) = parsed.get("annotations") {
        merge_citations(&mut round.citations, annotations);
    }
    if let Some(usage) = parsed.get("usage") {
        round.usage = Some(json!({
            "prompt_tokens": usage.get("prompt_tokens").or_else(|| usage.get("input_tokens")).and_then(|v| v.as_i64()).unwrap_or(0),
            "completion_tokens": usage.get("completion_tokens").or_else(|| usage.get("output_tokens")).and_then(|v| v.as_i64()).unwrap_or(0),
            "total_tokens": usage.get("total_tokens").and_then(|v| v.as_i64()).unwrap_or(0),
        }));
    }

    let mut text_delta = None;
    let mut reasoning_delta = None;
    let Some(delta) = parsed
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("delta"))
    else {
        return (text_delta, reasoning_delta);
    };

    if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
        round.text.push_str(content);
        text_delta = Some(content.to_string());
    }
    if let Some(reasoning) = delta.get("reasoning_content").and_then(|c| c.as_str()) {
        round.reasoning.push_str(reasoning);
        reasoning_delta = Some(reasoning.to_string());
    }
    if let Some(tool_calls) = delta.get("tool_calls").and_then(|t| t.as_array()) {
        for tc in tool_calls {
            let index = tc.get("index").and_then(|i| i.as_i64()).unwrap_or(0);
            let entry = tool_acc.entry(index).or_default();
            if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                entry.id = Some(id.to_string());
            }
            if let Some(extra) = tc.get("extra_content") {
                entry.extra_content = Some(extra.clone());
            }
            if let Some(function) = tc.get("function") {
                if let Some(name) = function.get("name").and_then(|v| v.as_str()) {
                    entry.name = Some(name.to_string());
                }
                if let Some(args) = function.get("arguments").and_then(|v| v.as_str()) {
                    entry.arguments.push_str(args);
                }
            }
        }
    }
    (text_delta, reasoning_delta)
}

async fn run_provider_round(
    http: &reqwest::Client,
    model: &ModelConfigFull,
    body: &Value,
    tx: Option<&EventSender>,
) -> Result<RoundResult, String> {
    let response = provider_request_builder(http, model, body)?
        .send()
        .await
        .map_err(|e| format!("API 请求失败: {e}"))?;

    if !response.status().is_success() {
        return Err(extract_api_error(response).await);
    }

    let mut round = RoundResult::default();
    let mut tool_acc: HashMap<i64, ToolCallAcc> = HashMap::new();
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut done = false;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("读取响应流失败: {e}"))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buffer.find('\n') {
            let line: String = buffer.drain(..=pos).collect();
            let trimmed = line.trim();
            if !trimmed.starts_with("data: ") {
                continue;
            }
            let data = &trimmed[6..];
            if data == "[DONE]" {
                done = true;
                break;
            }
            let Ok(parsed) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            let (text_delta, reasoning_delta) =
                apply_stream_event(&parsed, &mut round, &mut tool_acc);
            if let Some(sender) = tx {
                if let Some(delta) = text_delta {
                    send_event(sender, json!({ "type": "delta", "content": delta })).await?;
                }
                if let Some(delta) = reasoning_delta {
                    send_event(sender, json!({ "type": "reasoning", "content": delta })).await?;
                }
            }
        }
        if done {
            break;
        }
    }

    let mut indices: Vec<i64> = tool_acc.keys().copied().collect();
    indices.sort();
    round.tool_calls = indices
        .into_iter()
        .filter_map(|i| tool_acc.remove(&i))
        .collect();
    Ok(round)
}

// ---- chat completions endpoint --------------------------------------------

#[derive(Deserialize)]
struct ChatCompletionsBody {
    model_config_id: String,
    messages: Vec<Value>,
    web_search: Option<bool>,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
    top_p: Option<f64>,
    thinking_level: Option<String>,
}

fn build_provider_body(
    model: &ModelConfigFull,
    messages: &[Value],
    overrides: &ChatCompletionsBody,
    tools: Option<Vec<Value>>,
) -> Value {
    // 思考开启时不干预采样参数（temperature/top_p 固定为 1），与桌面端 buildRequestBody 行为一致
    let thinking_level = overrides
        .thinking_level
        .as_deref()
        .or(model.thinking_level.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let thinking = thinking_level.is_some();

    let mut body = json!({
        "model": model.model_id,
        "messages": messages,
        "stream": true,
        "temperature": if thinking { 1.0 } else { overrides.temperature.unwrap_or(model.temperature) },
        "max_tokens": overrides.max_tokens.unwrap_or(model.max_tokens),
        "top_p": if thinking { 1.0 } else { overrides.top_p.unwrap_or(model.top_p) },
        "stream_options": { "include_usage": true }
    });
    if let Some(level) = thinking_level {
        // OpenAI 风格的 reasoning_effort；OpenRouter 会将其归一化（两种格式只能发其一）
        body["reasoning_effort"] = Value::String(level.to_lowercase());
    }
    if let Some(tools) = tools {
        body["tools"] = Value::Array(tools);
        body["tool_choice"] = json!("auto");
    }
    body
}

fn dedupe_citations(citations: &[Value]) -> Vec<Value> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for citation in citations {
        let url = citation.get("url").and_then(|u| u.as_str()).unwrap_or("");
        if url.is_empty() || !seen.insert(url.to_string()) {
            continue;
        }
        out.push(citation.clone());
    }
    out
}

async fn chat_completions(
    State(server): State<Arc<LanServer>>,
    Json(body): Json<ChatCompletionsBody>,
) -> Response {
    let model = match load_model_config(&server.db, &body.model_config_id).await {
        Ok(model) => model,
        Err(e) => return err(StatusCode::BAD_REQUEST, e),
    };

    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(128);
    let http = server.http.clone();

    tauri::async_runtime::spawn(async move {
        let result = run_chat_loop(&http, &model, body, &tx).await;
        if let Err(e) = result {
            let _ = send_event(&tx, json!({ "type": "error", "message": e })).await;
        }
    });

    Sse::new(ReceiverStream::new(rx))
        .keep_alive(KeepAlive::default())
        .into_response()
}

async fn run_chat_loop(
    http: &reqwest::Client,
    model: &ModelConfigFull,
    body: ChatCompletionsBody,
    tx: &EventSender,
) -> Result<(), String> {
    let web_search_requested = body.web_search.unwrap_or(true);
    let mode = match model.provider.as_str() {
        "openrouter" if web_search_requested => "official",
        "google_gemini" | "openai_compatible" if web_search_requested => "legacy_tavily",
        _ => "disabled",
    };

    let mut history = body.messages.clone();
    let mut final_round: Option<RoundResult> = None;

    for round_index in 0..4 {
        let tools = match mode {
            "official" => Some(vec![openrouter_web_search_tool()]),
            "legacy_tavily" if round_index == 0 => Some(vec![web_search_tool_definition()]),
            _ => None,
        };
        let provider_body = build_provider_body(model, &history, &body, tools);
        let round = run_provider_round(http, model, &provider_body, Some(tx)).await?;

        let has_tool_calls = !round.tool_calls.is_empty();
        if mode != "legacy_tavily" || !has_tool_calls {
            if mode == "legacy_tavily" && has_tool_calls && round_index >= 3 {
                return Err("模型连续触发工具调用超过限制，请重试。".to_string());
            }
            final_round = Some(round);
            break;
        }

        // Append assistant tool-call message and execute tools.
        let tool_calls_json: Vec<Value> = round
            .tool_calls
            .iter()
            .enumerate()
            .map(|(i, tc)| {
                let mut value = json!({
                    "id": tc.id.clone().unwrap_or_else(|| format!("call_{i}")),
                    "type": "function",
                    "function": {
                        "name": tc.name.clone().unwrap_or_default(),
                        "arguments": tc.arguments
                    }
                });
                if let Some(extra) = &tc.extra_content {
                    value["extra_content"] = extra.clone();
                }
                value
            })
            .collect();
        history.push(json!({
            "role": "assistant",
            "content": round.text,
            "reasoning_content": round.reasoning,
            "tool_calls": tool_calls_json
        }));

        for (i, tc) in round.tool_calls.iter().enumerate() {
            let call_id = tc.id.clone().unwrap_or_else(|| format!("call_{i}"));
            let name = tc.name.clone().unwrap_or_default();
            let tool_result =
                if name == "web_search" {
                    let query = serde_json::from_str::<Value>(&tc.arguments)
                        .ok()
                        .and_then(|v| {
                            v.get("query")
                                .and_then(|q| q.as_str())
                                .map(|s| s.to_string())
                        })
                        .unwrap_or_default();
                    match tavily_search(http, &query).await {
                        Ok(data) => {
                            let count = data
                                .get("results")
                                .and_then(|r| r.as_array())
                                .map(|a| a.len())
                                .unwrap_or(0);
                            send_event(tx, json!({
                            "type": "tool", "name": "web_search", "query": query, "count": count
                        }))
                        .await?;
                            format_search_results(&query, &data)
                        }
                        Err(e) => format!("搜索失败: {e}"),
                    }
                } else {
                    format!("未知工具: {name}")
                };
            history.push(json!({
                "role": "tool",
                "content": tool_result,
                "tool_call_id": call_id
            }));
        }
    }

    let round = final_round.ok_or_else(|| "未获得模型回复".to_string())?;
    let citations = dedupe_citations(&round.citations);
    send_event(
        tx,
        json!({
            "type": "done",
            "content": round.text,
            "reasoning_content": round.reasoning,
            "usage": round.usage,
            "citations": citations
        }),
    )
    .await?;
    Ok(())
}

// ---- title generation ------------------------------------------------------

#[derive(Deserialize)]
struct TitleBody {
    model_config_id: String,
    messages: Vec<TitleMessage>,
}

#[derive(Deserialize)]
struct TitleMessage {
    role: String,
    content: String,
}

fn clean_title_text(title: &str) -> Option<String> {
    let mut text = title.trim().to_string();
    for prefix in ["标题:", "标题：", "题目:", "题目："] {
        if let Some(rest) = text.strip_prefix(prefix) {
            text = rest.trim().to_string();
        }
    }
    text = text
        .trim_matches(|c: char| {
            matches!(
                c,
                '"' | '\''
                    | '\u{201c}'
                    | '\u{201d}'
                    | '\u{2018}'
                    | '\u{2019}'
                    | '「'
                    | '」'
                    | '『'
                    | '』'
                    | '《'
                    | '》'
            )
        })
        .trim_end_matches(|c: char| {
            matches!(
                c,
                '。' | '.'
                    | '!'
                    | '！'
                    | '?'
                    | '？'
                    | ','
                    | '，'
                    | '、'
                    | ';'
                    | '；'
                    | ':'
                    | '：'
                    | ' '
            )
        })
        .trim()
        .to_string();
    if text.is_empty() {
        return None;
    }
    let lowered = text.to_lowercase();
    if ["", "new chat", "untitled", "新对话"].contains(&lowered.as_str()) {
        return None;
    }
    Some(text.chars().take(20).collect())
}

fn strip_title_noise(content: &str) -> String {
    let mut text = content.to_string();
    // Remove <!--attachments:...--> / <!--image-descriptions:...--> comments.
    for marker in ["<!--attachments:", "<!--image-descriptions:"] {
        while let Some(start) = text.find(marker) {
            match text[start..].find("-->") {
                Some(end) => text.replace_range(start..start + end + 3, " "),
                None => break,
            }
        }
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn fallback_title(messages: &[TitleMessage]) -> Option<String> {
    let source = messages
        .iter()
        .find(|m| m.role == "user" && !strip_title_noise(&m.content).is_empty())
        .or_else(|| {
            messages
                .iter()
                .find(|m| !strip_title_noise(&m.content).is_empty())
        })?;
    let cleaned = strip_title_noise(&source.content);
    if cleaned.is_empty() {
        return None;
    }
    let first_sentence = cleaned
        .split(|c| matches!(c, '。' | '！' | '？' | '!' | '?'))
        .next()
        .unwrap_or(&cleaned);
    clean_title_text(first_sentence)
}

async fn generate_title(
    State(server): State<Arc<LanServer>>,
    Json(body): Json<TitleBody>,
) -> Response {
    let model = match load_model_config(&server.db, &body.model_config_id).await {
        Ok(model) => model,
        Err(e) => return err(StatusCode::BAD_REQUEST, e),
    };

    let mut prompt_messages: Vec<Value> = vec![json!({
        "role": "system",
        "content": "你是一个对话标题生成助手。请根据对话内容生成一个简洁的中文标题（不超过15个字）。只输出标题文本，不要加引号，不要有任何解释。"
    })];
    for message in body
        .messages
        .iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .rev()
        .take(6)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
    {
        let truncated: String = message.content.chars().take(500).collect();
        prompt_messages.push(json!({ "role": message.role, "content": truncated }));
    }
    prompt_messages.push(json!({
        "role": "user",
        "content": "请为以上对话生成一个简洁的中文标题（不超过15个字）："
    }));

    let request_body = json!({
        "model": model.model_id,
        "messages": prompt_messages,
        "stream": false,
        "temperature": model.temperature.min(0.5),
        "max_tokens": 40,
        "top_p": model.top_p
    });

    let response = match provider_request_builder(&server.http, &model, &request_body) {
        Ok(req) => match req.send().await {
            Ok(resp) => resp,
            Err(_) => {
                return Json(json!({ "title": fallback_title(&body.messages) })).into_response()
            }
        },
        Err(e) => return err(StatusCode::BAD_REQUEST, e),
    };

    if !response.status().is_success() {
        let title = fallback_title(&body.messages);
        return Json(json!({ "title": title })).into_response();
    }

    let data: Value = match response.json().await {
        Ok(data) => data,
        Err(_) => return Json(json!({ "title": fallback_title(&body.messages) })).into_response(),
    };

    let raw = data
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("");
    let title = clean_title_text(raw).or_else(|| fallback_title(&body.messages));
    Json(json!({ "title": title })).into_response()
}

// ---- describe image ---------------------------------------------------------

#[derive(Deserialize)]
struct DescribeImageBody {
    model_config_id: String,
    image_data_url: String,
}

async fn describe_image(
    State(server): State<Arc<LanServer>>,
    Json(body): Json<DescribeImageBody>,
) -> Response {
    let model = match load_model_config(&server.db, &body.model_config_id).await {
        Ok(model) => model,
        Err(e) => return err(StatusCode::BAD_REQUEST, e),
    };

    let request_body = json!({
        "model": model.model_id,
        "messages": [{
            "role": "user",
            "content": [
                { "type": "text", "text": "请详细描述这张图片的内容。包括图片中的文字、场景、人物、物体等关键信息。用中文回复。" },
                { "type": "image_url", "image_url": { "url": body.image_data_url } }
            ]
        }],
        "stream": false,
        "temperature": 0.3,
        "max_tokens": 1024
    });

    let response = match provider_request_builder(&server.http, &model, &request_body) {
        Ok(req) => match req.send().await {
            Ok(resp) => resp,
            Err(e) => return err(StatusCode::BAD_GATEWAY, format!("图片描述请求失败: {e}")),
        },
        Err(e) => return err(StatusCode::BAD_REQUEST, e),
    };
    if !response.status().is_success() {
        let message = extract_api_error(response).await;
        return err(StatusCode::BAD_GATEWAY, message);
    }
    let data: Value = match response.json().await {
        Ok(data) => data,
        Err(e) => {
            return err(
                StatusCode::BAD_GATEWAY,
                format!("图片描述响应解析失败: {e}"),
            )
        }
    };
    let description = data
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.trim().to_string());
    Json(json!({ "description": description })).into_response()
}
