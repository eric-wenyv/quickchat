// Skills management

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  disable_model_invocation: boolean;

  source: string;
  path: string;
  has_assets: boolean;
}

export interface ImportedSkill {
  name: string;
  source: string;
}

export interface ImportReport {
  imported: ImportedSkill[];
  skipped_existing: string[];
}

// skill dir: $HOME/.chat/skills
export function skillsRoot(): string {
  return path.join(os.homedir(), ".chat", "skills");
}

// ---------------------------------------------------------------------------
// Path varify
// ---------------------------------------------------------------------------

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
// Frontmatter: name + description + invocation
// ---------------------------------------------------------------------------

interface Frontmatter {
  name?: string;
  description?: string;
  disable_model_invocation: boolean;
}

function scalarString(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trimEnd();
    return t.length > 0 ? t : undefined;
  }
  if (typeof v === "number" || typeof v === "boolean") {
    return String(v);
  }
  return undefined;
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

  let doc: unknown;
  try {
    doc = yaml.load(lines.join("\n"));
  } catch {
    return { disable_model_invocation: false };
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return { disable_model_invocation: false };
  }
  const record = doc as Record<string, unknown>;

  const disableRaw = record["disable-model-invocation"] ?? record["disable_model_invocation"];
  const disable =
    disableRaw === true ||
    disableRaw === 1 ||
    (typeof disableRaw === "string" &&
      ["true", "yes", "on", "1"].includes(disableRaw.toLowerCase()));

  return {
    name: scalarString(record.name),
    description: scalarString(record.description),
    disable_model_invocation: disable,
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
// recur Copy
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
      try {
        const real = await fsp.realpath(srcPath);
        const stat = await fsp.stat(real);
        if (stat.isDirectory()) {
          await copyDirRecursive(real, dstPath);
        } else if (stat.isFile()) {
          await fsp.copyFile(real, dstPath);
        }
      } catch {
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Commands
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
// Ensure description format
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
  const markdown = `---\nname: ${slug}\n${formatDescriptionYaml(description.trim())}${disableLine}---\n\n${body.length === 0 ? `# ${slug}\n` : `${body}\n`
    }`;
  try {
    await fsp.writeFile(path.join(dir, "SKILL.md"), markdown);
  } catch (e) {
    throw new Error(`写入 SKILL.md 失败: ${(e as Error).message}`);
  }
  return slug;
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

// Scan skill dir, return array[dirname, frontmatter name, path]
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

  // Existed skills
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
  }

  // External skills
  for (const [source, dir] of sources) {
    for (const [dirName, fmName, srcPath] of await scanExternalSource(dir)) {
      if (taken.has(dirName) || taken.has(fmName)) {
        report.skipped_existing.push(fmName);
        continue;
      }
      const dst = path.join(root, dirName);
      await copyDirRecursive(srcPath, dst);
      await fsp.writeFile(path.join(dst, ".source"), source).catch(() => { });
      taken.add(dirName);
      taken.add(fmName);
      report.imported.push({ name: fmName, source });
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// Built-in skill
// ---------------------------------------------------------------------------
const BUILTIN_SKILL_ID = "quick-chat-skill-guide";
const BUILTIN_SKILL_VERSION = "5";
async function loadBuiltinSkillContent(): Promise<string> {
  const rel = path.join("assets", "builtin-skills", BUILTIN_SKILL_ID, "SKILL.md");
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return await fsp
    .readFile(path.join(moduleDir, rel), "utf8")
    .catch(() => fsp.readFile(path.join(process.cwd(), "electron", rel), "utf8"));
}
export async function ensureBuiltinSkill(): Promise<void> {
  return ensureBuiltinSkillAt(skillsRoot());
}
// update->update, deleted->none
export async function ensureBuiltinSkillAt(root: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  const flag = path.join(root, ".builtin-installed");
  const installedVersion = (await fsp.readFile(flag, "utf8").catch(() => "")).trim();
  if (installedVersion === BUILTIN_SKILL_VERSION) {
    return;
  }
  const dir = path.join(root, BUILTIN_SKILL_ID);
  const neverInstalled = installedVersion.length === 0;
  if (fs.existsSync(dir) || neverInstalled) {
    let content: string;
    try {
      content = await loadBuiltinSkillContent();
    } catch (e) {
      throw new Error(`读取内置 Skill 资源失败: ${(e as Error).message}`);
    }
    await fsp.mkdir(dir, { recursive: true });
    try {
      await fsp.writeFile(path.join(dir, "SKILL.md"), content);
    } catch (e) {
      throw new Error(`写入内置 Skill 失败: ${(e as Error).message}`);
    }
    await fsp.writeFile(path.join(dir, ".source"), "builtin").catch(() => { });
  }
  await fsp.writeFile(flag, BUILTIN_SKILL_VERSION).catch(() => { });
}
