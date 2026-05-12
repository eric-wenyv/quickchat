import React, { useState } from 'react';
import type { ModelConfig, UUID } from '@/types/types';
import { ModelForm } from './ModelForm';

interface ModelSettingsProps {
  models: ModelConfig[];
  onSave: (config: ModelConfig) => void;
  onDelete: (id: UUID) => void;
  onClose: () => void;
  searchApiKey?: string;
  onSearchApiKeyChange?: (key: string) => void;
}

const PROVIDER_BADGES: Record<string, { label: string; bg: string; text: string }> = {
  google_gemini: { label: 'GG', bg: 'bg-blue-500/10', text: 'text-blue-600' },
  openrouter: { label: 'OR', bg: 'bg-purple-500/10', text: 'text-purple-600' },
  openai_compatible: { label: 'OA', bg: 'bg-emerald-500/10', text: 'text-emerald-600' },
};

export const ModelSettings: React.FC<ModelSettingsProps> = ({
  models,
  onSave,
  onDelete,
  onClose,
  searchApiKey = '',
  onSearchApiKeyChange,
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
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
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
          {/* 搜索 API 配置 */}
          {onSearchApiKeyChange && (
            <div className="mb-5 p-4 rounded-lg bg-linear-surface border border-linear-border">
              <div className="flex items-center gap-2 mb-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-linear-text-secondary">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                </svg>
                <h3 className="text-xs font-bold text-linear-text-primary">全局网络搜索</h3>
              </div>
              <p className="text-[11px] text-linear-text-tertiary mb-2">
                这里的 SerpApi Key 是全局配置，只需设置一次，所有 AI 模型都会共用这份网络搜索能力。
                <a href="https://serpapi.com/users/sign_up?plan=free" target="_blank" rel="noopener noreferrer" className="text-linear-accent hover:underline ml-1">获取 SerpApi Key →</a>
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={searchApiKey}
                  onChange={e => onSearchApiKeyChange(e.target.value)}
                  placeholder="SerpApi Key（全局共享）"
                  className="flex-1 bg-linear-bg text-linear-text-secondary text-xs placeholder:text-linear-text-muted px-3 py-2 rounded-lg border border-linear-border focus:border-linear-border-hover outline-none transition-all"
                />
                {searchApiKey && (
                  <button
                    onClick={() => onSearchApiKeyChange('')}
                    className="px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer border border-red-500/20"
                  >
                    清除
                  </button>
                )}
              </div>
              {searchApiKey ? (
                <p className="mt-1.5 text-[10px] text-emerald-400 font-medium">✓ 全局搜索已启用</p>
              ) : (
                <p className="mt-1.5 text-[10px] text-linear-text-muted">未配置，AI 将无法使用网络搜索</p>
              )}
            </div>
          )}

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

        {/* Footer */}
        {!showForm && (
          <div className="flex-shrink-0 px-6 py-4 border-t border-linear-border">
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
