import React, { useMemo } from 'react';

interface EmptyStateProps {
  /** "no_conversation" = 未选会话; "no_messages" = 会话内无消息 */
  type: 'no_conversation' | 'no_messages';
  /** 当前会话 ID，用于固定问候语 */
  conversationId?: string;
}

const GREETINGS = [
  'Good morning. What can I do for you?',
  'Good afternoon. How can I help?',
  'Good evening. What\'s on your mind?',
  'Hello. Ready when you are.',
  'Hi there. What would you like to explore?',
  'Hey. What can I assist you with today?',
  'Welcome back. What are we working on?',
  'Greetings. What shall we dive into?',
  'Hello. Ask me anything.',
  'Hey there. What\'s the plan?',
];

function getRandomGreeting(): string {
  const idx = Math.floor(Math.random() * GREETINGS.length);
  return GREETINGS[idx];
}

/**
 * C-3: EmptyState 组件
 *
 * 职责：
 * 当未选择会话或会话内无消息时，提供占位视觉引导。
 */
export const EmptyState: React.FC<EmptyStateProps> = ({ type, conversationId }) => {
  const isNoConversation = type === 'no_conversation';
  const greeting = useMemo(() => getRandomGreeting(), [conversationId]);

  if (!isNoConversation) {
    return (
      <div className="flex flex-col items-center justify-center text-center select-none animate-in fade-in duration-700 ease-out">
        <h2 className="text-2xl font-semibold text-ink-300 tracking-tight">
          {greeting}
        </h2>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center text-center select-none animate-in fade-in duration-700 ease-out px-6">
      {/* Logo / Icon */}
      <div className="relative mb-6">
        <div className="w-16 h-16 rounded-2xl bg-sand-200 dark:bg-sand-300 border border-sand-400/60 flex items-center justify-center shadow-panel">
          <svg
            className="w-8 h-8 text-ink-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
            />
          </svg>
        </div>
      </div>

      <h2 className="text-2xl font-bold text-ink-300 tracking-tight mb-2">
        Quick Chat
      </h2>
      <p className="text-sm text-ink-200 max-w-xs leading-relaxed mb-8">
        选择一个历史对话继续，或在下方输入框开始新的聊天
      </p>

      {/* 功能提示卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-md">
        <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-white/60 dark:bg-sand-300/40 border border-sand-400/40 backdrop-blur-sm">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <div className="text-left">
            <p className="text-xs font-semibold text-ink-300">联网搜索</p>
            <p className="text-[11px] text-ink-200 mt-0.5">实时获取最新信息</p>
          </div>
        </div>

        <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-white/60 dark:bg-sand-300/40 border border-sand-400/40 backdrop-blur-sm">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
            </svg>
          </div>
          <div className="text-left">
            <p className="text-xs font-semibold text-ink-300">代码高亮</p>
            <p className="text-[11px] text-ink-200 mt-0.5">支持多种编程语言</p>
          </div>
        </div>

        <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-white/60 dark:bg-sand-300/40 border border-sand-400/40 backdrop-blur-sm">
          <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
            </svg>
          </div>
          <div className="text-left">
            <p className="text-xs font-semibold text-ink-300">多模型切换</p>
            <p className="text-[11px] text-ink-200 mt-0.5">自由切换 AI 提供商</p>
          </div>
        </div>

        <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-white/60 dark:bg-sand-300/40 border border-sand-400/40 backdrop-blur-sm">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.75V16.5L12 14.25 7.5 16.5V3.75m9 0H18A2.25 2.25 0 0120.25 6v12A2.25 2.25 0 0118 20.25H6A2.25 2.25 0 013.75 18V6A2.25 2.25 0 016 3.75h1.5m9 0h-9" />
            </svg>
          </div>
          <div className="text-left">
            <p className="text-xs font-semibold text-ink-300">本地持久化</p>
            <p className="text-[11px] text-ink-200 mt-0.5">SQLite 存储对话历史</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmptyState;
