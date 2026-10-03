import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { useAutoResize } from '@/hooks/useAutoResize';
import { getSkillsSnapshot } from '@/services/skills';
import {
  findClipboardImageItem,
  readClipboardItemAsDataUrl,
  readSystemClipboardImageDataUrl,
} from '@/utils/clipboardImage';

interface ChatTextAreaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onImagePaste?: (imageDataUrl: string) => void;
  onFilePaste?: (files: File[]) => void;
  disabled: boolean;
  placeholder?: string;
}

export interface ChatTextAreaHandle {
  focus: (options?: FocusOptions) => void;
  element: HTMLTextAreaElement | null;
}

export const ChatTextArea = forwardRef<ChatTextAreaHandle, ChatTextAreaProps>(({
  value,
  onChange,
  onSubmit,
  onImagePaste,
  onFilePaste,
  disabled,
  placeholder = 'Type a message...',
}, ref) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 着色镜像层：textarea 无法局部变色，用同排版透明文本 + 底层镜像实现
  // 开头 /skill-id 命中已安装 Skill 时的字体着色
  const mirrorRef = useRef<HTMLDivElement>(null);

  const skillCommandPrefix = useMemo(() => {
    const match = value.match(/^\/([a-zA-Z0-9_-]+)/);
    if (!match) return null;
    const cmd = match[1].toLowerCase();
    const matched = getSkillsSnapshot().some(
      s => s.id.toLowerCase() === cmd || s.name.toLowerCase() === cmd
    );
    return matched ? `/${match[1]}` : null;
  }, [value]);

  const syncMirrorScroll = () => {
    if (mirrorRef.current && textareaRef.current) {
      mirrorRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  useImperativeHandle(ref, () => ({
    focus: (options?: FocusOptions) => textareaRef.current?.focus(options),
    get element() {
      return textareaRef.current;
    },
  }), []);

  /**
   * useAutoResize Hook (D-4)
   * Handles both height auto-growth and keyboard interception (Enter to send, Shift+Enter for newline)
   */
  useAutoResize(textareaRef, value, onSubmit);

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // 1. 优先处理文件粘贴（Windows 资源管理器 Ctrl+C 文件后 Ctrl+V）
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0 && onFilePaste) {
      e.preventDefault();
      onFilePaste(files);
      return;
    }

    // 2. 处理剪贴板图片粘贴
    if (!onImagePaste) return;

    const items = Array.from(e.clipboardData.items);
    const hasText = items.some(item => item.type === 'text/plain');
    const imageItem = findClipboardImageItem(items);

    // If there's text, let the default paste handle it
    if (hasText && !imageItem) return;
    // Wayland 下剪贴板 MIME 可能延迟协商：items 为空不代表剪贴板为空，
    // 但里面有其他内容（如 text/html）时仍保持默认粘贴，避免误吞
    if (!imageItem && items.length > 0) return;

    e.preventDefault();

    // 优先用 paste 事件自带的图片数据（paste 事件同步携带剪贴板文件，
    // 比异步权限的 navigator.clipboard.read 更可靠）；
    // 取不到再回落到系统剪贴板异步读取（Wayland 下 items 常为空）
    const dataUrl =
      (imageItem ? await readClipboardItemAsDataUrl(imageItem) : null) ??
      (await readSystemClipboardImageDataUrl());

    if (dataUrl) onImagePaste(dataUrl);
  };

  return (
    <div className="relative w-full">
      <div
        ref={mirrorRef}
        aria-hidden
        className="absolute inset-0 overflow-hidden pointer-events-none select-none whitespace-pre-wrap break-words text-[15px] leading-[1.55] text-linear-text-body"
      >
        {skillCommandPrefix ? (
          <>
            <span className="qc-skill-command">{skillCommandPrefix}</span>
            {value.slice(skillCommandPrefix.length)}
          </>
        ) : value}
      </div>
      <textarea
        ref={textareaRef}
        data-chat-input="true"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={handlePaste}
        onScroll={syncMirrorScroll}
        disabled={disabled}
        placeholder={placeholder}
        className="relative w-full bg-transparent border-none focus:ring-0 focus:outline-none resize-none p-0 text-[15px] leading-[1.55] text-transparent caret-linear-text-body placeholder:text-linear-text-muted min-h-[38px] max-h-[180px] scrollbar-hide transition-all duration-200 ease-in-out disabled:opacity-50"
        rows={1}
      />
    </div>
  );
});

ChatTextArea.displayName = 'ChatTextArea';
