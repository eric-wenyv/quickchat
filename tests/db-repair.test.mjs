import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

function buildRoot() {
  // 产物必须写在项目目录内（tests/.transpiled/…）：转译后的裸包名
  // 要经项目 node_modules 解析，写到 os.tmpdir() 会解析失败。
  return join(dirname(fileURLToPath(import.meta.url)), '.transpiled');
}

// 数据层已迁入 Electron 主进程（electron/db-service.ts，同步 better-sqlite3）。
// 这里 stub 掉 ./db.js 的 getDb()，注入一个记录 SQL 调用的假连接。
async function importDbService(fakeDb) {
  const source = await readFile(new URL('../electron/db-service.ts', import.meta.url), 'utf8');
  const transformedSource = source.replace(
    'import { getDb } from "./db.js";',
    'const getDb = globalThis.__quickChatDbTestGetDb;',
  );
  const connection = {
    prepare(sql) {
      return {
        run: (...params) => {
          fakeDb.execute(sql, params);
          return { changes: 1, lastInsertRowid: 1 };
        },
        all: (...params) => fakeDb.select(sql, params),
      };
    },
    exec(sql) {
      fakeDb.execute(sql, []);
    },
  };
  globalThis.__quickChatDbTestGetDb = () => connection;

  const transformed = ts.transpileModule(transformedSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;

  const dir = join(buildRoot(), `db-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  const modulePath = join(dir, 'db-service.mjs');
  await writeFile(modulePath, transformed);
  return import(`file:///${modulePath.replaceAll('\\', '/')}`);
}

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

test('recognizes SQLite corruption errors', async () => {
  const { isSqliteCorruptionError } = await importDbService({
    execute: () => undefined,
    select: () => [],
  });

  assert.equal(
    isSqliteCorruptionError('error returned from database: (code: 267) database disk image is malformed'),
    true,
  );
  assert.equal(isSqliteCorruptionError(new Error('foreign key constraint failed')), false);
});

test('deleteConversation rebuilds message FTS indexes and retries after SQLite corruption', async () => {
  const calls = [];
  let deleteAttempts = 0;
  const fakeDb = {
    execute: (sql, params = []) => {
      const normalized = normalizeSql(sql);
      calls.push({ sql: normalized, params });
      if (normalized === 'DELETE FROM conversations WHERE id = ?') {
        deleteAttempts += 1;
        if (deleteAttempts === 1) {
          throw new Error('error returned from database: (code: 267) database disk image is malformed');
        }
      }
      return undefined;
    },
    select: () => [],
  };

  const { deleteConversation } = await importDbService(fakeDb);

  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    deleteConversation('conv-1');
  } finally {
    console.warn = originalWarn;
  }

  const sql = calls.map((call) => call.sql);
  assert.equal(deleteAttempts, 2);
  assert.ok(sql.includes('DROP TRIGGER IF EXISTS trg_messages_fts_insert;'));
  assert.ok(sql.includes('DROP TRIGGER IF EXISTS trg_messages_search_fts_delete;'));
  assert.ok(sql.includes('DROP TABLE IF EXISTS messages_fts;'));
  assert.ok(sql.includes('DROP TABLE IF EXISTS messages_search_fts;'));
  assert.ok(sql.some((statement) => statement.includes('CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5')));
  assert.ok(sql.some((statement) => statement.includes('CREATE VIRTUAL TABLE IF NOT EXISTS messages_search_fts USING fts5')));
  assert.ok(sql.includes("INSERT INTO messages_fts(messages_fts) VALUES ('rebuild');"));
  assert.ok(sql.includes("INSERT INTO messages_search_fts(messages_search_fts) VALUES ('rebuild');"));
  assert.deepEqual(
    calls
      .filter((call) => call.sql === 'DELETE FROM conversations WHERE id = ?')
      .map((call) => call.params),
    [['conv-1'], ['conv-1']],
  );
});

test('deleteConversation does not rebuild indexes for unrelated delete errors', async () => {
  const calls = [];
  const fakeDb = {
    execute: (sql, params = []) => {
      const normalized = normalizeSql(sql);
      calls.push({ sql: normalized, params });
      if (normalized === 'DELETE FROM conversations WHERE id = ?') {
        throw new Error('foreign key constraint failed');
      }
      return undefined;
    },
    select: () => [],
  };

  const { deleteConversation } = await importDbService(fakeDb);

  assert.throws(() => deleteConversation('conv-1'), /foreign key constraint failed/);
  assert.equal(calls.some((call) => call.sql.startsWith('DROP TRIGGER')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('DROP TABLE')), false);
});
