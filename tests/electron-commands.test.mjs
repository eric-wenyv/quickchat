// tests/electron-commands.test.mjs
//
// electron/commands.ts 测试：
//   fetch_url — 本地 node:http 起测试服务器，验证 HTML 正文提取（对齐
//               旧 Rust 主程序单测）、重定向、错误形状、截断
//   search_web — Tavily 请求形状、.env 手写解析、缺 key 报错
//   parse_document — Python 缺失 / 解析失败错误形状

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { importElectronModule } from './lib/import-electron.mjs';

// ---------------------------------------------------------------------------
// fetch_url
// ---------------------------------------------------------------------------

function startTestServer(routes) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const handler = routes[url.pathname];
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    handler(res, url, req);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

test('fetch_url 提取标题与正文（对齐 Rust 单测）', async () => {
  const { fetchUrl } = await importElectronModule('commands');
  const html = `
    <html>
    <head><title>示例页面</title><style>body{color:red}</style></head>
    <body>
        <h1>标题一</h1>
        <p>第一段   带有多余空格。</p>
        <script>alert('x')</script>
        <ul><li>项目一</li><li>项目二</li></ul>
    </body>
    </html>`;
  const { server, port } = await startTestServer({
    '/page': (res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    },
  });
  try {
    const result = await fetchUrl(`http://127.0.0.1:${port}/page`);
    assert.equal(result.title, '示例页面');
    assert.ok(result.content.includes('标题一'));
    assert.ok(result.content.includes('第一段 带有多余空格。'));
    assert.ok(result.content.includes('项目一'));
    assert.ok(!result.content.includes('alert'));
    assert.ok(!result.content.includes('color:red'));
    assert.equal(result.truncated, false);
    assert.equal(result.url, `http://127.0.0.1:${port}/page`);
  } finally {
    server.close();
  }
});

test('fetch_url 嵌套块元素折叠为单行（对齐 Rust collapses_blank_lines）', async () => {
  const { extractHtmlText } = await importElectronModule('commands');
  const { content } = extractHtmlText('<body><p>a</p><div><div><div>b</div></div></div></body>');
  assert.equal(content, 'a\nb');
});

test('fetch_url 非 HTML 直接透传文本', async () => {
  const { fetchUrl } = await importElectronModule('commands');
  const { server, port } = await startTestServer({
    '/raw': (res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('  plain text body  ');
    },
  });
  try {
    const result = await fetchUrl(`http://127.0.0.1:${port}/raw`);
    assert.equal(result.title, null);
    assert.equal(result.content, '  plain text body  ');
  } finally {
    server.close();
  }
});

test('fetch_url 非 2xx / 重定向超限 / 空正文 / 非法协议 的错误形状', async () => {
  const { fetchUrl } = await importElectronModule('commands');
  const routes = {};
  routes['/missing'] = (res) => {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('nope');
  };
  for (let i = 1; i <= 11; i += 1) {
    const next = i < 11 ? `/loop${i + 1}` : '/loop1';
    routes[`/loop${i}`] = (res) => {
      res.writeHead(302, { Location: next });
      res.end();
    };
  }
  routes['/empty'] = (res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body><script>1</script></body></html>');
  };
  routes['/jump'] = (res) => {
    res.writeHead(302, { Location: '/final' });
    res.end();
  };
  routes['/final'] = (res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<body><p>arrived</p></body>');
  };
  const { server, port } = await startTestServer(routes);
  try {
    await assert.rejects(() => fetchUrl(`http://127.0.0.1:${port}/missing`), /网页请求失败 \(HTTP 404\)/);
    await assert.rejects(() => fetchUrl(`http://127.0.0.1:${port}/loop1`), /重定向次数超过限制/);
    await assert.rejects(
      () => fetchUrl(`http://127.0.0.1:${port}/empty`),
      /网页内容为空或无法提取正文/,
    );
    await assert.rejects(() => fetchUrl('ftp://example.com/x'), /仅支持 http\/https 链接/);

    // 正常重定向跟随（返回值 url 为原始请求地址，与 Rust 一致）
    const result = await fetchUrl(`http://127.0.0.1:${port}/jump`);
    assert.equal(result.content, 'arrived');
    assert.equal(result.url, `http://127.0.0.1:${port}/jump`);
  } finally {
    server.close();
  }
});

test('fetch_url 正文超过 20000 字符截断并标记 truncated', async () => {
  const { fetchUrl } = await importElectronModule('commands');
  const big = '字'.repeat(20_500);
  const { server, port } = await startTestServer({
    '/big': (res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<body><p>${big}</p></body>`);
    },
  });
  try {
    const result = await fetchUrl(`http://127.0.0.1:${port}/big`);
    assert.equal(result.truncated, true);
    assert.equal(Array.from(result.content).length, 20_000);
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// search_web
// ---------------------------------------------------------------------------

test('search_web 组装 Tavily 请求并透传响应', async () => {
  const commands = await importElectronModule('commands');
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = 'test-key';
  const captured = {};
  globalThis.fetch = async (url, init) => {
    captured.url = url;
    captured.init = init;
    return new Response(
      JSON.stringify({ results: [{ title: 't', url: 'u', content: 'c' }], response_time: 0.1 }),
      { status: 200 },
    );
  };
  try {
    const result = await commands.searchWeb('ai news');
    assert.equal(captured.url, 'https://api.tavily.com/search');
    assert.equal(captured.init.headers.Authorization, 'Bearer test-key');
    const body = JSON.parse(captured.init.body);
    assert.equal(body.query, 'ai news');
    assert.equal(body.search_depth, 'basic');
    assert.equal(body.max_results, 5);
    assert.deepEqual(result.results, [{ title: 't', url: 'u', content: 'c' }]);

    // 非 2xx：错误信息包含状态码与响应体
    globalThis.fetch = async () => new Response('rate limited', { status: 429 });
    await assert.rejects(() => commands.searchWeb('x'), /Tavily 搜索请求失败 \(429\): rate limited/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.TAVILY_API_KEY;
    } else {
      process.env.TAVILY_API_KEY = originalKey;
    }
  }
});

test('search_web 从 .env 读取 TAVILY_API_KEY（手写解析：export 前缀/引号/注释）', async () => {
  const commands = await importElectronModule('commands');
  const tmp = await mkdtemp(join(tmpdir(), 'qc-dotenv-'));
  await writeFile(
    join(tmp, '.env'),
    [
      '# 注释行',
      '',
      'OTHER_KEY=skip',
      'TAVILY_API_KEY="quoted-key"',
      "export TAVILY_API_KEY_SINGLE='single-key'",
    ].join('\n'),
  );
  const originalCwd = process.cwd();
  const originalKey = process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  try {
    process.chdir(tmp);
    assert.equal(commands.getTavilyApiKey(), 'quoted-key');

    // 改为单一 single-key 后应读到去掉引号的值
    await writeFile(join(tmp, '.env'), "export TAVILY_API_KEY_SINGLE='single-key'\nTAVILY_API_KEY='single-key'\n");
    assert.equal(commands.getTavilyApiKey(), 'single-key');

    // 空 .env：报未配置（getTavilyApiKey 为同步抛错）
    await writeFile(join(tmp, '.env'), '# nothing\n');
    assert.throws(() => commands.getTavilyApiKey(), /Tavily API Key 未配置/);
  } finally {
    process.chdir(originalCwd);
    if (originalKey !== undefined) {
      process.env.TAVILY_API_KEY = originalKey;
    }
  }
});

// ---------------------------------------------------------------------------
// parse_document
// ---------------------------------------------------------------------------

test('parse_document：未知扩展名返回空串，坏文件给出 Python exit code 错误', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const python = spawnSync('which', ['python3'], { encoding: 'utf8' });
  if (python.status !== 0) {
    t.skip('python3 不可用，跳过 parse_document 测试');
    return;
  }
  const commands = await importElectronModule('commands');

  // ext 不在 pdf/docx/doc 集合内：脚本输出空文本并成功退出
  const empty = commands.parseDocument(Buffer.from('anything').toString('base64'), 'xyz');
  assert.equal(empty, '');

  // 假 PDF：pdfplumber 打开失败（未安装或格式错误），退出码非 0
  assert.throws(
    () => commands.parseDocument(Buffer.from('not a pdf').toString('base64'), 'pdf'),
    (e) => /Python exit code Some\(\d+\)\. stderr: /.test(e.message) && e.message.includes('python:'),
  );
});

test('parse_document：PATH 下无 Python 时给出安装提示', () => {
  return importElectronModule('commands').then((commands) => {
    const originalPath = process.env.PATH;
    process.env.PATH = '';
    try {
      assert.throws(
        () => commands.parseDocument(Buffer.from('x').toString('base64'), 'pdf'),
        /无法找到 Python 解释器，请确保 Python 已安装并加入 PATH/,
      );
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
