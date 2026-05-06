import React from 'react';
import type { MessageRole } from '@/types/types';

interface MessageAvatarProps {
  role: MessageRole;
}

const MessageAvatar: React.FC<MessageAvatarProps> = ({ role }) => {
  const isAssistant = role === 'assistant';
  const isUser = role === 'user';
  const isSystem = role === 'system';

  return (
    <div 
      className={`
        flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-lg border transition-all duration-200
        ${isAssistant 
          ? 'bg-ink-400 border-ink-400 text-sand-100 shadow-sm ring-1 ring-ink-400/10' 
          : isUser
          ? 'bg-white border-sand-400 text-ink-300 shadow-sm'
          : 'bg-sand-300 border-sand-400 text-ink-200'
        }
      `}
    >
      {isAssistant && (
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          width="18" 
          height="18" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          className="opacity-90"
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
          width="18" 
          height="18" 
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
      {isSystem && (
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          width="16" 
          height="16" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          className="opacity-60"
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
        </svg>
      )}
    </div>
  );
};

export default MessageAvatar;
