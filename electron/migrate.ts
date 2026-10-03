// =============================================================================
// Quick-Chat — 旧版 Rust 桌面壳数据迁移
// =============================================================================
// 旧实现的数据目录标识符为 com.tauri-app.quick-chat（其配置文件的 identifier）：
//   Linux   $XDG_CONFIG_HOME/com.tauri-app.quick-chat（缺省 ~/.config/...）
//   macOS   ~/Library/Application Support/com.tauri-app.quick-chat
//   Windows %APPDATA%\com.tauri-app.quick-chat
// 迁移策略：新 userData 目录下尚无 quick_chat.db、且旧目录存在该文件时，
// 复制（不移动）数据库文件（含 -wal / -shm）到新目录；已有新库则不动。
// Skills 存放在 ~/.chat/skills，与旧实现位置一致，无需迁移；
// localStorage 偏好接受重置（计划内）。
// =============================================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 旧版桌面的应用数据目录标识符（tauri.conf.json 的 identifier） */
export const LEGACY_APP_DIR_NAME = "com.tauri-app.quick-chat";

const DB_FILE = "quick_chat.db";
const DB_SUFFIXES = ["", "-wal", "-shm"];

/** 旧版应用数据目录（按平台惯例解析；userData 目录名规则与旧实现一致） */
export function legacyConfigDir(): string {
  switch (process.platform) {
    case "win32": {
      const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
      return path.join(appData, LEGACY_APP_DIR_NAME);
    }
    case "darwin":
      return path.join(os.homedir(), "Library", "Application Support", LEGACY_APP_DIR_NAME);
    default: {
      const xdgConfig = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
      return path.join(xdgConfig, LEGACY_APP_DIR_NAME);
    }
  }
}

function hasAnyDbFile(dir: string): boolean {
  return DB_SUFFIXES.some((suffix) => {
    try {
      return fs.statSync(path.join(dir, DB_FILE + suffix)).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * 若目标目录尚无数据库而旧目录存在，则复制数据库文件。
 * 返回是否执行了复制（便于测试断言与日志）。
 */
export function migrateLegacyData(oldDir: string, newDir: string): boolean {
  if (hasAnyDbFile(newDir)) {
    return false;
  }
  if (!hasAnyDbFile(oldDir)) {
    return false;
  }
  fs.mkdirSync(newDir, { recursive: true });
  for (const suffix of DB_SUFFIXES) {
    const src = path.join(oldDir, DB_FILE + suffix);
    try {
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, path.join(newDir, DB_FILE + suffix));
      }
    } catch {
      // 单个伴随文件缺失/不可读不阻塞其余文件
    }
  }
  return true;
}

/** 应用启动时调用：按平台解析旧目录并尝试迁移（dev 开发库模式跳过） */
export function migrateLegacyDataIfNeeded(newDir: string, useDevDb: boolean): boolean {
  if (useDevDb) {
    return false;
  }
  const oldDir = legacyConfigDir();
  if (oldDir === newDir) {
    return false;
  }
  if (migrateLegacyData(oldDir, newDir)) {
    console.log(`[quick-chat] 已从旧版数据目录迁移数据库: ${oldDir} -> ${newDir}`);
    return true;
  }
  return false;
}
