'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'plugin.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));

class FakeEl {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.style = {};
    this.dataset = {};
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    this.children = [];
    this.childNodes = this.children;
    this._attrs = {};
    this._listeners = {};
    this.isConnected = true;
    this.parentNode = null;
    this.textContent = '';
  }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return this._attrs[k] ?? null; }
  append(...nodes) { for (const n of nodes) this.appendChild(n); }
  appendChild(node) {
    if (node?.parentNode) node.parentNode.removeChild(node);
    this.children.push(node);
    node.parentNode = this;
    return node;
  }
  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) this.children.splice(i, 1);
    if (node.parentNode === this) node.parentNode = null;
    return node;
  }
  insertAdjacentElement(_where, node) { return this.appendChild(node); }
  addEventListener(type, fn) {
    (this._listeners[type] ||= []).push(fn);
  }
  querySelector(sel) {
    const walk = (n) => {
      if (n.matches?.(sel)) return n;
      for (const c of n.children || []) {
        const hit = walk(c);
        if (hit) return hit;
      }
      return null;
    };
    return walk(this);
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => {
      if (n.matches?.(sel)) out.push(n);
      for (const c of n.children || []) walk(c);
    };
    walk(this);
    return out;
  }
  matches(sel) {
    if (sel.startsWith('.')) return this.className === sel.slice(1) || this.classList.contains(sel.slice(1));
    if (sel.includes('[')) {
      const m = sel.match(/\[([^=\]]+)(?:="([^"]*)")?\]/);
      if (m) {
        const got = this.getAttribute(m[1]);
        if (got == null || (m[2] != null && got !== m[2])) return false;
        sel = sel.slice(0, m.index);
      }
    }
    if (sel.startsWith('.')) return false;
    return !sel || sel === '*' || this.tagName === sel.toUpperCase();
  }
  closest(sel) {
    for (let n = this; n; n = n.parentNode) if (n.matches?.(sel)) return n;
    return null;
  }
  replaceChildren(...nodes) {
    this.children.length = 0;
    for (const n of nodes) this.appendChild(n);
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); this.isConnected = false; }
}

function loadPlugin() {
  const storage = new Map();
  const body = new FakeEl('body');
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
      createElement: (tag) => new FakeEl(tag),
      getElementById: () => null,
      querySelector: (sel) => body.querySelector(sel),
      querySelectorAll: (sel) => body.querySelectorAll(sel),
      documentElement: { clientHeight: 900 },
      body,
      head: { appendChild() {} },
    },
    Element: FakeEl,
    window: { CSS: { escape: (s) => String(s) }, g_universe: { itemsByGuid: {}, workspace: {} } },
  };
  context.globalThis = context;
  vm.runInNewContext(source + '\nthis.PluginUnderTest = Plugin;', context, { filename: 'plugin.js' });
  const plugin = new context.PluginUnderTest();
  plugin._unloaded = false;
  plugin._lineConnectionsEnabled = true;
  plugin._lineRefProps = ['Source Line'];
  plugin._autoLineRefs = true;
  plugin._referenceTargetKind = () => 'line';
  plugin.isExistingRecordGuid = () => false;
  plugin._isLineRefTarget = () => true;
  plugin._inlineRefsPersistCollapse = true;
  plugin._inlineRefsGroupsDefault = 'expanded';
  plugin._maxResults = 250;
  plugin._showSelf = false;
  plugin._propRefsEnabled = false;
  plugin._excludeCollections = new Set();
  plugin._countCache = new Map();
  plugin._enabled = true;
  plugin._targetLineBadges = true;
  plugin._minCount = 1;
  plugin._showZero = false;
  plugin._loadGlobalFilters = () => ({ inc: [], exc: [] });
  plugin._applyChipFilterToItems = (items) => items;
  plugin._applyGlobalFilterToItems = (items) => items;
  plugin._sortInlineRefLines = async (items) => items;
  plugin._renderInlineRefChips = () => {};
  plugin._prepareInlineRefsGroupCollapse = () => {};
  plugin._shouldDeferRefContext = () => false;
  plugin._renderRefsGroups = async () => {};
  plugin._yieldMacrotask = async () => {};
  plugin._ensureCardObserver = () => {};
  plugin._applyInlineRefsFilter = () => {};
  plugin._applyInlineRefsGroupCollapse = () => {};
  plugin._paintPinButton = () => {};
  plugin._isPinned = () => false;
  plugin._recordRefxError = () => {};
  plugin._yieldPreviewPaint = async () => {};
  plugin._refLevelLineText = (g) => g;
  plugin._refLevelRecordName = () => 'Page';
  plugin._refLevelCacheStamp = () => 1;
  plugin._refLevelCacheSet = () => {};
  plugin._applyRefChainTreeFilter = () => {};
  plugin._installRefChainTreeLevel = () => {};
  plugin.loadBoolSetting = () => true;
  plugin.data = { searchByQuery: async () => ({ lines: [], error: null }) };
  return { plugin, body, document: context.document };
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

test('v4.49.3 fill schedules without awaiting collapse meta', async () => {
  const { plugin, body } = loadPlugin();
  plugin._readCollapsedGroupsMeta = () => new Promise(() => {});
  let fillCalls = 0;
  const origFill = plugin._fillInlineRefs.bind(plugin);
  plugin._fillInlineRefs = (...args) => { fillCalls++; return origFill(...args); };
  const host = new FakeEl('div');
  host.className = 'listitem';
  host.setAttribute('data-guid', 'HOST_LINE');
  body.appendChild(host);
  await plugin._buildInlineRefsSection(null, 'TARGET_LINE', host, 'HOST_LINE');
  await tick(0);
  assert.equal(fillCalls, 1, '_fillInlineRefs runs within one macrotask while meta hangs');
});

test('v4.49.3 shared inbound @linkto search dedupes concurrent callers', async () => {
  const { plugin } = loadPlugin();
  let searchCalls = 0;
  plugin.data.searchByQuery = async (query) => {
    searchCalls++;
    await tick(5);
    return { lines: [{ guid: 'SRC_LINE', record: { guid: 'REC' } }], error: null };
  };
  const [a, b] = await Promise.all([
    plugin._sharedExactRefSearch('TARGET_LINE', 250),
    plugin._sharedExactRefSearch('TARGET_LINE', 200),
  ]);
  assert.equal(searchCalls, 1);
  assert.equal(a, b);
});

test('v4.49.3 chain abort does not reject shared inbound search promise', async () => {
  const { plugin } = loadPlugin();
  let release;
  const shared = new Promise((resolve) => { release = resolve; });
  plugin.data.searchByQuery = () => shared;
  const pending = plugin._sharedExactRefSearch('TARGET_LINE', 200);
  const controller = new AbortController();
  controller.abort();
  await plugin._refLevelIncomingCandidates('TARGET_LINE', 200, controller.signal).catch(() => {});
  release({ lines: [{ guid: 'SRC', record: { guid: 'REC' } }], error: null });
  const result = await pending;
  assert.ok(Array.isArray(result.lines));
});

test('v4.49.3 hung root resolve is replaced when fill succeeds', async () => {
  const { plugin } = loadPlugin();
  plugin._resolveRefLevel = () => new Promise(() => {});
  const entry = {
    targetGuid: 'TARGET_LINE',
    chainEl: {
      _refxChainTreeState: {
        deferRoot: true,
        rootJob: {
          isRoot: true,
          guid: 'TARGET_LINE',
          container: new FakeEl('div'),
          parentCtx: { guid: 'TARGET_LINE', depth: 0, path: [], ancestry: new Set() },
        },
        section: new FakeEl('section'),
      },
    },
    _rawItems: [{ guid: 'SRC', record: { guid: 'REC' }, segments: [] }],
  };
  entry.chainEl._refxChainTreeState.rootJob.container.replaceChildren(
    Object.assign(new FakeEl('div'), { className: 'refx-chain-level-error', textContent: 'This level took too long to load' })
  );
  plugin._refLevelIncomingRow = (line) => ({
    guid: line.guid, isLine: true, title: 'row', text: 'row',
    sourceRecordGuid: 'REC', sourceRecordName: 'Page', via: 'in',
  });
  plugin._refLevelRowsFromCandidates = (_guid, rows) => Object.freeze(rows);
  plugin._settleRefChainTreeResolution = (state, job) => {
    job.container.dataset.refxResolved = '1';
    job.container.replaceChildren(new FakeEl('div'));
    return true;
  };
  plugin._settleInlineRefChainRootFromFill(entry, entry._rawItems, { isCapped: false });
  assert.equal(entry.chainEl._refxChainTreeState.rootJob.container.dataset.refxResolved, '1');
});

test('v4.49.3 native floor keeps zero protection but fresh count wins', () => {
  const { plugin } = loadPlugin();
  const line = new FakeEl('div');
  const pill = { textContent: '2', closest: () => line };
  line.querySelectorAll = () => [pill];
  assert.equal(plugin._targetCountWithNativeFloor(line, 1, { count: 1 }), 1);
  assert.equal(plugin._targetCountWithNativeFloor(line, 0, { count: 0 }), 2);
  assert.equal(plugin._targetCountWithNativeFloor(line, 1, { count: 1, fromDisk: true }), 2);
  assert.equal(plugin._targetCountWithNativeFloor(line, 1, { count: 1, capped: true }), 2);
});

test('v4.49.3 fill completion repaints line badge from section rows', async () => {
  const { plugin, body } = loadPlugin();
  const painted = [];
  plugin._paintCountInfoForGuidNow = (guid, info) => painted.push([guid, info.count]);
  plugin._paintTargetEntriesNow = (_entries, guid, info) => painted.push(['target', guid, info.count]);
  plugin._inlineHostNode = () => {
    const el = new FakeEl('div');
    el.className = 'listitem';
    return el;
  };
  plugin._queryRefLines = async () => ([
    { guid: 'A', record: { guid: 'REC' } },
    { guid: 'B', record: { guid: 'REC' } },
  ]);
  plugin._queryPropertyRefRecords = async () => [];
  plugin._settleInlineRefChainRootFromFill = () => true;
  const host = new FakeEl('div');
  host.className = 'listitem';
  host.setAttribute('data-guid', 'HOST_LINE');
  body.appendChild(host);
  await plugin._buildInlineRefsSection(null, 'TARGET_LINE', host, 'HOST_LINE');
  await tick(0);
  await tick(20);
  const cached = plugin.getCachedCountInfo('TARGET_LINE');
  assert.equal(cached?.count, 2);
  assert.ok(painted.some((row) => row[0] === 'TARGET_LINE' && row[1] === 2));
});

test('version locks 4.49.3', () => {
  assert.equal(manifest.version, '4.64.1');
  assert.ok(source.startsWith('// v4.64.1'), 'first line must be // v4.49.9');
  assert.ok(source.includes('window.__REFX_VERSION = "4.64.1"'), '__REFX_VERSION must be 4.49.7');
});
