// Quick-Chat Tray

import { Menu, nativeImage, Tray } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TRAY_ICON_PATH = path.join(__dirname, "assets", "tray-icon.png");

export interface TrayDeps {
  getMainWindow: () => { show: () => void; focus: () => void } | null;
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
