/**
 * SKILL.md frontmatter 解析（与主进程 electron/skills.ts 的解析器语义一致，
 * 均对齐 Claude（gray-matter + js-yaml）的 YAML 解析结果）。
 *
 * 用于 Skill 内容预览：把文件头部的 frontmatter 字段拆出来交给
 * SkillFrontmatterTable 以表格展示，正文交给消息渲染管线。
 */

export interface SkillFrontmatterField {
  key: string;
  value: string;
}

export interface ParsedSkillFrontmatter {
  fields: SkillFrontmatterField[];
  /** frontmatter 之后的 Markdown 正文 */
  body: string;
}

const KEY_LINE = /^([A-Za-z0-9_-]+):(.*)$/;
/** 块标量头：| 或 > 加可选的缩进指示数字与 -/+ 裁剪指示（如 `>`、`|-`、`|2+`） */
const BLOCK_HEADER = /^([|>])([+-]?\d*[+-]?)?$/;

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** 剥离普通标量行内的注释（YAML：# 注释前必须有空白） */
function stripPlainComment(line: string): string {
  const pos = line.indexOf(' #');
  return pos === -1 ? line : line.slice(0, pos);
}

/**
 * 折叠块标量（>）：相邻非空行以空格连接，空行变为换行，
 * 更缩进的行（相对块缩进还有前导空白）与其前后保留原换行
 */
function foldBlockLines(lines: string[]): string {
  let out = '';
  let prevMoreIndented: boolean | null = null;
  let pendingNewlines = 0;

  for (const line of lines) {
    if (line.trim() === '') {
      pendingNewlines += 1;
      continue;
    }
    const moreIndented = line.startsWith(' ');
    if (prevMoreIndented !== null && pendingNewlines > 0) {
      out += '\n'.repeat(pendingNewlines);
    } else if (prevMoreIndented !== null && (prevMoreIndented || moreIndented)) {
      out += '\n';
    } else if (prevMoreIndented !== null) {
      out += ' ';
    }
    pendingNewlines = 0;
    out += line;
    prevMoreIndented = moreIndented;
  }

  return out;
}

/** 单/双引号标量（按单行尽力解析：'' 与 \" 等转义） */
function unquoteLine(text: string): string {
  const quote = text[0];
  let value = '';

  for (let i = 1; i < text.length; i += 1) {
    const c = text[i];
    if (quote === '"' && c === '\\' && i + 1 < text.length) {
      const next = text[i + 1];
      const mapped =
        next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next === '"' || next === '\\' ? next : undefined;
      if (mapped !== undefined) {
        value += mapped;
        i += 1;
        continue;
      }
    }
    if (c === quote) {
      if (quote === "'" && text[i + 1] === "'") {
        value += "'";
        i += 1;
        continue;
      }
      break;
    }
    value += c;
  }

  return value.trim();
}

/** 普通标量：截掉 # 注释；键值为空或后续行更缩进时，续行折叠进来 */
function plainScalar(block: string[], keyIndex: number, rest: string): { value: string; consumed: number } {
  let value = rest.startsWith('#') ? '' : stripPlainComment(rest).trim();
  let i = keyIndex + 1;
  let pendingNewlines = 0;

  while (i < block.length) {
    const line = block[i];
    if (line.trim() === '') {
      if (value === '') break;
      pendingNewlines += 1;
      i += 1;
      continue;
    }
    if (indentOf(line) === 0) break;
    const cont = stripPlainComment(line).trim();
    if (cont === '') {
      i += 1;
      continue;
    }
    if (value === '' && pendingNewlines === 0) {
      value = cont;
    } else if (pendingNewlines > 0) {
      value += '\n'.repeat(pendingNewlines) + cont;
      pendingNewlines = 0;
    } else {
      value += ' ' + cont;
    }
    i += 1;
  }

  return { value: value.trim(), consumed: i - keyIndex - 1 };
}

/** 解析某个键的标量值，返回 (值, 键行之后额外消耗的行数) */
function parseScalar(block: string[], keyIndex: number, rest: string): { value: string; consumed: number } {
  const trimmed = rest.trim();

  const header = BLOCK_HEADER.exec(trimmed);
  if (header) {
    // 块标量：| 字面量 / > 折叠
    let i = keyIndex + 1;
    let blockIndent: number | null = null;
    const raw: string[] = [];
    while (i < block.length) {
      const line = block[i];
      if (line.trim() === '') {
        raw.push('');
        i += 1;
        continue;
      }
      const ind = indentOf(line);
      if (blockIndent === null) blockIndent = ind;
      if (ind < blockIndent) break;
      raw.push(line.slice(blockIndent));
      i += 1;
    }
    while (raw.length > 0 && raw[raw.length - 1].trim() === '') raw.pop();
    const value = header[1] === '>' ? foldBlockLines(raw) : raw.join('\n');
    return { value: value.trimEnd(), consumed: i - keyIndex - 1 };
  }

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    return { value: unquoteLine(trimmed), consumed: 0 };
  }

  return plainScalar(block, keyIndex, trimmed);
}

/**
 * 解析 SKILL.md 头部的 YAML frontmatter。
 * 无 frontmatter（不以 --- 开头或未闭合）时返回 null。
 */
export function parseSkillFrontmatter(content: string): ParsedSkillFrontmatter | null {
  const lines = content.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  if (lines[0]?.trim() !== '---') return null;

  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (end === -1) return null;

  const block = lines.slice(1, end);
  const fields: SkillFrontmatterField[] = [];
  let i = 0;
  while (i < block.length) {
    const line = block[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      i += 1;
      continue;
    }
    // 只认缩进为 0 的顶层键；嵌套结构（列表等）Skill 元数据用不到，跳过
    if (indentOf(line) > 0) {
      i += 1;
      continue;
    }
    const match = KEY_LINE.exec(line);
    if (!match) {
      i += 1;
      continue;
    }
    const { value, consumed } = parseScalar(block, i, match[2]);
    fields.push({ key: match[1], value });
    i += 1 + consumed;
  }

  return { fields, body: lines.slice(end + 1).join('\n').replace(/^\n+/, '') };
}
