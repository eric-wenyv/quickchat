import { useEffect, useLayoutEffect, type RefObject } from 'react';

/**
 * useAutoResize Hook (D-4)
 * 
 * 职责：
 * 1. 监测 textarea 内容变化，自动调整高度以实现高度随内容增长。
 * 2. 拦截键盘事件：Enter 实现发送，Shift+Enter 实现换行。
 */
export function useAutoResize(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  onSend?: () => void
): void {
  // 1. 高度自适应逻辑：高度随内容自动增长
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // 重置高度以获取准确的 scrollHeight
    el.style.height = 'auto';
    // 设置为 scrollHeight，实现高度随内容增长
    el.style.height = `${el.scrollHeight}px`;
  }, [value, ref]);

  // 2. 键盘拦截逻辑：拦截 Enter 键实现发送，Shift+Enter 实现换行
  useEffect(() => {
    const el = ref.current;
    if (!el || !onSend) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        // Shift+Enter 保持默认换行行为
        if (!e.shiftKey) {
          // 拦截默认换行并执行发送
          e.preventDefault();
          onSend();
        }
      }
    };

    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [ref, onSend]);
}
