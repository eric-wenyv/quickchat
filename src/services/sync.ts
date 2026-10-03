// =============================================================================
// Quick-Chat — 设备间同步客户端（移动端 ↔ 桌面端 LAN 同步通道）
// =============================================================================
// 移动端持有桌面端的地址与 Token，数据方向：
//   • 推送：对话历史（移动端在外的新会话/消息）→ 桌面端
//   • 拉取：模型配置（含 API Key）+ 系统提示词 + Skills + 对话历史 ← 桌面端
// 合并策略 last-write-wins（按 updated_at），增量水位线按 桌面地址 对保存。
// 服务端原为 Rust 实现，Electron 迁移后在主进程重新实现（见 electron/sync-server.ts）；
// get_sync_info / set_sync_config / regenerate_sync_token
// 与 upsert_skill_from_sync 桥命令已就位。

import { invoke } from '@/services/bridge';
import {
  getConversationRowById,
  getConversationsUpdatedSince,
  getMessagesUpdatedSince,
  mergeSyncedConversations,
  mergeSyncedModels,
  mergeSyncedSystemPrompts,
  type SyncConversationRow,
  type SyncMessageRow,
  type SyncModelRow,
  type SyncSystemPromptRow,
} from './db';

export interface SyncClientConfig {
  host: string;
  port: number;
  token: string;
}

const SYNC_CONFIG_KEY = 'quick_chat_sync_client';
const SYNC_LAST_KEY_PREFIX = 'quick_chat_sync_last_';
const REQUEST_TIMEOUT_MS = 60_000;

export function loadSyncClientConfig(): SyncClientConfig {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        host: String(parsed.host ?? ''),
        port: Number(parsed.port ?? 8975),
        token: String(parsed.token ?? ''),
      };
    }
  } catch {
    // fallthrough
  }
  return { host: '', port: 8975, token: '' };
}

export function saveSyncClientConfig(config: SyncClientConfig): void {
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
}

function lastSyncKey(config: SyncClientConfig): string {
  return `${SYNC_LAST_KEY_PREFIX}${config.host}:${config.port}`;
}

export function getLastSyncAt(config: SyncClientConfig): number | null {
  const raw = localStorage.getItem(lastSyncKey(config));
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function setLastSyncAt(config: SyncClientConfig, at: number): void {
  localStorage.setItem(lastSyncKey(config), String(at));
}

function syncBaseUrl(config: SyncClientConfig): string {
  return `http://${config.host.trim()}:${config.port}/api/sync`;
}

async function syncFetch(
  config: SyncClientConfig,
  path: string,
  init?: RequestInit
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${syncBaseUrl(config)}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch {
        // keep default
      }
      throw new Error(message);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function testSyncConnection(config: SyncClientConfig): Promise<void> {
  if (!config.host.trim()) throw new Error('请先填写桌面端 IP 地址');
  await syncFetch(config, '/health');
}

export interface SyncRunResult {
  pushedConversations: number;
  pushedMessages: number;
  pulledModels: number;
  pulledPrompts: number;
  pulledSkills: number;
  pulledConversations: number;
  pulledMessages: number;
}

interface SyncPushResponse {
  ok: boolean;
  stats: {
    conversations: number;
    messages: number;
    skipped: number;
  };
}

interface SyncExportResponse {
  generated_at: number;
  conversations?: SyncConversationRow[];
  messages?: SyncMessageRow[];
  models?: SyncModelRow[];
  system_prompts?: SyncSystemPromptRow[];
  skills?: Array<{ id: string; content: string }>;
}

/**
 * 执行一次完整同步：
 *   推送本机对话历史（增量）→ 拉取桌面端配置与对话历史（增量）→ 推进水位线。
 * 首次同步为全量。
 */
export async function runSync(config: SyncClientConfig): Promise<SyncRunResult> {
  if (!config.host.trim()) throw new Error('请先填写桌面端 IP 地址');
  if (!config.token.trim()) throw new Error('请先填写桌面端同步 Token');

  const watermark = getLastSyncAt(config) ?? 0;

  // ── 组装推送载荷：本机对话历史 ────────────────────────────────
  const conversations = await getConversationsUpdatedSince(watermark);
  const messages = await getMessagesUpdatedSince(watermark);

  // 消息有更新但其会话行未变化的：补充会话行，保证桌面端外键完整
  const convIds = new Set(conversations.map((c) => c.id));
  for (const msg of messages) {
    if (!convIds.has(msg.conversation_id)) {
      convIds.add(msg.conversation_id);
      const conv = await getConversationRowById(msg.conversation_id);
      if (conv) conversations.push(conv);
    }
  }

  // ── 推送 → 拉取 → 合并 ──────────────────────────────────────
  const pushRes = (await syncFetch(config, '/push', {
    method: 'POST',
    body: JSON.stringify({ conversations, messages }),
  })) as SyncPushResponse;

  const exportRes = (await syncFetch(config, `/export?since=${watermark}`)) as SyncExportResponse;

  // 模型 / 系统提示词 → SQLite（LWW）
  const modelsApplied = await mergeSyncedModels(exportRes.models ?? []);
  const promptsApplied = await mergeSyncedSystemPrompts(exportRes.system_prompts ?? []);

  // Skills → Rust 文件系统（SKILL.md 原样覆盖，附属文件暂不同步）
  let skillsApplied = 0;
  for (const skill of exportRes.skills ?? []) {
    try {
      await invoke('upsert_skill_from_sync', { id: skill.id, content: skill.content });
      skillsApplied++;
    } catch {
      // 单个 Skill 写入失败不阻塞整体同步
    }
  }

  const merged = await mergeSyncedConversations(
    exportRes.conversations ?? [],
    exportRes.messages ?? []
  );

  setLastSyncAt(config, Date.now());

  // 通知前端刷新内存状态（拉取的内容已直接写入本地，不刷新则要重启才能看到）
  window.dispatchEvent(new CustomEvent('quick-chat-sync-merged'));

  return {
    pushedConversations: pushRes.stats?.conversations ?? 0,
    pushedMessages: pushRes.stats?.messages ?? 0,
    pulledModels: modelsApplied.applied,
    pulledPrompts: promptsApplied.applied,
    pulledSkills: skillsApplied,
    pulledConversations: merged.conversations,
    pulledMessages: merged.messages,
  };
}
