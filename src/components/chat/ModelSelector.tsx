import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { ModelConfig, UUID } from '@/types/types';
import { useAutoResize } from '@/hooks/useAutoResize';

const PROVIDER_BADGES: Record<string, { label: string; badge: string }> = {
  google_gemini: {
    label: 'GG',
    badge: 'bg-[#6f8f72] text-white',
  },
  openrouter: {
    label: 'OR',
    badge: 'bg-[#9a7a58] text-white',
  },
  openai_compatible: {
    label: 'OA',
    badge: 'bg-[#6f7f91] text-white',
  },
};

function providerBadge(provider: string) {
  return PROVIDER_BADGES[provider] ?? {
    label: '?',
    badge: 'bg-[#777] text-white',
  };
}

interface ModelSelectorProps {
  models: ModelConfig[];
  activeModelId: UUID;
  onSelect: (id: UUID) => void;
}

/**
 * ModelSelector (C-12)
 * 模型选择下拉菜单，展示当前模型名称，点击切换
 */
const ModelSelector: React.FC<ModelSelectorProps> = ({
  models,
  activeModelId,
  onSelect,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeModel = useMemo(() => 
    models.find((m) => m.id === activeModelId) || models[0],
    [models, activeModelId]
  );

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return models;
    const lowerQuery = searchQuery.toLowerCase();
    return models.filter(
      (m) =>
        m.display_name.toLowerCase().includes(lowerQuery) ||
        m.model_id.toLowerCase().includes(lowerQuery)
    );
  }, [models, searchQuery]);

  /**
   * 拦截 UI 任务附加限制：
   * 拦截 Enter 键实现发送（在选择器中表现为确认选择），Shift+Enter 实现换行，高度必须随内容自动增长。
   */
  useAutoResize(textareaRef, searchQuery, () => {
    if (filteredModels.length > 0) {
      onSelect(filteredModels[0].id);
      setIsOpen(false);
      setSearchQuery('');
    }
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        id="model-selector-trigger"
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={`group flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold cursor-pointer outline-none transition-colors duration-150 ${
          isOpen
            ? 'bg-linear-surface-hover text-linear-text-primary'
            : 'bg-transparent text-linear-text-tertiary hover:bg-linear-surface-hover hover:text-linear-text-primary focus-visible:bg-linear-surface-hover focus-visible:text-linear-text-primary'
        }`}
      >
        <span className="max-w-[120px] truncate">{activeModel?.display_name || 'Select Model'}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`w-3.5 h-3.5 ${isOpen ? 'rotate-180' : ''}`}
          style={{ transition: 'transform 0.2s var(--ease-snappy)' }}
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
          data-focus-preserve="true"
          role="menu"
          className="absolute bottom-full left-0 mb-2 w-72 rounded-xl bg-linear-bg-elevated/98 p-1.5 shadow-[0_18px_45px_rgba(0,0,0,0.32)] backdrop-blur-xl z-50 origin-bottom"
          style={{ animation: 'menu-enter 0.2s var(--ease-snappy) forwards' }}
        >
          <div className="space-y-1">
            <div className="p-1">
              <textarea
                ref={textareaRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search models..."
                rows={1}
                className="w-full resize-none overflow-hidden rounded-lg bg-linear-surface/70 px-3 py-2 text-xs text-linear-text-secondary placeholder:text-linear-text-muted outline-none transition-colors duration-150 focus:bg-linear-surface-hover"
              />
            </div>

            <div className="max-h-60 overflow-y-auto custom-scrollbar px-1">
              {filteredModels.length > 0 ? (
                filteredModels.map((model) => {
                  const provider = providerBadge(model.provider);
                  const isActive = model.id === activeModelId;
                  return (
                    <button
                      key={model.id}
                      onClick={() => {
                        onSelect(model.id);
                        setIsOpen(false);
                        setSearchQuery('');
                      }}
                      role="menuitemradio"
                      aria-checked={isActive}
                      className={`group w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-left transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-linear-surface-hover text-linear-text-primary'
                          : 'text-linear-text-secondary hover:bg-linear-surface hover:text-linear-text-primary'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`flex-shrink-0 w-6 h-6 rounded-[5px] ${provider.badge} flex items-center justify-center text-[8px] font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]`}>
                          {provider.label}
                        </span>
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="text-sm font-semibold tracking-tight truncate">{model.display_name}</span>
                          <span className="text-[10px] font-medium text-linear-text-tertiary uppercase tracking-[0.08em] truncate">{model.model_id}</span>
                        </div>
                      </div>
                      {isActive && (
                        <div className="text-linear-text-primary flex-shrink-0">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="w-4 h-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        </div>
                      )}
                    </button>
                  );
                })
              ) : (
                <div className="px-4 py-8 text-center text-linear-text-muted text-xs italic">
                  No models found
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelSelector;
