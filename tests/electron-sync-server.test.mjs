// tests/electron-sync-server.test.mjs
//
// electron/sync-server.ts 测试：Bearer 鉴权、CORS 预检、health/export/push
// 路由、LWW 合并语义、quick-chat-sync-pushed 事件、令牌与配置的持久化。
// DB 用 better-sqlite3 临时文件（N-API 预编译，Node 下可直接加载）。

import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

import { importElectronModule } from './lib/import-electron.mjs';

async function setup({ seed, exportSkills } = {}) {
  const { createSyncServer } = await importElectronModule('sync-server');
  const dir = await mkdtemp(join(tmpdir(), 'qc-sync-test-'));
  const db = new Database(join(dir, 'quick_chat.db'));
  db.pragma('journal_mode = WAL');
  const events = [];
  // 默认关闭，测试里按需 setConfig 启动（端口 0 = 随机端口）
  await writeFile(join(dir, 'sync_config.json'), JSON.stringify({ enabled: false, port: 0 }));
  const server = createSyncServer({
    db,
    configDir: dir,
    emit: (name, payload) => events.push({ name, payload }),
    exportSkills: exportSkills ?? (async () => []),
  });
  // createSyncServer 已运行 ensure_schema 建好同步所需表结构，seed 只插数据
  if (seed) {
    seed(db);
  }
  return { dir, db, server, events };
}

async function request(port, path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // 非 JSON 响应
  }
  return { status: response.status, json, headers: response.headers };
}

test('health：无 Token 401，带 Token 200，CORS 预检不鉴权直接 200', async () => {
  const { server, events, db } = await setup();
  try {
    await server.setConfig(true, 0);
    const port = server.actualPort();
    const info = await server.info();
    assert.equal(info.running, true);

    const unauthorized = await request(port, '/api/sync/health');
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(unauthorized.json, { error: '未授权：Token 无效或缺失' });

    const ok = await request(port, '/api/sync/health', { token: info.token });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json, { ok: true, app: 'quick-chat', role: 'sync-server' });

    const preflight = await fetch(`http://127.0.0.1:${port}/api/sync/push`, { method: 'OPTIONS' });
    assert.equal(preflight.status, 200);
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
    assert.equal(
      preflight.headers.get('access-control-allow-headers'),
      'Authorization, Content-Type',
    );

    const wrongToken = await request(port, '/api/sync/health', { token: 'nope' });
    assert.equal(wrongToken.status, 401);

    assert.deepEqual(events, []);
  } finally {
    await server.shutdown();
  }
});

test('export：增量会话/消息、新建会话携带全部消息、配置全量、skills 注入', async () => {
  const { server, db } = await setup({
    // createSyncServer 的 ensure_schema 已建好表结构，这里只插数据
    seed(db) {
      const conv = db.prepare(
        'INSERT INTO conversations (id, title, model_id, created_at, updated_at, pinned) VALUES (?, ?, ?, ?, ?, ?)',
      );
      const msg = db.prepare(
        'INSERT INTO messages (id, conversation_id, role, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      );
      // c-old：老会话，updated_at 都在水位线以下
      conv.run('c-old', '旧会话', 'm', 100, 200, 0);
      msg.run('m1', 'c-old', 'user', 'hello', 100, 100);
      msg.run('m2', 'c-old', 'assistant', 'hi', 110, 110);
      // c-new：水位线之后新建（全部消息都要带出去）
      conv.run('c-new', '新会话', 'm', 900, 900, 1);
      msg.run('m3', 'c-new', 'user', 'new hello', 900, 900);
      msg.run('m4', 'c-new', 'assistant', 'new hi', 905, 905);
      // c-touch：会话本身旧，但有水位线之后更新的消息
      conv.run('c-touch', 'touch', 'm', 150, 160, 0);
      msg.run('m5', 'c-touch', 'user', 'edited later', 150, 800);

      db.prepare(
        `INSERT INTO model_configs (id, provider, model_id, display_name, api_key, created_at, updated_at)
         VALUES ('mod-1', 'openai_compatible', 'gpt', 'GPT', 'secret-key', 300, 400)`,
      ).run();
      db.prepare(
        'INSERT INTO system_prompts (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run('p1', '提示词', '内容', 500, 600);
    },
    exportSkills: async () => [{ id: 'skill-a', content: 'SKILL body' }],
  });
  try {
    await server.setConfig(true, 0);
    const port = server.actualPort();
    const { token } = await server.info();

    const all = await request(port, '/api/sync/export', { token });
    assert.equal(all.status, 200);
    assert.deepEqual(all.json.conversations.map((c) => c.id).sort(), ['c-new', 'c-old', 'c-touch']);
    assert.equal(all.json.messages.length, 5);
    const model = all.json.models[0];
    assert.equal(model.api_key, 'secret-key');
    assert.equal(model.max_tokens, null);
    assert.deepEqual(all.json.system_prompts.map((p) => p.title), ['提示词']);
    assert.deepEqual(all.json.skills, [{ id: 'skill-a', content: 'SKILL body' }]);
    assert.equal(typeof all.json.generated_at, 'number');

    // 增量：since=500 —— 只有 c-new（900）与 c-touch（消息 800）出去
    const delta = await request(port, '/api/sync/export?since=500', { token });
    assert.deepEqual(delta.json.conversations.map((c) => c.id).sort(), ['c-new', 'c-touch']);
    // c-new 的全部消息 + c-touch 的 m5
    assert.deepEqual(delta.json.messages.map((m) => m.id).sort(), ['m3', 'm4', 'm5']);
    // 配置类始终全量
    assert.equal(delta.json.models.length, 1);
  } finally {
    await server.shutdown();
    db.close();
  }
});

test('push：LWW 合并、stats 统计、quick-chat-sync-pushed 事件', async () => {
  const { server, db, events } = await setup({
    seed(database) {
      database
        .prepare('INSERT INTO conversations (id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('c1', '原标题', 'm', 100, 100);
      database
        .prepare(
          'INSERT INTO messages (id, conversation_id, role, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('m1', 'c1', 'user', '旧内容', 100, 100);
    },
  });
  try {
    await server.setConfig(true, 0);
    const port = server.actualPort();
    const { token } = await server.info();

    const body = {
      conversations: [
        // 更新（updated_at 更新）→ 写入
        { id: 'c1', title: '新标题', model_id: 'm', created_at: 100, updated_at: 200 },
        // 冲突但较旧 → 跳过
        { id: 'c1', title: '更旧的标题', model_id: 'm', created_at: 100, updated_at: 50 },
        // 全新会话 → 写入
        { id: 'c2', title: '推送来的', model_id: 'm', created_at: 300, updated_at: 300 },
        // 缺 updated_at → 跳过
        { id: 'c3', title: '残缺', model_id: 'm', created_at: 1 },
      ],
      messages: [
        { id: 'm1', conversation_id: 'c1', role: 'user', content: '新内容', created_at: 100, updated_at: 200 },
        { id: 'm9', conversation_id: 'c2', role: 'user', content: '新消息', created_at: 300, updated_at: 300 },
      ],
    };
    const pushed = await request(port, '/api/sync/push', { method: 'POST', token, body });
    assert.equal(pushed.status, 200);
    // c1 更新 + c2 新建 = 2；m1 更新 + m9 新建 = 2；旧版 c1 与残缺 c3 跳过
    assert.deepEqual(pushed.json, {
      ok: true,
      stats: { conversations: 2, messages: 2, skipped: 2 },
    });

    // LWW 结果
    assert.equal(db.prepare('SELECT title FROM conversations WHERE id = ?').get('c1').title, '新标题');
    assert.equal(db.prepare('SELECT content FROM messages WHERE id = ?').get('m1').content, '新内容');
    assert.equal(db.prepare('SELECT COUNT(*) c FROM conversations').get().c, 2);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM messages').get().c, 2);

    // 事件：applied = 2 + 2 = 4
    assert.deepEqual(events, [{ name: 'quick-chat-sync-pushed', payload: 4 }]);

    // 重复推送同样的数据：全部跳过（4 会话 + 2 消息）且不重复发事件
    const again = await request(port, '/api/sync/push', { method: 'POST', token, body });
    assert.deepEqual(again.json.stats, { conversations: 0, messages: 0, skipped: 6 });
    assert.equal(events.length, 1);

    // 非法 JSON → 400
    const bad = await fetch(`http://127.0.0.1:${port}/api/sync/push`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{oops',
    });
    assert.equal(bad.status, 400);
  } finally {
    await server.shutdown();
    db.close();
  }
});

test('令牌与配置持久化：重启复用，regenerate 更换', async () => {
  const { createSyncServer } = await importElectronModule('sync-server');
  const dir = await mkdtemp(join(tmpdir(), 'qc-sync-persist-'));
  const db = new Database(join(dir, 'quick_chat.db'));
  try {
    const s1 = createSyncServer({ db, configDir: dir, emit: () => {}, exportSkills: async () => [] });
    const t1 = (await s1.info()).token;
    assert.match(t1, /^[0-9a-f]{32}$/);
    assert.equal(await readFile(join(dir, 'sync_token'), 'utf8'), t1);

    // 改配置（enabled=false, port=12345）→ 持久化
    await s1.setConfig(false, 12345);
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'sync_config.json'), 'utf8')), {
      enabled: false,
      port: 12345,
    });

    // 同 configDir 新实例：复用令牌与配置
    const s2 = createSyncServer({ db, configDir: dir, emit: () => {}, exportSkills: async () => [] });
    const info2 = await s2.info();
    assert.equal(info2.token, t1);
    assert.equal(info2.enabled, false);
    assert.equal(info2.port, 12345);
    assert.equal(info2.running, false);

    // 重置令牌：文件与内存同时更新
    const info3 = await s2.regenerateToken();
    assert.notEqual(info3.token, t1);
    assert.equal(await readFile(join(dir, 'sync_token'), 'utf8'), info3.token);
    await s2.shutdown();
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('默认配置缺省时启用并监听 DEFAULT_PORT（写入配置文件）', async () => {
  const { createSyncServer } = await importElectronModule('sync-server');
  const dir = await mkdtemp(join(tmpdir(), 'qc-sync-default-'));
  const db = new Database(join(dir, 'quick_chat.db'));
  try {
    // 不写 sync_config.json：默认 enabled=true, port=8975
    const server = createSyncServer({ db, configDir: dir, emit: () => {}, exportSkills: async () => [] });
    const info = await server.info();
    assert.equal(info.enabled, true);
    assert.equal(info.port, 8975);
    if (info.running) {
      // 等待 listen 落定（autostart 是异步的）再取实际端口
      for (let i = 0; i < 50 && server.actualPort() === null; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(server.actualPort(), 8975);
      await server.shutdown();
    }
    // 是否真正绑定成功取决于 8975 是否被占用；启动失败只落日志（与 Rust 一致）
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
