import React, { useState, useRef, useEffect, useMemo } from "react";
import type { ModelConfig, UUID } from "@/types/types";
import { useAutoResize } from "@/hooks/useAutoResize";

interface ModelSelectorProps {
  models: ModelConfig[];
  activeModelId: UUID;
  onSelect: (id: UUID) => void;
}

/**
 * ModelSelector
 * 模型选择下拉菜单，展示当前模型名称，点击切换
 */
const ModelSelector: React.FC<ModelSelectorProps> = ({
  models,
  activeModelId,
  onSelect,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeModel = useMemo(
    () => models.find((m) => m.id === activeModelId) || models[0],
    [models, activeModelId],
  );

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return models;
    const lowerQuery = searchQuery.toLowerCase();
    return models.filter(
      (m) =>
        m.display_name.toLowerCase().includes(lowerQuery) ||
        m.model_id.toLowerCase().includes(lowerQuery),
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
      setSearchQuery("");
    }
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
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
        className={`group flex h-8 items-center gap-1.5 rounded-full px-3 text-[14px] font-semibold cursor-pointer outline-none transition-colors duration-150 ${isOpen
            ? "bg-linear-surface-hover text-linear-text-primary"
            : "bg-transparent text-linear-text-tertiary hover:bg-linear-surface-hover hover:text-linear-text-primary focus-visible:bg-linear-surface-hover focus-visible:text-linear-text-primary"
          }`}
      >
        <span className="max-w-[140px] truncate">
          {activeModel?.display_name || "Select Model"}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`w-4 h-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
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
          className="absolute left-full ml-1 bottom-0 w-40 rounded-2xl border border-linear-border p-1.5 bg-[#2D2D2D] z-50 origin-bottom-left"
          style={{ animation: "menu-enter 0.2s var(--ease-snappy) forwards" }}
        >
          <div className="max-h-60 overflow-y-auto custom-scrollbar space-y-1">
            {filteredModels.length > 0 ? (
              filteredModels.map((model) => {
                const isActive = model.id === activeModelId;
                return (
                  <button
                    key={model.id}
                    onClick={() => {
                      onSelect(model.id);
                      setIsOpen(false);
                      setSearchQuery("");
                    }}
                    role="menuitemradio"
                    aria-checked={isActive}
                    className={`group w-full flex items-center justify-between gap-1.5 px-3 py-2.5 rounded-2xl text-left transition-colors cursor-pointer ${isActive
                        ? "bg-linear-surface-hover text-linear-text-primary"
                        : "text-linear-text-secondary hover:bg-linear-surface hover:text-linear-text-primary"
                      }`}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0 h-4">
                      <span className="text-sm font-semibold tracking-tight truncate">
                        {model.display_name}
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
              })
            ) : (
              <div className="px-4 py-8 text-center text-linear-text-muted text-xs italic">
                No models found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelSelector;
