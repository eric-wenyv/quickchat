// =============================================================================
// Quick-Chat — Skill 管理（Electron 主进程）
// =============================================================================
// 逐函数移植自旧 Rust skills 模块，行为与返回形状（serde 输出）一致：
// 桌面端存储 $HOME/.chat/skills/<skill-dir>/SKILL.md；兼容 Claude
// (~/.claude/skills) 与 Codex (~/.codex/skills) 目录格式，导入时整目录复制
// （排除 .git，符号链接解析为目标内容），同名时 Claude 优先。
// frontmatter 解析实现 Skill 实际用到的 YAML 子集（对齐 Claude gray-matter
// + js-yaml 语义）：普通标量（含更缩进续行折叠）、单/双引号标量、块标量
// （| 与 >，含 -/+ 裁剪与数字缩进指示）、# 注释剥离。
// =============================================================================

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// 类型（与 serde Serialize 输出形状一致）
// ---------------------------------------------------------------------------

export interface SkillMeta {
  /** 目录名，稳定 ID */
  id: string;
  /** 展示名称（frontmatter name） */
  name: string;
  description: string;
  /** claude | codex | builtin | local */
  source: string;
  /** Skill 目录的绝对路径 */
  path: string;
  /** 目录中除 SKILL.md 外是否还有其它可见文件（脚本、模板等） */
  has_assets: boolean;
  disable_model_invocation: boolean;
}

export interface ImportedSkill {
  name: string;
  source: string;
}

export interface ImportReport {
  imported: ImportedSkill[];
  skipped_existing: string[];
}

export interface SkillExport {
  id: string;
  content: string;
}

/** 桌面端 Skill 根目录（Rust 侧为 home_dir/.chat/skills） */
export function skillsRoot(): string {
  return path.join(os.homedir(), ".chat", "skills");
}

// ---------------------------------------------------------------------------
// 路径与安全校验
// ---------------------------------------------------------------------------

/** Skill 目录名只允许安全的 slug 字符，杜绝路径穿越 */
export function isValidSkillId(id: string): boolean {
  return (
    id.length > 0 &&
    id.length <= 128 &&
    !id.startsWith(".") &&
    Array.from(id).every((c) => /[A-Za-z0-9]/.test(c) || c === "-" || c === "_")
  );
}

function resolveSkillDir(root: string, id: string): string {
  if (!isValidSkillId(id)) {
    throw new Error(`非法的 Skill 名称: ${id}`);
  }
  return path.join(root, id);
}

// ---------------------------------------------------------------------------
// Frontmatter 解析（对齐 Claude 的 YAML 解析语义）
// ---------------------------------------------------------------------------

interface Frontmatter {
  name?: string;
  description?: string;
  disable_model_invocation: boolean;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** 顶层映射键：`name`、`disable-model-invocation` 等（字母数字_-，冒号前） */
function splitKey(line: string): [string, string] | null {
  const idx = line.indexOf(":");
  if (idx < 0) return null;
  const key = line.slice(0, idx).trim();
  if (
    key.length === 0 ||
    !Array.from(key).every((c) => /[A-Za-z0-9]/.test(c) || c === "-" || c === "_")
  ) {
    return null;
  }
  return [key, line.slice(idx + 1)];
}

/** 块标量头：| 或 > 加可选的缩进指示数字与 -/+ 裁剪指示（如 `>`、`|-`、`|2+`） */
function blockScalarHeader(rest: string): "|" | ">" | null {
  const style = rest.charAt(0);
  if (style !== "|" && style !== ">") return null;
  let seenDigit = false;
  let seenChomp = false;
  for (const c of rest.slice(1)) {
    if (c >= "1" && c <= "9" && !seenDigit) {
      seenDigit = true;
    } else if ((c === "-" || c === "+") && !seenChomp) {
      seenChomp = true;
    } else {
      return null;
    }
  }
  return style;
}

/** 剥离普通标量行内的注释（YAML：# 注释前必须有空白） */
function stripPlainComment(s: string): string {
  const pos = s.indexOf(" #");
  return pos >= 0 ? s.slice(0, pos) : s;
}

/**
 * 折叠块标量（>）：相邻非空行以空格连接，空行变为换行，
 * 更缩进的行（相对块缩进还有前导空白）与其前后保留原换行
 */
function foldBlockLines(lines: string[]): string {
  let out = "";
  let prevMoreIndented: boolean | null = null;
  let pendingNewlines = 0;
  for (const line of lines) {
    if (line.trim().length === 0) {
      pendingNewlines += 1;
      continue;
    }
    const moreIndented = line.startsWith(" ");
    if (prevMoreIndented !== null && pendingNewlines > 0) {
      out += "\n".repeat(pendingNewlines);
    } else if (prevMoreIndented !== null && (prevMoreIndented || moreIndented)) {
      out += "\n";
    } else if (prevMoreIndented !== null) {
      out += " ";
    }
    pendingNewlines = 0;
    out += line;
    prevMoreIndented = moreIndented;
  }
  return out;
}

/** 解析某个键的标量值，返回 [值, 键行之后额外消耗的行数] */
function parseScalarValue(lines: string[], keyIndex: number, rest: string): [string, number] {
  rest = rest.trim();

  // 块标量：| 字面量 / > 折叠
  const style = blockScalarHeader(rest);
  if (style !== null) {
    let i = keyIndex + 1;
    let blockIndent: number | null = null;
    const raw: string[] = [];
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim().length === 0) {
        raw.push("");
        i += 1;
        continue;
      }
      const ind = indentOf(line);
      if (blockIndent === null) {
        blockIndent = ind;
      }
      if (ind < blockIndent) {
        break;
      }
      raw.push(line.slice(blockIndent));
      i += 1;
    }
    while (raw.length > 0 && raw[raw.length - 1].trim().length === 0) {
      raw.pop();
    }
    const value = style === ">" ? foldBlockLines(raw) : raw.join("\n");
    return [value.trimEnd(), i - keyIndex - 1];
  }

  // 引号标量（按单行尽力解析：'' 与 \" 等转义）
  const first = rest.charAt(0);
  if (first === '"' || first === "'") {
    let value = "";
    const chars = Array.from(rest.slice(1));
    let i = 0;
    while (i < chars.length) {
      const c = chars[i];
      i += 1;
      if (first === '"' && c === "\\") {
        const next = i < chars.length ? chars[i] : null;
        if (next === null) {
          value += "\\";
        } else {
          i += 1;
          if (next === "n") value += "\n";
          else if (next === "t") value += "\t";
          else if (next === "r") value += "\r";
          else if (next === '"') value += '"';
          else if (next === "\\") value += "\\";
          else {
            value += "\\";
            value += next;
          }
        }
        continue;
      }
      if (c === first) {
        // 单引号内 '' 转义为 '
        if (first === "'" && i < chars.length && chars[i] === "'") {
          i += 1;
          value += "'";
          continue;
        }
        break;
      }
      value += c;
    }
    return [value.trim(), 0];
  }

  // 普通标量：截掉 # 注释；键值为空或后续行更缩进时，续行折叠进来
  let value = rest.startsWith("#") ? "" : stripPlainComment(rest).trim();
  let i = keyIndex + 1;
  let pendingNewlines = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().length === 0) {
      if (value.length === 0) {
        break;
      }
      pendingNewlines += 1;
      i += 1;
      continue;
    }
    if (indentOf(line) === 0) {
      break;
    }
    const cont = stripPlainComment(line).trim();
    if (cont.length === 0) {
      i += 1;
      continue;
    }
    if (value.length === 0 && pendingNewlines === 0) {
      value = cont;
    } else if (pendingNewlines > 0) {
      value += "\n".repeat(pendingNewlines);
      value += cont;
      pendingNewlines = 0;
    } else {
      value += " ";
      value += cont;
    }
    i += 1;
  }
  return [value.trim(), i - keyIndex - 1];
}

export function parseFrontmatter(content: string): Frontmatter {
  const trimmed = content.trimStart();
  const iter = trimmed.split("\n");
  const first = iter.length > 0 ? iter[0] : undefined;
  if (first === undefined || first.trim() !== "---") {
    return { disable_model_invocation: false };
  }
  const all = iter.slice(1).map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  const endIdx = all.findIndex((l) => l.trim() === "---");
  const lines = endIdx >= 0 ? all.slice(0, endIdx) : all;

  const fields: Array<[string, string]> = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().length === 0 || line.trimStart().startsWith("#")) {
      i += 1;
      continue;
    }
    // 只认缩进为 0 的顶层键；嵌套结构（列表等）Skill 元数据用不到，跳过
    if (indentOf(line) > 0) {
      i += 1;
      continue;
    }
    const kv = splitKey(line);
    if (kv === null) {
      i += 1;
      continue;
    }
    const [key, rest] = kv;
    const [value, consumed] = parseScalarValue(lines, i, rest);
    fields.push([key, value]);
    i += 1 + consumed;
  }

  const get = (k: string): string | undefined => {
    const hit = fields.find(([key]) => key === k);
    return hit ? hit[1] : undefined;
  };
  const disableRaw = get("disable-model-invocation") ?? get("disable_model_invocation");
  return {
    name: get("name") || undefined,
    description: get("description") || undefined,
    disable_model_invocation:
      disableRaw !== undefined && ["true", "yes", "on", "1"].includes(disableRaw.toLowerCase()),
  };
}

async function readSource(dir: string): Promise<string> {
  try {
    const s = (await fsp.readFile(path.join(dir, ".source"), "utf8")).trim();
    return s.length > 0 ? s : "local";
  } catch {
    return "local";
  }
}

async function dirHasAssets(dir: string): Promise<boolean> {
  try {
    const entries = await fsp.readdir(dir);
    return entries.some((n) => n !== "SKILL.md" && !n.startsWith("."));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 递归复制（排除 .git；符号链接解析为目标内容复制，保证链接类 Skill 可用）
// ---------------------------------------------------------------------------

async function copyDirRecursive(src: string, dst: string): Promise<void> {
  await fsp.mkdir(dst, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, dstPath);
    } else if (entry.isFile()) {
      await fsp.copyFile(srcPath, dstPath);
    } else if (entry.isSymbolicLink()) {
      // 解析符号链接：复制其指向的实际内容，保证 Skill 迁移后仍然完整
      try {
        const real = await fsp.realpath(srcPath);
        const stat = await fsp.stat(real);
        if (stat.isDirectory()) {
          await copyDirRecursive(real, dstPath);
        } else if (stat.isFile()) {
          await fsp.copyFile(real, dstPath);
        }
      } catch {
        // 悬空链接：跳过（Rust 侧 metadata 失败亦静默跳过）
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Commands（*_at 变体与 Rust 对齐，便于测试传入临时根目录）
// ---------------------------------------------------------------------------

export async function listSkills(): Promise<SkillMeta[]> {
  return listSkillsAt(skillsRoot());
}

export async function listSkillsAt(root: string): Promise<SkillMeta[]> {
  await fsp.mkdir(root, { recursive: true });

  const skills: SkillMeta[] = [];
  const entries = await fsp.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dirName = entry.name;
    if (dirName.startsWith(".")) {
      continue;
    }
    const dir = path.join(root, dirName);
    const skillMd = path.join(dir, "SKILL.md");
    try {
      if (!(await fsp.stat(skillMd)).isFile()) {
        continue;
      }
    } catch {
      continue;
    }
    const content = await fsp.readFile(skillMd, "utf8").catch(() => "");
    const fm = parseFrontmatter(content);
    skills.push({
      id: dirName,
      name: fm.name ?? dirName,
      description: fm.description ?? "",
      source: await readSource(dir),
      path: dir,
      has_assets: await dirHasAssets(dir),
      disable_model_invocation: fm.disable_model_invocation,
    });
  }
  skills.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return skills;
}

export async function readSkill(id: string): Promise<string> {
  return readSkillAt(skillsRoot(), id);
}

export async function readSkillAt(root: string, id: string): Promise<string> {
  const dir = resolveSkillDir(root, id);
  try {
    return await fsp.readFile(path.join(dir, "SKILL.md"), "utf8");
  } catch (e) {
    throw new Error(`读取 Skill 失败: ${(e as Error).message}`);
  }
}

/** 描述内联写入 YAML 是否安全（不含冒号/井号/引号等特殊字符、不以空白结尾） */
function isPlainInlineSafe(s: string): boolean {
  return (
    s.length > 0 &&
    !s.startsWith(" ") &&
    !s.startsWith("\t") &&
    !s.startsWith("#") &&
    !s.startsWith("- ") &&
    !s.startsWith("? ") &&
    !s.startsWith(": ") &&
    !s.endsWith(" ") &&
    !s.endsWith("\t") &&
    !Array.from(s).some((c) =>
      [
        ":",
        "#",
        '"',
        "'",
        "\n",
        "\r",
        "{",
        "}",
        "[",
        "]",
        ",",
        "&",
        "*",
        "!",
        "|",
        ">",
        "%",
        "@",
        "`",
      ].includes(c),
    )
  );
}

/**
 * 序列化 description 字段：简单文本内联单行；含特殊字符时改用字面量块标量
 * （|-），保证 Claude / Codex 的 YAML 解析器读到的文本与用户输入完全一致
 */
function formatDescriptionYaml(desc: string): string {
  if (isPlainInlineSafe(desc)) {
    return `description: ${desc}\n`;
  }
  if (desc.length === 0) {
    return 'description: ""\n';
  }
  const indented = desc
    .split("\n")
    .map((l) => (l.length === 0 ? "" : `  ${l}`))
    .join("\n");
  return `description: |-\n${indented}\n`;
}

export async function createSkill(
  name: string,
  description: string,
  content: string,
  disableModelInvocation = false,
): Promise<string> {
  return createSkillAt(skillsRoot(), name, description, content, disableModelInvocation);
}

export async function createSkillAt(
  root: string,
  name: string,
  description: string,
  content: string,
  disableModelInvocation: boolean,
): Promise<string> {
  const slug = name
    .trim()
    .toLowerCase()
    .split("")
    .map((c) => (/[a-z0-9]/.test(c) || c === "-" || c === "_" ? c : "-"))
    .join("")
    .split("-")
    .filter((s) => s.length > 0)
    .join("-");
  if (!isValidSkillId(slug)) {
    throw new Error("名称无效：请使用字母、数字、连字符或下划线");
  }
  const dir = resolveSkillDir(root, slug);
  if (fs.existsSync(dir)) {
    throw new Error(`Skill "${slug}" 已存在`);
  }
  await fsp.mkdir(dir, { recursive: true });
  const body = content.trim();
  const disableLine = disableModelInvocation ? "disable-model-invocation: true\n" : "";
  const markdown = `---\nname: ${slug}\n${formatDescriptionYaml(description.trim())}${disableLine}---\n\n${
    body.length === 0 ? `# ${slug}\n` : `${body}\n`
  }`;
  try {
    await fsp.writeFile(path.join(dir, "SKILL.md"), markdown);
  } catch (e) {
    throw new Error(`写入 SKILL.md 失败: ${(e as Error).message}`);
  }
  return slug;
}

/** 同步通道专用：按 id 写入/覆盖 SKILL.md（内容原样落盘，不动附属文件） */
export async function upsertSkillFromSync(id: string, content: string): Promise<void> {
  const root = skillsRoot();
  if (!isValidSkillId(id)) {
    throw new Error(`非法的 Skill 名称: ${id}`);
  }
  await fsp.mkdir(path.join(root, id), { recursive: true });
  try {
    await fsp.writeFile(path.join(root, id, "SKILL.md"), content);
  } catch (e) {
    throw new Error(`写入 SKILL.md 失败: ${(e as Error).message}`);
  }
}

/** 同步通道专用：导出全部 Skill（id + SKILL.md 原文，附属文件暂不同步） */
export async function exportSkillsForSync(root: string): Promise<SkillExport[]> {
  const metas = await listSkillsAt(root);
  const out: SkillExport[] = [];
  for (const meta of metas) {
    try {
      const content = await readSkillAt(root, meta.id);
      out.push({ id: meta.id, content });
    } catch {
      // 单个读取失败不阻塞整体导出
    }
  }
  return out;
}

export async function deleteSkill(id: string): Promise<void> {
  return deleteSkillAt(skillsRoot(), id);
}

export async function deleteSkillAt(root: string, id: string): Promise<void> {
  const dir = resolveSkillDir(root, id);
  if (!fs.existsSync(dir) || !(await fsp.stat(dir)).isDirectory()) {
    throw new Error(`Skill "${id}" 不存在`);
  }
  try {
    await fsp.rm(dir, { recursive: true });
  } catch (e) {
    throw new Error(`删除 Skill 失败: ${(e as Error).message}`);
  }
}

/** 扫描一个外部 Skill 来源目录，返回 [目录名, frontmatter name, 源路径] 列表 */
async function scanExternalSource(dir: string): Promise<Array<[string, string, string]>> {
  const found: Array<[string, string, string]> = [];
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dirName = entry.name;
    // 跳过隐藏目录（包括 Codex 的 .system 内置 skills）
    if (dirName.startsWith(".")) {
      continue;
    }
    const dirPath = path.join(dir, dirName);
    try {
      if (!(await fsp.stat(path.join(dirPath, "SKILL.md"))).isFile()) {
        continue;
      }
    } catch {
      continue;
    }
    const fmName =
      (await fsp.readFile(path.join(dirPath, "SKILL.md"), "utf8")
        .then((c) => parseFrontmatter(c).name)
        .catch(() => undefined)) ?? dirName;
    found.push([dirName, fmName, dirPath]);
  }
  return found;
}

/** 外部 Skill 来源目录（桌面端），已按优先级排序：同名时 Claude 优先 */
export function externalSkillSources(): Array<[string, string]> {
  const home = os.homedir();
  return [
    ["claude", path.join(home, ".claude", "skills")],
    ["codex", path.join(home, ".codex", "skills")],
  ];
}

export async function importExternalSkills(): Promise<ImportReport> {
  return importExternalSkillsAt(skillsRoot(), externalSkillSources());
}

export async function importExternalSkillsAt(
  root: string,
  sources: Array<[string, string]>,
): Promise<ImportReport> {
  await fsp.mkdir(root, { recursive: true });

  const report: ImportReport = { imported: [], skipped_existing: [] };

  // 已占用的名称（目录名 + frontmatter name），Claude 先扫描，因此同名时 Claude 优先
  const taken = new Set<string>();
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const dirName = entry.name;
      taken.add(dirName);
      const content = await fsp
        .readFile(path.join(root, dirName, "SKILL.md"), "utf8")
        .catch(() => null);
      if (content !== null) {
        const fmName = parseFrontmatter(content).name;
        if (fmName) {
          taken.add(fmName);
        }
      }
    }
  } catch {
    // 读取失败视为无已占用名称
  }

  // 传入的 sources 已按优先级排序：同名冲突时排在前面的来源胜出
  for (const [source, dir] of sources) {
    for (const [dirName, fmName, srcPath] of await scanExternalSource(dir)) {
      if (taken.has(dirName) || taken.has(fmName)) {
        report.skipped_existing.push(fmName);
        continue;
      }
      const dst = path.join(root, dirName);
      await copyDirRecursive(srcPath, dst);
      await fsp.writeFile(path.join(dst, ".source"), source).catch(() => {});
      taken.add(dirName);
      taken.add(fmName);
      report.imported.push({ name: fmName, source });
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// 内置 Skill：Skill 使用/导入指南
// ---------------------------------------------------------------------------

const BUILTIN_SKILL_ID = "quick-chat-skill-guide";

/** 内置 Skill 内容版本：升级内容时递增，ensure_builtin_skill 会就地更新旧版本 */
const BUILTIN_SKILL_VERSION = "4";

const BUILTIN_SKILL_MD = `---
name: quick-chat-skill-guide
description: >
  Quick Chat Skill 使用指南：斜杠命令与 AI 自主调用、从 Claude / Codex 导入 Skill、
  新建 Skill、目录结构与 SKILL.md frontmatter 规范。Use when the user asks how to
  create, import, preview, or invoke skills in Quick Chat, or how SKILL.md works.
---

# Quick Chat Skill 指南

## 什么是 Skill

Skill 是一个以 Markdown 描述的能力包，遵循 Claude / Codex 的 Skill 目录规范。
每个 Skill 是一个文件夹，其中必须包含一个 \`SKILL.md\`，还可以携带脚本、模板、参考文档等附属文件。

## 在对话中调用 Skill

有两种调用方式：

1. **用户主动调用（斜杠命令）**：在输入框输入 \`/\` 会弹出 Skill 列表，选择后发送，
   例如 \`/generate-pdf 帮我做一份简历\`。该 Skill 的完整指引会随这条消息注入对话，
   并在整个会话中持续生效（消息里的 HTML 注释携带指引，界面上不可见）。
2. **AI 自主调用**：发送消息时，模型会看到可调用 Skill 的目录（名称 + 描述），
   当请求与某个 Skill 的用途匹配时，模型会通过 \`use_skill\` 工具自动加载其完整指引并遵循。

### 禁止 AI 自主调用

在 \`SKILL.md\` 的 frontmatter 中加入（Claude 规范字段，\`true\` = 禁止，缺省或 \`false\` = 允许）：

\`\`\`markdown
---
name: my-skill
description: …
disable-model-invocation: true
---
\`\`\`

标注后该 Skill 不会出现在 AI 的可用目录中，只能由用户通过 \`/my-skill\` 主动调用。
新建 Skill 时勾选「仅手动调用」也会写入此字段。
直接编辑 SKILL.md 增删该字段无需重启：下一条消息发送时会重新扫描并即时生效。

## 目录结构

\`\`\`
~/.chat/skills/
└── <skill-name>/
    ├── SKILL.md        # 必需：Skill 说明（含 frontmatter）
    ├── scripts/        # 可选：bash/python 等辅助脚本
    └── templates/      # 可选：模板、参考文件
\`\`\`

\`SKILL.md\` 开头的 frontmatter（YAML）定义名称与描述，遵循 Claude Skill 规范：

- \`name\`：小写字母、数字、连字符，与目录名一致
- \`description\`：说明这个 Skill 做什么、什么时候用（when to use / triggers），上限 1024 字符
- 较长的描述推荐用 \`>\` 折叠块写法：源码里分多行书写，解析时自动折叠成一行

\`\`\`markdown
---
name: my-skill
description: >
  一句话说明这个 Skill 做什么、什么时候用（when to use / triggers）。
---

# 正文：具体的使用指引……
\`\`\`

## 如何导入 Skill

1. **自动导入**：应用启动时会自动扫描 \`~/.claude/skills/\` 与 \`~/.codex/skills/\`，
   把新增的 Skill 复制到 \`~/.chat/skills/\`。两边同名时优先导入 Claude 的版本；
   本地已存在的同名 Skill 不会被覆盖。
2. **手动导入**：在 Skill 管理界面点击右上角「导入 Claude/Codex」按钮，立即重新扫描。
3. **手动复制**：直接把任何符合规范的 Skill 文件夹拷贝到 \`~/.chat/skills/\` 即可被识别。
4. **新建**：点击「新建 Skill」，填写名称、描述和 Markdown 内容，会自动写入 \`~/.chat/skills/\`。

## 在 Skill 管理界面

点击侧边栏的 Skills 图标进入管理界面：左侧列表悬浮可查看描述，点击可预览完整内容；
「在对话中使用」会新建一个对话并把该 Skill 作为系统提示词注入。

> 注意：Quick Chat 是对话应用，只注入 Skill 的文本内容，**不会执行**其中的 bash/python 脚本。
> 包含可执行脚本的 Skill（如需要跑命令的场景）请在 Claude Code / Codex 中使用；
> 本应用会完整保留这些文件，方便随时在文件管理器中查看或拷回。
`;

export async function ensureBuiltinSkill(): Promise<void> {
  return ensureBuiltinSkillAt(skillsRoot());
}

/**
 * 首次运行时写入内置 Skill；内容升级时就地更新（用户已删除的则不复活）。
 * 通过 \`.builtin-installed\` 标记文件记录已安装的版本。
 */
export async function ensureBuiltinSkillAt(root: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  const flag = path.join(root, ".builtin-installed");
  const installedVersion = (await fsp.readFile(flag, "utf8").catch(() => "")).trim();
  if (installedVersion === BUILTIN_SKILL_VERSION) {
    return;
  }
  const dir = path.join(root, BUILTIN_SKILL_ID);
  // 目录存在则升级内容；目录不存在但只有旧版本标记，说明用户删过旧版 ——
  // 若从未安装过（无标记），则全新写入。
  const neverInstalled = installedVersion.length === 0;
  if (fs.existsSync(dir) || neverInstalled) {
    await fsp.mkdir(dir, { recursive: true });
    try {
      await fsp.writeFile(path.join(dir, "SKILL.md"), BUILTIN_SKILL_MD);
    } catch (e) {
      throw new Error(`写入内置 Skill 失败: ${(e as Error).message}`);
    }
    await fsp.writeFile(path.join(dir, ".source"), "builtin").catch(() => {});
  }
  await fsp.writeFile(flag, BUILTIN_SKILL_VERSION).catch(() => {});
}
