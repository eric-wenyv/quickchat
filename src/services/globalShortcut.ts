import { getCurrentWindow } from '@tauri-apps/api/window';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';

export const GLOBAL_SHORTCUT_STORAGE_KEY = 'quick_chat_global_shortcut';
// Avoid Alt+Space: Linux desktop environments commonly reserve it for the window menu.
export const DEFAULT_GLOBAL_SHORTCUT = 'Ctrl+Alt+Space';

let registeredShortcut: string | null = null;

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

async function registerShortcut(shortcut: string) {
  await register(shortcut, event => {
    if (event.state === 'Pressed') {
      void toggleWindowVisibility().catch(error => {
        console.error('切换 Quick Chat 窗口失败:', error);
      });
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
