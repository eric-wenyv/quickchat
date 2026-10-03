// =============================================================================
// Quick-Chat — Electron 主进程 SQLite 连接单例
// =============================================================================
// better-sqlite3 为同步驱动，主进程内 IPC handler 与 LAN 同步服务器共用同一
// 连接（等价于 Rust 侧 sqlx 以 WAL 多连接并发访问同一文件，但更简单）。
// 数据库文件位置与旧版桌面壳约定一致：app config dir 下的
// quick_chat.db；QUICK_CHAT_DEV_DB / VITE_FRESH_DB 环境变量时用开发库并在
// 启动时清空（对应原 dev:fresh 模式）。
// =============================================================================

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

let db: Database.Database | null = null;

/** dev:fresh 语义对齐旧版行为：开发库每次启动清空（空白首启） */
export function useDevDb(): boolean {
  return process.env.QUICK_CHAT_DEV_DB !== undefined || process.env.VITE_FRESH_DB === "1";
}

export function dbPath(): string {
  // userData 由 main.ts 在 app ready 后通过 setUserDataDir 注入
  return path.join(userDataDir, useDevDb() ? "quick_chat_dev.db" : "quick_chat.db");
}

let userDataDir = "";

export function setUserDataDir(dir: string): void {
  userDataDir = dir;
}

export function getDb(): Database.Database {
  if (db) return db;
  const file = dbPath();
  if (useDevDb()) {
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(file + suffix, { force: true });
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  return db;
}

export function toLastInsertId(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}
