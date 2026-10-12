// Database management

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

let db: Database.Database | null = null;

export function useDevDb(): boolean {
  return process.env.QUICK_CHAT_DEV_DB !== undefined || process.env.VITE_FRESH_DB === "1";
}

export function dbPath(): string {
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
