// =============================================================================
// Quick-Chat — 系统托盘
// =============================================================================
// 对齐旧 Rust 实现的 setup_tray：右键菜单「显示窗口」/「退出」，
// 左键点击显示窗口。Linux 无 indicator 环境（如 headless CI）下创建托盘
// 可能失败 —— 降级为日志，不影响主进程（与 Rust 侧 tray setup error 一致）。
// =============================================================================

import { Menu, nativeImage, Tray } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TRAY_ICON_PATH = path.join(__dirname, "assets", "tray-icon.png");

export interface TrayDeps {
  getMainWindow: () => { show: () => void; focus: () => void } | null;
  /** 「退出」：置退出标记后真正退出（绕过 close-to-tray 拦截） */
  onQuit: () => void;
}

export function setupTray(deps: TrayDeps): Tray | null {
  try {
    const icon = nativeImage.createFromPath(TRAY_ICON_PATH);
    if (icon.isEmpty()) {
      throw new Error(`托盘图标为空: ${TRAY_ICON_PATH}`);
    }
    const tray = new Tray(icon);
    tray.setToolTip("quick-chat");

    const showWindow = () => {
      const win = deps.getMainWindow();
      if (win) {
        win.show();
        win.focus();
      }
    };

    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "显示窗口", click: showWindow },
        { type: "separator" },
        { label: "退出", click: () => deps.onQuit() },
      ]),
    );
    tray.on("click", showWindow);
    return tray;
  } catch (e) {
    console.error("[quick-chat] tray setup error:", e);
    return null;
  }
}
