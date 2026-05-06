import { useEffect, useRef, useCallback, useLayoutEffect, type RefObject } from 'react';

/**
 * useAutoScroll Hook (D-3)
 * 
 * 职责：依赖项变化时自动滚动到容器底部。
 * 针对聊天列表优化：仅当用户处于底部区域时才自动追踪滚动，避免干扰阅读历史。
 */
export function useAutoScroll(deps: unknown[]): RefObject<HTMLDivElement | null> {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScroll = useRef(true);

  // 监听滚动事件，判断用户是否手动向上滚动
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    
    // 阈值设为 100px，允许一定的误差（如动态内容渲染导致的高度微调）
    const threshold = 100;
    const isAtBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + threshold;
    shouldAutoScroll.current = isAtBottom;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    el.addEventListener('scroll', handleScroll);
    // 初始化时滚动到底部
    el.scrollTop = el.scrollHeight;

    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // 当依赖项变化时，如果用户在底部，则自动同步滚动位置
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && shouldAutoScroll.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, deps);

  return scrollRef;
}
