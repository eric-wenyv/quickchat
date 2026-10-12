import { useEffect, useRef, useCallback, useState, useLayoutEffect, type RefObject } from 'react';
import type { Message } from '@/types/types';

/**
 * useChatScroll Hook
 *
 * 职责：智能管理聊天列表的滚动行为。
 * - 默认不自动追踪底部（autoScrollEnabled = false）。
 * - 用户发送新消息时，若发送前视口不在底部附近，平滑滚动到该用户消息位置。
 * - 发送前视口在底部附近（约 1-2 行容错）时，进入跟随模式：AI 思考和流式
 *   输出期间持续钉在底部（token 增长与代码高亮/图片/KaTeX 等异步撑高都跟随），
 *   用户向上滚动离开底部超过阈值时解除。
 * - 挂载时若末尾消息正在流式生成（空会话首条消息、生成中切回会话），
 *   直接进入跟随模式。注意空会话下 MessageList 整体不挂载（EmptyState 分支），
 *   首条消息发送时的挂载必须视为"刚发送"而非"打开会话"。
 * - 提供 enableAutoScroll()（同时立即 scrollToBottom）和 scrollToMessage(index)。
 */

interface UseChatScrollOptions {
  messages: Message[];
  /** 会话标识，变化时重置内部状态（避免跨会话误触发"新消息"滚动） */
  conversationKey?: string | null;
}

interface UseChatScrollReturn {
  scrollRef: RefObject<HTMLDivElement | null>;
  isAutoScrollEnabled: boolean;
  isNearBottom: boolean;
  enableAutoScroll: () => void;
  scrollToBottom: () => void;
  scrollToMessage: (index: number) => void;
}

const BOTTOM_THRESHOLD = 100; // px，"回到底部"按钮显隐/解除跟随的判定
const SEND_FOLLOW_THRESHOLD = 64; // px，发送前距底部在该范围内（约 1-2 行）则跟随 AI 输出

/** 上一次 commit 末尾消息的尾部快照，用于区分追加/prepend/会话切换/状态流转 */
interface TailSnapshot {
  key: string | null;
  len: number;
  firstId: string | null;
  lastId: string | null;
  lastStatus: Message['status'] | null;
}

export function useChatScroll({ messages, conversationKey }: UseChatScrollOptions): UseChatScrollReturn {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  // isAutoScrollEnabled 的同步镜像：滚动/ResizeObserver 回调里直接读写，
  // 避免 setState 异步间隙内程序化滚动与用户滚动互相干扰
  const autoScrollRef = useRef(false);
  // 上一帧 scrollTop，用于区分用户上滚与程序化下滚
  const lastScrollTopRef = useRef(0);
  // 视口距底部距离，由滚动事件与每次 commit 结束时的布局阶段持续维护；
  // 发送检测读取的是"新消息追加前"的值（本帧布局阶段读取后再覆写）
  const distToBottomRef = useRef(0);
  const tailRef = useRef<TailSnapshot | null>(null);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  const scrollToMessage = useCallback((index: number) => {
    const container = scrollRef.current;
    if (!container) return;
    // 按属性值查找：渐进式渲染期间 DOM 中的消息只是全量列表的尾部窗口，
    // 不能再用 NodeList 下标对应全局索引
    const target = container.querySelector<HTMLElement>(`[data-message-index="${index}"]`);
    if (!target) return;
    const targetTop = target.offsetTop - 24;
    container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
  }, []);

  const enableAutoScroll = useCallback(() => {
    autoScrollRef.current = true;
    setIsAutoScrollEnabled(true);
    scrollToBottom();
  }, [scrollToBottom]);

  // 监听滚动事件，检测用户是否手动离开底部
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      distToBottomRef.current = distanceToBottom;
      const nearBottom = distanceToBottom <= BOTTOM_THRESHOLD;
      setIsNearBottom(nearBottom);
      // 只有"向上滚动"才解除跟随：程序化平滑滚动（scrollToBottom）的中间帧
      // 同样会短暂离开底部，但那并非用户意图
      const scrolledUp = el.scrollTop < lastScrollTopRef.current;
      lastScrollTopRef.current = el.scrollTop;
      if (scrolledUp && !nearBottom && autoScrollRef.current) {
        autoScrollRef.current = false;
        setIsAutoScrollEnabled(false);
      }
    };

    el.addEventListener('scroll', handleScroll);
    handleScroll();

    return () => el.removeEventListener('scroll', handleScroll);
  }, [isAutoScrollEnabled]);

  // 统一的消息变化处理，在布局阶段（绘制前）执行：
  // 1. 挂载/会话切换：末尾消息正在流式生成则直接进入跟随；
  // 2. 同会话尾部新增用户消息：按追加前的视口位置决定跟随还是滚动到该消息；
  // 3. 末尾消息 streaming -> completed：跟随中则平滑收尾；
  // 4. 跟随期间每次 commit 都把视口钉在底部（即时滚动，平滑滚动跟不上 token 频率）。
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const convKey = conversationKey ?? null;
    const prev = tailRef.current;
    const last = messages[messages.length - 1];

    if (el && messages.length > 0) {
      if (prev === null || prev.key !== convKey) {
        // 挂载/会话切换。空会话首条消息发送时 MessageList 才挂载（EmptyState 分支），
        // 此时末尾是 streaming 的 AI 占位消息，必须进入跟随而非当作普通打开
        const streaming = last?.status === 'streaming';
        autoScrollRef.current = streaming;
        setIsAutoScrollEnabled(streaming);
      } else if (messages.length > prev.len) {
        const didPrependHistory =
          prev.len > 0 &&
          messages[0]?.id !== prev.firstId &&
          last?.id === prev.lastId;
        if (!didPrependHistory) {
          const newUserIndex = messages.slice(prev.len).findIndex(m => m.role === 'user');
          if (newUserIndex >= 0) {
            if (distToBottomRef.current <= SEND_FOLLOW_THRESHOLD) {
              // 发送前已在底部附近：进入跟随模式，不再平滑滚动到用户消息
              // （避免与跟随滚动互相拉扯）
              autoScrollRef.current = true;
              setIsAutoScrollEnabled(true);
            } else {
              const globalIndex = prev.len + newUserIndex;
              requestAnimationFrame(() => scrollToMessage(globalIndex));
            }
          }
        }
      } else if (
        last &&
        prev.lastId === last.id &&
        prev.lastStatus === 'streaming' &&
        last.status === 'completed' &&
        autoScrollRef.current
      ) {
        scrollToBottom();
      }

      if (autoScrollRef.current) {
        el.scrollTop = el.scrollHeight;
      }
      distToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight;
    }

    tailRef.current = {
      key: convKey,
      len: messages.length,
      firstId: messages[0]?.id ?? null,
      lastId: last?.id ?? null,
      lastStatus: last?.status ?? null,
    };
  }, [messages, conversationKey, scrollToMessage, scrollToBottom]);

  // 跟随模式：内容异步撑高（代码高亮、图片、KaTeX、Mermaid 渲染完成）时同样钉在底部
  useEffect(() => {
    if (!isAutoScrollEnabled) return;
    const el = scrollRef.current;
    const content = el?.firstElementChild;
    if (!el || !content) return;

    const observer = new ResizeObserver(() => {
      if (autoScrollRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [isAutoScrollEnabled]);

  return {
    scrollRef,
    isAutoScrollEnabled,
    isNearBottom,
    enableAutoScroll,
    scrollToBottom,
    scrollToMessage,
  };
}
