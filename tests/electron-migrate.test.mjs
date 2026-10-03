// tests/electron-migrate.test.mjs
//
// electron/migrate.ts 测试：旧版数据目录 → 新 userData 目录的数据库复制。
// 验证复制分支（含 -wal/-shm 伴随文件）、新库已存在时跳过、旧目录无库时跳过。

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { importElectronModule } from './lib/import-electron.mjs';

async function makeLegacyDir(parent) {
  const legacy = join(parent, 'com.tauri-app.quick-chat');
  await mkdir(legacy, { recursive: true });
  return legacy;
}

test('新目录无库且旧目录有库：复制 db 及 -wal/-shm 伴随文件', async () => {
  const { migrateLegacyData } = await importElectronModule('migrate');
  const tmp = await mkdtemp(join(tmpdir(), 'qc-migrate-copy-'));
  const legacy = await makeLegacyDir(tmp);
  const fresh = join(tmp, 'quick-chat');
  await writeFile(join(legacy, 'quick_chat.db'), 'main-db-bytes');
  await writeFile(join(legacy, 'quick_chat.db-wal'), 'wal-bytes');
  // 无 -shm（例如上次关闭时已 checkpoint）

  const migrated = migrateLegacyData(legacy, fresh);
  assert.equal(migrated, true);
  assert.equal(await readFile(join(fresh, 'quick_chat.db'), 'utf8'), 'main-db-bytes');
  assert.equal(await readFile(join(fresh, 'quick_chat.db-wal'), 'utf8'), 'wal-bytes');
  assert.deepEqual((await readdir(fresh)).sort(), ['quick_chat.db', 'quick_chat.db-wal']);

  // 旧目录文件保留（复制而非移动）
  assert.equal(await readFile(join(legacy, 'quick_chat.db'), 'utf8'), 'main-db-bytes');
});

test('新目录已有库：不迁移（原样保留）', async () => {
  const { migrateLegacyData } = await importElectronModule('migrate');
  const tmp = await mkdtemp(join(tmpdir(), 'qc-migrate-skip-'));
  const legacy = await makeLegacyDir(tmp);
  const fresh = join(tmp, 'quick-chat');
  await mkdir(fresh, { recursive: true });
  await writeFile(join(legacy, 'quick_chat.db'), 'old-bytes');
  await writeFile(join(fresh, 'quick_chat.db'), 'new-bytes');

  const migrated = migrateLegacyData(legacy, fresh);
  assert.equal(migrated, false);
  assert.equal(await readFile(join(fresh, 'quick_chat.db'), 'utf8'), 'new-bytes');
});

test('旧目录无库：不迁移；migrateLegacyDataIfNeeded dev 模式跳过', async () => {
  const migrate = await importElectronModule('migrate');
  const tmp = await mkdtemp(join(tmpdir(), 'qc-migrate-empty-'));
  const legacy = await makeLegacyDir(tmp);
  const fresh = join(tmp, 'quick-chat');
  assert.equal(migrate.migrateLegacyData(legacy, fresh), false);

  // dev 开发库模式一律跳过（即使旧目录有库）
  await writeFile(join(legacy, 'quick_chat.db'), 'old-bytes');
  assert.equal(migrate.migrateLegacyDataIfNeeded(fresh, true), false);
  assert.equal(migrate.migrateLegacyDataIfNeeded(fresh, false), true);
});
