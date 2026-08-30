import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { ModelConfig, UUID } from '@/types/types';

interface ThinkingLevelSelectorProps {
  models: ModelConfig[];
  activeModelId: UUID;
  /** 当前会话的 thinking_level（per-conversation） */
  thinkingLevel: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  onUpdateThinkingLevel: (level: 'LOW' | 'MEDIUM' | 'HIGH' | null) => void;
}

const LEVEL_LABELS: Record<string, string> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
};

/**
 * ThinkingLevelSelector
 * 模型思考深度选择器，仅对支持 thinking 的模型显示（Gemini 3.x）
 */
const ThinkingLevelSelector: React.FC<ThinkingLevelSelectorProps> = ({
  models,
  activeModelId,
  thinkingLevel,
  onUpdateThinkingLevel,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeModel = useMemo(() =>
    models.find(m => m.id === activeModelId),
    [models, activeModelId]
  );

  // 仅 Gemini 3.x 系列支持 thinkingLevel 调节（通过 Gemini OpenAI 兼容端点）
  const isSupported = (activeModel?.provider === 'google_gemini' && activeModel?.model_id.includes('gemini-3')) ?? false;

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

  // 使用 per-conversation 的 thinking_level，fallback 到 MEDIUM
  const currentLevel = thinkingLevel || 'MEDIUM';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-[14px] font-semibold cursor-pointer outline-none transition-colors duration-150 ${
          isOpen
            ? 'bg-linear-surface-hover text-linear-text-primary'
            : 'bg-transparent text-linear-text-tertiary hover:bg-linear-surface-hover hover:text-linear-text-primary focus-visible:bg-linear-surface-hover focus-visible:text-linear-text-primary'
        }`}
        title="思考深度"
      >
        <span>思考: {LEVEL_LABELS[currentLevel]}</span>
        <svg
          className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-2 w-24 rounded-xl bg-linear-bg-elevated/98 p-1.5 shadow-[0_18px_45px_rgba(0,0,0,0.32)] backdrop-blur-xl z-50 origin-bottom"
          style={{ animation: 'menu-enter 0.2s var(--ease-snappy) forwards' }}
        >
          {(['LOW', 'MEDIUM', 'HIGH'] as const).map(level => (
            <button
              key={level}
              onClick={() => {
                onUpdateThinkingLevel(level);
                setIsOpen(false);
              }}
              role="menuitemradio"
              aria-checked={currentLevel === level}
              className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors duration-150 cursor-pointer ${
                currentLevel === level
                  ? 'bg-linear-surface-hover text-linear-text-primary'
                  : 'text-linear-text-secondary hover:bg-linear-surface hover:text-linear-text-primary'
              }`}
            >
              <span className="text-xs font-semibold">{LEVEL_LABELS[level]}</span>
              {currentLevel === level && (
                <svg
                  className="h-3.5 w-3.5 flex-shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ThinkingLevelSelector;
