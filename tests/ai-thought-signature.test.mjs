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
