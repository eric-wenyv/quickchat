import React, { useState, useRef, useEffect } from 'react';

interface ThinkingLevelSelectorProps {
  /** 模型支持的思考强度档位（来自 OpenRouter 元数据 / Gemini 固定三档）；null 或空数组时整个组件隐藏 */
  efforts: string[] | null;
  /** 当前选中的档位（per-conversation）；null 表示未选择，使用模型默认档位 */
  thinkingLevel: string | null;
  /** 模型默认档位（未选择时实际生效的值，用于提示） */
  defaultEffort?: string | null;
  onUpdateThinkingLevel: (level: string | null) => void;
}

/** 常见档位的显示文案；未收录的档位原样展示 */
const EFFORT_LABELS: Record<string, string> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
  low: '低',
  medium: '中',
  high: '高',
  max: '最大',
  xhigh: '超高',
  minimal: '极低',
};

function effortLabel(effort: string): string {
  return EFFORT_LABELS[effort] ?? effort;
}

/**
 * ThinkingLevelSelector
 * 思考强度选择器，位于模型选择器右侧。档位列表由调用方按模型提供
 * （OpenRouter 官方元数据，本地持久化缓存）；不支持的模型直接隐藏。
 * 不提供"关闭思考"选项。
 */
const ThinkingLevelSelector: React.FC<ThinkingLevelSelectorProps> = ({
  efforts,
  thinkingLevel,
  defaultEffort,
  onUpdateThinkingLevel,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  if (!efforts || efforts.length === 0) return null;

  const currentLabel = thinkingLevel ? effortLabel(thinkingLevel) : '默认';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={thinkingLevel ? '思考强度' : `思考强度（默认: ${defaultEffort ? effortLabel(defaultEffort) : '模型默认'}）`}
        className={`group flex h-8 items-center gap-1.5 rounded-full px-3 text-[14px] font-semibold cursor-pointer outline-none transition-colors duration-150 ${isOpen
            ? 'bg-linear-surface-hover text-linear-text-primary'
            : 'bg-transparent text-linear-text-tertiary hover:bg-linear-surface-hover hover:text-linear-text-primary focus-visible:bg-linear-surface-hover focus-visible:text-linear-text-primary'
          }`}
      >
        <span className="max-w-[140px] truncate">思考: {currentLabel}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
      {isOpen && (
        <div
          data-focus-preserve="true"
          role="menu"
          className="absolute left-full ml-1 bottom-0 w-32 rounded-2xl border border-linear-border p-1.5 bg-[#2D2D2D] z-50 origin-bottom-left"
          style={{ animation: 'menu-enter 0.2s var(--ease-snappy) forwards' }}
        >
          <div className="max-h-60 overflow-y-auto custom-scrollbar space-y-1">
            {efforts.map((effort) => {
              const isActive = thinkingLevel === effort;
              return (
                <button
                  key={effort}
                  onClick={() => {
                    onUpdateThinkingLevel(effort);
                    setIsOpen(false);
                  }}
                  role="menuitemradio"
                  aria-checked={isActive}
                  className={`group w-full flex items-center justify-between gap-1.5 px-3 py-2.5 rounded-2xl text-left transition-colors cursor-pointer ${isActive
                      ? 'bg-linear-surface-hover text-linear-text-primary'
                      : 'text-linear-text-secondary hover:bg-linear-surface hover:text-linear-text-primary'
                    }`}
                >
                  <div className="flex flex-col gap-0.5 min-w-0 h-4">
                    <span className="text-sm font-semibold tracking-tight truncate">
                      {effortLabel(effort)}
                      {!thinkingLevel && defaultEffort === effort && (
                        <span className="ml-1 text-[10px] font-normal text-linear-text-muted">默认</span>
                      )}
                    </span>
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
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ThinkingLevelSelector;
