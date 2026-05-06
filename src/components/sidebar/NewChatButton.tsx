import React from 'react';

interface NewChatButtonProps {
  onClick: () => void;
}

/**
 * B-2: NewChatButton
 * 核心职责: "新建对话"按钮，触发 onCreateConversation 回调
 * 设计规范: Claude-inspired 极简风格，动态交互反馈
 */
const NewChatButton: React.FC<NewChatButtonProps> = ({ onClick }) => {
  return (
    <button
      onClick={onClick}
      className="group flex items-center justify-between w-full px-3.5 py-2.5 transition-all duration-200 border rounded-xl bg-sand-100 border-sand-400/60 hover:border-sand-500 hover:bg-white hover:shadow-sm active:scale-[0.98] cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-sand-500"
      aria-label="Create new conversation"
    >
      <span className="text-sm font-semibold text-ink-300 transition-colors group-hover:text-ink-400">
        New Chat
      </span>
      <div className="flex items-center justify-center w-6 h-6 transition-all duration-200 rounded-lg bg-sand-200 group-hover:bg-sand-300 group-hover:rotate-90">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-ink-200 group-hover:text-ink-400"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </div>
    </button>
  );
};

export default NewChatButton;
