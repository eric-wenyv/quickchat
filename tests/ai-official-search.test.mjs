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

function modelConfig(provider, overrides = {}) {
  return {
    id: 'model-1',
    provider,
    model_id: provider === 'openrouter' ? 'openai/gpt-4o-mini' : 'gemini-3-flash-preview',
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

test('web search is disabled by default to preserve streaming reasoning', async () => {
  const { getWebSearchOptions } = await importAiService();

  // 2026-09-18 定案：附带 openrouter:web_search 工具时，OpenRouter 会把思考模型
  // 的整段 reasoning 在思考阶段结束后作为单一事件下发（对照实验证实），破坏流式
  // 思考展示。因此所有 provider 默认禁用官方搜索；显式传 webSearch.enabled 的
  // 路径仍保留（见下方 official 注入用例）。
  assert.deepEqual(getWebSearchOptions(modelConfig('openrouter')), { enabled: false, mode: 'disabled' });
  assert.deepEqual(getWebSearchOptions(modelConfig('google_gemini')), { enabled: false, mode: 'disabled' });
  assert.deepEqual(getWebSearchOptions(modelConfig('openai_compatible')), { enabled: false, mode: 'disabled' });
});

test('OpenRouter official search injects server tool alongside local function tools', async () => {
  const { chatCompletion, READ_URL_TOOL } = await importAiService();
  let requestBody;

  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(sse([
      { choices: [{ delta: { content: 'Grounded answer' }, finish_reason: null }] },
      { choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } },
    ]));
  };

  const result = await chatCompletion({
    model: modelConfig('openrouter'),
    messages: [{ role: 'user', content: 'What happened today?' }],
    tools: [READ_URL_TOOL],
    webSearch: { enabled: true, mode: 'official' },
  });
  await readAll(result.stream);

  // 官方 server tool 置于首位，本地 function tools（read_url 等）与之共存。
  // 调用方（App.tsx）在 official 模式下本就不会再传 web_search function tool。
  assert.deepEqual(requestBody.tools, [
    {
      type: 'openrouter:web_search',
      parameters: {
        engine: 'auto',
        max_results: 5,
        max_total_results: 10,
        search_context_size: 'medium',
      },
    },
    READ_URL_TOOL,
  ]);
  assert.equal(requestBody.tool_choice, 'auto');
});

test('Gemini legacy search uses local web_search function tool through chat completions', async () => {
  const { chatCompletion, WEB_SEARCH_TOOL } = await importAiService();
  let requestUrl;
  let requestBody;

  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(init.body);
    return new Response(sse([
      { choices: [{ delta: { content: 'Local-search-capable answer' }, finish_reason: null }] },
      { choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } },
    ]));
  };

  const result = await chatCompletion({
    model: modelConfig('google_gemini'),
    messages: [{ role: 'user', content: 'Find a current source.' }],
    tools: [WEB_SEARCH_TOOL],
    webSearch: { enabled: true, mode: 'legacy_tavily' },
  });
  await readAll(result.stream);

  assert.equal(requestUrl, 'https://example.test/v1/chat/completions');
  assert.equal(requestBody.tools.length, 1);
  assert.equal(requestBody.tools[0].type, 'function');
  assert.equal(requestBody.tools[0].function.name, 'web_search');
  assert.equal(requestBody.tool_choice, 'auto');
});
