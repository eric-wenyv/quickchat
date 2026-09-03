import React, { useState } from 'react';
import {
  getLastSyncAt,
  loadSyncClientConfig,
  runSync,
  saveSyncClientConfig,
  testSyncConnection,
  type SyncClientConfig,
  type SyncRunResult,
} from '@/services/sync';

/**
 * 移动端同步客户端设置：配置桌面端 IP / 端口 / Token。
 * 推送：模型、Skills、系统提示词与对话历史 → 桌面端；拉取：桌面端对话历史 → 本地。
 */
export const SyncClientSettings: React.FC = () => {
  const [config, setConfig] = useState<SyncClientConfig>(() => loadSyncClientConfig());
  const [busy, setBusy] = useState<'test' | 'sync' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncRunResult | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(() => getLastSyncAt(loadSyncClientConfig()));

  const update = (patch: Partial<SyncClientConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
    setError(null);
  };

  const handleTest = async () => {
    setBusy('test');
    setError(null);
    try {
      saveSyncClientConfig(config);
      await testSyncConnection(config);
      setError(null);
      setResult(null);
      window.alert('连接成功');
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleSync = async () => {
    setBusy('sync');
    setError(null);
    setResult(null);
    try {
      saveSyncClientConfig(config);
      const res = await runSync(config);
      setResult(res);
      setLastSyncAt(getLastSyncAt(config));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const inputClass =
    'w-full bg-linear-bg text-linear-text-secondary text-sm px-3 py-2 rounded-lg border border-linear-border focus:border-linear-border-hover outline-none';

  return (
    <div className="rounded-lg border border-linear-border bg-linear-surface/60 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-linear-text-primary">设备同步</h3>
        <p className="text-[11px] text-linear-text-tertiary mt-0.5">
          连接同一局域网内的桌面端：推送本机对话历史，并拉取桌面端的模型配置 / Skills 与对话历史
        </p>
      </div>

      <div className="flex gap-2">
        <div className="flex-[2] min-w-0">
          <label className="block text-[11px] text-linear-text-tertiary mb-1">桌面端 IP 地址</label>
          <input
            type="text"
            value={config.host}
            onChange={(e) => update({ host: e.target.value })}
            placeholder="例如 192.168.1.10"
            className={inputClass}
            inputMode="text"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <div className="w-24 shrink-0">
          <label className="block text-[11px] text-linear-text-tertiary mb-1">端口</label>
          <input
            type="number"
            value={config.port}
            onChange={(e) => update({ port: parseInt(e.target.value, 10) || 0 })}
            className={inputClass}
            inputMode="numeric"
          />
        </div>
      </div>

      <div>
        <label className="block text-[11px] text-linear-text-tertiary mb-1">同步 Token（桌面端设置中查看）</label>
        <input
          type="text"
          value={config.token}
          onChange={(e) => update({ token: e.target.value.trim() })}
          className={`${inputClass} font-mono text-xs`}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleTest}
          disabled={busy !== null}
          className="px-4 py-2 text-sm text-linear-text-secondary bg-linear-bg border border-linear-border hover:border-linear-border-hover disabled:opacity-40 rounded-lg transition-colors cursor-pointer"
        >
          {busy === 'test' ? '测试中...' : '测试连接'}
        </button>
        <button
          onClick={handleSync}
          disabled={busy !== null}
          className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-linear-accent hover:bg-linear-accent-hover disabled:opacity-40 rounded-lg transition-colors cursor-pointer"
        >
          {busy === 'sync' ? '同步中...' : '立即同步'}
        </button>
      </div>

      {lastSyncAt && (
        <p className="text-[11px] text-linear-text-tertiary">
          上次同步：{new Date(lastSyncAt).toLocaleString()}
        </p>
      )}

      {result && (
        <div className="text-xs text-linear-text-secondary bg-linear-bg border border-linear-border rounded-lg px-3 py-2 space-y-0.5">
          <p>已推送：会话 {result.pushedConversations} · 消息 {result.pushedMessages}</p>
          <p>已拉取：模型 {result.pulledModels} · 提示词 {result.pulledPrompts} · Skill {result.pulledSkills} · 会话 {result.pulledConversations} · 消息 {result.pulledMessages}</p>
        </div>
      )}

      {error && <p className="text-xs text-red-400 break-all">{error}</p>}
    </div>
  );
};

export default SyncClientSettings;
