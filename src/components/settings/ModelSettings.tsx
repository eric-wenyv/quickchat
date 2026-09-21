import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelConfig, UUID } from '@/types/types';
import { ModelForm } from './ModelForm';
import { DEFAULT_GLOBAL_SHORTCUT } from '@/services/globalShortcut';
import { isDesktopPlatform, isMobilePlatform } from '@/utils/platform';
import { SyncServerSettings } from './SyncServerSettings';
import { SyncClientSettings } from './SyncClientSettings';

interface ModelSettingsProps {
  models: ModelConfig[];
  visionModelId: string | null;
  onSelectVisionModel: (id: string | null) => void;
  globalShortcut: string | null;
  onGlobalShortcutChange: (shortcut: string | null) => Promise<void>;
  onSave: (config: ModelConfig) => void;
  onDelete: (id: UUID) => void;
  onClose: () => void;
}

interface GlobalShortcutSettingsProps {
  value: string | null;
  onChange: (shortcut: string | null) => Promise<void>;
}

const shortcutKeyFromEvent = (event: React.KeyboardEvent<HTMLButtonElement>): string | null => {
  if (event.key === ' ') return 'Space';
  if (/^[a-z0-9]$/i.test(event.key)) return event.key.toUpperCase();
  if (/^F(?:[1-9]|1[0-2])$/i.test(event.key)) return event.key.toUpperCase();
  return null;
};

const RESERVED_SHORTCUTS = new Set(['Ctrl+Shift+S', 'Ctrl+Shift+N']);

// TODO: beautify or completely delete this componet
const GlobalShortcutSettings: React.FC<GlobalShortcutSettingsProps> = ({ value, onChange }) => {
  const [shortcut, setShortcut] = useState(value);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setShortcut(value), [value]);

  const captureShortcut = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!isCapturing) return;
    event.preventDefault();
    event.stopPropagation();

    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;

    const key = shortcutKeyFromEvent(event);
    if (!key) {
      setError('请使用字母、数字、F1–F12 或空格键。');
      return;
    }

    const modifiers = [
      event.ctrlKey && 'Ctrl',
      event.altKey && 'Alt',
      event.shiftKey && 'Shift',
      event.metaKey && 'Super',
    ].filter(Boolean);

    if (modifiers.length === 0) {
      setError('快捷键必须包含 Ctrl、Alt、Shift 或 Super。');
      return;
    }

    const nextShortcut = [...modifiers, key].join('+');
    if (RESERVED_SHORTCUTS.has(nextShortcut)) {
      setError('该组合键已用于应用内操作，请选择其他快捷键。');
      return;
    }

    setShortcut(nextShortcut);
    setError(null);
    setIsCapturing(false);
  };

  const saveShortcut = async (nextShortcut: string | null) => {
    setIsSaving(true);
    setError(null);
    try {
      await onChange(nextShortcut);
      setShortcut(nextShortcut);
    } catch (saveError) {
      setError(`无法注册此快捷键：${String(saveError)}`);
    } finally {
      setIsSaving(false);
      setIsCapturing(false);
    }
  };

  return (
    <section className="rounded-lg border border-linear-border bg-linear-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-linear-text-primary">快速打开</h3>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-bold ${shortcut ? 'bg-emerald-500/10 text-emerald-400' : 'bg-linear-surface-hover text-linear-text-tertiary'}`}>
          {shortcut ? '已启用' : '已禁用'}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setIsCapturing(true);
            setError(null);
          }}
          onKeyDown={captureShortcut}
          className={`min-w-44 rounded-lg border px-3 py-2 text-left font-mono text-sm transition-colors cursor-pointer focus:outline-none focus-visible:border-linear-border-hover ${
            isCapturing
              ? 'border-linear-border-hover bg-linear-surface-hover text-linear-text-primary'
              : 'border-linear-border bg-linear-bg text-linear-text-secondary hover:bg-linear-surface-hover'
          }`}
          aria-label="录入快速打开快捷键"
        >
          {isCapturing ? '按下新的组合键…' : shortcut ?? '未设置'}
        </button>
        <button
          type="button"
          disabled={isSaving || !shortcut || isCapturing}
          onClick={() => void saveShortcut(shortcut)}
          className="rounded-lg border border-linear-border px-3 py-2 text-xs font-semibold text-linear-text-secondary transition-colors hover:bg-linear-surface-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          {isSaving ? '保存中…' : '保存'}
        </button>
        <button
          type="button"
          disabled={isSaving}
          onClick={() => void saveShortcut(null)}
          className="rounded-lg px-3 py-2 text-xs font-semibold text-linear-text-tertiary transition-colors hover:bg-linear-surface-hover hover:text-linear-text-secondary disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          禁用
        </button>
        <button
          type="button"
          disabled={isSaving}
          onClick={() => void saveShortcut(DEFAULT_GLOBAL_SHORTCUT)}
          className="rounded-lg px-3 py-2 text-xs font-semibold text-linear-text-tertiary transition-colors hover:bg-linear-surface-hover hover:text-linear-text-secondary disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          恢复默认
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400" role="alert">{error}</p>}
    </section>
  );
};

interface VisionModelSelectorProps {
  models: ModelConfig[];
  value: string | null;
  onChange: (id: string | null) => void;
}

const VisionModelSelector: React.FC<VisionModelSelectorProps> = ({
  models,
  value,
  onChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const visionModels = useMemo(() => models.filter(m => m.supports_vision), [models]);
  const selectedModel = useMemo(
    () => visionModels.find(m => m.id === value) ?? null,
    [visionModels, value],
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSelect = (id: string | null) => {
    onChange(id);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={`group flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left outline-none transition-all duration-150 cursor-pointer ${
          isOpen
            ? 'bg-linear-surface-hover border-linear-border-hover text-linear-text-primary'
            : 'bg-linear-surface border-linear-border text-linear-text-secondary hover:bg-linear-surface-hover hover:border-linear-border-hover hover:text-linear-text-primary focus-visible:bg-linear-surface-hover focus-visible:border-linear-border-hover'
        }`}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[5px] bg-linear-surface-hover text-linear-text-tertiary">
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
            </svg>
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-semibold tracking-tight">
              {selectedModel?.display_name ?? '自动选择 Vision 模型'}
            </span>
            <span className="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-linear-text-tertiary">
              {selectedModel?.model_id ?? '使用第一个可用的图片模型'}
            </span>
          </span>
        </span>
        <svg
          className={`h-4 w-4 flex-shrink-0 text-linear-text-tertiary transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute top-full left-0 z-50 mt-2 w-full min-w-[280px] rounded-lg bg-linear-bg-elevated/98 p-1.5 shadow-[0_18px_45px_rgba(0,0,0,0.32)] backdrop-blur-xl origin-top"
          style={{ animation: 'menu-enter 0.2s var(--ease-snappy) forwards' }}
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={!selectedModel}
            onClick={() => handleSelect(null)}
            className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-150 cursor-pointer ${
              !selectedModel
                ? 'bg-linear-surface-hover text-linear-text-primary'
                : 'text-linear-text-secondary hover:bg-linear-surface hover:text-linear-text-primary'
            }`}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-semibold tracking-tight">自动选择</span>
              </span>
            </span>
            {!selectedModel && <CheckIcon className="h-4 w-4 flex-shrink-0" />}
          </button>

          <div className="max-h-52 overflow-y-auto custom-scrollbar space-y-1 rounded-lg">
            {visionModels.map(model => {
              const isActive = selectedModel?.id === model.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => handleSelect(model.id)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-150 cursor-pointer ${
                    isActive
                      ? 'bg-linear-surface-hover text-linear-text-primary'
                      : 'text-linear-text-secondary hover:bg-linear-surface hover:text-linear-text-primary'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-sm font-semibold tracking-tight">{model.display_name}</span>
                    </span>
                  </span>
                  {isActive && <CheckIcon className="h-4 w-4 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const CheckIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
/**
 * 设置页（全页面，占据主界面整个内容区，替代侧栏 + 聊天区）
 *
 * - 桌面端返回入口在顶部菜单栏左侧；移动端无菜单栏，头部自带返回按钮
 * - 单列窄栏内容流：快捷键 / 同步 / 模型管理 / 图片解析模型
 */
export const ModelSettings: React.FC<ModelSettingsProps> = ({
  models,
  visionModelId,
  onSelectVisionModel,
  globalShortcut,
  onGlobalShortcutChange,
  onSave,
  onDelete,
  onClose,
}) => {
  const [editing, setEditing] = useState<ModelConfig | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<UUID | null>(null);

  const handleSave = (config: ModelConfig) => {
    onSave(config);
    setShowForm(false);
    setEditing(null);
  };

  const handleEdit = (model: ModelConfig) => {
    setEditing(model);
    setShowForm(true);
  };

  const handleAdd = () => {
    setEditing(null);
    setShowForm(true);
  };

  return (
    <div className="col-span-full relative z-0 flex h-full min-w-0 flex-col overflow-hidden bg-linear-bg">
      {/* 页面头部：移动端带返回按钮（桌面端返回在顶部菜单栏左侧） */}
      <header className="flex h-12 flex-shrink-0 items-center justify-between border-b border-linear-border px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {isMobilePlatform && (
            <button
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-linear-text-tertiary transition-colors hover:bg-linear-surface hover:text-linear-text-primary cursor-pointer"
              title="返回对话"
              aria-label="返回对话"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          )}
          <h1 className="text-[15px] font-semibold text-linear-text-primary">设置</h1>
        </div>
        {!showForm && (
          <button
            onClick={handleAdd}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-semibold text-linear-text-secondary transition-colors hover:bg-linear-surface hover:text-linear-text-primary cursor-pointer"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" /><path d="M5 12h14" />
            </svg>
            添加模型
          </button>
        )}
      </header>

      {/* 内容区：单列滚动窄栏 */}
      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        <div className="mx-auto w-full max-w-2xl space-y-4 px-6 py-6">
          {showForm ? (
            <section className="rounded-lg border border-linear-border bg-linear-surface p-4">
              <h3 className="text-sm font-bold text-linear-text-primary mb-4">
                {editing ? '编辑模型' : '添加新模型'}
              </h3>
              <ModelForm
                initial={editing}
                onSave={handleSave}
                onCancel={() => {
                  setShowForm(false);
                  setEditing(null);
                }}
              />
            </section>
          ) : (
            <>
              {isDesktopPlatform && <GlobalShortcutSettings value={globalShortcut} onChange={onGlobalShortcutChange} />}
              {isDesktopPlatform ? <SyncServerSettings /> : <SyncClientSettings />}

              <section className="rounded-lg border border-linear-border bg-linear-surface p-4">
                <h3 className="text-sm font-bold text-linear-text-primary">模型管理</h3>
                {models.length === 0 && (
                  <div className="py-8 text-center text-linear-text-tertiary text-sm">
                    还没有配置任何模型，点击右上角「添加模型」按钮添加。
                  </div>
                )}
                <div className="mt-3 space-y-2">
                  {models.map(model => {
                    return (
                      <div
                        key={model.id}
                        className="flex items-center gap-3 px-4 py-3 rounded-lg bg-linear-bg border border-linear-border hover:border-linear-border-hover transition-all"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-linear-text-primary truncate">{model.display_name}</span>
                            {model.is_default && (
                              <span className="flex-shrink-0 text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded-md font-bold">
                                默认
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => handleEdit(model)}
                            className="p-1.5 text-linear-text-tertiary hover:text-linear-text-secondary hover:bg-linear-surface rounded-lg transition-colors cursor-pointer"
                            title="编辑"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                            </svg>
                          </button>
                          {deleteConfirm === model.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => {
                                  onDelete(model.id);
                                  setDeleteConfirm(null);
                                }}
                                className="px-2 py-1 text-[11px] font-bold text-white bg-red-500 rounded-md hover:bg-red-600 transition-colors cursor-pointer"
                              >
                                确认
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                className="px-2 py-1 text-[11px] font-bold text-linear-text-secondary bg-linear-surface rounded-md hover:bg-linear-surface-hover transition-colors cursor-pointer"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirm(model.id)}
                              className="p-1.5 text-linear-text-tertiary hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                              title="删除"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* 图片解析模型选择器 */}
              {models.filter(m => m.supports_vision).length > 0 && (
                <section className="rounded-lg border border-linear-border bg-linear-surface p-4">
                  <h3 className="text-sm font-bold text-linear-text-primary">图片解析模型</h3>
                  <p className="mt-1 text-xs text-linear-text-tertiary">
                    当前对话模型不支持图片输入时，使用它解析图片内容。
                  </p>
                  <div className="mt-3">
                    <VisionModelSelector
                      models={models}
                      value={visionModelId}
                      onChange={onSelectVisionModel}
                    />
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default React.memo(ModelSettings);
