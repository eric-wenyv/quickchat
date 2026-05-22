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
      className="group flex h-9 w-full items-center gap-3 rounded-md bg-transparent px-2 text-left transition-colors duration-150 hover:bg-linear-surface cursor-pointer outline-none overflow-hidden"
      aria-label="新对话"
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-linear-text-secondary group-hover:text-linear-text-primary transition-colors"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
      <span className="text-[15px] font-semibold text-linear-text-secondary group-hover:text-linear-text-primary transition-colors whitespace-nowrap">
        新对话
      </span>
    </button>
  );
};

export default NewChatButton;
