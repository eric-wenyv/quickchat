import React, { useEffect, useState } from 'react';
import { invoke } from '@/services/bridge';

interface SyncInfo {
  enabled: boolean;
  running: boolean;
  port: number;
  token: string;
}

/**
 * 桌面端同步服务设置：移动端通过 局域网 IP:端口 + Token 连接本机，
 * 推送模型/Skills/对话历史并拉取桌面端对话历史。
 */
export const SyncServerSettings: React.FC = () => {
  const [info, setInfo] = useState<SyncInfo | null>(null);
  const [portDraft, setPortDraft] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    invoke<SyncInfo>('get_sync_info')
      .then((next) => {
        setInfo(next);
        setPortDraft(String(next.port));
      })
      .catch((e) => setError(String(e)));
  }, []);

  const applyConfig = async (enabled: boolean, port: number) => {
    setError(null);
    try {
      const next = await invoke<SyncInfo>('set_sync_config', { enabled, port });
      setInfo(next);
      setPortDraft(String(next.port));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const regenerateToken = async () => {
    setError(null);
    try {
      setInfo(await invoke<SyncInfo>('regenerate_sync_token'));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const copyToken = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默失败，Token 仍可直接选中复制
    }
  };

  return (
    <div className="rounded-lg border border-linear-border bg-linear-surface/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-linear-text-primary">设备同步</h3>
        </div>
        <button
          onClick={() => info && applyConfig(!info.enabled, Number(portDraft) || info.port)}
          disabled={!info}
          className={`relative w-10 h-5.5 rounded-full transition-colors cursor-pointer shrink-0 disabled:opacity-40 ${
            info?.enabled ? 'bg-linear-accent' : 'bg-linear-border'
          }`}
          style={{ height: 22 }}
          aria-label="启用同步服务"
        >
          <span
            className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-all ${
              info?.enabled ? 'left-[22px]' : 'left-0.5'
            }`}
            style={{ width: 18, height: 18 }}
          />
        </button>
      </div>

      {info && (
        <>
          <div className="flex items-center gap-2">
            <label className="text-xs text-linear-text-secondary shrink-0">端口</label>
            <input
              type="number"
              value={portDraft}
              onChange={(e) => setPortDraft(e.target.value)}
              onBlur={() => {
                const port = parseInt(portDraft, 10);
                if (Number.isFinite(port) && port > 0 && port < 65536 && port !== info.port) {
                  applyConfig(info.enabled, port);
                }
              }}
              className="w-24 bg-linear-bg text-linear-text-secondary text-xs px-2.5 py-1.5 rounded-lg border border-linear-border focus:border-linear-border-hover outline-none"
            />
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${
                info.running
                  ? 'bg-green-500/10 text-green-400'
                  : 'bg-linear-surface text-linear-text-tertiary'
              }`}
            >
              {info.running ? '运行中' : '已停止'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-linear-text-secondary shrink-0">Token</label>
            <code className="flex-1 min-w-0 truncate text-[11px] font-mono bg-linear-bg border border-linear-border rounded-lg px-2.5 py-1.5 text-linear-text-secondary select-all">
              {info.token}
            </code>
            <button
              onClick={copyToken}
              className="px-2.5 py-1.5 text-xs text-linear-text-secondary bg-linear-bg border border-linear-border hover:border-linear-border-hover rounded-lg transition-colors cursor-pointer"
            >
              {copied ? '已复制' : '复制'}
            </button>
            <button
              onClick={regenerateToken}
              className="px-2.5 py-1.5 text-xs text-linear-text-secondary bg-linear-bg border border-linear-border hover:border-linear-border-hover rounded-lg transition-colors cursor-pointer"
            >
              重置
            </button>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </>
      )}
    </div>
  );
};

export default SyncServerSettings;
