// tests/app-settings.test.mjs
//
// app_settings 持久化：设置页写入的 Tavily API Key 等键值对。
// db-service.ts 是同步 better-sqlite3 模块，这里 stub ./db.js 注入假连接。

import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

function buildRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '.transpiled');
}

async function importDbService(fakeDb) {
  const source = await readFile(new URL('../electron/db-service.ts', import.meta.url), 'utf8');
  const transformedSource = source.replace(
    'import { getDb } from "./db.js";',
    'const getDb = globalThis.__quickChatAppSettingsTestDb;',
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
  globalThis.__quickChatAppSettingsTestDb = () => connection;

  const transformed = ts.transpileModule(transformedSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;

  const dir = join(buildRoot(), `app-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  const modulePath = join(dir, 'db-service.mjs');
  await writeFile(modulePath, transformed);
  return import(`file:///${modulePath.replaceAll('\\', '/')}`);
}

const normalizeSql = (sql) => sql.replace(/\s+/g, ' ').trim();

test('getAppSetting returns the stored value or null', async () => {
  const rows = [{ value: 'tvly-test' }];
  const { getAppSetting } = await importDbService({
    execute: () => undefined,
    select: (sql, params) => {
      assert.equal(normalizeSql(sql), 'SELECT value FROM app_settings WHERE key = ?');
      assert.deepEqual(params, ['tavily_api_key']);
      return rows;
    },
  });

  assert.equal(getAppSetting('tavily_api_key'), 'tvly-test');
  rows.length = 0;
  assert.equal(getAppSetting('tavily_api_key'), null);
});

test('setAppSetting trims and upserts non-empty values', async () => {
  const calls = [];
  const { setAppSetting } = await importDbService({
    execute: (sql, params) => {
      calls.push({ sql: normalizeSql(sql), params });
    },
    select: () => [],
  });

  setAppSetting('tavily_api_key', '  tvly-test  ');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO app_settings/);
  assert.deepEqual(calls[0].params.slice(0, 2), ['tavily_api_key', 'tvly-test']);
});

test('setAppSetting deletes the key when the value is blank', async () => {
  const calls = [];
  const { setAppSetting } = await importDbService({
    execute: (sql, params) => {
      calls.push({ sql: normalizeSql(sql), params });
    },
    select: () => [],
  });

  setAppSetting('tavily_api_key', '   ');
  assert.deepEqual(calls, [
    { sql: 'DELETE FROM app_settings WHERE key = ?', params: ['tavily_api_key'] },
  ]);
});
