import React, { useMemo } from 'react';

interface EmptyStateProps {
  /** "no_conversation" = 未选会话; "no_messages" = 会话内无消息 */
  type: 'no_conversation' | 'no_messages';
  /** 当前会话 ID，用于固定问候语 */
  conversationId?: string;
}

const GREETINGS = [
  'Good morning. What can I do for you?',
  'Good afternoon. How can I help?',
  'Good evening. What\'s on your mind?',
  'Hello. Ready when you are.',
  'Hi there. What would you like to explore?',
  'Hey. What can I assist you with today?',
  'Welcome back. What are we working on?',
  'Greetings. What shall we dive into?',
  'Hello. Ask me anything.',
  'Hey there. What\'s the plan?',
];

function getRandomGreeting(): string {
  const idx = Math.floor(Math.random() * GREETINGS.length);
  return GREETINGS[idx];
}

/**
 * C-3: EmptyState 组件
 *
 * 职责：
 * 当未选择会话或会话内无消息时，提供极简的占位视觉引导。
 */
export const EmptyState: React.FC<EmptyStateProps> = ({ type, conversationId }) => {
  const isNoConversation = type === 'no_conversation';
  const greeting = useMemo(() => getRandomGreeting(), [conversationId]);

  return (
    <div className="flex flex-col items-center justify-center text-center select-none animate-in fade-in duration-700 ease-out">
      <h2 className="text-2xl font-semibold text-ink-300 tracking-tight">
        {isNoConversation ? 'Quick Chat' : greeting}
      </h2>
      {isNoConversation && (
        <p className="mt-2 text-sm text-ink-200">
          Select a conversation or start a new one.
        </p>
      )}
    </div>
  );
};

export default EmptyState;
