// tests/sse-transport.test.mjs
//
// SSE 传输层测试（Electron 迁移后仅 fetch 路径）：mock globalThis.fetch 返回
// 可控 ReadableStream，验证分片按到达节奏逐片交付、非 2xx 错误体解析、
// abort 与提前关闭迭代器的行为。核心回归断言：增量交付不被聚合
// （旧版 Linux WebView 的 fetch 流会把它们挤成一坨，Electron 下不应复发）。

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
 * 安装 fetch mock：响应体为可手动推送的 ReadableStream。
 * 真实 fetch（Chromium/undici）在 signal abort 时会让进行中的 body 读取
 * 以 AbortError reject，这里在 mock 里复现同一行为。
 * 返回 { calls, push, pushWithDelay, close, error, restore }。
 */
function mockSseFetch({ status = 200, statusText = 'OK' } = {}) {
  const calls = [];
  let controller;
  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    init?.signal?.addEventListener(
      'abort',
      () => {
        const error = new DOMException('The operation was aborted.', 'AbortError');
        controller.error(error);
      },
      { once: true },
    );
    return new Response(stream, { status, statusText });
  };
  return {
    calls,
    async push(text) {
      controller.enqueue(new TextEncoder().encode(text));
    },
    async pushWithDelay(text, ms) {
      await sleep(ms);
      await this.push(text);
    },
    close() {
      controller.close();
    },
    error(err) {
      controller.error(err);
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

test('fetch transport delivers reasoning fragments progressively as they arrive', async () => {
  const { chatCompletion } = await importAiService();
  const sse = mockSseFetch();

  const deltas = [];
  const arrivalTimes = [];
  try {
    // 先发起请求（fetch 同步返回响应），再按 30ms 节奏推分片 ——
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
      await sse.push(sseDataLine({ choices: [{ delta: { reasoning_content: '片段一，' } }] }));
      await sleep(30);
      await sse.push(sseDataLine({ choices: [{ delta: { reasoning_content: '片段二。' } }] }));
      await sleep(30);
      await sse.push(sseDataLine({ choices: [{ delta: { content: '答案' } }] }));
      await sleep(30);
      await sse.push('data: [DONE]\n\n');
      sse.close();
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

    // fetch 参数：URL / headers / body 完整传递
    assert.equal(sse.calls[0].url, 'https://example.test/v1/chat/completions');
    assert.equal(sse.calls[0].init.headers['Content-Type'], 'application/json');
    assert.match(sse.calls[0].init.body, /gemini-3-flash-preview/);
  } finally {
    sse.restore();
  }
});

test('fetch transport surfaces non-2xx body as ReasoningEffortError', async () => {
  const { chatCompletion } = await importAiService();
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'reasoning_effort high is not supported' } }), {
      status: 400,
      statusText: 'Bad Request',
    });

  try {
    await assert.rejects(
      chatCompletion({ model: modelConfig(), messages: [{ role: 'user', content: 'hi' }] }),
      (error) => error.name === 'ReasoningEffortError' && /reasoning_effort high/.test(error.message)
    );
  } finally {
    delete globalThis.fetch;
  }
});

test('fetch transport surfaces non-2xx body as a generic API error', async () => {
  const { chatCompletion } = await importAiService();
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), {
      status: 401,
      statusText: 'Unauthorized',
    });

  try {
    await assert.rejects(
      chatCompletion({ model: modelConfig(), messages: [{ role: 'user', content: 'hi' }] }),
      (error) => /API 请求失败 \(401\): Invalid API key/.test(error.message)
    );
  } finally {
    delete globalThis.fetch;
  }
});

test('abort rejects the stream with AbortError', async () => {
  const { openSseStream } = await importSseTransport();
  const sse = mockSseFetch();
  const controller = new AbortController();

  try {
    const opening = openSseStream(
      'https://example.test/v1/chat/completions',
      { Authorization: 'Bearer k' },
      '{}',
      controller.signal
    );

    const stream = await opening;
    const collected = [];
    const consuming = (async () => {
      for await (const text of stream.chunks()) {
        collected.push(text);
      }
    })();

    await sse.push('data: partial\n\n');
    await sleep(10);
    controller.abort();

    await assert.rejects(consuming, (error) => error.name === 'AbortError');
    assert.deepEqual(collected, ['data: partial\n\n']);
  } finally {
    sse.restore();
  }
});

test('closing the chunk iterator early stops delivery', async () => {
  const { openSseStream } = await importSseTransport();
  const sse = mockSseFetch();

  try {
    const stream = await openSseStream('https://example.test/v1/chat/completions', {}, '{}');

    const iterator = stream.chunks();
    await sse.push('data: first\n\n');
    const first = await iterator.next();
    assert.strictEqual(first.value, 'data: first\n\n');

    const returned = await iterator.return();
    assert.strictEqual(returned.done, true);

    // 迭代器关闭后再到达的数据不应再被消费
    await sse.push('data: second\n\n');
    const after = await iterator.next();
    assert.strictEqual(after.done, true);
    sse.close();
  } finally {
    sse.restore();
  }
});

test('network error during body read rejects consumers with the transport error', async () => {
  const { openSseStream } = await importSseTransport();
  const sse = mockSseFetch();

  try {
    const stream = await openSseStream('https://example.test/v1/chat/completions', {}, '{}');
    const consuming = (async () => {
      for await (const _text of stream.chunks()) {
        // 不应收到任何完整迭代
      }
    })();

    await sse.push('data: partial\n\n');
    sse.error(new TypeError('connection reset by peer'));

    await assert.rejects(consuming, /connection reset by peer/);
  } finally {
    sse.restore();
  }
});

test('openSseStream rejects when fetch itself fails', async () => {
  const { openSseStream } = await importSseTransport();
  globalThis.fetch = async () => {
    throw new TypeError('dns resolution failed');
  };

  try {
    await assert.rejects(
      openSseStream('https://example.test/v1/chat/completions', {}, '{}'),
      /dns resolution failed/
    );
  } finally {
    delete globalThis.fetch;
  }
});

test('openSseStream delivers the fetch body as text chunks', async () => {
  const { openSseStream } = await importSseTransport();
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
    delete globalThis.fetch;
  }
});
