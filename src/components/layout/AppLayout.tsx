import React, { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from '../sidebar/Sidebar';
import { MainChatArea } from '../chat/MainChatArea';
import SkillManager from '../skills/SkillManager';
import ModelSettings from '../settings/ModelSettings';
import type { SkillMeta } from '@/services/skills';
import { isElectron, onEvent } from '@/services/bridge';
import { getCurrentWindow } from '@/services/appWindow';
import { isMobilePlatform } from '@/utils/platform';
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
  activeThinkingLevel: string | null;
  /** 更新思考程度（per-conversation） */
  onUpdateThinkingLevel: (level: string | null) => void;
  /** 当前模型支持的思考强度档位；null/空时隐藏选择器 */
  activeThinkingEfforts: string[] | null;
  /** 模型默认思考强度（未选择时的生效值） */
  defaultThinkingEffort?: string | null;
  onOpenSettings?: () => void;
  /** --- 设置页（全页面替代侧栏 + 聊天区） --- */
  /** 是否显示设置页 */
  showSettings: boolean;
  /** 返回主界面（关闭设置页） */
  onCloseSettings: () => void;
  /** 图片解析模型 ID（null = 自动选择） */
  visionModelId: string | null;
  /** 选择图片解析模型 */
  onSelectVisionModel: (id: string | null) => void;
  /** 全局快速打开快捷键 */
  globalShortcut: string | null;
  /** 启动时全局快捷键注册失败信息（null = 正常） */
  globalShortcutError: string | null;
  /** 更新全局快捷键 */
  onGlobalShortcutChange: (shortcut: string | null) => Promise<void>;
  /** 保存模型配置 */
  onSaveModel: (config: ModelConfig) => void;
  /** 删除模型配置 */
  onDeleteModel: (id: UUID) => void;
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
  /** 是否显示 Skill 管理界面（替代右侧聊天区） */
  showSkills: boolean;
  /** 打开/关闭 Skill 管理界面 */
  onOpenSkills: () => void;
  /** 在对话中使用 Skill */
  onUseSkill: (skill: SkillMeta, content: string) => void;
  /** 全局 Toast 通知 */
  onNotify: (title: string, desc?: string, type?: 'error' | 'success') => void;
}

const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 480;
const DEFAULT_SIDEBAR_WIDTH = 256; // ~2/3 of original w-80 (320px)
const SIDEBAR_WIDTH_KEY = 'quick_chat_sidebar_width';

interface CodexMenuBarProps {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  /** 设置页打开时，左侧按钮切换为"返回" */
  isSettingsOpen: boolean;
  /** 从设置页返回主界面 */
  onExitSettings: () => void;
}

const CodexMenuBar: React.FC<CodexMenuBarProps> = ({
  isSidebarOpen,
  onToggleSidebar,
  isSettingsOpen,
  onExitSettings,
}) => {
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [hoveredWindowButton, setHoveredWindowButton] = useState<'minimize' | 'maximize' | 'close' | null>(null);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    if (isMobilePlatform) return;
    const unlisten = appWindow.onResized(async () => {
      setIsWindowMaximized(await appWindow.isMaximized());
    });
    appWindow.isMaximized().then(setIsWindowMaximized);
    return () => { unlisten.then(f => f()); };
  }, [appWindow]);

  const windowButtonClass = "h-9 w-11 flex items-center justify-center text-linear-text-tertiary transition-colors duration-150 cursor-pointer";

  return (
    <header
      className="codex-menu-bar codex-glass-chrome relative z-40 flex h-9 w-full shrink-0 items-center justify-between text-linear-text-tertiary select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div
        className="flex h-full items-center px-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {isSettingsOpen ? (
          <button
            onClick={onExitSettings}
            className="flex h-6 w-6 items-center justify-center rounded-md text-linear-text-tertiary hover:bg-linear-surface hover:text-linear-text-primary transition-colors"
            title="返回对话"
            aria-label="返回对话"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        ) : (
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
        )}
      </div>

      <div
        className="flex h-full items-center"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {!isMobilePlatform && (
          <>
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
          </>
        )}
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
  activeThinkingEfforts,
  defaultThinkingEffort,
  onOpenSettings,
  showSettings,
  onCloseSettings,
  visionModelId,
  onSelectVisionModel,
  globalShortcut,
  globalShortcutError,
  onGlobalShortcutChange,
  onSaveModel,
  onDeleteModel,
  systemPrompts,
  onSaveSystemPromptPreset,
  onDeleteSystemPromptPreset,
  onDeleteMessage,
  onStopGeneration,
  showSkills,
  onOpenSkills,
  onUseSkill,
  onNotify,
}) => {
  // 内部维护侧边栏开关状态，确保布局灵活性。
  // 内容层维持完整宽度，外层宽度和透明度同步过渡，避免文字和控件被压缩重排。
  // 移动端侧栏默认收起（抽屉式覆盖层）。
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => !isMobilePlatform);
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

  // 移动端侧栏宽度不超过视口的 85%
  const [mobileViewportWidth, setMobileViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    if (!isMobilePlatform) return;
    const update = () => setMobileViewportWidth(window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const sidebarPx = isMobilePlatform
    ? Math.min(sidebarWidth, Math.round(mobileViewportWidth * 0.85))
    : sidebarWidth;

  // 移动端：选中/新建会话后收起抽屉，让出主对话区
  const handleSelectConversation = useCallback((id: UUID) => {
    onSelectConversation(id);
    if (isMobilePlatform) setIsSidebarOpen(false);
  }, [onSelectConversation]);
  const handleCreateConversation = useCallback(() => {
    onCreateConversation();
    if (isMobilePlatform) setIsSidebarOpen(false);
  }, [onCreateConversation]);
  // 移动端：从侧栏进入 Skill 管理后同样收起抽屉，否则 SkillManager 被抽屉遮挡
  const handleOpenSkillsFromSidebar = useCallback(() => {
    onOpenSkills();
    if (isMobilePlatform) setIsSidebarOpen(false);
  }, [onOpenSkills]);
  // 移动端：进入设置页同样收起抽屉（设置页全屏覆盖内容区）
  const handleOpenSettingsFromSidebar = useCallback(() => {
    onOpenSettings?.();
    if (isMobilePlatform) setIsSidebarOpen(false);
  }, [onOpenSettings]);

  // ── 移动端抽屉手势：跟手拖拽，松手按展开比例落位（>50% 展开，否则收回）──
  // 不要求从屏幕边缘起始：Android 12+ 系统手势导航占据左右边缘，边缘横滑
  // 会被系统消费（App 收到 touchcancel），手势永远触发不了。
  // 监听挂在外层容器上：抽屉打开后，遮罩/侧栏上的左滑仍能冒泡到这里生效。
  // 使用原生非 passive 监听，锁定横向意图后 preventDefault，避免与纵向滚动叠加；
  // 跟手过程直接操作 DOM（translate/opacity），绕过 React 渲染周期避免掉帧。
  const overlayRef = useRef<HTMLDivElement>(null);
  const isSidebarOpenRef = useRef(isSidebarOpen);
  useEffect(() => {
    isSidebarOpenRef.current = isSidebarOpen;
  }, [isSidebarOpen]);

  useEffect(() => {
    if (!isMobilePlatform) return;
    const shell = contentLayoutRef.current;
    const aside = asideRef.current;
    const overlay = overlayRef.current;
    if (!shell || !aside || !overlay) return;

    const drawerWidth = sidebarPx;

    /** 触摸起点位于可横向滚动区域（代码块等）或输入控件内时不启用手势，避免与横滑/文本选择冲突 */
    const gestureBlockedByTarget = (target: EventTarget | null): boolean => {
      // 存在文本选区时不启用手势：横滑会被识别为拖拽选择手柄
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return true;
      let node = target as HTMLElement | null;
      while (node && node !== document.body) {
        if (node.scrollWidth > node.clientWidth + 1) {
          const style = getComputedStyle(node);
          if (/(auto|scroll)/.test(style.overflowX)) return true;
        }
        if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT' || node.isContentEditable) {
          return true;
        }
        node = node.parentElement;
      }
      return false;
    };

    let startX = 0;
    let startY = 0;
    let startedOpen = false;
    let tracking = false; // 已记录触摸起点
    let dragging = false; // 已锁定横向意图，正在跟手
    let progress = 0;     // 当前展开比例 0..1
    let lastX = 0;        // 速度采样：上一次 move 的位置/时间
    let lastT = 0;
    let velocity = 0;     // 水平速度 px/ms（向右为正），指数平滑去抖
    let settleTimer = 0;
    // 快速轻扫（fling）判定阈值：速度超过它时直接按扫动方向开合，无视 50% 位置
    const FLING_VELOCITY = 0.5;

    const clearInlineStyles = () => {
      window.clearTimeout(settleTimer);
      aside.style.transition = '';
      aside.style.translate = '';
      aside.style.opacity = '';
      overlay.style.transition = '';
      overlay.style.opacity = '';
      overlay.style.pointerEvents = '';
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      if (gestureBlockedByTarget(e.target)) return;
      // 上一轮 settle 的内联样式此时与状态一致，提前清理是无感操作
      clearInlineStyles();
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      lastX = t.clientX;
      lastT = performance.now();
      velocity = 0;
      startedOpen = isSidebarOpenRef.current;
      tracking = true;
      dragging = false;
      progress = startedOpen ? 1 : 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.touches[0];
      const now = performance.now();
      const dt = now - lastT;
      if (dt > 0) {
        velocity = 0.6 * ((t.clientX - lastX) / dt) + 0.4 * velocity;
        lastX = t.clientX;
        lastT = now;
      }
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (!dragging) {
        // 横向位移超过 8px 才接管；纵向位移更大则让路给滚动
        if (Math.abs(dx) < 8) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          tracking = false;
          return;
        }
        dragging = true;
        aside.style.transition = 'none';
        overlay.style.transition = 'none';
        overlay.style.pointerEvents = 'none';
      }
      // 跟手：以起点状态为基础随手指位移（闭合态右滑展开、展开态左滑收起），
      // 反向位移被夹紧到 [0, drawerWidth]，抽屉始终贴住指尖
      const basePx = startedOpen ? drawerWidth : 0;
      const progressPx = Math.min(Math.max(basePx + dx, 0), drawerWidth);
      progress = progressPx / drawerWidth;
      aside.style.translate = `${progressPx - drawerWidth}px`;
      aside.style.opacity = String(progress);
      overlay.style.opacity = String(progress);
      e.preventDefault();
    };

    // 松手落位：快速轻扫直接按扫动方向开合；否则按 50% 分界。
    // 恢复 class 驱动的过渡动画走完剩余路程
    const settle = () => {
      dragging = false;
      tracking = false;
      // 松手前已停顿（期间无 move 采样）则视为静止，不沿用旧速度
      if (performance.now() - lastT > 100) velocity = 0;
      // 快速轻扫按纯几何方向开合：右滑展开、左滑收回（反向轻扫等于落在原状态）
      const open = velocity > FLING_VELOCITY
        ? true
        : velocity < -FLING_VELOCITY
          ? false
          : progress > 0.5;
      aside.style.transition = '';
      aside.style.translate = open ? '0px' : `${-drawerWidth}px`;
      aside.style.opacity = open ? '1' : '0';
      overlay.style.transition = '';
      overlay.style.opacity = open ? '1' : '0';
      overlay.style.pointerEvents = open ? 'auto' : 'none';
      isSidebarOpenRef.current = open;
      setIsSidebarOpen(open);
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(clearInlineStyles, 350);
    };

    const onTouchEnd = () => {
      if (dragging) settle();
      tracking = false;
    };
    // 系统手势导航抢占（touchcancel）：已跟手则就近落位，避免闪跳
    const onTouchCancel = () => {
      if (dragging) settle();
      tracking = false;
    };

    shell.addEventListener('touchstart', onTouchStart, { passive: true });
    shell.addEventListener('touchmove', onTouchMove, { passive: false });
    shell.addEventListener('touchend', onTouchEnd);
    shell.addEventListener('touchcancel', onTouchCancel);
    return () => {
      shell.removeEventListener('touchstart', onTouchStart);
      shell.removeEventListener('touchmove', onTouchMove);
      shell.removeEventListener('touchend', onTouchEnd);
      shell.removeEventListener('touchcancel', onTouchCancel);
      window.clearTimeout(settleTimer);
    };
    // showSettings 切换会卸载/重建 aside 与遮罩，需重新绑定引用
  }, [isMobilePlatform, sidebarPx, showSettings]);

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

  // 快捷键监听：Electron 全局快捷键事件（主进程 globalShortcut 注册
  // Ctrl+Shift+S/N 后转发，X11/macOS/Windows 可用）+ DOM keydown 兜底。
  // Wayland 不允许应用全局抢键，globalShortcut 静默失效，keydown 是那里
  // 唯一的路径；其他平台上同一次按键可能同时走两条通道，按动作短时去重。
  useEffect(() => {
    let unlistenToggle: (() => void) | undefined;
    let unlistenNew: (() => void) | undefined;

    const DEDUPE_MS = 100;
    let lastToggleFiredAt = 0;
    let lastNewFiredAt = 0;
    const fireToggle = () => {
      const now = Date.now();
      if (now - lastToggleFiredAt < DEDUPE_MS) return;
      lastToggleFiredAt = now;
      toggleSidebar();
    };
    const fireNew = () => {
      const now = Date.now();
      if (now - lastNewFiredAt < DEDUPE_MS) return;
      lastNewFiredAt = now;
      onCreateConversationRef.current();
    };

    if (isElectron()) {
      try {
        unlistenToggle = onEvent('shortcut-toggle-sidebar', fireToggle);
        unlistenNew = onEvent('shortcut-new-conversation', fireNew);
      } catch (e) {
        console.warn('全局快捷键监听未就绪:', e);
      }
    }

    // 焦点在主窗口内时响应（含输入框）；mac 主进程注册的是 Command+Shift，
    // 这里 ctrlKey/metaKey 任一匹配即可与主进程修饰键对齐
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        fireToggle();
      } else if (key === 'n') {
        e.preventDefault();
        fireNew();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      unlistenToggle?.();
      unlistenNew?.();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggleSidebar]);

  return (
    <div className="app-window-shell flex h-screen w-screen flex-col bg-transparent text-linear-text-secondary font-sans overflow-hidden selection:bg-linear-surface-hover selection:text-linear-text-primary antialiased">
      {/* 移动端不渲染菜单栏：侧栏入口移至对话头部左侧 */}
      {!isMobilePlatform && (
        <CodexMenuBar
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={toggleSidebar}
          isSettingsOpen={showSettings}
          onExitSettings={onCloseSettings}
        />
      )}
      <div
        ref={contentLayoutRef}
        className="app-content-shell relative isolate grid min-h-0 flex-1 transition-[grid-template-columns] duration-300 ease-out bg-linear-sidebar"
        style={{
          gridTemplateColumns: isMobilePlatform
            ? 'minmax(0, 1fr)'
            : isSidebarOpen
              ? `${sidebarWidth}px minmax(0, 1fr)`
              : '0px minmax(0, 1fr)',
          willChange: 'grid-template-columns',
        }}
      >

        {/*
          设置页：全页面占据整个内容区（替代侧栏 + 聊天区），
          col-span-full 跨越全部 Grid 列，无需改动列宽定义与过渡动画。
          返回入口：桌面端在顶部菜单栏左侧，移动端在设置页头部。
        */}
        {showSettings ? (
          <ModelSettings
            models={models}
            visionModelId={visionModelId}
            onSelectVisionModel={onSelectVisionModel}
            globalShortcut={globalShortcut}
            globalShortcutError={globalShortcutError}
            onGlobalShortcutChange={onGlobalShortcutChange}
            onSave={onSaveModel}
            onDelete={onDeleteModel}
            onClose={onCloseSettings}
          />
        ) : (
        <>
        {/*
          移动端抽屉背景遮罩：点击关闭侧栏。
          常驻渲染，供手势跟手时按比例渐显；透明度走 class 驱动，
          与 aside 同模式，手势遗留的内联样式清理后可安全回退。
        */}
        {isMobilePlatform && (
          <div
            ref={overlayRef}
            className={`absolute inset-0 z-10 bg-black/45 transition-opacity duration-300 ease-out ${
              isSidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
            onClick={toggleSidebar}
            aria-hidden="true"
          />
        )}

        {/* 
        左侧边栏区域 (B-1): 负责导航与历史管理
        桌面端为可拖拽宽度的 Grid 轨道；移动端为覆盖式抽屉。
      */}
        <aside
          ref={asideRef}
          aria-hidden={!isSidebarOpen}
          className={`
          codex-glass-chrome min-w-0 h-full overflow-hidden transition-[opacity,translate] duration-300 ease-out z-20
          ${isMobilePlatform ? 'absolute inset-y-0 left-0 shadow-2xl' : 'relative'}
          ${isSidebarOpen ? 'opacity-100 translate-x-0' : 'opacity-0 pointer-events-none -translate-x-full'}
        `}
          style={{ willChange: 'opacity, translate', zIndex: 20 }}
        >
          <div ref={sidebarContentRef} className="h-full w-full shrink-0 overflow-hidden" style={{ width: sidebarPx, minWidth: sidebarPx }}>
            <Sidebar
              conversations={conversations}
              activeConversationId={selectedConversationId ?? activeConversation?.id ?? null}
              onSelectConversation={handleSelectConversation}
              onCreateConversation={handleCreateConversation}
              onDeleteConversation={onDeleteConversation}
              onPinConversation={onPinConversation}
              onSearchChange={onSearchConversations}
              isLoading={isLoadingConversations}
              isSearching={isSearchingConversations}
              searchQuery={searchQuery}
              onOpenSettings={handleOpenSettingsFromSidebar}
              onOpenSkills={handleOpenSkillsFromSidebar}
              isSkillsActive={showSkills}
              theme={theme}
              onToggleTheme={onToggleTheme}
            />
          </div>

        </aside>

        {/*
          侧边栏宽度拖拽条：独立于始终裁剪内容的 aside，沿 Grid 分界线移动。
          这样命中区域可以伸入主区，而侧栏内容不会在展开/收缩动画中越过轨道。
          （桌面端专属）
        */}
        {!isMobilePlatform && (
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
        )}
        {/* 
        右侧主对话区区域 (C-1): 应用核心交互平面
        占据 Grid 的剩余空间，始终不与侧栏轨道重叠。
        */}
        <main
          className={`main-chat-shell min-w-0 h-full relative z-0 flex flex-col overflow-hidden bg-linear-bg transition-colors ${
            isMobilePlatform
              ? ''
              : `border-t border-linear-border border-l ${isSidebarOpen ? 'rounded-tl-xl' : 'rounded-tl-none'} ${
                  isSidebarResizeHovered || isSidebarResizing
                    ? 'border-l-linear-border-hover'
                    : 'border-l-linear-border'
                }`
          }`}
        >

          {/* 
          集成主对话区容器 
          内部已包含 Header, MessageList, EmptyState 与 ChatInputFooter (含 Enter 发送拦截与高度增长逻辑)
        */}
          {showSkills ? (
            <SkillManager
              onClose={onOpenSkills}
              onUseSkill={onUseSkill}
              onNotify={onNotify}
            />
          ) : (
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
            thinkingEfforts={activeThinkingEfforts}
            defaultThinkingEffort={defaultThinkingEffort}
            systemPrompts={systemPrompts}
            onSaveSystemPromptPreset={onSaveSystemPromptPreset}
            onDeleteSystemPromptPreset={onDeleteSystemPromptPreset}
            onDeleteMessage={onDeleteMessage}
            onStopGeneration={onStopGeneration}
            onFileDrop={onFileDrop}
            onToggleSidebar={isMobilePlatform ? toggleSidebar : undefined}
          />
          )}
        </main>
        </>
        )}

      </div>
    </div>
  );
};

export default AppLayout;
