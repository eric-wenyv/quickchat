import { useState, useEffect } from 'react';
import type { EpochMillis } from '@/types/types';

/**
 * 将 EpochMillis 时间戳转换为相对时间文本，每 60s 自动刷新
 * 遵循极简、直观的设计原则
 */
export function useRelativeTime(timestamp: EpochMillis): string {
  const [relativeTime, setRelativeTime] = useState<string>('');

  useEffect(() => {
    const calculate = () => {
      const now = Date.now();
      const diff = now - timestamp;

      // 处理未来时间或极短时间差
      if (diff < 0) return '刚刚';

      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (seconds < 60) {
        return '刚刚';
      } else if (minutes < 60) {
        return `${minutes} 分钟前`;
      } else if (hours < 24) {
        return `${hours} 小时前`;
      } else if (days < 7) {
        return `${days} 天前`;
      } else {
        const date = new Date(timestamp);
        const year = date.getFullYear();
        const currentYear = new Date().getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();

        // 跨年显示年份，否则仅显示月日
        return year === currentYear
          ? `${month}月${day}日`
          : `${year}年${month}月${day}日`;
      }
    };

    // 执行初始计算
    setRelativeTime(calculate());

    // 每分钟定时刷新
    const timer = setInterval(() => {
      setRelativeTime(calculate());
    }, 60000);

    return () => clearInterval(timer);
  }, [timestamp]);

  return relativeTime;
}
