import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useDebounce } from '@/hooks/useDebounce';

interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
}

/**
 * B-3: SearchBar (Linear-style)
 * 隐形搜索栏：仅保留图标和文字，Hover 时才显示极淡背景框。
 */
const SearchBar: React.FC<SearchBarProps> = ({ onSearch, placeholder = '搜索' }) => {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const debouncedQuery = useDebounce(query, 300);
  const inputRef = useRef<HTMLInputElement>(null);

  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;

  useEffect(() => {
    onSearchRef.current(debouncedQuery);
  }, [debouncedQuery]);

  const handleClear = useCallback(() => {
    setQuery('');
    inputRef.current?.focus();
  }, []);

  const showBg = isFocused || query.length > 0;

  return (
    <div className="relative">
      {/* 搜索图标 */}
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 text-linear-text-tertiary pointer-events-none"
        width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
      </svg>

      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={placeholder}
        className={`
          w-full text-[15px] font-semibold placeholder:text-linear-text-secondary text-linear-text-body pl-9 pr-8 py-1.5 rounded-md outline-none transition-all duration-200 whitespace-nowrap
          ${showBg
            ? 'bg-linear-bg-elevated border-linear-border shadow-linear-highlight'
            : 'bg-transparent border border-transparent hover:bg-linear-bg-elevated hover:border-linear-border'
          }
        `}
      />

      {/* 清除按钮 */}
      {query && (
        <button
          onClick={handleClear}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-linear-text-tertiary hover:text-linear-text-secondary transition-colors cursor-pointer"
          aria-label="清除搜索"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default SearchBar;
