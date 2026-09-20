// =============================================================================
// Quick-Chat — SSE 传输层（后端选择：Tauri Rust 侧 / WebView fetch）
// =============================================================================
//
// Linux 桌面的 WebKitGTK fetch ReadableStream 不做增量交付（思考内容一次性
// 涌入），因此 Tauri 环境（Linux 桌面 + Android）统一走 Rust 侧的
// `stream_http_sse` command（reqwest + Tauri Channel，见 src-tauri/src/http_stream.rs）；
// 纯浏览器（dev:web）保留 fetch 路径。SSE 解析与业务逻辑都在 ai.ts，本模块
// 只负责把「status / 错误体 / 逐段文本」以与 fetch 一致的形状交出去。

import { Channel, invoke } from '@tauri-apps/api/core';

/** Rust 侧 SseEvent（serde tag = "type", snake_case） */
type SseEvent =
  | { type: 'start'; status: number }
  | { type: 'chunk'; text: string }
  | { type: 'end' }
  | { type: 'failed'; message: string };

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
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    return openTauriSseStream(url, headers, body, signal);
  }
  return openFetchSseStream(url, headers, body, signal);
}

// ---------------------------------------------------------------------------
// Tauri 分支：invoke command + Channel → AsyncGenerator 桥接
// ---------------------------------------------------------------------------

function createAbortError(): Error {
  try {
    return new DOMException('The operation was aborted.', 'AbortError');
  } catch {
    // 极老环境无 DOMException 构造器
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
  }
}

function randomStreamId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sse-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 把「push/end/fail 回调」桥接成单消费者 AsyncGenerator：
 * Tauri Channel 的 onmessage 是回调式，SSE 解析器需要迭代器式。
 */
function createPushQueue<T>() {
  const values: T[] = [];
  let ended = false;
  let failure: unknown = null;
  let notify: (() => void) | null = null;

  const wake = () => {
    const waiter = notify;
    notify = null;
    waiter?.();
  };

  async function* iterate(): AsyncGenerator<T, void, unknown> {
    while (true) {
      if (values.length > 0) {
        yield values.shift()!;
        continue;
      }
      if (failure !== null) throw failure;
      if (ended) return;
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
  }

  return {
    push(value: T) {
      values.push(value);
      wake();
    },
    end() {
      ended = true;
      wake();
    },
    fail(error: unknown) {
      failure = error;
      wake();
    },
    iterate,
  };
}

async function openTauriSseStream(
  url: string,
  headers: Record<string, string>,
  body: string,
  signal?: AbortSignal
): Promise<SseStream> {
  if (signal?.aborted) throw createAbortError();

  const streamId = randomStreamId();
  const channel = new Channel<SseEvent>();
  const queue = createPushQueue<string>();

  let settled = false; // 流已终结（end/failed/abort），无需再发 cancel
  const cancelStream = () => {
    if (settled) return;
    settled = true;
    void invoke('cancel_http_stream', { streamId }).catch(() => {});
  };

  let resolveOpen!: (status: number) => void;
  let rejectOpen!: (error: unknown) => void;
  const opened = new Promise<number>((resolve, reject) => {
    resolveOpen = resolve;
    rejectOpen = reject;
  });

  channel.onmessage = (event) => {
    switch (event?.type) {
      case 'start':
        resolveOpen(event.status);
        break;
      case 'chunk':
        queue.push(event.text);
        break;
      case 'end':
        settled = true;
        queue.end();
        break;
      case 'failed': {
        settled = true;
        const error = new Error(event.message);
        queue.fail(error);
        rejectOpen(error);
        break;
      }
    }
  };

  const onAbort = () => {
    const error = createAbortError();
    rejectOpen(error);
    queue.fail(error);
    cancelStream();
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  // invoke 在流终结后才 resolve/reject；错误已经 Failed 事件送达，
  // 这里只需吞掉拒绝避免 unhandled rejection
  invoke('stream_http_sse', {
    streamId,
    request: { url, headers, body },
    onEvent: channel,
  }).catch(() => {
    const error = new Error('Rust 侧 SSE 传输命令调用失败');
    rejectOpen(error);
    queue.fail(error);
  });

  const status = await opened;

  const iterator = (async function* (): AsyncGenerator<string, void, unknown> {
    try {
      for await (const text of queue.iterate()) {
        yield text;
      }
    } finally {
      // 覆盖消费者提前 return()：立即取消 Rust 侧下载
      cancelStream();
    }
  })();

  return {
    status,
    statusText: '',
    ok: status >= 200 && status < 300,
    async readAllText() {
      let out = '';
      for await (const text of iterator) {
        out += text;
      }
      return out;
    },
    chunks: () => iterator,
  };
}

// ---------------------------------------------------------------------------
// 浏览器分支（dev:web）：行为与原 ai.ts 内联实现完全一致
// ---------------------------------------------------------------------------

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
