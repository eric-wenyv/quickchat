import React, { useState } from 'react';
import type { ModelConfig, UUID } from '@/types/types';
import { ChatTextArea } from './ChatTextArea';
import SendButton from './SendButton';
import ModelSelector from './ModelSelector';
import ThinkingLevelSelector from './ThinkingLevelSelector';

interface ChatInputFooterProps {
  onSend: (content: string) => void;
  disabled: boolean;
  models: ModelConfig[];
  activeModelId: UUID;
  onModelSelect: (id: UUID) => void;
  onUpdateModelThinkingLevel: (id: UUID, level: 'LOW' | 'MEDIUM' | 'HIGH' | null) => void;
}

/**
 * ChatInputFooter (Linear-style)
 * 输入区容器：
 * - 去掉大面积深灰底色，改用和主背景同色或微微亮一点点的底色
 * - 精致边框 border: 1px solid rgba(255,255,255,0.1)
 * - 圆角收敛为 8px
 * - 发送按钮改为小圆圈设计
 */
export const ChatInputFooter: React.FC<ChatInputFooterProps> = ({
  onSend,
  disabled,
  models,
  activeModelId,
  onModelSelect,
  onUpdateModelThinkingLevel,
}) => {
  const [content, setContent] = useState('');
  const [pendingImages, setPendingImages] = useState<string[]>([]);

  const handleSend = () => {
    const trimmed = content.trim();
    if ((!trimmed && pendingImages.length === 0) || disabled) return;

    let finalContent = trimmed;
    if (pendingImages.length > 0) {
      const imageMarkdown = pendingImages.map((url) => `![image](${url})`).join('\n\n');
      finalContent = trimmed ? `${trimmed}\n\n${imageMarkdown}` : imageMarkdown;
    }

    onSend(finalContent);
    setContent('');
    setPendingImages([]);
  };

  const handleImagePaste = (imageDataUrl: string) => {
    setPendingImages((prev) => [...prev, imageDataUrl]);
  };

  const removeImage = (index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  };

  const canSend = (!!content.trim() || pendingImages.length > 0) && !disabled;

  return (
    <footer className="w-full px-4 pt-2 pb-4 bg-linear-bg relative">
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-linear-border to-transparent opacity-50" />
      <div className="max-w-3xl mx-auto">
        <div
          className="relative group bg-linear-bg-elevated border border-[rgba(255,255,255,0.08)] shadow-linear-highlight rounded-2xl hover:border-linear-border-hover focus-within:border-linear-accent focus-within:shadow-linear-highlight-strong"
          style={{ transition: 'border-color 0.1s var(--ease-snappy), box-shadow 0.1s var(--ease-snappy)' }}
        >
          {/* 图片预览区 */}
          {pendingImages.length > 0 && (
            <div className="flex gap-2 px-4 pt-3 pb-1 overflow-x-auto scrollbar-hide">
              {pendingImages.map((url, idx) => (
                <div key={`${url.slice(-20)}-${idx}`} className="relative flex-shrink-0 group/img">
                  <img
                    src={url}
                    alt="pasted"
                    className="h-16 w-16 object-cover rounded-xl border border-linear-border"
                  />
                  <button
                    onClick={() => removeImage(idx)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-linear-text-secondary text-linear-bg rounded-full flex items-center justify-center text-[10px] opacity-0 group-hover/img:opacity-100 transition-opacity shadow-sm"
                    title="Remove image"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="px-2 pt-2 pb-1">
            <ChatTextArea
              value={content}
              onChange={setContent}
              onSubmit={handleSend}
              onImagePaste={handleImagePaste}
              disabled={disabled}
              placeholder="Ask anything..."
            />
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-linear-border/50">
            <div className="flex items-center gap-1.5">
              <ModelSelector
                models={models}
                activeModelId={activeModelId}
                onSelect={onModelSelect}
              />
              <ThinkingLevelSelector
                models={models}
                activeModelId={activeModelId}
                onUpdateThinkingLevel={onUpdateModelThinkingLevel}
              />
              <div className="h-4 w-[1px] bg-linear-border mx-1" />
              <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-linear-surface text-[10px] font-medium text-linear-text-tertiary uppercase tracking-tighter">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" style={{ animation: 'status-breathe 3.5s ease-in-out infinite' }} />
                Ready
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className={`hidden sm:block transition-all duration-300 ${content.trim() || pendingImages.length > 0 ? 'opacity-40 translate-x-0' : 'opacity-0 translate-x-2'}`}>
                <span className="text-[10px] font-medium text-linear-text-tertiary uppercase tracking-widest">
                  {content.length} chars
                </span>
              </div>
              <SendButton
                onClick={handleSend}
                disabled={!canSend}
              />
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default ChatInputFooter;
