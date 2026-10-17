import React, { useMemo, useState } from 'react';
import type { ModelConfig, UUID } from '@/types/types';
import { ModelForm } from './ModelForm';

interface ModelManagerProps {
  models: ModelConfig[];
  onSave: (config: ModelConfig) => void;
  onDelete: (id: UUID) => void;
  /**
   * false（默认）：自带"模型管理"卡片外壳，用于整页设置；
   * true：只渲染列表/表单内容，外壳由调用方（设置窗口分组卡片）提供
   */
  bare?: boolean;
}

export const maskApiKey = (key: string): string => {
  if (key.length > 10) return `${key.slice(0, 6)}…${key.slice(-4)}`;
  if (key.length > 4) return `${key.slice(0, 2)}…${key.slice(-2)}`;
  return '•••';
};

export const ModelManager: React.FC<ModelManagerProps> = ({ models, onSave, onDelete, bare = false }) => {
  const [editing, setEditing] = useState<ModelConfig | null>(null);
  const [addPrefill, setAddPrefill] = useState<{ api_key: string; api_endpoint: string | null } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<UUID | null>(null);

  // 先按 API Endpoint 分组，组内再按 API Key 分组
  const groups = useMemo(() => {
    const byEndpoint = new Map<string, Map<string, ModelConfig[]>>();
    for (const model of models) {
      const endpoint = model.api_endpoint?.trim() ?? '';
      let byKey = byEndpoint.get(endpoint);
      if (!byKey) {
        byKey = new Map();
        byEndpoint.set(endpoint, byKey);
      }
      const list = byKey.get(model.api_key);
      if (list) list.push(model);
      else byKey.set(model.api_key, [model]);
    }
    return [...byEndpoint.entries()].map(([endpoint, byKey]) => ({
      endpoint,
      keyGroups: [...byKey.entries()].map(([apiKey, items]) => ({ apiKey, models: items })),
    }));
  }, [models]);

  const handleSave = (config: ModelConfig) => {
    onSave(config);
    setShowForm(false);
    setEditing(null);
    setAddPrefill(null);
  };

  const handleEdit = (model: ModelConfig) => {
    setEditing(model);
    setAddPrefill(null);
    setShowForm(true);
  };

  const handleAdd = (prefill: { api_key: string; api_endpoint: string | null } | null = null) => {
    setEditing(null);
    setAddPrefill(prefill);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
    setAddPrefill(null);
  };

  const renderModelRow = (model: ModelConfig) => (
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

  const formContent = showForm ? (
    <div className={bare ? 'p-4' : 'rounded-lg border border-linear-border bg-linear-surface p-4'}>
      <h3 className="text-sm font-bold text-linear-text-primary mb-4">
        {editing ? '编辑模型' : '添加新模型'}
      </h3>
      <ModelForm
        initial={editing}
        prefill={addPrefill}
        onSave={handleSave}
        onCancel={closeForm}
      />
    </div>
  ) : null;

  if (showForm) {
    return formContent;
  }

  const listContent = models.length === 0 ? (
    <button
      onClick={() => handleAdd()}
      className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-linear-border py-6 text-sm font-semibold text-linear-text-tertiary transition-colors hover:border-linear-border-hover hover:text-linear-text-secondary cursor-pointer"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14" /><path d="M5 12h14" />
      </svg>
      添加模型
    </button>
  ) : (
    <div className={bare ? 'space-y-3' : 'mt-3 space-y-3'}>
      {groups.map(group => (
        <div
          key={group.endpoint || '__default__'}
          className="rounded-lg border border-linear-border bg-linear-bg p-3 space-y-2.5"
        >
          <div
            className="truncate px-1 font-mono text-xs font-semibold text-linear-text-secondary"
            title={group.endpoint || undefined}
          >
            {group.endpoint || '默认端点'}
          </div>
          {group.keyGroups.map(keyGroup => (
            <div
              key={keyGroup.apiKey}
              className="rounded-lg border border-linear-border/70 bg-linear-surface p-2 space-y-2"
            >
              <div className="px-2 pt-1 font-mono text-[11px] text-linear-text-tertiary">
                {maskApiKey(keyGroup.apiKey)}
              </div>
              <div className="space-y-2">
                {keyGroup.models.map(renderModelRow)}
              </div>
              <button
                onClick={() => handleAdd({ api_key: keyGroup.apiKey, api_endpoint: group.endpoint || null })}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-linear-border py-2 text-xs font-semibold text-linear-text-tertiary transition-colors hover:border-linear-border-hover hover:text-linear-text-secondary cursor-pointer"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14" /><path d="M5 12h14" />
                </svg>
                添加模型
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );

  if (bare) {
    return <div className="p-1">{listContent}</div>;
  }

  return (
    <section className="rounded-lg border border-linear-border bg-linear-surface p-4">
      <h3 className="text-sm font-bold text-linear-text-primary">模型管理</h3>
      {listContent}
    </section>
  );
};

export default React.memo(ModelManager);
