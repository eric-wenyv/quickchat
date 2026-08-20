import { useSyncExternalStore } from 'react';
import { getSkillsSnapshot, subscribeSkills, type SkillMeta } from '@/services/skills';

/**
 * 订阅全局 Skill 列表缓存（由 refreshSkills() 填充/更新）。
 * 用于聊天输入框的 / 命令补全、Skill 管理界面等。
 */
export function useSkills(): SkillMeta[] {
  return useSyncExternalStore(subscribeSkills, getSkillsSnapshot);
}
