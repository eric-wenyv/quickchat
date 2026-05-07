import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { Message } from '@/types/types';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import MessageBubble from './MessageBubble';

interface MessageListProps {
  messages: Message[];
  onLoadMore: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
}

/**
 * C-4: MessageList
 * 消息列表容器组件。
 * 职责：负责渲染消息流主体、管理消息到达时的自动滚动、以及向上滚动的流式分页加载。
 * 新增：右侧快速定位导航条（类似 Google AI Studio）。
 */
const MessageList: React.FC<MessageListProps> = ({
  messages,
  onLoadMore,
  hasMore,
  isLoadingMore,
}) => {
  // 注入自动滚动钩子：当消息数组长度或内容变化时，自动同步滚动到底部
  const scrollRef = useAutoScroll([messages]);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // ── 消息快速定位导航条状态 ──
  const messageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const rafRef = useRef<number | null>(null);

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
    // 初始化一次
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

  // 点击导航点滚动到对应消息
  const handleDotClick = (index: number) => {
    const el = messageRefs.current[index];
    const container = scrollRef.current;
    if (!el || !container) return;
    const targetTop = el.offsetTop - 24; // 留一些顶部呼吸空间
    container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
  };

  // 向上滚动加载更多：使用 Intersection Observer 监听列表顶部占位符
  useEffect(() => {
    if (!hasMore || isLoadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // 当占位符进入视口（即用户滚动到顶部附近）时，触发加载回调
        if (entries[0].isIntersecting) {
          onLoadMore();
        }
      },
      { 
        root: scrollRef.current,
        threshold: 0.1,
        rootMargin: '100px 0px 0px 0px' // 提前 100px 预加载，确保体验连贯
      }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore, scrollRef]);

  const showNavBar = messages.length >= 3;

  return (
    <div
      ref={scrollRef}
      id="message-list-container"
      className="flex-1 w-full overflow-y-auto overflow-x-hidden flex flex-col bg-transparent custom-scrollbar relative"
    >
      {/* 内部弹性容器，通过 min-h-full 确保内容不足时也能撑开高度 */}
      <div className="flex flex-col w-full min-h-full">
        
        {/* 顶部加载状态/触发区 */}
        {hasMore && (
          <div 
            ref={loadMoreRef} 
            className="flex justify-center items-center py-10 w-full"
          >
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

        {/* 消息渲染流：不加额外边距，MessageBubble 内部已处理 py-6 间距 */}
        <div className="flex flex-col w-full">
          {messages.map((message, index) => (
            <div
              key={message.id}
              ref={(el) => { messageRefs.current[index] = el; }}
            >
              <MessageBubble message={message} />
            </div>
          ))}
        </div>
        
        {/* 底部安全占位：确保最后一条消息与输入框/底部栏保持呼吸感，且利于 auto-scroll 到底部的视觉表现 */}
        <div className="h-16 w-full flex-shrink-0" aria-hidden="true" />
      </div>

      {/* ── 右侧消息快速定位导航条 ── */}
      {showNavBar && (
        <div className="absolute right-2 top-4 bottom-20 w-4 flex flex-col items-center z-10 pointer-events-none">
          <div className="relative w-full flex-1">
            {messages.map((message, index) => {
              const isActive = index === activeIndex;
              const isUser = message.role === 'user';
              return (
                <button
                  key={message.id}
                  onClick={() => handleDotClick(index)}
                  className={`
                    absolute left-1/2 -translate-x-1/2 rounded-full pointer-events-auto
                    transition-all duration-200 cursor-pointer
                    ${isActive 
                      ? 'w-2 h-2 bg-ink-400 dark:bg-white shadow-[0_0_6px_rgba(0,0,0,0.2)]' 
                      : isUser 
                        ? 'w-1.5 h-1.5 bg-ink-200/40 hover:bg-ink-200/70' 
                        : 'w-1.5 h-1.5 bg-ink-200/30 hover:bg-ink-200/60'
                    }
                  `}
                  style={{
                    top: `${(index / (messages.length - 1)) * 100}%`,
                  }}
                  title={`${isUser ? 'User' : 'Assistant'} · 第 ${index + 1} 条`}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default MessageList;
