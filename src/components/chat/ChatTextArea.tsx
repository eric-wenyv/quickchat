import React, { useRef } from 'react';
import { useAutoResize } from '@/hooks/useAutoResize';

interface ChatTextAreaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  placeholder?: string;
}

export const ChatTextArea: React.FC<ChatTextAreaProps> = ({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder = 'Type a message...',
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /**
   * useAutoResize Hook (D-4)
   * Handles both height auto-growth and keyboard interception (Enter to send, Shift+Enter for newline)
   */
  useAutoResize(textareaRef, value, onSubmit);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      className="w-full bg-transparent border-none focus:ring-0 focus:outline-none resize-none py-3 px-4 text-ink-300 placeholder:text-ink-100 min-h-[52px] max-h-[300px] scrollbar-hide transition-all duration-200 ease-in-out disabled:opacity-50"
      rows={1}
    />
  );
};
