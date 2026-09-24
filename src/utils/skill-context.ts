/**
 * Skill 上下文注入工具
 *
 * 用户通过 /skill-id 斜杠命令调用 Skill 时，完整指引以 HTML 注释形式
 * 追加到用户消息末尾并持久化，使整个会话后续轮次都能携带该上下文：
 *
 *   /generate-pdf 帮我做一份简历
 *
 *   <!-- skill-context:generate-pdf
 *   （SKILL.md 完整内容）
 *   -->
 *
 * 与 image-descriptions 一样，UI 渲染前需剥离此注释（react-markdown 默认
 * 会把 HTML 注释转义成可见文本），但发送给 API 的消息保留原文。
 */

const SKILL_CONTEXT_REGEX = /\n*<!--\s*skill-context:[a-zA-Z0-9_-]+\s*\n[\s\S]*?-->/g;

const SKILL_CONTEXT_ID_REGEX = /<!--\s*skill-context:([a-zA-Z0-9_-]+)\s*\n/;

const SKILL_ID_CHARS = 'a-zA-Z0-9_-';

/** 斜杠命令调用形式：/skill-id [参数...]（参数可跨行），与 App.tsx 展开逻辑保持一致 */
const SKILL_INVOCATION_REGEX = new RegExp(`^\\/([${SKILL_ID_CHARS}]+)(?:\\s+([\\s\\S]*))?$`);

/** 剥离消息中的 skill-context 注释块，返回 UI 展示用的纯文本 */
export function stripSkillContext(content: string): string {
  if (!content.includes('skill-context:')) return content;
  return content.replace(SKILL_CONTEXT_REGEX, '').trimEnd();
}

/**
 * 提取消息中 skill-context 注释块的 skill id。
 * 斜杠命令展开失败（skill 加载失败）时消息不含此注释块，返回 null——
 * 因此该返回值同时表示"skill 已成功注入本会话"。
 */
export function getSkillContextId(content: string): string | null {
  const match = content.match(SKILL_CONTEXT_ID_REGEX);
  return match ? match[1] : null;
}

export interface SkillInvocation {
  id: string;
  /** 命令之后的用户输入（已 trim，可能为空字符串） */
  args: string;
}

/** 解析消息文本开头的 /skill-id 斜杠命令；格式不匹配返回 null。
 *  与 App.tsx 展开逻辑一致：命令必须位于文本开头（前导空白不接受） */
export function parseSkillInvocation(text: string): SkillInvocation | null {
  const match = text.match(SKILL_INVOCATION_REGEX);
  if (!match) return null;
  return { id: match[1], args: (match[2] ?? '').trim() };
}
