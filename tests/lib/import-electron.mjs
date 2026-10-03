// tests/lib/import-electron.mjs
//
// 转译并加载 electron/ 主进程模块（单文件模块，无相对导入）。
// 产物必须写在项目目录内（tests/.transpiled/…）：转译后的裸包名
// （linkedom / better-sqlite3 等）要经项目 node_modules 解析，
// 写到 os.tmpdir() 会解析失败。

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

export async function importElectronModule(name) {
  const source = await readFile(join(projectRoot, 'electron', `${name}.ts`), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions }).outputText;
  const dir = join(buildRoot, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  const modulePath = join(dir, `${name}.mjs`);
  await writeFile(modulePath, output);
  return import(pathToFileURL(modulePath));
}
