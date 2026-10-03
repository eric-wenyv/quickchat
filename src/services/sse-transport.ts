// =============================================================================
// Quick-Chat — SSE 传输层（Chromium fetch 流）
// =============================================================================
// Electron 统一走 Chromium fetch：其 ReadableStream 原生支持增量交付，
// 旧版 Linux WebView「思考内容一次性涌入」的问题不复存在，桌面壳自带的
// 流式命令桥已随迁移删除；dev:web 纯浏览器同走此路径。
// SSE 解析与业务逻辑都在 ai.ts，本模块只负责把「status / 错误体 / 逐段
// 文本」以迭代器形式交出去。
// =============================================================================

export interface SseStream {
  status: number;
  statusText: string;
  ok: boolean;
  /** 读取完整响应体文本（错误分支用）；正常分支不应调用 */
  readAllText(): Promise<string>;
  /** 逐段文本（可能含不完整行），传输层 EOF 后 done；网络错误时抛出 */
  chunks(): AsyncGenerator<string, void, unknown>;
}

export async function openSseStream(
  url: string,
  headers: Record<string, string>,
  body: string,
  signal?: AbortSignal
): Promise<SseStream> {
  return openFetchSseStream(url, headers, body, signal);
}

async function openFetchSseStream(
  url: string,
  headers: Record<string, string>,
  body: string,
  signal?: AbortSignal
): Promise<SseStream> {
  const response = await fetch(url, { method: 'POST', headers, body, signal });

  return {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    async readAllText() {
      return response.text();
    },
    chunks: () => readBodyTextChunks(response.body),
  };
}

async function* readBodyTextChunks(
  stream: ReadableStream<Uint8Array> | null
): AsyncGenerator<string, void, unknown> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text) yield text;
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}
