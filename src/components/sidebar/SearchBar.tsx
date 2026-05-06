import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useDebounce } from '@/hooks/useDebounce';

interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
}

/**
 * B-3: SearchBar
 * 搜索栏组件，支持防抖关键词上报。
 * 使用 input 元素实现清爽的单行搜索体验。
 */
const SearchBar: React.FC<SearchBarProps> = ({ onSearch, placeholder = '搜索对话...' }) => {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  const inputRef = useRef<HTMLInputElement>(null);

  // 稳定 onSearch 回调引用
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;

  useEffect(() => {
    onSearchRef.current(debouncedQuery);
  }, [debouncedQuery]);

  const handleClear = useCallback(() => {
    setQuery('');
    inputRef.current?.focus();
  }, []);

  return (
    <div className="px-3 py-4 bg-sand-200">
      <div className="relative">
        {/* 搜索图标 */}
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-100 pointer-events-none"
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
        </svg>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-sand-100 text-ink-300 text-sm placeholder:text-ink-100 pl-9 pr-8 py-2.5 rounded-xl border border-sand-400 focus:border-sand-500 focus:shadow-input-hover outline-none transition-all duration-200"
        />

        {/* 清除按钮 */}
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-ink-100 hover:text-ink-300 transition-colors cursor-pointer"
            aria-label="清除搜索"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};

export default SearchBar;
