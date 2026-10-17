import React, { useState } from 'react';

interface SkillFormProps {
  onSave: (name: string, description: string, content: string, disableModelInvocation: boolean) => void;
  onClose: () => void;
}

/**
 * 新建 Skill 弹窗：名称（slug）、描述、Markdown 正文、是否仅手动调用。
 * 视觉与 SettingsPanel / Toast 保持一致：elevated 背景 + 细边框 + 圆角。
 */
const SkillForm: React.FC<SkillFormProps> = ({ onSave, onClose }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [disableModelInvocation, setDisableModelInvocation] = useState(false);

  const canSave = name.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    onSave(name.trim(), description.trim(), content, disableModelInvocation);
  };

  const inputClass =
    'w-full rounded-md border border-linear-border bg-linear-bg px-3 py-2 text-sm text-linear-text-primary placeholder:text-linear-text-muted outline-none transition-colors focus:border-linear-border-hover';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="flex w-[min(560px,calc(100vw-2rem))] max-h-[85vh] flex-col gap-4 rounded-xl border border-linear-border bg-linear-bg-elevated p-5 shadow-[0_18px_48px_rgba(0,0,0,0.35)]"
      >
        <h2 className="text-[15px] font-semibold text-linear-text-primary">新建 Skill</h2>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-linear-text-secondary">名称</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如 my-skill（会转为小写 slug）"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-linear-text-secondary">描述</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="一句话说明这个 Skill 的用途（悬浮在列表项上时显示）"
            className={inputClass}
          />
        </label>

        <label className="flex min-h-0 flex-1 flex-col gap-1.5">
          <span className="text-xs font-medium text-linear-text-secondary">内容（Markdown）</span>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={'# My Skill\n\n在这里编写 Skill 的具体指引……'}
            className={`${inputClass} min-h-[180px] flex-1 resize-none font-mono leading-relaxed`}
          />
        </label>

        <label className="flex cursor-pointer items-center gap-2.5 select-none">
          <input
            type="checkbox"
            checked={disableModelInvocation}
            onChange={(e) => setDisableModelInvocation(e.target.checked)}
            className="h-3.5 w-3.5 accent-linear-text-primary cursor-pointer"
          />
          <span className="text-xs text-linear-text-secondary">
            仅手动调用（写入 <code className="text-linear-text-tertiary">disable-model-invocation</code>，AI 不会自主调用，只能通过 / 命令使用）
          </span>
        </label>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3.5 py-1.5 text-[13px] font-semibold text-linear-text-secondary transition-colors hover:bg-linear-surface-hover hover:text-linear-text-primary cursor-pointer"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="rounded-md bg-linear-text-primary px-3.5 py-1.5 text-[13px] font-semibold text-linear-bg transition-opacity disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
          >
            保存
          </button>
        </div>
      </form>
    </div>
  );
};

export default SkillForm;
