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

function modelConfig(overrides = {}) {
  return {
    id: 'model-1',
    provider: 'openai_compatible',
    model_id: 'gemini-3-flash-preview',
    display_name: 'Test model',
    api_key: 'test-key',
    api_endpoint: 'https://example.test/v1',
    temperature: 0.7,
    max_tokens: 1024,
    top_p: 0.95,
    thinking_level: null,
    is_default: true,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

test('local function tools pass through to the request body', async () => {
  const { chatCompletion } = await importAiService();
  let requestUrl;
  let requestBody;

  const WEB_SEARCH_TOOL = {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  };

  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(init.body);
    return new Response(sse([
      { choices: [{ delta: { content: 'Local-search-capable answer' }, finish_reason: null }] },
      { choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } },
    ]));
  };

  const result = await chatCompletion({
    model: modelConfig(),
    messages: [{ role: 'user', content: 'Find a current source.' }],
    tools: [WEB_SEARCH_TOOL],
  });
  await readAll(result.stream);

  assert.equal(requestUrl, 'https://example.test/v1/chat/completions');
  assert.deepEqual(requestBody.tools, [WEB_SEARCH_TOOL]);
  assert.equal(requestBody.tool_choice, 'auto');
});

test('openrouter endpoints get the server-side web_search tool appended', async () => {
  const { chatCompletion } = await importAiService();
  let requestBody;

  const LOCAL_TOOL = {
    type: 'function',
    function: {
      name: 'read_url',
      description: 'Read a URL',
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    },
  };

  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(sse([
      { choices: [{ delta: { content: 'Grounded answer' }, finish_reason: null }] },
    ]));
  };

  // 有本地工具时：web_search 追加在本地工具之后
  let result = await chatCompletion({
    model: modelConfig({ api_endpoint: 'https://openrouter.ai/api/v1/' }),
    messages: [{ role: 'user', content: 'What happened this week?' }],
    tools: [LOCAL_TOOL],
  });
  await readAll(result.stream);
  assert.deepEqual(requestBody.tools, [LOCAL_TOOL, { type: 'openrouter:web_search' }]);
  assert.equal(requestBody.tool_choice, 'auto');

  // 无本地工具时：web_search 也会下发，保证模型可自主搜索
  result = await chatCompletion({
    model: modelConfig({ api_endpoint: 'https://openrouter.ai/api/v1' }),
    messages: [{ role: 'user', content: 'What happened this week?' }],
  });
  await readAll(result.stream);
  assert.deepEqual(requestBody.tools, [{ type: 'openrouter:web_search' }]);
});

test('non-openrouter endpoints do not get the server-side web_search tool', async () => {
  const { chatCompletion } = await importAiService();
  let requestBody;

  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(sse([
      { choices: [{ delta: { content: 'Plain answer' }, finish_reason: null }] },
    ]));
  };

  const result = await chatCompletion({
    model: modelConfig(),
    messages: [{ role: 'user', content: 'Hi' }],
  });
  await readAll(result.stream);

  assert.equal(requestBody.tools, undefined);
  assert.equal(requestBody.tool_choice, undefined);
});
