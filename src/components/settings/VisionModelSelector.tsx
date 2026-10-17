import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelConfig } from '@/types/types';

interface VisionModelSelectorProps {
  models: ModelConfig[];
  value: string | null;
  onChange: (id: string | null) => void;
}

export const VisionModelSelector: React.FC<VisionModelSelectorProps> = ({
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
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-semibold tracking-tight">
              {selectedModel?.display_name ?? '自动选择 Vision 模型'}
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

export default React.memo(VisionModelSelector);
