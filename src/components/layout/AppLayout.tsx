import React, { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from '../sidebar/Sidebar';
import { MainChatArea } from '../chat/MainChatArea';
import AgentBrowser from '../agent/AgentBrowser';
import { listen } from '@tauri-apps/api/event';
import type {
  ConversationSummary,
  Conversation,
  Message,
  ModelConfig,
  SystemPrompt,
  UUID,
} from '@/types/types';

interface AppLayoutProps {
  // --- 主题 ---
  theme: string;
  onToggleTheme: () => void;
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
  /** 固定/取消固定会话 */
  onPinConversation?: (id: UUID) => void;
  /** 重命名会话 */
  onRenameConversation: (id: UUID, newTitle: string) => void;
  /** 搜索会话 */
  onSearchConversations: (query: string) => void;
  /** 当前搜索关键词 */
  searchQuery: string;
  /** 发送消息 */
  onSendMessage: (content: string) => void;
  /** 文件拖拽放下 */
  onFileDrop?: (files: File[]) => void;
  /** 加载更多历史 */
  onLoadMoreMessages: () => void;
  /** 切换 AI 模型 */
  onModelSelect: (id: UUID) => void;
  /** 更新系统提示词 */
  onUpdateSystemPrompt: (prompt: string | null) => void;
  /** 更新模型 thinking level */
  onUpdateModelThinkingLevel: (id: UUID, level: 'LOW' | 'MEDIUM' | 'HIGH' | null) => void;
  onOpenSettings?: () => void;
  /** 已保存的系统提示词预设列表 */
  systemPrompts: SystemPrompt[];
  /** 保存系统提示词预设 */
  onSaveSystemPromptPreset: (title: string, content: string) => void;
  /** 删除系统提示词预设 */
  onDeleteSystemPromptPreset: (id: UUID) => void;
  /** 删除单条消息 */
  onDeleteMessage: (id: UUID) => void;
  /** 中断 AI 生成 */
  onStopGeneration?: () => void;
  // --- Agent 浏览器 ---
  agentMode: boolean;
  agentUrl: string;
  onOpenAgentBrowser: () => void;
  onAgentUrlChange: (newUrl: string) => void;
  onAgentTitleChange: (title: string) => void;
  onExitAgentMode: () => void;
}

const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 480;
const DEFAULT_SIDEBAR_WIDTH = 256; // ~2/3 of original w-80 (320px)
const SIDEBAR_WIDTH_KEY = 'quick_chat_sidebar_width';

/**
 * AppLayout (P4): 最终集成页面布局
 * 
 * 核心职责：
 * 1. 物理整合 Sidebar 与 MainChatArea，实现无缝联动。
 * 2. 建立全局极简、高端的视觉基调 (Claude-inspired Sand-White Palette)。
 * 3. 管理侧边栏的响应式显隐过渡与深度动效。
 * 4. 支持侧边栏宽度拖拽调整。
 */
export const AppLayout: React.FC<AppLayoutProps> = ({
  theme,
  onToggleTheme,
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
  onPinConversation,
  onRenameConversation,
  onSearchConversations,
  searchQuery,
  onSendMessage,
  onFileDrop,
  onLoadMoreMessages,
  onModelSelect,
  onUpdateSystemPrompt,
  onUpdateModelThinkingLevel,
  onOpenSettings,
  systemPrompts,
  onSaveSystemPromptPreset,
  onDeleteSystemPromptPreset,
  onDeleteMessage,
  onStopGeneration,
  // Agent 浏览器
  agentMode,
  agentUrl,
  onOpenAgentBrowser,
  onAgentUrlChange,
  onAgentTitleChange,
  onExitAgentMode,
}) => {
  // 内部维护侧边栏开关状态，确保布局灵活性
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // 侧边栏宽度状态（支持拖拽调整）
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= MIN_SIDEBAR_WIDTH && parsed <= MAX_SIDEBAR_WIDTH) {
        return parsed;
      }
    }
    return DEFAULT_SIDEBAR_WIDTH;
  });
  const asideRef = useRef<HTMLElement>(null);

  // 直接操作 DOM 的拖拽实现，绕过 React 渲染周期以避免卡顿
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = asideRef.current?.offsetWidth ?? sidebarWidth;
    const aside = asideRef.current;

    if (aside) {
      aside.style.transition = 'none';
    }
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.min(Math.max(startWidth + delta, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH);
      if (aside) {
        aside.style.width = `${newWidth}px`;
      }
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      const delta = upEvent.clientX - startX;
      const finalWidth = Math.min(Math.max(startWidth + delta, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH);
      if (aside) {
        aside.style.transition = '';
        aside.style.width = '';
      }
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      setSidebarWidth(finalWidth);
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(finalWidth));
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [sidebarWidth]);

  // 使用 ref 保存最新回调，避免闭包问题导致监听 stale handler
  const onCreateConversationRef = useRef(onCreateConversation);
  onCreateConversationRef.current = onCreateConversation;

  // 快捷键监听：Tauri 全局快捷键（可穿透 iframe）+ window fallback（主文档焦点时）
  useEffect(() => {
    let unlistenToggle: (() => void) | undefined;
    let unlistenNew: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        unlistenToggle = await listen('shortcut-toggle-sidebar', () => {
          if (!cancelled) setIsSidebarOpen(prev => !prev);
        });
        unlistenNew = await listen('shortcut-new-conversation', () => {
          if (!cancelled) onCreateConversationRef.current();
        });
      } catch (e) {
        console.warn('Tauri 全局快捷键监听未就绪:', e);
      }
    })();

    // Fallback：当焦点在主文档时，仍可通过常规键盘事件响应
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        setIsSidebarOpen(prev => !prev);
      } else if (key === 'n') {
        e.preventDefault();
        onCreateConversationRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelled = true;
      unlistenToggle?.();
      unlistenNew?.();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []); // 空依赖：只注册一次，回调通过 ref 保持最新

  return (
    <div className="flex h-screen w-screen bg-linear-bg text-linear-text-secondary font-sans overflow-hidden selection:bg-linear-surface-hover selection:text-linear-text-primary antialiased">
      
      {/* 
        左侧边栏区域 (B-1): 负责导航与历史管理
        宽度支持拖拽调整，通过 style 动态绑定
      */}
      <aside
        ref={asideRef}
        className={`
          relative flex-shrink-0 h-full transition-[width] duration-500 ease-out z-20 overflow-hidden
          ${isSidebarOpen ? 'border-r border-linear-border' : 'w-0 min-w-0 pointer-events-none border-r-0'}
        `}
        style={{ width: isSidebarOpen ? sidebarWidth : 0 }}
      >
        <Sidebar
          conversations={conversations}
          activeConversationId={activeConversation?.id ?? null}
          onSelectConversation={onSelectConversation}
          onCreateConversation={onCreateConversation}
          onDeleteConversation={onDeleteConversation}
          onPinConversation={onPinConversation}
          onSearchChange={onSearchConversations}
          isLoading={isLoadingConversations}
          searchQuery={searchQuery}
          onToggleCollapse={() => setIsSidebarOpen(false)}
          onOpenSettings={onOpenSettings}
          onOpenAgentBrowser={onOpenAgentBrowser}
          theme={theme}
          onToggleTheme={onToggleTheme}
        />

        {/* 侧边栏宽度拖拽条 */}
        {isSidebarOpen && (
          <div
            onMouseDown={startResize}
            className="absolute right-0 top-0 bottom-0 w-2 z-30 cursor-col-resize bg-transparent hover:bg-linear-surface-hover active:bg-linear-border-hover transition-colors"
            title="拖动调整宽度"
          />
        )}
      </aside>

      {/* 
        右侧主对话区区域 (C-1): 应用核心交互平面
        利用 flex-1 中自适应剩余空间。
      */}
      <main className="flex-1 min-w-0 h-full relative z-10 flex flex-col">
        
        {/* 侧边栏唤醒触发器: 普通模式下在左侧浮动，Agent 模式下由 AgentBrowser 内部接管 */}
        {!isSidebarOpen && !agentMode && (
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="absolute top-16 left-3 z-50 p-2 rounded-lg bg-linear-bg-elevated/90 border border-linear-border backdrop-blur-xl text-linear-text-secondary hover:text-linear-text-primary hover:bg-linear-surface transition-all active:scale-90 group"
            title="展开侧边栏"
          >
            <svg className="w-4 h-4 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* 
          集成主对话区容器 
          内部已包含 Header, MessageList, EmptyState 与 ChatInputFooter (含 Enter 发送拦截与高度增长逻辑)
        */}
        {agentMode ? (
          <AgentBrowser
            url={agentUrl}
            isSidebarOpen={isSidebarOpen}
            onToggleSidebar={() => setIsSidebarOpen(true)}
            onUrlChange={onAgentUrlChange}
            onTitleChange={onAgentTitleChange}
            onExitAgentMode={onExitAgentMode}
            onNewChat={onCreateConversation}
          />
        ) : (
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
            systemPrompts={systemPrompts}
            onSaveSystemPromptPreset={onSaveSystemPromptPreset}
            onDeleteSystemPromptPreset={onDeleteSystemPromptPreset}
            onDeleteMessage={onDeleteMessage}
            onStopGeneration={onStopGeneration}
            onFileDrop={onFileDrop}
          />
        )}
      </main>

    </div>
  );
};

export default AppLayout;
