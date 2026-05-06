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
}

/**
 * C-1: MainChatArea
 * 主对话区容器，组合 Header + MessageList/EmptyState + InputFooter。
 * 它是应用的心脏，负责协调各个原子组件并呈现最核心的交流体验。
 * 
 * [针对 UI 任务的附加限制]：拦截 Enter 键实现发送，Shift+Enter 实现换行，高度必须随内容自动增长。
 * (注：此逻辑已在子组件 ChatTextArea 及 ChatInputFooter 中实现，本容器确保布局适配高度增长)
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
}) => {
  const showNoConversation = !conversation;
  const showNoMessages = conversation && messages.length === 0 && !isLoadingMessages;

  return (
    <div className="relative flex flex-col h-full w-full overflow-hidden bg-sand-100">
      {/* 顶部透明拖拽区 (悬浮模式，确保不遮挡 Header 交互但支持窗口拖拽) */}
      <TauriDragRegion floating className="h-10 pointer-events-none" />

      {showNoConversation ? (
        <div className="flex-1 overflow-hidden">
          <EmptyState type="no_conversation" />
        </div>
      ) : (
        <>
          {/* 顶部导航与状态栏 */}
          <MessageHeader conversation={conversation} />

          {/* 消息展示核心区：使用 flex-1 撑开，内部 MessageList 自助滚动 */}
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

          {/* 输入底部栏：位于容器底部，高度随内容自适应 */}
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
