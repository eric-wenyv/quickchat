import assert from 'node:assert/strict';
import test from 'node:test';

import { importAiService } from './lib/import-ai.mjs';

function sse(events) {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function expectResolvesQuickly(promise, message) {
  const timeout = Symbol('timeout');
  const result = await Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(timeout), 25)),
  ]);
  assert.notEqual(result, timeout, message);
  return result;
}

function modelConfig() {
  return {
    provider: 'google_gemini',
    model_id: 'gemini-3-flash-preview',
    api_key: 'test-key',
    api_endpoint: 'https://example.test/v1',
    temperature: 0.7,
    max_tokens: 1024,
    top_p: 0.95,
  };
}

test('chatCompletion preserves Gemini thought signatures on streamed tool calls', async () => {
  const { chatCompletion } = await importAiService();

  globalThis.fetch = async () => new Response(sse([
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'web_search', arguments: '{"query":"weather"}' },
                extra_content: {
                  google: {
                    thought_signature: 'thought-signature-1',
                  },
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    },
  ]));

  const result = await chatCompletion({
    model: modelConfig(),
    messages: [{ role: 'user', content: 'weather now' }],
    tools: [],
  });

  assert.equal(result.type, 'tool_calls');
  assert.equal(result.toolCalls[0].extra_content.google.thought_signature, 'thought-signature-1');
});

test('chatCompletion yields text chunks before the response stream closes', async () => {
  const { chatCompletion } = await importAiService();
  const streamReady = deferred();
  let controller;

  globalThis.fetch = async () => new Response(new ReadableStream({
    start(c) {
      controller = c;
      streamReady.resolve();
    },
  }));

  const resultPromise = chatCompletion({
    model: modelConfig(),
    messages: [{ role: 'user', content: 'hello' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search',
          parameters: { type: 'object', properties: {} },
        },
      },
    ],
  });

  await streamReady.promise;
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
    choices: [{ delta: { content: 'Hel' }, finish_reason: null }],
  })}\n\n`));

  const result = await expectResolvesQuickly(
    resultPromise,
    'chatCompletion should return a text stream after the first text delta, not after the API response closes',
  );
  assert.equal(result.type, 'text');

  const firstChunk = await expectResolvesQuickly(
    result.stream.next(),
    'the first text chunk should be yielded before the API response closes',
  );
  assert.deepEqual(firstChunk.value, { delta: 'Hel', accumulated: 'Hel' });

  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
    choices: [{ delta: { content: 'lo' }, finish_reason: null }],
  })}\n\n`));
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
    choices: [],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  })}\n\n`));
  controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
  controller.close();

  const secondChunk = await result.stream.next();
  assert.deepEqual(secondChunk.value, { delta: 'lo', accumulated: 'Hello' });
  const usageChunk = await result.stream.next();
  assert.deepEqual(usageChunk.value, {
    delta: '',
    accumulated: 'Hello',
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  });
  assert.equal((await result.stream.next()).done, true);
  assert.deepEqual(result.usage, { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 });
});

test('chatCompletion resolves tool calls streamed after reasoning-only deltas', async () => {
  const { chatCompletion } = await importAiService();

  // 思考模型的工具调用顺序：先流式 reasoning_content，随后 tool_calls，全程无正文。
  // 解析器不应在 reasoning 阶段就提交文本分支，否则 tool_calls 会触发混合响应报错。
  globalThis.fetch = async () => new Response(sse([
    { choices: [{ delta: { reasoning_content: '用户想要天气，先调用搜索工具。' } }] },
    { choices: [{ delta: { reasoning_content: '继续推演查询词…' } }] },
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_7',
                type: 'function',
                function: { name: 'web_search', arguments: '{"query":"weather"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    },
  ]));

  const result = await chatCompletion({
    model: modelConfig(),
    messages: [{ role: 'user', content: 'weather now' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search',
          parameters: { type: 'object', properties: {} },
        },
      },
    ],
  });

  assert.equal(result.type, 'tool_calls');
  assert.equal(result.toolCalls[0].function.name, 'web_search');
  assert.equal(result.toolCalls[0].function.arguments, '{"query":"weather"}');
  assert.equal(result.reasoningContent.includes('搜索工具'), true);
});

test('chatCompletion surfaces tool calls that arrive after text deltas', async () => {
  const { chatCompletion } = await importAiService();

  // 混合响应：先流出正文前言，随后才出现 tool_calls（GLM 等思考模型的行为）。
  // 正文照常产出增量，工具调用通过 result.lateToolCalls 上报，由调用方续跑工具循环。
  globalThis.fetch = async () => new Response(sse([
    { choices: [{ delta: { content: '我先搜索一下最新天气。' } }] },
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_8',
                type: 'function',
                function: { name: 'web_search', arguments: '{"query":"weather"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    },
  ]));

  const result = await chatCompletion({
    model: modelConfig(),
    messages: [{ role: 'user', content: 'weather now' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search',
          parameters: { type: 'object', properties: {} },
        },
      },
    ],
  });

  assert.equal(result.type, 'text');

  const firstChunk = await result.stream.next();
  assert.deepEqual(firstChunk.value, { delta: '我先搜索一下最新天气。', accumulated: '我先搜索一下最新天气。' });

  const done = await result.stream.next();
  assert.equal(done.done, true);

  assert.equal(result.lateToolCalls.length, 1);
  assert.equal(result.lateToolCalls[0].function.name, 'web_search');
  assert.equal(result.lateToolCalls[0].function.arguments, '{"query":"weather"}');
});
