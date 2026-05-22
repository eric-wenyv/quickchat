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
    model: {
      provider: 'google_gemini',
      model_id: 'gemini-3-flash-preview',
      api_key: 'test-key',
      api_endpoint: 'https://example.test/v1',
      temperature: 0.7,
      max_tokens: 1024,
      top_p: 0.95,
    },
    messages: [{ role: 'user', content: 'weather now' }],
    tools: [],
  });

  assert.equal(result.type, 'tool_calls');
  assert.equal(result.toolCalls[0].extra_content.google.thought_signature, 'thought-signature-1');
});
