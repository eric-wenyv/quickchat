import React from 'react';

interface TauriDragRegionProps {
  /** 拖拽区高度，默认 "h-12" */
  className?: string;
  /** true = absolute 悬浮模式 (主区域用)；false = 文档流模式 (侧边栏用) */
  floating?: boolean;
}

const TauriDragRegion: React.FC<TauriDragRegionProps> = ({
  className = 'h-12',
  floating = false,
}) => {
  return (
    <div
      data-tauri-drag-region
      className={`${
        floating ? 'absolute top-0 left-0 z-50' : 'relative'
      } w-full flex-shrink-0 cursor-grab active:cursor-grabbing ${className}`}
    />
  );
};

export default TauriDragRegion;
