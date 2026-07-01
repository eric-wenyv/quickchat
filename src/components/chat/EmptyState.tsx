import React, { useMemo } from 'react';

interface EmptyStateProps {
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
 * C-3: EmptyState (Linear-style)
 * 新对话的空白页问候语。
 */
export const EmptyState: React.FC<EmptyStateProps> = ({ conversationId }) => {
  const greeting = useMemo(() => getRandomGreeting(), [conversationId]);

  return (
    <div className="flex flex-col items-center justify-center text-center select-none animate-in fade-in duration-700 ease-out">
      <h2 className="text-[28px] font-semibold text-linear-text-secondary tracking-tight">
        {greeting}
      </h2>
    </div>
  );
};

export default EmptyState;
