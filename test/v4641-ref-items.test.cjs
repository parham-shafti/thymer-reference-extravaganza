'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'plugin.js'), 'utf8');

function loadPlugin() {
  const context = {
    AppPlugin: class {},
    console,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout,
    performance: { now: () => Date.now() },
    CSS: { escape: (s) => String(s) },
    navigator: { platform: 'MacIntel', clipboard: {} },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    document: {
      querySelectorAll: () => [],
      querySelector: () => null,
      documentElement: { clientHeight: 900 },
      body: { classList: { toggle() {}, add() {}, remove() {} } },
      head: { appendChild() {} },
    },
    Element: class {},
    window: {
      CSS: { escape: (s) => String(s) },
      g_universe: { itemsByGuid: {}, workspace: {} },
    },
  };
  context.globalThis = context;
  vm.runInNewContext(source + '\nthis.PluginUnderTest = Plugin;', context, { filename: 'plugin.js' });
  const plugin = new context.PluginUnderTest();
  plugin.data = { getRecord: () => null };
  plugin._showSelf = true;
  plugin.isLineSharedIgnored = () => false;
  plugin.isExistingRecordGuid = () => false;
  plugin._isLineRefTarget = () => true;
  return { plugin, context };
}

function makeFixture() {
  const T = 'TARGET_LINE';
  const O = 'OWNER_PAGE';
  const J = 'JOURNAL_REF';
  const K = 'SIBLING_REF';
  const X = 'TRANSCLUSION';
  const JOURNAL = 'JOURNAL_PAGE';

  const journalRef = {
    guid: J,
    type: 'ref',
    props: { itemref: T },
    segments: [],
    rguid: JOURNAL,
  };
  const siblingRef = {
    guid: K,
    type: 'ref',
    props: { itemref: 'OTHER' },
    segments: [],
    rguid: JOURNAL,
  };
  const transclusion = {
    guid: X,
    type: 'transclusion',
    props: { itemref: T },
    segments: [],
    rguid: JOURNAL,
  };

  const backrefs = [
    { kind: 'line', lineItemGuid: J, record: { guid: JOURNAL } },
    { kind: 'line', lineItemGuid: K, record: { guid: JOURNAL } },
    { kind: 'line', lineItemGuid: X, record: { guid: JOURNAL } },
  ];

  return { T, O, J, K, X, JOURNAL, journalRef, siblingRef, transclusion, backrefs };
}

test('D1: native ref-item lines count as linked references for LINE targets', async () => {
  const { plugin, context } = loadPlugin();
  const fx = makeFixture();

  context.window.g_universe.itemsByGuid = {
    [fx.T]: { guid: fx.T, rguid: fx.O },
    [fx.J]: fx.journalRef,
    [fx.K]: fx.siblingRef,
    [fx.X]: fx.transclusion,
  };

  plugin._searchExactRefLines = async () => ({ ok: true, items: [] });
  plugin._fetchBackrefs = async (owner) => (owner === fx.O ? fx.backrefs : null);

  const rows = await plugin._queryRefLines(fx.T);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].guid, fx.J);
  assert.equal(rows[0]._refxRefItem, true);
  assert.equal(rows[0].type, 'ref');
  assert.equal(rows[0].props.itemref, fx.T);
  assert.equal(plugin._isPureSelfRef(rows[0], fx.T), true);

  plugin._searchExactRefLines = async () => ({
    ok: true,
    items: [{ guid: fx.J, record: { guid: fx.JOURNAL }, segments: [] }],
  });
  const noDup = await plugin._queryRefLines(fx.T);
  assert.equal(noDup.length, 1);
  assert.equal(noDup[0].guid, fx.J);

  delete context.window.g_universe.itemsByGuid[fx.J];
  plugin._searchExactRefLines = async () => ({ ok: true, items: [] });
  plugin.data.getRecord = (g) => (g === fx.JOURNAL
    ? {
      guid: g,
      getLineItems: async () => [fx.journalRef, fx.siblingRef, fx.transclusion],
    }
    : null);

  const coldRows = await plugin._queryRefLines(fx.T);
  assert.equal(coldRows.length, 1);
  assert.equal(coldRows[0].guid, fx.J);
  assert.equal(coldRows[0]._refxRefItem, true);

  plugin._fetchBackrefs = async () => null;
  plugin._searchExactRefLines = async () => ({
    ok: true,
    items: [{ guid: 'EXACT_ONLY', record: { guid: 'SRC' }, segments: [{ type: 'text', text: 'hit' }] }],
  });
  const exactOnly = await plugin._queryRefLines(fx.T);
  assert.equal(exactOnly.length, 1);
  assert.equal(exactOnly[0].guid, 'EXACT_ONLY');
});
