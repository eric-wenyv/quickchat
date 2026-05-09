import React, { useState, useMemo, useRef } from 'react';
import type { Conversation, Message, ModelConfig, SystemPrompt, UUID } from '@/types/types';
import { MessageHeader } from './MessageHeader';

interface TokenStats {
  totalTokens: number;
  totalInput: number;
  totalOutput: number;
}
import MessageList, { type MessageListHandle } from './MessageList';
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
  /** 更新模型 thinking level 回调 */
  onUpdateModelThinkingLevel: (id: UUID, level: 'LOW' | 'MEDIUM' | 'HIGH' | null) => void;
  /** 已保存的系统提示词预设列表 */
  systemPrompts: SystemPrompt[];
  /** 保存系统提示词预设 */
  onSaveSystemPromptPreset: (title: string, content: string) => void;
  /** 删除系统提示词预设 */
  onDeleteSystemPromptPreset: (id: UUID) => void;
  /** 删除单条消息 */
  onDeleteMessage: (id: UUID) => void;
}

/**
 * 根据当前活跃的全局消息索引，返回对应的高亮 user 消息在 userMessages 中的索引
 */
function getActiveUserIndex(allMessages: Message[], activeIdx: number): number {
  const userIndices = allMessages
    .map((m, i) => (m.role === 'user' ? i : -1))
    .filter((i) => i !== -1);
  let target = -1;
  for (let i = 0; i < userIndices.length; i++) {
    if (userIndices[i] <= activeIdx) {
      target = i;
    } else {
      break;
    }
  }
  return target;
}

/**
 * C-1: MainChatArea
 * 主对话区容器，组合 Header + MessageList/EmptyState + InputFooter。
 * 新增：右侧消息区域中间固定导航条（DeepSeek 风格，默认仅显示短横线，悬浮展开信息）。
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
  onUpdateModelThinkingLevel,
  systemPrompts,
  onSaveSystemPromptPreset,
  onDeleteSystemPromptPreset,
  onDeleteMessage,
}) => {
  const showNoConversation = !conversation;
  const showNoMessages = conversation && messages.length === 0 && !isLoadingMessages;

  // ── 右侧导航条状态 ──
  const messageListRef = useRef<MessageListHandle>(null);
  const [isNavHovered, setIsNavHovered] = useState(false);
  const [activeMessageIndex, setActiveMessageIndex] = useState(0);

  // ── 滚动状态 ──
  const [scrollState, setScrollState] = useState({ isNearBottom: true, isAutoScrollEnabled: false });

  const userMessages = useMemo(
    () => messages.filter((m) => m.role === 'user'),
    [messages]
  );
  const activeUserIndex = useMemo(
    () => getActiveUserIndex(messages, activeMessageIndex),
    [messages, activeMessageIndex]
  );

  const showNavPanel = userMessages.length >= 2;

  // ── 当前对话累计 Token 统计 ──
  const tokenStats: TokenStats = useMemo(() => {
    let totalTokens = 0;
    let totalInput = 0;
    let totalOutput = 0;
    for (const msg of messages) {
      if (msg.token_count != null) totalTokens += msg.token_count;
      if (msg.input_tokens != null) totalInput += msg.input_tokens;
      if (msg.output_tokens != null) totalOutput += msg.output_tokens;
    }
    return { totalTokens, totalInput, totalOutput };
  }, [messages]);

  const handleNavClick = (userIdx: number) => {
    let userCount = 0;
    let globalIdx = -1;
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === 'user') {
        if (userCount === userIdx) {
          globalIdx = i;
          break;
        }
        userCount++;
      }
    }
    if (globalIdx !== -1) {
      messageListRef.current?.scrollToMessage(globalIdx);
    }
  };

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
          {/* 顶部导航与状态栏 */}
          <MessageHeader
            conversation={conversation}
            tokenStats={tokenStats}
            onRename={(newTitle) => onRenameConversation(conversation.id, newTitle)}
            onUpdateSystemPrompt={onUpdateSystemPrompt}
            savedPrompts={systemPrompts}
            onSavePrompt={onSaveSystemPromptPreset}
            onDeletePrompt={onDeleteSystemPromptPreset}
          />

          {/* 消息展示核心区 */}
          <main className="flex-1 relative overflow-hidden flex flex-col min-h-0">
            {showNoMessages ? (
              <div className="flex-1 flex flex-col items-center justify-center px-4 pb-12">
                <EmptyState type="no_messages" conversationId={conversation?.id} />
                <div className="w-full max-w-2xl mt-8">
                  <ChatInputFooter
                    onSend={onSendMessage}
                    disabled={isSending || isLoadingMessages}
                    models={models}
                    activeModelId={activeModelId}
                    onModelSelect={onModelSelect}
                    onUpdateModelThinkingLevel={onUpdateModelThinkingLevel}
                  />
                </div>
              </div>
            ) : (
              <>
                {/* 消息列表区域（导航条固定在内部右侧中间） */}
                <div className="flex-1 relative min-h-0 flex flex-col">
                  {/* ── 右侧中间固定导航条（DeepSeek 风格）── */}
                  {showNavPanel && (
                    <div
                      className="absolute right-5 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center py-3 transition-all duration-200 overflow-hidden"
                      style={{
                        width: isNavHovered ? 192 : 20,
                        backgroundColor: isNavHovered ? 'rgba(var(--sand-200-rgb), 0.9)' : 'transparent',
                        backdropFilter: isNavHovered ? 'blur(12px)' : 'none',
                        borderRadius: isNavHovered ? '12px 0 0 12px' : '0',
                        border: isNavHovered ? '1px solid rgba(var(--sand-400-rgb), 0.4)' : 'none',
                        borderRight: 'none',
                        boxShadow: isNavHovered ? '0 4px 20px rgba(0,0,0,0.08)' : 'none',
                      }}
                      onMouseEnter={() => setIsNavHovered(true)}
                      onMouseLeave={() => setIsNavHovered(false)}
                    >
                      <div className="flex flex-col items-center w-full">
                        {userMessages.map((msg, idx) => {
                          const isActive = idx === activeUserIndex;
                          const preview = msg.content
                            .replace(/!\[.*?\]\(.*?\)/g, '[图片]')
                            .replace(/\n/g, ' ')
                            .slice(0, 18);
                          return (
                            <button
                              key={msg.id}
                              onClick={() => handleNavClick(idx)}
                              className="w-full flex items-center gap-2 px-2 py-1.5 transition-colors cursor-pointer"
                              title={isNavHovered ? undefined : msg.content.slice(0, 100)}
                            >
                              {/* 短横线标记 */}
                              <div
                                className={`h-px shrink-0 transition-all ${
                                  isActive
                                    ? 'bg-blue-500'
                                    : 'bg-sand-400/50 hover:bg-sand-400'
                                }`}
                                style={{ width: isNavHovered ? 16 : 12 }}
                              />
                              {/* 悬浮后显示的文字 */}
                              {isNavHovered && (
                                <span className="text-xs text-ink-300 truncate flex-1 text-left">
                                  {preview || '[空消息]'}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <MessageList
                    ref={messageListRef}
                    messages={messages}
                    onLoadMore={onLoadMore}
                    hasMore={hasMore}
                    isLoadingMore={isLoadingMore}
                    onDeleteMessage={onDeleteMessage}
                    onActiveIndexChange={setActiveMessageIndex}
                    onScrollStateChange={setScrollState}
                  />

                  {/* 固定跳转至底部按钮（不随消息列表滚动） */}
                  {!scrollState.isNearBottom && (
                    <button
                      onClick={() => messageListRef.current?.enableAutoScroll()}
                      className={`absolute bottom-6 right-6 z-30 flex items-center justify-center w-10 h-10 rounded-full shadow-panel backdrop-blur-xl border transition-all duration-300 animate-in fade-in zoom-in-95 cursor-pointer ${
                        scrollState.isAutoScrollEnabled
                          ? 'bg-blue-500/90 text-white border-blue-400/60'
                          : 'bg-white/90 dark:bg-sand-200/90 text-ink-300 border-sand-400/40 hover:bg-sand-100 dark:hover:bg-sand-300'
                      }`}
                      title={scrollState.isAutoScrollEnabled ? '已开启自动追踪底部' : '跳转至最底部'}
                    >
                      <svg
                        className={`w-4 h-4 transition-transform duration-300 ${scrollState.isAutoScrollEnabled ? 'animate-bounce' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* 输入框区域 */}
                <ChatInputFooter
                  onSend={onSendMessage}
                  disabled={isSending || isLoadingMessages}
                  models={models}
                  activeModelId={activeModelId}
                  onModelSelect={onModelSelect}
                  onUpdateModelThinkingLevel={onUpdateModelThinkingLevel}
                />
              </>
            )}
          </main>
        </>
      )}
    </div>
  );
};

export default MainChatArea;
