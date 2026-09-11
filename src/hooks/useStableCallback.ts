import { useCallback, useRef } from 'react';

/**
 * 返回一个引用恒定的回调包装器：每次渲染都会把内部指针更新为最新实现，
 * 调用时转发到最新版本。用于让 memo 化子组件的回调 prop 保持稳定，
 * 避免父级高频重渲染（如 AI 流式输出期间的周期性 setState）击穿 memo。
 */
export function useStableCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback(((...args: any[]) => ref.current(...args)) as T, []);
}
