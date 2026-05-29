import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

async function importThreadState() {
  const source = await readFile(new URL('../src/utils/threadState.ts', import.meta.url), 'utf8');
  const transformed = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;

  const dir = join(tmpdir(), 'quick-chat-tests');
  await mkdir(dir, { recursive: true });
  const modulePath = join(dir, `thread-state-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(modulePath, transformed);
  return import(`file:///${modulePath.replaceAll('\\', '/')}`);
}

test('thread send state only disables the matching conversation', async () => {
  const { markThreadSending, markThreadIdle, isThreadSending } = await importThreadState();

  const sendingState = markThreadSending({}, 'thread-a');

  assert.equal(isThreadSending(sendingState, 'thread-a'), true);
  assert.equal(isThreadSending(sendingState, 'thread-b'), false);
  assert.equal(isThreadSending(sendingState, null), false);

  const idleState = markThreadIdle(sendingState, 'thread-a');

  assert.equal(isThreadSending(idleState, 'thread-a'), false);
});
