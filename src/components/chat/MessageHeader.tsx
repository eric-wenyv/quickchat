import React, { useState, useEffect, useRef } from 'react';
import type { Conversation, SystemPrompt, UUID } from '@/types/types';

interface TokenStats {
  totalTokens: number;
  totalInput: number;
  totalOutput: number;
}

interface MessageHeaderProps {
  conversation: Conversation;
  tokenStats: TokenStats;
  onRename: (newTitle: string) => void;
  onUpdateSystemPrompt: (prompt: string | null) => void;
  savedPrompts: SystemPrompt[];
  onSavePrompt: (title: string, content: string) => void;
  onDeletePrompt: (id: UUID) => void;
}

function generateDefaultTitle(existingTitles: string[]): string {
  const base = 'Default Prompt';
  if (!existingTitles.includes(base)) return base;
  let maxNum = 0;
  const regex = /^Default Prompt(\d+)$/;
  for (const t of existingTitles) {
    const match = t.match(regex);
    if (match) {
      maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
  }
  return `${base}${maxNum + 1}`;
}

/**
 * C-2: MessageHeader
 * 对话区顶部栏，展示当前会话标题和模型标识。
 * 功能按钮：会话设置(系统提示词编辑)
 * 集成 Windows 风格窗口控制按钮。
 * 标题可点击编辑重命名。
 */
export const MessageHeader: React.FC<MessageHeaderProps> = ({
  conversation,
  tokenStats,
  onRename,
  onUpdateSystemPrompt,
  savedPrompts,
  onSavePrompt,
  onDeletePrompt,
}) => {
  // ── 标题编辑状态 ──
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(conversation.title);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditTitle(conversation.title);
  }, [conversation.title]);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  const handleTitleClick = () => {
    setEditTitle(conversation.title);
    setIsEditingTitle(true);
  };

  const commitTitle = () => {
    setIsEditingTitle(false);
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== conversation.title) {
      onRename(trimmed);
    } else {
      setEditTitle(conversation.title);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitTitle();
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false);
      setEditTitle(conversation.title);
    }
  };

  // ── 系统提示词弹窗状态 ──
  const [showSystemPromptModal, setShowSystemPromptModal] = useState(false);
  const [systemPromptDraft, setSystemPromptDraft] = useState(conversation.system_prompt || '');
  const [saveTitleDraft, setSaveTitleDraft] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setSystemPromptDraft(conversation.system_prompt || '');
  }, [conversation.system_prompt]);

  useEffect(() => {
    if (showSystemPromptModal && promptTextareaRef.current) {
      promptTextareaRef.current.focus();
    }
  }, [showSystemPromptModal]);

  const handleSaveSystemPrompt = () => {
    const trimmed = systemPromptDraft.trim();
    onUpdateSystemPrompt(trimmed || null);
    setShowSystemPromptModal(false);
  };

  const handleSelectPreset = (id: string) => {
    setSelectedPresetId(id);
    if (!id) return;
    const preset = savedPrompts.find(p => p.id === id);
    if (preset) {
      setSystemPromptDraft(preset.content);
    }
  };

  const handleSavePreset = () => {
    const title = saveTitleDraft.trim() || generateDefaultTitle(savedPrompts.map(p => p.title));
    onSavePrompt(title, systemPromptDraft);
    setSaveTitleDraft('');
  };

  const handleDeletePreset = (id: UUID, e: React.MouseEvent) => {
    e.stopPropagation();
    onDeletePrompt(id);
    if (selectedPresetId === id) {
      setSelectedPresetId('');
    }
  };

  return (
    <>
      <header
        data-tauri-drag-region
        className="sticky top-0 z-30 flex min-h-[56px] items-center justify-between w-full bg-linear-bg/72 backdrop-blur-xl border-b border-linear-border/70 transition-all duration-300 select-none"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* 左侧: 标题 (可点击编辑) + 模型标识 */}
        <div
          className="flex flex-col gap-0.5 min-w-0 py-2.5 pl-5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={handleTitleKeyDown}
              className="text-[15px] font-semibold text-linear-text-primary tracking-tight leading-tight bg-transparent border-b-2 border-linear-border outline-none px-0 py-0 w-full max-w-xs"
              maxLength={100}
            />
          ) : (
            <h1
              onClick={handleTitleClick}
              className="text-[15px] font-semibold text-linear-text-primary truncate tracking-tight leading-tight cursor-pointer hover:text-linear-text-secondary transition-colors"
              title="点击修改标题"
            >
              {conversation.title || '新对话'}
            </h1>
          )}
          <div className="flex items-center gap-2">
            {conversation.system_prompt ? (
              <button
                onClick={() => setShowSystemPromptModal(true)}
                className="text-[9px] bg-linear-surface text-linear-text-tertiary hover:text-linear-text-secondary px-1.5 py-0.5 rounded-md font-medium transition-colors cursor-pointer border border-linear-border hover:border-linear-border-hover"
                title="编辑系统提示词"
              >
                系统提示词
              </button>
            ) : (
              <button
                onClick={() => setShowSystemPromptModal(true)}
                className="text-[9px] text-linear-text-muted hover:text-linear-text-tertiary transition-colors cursor-pointer"
                title="添加系统提示词"
              >
                + 添加系统提示词
              </button>
            )}
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-linear-text-tertiary">
              {tokenStats.totalInput > 0 && (
                <span className="flex items-center gap-0.5" title="累计输入 Token">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>
                  </svg>
                  {tokenStats.totalInput.toLocaleString()}
                </span>
              )}
              {tokenStats.totalOutput > 0 && (
                <span className="flex items-center gap-0.5" title="累计输出 Token">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14"/><path d="M5 12l7 7 7-7"/>
                  </svg>
                  {tokenStats.totalOutput.toLocaleString()}
                </span>
              )}
              {tokenStats.totalTokens > 0 && (
                <span className="text-linear-text-tertiary" title="累计总 Token">
                  ∑ {tokenStats.totalTokens.toLocaleString()}
                </span>
              )}
              {tokenStats.totalTokens === 0 && (
                <span className="text-[10px] font-bold text-linear-text-tertiary uppercase tracking-[0.1em] font-mono">
                  {conversation.model_id}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 右侧留白：窗口按钮由全局 CodexMenuBar 承载 */}
        <div
          className="flex items-center h-full pr-4"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
        </div>
      </header>

      {/* ════════════════════════════════════════════════════════════════════════
          系统提示词编辑弹窗 — 使用 absolute 定位于主区域内部
         ════════════════════════════════════════════════════════════════════════ */}
      {showSystemPromptModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="absolute inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowSystemPromptModal(false)}
        >
          <div
            className="bg-linear-bg-elevated backdrop-blur-xl border border-[rgba(255,255,255,0.08)] shadow-linear-highlight rounded-xl w-full max-w-lg mx-4 animate-in fade-in zoom-in-95 duration-200 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-linear-border flex-shrink-0">
              <div className="flex items-center gap-2">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-linear-text-secondary">
                  <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                <h2 className="text-base font-bold text-linear-text-primary">系统提示词</h2>
              </div>
              <button
                onClick={() => setShowSystemPromptModal(false)}
                className="p-1.5 text-linear-text-tertiary hover:text-linear-text-secondary hover:bg-linear-surface rounded-lg transition-colors cursor-pointer"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            {/* 弹窗内容 */}
            <div className="px-6 py-4 overflow-y-auto">
              {/* 已保存预设选择 */}
              {savedPrompts.length > 0 && (
                <div className="mb-4">
                  <label className="block text-xs font-medium text-linear-text-secondary mb-1.5">
                    选择已保存的提示词
                  </label>
                  <div className="relative">
                    <select
                      value={selectedPresetId}
                      onChange={(e) => handleSelectPreset(e.target.value)}
                      className="w-full bg-linear-surface text-linear-text-secondary text-sm px-3 py-2.5 rounded-lg border border-linear-border focus:border-linear-border-hover outline-none transition-all duration-200 appearance-none cursor-pointer"
                    >
                      <option value="">-- 选择预设 --</option>
                      {savedPrompts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                    <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-linear-text-tertiary pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </div>
                  {savedPrompts.length > 0 && selectedPresetId && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {savedPrompts.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => handleSelectPreset(p.id)}
                          className={`group flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border transition-all cursor-pointer ${
                            selectedPresetId === p.id
                              ? 'bg-linear-accent text-white border-linear-accent'
                              : 'bg-linear-surface text-linear-text-secondary border-linear-border hover:border-linear-border-hover'
                          }`}
                        >
                          <span>{p.title}</span>
                          <span
                            onClick={(e) => handleDeletePreset(p.id, e)}
                            className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity ${
                              selectedPresetId === p.id ? 'hover:bg-white/20' : 'hover:bg-linear-surface-hover'
                            }`}
                            title="删除预设"
                          >
                            ×
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <p className="text-xs text-linear-text-tertiary mb-3">
                设置系统提示词来定义 AI 的行为方式。留空则使用默认行为。
              </p>
              <textarea
                ref={promptTextareaRef}
                value={systemPromptDraft}
                onChange={(e) => setSystemPromptDraft(e.target.value)}
                placeholder="例如：你是一个专业的编程助手，请用中文回复..."
                rows={6}
                className="w-full bg-linear-surface text-linear-text-secondary text-sm placeholder:text-linear-text-muted px-4 py-3 rounded-lg border border-linear-border focus:border-linear-border-hover outline-none transition-all duration-200 resize-none"
              />
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-linear-text-muted">{systemPromptDraft.length} 字符</span>
              </div>

              {/* 保存为新预设 */}
              <div className="mt-4 pt-4 border-t border-linear-border">
                <label className="block text-xs font-medium text-linear-text-secondary mb-1.5">
                  保存为新预设
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={saveTitleDraft}
                    onChange={(e) => setSaveTitleDraft(e.target.value)}
                    placeholder={`留空则使用 "${generateDefaultTitle(savedPrompts.map(p => p.title))}"`}
                    className="flex-1 bg-linear-surface text-linear-text-secondary text-sm placeholder:text-linear-text-muted px-3 py-2 rounded-lg border border-linear-border focus:border-linear-border-hover focus:shadow-input-hover outline-none transition-all duration-200"
                  />
                  <button
                    onClick={handleSavePreset}
                    disabled={!systemPromptDraft.trim()}
                    className="px-4 py-2 text-sm font-medium text-linear-text-primary bg-linear-surface hover:bg-linear-surface-hover disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors cursor-pointer border border-linear-border"
                  >
                    保存
                  </button>
                </div>
                <p className="text-[10px] text-linear-text-muted mt-1">
                  使用相同标题会覆盖已有预设
                </p>
              </div>
            </div>

            {/* 弹窗底部 */}
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-linear-border flex-shrink-0">
              {conversation.system_prompt && (
                <button
                  onClick={() => {
                    setSystemPromptDraft('');
                    onUpdateSystemPrompt(null);
                    setShowSystemPromptModal(false);
                  }}
                  className="px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                >
                  清除
                </button>
              )}
              <button
                onClick={() => setShowSystemPromptModal(false)}
                className="px-4 py-2 text-sm text-linear-text-tertiary hover:text-linear-text-secondary hover:bg-linear-surface rounded-lg transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleSaveSystemPrompt}
                className="px-5 py-2 text-sm font-semibold text-white bg-linear-accent hover:bg-linear-accent-hover rounded-lg transition-colors cursor-pointer"
              >
                应用
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
