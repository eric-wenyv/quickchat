import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ts from 'typescript';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

// 无边框窗口的 -webkit-app-region: drag 区域（菜单栏 / 会话头部）按元素矩形
// 注册，全屏遮罩不会自动让它们失效。遮罩若不声明 no-drag，遮罩标题栏上的
// 真实鼠标点击会被窗口拖动逻辑吞掉：关闭 / 复制等按钮全部无响应，表现为
// "全屏后整个应用卡死"。这里锁定这一行为，避免后续回归。
// 在遮罩内部显式恢复标题栏和上方空隙的 drag，按钮及内容仍须使用 no-drag。
test('fullscreen overlay opts out of frameless window drag regions', async () => {
  const shell = await source('src/components/chat/ArtifactFullscreenShell.tsx');

  assert.match(shell, /role="dialog"/);
  assert.match(shell, /className="fixed inset-0 z-\[220\]/);
  assert.match(shell, /WebkitAppRegion:\s*'no-drag'/);
});

test('both fullscreen viewers go through the shared no-drag shell', async () => {
  const [messageContent, htmlArtifact] = await Promise.all([
    source('src/components/chat/MessageContent.tsx'),
    source('src/components/chat/HtmlArtifact.tsx'),
  ]);

  // Mermaid 全屏与 HTML 小程序全屏都复用 ArtifactFullscreenShell
  assert.match(messageContent, /<ArtifactFullscreenShell/);
  assert.match(htmlArtifact, /<ArtifactFullscreenShell/);
});

test('link preview overlay also opts out of window drag regions', async () => {
  const messageContent = await source('src/components/chat/MessageContent.tsx');
  const overlayStart = messageContent.indexOf('className="fixed inset-0 z-[200]');
  assert.ok(overlayStart >= 0, 'link preview overlay should exist');

  const overlayTag = messageContent.slice(overlayStart, messageContent.indexOf('onClick={onClose}', overlayStart));
  assert.match(overlayTag, /WebkitAppRegion:\s*'no-drag'/);
});

test('fullscreen shell separates window dragging, toolbar actions and backdrop dismissal', async (t) => {
  const buildRoot = fileURLToPath(new URL('./.transpiled/', import.meta.url));
  await mkdir(buildRoot, { recursive: true });
  const dir = await mkdtemp(join(buildRoot, 'fullscreen-shell-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { outputText } = ts.transpileModule(await source('src/components/chat/ArtifactFullscreenShell.tsx'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const modulePath = join(dir, 'shell.mjs');
  await writeFile(modulePath, outputText);
  const { default: Shell } = await import(pathToFileURL(modulePath));
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  const globals = { window, document, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, globals);
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  let closes = 0;
  let copies = 0;
  const onClose = () => closes++;
  await act(async () => root.render(React.createElement(Shell, {
    title: 'Demo', onClose,
    actions: React.createElement(React.Fragment, null,
      React.createElement('button', { id: 'copy', onClick: () => copies++ }, 'Copy'),
      React.createElement('button', { id: 'close', onClick: onClose }, 'Close')),
  }, React.createElement('button', { id: 'app-control' }, 'App control'))));
  const dialog = document.querySelector('[role="dialog"]');
  const topGap = dialog.firstElementChild;
  const header = dialog.querySelector('header');
  const actions = document.getElementById('copy').parentElement;
  const content = document.getElementById('app-control').parentElement;
  assert.equal(dialog.style.WebkitAppRegion, 'no-drag');
  assert.equal(topGap.style.WebkitAppRegion, 'drag');
  assert.equal(header.style.WebkitAppRegion, 'drag');
  assert.equal(actions.style.WebkitAppRegion, 'no-drag');
  assert.equal(content.style.WebkitAppRegion, 'no-drag');
  assert.ok(topGap.classList.contains('h-[4vh]'), 'the drag strip must match the gap above the 92vh panel');
  const click = async (target, position = {}) => {
    const event = new window.Event('click', { bubbles: true });
    Object.assign(event, position);
    await act(async () => target.dispatchEvent(event));
  };
  await click(topGap);
  await click(header);
  await click(document.getElementById('app-control'));
  assert.equal(closes, 0, 'top gap, title bar and application content must not dismiss fullscreen');
  await click(document.getElementById('copy'));
  assert.equal(copies, 1);
  assert.equal(closes, 0, 'toolbar actions must not bubble into backdrop dismissal');
  await click(document.getElementById('close'));
  assert.equal(closes, 1);
  for (const position of [{ clientX: 5, clientY: 400 }, { clientX: 995, clientY: 400 }, { clientX: 500, clientY: 795 }]) {
    await click(dialog, position);
  }
  assert.equal(closes, 4, 'left, right and bottom backdrop clicks must dismiss fullscreen');
  const escape = new window.Event('keydown');
  escape.key = 'Escape';
  await act(async () => document.dispatchEvent(escape));
  assert.equal(closes, 5);
});
