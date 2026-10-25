import React, { useEffect, useState } from 'react';
import pkg from '../../../package.json';
import GlobalShortcutSettings from './GlobalShortcutSettings';
import ModelManager from './ModelManager';
import TavilySearchSettings from './TavilySearchSettings';
import VisionModelSelector from './VisionModelSelector';
import { Card, Row, SectionTitle } from './controls';
import { isDesktopPlatform } from '@/utils/platform';
import type { ModelConfig, UUID } from '@/types/types';

type NavKey = 'general' | 'providers' | 'about';

export interface SettingsPanelProps {
  /** 当前主题（'light' | 'dark'） */
  theme: string;
  /** 切换主题（立即生效并持久化） */
  onSetTheme: (theme: 'light' | 'dark') => void;
  /** 已配置的模型列表 */
  models: ModelConfig[];
  /** 保存（新增/编辑）模型配置 */
  onSaveModel: (config: ModelConfig) => void;
  /** 删除模型配置 */
  onDeleteModel: (id: UUID) => void;
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
  /** 关闭浮层 */
  onClose: () => void;
}

const NAV_ITEMS: Array<{ key: NavKey; label: string; icon: React.ReactNode }> = [
  {
    key: 'general',
    label: '通用',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="21" y1="4" x2="14" y2="4" />
        <line x1="10" y1="4" x2="3" y2="4" />
        <line x1="21" y1="12" x2="12" y2="12" />
        <line x1="8" y1="12" x2="3" y2="12" />
        <line x1="21" y1="20" x2="16" y2="20" />
        <line x1="12" y1="20" x2="3" y2="20" />
        <line x1="14" y1="2" x2="14" y2="6" />
        <line x1="8" y1="10" x2="8" y2="14" />
        <line x1="16" y1="18" x2="16" y2="22" />
      </svg>
    ),
  },
  {
    key: 'providers',
    label: '模型供应商',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <rect x="9" y="9" width="6" height="6" />
        <path d="M15 2v2" />
        <path d="M15 20v2" />
        <path d="M2 15h2" />
        <path d="M2 9h2" />
        <path d="M20 15h2" />
        <path d="M20 9h2" />
        <path d="M9 2v2" />
        <path d="M9 20v2" />
      </svg>
    ),
  },
  {
    key: 'about',
    label: '关于',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
    ),
  },
];

/**
 * 设置浮层：主窗口内居中的卡片式弹层（半透明遮罩保留背景可见）。
 * 数据全部经 props 与主进程状态直连，无 IPC 同步；支持 X 按钮、
 * 点击遮罩、Esc 键关闭。
 */
export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  theme,
  onSetTheme,
  models,
  onSaveModel,
  onDeleteModel,
  visionModelId,
  onSelectVisionModel,
  globalShortcut,
  globalShortcutError,
  onGlobalShortcutChange,
  onClose,
}) => {
  const [activeNav, setActiveNav] = useState<NavKey>('general');

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const renderGeneral = () => (
    <div className="space-y-6">
      <div>
        <SectionTitle>外观</SectionTitle>
        <Card>
          <Row title="主题">
            <div className="flex rounded-lg border border-linear-border bg-linear-bg p-0.5">
              {(['light', 'dark'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => onSetTheme(t)}
                  className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                    theme === t
                      ? 'bg-linear-surface-hover text-linear-text-primary'
                      : 'text-linear-text-tertiary hover:text-linear-text-secondary'
                  }`}
                >
                  {t === 'light' ? '浅色' : '深色'}
                </button>
              ))}
            </div>
          </Row>
        </Card>
      </div>
      <div>
        <SectionTitle>联网搜索</SectionTitle>
        <Card>
          <TavilySearchSettings />
        </Card>
      </div>
      {isDesktopPlatform && (
        <div>
          <SectionTitle>快捷操作</SectionTitle>
          <Card>
            <div className="px-4 py-3.5">
              <GlobalShortcutSettings value={globalShortcut} startupError={globalShortcutError} onChange={onGlobalShortcutChange} />
            </div>
          </Card>
        </div>
      )}
    </div>
  );

  const renderProviders = () => (
    <div className="space-y-6">
      <div>
        <SectionTitle>模型</SectionTitle>
        <Card>
          <ModelManager bare models={models} onSave={onSaveModel} onDelete={onDeleteModel} />
          {models.some(m => m.supports_vision) && (
            <Row title="图片解析模型">
              <div className="w-72">
                <VisionModelSelector models={models} value={visionModelId} onChange={onSelectVisionModel} />
              </div>
            </Row>
          )}
        </Card>
      </div>
    </div>
  );

  const renderAbout = () => (
    <div className="space-y-6">
      <div>
        <SectionTitle>应用信息</SectionTitle>
        <Card>
          <Row title="应用名称">
            <span className="text-sm font-medium text-linear-text-primary">quick-chat</span>
          </Row>
          <Row title="版本">
            <span className="font-mono text-sm text-linear-text-secondary">{pkg.version}</span>
          </Row>
        </Card>
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label="设置"
    >
      {/* 半透明遮罩：保留主界面背景可见，点击关闭 */}
      <div className="absolute inset-0 bg-black/55" onClick={onClose} aria-hidden="true" />

      <div
        className="relative flex h-[600px] w-[880px] max-h-full max-w-full overflow-hidden rounded-xl border border-linear-border bg-linear-bg font-sans text-linear-text-secondary shadow-[0_24px_80px_rgba(0,0,0,0.45)] antialiased"
        style={{ animation: 'menu-enter 0.18s var(--ease-snappy) forwards' }}
      >
        {/* 左侧导航栏 */}
        <nav className="flex w-[200px] flex-shrink-0 flex-col border-r border-linear-border bg-linear-sidebar">
          <div className="flex h-11 flex-shrink-0 items-center px-4">
            <h1 className="text-[15px] font-semibold text-linear-text-primary">设置</h1>
          </div>
          <div className="flex-1 space-y-1 px-3 py-2">
            {NAV_ITEMS.map(item => {
              const isActive = activeNav === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveNav(item.key)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-linear-surface font-semibold text-linear-text-primary'
                      : 'text-linear-text-secondary hover:bg-linear-surface/60 hover:text-linear-text-primary'
                  }`}
                >
                  <span className={isActive ? 'text-linear-text-primary' : 'text-linear-text-tertiary'}>{item.icon}</span>
                  {item.label}
                </button>
              );
            })}
          </div>
          <div className="flex-shrink-0 px-4 py-3">
            <span className="text-[11px] text-linear-text-muted">v{pkg.version}</span>
          </div>
        </nav>

        {/* 右侧内容区 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-11 flex-shrink-0 items-center justify-end">
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-9 items-center justify-center rounded-lg text-linear-text-tertiary transition-colors duration-150 hover:bg-[#e81123] hover:text-white cursor-pointer"
              aria-label="关闭设置"
              title="关闭"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.75" />
              </svg>
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
            <div className="mx-auto w-full max-w-[680px] px-6 pb-8">
              <div key={activeNav} style={{ animation: 'menu-enter 0.18s var(--ease-snappy) forwards' }}>
                {activeNav === 'general' && renderGeneral()}
                {activeNav === 'providers' && renderProviders()}
                {activeNav === 'about' && renderAbout()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(SettingsPanel);
