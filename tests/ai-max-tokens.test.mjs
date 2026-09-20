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

function model(maxTokens) {
  return {
    id: 'model-1',
    provider: 'openai_compatible',
    model_id: 'test-model',
    display_name: 'Test Model',
    api_key: 'test-key',
    api_endpoint: 'https://example.test/v1',
    temperature: 0.6,
    max_tokens: maxTokens,
    top_p: 1.0,
    thinking_level: null,
    is_default: true,
    created_at: 1,
    updated_at: 1,
  };
}

/** 跑一次对话并捕获实际发出的请求体（JSON） */
async function captureRequestBody({ model, maxTokens }) {
  const { chatCompletion } = await importAiService();
  let sentBody = null;
  globalThis.fetch = async (_url, init) => {
    sentBody = JSON.parse(init.body);
    return new Response(sse([
      { choices: [{ delta: { content: 'ok' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
    ]));
  };
  const result = await chatCompletion({
    model,
    messages: [{ role: 'user', content: 'hi' }],
    ...(maxTokens !== undefined ? { maxTokens } : {}),
  });
  // 消费完流，避免句柄悬挂
  for await (const _chunk of result.stream) { /* drain */ }
  return sentBody;
}

test('model.max_tokens = null omits the field so provider uses model-default max output', async () => {
  const body = await captureRequestBody({ model: model(null) });
  assert.ok(!('max_tokens' in body), `max_tokens should be absent, got: ${body.max_tokens}`);
});

test('model.max_tokens number is passed through unchanged', async () => {
  const body = await captureRequestBody({ model: model(4096) });
  assert.equal(body.max_tokens, 4096);
});

test('request-level maxTokens: null forces unlimited even when the model sets a cap', async () => {
  // 复现 App.tsx 思考模型烧尽预算后的补发路径：模型配置有上限，但本次请求放开
  const body = await captureRequestBody({ model: model(2048), maxTokens: null });
  assert.ok(!('max_tokens' in body), `max_tokens should be absent, got: ${body.max_tokens}`);
});

test('request-level maxTokens number overrides the model config', async () => {
  const body = await captureRequestBody({ model: model(null), maxTokens: 512 });
  assert.equal(body.max_tokens, 512);
});
