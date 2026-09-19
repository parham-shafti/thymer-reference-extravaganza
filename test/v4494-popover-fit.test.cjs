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
    this.style = {
      setProperty(name, value) { this[name] = String(value); },
      getPropertyValue(name) { return this[name] ?? ''; },
      removeProperty(name) { delete this[name]; },
    };
    this.dataset = {};
    this.className = '';
    const self = this;
    this.classList = {
      add(c) { self.className = (self.className ? self.className + ' ' : '') + c; },
      remove() {},
      toggle() {},
      contains(c) { return (self.className || '').split(/\s+/).filter(Boolean).includes(c); },
    };
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
  after(node) {
    const p = this.parentNode;
    if (!p) return node;
    if (node?.parentNode) node.parentNode.removeChild(node);
    const i = p.children.indexOf(this);
    p.children.splice(i + 1, 0, node);
    node.parentNode = p;
    return node;
  }
}

function mkAnchor(rect) {
  const el = new FakeEl('span');
  el.getBoundingClientRect = () => rect;
  return el;
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
      contains: () => true,
    },
    Element: FakeEl,
    window: {
      CSS: { escape: (s) => String(s) },
      g_universe: { itemsByGuid: {}, workspace: {} },
      innerWidth: 900,
      innerHeight: 480,
    },
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
  return { plugin, body, document: context.document, window: context.window };
}

function mkPop(h = 700, w = 320) {
  const pop = new FakeEl('div');
  pop.offsetHeight = h;
  pop.offsetWidth = w;
  return pop;
}

test('chip near the bottom of a short window flips above and caps maxHeight to the upper pocket', () => {
  const { plugin } = loadPlugin();
  const pop = mkPop(700);
  const anchor = mkAnchor({ top: 380, bottom: 400, left: 100, right: 160, width: 60, height: 20 });
  plugin._positionPopover(pop, [anchor]);
  assert.equal(pop.style.maxHeight, '362px');
  assert.ok(parseInt(pop.style.top, 10) >= 12);
  assert.ok(parseInt(pop.style.top, 10) + 362 <= 468);
});

test('menu that fits below keeps top = rect.bottom + 6 and no maxHeight', () => {
  const { plugin } = loadPlugin();
  const pop = mkPop(200);
  const anchor = mkAnchor({ top: 100, bottom: 120, left: 100, right: 160, width: 60, height: 20 });
  plugin._positionPopover(pop, [anchor]);
  assert.equal(pop.style.top, '126px');
  assert.ok(!pop.style.maxHeight);
});

test('below pocket wins when above is smaller', () => {
  const { plugin } = loadPlugin();
  const pop = mkPop(700);
  const anchor = mkAnchor({ top: 60, bottom: 80, left: 100, right: 160, width: 60, height: 20 });
  plugin._positionPopover(pop, [anchor]);
  assert.equal(pop.style.maxHeight, '382px');
  assert.equal(pop.style.top, '86px');
});

test('side placement caps to viewport height', () => {
  const { plugin } = loadPlugin();
  const pop = mkPop(700);
  const anchor = mkAnchor({ top: 100, bottom: 120, left: 100, right: 160, width: 60, height: 20 });
  plugin._positionPopover(pop, [anchor], { placement: 'side' });
  assert.equal(pop.style.maxHeight, '456px');
  assert.equal(pop.style.top, '12px');
});

test('fit:false leaves maxHeight unset (picker path)', () => {
  const { plugin } = loadPlugin();
  const pop = mkPop(700);
  const anchor = mkAnchor({ top: 380, bottom: 400, left: 100, right: 160, width: 60, height: 20 });
  plugin._positionPopover(pop, [anchor], { fit: false });
  assert.ok(!pop.style.maxHeight);
  const spill = mkPop(450);
  plugin._positionPopover(spill, [anchor], { fit: false });
  assert.equal(spill.style.top, '406px');
  assert.ok(!spill.style.maxHeight);
  const flip = mkPop(300);
  plugin._positionPopover(flip, [anchor], { fit: false });
  assert.equal(flip.style.top, '74px');
});

test('_fitRefMenuToPocket shrinks chain and Block Context so six action rows fit', () => {
  const { plugin } = loadPlugin();
  const pop = new FakeEl('div');
  const contextSection = new FakeEl('div');
  const list = new FakeEl('div');
  for (let i = 0; i < 14; i++) {
    const row = new FakeEl('div');
    row.className = 'refalias-result';
    list.appendChild(row);
  }
  for (let i = 0; i < 3; i++) {
    const div = new FakeEl('div');
    div.className = 'refx-menu-divider';
    list.appendChild(div);
  }
  const tight = plugin._fitRefMenuToPocket(pop, contextSection, list, 300);
  const total = 34 + 44 + tight.chain + 26 + tight.cap + 6 * 28 + 10;
  assert.ok(total <= 300 || (tight.chain === 40 && tight.cap === 56));
  assert.ok(tight.chain >= 40);
  assert.ok(tight.cap >= 56);
  const roomy = plugin._fitRefMenuToPocket(pop, contextSection, list, 900);
  assert.equal(roomy.chain, 120);
  assert.equal(roomy.cap, 200);
});

test('_fitLineRefMenuContext honors the cap and the lock', () => {
  const { plugin } = loadPlugin();
  const section = new FakeEl('div');
  section.dataset.refxContextCap = '80';
  const body = new FakeEl('div');
  body.className = 'refx-line-context-body';
  section.appendChild(body);
  plugin._lineRefContextCacheGet = () => ({
    context: {
      target: { guid: 'T' },
      parent: { guid: 'P' },
      breadcrumbs: [{ guid: 'B' }],
      sections: [{ key: 'children', directTotal: 6, directItems: [] }],
    },
    ownerName: 'Owner',
  });
  const capped = plugin._fitLineRefMenuContext(section, 'T');
  assert.equal(capped, 80);
  section.dataset.refxHeightLocked = '1';
  body.style.setProperty('--refx-line-context-height', '80px');
  const locked = plugin._fitLineRefMenuContext(section, 'T');
  assert.equal(locked, 80);
  assert.equal(body.style.getPropertyValue('--refx-line-context-height'), '80px');
});

test('outgoing chain reservation keeps the chain budget constant', () => {
  const { plugin } = loadPlugin();
  const pop = new FakeEl('div');
  pop.className = 'refx-refmenu';
  pop.style.setProperty('--refx-refmenu-chain-height', '120px');
  const outgoing = new FakeEl('div');
  outgoing.className = 'refx-ref-chain-outgoing';
  for (let i = 0; i < 3; i++) {
    const row = new FakeEl('div');
    row.className = 'refx-ref-chain-row';
    outgoing.appendChild(row);
  }
  plugin._reserveRefMenuChainBudget(pop, outgoing);
  const chain = parseInt(pop.style.getPropertyValue('--refx-refmenu-chain-height'), 10);
  const out = parseInt(pop.style.getPropertyValue('--refx-refmenu-outgoing-height'), 10);
  assert.equal(chain + out, 120);
  assert.ok(out >= 40);
});

test('scanChipRefChains resolves at most 12 cold guids per pass and re-queues the rest', async () => {
  const { plugin } = loadPlugin();
  let calls = 0;
  plugin._refChainCacheGet = () => null;
  plugin._resolveRefChain = async () => { calls++; return []; };
  plugin._paintRefChainChip = () => {};
  const refs = [];
  for (let i = 0; i < 20; i++) {
    const chip = new FakeEl('span');
    chip.classList.contains = (cls) => cls === 'lineitem-ref';
    refs.push({ guid: 'G' + i, anchor: chip });
  }
  const state = { scanSeq: 1, panelId: 'p' };
  await plugin.scanChipRefChains(refs, state, 1);
  assert.equal(calls, 12);
  assert.equal(state.refChainScanRequest.refs.length, 8);
});

test('outgoing section on the menu reserves inside the chain budget through _appendRefChainSection', () => {
  const { plugin } = loadPlugin();
  const pop = new FakeEl('div');
  pop.className = 'refalias-pop refx-refmenu';
  pop.style.setProperty('--refx-refmenu-chain-height', '120px');
  const incoming = new FakeEl('div');
  incoming.className = 'refx-ref-chain refx-ref-chain-incoming refx-ref-chain-tree';
  pop.appendChild(incoming);
  plugin._buildRefContextRow = () => {
    const rowEl = new FakeEl('div');
    rowEl.className = 'refx-ref-chain-row';
    return { rowEl, rowTopEl: rowEl };
  };
  plugin._refRowClipboardActions = () => [];
  plugin._mediaLineInfo = () => null;
  plugin._liveStateByGuid = () => null;
  plugin._appendRefChainSection(pop, 'T', [{
    guid: 'A', text: 'a', via: 'inline', depth: 1, isLine: true,
  }], { lazyIncoming: false });
  assert.equal(pop.dataset.refxOutgoingReserved, '1');
  const chain = parseInt(pop.style.getPropertyValue('--refx-refmenu-chain-height'), 10);
  const outgoing = parseInt(pop.style.getPropertyValue('--refx-refmenu-outgoing-height'), 10);
  assert.equal(chain + outgoing, 120);
});

test('reserveHeight clamps a short skeleton popover to the remaining pocket', () => {
  const { plugin } = loadPlugin();
  const pop = mkPop(150);
  const mid = mkAnchor({ top: 200, bottom: 220, left: 100, right: 160, width: 60, height: 20 });
  plugin._positionPopover(pop, [mid], { reserveHeight: 560 });
  assert.equal(pop.style.maxHeight, '242px');
  assert.equal(pop.style.top, '226px');
  const low = mkPop(150);
  const bottom = mkAnchor({ top: 380, bottom: 400, left: 100, right: 160, width: 60, height: 20 });
  plugin._positionPopover(low, [bottom], { reserveHeight: 560 });
  assert.equal(low.style.maxHeight, '362px');
  assert.equal(low.style.top, '12px');
});

test('clamped generic popups get overflow-y auto; ref menus keep their own overflow', () => {
  const { plugin } = loadPlugin();
  const generic = mkPop(700);
  generic.className = 'refalias-pop';
  const anchor = mkAnchor({ top: 380, bottom: 400, left: 100, right: 160, width: 60, height: 20 });
  plugin._positionPopover(generic, [anchor]);
  assert.equal(generic.style.overflowY, 'auto');
  const menu = mkPop(700);
  menu.className = 'refalias-pop refx-refmenu';
  plugin._positionPopover(menu, [anchor]);
  assert.ok(!menu.style.overflowY);
});

test('v4.49.4 source guards', () => {
  assert.match(source, /rec\.getLineItems\(false\)/);
  assert.match(source, /_sharedExactRefSearch\(guid, this\._maxResults\)/);
  assert.match(source, /\.refx-refmenu > \.refx-ref-chain-tree \.refx-chain-tree-root \{\s*height: var\(--refx-refmenu-chain-height/);
  assert.match(source, /\.refalias-pop\.refx-line-context-pop \.refx-line-context-body \{\s*flex: 1 1 auto; min-height: 0;/);
  assert.match(source, /\.refx-hoverpop \{[^}]*overflow: hidden/);
  assert.equal(manifest.version, '4.64.1');
  assert.ok(source.startsWith('// v4.64.1'));
  assert.ok(source.includes('window.__REFX_VERSION = "4.64.1"'));
});
