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
  assert.doesNotMatch(sidebar, /Agent/);
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
  assert.match(modelSelector, /h-8/);
  assert.match(thinkingSelector, /h-8/);
  assert.match(composer, /rounded-2xl/);
  assert.match(composer, /focus-within:shadow-\[0_0_0_1px_rgba\(255,255,255,0\.06\),0_18px_54px_rgba\(0,0,0,0\.34\)\]/);
  assert.match(modelSelector, /cursor-pointer/);
  assert.match(thinkingSelector, /cursor-pointer/);
  assert.match(modelSelector, /className=\{`group flex h-8 items-center gap-1\.5 rounded-full px-3/);
  assert.match(thinkingSelector, /className=\{`flex h-8 items-center gap-1\.5 rounded-full px-3/);
  assert.match(modelSelector, /bg-transparent text-linear-text-tertiary hover:bg-linear-surface-hover/);
  assert.match(thinkingSelector, /bg-transparent text-linear-text-tertiary hover:bg-linear-surface-hover/);
  assert.doesNotMatch(modelSelector, /border border-\[rgba\(255,255,255,0\.16\)\]/);
  assert.doesNotMatch(thinkingSelector, /border border-\[rgba\(255,255,255,0\.16\)\]/);
  assert.match(modelSelector, /className=\{`group w-full flex items-center justify-between gap-1\.5 px-3 py-2\.5 rounded-2xl text-left transition-colors cursor-pointer/);
  assert.match(thinkingSelector, /className=\{`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors duration-150 cursor-pointer/);
  assert.match(modelSelector, /role="menu"/);
  assert.match(thinkingSelector, /role="menu"/);
  // ModelSelector 弹层已从阴影改为描边（border-linear-border）；ThinkingLevelSelector 保留阴影。
  assert.match(modelSelector, /border border-linear-border/);
  assert.doesNotMatch(modelSelector, /providerBadge/);
  assert.match(thinkingSelector, /shadow-\[0_18px_45px_rgba\(0,0,0,0\.32\)\]/);
  assert.match(modelSelector, /text-linear-text-primary/);
  assert.match(thinkingSelector, /text-linear-text-primary/);
  assert.doesNotMatch(modelSelector, /animate-ping/);
  assert.doesNotMatch(modelSelector, /w-2 h-2 rounded-full/);
  assert.doesNotMatch(thinkingSelector, /rounded-full \$\{LEVEL_COLORS/);
});

test('toast matches the main graphite surface language', async () => {
  const app = await source('src/App.tsx');

  assert.match(app, /role=\{toast\.type === 'error' \? "alert" : "status"\}/);
  assert.match(app, /bg-\[#2D2D2D\]\/95/);
  assert.match(app, /rounded-2xl/);
  assert.match(app, /shadow-\[0_18px_48px_rgba\(0,0,0,0\.28\)\]/);
  assert.doesNotMatch(app, /shadow-2xl/);
  assert.doesNotMatch(app, /shadow-\[0_0_8px_currentColor\]/);
});

test('assistant instructions prohibit compact inline tree diagrams', async () => {
  const app = await source('src/App.tsx');

  assert.match(app, /Never use inline-code pseudo-diagrams/);
  assert.match(app, /ASCII\/Unicode tree, branch, box, or connector characters/);
  assert.match(app, /short bullets or a table for structured data/);
  assert.match(app, /fenced Mermaid diagram/);
  assert.match(app, /Never put an explanatory diagram or a long structured summary inside single backticks/);
});

test('artifact fullscreen surfaces share window shell and mermaid pan zoom', async () => {
  const messageContent = await source('src/components/chat/MessageContent.tsx');
  const htmlArtifact = await source('src/components/chat/HtmlArtifact.tsx');
  const appCss = await source('src/App.css');

  assert.match(messageContent, /ArtifactFullscreenShell/);
  assert.match(htmlArtifact, /ArtifactFullscreenShell/);
  assert.doesNotMatch(messageContent, /qc-mermaid-fullscreen-viewport/);
  assert.doesNotMatch(appCss, /qc-mermaid-fullscreen-viewport/);
  assert.match(messageContent, /event\.ctrlKey/);
  assert.match(messageContent, /parseMermaidSvgSize/);
  assert.match(messageContent, /viewBox=\["'\]\(\[\^"'\]\+\)\["'\]/);
  assert.match(messageContent, /width: svgSize\.width/);
  assert.match(messageContent, /height: svgSize\.height/);
  assert.match(messageContent, /onPointerDown=\{handlePointerDown\}/);
  assert.match(messageContent, /onPointerMove=\{handlePointerMove\}/);
  assert.match(messageContent, /setPointerCapture/);
  assert.match(messageContent, /releasePointerCapture/);
});

test('rich output stays inside the app viewport instead of creating page scrollbars', async () => {
  const messageContent = await source('src/components/chat/MessageContent.tsx');
  const htmlArtifact = await source('src/components/chat/HtmlArtifact.tsx');
  const appCss = await source('src/App.css');

  assert.match(appCss, /html,\s*body,\s*#root \{[\s\S]*margin: 0;[\s\S]*overflow: hidden;/);
  assert.match(appCss, /\.qc-markdown \{[\s\S]*max-width: 100%;/);
  const mermaidStyles = appCss.match(/\.qc-mermaid \{([^}]*)\}/)?.[1];
  assert.ok(mermaidStyles);
  assert.match(mermaidStyles, /max-width: 100%;/);
  assert.match(mermaidStyles, /overflow: auto;/);
  assert.doesNotMatch(mermaidStyles, /overscroll-behavior:/);
  assert.match(messageContent, /w-full min-w-0 max-w-full/);
  assert.match(messageContent, /qc-markdown prose prose-sm min-w-0 max-w-full/);
  assert.match(htmlArtifact, /relative my-3 w-full max-w-full overflow-hidden/);
  assert.doesNotMatch(htmlArtifact, /-mx-1/);
  assert.doesNotMatch(htmlArtifact, /md:-mx-2/);
});

test('sidebar grid width and opacity transition together without reflowing labels', async () => {
  const appLayout = await source('src/components/layout/AppLayout.tsx');
  const newChatButton = await source('src/components/sidebar/NewChatButton.tsx');
  const searchBar = await source('src/components/sidebar/SearchBar.tsx');
  const messageHeader = await source('src/components/chat/MessageHeader.tsx');
  const emptyState = await source('src/components/chat/EmptyState.tsx');

  assert.match(appLayout, /transition-\[grid-template-columns\] duration-300/);
  assert.match(appLayout, /gridTemplateColumns: isSidebarOpen \? `\$\{sidebarWidth\}px minmax\(0, 1fr\)` : '0px minmax\(0, 1fr\)'/);
  assert.match(appLayout, /style=\{\{ width: sidebarWidth, minWidth: sidebarWidth \}\}/);
  assert.match(appLayout, /contentLayout\.style\.gridTemplateColumns = `\$\{width\}px minmax\(0, 1fr\)`/);
  assert.match(appLayout, /willChange: 'grid-template-columns'/);
  assert.match(appLayout, /const sidebarContentRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(appLayout, /const sidebarResizeHandleRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(appLayout, /sidebarContent\.style\.width = `\$\{width\}px`/);
  assert.match(appLayout, /sidebarResizeHandle\.style\.left = `\$\{width\}px`/);
  assert.match(appLayout, /relative isolate grid min-h-0 flex-1 transition-\[grid-template-columns\]/);
  assert.match(appLayout, /zIndex: 20/);
  assert.match(appLayout, /relative z-0 flex flex-col/);
  assert.doesNotMatch(appLayout, /isSidebarVisible/);
  assert.match(appLayout, /overflow-hidden/);
  assert.match(appLayout, /border-t border-linear-border border-l transition-colors/);
  assert.match(appLayout, /isSidebarOpen \? 'rounded-tl-xl' : 'rounded-tl-none'/);
  assert.match(appLayout, /border-l-linear-border-hover/);
  assert.doesNotMatch(appLayout, /hover:bg-linear-surface-hover active:bg-linear-border-hover/);
  assert.doesNotMatch(appLayout, /overflow-visible/);
  assert.match(appLayout, /codex-glass-chrome relative min-w-0 h-full overflow-hidden transition-opacity duration-300/);
  assert.match(appLayout, /isSidebarOpen \? 'opacity-100' : 'opacity-0 pointer-events-none'/);
  assert.match(appLayout, /transition-\[left,opacity\] duration-300/);
  assert.match(appLayout, /style=\{\{ left: isSidebarOpen \? sidebarWidth : 0 \}\}/);
  assert.ok(appLayout.indexOf('</aside>') < appLayout.indexOf('ref={sidebarResizeHandleRef}'));
  assert.doesNotMatch(appLayout, /left-full/);
  assert.match(newChatButton, /whitespace-nowrap/);
  assert.match(searchBar, /whitespace-nowrap/);
  assert.match(messageHeader, /text-\[15px\]/);
  assert.doesNotMatch(messageHeader, /md:text-lg/);
  assert.match(emptyState, /text-\[28px\]/);
});
