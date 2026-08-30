import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

async function importAiService() {
  const source = await readFile(new URL('../src/services/ai.ts', import.meta.url), 'utf8');
  const transformed = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;

  const dir = join(tmpdir(), 'quick-chat-tests');
  await mkdir(dir, { recursive: true });
  const modulePath = join(dir, `ai-official-search-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(modulePath, transformed);
  return import(`file:///${modulePath.replaceAll('\\', '/')}`);
}

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

test('web search routing keeps OpenRouter official and Gemini/OpenAI-compatible on local Tavily', async () => {
  const { getWebSearchOptions } = await importAiService();

  assert.deepEqual(getWebSearchOptions(modelConfig('openrouter')), { enabled: true, mode: 'official' });
  assert.deepEqual(getWebSearchOptions(modelConfig('google_gemini')), { enabled: true, mode: 'legacy_tavily' });
  assert.deepEqual(getWebSearchOptions(modelConfig('openai_compatible')), { enabled: true, mode: 'legacy_tavily' });
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
