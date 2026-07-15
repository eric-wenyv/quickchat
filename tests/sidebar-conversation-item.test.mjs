import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('sidebar conversation items only render titles while keeping pin and delete actions', async () => {
  const conversationItem = await source('src/components/sidebar/ConversationItem.tsx');

  assert.match(conversationItem, /conversation\.title/);
  assert.doesNotMatch(conversationItem, /last_message_preview/);
  assert.doesNotMatch(conversationItem, /last_message_at/);
  assert.doesNotMatch(conversationItem, /message_count/);
  assert.doesNotMatch(conversationItem, /RelativeTime/);
  assert.match(conversationItem, /onPin\?\.\(\)/);
  assert.match(conversationItem, /title=\{conversation\.pinned \? '取消固定' : '固定对话'\}/);
  assert.match(conversationItem, /title="删除对话"/);
  assert.match(conversationItem, /onClick=\{handleDelete\}/);
});
