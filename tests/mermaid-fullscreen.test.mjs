import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ts from 'typescript';

// 加载实际的全屏组件，隔离消息渲染、桌面桥和高亮 Worker 等无关依赖。
async function loadModal(t) {
  const buildRoot = fileURLToPath(new URL('./.transpiled/', import.meta.url));
  await mkdir(buildRoot, { recursive: true });
  const dir = await mkdtemp(join(buildRoot, 'mermaid-fullscreen-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const message = await readFile(new URL('../src/components/chat/MessageContent.tsx', import.meta.url), 'utf8');
  const shell = await readFile(new URL('../src/components/chat/ArtifactFullscreenShell.tsx', import.meta.url), 'utf8');
  const start = message.indexOf('const MERMAID_MIN_SCALE');
  const end = message.indexOf('// Mermaid 渲染是全量布局计算');
  assert.ok(start > 0 && end > start);
  const source = `
    import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
    import { createPortal } from 'react-dom';
    import ArtifactFullscreenShell from './shell.mjs';
    ${message.slice(start, end)}
    export default MermaidFullscreenModal;
  `;
  for (const [name, text] of [['modal', source], ['shell', shell]]) {
    const { outputText } = ts.transpileModule(text, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    });
    await writeFile(join(dir, `${name}.mjs`), outputText);
  }
  return (await import(pathToFileURL(join(dir, 'modal.mjs')))).default;
}

async function mountModal(t, { raster = true, width = 240, height = 160 } = {}) {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  const frames = new Map();
  const draws = [];
  let frameId = 0;
  const bounds = { left: 20, top: 70, width: 800, height: 600 };
  const captured = new Set();
  window.HTMLElement.prototype.getBoundingClientRect = () => bounds;
  window.HTMLElement.prototype.setPointerCapture = (id) => captured.add(id);
  window.HTMLElement.prototype.hasPointerCapture = (id) => captured.has(id);
  window.HTMLElement.prototype.releasePointerCapture = (id) => captured.delete(id);
  window.HTMLCanvasElement.prototype.getContext = function () {
    return {
      setTransform() {}, clearRect() {},
      drawImage: (...args) => {
        if (this.className === 'qc-mermaid-pan-canvas') draws.push(args);
      },
    };
  };
  const globals = {
    window, document, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (callback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id) => frames.delete(id),
    ResizeObserver: class { observe() {} disconnect() {} },
    Image: class {
      set src(_value) { queueMicrotask(() => raster ? this.onload() : this.onerror()); }
    },
  };
  const saved = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, globals);
  let root;
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const Modal = await loadModal(t);
  root = createRoot(document.getElementById('root'));
  let copies = 0;
  let closes = 0;
  await act(async () => {
    root.render(React.createElement(React.StrictMode, null, React.createElement(Modal, {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" /></svg>`,
      copied: false, onCopy: () => copies++, onClose: () => closes++,
    })));
  });
  const viewport = document.querySelector('.qc-mermaid-pan-viewport');
  async function flush() {
    await act(async () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    });
  }
  async function dispatch(type, values = {}, target = viewport) {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { button: 0, pointerId: 1, clientX: 420, clientY: 370, ...values });
    await act(async () => { target.dispatchEvent(event); });
    await flush();
    return event;
  }
  await flush();
  return { document, viewport, draws, captured, dispatch, copies: () => copies, closes: () => closes };
}

test('small fullscreen diagrams can be dragged after rasterization', async (t) => {
  const view = await mountModal(t);
  assert.ok(view.document.querySelector('canvas'));
  const before = view.draws.at(-1);
  assert.ok(before, 'the first frame must render under StrictMode without a mouse event');
  await view.dispatch('pointerdown');
  await view.dispatch('pointermove', { clientX: 480, clientY: 405 });
  const after = view.draws.at(-1);
  assert.equal(after[5] - before[5], 60);
  assert.equal(after[6] - before[6], 35);
  await view.dispatch('pointerup');
  assert.equal(view.captured.size, 0);
});

test('wheel zoom keeps the point under the cursor fixed', async (t) => {
  const view = await mountModal(t);
  const before = view.draws.at(-1);
  const event = await view.dispatch('wheel', { clientX: 360, clientY: 340, deltaY: -100, ctrlKey: true });
  const after = view.draws.at(-1);
  assert.ok(after[7] > before[7]);
  // 光标在视口内 (340, 270)，缩放前后对应图上的同一点。
  assert.ok(Math.abs((340 - before[5]) / before[7] - (340 - after[5]) / after[7]) < 1e-9);
  assert.ok(Math.abs((270 - before[6]) / before[8] - (270 - after[6]) / after[8]) < 1e-9);
  assert.equal(event.defaultPrevented, true);
});

test('large diagrams can move while keeping a visible edge inside the viewport', async (t) => {
  const view = await mountModal(t, { width: 1600, height: 1200 });
  await view.dispatch('pointerdown');
  await view.dispatch('pointermove', { clientX: 10000, clientY: 10000 });
  let draw = view.draws.at(-1);
  assert.equal(draw[5], 768);
  assert.equal(draw[6], 568);
  assert.equal(draw[7], 32);
  assert.equal(draw[8], 32);
  await view.dispatch('pointermove', { clientX: -10000, clientY: -10000 });
  draw = view.draws.at(-1);
  assert.equal(draw[5], 0);
  assert.equal(draw[6], 0);
  assert.equal(draw[7], 32);
  assert.equal(draw[8], 32);
  await view.dispatch('pointerup');
});

test('wheel zoom respects its minimum and maximum scale', async (t) => {
  const view = await mountModal(t);
  for (let i = 0; i < 30; i++) await view.dispatch('wheel', { deltaY: -100, ctrlKey: true });
  let draw = view.draws.at(-1);
  assert.ok(Math.abs(draw[7] / draw[3] * draw[0].width / 240 - 4) < 1e-9);
  for (let i = 0; i < 50; i++) await view.dispatch('wheel', { deltaY: 100, ctrlKey: true });
  draw = view.draws.at(-1);
  assert.ok(Math.abs(draw[7] / draw[3] * draw[0].width / 240 - 0.25) < 1e-9);
});

test('cancelled or lost pointer capture ends dragging', async (t) => {
  const view = await mountModal(t);
  for (const type of ['pointercancel', 'lostpointercapture']) {
    await view.dispatch('pointerdown');
    assert.ok(view.viewport.classList.contains('is-dragging'));
    await view.dispatch(type);
    assert.equal(view.captured.size, 0);
    assert.equal(view.viewport.classList.contains('is-dragging'), false);
    const count = view.draws.length;
    await view.dispatch('pointermove', { clientX: 460 });
    assert.equal(view.draws.length, count);
  }
});

test('vector fallback still supports dragging and wheel zoom', async (t) => {
  const view = await mountModal(t, { raster: false });
  assert.equal(view.document.querySelector('canvas'), null);
  await view.dispatch('pointerdown');
  await view.dispatch('pointermove', { clientX: 480, clientY: 405 });
  assert.equal(view.document.querySelector('.qc-mermaid-pan-layer').style.transform, 'translate(60px, 35px)');
  await view.dispatch('pointerup');
  await view.dispatch('wheel', { deltaY: -100, ctrlKey: true });
  assert.equal(view.document.querySelector('.qc-mermaid-pan-content').style.transform, 'scale(1.12)');
});

test('fullscreen toolbar actions still work after dragging and zooming', async (t) => {
  const view = await mountModal(t);
  await view.dispatch('pointerdown');
  await view.dispatch('pointermove', { clientX: 460 });
  await view.dispatch('pointerup');
  await view.dispatch('wheel', { deltaY: -100, ctrlKey: true });
  await view.dispatch('click', {}, view.document.querySelector('[title="复制 Mermaid 源码"]'));
  assert.equal(view.copies(), 1);
  assert.equal(view.closes(), 0);
  await view.dispatch('click', {}, view.document.querySelector('[title="关闭全屏"]'));
  assert.equal(view.closes(), 1);
});
