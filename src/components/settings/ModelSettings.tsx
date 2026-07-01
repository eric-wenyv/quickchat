import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelConfig, UUID } from '@/types/types';
import { ModelForm } from './ModelForm';

interface ModelSettingsProps {
  models: ModelConfig[];
  visionModelId: string | null;
  onSelectVisionModel: (id: string | null) => void;
  onSave: (config: ModelConfig) => void;
  onDelete: (id: UUID) => void;
  onClose: () => void;
}

const PROVIDER_BADGES: Record<string, { label: string; bg: string; text: string }> = {
  google_gemini: { label: 'GG', bg: 'bg-blue-500/10', text: 'text-blue-600' },
  openrouter: { label: 'OR', bg: 'bg-purple-500/10', text: 'text-purple-600' },
  openai_compatible: { label: 'OA', bg: 'bg-emerald-500/10', text: 'text-emerald-600' },
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
          className="absolute bottom-full left-0 z-50 mb-2 w-full min-w-[280px] rounded-xl bg-linear-bg-elevated/98 p-1.5 shadow-[0_18px_45px_rgba(0,0,0,0.32)] backdrop-blur-xl origin-bottom"
          style={{ animation: 'menu-enter 0.2s var(--ease-snappy) forwards' }}
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={!selectedModel}
            onClick={() => handleSelect(null)}
            className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-150 cursor-pointer ${
              !selectedModel
                ? 'bg-linear-surface-hover text-linear-text-primary'
                : 'text-linear-text-secondary hover:bg-linear-surface hover:text-linear-text-primary'
            }`}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[5px] bg-linear-surface text-[9px] font-bold text-linear-text-tertiary">
                A
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-semibold tracking-tight">自动选择</span>
                <span className="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-linear-text-tertiary">
                  第一个可用的 Vision 模型
                </span>
              </span>
            </span>
            {!selectedModel && <CheckIcon className="h-4 w-4 flex-shrink-0" />}
          </button>

          <div className="max-h-52 overflow-y-auto custom-scrollbar">
            {visionModels.map(model => {
              const badge = PROVIDER_BADGES[model.provider] || { label: '?', bg: 'bg-gray-500/10', text: 'text-gray-400' };
              const isActive = selectedModel?.id === model.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => handleSelect(model.id)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-150 cursor-pointer ${
                    isActive
                      ? 'bg-linear-surface-hover text-linear-text-primary'
                      : 'text-linear-text-secondary hover:bg-linear-surface hover:text-linear-text-primary'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[5px] ${badge.bg} ${badge.text} text-[8px] font-bold`}>
                      {badge.label}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-sm font-semibold tracking-tight">{model.display_name}</span>
                      <span className="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-linear-text-tertiary">
                        {model.model_id}
                      </span>
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
export const ModelSettings: React.FC<ModelSettingsProps> = ({
  models,
  visionModelId,
  onSelectVisionModel,
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
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-linear-bg-elevated backdrop-blur-xl border border-linear-border rounded-xl shadow-2xl w-full max-w-xl mx-4 max-h-[85vh] flex flex-col animate-in fade-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-linear-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-linear-text-secondary">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            <h2 className="text-base font-bold text-linear-text-primary">模型与全局设置</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-linear-text-tertiary hover:text-linear-text-secondary hover:bg-linear-surface rounded-lg transition-colors cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
          {showForm ? (
            <div>
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
            </div>
          ) : (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-linear-text-primary mb-2">模型管理</h3>
              {models.length === 0 && (
                <div className="text-center py-12 text-linear-text-tertiary text-sm">
                  还没有配置任何模型，点击下方按钮添加。
                </div>
              )}
              {models.map(model => {
                const badge = PROVIDER_BADGES[model.provider] || { label: '?', bg: 'bg-gray-100', text: 'text-gray-500' };
                return (
                  <div
                    key={model.id}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg bg-linear-surface border border-linear-border hover:border-linear-border-hover transition-all"
                  >
                    <div className={`flex-shrink-0 w-8 h-8 rounded-[4px] ${badge.bg} ${badge.text} flex items-center justify-center text-[10px] font-bold`}>
                      {badge.label}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-linear-text-primary truncate">{model.display_name}</span>
                        {model.is_default && (
                          <span className="flex-shrink-0 text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded-md font-bold">
                            默认
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-linear-text-tertiary font-mono truncate block">{model.model_id}</span>
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
          )}
        </div>

        {/* Footer — 图片解析模型选择 + 添加按钮 */}
        {!showForm && (
          <div className="flex-shrink-0 px-6 py-4 border-t border-linear-border space-y-3">
            {/* 图片解析模型选择器 */}
            {models.filter(m => m.supports_vision).length > 0 && (
              <div>
                <label className="block text-xs font-bold text-linear-text-secondary mb-1.5">
                  图片解析模型
                  <span className="font-normal text-linear-text-muted ml-1">— 当主模型不支持图片时，用此模型解析图片内容</span>
                </label>
                <VisionModelSelector
                  models={models}
                  value={visionModelId}
                  onChange={onSelectVisionModel}
                />
              </div>
            )}
            <button
              onClick={handleAdd}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-linear-text-primary bg-linear-surface hover:bg-linear-surface-hover rounded-lg transition-colors cursor-pointer border border-linear-border"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14" /><path d="M5 12h14" />
              </svg>
              添加模型
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ModelSettings;
