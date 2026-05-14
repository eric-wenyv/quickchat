import React from 'react';
import type { ConversationSummary, UUID } from '@/types/types';
import NewChatButton from './NewChatButton';
import SearchBar from './SearchBar';
import ConversationList from './ConversationList';

interface SidebarProps {
  conversations: ConversationSummary[];
  activeConversationId: UUID | null;
  onSelectConversation: (id: UUID) => void;
  onCreateConversation: () => void;
  onDeleteConversation: (id: UUID) => void;
  onPinConversation?: (id: UUID) => void;
  onSearchChange: (query: string) => void;
  isLoading: boolean;
  /** 当前搜索关键词 */
  searchQuery: string;
  /** 触发侧边栏收缩/展开 */
  onToggleCollapse?: () => void;
  /** 打开模型设置 */
  onOpenSettings?: () => void;
  onOpenAgentBrowser?: () => void;
  theme?: string;
  onToggleTheme?: () => void;
}

/**
 * B-1: Sidebar
 * 
 * 核心职责：
 * 侧边栏容器组件，作为 AppLayout 的左侧面板。
 * 组合了拖拽区域、新建按钮、搜索功能和对话历史列表。
 * 
 * 设计规范：
 * - 背景色：linear-sidebar (深灰次级背景)
 * - 边框：右侧 border-r border-linear-border
 * - 交互：select-none 禁止文本选中，优化原生应用感
 */
const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  activeConversationId,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onPinConversation,
  onSearchChange,
  isLoading,
  searchQuery,
  onToggleCollapse,
  onOpenSettings,
  onOpenAgentBrowser,
  theme,
  onToggleTheme,
}) => {
  return (
    <aside className="relative flex flex-col h-full w-full bg-linear-sidebar border-r border-linear-border overflow-hidden select-none">
      {/* 操作与搜索区域 — 整体作为拖拽区，内部按钮/搜索框可交互 */}
      <div
        data-tauri-drag-region
        className="relative flex flex-col flex-shrink-0 px-3 pt-3 pb-1 gap-3"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* B-2: 新建对话按钮 + 收缩按钮 */}
        <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="flex-1 min-w-0">
            <NewChatButton onClick={onCreateConversation} />
          </div>
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-lg text-linear-text-tertiary hover:text-linear-text-secondary hover:bg-linear-surface transition-all duration-200 cursor-pointer"
              title="收起侧边栏"
              aria-label="Collapse sidebar"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 17l-5-5 5-5" />
                <path d="M18 17l-5-5 5-5" />
              </svg>
            </button>
          )}
        </div>

        {/* B-3: 搜索框 */}
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <SearchBar onSearch={onSearchChange} />
        </div>

        {/* 搜索结果统计 */}
        {searchQuery.trim() && (
          <div className="flex items-center justify-between px-1 py-1.5 mb-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <span className="text-[11px] text-linear-text-tertiary font-medium">
              {conversations.length > 0
                ? `找到 ${conversations.length} 个结果`
                : '无匹配结果'}
            </span>
            <button
              onClick={() => onSearchChange('')}
              className="text-[11px] text-linear-text-muted hover:text-linear-text-primary font-semibold transition-colors cursor-pointer"
            >
              清除
            </button>
          </div>
        )}
      </div>

      {/* 3. 会话列表区域 (B-4) */}
      <div className="flex-1 overflow-hidden mt-2">
        <ConversationList
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={onSelectConversation}
          onDelete={onDeleteConversation}
          onPin={onPinConversation}
          isLoading={isLoading}
        />
      </div>

      {/* 4. 底部设置与主题切换 */}
      <div className="flex-shrink-0 px-3 py-3 border-t border-linear-border flex items-center gap-2">
        {onOpenAgentBrowser && (
          <button
            onClick={onOpenAgentBrowser}
            className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-linear-text-secondary hover:text-linear-text-primary hover:bg-linear-surface transition-all cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
              <line x1="8" y1="21" x2="16" y2="21"/>
              <line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
            Agent
          </button>
        )}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-linear-text-secondary hover:text-linear-text-primary hover:bg-linear-surface transition-all cursor-pointer"
            title="模型设置"
            aria-label="模型设置"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l-.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"/>
            </svg>
          </button>
        )}
        {onToggleTheme && (
          <button
            onClick={onToggleTheme}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-linear-text-secondary hover:text-linear-text-primary hover:bg-linear-surface transition-all cursor-pointer"
            title={theme === 'dark' ? '切换到浅色模式' : '切换到暗色模式'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" />
                <path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" />
                <path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
              </svg>
            )}
          </button>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
