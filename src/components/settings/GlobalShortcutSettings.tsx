import React, { useEffect, useState } from 'react';
import { DEFAULT_GLOBAL_SHORTCUT, isReservedGlobalShortcut } from '@/services/globalShortcut';
import { isMacPlatform } from '@/utils/platform';

interface GlobalShortcutSettingsProps {
  value: string | null;
  /** 启动时注册失败信息（null = 正常），以黄色警告展示 */
  startupError: string | null;
  onChange: (shortcut: string | null) => Promise<void>;
}

const shortcutKeyFromEvent = (event: React.KeyboardEvent<HTMLButtonElement>): string | null => {
  if (event.key === ' ') return 'Space';
  if (/^[a-z0-9]$/i.test(event.key)) return event.key.toUpperCase();
  if (/^F(?:[1-9]|1[0-2])$/i.test(event.key)) return event.key.toUpperCase();
  return null;
};

// 行式布局：左侧标题/描述 + 状态徽标，右侧录入与操作按钮，
// 整页设置与独立设置窗口共用
export const GlobalShortcutSettings: React.FC<GlobalShortcutSettingsProps> = ({ value, startupError, onChange }) => {
  const [shortcut, setShortcut] = useState(value);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setShortcut(value), [value]);

  const captureShortcut = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!isCapturing) return;
    event.preventDefault();
    event.stopPropagation();

    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;

    const key = shortcutKeyFromEvent(event);
    if (!key) {
      setError('请使用字母、数字、F1–F12 或空格键。');
      return;
    }

    const modifiers = [
      event.ctrlKey && 'Ctrl',
      event.altKey && 'Alt',
      event.shiftKey && 'Shift',
      event.metaKey && 'Super',
    ].filter(Boolean);

    if (modifiers.length === 0) {
      setError('快捷键必须包含 Ctrl、Alt、Shift 或 Super。');
      return;
    }

    const nextShortcut = [...modifiers, key].join('+');
    if (isReservedGlobalShortcut(nextShortcut, isMacPlatform)) {
      setError('该组合键已用于应用内操作，请选择其他快捷键。');
      return;
    }

    setShortcut(nextShortcut);
    setError(null);
    setIsCapturing(false);
  };

  const saveShortcut = async (nextShortcut: string | null) => {
    setIsSaving(true);
    setError(null);
    try {
      await onChange(nextShortcut);
      setShortcut(nextShortcut);
    } catch (saveError) {
      setError(`无法注册此快捷键：${String(saveError)}`);
    } finally {
      setIsSaving(false);
      setIsCapturing(false);
    }
  };

  const statusBadge = (
    <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold ${
      startupError && shortcut
        ? 'bg-amber-500/10 text-amber-400'
        : shortcut
          ? 'bg-emerald-500/10 text-emerald-400'
          : 'bg-linear-surface-hover text-linear-text-tertiary'
    }`}>
      {startupError && shortcut ? '注册失败' : shortcut ? '已启用' : '已禁用'}
    </span>
  );

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-linear-text-primary">快速打开</h3>
          {statusBadge}
        </div>
        {startupError && shortcut && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-400" role="alert" title={startupError}>
            <span aria-hidden="true" className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-bold">!</span>
            启动时注册失败，快捷键当前不可用（可能被其他应用占用）。重新保存即可重试。
          </p>
        )}
        {error && <p className="mt-1.5 text-xs text-red-400" role="alert">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setIsCapturing(true);
            setError(null);
          }}
          onKeyDown={captureShortcut}
          className={`min-w-40 rounded-lg border px-3 py-2 text-left font-mono text-sm transition-colors cursor-pointer focus:outline-none focus-visible:border-linear-border-hover ${
            isCapturing
              ? 'border-linear-border-hover bg-linear-surface-hover text-linear-text-primary'
              : 'border-linear-border bg-linear-bg text-linear-text-secondary hover:bg-linear-surface-hover'
          }`}
          aria-label="录入快速打开快捷键"
        >
          {isCapturing ? '按下新的组合键…' : shortcut ?? '未设置'}
        </button>
        <button
          type="button"
          disabled={isSaving || !shortcut || isCapturing}
          onClick={() => void saveShortcut(shortcut)}
          className="rounded-lg border border-linear-border px-3 py-2 text-xs font-semibold text-linear-text-secondary transition-colors hover:bg-linear-surface-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          {isSaving ? '保存中…' : '保存'}
        </button>
        <button
          type="button"
          disabled={isSaving}
          onClick={() => void saveShortcut(null)}
          className="rounded-lg px-3 py-2 text-xs font-semibold text-linear-text-tertiary transition-colors hover:bg-linear-surface-hover hover:text-linear-text-secondary disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          禁用
        </button>
        <button
          type="button"
          disabled={isSaving}
          onClick={() => void saveShortcut(DEFAULT_GLOBAL_SHORTCUT)}
          className="rounded-lg px-3 py-2 text-xs font-semibold text-linear-text-tertiary transition-colors hover:bg-linear-surface-hover hover:text-linear-text-secondary disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          恢复默认
        </button>
      </div>
    </div>
  );
};

export default React.memo(GlobalShortcutSettings);
