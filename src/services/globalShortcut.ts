// =============================================================================
// Quick-Chat — 全局快捷键（唤起/隐藏主窗口）
// =============================================================================
// 注册走 Electron globalShortcut（bridge 的 shortcut:* 命令），触发时主进程
// 向主窗口转发 shortcut-fired 事件；这里做防抖/串行化后切换窗口显隐。
// 快捷键值持久化在 localStorage，旧安装默认 Ctrl+Alt+Space。
// =============================================================================

import { invoke, onEvent, isElectron } from '@/services/bridge';
import { getCurrentWindow } from '@/services/appWindow';

export const GLOBAL_SHORTCUT_STORAGE_KEY = 'quick_chat_global_shortcut';
// Avoid Alt+Space: Linux desktop environments commonly reserve it for the window menu.
export const DEFAULT_GLOBAL_SHORTCUT = 'Ctrl+Alt+Space';

let registeredShortcut: string | null = null;
let unsubscribeFired: (() => void) | null = null;

// 旧桌面壳/global-hotkey 风格的修饰键写法 → Electron accelerator 规范名
const MODIFIER_MAP: Record<string, string> = {
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  commandorctrl: 'CommandOrControl',
  command: 'Command',
  cmd: 'Command',
  control: 'Control',
  ctrl: 'Control',
  option: 'Alt',
  alt: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  win: 'Super',
};

// 常见命名键的小写写法 → Electron 规范名（大小写敏感）
const NAMED_KEY_MAP: Record<string, string> = {
  space: 'Space',
  tab: 'Tab',
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  return: 'Enter',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
};

/**
 * 旧桌面壳（global-hotkey 插件）风格的 accelerator 归一化为 Electron 格式。
 * 历史 localStorage 里可能有 CommandOrControl/CmdOrCtrl/Option/Super/win 等
 * 写法（大小写不限），单字符键统一大写（Electron 要求 'S' 而非 's'）。
 */
export function normalizeAccelerator(shortcut: string): string {
  return shortcut
    .split('+')
    .map((part) => {
      const trimmed = part.trim();
      if (trimmed.length === 0) return trimmed;
      const modifier = MODIFIER_MAP[trimmed.toLowerCase()];
      if (modifier) return modifier;
      const named = NAMED_KEY_MAP[trimmed.toLowerCase()];
      if (named) return named;
      return trimmed.length === 1 ? trimmed.toUpperCase() : trimmed;
    })
    .filter((part) => part.length > 0)
    .join('+');
}

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

  // window:show 覆盖还原最小化 + 显示 + 聚焦
  await window.show();
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
  // 归一化历史写法后再注册；registeredShortcut 统一保存归一化形式
  await invoke('shortcut:register', { accelerator: normalizeAccelerator(shortcut) });
}

async function unregisterShortcut(shortcut: string) {
  await invoke('shortcut:unregister', { accelerator: normalizeAccelerator(shortcut) });
}

/** 订阅主进程的 shortcut-fired 转发，只响应当前注册的快捷键 */
function subscribeShortcutFired() {
  unsubscribeFired?.();
  unsubscribeFired = onEvent('shortcut-fired', (payload) => {
    const accelerator = (payload as { accelerator?: string } | null)?.accelerator;
    if (accelerator && accelerator !== registeredShortcut) return;
    requestToggle();
  });
}

/** Register the saved shortcut once the webview is ready. */
export async function initializeGlobalShortcut(): Promise<void> {
  if (!isElectron()) return;

  const shortcut = getConfiguredGlobalShortcut();
  if (!shortcut) return;
  const normalized = normalizeAccelerator(shortcut);
  if (registeredShortcut === normalized) return;

  await registerShortcut(shortcut);
  registeredShortcut = normalized;
  subscribeShortcutFired();
}

/**
 * Swap the global quick-open shortcut without leaving a stale registration.
 * The persisted value is updated only after the new shortcut is registered.
 */
export async function setConfiguredGlobalShortcut(shortcut: string | null): Promise<void> {
  const previousShortcut = registeredShortcut;

  if (previousShortcut) {
    await unregisterShortcut(previousShortcut);
    registeredShortcut = null;
  }

  try {
    if (shortcut) {
      await registerShortcut(shortcut);
      registeredShortcut = normalizeAccelerator(shortcut);
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
