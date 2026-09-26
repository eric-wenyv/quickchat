// tests/sse-transport.test.mjs
//
// Tauri 分支 SSE 传输层测试：mock window.__TAURI_INTERNALS__，让真实的
// @tauri-apps/api Channel 走通（transformCallback + invoke），再按事件序列
// 驱动 Rust 侧等价行为。核心回归断言：分片按到达节奏逐片交付（WebKitGTK
// 的 fetch 流会把它们挤成一坨 —— 那正是本传输层要根治的问题）。

import assert from 'node:assert/strict';
import test from 'node:test';
import { importAiService, importSseTransport } from './lib/import-ai.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sseDataLine(event) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function modelConfig() {
  return {
    provider: 'openai_compatible',
    model_id: 'gemini-3-flash-preview',
    api_key: 'test-key',
    api_endpoint: 'https://example.test/v1',
    temperature: 0.7,
    max_tokens: 1024,
    top_p: 0.95,
  };
}

/**
 * 安装 __TAURI_INTERNALS__ mock，返回事件发送器与调用记录。
 * send(event) 等价于 Rust 侧 Channel::send：携带递增 index 保证顺序。
 */
function mockTauriInternals() {
  const callbacks = new Map();
  let nextCallbackId = 1;
  let messageIndex = 0;
  let activeChannel = null;

  const state = {
    lastStreamArgs: null,
    cancelledStreamIds: [],
  };

  globalThis.window = globalThis;
  globalThis.__TAURI_INTERNALS__ = {
    transformCallback(fn) {
      const id = nextCallbackId++;
      callbacks.set(id, fn);
      return id;
    },
    unregisterCallback(id) {
      callbacks.delete(id);
    },
    async invoke(cmd, args) {
      if (cmd === 'stream_http_sse') {
        state.lastStreamArgs = args;
        activeChannel = args.onEvent;
        return null;
      }
      if (cmd === 'cancel_http_stream') {
        state.cancelledStreamIds.push(args.streamId);
        return null;
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    },
  };

  const send = (message) => {
    assert.ok(activeChannel, 'stream_http_sse must be invoked before sending events');
    const deliver = callbacks.get(activeChannel.id);
    assert.ok(deliver, 'channel callback must be registered');
    deliver({ index: messageIndex++, message });
  };

  const cleanup = () => {
    delete globalThis.window;
    delete globalThis.__TAURI_INTERNALS__;
  };

  return { send, state, cleanup };
}

test('Tauri transport delivers reasoning fragments progressively as they arrive', async () => {
  const { chatCompletion } = await importAiService();
  const { send, state, cleanup } = mockTauriInternals();

  const deltas = [];
  const arrivalTimes = [];
  try {
    // 先发起请求（invoke 同步注册 channel），再开始按 30ms 节奏推分片 ——
    // onReasoningDelta 必须以到达节奏逐片触发，而不是结束时一次性涌入
    const request = chatCompletion({
      model: modelConfig(),
      messages: [{ role: 'user', content: 'hello' }],
      onReasoningDelta: (delta) => {
        deltas.push(delta);
        arrivalTimes.push(Date.now());
      },
    });

    const pushing = (async () => {
      send({ type: 'start', status: 200 });
      await sleep(30);
      send({ type: 'chunk', text: sseDataLine({ choices: [{ delta: { reasoning_content: '片段一，' } }] }) });
      await sleep(30);
      send({ type: 'chunk', text: sseDataLine({ choices: [{ delta: { reasoning_content: '片段二。' } }] }) });
      await sleep(30);
      send({ type: 'chunk', text: sseDataLine({ choices: [{ delta: { content: '答案' } }] }) });
      await sleep(30);
      send({ type: 'chunk', text: 'data: [DONE]\n\n' });
      send({ type: 'end' });
    })();

    const result = await request;
    await pushing;

    assert.equal(result.type, 'text');
    assert.deepEqual(deltas, ['片段一，', '片段二。']);
    assert.ok(
      arrivalTimes[1] - arrivalTimes[0] >= 20,
      `fragments must arrive progressively, gap was ${arrivalTimes[1] - arrivalTimes[0]}ms`
    );

    for await (const chunk of result.stream) {
      assert.ok(chunk.accumulated);
    }

    // invoke 参数：URL / headers / body / streamId 完整传递
    assert.equal(state.lastStreamArgs.request.url, 'https://example.test/v1/chat/completions');
    assert.equal(state.lastStreamArgs.request.headers['Content-Type'], 'application/json');
    assert.match(state.lastStreamArgs.request.body, /gemini-3-flash-preview/);
    assert.ok(state.lastStreamArgs.streamId);
    // 正常结束（End 事件后）不应再发 cancel
    await sleep(10);
    assert.deepEqual(state.cancelledStreamIds, []);
  } finally {
    cleanup();
  }
});

test('Tauri transport surfaces non-2xx body as ReasoningEffortError', async () => {
  const { chatCompletion } = await importAiService();
  const { send, cleanup } = mockTauriInternals();

  try {
    // 先发起请求（invoke 同步执行，注册好 channel），再开始推事件
    const request = chatCompletion({ model: modelConfig(), messages: [{ role: 'user', content: 'hi' }] });
    const pushing = (async () => {
      send({ type: 'start', status: 400 });
      await sleep(10);
      send({ type: 'chunk', text: JSON.stringify({ error: { message: 'reasoning_effort high is not supported' } }) });
      await sleep(10);
      send({ type: 'end' });
    })();

    await assert.rejects(
      request,
      (error) => error.name === 'ReasoningEffortError' && /reasoning_effort high/.test(error.message)
    );
    await pushing;
  } finally {
    cleanup();
  }
});

test('Tauri transport surfaces non-2xx body as a generic API error', async () => {
  const { chatCompletion } = await importAiService();
  const { send, cleanup } = mockTauriInternals();

  try {
    const request = chatCompletion({ model: modelConfig(), messages: [{ role: 'user', content: 'hi' }] });
    const pushing = (async () => {
      send({ type: 'start', status: 401 });
      await sleep(10);
      send({ type: 'chunk', text: JSON.stringify({ error: { message: 'Invalid API key' } }) });
      send({ type: 'end' });
    })();

    await assert.rejects(
      request,
      (error) => /API 请求失败 \(401\): Invalid API key/.test(error.message)
    );
    await pushing;
  } finally {
    cleanup();
  }
});

test('abort rejects the stream with AbortError and invokes cancel_http_stream', async () => {
  const { openSseStream } = await importSseTransport();
  const { send, state, cleanup } = mockTauriInternals();
  const controller = new AbortController();

  try {
    const opening = openSseStream(
      'https://example.test/v1/chat/completions',
      { Authorization: 'Bearer k' },
      '{}',
      controller.signal
    );
    send({ type: 'start', status: 200 });
    const stream = await opening;

    const collected = [];
    const consuming = (async () => {
      for await (const text of stream.chunks()) {
        collected.push(text);
      }
    })();

    send({ type: 'chunk', text: 'data: partial\n\n' });
    await sleep(10);
    controller.abort();

    await assert.rejects(consuming, (error) => error.name === 'AbortError');
    assert.deepEqual(collected, ['data: partial\n\n']);
    assert.deepEqual(state.cancelledStreamIds, [state.lastStreamArgs.streamId]);
  } finally {
    cleanup();
  }
});

test('closing the chunk iterator early cancels the Rust stream', async () => {
  const { openSseStream } = await importSseTransport();
  const { send, state, cleanup } = mockTauriInternals();

  try {
    const opening = openSseStream('https://example.test/v1/chat/completions', {}, '{}');
    send({ type: 'start', status: 200 });
    const stream = await opening;

    const iterator = stream.chunks();
    send({ type: 'chunk', text: 'data: first\n\n' });
    const first = await iterator.next();
    assert.strictEqual(first.value, 'data: first\n\n');

    await iterator.return();

    assert.deepEqual(state.cancelledStreamIds, [state.lastStreamArgs.streamId]);
  } finally {
    cleanup();
  }
});

test('Failed event rejects pending consumers with the transport error', async () => {
  const { openSseStream } = await importSseTransport();
  const { send, cleanup } = mockTauriInternals();

  try {
    const opening = openSseStream('https://example.test/v1/chat/completions', {}, '{}');
    send({ type: 'start', status: 200 });
    const stream = await opening;

    send({ type: 'failed', message: 'connection reset by peer' });

    await assert.rejects(
      (async () => {
        for await (const _text of stream.chunks()) {
          // 不应收到任何完整迭代
        }
      })(),
      /connection reset by peer/
    );
  } finally {
    cleanup();
  }
});

test('Failed before Start rejects openSseStream itself', async () => {
  const { openSseStream } = await importSseTransport();
  const { send, cleanup } = mockTauriInternals();

  try {
    const opening = openSseStream('https://example.test/v1/chat/completions', {}, '{}');
    send({ type: 'failed', message: 'dns resolution failed' });
    await assert.rejects(opening, /dns resolution failed/);
  } finally {
    cleanup();
  }
});

test('browser fetch fallback keeps working without __TAURI_INTERNALS__', async () => {
  const { openSseStream } = await importSseTransport();
  // 不安装 Tauri mock：window 未定义，必须走 fetch 分支
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('data: fetch-ok\n\n');
  try {
    const stream = await openSseStream('https://example.test/v1/chat/completions', {}, '{}');
    assert.equal(stream.status, 200);
    assert.ok(stream.ok);
    const chunks = [];
    for await (const text of stream.chunks()) {
      chunks.push(text);
    }
    assert.deepEqual(chunks, ['data: fetch-ok\n\n']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
