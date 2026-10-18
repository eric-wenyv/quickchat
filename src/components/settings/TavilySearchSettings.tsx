import React, { useEffect, useState } from 'react';
import { getAppSetting, setAppSetting } from '@/services/db';

export const TAVILY_API_KEY_SETTING = 'tavily_api_key';

/**
 * 联网搜索（Tavily）配置：Key 存在 SQLite 的 app_settings 表，
 * 主进程执行 web_search 时从设置读取，不再依赖 .env。
 */
const TavilySearchSettings: React.FC = () => {
  const [apiKey, setApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [savedState, setSavedState] = useState<'idle' | 'saved' | 'cleared'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAppSetting(TAVILY_API_KEY_SETTING)
      .then((value) => {
        if (!cancelled) setApiKey(value ?? '');
      })
      .catch((e) => {
        if (!cancelled) setError(`读取失败：${String(e)}`);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    const next = apiKey.trim();
    setIsSaving(true);
    setError(null);
    setSavedState('idle');
    try {
      await setAppSetting(TAVILY_API_KEY_SETTING, next);
      setApiKey(next);
      setSavedState(next.length > 0 ? 'saved' : 'cleared');
    } catch (e) {
      setError(`保存失败：${String(e)}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-linear-text-primary">Tavily API Key</h3>
          <p
            className={`mt-0.5 h-4 truncate text-[11px] ${error ? 'text-red-400' : 'text-emerald-400'}`}
            title={error ?? undefined}
            aria-live="polite"
          >
            {error ?? (savedState === 'saved' ? '已保存' : savedState === 'cleared' ? '已清除' : '')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setSavedState('idle');
              setError(null);
            }}
            placeholder={isLoading ? '读取中…' : 'tvly-...'}
            disabled={isLoading || isSaving}
            autoComplete="off"
            spellCheck={false}
            className="h-10 w-80 rounded-lg border border-linear-border bg-linear-bg px-3 text-sm text-linear-text-secondary placeholder:text-linear-text-muted outline-none transition-all focus:border-linear-border-hover disabled:opacity-60"
          />
          <button
            type="button"
            onClick={save}
            disabled={isLoading || isSaving}
            className="h-10 cursor-pointer whitespace-nowrap rounded-lg bg-linear-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-linear-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default React.memo(TavilySearchSettings);
