import { getCurrentWindow } from '@tauri-apps/api/window';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';

export const GLOBAL_SHORTCUT_STORAGE_KEY = 'quick_chat_global_shortcut';
// Avoid Alt+Space: Linux desktop environments commonly reserve it for the window menu.
export const DEFAULT_GLOBAL_SHORTCUT = 'Ctrl+Alt+Space';

let registeredShortcut: string | null = null;

// Holding the shortcut down fires repeated Pressed events (key auto-repeat), and
// each async toggle reads isVisible() before the previous show()/hide() lands.
// Both make the window flash open and immediately close. Serialize toggles and
// ignore presses that arrive right after a toggle.
const TOGGLE_DEBOUNCE_MS = 400;
let lastToggleAt = 0;
let toggleQueue: Promise<void> = Promise.resolve();

export function getConfiguredGlobalShortcut(): string | null {
  const saved = localStorage.getItem(GLOBAL_SHORTCUT_STORAGE_KEY);

  // Existing installations have no saved value, so migrate them to the safer default.
  if (saved === null) return DEFAULT_GLOBAL_SHORTCUT;
  return saved || null;
}

async function toggleWindowVisibility() {
  const window = getCurrentWindow();
  const isVisible = await window.isVisible();

  if (isVisible) {
    await window.hide();
    return;
  }

  await window.show();
  await window.unminimize();
  await window.setFocus();
}

function requestToggle() {
  const now = Date.now();
  if (now - lastToggleAt < TOGGLE_DEBOUNCE_MS) return;
  lastToggleAt = now;

  toggleQueue = toggleQueue.then(() =>
    toggleWindowVisibility().catch(error => {
      console.error('切换 Quick Chat 窗口失败:', error);
    }),
  );
}

async function registerShortcut(shortcut: string) {
  await register(shortcut, event => {
    if (event.state === 'Pressed') {
      requestToggle();
    }
  });
}

/** Register the saved shortcut once the webview is ready. */
export async function initializeGlobalShortcut(): Promise<void> {
  const shortcut = getConfiguredGlobalShortcut();
  if (!shortcut || registeredShortcut === shortcut) return;

  await registerShortcut(shortcut);
  registeredShortcut = shortcut;
}

/**
 * Swap the global quick-open shortcut without leaving a stale registration.
 * The persisted value is updated only after the new shortcut is registered.
 */
export async function setConfiguredGlobalShortcut(shortcut: string | null): Promise<void> {
  const previousShortcut = registeredShortcut;

  if (previousShortcut) {
    await unregister(previousShortcut);
    registeredShortcut = null;
  }

  try {
    if (shortcut) {
      await registerShortcut(shortcut);
      registeredShortcut = shortcut;
    }
  } catch (error) {
    // Do not accidentally leave the user without their former shortcut when
    // the requested combination is invalid or already claimed by the system.
    if (previousShortcut) {
      try {
        await registerShortcut(previousShortcut);
        registeredShortcut = previousShortcut;
      } catch (restoreError) {
        console.error('恢复原全局快捷键失败:', restoreError);
      }
    }
    throw error;
  }

  localStorage.setItem(GLOBAL_SHORTCUT_STORAGE_KEY, shortcut ?? '');
}
