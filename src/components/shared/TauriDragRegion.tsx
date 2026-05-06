import React, { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface TauriDragRegionProps {
  /** 拖拽区高度，默认 "h-12" */
  className?: string;
  /** true = absolute 悬浮模式 (主区域用)；false = 文档流模式 (侧边栏用) */
  floating?: boolean;
  /** 是否显示窗口控制按钮 (仅在侧边栏顶部显示一组即可) */
  showControls?: boolean;
}

const TauriDragRegion: React.FC<TauriDragRegionProps> = ({
  className = 'h-12',
  floating = false,
  showControls = false,
}) => {
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isHoveringClose, setIsHoveringClose] = useState(false);
  const [isHoveringMinimize, setIsHoveringMinimize] = useState(false);
  const [isHoveringMaximize, setIsHoveringMaximize] = useState(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    // 监听窗口最大化状态
    const unlisten = appWindow.onResized(async () => {
      setIsWindowMaximized(await appWindow.isMaximized());
    });
    appWindow.isMaximized().then(setIsWindowMaximized);
    return () => {
      unlisten.then(f => f());
    };
  }, [appWindow]);

  return (
    <div
      data-tauri-drag-region
      className={`${
        floating ? 'absolute top-0 left-0 right-0 z-50' : 'relative'
      } w-full flex-shrink-0 flex items-center ${showControls ? 'justify-end' : ''} ${className}`}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Windows 风格窗口控制按钮：─ □ ✕ 排列在右上角 */}
      {showControls && (
        <div
          className="flex items-center ml-auto"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* 最小化 */}
          <button
            onClick={() => appWindow.minimize()}
            onMouseEnter={() => setIsHoveringMinimize(true)}
            onMouseLeave={() => setIsHoveringMinimize(false)}
            className="w-12 h-10 flex items-center justify-center transition-colors duration-150 cursor-pointer"
            style={{
              backgroundColor: isHoveringMinimize ? 'rgba(0,0,0,0.06)' : 'transparent',
            }}
            aria-label="Minimize"
          >
            {/* ─ 横线图标 */}
            <svg width="10" height="1" viewBox="0 0 10 1" fill="none">
              <rect width="10" height="1" rx="0.5" fill="currentColor" opacity="0.7" />
            </svg>
          </button>

          {/* 最大化 / 还原 */}
          <button
            onClick={() => appWindow.toggleMaximize()}
            onMouseEnter={() => setIsHoveringMaximize(true)}
            onMouseLeave={() => setIsHoveringMaximize(false)}
            className="w-12 h-10 flex items-center justify-center transition-colors duration-150 cursor-pointer"
            style={{
              backgroundColor: isHoveringMaximize ? 'rgba(0,0,0,0.06)' : 'transparent',
            }}
            aria-label={isWindowMaximized ? 'Restore' : 'Maximize'}
          >
            {isWindowMaximized ? (
              /* 还原图标：两个重叠的小矩形 */
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="2" y="0" width="8" height="8" rx="0.5" stroke="currentColor" strokeWidth="1" opacity="0.7" fill="none" />
                <rect x="0" y="2" width="8" height="8" rx="0.5" stroke="currentColor" strokeWidth="1" opacity="0.7" fill="white" />
              </svg>
            ) : (
              /* 最大化图标：□ 空心矩形 */
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" stroke="currentColor" strokeWidth="1" opacity="0.7" />
              </svg>
            )}
          </button>

          {/* 关闭 */}
          <button
            onClick={() => appWindow.close()}
            onMouseEnter={() => setIsHoveringClose(true)}
            onMouseLeave={() => setIsHoveringClose(false)}
            className="w-12 h-10 flex items-center justify-center transition-colors duration-150 cursor-pointer rounded-tr-xl"
            style={{
              backgroundColor: isHoveringClose ? '#e81123' : 'transparent',
              color: isHoveringClose ? '#ffffff' : 'inherit',
            }}
            aria-label="Close"
          >
            {/* ✕ 关闭图标 */}
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity={isHoveringClose ? 1 : 0.7} />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default TauriDragRegion;
