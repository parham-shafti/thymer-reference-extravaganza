'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'plugin.js'), 'utf8');

function installFakeDom(context) {
  const makeEl = (tag) => {
    const listeners = {};
    const classes = new Set();
    const el = {
      tagName: String(tag).toUpperCase(),
      textContent: '', title: '', children: [], isConnected: true,
      style: {}, dataset: {}, disabled: false, _listeners: listeners,
      parentElement: null, parentNode: null,
      previousElementSibling: null, nextSibling: null,
      clientWidth: 800,
      classList: {
        add(...names) { names.forEach((name) => classes.add(name)); },
        remove(...names) { names.forEach((name) => classes.delete(name)); },
        contains(name) { return classes.has(name); },
        toggle(name, force) {
          if (force === undefined) force = !classes.has(name);
          if (force) classes.add(name); else classes.delete(name);
          return force;
        },
      },
      appendChild(child) {
        child.parentElement = this;
        child.parentNode = this;
        child.isConnected = this.isConnected;
        this.children.push(child);
        return child;
      },
      append(...children) { for (const child of children) this.appendChild(child); },
      replaceChildren(...children) {
        for (const c of this.children) { c.parentElement = null; c.isConnected = false; }
        this.children = [];
        for (const c of children) this.appendChild(c);
      },
      insertBefore(child, before) {
        const index = this.children.indexOf(before);
        if (index < 0) return this.appendChild(child);
        this.children.splice(index, 0, child);
        child.parentElement = this;
        child.parentNode = this;
        child.isConnected = this.isConnected;
        return child;
      },
      addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
      dispatchEvent(ev) {
        const fns = listeners[ev.type] || [];
        for (const fn of fns) fn(ev);
        return true;
      },
      setAttribute(name, value) {
        if (name === 'data-guid') this.dataset.guid = String(value);
        this[name] = String(value);
      },
      getAttribute(name) {
        if (name === 'data-guid') return this.dataset.guid ?? this[name] ?? null;
        return this[name] ?? null;
      },
      remove() {
        if (this.parentElement) {
          this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
        }
        this.parentElement = null;
        this.parentNode = null;
        this.isConnected = false;
      },
      closest(selector) {
        let node = this;
        const wanted = selector.startsWith('.') ? selector.slice(1).split(/[\s\[:]/)[0] : '';
        while (node) {
          if (wanted && node.classList?.contains(wanted)) return node;
          node = node.parentElement;
        }
        return null;
      },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      scrollIntoView() { this._scrolled = true; },
    };
    Object.defineProperty(el, 'className', {
      get: () => [...classes].join(' '),
      set: (value) => {
        classes.clear();
        String(value || '').split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
      },
    });
    Object.defineProperty(el, 'firstChild', {
      get() { return this.children[0] || null; },
    });
    Object.defineProperty(el, 'firstElementChild', {
      get() { return this.children[0] || null; },
    });
    return el;
  };
  context.document.createElement = makeEl;
  return makeEl;
}

function loadPlugin() {
  const storage = new Map();
  const docListeners = new Map();
  const addDocListener = (type, fn) => {
    if (!docListeners.has(type)) docListeners.set(type, []);
    docListeners.get(type).push(fn);
  };
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
    CustomEvent: class {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail ?? null;
      }
    },
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    document: {
      createElement: () => ({
        style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        append() {}, setAttribute() {}, appendChild() {}, replaceChildren() {},
        addEventListener(type, fn) { addDocListener(type, fn); },
        remove() {},
        hidden: false, children: [], isConnected: true, parentElement: null,
        previousElementSibling: null, nextSibling: null, dataset: {},
        dispatchEvent(event) {
          for (const fn of docListeners.get(event.type) || []) fn(event);
          return true;
        },
      }),
      getElementById: (id) => context._styleEls?.get(id) || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { clientHeight: 900 },
      body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, children: [] },
      head: { appendChild(el) { if (el.id) context._styleEls.set(el.id, el); } },
      addEventListener(type, fn) { addDocListener(type, fn); },
      removeEventListener: () => {},
      dispatchEvent(event) {
        for (const fn of docListeners.get(event.type) || []) fn(event);
        return true;
      },
    },
    Element: class {},
    window: {
      CSS: { escape: (s) => String(s) },
      g_universe: { itemsByGuid: {}, workspace: {} },
      innerWidth: 1200,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  };
  context._styleEls = new Map();
  context._docListeners = docListeners;
  context.globalThis = context;
  vm.runInNewContext(source + '\nthis.PluginUnderTest = Plugin;', context, { filename: 'plugin.js' });
  const plugin = new context.PluginUnderTest();
  plugin._unloaded = false;
  plugin._isMac = true;
  plugin._recheckBackgroundGate = async () => true;
  plugin._toast = () => {};
  plugin.ui = {
    addCommandPaletteCommand: () => ({ dispose() {} }),
    addStatusBarItem: () => ({ dispose() {} }),
  };
  plugin.data = {
    getRecord: async () => null,
    getAllCollections: async () => [],
  };
  return { plugin, context, storage };
}

function createBridge(plugin, context) {
  const bridge = {
    version: context.window.__REFX_VERSION || '4.64.1',
    registerMenuExtension: (definition) => plugin._registerMenuExtension(definition),
    unregisterMenuExtension: (id, ownerId) => plugin._unregisterMenuExtension(id, ownerId),
    listMenuExtensions: () => plugin._listMenuExtensions(),
  };
  plugin._refxBridge = bridge;
  context.window.__refx = bridge;
  plugin._drainRefxMenuExtensionProviders(bridge);
  plugin._wbPokeMenuRegistrants('bridge-ready');
  context.document.dispatchEvent(new context.CustomEvent('refx:bridge-ready', { detail: { version: bridge.version } }));
  return bridge;
}

test('S1: queued menu-extension providers drain on bridge-ready and before menu build', () => {
  const { plugin, context } = loadPlugin();
  installFakeDom(context);
  context.window.__REFX_VERSION = '4.64.1';
  context.window.__refxMenuExtensionProviders = [];

  const earlyCalls = [];
  context.window.__refxMenuExtensionProviders.push((bridge) => { earlyCalls.push(bridge); });

  const bridgeReadyEvents = [];
  context.document.addEventListener('refx:bridge-ready', (ev) => { bridgeReadyEvents.push(ev); });

  const bridge = createBridge(plugin, context);

  assert.equal(earlyCalls.length, 1, 'early provider runs once when bridge is created');
  assert.equal(earlyCalls[0], bridge);
  assert.equal(context.window.__refxMenuExtensionProviders.length, 0, 'providers array emptied after drain');
  assert.equal(bridgeReadyEvents.length, 1);
  assert.equal(bridgeReadyEvents[0].detail.version, '4.64.1');

  const lateCalls = [];
  context.window.__refxMenuExtensionProviders.push((bridgeArg) => { lateCalls.push(bridgeArg); });
  plugin._availableMenuExtensions({});
  assert.equal(lateCalls.length, 1, 'late provider runs on next _availableMenuExtensions');
  assert.equal(lateCalls[0], bridge);
  assert.equal(context.window.__refxMenuExtensionProviders.length, 0);

  plugin._availableMenuExtensions({});
  assert.equal(lateCalls.length, 1, 'provider is not invoked twice');

  context.window['other-plugin'] = {};
  plugin._registerMenuExtension({
    id: 'foreign-ext',
    owner: 'other-plugin',
    label: 'Foreign',
    onSelect: () => {},
  });
  context.window.__refxMenuExtensionProviders.push(() => {});
  const providersRef = context.window.__refxMenuExtensionProviders;
  const extensionsRef = context.window.__refxMenuExtensions;
  plugin.onUnload();
  assert.equal(context.window.__refx, null);
  assert.equal(context.window.__refxMenuExtensionProviders, providersRef);
  assert.equal(context.window.__refxMenuExtensions, extensionsRef);
  assert.equal(context.window.__refxMenuExtensions.has('foreign-ext'), true);
});

function loadWbPlugin() {
  const { plugin, context, storage } = loadPlugin();
  installFakeDom(context);
  plugin._wbHeaders = new Map();
  plugin._wbOwner = { token: 1 };
  plugin._wbOwnerCurrent = () => true;
  plugin._wbRefreshCurrent = () => true;
  plugin._wbRefreshSeq = 1;
  plugin._wbBootDiagOpenAt = performance.now();
  plugin._wbBootDiag = { trail: {} };
  context.window.__REFX_WB_BOOT_DIAG = plugin._wbBootDiag;
  plugin.getOrLoadRecordName = (g) => ({ REC_OWNER: 'Owner Page' }[g] || g);
  plugin._bridgeJump = () => {};
  plugin._refRowClipboardActions = () => [];
  plugin._navigatorContextText = (anc) => (anc?.segments || []).map((s) => s.text).join('');
  plugin._mediaLineInfo = () => null;
  plugin._cleanDisplayText = (segs) => (segs || []).map((s) => s.text || '').join('');
  plugin._mkRefRowAction = (label, title, fn) => ({ label, title, fn });
  plugin._appendFlatAncestorTrail = (crumbEl, ancChain) => {
    for (const anc of ancChain || []) {
      const btn = context.document.createElement('button');
      btn.className = 'trc-ref-popover-crumb-parent';
      btn.dataset.guid = anc.guid;
      btn.textContent = (anc.segments || []).map((s) => s.text).join('');
      crumbEl.appendChild(btn);
    }
  };
  plugin._wbCtxTruncateCrumbLabels = () => {};
  plugin._el = (tag, cls) => context.document.createElement(tag);
  plugin.data = {
    getRecord: (g) => (g === 'REC_OWNER' ? { guid: g } : null),
    getAllCollections: async () => [],
  };
  return { plugin, context, storage };
}

function makeShelfNode(targetGuid, ownerGuid) {
  const listview = {
    getAttribute: (k) => (k === 'data-guid' ? ownerGuid : null),
    closest: () => null,
  };
  const li = {
    getAttribute: (k) => (k === 'data-guid' ? targetGuid : null),
    closest: (sel) => (sel && sel.includes('listview-items') ? listview : null),
  };
  return {
    insertBefore(child, before) {
      child.parentNode = this;
      child.isConnected = true;
      return child;
    },
    querySelector: (sel) => {
      if (sel.includes('transclusion-container-div') && sel.includes(targetGuid)) return li;
      if (sel.includes(targetGuid)) return li;
      return null;
    },
  };
}

function makeWbHeader(plugin, lineGuid = 'WB1') {
  const h = {
    el: { nextSibling: null, isConnected: true, querySelector: () => null },
    ctx: null,
    ctxChain: null,
    ctxExpanded: false,
    ctxRetryTimer: 0,
    ctxResolveGen: 0,
  };
  plugin._wbHeaders.set(lineGuid, h);
  return h;
}

test('S2: cached trail paints synchronously on first decorate with no registry', () => {
  const { plugin, context } = loadWbPlugin();
  context.window.g_universe.itemsByGuid = {};
  const chainJson = JSON.stringify({
    o: 'REC_OWNER',
    on: 'Owner Page',
    c: [['LINE_A', 'ancestor a'], ['LINE_B', 'ancestor b']],
  });
  const line = {
    guid: 'WB_LINE',
    props: { refx_chain: chainJson, refx_variant: 'full' },
    setMetaProperty() {},
  };
  const it = { lineGuid: 'WB_LINE', target: 'LINE_LEAF', variant: 'full', line };
  const h = makeWbHeader(plugin, it.lineGuid);
  const node = makeShelfNode('LINE_LEAF', 'REC_OWNER');
  let paints = 0;
  let paintBeforeWarm = false;
  let warmCalled = false;
  plugin._wbLiveRenderContextPaint = () => { paints++; paintBeforeWarm = !warmCalled; };
  plugin._wbCtxWarmResolve = () => { warmCalled = true; };
  plugin._wbLiveRenderContext(node, it, h, false);
  assert.equal(paints, 1, 'cached paint runs synchronously');
  assert.equal(paintBeforeWarm, true, 'cached paint completes before warm resolve starts');
  assert.ok(h.ctx);
  assert.ok(h.ctx.classList.contains('is-cached'));
  assert.equal(h.ctxChain?.cached, true);
  assert.equal(plugin._wbBootDiag.trail.WB_LINE?.source, 'cache');
  assert.ok(typeof plugin._wbBootDiag.trail.WB_LINE?.cachedAt === 'number');
});

test('S3: equal live chain skips repaint and drops is-cached', () => {
  const { plugin, context } = loadWbPlugin();
  const owner = 'REC_OWNER';
  context.window.g_universe.itemsByGuid = {
    LINE_LEAF: {
      guid: 'LINE_LEAF', rguid: owner, type: 'task',
      text_segments: ['text', 'leaf'],
      parent: { guid: 'LINE_A', type: 'text' },
    },
    LINE_A: {
      guid: 'LINE_A', rguid: owner, type: 'text',
      text_segments: ['text', 'ancestor a'],
      parent: { guid: owner, type: 'document' },
    },
    [owner]: { guid: owner, rguid: owner, type: 'document', parent_unknown: true },
  };
  const chainJson = JSON.stringify({ o: owner, on: 'Owner Page', c: [['LINE_A', 'ancestor a']] });
  const line = { guid: 'WB_LINE', props: { refx_chain: chainJson }, setMetaProperty() {} };
  const it = { lineGuid: 'WB_LINE', target: 'LINE_LEAF', variant: 'full', line };
  const h = makeWbHeader(plugin, it.lineGuid);
  h.ctx = plugin._el('div', 'refx-wb-ctx');
  h.ctx.classList.add('is-cached');
  const crumbEl = plugin._el('span', 'trc-ref-popover-crumb');
  const btn = plugin._el('button', 'trc-ref-popover-crumb-parent');
  btn.dataset.guid = 'LINE_A';
  btn.textContent = 'ancestor a';
  crumbEl.appendChild(btn);
  h.ctx.appendChild(crumbEl);
  h.ctxChain = plugin._wbCtxParseCachedChain(it);
  const firstBtn = h.ctx.querySelector('.trc-ref-popover-crumb-parent');
  let paints = 0;
  plugin._wbLiveRenderContextPaint = () => { paints++; };
  const live = plugin._wbCtxChain(it.target);
  plugin._wbCtxWarmPaint(h, it, null, live, () => true, null, 'registry', 0);
  assert.equal(paints, 0, 'equal guid list does not repaint');
  assert.equal(h.ctxChain?.complete, true);
  assert.equal(h.ctx.classList.contains('is-cached'), false);
  assert.equal(h.ctx.querySelector('.trc-ref-popover-crumb-parent'), firstBtn);
});

test('S4: different live chain repaints once, rewrites refx_chain, kick resolves, ladder starts at 120', async () => {
  const { plugin, context } = loadWbPlugin();
  const owner = 'REC_OWNER';
  const chainJson = JSON.stringify({ o: owner, on: 'Owner Page', c: [['LINE_OLD', 'old']] });
  let writes = 0;
  const line = {
    guid: 'WB_LINE',
    props: { refx_chain: chainJson },
    setMetaProperty(key, value) {
      if (key === 'refx_chain') {
        writes++;
        this.props.refx_chain = value;
      }
    },
  };
  const it = { lineGuid: 'WB_LINE', target: 'LINE_LEAF', variant: 'full', line };
  const h = makeWbHeader(plugin, it.lineGuid);
  h.ctx = plugin._el('div', 'refx-wb-ctx');
  h.ctxChain = plugin._wbCtxParseCachedChain(it);
  let paints = 0;
  plugin._wbLiveRenderContextPaint = () => { paints++; };
  context.window.g_universe.itemsByGuid = {
    LINE_LEAF: {
      guid: 'LINE_LEAF', rguid: owner, type: 'task',
      text_segments: ['text', 'leaf'],
      parent: { guid: 'LINE_NEW', type: 'text' },
    },
    LINE_NEW: {
      guid: 'LINE_NEW', rguid: owner, type: 'text',
      text_segments: ['text', 'new ancestor'],
      parent: { guid: owner, type: 'document' },
    },
    [owner]: { guid: owner, rguid: owner, type: 'document', parent_unknown: true },
  };
  const live = plugin._wbCtxChain(it.target);
  plugin._wbCtxWarmPaint(h, it, null, live, () => true, null, 'registry', 2);
  assert.equal(paints, 1);
  assert.equal(writes, 1);
  assert.ok(line.props.refx_chain.includes('LINE_NEW'));
  const ladder = plugin._wbCtxWarmDelays();
  assert.equal(ladder[0], 120);
  assert.equal(ladder.join(','), '120,250,500,1000,2000,4000,8000,13000,21000');

  const it2 = { lineGuid: 'WB_KICK', target: 'LINE_K', variant: 'full', line: { props: {}, setMetaProperty() {} } };
  const h2 = makeWbHeader(plugin, it2.lineGuid);
  const node2 = makeShelfNode('LINE_K', owner);
  let kickResolves = 0;
  const origResolve = plugin._wbCtxWarmResolve.bind(plugin);
  plugin._wbCtxWarmResolve = (...args) => { kickResolves++; return origResolve(...args); };
  plugin._wbCtxScheduleWarmRetry(h2, it2, node2, false, null, plugin._wbOwner, 1, 0);
  assert.ok(h2.ctxRetryTimer);
  plugin._wbCtxKickPending();
  assert.equal(h2.ctxRetryTimer, 0);
  assert.equal(kickResolves, 1);
});

test('S5: native lineitem events invalidate affected shelf item; teardown offs ids; no bus when absent', async () => {
  const handlers = new Map();
  let nextId = 1;
  const { plugin, context } = loadWbPlugin();
  plugin.events = {
    on(name, fn) {
      const id = nextId++;
      handlers.set(id, { name, fn });
      return id;
    },
    off(id) { handlers.delete(id); },
  };
  plugin._wbCtxSubscribeEvents();
  assert.equal(plugin._wbCtxEventHandlers.length, 3);

  const owner = 'REC_OWNER';
  const lineA = { guid: 'WB_A', props: {}, setMetaProperty() {} };
  const lineB = { guid: 'WB_B', props: {}, setMetaProperty() {} };
  const itA = { lineGuid: 'WB_A', target: 'LINE_A', variant: 'full', line: lineA };
  const itB = { lineGuid: 'WB_B', target: 'LINE_B', variant: 'full', line: lineB };
  const hA = makeWbHeader(plugin, 'WB_A');
  const hB = makeWbHeader(plugin, 'WB_B');
  hA.target = 'LINE_A';
  hB.target = 'LINE_B';
  hA.ctxWarmIt = itA;
  hB.ctxWarmIt = itB;
  hA.ctxChain = {
    ownerGuid: owner,
    complete: true,
    chain: [{ guid: 'LINE_PARENT', segments: [{ type: 'text', text: 'parent' }] }],
  };
  hB.ctxChain = {
    ownerGuid: owner,
    complete: true,
    chain: [{ guid: 'LINE_OTHER', segments: [{ type: 'text', text: 'other' }] }],
  };
  let resolves = { WB_A: 0, WB_B: 0 };
  plugin._wbCtxWarmResolve = (h) => {
    const lg = h.ctxWarmIt?.lineGuid;
    if (lg) resolves[lg] = (resolves[lg] || 0) + 1;
  };

  for (const [, entry] of handlers) {
    if (entry.name === 'lineitem.moved') entry.fn({ lineitemGuid: 'LINE_PARENT' });
  }
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(resolves.WB_A, 1);
  assert.equal(resolves.WB_B, 0);

  plugin.onUnload();
  assert.equal(handlers.size, 0);

  const { plugin: plugin2 } = loadWbPlugin();
  plugin2.events = null;
  plugin2._wbCtxSubscribeEvents();
  assert.equal(plugin2._wbCtxEventHandlers.length, 0);
});

test('S6: refx_chain write guard dedupes while line.props lags; changed chain writes again', () => {
  const { plugin, context } = loadWbPlugin();
  const owner = 'REC_OWNER';
  const staleJson = JSON.stringify({ o: owner, on: 'Owner Page', c: [['LINE_OLD', 'old']] });
  let writes = 0;
  const line = {
    guid: 'WB_LINE',
    props: { refx_chain: staleJson },
    setMetaProperty(key, value) {
      if (key === 'refx_chain') writes++;
    },
  };
  const it = { lineGuid: 'WB_LINE', target: 'LINE_LEAF', variant: 'full', line };
  const h = makeWbHeader(plugin, it.lineGuid);
  h.ctx = plugin._el('div', 'refx-wb-ctx');
  h.ctxChain = plugin._wbCtxParseCachedChain(it);
  plugin._wbLiveRenderContextPaint = () => {};
  context.window.g_universe.itemsByGuid = {
    LINE_LEAF: {
      guid: 'LINE_LEAF', rguid: owner, type: 'task',
      text_segments: ['text', 'leaf'],
      parent: { guid: 'LINE_NEW', type: 'text' },
    },
    LINE_NEW: {
      guid: 'LINE_NEW', rguid: owner, type: 'text',
      text_segments: ['text', 'new ancestor'],
      parent: { guid: owner, type: 'document' },
    },
    [owner]: { guid: owner, rguid: owner, type: 'document', parent_unknown: true },
  };
  const live = plugin._wbCtxChain(it.target);
  plugin._wbCtxWarmPaint(h, it, null, live, () => true, null, 'registry', 0);
  assert.equal(writes, 1, 'first warm paint writes refx_chain once');
  assert.equal(line.props.refx_chain, staleJson, 'props lag: stale value unchanged');

  h.ctxChain = plugin._wbCtxParseCachedChain(it);
  plugin._wbCtxWarmPaint(h, it, null, live, () => true, null, 'registry', 1);
  assert.equal(writes, 1, 'second warm paint with same chain does not rewrite');

  context.window.g_universe.itemsByGuid.LINE_LEAF.parent = { guid: 'LINE_OTHER', type: 'text' };
  context.window.g_universe.itemsByGuid.LINE_OTHER = {
    guid: 'LINE_OTHER', rguid: owner, type: 'text',
    text_segments: ['text', 'other ancestor'],
    parent: { guid: owner, type: 'document' },
  };
  const live2 = plugin._wbCtxChain(it.target);
  h.ctxChain = plugin._wbCtxParseCachedChain(it);
  plugin._wbCtxWarmPaint(h, it, null, live2, () => true, null, 'registry', 2);
  assert.equal(writes, 2, 'changed chain produces a second write');
});

test('S7: _wbCtxEventLineGuid resolves every known payload shape; event diag written once', () => {
  const { plugin, context } = loadWbPlugin();
  const shapes = [
    { lineitem: { guid: 'G_LINEITEM' } },
    { lineItem: { guid: 'G_LINEITEM_CAMEL' } },
    { item: { guid: 'G_ITEM' } },
    { lineitemGuid: 'G_LINEITEM_GUID' },
    { lineItemGuid: 'G_LINEITEM_GUID_CAMEL' },
    { guid: 'G_TOP' },
    { line: { guid: 'G_LINE' } },
  ];
  const expected = ['G_LINEITEM', 'G_LINEITEM_CAMEL', 'G_ITEM', 'G_LINEITEM_GUID', 'G_LINEITEM_GUID_CAMEL', 'G_TOP', 'G_LINE'];
  for (let i = 0; i < shapes.length; i++) {
    assert.equal(plugin._wbCtxEventLineGuid(shapes[i]), expected[i]);
  }
  assert.equal(plugin._wbCtxEventLineGuid({}), null);
  assert.equal(plugin._wbCtxEventLineGuid({ lineitem: { guid: '' }, guid: 'FALLBACK' }), 'FALLBACK');

  const handlers = new Map();
  let nextId = 1;
  plugin.events = {
    on(name, fn) {
      const id = nextId++;
      handlers.set(id, { name, fn });
      return id;
    },
    off(id) { handlers.delete(id); },
  };
  plugin._wbCtxSubscribeEvents();
  const moved = [...handlers.values()].find((e) => e.name === 'lineitem.moved').fn;
  const updated = [...handlers.values()].find((e) => e.name === 'lineitem.updated').fn;

  moved({ lineitemGuid: 'LINE_A', extra: 1 });
  assert.ok(context.window.__REFX_WB_BOOT_DIAG.events);
  assert.deepEqual([...context.window.__REFX_WB_BOOT_DIAG.events.keys], ['lineitemGuid', 'extra']);
  assert.equal(context.window.__REFX_WB_BOOT_DIAG.events.resolvedGuid, true);
  assert.ok(typeof context.window.__REFX_WB_BOOT_DIAG.events.at === 'number');

  const firstDiag = context.window.__REFX_WB_BOOT_DIAG.events;
  updated({ lineItemGuid: 'LINE_B' });
  assert.equal(context.window.__REFX_WB_BOOT_DIAG.events, firstDiag, 'diag entry is written once');
});

function makeLineEl(makeEl, guid, classes = ['listitem']) {
  const li = makeEl('li');
  li.className = classes.join(' ');
  li.dataset.guid = guid;
  li.setAttribute = (name, value) => {
    if (name === 'data-guid') li.dataset.guid = String(value);
    li[name] = String(value);
  };
  li.getAttribute = (name) => {
    if (name === 'data-guid') return li.dataset.guid ?? li[name] ?? null;
    return li[name] ?? null;
  };
  li.matches = (sel) => {
    const parts = String(sel || '').split(/[.\s#[]/).filter(Boolean);
    return parts.every((part) => li.classList.contains(part) || part === 'listitem' && li.classList.contains('listitem'));
  };
  return li;
}

function linkParent(child, parent) {
  child.parentElement = parent;
  child.parentNode = parent;
  if (parent && !parent.children.includes(child)) parent.children.push(child);
}

function contextMenuEvent(target) {
  return {
    shiftKey: false,
    target,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.immediatePropagationStopped = true; },
  };
}

test('S8: Workbench inner lines open RefX block menu; shelf and bare transclusion stay native', () => {
  const { plugin, context } = loadWbPlugin();
  const makeEl = installFakeDom(context);
  const BACKING = '1KKKKKKKKKKKKKKKKKKKKKKKKK';
  const OWNER = 'REC_OWNER';
  plugin._wbBackingGuid = BACKING;

  const wbItem = makeEl('div');
  wbItem.className = 'listitem-transclusion refx-wb-item';
  const transclusion = makeEl('div');
  transclusion.className = 'transclusion-container-div';
  const listview = makeEl('div');
  listview.className = 'listview-items';
  listview.dataset.guid = OWNER;
  listview.getAttribute = (name) => (name === 'data-guid' ? listview.dataset.guid : null);
  const innerLine = makeLineEl(makeEl, 'INNER_LINE');
  linkParent(innerLine, listview);
  linkParent(listview, transclusion);
  linkParent(transclusion, wbItem);

  const shelfLine = makeLineEl(makeEl, 'SHELF_LINE', ['listitem', 'listitem-transclusion']);

  const bareTransclusion = makeEl('div');
  bareTransclusion.className = 'listitem-transclusion';
  const bareInner = makeLineEl(makeEl, 'BARE_INNER');
  linkParent(bareInner, bareTransclusion);

  const openCalls = [];
  plugin._openLineMenu = (guid, anchor, opts) => { openCalls.push({ guid, anchor, opts }); };
  plugin._openRefMenuForChip = () => { openCalls.push({ chip: true }); };

  plugin._handleContextMenu(contextMenuEvent(innerLine));
  assert.equal(openCalls.length, 1);
  assert.equal(openCalls[0].guid, 'INNER_LINE');
  assert.equal(openCalls[0].opts.lineNode, innerLine);

  openCalls.length = 0;
  plugin._handleContextMenu(contextMenuEvent(shelfLine));
  assert.equal(openCalls.length, 0, 'shelf transclusion line keeps native menu');

  openCalls.length = 0;
  plugin._handleContextMenu(contextMenuEvent(bareInner));
  assert.equal(openCalls.length, 0, 'bare transclusion outside Workbench keeps native menu');

  context.document.querySelector = (sel) => {
    if (sel.includes('INNER_LINE')) return innerLine;
    return null;
  };
  assert.equal(plugin._pageGuidFromDom('INNER_LINE'), OWNER);
  listview.dataset.guid = BACKING;
  assert.equal(plugin._pageGuidFromDom('INNER_LINE'), null, 'backing guid rejected centrally');
});

test('S9: registrant poke runs stale disposers then registers once per bridge generation', () => {
  const { plugin, context } = loadPlugin();
  installFakeDom(context);
  context.window.__REFX_WB_BOOT_DIAG = { registrants: [] };

  let d1Runs = 0;
  let d2Runs = 0;
  let registerRuns = 0;
  context.window.__FAKE_REG = {
    refxMenuDisposers: [
      () => { d1Runs++; },
      () => { d2Runs++; },
    ],
    _registerRefxMenuExtensions(n) { registerRuns++; },
  };
  context.window.__NO_METHOD = { refxMenuDisposers: [() => {}] };

  const bridge = createBridge(plugin, context);
  assert.equal(d1Runs, 1);
  assert.equal(d2Runs, 1);
  assert.equal(registerRuns, 1);
  assert.equal(context.window.__REFX_WB_BOOT_DIAG.registrants.length, 1);
  assert.equal(context.window.__REFX_WB_BOOT_DIAG.registrants[0].name, '__FAKE_REG');
  assert.equal(context.window.__REFX_WB_BOOT_DIAG.registrants[0].disposersRun, 2);

  plugin._wbPokeMenuRegistrants('repeat');
  assert.equal(d1Runs, 1, 'disposers not re-run on second poke');
  assert.equal(registerRuns, 1, 'register not re-run on second poke');

  plugin._availableMenuExtensions({});
  assert.equal(registerRuns, 1, 'empty registry poke is still once per generation');

  plugin.onUnload();
  assert.equal(plugin._wbMenuRegistrantPoked, null);

  d1Runs = 0;
  d2Runs = 0;
  registerRuns = 0;
  context.window.__FAKE_REG.refxMenuDisposers = [() => { d1Runs++; }, () => { d2Runs++; }];
  plugin._refxBridge = bridge;
  context.window.__refx = bridge;
  plugin._wbPokeMenuRegistrants('after-teardown');
  assert.equal(d1Runs, 1);
  assert.equal(registerRuns, 1, 'new bridge generation re-pokes registrant');
});

test('S10: Activity Timer rows in Extensions flyout via public API', async () => {
  const { plugin, context } = loadPlugin();
  installFakeDom(context);
  createBridge(plugin, context);

  const startCalls = [];
  const switchCalls = [];
  const stopCalls = [];
  const dockCalls = [];
  let atState = { ready: true, activeSessionGuid: null, active: null };

  context.window.__activityTimer = {
    getState: () => atState,
    start: (input) => { startCalls.push(input); return Promise.resolve({ ok: true }); },
    switch: (input) => { switchCalls.push(input); return Promise.resolve({ ok: true }); },
    stop: (input) => { stopCalls.push(input); return Promise.resolve({ ok: true }); },
    openDock: () => { dockCalls.push(true); return Promise.resolve({ ok: true }); },
  };

  const extIds = (ctx) => [...plugin._availableMenuExtensions(ctx).map((e) => e.id)].sort();
  const ids1 = extIds({ lineGuid: 'L1' });
  assert.deepEqual(ids1, ['refx-at:dock', 'refx-at:start']);
  assert.ok(!ids1.includes('refx-at:switch'));
  assert.ok(!ids1.includes('refx-at:stop'));

  const ids2 = extIds({ lineGuid: 'L1' });
  assert.deepEqual(ids2, ids1, 'second _availableMenuExtensions does not duplicate rows');
  assert.equal(context.window.__refxMenuExtensions.size, 4, 'all four rows registered once');

  const startExt = plugin._availableMenuExtensions({ lineGuid: 'L1' }).find((e) => String(e.id) === 'refx-at:start');
  startExt.onSelect({ lineGuid: 'L1' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(startCalls.length, 1);
  assert.equal(startCalls[0].sourceLine, 'L1');
  assert.equal(startCalls[0].origin, 'RefX line menu');

  atState = { ready: true, activeSessionGuid: 'SESS1', active: { sourceLine: 'OTHER' } };
  const ids3 = extIds({ lineGuid: 'L1' });
  assert.deepEqual(ids3, ['refx-at:dock', 'refx-at:stop', 'refx-at:switch']);
  assert.ok(!ids3.includes('refx-at:start'));

  delete context.window.__activityTimer;
  assert.equal(plugin._availableMenuExtensions({ lineGuid: 'L1' }).length, 0);
  for (const id of ['refx-at:start', 'refx-at:switch', 'refx-at:stop', 'refx-at:dock']) {
    assert.equal(context.window.__refxMenuExtensions.has(id), false, `${id} pruned when Activity Timer absent`);
  }
});
