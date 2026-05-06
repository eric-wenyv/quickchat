import React from 'react';
import type { EpochMillis } from '@/types/types';
import { useRelativeTime } from '@/hooks/useRelativeTime';

interface RelativeTimeProps {
  timestamp: EpochMillis;
  /** 可选的额外样式类 */
  className?: string;
}

/**
 * A-2: 相对时间展示组件
 * 将 EpochMillis 时间戳渲染为人类可读的相对时间（如 "3 分钟前"）
 */
const RelativeTime: React.FC<RelativeTimeProps> = ({ timestamp, className = '' }) => {
  const displayTime = useRelativeTime(timestamp);

  return (
    <span 
      className={`text-ink-200 text-xs tabular-nums select-none ${className}`}
      title={new Date(timestamp).toLocaleString()}
    >
      {displayTime}
    </span>
  );
};

export default RelativeTime;
