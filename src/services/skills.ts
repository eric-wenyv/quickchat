// =============================================================================
// Quick-Chat — Skill Service
// =============================================================================
// Skill 的增删查、Claude/Codex 导入，均通过桥命令操作 ~/.chat/skills/
// （handler 在阶段 2 补齐，当前调用会抛 "not implemented yet"）。
// =============================================================================

import { invoke } from '@/services/bridge';

export type SkillSource = 'claude' | 'codex' | 'builtin' | 'local';

export interface SkillMeta {
  /** 目录名，稳定 ID（读取/删除使用） */
  id: string;
  /** 展示名称（frontmatter name） */
  name: string;
  description: string;
  source: SkillSource | string;
  /** Skill 目录绝对路径 */
  path: string;
  /** 除 SKILL.md 外是否还有附属文件（脚本/模板等） */
  has_assets: boolean;
  /** frontmatter `disable-model-invocation`：禁止 AI 自主调用，仅用户 / 调用 */
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

export const listSkills = () => invoke<SkillMeta[]>('list_skills');

export const readSkill = (id: string) => invoke<string>('read_skill', { id });

export const createSkill = (name: string, description: string, content: string, disableModelInvocation = false) =>
  invoke<string>('create_skill', { name, description, content, disableModelInvocation });

export const deleteSkill = (id: string) => invoke<void>('delete_skill', { id });

export const importExternalSkills = () => invoke<ImportReport>('import_external_skills');

export const ensureBuiltinSkill = () => invoke<void>('ensure_builtin_skill');

// =============================================================================
// 全局 Skill 列表缓存（启动时刷新；管理界面增删/导入后同步刷新）
// 聊天输入框（/ 补全）与发送链路（AI 自主调用目录）共享这份只读快照。
// =============================================================================

let skillsCache: SkillMeta[] = [];
const listeners = new Set<() => void>();

export function getSkillsSnapshot(): SkillMeta[] {
  return skillsCache;
}

/** AI 可自主调用的 Skill（排除 disable-model-invocation） */
export function getAutoInvocableSkills(): SkillMeta[] {
  return skillsCache.filter(s => !s.disable_model_invocation);
}

export function subscribeSkills(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function refreshSkills(): Promise<SkillMeta[]> {
  const list = await listSkills();
  skillsCache = list;
  listeners.forEach(l => l());
  return list;
}
