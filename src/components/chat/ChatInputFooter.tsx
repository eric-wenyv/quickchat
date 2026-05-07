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
 * ChatInputFooter (C-9)
 * 输入区容器，组合 TextArea + ModelSelector + SendButton，管理输入状态
 * [针对 UI 任务的附加限制]：拦截 Enter 键实现发送，Shift+Enter 实现换行，高度必须随内容自动增长。
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
    <footer className="w-full px-4 pt-2 pb-0 bg-gradient-to-t from-sand-100 via-sand-100/95 to-transparent">
      <div className="max-w-3xl mx-auto">
        <div className="relative group transition-all duration-500 ease-in-out bg-white/70 dark:bg-sand-300/70 backdrop-blur-2xl border border-sand-400/60 rounded-[28px] shadow-sm hover:shadow-input-hover focus-within:shadow-input-hover focus-within:border-sand-500/40">
          {/* 图片预览区 */}
          {pendingImages.length > 0 && (
            <div className="flex gap-2 px-4 pt-3 pb-1 overflow-x-auto scrollbar-hide">
              {pendingImages.map((url, idx) => (
                <div key={`${url.slice(-20)}-${idx}`} className="relative flex-shrink-0 group/img">
                  <img
                    src={url}
                    alt="pasted"
                    className="h-16 w-16 object-cover rounded-xl border border-sand-400/40"
                  />
                  <button
                    onClick={() => removeImage(idx)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-ink-400 text-white rounded-full flex items-center justify-center text-[10px] opacity-0 group-hover/img:opacity-100 transition-opacity shadow-sm"
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
          
          <div className="flex items-center justify-between px-4 py-3 bg-sand-200/30 dark:bg-sand-400/20 rounded-b-[27px] border-t border-sand-400/20">
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
              <div className="h-4 w-[1px] bg-sand-400/30 mx-1" />
              <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-sand-200/50 text-[10px] font-bold text-ink-200 uppercase tracking-tighter">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Ready
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className={`hidden sm:block transition-all duration-300 ${content.trim() || pendingImages.length > 0 ? 'opacity-40 translate-x-0' : 'opacity-0 translate-x-2'}`}>
                <span className="text-[10px] font-bold text-ink-300 uppercase tracking-widest">
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
