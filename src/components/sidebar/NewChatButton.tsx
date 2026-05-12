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
      className="group flex items-center justify-between w-full px-2 py-1.5 transition-all duration-200 rounded-md bg-transparent hover:bg-linear-surface active:scale-[0.98] cursor-pointer outline-none"
      aria-label="Create new conversation"
    >
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-5 h-5 rounded bg-linear-surface text-linear-text-tertiary group-hover:text-linear-text-secondary group-hover:bg-linear-surface-hover transition-colors">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </div>
        <span className="text-[13px] font-medium text-linear-text-secondary group-hover:text-linear-text-primary transition-colors">
          New Chat
        </span>
      </div>
      <span className="text-[10px] text-linear-text-tertiary font-mono tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity">
        ⌘N
      </span>
    </button>
  );
};

export default NewChatButton;
