import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

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
