import assert from 'node:assert/strict';
import test from 'node:test';

import { importElectronModule } from './lib/import-electron.mjs';

// URL 抓取结果的格式化已迁入主进程（electron/commands.ts，与 fetch_url 同文件）
async function importUrlService() {
  return importElectronModule('commands');
}

test('formatUrlContent includes url, title and body', async () => {
  const { formatUrlContent } = await importUrlService();

  const output = formatUrlContent({
    url: 'https://example.com/page',
    title: 'Example Page',
    content: '  这是正文内容。  ',
    truncated: false,
  });

  assert.ok(output.includes('https://example.com/page'));
  assert.ok(output.includes('标题: Example Page'));
  assert.ok(output.includes('这是正文内容。'));
  assert.ok(!output.includes('已截断'));
});

test('formatUrlContent notes truncation when content is truncated', async () => {
  const { formatUrlContent } = await importUrlService();

  const output = formatUrlContent({
    url: 'https://example.com/long',
    title: null,
    content: '很长的正文',
    truncated: true,
  });

  assert.ok(output.includes('已截断'));
  assert.ok(!output.includes('标题:'));
});
