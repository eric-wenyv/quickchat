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

function openRouterModel() {
  return {
    id: 'model-1',
    provider: 'openrouter',
    model_id: 'openai/gpt-4o-mini',
    display_name: 'OpenRouter model',
    api_key: 'test-key',
    api_endpoint: 'https://example.test/v1',
    temperature: 0.7,
    max_tokens: 1024,
    top_p: 0.95,
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

test('chatCompletion maps OpenRouter url_citation annotations to citations', async () => {
  const { chatCompletion } = await importAiService();

  globalThis.fetch = async () => new Response(sse([
    {
      choices: [
        {
          delta: {
            content: 'Answer with source.',
            annotations: [
              {
                type: 'url_citation',
                url_citation: {
                  url: 'https://example.com/source',
                  title: 'Example Source',
                  content: 'Relevant excerpt.',
                  start_index: 0,
                  end_index: 6,
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    { choices: [], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } },
  ]));

  const result = await chatCompletion({
    model: openRouterModel(),
    messages: [{ role: 'user', content: 'Search this.' }],
    webSearch: { enabled: true, mode: 'official' },
  });
  const chunks = await readAll(result.stream);

  assert.equal(chunks.at(-1).citations.length, 1);
  assert.deepEqual(result.citations, [
    {
      url: 'https://example.com/source',
      title: 'Example Source',
      content: 'Relevant excerpt.',
      start_index: 0,
      end_index: 6,
    },
  ]);
});

test('citation helpers dedupe repeated URLs and append source list', async () => {
  const { appendCitationList, dedupeCitations } = await importAiService();
  const citations = [
    { url: 'https://example.com/a', title: 'A' },
    { url: 'https://example.com/a', title: 'A again' },
    { url: 'https://example.com/b' },
  ];

  assert.deepEqual(dedupeCitations(citations), [
    { url: 'https://example.com/a', title: 'A' },
    { url: 'https://example.com/b' },
  ]);
  assert.equal(
    appendCitationList('Answer', citations),
    'Answer\n\n来源：\n1. [A](https://example.com/a)\n2. [https://example.com/b](https://example.com/b)',
  );
});
