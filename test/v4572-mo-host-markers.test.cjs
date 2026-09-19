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

function makeListitem(guid) {
  return {
    nodeType: 1,
    tagName: 'DIV',
    className: 'listitem',
    isConnected: true,
    classList: { contains: (c) => c === 'listitem' },
    getAttribute: (a) => (a === 'data-guid' ? guid : null),
    parentElement: null,
  };
}

test('WO-23: marked .line-div is not skippable', () => {
  const { plugin } = loadPlugin();
  const listitem = makeListitem('LINE1');
  const lineDiv = {
    nodeType: 1,
    tagName: 'DIV',
    className: 'line-div refx-ovl-host attr-caret-line',
    classList: { contains: (c) => c === 'line-div' },
    parentElement: listitem,
  };
  assert.equal(plugin._moNodeSkippable(lineDiv, null), false);
});

test('WO-23: marked .lineitem-ref is not skippable', () => {
  const { plugin } = loadPlugin();
  const lineRef = {
    nodeType: 1,
    tagName: 'SPAN',
    className: 'lineitem-ref clickable refx-lineref-chip trc-ref-anchor trc-anchor-has-arrow',
    classList: { contains: (c) => c === 'lineitem-ref' },
    parentElement: null,
  };
  assert.equal(plugin._moNodeSkippable(lineRef, null), false);
});

test('WO-23: marked BODY is not skippable', () => {
  const { plugin } = loadPlugin();
  const body = {
    nodeType: 1,
    tagName: 'BODY',
    className: 'trc-zerolayout refx-overlay-badges refx-links-distinct',
    classList: { contains: () => false },
    parentElement: null,
  };
  assert.equal(plugin._moNodeSkippable(body, null), false);
});

test('WO-23: RefX overlay span under marked .line-div is still skippable', () => {
  const { plugin } = loadPlugin();
  const listitem = makeListitem('LINE2');
  const lineDiv = {
    nodeType: 1,
    tagName: 'DIV',
    className: 'line-div refx-ovl-host',
    classList: { contains: (c) => c === 'line-div' },
    parentElement: listitem,
  };
  const overlay = {
    nodeType: 1,
    tagName: 'SPAN',
    className: 'trc-refcount-badge-wrap refx-count-overlay trc-size-medium',
    classList: { contains: () => false },
    parentElement: lineDiv,
  };
  assert.equal(plugin._moNodeSkippable(overlay, null), true);
});

test('WO-23: childList removal from marked .line-div survives _moRecordSkippable', () => {
  const { plugin } = loadPlugin();
  const listitem = makeListitem('LINE3');
  const lineDiv = {
    nodeType: 1,
    tagName: 'DIV',
    className: 'line-div refx-ovl-host attr-caret-line',
    classList: { contains: (c) => c === 'line-div' },
    parentElement: listitem,
  };
  const overlay = {
    nodeType: 1,
    tagName: 'SPAN',
    className: 'trc-refcount-badge-wrap refx-count-overlay trc-size-medium',
    classList: { contains: () => false },
    parentElement: lineDiv,
  };
  const stats = { skippedSvg: 0, skippedIdentical: 0 };
  const m = {
    type: 'childList',
    target: lineDiv,
    addedNodes: [],
    removedNodes: [overlay],
  };
  assert.equal(plugin._moRecordSkippable(m, stats), false);
  assert.equal(stats.skippedSvg, 0);
});

test('WO-23: SVG, nautilus, and np- nodes remain skippable', () => {
  const { plugin } = loadPlugin();
  const svg = {
    nodeType: 1,
    tagName: 'SVG',
    className: '',
    classList: { contains: () => false },
    parentElement: null,
  };
  assert.equal(plugin._moNodeSkippable(svg, null), true);
  const nautilus = {
    nodeType: 1,
    tagName: 'DIV',
    className: 'nautilus-chart',
    classList: { contains: () => false },
    parentElement: null,
  };
  assert.equal(plugin._moNodeSkippable(nautilus, null), true);
  const np = {
    nodeType: 1,
    tagName: 'DIV',
    className: 'np-draggable',
    classList: { contains: () => false },
    parentElement: null,
  };
  assert.equal(plugin._moNodeSkippable(np, null), true);
});

test('WO-23: _moClassSkippable unchanged for refx vs native classes', () => {
  const { plugin } = loadPlugin();
  assert.equal(plugin._moClassSkippable('refx-count-overlay'), true);
  assert.equal(plugin._moClassSkippable('line-div'), false);
});

test('v4.64.1 version locks', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.version, '4.64.1');
  assert.ok(source.startsWith('// v4.64.1'));
  assert.ok(source.includes('window.__REFX_VERSION = "4.64.1"'));
  assert.ok(source.includes('REFX_NATIVE_HOST_CLASSES'));
  assert.ok(source.includes('_moNativeHost'));
});
