import { app, BrowserWindow, globalShortcut, net, protocol } from "electron";
import netSocket from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerIpcHandlers, sendEventTo } from "./ipc.js";
import { setUserDataDir, getDb } from "./db.js";
import { setupTray } from "./tray.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.join(__dirname, "preload.cjs");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

let mainWindow: BrowserWindow | null = null;

function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

// close -> hide windows, app quits only when quit on tray
let isQuitting = false;

// Single Instance App
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.exit(0);
} else if (process.argv.includes("--toggle")) {
  app.exit(0);
} else {
  app.on("second-instance", (_event, argv) => {
    const win = getMainWindow();
    if (!win) {
      return;
    }
    if (argv.includes("--toggle")) {
      toggleMainWindow(win);
    } else {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

function toggleMainWindow(win: BrowserWindow): void {
  if (win.isVisible()) {
    if (win.isFocused()) {
      win.hide();
    } else {
      win.focus();
    }
  } else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

// Ctrl + Shift + S / N register only when window focused
function registerFixedShortcuts(): void {
  const modifier = process.platform === "darwin" ? "Command+Shift" : "Ctrl+Shift";
  const registrations: Array<{ accelerator: string; event: string }> = [
    { accelerator: `${modifier}+S`, event: "shortcut-toggle-sidebar" },
    { accelerator: `${modifier}+N`, event: "shortcut-new-conversation" },
  ];
  for (const { accelerator, event } of registrations) {
    const ok = globalShortcut.register(accelerator, () => {
      const win = getMainWindow();
      if (!win || !win.isFocused()) {
        return;
      }
      sendEventTo(win, event);
    });
    if (!ok) {
      console.error(`[quick-chat] 注册固定快捷键失败: ${accelerator}`);
    }
  }
}

const DEFAULT_DEV_SERVER_URL = "http://localhost:1420";

function isPortReachable(port: number, host = "127.0.0.1", timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new netSocket.Socket();
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

async function resolveLoadTarget(): Promise<{ url?: string }> {
  // 1. env set DEV SERVER
  const envUrl = process.env.VITE_DEV_SERVER_URL;
  if (envUrl) {
    return { url: envUrl };
  }
  // 2. default DEV SERVER
  if (!app.isPackaged && process.env.NODE_ENV !== "production") {
    const { port, hostname } = new URL(DEFAULT_DEV_SERVER_URL);
    if (await isPortReachable(Number(port), hostname)) {
      return { url: DEFAULT_DEV_SERVER_URL };
    }
  }
  // 3. static html
  return { url: "app://./index.html" };
}

async function createWindow(): Promise<void> {
  const isWindows = process.platform === "win32";
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    frame: false,
    show: false,
    transparent: isWindows,
    backgroundColor: isWindows ? "#00000000" : "#1e1e1e",
    ...(isWindows ? { backgroundMaterial: "acrylic" as const } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  // close -> hide windows, app quits only when quit on tray
  win.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    win.hide();
  });

  // send notification to renderer
  const notifyResized = () => {
    sendEventTo(win, "window:resized", { isMaximized: win.isMaximized() });
  };
  win.on("resize", notifyResized);
  win.on("maximize", notifyResized);
  win.on("unmaximize", notifyResized);
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  mainWindow = win;

  const target = await resolveLoadTarget();
  await win.loadURL(target.url!);
}

// app://./<path> → dist/<path>
function registerAppProtocol(): void {
  const distDir = path.join(__dirname, "../dist");
  protocol.handle("app", (request) => {
    const { pathname } = new URL(request.url);
    const filePath = path.normalize(path.join(distDir, pathname));
    if (!filePath.startsWith(distDir)) {
      return new Response("forbidden", { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) {
    return;
  }
  registerAppProtocol();

  const userDataDir = app.getPath("userData");
  setUserDataDir(userDataDir);

  registerIpcHandlers(getMainWindow);

  setupTray({
    getMainWindow,
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
  });

  registerFixedShortcuts();

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
