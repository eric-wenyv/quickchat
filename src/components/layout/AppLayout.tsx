import React, { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from '../sidebar/Sidebar';
import { MainChatArea } from '../chat/MainChatArea';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
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
  /** 点击后立即高亮的会话 ID */
  selectedConversationId: UUID | null;
  /** 当前会话的消息流 */
  messages: Message[];
  /** 可选模型配置列表 */
  models: ModelConfig[];
  /** 当前选中的模型 ID */
  activeModelId: UUID;

  // --- 状态标志 ---
  /** 列表是否正在加载 */
  isLoadingConversations: boolean;
  /** 会话搜索是否正在执行 */
  isSearchingConversations?: boolean;
  /** 消息是否正在初次加载 */
  isLoadingMessages: boolean;
  /** 是否正在加载更早历史消息 */
  isLoadingMoreMessages: boolean;
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
  /** 当前会话的 thinking_level（per-conversation） */
  activeThinkingLevel: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  /** 更新思考程度（per-conversation） */
  onUpdateThinkingLevel: (level: 'LOW' | 'MEDIUM' | 'HIGH' | null) => void;
  /** 切换会话后需要恢复滚动到的消息 ID */
  scrollRestoreMessageId: UUID | null;
  /** 活跃消息 ID 变化回调（用于保存滚动位置） */
  onActiveMessageIdChange?: (messageId: UUID | null) => void;
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
}

const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 480;
const DEFAULT_SIDEBAR_WIDTH = 256; // ~2/3 of original w-80 (320px)
const SIDEBAR_WIDTH_KEY = 'quick_chat_sidebar_width';

interface CodexMenuBarProps {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
}

const CodexMenuBar: React.FC<CodexMenuBarProps> = ({
  isSidebarOpen,
  onToggleSidebar,
}) => {
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [hoveredWindowButton, setHoveredWindowButton] = useState<'minimize' | 'maximize' | 'close' | null>(null);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    const unlisten = appWindow.onResized(async () => {
      setIsWindowMaximized(await appWindow.isMaximized());
    });
    appWindow.isMaximized().then(setIsWindowMaximized);
    return () => { unlisten.then(f => f()); };
  }, [appWindow]);

  const windowButtonClass = "h-9 w-11 flex items-center justify-center text-linear-text-tertiary transition-colors duration-150 cursor-pointer";

  return (
    <header
      data-tauri-drag-region
      className="codex-menu-bar codex-glass-chrome relative z-40 flex h-9 w-full shrink-0 items-center justify-between text-linear-text-tertiary select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div
        className="flex h-full items-center px-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={onToggleSidebar}
          className="flex h-6 w-6 items-center justify-center rounded-md text-linear-text-tertiary hover:bg-linear-surface hover:text-linear-text-primary transition-colors"
          title={isSidebarOpen ? '收起侧栏' : '展开侧栏'}
          aria-label={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="19" height="19" rx="3" />
            <path d="M9 5v14" />
          </svg>
        </button>
      </div>

      <div
        className="flex h-full items-center"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={() => appWindow.minimize()}
          onMouseEnter={() => setHoveredWindowButton('minimize')}
          onMouseLeave={() => setHoveredWindowButton(null)}
          className={windowButtonClass}
          style={{ backgroundColor: hoveredWindowButton === 'minimize' ? 'rgba(255,255,255,0.08)' : 'transparent' }}
          aria-label="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="none">
            <rect width="10" height="1" rx="0.5" fill="currentColor" opacity="0.75" />
          </svg>
        </button>
        <button
          onClick={() => appWindow.toggleMaximize()}
          onMouseEnter={() => setHoveredWindowButton('maximize')}
          onMouseLeave={() => setHoveredWindowButton(null)}
          className={windowButtonClass}
          style={{ backgroundColor: hoveredWindowButton === 'maximize' ? 'rgba(255,255,255,0.08)' : 'transparent' }}
          aria-label={isWindowMaximized ? 'Restore' : 'Maximize'}
        >
          {isWindowMaximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect x="2" y="0" width="8" height="8" rx="0.5" stroke="currentColor" strokeWidth="1" opacity="0.75" fill="none" />
              <rect x="0" y="2" width="8" height="8" rx="0.5" stroke="currentColor" strokeWidth="1" opacity="0.75" fill="#151515" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" stroke="currentColor" strokeWidth="1" opacity="0.75" />
            </svg>
          )}
        </button>
        <button
          onClick={() => appWindow.close()}
          onMouseEnter={() => setHoveredWindowButton('close')}
          onMouseLeave={() => setHoveredWindowButton(null)}
          className={windowButtonClass}
          style={{
            backgroundColor: hoveredWindowButton === 'close' ? '#e81123' : 'transparent',
            color: hoveredWindowButton === 'close' ? '#ffffff' : 'inherit',
          }}
          aria-label="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity={hoveredWindowButton === 'close' ? 1 : 0.75} />
          </svg>
        </button>
      </div>
    </header>
  );
};

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
  selectedConversationId,
  messages,
  models,
  activeModelId,
  isLoadingConversations,
  isSearchingConversations = false,
  isLoadingMessages,
  isLoadingMoreMessages,
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
  activeThinkingLevel,
  onUpdateThinkingLevel,
  scrollRestoreMessageId,
  onActiveMessageIdChange,
  onOpenSettings,
  systemPrompts,
  onSaveSystemPromptPreset,
  onDeleteSystemPromptPreset,
  onDeleteMessage,
  onStopGeneration,
}) => {
  // 内部维护侧边栏开关状态，确保布局灵活性。
  // 内容层维持完整宽度，外层宽度和透明度同步过渡，避免文字和控件被压缩重排。
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSidebarResizeHovered, setIsSidebarResizeHovered] = useState(false);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);

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
  const contentLayoutRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const sidebarContentRef = useRef<HTMLDivElement>(null);
  const sidebarResizeHandleRef = useRef<HTMLDivElement>(null);

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen(prev => !prev);
  }, []);

  // 直接操作 DOM 的拖拽实现，绕过 React 渲染周期以避免卡顿
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsSidebarResizing(true);
    const startX = e.clientX;
    const startWidth = asideRef.current?.offsetWidth ?? sidebarWidth;
    const contentLayout = contentLayoutRef.current;
    const sidebarContent = sidebarContentRef.current;
    const sidebarResizeHandle = sidebarResizeHandleRef.current;

    const updateResizeWidth = (width: number) => {
      if (contentLayout) {
        contentLayout.style.gridTemplateColumns = `${width}px minmax(0, 1fr)`;
      }
      // 拖拽需要实时扩展内容层；收缩/展开动画则继续保持这个完整宽度，避免文本重排。
      if (sidebarContent) {
        sidebarContent.style.width = `${width}px`;
        sidebarContent.style.minWidth = `${width}px`;
      }
      if (sidebarResizeHandle) {
        sidebarResizeHandle.style.left = `${width}px`;
      }
    };

    if (contentLayout) {
      contentLayout.style.transition = 'none';
    }
    if (sidebarResizeHandle) {
      sidebarResizeHandle.style.transition = 'none';
    }
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.min(Math.max(startWidth + delta, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH);
      updateResizeWidth(newWidth);
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      const delta = upEvent.clientX - startX;
      const finalWidth = Math.min(Math.max(startWidth + delta, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH);

      updateResizeWidth(finalWidth);
      if (contentLayout) {
        // 拖拽结束时立即固定宽度，再恢复收缩/展开的过渡。
        void contentLayout.offsetHeight;
        contentLayout.style.transition = '';
      }
      if (sidebarResizeHandle) {
        void sidebarResizeHandle.offsetHeight;
        sidebarResizeHandle.style.transition = '';
      }

      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setIsSidebarResizing(false);
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
    const isTauriRuntime = '__TAURI_INTERNALS__' in window;

    if (isTauriRuntime) {
      (async () => {
        try {
          unlistenToggle = await listen('shortcut-toggle-sidebar', () => {
            if (!cancelled) toggleSidebar();
          });
          unlistenNew = await listen('shortcut-new-conversation', () => {
            if (!cancelled) onCreateConversationRef.current();
          });
        } catch (e) {
          console.warn('Tauri 全局快捷键监听未就绪:', e);
        }
      })();
    }

    // Fallback：当焦点在主文档时，仍可通过常规键盘事件响应
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        toggleSidebar();
      } else if (key === 'n') {
        e.preventDefault();
        onCreateConversationRef.current();
      }
    };
    if (!isTauriRuntime) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      cancelled = true;
      unlistenToggle?.();
      unlistenNew?.();
      if (!isTauriRuntime) {
        window.removeEventListener('keydown', handleKeyDown);
      }
    };
  }, [toggleSidebar]);

  return (
    <div className="app-window-shell flex h-screen w-screen flex-col bg-transparent text-linear-text-secondary font-sans overflow-hidden selection:bg-linear-surface-hover selection:text-linear-text-primary antialiased">
      <CodexMenuBar
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={toggleSidebar}
      />
      <div
        ref={contentLayoutRef}
        className="app-content-shell relative isolate grid min-h-0 flex-1 transition-[grid-template-columns] duration-300 ease-out bg-linear-sidebar"
        style={{
          gridTemplateColumns: isSidebarOpen ? `${sidebarWidth}px minmax(0, 1fr)` : '0px minmax(0, 1fr)',
          willChange: 'grid-template-columns',
        }}
      >

        {/* 
        左侧边栏区域 (B-1): 负责导航与历史管理
        宽度支持拖拽调整，并由 Grid 轨道与主区域同步计算
      */}
        <aside
          ref={asideRef}
          aria-hidden={!isSidebarOpen}
          className={`
          codex-glass-chrome relative min-w-0 h-full overflow-hidden transition-opacity duration-300 ease-out z-20
          ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}
        `}
          style={{ willChange: 'opacity', zIndex: 20 }}
        >
          <div ref={sidebarContentRef} className="h-full w-full shrink-0 overflow-hidden" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
            <Sidebar
              conversations={conversations}
              activeConversationId={selectedConversationId ?? activeConversation?.id ?? null}
              onSelectConversation={onSelectConversation}
              onCreateConversation={onCreateConversation}
              onDeleteConversation={onDeleteConversation}
              onPinConversation={onPinConversation}
              onSearchChange={onSearchConversations}
              isLoading={isLoadingConversations}
              isSearching={isSearchingConversations}
              searchQuery={searchQuery}
              onOpenSettings={onOpenSettings}
              theme={theme}
              onToggleTheme={onToggleTheme}
            />
          </div>

        </aside>

        {/*
          侧边栏宽度拖拽条：独立于始终裁剪内容的 aside，沿 Grid 分界线移动。
          这样命中区域可以伸入主区，而侧栏内容不会在展开/收缩动画中越过轨道。
        */}
        <div
          ref={sidebarResizeHandleRef}
          onMouseDown={startResize}
          onMouseEnter={() => setIsSidebarResizeHovered(true)}
          onMouseLeave={() => setIsSidebarResizeHovered(false)}
          className={`absolute top-0 bottom-0 w-2 z-30 cursor-col-resize bg-transparent transition-[left,opacity] duration-300 ease-out ${
            isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          style={{ left: isSidebarOpen ? sidebarWidth : 0 }}
          title="拖动调整宽度"
          aria-hidden={!isSidebarOpen}
        />

        {/* 
        右侧主对话区区域 (C-1): 应用核心交互平面
        占据 Grid 的剩余空间，始终不与侧栏轨道重叠。
        */}
        <main
          className={`main-chat-shell min-w-0 h-full relative z-0 flex flex-col overflow-hidden bg-linear-bg border-t border-linear-border border-l transition-colors ${
            isSidebarOpen ? 'rounded-tl-xl' : 'rounded-tl-none'
          } ${
            isSidebarResizeHovered || isSidebarResizing
              ? 'border-l-linear-border-hover'
              : 'border-l-linear-border'
          }`}
        >

          {/* 
          集成主对话区容器 
          内部已包含 Header, MessageList, EmptyState 与 ChatInputFooter (含 Enter 发送拦截与高度增长逻辑)
        */}
          <MainChatArea
            conversation={activeConversation}
            messages={messages}
            isLoadingMessages={isLoadingMessages}
            isLoadingMore={isLoadingMoreMessages}
            onSendMessage={onSendMessage}
            onLoadMore={onLoadMoreMessages}
            hasMore={hasMoreMessages}
            models={models}
            activeModelId={activeModelId}
            onModelSelect={onModelSelect}
            isSending={isSending}
            onRenameConversation={onRenameConversation}
            onUpdateSystemPrompt={onUpdateSystemPrompt}
            thinkingLevel={activeThinkingLevel}
            onUpdateThinkingLevel={onUpdateThinkingLevel}
            scrollRestoreMessageId={scrollRestoreMessageId}
            onActiveMessageIdChange={onActiveMessageIdChange}
            systemPrompts={systemPrompts}
            onSaveSystemPromptPreset={onSaveSystemPromptPreset}
            onDeleteSystemPromptPreset={onDeleteSystemPromptPreset}
            onDeleteMessage={onDeleteMessage}
            onStopGeneration={onStopGeneration}
            onFileDrop={onFileDrop}
          />
        </main>

      </div>
    </div>
  );
};

export default AppLayout;
