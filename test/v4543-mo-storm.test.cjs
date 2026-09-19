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
  let perfNow = 0;
  const observerCallbacks = {};
  let observerSeq = 0;
  const context = {
    AppPlugin: class {},
    console,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout,
    performance: { now: () => perfNow },
    CSS: { escape: (s) => String(s) },
    navigator: { platform: 'MacIntel', clipboard: {} },
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    MutationObserver: class {
      constructor(fn) {
        this._fn = fn;
        this._id = ++observerSeq;
        observerCallbacks[this._id] = fn;
        this._lastFn = fn;
      }
      observe() {}
      disconnect() { this._disconnected = true; }
    },
    document: {
      createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, append() {}, setAttribute() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [] }),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { clientHeight: 900, classList: { contains: () => false } },
      body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {} },
      head: { appendChild() {} },
    },
    Element: class {},
    window: { CSS: { escape: (s) => String(s) }, g_universe: { itemsByGuid: {}, workspace: {} } },
  };
  context.globalThis = context;
  vm.runInNewContext(source + '\nthis.PluginUnderTest = Plugin;', context, { filename: 'plugin.js' });
  const plugin = new context.PluginUnderTest();
  plugin._unloaded = false;
  plugin._isUnloading = false;
  plugin._enabled = true;
  plugin._cards = new Map();
  plugin._crumbs = new Map();
  plugin._inlineRefs = new Map();
  plugin._recordPreviews = new Map();
  plugin._aliasPanelRows = new Map();
  plugin._queryEmbeds = new Map();
  plugin._variants = new Map();
  plugin._liveGlyphs = new Map();
  plugin._liveChipBadges = new Map();
  plugin._liveTargetBadges = new Map();
  plugin._liveOverlayBadges = new Map();
  plugin._liveCheckOverlays = new Map();
  plugin._wbHeaders = new Map();
  plugin._wbFoldTwists = new Map();
  plugin._overlayMode = true;
  plugin._targetLineBadges = false;
  plugin._excludeCollections = new Set();
  plugin._pickerOnlyMutation = () => false;
  plugin._isNativePickerNode = () => false;
  plugin._toast = () => {};
  plugin.scheduleScan = () => {};
  plugin.scheduleRescanLines = () => {};
  plugin._wbLiveScheduleRefresh = () => {};
  plugin._scheduleOverlayReposition = () => {};
  plugin._onCardMutation = () => {};
  plugin._tagReferenceChipsFromMutations = () => {};
  plugin._nativeInlinePickerVisible = () => false;
  plugin._wbMutationIgnored = () => false;
  plugin._wbFoldApply = () => {};
  plugin._wbFoldMount = () => {};
  plugin.nodeHasReferenceHint = (n) => !!(n && n._refHint);
  plugin.findEditorRoot = () => ({ contains: () => true, querySelectorAll: () => [] });
  plugin._refreshDebounceMs = 180;
  plugin.data = { getRecord: () => null };
  return { plugin, storage, context, setPerfNow: (n) => { perfNow = n; }, getObserverCallbacks: () => observerCallbacks };
}

function makeLine(guid) {
  return {
    nodeType: 1,
    tagName: 'DIV',
    className: 'listitem',
    isConnected: true,
    _refHint: true,
    classList: { contains: (c) => c === 'listitem' },
    getAttribute: (a) => (a === 'data-guid' ? guid : null),
    parentElement: null,
  };
}

function makeSvgNode() {
  return {
    nodeType: 1,
    tagName: 'SVG',
    className: '',
    isConnected: true,
    classList: { contains: () => false },
    getAttribute: () => null,
    parentElement: null,
  };
}

function makeIdenticalAttrRecord(target, attr, value) {
  return {
    type: 'attributes',
    target,
    attributeName: attr,
    oldValue: value,
    addedNodes: [],
    removedNodes: [],
  };
}

function makeChildListRecord(target, added) {
  return {
    type: 'childList',
    target,
    addedNodes: added || [],
    removedNodes: [],
  };
}

function giantBatch(svgCount, identicalCount, lineCount) {
  const muts = [];
  for (let i = 0; i < svgCount; i++) muts.push(makeIdenticalAttrRecord(makeSvgNode(), 'd', String(i)));
  const line = makeLine('LINE_REAL');
  for (let i = 0; i < identicalCount; i++) {
    const t = { nodeType: 1, tagName: 'DIV', className: 'line-div', classList: { contains: () => false }, getAttribute: (a) => (a === 'class' ? 'line-div' : null), parentElement: line };
    muts.push(makeIdenticalAttrRecord(t, 'class', 'line-div'));
  }
  for (let i = 0; i < lineCount; i++) muts.push(makeChildListRecord(line, [makeLine('LINE_' + i)]));
  return muts;
}

const OBSERVER_NAMES = ['theme', 'card', 'panel', 'wb', 'overlay'];

for (const name of OBSERVER_NAMES) {
  test(`WO-16 ${name}: 20k mutation batch caps in < 5 ms and schedules coalesced rescan`, () => {
    const { plugin, setPerfNow } = loadPlugin();
    setPerfNow(0);
    let handlerRan = false;
    const muts = giantBatch(18000, 1500, 500);
    const t0 = performance.now();
    plugin._moGuardCallback(name, muts, { ctx: { state: { panelId: 'P1' } } }, () => { handlerRan = true; });
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 5, `expected < 5 ms, got ${elapsed}`);
    assert.equal(handlerRan, false, 'handler must not run on capped batch');
    const stats = plugin._moStats(name);
    assert.equal(stats.capped, 1);
    assert.ok(plugin._moCoalesceT && Object.keys(plugin._moCoalesceT).length > 0, 'coalesced rescan must be scheduled');
  });
}

test('WO-16 mixed 50-record batch filters svg and identical-value records', () => {
  const { plugin, setPerfNow } = loadPlugin();
  setPerfNow(0);
  const line = makeLine('LINE_KEEP');
  const muts = [];
  for (let i = 0; i < 20; i++) muts.push(makeIdenticalAttrRecord(makeSvgNode(), 'd', 'same'));
  for (let i = 0; i < 20; i++) {
    const t = { nodeType: 1, tagName: 'SPAN', className: 'seg', classList: { contains: () => false }, getAttribute: (a) => (a === 'class' ? 'seg' : null), parentElement: line };
    muts.push(makeIdenticalAttrRecord(t, 'class', 'seg'));
  }
  for (let i = 0; i < 10; i++) muts.push(makeChildListRecord(line, [makeLine('HIT_' + i)]));
  let seen = 0;
  plugin._moGuardCallback('panel', muts, { ctx: { state: { panelId: 'P1' } } }, (filtered) => {
    seen = filtered.length;
  });
  const stats = plugin._moStats('panel');
  assert.equal(stats.skippedSvg, 20);
  assert.equal(stats.skippedIdentical, 20);
  assert.equal(seen, 10);
  const lines = plugin._mutatedLines(muts.filter((m) => !plugin._moRecordSkippable(m, null)), 0);
  assert.ok(lines.size >= 10, 'real line mutations must reach _mutatedLines');
  assert.equal(stats.skippedSvg + stats.skippedIdentical, 40);
});

test('WO-16 storm breaker disconnects after 200 callbacks in 100 ms and reconnects', () => {
  const { plugin, setPerfNow } = loadPlugin();
  setPerfNow(0);
  let disconnects = 0;
  let observes = 0;
  const obs = {
    disconnect() { disconnects++; },
    observe() { observes++; },
  };
  const stormCtx = { obs, target: {}, options: { childList: true } };
  for (let i = 0; i < 200; i++) {
    plugin._moGuardCallback('card', [], stormCtx, () => {});
    setPerfNow(i * 0.4);
  }
  assert.equal(disconnects, 0, '200 callbacks must not trip yet');
  plugin._moGuardCallback('card', [], stormCtx, () => {});
  assert.equal(disconnects, 1, '201st callback in 100 ms window must disconnect');
  const bucket = plugin._moStormBucket('card');
  assert.ok(bucket.reconnectT, 'reconnect timer must be armed');
  setPerfNow(3000);
  clearTimeout(bucket.reconnectT);
  plugin._moStormReconnect(bucket, stormCtx);
  assert.equal(observes, 1, 'observer must reconnect after pause');
});

test('every MutationObserver callback uses _moGuardCallback', () => {
  const indices = [];
  let pos = 0;
  while ((pos = source.indexOf('new MutationObserver', pos)) >= 0) {
    indices.push(pos);
    pos += 1;
  }
  assert.equal(indices.length, 5, 'expected five MutationObserver sites');
  const names = [];
  for (const idx of indices) {
    const slice = source.slice(idx, idx + 500);
    const m = slice.match(/_moGuardCallback\('([^']+)'/);
    assert.ok(m, `observer at ${idx} must call _moGuardCallback`);
    names.push(m[1]);
  }
  assert.deepEqual([...new Set(names)].sort(), OBSERVER_NAMES.slice().sort());
});

test('v4.64.1 version locks', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.version, '4.64.1');
  assert.ok(source.startsWith('// v4.64.1'));
  assert.ok(source.includes('window.__REFX_VERSION = "4.64.1"'));
  assert.ok(source.includes('__refxMoStats'));
  assert.ok(source.includes('_moGuardCallback'));
});
