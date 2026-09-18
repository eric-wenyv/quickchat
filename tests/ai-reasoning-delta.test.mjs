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
  const modulePath = join(dir, `ai-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
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

test('onReasoningDelta streams reasoning increments before the first text delta resolves', async () => {
  const { chatCompletion } = await importAiService();
  const deltas = [];
  const accumulatedSnapshots = [];

  // 思考模型的标准顺序：reasoning 分片全部先于首个 content 分片到达。
  // 回调必须在 chatCompletion 返回（首个正文分片提交文本分支）之前就已触发，
  // 否则 UI 在等待正文期间拿不到任何思考内容。
  globalThis.fetch = async () => new Response(sse([
    { choices: [{ delta: { reasoning_content: '先分析问题，' } }] },
    { choices: [{ delta: { reasoning_content: '再拆解步骤。' } }] },
    { choices: [{ delta: { content: '好的，' } }] },
    { choices: [{ delta: { content: '这是答案。' } }] },
  ]));

  const result = await chatCompletion({
    model: modelConfig(),
    messages: [{ role: 'user', content: 'hello' }],
    onReasoningDelta: (delta, accumulated) => {
      deltas.push(delta);
      accumulatedSnapshots.push(accumulated);
    },
  });

  assert.equal(result.type, 'text');
  assert.deepEqual(deltas, ['先分析问题，', '再拆解步骤。']);
  assert.deepEqual(accumulatedSnapshots, ['先分析问题，', '先分析问题，再拆解步骤。']);
  assert.equal(result.reasoningContent, '先分析问题，再拆解步骤。');

  for await (const chunk of result.stream) {
    // 消费完流，确认正文不受影响
    assert.ok(chunk.accumulated);
  }
});

test('onReasoningDelta also fires for OpenRouter-normalized delta.reasoning fragments', async () => {
  const { chatCompletion } = await importAiService();
  const deltas = [];

  globalThis.fetch = async () => new Response(sse([
    { choices: [{ delta: { reasoning: 'thinking via openrouter' } }] },
    { choices: [{ delta: { content: 'answer' } }] },
  ]));

  const result = await chatCompletion({
    model: { ...modelConfig(), provider: 'openrouter', model_id: 'glm-4.6' },
    messages: [{ role: 'user', content: 'hi' }],
    onReasoningDelta: (delta) => deltas.push(delta),
  });

  assert.equal(result.type, 'text');
  assert.deepEqual(deltas, ['thinking via openrouter']);
});

test('onReasoningDelta fires for reasoning streamed ahead of tool_calls responses', async () => {
  const { chatCompletion } = await importAiService();
  const deltas = [];

  globalThis.fetch = async () => new Response(sse([
    { choices: [{ delta: { reasoning_content: '需要先查资料。' } }] },
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_9',
                type: 'function',
                function: { name: 'web_search', arguments: '{"query":"news"}' },
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
    messages: [{ role: 'user', content: 'latest news' }],
    tools: [],
    onReasoningDelta: (delta) => deltas.push(delta),
  });

  assert.equal(result.type, 'tool_calls');
  assert.deepEqual(deltas, ['需要先查资料。']);
});

// Gemini 的 OpenAI 兼容层必须显式 include_thoughts 才会在流中返回思考摘要；
// 缺失该参数时思考阶段完全没有 reasoning 分片，UI 只能显示等待动画。
async function captureRequestBody(provider, modelId, thinkingLevel) {
  const { chatCompletion } = await importAiService();
  let capturedBody = null;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return new Response(sse([{ choices: [{ delta: { content: 'ok' } }] }]));
  };
  await chatCompletion({
    model: { ...modelConfig(), provider, model_id: modelId },
    messages: [{ role: 'user', content: 'hi' }],
    ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
  });
  return capturedBody;
}

test('google_gemini with thinking level requests thought summaries via include_thoughts', async () => {
  const body = await captureRequestBody('google_gemini', 'gemini-3-flash-preview', 'MEDIUM');
  assert.deepEqual(body.google, { thinking_config: { include_thoughts: true } });
  assert.equal(body.reasoning_effort, 'medium');
  // thinking_config 内的 level/budget 与顶层 reasoning_effort 互斥，不得同时下发
  assert.equal(body.google.thinking_config.thinking_level, undefined);
  assert.equal(body.google.thinking_config.thinking_budget, undefined);
});

test('non-google providers do not receive the google thinking_config payload', async () => {
  const body = await captureRequestBody('openrouter', 'glm-4.6', 'high');
  assert.equal(body.google, undefined);
  assert.equal(body.reasoning_effort, 'high');
});

test('google_gemini without an explicit thinking level keeps the request unchanged', async () => {
  const body = await captureRequestBody('google_gemini', 'gemini-2.5-flash', undefined);
  assert.equal(body.google, undefined);
  assert.equal(body.reasoning_effort, undefined);
});
