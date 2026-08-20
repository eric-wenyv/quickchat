import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

async function importUrlService() {
  const source = await readFile(new URL('../src/services/url.ts', import.meta.url), 'utf8');
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
  const modulePath = join(dir, `url-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(modulePath, transformed);
  return import(`file:///${modulePath.replaceAll('\\', '/')}`);
}

test('formatUrlContent includes url, title and body', async () => {
  const { formatUrlContent } = await importUrlService();

  const output = formatUrlContent({
    url: 'https://example.com/page',
    title: 'Example Page',
    content: '  这是正文内容。  ',
    truncated: false,
  });

  assert.ok(output.includes('https://example.com/page'));
  assert.ok(output.includes('标题: Example Page'));
  assert.ok(output.includes('这是正文内容。'));
  assert.ok(!output.includes('已截断'));
});

test('formatUrlContent notes truncation when content is truncated', async () => {
  const { formatUrlContent } = await importUrlService();

  const output = formatUrlContent({
    url: 'https://example.com/long',
    title: null,
    content: '很长的正文',
    truncated: true,
  });

  assert.ok(output.includes('已截断'));
  assert.ok(!output.includes('标题:'));
});
