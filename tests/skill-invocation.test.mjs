import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

async function importSkillContext() {
  const source = await readFile(new URL('../src/utils/skill-context.ts', import.meta.url), 'utf8');
  const transformed = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;

  const dir = join(tmpdir(), 'quick-chat-tests');
  await mkdir(dir, { recursive: true });
  const modulePath = join(dir, `skill-context-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(modulePath, transformed);
  return import(`file:///${modulePath.replaceAll('\\', '/')}`);
}

test('stripSkillContext removes the injected skill block and keeps visible text', async () => {
  const { stripSkillContext } = await importSkillContext();
  const content = '/generate-pdf 帮我做一份简历\n\n<!-- skill-context:generate-pdf\n# SKILL.md content\n-->';
  assert.equal(stripSkillContext(content), '/generate-pdf 帮我做一份简历');
});

test('stripSkillContext leaves plain messages untouched', async () => {
  const { stripSkillContext } = await importSkillContext();
  assert.equal(stripSkillContext('你好，世界'), '你好，世界');
});

test('getSkillContextId extracts the skill id of a successfully injected block', async () => {
  const { getSkillContextId } = await importSkillContext();
  const content = '/generate-pdf 帮我做一份简历\n\n<!-- skill-context:generate-pdf\n# SKILL.md\n-->';
  assert.equal(getSkillContextId(content), 'generate-pdf');
});

test('getSkillContextId returns null when skill loading failed or was never invoked', async () => {
  const { getSkillContextId } = await importSkillContext();
  assert.equal(getSkillContextId('/generate-pdf 帮我做一份简历'), null);
  assert.equal(getSkillContextId('普通消息'), null);
});

test('parseSkillInvocation parses id-only and id with args', async () => {
  const { parseSkillInvocation } = await importSkillContext();
  assert.deepEqual(parseSkillInvocation('/generate-pdf'), { id: 'generate-pdf', args: '' });
  assert.deepEqual(parseSkillInvocation('/generate-pdf 帮我做一份简历'), {
    id: 'generate-pdf',
    args: '帮我做一份简历',
  });
});

test('parseSkillInvocation supports multiline args and trailing whitespace', async () => {
  const { parseSkillInvocation } = await importSkillContext();
  assert.deepEqual(parseSkillInvocation('/gen\n第一行\n第二行  '), { id: 'gen', args: '第一行\n第二行' });
});

test('parseSkillInvocation rejects non-slash-command text', async () => {
  const { parseSkillInvocation } = await importSkillContext();
  assert.equal(parseSkillInvocation('帮我做一份简历'), null);
  assert.equal(parseSkillInvocation('/'), null);
  assert.equal(parseSkillInvocation('/生成 pdf'), null);
  assert.equal(parseSkillInvocation(' /gen 前置文本'), null);
});
