import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { LinuxTargetHelper } from 'app-builder-lib/out/targets/LinuxTargetHelper.js';

const root = new URL('../', import.meta.url);
const metadata = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));

test('Linux desktop entry filename and window identity agree with Electron metadata', async () => {
  const helper = new LinuxTargetHelper({
    info: { metadata },
    appInfo: { productName: metadata.build.productName, sanitizedProductName: metadata.build.productName, description: metadata.description },
    platformSpecificBuildOptions: metadata.build.linux,
    executableName: metadata.name,
    config: metadata.build,
    fileAssociations: [],
  });
  assert.equal(metadata.desktopName, `${metadata.build.appId}.desktop`);
  assert.equal(`${helper.getDesktopFileName()}.desktop`, metadata.desktopName);
  const entry = await helper.computeDesktopEntry(metadata.build.linux);
  assert.ok(entry.includes(`\nStartupWMClass=${metadata.build.appId}\n`));
  assert.ok(entry.includes(`\nIcon=${metadata.name}\n`));
});

test('Linux package icons use standard hicolor sizes and matching square PNGs', async () => {
  const standardSizes = new Set([16, 24, 32, 48, 64, 96, 128, 256, 512]);
  const dir = new URL(`${metadata.build.linux.icon}/`, root);
  const icons = await readdir(dir);
  assert.ok(icons.includes('512x512.png'));
  for (const icon of icons) {
    const png = await readFile(new URL(icon, dir));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    assert.equal(width, height, icon);
    assert.ok(standardSizes.has(width), `${icon}: ${width} is not a standard hicolor size`);
    assert.equal(icon, `${width}x${height}.png`);
  }
});
