import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

async function importSearchService() {
  const source = await readFile(new URL('../src/services/search.ts', import.meta.url), 'utf8');
  const transformedSource = source.replace(
    "import { invoke } from '@tauri-apps/api/core';",
    "const invoke = async () => { throw new Error('invoke not stubbed'); };",
  );
  const transformed = ts.transpileModule(transformedSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;

  const dir = join(tmpdir(), 'quick-chat-tests');
  await mkdir(dir, { recursive: true });
  const modulePath = join(dir, `search-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(modulePath, transformed);
  return import(`file:///${modulePath.replaceAll('\\', '/')}`);
}

test('normalizeTavilySearchResponse maps Tavily results into chat search results', async () => {
  const { normalizeTavilySearchResponse } = await importSearchService();

  const results = normalizeTavilySearchResponse({
    query: 'latest ai news',
    results: [
      { title: 'First result', url: 'https://example.com/one', content: 'The first Tavily content snippet.' },
      { title: 'Second result', url: 'https://example.com/two', content: 'The second Tavily content snippet.' },
    ],
    response_time: 0.42,
  });

  assert.deepEqual(results, [
    {
      title: 'First result',
      url: 'https://example.com/one',
      snippet: 'The first Tavily content snippet.',
    },
    {
      title: 'Second result',
      url: 'https://example.com/two',
      snippet: 'The second Tavily content snippet.',
    },
  ]);
});

test('normalizeTavilySearchResponse limits normalized results to five items', async () => {
  const { normalizeTavilySearchResponse } = await importSearchService();

  const results = normalizeTavilySearchResponse({
    results: Array.from({ length: 6 }, (_, index) => ({
      title: `Result ${index + 1}`,
      url: `https://example.com/${index + 1}`,
      content: `Snippet ${index + 1}`,
    })),
  });

  assert.equal(results.length, 5);
  assert.equal(results.at(-1).title, 'Result 5');
});
