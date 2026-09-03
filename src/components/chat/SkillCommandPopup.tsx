import React from 'react';
import type { SkillMeta } from '@/services/skills';

interface SkillCommandPopupProps {
  /** 过滤后的候选 Skill 列表 */
  skills: SkillMeta[];
  /** 当前高亮索引 */
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (skill: SkillMeta) => void;
}

/**
 * 斜杠命令补全弹窗：输入框以 / 开头时浮现于输入卡片上方。
 * 视觉与输入卡片一致（#2D2D2D + 细边框 + 大圆角 + 投影）。
 */
const SkillCommandPopup: React.FC<SkillCommandPopupProps> = ({ skills, activeIndex, onHover, onSelect }) => {
  return (
    <div className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[#2D2D2D]/98 shadow-[0_18px_48px_rgba(0,0,0,0.32)] backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2">
      <div className="px-3.5 pt-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-linear-text-tertiary">
        Skills
      </div>
      <div className="max-h-[260px] overflow-y-auto px-1.5 pb-1.5">
        {skills.map((skill, idx) => (
          <button
            key={skill.id}
            onMouseDown={(e) => {
              // 用 mousedown 而非 click，避免输入框先失焦
              e.preventDefault();
              onSelect(skill);
            }}
            onMouseEnter={() => onHover(idx)}
            className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors cursor-pointer ${
              idx === activeIndex ? 'bg-linear-surface-hover' : 'hover:bg-linear-surface'
            }`}
          >
            <span className="shrink-0 text-[13px] font-semibold text-linear-text-primary">
              /{skill.id}
            </span>
            {skill.disable_model_invocation && (
              <span
                className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold bg-linear-surface-hover text-linear-text-tertiary"
                title="已标注 disable-model-invocation，AI 不会自主调用"
              >
                仅手动
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-xs text-linear-text-tertiary">
              {skill.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default SkillCommandPopup;
