// =============================================================================
// Quick-Chat — Electron 主进程 IPC 分发层
// =============================================================================
// 前端统一经 preload 桥 `window.__QC_BRIDGE__.invoke(cmd, args)` 调用，
// 本模块按 cmd 路由到 handler 表。命令命名约定：
//   sql:*        SQLite 数据面（better-sqlite3，见 electron/db.ts 连接单例）
//   window:*     窗口控制（阶段 3 的自绘标题栏使用）
//   clipboard:*  剪贴板
//   opener:*     外部打开
//   shortcut:*   全局快捷键
//   fetch_url / search_web / parse_document / skills 系列 / sync 系列
//                逐条移植自旧 Rust 实现（见 electron/commands.ts、
//                electron/skills.ts、electron/sync-server.ts）。
// stream_http_sse / cancel_http_stream 不注册：Electron 下前端永远走
// Chromium fetch 流。
// =============================================================================

import { BrowserWindow, clipboard, globalShortcut, ipcMain, shell } from "electron";

import { getDb, toLastInsertId } from "./db.js";
import { fetchUrl, parseDocument, searchWeb } from "./commands.js";
import * as skills from "./skills.js";
import type { SyncServer } from "./sync-server.js";

type InvokeArgs = Record<string, unknown> | undefined;

type InvokeHandler = (
  args: InvokeArgs,
  event: Electron.IpcMainInvokeEvent,
  getMainWindow: () => BrowserWindow | null,
) => unknown;

const handlers = new Map<string, InvokeHandler>();

function handle(cmd: string, fn: InvokeHandler): void {
  handlers.set(cmd, fn);
}

/** 向窗口推送 qc:event:<name> 事件（preload 的 onEvent 按同名通道订阅） */
export function sendEventTo(window: BrowserWindow | null, name: string, payload?: unknown): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(`qc:event:${name}`, payload);
  }
}

// ---------------------------------------------------------------------------
// SQLite 数据面（与旧版 SQL 插件行为对齐）
// ---------------------------------------------------------------------------

function readParams(args: InvokeArgs): unknown[] {
  return Array.isArray(args?.params) ? (args.params as unknown[]) : [];
}

handle("sql:execute", (args) => {
  const sql = String(args?.sql ?? "");
  const params = readParams(args);
  const database = getDb();
  try {
    const result = database.prepare(sql).run(...params);
    return { rowsAffected: result.changes, lastInsertId: toLastInsertId(result.lastInsertRowid) };
  } catch (error) {
    // better-sqlite3 不允许一条 SQL 内含多个语句（db.ts 的 FTS 触发器块即如此），
    // 无参时退回 exec 顺序执行；旧版 SQL 插件对多语句也是整串执行。
    if (params.length === 0 && error instanceof Error && /one statement/i.test(error.message)) {
      database.exec(sql);
      return { rowsAffected: 0, lastInsertId: 0 };
    }
    throw error;
  }
});

handle("sql:select", (args) => {
  const sql = String(args?.sql ?? "");
  const params = readParams(args);
  return getDb().prepare(sql).all(...params);
});

// ---------------------------------------------------------------------------
// 窗口控制（阶段 3 的 UI 直接复用）
// ---------------------------------------------------------------------------

function targetWindow(event: Electron.IpcMainInvokeEvent, getMainWindow: () => BrowserWindow | null): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender) ?? getMainWindow();
}

handle("window:minimize", (_args, event, getMainWindow) => {
  targetWindow(event, getMainWindow)?.minimize();
  return null;
});

handle("window:maximize", (_args, event, getMainWindow) => {
  targetWindow(event, getMainWindow)?.maximize();
  return null;
});

handle("window:unmaximize", (_args, event, getMainWindow) => {
  targetWindow(event, getMainWindow)?.unmaximize();
  return null;
});

handle("window:toggle-maximize", (_args, event, getMainWindow) => {
  const win = targetWindow(event, getMainWindow);
  if (win) {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
  return null;
});

handle("window:close", (_args, event, getMainWindow) => {
  targetWindow(event, getMainWindow)?.close();
  return null;
});

handle("window:hide", (_args, event, getMainWindow) => {
  targetWindow(event, getMainWindow)?.hide();
  return null;
});

handle("window:show", (_args, event, getMainWindow) => {
  const win = targetWindow(event, getMainWindow);
  if (win) {
    // 覆盖最小化恢复 + 显示 + 聚焦（旧版 toggle 链路的 show/unminimize/setFocus）
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  return null;
});

handle("window:focus", (_args, event, getMainWindow) => {
  targetWindow(event, getMainWindow)?.focus();
  return null;
});

handle("window:is-maximized", (_args, event, getMainWindow) => {
  return targetWindow(event, getMainWindow)?.isMaximized() ?? false;
});

handle("window:is-visible", (_args, event, getMainWindow) => {
  return targetWindow(event, getMainWindow)?.isVisible() ?? false;
});

// ---------------------------------------------------------------------------
// 剪贴板 / 外部打开
// ---------------------------------------------------------------------------

/** 剪贴板不含图片时返回 null，否则返回 PNG 的 base64（前端自行拼 data URL） */
handle("clipboard:read-image", async () => {
  // Electron 44 起剪贴板为 W3C 风格异步 API（clipboard.read + ClipboardItem）
  const items = await clipboard.read();
  for (const item of items) {
    const imageType = item.types.find((t) => t.startsWith("image/"));
    if (!imageType) continue;
    const blob = (await item.getType(imageType)) as Blob;
    const buffer = Buffer.from(await blob.arrayBuffer());
    return buffer.toString("base64");
  }
  return null;
});

handle("opener:open", (args) => {
  return shell.openExternal(String(args?.url ?? ""));
});

handle("opener:open-path", (args) => {
  return shell.openPath(String(args?.path ?? ""));
});

// ---------------------------------------------------------------------------
// 全局快捷键：注册后触发时向主窗口转发 shortcut-fired 事件
// ---------------------------------------------------------------------------

handle("shortcut:register", (args, _event, getMainWindow) => {
  const accelerator = String(args?.accelerator ?? "");
  // 重复注册同一快捷键前先注销，保证幂等
  globalShortcut.unregister(accelerator);
  const ok = globalShortcut.register(accelerator, () => {
    sendEventTo(getMainWindow(), "shortcut-fired", { accelerator });
  });
  if (!ok) {
    throw new Error(`无法注册全局快捷键: ${accelerator}（可能被系统占用或格式非法）`);
  }
  return null;
});

handle("shortcut:unregister", (args) => {
  globalShortcut.unregister(String(args?.accelerator ?? ""));
  return null;
});

handle("shortcut:unregister-all", () => {
  globalShortcut.unregisterAll();
  return null;
});

// ---------------------------------------------------------------------------
// fetch_url / search_web / parse_document（移植自旧 Rust 主程序）
// ---------------------------------------------------------------------------

handle("fetch_url", (args) => {
  return fetchUrl(String(args?.url ?? ""));
});

handle("search_web", (args) => {
  return searchWeb(String(args?.query ?? ""));
});

handle("parse_document", (args) => {
  return parseDocument(String(args?.data ?? ""), String(args?.ext ?? ""));
});

// ---------------------------------------------------------------------------
// skills 系列（移植自旧 Rust skills 模块）
// ---------------------------------------------------------------------------

handle("list_skills", () => {
  return skills.listSkills();
});

handle("read_skill", (args) => {
  return skills.readSkill(String(args?.id ?? ""));
});

handle("create_skill", (args) => {
  return skills.createSkill(
    String(args?.name ?? ""),
    String(args?.description ?? ""),
    String(args?.content ?? ""),
    Boolean(args?.disableModelInvocation),
  );
});

handle("delete_skill", (args) => {
  return skills.deleteSkill(String(args?.id ?? ""));
});

handle("import_external_skills", () => {
  return skills.importExternalSkills();
});

handle("ensure_builtin_skill", () => {
  return skills.ensureBuiltinSkill();
});

handle("upsert_skill_from_sync", (args) => {
  return skills.upsertSkillFromSync(String(args?.id ?? ""), String(args?.content ?? ""));
});

// ---------------------------------------------------------------------------
// 注册入口（main.ts 在 app ready 后调用；sync 命令由 main.ts 注入实例）
// ---------------------------------------------------------------------------

export interface IpcDeps {
  sync: SyncServer;
}

export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null, deps: IpcDeps): void {
  handle("get_sync_info", () => {
    return deps.sync.info();
  });

  handle("set_sync_config", (args) => {
    return deps.sync.setConfig(Boolean(args?.enabled), Number(args?.port));
  });

  handle("regenerate_sync_token", () => {
    return deps.sync.regenerateToken();
  });

  ipcMain.handle("qc:invoke", async (event, cmd: string, args: InvokeArgs) => {
    const fn = handlers.get(cmd);
    if (!fn) {
      throw new Error(`unknown command: ${cmd}`);
    }
    // Electron 经结构化克隆序列化错误，前端 reject 拿到同 message 的 Error
    return fn(args, event, getMainWindow);
  });
}
