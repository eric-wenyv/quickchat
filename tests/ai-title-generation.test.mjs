import assert from 'node:assert/strict';
import test from 'node:test';

import { importAiService } from './lib/import-ai.mjs';

function modelConfig(overrides = {}) {
  return {
    id: 'model-1',
    provider: 'openai_compatible',
    model_id: 'gemini-3-flash-preview',
    display_name: 'Gemini',
    api_key: 'test-key',
    api_endpoint: 'https://example.test/v1',
    temperature: 0.7,
    max_tokens: 1024,
    top_p: 0.95,
    thinking_level: null,
    supports_vision: false,
    is_default: true,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

test('conversation title generation uses the passed model instead of a hard-coded OpenRouter model', async () => {
  const { generateConversationTitle } = await importAiService();
  let requestUrl;
  let requestBody;

  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: '「Redis 数据结构」' } }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const title = await generateConversationTitle([
    { role: 'user', content: '# Redis 底层数据结构：压缩列表与 Listpack 详解' },
    { role: 'assistant', content: 'Redis 使用紧凑编码优化小对象。' },
  ], modelConfig());

  assert.equal(requestUrl, 'https://example.test/v1/chat/completions');
  assert.equal(requestBody.model, 'gemini-3-flash-preview');
  assert.equal(requestBody.stream, false);
  assert.equal(title, 'Redis 数据结构');
});

test('fallback conversation title cleans the first user message', async () => {
  const { generateFallbackConversationTitle, isPlaceholderConversationTitle } = await importAiService();

  assert.equal(isPlaceholderConversationTitle('New Chat'), true);
  assert.equal(
    generateFallbackConversationTitle([
      {
        role: 'user',
        content: '# Redis 底层数据结构：压缩列表与 Listpack 详解\n\n<!-- attachments:[] -->',
      },
    ]),
    'Redis 底层数据结构',
  );
});
