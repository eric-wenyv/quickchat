import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { ModelConfig, UUID } from '@/types/types';

interface ThinkingLevelSelectorProps {
  models: ModelConfig[];
  activeModelId: UUID;
  onUpdateThinkingLevel: (id: UUID, level: 'LOW' | 'MEDIUM' | 'HIGH' | null) => void;
}

const LEVEL_LABELS: Record<string, string> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
};

const LEVEL_COLORS: Record<string, string> = {
  LOW: 'bg-blue-400',
  MEDIUM: 'bg-amber-400',
  HIGH: 'bg-rose-400',
};

/**
 * ThinkingLevelSelector
 * 模型思考深度选择器，仅对支持 thinking 的模型显示（Gemini 3.x）
 */
const ThinkingLevelSelector: React.FC<ThinkingLevelSelectorProps> = ({
  models,
  activeModelId,
  onUpdateThinkingLevel,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeModel = useMemo(() =>
    models.find(m => m.id === activeModelId),
    [models, activeModelId]
  );

  // 仅 Gemini 3.x 系列支持 thinkingLevel 调节
  const isSupported = activeModel?.model_id.includes('gemini-3') ?? false;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  if (!isSupported || !activeModel) return null;

  const currentLevel = activeModel.thinking_level || 'MEDIUM';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-sand-200/50 hover:bg-sand-300 border border-sand-400/30 hover:border-sand-400/60 transition-all duration-200 text-[10px] font-bold text-ink-200 hover:text-ink-400"
        title="思考深度"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${LEVEL_COLORS[currentLevel]}`} />
        <span>思考: {LEVEL_LABELS[currentLevel]}</span>
        <svg
          className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-28 bg-sand-100/95 backdrop-blur-md border border-sand-400/60 rounded-xl shadow-panel z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
          {(['LOW', 'MEDIUM', 'HIGH'] as const).map(level => (
            <button
              key={level}
              onClick={() => {
                onUpdateThinkingLevel(activeModel.id, level);
                setIsOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-all duration-200 first:rounded-t-xl last:rounded-b-xl ${
                currentLevel === level
                  ? 'bg-sand-300 text-ink-400'
                  : 'text-ink-200 hover:bg-sand-200 hover:text-ink-300'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${LEVEL_COLORS[level]}`} />
              <span className="text-xs font-semibold">{LEVEL_LABELS[level]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ThinkingLevelSelector;
