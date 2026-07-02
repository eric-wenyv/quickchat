import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('conversation history and message history are bounded at load time', async () => {
  const app = await source('src/App.tsx');

  assert.ok(app.includes('const CONVERSATION_LIST_LIMIT = 100;'));
  assert.ok(app.includes('sortConversations(convs).slice(0, CONVERSATION_LIST_LIMIT)'));
  assert.ok(app.includes('getConversations(CONVERSATION_LIST_LIMIT, 0)'));
  assert.ok(app.includes('const MESSAGE_PAGE_SIZE = 120;'));
  assert.ok(app.includes('getMessages(id, MESSAGE_PAGE_SIZE)'));
  assert.ok(app.includes('getMessages(convId, MESSAGE_PAGE_SIZE, firstMessage.created_at)'));
  assert.ok(app.includes('hasMoreMessages={hasMoreMessages}'));
  assert.equal(app.includes('hasMoreMessages={false}'), false);
});

test('message pagination fetches the latest page and then older pages', async () => {
  const db = await source('src/services/db.ts');

  assert.ok(db.includes('ORDER BY created_at DESC'));
  assert.ok(db.includes('LIMIT ?'));
  assert.ok(db.includes(') ORDER BY created_at ASC'));
  assert.ok(db.includes('created_at < ?'));
});

test('message list preserves viewport when older history is prepended', async () => {
  const messageList = await source('src/components/chat/MessageList.tsx');
  const chatScroll = await source('src/hooks/useChatScroll.ts');

  assert.ok(messageList.includes('pendingPrependScrollRef'));
  assert.ok(messageList.includes('useLayoutEffect'));
  assert.ok(messageList.includes('container.scrollTop = pending.scrollTop + heightDelta'));
  assert.ok(chatScroll.includes('didPrependHistory'));
  assert.ok(chatScroll.includes('!didPrependHistory'));
});

test('right-side quick jump is height capped and scrollable', async () => {
  const mainChatArea = await source('src/components/chat/MainChatArea.tsx');

  assert.ok(mainChatArea.includes("maxHeight: 'min(64vh, 420px)'"));
  assert.ok(mainChatArea.includes("overflowY: isNavHovered ? 'auto' : 'hidden'"));
  assert.ok(mainChatArea.includes("overscrollBehavior: 'contain'"));
  assert.ok(mainChatArea.includes('onWheel={(e) => { if (isNavHovered) e.stopPropagation(); }}'));
});
