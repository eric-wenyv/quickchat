// tests/lib/import-ai.mjs
//
// 转译并加载 electron/ai.ts（连同其依赖 sse-transport.ts）。
// AI 管线已迁入 Electron 主进程，测试直接覆盖主进程模块。
// 关键点：产物必须写在项目目录内（tests/.transpiled/…），这样产物里残留
// 的任何裸包名仍可在项目 node_modules 下解析 —— 写到 os.tmpdir() 会解析失败。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const buildRoot = join(projectRoot, 'tests', '.transpiled');

const compilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
  verbatimModuleSyntax: true,
};

async function transpileTo(dir, sourceName, outName, transform) {
  const source = await readFile(join(projectRoot, 'electron', sourceName), 'utf8');
  let output = ts.transpileModule(source, { compilerOptions }).outputText;
  if (transform) output = transform(output);
  await writeFile(join(dir, outName), output);
}

async function newBuildDir() {
  const dir = join(buildRoot, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function importAiService() {
  const dir = await newBuildDir();
  await transpileTo(dir, 'sse-transport.ts', 'sse-transport.mjs');
  // ai.ts 的相对导入 './sse-transport.js' 指向转译产物
  await transpileTo(dir, 'ai.ts', 'ai.mjs', (out) =>
    out.replace(/(['"])\.\/sse-transport\.js\1/g, '$1./sse-transport.mjs$1')
  );
  return import(pathToFileURL(join(dir, 'ai.mjs')));
}

export async function importSseTransport() {
  const dir = await newBuildDir();
  await transpileTo(dir, 'sse-transport.ts', 'sse-transport.mjs');
  return import(pathToFileURL(join(dir, 'sse-transport.mjs')));
}
