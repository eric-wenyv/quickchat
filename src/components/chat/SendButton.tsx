import React from 'react';

interface SendButtonProps {
  onClick: () => void;
  disabled: boolean;
}

/**
 * SendButton (Linear-style)
 * 小圆圈里的向上箭头：
 * - 平时：暗灰线框 + 暗灰箭头
 * - 激活（有内容时）：背景变成主高亮色 #6B7CED，箭头变白
 */
const SendButton: React.FC<SendButtonProps> = ({ onClick, disabled }) => {
  return (
    <button
      id="chat-send-button"
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`
        relative flex items-center justify-center overflow-hidden
        w-7 h-7 rounded-full transition-all
        ${disabled
          ? 'bg-linear-surface/70 text-linear-text-tertiary cursor-not-allowed border border-linear-border scale-95'
          : 'bg-linear-accent text-white border border-linear-accent hover:bg-linear-accent-hover active:scale-90 shadow-[0_6px_18px_rgba(107,124,237,0.22)] scale-100'
        }
      `}
      style={{ transitionTimingFunction: 'var(--ease-snappy)', transitionDuration: '0.25s' }}
      aria-label="Send message"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-3.5 h-3.5"
      >
        <path d="m5 12 7-7 7 7" />
        <path d="M12 19V5" />
      </svg>
    </button>
  );
};

export default SendButton;
