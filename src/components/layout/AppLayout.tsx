import React from 'react';

interface AppLayoutProps {
  /** 
   * 左侧边栏内容 
   */
  sidebar?: React.ReactNode;
  /** 
   * 右侧主对话区内容 
   */
  children?: React.ReactNode;
  /** 
   * 控制侧边栏是否展开，默认展开 
   */
  isSidebarOpen?: boolean;
}

/**
 * 全局应用布局骨架
 * 遵循极简、克制、高品质排版设计哲学
 */
export const AppLayout: React.FC<AppLayoutProps> = ({ 
  sidebar, 
  children,
  isSidebarOpen = true 
}) => {
  return (
    // 全局背景使用沙白色，字体使用低对比度深灰
    <div className="flex h-screen w-screen bg-sand-100 text-ink-300 font-sans overflow-hidden selection:bg-sand-300 selection:text-ink-400">
      
      {/* 
        左侧 260px 可折叠侧边栏 
        完全依赖极度克制的边框 (border-sand-400) 和内边距区分层级
      */}
      <aside 
        className={`
          flex flex-col h-full flex-shrink-0 transition-[width,opacity] duration-300 ease-in-out
          border-r border-sand-400 bg-sand-200
          ${isSidebarOpen ? 'w-[260px] opacity-100' : 'w-0 opacity-0 overflow-hidden border-none'}
        `}
      >
        {/* Tauri 无边框窗口顶部自定义拖拽区域 */}
        <div 
          data-tauri-drag-region 
          className="h-12 w-full flex-shrink-0 cursor-grab active:cursor-grabbing" 
        />
        
        {/* 侧边栏主内容区：留白控制 */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {sidebar}
        </div>
      </aside>

      {/* 
        右侧主对话区 
      */}
      <main className="flex-1 flex flex-col h-full min-w-0 relative bg-sand-100">
        
        {/* Tauri 无边框窗口顶部自定义拖拽区域 (悬浮于主内容之上但不阻挡主内容交互) */}
        <div 
          data-tauri-drag-region 
          className="h-12 w-full flex-shrink-0 absolute top-0 left-0 z-50 cursor-grab active:cursor-grabbing"
        />

        {/* 
          主内容容器：
          - 顶部留出拖拽区的高度留白
          - 居中限制最大宽度 (max-w-4xl) 确保高品质阅读排版体验
        */}
        <div className="flex-1 overflow-y-auto pt-12">
          <div className="max-w-4xl mx-auto h-full px-6 md:px-12 pb-8 flex flex-col">
            {children}
          </div>
        </div>
        
      </main>
    </div>
  );
};
