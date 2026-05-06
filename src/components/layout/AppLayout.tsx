import React, { useState, useEffect } from 'react';
import Sidebar from '../sidebar/Sidebar';
import { MainChatArea } from '../chat/MainChatArea';
import type { 
  ConversationSummary, 
  Conversation, 
  Message, 
  ModelConfig, 
  UUID 
} from '@/types/types';

interface AppLayoutProps {
  // --- 数据契约 ---
  /** 会话列表摘要 */
  conversations: ConversationSummary[];
  /** 当前激活的会话详情 */
  activeConversation: Conversation | null;
  /** 当前会话的消息流 */
  messages: Message[];
  /** 可选模型配置列表 */
  models: ModelConfig[];
  /** 当前选中的模型 ID */
  activeModelId: UUID;
  
  // --- 状态标志 ---
  /** 列表是否正在加载 */
  isLoadingConversations: boolean;
  /** 消息是否正在初次加载 */
  isLoadingMessages: boolean;
  /** 是否正在发送消息 (禁用输入框) */
  isSending: boolean;
  /** 是否有更多历史消息 */
  hasMoreMessages: boolean;
  
  // --- 动作回调 ---
  /** 切换会话 */
  onSelectConversation: (id: UUID) => void;
  /** 创建新会话 */
  onCreateConversation: () => void;
  /** 删除会话 */
  onDeleteConversation: (id: UUID) => void;
  /** 重命名会话 */
  onRenameConversation: (id: UUID, newTitle: string) => void;
  /** 搜索会话 */
  onSearchConversations: (query: string) => void;
  /** 当前搜索关键词 */
  searchQuery: string;
  /** 发送消息 */
  onSendMessage: (content: string) => void;
  /** 加载更多历史 */
  onLoadMoreMessages: () => void;
  /** 切换 AI 模型 */
  onModelSelect: (id: UUID) => void;
  /** 更新系统提示词 */
  onUpdateSystemPrompt: (prompt: string | null) => void;
  /** 更新模型 thinking level */
  onUpdateModelThinkingLevel: (id: UUID, level: 'LOW' | 'MEDIUM' | 'HIGH' | null) => void;
}

/**
 * AppLayout (P4): 最终集成页面布局
 * 
 * 核心职责：
 * 1. 物理整合 Sidebar 与 MainChatArea，实现无缝联动。
 * 2. 建立全局极简、高端的视觉基调 (Claude-inspired Sand-White Palette)。
 * 3. 管理侧边栏的响应式显隐过渡与深度动效。
 */
export const AppLayout: React.FC<AppLayoutProps> = ({
  conversations,
  activeConversation,
  messages,
  models,
  activeModelId,
  isLoadingConversations,
  isLoadingMessages,
  isSending,
  hasMoreMessages,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onRenameConversation,
  onSearchConversations,
  searchQuery,
  onSendMessage,
  onLoadMoreMessages,
  onModelSelect,
  onUpdateSystemPrompt,
  onUpdateModelThinkingLevel,
}) => {
  // 内部维护侧边栏开关状态，确保布局灵活性
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // 全局快捷键：Ctrl+Shift+S 切换侧边栏，Ctrl+Shift+N 新建对话
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        setIsSidebarOpen(prev => !prev);
      } else if (key === 'n') {
        e.preventDefault();
        onCreateConversation();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCreateConversation]);

  return (
    <div className="flex h-screen w-screen bg-sand-100 text-ink-300 font-sans overflow-hidden selection:bg-sand-300/60 selection:text-ink-400 antialiased">
      
      {/* 
        左侧边栏区域 (B-1): 负责导航与历史管理
        采用固定宽度 w-80 (320px)，支持通过 transform 与 opacity 实现硬件加速的平滑过渡
      */}
      <aside 
        className={`
          flex-shrink-0 h-full border-r border-sand-400 transition-[width,opacity,transform] duration-500 ease-out z-20
          ${isSidebarOpen ? 'w-80 opacity-100 translate-x-0' : 'w-0 opacity-0 -translate-x-full pointer-events-none'}
        `}
      >
        <div className="w-80 h-full">
          <Sidebar
            conversations={conversations}
            activeConversationId={activeConversation?.id ?? null}
            onSelectConversation={onSelectConversation}
            onCreateConversation={onCreateConversation}
            onDeleteConversation={onDeleteConversation}
            onSearchChange={onSearchConversations}
            isLoading={isLoadingConversations}
            searchQuery={searchQuery}
            onToggleCollapse={() => setIsSidebarOpen(false)}
          />
        </div>
      </aside>

      {/* 
        右侧主对话区区域 (C-1): 应用核心交互平面
        利用 flex-1 中自适应剩余空间。
      */}
      <main className={`flex-1 min-w-0 h-full relative z-10 flex flex-col shadow-[inset_1px_0_0_rgba(255,255,255,0.4)] transition-[padding] duration-500 ease-out ${!isSidebarOpen ? 'pl-14' : ''}`}>
        
        {/* 侧边栏唤醒触发器: 采用磨砂玻璃质感，仅在侧边栏关闭时漂浮显示 */}
        {!isSidebarOpen && (
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="absolute top-4 left-4 z-50 p-2.5 rounded-2xl bg-white/40 border border-sand-400/40 backdrop-blur-xl shadow-panel text-ink-200 hover:text-ink-400 hover:bg-white/60 transition-all active:scale-90 group"
            title="展开侧边栏"
          >
            <svg className="w-5 h-5 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* 
          集成主对话区容器 
          内部已包含 Header, MessageList, EmptyState 与 ChatInputFooter (含 Enter 发送拦截与高度增长逻辑)
        */}
        <MainChatArea
          conversation={activeConversation}
          messages={messages}
          isLoadingMessages={isLoadingMessages}
          onSendMessage={onSendMessage}
          onLoadMore={onLoadMoreMessages}
          hasMore={hasMoreMessages}
          models={models}
          activeModelId={activeModelId}
          onModelSelect={onModelSelect}
          isSending={isSending}
          onRenameConversation={onRenameConversation}
          onUpdateSystemPrompt={onUpdateSystemPrompt}
          onUpdateModelThinkingLevel={onUpdateModelThinkingLevel}
        />
      </main>

    </div>
  );
};

export default AppLayout;
