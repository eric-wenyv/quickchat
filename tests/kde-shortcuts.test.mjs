import assert from 'node:assert/strict';
import test from 'node:test';
import { importElectronModule } from './lib/import-electron.mjs';

const { restoreKdeGlobalShortcuts } = await importElectronModule('kde-shortcuts');
const id = 'C87E8F0A75340D847F23657CF071EF67-Ctrl+Alt+Space';
const backend = 'org.freedesktop.impl.portal.desktop.kde';

function fixture({ connections, ids = [id], bindResponse = 0 } = {}) {
  const calls = [];
  return {
    calls,
    options: {
      pid: 123,
      isRegistered: key => key === 'Ctrl+Alt+Space',
      pause: async () => {},
      run: async args => {
        calls.push(args);
        if (args[0] === 'list') return JSON.stringify(connections ?? [
          { name: backend, pid: 456 },
          { name: ':1.15', pid: 999 },
          { name: ':1.20', pid: 123 },
        ]);
        if (args[4] === 'Introspect') return JSON.stringify({ data: ['<node><node name="com_quickchat_app_global_shortcuts"/></node>'] });
        if (args[4] === 'ListShortcuts') return JSON.stringify({ data: [0, {
          shortcuts: { data: ids.map(key => [key, { description: { data: 'Quick Chat' }, trigger_description: { data: 'user custom binding' } }]) },
        }] });
        if (args[4] === 'BindShortcuts') return JSON.stringify({ data: [bindResponse, {}] });
        throw new Error(`Unexpected busctl call: ${args}`);
      },
    },
  };
}

test('restored KDE shortcuts are bound on every application launch', async () => {
  const f = fixture();
  await restoreKdeGlobalShortcuts(f.options);
  await restoreKdeGlobalShortcuts(f.options);
  const binds = f.calls.filter(call => call[4] === 'BindShortcuts');
  assert.equal(binds.length, 2);
  assert.ok(binds.every(call => call.includes('/org/freedesktop/portal/desktop/session/1_20/com_quickchat_app_global_shortcuts')));
  assert.ok(!f.calls.some(call => call.some(arg => arg.includes('/session/1_15'))));
});

test('recovery preserves compositor bindings and excludes unregistered shortcuts', async () => {
  const otherId = '0E5856065CFBDC9656CE619527DFBF3E-Ctrl+Shift+S';
  const f = fixture({ ids: [id, otherId] });
  await restoreKdeGlobalShortcuts(f.options);
  const bind = f.calls.find(call => call[4] === 'BindShortcuts');
  assert.ok(bind.includes(id));
  assert.ok(!bind.includes(otherId));
  assert.ok(!bind.includes('preferred_trigger'));
  assert.ok(bind.includes('description'));
});

test('a new shortcut stays on the normal Electron registration path', async () => {
  const f = fixture({ ids: [] });
  await restoreKdeGlobalShortcuts(f.options);
  assert.ok(!f.calls.some(call => call[4] === 'BindShortcuts'));
});

test('other desktop backends do not invoke KDE recovery', async () => {
  const f = fixture({ connections: [{ name: ':1.20', pid: 123 }] });
  await restoreKdeGlobalShortcuts(f.options);
  assert.equal(f.calls.length, 1);
});

test('systems without busctl can continue using Electron normally', async () => {
  await restoreKdeGlobalShortcuts({ pid: 123, isRegistered: () => true, run: async () => { throw new Error('ENOENT'); } });
});

test('a rejected KDE bind surfaces as registration failure', async () => {
  const f = fixture({ bindResponse: 2 });
  await assert.rejects(restoreKdeGlobalShortcuts(f.options), /无法重新激活 KDE.*BindShortcuts failed: 2/);
});

test('recovery waits for the native D-Bus connection to appear', async () => {
  const f = fixture();
  const run = f.options.run;
  let listed = false;
  f.options.run = async args => {
    if (args[0] === 'list' && !listed) {
      listed = true;
      return JSON.stringify([{ name: backend, pid: 456 }]);
    }
    return run(args);
  };
  await restoreKdeGlobalShortcuts(f.options);
  assert.ok(f.calls.some(call => call[4] === 'BindShortcuts'));
});

test('native X11 registrations without a portal session remain untouched', async () => {
  const f = fixture();
  const run = f.options.run;
  f.options.run = args => args[4] === 'Introspect'
    ? Promise.resolve(JSON.stringify({ data: ['<node/>'] }))
    : run(args);
  await restoreKdeGlobalShortcuts(f.options);
  assert.ok(!f.calls.some(call => call[4] === 'BindShortcuts'));
});
