import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const BACKEND = "org.freedesktop.impl.portal.desktop.kde";
const DESKTOP = "/org/freedesktop/portal/desktop";
const INTERFACE = "org.freedesktop.impl.portal.GlobalShortcuts";

type BusReply = { data: unknown[] };
type BusConnection = { name: string; pid: number };
type Shortcut = [string, { description?: { data: string } }];

interface RecoveryOptions {
  pid: number;
  isRegistered: (accelerator: string) => boolean;
  run?: (args: string[]) => Promise<string>;
  pause?: () => Promise<unknown>;
}

/**
 * Chromium 152/156 skips BindShortcuts when ListShortcuts contains every ID.
 * Plasma >= 6.7.4 requires a bind on EVERY session, including restored ones.
 * Re-arm only this process's existing KDE portal session; Electron continues
 * to own its lifetime and dispatch Activated. Preserve the user's KDE bindings.
 * https://bugs.kde.org/show_bug.cgi?id=524138
 */
export async function restoreKdeGlobalShortcuts({
  pid,
  isRegistered,
  run = async (args) => {
    const address = process.env.DBUS_SESSION_BUS_ADDRESS
      || `unix:path=${process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid!()}`}/bus`;
    const result = await execFileAsync("busctl", [
      `--address=${address}`, "--json=short", "--timeout=3s", ...args,
    ], { timeout: 4000, maxBuffer: 1024 * 1024 });
    return result.stdout;
  },
  pause = () => delay(100),
}: RecoveryOptions): Promise<void> {
  let connections: BusConnection[];
  try {
    connections = JSON.parse(await run(["list", "--no-pager"]));
  } catch {
    // busctl is optional; other desktops and platforms use Electron as usual.
    return;
  }
  if (!connections.some(({ name }) => name === BACKEND)) return;
  let owners = connections.filter((entry) => entry.pid === pid && entry.name.startsWith(":"));

  const call = async (service: string, path: string, iface: string, method: string, ...args: string[]) => {
    return JSON.parse(await run(["call", service, path, iface, method, ...args])) as BusReply;
  };
  let lastError: unknown;
  let foundSession = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    // Native registration and portal session creation are asynchronous.
    await pause();
    if (owners.length === 0) {
      connections = JSON.parse(await run(["list", "--no-pager"]));
      owners = connections.filter((entry) => entry.pid === pid && entry.name.startsWith(":"));
    }
    for (const owner of owners) {
      const parent = `${DESKTOP}/session/${owner.name.slice(1).replaceAll(".", "_")}`;
      try {
        const reply = await call("org.freedesktop.portal.Desktop", parent,
          "org.freedesktop.DBus.Introspectable", "Introspect");
        const xml = String(reply.data[0]);
        for (const match of xml.matchAll(/<node name="([A-Za-z0-9_]+_global_shortcuts)"\s*\/?\s*>/g)) {
          foundSession = true;
          const session = `${parent}/${match[1]}`;
          const request = `${DESKTOP}/request/quick_chat_recovery/p${pid}`;
          const listed = await call(BACKEND, DESKTOP, INTERFACE, "ListShortcuts", "oo", request, session);
          if (listed.data[0] !== 0) throw new Error("KDE ListShortcuts failed");
          const result = listed.data[1] as { shortcuts: { data: Shortcut[] } };
          const shortcuts = result.shortcuts.data.filter(([id]) => {
            const accelerator = /^[A-F0-9]{32}-(.+)$/.exec(id)?.[1];
            return accelerator && isRegistered(accelerator);
          });
          // A first-time/new binding is handled by Electron's normal bind path.
          if (shortcuts.length === 0) return;

          const args = [request, session, String(shortcuts.length)];
          for (const [id, props] of shortcuts) {
            args.push(id, "1", "description", "s", props.description?.data || id);
          }
          args.push("", "0");
          // Do not pass preferred_trigger: the compositor retains user changes.
          const bound = await call(BACKEND, DESKTOP, INTERFACE, "BindShortcuts",
            "ooa(sa{sv})sa{sv}", ...args);
          if (bound.data[0] !== 0) throw new Error(`KDE BindShortcuts failed: ${bound.data[0]}`);
          console.info("[quick-chat] 已重新激活 KDE 全局快捷键会话");
          return;
        }
      } catch (error) {
        lastError = error;
      }
    }
  }
  // X11 registrations have no portal session and need no recovery.
  if (!foundSession) return;
  throw new Error(`无法重新激活 KDE 全局快捷键：${String(lastError ?? "未找到当前应用的快捷键会话")}`);
}
