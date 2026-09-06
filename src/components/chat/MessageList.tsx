import { useRef, useEffect, useState, useCallback, useLayoutEffect, forwardRef, useImperativeHandle } from 'react';
import type { Message, UUID } from '@/types/types';
import { useChatScroll } from '@/hooks/useChatScroll';
import MessageBubble from './MessageBubble';
import SelectionCopyBar from './SelectionCopyBar';

interface MessageListProps {
  messages: Message[];
  onLoadMore: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onDeleteMessage?: (id: string) => void;
  onActiveIndexChange?: (index: number) => void;
  onScrollStateChange?: (state: { isNearBottom: boolean; isAutoScrollEnabled: boolean }) => void;
  /** 切换会话后需要恢复滚动到的消息 ID */
  restoreScrollMessageId?: UUID | null;
}

export interface MessageListHandle {
  scrollToMessage: (index: number) => void;
  enableAutoScroll: () => void;
}

/**
 * C-4: MessageList
 * 消息列表容器组件。
 * 职责：负责渲染消息流主体、管理消息到达时的自动滚动、以及向上滚动的流式分页加载。
 */
const MessageList = forwardRef<MessageListHandle, MessageListProps>(
  ({ messages, onLoadMore, hasMore, isLoadingMore, onDeleteMessage, onActiveIndexChange, onScrollStateChange, restoreScrollMessageId }, ref) => {
    const {
      scrollRef,
      isAutoScrollEnabled,
      isNearBottom,
      enableAutoScroll,
      scrollToMessage,
      scrollToBottom,
    } = useChatScroll({ messages, conversationKey: messages[0]?.conversation_id ?? null });
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const messageRefs = useRef<(HTMLDivElement | null)[]>([]);
    const pendingPrependScrollRef = useRef<{ firstMessageId: UUID; scrollHeight: number; scrollTop: number } | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const rafRef = useRef<number | null>(null);
    const restoredScrollForRef = useRef<string | null>(null);

    // 暴露 scrollToMessage 和 enableAutoScroll 给父组件
    useImperativeHandle(ref, () => ({
      scrollToMessage: (index: number) => {
        scrollToMessage(index);
      },
      enableAutoScroll: () => {
        enableAutoScroll();
      },
    }));

    // 通知父组件滚动状态变化
    useEffect(() => {
      onScrollStateChange?.({ isNearBottom, isAutoScrollEnabled });
    }, [isNearBottom, isAutoScrollEnabled, onScrollStateChange]);

    // 通知父组件活跃索引变化
    useEffect(() => {
      onActiveIndexChange?.(activeIndex);
    }, [activeIndex, onActiveIndexChange]);

    // 切换会话后恢复滚动位置；没有保存位置时落到当前最新页底部。
    useEffect(() => {
      if (messages.length === 0) {
        restoredScrollForRef.current = null;
        return;
      }

      const convKey = messages[0]?.conversation_id ?? '';
      const restoreTarget = restoreScrollMessageId ?? '__bottom__';
      const restoreKey = `${convKey}:${restoreTarget}`;
      if (restoredScrollForRef.current === restoreKey) return;

      if (!restoreScrollMessageId) {
        restoredScrollForRef.current = restoreKey;
        requestAnimationFrame(() => {
          requestAnimationFrame(scrollToBottom);
        });
        return;
      }

      const index = messages.findIndex(m => m.id === restoreScrollMessageId);
      if (index === -1) return; // 消息还未加载，等下次 effect

      restoredScrollForRef.current = restoreKey;
      // 双 rAF 确保 DOM 已完成渲染后再滚动
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToMessage(index);
        });
      });
    }, [restoreScrollMessageId, messages, scrollToMessage, scrollToBottom]);

    // 计算当前视口中心最接近的消息索引
    const updateActiveIndex = useCallback(() => {
      const container = scrollRef.current;
      if (!container || messages.length === 0) return;
      const viewportCenter = container.scrollTop + container.clientHeight / 2;
      let closestIdx = 0;
      let minDist = Infinity;
      messageRefs.current.forEach((el, idx) => {
        if (!el) return;
        const elCenter = el.offsetTop + el.clientHeight / 2;
        const dist = Math.abs(elCenter - viewportCenter);
        if (dist < minDist) {
          minDist = dist;
          closestIdx = idx;
        }
      });
      setActiveIndex(closestIdx);
    }, [messages.length]);

    useLayoutEffect(() => {
      const pending = pendingPrependScrollRef.current;
      const container = scrollRef.current;
      if (!pending || !container) return;

      const stillContainsAnchor = messages.some(m => m.id === pending.firstMessageId);
      const didPrependHistory = stillContainsAnchor && messages[0]?.id !== pending.firstMessageId;
      if (!didPrependHistory) return;

      const heightDelta = container.scrollHeight - pending.scrollHeight;
      container.scrollTop = pending.scrollTop + heightDelta;
      pendingPrependScrollRef.current = null;
      requestAnimationFrame(updateActiveIndex);
    }, [messages, scrollRef, updateActiveIndex]);

    useEffect(() => {
      if (!isLoadingMore && pendingPrependScrollRef.current?.firstMessageId === messages[0]?.id) {
        pendingPrependScrollRef.current = null;
      }
    }, [isLoadingMore, messages]);

    useEffect(() => {
      const container = scrollRef.current;
      if (!container) return;

      const handleScroll = () => {
        if (rafRef.current !== null) return;
        rafRef.current = requestAnimationFrame(() => {
          updateActiveIndex();
          rafRef.current = null;
        });
      };

      container.addEventListener('scroll', handleScroll);
      const timer = window.setTimeout(updateActiveIndex, 100);
      return () => {
        container.removeEventListener('scroll', handleScroll);
        clearTimeout(timer);
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      };
    }, [updateActiveIndex]);

    // 向上滚动加载更多
    useEffect(() => {
      if (!hasMore || isLoadingMore) return;

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            const container = scrollRef.current;
            const firstMessage = messages[0];
            if (container && firstMessage) {
              pendingPrependScrollRef.current = {
                firstMessageId: firstMessage.id,
                scrollHeight: container.scrollHeight,
                scrollTop: container.scrollTop,
              };
            }
            onLoadMore();
          }
        },
        {
          root: scrollRef.current,
          threshold: 0.1,
          rootMargin: '100px 0px 0px 0px',
        }
      );

      if (loadMoreRef.current) {
        observer.observe(loadMoreRef.current);
      }

      return () => observer.disconnect();
    }, [hasMore, isLoadingMore, onLoadMore, scrollRef, messages]);

    return (
      <div
        ref={scrollRef}
        id="message-list-container"
        className="flex-1 w-full overflow-y-auto overflow-x-hidden flex flex-col bg-transparent custom-scrollbar relative"
      >
        <div className="flex flex-col w-full min-h-full">
          {/* 顶部加载状态/触发区 */}
          {hasMore && (
            <div ref={loadMoreRef} className="flex justify-center items-center py-10 w-full">
              <div className="flex items-center gap-3 px-4 py-2 bg-linear-surface rounded-full border border-linear-border text-linear-text-tertiary text-[11px] font-medium tracking-tight backdrop-blur-sm select-none">
                {isLoadingMore ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5 text-linear-text-muted" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>正在回溯历史...</span>
                  </>
                ) : (
                  <span className="opacity-60">向上滚动以加载更多历史</span>
                )}
              </div>
            </div>
          )}

          {/* 消息渲染流 */}
          <div className="flex flex-col w-full">
            {messages.map((message, index) => (
              <div
                key={message.id}
                data-message-index={index}
                ref={(el) => {
                  messageRefs.current[index] = el;
                }}
              >
                <MessageBubble message={message} onDelete={onDeleteMessage} />
              </div>
            ))}
          </div>

          {/* 底部安全占位 */}
          <div className="h-16 w-full flex-shrink-0" aria-hidden="true" />
        </div>

        {/* 移动端选区悬浮复制条（portal 到 body） */}
        <SelectionCopyBar messages={messages} />
      </div>
    );
  }
);

MessageList.displayName = 'MessageList';
export default MessageList;
