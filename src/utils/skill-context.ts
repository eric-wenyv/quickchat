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

/** 剥离消息中的 skill-context 注释块，返回 UI 展示用的纯文本 */
export function stripSkillContext(content: string): string {
  if (!content.includes('skill-context:')) return content;
  return content.replace(SKILL_CONTEXT_REGEX, '').trimEnd();
}
