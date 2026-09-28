import { useEffect, useRef, useCallback, useState, type RefObject } from 'react';
import type { Message } from '@/types/types';

/**
 * useChatScroll Hook
 *
 * 职责：智能管理聊天列表的滚动行为。
 * - 默认不自动追踪底部（autoScrollEnabled = false）。
 * - 用户发送新消息时，自动滚动到该用户消息位置。
 * - AI 流式输出完成时，若 autoScrollEnabled 为 true，则滚动到底部。
 * - 用户手动向上滚动（离开底部）时，自动禁用 autoScroll。
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

const BOTTOM_THRESHOLD = 100; // px

export function useChatScroll({ messages, conversationKey }: UseChatScrollOptions): UseChatScrollReturn {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const prevMessagesRef = useRef<Message[]>([]);
  const prevConversationKeyRef = useRef<string | null>(null);

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
    setIsAutoScrollEnabled(true);
    scrollToBottom();
  }, [scrollToBottom]);

  // 监听滚动事件，检测用户是否手动离开底部
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + BOTTOM_THRESHOLD;
      setIsNearBottom(nearBottom);
      if (!nearBottom && isAutoScrollEnabled) {
        setIsAutoScrollEnabled(false);
      }
    };

    el.addEventListener('scroll', handleScroll);
    handleScroll();

    return () => el.removeEventListener('scroll', handleScroll);
  }, [isAutoScrollEnabled]);

  // 监听 messages 变化，处理两种滚动场景
  useEffect(() => {
    const prev = prevMessagesRef.current;
    const curr = messages;
    const convKey = conversationKey ?? null;
    const conversationChanged = prevConversationKeyRef.current !== convKey;
    prevMessagesRef.current = curr;
    prevConversationKeyRef.current = convKey;

    if (curr.length === 0) return;

    // 会话切换时，跳过"新消息"滚动逻辑（打开会话由 MessageList 统一滚动到底部）
    if (conversationChanged) return;

    const didPrependHistory =
      prev.length > 0 &&
      curr.length > prev.length &&
      curr[0]?.id !== prev[0]?.id &&
      curr[curr.length - 1]?.id === prev[prev.length - 1]?.id;

    // 场景 1：检测新增的用户消息，滚动到该消息；向上分页 prepend 历史时跳过。
    if (curr.length > prev.length && !didPrependHistory) {
      const newMessages = curr.slice(prev.length);
      for (let i = 0; i < newMessages.length; i++) {
        if (newMessages[i].role === 'user') {
          const globalIndex = prev.length + i;
          requestAnimationFrame(() => {
            scrollToMessage(globalIndex);
          });
          break;
        }
      }
    }

    // 场景 2：检测最后一条消息从 streaming -> completed，且 autoScrollEnabled 时滚动到底部
    const lastMsg = curr[curr.length - 1];
    const prevLastMsg = prev[prev.length - 1];
    if (
      lastMsg &&
      prevLastMsg &&
      lastMsg.id === prevLastMsg.id &&
      prevLastMsg.status === 'streaming' &&
      lastMsg.status === 'completed' &&
      isAutoScrollEnabled
    ) {
      scrollToBottom();
    }
  }, [messages, isAutoScrollEnabled, scrollToBottom, scrollToMessage, conversationKey]);

  return {
    scrollRef,
    isAutoScrollEnabled,
    isNearBottom,
    enableAutoScroll,
    scrollToBottom,
    scrollToMessage,
  };
}
