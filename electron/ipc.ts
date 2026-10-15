// =============================================================================
// Quick-Chat — Electron 主进程 IPC 分发层
// =============================================================================
// 前端统一经 preload 桥 `window.__QC_BRIDGE__.invoke(cmd, args)` 调用，
// 本模块按 cmd 路由到 handler 表。命令命名约定：
//   sql:*        SQLite
//   window:*     窗口控制
//   clipboard:*  剪贴板
//   opener:*     外部打开
//   shortcut:*   全局快捷键
//   fetch_url / search_web / parse_document / skills
// =============================================================================

import { BrowserWindow, clipboard, globalShortcut, ipcMain, shell } from "electron";

import { getDb, toLastInsertId } from "./db.js";
import { fetchUrl, parseDocument, searchWeb } from "./commands.js";
import * as skills from "./skills.js";

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

// send window qc:event:<name> 
export function sendEventTo(window: BrowserWindow | null, name: string, payload?: unknown): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(`qc:event:${name}`, payload);
  }
}

// ---------------------------------------------------------------------------
// SQLite
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
// Window control
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
// Clipborad
// ---------------------------------------------------------------------------
handle("clipboard:read-image", async () => {
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
// Global shortcut
// ---------------------------------------------------------------------------

handle("shortcut:register", (args, _event, getMainWindow) => {
  const accelerator = String(args?.accelerator ?? "");
  globalShortcut.unregister(accelerator);
  const ok = globalShortcut.register(accelerator, () => {
    sendEventTo(getMainWindow(), "shortcut-fired", { accelerator });
  });
  if (!ok) {
    throw new Error(`无法注册全局快捷键: ${accelerator}`);
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
// fetch_url / search_web / parse_document
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
// skills
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

// ---------------------------------------------------------------------------
// Register Entry
// ---------------------------------------------------------------------------

export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("qc:invoke", async (event, cmd: string, args: InvokeArgs) => {
    const fn = handlers.get(cmd);
    if (!fn) {
      throw new Error(`unknown command: ${cmd}`);
    }
    return fn(args, event, getMainWindow);
  });
}
