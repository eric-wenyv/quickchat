import React from 'react';

interface SkillsNavButtonProps {
  onClick: () => void;
  isActive?: boolean;
}

/**
 * B-2.5: SkillsNavButton (Linear-style)
 * 位于「新对话」与「搜索」之间的 Skill 管理入口，与 NewChatButton 保持同一视觉语言。
 */
const SkillsNavButton: React.FC<SkillsNavButtonProps> = ({ onClick, isActive = false }) => {
  return (
    <button
      onClick={onClick}
      className={`group flex h-9 w-full items-center gap-3 rounded-md px-2 text-left transition-colors duration-150 cursor-pointer outline-none overflow-hidden ${
        isActive ? 'bg-linear-surface' : 'bg-transparent hover:bg-linear-surface'
      }`}
      aria-label="Skills"
      title="Skills"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`shrink-0 transition-colors ${
          isActive
            ? 'text-linear-text-primary'
            : 'text-linear-text-secondary group-hover:text-linear-text-primary'
        }`}
      >
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
        <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" />
      </svg>
      <span
        className={`text-[15px] font-semibold transition-colors whitespace-nowrap ${
          isActive
            ? 'text-linear-text-primary'
            : 'text-linear-text-secondary group-hover:text-linear-text-primary'
        }`}
      >
        Skills
      </span>
    </button>
  );
};

export default SkillsNavButton;
