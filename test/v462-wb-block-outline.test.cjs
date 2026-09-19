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
      querySelector(selector) {
        const walk = (node) => {
          for (const child of node.children || []) {
            if (selector.startsWith('.') && child.classList.contains(selector.slice(1).split(/[\s\[]/)[0])) return child;
            const hit = walk(child);
            if (hit) return hit;
          }
          return null;
        };
        return walk(this);
      },
      querySelectorAll(selector) {
        const wanted = selector.startsWith('.') ? selector.slice(1).split(/[\s\[]/)[0] : '';
        const out = [];
        const walk = (node) => {
          for (const child of node.children || []) {
            if (wanted && child.classList.contains(wanted)) out.push(child);
            walk(child);
          }
        };
        walk(this);
        return out;
      },
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
        addEventListener() {}, remove() {},
        hidden: false, children: [], isConnected: true, parentElement: null,
        previousElementSibling: null, nextSibling: null, dataset: {},
      }),
      getElementById: (id) => context._styleEls?.get(id) || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { clientHeight: 900 },
      body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, children: [] },
      head: { appendChild(el) { if (el.id) context._styleEls.set(el.id, el); } },
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    Element: class {},
    window: { CSS: { escape: (s) => String(s) }, g_universe: { itemsByGuid: {}, workspace: {} }, innerWidth: 1200 },
  };
  context._styleEls = new Map();
  context.globalThis = context;
  vm.runInNewContext(source + '\nthis.PluginUnderTest = Plugin;', context, { filename: 'plugin.js' });
  const plugin = new context.PluginUnderTest();
  plugin._unloaded = false;
  plugin._isMac = true;
  plugin._recheckBackgroundGate = async () => true;
  plugin._toast = () => {};
  plugin._wbHeaders = new Map();
  plugin._wbOwner = { token: 1 };
  plugin._wbOwnerCurrent = () => true;
  plugin._wbRefreshCurrent = () => true;
  plugin._wbRefreshSeq = 1;
  plugin._wbLiveScheduleRefresh = () => {};
  plugin._wbLiveDropPropCard = () => {};
  plugin._wbCtxTruncateCrumbLabels = () => {};
  plugin._wbLiveRenderContextApplyGroups = () => 0;
  plugin.getOrLoadRecordName = (g) => ({ REC_OWNER: 'Owner Page' }[g] || g);
  plugin._navigatorContextText = (anc) => (anc?.segments || []).map((s) => s.text).join('');
  plugin._mediaLineInfo = () => null;
  plugin._cleanDisplayText = (segs) => (segs || []).map((s) => s.text || '').join('');
  plugin._wbCtxAncDisplayText = (anc) => plugin._cleanDisplayText(anc?.segments || []);
  plugin._refRowClipboardActions = () => [];
  plugin._mkRefRowAction = (label, title, fn) => ({ label, title, fn });
  plugin._ensureElDataset = (el) => {
    if (!el.dataset) el.dataset = {};
    return el;
  };
  plugin.data = {
    getRecord: (g) => (g === 'REC_OWNER' ? { guid: g, getName: () => 'Owner Page', getLineItems: async () => [] } : null),
    getAllCollections: async () => [],
  };
  return { plugin, context, storage };
}

function seedFourLevelChain(context) {
  const owner = 'REC_OWNER';
  context.window.g_universe.itemsByGuid = {
    L4: {
      guid: 'L4', rguid: owner, type: 'task',
      text_segments: ['text', 'd'],
      parent_guid: 'L3',
    },
    L3: {
      guid: 'L3', rguid: owner, type: 'text',
      text_segments: ['text', 'c'],
      parent_guid: 'L2',
    },
    L2: {
      guid: 'L2', rguid: owner, type: 'text',
      text_segments: ['text', 'b'],
      parent_guid: 'L1',
    },
    L1: {
      guid: 'L1', rguid: owner, type: 'text',
      text_segments: ['text', 'a'],
      parent_guid: owner,
    },
    [owner]: { guid: owner, rguid: owner, type: 'document', parent_unknown: true },
  };
}

function makeWbPaintHarness(plugin, context) {
  const makeEl = installFakeDom(context);
  plugin._el = (tag, cls, text) => {
    const el = makeEl(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };
  plugin._ensureElDataset = (el) => {
    if (!el.dataset) el.dataset = {};
    return el;
  };
  const reroots = [];
  const jumps = [];
  plugin._wbLiveReroot = (it, guid, focus) => { reroots.push({ it, guid, focus }); };
  plugin._bridgeJump = (guid, opts) => { jumps.push({ guid, opts }); };
  return { makeEl, reroots, jumps };
}

test('B1: WB crumb clicks reroot or bridgeJump with modifier keys', () => {
  const { plugin, context } = loadPlugin();
  installFakeDom(context);
  seedFourLevelChain(context);
  const { reroots, jumps } = makeWbPaintHarness(plugin, context);
  const it = { lineGuid: 'WB1', target: 'L4', focus: 'L4', variant: 'full' };
  const h = { ctxExpanded: false };
  const ctxEl = plugin._el('div', 'refx-wb-ctx');
  const chainResult = plugin._wbCtxChain('L4');
  plugin._wbLiveRenderContextPaint(ctxEl, chainResult, it, h, () => true);
  const crumbEl = ctxEl.querySelector('.trc-ref-popover-crumb');
  assert.ok(crumbEl);
  const allCrumbBtns = [];
  const walkCrumbs = (node) => {
    for (const c of node.children || []) {
      if (c.classList && c.classList.contains('trc-ref-popover-crumb-parent')) allCrumbBtns.push(c);
      walkCrumbs(c);
    }
  };
  walkCrumbs(crumbEl);
  const ancBtn = allCrumbBtns.find((b) => b.dataset && b.dataset.guid === 'L3');
  assert.ok(ancBtn, 'ancestor crumb L3');
  ancBtn.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  assert.equal(reroots.length, 1);
  assert.equal(reroots[0].guid, 'L3');
  assert.equal(reroots[0].focus, 'L4');
  assert.equal(jumps.length, 0);
  ancBtn.dispatchEvent({ type: 'click', shiftKey: true, preventDefault() {}, stopPropagation() {} });
  assert.equal(jumps.length, 1);
  assert.equal(jumps[0].guid, 'L3');
  assert.equal(jumps[0].opts.newPanel, true);
  ancBtn.dispatchEvent({ type: 'click', metaKey: true, preventDefault() {}, stopPropagation() {} });
  assert.equal(jumps.length, 2);
  assert.equal(jumps[1].guid, 'L3');
  assert.equal(jumps[1].opts.newPanel, undefined);
  const recBtn = crumbEl.querySelector('.trc-ref-popover-crumb-rec');
  assert.ok(recBtn);
  recBtn.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  assert.equal(reroots.length, 2);
  assert.equal(reroots[1].guid, 'REC_OWNER');
  recBtn.dispatchEvent({ type: 'click', shiftKey: true, preventDefault() {}, stopPropagation() {} });
  assert.equal(jumps[jumps.length - 1].guid, 'REC_OWNER');
  assert.equal(jumps[jumps.length - 1].opts.newPanel, true);
  recBtn.dispatchEvent({ type: 'click', metaKey: true, preventDefault() {}, stopPropagation() {} });
  assert.equal(jumps[jumps.length - 1].guid, 'REC_OWNER');
  assert.equal(jumps[jumps.length - 1].opts.newPanel, undefined);
});

test('B2: linked-reference rows omit onCrumbClick — hook only when WB passes it', () => {
  assert.match(source, /opts\.onCrumbClick/);
  assert.match(source, /if \(opts\.onCrumbClick\)/);
  assert.match(source, /_appendFlatAncestorTrail\(crumbEl, chain, ctx, mkAncActions, \{\}\)/);
  assert.match(source, /onCrumbClick,/);
  const trailBody = source.slice(source.indexOf('_appendFlatAncestorTrail(crumbEl, chain, ctx, mkAncActions, opts = {})'),
    source.indexOf('_buildRefChildTree('));
  assert.doesNotMatch(trailBody, /ctx\.onJump\(anc\.guid\)/);
});

test('B3: full wrapping trail shows 8 ancestors and collapses 10', () => {
  const { plugin } = loadPlugin();
  const chain = [];
  for (let i = 1; i <= 10; i++) chain.push({ guid: 'A' + i });
  const plan = plugin._wbCtxTrailPlan(chain);
  assert.equal(plan.hidden.length, 2);
  assert.equal(plan.tail.length, 8);
  assert.match(source, /\.refx-wb-item > \.refx-wb-ctx \{[^}]*flex-wrap: wrap/);
  const ctxBlock = source.match(/\.refx-wb-item > \.refx-wb-ctx \{[^}]+\}/);
  assert.ok(ctxBlock);
  assert.doesNotMatch(ctxBlock[0], /text-overflow: ellipsis/);
});

test('B4: focus outline rules, reroot scroll-once, and guid guard', async () => {
  const { plugin, context } = loadPlugin();
  const makeEl = installFakeDom(context);
  const styleEl = context.document.createElement('style');
  styleEl.id = 'refx-wb-focus-rules';
  context._styleEls.set('refx-wb-focus-rules', styleEl);

  plugin._wbLiveFocusRulesSync([
    { focus: 'FOCUS01', target: 'TARGET1' },
    { focus: 'FOCUS01', target: 'FOCUS01' },
    { focus: 'BAD"><script', target: 'TARGET1' },
  ]);
  const text = styleEl.textContent;
  assert.match(text, /::before/);
  assert.match(text, /border: 2px solid var\(--refx-wb-focus-ring/);
  assert.match(text, /left: -10px/);
  assert.doesNotMatch(text, /outline:/);
  assert.doesNotMatch(text, /box-shadow/);
  assert.doesNotMatch(text, /background/);
  assert.match(text, /FOCUS01/);
  assert.ok(!text.includes('BAD"'));
  assert.equal((text.match(/data-guid="FOCUS01"/g) || []).length, 2);
  assert.doesNotMatch(text, /data-guid="BAD/);

  plugin._wbScrollFocusOnce = new Set(['WB_SCROLL']);
  plugin._wbScrollFocusTries = new Map();
  const container = makeEl('div');
  container.className = 'transclusion-container-div';
  const node = makeEl('div');
  node.className = 'refx-wb-item';
  node.appendChild(container);
  plugin._wbHeaders.set('WB_SCROLL', { el: makeEl('div'), variant: 'full', pinned: false, collapsed: false });
  plugin._wbFoldMount = () => {};
  plugin._wbClampApply = () => {};
  plugin._wbLiveRenderContext = () => {};
  plugin._wbLiveRenderVariantBody = () => {};
  plugin._wbPreserveQueryHost = () => {};
  plugin._wbTxRendered = () => true;
  const it = { lineGuid: 'WB_SCROLL', target: 'TARGET1', focus: 'FOCUS01', variant: 'full', collapsed: false };
  plugin._wbLiveDecorate(node, it);
  assert.equal(plugin._wbScrollFocusOnce.has('WB_SCROLL'), true, 'no rendered focus line yet — key stays');
  const focusLi = makeEl('div');
  focusLi.className = 'listitem';
  focusLi.setAttribute('data-guid', 'FOCUS01');
  container.appendChild(focusLi);
  plugin._wbLiveDecorate(node, it);
  assert.equal(focusLi._scrolled, true);
  assert.equal(plugin._wbScrollFocusOnce.has('WB_SCROLL'), false);
  plugin._wbScrollFocusOnce.add('WB_SCROLL');
  plugin._wbLiveDecorate(node, it);
  assert.equal(plugin._wbScrollFocusOnce.has('WB_SCROLL'), false);

  seedFourLevelChain(context);
  const oldLine = { guid: 'OLD', delete: async () => true };
  plugin._wbWriteShelfLine = async () => ({ guid: 'NEWLINE1' });
  plugin._wbBackingRecord = { guid: 'WB_RECORD', getGuid: () => 'WB_RECORD' };
  plugin._wbBackingValidatedGuid = 'WB_RECORD';
  plugin._wbScrollFocusOnce = new Set();
  await plugin._wbLiveReroot(
    { lineGuid: 'OLD', line: oldLine, target: 'L4', variant: 'full', pinned: false, collapsed: false },
    'L3', 'L4',
  );
  assert.ok(plugin._wbScrollFocusOnce.has('NEWLINE1'));
});

test('B8: focus-path ancestors are never depth-seeded into _wbFolds', () => {
  const { plugin, context } = loadPlugin();
  const makeEl = installFakeDom(context);
  context.window.g_universe = { itemsByGuid: {} };
  plugin._wbClampForeign = false;
  plugin.data = { getRecord: (g) => (g === 'HOME' ? { guid: g, getName: () => g } : null) };
  plugin._wbFoldMount = () => {};

  const setUni = (guid, rguid, parentGuid, children) => {
    const item = { guid, rguid, children: children || [] };
    if (parentGuid) item.parent = { guid: parentGuid, type: 'text' };
    context.window.g_universe.itemsByGuid[guid] = item;
  };
  setUni('HOME', 'HOME', null, [{ guid: 'TARGET' }]);
  setUni('TARGET', 'HOME', 'HOME', [{ guid: 'P1' }, { guid: 'SIB' }]);
  setUni('P1', 'HOME', 'TARGET', [{ guid: 'P2' }]);
  setUni('P2', 'HOME', 'P1', [{ guid: 'FOCUS' }]);
  setUni('FOCUS', 'HOME', 'P2', []);
  setUni('SIB', 'HOME', 'TARGET', [{ guid: 'SIBC' }]);
  setUni('SIBC', 'HOME', 'SIB', []);

  const node = makeEl('div');
  node.className = 'listitem-transclusion refx-wb-item';
  node.querySelector = (sel) => {
    if (sel === '.transclusion-container-div') return container;
    return null;
  };
  const container = makeEl('div');
  container.className = 'transclusion-container-div';
  node.appendChild(container);

  const addLine = (guid, parentEl) => {
    const li = makeEl('div');
    li.className = 'listitem';
    li.setAttribute('data-guid', guid);
    parentEl.appendChild(li);
    return li;
  };
  const targetLi = addLine('TARGET', container);
  const p1 = addLine('P1', targetLi);
  const p2 = addLine('P2', p1);
  addLine('FOCUS', p2);
  addLine('SIB', targetLi);

  const it = { lineGuid: 'WB8', target: 'TARGET', focus: 'FOCUS', variant: 'children', collapsed: false };
  plugin._wbClampApply(node, it);
  assert.ok(!plugin._wbFolds.has('WB8>P1'));
  assert.ok(!plugin._wbFolds.has('WB8>P2'));
  assert.ok(plugin._wbFolds.has('WB8>SIB'));
});

test('B9: Alt+ArrowLeft/Right zoom keys on focused header only when handled', () => {
  const { plugin, context } = loadPlugin();
  seedFourLevelChain(context);
  const reroots = [];
  plugin._wbLiveReroot = (it, guid, focus) => { reroots.push({ guid, focus }); };
  const hdr = context.document.createElement('div');
  hdr.className = 'refx-wb-hdr';
  hdr.__wbIt = { lineGuid: 'WB9', target: 'L3', focus: 'L4', variant: 'full' };
  hdr.offsetParent = hdr;
  plugin._wbNavHeaders = () => [hdr];
  plugin._wbNav = { index: 0 };
  plugin._clearNavPaint = () => {};
  plugin._cardNav = null;
  plugin._cardEditing = null;
  plugin._modal = null;
  plugin._link = null;

  let prevented = false;
  plugin._onWbNavKey({ key: 'ArrowLeft', altKey: true, preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
  assert.ok(prevented);
  assert.equal(reroots.length, 1);
  assert.equal(reroots[0].guid, 'L2');

  prevented = false;
  plugin._onWbNavKey({ key: 'ArrowRight', altKey: true, preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
  assert.ok(prevented);
  assert.equal(reroots.length, 2);
  assert.equal(reroots[1].guid, 'L4');
  assert.equal(reroots[1].focus, 'L4');

  hdr.__wbIt = { lineGuid: 'WB9', target: 'L4', focus: 'L4', variant: 'full' };
  prevented = false;
  plugin._onWbNavKey({ key: 'ArrowRight', altKey: true, preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
  assert.equal(prevented, false);
  assert.equal(reroots.length, 2);

  plugin._wbNav = null;
  prevented = false;
  plugin._onWbNavKey({ key: 'ArrowLeft', altKey: true, preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
  assert.equal(prevented, false);
});

test('B10: variant menu always shows zoom rows; header has no reroot-up button', () => {
  const { plugin, context } = loadPlugin();
  seedFourLevelChain(context);
  const makeEl = installFakeDom(context);
  context.document.body = makeEl('body');
  context.document.body.append = (...kids) => { for (const k of kids) context.document.body.appendChild(k); };
  plugin._el = (tag, cls, text) => {
    const el = makeEl(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };
  plugin._wbLiveSetVariant = () => {};
  plugin._wbLiveSetDepth = () => {};
  plugin._wbLiveTogglePin = () => {};
  plugin._wbLiveSwapToMain = () => {};
  plugin._wbHeaders.set('WB10', { el: { clientWidth: 800 } });
  const it = { lineGuid: 'WB10', target: 'L3', focus: 'L3', rootOf: 'L3', variant: 'full' };
  plugin._wbLiveVariantMenu(it, { currentTarget: makeEl('button'), preventDefault() {}, stopPropagation() {} });
  const pop = context.document.body.children[0];
  const labels = [...pop.children].map((r) => r.textContent);
  assert.ok(labels.some((t) => t.includes('Zoom out one level')));
  assert.ok(labels.some((t) => t.includes('Back to original')));

  const hdrSync = source.slice(source.indexOf('_wbLiveHeaderSync('), source.indexOf('_wbBtn(glyph, title, fn)'));
  assert.doesNotMatch(hdrSync, /Show parent in place/);
  assert.doesNotMatch(hdrSync, /⤒/);
  assert.match(hdrSync, /Back to original/);
});

function makeTree() {
  const leaf = { guid: 'LINE_LEAF', parent_guid: 'LINE_MID', segments: [{ type: 'text', text: 'leaf' }], children: [] };
  const mid = { guid: 'LINE_MID', parent_guid: 'LINE_ROOT', segments: [{ type: 'text', text: 'mid' }], children: [leaf] };
  const root = { guid: 'LINE_ROOT', parent_guid: null, segments: [{ type: 'text', text: 'root' }], children: [mid] };
  const sibling = { guid: 'LINE_SIB', parent_guid: 'LINE_ROOT', segments: [{ type: 'text', text: 'sibling' }], children: [] };
  root.children.push(sibling);
  return { items: [root], root, mid, leaf, sibling };
}

test('B5: crumb hover dwell builds one crumbpop with focus highlight and dismisses on leave', async () => {
  const { plugin, context } = loadPlugin();
  const makeEl = installFakeDom(context);
  plugin._el = (tag, cls, text) => {
    const el = makeEl(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };
  plugin._positionPopover = () => {};
  plugin._bridgeJump = () => {};
  context.document.body.append = (el) => context.document.body.appendChild(el);
  context.document.body.children = [];
  const { items, root, leaf } = makeTree();
  plugin.data = {
    getRecord: (g) => (g === 'REC_OWNER' ? { guid: g, getLineItems: async () => items } : null),
  };
  const panel = makeEl('div');
  panel.className = 'refx-wb-live';
  const ctxEl = plugin._el('div', 'refx-wb-ctx');
  ctxEl.dataset.refxWbLine = 'WB5';
  const crumb = plugin._el('button', 'trc-ref-popover-crumb-parent', 'root');
  crumb.dataset.guid = root.guid;
  crumb.parentElement = ctxEl;
  crumb.closest = (selector) => {
    if (selector === '.refx-hoverpop') return null;
    if (selector.includes('trc-ref-popover-crumb-parent')) return crumb;
    if (selector === '.refx-wb-ctx') return ctxEl;
    return null;
  };
  ctxEl.appendChild(crumb);
  ctxEl.parentElement = panel;
  ctxEl.closest = (selector) => (selector === '.refx-wb-ctx' ? ctxEl : null);
  panel.appendChild(ctxEl);
  panel.closest = () => null;
  const hdrEl = makeEl('div');
  hdrEl.__wbIt = { lineGuid: 'WB5', target: 'LINE_LEAF', focus: 'LINE_LEAF', variant: 'full' };
  plugin._wbHeaders.set('WB5', { el: hdrEl, ctx: ctxEl, ctxChain: { ownerGuid: 'REC_OWNER', chain: [root, { guid: 'LINE_MID' }], complete: true } });
  let popsBuilt = 0;
  const origBuild = plugin._buildRefChildTree.bind(plugin);
  plugin._buildRefChildTree = (...args) => {
    popsBuilt++;
    const box = origBuild(...args);
    const target = makeEl('div');
    target.className = 'refx-zoom-target';
    target.dataset.guid = 'LINE_LEAF';
    box.appendChild(target);
    return box;
  };
  plugin._wbCrumbHoverEnabled = true;
  plugin._wbCrumbHover({ target: crumb });
  assert.equal(plugin._hoverChip, crumb);
  assert.equal(popsBuilt, 0);
  await new Promise((resolve) => setTimeout(resolve, 360));
  assert.equal(popsBuilt, 1);
  assert.ok(plugin._hoverPop);
  assert.ok(plugin._hoverPop.classList.contains('refx-wb-crumbpop'));
  let hasZoomTarget = false;
  const walkPop = (node) => {
    for (const c of node.children || []) {
      if (c.classList?.contains?.('refx-zoom-target')) hasZoomTarget = true;
      walkPop(c);
    }
  };
  walkPop(plugin._hoverPop);
  assert.ok(hasZoomTarget);
  plugin._wbCrumbHover({ target: crumb });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(popsBuilt, 1, 'second hover within dwell must not build twice');
  plugin._wbCrumbHover({ target: panel });
  assert.equal(plugin._hoverPop, null);
});

test('B6: _wbCtxAncestorTree renders the four v4.59 note strings', async () => {
  const { plugin, context } = loadPlugin();
  const it = { lineGuid: 'WB6', target: 'LINE_LEAF', focus: 'LINE_LEAF' };
  plugin._wbHeaders.set('WB6', { el: { parentNode: null } });
  plugin._wbCtxResolveOwner = () => ({ ownerGuid: null, source: null });
  plugin.data = { getRecord: () => null };
  let r = await plugin._wbCtxAncestorTree(it, 'LINE_ROOT', 'BAD_OWNER', new Map(), () => true);
  assert.equal(r.note, "Can't open this ancestor's record.");

  const { items } = makeTree();
  plugin.data = { getRecord: () => ({ getLineItems: async () => items }) };
  r = await plugin._wbCtxAncestorTree(it, 'MISSING_ANC', 'REC_OWNER', new Map(), () => true);
  assert.equal(r.note, 'Ancestor is no longer in this record.');

  const leafOnly = [{ guid: 'LINE_LEAF', parent_guid: null, segments: [{ type: 'text', text: 'leaf' }], children: [] }];
  plugin.data = { getRecord: () => ({ getLineItems: async () => leafOnly }) };
  r = await plugin._wbCtxAncestorTree(it, 'LINE_LEAF', 'REC_OWNER', new Map(), () => true);
  assert.equal(r.note, 'No siblings under this ancestor.');

  plugin.data = { getRecord: () => ({ getLineItems: async () => { throw new Error('fail'); } }) };
  r = await plugin._wbCtxAncestorTree(it, 'LINE_ROOT', 'REC_OWNER', new Map(), () => true);
  assert.equal(r.note, "Couldn't load context.");
});

test('B7: peek strip retired — no twist, no toggle, no h.peek in decorate', () => {
  assert.doesNotMatch(source, /_wbLiveToggleCtxPeek/);
  const decorate = source.slice(source.indexOf('  _wbLiveDecorate('), source.indexOf('  _wbLiveRenderContext('));
  assert.doesNotMatch(decorate, /h\.peek/);
  assert.doesNotMatch(decorate, /ctxPeekAnc/);
  const { plugin, context } = loadPlugin();
  installFakeDom(context);
  seedFourLevelChain(context);
  const { makeEl } = makeWbPaintHarness(plugin, context);
  const it = { lineGuid: 'WB7', target: 'L4', focus: 'L4', variant: 'full' };
  const h = { ctxExpanded: false };
  const ctxEl = plugin._el('div', 'refx-wb-ctx');
  plugin._wbLiveRenderContextPaint(ctxEl, plugin._wbCtxChain('L4'), it, h, () => true);
  const walk = (node) => {
    for (const c of node.children || []) {
      if (c.classList?.contains?.('refx-wb-ctx-twist')) assert.fail('twisty must not render');
      walk(c);
    }
  };
  walk(ctxEl);
});

test('S1: reinstall teardown keeps other plugins menu extensions in the shared registry', () => {
  const { plugin, context } = loadPlugin();
  context.window['other-plugin'] = {};
  plugin._registerMenuExtension({
    id: 'foreign-ext',
    owner: 'other-plugin',
    label: 'Foreign',
    onSelect: () => {},
  });
  plugin._registerPopupSection({
    id: 'foreign-pop',
    owner: 'other-plugin',
    label: 'Foreign pop',
    render: () => {},
  });
  context.window.__refx = plugin._refxBridge;
  context.window.removeEventListener = () => {};
  plugin.onUnload();
  assert.equal(context.window.__refx, null);
  assert.ok(context.window.__refxMenuExtensions);
  assert.ok(context.window.__refxPopupSections);
  assert.equal(context.window.__refxMenuExtensions.has('foreign-ext'), true);
  assert.equal(context.window.__refxPopupSections.has('foreign-pop'), true);
  assert.equal(plugin._availableMenuExtensions({}).length, 1);
  delete context.window['other-plugin'];
  assert.equal(plugin._availableMenuExtensions({}).length, 0);
  assert.equal(context.window.__refxMenuExtensions.has('foreign-ext'), false);
});

test('B11: _wbLiveZoomInOne, header ⤵, and ⋯ Zoom in one level follow focus vs target', () => {
  const { plugin, context } = loadPlugin();
  seedFourLevelChain(context);
  const makeEl = installFakeDom(context);
  context.document.body = makeEl('body');
  context.document.body.append = (...kids) => { for (const k of kids) context.document.body.appendChild(k); };
  plugin._el = (tag, cls, text) => {
    const el = makeEl(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };
  plugin._mkTimestampSpan = () => null;
  plugin._lineTextByGuid = (g) => ({ L1: 'a', L2: 'b', L3: 'c', L4: 'd' }[g] || g);
  plugin.getCountInfoForGuid = async () => null;
  plugin._wbLiveToggleCollapse = () => {};
  plugin._wbLiveTogglePin = () => {};
  plugin._wbLiveSwapToMain = () => {};
  plugin._wbLiveRemove = () => {};
  plugin._wbLiveSetVariant = () => {};
  plugin._wbLiveSetDepth = () => {};
  plugin._wbAdd = () => {};
  plugin._searchKey = (s) => s;
  const reroots = [];
  plugin._wbLiveReroot = (it, guid, focus) => { reroots.push({ guid, focus }); };

  let zoom = plugin._wbLiveZoomInOne({ lineGuid: 'B11', target: 'L1', focus: 'L4' });
  assert.equal(zoom, 'L2');
  assert.equal(reroots.length, 1);
  assert.equal(reroots[0].guid, 'L2');
  assert.equal(reroots[0].focus, 'L4');

  zoom = plugin._wbLiveZoomInOne({ lineGuid: 'B11', target: 'L3', focus: 'L4' });
  assert.equal(zoom, 'L4');
  assert.equal(reroots[1].guid, 'L4');

  assert.equal(plugin._wbLiveZoomInOne({ lineGuid: 'B11', target: 'L4', focus: 'L4' }), null);
  assert.equal(reroots.length, 2);

  const hdrEl = makeEl('div');
  plugin._wbLiveHeaderSync(hdrEl, { lineGuid: 'B11a', target: 'L1', focus: 'L4', variant: 'full', collapsed: false }, false);
  const actions = hdrEl.querySelector('.refx-wb-hdr-actions');
  const zoomBtn = [...actions.children].find((c) => c.textContent === '⤵');
  assert.ok(zoomBtn, 'header shows ⤵ when focus !== target');
  assert.ok(zoomBtn.title.includes('Zoom in one level'));
  assert.equal(zoomBtn.parentElement, actions, '⤵ stays outside -more');

  const hdrFlat = makeEl('div');
  plugin._wbLiveHeaderSync(hdrFlat, { lineGuid: 'B11b', target: 'L4', focus: 'L4', variant: 'full', collapsed: false }, false);
  const flatActions = hdrFlat.querySelector('.refx-wb-hdr-actions');
  assert.equal([...flatActions.children].some((c) => c.textContent === '⤵'), false);

  plugin._wbHeaders.set('B11c', { el: { clientWidth: 800 } });
  plugin._wbLiveVariantMenu({ lineGuid: 'B11c', target: 'L1', focus: 'L4', variant: 'full' }, { currentTarget: makeEl('button'), preventDefault() {}, stopPropagation() {} });
  const pop = context.document.body.children[0];
  const labels = [...pop.children].map((r) => r.textContent);
  assert.ok(labels.some((t) => t.includes('Zoom in one level')));
});

test('B12: dropped owner crumb leaves no leading › separator in the trail', () => {
  const { plugin, context } = loadPlugin();
  installFakeDom(context);
  seedFourLevelChain(context);
  const { makeEl } = makeWbPaintHarness(plugin, context);
  const it = { lineGuid: 'B12', target: 'L4', focus: 'L4', variant: 'full' };
  const h = { ctxExpanded: false };
  const ctxEl = plugin._el('div', 'refx-wb-ctx');
  const chainResult = plugin._wbCtxChain('L4');

  plugin._wbCtxDropRedundantOwner = () => true;
  plugin._wbLiveRenderContextPaint(ctxEl, chainResult, it, h, () => true);
  const crumbDrop = ctxEl.querySelector('.trc-ref-popover-crumb');
  assert.ok(crumbDrop);
  const firstDrop = crumbDrop.firstElementChild || crumbDrop.children[0];
  assert.ok(firstDrop);
  assert.equal(firstDrop.classList.contains('trc-ref-popover-crumb-sep'), false);

  ctxEl.replaceChildren();
  plugin._wbCtxDropRedundantOwner = () => false;
  plugin._wbLiveRenderContextPaint(ctxEl, chainResult, it, h, () => true);
  const crumbKeep = ctxEl.querySelector('.trc-ref-popover-crumb');
  const firstKeep = crumbKeep.firstElementChild || crumbKeep.children[0];
  assert.ok(firstKeep.classList.contains('trc-ref-popover-crumb-rec'));
});
