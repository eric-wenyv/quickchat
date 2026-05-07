import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import type { Message } from '@/types/types';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import MessageBubble from './MessageBubble';

interface MessageListProps {
  messages: Message[];
  onLoadMore: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onDeleteMessage?: (id: string) => void;
}

export interface MessageListHandle {
  scrollToMessage: (index: number) => void;
}

/**
 * C-4: MessageList
 * 消息列表容器组件。
 * 职责：负责渲染消息流主体、管理消息到达时的自动滚动、以及向上滚动的流式分页加载。
 */
const MessageList = forwardRef<MessageListHandle, MessageListProps>(
  ({ messages, onLoadMore, hasMore, isLoadingMore, onDeleteMessage }, ref) => {
    const scrollRef = useAutoScroll([messages]);
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const messageRefs = useRef<(HTMLDivElement | null)[]>([]);

    // 暴露 scrollToMessage 给父组件
    useImperativeHandle(ref, () => ({
      scrollToMessage: (index: number) => {
        const el = messageRefs.current[index];
        const container = scrollRef.current;
        if (!el || !container) return;
        const targetTop = el.offsetTop - 24;
        container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
      },
    }));

    // 向上滚动加载更多
    useEffect(() => {
      if (!hasMore || isLoadingMore) return;

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
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
    }, [hasMore, isLoadingMore, onLoadMore, scrollRef]);

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
              <div className="flex items-center gap-3 px-4 py-2 bg-sand-200/40 rounded-full border border-sand-400/20 text-ink-200 text-[11px] font-medium tracking-tight backdrop-blur-sm select-none">
                {isLoadingMore ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5 text-ink-100" viewBox="0 0 24 24" fill="none">
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
      </div>
    );
  }
);

MessageList.displayName = 'MessageList';
export default MessageList;
