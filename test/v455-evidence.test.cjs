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
      createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, append() {}, setAttribute() {}, appendChild() {} }),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { clientHeight: 900 },
      body: { classList: { add() {}, remove() {}, contains: () => false } },
      head: { appendChild() {} },
    },
    Element: class {},
    window: { CSS: { escape: (s) => String(s) }, g_universe: { itemsByGuid: {}, workspace: { guid: 'WS1' } }, __refxTrail: { ring: [], cap: 50 } },
  };
  context.globalThis = context;
  vm.runInNewContext(source + '\nthis.PluginUnderTest = Plugin;', context, { filename: 'plugin.js' });
  const plugin = new context.PluginUnderTest();
  plugin._unloaded = false;
  plugin.workspaceGuid = 'WS1';
  plugin._lineConnectionsEnabled = true;
  plugin._lineRefProps = ['Source Line'];
  plugin._autoLineRefs = true;
  plugin._referenceTargetKind = () => 'line';
  plugin._referenceIndexDataGeneration = 0;
  plugin._refLevelCacheStamp = () => '0:0';
  plugin._CONN_INDEX_TTL_MS = 60000;
  plugin._REF_CHAIN_LEVEL_RESOLVE_LIMIT = 200;
  plugin._refxTrail = context.window.__refxTrail;
  plugin._countCache = new Map();
  plugin.getOrLoadRecordName = (g) => ({
    TARGET: 'Target Page',
    SRC_REC: 'Wed Sep 10, 2025',
    PARENT_LINE: 'Time Block',
  }[g] || g);
  plugin.data = {
    getRecord: (g) => {
      if (g === 'SRC_REC') {
        return {
          guid: 'SRC_REC',
          getName: () => 'Wed Sep 10, 2025',
          getJournalDetails: () => ({ date: '2025-09-10' }),
        };
      }
      return null;
    },
  };
  return { plugin, storage, context };
}

test('_connEvidenceLabel assembles count from seeded cache and omits missing parts', () => {
  const { plugin, context } = loadPlugin();
  plugin.setCachedCountInfo('TARGET', { count: 3, capped: false, sdkPropCount: 0 });
  context.window.g_universe.itemsByGuid.REF_LINE = {
    guid: 'REF_LINE',
    rguid: 'SRC_REC',
    parent_guid: 'PARENT_LINE',
    text_segments: ['text', 'link', 'ref', 'TARGET'],
  };
  context.window.g_universe.itemsByGuid.PARENT_LINE = {
    guid: 'PARENT_LINE',
    rguid: 'SRC_REC',
    text_segments: ['text', 'Time Block'],
  };
  const stamp = plugin._refLevelCacheStamp();
  plugin._connIndexCache = {
    stamp,
    builtAt: Date.now(),
    reverseRefIndex: new Map([['TARGET', [context.window.g_universe.itemsByGuid.REF_LINE]]]),
    rguidIndex: new Map(),
    forwardRefIndex: new Map(),
  };
  plugin._lineTextByGuid = (g) => (g === 'PARENT_LINE' ? 'Time Block' : '');
  const label = plugin._connEvidenceLabel('TARGET');
  assert.match(label, /3 refs/);
  assert.match(label, /last Tue/);
  assert.match(label, /in Time Block/);
  assert.equal(plugin._connEvidenceLabel('NO_CACHE'), '');
});

test('related gather keeps chip.reason unchanged and adds chip.evidence separately', async () => {
  const { plugin } = loadPlugin();
  plugin.setCachedCountInfo('REC_OUT', { count: 2, capped: false, sdkPropCount: 0 });
  plugin._queryRefLines = async (g) => {
    if (g === 'TARGET_A') {
      return [{ guid: 'LN1', record: { guid: 'REC_OUT' }, segments: [{ type: 'text', text: 'out' }] }];
    }
    return [];
  };
  plugin.getOrLoadRecordName = (g) => ({ REC_OUT: 'Outside', TARGET_A: 'Alpha' }[g] || g);
  plugin.data.getRecord = (g) => (g === 'TARGET_A' ? { guid: 'TARGET_A', getName: () => 'Alpha' } : null);
  const chips = await plugin._wbRelatedGather([{ target: 'TARGET_A' }], null);
  assert.equal(chips.length, 1);
  assert.equal(chips[0].reason, 'references Alpha');
  assert.match(chips[0].evidence || '', /2 refs/);
});

test('_wbRelatedPaintFingerprint changes when evidence changes', () => {
  const { plugin } = loadPlugin();
  const a = [{ guid: 'G1', evidence: '1 refs' }];
  const b = [{ guid: 'G1', evidence: '2 refs' }];
  assert.notEqual(plugin._wbRelatedPaintFingerprint(a), plugin._wbRelatedPaintFingerprint(b));
  assert.equal(plugin._wbRelatedPaintFingerprint(a), plugin._wbRelatedPaintFingerprint([{ guid: 'G1', evidence: '1 refs' }]));
});

test('_connRecordHop writes traversal store and trail ring with bounded LRU', () => {
  const { plugin, storage } = loadPlugin();
  plugin._connRecordHop('A', 'B', 'jump');
  const key = 'refx_traversal_v1:WS1';
  const store = JSON.parse(storage.get(key));
  assert.deepEqual(store['A>B'], { n: 1, last: store['A>B'].last });
  assert.equal(plugin._refxTrail.ring.length, 1);
  assert.equal(plugin._refxTrail.ring[0].guid, 'B');
  assert.equal(plugin._refxTrail.ring[0].how, 'jump');
  for (let i = 0; i < 1005; i++) plugin._connRecordHop('S' + i, 'D' + i, 'jump');
  const trimmed = JSON.parse(storage.get(key));
  assert.equal(Object.keys(trimmed).length, 1000);
});

test('_connRecordHop no-ops on falsy end and unavailable store', () => {
  const { plugin, storage, context } = loadPlugin();
  plugin.workspaceGuid = '';
  context.window.g_universe.workspace = {};
  delete context.window.g_universe.workspaceGuid;
  plugin._connRecordHop('A', 'B', 'jump');
  assert.equal([...storage.keys()].some((k) => k.startsWith('refx_traversal_v1:')), false);
  plugin.workspaceGuid = 'WS1';
  context.window.g_universe.workspace = { guid: 'WS1' };
  plugin._connRecordHop('', 'B', 'jump');
  plugin._connRecordHop('A', '', 'jump');
  assert.equal(storage.has('refx_traversal_v1:WS1'), false);
  const origLoad = plugin._connTraversalLoad.bind(plugin);
  plugin._connTraversalLoad = () => { throw new Error('boom'); };
  assert.doesNotThrow(() => plugin._connRecordHop('A', 'B', 'jump'));
  plugin._connTraversalLoad = origLoad;
});

test('_connRecordHop records from bridgeJump, navigator, zoom, expand, and pick seams', async () => {
  const { plugin, storage } = loadPlugin();
  plugin.ui = {
    getActivePanel: () => ({
      navigateTo: async () => true,
      getActiveRecord: () => ({ guid: 'FROM_REC' }),
    }),
    getPanels: () => [],
  };
  plugin.data.getRecord = (g) => (g === 'FROM_REC' || g === 'DST_REC' ? { guid: g, getName: () => g } : null);
  await plugin._bridgeJump('DST_REC', { from: 'FROM_REC' });
  plugin._connRecordHop('PARENT', 'CHILD', 'expand');
  plugin._connRecordHop('SRC_Z', 'DST_Z', 'zoom');
  const link = { lineGuid: 'LINE1', pageGuid: 'PAGE1', picking: false, kind: 'line', query: 'x', br: '((', closingPair: null };
  plugin._link = link;
  plugin._pickerCanUseResult = () => true;
  plugin._exitLinkMode = () => {};
  plugin._searchPlan = () => ({ clauses: [{ tokens: ['x'] }] });
  plugin._pickMemoryRecord = () => {};
  plugin._liveStateByGuid = () => null;
  plugin._liveSegs = () => [{ type: 'text', text: '((x' }];
  plugin._findBracketRange = () => ({ start: 0, end: 1 });
  plugin._resolveLineItemByGuid = async () => ({
    segments: [{ type: 'text', text: '((x' }],
    setSegments: async () => true,
  });
  plugin._insertAt = (segs) => segs;
  plugin._referenceEditDigest = () => 'd';
  plugin._queueImmediateRefPaint = () => {};
  plugin._toast = () => {};
  await plugin._navigatorOpenResult({ guid: 'NAV_DST', type: 'record' }, false);
  await plugin._pickLink({ guid: 'PICK_DST', text: 'pick' });
  const store = JSON.parse(storage.get('refx_traversal_v1:WS1'));
  assert.ok(store['FROM_REC>DST_REC']);
  assert.ok(store['PARENT>CHILD']);
  assert.ok(store['SRC_Z>DST_Z']);
  assert.ok(store['LINE1>PICK_DST']);
});

test('_connHopWeight still returns 0', () => {
  const { plugin } = loadPlugin();
  assert.equal(plugin._connHopWeight('A', 'B'), 0);
});

test('v4.64.1 version locks', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.version, '4.64.1');
  assert.ok(source.startsWith('// v4.64.1'));
  assert.ok(source.includes('window.__REFX_VERSION = "4.64.1"'));
});
