import type { BrowserWindow } from "electron";

type ToggleWindow = Pick<BrowserWindow,
  "isVisible" | "isFocused" | "isMinimized" | "restore" | "show" | "focus" | "hide"
>;

/** Keep quick-open independent of renderer IPC and background throttling. */
export function toggleMainWindow(win: ToggleWindow): void {
  if (win.isMinimized()) {
    win.restore();
    win.show();
    win.focus();
  } else if (win.isVisible() && win.isFocused()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
}

/** Ignore key auto-repeat so a held shortcut cannot immediately hide the window. */
export function createQuickOpenHandler(getWindow: () => ToggleWindow | null): () => void {
  let lastToggleAt = -Infinity;
  return () => {
    const win = getWindow();
    if (!win) return;
    const now = Date.now();
    if (now - lastToggleAt < 400) return;
    lastToggleAt = now;
    toggleMainWindow(win);
  };
}
