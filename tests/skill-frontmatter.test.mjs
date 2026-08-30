import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

async function importSkillFrontmatter() {
  const source = await readFile(new URL('../src/utils/skill-frontmatter.ts', import.meta.url), 'utf8');
  const transformed = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;

  const dir = join(tmpdir(), 'quick-chat-tests');
  await mkdir(dir, { recursive: true });
  const modulePath = join(dir, `skill-frontmatter-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(modulePath, transformed);
  return import(`file:///${modulePath.replaceAll('\\', '/')}`);
}

test('folding folded block scalar (>) matches Claude/js-yaml semantics', async () => {
  const { parseSkillFrontmatter } = await importSkillFrontmatter();

  // omarchy / diagnose-crash 等官方 Skill 的写法
  const parsed = parseSkillFrontmatter(
    [
      '---',
      'name: diagnose-crash',
      'description: >',
      '  Diagnose why a program crashed on this machine.',
      '  Use when a process has segfaulted, or asked',
      '  why an application crashed. Triggers: crash, segfault.',
      '---',
      '',
      '# Diagnosing a Crash',
    ].join('\n'),
  );

  assert.equal(parsed.fields.find((f) => f.key === 'name')?.value, 'diagnose-crash');
  assert.equal(
    parsed.fields.find((f) => f.key === 'description')?.value,
    'Diagnose why a program crashed on this machine. Use when a process has segfaulted, or asked why an application crashed. Triggers: crash, segfault.',
  );
  assert.equal(parsed.body, '# Diagnosing a Crash');
});

test('literal block scalar (|-) keeps line breaks and strips chomp indicator', async () => {
  const { parseSkillFrontmatter } = await importSkillFrontmatter();

  const parsed = parseSkillFrontmatter(
    '---\nname: multi\ndescription: |-\n  第一行\n  第二行\n---\n\n# 正文\n',
  );

  assert.equal(parsed.fields.find((f) => f.key === 'description')?.value, '第一行\n第二行');
});

test('plain scalars: inline value, comment stripping, quoted and continuation folding', async () => {
  const { parseSkillFrontmatter } = await importSkillFrontmatter();

  // 单行 + 注释剥离
  const plain = parseSkillFrontmatter('---\nname: a\nauthor: eric # 仅注释\n---\n\n# a\n');
  assert.equal(plain.fields.find((f) => f.key === 'author')?.value, 'eric');

  // 引号标量（含 ": " 与转义）
  const quoted = parseSkillFrontmatter(
    '---\nname: b\ndescription: "使用它：当用户说 \\"帮我做简历\\" 时"\n---\n# b\n',
  );
  assert.equal(quoted.fields.find((f) => f.key === 'description')?.value, '使用它：当用户说 "帮我做简历" 时');

  // 更缩进的续行按空格折叠（js-yaml 的普通多行标量）
  const continued = parseSkillFrontmatter('---\nname: c\ndescription: 首行\n  次行\n---\n# c\n');
  assert.equal(continued.fields.find((f) => f.key === 'description')?.value, '首行 次行');

  // 值写在下一行
  const nextLine = parseSkillFrontmatter('---\nname: d\ndescription:\n  写在下一行的描述\n---\n# d\n');
  assert.equal(nextLine.fields.find((f) => f.key === 'description')?.value, '写在下一行的描述');
});

test('disable-model-invocation and unknown fields are surfaced as fields', async () => {
  const { parseSkillFrontmatter } = await importSkillFrontmatter();

  const parsed = parseSkillFrontmatter(
    '---\nname: manual\ndescription: 仅手动调用\nallowed-tools: Bash, Read\ndisable-model-invocation: true\n---\n# manual\n',
  );

  assert.deepEqual(
    parsed.fields.map((f) => f.key),
    ['name', 'description', 'allowed-tools', 'disable-model-invocation'],
  );
  assert.equal(parsed.fields.find((f) => f.key === 'disable-model-invocation')?.value, 'true');
});

test('content without frontmatter returns null', async () => {
  const { parseSkillFrontmatter } = await importSkillFrontmatter();

  assert.equal(parseSkillFrontmatter('# 只有正文\n'), null);
  assert.equal(parseSkillFrontmatter('---\nname: 未闭合\n'), null);
});
