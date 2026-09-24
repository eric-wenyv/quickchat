import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

async function importClipboardImage() {
  const source = await readFile(new URL('../src/utils/clipboardImage.ts', import.meta.url), 'utf8');
  const transformed = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;

  const dir = join(tmpdir(), 'quick-chat-tests');
  await mkdir(dir, { recursive: true });
  const modulePath = join(dir, `clipboard-image-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(modulePath, transformed);
  return import(`file:///${modulePath.replaceAll('\\', '/')}`);
}

test('findClipboardImageItem returns null for empty or text-only clipboards', async () => {
  const { findClipboardImageItem } = await importClipboardImage();
  assert.equal(findClipboardImageItem([]), null);
  assert.equal(findClipboardImageItem([{ kind: 'string', type: 'text/plain' }]), null);
  assert.equal(
    findClipboardImageItem([
      { kind: 'string', type: 'text/plain' },
      { kind: 'string', type: 'text/html' },
    ]),
    null,
  );
});

test('findClipboardImageItem prefers png over other image types', async () => {
  const { findClipboardImageItem } = await importClipboardImage();
  const jpeg = { kind: 'file', type: 'image/jpeg' };
  const png = { kind: 'file', type: 'image/png' };
  assert.equal(findClipboardImageItem([jpeg, png]), png);
  assert.equal(findClipboardImageItem([png, jpeg]), png);
});

test('findClipboardImageItem falls back to the first image item when no png', async () => {
  const { findClipboardImageItem } = await importClipboardImage();
  const jpeg = { kind: 'file', type: 'image/jpeg' };
  const webp = { kind: 'file', type: 'image/webp' };
  assert.equal(findClipboardImageItem([jpeg, webp]), jpeg);
});

test('findClipboardImageItem ignores image-like types that are not files', async () => {
  const { findClipboardImageItem } = await importClipboardImage();
  assert.equal(findClipboardImageItem([{ kind: 'string', type: 'image/png' }]), null);
});
