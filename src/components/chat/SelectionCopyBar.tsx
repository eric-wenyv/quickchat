import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { Message } from '@/types/types';
import { isMobilePlatform } from '@/utils/platform';
import { copyTextToClipboard } from '@/hooks/useCopy';

interface SelectionCopyBarProps {
  messages: Message[];
}

const BAR_WIDTH = 96;
const BAR_HEIGHT = 36;
const EDGE_GAP = 8;
const DEBOUNCE_MS = 120;

/**
 * 移动端选区悬浮复制条：
 * 1. selectionchange 驱动 — 仅当非塌陷选区落在 AI 消息正文（.qc-markdown）内时显示；
 * 2. 悬浮在选区上方（顶部空间不足时翻转到下方），随滚动重新定位；
 * 3. 复制 selection.toString()，成功后清空选区并短暂显示"已复制"。
 * 手动拖选与长按（MessageBubble 建立的程序化选区）都会经过这里。
 */
const SelectionCopyBar: React.FC<SelectionCopyBarProps> = ({ messages }) => {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const messagesRef = useRef(messages);
  const debounceRef = useRef<number | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  // 复制后清空选区会触发 selectionchange，宽限期内保持悬浮条显示"已复制"
  const copiedGraceRef = useRef(false);
  messagesRef.current = messages;

  const computeAnchorBox = (range: Range): DOMRect | null => {
    let box = range.getBoundingClientRect();
    // 塌陷矩形或跨屏大选区：跟随首个 client rect（第一行）
    if ((box.width === 0 && box.height === 0) || box.height > window.innerHeight * 0.4) {
      const first = range.getClientRects()[0];
      if (!first) return null;
      box = first;
    }
    return box;
  };

  const update = useCallback(() => {
    if (copiedGraceRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setPos(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const startEl =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
    // 仅响应 AI 消息正文内的选区（排除用户气泡 / 侧栏 / 输入区）
    const msgEl = startEl?.closest('[data-message-id][data-role="assistant"]') as HTMLElement | null;
    const markdown = msgEl?.querySelector('.qc-markdown');
    if (!msgEl || !markdown || !startEl || !markdown.contains(startEl)) {
      setPos(null);
      return;
    }
    const msgId = msgEl.getAttribute('data-message-id');
    const msg = messagesRef.current.find((m) => m.id === msgId);
    if (!msg || msg.status === 'pending' || msg.status === 'streaming') {
      setPos(null);
      return;
    }
    const box = computeAnchorBox(range);
    if (!box) {
      setPos(null);
      return;
    }
    let top = box.top - BAR_HEIGHT - 4;
    if (top < EDGE_GAP) top = Math.min(box.bottom + 4, window.innerHeight - BAR_HEIGHT - EDGE_GAP);
    top = Math.max(EDGE_GAP, top);
    let left = box.left + box.width / 2 - BAR_WIDTH / 2;
    left = Math.min(Math.max(EDGE_GAP, left), Math.max(EDGE_GAP, window.innerWidth - BAR_WIDTH - EDGE_GAP));
    setPos({ top, left });
  }, []);

  useEffect(() => {
    if (!isMobilePlatform) return;

    const onSelectionChange = () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(update, DEBOUNCE_MS);
    };
    // 滚动时从活 Range 重算位置（不塌陷则跟随，失败即隐藏）
    const onScroll = () => update();
    const hide = () => setPos(null);

    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', hide);
    window.addEventListener('orientationchange', hide);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', hide);
      window.removeEventListener('orientationchange', hide);
    };
  }, [update]);

  useEffect(() => () => {
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
  }, []);

  // 切换会话时隐藏
  const conversationId = messages[0]?.conversation_id;
  useEffect(() => {
    copiedGraceRef.current = false;
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    setCopied(false);
    setPos(null);
  }, [conversationId]);

  if (!isMobilePlatform) return null;

  const handleCopy = async () => {
    const text = window.getSelection()?.toString() ?? '';
    if (!text) return;
    await copyTextToClipboard(text);
    copiedGraceRef.current = true;
    setCopied(true);
    window.getSelection()?.removeAllRanges();
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => {
      copiedGraceRef.current = false;
      setCopied(false);
      setPos(null);
    }, 700);
  };

  if (!pos) return null;

  return createPortal(
    <div
      className="fixed z-[9999] flex items-center rounded-xl border border-linear-border bg-linear-bg-elevated/95 backdrop-blur-xl px-1 py-1 shadow-linear-highlight"
      style={{
        top: pos.top,
        left: pos.left,
        minWidth: BAR_WIDTH,
        animation: 'menu-enter 0.15s var(--ease-snappy) both',
        touchAction: 'manipulation',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
      // 阻止按下时选区塌陷，否则复制到的是空文本
      onPointerDown={(e) => e.preventDefault()}
    >
      <button
        onClick={handleCopy}
        className="flex items-center justify-center gap-1 flex-1 px-2 py-1 rounded-lg text-[12px] font-medium text-linear-text-primary hover:bg-linear-surface active:scale-[0.96] transition-colors cursor-pointer"
      >
        {copied ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
        )}
        {copied ? '已复制' : '复制'}
      </button>
    </div>,
    document.body
  );
};

export default SelectionCopyBar;
