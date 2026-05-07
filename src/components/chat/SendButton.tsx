import React from 'react';

interface SendButtonProps {
  onClick: () => void;
  disabled: boolean;
}

const SendButton: React.FC<SendButtonProps> = ({ onClick, disabled }) => {
  return (
    <button
      id="chat-send-button"
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`
        relative flex items-center justify-center
        w-8 h-8 rounded-lg transition-all duration-200 ease-out
        ${
          disabled
            ? 'bg-transparent text-ink-100 cursor-not-allowed opacity-30'
            : 'bg-ink-400 dark:bg-accent-600 text-sand-100 hover:bg-ink-300 dark:hover:bg-accent-500 active:scale-90 shadow-sm hover:shadow-input-hover'
        }
      `}
      aria-label="Send message"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-4 h-4"
      >
        <path d="m5 12 7-7 7 7" />
        <path d="M12 19V5" />
      </svg>
    </button>
  );
};

export default SendButton;
