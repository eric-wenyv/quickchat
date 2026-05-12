import React from 'react';
import type { MessageRole } from '@/types/types';

interface MessageAvatarProps {
  role: MessageRole;
}

/**
 * MessageAvatar (Linear-style)
 * 极小、圆角的头像标识。用户用小人图标，AI 用终端/机器人图标。
 */
const MessageAvatar: React.FC<MessageAvatarProps> = ({ role }) => {
  const isAssistant = role === 'assistant';
  const isUser = role === 'user';

  return (
    <div
      className={`
        flex h-[22px] w-[22px] shrink-0 select-none items-center justify-center rounded-[4px] transition-all duration-200
        ${isAssistant
          ? 'bg-linear-accent/8 border border-linear-accent/12 text-linear-accent'
          : isUser
            ? 'bg-linear-surface border border-linear-border text-linear-text-secondary'
            : 'bg-linear-surface border border-linear-border text-linear-text-tertiary'
        }
      `}
    >
      {isAssistant && (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="opacity-85"
        >
          <path d="M12 8V4H8" />
          <rect width="16" height="12" x="4" y="8" rx="2" />
          <path d="M2 14h2" />
          <path d="M20 14h2" />
          <path d="M15 13v2" />
          <path d="M9 13v2" />
        </svg>
      )}
      {isUser && (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="opacity-80"
        >
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      )}
    </div>
  );
};

export default MessageAvatar;
