import React from 'react';
import type { Conversation } from '@/types/types';

interface MessageHeaderProps {
  conversation: Conversation;
}

/**
 * C-2: MessageHeader
 * 对话区顶部栏，展示当前会话标题和模型标识。
 * 采用极简沙白配色，结合毛玻璃效果，营造高端克制的质感。
 */
export const MessageHeader: React.FC<MessageHeaderProps> = ({ conversation }) => {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between w-full py-4 bg-sand-100/80 backdrop-blur-md border-b border-sand-400/50 transition-all duration-300">
      <div className="flex flex-col gap-0.5 min-w-0">
        <h1 className="text-base md:text-lg font-semibold text-ink-400 truncate tracking-tight leading-tight">
          {conversation.title || '新对话'}
        </h1>
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-[10px] font-bold text-ink-200 uppercase tracking-[0.1em] font-mono">
            {conversation.model_id}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 ml-4">
        <button 
          title="搜索消息"
          className="p-2 text-ink-100 hover:text-ink-400 hover:bg-sand-300 rounded-lg transition-colors group"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-active:scale-90 transition-transform">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
        </button>
        <button 
          title="会话设置"
          className="p-2 text-ink-100 hover:text-ink-400 hover:bg-sand-300 rounded-lg transition-colors group"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-active:rotate-90 transition-transform duration-300">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"/>
          </svg>
        </button>
      </div>
    </header>
  );
};
