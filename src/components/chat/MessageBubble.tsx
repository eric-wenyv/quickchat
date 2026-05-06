import React from 'react';
import type { Message } from '@/types/types';
import MessageAvatar from './MessageAvatar';
import MessageContent from './MessageContent';
import MessageMeta from './MessageMeta';

interface MessageBubbleProps {
  message: Message;
}

/**
 * C-5: MessageBubble
 * 消息外层容器组件。
 * 职责：根据角色 (role) 处理布局对齐、背景样式，并组合头像、正文与元信息。
 */
const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isSystem = message.role === 'system';

  // 系统消息：居中显示，采用极简的胶囊样式
  if (isSystem) {
    return (
      <div className="flex justify-center w-full my-6 px-6">
        <div className="px-4 py-1.5 bg-sand-200/50 border border-sand-400/40 rounded-full text-[11px] text-ink-200 font-medium tracking-wide backdrop-blur-sm select-none">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`
        flex w-full group py-6 px-4 md:px-8 transition-colors duration-300 ease-in-out
        ${isUser ? 'flex-row-reverse' : 'flex-row'} 
        gap-4 md:gap-6 hover:bg-sand-200/30
      `}
    >
      {/* 头像区域：固定宽度，防止在长文本下挤压 */}
      <div className="flex-shrink-0 pt-0.5">
        <MessageAvatar role={message.role} />
      </div>

      {/* 消息正文与元信息容器 */}
      <div className={`flex flex-col min-w-0 max-w-[88%] md:max-w-[82%] ${isUser ? 'items-end' : 'items-start'}`}>
        
        {/* 内容气泡：用户侧有背景，AI 侧保持透明以融入背景 */}
        <div 
          className={`
            relative w-full transition-all duration-300
            ${isUser 
              ? 'px-5 py-3.5 bg-white border border-sand-400/60 rounded-2xl rounded-tr-sm shadow-[0_2px_12px_-2px_rgba(0,0,0,0.02)]' 
              : 'px-1 py-1 bg-transparent'
            }
          `}
        >
          <MessageContent 
            content={message.content} 
            status={message.status} 
          />
        </div>

        {/* 元信息行：显示时间戳、Token 数及模型标识 */}
        <div className={`mt-2 ${isUser ? 'mr-1' : 'ml-1'}`}>
          <MessageMeta 
            createdAt={message.created_at} 
            tokenCount={message.token_count} 
            modelId={message.model_id} 
          />
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
