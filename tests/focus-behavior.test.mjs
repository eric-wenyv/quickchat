import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

async function importFocusUtils() {
  const source = await readFile(new URL('../src/utils/focus.ts', import.meta.url), 'utf8');
  const transformed = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;

  const dir = join(tmpdir(), 'quick-chat-tests');
  await mkdir(dir, { recursive: true });
  const modulePath = join(dir, `focus-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(modulePath, transformed);
  return import(`file:///${modulePath.replaceAll('\\', '/')}`);
}

function element({ matches = false, closest = null } = {}) {
  return {
    matches: () => matches,
    closest: () => closest,
  };
}

test('shouldPreserveCurrentFocus protects active form and modal focus', async () => {
  const { shouldPreserveCurrentFocus } = await importFocusUtils();

  assert.equal(shouldPreserveCurrentFocus(null), false);
  assert.equal(shouldPreserveCurrentFocus(element({ matches: true })), true);
  assert.equal(shouldPreserveCurrentFocus(element({ closest: {} })), true);
  assert.equal(shouldPreserveCurrentFocus(element()), false);
});
