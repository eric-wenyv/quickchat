/**
 * SKILL.md frontmatter 解析（js-yaml，与 Claude 的 gray-matter + js-yaml 解析结果一致；
 * 主进程 electron/skills.ts 同样基于 js-yaml）。
 *
 * 用于 Skill 内容预览：把文件头部的 frontmatter 字段拆出来交给
 * SkillFrontmatterTable 以表格展示，正文交给消息渲染管线。
 */

import * as yaml from 'js-yaml';

export interface SkillFrontmatterField {
  key: string;
  value: string;
}

export interface ParsedSkillFrontmatter {
  fields: SkillFrontmatterField[];
  /** frontmatter 之后的 Markdown 正文 */
  body: string;
}

/** 标量值转字符串；嵌套结构（列表/映射）表格不展示，跳过。
 *  字符串去掉尾部空白：js-yaml 的块标量默认保留一个结尾换行，展示时不需要 */
function scalarString(v: unknown): string | null {
  if (typeof v === 'string') return v.trimEnd();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

/**
 * 解析 SKILL.md 头部的 YAML frontmatter。
 * 无 frontmatter（不以 --- 开头、未闭合或 YAML 解析失败）时返回 null。
 */
export function parseSkillFrontmatter(content: string): ParsedSkillFrontmatter | null {
  const lines = content.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  if (lines[0]?.trim() !== '---') return null;

  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (end === -1) return null;

  const body = lines.slice(end + 1).join('\n').replace(/^\n+/, '');

  let doc: unknown;
  try {
    doc = yaml.load(lines.slice(1, end).join('\n'));
  } catch {
    return null;
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { fields: [], body };
  }

  const fields: SkillFrontmatterField[] = [];
  for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
    const s = scalarString(value);
    if (s !== null) {
      fields.push({ key, value: s });
    }
  }

  return { fields, body };
}
