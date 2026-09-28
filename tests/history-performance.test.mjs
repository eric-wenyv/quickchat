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
  // 首屏只取最近一页快速渲染，剩余部分由后台任务补齐到 MESSAGE_PAGE_SIZE
  assert.ok(app.includes('const INITIAL_MESSAGE_PAGE_SIZE = 30;'));
  assert.ok(app.includes('getMessages(id, INITIAL_MESSAGE_PAGE_SIZE)'));
  assert.ok(app.includes('getMessages(id, MESSAGE_PAGE_SIZE - INITIAL_MESSAGE_PAGE_SIZE, oldestLoadedAt)'));
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

test('long conversations render progressively instead of one blocking commit', async () => {
  const messageList = await source('src/components/chat/MessageList.tsx');

  assert.ok(messageList.includes('INITIAL_RENDER_COUNT'));
  assert.ok(messageList.includes('RENDER_CHUNK_SIZE'));
  assert.ok(messageList.includes('messages.slice(firstRenderedIndex)'));
  // 向上扩展渲染窗口时必须补偿滚动位置，避免视口跳动
  assert.ok(messageList.includes('expansionAnchorRef'));
  // 窗口未补全时不触发向上分页，避免本地补渲染与 prepend 同时进行
  assert.ok(messageList.includes('!isFullyRendered'));
  // 按需扩窗：只在滚动接近窗口顶部时补渲染，不在后台把整页消息全部渲染掉
  assert.ok(messageList.includes('EXPANSION_TRIGGER_PX'));
  assert.ok(messageList.includes('expandWindowStep'));
  // 快速跳转到未渲染消息：先扩窗覆盖目标，再由布局阶段执行跳转
  assert.ok(messageList.includes('pendingJumpIndexRef'));
});

test('opening a conversation always scrolls to the page bottom', async () => {
  const [messageList, mainChatArea, appLayout, app] = await Promise.all([
    source('src/components/chat/MessageList.tsx'),
    source('src/components/chat/MainChatArea.tsx'),
    source('src/components/layout/AppLayout.tsx'),
    source('src/App.tsx'),
  ]);

  // 恢复阅读位置的链路已移除：打开会话统一由 MessageList 滚动到底部（即时定位）
  assert.ok(messageList.includes('container.scrollTo({ top: container.scrollHeight'));
  // 打开会话的滚动在绘制前（useLayoutEffect）同步完成，避免先闪一帧顶部再跳到底部
  assert.ok(messageList.includes('useLayoutEffect(() => {\n      if (messages.length === 0)'));
  // 异步渲染（高亮/Mermaid/图片/KaTeX）撑高内容时钉住底部，用户上滚后解除
  assert.ok(messageList.includes('pinToBottomRef'));
  assert.ok(messageList.includes('ResizeObserver'));
  assert.ok(messageList.includes('PIN_RELEASE_THRESHOLD_PX'));
  assert.ok(!messageList.includes('restoreScrollMessageId'));
  assert.ok(!mainChatArea.includes('scrollRestoreMessageId'));
  assert.ok(!mainChatArea.includes('onActiveMessageIdChange'));
  assert.ok(!appLayout.includes('scrollRestoreMessageId'));
  assert.ok(!app.includes('scrollRestoreMessageId'));
  assert.ok(!app.includes('setScrollRestoreMessageId'));
});
