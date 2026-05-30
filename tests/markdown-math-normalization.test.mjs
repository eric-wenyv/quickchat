import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import katex from 'katex';

async function importMarkdownUtils() {
  const source = await readFile(new URL('../src/utils/markdown.ts', import.meta.url), 'utf8');
  const transformed = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;

  const dir = join(tmpdir(), 'quick-chat-tests');
  await mkdir(dir, { recursive: true });
  const modulePath = join(dir, `markdown-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(modulePath, transformed);
  return import(`file:///${modulePath.replaceAll('\\', '/')}`);
}

function assertKatexClean(markdown) {
  const inlineMath = [...markdown.matchAll(/\$([^$\n]+)\$/g)].map((match) => match[1]);
  assert.ok(inlineMath.length > 0, 'expected inline math in normalized markdown');

  for (const expression of inlineMath) {
    assert.doesNotThrow(() => katex.renderToString(expression));
    assert.ok(!expression.includes('$'), 'math expression should not contain delimiter characters');
  }
}

test('normalizeMarkdownMath repairs single-line math opened with double dollar and closed with single dollar', async () => {
  const { normalizeMarkdownMath } = await importMarkdownUtils();

  const input = [
    "- $$\\text{SELECT}(B' \\rightarrow \\varepsilon) = \\text{FOLLOW}(B') = \\{a, \\}$",
    '- $$\\{a\\} \\cap \\{\\} = \\emptyset$',
  ].join('\n');

  const normalized = normalizeMarkdownMath(input);

  assert.equal(normalized, [
    "- $\\text{SELECT}(B' \\rightarrow \\varepsilon) = \\text{FOLLOW}(B') = \\{a, \\}$",
    '- $\\{a\\} \\cap \\{\\} = \\emptyset$',
  ].join('\n'));
  assertKatexClean(normalized);
});
