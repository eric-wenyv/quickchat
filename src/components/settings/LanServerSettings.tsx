import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface ServerInfo {
  enabled: boolean;
  running: boolean;
  port: number;
  token: string;
  addresses: string[];
}

export const LanServerSettings: React.FC = () => {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [portInput, setPortInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await invoke<ServerInfo>('get_server_info');
      setInfo(next);
      setPortInput(String(next.port));
      setError(null);
    } catch (e) {
      setError(`读取服务器状态失败：${String(e)}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const apply = async (enabled: boolean, port: number) => {
    setBusy(true);
    setError(null);
    try {
      const next = await invoke<ServerInfo>('set_server_config', { enabled, port });
      setInfo(next);
      setPortInput(String(next.port));
    } catch (e) {
      setError(`保存失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const regenerateToken = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await invoke<ServerInfo>('regenerate_server_token');
      setInfo(next);
    } catch (e) {
      setError(`重置 Token 失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError('复制失败');
    }
  };

  const portValue = Number.parseInt(portInput, 10);
  const portValid = Number.isInteger(portValue) && portValue > 0 && portValue < 65536;

  return (
    <section className="rounded-lg border border-linear-border bg-linear-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-linear-text-primary">局域网服务</h3>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-bold ${
          info?.running ? 'bg-emerald-500/10 text-emerald-400' : 'bg-linear-surface-hover text-linear-text-tertiary'
        }`}>
          {info ? (info.running ? '运行中' : '已停止') : '加载中…'}
        </span>
      </div>

      {info && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void apply(!info.enabled, info.port)}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                info.enabled
                  ? 'border-red-500/30 text-red-400 hover:bg-red-500/10'
                  : 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10'
              }`}
            >
              {info.enabled ? '停止服务' : '启动服务'}
            </button>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={65535}
                value={portInput}
                onChange={e => setPortInput(e.target.value)}
                className="w-24 rounded-lg border border-linear-border bg-linear-bg px-3 py-2 font-mono text-xs text-linear-text-primary focus:outline-none focus-visible:border-linear-border-hover"
                aria-label="服务端口"
              />
              <button
                type="button"
                disabled={busy || !portValid || portValue === info.port}
                onClick={() => void apply(info.enabled, portValue)}
                className="rounded-lg border border-linear-border px-3 py-2 text-xs font-semibold text-linear-text-secondary transition-colors hover:bg-linear-surface-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              >
                应用端口
              </button>
            </div>
          </div>

          {info.running && (
            <>
              <div>
                <label className="block text-[11px] font-bold text-linear-text-secondary">Address</label>
                <div className="mt-1 space-y-1">
                  {info.addresses.length === 0 && (
                    <p className="text-xs text-linear-text-muted">未检测到局域网 IPv4 地址</p>
                  )}
                  {info.addresses.map(address => {
                    const url = `http://${address}:${info.port}`;
                    return (
                      <button
                        key={address}
                        type="button"
                        onClick={() => void copy(address, url)}
                        className="block w-full truncate rounded-md bg-linear-bg px-3 py-1.5 text-left font-mono text-xs text-linear-text-secondary transition-colors hover:bg-linear-surface-hover cursor-pointer"
                        title="点击复制"
                      >
                        {copied === address ? '已复制 ✓' : url}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-linear-text-secondary">Token</label>
                <div className="mt-1 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void copy('token', info.token)}
                    className="min-w-0 flex-1 truncate rounded-md bg-linear-bg px-3 py-1.5 text-left font-mono text-xs text-linear-text-secondary transition-colors hover:bg-linear-surface-hover cursor-pointer"
                    title="点击复制"
                  >
                    {copied === 'token' ? '已复制 ✓' : info.token}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void regenerateToken()}
                    className="shrink-0 rounded-lg border border-linear-border px-3 py-1.5 text-[11px] font-semibold text-linear-text-tertiary transition-colors hover:bg-linear-surface-hover hover:text-linear-text-secondary disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                  >
                    重置
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-400" role="alert">{error}</p>}
    </section>
  );
};

export default LanServerSettings;
