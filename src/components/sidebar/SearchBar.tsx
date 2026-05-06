import React, { useState, useEffect, useRef } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { useAutoResize } from '@/hooks/useAutoResize';

interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
}

const SearchBar: React.FC<SearchBarProps> = ({ onSearch, placeholder = '搜索对话...' }) => {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    onSearch(debouncedQuery);
  }, [debouncedQuery, onSearch]);

  useAutoResize(textareaRef, query, () => {
    onSearch(query);
  });

  return (
    <div className="px-3 py-4 bg-sand-200">
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          rows={1}
          className="w-full bg-sand-100 text-ink-300 text-sm placeholder:text-ink-100 px-4 py-2.5 rounded-xl border border-sand-400 focus:border-sand-500 focus:shadow-input-hover outline-none transition-all duration-200 resize-none overflow-hidden"
        />
      </div>
    </div>
  );
};

export default SearchBar;
