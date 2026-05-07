import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { ModelConfig, UUID } from '@/types/types';
import { useAutoResize } from '@/hooks/useAutoResize';

const PROVIDER_BADGES: Record<string, { label: string; color: string }> = {
  google_gemini: { label: 'GG', color: 'bg-blue-500' },
  openrouter: { label: 'OR', color: 'bg-purple-500' },
  openai_compatible: { label: 'OA', color: 'bg-emerald-500' },
};

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
        className="group flex items-center gap-2 px-3 py-1.5 rounded-xl bg-sand-200/80 hover:bg-sand-300 border border-sand-400/40 hover:border-sand-400/80 transition-all duration-300 text-ink-200 hover:text-ink-400 text-xs font-semibold backdrop-blur-sm shadow-sm"
      >
        <div className="relative">
          <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
          <div className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-500 animate-ping opacity-20" />
        </div>
        <span className="max-w-[120px] truncate">{activeModel?.display_name || 'Select Model'}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`w-3.5 h-3.5 transition-transform duration-300 ease-out ${isOpen ? 'rotate-180' : ''}`}
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
          className="absolute bottom-full left-0 mb-3 w-64 bg-sand-100/95 dark:bg-sand-200/95 backdrop-blur-md border border-sand-400/60 rounded-2xl shadow-panel z-50 animate-in fade-in slide-in-from-bottom-2 duration-300 origin-bottom"
        >
          <div className="p-2 space-y-1">
            <div className="px-2 py-1.5 mb-1">
              <textarea
                ref={textareaRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search models..."
                rows={1}
                className="w-full bg-sand-200/50 dark:bg-sand-300/50 text-ink-300 text-xs placeholder:text-ink-100 px-3 py-2 rounded-xl border border-sand-400/40 focus:border-sand-500 focus:shadow-input-hover outline-none transition-all duration-200 resize-none overflow-hidden"
              />
            </div>

            <div className="max-h-60 overflow-y-auto custom-scrollbar px-1">
              {filteredModels.length > 0 ? (
                filteredModels.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => {
                      onSelect(model.id);
                      setIsOpen(false);
                      setSearchQuery('');
                    }}
                    className={`group w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all duration-200 ${
                      model.id === activeModelId
                        ? 'bg-sand-300 text-ink-400'
                        : 'text-ink-200 hover:bg-sand-200 hover:text-ink-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`flex-shrink-0 w-5 h-5 rounded-md ${PROVIDER_BADGES[model.provider]?.color || 'bg-gray-400 dark:bg-gray-600'} text-white flex items-center justify-center text-[8px] font-bold`}>
                        {PROVIDER_BADGES[model.provider]?.label || '?'}
                      </span>
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-sm font-bold tracking-tight truncate">{model.display_name}</span>
                        <span className="text-[10px] font-medium opacity-50 uppercase tracking-widest truncate">{model.model_id}</span>
                      </div>
                    </div>
                    {model.id === activeModelId && (
                      <div className="bg-ink-400 text-sand-100 rounded-full p-0.5 shadow-sm flex-shrink-0">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="w-3 h-3"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      </div>
                    )}
                  </button>
                ))
              ) : (
                <div className="px-4 py-8 text-center text-ink-100 text-xs italic">
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
