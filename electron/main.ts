import { app, BrowserWindow, globalShortcut, net, protocol } from "electron";
import netSocket from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerIpcHandlers, sendEventTo } from "./ipc.js";
import { setUserDataDir, getDb } from "./db.js";
import { setupTray } from "./tray.js";

// ESM 主进程没有 __dirname，从 import.meta.url 推导（Electron >= 28 支持 ESM 主进程）。
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// preload 选择 CJS（preload.cts 编译为 preload.cjs）：
// CJS preload 在 sandbox 开启或关闭下都可加载，不依赖 Electron 对 ESM preload
// 的 ".mjs 扩展名 + sandbox: false" 限制；后续阶段需要更大 API 面时 sandbox 保持 false。
const preloadPath = path.join(__dirname, "preload.cjs");

// ── 自定义协议：生产模式用 app:// 加载打包产物（file:// 下 ES module 会被
//    Chromium 静默拦截；必须在 app ready 之前注册特权）──────────────────
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

// 主窗口引用：IPC handler（窗口控制/快捷键转发）与 resize 事件推送都指向它
let mainWindow: BrowserWindow | null = null;

function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

// 托盘「退出」/ app.quit() 置位：真正退出时不再拦截 close（见 close-to-tray）
let isQuitting = false;

// ── 单实例：第二个实例带 --toggle 时切换窗口显隐，否则显示并聚焦 ──────────
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // 注意不能用 app.quit()：ready 前调用不会阻止 whenReady() 链继续执行，
  // 第二实例会继续初始化并建窗。app.exit 立即终止。
  app.exit(0);
} else if (process.argv.includes("--toggle")) {
  // --toggle 仅用于唤起已在运行的实例（显隐切换）；进程未运行时直接退出，
  // 不创建窗口
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

/** 对齐 Rust toggle_main_window：可见+聚焦 → 隐藏；可见未聚焦 → 聚焦；不可见 → 显示 */
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

/** 固定全局快捷键：Ctrl+Shift+S 切换侧栏 / Ctrl+Shift+N 新建会话（mac 用 Command） */
function registerFixedShortcuts(): void {
  const modifier = process.platform === "darwin" ? "Command+Shift" : "Ctrl+Shift";
  const registrations: Array<{ accelerator: string; event: string }> = [
    { accelerator: `${modifier}+S`, event: "shortcut-toggle-sidebar" },
    { accelerator: `${modifier}+N`, event: "shortcut-new-conversation" },
  ];
  for (const { accelerator, event } of registrations) {
    const ok = globalShortcut.register(accelerator, () => {
      const win = getMainWindow();
      // 对齐 Rust：仅在主窗口聚焦时触发（避免后台窗口被全局按键穿透）
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
  // 1. 显式指定 dev server（dev:electron 脚本注入 VITE_DEV_SERVER_URL）。
  const envUrl = process.env.VITE_DEV_SERVER_URL;
  if (envUrl) {
    return { url: envUrl };
  }
  // 2. 非打包运行且未标记 production 时，探测 Vite dev 端口。
  if (!app.isPackaged && process.env.NODE_ENV !== "production") {
    const { port, hostname } = new URL(DEFAULT_DEV_SERVER_URL);
    if (await isPortReachable(Number(port), hostname)) {
      return { url: DEFAULT_DEV_SERVER_URL };
    }
  }
  // 3. 生产模式经自定义协议加载打包产物（见文件头 registerSchemesAsPrivileged）。
  return { url: "app://./index.html" };
}

async function createWindow(): Promise<void> {
  // Windows 用 acrylic 透明材质（对齐旧版桌面配置的 acrylic 特效）；Linux/macOS 保持不透明，
  // 透明窗在部分 Linux 合成器上有残留/穿透问题（旧版 Linux 配置同样置不透明）。
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

  // 避免 ready-to-show 之前白屏闪烁；窗口尺寸参考旧版桌面配置。
  win.once("ready-to-show", () => {
    win.show();
  });

  // ── close-to-tray：拦截关闭改为隐藏（托盘「退出」/ before-quit 除外）─────
  win.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    win.hide();
  });

  // 最大化状态变化推给渲染进程（自绘标题栏按钮状态，见 src/services/appWindow.ts）
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

/** app://./<path> → dist/<path>（net.fetch 按扩展名给出正确的 Content-Type） */
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
  // 双保险：单实例锁失败的分支已在上方 exit，这里防止任何路径漏进来
  if (!gotSingleInstanceLock) {
    return;
  }
  registerAppProtocol();

  const userDataDir = app.getPath("userData");
  setUserDataDir(userDataDir);

  registerIpcHandlers(getMainWindow);

  // 系统托盘（无 indicator 环境下降级为日志，不 crash）
  setupTray({
    getMainWindow,
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
  });

  // 固定全局快捷键（Ctrl+Shift+S/N；mac 为 Command+Shift+S/N）
  registerFixedShortcuts();

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  // 真正的退出（托盘菜单 / app.quit()）：放行 close 拦截
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
