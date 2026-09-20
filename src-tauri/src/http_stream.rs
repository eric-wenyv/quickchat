// src-tauri/src/http_stream.rs
//
// SSE 流式传输的 Rust 侧实现。
//
// 背景：Linux 桌面的 WebKitGTK(libwebkit2gtk 2.52.x)+ libsoup3 的 fetch
// ReadableStream 不做增量交付 —— reasoning 分片会在思考阶段结束时一次性涌入
// (DB 实测 72KB 思考在 10ms 内到达)。Android 与桌面统一改走本模块：
// 前端 invoke `stream_http_sse`，Rust 用 reqwest 发请求，把响应体文本分片经
// Tauri Channel(为高频流式推送设计)回传；SSE 解析与业务逻辑全部留在 TS 侧。
// 不用 tauri-plugin-http 的 fetch：其响应体缓冲后整体返回，无增量保证。

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::watch;

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SseEvent {
    /// 响应头到达：status 供前端执行现有的 !ok 错误处理
    Start { status: u16 },
    /// 一段文本（可能含不完整行；前端已有缓冲分行逻辑，语义等同 fetch 流的
    /// TextDecoder 输出）。非 2xx 响应体也照常转发 —— 前端依赖完整错误体
    /// 识别 ReasoningEffortError(400 + /reasoning|effort/i)。
    Chunk { text: String },
    /// 流正常结束（[DONE] 与否由前端解析，这里只表示传输层 EOF）
    End,
    /// 传输层错误（连接中断等）
    Failed { message: String },
}

#[derive(Deserialize)]
pub struct HttpRequest {
    pub url: String,
    /// 含 Authorization / Content-Type 等
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// 全局共享状态：复用的 reqwest Client（内部 Arc，clone 廉价）+ 取消注册表。
/// stream_id 由前端生成（uuid）随请求传入。
#[derive(Clone)]
pub struct HttpStreamState {
    client: reqwest::Client,
    cancels: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
}

impl HttpStreamState {
    pub fn new() -> Self {
        // 连接池 + ALPN(h2/h1 自适应)；仅设 connect timeout，不设总超时（流式长连接）。
        // 默认读环境代理（HTTP_PROXY 等），与用户网络环境兼容。
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("failed to build reqwest client for SSE streaming");
        Self {
            client,
            cancels: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[tauri::command]
pub async fn stream_http_sse(
    state: State<'_, HttpStreamState>,
    stream_id: String,
    request: HttpRequest,
    on_event: Channel<SseEvent>,
) -> Result<(), String> {
    let (tx, mut rx) = watch::channel(false);
    state.cancels.lock().unwrap().insert(stream_id.clone(), tx);
    let result = relay_sse_stream(&state.client, &request, &mut rx, |event| {
        on_event.send(event).is_ok()
    })
    .await;
    state.cancels.lock().unwrap().remove(&stream_id);
    result
}

#[tauri::command]
pub async fn cancel_http_stream(
    state: State<'_, HttpStreamState>,
    stream_id: String,
) -> Result<(), String> {
    if let Some(tx) = state.cancels.lock().unwrap().remove(&stream_id) {
        let _ = tx.send(true);
    }
    Ok(())
}

/// 增量 UTF-8 解码器：reqwest 0.12 只有 bytes_stream()，多字节序列跨块
/// 边界时不能直接 from_utf8_lossy（会引入 U+FFFD 损坏中文思考内容），
/// 因此把不完整的尾部字节暂存到下一块再解码。
struct Utf8ChunkDecoder {
    carry: Vec<u8>,
}

impl Utf8ChunkDecoder {
    fn new() -> Self {
        Self { carry: Vec::new() }
    }

    /// 解码一段字节；结尾若有不完整的多字节序列则暂存。SSE / OpenAI 兼容
    /// API 的响应体按规范是 UTF-8，非法字节用 U+FFFD 占位（理论不会出现）。
    fn push(&mut self, chunk: &[u8]) -> String {
        if self.carry.is_empty() {
            self.decode(chunk)
        } else {
            self.carry.extend_from_slice(chunk);
            let combined = std::mem::take(&mut self.carry);
            self.decode(&combined)
        }
    }

    fn decode(&mut self, bytes: &[u8]) -> String {
        match std::str::from_utf8(bytes) {
            Ok(s) => s.to_string(),
            Err(err) => {
                let valid = err.valid_up_to();
                let mut out = std::str::from_utf8(&bytes[..valid]).unwrap().to_string();
                match err.error_len() {
                    None => {
                        // 结尾是不完整的多字节序列，留待下一块
                        self.carry = bytes[valid..].to_vec();
                    }
                    Some(invalid_len) => {
                        out.push('\u{FFFD}');
                        out.push_str(&self.decode(&bytes[valid + invalid_len..]));
                    }
                }
                out
            }
        }
    }

    /// EOF 冲刷：残留的不完整序列按 replacement 语义收尾（正常流应为空）
    fn finish(&mut self) -> String {
        String::from_utf8_lossy(&std::mem::take(&mut self.carry)).into_owned()
    }
}

/// 请求并发送，把响应体文本分片逐个经 `emit` 转发。
/// `emit` 返回 false 表示下游已关闭（前端销毁），立即停止。
/// 取消信号触发或下游关闭都按正常结束处理（Ok），仅传输错误返回 Err。
async fn relay_sse_stream<E>(
    client: &reqwest::Client,
    request: &HttpRequest,
    cancel: &mut watch::Receiver<bool>,
    mut emit: E,
) -> Result<(), String>
where
    E: FnMut(SseEvent) -> bool,
{
    let mut req = client.post(&request.url).body(request.body.clone());
    for (k, v) in &request.headers {
        req = req.header(k, v);
    }

    let resp = tokio::select! {
        biased;
        _ = cancel.changed() => return Ok(()), // 已取消
        r = req.send() => r.map_err(|e| e.to_string())?,
    };
    if !emit(SseEvent::Start {
        status: resp.status().as_u16(),
    }) {
        return Ok(());
    }

    let mut stream = resp.bytes_stream();
    let mut decoder = Utf8ChunkDecoder::new();
    loop {
        tokio::select! {
            biased;
            _ = cancel.changed() => return Ok(()),
            chunk = stream.next() => match chunk {
                Some(Ok(bytes)) => {
                    let text = decoder.push(&bytes);
                    if !text.is_empty() && !emit(SseEvent::Chunk { text }) {
                        return Ok(());
                    }
                }
                Some(Err(e)) => {
                    emit(SseEvent::Failed {
                        message: e.to_string(),
                    });
                    return Err(e.to_string());
                }
                None => {
                    let tail = decoder.finish();
                    if !tail.is_empty() {
                        emit(SseEvent::Chunk { text: tail });
                    }
                    emit(SseEvent::End);
                    return Ok(());
                }
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::response::Response;
    use axum::routing::any;
    use std::time::Duration;

    fn test_client() -> reqwest::Client {
        reqwest::Client::builder().build().expect("test reqwest client")
    }

    fn request_to(url: String) -> HttpRequest {
        HttpRequest {
            url,
            headers: HashMap::from([(
                "Content-Type".to_string(),
                "application/json".to_string(),
            )]),
            body: "{}".to_string(),
        }
    }

    /// 起一个 axum 服务，返回其地址（各测试内联构造 handler）
    async fn spawn_server(app: axum::Router) -> std::net::SocketAddr {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        addr
    }

    /// 把字节块按 interval 毫秒间隔推成字节流（模拟服务端渐进产出 SSE 分片）
    fn paced_bytes(
        chunks: Vec<Vec<u8>>,
        interval_ms: u64,
    ) -> impl futures_util::Stream<Item = Result<Vec<u8>, std::io::Error>> {
        futures_util::stream::iter(chunks.into_iter().map(Ok)).then(move |chunk| async move {
            tokio::time::sleep(Duration::from_millis(interval_ms)).await;
            chunk
        })
    }

    #[test]
    fn utf8_decoder_reassembles_split_multibyte_sequences() {
        // 「思考中…」按任意字节边界切开都不应损坏
        let bytes = "思考中…".as_bytes();
        for i in 1..bytes.len() {
            let mut decoder = Utf8ChunkDecoder::new();
            let head = decoder.push(&bytes[..i]);
            let tail = decoder.push(&bytes[i..]);
            assert_eq!(
                format!("{head}{tail}{}", decoder.finish()),
                "思考中…",
                "split at byte {i} must survive"
            );
        }
        // 空块与 EOF 冲刷
        let mut decoder = Utf8ChunkDecoder::new();
        assert_eq!(decoder.push(b""), "");
        assert_eq!(decoder.finish(), "");
    }

    #[tokio::test]
    async fn forwards_sse_chunks_incrementally_with_utf8_intact() {
        // 「思」的 UTF-8 字节 E6 80 9D 拆到两个 chunk，验证跨块边界不损坏
        let body_chunks: Vec<Vec<u8>> = vec![
            vec![b'd', b'a', b't', b'a', b':', b' ', 0xE6, 0x80],
            vec![0x9D, b'\n', b'\n', b'd', b'a', b't', b'a', b':', b' ', 0xE8, 0x80],
            vec![0x83, b'\n', b'\n'],
        ];
        let expected = "data: 思\n\ndata: 考\n\n";

        let addr = spawn_server(axum::Router::new().route(
            "/chat/completions",
            any(move || async move {
                Response::new(Body::from_stream(paced_bytes(body_chunks, 40)))
            }),
        ))
        .await;

        let client = test_client();
        let (_tx_alive, mut cancel) = watch::channel(false); /* sender 需存活到测试结束，否则 changed() 误判为取消 */
        let mut events = Vec::new();
        let mut arrival_times = Vec::new();

        let start = std::time::Instant::now();
        let result = relay_sse_stream(
            &client,
            &request_to(format!("http://{addr}/chat/completions")),
            &mut cancel,
            |event| {
                if matches!(event, SseEvent::Chunk { .. }) {
                    arrival_times.push(start.elapsed());
                }
                events.push(event);
                true
            },
        )
        .await;

        assert!(result.is_ok());
        // 逐片到达：服务端每 40ms 发一片，相邻 Chunk 到达间隔应保留明显的节奏
        // （阈值放宽到 25ms，避免 CI 抖动误报）
        assert_eq!(arrival_times.len(), 3, "three chunk events expected");
        assert!(
            arrival_times[1] - arrival_times[0] >= Duration::from_millis(25),
            "second chunk should arrive after the server's 40ms delay: {arrival_times:?}"
        );
        assert!(
            arrival_times[2] - arrival_times[1] >= Duration::from_millis(25),
            "third chunk should arrive after the server's 40ms delay: {arrival_times:?}"
        );
        // 首片不应等全部响应体到齐（若整流缓冲，首片会晚于 80ms）
        assert!(
            arrival_times[0] >= Duration::from_millis(25),
            "first chunk must not be buffered until the whole body arrives"
        );

        let text: String = events
            .iter()
            .filter_map(|e| match e {
                SseEvent::Chunk { text } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(text, expected, "UTF-8 split across chunks must survive");
        assert!(matches!(events.first(), Some(SseEvent::Start { status: 200 })));
        assert!(matches!(events.last(), Some(SseEvent::End)));
    }

    #[tokio::test]
    async fn forwards_non_2xx_body_so_frontend_can_read_error_json() {
        let addr = spawn_server(axum::Router::new().route(
            "/chat/completions",
            any(|| async {
                Response::builder()
                    .status(400)
                    .body(Body::from(
                        r#"{"error":{"message":"reasoning_effort not supported"}}"#,
                    ))
                    .unwrap()
            }),
        ))
        .await;

        let client = test_client();
        let (_tx_alive, mut cancel) = watch::channel(false); /* sender 需存活到测试结束，否则 changed() 误判为取消 */
        let mut events = Vec::new();
        relay_sse_stream(
            &client,
            &request_to(format!("http://{addr}/chat/completions")),
            &mut cancel,
            |event| {
                events.push(event);
                true
            },
        )
        .await
        .unwrap();

        assert!(matches!(events.first(), Some(SseEvent::Start { status: 400 })));
        let text: String = events
            .iter()
            .filter_map(|e| match e {
                SseEvent::Chunk { text } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert!(text.contains("reasoning_effort"));
        assert!(matches!(events.last(), Some(SseEvent::End)));
    }

    #[tokio::test]
    async fn cancel_stops_the_stream_immediately() {
        // 服务器持续每 20ms 发一片、共发 50 片；首片到达后取消，
        // 断言 relay 立刻返回且收到的分片远少于总量
        let chunks: Vec<Vec<u8>> = (0..50).map(|i| format!("part-{i}\n").into_bytes()).collect();
        let addr = spawn_server(axum::Router::new().route(
            "/chat/completions",
            any(move || async move {
                Response::new(Body::from_stream(paced_bytes(chunks.clone(), 20)))
            }),
        ))
        .await;

        let client = test_client();
        let (tx, mut cancel) = watch::channel(false);
        let events = Arc::new(Mutex::new(Vec::new()));
        let notify = Arc::new(tokio::sync::Notify::new());

        let events_c = events.clone();
        let notify_c = notify.clone();
        let handle = tokio::spawn(async move {
            relay_sse_stream(
                &client,
                &request_to(format!("http://{addr}/chat/completions")),
                &mut cancel,
                move |event| {
                    events_c.lock().unwrap().push(event);
                    notify_c.notify_one();
                    true
                },
            )
            .await
        });

        // 等首片 Chunk 到达后取消
        loop {
            notify.notified().await;
            if events
                .lock()
                .unwrap()
                .iter()
                .any(|e| matches!(e, SseEvent::Chunk { .. }))
            {
                break;
            }
        }
        let cancel_start = std::time::Instant::now();
        let _ = tx.send(true);
        let result = tokio::time::timeout(Duration::from_secs(2), handle)
            .await
            .expect("relay must return promptly after cancel")
            .unwrap();
        let cancel_elapsed = cancel_start.elapsed();

        assert!(result.is_ok(), "cancel is a clean stop, not an error");
        assert!(cancel_elapsed < Duration::from_secs(1));
        assert!(
            events.lock().unwrap().len() < 20,
            "stream should stop after cancel, not drain all chunks"
        );
    }

    #[tokio::test]
    async fn emit_returning_false_stops_the_stream() {
        let chunks: Vec<Vec<u8>> = (0..20).map(|i| format!("part-{i}\n").into_bytes()).collect();
        let addr = spawn_server(axum::Router::new().route(
            "/chat/completions",
            any(move || async move {
                Response::new(Body::from_stream(paced_bytes(chunks.clone(), 5)))
            }),
        ))
        .await;

        let client = test_client();
        let (_tx_alive, mut cancel) = watch::channel(false); /* sender 需存活到测试结束，否则 changed() 误判为取消 */
        let count = Arc::new(Mutex::new(0));
        let count_c = count.clone();
        let result = relay_sse_stream(
            &client,
            &request_to(format!("http://{addr}/chat/completions")),
            &mut cancel,
            move |_event| {
                let mut c = count_c.lock().unwrap();
                *c += 1;
                // 第 3 个事件（Start + 两个 Chunk）后模拟前端销毁：emit 返回 false
                *c < 3
            },
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(*count.lock().unwrap(), 3);
    }
}
