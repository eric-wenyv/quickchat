import React from 'react';

interface SendButtonProps {
  onClick: () => void;
  disabled: boolean;
}

/**
 * SendButton (Linear-style)
 * 小圆圈里的向上箭头：
 * - 平时：暗灰线框 + 暗灰箭头
 * - 激活（有内容时）：浅色圆形按钮，避免蓝色选中态
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
          ? 'bg-transparent text-linear-text-muted cursor-not-allowed border border-linear-border/70 opacity-45 scale-95 shadow-none'
          : 'bg-linear-text-primary text-linear-bg border border-linear-text-primary hover:bg-white active:scale-90 shadow-[0_6px_18px_rgba(255,255,255,0.12)] scale-100'
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
