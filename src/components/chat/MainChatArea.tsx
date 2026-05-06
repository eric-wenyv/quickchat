import React from 'react';
import type { Conversation, Message, ModelConfig, UUID } from '@/types/types';
import { MessageHeader } from './MessageHeader';
import MessageList from './MessageList';
import { EmptyState } from './EmptyState';
import { ChatInputFooter } from './ChatInputFooter';
import TauriDragRegion from '../shared/TauriDragRegion';

interface MainChatAreaProps {
  conversation: Conversation | null;
  messages: Message[];
  isLoadingMessages: boolean;
  isLoadingMore?: boolean;
  onSendMessage: (content: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  /** AI 模型配置列表 */
  models: ModelConfig[];
  /** 当前选中的模型 ID */
  activeModelId: UUID;
  /** 切换模型回调 */
  onModelSelect: (id: UUID) => void;
  /** 是否正在发送消息 (用于禁用输入) */
  isSending: boolean;
  /** 重命名会话回调 */
  onRenameConversation: (id: UUID, newTitle: string) => void;
  /** 更新系统提示词回调 */
  onUpdateSystemPrompt: (prompt: string | null) => void;
}

/**
 * C-1: MainChatArea
 * 主对话区容器，组合 Header + MessageList/EmptyState + InputFooter。
 */
export const MainChatArea: React.FC<MainChatAreaProps> = ({
  conversation,
  messages,
  isLoadingMessages,
  isLoadingMore = false,
  onSendMessage,
  onLoadMore,
  hasMore,
  models,
  activeModelId,
  onModelSelect,
  isSending,
  onRenameConversation,
  onUpdateSystemPrompt,
}) => {
  const showNoConversation = !conversation;
  const showNoMessages = conversation && messages.length === 0 && !isLoadingMessages;

  return (
    <div className="relative flex flex-col h-full w-full overflow-hidden bg-sand-100">
      {showNoConversation ? (
        <>
          {/* 无会话时：顶部拖拽区 + 窗口控制按钮 */}
          <TauriDragRegion floating showControls className="h-10" />
          <div className="flex-1 overflow-hidden">
            <EmptyState type="no_conversation" />
          </div>
        </>
      ) : (
        <>
          {/* 顶部导航与状态栏 (已内联窗口控制按钮) */}
          <MessageHeader
            conversation={conversation}
            onRename={(newTitle) => onRenameConversation(conversation.id, newTitle)}
            onUpdateSystemPrompt={onUpdateSystemPrompt}
          />

          {/* 消息展示核心区 */}
          <main className="flex-1 relative overflow-hidden flex flex-col min-h-0">
            {showNoMessages ? (
              <div className="flex-1 overflow-hidden">
                <EmptyState type="no_messages" />
              </div>
            ) : (
              <MessageList
                messages={messages}
                onLoadMore={onLoadMore}
                hasMore={hasMore}
                isLoadingMore={isLoadingMore}
              />
            )}
          </main>

          {/* 输入底部栏 */}
          <ChatInputFooter
            onSend={onSendMessage}
            disabled={isSending || isLoadingMessages}
            models={models}
            activeModelId={activeModelId}
            onModelSelect={onModelSelect}
          />
        </>
      )}
    </div>
  );
};

export default MainChatArea;
