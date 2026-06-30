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
