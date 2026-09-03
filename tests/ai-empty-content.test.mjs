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
  const modulePath = join(dir, `ai-empty-content-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
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

function openRouterModel() {
  return {
    id: 'model-1',
    provider: 'openrouter',
    model_id: 'z-ai/glm-5.3',
    display_name: 'GLM 5.3',
    api_key: 'test-key',
    api_endpoint: 'https://example.test/v1',
    temperature: 1.0,
    max_tokens: 16384,
    top_p: 0.6,
    thinking_level: null,
    is_default: true,
    created_at: 1,
    updated_at: 1,
  };
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

test('empty-string content chunks before tool_calls resolve as tool_calls, not empty text', async () => {
  // 复现 z-ai/glm-5.3 via OpenRouter 的真实流：web_search 引用分片的 content 是空字符串，
  // 修复前会被当成正文开始并提交文本分支，随后的 tool_calls 被丢弃，最终误报"返回了空内容"
  const { chatCompletion } = await importAiService();

  globalThis.fetch = async () => new Response(sse([
    {
      choices: [{
        delta: {
          content: '',
          role: 'assistant',
          annotations: [{ type: 'url_citation', url_citation: { url: 'https://example.com/a', title: 'A' } }],
        },
        finish_reason: null,
      }],
    },
    { choices: [{ delta: { content: '' }, finish_reason: null }] },
    {
      choices: [{
        delta: { content: null, tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read_url', arguments: '' } }] },
        finish_reason: null,
      }],
    },
    {
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"url":"https://example.com/a"}' } }] }, finish_reason: null }],
    },
    {
      choices: [{ delta: { content: '' }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    },
  ]));

  const result = await chatCompletion({
    model: openRouterModel(),
    messages: [{ role: 'user', content: 'opencode如何查看session修改代码' }],
    webSearch: { enabled: true, mode: 'official' },
  });

  assert.equal(result.type, 'tool_calls');
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].id, 'call_1');
  assert.equal(result.toolCalls[0].function.name, 'read_url');
  assert.deepEqual(JSON.parse(result.toolCalls[0].function.arguments), { url: 'https://example.com/a' });
  assert.equal(result.assistantMessage, '');
  assert.equal(result.usage.total_tokens, 30);
});

test('mid-stream error events surface as a thrown error instead of empty content', async () => {
  // OpenRouter 上游 500 会在流内下发 error 事件；修复前被静默忽略，
  // 调用方只能看到"返回了空内容"
  const { chatCompletion } = await importAiService();

  globalThis.fetch = async () => new Response(sse([
    { choices: [{ delta: { content: '', role: 'assistant' }, finish_reason: null }] },
    { choices: [], error: { code: 500, message: 'Internal Server Error', metadata: { error_type: 'server' } } },
  ]));

  await assert.rejects(
    chatCompletion({
      model: openRouterModel(),
      messages: [{ role: 'user', content: 'hi' }],
      webSearch: { enabled: true, mode: 'official' },
    }),
    /Internal Server Error/,
  );
});

test('OpenRouter delta.reasoning chunks accumulate into reasoningContent', async () => {
  const { chatCompletion } = await importAiService();

  globalThis.fetch = async () => new Response(sse([
    { choices: [{ delta: { reasoning: 'thinking about it' }, finish_reason: null }] },
    { choices: [{ delta: { reasoning: ' carefully' }, finish_reason: null }] },
    { choices: [{ delta: { content: 'Final answer' }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ]));

  const result = await chatCompletion({
    model: openRouterModel(),
    messages: [{ role: 'user', content: 'hi' }],
    webSearch: { enabled: true, mode: 'official' },
  });

  assert.equal(result.type, 'text');
  assert.equal(result.reasoningContent, 'thinking about it carefully');
  const chunks = await readAll(result.stream);
  assert.equal(chunks.map(c => c.delta).join(''), 'Final answer');
});

test('text followed by tool_calls returns lateToolCalls for the caller to continue the loop', async () => {
  const { chatCompletion } = await importAiService();

  globalThis.fetch = async () => new Response(sse([
    { choices: [{ delta: { content: 'Let me check the docs.' }, finish_reason: null }] },
    {
      choices: [{
        delta: { content: null, tool_calls: [{ index: 0, id: 'call_9', type: 'function', function: { name: 'read_url', arguments: '{"url":"https://example.com/x"}' } }] },
        finish_reason: null,
      }],
    },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ]));

  const result = await chatCompletion({
    model: openRouterModel(),
    messages: [{ role: 'user', content: 'hi' }],
    webSearch: { enabled: true, mode: 'official' },
  });

  assert.equal(result.type, 'text');
  const chunks = await readAll(result.stream);
  // lateToolCalls 在流结束时（finally）才挂到 result 上，必须先消费完流
  assert.equal(result.lateToolCalls?.length, 1);
  assert.equal(result.lateToolCalls[0].function.name, 'read_url');
  assert.equal(chunks.map(c => c.delta).join(''), 'Let me check the docs.');
});

test('plain content streams normally after empty-string citation chunks', async () => {
  // 引用分片后紧跟真实正文：正文必须完整流出且不被空分片污染
  const { chatCompletion } = await importAiService();

  globalThis.fetch = async () => new Response(sse([
    {
      choices: [{
        delta: { content: '', annotations: [{ type: 'url_citation', url_citation: { url: 'https://example.com/a', title: 'A' } }] },
        finish_reason: null,
      }],
    },
    { choices: [{ delta: { content: 'Answer' }, finish_reason: null }] },
    { choices: [{ delta: { content: ' part two.' }, finish_reason: 'stop' }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } },
  ]));

  const result = await chatCompletion({
    model: openRouterModel(),
    messages: [{ role: 'user', content: 'hi' }],
    webSearch: { enabled: true, mode: 'official' },
  });

  assert.equal(result.type, 'text');
  const chunks = await readAll(result.stream);
  const text = chunks.map(c => c.delta).join('');
  assert.equal(text, 'Answer part two.');
  assert.equal(chunks.at(-1).citations?.length, 1);
  assert.equal(result.citations?.length, 1);
});
