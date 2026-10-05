import { useRef, useEffect, useState, useCallback, useLayoutEffect, forwardRef, useImperativeHandle, memo } from 'react';
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
}

export interface MessageListHandle {
  scrollToMessage: (index: number) => void;
  enableAutoScroll: () => void;
}

/** 打开会话时首屏只渲染尾部这么多条消息，其余按需分块补渲染 */
const INITIAL_RENDER_COUNT = 6;
/** 渐进式渲染每帧向上补渲染的消息条数（单帧同步渲染太多会掉帧） */
const RENDER_CHUNK_SIZE = 8;
/** 视口距已渲染窗口顶部不足该距离时预取下一批（提前补渲染，用户滚到时不等待） */
const EXPANSION_TRIGGER_PX = 2000;
/** 打开会话后进入底部钉住状态，用户向上滚动离开底部超过该距离时解除钉住 */
const PIN_RELEASE_THRESHOLD_PX = 100;
/** 打开会话时立即走完整 markdown 管线的尾部消息条数（首屏可见区域） */
const EAGER_RICH_TAIL_COUNT = 2;
/** 首帧绘制后每帧向上升级的延迟渲染消息条数 */
const RICH_UPGRADE_PER_FRAME = 2;

/**
 * C-4: MessageList
 * 消息列表容器组件。
 * 职责：负责渲染消息流主体、管理消息到达时的自动滚动、以及向上滚动的流式分页加载。
 */
const MessageList = forwardRef<MessageListHandle, MessageListProps>(
  ({ messages, onLoadMore, hasMore, isLoadingMore, onDeleteMessage, onActiveIndexChange, onScrollStateChange }, ref) => {
    const conversationKey = messages[0]?.conversation_id ?? null;
    const {
      scrollRef,
      isAutoScrollEnabled,
      isNearBottom,
      enableAutoScroll,
      scrollToMessage,
    } = useChatScroll({ messages, conversationKey });
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const messageRefs = useRef<(HTMLDivElement | null)[]>([]);
    const pendingPrependScrollRef = useRef<{ firstMessageId: UUID; scrollHeight: number; scrollTop: number } | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const rafRef = useRef<number | null>(null);
    const restoredScrollForRef = useRef<string | null>(null);
    // 打开会话后的"底部钉住"标记：钉住期间内容高度变化时始终跟随到底部，
    // 用户主动向上滚动离开底部后解除
    const pinToBottomRef = useRef(false);

    // ── 渐进式渲染：打开长会话时一次性同步渲染整页消息（markdown/KaTeX 管线）
    //    会形成长任务卡住主线程。这里先只渲染尾部一屏；之后不做后台补齐——
    //    后台扩窗会把整页消息的 markdown 渲染连环压到主线程上，表现为加载完成后
    //    滚动仍长时间无响应。只在用户滚动接近窗口顶部或快速跳转需要时按需扩窗。
    const [renderLimit, setRenderLimit] = useState(INITIAL_RENDER_COUNT);
    const renderMetaRef = useRef({ conversationKey, length: messages.length });
    // 快速跳转目标：目标尚未渲染时先记下，扩窗覆盖后由布局阶段执行跳转
    const pendingJumpIndexRef = useRef<number | null>(null);
    // 延迟渲染区间 [from, to)：打开会话时非尾部的消息先以纯文本占位（不跑
    // markdown 管线），首帧绘制后每帧向上升级。区间固定在打开时刻的初始窗口内，
    // 扩窗暴露的新消息始终立即完整渲染。必须用 ref 承载区间：渲染期 setState
    // 会让第一遍渲染按"无延迟区间"执行，白跑一遍完整 markdown 解析后才被丢弃。
    // 注意惰性初始化：MessageList 是 lazy 组件，首帧渲染时消息可能已就位，
    // 只在"会话切换"分支里初始化会漏掉这种挂载即带数据的路径
    const deferredRangeRef = useRef<{ key: string | null; from: number; to: number } | null>(null);
    if (deferredRangeRef.current === null || deferredRangeRef.current.key !== conversationKey) {
      deferredRangeRef.current = {
        key: conversationKey,
        from: Math.max(0, messages.length - INITIAL_RENDER_COUNT),
        to: Math.max(0, messages.length - EAGER_RICH_TAIL_COUNT),
      };
    }
    // 升级节拍：仅用于触发重渲染，真实区间在 deferredRangeRef 上同步维护
    const [, setUpgradeTick] = useState(0);
    if (
      renderMetaRef.current.conversationKey !== conversationKey ||
      renderMetaRef.current.length !== messages.length
    ) {
      const prev = renderMetaRef.current;
      if (prev.conversationKey !== conversationKey) {
        // 切换会话：渲染窗口重置为尾部一屏
        pendingJumpIndexRef.current = null;
        setRenderLimit(INITIAL_RENDER_COUNT);
      } else if (messages.length > prev.length) {
        // 同会话内增长（向上分页/新消息）：同步扩大窗口，保证已渲染的消息不被裁掉
        setRenderLimit((c) => Math.min(c + (messages.length - prev.length), messages.length));
      }
      renderMetaRef.current = { conversationKey, length: messages.length };
    }

    const firstRenderedIndex = Math.max(0, messages.length - renderLimit);
    const isFullyRendered = firstRenderedIndex === 0;
    const renderedMessages = isFullyRendered ? messages : messages.slice(firstRenderedIndex);
    const deferredRange = deferredRangeRef.current ?? { key: null, from: 0, to: 0 };

    // 向上扩展渲染窗口前记录滚动锚点，由下方 useLayoutEffect 补偿，
    // 保证新内容出现在视口上方时用户看到的内容不跳动。
    const expansionAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);

    // 按需向上扩展一个分块。触发条件二选一：
    // 1. 视口距已渲染窗口顶部不足 EXPANSION_TRIGGER_PX（用户正往上翻，提前补渲染）；
    // 2. 存在待跳转目标且尚未进入渲染窗口（右侧快速跳转到窗口外的消息）。
    const expandWindowStep = useCallback(() => {
      if (isFullyRendered) return;
      const container = scrollRef.current;
      const pendingJump = pendingJumpIndexRef.current;
      const jumpPending = pendingJump !== null && pendingJump < firstRenderedIndex;
      const nearRenderedTop = container !== null && container.scrollTop <= EXPANSION_TRIGGER_PX;
      if (!jumpPending && !nearRenderedTop) return;
      if (container) {
        expansionAnchorRef.current = {
          scrollHeight: container.scrollHeight,
          scrollTop: container.scrollTop,
        };
      }
      setRenderLimit((c) => Math.min(c + RENDER_CHUNK_SIZE, messages.length));
    }, [isFullyRendered, firstRenderedIndex, messages.length, scrollRef]);

    useLayoutEffect(() => {
      const anchor = expansionAnchorRef.current;
      const container = scrollRef.current;
      expansionAnchorRef.current = null;
      if (!anchor || !container) return;
      const heightDelta = container.scrollHeight - anchor.scrollHeight;
      if (heightDelta > 0) {
        container.scrollTop = anchor.scrollTop + heightDelta;
      }
      // 待跳转目标已进入渲染窗口：立即跳转。长距离跳转用即时滚动，
      // 避免平滑动画跨越大段未浏览内容
      const pendingJump = pendingJumpIndexRef.current;
      if (pendingJump !== null && pendingJump >= firstRenderedIndex) {
        pendingJumpIndexRef.current = null;
        const target = container.querySelector<HTMLElement>(`[data-message-index="${pendingJump}"]`);
        if (target) {
          container.scrollTo({ top: Math.max(0, target.offsetTop - 24), behavior: 'auto' });
        }
      }
      // 若仍处于触发条件内（用户贴近窗口顶部 / 跳转目标未覆盖），下一帧继续扩窗
      requestAnimationFrame(expandWindowStep);
    }, [renderLimit, scrollRef, firstRenderedIndex, expandWindowStep]);

    // 暴露 scrollToMessage 和 enableAutoScroll 给父组件
    useImperativeHandle(ref, () => ({
      scrollToMessage: (index: number) => {
        if (index < firstRenderedIndex) {
          // 目标消息尚未渲染：记录待跳转目标并立即开始向上扩窗，
          // 窗口覆盖目标后由布局阶段执行跳转
          pendingJumpIndexRef.current = index;
          expandWindowStep();
          return;
        }
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

    // 打开会话后直接定位到页面最底部（每个会话只执行一次，之后的滚动由用户掌控）。
    // useLayoutEffect 在浏览器绘制前同步滚动，首帧即停留在底部，
    // 避免"先显示顶部、再跳到底部"的闪烁。
    useLayoutEffect(() => {
      if (messages.length === 0) {
        restoredScrollForRef.current = null;
        return;
      }

      const convKey = messages[0]?.conversation_id ?? '';
      if (restoredScrollForRef.current === convKey) return;
      restoredScrollForRef.current = convKey;

      const container = scrollRef.current;
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
      }
      // 扩窗检查放到首帧绘制之后：打开时的首要目标是尽快画出底部一屏，
      // 向上补渲染（markdown 解析重）不应拖慢首帧
      requestAnimationFrame(() => {
        expandWindowStep();
      });
      // 进入底部钉住状态：代码高亮、Mermaid、图片、KaTeX 等异步渲染会继续撑高
      // 内容，钉住期间由下方 ResizeObserver 持续跟随到底部
      pinToBottomRef.current = true;
      // 内容总高不大时底部 scrollTop 也在预取距离内，这里补一轮扩窗检查
      expandWindowStep();
    }, [messages, scrollRef, expandWindowStep]);

    // 底部钉住：内容高度变化（异步渲染完成、后台补历史 prepend 等）时保持视口
    // 钉在底部；用户向上滚动离开底部超过阈值后解除钉住，不再干预浏览位置。
    useEffect(() => {
      const container = scrollRef.current;
      const content = container?.firstElementChild;
      if (!container || !content) return;

      const observer = new ResizeObserver(() => {
        if (!pinToBottomRef.current) return;
        container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
      });
      observer.observe(content);

      const handleScroll = () => {
        if (!pinToBottomRef.current) return;
        const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (distanceToBottom > PIN_RELEASE_THRESHOLD_PX) {
          pinToBottomRef.current = false;
        }
      };
      container.addEventListener('scroll', handleScroll, { passive: true });

      return () => {
        observer.disconnect();
        container.removeEventListener('scroll', handleScroll);
      };
    }, [scrollRef]);

    // 延迟渲染升级：首帧绘制后每帧把延迟区间底部（离视口最近）的消息升级为
    // 完整 markdown 渲染。升级引起的高度变化位于视口上方，配合底部钉住对视口无影响
    useEffect(() => {
      const range = deferredRangeRef.current;
      if (!range || range.to <= range.from) return;
      const raf = requestAnimationFrame(() => {
        deferredRangeRef.current = {
          key: range.key,
          from: range.from,
          to: Math.max(range.from, range.to - RICH_UPGRADE_PER_FRAME),
        };
        setUpgradeTick((t) => t + 1);
      });
      return () => cancelAnimationFrame(raf);
    });

    // 计算当前视口中心最接近的消息索引。
    // 消息按 offsetTop 单调递增排列，用二分查找把每次滚动帧的开销从 O(N) 降到 O(log N)。
    // 注意只需在已渲染范围 [firstRenderedIndex, count) 内查找（渐进式渲染期间头部消息可能未挂载）。
    const updateActiveIndex = useCallback(() => {
      const container = scrollRef.current;
      const count = messages.length;
      if (!container || count === 0) return;
      const els = messageRefs.current;
      const viewportCenter = container.scrollTop + container.clientHeight / 2;

      // 找到第一个底边越过视口中心的消息
      let lo = firstRenderedIndex;
      let hi = count - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const el = els[mid];
        if (!el) break;
        if (el.offsetTop + el.clientHeight < viewportCenter) lo = mid + 1;
        else hi = mid;
      }

      // 与上一条消息比较，取中心距离更近者
      let closestIdx = lo;
      const current = els[lo];
      const prev = lo > 0 ? els[lo - 1] : null;
      if (prev && !current) {
        closestIdx = lo - 1;
      } else if (prev && current) {
        const distPrev = Math.abs(prev.offsetTop + prev.clientHeight / 2 - viewportCenter);
        const distCurrent = Math.abs(current.offsetTop + current.clientHeight / 2 - viewportCenter);
        if (distPrev <= distCurrent) closestIdx = lo - 1;
      }
      setActiveIndex(closestIdx);
    }, [messages.length, firstRenderedIndex]);

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
          // 滚动接近已渲染窗口顶部时按需向上补渲染
          expandWindowStep();
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
    }, [updateActiveIndex, expandWindowStep]);

    // 向上滚动加载更多（渐进式渲染窗口尚未补全时先不触发，避免本地补渲染与分页 prepend 同时进行）
    useEffect(() => {
      if (!hasMore || isLoadingMore || !isFullyRendered) return;

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
    }, [hasMore, isLoadingMore, isFullyRendered, onLoadMore, scrollRef, messages]);

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

          {/* 消息渲染流（渐进式：只渲染 [firstRenderedIndex, messages.length) 窗口，
              向上扩展时由 expansionAnchorRef 补偿滚动位置，视口内容保持稳定） */}
          <div className="flex flex-col w-full">
          {renderedMessages.map((message, offset) => {
            const index = firstRenderedIndex + offset;
            return (
              <div
                key={message.id}
                data-message-index={index}
                ref={(el) => {
                  messageRefs.current[index] = el;
                }}
              >
                <MessageBubble
                  message={message}
                  onDelete={onDeleteMessage}
                  deferRich={index >= deferredRange.from && index < deferredRange.to}
                />
              </div>
            );
          })}
          </div>

          {/* 底部安全占位：需容纳最后一条消息悬浮的复制/删除按钮（约 34px，
              行内 py-6 已覆盖 24px，这里补足剩余空间即可） */}
          <div className="h-6 w-full flex-shrink-0" aria-hidden="true" />
        </div>

        {/* 移动端选区悬浮复制条（portal 到 body） */}
        <SelectionCopyBar messages={messages} />
      </div>
    );
  }
);

MessageList.displayName = 'MessageList';
// memo：父组件的导航 hover、滚动定位等状态变化不应触发整个消息列表重渲染
export default memo(MessageList);
