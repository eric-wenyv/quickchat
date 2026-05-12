import React, { useRef } from 'react';
import { useAutoResize } from '@/hooks/useAutoResize';
import { readImage } from '@tauri-apps/plugin-clipboard-manager';

interface ChatTextAreaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onImagePaste?: (imageDataUrl: string) => void;
  disabled: boolean;
  placeholder?: string;
}

export const ChatTextArea: React.FC<ChatTextAreaProps> = ({
  value,
  onChange,
  onSubmit,
  onImagePaste,
  disabled,
  placeholder = 'Type a message...',
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /**
   * useAutoResize Hook (D-4)
   * Handles both height auto-growth and keyboard interception (Enter to send, Shift+Enter for newline)
   */
  useAutoResize(textareaRef, value, onSubmit);

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Only process image paste if handler is provided
    if (!onImagePaste) return;

    // Check if clipboard has image (no text/plain or only image)
    const items = e.clipboardData.items;
    let hasImage = false;
    let hasText = false;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) hasImage = true;
      if (item.type === 'text/plain') hasText = true;
    }

    // If there's text, let the default paste handle it
    if (hasText && !hasImage) return;
    if (!hasImage) return;

    e.preventDefault();
    try {
      const image = await readImage();
      const rgba = await image.rgba();
      const size = await image.size();
      // Convert RGBA to PNG via canvas
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const imgData = ctx.createImageData(size.width, size.height);
      imgData.data.set(rgba);
      ctx.putImageData(imgData, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      onImagePaste(dataUrl);
    } catch {
      // Clipboard may not contain an image, ignore
    }
  };

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onPaste={handlePaste}
      disabled={disabled}
      placeholder={placeholder}
      className="w-full bg-transparent border-none focus:ring-0 focus:outline-none resize-none py-3 px-4 text-linear-text-primary placeholder:text-linear-text-muted min-h-[52px] max-h-[300px] scrollbar-hide transition-all duration-200 ease-in-out disabled:opacity-50"
      rows={1}
    />
  );
};
