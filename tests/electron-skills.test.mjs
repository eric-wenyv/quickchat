// tests/electron-skills.test.mjs
//
// electron/skills.ts 端到端测试：逐断言移植自旧 Rust skills 模块的
// skills_end_to_end 测试（frontmatter 解析、Claude 优先导入、内置 Skill
// 版本标记、slug 化新建、字面量块标量描述、路径穿越防护），外加
// ensure_builtin_skill 的"删后不复活"语义。

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { importElectronModule } from './lib/import-electron.mjs';

async function writeSkill(root, dir, fmName, desc) {
  const d = join(root, dir);
  await mkdir(d, { recursive: true });
  await writeFile(join(d, 'SKILL.md'), `---\nname: ${fmName}\ndescription: ${desc}\n---\n\n# ${fmName}\n`);
}

test('skills end-to-end: import/list/create/delete 与 frontmatter 语义', async () => {
  const skills = await importElectronModule('skills');
  const tmp = await mkdtemp(join(tmpdir(), 'qc-skills-test-'));

  const root = join(tmp, '.chat', 'skills');
  // 外部来源：claude 有 shared + claude-only + folded（块标量描述）；
  // codex 有 shared（应输给 claude）、codex-only、.system 内置（应跳过）。
  const claude = join(tmp, '.claude', 'skills');
  const codex = join(tmp, '.codex', 'skills');
  const sources = [
    ['claude', claude],
    ['codex', codex],
  ];
  await writeSkill(claude, 'shared', 'shared', 'claude 版本');
  await writeSkill(claude, 'claude-only', 'claude-only', '带附件');
  await mkdir(join(claude, 'claude-only'), { recursive: true });
  await writeFile(join(claude, 'claude-only', 'run.sh'), '#!/bin/sh\necho hi\n');
  // Claude 官方 Skill 的折叠块写法：description: > + 缩进多行；
  // 布尔值用首字母大写的 True（js-yaml 同样识别）
  await mkdir(join(claude, 'folded'), { recursive: true });
  await writeFile(
    join(claude, 'folded', 'SKILL.md'),
    '---\nname: folded\ndescription: >\n  第一行说明\n  第二行：带冒号与 "引号"\ndisable-model-invocation: True\n---\n\n# folded\n',
  );
  await writeSkill(codex, 'shared', 'shared', 'codex 版本');
  await writeSkill(codex, 'codex-only', 'codex-only', 'codex 独有');
  await writeSkill(codex, '.system/sys', 'sys', '内置应跳过');

  try {
    // 内置 Skill：首次写入，且写入标记
    await skills.ensureBuiltinSkillAt(root);
    assert.ok((await stat(join(root, 'quick-chat-skill-guide', 'SKILL.md'))).isFile());
    const guide = await skills.readSkillAt(root, 'quick-chat-skill-guide');
    assert.ok(guide.includes('Managing Skills in Quick Chat'));

    // 导入：claude 优先、跳过 .system、跳过已存在
    const report = await skills.importExternalSkillsAt(root, sources);
    assert.equal(report.imported.length, 4);
    const names = new Set(report.imported.map((i) => i.name));
    assert.ok(names.has('shared') && names.has('claude-only') && names.has('folded') && names.has('codex-only'));
    const shared = report.imported.find((i) => i.name === 'shared');
    assert.equal(shared.source, 'claude');
    assert.ok(!(await stat(join(root, 'sys')).catch(() => null)));

    // 附属文件被完整复制
    assert.ok((await stat(join(root, 'claude-only', 'run.sh'))).isFile());
    assert.equal((await readFile(join(root, 'shared', '.source'), 'utf8')).trim(), 'claude');

    // 重复导入：全部跳过（claude 3 个 + codex 2 个），不覆盖
    const report2 = await skills.importExternalSkillsAt(root, sources);
    assert.equal(report2.imported.length, 0);
    assert.equal(report2.skipped_existing.length, 5);

    // 列表：frontmatter 解析 + 来源标记
    const list = await skills.listSkillsAt(root);
    assert.equal(list.length, 5); // guide + 4 导入
    const claudeOnly = list.find((s) => s.id === 'claude-only');
    assert.equal(claudeOnly.description, '带附件');
    assert.equal(claudeOnly.has_assets, true);
    // 折叠块标量描述按 Claude（js-yaml）语义折叠为单行
    const folded = list.find((s) => s.id === 'folded');
    assert.equal(folded.description, '第一行说明 第二行：带冒号与 "引号"');
    assert.equal(folded.disable_model_invocation, true);
    const guideMeta = list.find((s) => s.id === 'quick-chat-skill-guide');
    assert.equal(guideMeta.source, 'builtin');
    assert.equal(guideMeta.has_assets, false);
    // 内置指南自身也用折叠块写法，解析结果不应残留 ">"
    assert.ok(guideMeta.description.startsWith('How to manage skills'));
    assert.ok(!guideMeta.description.includes('>'));

    // 新建：slug 化 + 重名拒绝 + disable-model-invocation 写入与解析
    const slug = await skills.createSkillAt(root, 'My Skill', '测试', '# 你好', false);
    assert.equal(slug, 'my-skill');
    const created = await skills.readSkillAt(root, 'my-skill');
    assert.ok(created.includes('name: my-skill') && created.includes('# 你好'));
    await assert.rejects(() => skills.createSkillAt(root, 'my-skill', '', '', false), /已存在/);

    await skills.createSkillAt(root, 'manual-only', '仅手动', '', true);
    const list2 = await skills.listSkillsAt(root);
    assert.equal(list2.find((s) => s.id === 'manual-only').disable_model_invocation, true);
    assert.equal(list2.find((s) => s.id === 'my-skill').disable_model_invocation, false);

    // 含冒号/引号的描述写入字面量块标量（|-），保证 Claude 的 YAML 解析一致
    const colonDesc = '使用时机：当用户说 "帮我做简历" 时';
    await skills.createSkillAt(root, 'colon-desc', colonDesc, '', false);
    const colonFile = await skills.readSkillAt(root, 'colon-desc');
    assert.ok(colonFile.includes('description: |-\n  使用时机：当用户说 "帮我做简历" 时\n'));
    const list3 = await skills.listSkillsAt(root);
    assert.equal(list3.find((s) => s.id === 'colon-desc').description, colonDesc);

    // 删除 + 路径穿越防护
    await skills.deleteSkillAt(root, 'my-skill');
    await skills.deleteSkillAt(root, 'manual-only');
    await skills.deleteSkillAt(root, 'colon-desc');
    assert.equal(await stat(join(root, 'my-skill')).catch(() => null), null);
    await assert.rejects(() => skills.deleteSkillAt(root, '../..'), /非法的 Skill 名称/);
    await assert.rejects(() => skills.readSkillAt(root, '../..'), /非法的 Skill 名称/);

    // 内置 Skill 版本语义：同版本不重写；用户删除后不复活；清标记后重装
    const guideBefore = await readFile(join(root, 'quick-chat-skill-guide', 'SKILL.md'), 'utf8');
    await skills.ensureBuiltinSkillAt(root);
    assert.equal(await readFile(join(root, 'quick-chat-skill-guide', 'SKILL.md'), 'utf8'), guideBefore);
    await rm(join(root, 'quick-chat-skill-guide'), { recursive: true });
    await skills.ensureBuiltinSkillAt(root);
    assert.equal(await stat(join(root, 'quick-chat-skill-guide')).catch(() => null), null);
    await rm(join(root, '.builtin-installed'));
    await skills.ensureBuiltinSkillAt(root);
    assert.ok((await stat(join(root, 'quick-chat-skill-guide', 'SKILL.md'))).isFile());
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('frontmatter 解析：引号标量、注释剥离、续行折叠', async () => {
  const skills = await importElectronModule('skills');

  // 双引号标量 + 转义
  const quoted = skills.parseFrontmatter('---\nname: "hello \\"world\\""\ndescription: test\n---\n');
  assert.equal(quoted.name, 'hello "world"');

  // 单引号标量（'' 转义）
  const single = skills.parseFrontmatter("---\nname: 'it''s'\n---\n");
  assert.equal(single.name, "it's");

  // 普通标量的注释剥离（# 前必须有空格）
  const comment = skills.parseFrontmatter('---\nname: abc # 注释\ndescription: x#y\n---\n');
  assert.equal(comment.name, 'abc');
  assert.equal(comment.description, 'x#y');

  // 更缩进续行折叠进标量
  const folded = skills.parseFrontmatter('---\ndescription: 第一行\n  第二段\n  第三段\nname: n\n---\n');
  assert.equal(folded.description, '第一行 第二段 第三段');
  assert.equal(folded.name, 'n');

  // disable 语义值
  const disable = skills.parseFrontmatter('---\ndisable-model-invocation: yes\n---\n');
  assert.equal(disable.disable_model_invocation, true);
  const disableUnderscore = skills.parseFrontmatter('---\ndisable_model_invocation: "1"\n---\n');
  assert.equal(disableUnderscore.disable_model_invocation, true);

  // 无 frontmatter
  assert.deepEqual(skills.parseFrontmatter('# 正文'), { disable_model_invocation: false });
});

test('listSkillsAt 按名称排序且容忍缺 SKILL.md 的目录', async () => {
  const skills = await importElectronModule('skills');
  const tmp = await mkdtemp(join(tmpdir(), 'qc-skills-list-'));
  try {
    const root = join(tmp, 'skills');
    await writeSkill(root, 'zzz', 'Alpha', 'a');
    await writeSkill(root, 'aaa', 'beta', 'b');
    await mkdir(join(root, 'empty-dir'), { recursive: true });
    const list = await skills.listSkillsAt(root);
    assert.deepEqual(list.map((s) => s.name), ['Alpha', 'beta']);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
