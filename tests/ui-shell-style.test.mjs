import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Codex shell chrome is owned by the app layout', async () => {
  const appLayout = await source('src/components/layout/AppLayout.tsx');

  assert.match(appLayout, /CodexMenuBar/);
  assert.doesNotMatch(appLayout, /\['文件', '编辑', '查看', '窗口', '帮助'\]/);
  assert.doesNotMatch(appLayout, /aria-label="后退"/);
  assert.doesNotMatch(appLayout, /aria-label="前进"/);
  assert.match(appLayout, /appWindow\.minimize/);
  assert.match(appLayout, /appWindow\.toggleMaximize/);
  assert.match(appLayout, /appWindow\.close/);
});

test('sidebar keeps real quick-chat actions without fake Codex sections', async () => {
  const sidebar = await source('src/components/sidebar/Sidebar.tsx');
  const conversationItem = await source('src/components/sidebar/ConversationItem.tsx');
  const conversationList = await source('src/components/sidebar/ConversationList.tsx');

  assert.match(sidebar, /SearchBar/);
  assert.match(sidebar, /onOpenAgentBrowser/);
  assert.doesNotMatch(sidebar, /插件/);
  assert.doesNotMatch(sidebar, /自动化/);
  assert.doesNotMatch(sidebar, /项目/);
  assert.doesNotMatch(conversationItem, /bg-linear-accent/);
  assert.doesNotMatch(conversationList, /开启新的灵感/);
  assert.doesNotMatch(conversationList, /AI 对话/);
});

test('composer keeps model, thinking and send controls without extra status chrome', async () => {
  const composer = await source('src/components/chat/ChatInputFooter.tsx');
  const sendButton = await source('src/components/chat/SendButton.tsx');
  const modelSelector = await source('src/components/chat/ModelSelector.tsx');
  const thinkingSelector = await source('src/components/chat/ThinkingLevelSelector.tsx');

  assert.match(composer, /ModelSelector/);
  assert.match(composer, /ThinkingLevelSelector/);
  assert.match(composer, /SendButton/);
  assert.doesNotMatch(composer, /Ready/);
  assert.doesNotMatch(sendButton, /bg-linear-accent/);
  assert.match(sendButton, /opacity-45/);
  assert.match(sendButton, /cursor-not-allowed/);
  assert.match(modelSelector, /providerBadge/);
  assert.match(modelSelector, /h-8/);
  assert.match(thinkingSelector, /h-8/);
  assert.match(composer, /focus-within:shadow-\[0_0_0_3px_rgba\(255,255,255,0\.08\),0_16px_40px_rgba\(0,0,0,0\.28\)\]/);
  assert.match(modelSelector, /cursor-pointer/);
  assert.match(thinkingSelector, /cursor-pointer/);
  assert.match(modelSelector, /className=\{`group flex h-8 items-center gap-1\.5 rounded-md px-2\.5/);
  assert.match(thinkingSelector, /className=\{`flex h-8 items-center gap-1\.5 rounded-md px-2\.5/);
  assert.match(modelSelector, /bg-transparent text-linear-text-tertiary hover:bg-linear-surface-hover/);
  assert.match(thinkingSelector, /bg-transparent text-linear-text-tertiary hover:bg-linear-surface-hover/);
  assert.doesNotMatch(modelSelector, /border border-\[rgba\(255,255,255,0\.16\)\]/);
  assert.doesNotMatch(thinkingSelector, /border border-\[rgba\(255,255,255,0\.16\)\]/);
  assert.match(modelSelector, /className=\{`group w-full flex items-center justify-between gap-3 px-3 py-2\.5 rounded-lg text-left transition-colors cursor-pointer/);
  assert.match(thinkingSelector, /className=\{`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors duration-150 cursor-pointer/);
  assert.match(modelSelector, /role="menu"/);
  assert.match(thinkingSelector, /role="menu"/);
  assert.match(modelSelector, /shadow-\[0_18px_45px_rgba\(0,0,0,0\.32\)\]/);
  assert.match(thinkingSelector, /shadow-\[0_18px_45px_rgba\(0,0,0,0\.32\)\]/);
  assert.match(modelSelector, /text-linear-text-primary/);
  assert.match(thinkingSelector, /text-linear-text-primary/);
  assert.doesNotMatch(modelSelector, /animate-ping/);
  assert.doesNotMatch(modelSelector, /w-2 h-2 rounded-full/);
  assert.doesNotMatch(thinkingSelector, /rounded-full \$\{LEVEL_COLORS/);
});

test('sidebar collapse clips fixed content instead of reflowing labels', async () => {
  const appLayout = await source('src/components/layout/AppLayout.tsx');
  const newChatButton = await source('src/components/sidebar/NewChatButton.tsx');
  const searchBar = await source('src/components/sidebar/SearchBar.tsx');
  const messageHeader = await source('src/components/chat/MessageHeader.tsx');
  const emptyState = await source('src/components/chat/EmptyState.tsx');

  assert.match(appLayout, /style=\{\{ minWidth: MIN_SIDEBAR_WIDTH \}\}/);
  assert.match(appLayout, /overflow-hidden/);
  assert.doesNotMatch(appLayout, /rounded-tl-xl border-l/);
  assert.match(newChatButton, /whitespace-nowrap/);
  assert.match(searchBar, /whitespace-nowrap/);
  assert.match(messageHeader, /text-\[15px\]/);
  assert.doesNotMatch(messageHeader, /md:text-lg/);
  assert.match(emptyState, /text-\[28px\]/);
});
