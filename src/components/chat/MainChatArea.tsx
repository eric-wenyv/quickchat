import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
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
import { parseAttachments } from '@/utils/file';

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
  /** 当前会话的 thinking_level（per-conversation） */
  thinkingLevel: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  /** 更新思考程度回调（per-conversation） */
  onUpdateThinkingLevel: (level: 'LOW' | 'MEDIUM' | 'HIGH' | null) => void;
  /** 切换会话后需要恢复滚动到的消息 ID */
  scrollRestoreMessageId: UUID | null;
  /** 活跃消息 ID 变化回调（用于保存滚动位置） */
  onActiveMessageIdChange?: (messageId: UUID | null) => void;
  /** 已保存的系统提示词预设列表 */
  systemPrompts: SystemPrompt[];
  /** 保存系统提示词预设 */
  onSaveSystemPromptPreset: (title: string, content: string) => void;
  /** 删除系统提示词预设 */
  onDeleteSystemPromptPreset: (id: UUID) => void;
  /** 删除单条消息 */
  onDeleteMessage: (id: UUID) => void;
  /** 文件拖拽放下 */
  onFileDrop?: (files: File[]) => void;
  /** 中断 AI 生成 */
  onStopGeneration?: () => void;
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
  thinkingLevel,
  onUpdateThinkingLevel,
  scrollRestoreMessageId,
  onActiveMessageIdChange,
  systemPrompts,
  onSaveSystemPromptPreset,
  onDeleteSystemPromptPreset,
  onDeleteMessage,
  onFileDrop,
  onStopGeneration,
}) => {
  const showNoMessages = conversation && messages.length === 0 && !isLoadingMessages;
  const inputFocusKey = conversation
    ? `${conversation.id}:${isLoadingMessages ? 'loading' : 'ready'}:${messages.length === 0 ? 'empty' : 'messages'}`
    : 'no-conversation';

  // ── 右侧导航条状态 ──
  const messageListRef = useRef<MessageListHandle>(null);
  const [isNavHovered, setIsNavHovered] = useState(false);
  const [activeMessageIndex, setActiveMessageIndex] = useState(0);

  // ── 滚动状态 ──
  const [scrollState, setScrollState] = useState({ isNearBottom: true, isAutoScrollEnabled: false });

  // ── 拖拽上传状态 ──
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [dropVersion, setDropVersion] = useState(0);
  const dragCounterRef = useRef(0);

  const hasFiles = useCallback((dt: DataTransfer): boolean => {
    const types = dt.types;
    if (typeof types.includes === 'function') {
      return types.includes('Files');
    }
    // DOMStringList fallback
    for (let i = 0; i < types.length; i++) {
      if (types[i] === 'Files') return true;
    }
    return false;
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!hasFiles(e.dataTransfer)) return;
    dragCounterRef.current += 1;
    setIsDraggingOver(true);
  }, [hasFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (hasFiles(e.dataTransfer)) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, [hasFiles]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDraggingOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDraggingOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      setDroppedFiles(files);
      setDropVersion((v) => v + 1);
      onFileDrop?.(files);
    }
  }, [onFileDrop]);

  const userMessages = useMemo(
    () => messages.filter((m) => m.role === 'user'),
    [messages]
  );
  const activeUserIndex = useMemo(
    () => getActiveUserIndex(messages, activeMessageIndex),
    [messages, activeMessageIndex]
  );

  const showNavPanel = userMessages.length >= 2;

  // ── 上报活跃消息 ID（用于切换会话时保存滚动位置）──
  useEffect(() => {
    const msg = messages[activeMessageIndex];
    onActiveMessageIdChange?.(msg?.id ?? null);
  }, [activeMessageIndex, messages, onActiveMessageIdChange]);

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

  if (!conversation) {
    return (
      <div className="relative flex flex-col h-full w-full overflow-hidden bg-linear-bg items-center justify-center">
        <div className="w-8 h-8 border-2 border-linear-border border-t-linear-accent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div
      className="relative flex flex-col h-full w-full overflow-hidden bg-linear-bg"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
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
                <EmptyState conversationId={conversation.id} />
                <div className="w-full max-w-2xl mt-8">
                  <ChatInputFooter
                    onSend={onSendMessage}
                    disabled={isSending || isLoadingMessages}
                    models={models}
                    activeModelId={activeModelId}
                    onModelSelect={onModelSelect}
                    thinkingLevel={thinkingLevel}
                    onUpdateThinkingLevel={onUpdateThinkingLevel}
                    droppedFiles={droppedFiles}
                    dropVersion={dropVersion}
                    isSending={isSending}
                    onStop={onStopGeneration}
                    focusKey={inputFocusKey}
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
                      className="absolute right-5 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center py-3 overflow-hidden"
                      style={{
                        width: isNavHovered ? 192 : 20,
                        backgroundColor: isNavHovered ? 'rgba(24, 24, 24, 0.42)' : 'transparent',
                        backdropFilter: isNavHovered ? 'blur(28px) saturate(1.35)' : 'none',
                        borderRadius: isNavHovered ? '12px 0 0 12px' : 0,
                        borderWidth: '1px 0 1px 1px',
                        borderStyle: 'solid',
                        borderColor: isNavHovered ? 'rgba(255,255,255,0.08)' : 'transparent',
                        boxShadow: isNavHovered ? '0 16px 48px rgba(0,0,0,0.32)' : 'none',
                        outline: 'none',
                        transition: [
                          'width 0.28s var(--ease-snappy)',
                          'background-color 0.18s ease',
                          'backdrop-filter 0.18s ease',
                          'border-color 0.18s ease',
                          'border-radius 0.2s var(--ease-snappy)',
                          'box-shadow 0.2s ease',
                        ].join(', '),
                      }}
                      onMouseEnter={() => setIsNavHovered(true)}
                      onMouseLeave={() => setIsNavHovered(false)}
                    >
                      <div className="flex flex-col items-center w-full">
                        {userMessages.map((msg, idx) => {
                          const isActive = idx === activeUserIndex;
                          const { text: textWithoutAttachments, attachments } = parseAttachments(msg.content);
                          const preview = textWithoutAttachments
                            .replace(/!\[.*?\]\(.*?\)/g, '[图片]')
                            .replace(/\n/g, ' ')
                            .slice(0, 18) || (attachments.length > 0 ? '[文件]' : '[空消息]');
                          return (
                            <button
                              key={msg.id}
                              onClick={() => handleNavClick(idx)}
                              className="group relative w-full overflow-hidden rounded-md border border-transparent px-2 py-1.5 text-left outline-none cursor-pointer focus:outline-none focus-visible:outline-none focus-visible:ring-0"
                              aria-label={`跳转到第 ${idx + 1} 条用户消息`}
                              title={isNavHovered ? undefined : msg.content.slice(0, 100)}
                            >
                              <span
                                aria-hidden="true"
                                className={`absolute inset-y-0 left-1 right-1 rounded-md transition-[opacity,transform] duration-200 ${isActive
                                    ? 'translate-x-0 opacity-0'
                                    : '-translate-x-4 opacity-0 group-hover:translate-x-0'
                                  }`}
                                style={{ transitionTimingFunction: 'var(--ease-snappy)' }}
                              />
                              <span className="relative z-10 flex w-full items-center gap-2 transition-transform duration-200 ease-out group-hover:translate-x-1">
                                {/* 短横线标记 */}
                                <span
                                  className={`h-[2px] shrink-0 rounded-full transition-transform group-hover:scale-x-125 ${isActive
                                      ? 'bg-linear-accent'
                                      : 'bg-linear-border group-hover:bg-linear-border-hover'
                                    }`}
                                  style={{
                                    width: isNavHovered ? 16 : 12,
                                    transformOrigin: 'left center',
                                    transition: 'width 0.2s var(--ease-snappy), background-color 0.15s var(--ease-snappy), transform 0.2s var(--ease-snappy)',
                                  }}
                                />
                                {/* 悬浮后显示的文字 */}
                                <span
                                  aria-hidden={!isNavHovered}
                                  className={`min-w-0 flex-1 whitespace-nowrap truncate text-xs text-left transition-[max-width,opacity,transform,color] duration-200 ${isActive
                                      ? 'text-linear-accent font-medium'
                                      : 'text-linear-text-secondary group-hover:text-linear-text-primary'
                                    }`}
                                  style={{
                                    maxWidth: isNavHovered ? 144 : 0,
                                    opacity: isNavHovered ? 1 : 0,
                                    transform: isNavHovered ? 'translateX(0)' : 'translateX(-6px)',
                                    transitionDelay: isNavHovered ? `${70 + Math.min(idx * 18, 180)}ms` : '0ms',
                                    transitionTimingFunction: 'var(--ease-snappy)',
                                  }}
                                >
                                  {preview || '[空消息]'}
                                </span>
                              </span>
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
                    restoreScrollMessageId={scrollRestoreMessageId}
                  />

                  {/* 固定跳转至底部按钮（不随消息列表滚动） */}
                  {!scrollState.isNearBottom && (
                    <button
                      onClick={() => messageListRef.current?.enableAutoScroll()}
                      className={`absolute bottom-6 right-6 z-30 flex items-center justify-center w-10 h-10 rounded-full backdrop-blur-xl border transition-all duration-300 animate-in fade-in zoom-in-95 cursor-pointer ${scrollState.isAutoScrollEnabled
                          ? 'bg-linear-accent text-white border-linear-accent'
                          : 'bg-linear-bg-elevated text-linear-text-secondary border-linear-border hover:bg-linear-surface'
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
                  thinkingLevel={thinkingLevel}
                  onUpdateThinkingLevel={onUpdateThinkingLevel}
                  droppedFiles={droppedFiles}
                  dropVersion={dropVersion}
                  isSending={isSending}
                  onStop={onStopGeneration}
                  focusKey={inputFocusKey}
                />

                {/* 拖拽上传遮罩 */}
                {isDraggingOver && (
                  <div className="absolute inset-0 z-50 bg-linear-bg/80 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-150 pointer-events-none">
                    <div className="flex flex-col items-center gap-4 px-8 py-6 rounded-2xl border-2 border-dashed border-linear-accent bg-linear-bg-elevated/90 shadow-2xl">
                      <svg className="w-10 h-10 text-linear-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l-3 3m3-3l3 3M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12z" />
                      </svg>
                      <span className="text-sm font-medium text-linear-text-primary">释放以上传文件</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </main>
    </div>
  );
};

export default MainChatArea;
