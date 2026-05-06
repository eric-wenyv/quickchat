import React from 'react';
import type { ConversationSummary, UUID } from '@/types/types';
import TauriDragRegion from '@/components/shared/TauriDragRegion';
import NewChatButton from './NewChatButton';
import SearchBar from './SearchBar';
import ConversationList from './ConversationList';

interface SidebarProps {
  conversations: ConversationSummary[];
  activeConversationId: UUID | null;
  onSelectConversation: (id: UUID) => void;
  onCreateConversation: () => void;
  onSearchChange: (query: string) => void;
  isLoading: boolean;
}

/**
 * B-1: Sidebar
 * 
 * 核心职责：
 * 侧边栏容器组件，作为 AppLayout 的左侧面板。
 * 组合了拖拽区域、新建按钮、搜索功能和对话历史列表。
 * 
 * 设计规范：
 * - 背景色：sand-200 (次级背景)
 * - 边框：右侧 border-r border-sand-400
 * - 交互：select-none 禁止文本选中，优化原生应用感
 */
const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  activeConversationId,
  onSelectConversation,
  onCreateConversation,
  onSearchChange,
  isLoading,
}) => {
  return (
    <aside className="flex flex-col h-full w-80 bg-sand-200 border-r border-sand-400 overflow-hidden select-none">
      {/* 1. Tauri 窗口拖拽区域 (非悬浮模式，占据侧边栏顶部高度) */}
      <TauriDragRegion floating={false} className="flex-shrink-0 h-12" />

      {/* 2. 操作与搜索区域 */}
      <div className="flex flex-col flex-shrink-0 px-4 mt-2">
        {/* B-2: 新建对话按钮 */}
        <NewChatButton onClick={onCreateConversation} />
        
        {/* B-3: 搜索框 (内部自带 padding 和 bg) */}
        <div className="-mx-1 -mt-2">
          <SearchBar onSearch={onSearchChange} />
        </div>
      </div>

      {/* 3. 会话列表区域 (B-4) */}
      <div className="flex-1 overflow-hidden mt-2">
        <ConversationList
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={onSelectConversation}
          isLoading={isLoading}
        />
      </div>
    </aside>
  );
};

export default Sidebar;
