'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'plugin.js'), 'utf8');

function loadPlugin() {
  const storage = new Map();
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
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    document: {
      createElement: (tag) => {
        const el = {
          tagName: tag.toUpperCase(),
          style: {},
          classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
          append() {}, setAttribute() {}, appendChild() {}, replaceChildren() {},
          addEventListener() {}, remove() {},
          hidden: false, children: [], isConnected: true, parentElement: null,
          previousElementSibling: null, nextSibling: null, dataset: {},
          textContent: '',
          id: '',
        };
        return el;
      },
      getElementById: (id) => context._styleEls?.get(id) || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { clientHeight: 900 },
      body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {} },
      head: { appendChild(el) { if (el.id) context._styleEls.set(el.id, el); } },
    },
    Element: class {},
    window: { CSS: { escape: (s) => String(s) }, g_universe: { itemsByGuid: {}, workspace: {} }, innerWidth: 1200 },
  };
  context._styleEls = new Map();
  context.globalThis = context;
  vm.runInNewContext(source + '\nthis.PluginUnderTest = Plugin;', context, { filename: 'plugin.js' });
  const plugin = new context.PluginUnderTest();
  plugin._unloaded = false;
  plugin._recheckBackgroundGate = async () => true;
  plugin._toast = () => {};
  plugin._wbHeaders = new Map();
  plugin._wbOwner = { token: 1 };
  plugin._wbOwnerCurrent = () => true;
  plugin._wbRefreshCurrent = () => true;
  plugin._wbRefreshSeq = 1;
  plugin._wbLiveScheduleRefresh = () => {};
  plugin._wbLiveDropPropCard = () => {};
  plugin.getOrLoadRecordName = (g) => ({ REC_OWNER: 'Owner Page' }[g] || g);
  plugin.data = {
    getRecord: (g) => (g === 'REC_OWNER' ? { guid: g, getName: () => 'Owner Page', getLineItems: async () => [] } : null),
    getAllCollections: async () => [],
  };
  return { plugin, context, storage };
}

function workbenchLine(guid, props = {}) {
  const line = {
    guid,
    type: 'transclusion',
    props: { ...props },
    async setMetaProperty(key, value) { this.props[key] = value; return true; },
    async delete() { return true; },
    async move() { return true; },
  };
  return line;
}

function workbenchRecord(guid, lines) {
  let sequence = 0;
  const bindDelete = (line) => {
    line.delete = async () => { const i = lines.indexOf(line); if (i >= 0) lines.splice(i, 1); return true; };
    return line;
  };
  for (const line of lines) bindDelete(line);
  return {
    guid,
    getName: () => 'Reference Workbench State',
    async getLineItems() { return lines; },
    async createLineItem(_parent, after, type, _segments, props) {
      const line = bindDelete(workbenchLine(`WB_NEW_${++sequence}`, props));
      line.type = type;
      const idx = after ? lines.findIndex((l) => l === after) + 1 : lines.length;
      lines.splice(idx < 0 ? lines.length : idx, 0, line);
      return line;
    },
  };
}

function setupBacking(plugin, lines) {
  const backing = workbenchRecord('WB_RECORD', lines);
  plugin._wbBackingRecord = backing;
  plugin._wbBackingGuid = 'WB_RECORD';
  plugin._wbBackingValidatedGuid = 'WB_RECORD';
  plugin._wbBackingValidatedCollectionGuid = 'COL_SETTINGS';
  return backing;
}

function seedChain(ctx) {
  const owner = 'REC_OWNER';
  ctx.window.g_universe.itemsByGuid = {
    LINE_LEAF: {
      guid: 'LINE_LEAF', rguid: owner, type: 'task',
      text_segments: ['text', 'leaf'],
      parent: { guid: 'LINE_MID', type: 'text' },
    },
    LINE_MID: {
      guid: 'LINE_MID', rguid: owner, type: 'text',
      text_segments: ['text', 'mid'],
      parent: { guid: 'LINE_ROOT', type: 'text' },
    },
    LINE_ROOT: {
      guid: 'LINE_ROOT', rguid: owner, type: 'text',
      text_segments: ['text', 'root'],
      parent: { guid: owner, type: 'document' },
    },
    [owner]: { guid: owner, rguid: owner, type: 'document', parent_unknown: true },
  };
}

test('reroot writes new line with new target and deletes old one', async () => {
  const { plugin, context } = loadPlugin();
  seedChain(context);
  const oldLine = workbenchLine('L1', {
    itemref: 'LINE_LEAF', refx_wb: 1, refx_variant: 'card', refx_pinned: '1', refx_collapsed: '1',
  });
  const other = workbenchLine('L0', { itemref: 'LINE_ROOT', refx_wb: 1, refx_variant: 'full' });
  const { getLineItems } = setupBacking(plugin, [other, oldLine]);
  let getCalls = 0;
  plugin._wbBackingRecord.getLineItems = async () => { getCalls++; return getLineItems(); };

  const it = { lineGuid: 'L1', line: oldLine, target: 'LINE_LEAF', variant: 'card', pinned: true, collapsed: true };
  await plugin._wbLiveReroot(it, 'LINE_MID', 'LINE_LEAF');
  assert.equal(getCalls, 0);

  const lines = await plugin._wbBackingRecord.getLineItems();
  assert.equal(lines.length, 2);
  assert.equal(lines[0].props.itemref, 'LINE_ROOT');
  const newLine = lines[1];
  assert.notEqual(newLine.guid, 'L1');
  assert.equal(newLine.props.itemref, 'LINE_MID');
  assert.equal(newLine.props.refx_variant, 'card');
  assert.equal(newLine.props.refx_pinned, '1');
  assert.equal(newLine.props.refx_collapsed, '1');
  assert.equal(newLine.props.refx_focus, 'LINE_LEAF');
  assert.equal(newLine.props.refx_root_of, 'LINE_LEAF');
  assert.ok(!lines.some((l) => l.guid === 'L1'));
});

test('_wbLoadLive reads refx_focus and refx_root_of', async () => {
  const { plugin } = loadPlugin();
  const line = workbenchLine('L1', {
    itemref: 'LINE_MID', refx_wb: 1, refx_variant: 'full',
    refx_focus: 'LINE_LEAF', refx_root_of: 'LINE_LEAF',
  });
  setupBacking(plugin, [line]);
  const items = await plugin._wbLoadLive();
  assert.equal(items.length, 1);
  assert.equal(items[0].focus, 'LINE_LEAF');
  assert.equal(items[0].rootOf, 'LINE_LEAF');
});

test('back reroot restores original target and clears focus meta', async () => {
  const { plugin, context } = loadPlugin();
  seedChain(context);
  const oldLine = workbenchLine('L2', {
    itemref: 'LINE_MID', refx_wb: 1, refx_variant: 'full',
    refx_focus: 'LINE_LEAF', refx_root_of: 'LINE_LEAF',
  });
  setupBacking(plugin, [oldLine]);
  const it = {
    lineGuid: 'L2', line: oldLine, target: 'LINE_MID', variant: 'full',
    pinned: false, collapsed: false, focus: 'LINE_LEAF', rootOf: 'LINE_LEAF',
  };
  await plugin._wbLiveReroot(it, 'LINE_LEAF', null, true);

  const lines = await plugin._wbBackingRecord.getLineItems();
  assert.equal(lines.length, 1);
  assert.equal(lines[0].props.itemref, 'LINE_LEAF');
  assert.equal(lines[0].props.refx_focus, undefined);
  assert.equal(lines[0].props.refx_root_of, undefined);
});

test('focus stylesheet contains exactly shelf focus guids', () => {
  const { plugin, context } = loadPlugin();
  const styleEl = context.document.createElement('style');
  styleEl.id = 'refx-wb-focus-rules';
  context._styleEls.set('refx-wb-focus-rules', styleEl);

  plugin._wbLiveFocusRulesSync([
    { focus: 'LINE_LEAF', target: 'LINE_MID' },
    { focus: 'LINE_MID', target: 'LINE_ROOT' },
    { focus: 'LINE_LEAF', target: 'LINE_LEAF' },
    { focus: null },
    {},
  ]);

  const text = styleEl.textContent;
  assert.match(text, /data-guid="LINE_LEAF"/);
  assert.match(text, /data-guid="LINE_MID"/);
  assert.equal((text.match(/data-guid="/g) || []).length, 4);
  assert.match(text, /::before/);
  assert.match(text, /border: 2px solid var\(--refx-wb-focus-ring/);
  assert.match(text, /left: -10px/);
  assert.doesNotMatch(text, /outline:/);
  assert.doesNotMatch(text, /box-shadow/);
  assert.doesNotMatch(text, /background/);
});

test('invalid focus guid is not interpolated into stylesheet', () => {
  const { plugin, context } = loadPlugin();
  const styleEl = context.document.createElement('style');
  styleEl.id = 'refx-wb-focus-rules';
  context._styleEls.set('refx-wb-focus-rules', styleEl);

  plugin._wbLiveFocusRulesSync([
    { focus: 'BAD" { color: red; }' },
    { focus: 'SHORT' },
    { focus: 'VALIDGUID01' },
  ]);

  const text = styleEl.textContent;
  assert.match(text, /data-guid="VALIDGUID01"/);
  assert.equal((text.match(/data-guid="VALIDGUID01"/g) || []).length, 2);
  assert.ok(!text.includes('BAD"'));
  assert.ok(!text.includes('SHORT'));
});

test('reroot does not poll getLineItems for readback', async () => {
  const { plugin, context } = loadPlugin();
  seedChain(context);
  const oldLine = workbenchLine('L1', { itemref: 'LINE_LEAF', refx_wb: 1, refx_variant: 'full' });
  setupBacking(plugin, [oldLine]);
  let getCalls = 0;
  plugin._wbBackingRecord.getLineItems = async () => { getCalls++; return [oldLine]; };

  const it = { lineGuid: 'L1', line: oldLine, target: 'LINE_LEAF', variant: 'full', pinned: false, collapsed: false };
  await plugin._wbLiveReroot(it, 'LINE_MID', 'LINE_LEAF');
  assert.equal(getCalls, 0);
});

test('reroot preserves shelf order via create-after-delete', async () => {
  const { plugin, context } = loadPlugin();
  seedChain(context);
  const a = workbenchLine('LA', { itemref: 'LINE_ROOT', refx_wb: 1, refx_variant: 'full' });
  const b = workbenchLine('LB', { itemref: 'LINE_LEAF', refx_wb: 1, refx_variant: 'full', refx_pinned: '1' });
  const c = workbenchLine('LC', { itemref: 'LINE_MID', refx_wb: 1, refx_variant: 'refs' });
  setupBacking(plugin, [a, b, c]);

  const it = { lineGuid: 'LB', line: b, target: 'LINE_LEAF', variant: 'full', pinned: true, collapsed: false };
  await plugin._wbLiveReroot(it, 'LINE_MID', 'LINE_LEAF');

  const lines = await plugin._wbBackingRecord.getLineItems();
  assert.equal(lines.length, 3);
  assert.equal(lines[0].props.itemref, 'LINE_ROOT');
  assert.equal(lines[1].props.itemref, 'LINE_MID');
  assert.equal(lines[1].props.refx_pinned, '1');
  assert.equal(lines[2].props.itemref, 'LINE_MID');
  assert.equal(lines[2].props.refx_variant, 'refs');
});
