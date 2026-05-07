import React, { useState, useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Conversation } from '@/types/types';

interface MessageHeaderProps {
  conversation: Conversation;
  onRename: (newTitle: string) => void;
  onUpdateSystemPrompt: (prompt: string | null) => void;
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
  onRename,
  onUpdateSystemPrompt,
}) => {
  // ── 窗口控制状态 ──
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isHoveringClose, setIsHoveringClose] = useState(false);
  const [isHoveringMinimize, setIsHoveringMinimize] = useState(false);
  const [isHoveringMaximize, setIsHoveringMaximize] = useState(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    const unlisten = appWindow.onResized(async () => {
      setIsWindowMaximized(await appWindow.isMaximized());
    });
    appWindow.isMaximized().then(setIsWindowMaximized);
    return () => { unlisten.then(f => f()); };
  }, [appWindow]);

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

  return (
    <>
      <header
        data-tauri-drag-region
        className="sticky top-0 z-30 flex items-center justify-between w-full bg-sand-100/80 backdrop-blur-md border-b border-sand-400/50 transition-all duration-300 select-none"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* 左侧: 标题 (可点击编辑) + 模型标识 */}
        <div
          className="flex flex-col gap-0.5 min-w-0 py-3 pl-5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={handleTitleKeyDown}
              className="text-base md:text-lg font-semibold text-ink-400 tracking-tight leading-tight bg-transparent border-b-2 border-sand-500 outline-none px-0 py-0 w-full max-w-xs"
              maxLength={100}
            />
          ) : (
            <h1
              onClick={handleTitleClick}
              className="text-base md:text-lg font-semibold text-ink-400 truncate tracking-tight leading-tight cursor-pointer hover:text-ink-300 transition-colors"
              title="点击修改标题"
            >
              {conversation.title || '新对话'}
            </h1>
          )}
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-[10px] font-bold text-ink-200 uppercase tracking-[0.1em] font-mono">
              {conversation.model_id}
            </span>
            {conversation.system_prompt && (
              <span className="text-[9px] bg-sand-300 dark:bg-sand-400 text-ink-200 px-1.5 py-0.5 rounded-md font-medium">
                系统提示词
              </span>
            )}
          </div>
        </div>

        {/* 右侧: 功能按钮 + 窗口控制 */}
        <div
          className="flex items-center h-full"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* 设置按钮 → 系统提示词编辑 */}
          <button 
            title="编辑系统提示词"
            onClick={() => setShowSystemPromptModal(true)}
            className="p-2 text-ink-100 hover:text-ink-400 hover:bg-sand-300 rounded-lg transition-colors group mr-2 cursor-pointer"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-active:rotate-90 transition-transform duration-300">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"/>
            </svg>
          </button>

          {/* 分隔线 */}
          <div className="w-px h-5 bg-sand-400/50 mr-1" />

          {/* Windows 窗口控制按钮 */}
          <button
            onClick={() => appWindow.minimize()}
            onMouseEnter={() => setIsHoveringMinimize(true)}
            onMouseLeave={() => setIsHoveringMinimize(false)}
            className="w-12 h-full flex items-center justify-center transition-colors duration-150 cursor-pointer"
            style={{ backgroundColor: isHoveringMinimize ? 'rgba(0,0,0,0.06)' : 'transparent' }}
            aria-label="Minimize"
          >
            <svg width="10" height="1" viewBox="0 0 10 1" fill="none">
              <rect width="10" height="1" rx="0.5" fill="currentColor" opacity="0.7" />
            </svg>
          </button>
          <button
            onClick={() => appWindow.toggleMaximize()}
            onMouseEnter={() => setIsHoveringMaximize(true)}
            onMouseLeave={() => setIsHoveringMaximize(false)}
            className="w-12 h-full flex items-center justify-center transition-colors duration-150 cursor-pointer"
            style={{ backgroundColor: isHoveringMaximize ? 'rgba(0,0,0,0.06)' : 'transparent' }}
            aria-label={isWindowMaximized ? 'Restore' : 'Maximize'}
          >
            {isWindowMaximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="2" y="0" width="8" height="8" rx="0.5" stroke="currentColor" strokeWidth="1" opacity="0.7" fill="none" />
                <rect x="0" y="2" width="8" height="8" rx="0.5" stroke="currentColor" strokeWidth="1" opacity="0.7" fill="white" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" stroke="currentColor" strokeWidth="1" opacity="0.7" />
              </svg>
            )}
          </button>
          <button
            onClick={() => appWindow.close()}
            onMouseEnter={() => setIsHoveringClose(true)}
            onMouseLeave={() => setIsHoveringClose(false)}
            className="w-12 h-full flex items-center justify-center transition-colors duration-150 cursor-pointer"
            style={{
              backgroundColor: isHoveringClose ? '#e81123' : 'transparent',
              color: isHoveringClose ? '#ffffff' : 'inherit',
            }}
            aria-label="Close"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity={isHoveringClose ? 1 : 0.7} />
            </svg>
          </button>
        </div>
      </header>

      {/* ════════════════════════════════════════════════════════════════════════
          系统提示词编辑弹窗 — 使用 absolute 定位于主区域内部
         ════════════════════════════════════════════════════════════════════════ */}
      {showSystemPromptModal && (
        <div
          className="absolute inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setShowSystemPromptModal(false)}
        >
          <div
            className="bg-white/95 dark:bg-sand-200/95 backdrop-blur-xl border border-sand-400/60 rounded-2xl shadow-2xl w-full max-w-lg mx-4 animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-sand-400/30">
              <div className="flex items-center gap-2">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-300">
                  <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                <h2 className="text-base font-bold text-ink-400">系统提示词</h2>
              </div>
              <button
                onClick={() => setShowSystemPromptModal(false)}
                className="p-1.5 text-ink-200 hover:text-ink-400 hover:bg-sand-300 rounded-lg transition-colors cursor-pointer"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            {/* 弹窗内容 */}
            <div className="px-6 py-4">
              <p className="text-xs text-ink-200 mb-3">
                设置系统提示词来定义 AI 的行为方式。留空则使用默认行为。
              </p>
              <textarea
                ref={promptTextareaRef}
                value={systemPromptDraft}
                onChange={(e) => setSystemPromptDraft(e.target.value)}
                placeholder="例如：你是一个专业的编程助手，请用中文回复..."
                rows={6}
                className="w-full bg-sand-200/50 text-ink-300 text-sm placeholder:text-ink-100 px-4 py-3 rounded-xl border border-sand-400/40 focus:border-sand-500 focus:shadow-input-hover outline-none transition-all duration-200 resize-none"
              />
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-ink-100">{systemPromptDraft.length} 字符</span>
              </div>
            </div>

            {/* 弹窗底部 */}
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-sand-400/30">
              {conversation.system_prompt && (
                <button
                  onClick={() => {
                    setSystemPromptDraft('');
                    onUpdateSystemPrompt(null);
                    setShowSystemPromptModal(false);
                  }}
                  className="px-4 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950 rounded-xl transition-colors cursor-pointer"
                >
                  清除
                </button>
              )}
              <button
                onClick={() => setShowSystemPromptModal(false)}
                className="px-4 py-2 text-sm text-ink-200 hover:text-ink-400 hover:bg-sand-200 rounded-xl transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleSaveSystemPrompt}
                className="px-5 py-2 text-sm font-semibold text-white bg-ink-400 hover:bg-ink-300 dark:bg-accent-600 dark:hover:bg-accent-500 rounded-xl transition-colors shadow-sm cursor-pointer"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
