// =============================================================================
// Quick-Chat — Electron 主进程 IPC 分发层
// =============================================================================
// 前端统一经 preload 桥 `window.__QC_BRIDGE__.invoke(cmd, args)` 调用，
// 本模块按 cmd 路由到 handler 表。命令命名约定：
//   db:*         SQLite 数据访问（语义命令，SQL 只在主进程，见 db-service.ts）
//   ai:*         AI 管线（对话流、标题、图片描述、思考档位，见 ai.ts / chat.ts）
//   window:*     窗口控制
//   clipboard:*  剪贴板
//   opener:*     外部打开
//   shortcut:*   全局快捷键
//   fetch_url / search_web / parse_document / skills
// =============================================================================

import { BrowserWindow, clipboard, globalShortcut, ipcMain, shell } from "electron";

import { fetchUrl, parseDocument, searchWeb } from "./commands.js";
import * as skills from "./skills.js";
import * as dbs from "./db-service.js";
import { describeImage, fetchModelThinkingEfforts, generateConversationTitle } from "./ai.js";
import { runChatLoop, type ChatLoopOutcome } from "./chat.js";

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
// SQLite（语义命令；SQL 集中在 db-service.ts，不再暴露裸 sql:*）
// ---------------------------------------------------------------------------

handle("db:init", () => { dbs.initDatabase(); return null; });
handle("db:maintenance", () => { dbs.runDatabaseMaintenance(); return null; });

handle("db:get_conversations", (args) => dbs.getConversations(Number(args?.limit ?? 100), Number(args?.offset ?? 0)));
handle("db:search_conversations", (args) => dbs.searchConversations(String(args?.query ?? ""), Number(args?.limit ?? 100), Number(args?.offset ?? 0)));
handle("db:get_conversation", (args) => dbs.getConversation(String(args?.id ?? "")));
handle("db:create_conversation", (args) => { dbs.createConversation(args?.conv as dbs.Conversation); return null; });
handle("db:update_conversation", (args) => { dbs.updateConversation(String(args?.id ?? ""), (args?.updates ?? {}) as never); return null; });
handle("db:delete_conversation", (args) => { dbs.deleteConversation(String(args?.id ?? "")); return null; });

handle("db:get_messages", (args) => dbs.getMessages(String(args?.conversationId ?? ""), Number(args?.limit ?? 200), (args?.beforeTimestamp ?? null) as number | null));
handle("db:save_message", (args) => { dbs.saveMessage(args?.msg as dbs.Message); return null; });
handle("db:update_message", (args) => { dbs.updateMessage(String(args?.id ?? ""), (args?.updates ?? {}) as never); return null; });
handle("db:delete_message", (args) => { dbs.deleteMessage(String(args?.id ?? "")); return null; });
handle("db:search_messages", (args) => dbs.searchMessages(String(args?.query ?? ""), (args?.conversationId ?? null) as string | null, Number(args?.limit ?? 50), Number(args?.offset ?? 0)));

handle("db:get_model_configs", () => dbs.getModelConfigs());
handle("db:save_model_config", (args) => { dbs.saveModelConfig(args?.config as dbs.ModelConfig); return null; });
handle("db:update_model_config", (args) => { dbs.updateModelConfig(String(args?.id ?? ""), (args?.updates ?? {}) as never); return null; });
handle("db:delete_model_config", (args) => { dbs.deleteModelConfig(String(args?.id ?? "")); return null; });

handle("db:get_system_prompts", () => dbs.getSystemPrompts());
handle("db:save_system_prompt", (args) => { dbs.saveSystemPrompt(args?.prompt as dbs.SystemPrompt); return null; });
handle("db:delete_system_prompt", (args) => { dbs.deleteSystemPrompt(String(args?.id ?? "")); return null; });

handle("db:get_thinking_efforts_cache", () => dbs.getThinkingEffortsCache());
handle("db:save_thinking_efforts_cache", (args) => { dbs.saveThinkingEffortsCache(String(args?.modelKey ?? ""), args?.efforts as dbs.ThinkingEfforts); return null; });

handle("db:get_mermaid_svg", (args) => dbs.getMermaidSvgCache(String(args?.cacheKey ?? "")));
handle("db:set_mermaid_svg", (args) => { dbs.setMermaidSvgCache(String(args?.cacheKey ?? ""), String(args?.svg ?? "")); return null; });

// ---------------------------------------------------------------------------
// AI 管线（流式对话经 qc:event:ai:stream 推送增量，invoke 返回最终结果）
// ---------------------------------------------------------------------------

const chatAbortControllers = new Map<string, AbortController>();

handle("ai:chat", async (args, event, getMainWindow) => {
  const requestId = String(args?.requestId ?? "");
  const win = targetWindow(event, getMainWindow);
  const abortController = new AbortController();
  chatAbortControllers.set(requestId, abortController);
  try {
    const outcome: ChatLoopOutcome = await runChatLoop(
      {
        model: args?.model as never,
        messages: (args?.messages ?? []) as never,
        thinkingLevel: (args?.thinkingLevel ?? null) as string | null,
        signal: abortController.signal,
      },
      (streamEvent) => {
        sendEventTo(win, "ai:stream", { requestId, ...streamEvent });
      },
    );
    return outcome;
  } finally {
    chatAbortControllers.delete(requestId);
  }
});

handle("ai:abort", (args) => {
  chatAbortControllers.get(String(args?.requestId ?? ""))?.abort();
  return null;
});

handle("ai:generate_title", (args) => {
  return generateConversationTitle((args?.messages ?? []) as never, args?.model as never);
});

handle("ai:describe_image", (args) => {
  return describeImage(String(args?.imageDataUrl ?? ""), args?.model as never);
});

handle("ai:thinking_efforts", (args) => {
  return fetchModelThinkingEfforts(args?.model as never);
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
