import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ts from 'typescript';

async function loadFrame(t) {
  const buildRoot = fileURLToPath(new URL('./.transpiled/', import.meta.url));
  await mkdir(buildRoot, { recursive: true });
  const dir = await mkdtemp(join(buildRoot, 'html-artifact-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const modules = [
    ['artifacts', '../src/utils/artifacts.ts'],
    ['shell', '../src/components/chat/ArtifactFullscreenShell.tsx'],
    ['frame', '../src/components/chat/HtmlArtifact.tsx'],
  ];
  for (const [name, path] of modules) {
    let source = await readFile(new URL(path, import.meta.url), 'utf8');
    if (name === 'frame') {
      source = source.replace("from '@/utils/artifacts'", "from './artifacts.mjs'")
        .replace("from './ArtifactFullscreenShell'", "from './shell.mjs'");
      source += '\nexport { ArtifactFrame };';
    }
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    });
    await writeFile(join(dir, `${name}.mjs`), outputText);
  }
  return (await import(pathToFileURL(join(dir, 'frame.mjs')))).ArtifactFrame;
}

async function mountFrame(t, { fit = true } = {}) {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  let viewport = { width: 1200, height: 1000 };
  const observers = new Set();
  window.HTMLElement.prototype.getBoundingClientRect = () => viewport;
  const globals = {
    window, document, IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { observers.add(this.callback); }
      disconnect() { observers.delete(this.callback); }
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
  const Frame = await loadFrame(t);
  root = createRoot(document.getElementById('root'));
  const sizes = [];
  await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Frame, {
    artifactId: 'fit-test', srcDoc: '<main>Demo</main>', title: 'Demo', reloadKey: 0,
    fitSize: fit ? { width: 600, height: 400 } : undefined,
    onSizeChange: (size) => sizes.push(size),
  }))));
  const frame = document.querySelector('iframe');
  Object.defineProperty(frame, 'contentWindow', { value: {} });
  await act(async () => frame.dispatchEvent(new window.Event('load')));
  const message = async (data, source = frame.contentWindow) => {
    const event = new window.Event('message');
    Object.assign(event, { source, data: { type: 'quick-chat-artifact-size', artifactId: 'fit-test', ...data } });
    await act(async () => window.dispatchEvent(event));
  };
  const resize = async (size) => {
    viewport = size;
    await act(async () => observers.forEach((callback) => callback()));
  };
  return { document, frame, message, resize, sizes };
}

test('fullscreen scales and centers the complete iframe without reloading on resize', async (t) => {
  const { document, frame, resize } = await mountFrame(t);
  assert.equal(frame.style.width, '600px');
  assert.equal(frame.style.height, '400px');
  assert.equal(frame.style.maxWidth, 'none');
  assert.equal(frame.style.transform, 'scale(1.92)');
  assert.equal(frame.style.left, '24px');
  assert.equal(frame.style.top, '116px');
  await resize({ width: 800, height: 400 });
  assert.equal(frame.style.transform, 'scale(0.88)');
  assert.equal(frame.style.left, '136px');
  assert.equal(frame.style.top, '24px');
  await resize({ width: 300, height: 600 });
  assert.equal(frame.style.transform, 'scale(0.42)');
  assert.equal(frame.style.left, '24px');
  assert.equal(frame.style.top, '216px');
  assert.equal(document.querySelector('iframe'), frame, 'resizing must preserve the running mini-app');
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts allow-forms');
});

test('fullscreen refits when application content grows or shrinks', async (t) => {
  const { frame, message } = await mountFrame(t);
  await message({ width: 600, height: 2000 });
  assert.equal(frame.style.height, '2000px');
  assert.equal(frame.style.transform, 'scale(0.476)');
  assert.ok(Math.abs(Number.parseFloat(frame.style.left) - 457.2) < 1e-9);
  assert.equal(frame.style.top, '24px');
  await message({ width: 600, height: 400 });
  assert.equal(frame.style.transform, 'scale(1.92)');
  assert.equal(frame.style.top, '116px');
});

test('size updates require valid dimensions from this iframe and artifact', async (t) => {
  const { frame, message, sizes } = await mountFrame(t);
  await message({ width: 600, height: 2000 }, {});
  await message({ artifactId: 'another-artifact', width: 600, height: 2000 });
  for (const invalid of [0, -100, Infinity, NaN]) await message({ width: 600, height: invalid });
  assert.equal(frame.style.transform, 'scale(1.92)');
  assert.equal(sizes.length, 0);
  await message({ width: 800, height: 400 });
  assert.deepEqual(sizes, [{ width: 800, height: 400 }]);
});

test('inline previews report content dimensions without fullscreen scaling', async (t) => {
  const { frame, message, sizes } = await mountFrame(t, { fit: false });
  await message({ width: 640, height: 360 });
  assert.deepEqual(sizes, [{ width: 640, height: 360 }]);
  assert.ok(!frame.style.transform);
  assert.ok(!frame.style.position);
});
