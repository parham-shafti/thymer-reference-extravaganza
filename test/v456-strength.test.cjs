'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'plugin.js'), 'utf8');

function loadPlugin(workspace = 'WS_STR') {
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
      createElement: () => ({
        style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        append() {}, setAttribute() {}, appendChild() {}, replaceChildren() {},
        hidden: false, children: [], isConnected: true, parentElement: null,
        previousElementSibling: null, nextSibling: null,
      }),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { clientHeight: 900 },
      body: { classList: { add() {}, remove() {}, contains: () => false } },
      head: { appendChild() {} },
    },
    Element: class {},
    window: { CSS: { escape: (s) => String(s) }, g_universe: { itemsByGuid: {}, workspace: { guid: workspace } } },
  };
  context.globalThis = context;
  vm.runInNewContext(source + '\nthis.PluginUnderTest = Plugin;', context, { filename: 'plugin.js' });
  const plugin = new context.PluginUnderTest();
  plugin._unloaded = false;
  plugin._connStrengthEnabled = true;
  plugin._referenceIndexDataGeneration = 0;
  plugin._refLevelCacheStamp = () => '0:0';
  plugin._CONN_INDEX_TTL_MS = 60000;
  plugin._wbWorkspaceGuid = () => workspace;
  plugin.getOrLoadRecordName = (g) => ({ A: 'Alpha', B: 'Beta', C: 'Gamma', SHARED: 'Shared' }[g] || g);
  plugin.data = {
    getRecord: (g) => {
      if (g === 'JREC') return { guid: 'JREC', getName: () => 'Journal', getJournalDetails: () => ({ date: '2025-09-10' }) };
      if (['A', 'B', 'C', 'SHARED'].includes(g)) return { guid: g, getName: () => plugin.getOrLoadRecordName(g) };
      return null;
    },
  };
  plugin._el = (tag, cls, text) => {
    const el = context.document.createElement(tag);
    if (cls) el.classList.add(...cls.split(' '));
    if (text != null) el.textContent = String(text);
    el.append = (...kids) => kids.forEach((k) => el.appendChild(k));
    el.appendChild = (c) => { el.children.push(c); c.parentElement = el; return c; };
    el.addEventListener = () => {};
    return el;
  };
  return { plugin, storage, context };
}

test('_connHopWeight decays with age and caps at 60', () => {
  const { plugin, storage } = loadPlugin();
  const key = 'refx_traversal_v1:WS_STR';
  const now = Date.now();
  storage.set(key, JSON.stringify({
    'SRC>MANY': { n: 500, last: now },
    'SRC>OLD': { n: 100, last: now - 60 * 86400000 },
  }));
  plugin._connTraversalCache = null;
  assert.equal(plugin._connHopWeight('SRC', 'MISSING'), 0);
  assert.equal(plugin._connHopWeight('SRC', 'MANY'), 60);
  assert.ok(plugin._connHopWeight('SRC', 'OLD') < plugin._connHopWeight('SRC', 'MANY'));
  assert.ok(plugin._connHopWeight('SRC', 'OLD') >= 0);
});

test('traversal boost is rank-only and never removes picker rows', async () => {
  const { plugin, context } = loadPlugin();
  context.window.g_universe.itemsByGuid.WEAK = {
    guid: 'WEAK', rguid: 'PAGE1', text_segments: ['text', 'needle match here'],
  };
  context.window.g_universe.itemsByGuid.STRONG = {
    guid: 'STRONG', rguid: 'PAGE1', text_segments: ['text', 'other words'],
  };
  plugin._recordNameIndex = new Map([['PAGE1', 'Page']]);
  plugin._connRecordHop('HOST', 'STRONG', 'pick');
  for (let i = 0; i < 20; i++) plugin._connRecordHop('HOST', 'STRONG', 'pick');
  plugin._link = {
    lineGuid: 'HOST', pageGuid: null, token: 1, results: [], resultPool: new Map(),
    fuzzyPool: new Map(), textCache: new Map(), sel: 0, userSelected: false, scanDone: Promise.resolve(),
  };
  const weakScore = 400 + plugin._connHopWeight('HOST', 'WEAK');
  const strongScore = 400 + plugin._connHopWeight('HOST', 'STRONG');
  assert.ok(strongScore > weakScore);
  assert.equal(plugin._r5FilterRow({ guid: 'WEAK', text: 'x' }, {}, null), true);
});

test('empty-state score expression includes traversal term while sort comparator stays frecency-first', () => {
  const { plugin, context } = loadPlugin();
  seedLine(context, 'LEARNED_EMPTY', 'Learned empty state line', 'PAGE1');
  plugin._recordNameIndex = new Map([['PAGE1', 'Page']]);
  plugin._r5RecordFrecency('RECENT1');
  plugin._pickMemoryRecord('LEARNED_EMPTY', ['picked']);
  plugin._connRecordHop('HOST', 'LEARNED_EMPTY', 'pick');
  const rows = plugin._r5EmptyPickerCandidates('line', 'HOST', 12);
  const learned = rows.find((r) => r.guid === 'LEARNED_EMPTY');
  assert.ok(learned);
  assert.ok(learned.score >= 500 + plugin._connHopWeight('HOST', 'LEARNED_EMPTY'));
  const recentIdx = rows.findIndex((r) => r.suggestionKind === 'recent');
  const learnedIdx = rows.findIndex((r) => r.guid === 'LEARNED_EMPTY' && r.suggestionKind === 'learned');
  if (recentIdx >= 0) assert.ok(learnedIdx > recentIdx);
});

function seedLine(context, guid, text, pageGuid) {
  context.window.g_universe.itemsByGuid[guid] = {
    guid, rguid: pageGuid, text_segments: ['text', text],
  };
}

test('co-occurrence extraction records line parent and day relations with bounds', async () => {
  const { plugin, context, storage } = loadPlugin();
  context.window.g_universe.itemsByGuid.L1 = {
    guid: 'L1', rguid: 'JREC', parent_guid: 'JREC',
    text_segments: ['text', 'a', 'ref', 'A', 'ref', 'B', 'ref', 'C'],
  };
  context.window.g_universe.itemsByGuid.LBIG = {
    guid: 'LBIG', rguid: 'JREC',
    text_segments: ['text', 'x', 'ref', 'A', 'ref', 'B', 'ref', 'C', 'ref', 'D', 'ref', 'E', 'ref', 'F', 'ref', 'G', 'ref', 'H', 'ref', 'I'],
  };
  await plugin._buildConnIndexesChunked(null, '0:0');
  const pair = plugin._connCooccurGet('A', 'B');
  assert.ok(pair);
  assert.equal(pair.line, 1);
  assert.equal(pair.parent, 1);
  assert.equal(pair.day, 1);
  assert.equal(plugin._connCooccurGet('A', 'I'), null);
  for (let i = 0; i < 5100; i++) {
    plugin._connCooccurNotePair('P' + i, 'Q' + i, { line: true, parent: true, day: true });
  }
  const store = plugin._connCooccurLoad();
  assert.ok(Object.keys(store).length <= 5000);
  plugin._scheduleCooccurPersist();
  assert.ok(plugin._connCooccurPersistT);
});

test('co-occurrence persists debounced without immediate write', () => {
  const { plugin, storage } = loadPlugin();
  plugin._connCooccurNotePair('X', 'Y', { line: true, parent: true, day: true });
  assert.ok(plugin._connCooccurPersistT, 'debounced timer must be scheduled');
  assert.equal(storage.has('refx_cooccur_v1:WS_STR'), false, 'must not write immediately');
  plugin._persistCooccurStore();
  assert.ok(storage.has('refx_cooccur_v1:WS_STR'), 'persist helper writes store');
});

test('shared strip hides below two shelf items and caps at five', async () => {
  const { plugin } = loadPlugin();
  plugin._wbSharedEnabled = true;
  plugin._wbOwner = {};
  plugin._wbOwnerCurrent = () => true;
  plugin._wbLivePanel = () => ({ getElement: () => panelEl });
  plugin._wbLoadLive = async () => [
    { lineGuid: 'L1', target: 'A' },
    { lineGuid: 'L2', target: 'B' },
  ];
  plugin._connSharedNeighbours = () => Array.from({ length: 8 }, (_, i) => ({
    guid: 'N' + i,
    name: 'Neighbour ' + i,
    coCount: 8 - i,
  }));
  const panelEl = {
    querySelector: (sel) => (sel.includes('panel-scroller-y') ? panelEl : null),
    appendChild(c) { c.parentElement = panelEl; },
  };
  plugin._wbTabsEl = { isConnected: true, parentElement: panelEl, nextSibling: null };
  plugin._wbSharedGen = 1;
  await plugin._wbSharedRefresh(1);
  assert.ok(plugin._wbSharedEl);
  assert.equal(plugin._wbSharedEl.hidden, false);
  assert.equal(plugin._wbSharedEl.children.length, 5);
  plugin._wbLiveSharedPaint(panelEl, [{ target: 'A' }], [{ guid: 'Z', name: 'Z', reason: '1 shared' }]);
  assert.equal(plugin._wbSharedEl.hidden, true);
});

test('shared strip registered in mutation-ignore lists', () => {
  assert.match(source, /refx-wb-shared/);
  assert.match(source, /node\.matches\?\.\("\.refx-wb-shared"\)/);
  assert.match(source, /node\.closest\?\.\("\.refx-wb-shared"\)/);
  assert.match(source, /refx-wb-related, \.refx-wb-shared/);
});

test('traversal store LRU keeps at most 1000 edges', () => {
  const { plugin, storage } = loadPlugin();
  for (let i = 0; i < 1010; i++) plugin._connRecordHop('SRC', 'D' + i, 'jump');
  const parsed = JSON.parse(storage.get('refx_traversal_v1:WS_STR'));
  assert.ok(Object.keys(parsed).length <= 1000);
});

test('traversal boost bounded to [0, 60]', () => {
  const { plugin } = loadPlugin();
  for (let i = 0; i < 100; i++) plugin._connRecordHop('SRC', 'MANY', 'jump');
  const boost = plugin._connHopWeight('SRC', 'MANY');
  assert.ok(boost >= 0 && boost <= 60, `Boost ${boost} out of [0, 60]`);
});

test('v4.64.1 version locks', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.version, '4.64.1');
  assert.ok(source.startsWith('// v4.64.1'));
  assert.ok(source.includes('window.__REFX_VERSION = "4.64.1"'));
  assert.ok(source.includes('custom.connections.strength'));
  assert.ok(source.includes('_wbLiveSharedEnsure'));
});
