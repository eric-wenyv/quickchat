import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';

async function importArtifactUtils() {
  const source = await readFile(new URL('../src/utils/artifacts.ts', import.meta.url), 'utf8');
  const transformed = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;

  const dir = join(tmpdir(), 'quick-chat-tests');
  await mkdir(dir, { recursive: true });
  const modulePath = join(dir, `artifacts-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(modulePath, transformed);
  return import(`file:///${modulePath.replaceAll('\\', '/')}`);
}

test('recognizes complete interactive html blocks as renderable artifacts', async () => {
  const { isRenderableHtmlArtifact } = await importArtifactUtils();
  const code = `<!doctype html>
<html>
<head><title>CLOCK Demo</title><style>button{padding:8px}</style></head>
<body>
  <button id="next">Next</button>
  <script>document.getElementById('next').addEventListener('click', () => {})</script>
</body>
</html>`;

  assert.equal(isRenderableHtmlArtifact(code, 'html'), true);
});

test('does not treat short static html snippets as artifacts', async () => {
  const { isRenderableHtmlArtifact } = await importArtifactUtils();

  assert.equal(isRenderableHtmlArtifact('<span class="note">hello</span>', 'html'), false);
  assert.equal(isRenderableHtmlArtifact('<button>Next</button>', 'text'), false);
});

test('builds a sandbox-friendly srcdoc with csp metadata', async () => {
  const { buildArtifactSrcDoc } = await importArtifactUtils();
  const srcDoc = buildArtifactSrcDoc('<button>Next</button><script>console.log(1)</script>');

  assert.match(srcDoc, /<!doctype html>/i);
  assert.match(srcDoc, /Content-Security-Policy/);
  assert.match(srcDoc, /connect-src 'none'/);
  assert.match(srcDoc, /<body>/);
});

test('injects borderless host integration styles', async () => {
  const { buildArtifactSrcDoc } = await importArtifactUtils();
  const srcDoc = buildArtifactSrcDoc('<main class="app"><button>Next</button></main>');

  assert.match(srcDoc, /body > :where\(\.app, #app, \.container/);
  assert.match(srcDoc, /background: transparent !important/);
  assert.match(srcDoc, /border-color: transparent !important/);
});

test('injects reusable artifact layout primitives', async () => {
  const { buildArtifactSrcDoc } = await importArtifactUtils();
  const srcDoc = buildArtifactSrcDoc('<main class="qc-artifact"><div class="qc-artifact-layout"><section class="qc-artifact-canvas"></section></div></main>');

  assert.match(srcDoc, /body :where\(\.qc-artifact\)/);
  assert.match(srcDoc, /grid-template-columns: minmax\(0, 1fr\) minmax\(260px, 360px\)/);
  assert.match(srcDoc, /body :where\(\.qc-artifact-canvas\)/);
  assert.match(srcDoc, /body :where\(\.qc-artifact-log\),/);
});

test('splits raw qc artifact fragments outside markdown fences', async () => {
  const { splitRenderableHtmlArtifacts } = await importArtifactUtils();
  const raw = [
    'Intro text',
    '',
    '<main class="qc-artifact"><button id="next">Next</button></main><script>document.getElementById("next").addEventListener("click", () => {})</script>',
    '',
    'Outro text',
  ].join('\n');

  const segments = splitRenderableHtmlArtifacts(raw);

  assert.equal(segments.length, 3);
  assert.deepEqual(segments.map((segment) => segment.type), ['markdown', 'artifact', 'markdown']);
  assert.match(segments[0].content, /Intro text/);
  assert.match(segments[1].content, /qc-artifact/);
  assert.match(segments[1].content, /<script>/);
  assert.equal(segments[1].language, 'html');
  assert.match(segments[2].content, /Outro text/);
});

test('does not split raw artifact markup inside markdown fences', async () => {
  const { splitRenderableHtmlArtifacts } = await importArtifactUtils();
  const fenced = [
    '```html',
    '<main class="qc-artifact"><button id="next">Next</button></main><script>document.getElementById("next").addEventListener("click", () => {})</script>',
    '```',
  ].join('\n');

  const segments = splitRenderableHtmlArtifacts(fenced);

  assert.equal(segments.length, 1);
  assert.equal(segments[0].type, 'markdown');
  assert.match(segments[0].content, /```html/);
});

test('keeps artifact layout primitives overridable', async () => {
  const { buildArtifactSrcDoc } = await importArtifactUtils();
  const srcDoc = buildArtifactSrcDoc('<main class="qc-artifact"><div class="qc-artifact-canvas" style="display:flex"></div></main>');

  assert.doesNotMatch(srcDoc, /display: grid !important/);
  assert.doesNotMatch(srcDoc, /display: flex !important/);
  assert.match(srcDoc, /body :where\(\.qc-artifact-canvas\) \{[\s\S]*display: flex;/);
  assert.match(srcDoc, /body :where\(\.qc-artifact-canvas\) \{[\s\S]*min-height: 0;/);
});

test('injects frame bounds that prevent fixed-width artifacts from leaking out', async () => {
  const { buildArtifactSrcDoc } = await importArtifactUtils();
  const srcDoc = buildArtifactSrcDoc('<main class="qc-artifact"><div class="qc-artifact-layout"><section class="qc-artifact-canvas"><svg width="2000"></svg></section></div></main>');

  assert.match(srcDoc, /body > :first-child \{[\s\S]*max-width: 100% !important;[\s\S]*min-width: 0 !important;/);
  assert.match(srcDoc, /body :where\(\.qc-artifact\) \{[\s\S]*max-width: 100% !important;[\s\S]*min-width: 0 !important;/);
  assert.match(srcDoc, /body :where\(\.qc-artifact-layout\) \{[\s\S]*max-width: 100% !important;[\s\S]*min-width: 0 !important;/);
  assert.match(srcDoc, /body :where\(\.qc-artifact-canvas\) \{[\s\S]*overflow: hidden;/);
  assert.match(srcDoc, /body :where\(svg, canvas, img, video\) \{[\s\S]*max-width: 100% !important;/);
});

test('keeps interactive controls visible by default and hides them only on opt-out', async () => {
  const { buildArtifactSrcDoc } = await importArtifactUtils();
  const srcDoc = buildArtifactSrcDoc('<main class="qc-artifact"><input type="range"><select></select></main>');

  // 旧的"默认隐藏、opt-in 才显示"选择器不应再出现
  assert.doesNotMatch(srcDoc, /:not\(\[data-allow-inputs="true"\]\)/);
  assert.doesNotMatch(srcDoc, /:not\(\[data-allow-autoplay="true"\]\)/);
  // 交互控件默认可见，仅在 artifact 显式声明 ="false" 时隐藏
  assert.match(srcDoc, /\.qc-artifact\[data-allow-inputs="false"\] input/);
  assert.match(srcDoc, /\.qc-artifact\[data-allow-inputs="false"\] select/);
  assert.match(srcDoc, /\.qc-artifact\[data-allow-autoplay="false"\] input\[type="range"\]/);
  // 注入的 runtime 策略脚本与 CSS 语义一致
  assert.match(srcDoc, /optedOut\(root, 'data-allow-inputs'\)/);
  assert.match(srcDoc, /optedOut\(root, 'data-allow-autoplay'\)/);
  assert.doesNotMatch(srcDoc, /!optedIn\(root, 'data-allow-inputs'\)/);
  assert.doesNotMatch(srcDoc, /!optedIn\(root, 'data-allow-autoplay'\)/);
});

test('keeps execution logs hidden unless the artifact opts in', async () => {
  const { buildArtifactSrcDoc } = await importArtifactUtils();
  const srcDoc = buildArtifactSrcDoc('<main class="qc-artifact"><div class="log"></div></main>');

  assert.match(srcDoc, /body :where\(\.qc-artifact-log\),\s*body :where\(\.log, \.logs, \.execution-log, \.console-log, \[data-role="log"\], \[data-qc-policy-hidden="true"\]\) \{[\s\S]*display: none !important;/);
  assert.match(srcDoc, /\.qc-artifact\[data-allow-logs="true"\] \.qc-artifact-log/);
  assert.match(srcDoc, /optedIn\(root, 'data-allow-logs'\)/);
});

test('fullscreen fit maximizes uniform scale inside a 24px inset and centers the whole app', async () => {
  const { fitArtifactToViewport } = await importArtifactUtils();
  const cases = [
    [{ width: 600, height: 400 }, { width: 1200, height: 1000 }, { scale: 1.92, x: 24, y: 116 }],
    [{ width: 600, height: 400 }, { width: 1200, height: 600 }, { scale: 1.38, x: 186, y: 24 }],
    [{ width: 1600, height: 1200 }, { width: 800, height: 600 }, { scale: 0.46, x: 32, y: 24 }],
    [{ width: 600, height: 1200 }, { width: 420, height: 600 }, { scale: 0.46, x: 72, y: 24 }],
  ];
  for (const [content, viewport, expected] of cases) {
    const fit = fitArtifactToViewport(content, viewport);
    for (const key of ['scale', 'x', 'y']) assert.ok(Math.abs(fit[key] - expected[key]) < 1e-9);
  }
});

test('fullscreen fit stays inside fractional viewport bounds and handles unmeasured sizes', async () => {
  const { fitArtifactToViewport } = await importArtifactUtils();
  const content = { width: 600, height: 462 };
  const viewport = { width: 1128, height: 791.953125 };
  const fit = fitArtifactToViewport(content, viewport);
  assert.ok(fit.x >= 24 && fit.y >= 24);
  assert.ok(fit.x + content.width * fit.scale <= viewport.width - 24);
  assert.ok(fit.y + content.height * fit.scale <= viewport.height - 24);
  assert.deepEqual(fitArtifactToViewport(content, { width: 48, height: 32 }), {
    scale: 16 / 462, x: (48 - 600 * 16 / 462) / 2, y: 8,
  });
  for (const invalid of [0, -1, NaN, Infinity]) {
    assert.deepEqual(fitArtifactToViewport(content, { width: invalid, height: 800 }), { scale: 0, x: 0, y: 0 });
    assert.deepEqual(fitArtifactToViewport({ width: 600, height: invalid }, viewport), { scale: 0, x: 0, y: 0 });
  }
});

test('artifact runtime reports natural content dimensions without counting viewport whitespace', async () => {
  const { buildArtifactSrcDoc } = await importArtifactUtils();
  const srcDoc = buildArtifactSrcDoc('<main class="qc-artifact">Demo</main>', 'size-test');
  const { document, HTMLElement } = parseHTML(srcDoc);
  const { body, documentElement: html } = document;
  let contentHeight = 320;
  for (const child of body.children) child.getBoundingClientRect = () => ({ right: 600, bottom: contentHeight });
  Object.defineProperties(body, {
    scrollWidth: { value: 600, writable: true }, offsetWidth: { value: 600, writable: true },
    scrollHeight: { get: () => contentHeight }, offsetHeight: { get: () => contentHeight },
  });
  Object.defineProperties(html, { clientWidth: { value: 600 }, scrollHeight: { value: 2000 } });
  const messages = [];
  const listeners = {};
  let frame;
  const window = {
    parent: { postMessage: (message) => messages.push(message) },
    addEventListener: (name, callback) => { listeners[name] = callback; },
  };
  runInNewContext(document.querySelector('[data-quick-chat-artifact-runtime]').textContent, {
    window, document, HTMLElement, requestAnimationFrame: (callback) => { frame = callback; }, setTimeout() {},
  });
  frame();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].width, 600);
  assert.equal(messages[0].height, 320);
  assert.equal(messages[0].artifactId, 'size-test');
  body.scrollWidth = body.offsetWidth = 800;
  listeners.resize();
  frame();
  assert.equal(messages.length, 2, 'a width-only change must report a new size');
  assert.equal(messages[1].width, 800);
  assert.equal(messages[1].height, 320);
  contentHeight = 80;
  listeners.resize();
  frame();
  assert.equal(messages[2].height, 80, 'preview minimum height must not add blank space to fullscreen fitting');
});
