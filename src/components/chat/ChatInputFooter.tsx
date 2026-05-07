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
  /** 是否显示底部免责声明，默认 true */
  showDisclaimer?: boolean;
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
  showDisclaimer = true,
}) => {
  const [content, setContent] = useState('');

  const handleSend = () => {
    const trimmed = content.trim();
    if (trimmed && !disabled) {
      onSend(trimmed);
      setContent('');
    }
  };

  return (
    <footer className={`w-full px-4 pt-2 bg-gradient-to-t from-sand-100 via-sand-100/95 to-transparent ${showDisclaimer ? 'pb-4' : 'pb-2'}`}>
      <div className="max-w-3xl mx-auto">
        <div className="relative group transition-all duration-500 ease-in-out bg-white/70 dark:bg-sand-300/70 backdrop-blur-2xl border border-sand-400/60 rounded-[28px] shadow-sm hover:shadow-input-hover focus-within:shadow-input-hover focus-within:border-sand-500/40">
          <div className="px-2 pt-2 pb-1">
            <ChatTextArea
              value={content}
              onChange={setContent}
              onSubmit={handleSend}
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
              <div className={`hidden sm:block transition-all duration-300 ${content.trim() ? 'opacity-40 translate-x-0' : 'opacity-0 translate-x-2'}`}>
                <span className="text-[10px] font-bold text-ink-300 uppercase tracking-widest">
                  {content.length} chars
                </span>
              </div>
              <SendButton 
                onClick={handleSend} 
                disabled={disabled || !content.trim()} 
              />
            </div>
          </div>
        </div>
        
        {showDisclaimer && (
          <p className="mt-4 text-[10px] text-center text-ink-100 font-medium opacity-50 tracking-tight select-none">
            Quick Chat can make mistakes. Always check for accuracy.
          </p>
        )}
      </div>
    </footer>
  );
};

export default ChatInputFooter;
