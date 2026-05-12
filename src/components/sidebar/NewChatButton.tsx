import React from 'react';

interface NewChatButtonProps {
  onClick: () => void;
}

/**
 * B-2: NewChatButton (Linear-style)
 * 极简新建按钮，弱边框、微背景，hover 时稍亮。
 */
const NewChatButton: React.FC<NewChatButtonProps> = ({ onClick }) => {
  return (
    <button
      onClick={onClick}
      className="group flex items-center justify-between w-full px-3.5 py-2.5 transition-all duration-200 border rounded-lg bg-linear-surface border-linear-border hover:border-linear-border-hover hover:bg-linear-surface-hover active:scale-[0.98] cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-linear-accent/40"
      aria-label="Create new conversation"
    >
      <span className="text-sm font-medium text-linear-text-secondary transition-colors group-hover:text-linear-text-primary">
        New Chat
      </span>
      <div className="flex items-center justify-center w-6 h-6 transition-all duration-200 rounded-md bg-linear-bg group-hover:bg-linear-surface-hover group-hover:rotate-90">
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
          className="text-linear-text-tertiary group-hover:text-linear-text-secondary"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </div>
    </button>
  );
};

export default NewChatButton;
