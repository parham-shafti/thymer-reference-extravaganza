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
      style: { setProperty() {}, getPropertyValue: () => '' },
      dataset: {}, disabled: false, _listeners: listeners,
      parentElement: null, parentNode: null,
      previousElementSibling: null, nextSibling: null,
      clientWidth: 800,
      offsetParent: {},
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
        if (name === 'data-refx-depth') this.dataset.refxDepth = String(value);
        if (name === 'data-refx-guid') this.dataset.refxGuid = String(value);
        this[name] = String(value);
      },
      getAttribute(name) {
        if (name === 'data-guid') return this.dataset.guid ?? this[name] ?? null;
        if (name === 'data-refx-depth') return this.dataset.refxDepth ?? this[name] ?? null;
        if (name === 'data-refx-guid') return this.dataset.refxGuid ?? this[name] ?? null;
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
        const notMatch = selector.match(/:not\(\.([^)]+)\)/);
        const notClass = notMatch ? notMatch[1] : '';
        while (node) {
          if (notClass && node.classList?.contains?.(notClass)) {
            node = node.parentElement;
            continue;
          }
          if (selector.includes('.refx-hovercard') && node.classList?.contains('refx-hovercard')) return node;
          if (selector.includes('.refx-hoverpop') && node.classList?.contains('refx-hoverpop')) return node;
          if (selector.includes('.lineitem-ref') && node.classList?.contains('lineitem-ref')) return node;
          if (selector.includes('.listitem') && node.classList?.contains('listitem')) return node;
          if (selector.includes('.listview-items') && node.classList?.contains('listview-items')) return node;
          const wanted = selector.startsWith('.') ? selector.slice(1).split(/[\s\[:]/)[0] : '';
          if (wanted && node.classList?.contains(wanted)) return node;
          node = node.parentElement;
        }
        return null;
      },
      querySelector(selector) {
        const walk = (node) => {
          for (const child of node.children || []) {
            if (!child?.classList) { const hit = walk(child); if (hit) return hit; continue; }
            if (selector.includes('.refx-zoom-target') && child.classList.contains('refx-zoom-target')) return child;
            const hit = walk(child);
            if (hit) return hit;
          }
          return null;
        };
        return walk(this);
      },
      querySelectorAll(selector) {
        const out = [];
        const walk = (node) => {
          for (const child of node.children || []) {
            if (selector.includes('.lineitem-ref') && child.classList.contains('lineitem-ref')) out.push(child);
            walk(child);
          }
        };
        walk(this);
        return out;
      },
      scrollIntoView(opts) {
        this._scrollIntoViewCalls = (this._scrollIntoViewCalls || 0) + 1;
        this._scrollIntoViewOpts = opts;
      },
    };
    Object.defineProperty(el, 'className', {
      get: () => [...classes].join(' '),
      set: (value) => {
        classes.clear();
        String(value || '').split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
      },
    });
    return el;
  };
  context.document.createElement = makeEl;
  return makeEl;
}

function loadPlugin() {
  const storage = new Map();
  const queryNodes = [];
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
        style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        append() {}, setAttribute() {}, appendChild() {}, replaceChildren() {},
        addEventListener() {}, removeEventListener() {}, remove() {},
        hidden: false, children: [], isConnected: true, parentElement: null,
        previousElementSibling: null, nextSibling: null, dataset: {}, offsetParent: {},
      }),
      getElementById: (id) => context._styleEls?.get(id) || null,
      querySelector: () => null,
      querySelectorAll: (sel) => queryNodes.filter((n) => {
        if (sel.includes('[role="dialog"]') && n.getAttribute?.('role') === 'dialog') return n.offsetParent != null;
        if (sel.includes('.cmdpal--dialog') && n.classList?.contains('cmdpal--dialog')) return n.offsetParent != null;
        return false;
      }),
      documentElement: { clientHeight: 900 },
      body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild(el) { this.children.push(el); return el; }, append(el) { return this.appendChild(el); }, children: [] },
      head: { appendChild(el) { if (el.id) context._styleEls.set(el.id, el); } },
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    Element: class {},
    window: { CSS: { escape: (s) => String(s) }, g_universe: { itemsByGuid: {}, workspace: {} }, innerWidth: 1200, __refxTrail: { ring: [], cap: 200 } },
  };
  context._styleEls = new Map();
  context._queryNodes = queryNodes;
  context.globalThis = context;
  vm.runInNewContext(source + '\nthis.PluginUnderTest = Plugin;', context, { filename: 'plugin.js' });
  const plugin = new context.PluginUnderTest();
  plugin._unloaded = false;
  plugin._isMac = true;
  plugin._modal = false;
  plugin._link = false;
  plugin._cardEditing = false;
  plugin._cardPopup = false;
  plugin._recheckBackgroundGate = async () => true;
  plugin._toast = () => {};
  plugin._bridgeJump = () => {};
  plugin._wbAdd = () => {};
  plugin._wbHeaders = new Map();
  plugin._hoverRecursive = true;
  plugin._hoverMentions = true;
  plugin._hoverNestDepth = 2;
  plugin._hoverCloseMs = 180;
  plugin._smallBodyLineCap = 40;
  plugin._renderPopupSections = () => {};
  plugin._popupSectionContext = () => ({});
  plugin._refRowClipboardActions = () => [];
  plugin._mkRefRowAction = (label, title, fn) => ({ label, title, fn });
  plugin._ensureElDataset = (el) => { if (!el.dataset) el.dataset = {}; return el; };
  plugin._mediaLineInfo = () => null;
  plugin._cleanDisplayText = (segs) => (segs || []).map((s) => s.text || '').join('');
  plugin._readableLineTitle = (g) => ({ LINE_A: 'Line A', LINE_B: 'Line B', LINE_C: 'Line C', LINE_LEAF: 'Leaf' }[g] || g);
  plugin.getOrLoadRecordName = (g) => ({ REC_PAGE: 'Owner Page', GUID_A: 'Alpha', GUID_B: 'Beta' }[g] || g);
  plugin._wbCtxResolveOwner = (g) => ({ ownerGuid: 'REC_PAGE', source: 'state' });
  plugin._isTaskLikeLine = () => false;
  plugin._navigatorContextText = (anc) => plugin._cleanDisplayText(anc?.segments || []);
  plugin._renderPreviewLineItem = () => {};
  plugin._renderRefLineText = (el, segs) => {
    for (const s of segs || []) {
      if (s.type === 'ref') {
        const chip = context.document.createElement('span');
        chip.className = 'lineitem-ref';
        chip.dataset.guid = typeof s.text === 'string' ? s.text : s.text?.guid;
        chip.setAttribute('data-guid', chip.dataset.guid);
        el.appendChild(chip);
      } else if (s.text) {
        el.appendChild(Object.assign(context.document.createElement('span'), { textContent: s.text }));
      }
    }
  };
  plugin._renderSegmentsOwn = plugin._renderRefLineText;
  plugin._positionPopover = () => {};
  plugin._refxTrail = context.window.__refxTrail;
  plugin._wbWorkspaceGuid = () => 'WS_V464';
  plugin._connTraversalCache = {};
  plugin._connTraversalCacheKey = 'refx_traversal_v1:WS_V464';
  plugin._wbBtn = (label, title, fn) => {
    const btn = context.document.createElement('button');
    btn.textContent = label;
    btn.title = title || '';
    btn.type = 'button';
    btn.addEventListener('click', (ev) => { ev.preventDefault(); fn(); });
    return btn;
  };
  plugin._relativeTime = (ts) => ({ rel: 'now', absShort: 'Sep 18, 3:00 PM' });
  plugin.data = {
    getRecord: (g) => {
      if (g === 'REC_PAGE') {
        return {
          guid: g,
          getName: () => 'Owner Page',
          getLineItems: async (expanded) => plugin._fixtureItems || [],
        };
      }
      return null;
    },
  };
  return { plugin, context, storage };
}

function makePageFixture() {
  const lineC = { guid: 'LINE_C', parent_guid: 'LINE_B', segments: [{ type: 'text', text: 'line c' }], children: [] };
  const lineB = { guid: 'LINE_B', parent_guid: 'LINE_A', segments: [{ type: 'text', text: 'line b' }, { type: 'ref', text: 'GUID_B' }], children: [lineC] };
  const lineA = { guid: 'LINE_A', parent_guid: 'REC_PAGE', segments: [{ type: 'text', text: 'line a' }, { type: 'ref', text: 'GUID_A' }], children: [lineB] };
  const root = { guid: 'REC_PAGE', parent_guid: null, segments: [{ type: 'text', text: 'root' }], children: [lineA] };
  return { items: [root], lineA, lineB, lineC, root };
}

function bindClosest(el) {
  el.closest = (selector) => {
    let node = el;
    const notMatch = selector.match(/:not\(\.([^)]+)\)/);
    const notClass = notMatch ? notMatch[1] : '';
    while (node) {
      if (notClass && node.classList?.contains?.(notClass)) {
        node = node.parentElement;
        continue;
      }
      if (selector.includes('.refx-hovercard') && node.classList?.contains('refx-hovercard')) return node;
      if (selector.includes('.refx-hoverpop') && node.classList?.contains('refx-hoverpop')) return node;
      if (selector.includes('.lineitem-ref') && node.classList?.contains('lineitem-ref')) return node;
      if (selector.includes('.listitem') && node.classList?.contains('listitem')) return node;
      if (selector.includes('.listview-items') && node.classList?.contains('listview-items')) return node;
      const wanted = selector.startsWith('.') ? selector.slice(1).split(/[\s\[:]/)[0] : '';
      if (wanted && node.classList?.contains(wanted)) return node;
      node = node.parentElement;
    }
    return null;
  };
}

function addChipInCard(makeEl, cardPop, guid) {
  const chip = makeEl('span');
  chip.className = 'lineitem-ref';
  chip.setAttribute('data-guid', guid);
  cardPop.appendChild(chip);
  bindClosest(chip);
  return chip;
}

function makeOutside(makeEl) {
  const outside = makeEl('div');
  bindClosest(outside);
  return outside;
}

function wireChip(makeEl, chip, page, line, listview) {
  chip.className = 'lineitem-ref';
  chip.parentElement = line;
  line.appendChild(chip);
  line.parentElement = listview;
  listview.appendChild(line);
  listview.parentElement = page;
  page.appendChild(listview);
  chip.closest = (sel) => {
    if (sel.includes('.lineitem-ref')) return chip;
    if (sel.includes('.listitem')) return line;
    if (sel.includes('.listview-items')) return listview;
    if (sel.includes('.refx-hovercard')) {
      let n = chip.parentElement;
      while (n) {
        if (n.classList?.contains('refx-hovercard')) return n;
        n = n.parentElement;
      }
    }
    if (sel.includes('.refx-hoverpop')) {
      let n = chip.parentElement;
      while (n) {
        if (n.classList?.contains('refx-hoverpop')) return n;
        n = n.parentElement;
      }
    }
    return null;
  };
  line.closest = (sel) => (sel.includes('.listitem') ? line : listview.closest?.(sel) || null);
  listview.closest = (sel) => (sel.includes('.listview-items') ? listview : null);
  return { chip, line, listview, page };
}

function setupEl(plugin, context) {
  const makeEl = installFakeDom(context);
  plugin._el = (tag, cls, text) => {
    const el = makeEl(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };
  context.document.body.appendChild = (el) => { context.document.body.children.push(el); return el; };
  context.document.body.append = (el) => context.document.body.appendChild(el);
  context.document.body.children = [];
  return makeEl;
}

test('O1: hover card flex-shrink CSS and line-target title datetime segment', () => {
  assert.ok(source.includes('.refx-hovercard > * { flex-shrink: 0; }'), 'card children must not shrink under footer');
  assert.ok(!/\.refx-hovercard-body\s*\{\s*min-height:\s*0/.test(source), 'body min-height:0 removed so card scrolls');
  assert.ok(source.includes('.refx-hovercard-crumb-page { border: 0;'), 'crumb page button unstyled');

  const { plugin, context } = loadPlugin();
  const makeEl = setupEl(plugin, context);
  plugin._scheduleHoverCardMentions = () => {};
  plugin._renderPopupSections = () => {};
  plugin._popupSectionContext = () => ({});
  plugin._liveSegs = (g) => {
    if (g === 'LINE_DT') return [{ type: 'datetime', text: '18:30' }, { type: 'text', text: 'On the publisher box' }];
    return [];
  };
  plugin._readableLineTitle = () => '18:300n the publisher box';
  plugin._renderRefLineText = (el, segs) => {
    for (const s of segs || []) {
      if (s.type === 'datetime') {
        const span = makeEl('span');
        span.className = 'lineitem-datetime';
        el.appendChild(span);
      } else if (s.text) {
        el.appendChild(Object.assign(makeEl('span'), { textContent: s.text }));
      }
    }
  };
  context.window.g_universe.itemsByGuid = { LINE_DT: { guid: 'LINE_DT', rguid: 'REC_PAGE' } };
  plugin._wbCtxResolveOwner = () => ({ ownerGuid: 'REC_PAGE' });
  plugin.data.getRecord = (g) => (g === 'REC_PAGE'
    ? { guid: g, getName: () => 'Owner Page', getLineItems: async () => [] }
    : null);
  plugin._hoverTreeCacheGet = async () => ({
    byGuid: { LINE_DT: { guid: 'LINE_DT', segments: [], children: [] } },
    roots: [],
  });

  const pop = plugin._el('div', 'refalias-pop refx-hoverpop refx-hovercard');
  plugin._fillHoverPopRecursive(pop, 'LINE_DT', () => true, { pageGuid: 'REC_PAGE' });
  const title = findClass(pop, 'refx-hovercard-title');
  assert.ok(title, 'line-target card title element exists');
  assert.ok(findClass(title, 'lineitem-datetime'), 'title renders datetime segment instead of glued plain text');
});

test('P1: nested stack honors depth cap and visited-set cycle guard', async () => {
  const { plugin, context } = loadPlugin();
  const makeEl = setupEl(plugin, context);
  const { items } = makePageFixture();
  plugin._fixtureItems = items;
  context.window.g_universe.itemsByGuid = {
    LINE_A: { guid: 'LINE_A', rguid: 'REC_PAGE' },
    LINE_B: { guid: 'LINE_B', rguid: 'REC_PAGE' },
    A: { guid: 'A', rguid: 'REC_PAGE' },
    B: { guid: 'B', rguid: 'REC_PAGE' },
    C: { guid: 'C', rguid: 'REC_PAGE' },
    D: { guid: 'D', rguid: 'REC_PAGE' },
  };
  let fillCalls = 0;
  const origFill = plugin._fillHoverPop.bind(plugin);
  plugin._fillHoverPop = (...args) => {
    fillCalls++;
    return origFill(...args);
  };

  const page = makeEl('div');
  const listview = makeEl('div');
  listview.className = 'listview-items';
  listview.dataset.guid = 'REC_PAGE';
  const line = makeEl('div');
  line.className = 'listitem';
  line.dataset.guid = 'HOST';
  const chipA = makeEl('span');
  chipA.className = 'lineitem-ref';
  chipA.setAttribute('data-guid', 'A');
  wireChip(makeEl, chipA, page, line, listview);

  plugin._handleRefHover({ target: chipA });
  await new Promise((r) => setTimeout(r, 360));
  assert.equal(plugin._hoverStack.length, 1, 'root chip A opens one card');
  assert.equal(plugin._hoverStack[0].guid, 'A');

  const card0 = plugin._hoverStack[0].pop;
  const chipB = addChipInCard(makeEl, card0, 'B');
  plugin._handleRefHover({ target: chipB });
  await new Promise((r) => setTimeout(r, 360));
  assert.equal(plugin._hoverStack.length, 2, 'chip B inside card 0 opens depth 1');
  assert.equal(plugin._hoverStack[1].guid, 'B');
  assert.equal(plugin._hoverStack[1].parentGuid, 'A');

  const card1 = plugin._hoverStack[1].pop;
  const chipBackA = addChipInCard(makeEl, card1, 'A');
  const realVisited = plugin._hoverVisitedGuids.bind(plugin);
  let hideVisited = false;
  plugin._hoverVisitedGuids = () => (hideVisited ? new Set() : realVisited());
  hideVisited = true;
  plugin._handleRefHover({ target: chipBackA });
  hideVisited = false;
  await new Promise((r) => setTimeout(r, 360));
  assert.equal(plugin._hoverStack.length, 2, 'hovering root guid A inside card 1 must not open a third card');
  assert.equal(fillCalls, 2, 'cycle guard in _openHoverCard blocks another _fillHoverPop for A');

  const chipC = addChipInCard(makeEl, card1, 'C');
  plugin._handleRefHover({ target: chipC });
  await new Promise((r) => setTimeout(r, 360));
  assert.equal(plugin._hoverStack.length, 3, 'chip C opens depth 2');
  const card2 = plugin._hoverStack[2].pop;
  const chipD = addChipInCard(makeEl, card2, 'D');
  plugin._hoverNestDepth = 99;
  plugin._handleRefHover({ target: chipD });
  plugin._hoverNestDepth = 2;
  await new Promise((r) => setTimeout(r, 360));
  assert.equal(plugin._hoverStack.length, 3, 'depth cap _hoverNestDepth=2 blocks card for D');
  assert.equal(fillCalls, 3, 'depth cap in _openHoverCard blocks another _fillHoverPop for D');

  plugin._cancelHover();
  fillCalls = 0;
  plugin._hoverNestDepth = 1;
  plugin._handleRefHover({ target: chipA });
  await new Promise((r) => setTimeout(r, 360));
  const card0b = plugin._hoverStack[0].pop;
  const chipBb = addChipInCard(makeEl, card0b, 'B');
  plugin._handleRefHover({ target: chipBb });
  await new Promise((r) => setTimeout(r, 360));
  assert.equal(plugin._hoverStack.length, 2);
  const card1b = plugin._hoverStack[1].pop;
  const chipCb = addChipInCard(makeEl, card1b, 'C');
  plugin._handleRefHover({ target: chipCb });
  await new Promise((r) => setTimeout(r, 360));
  assert.equal(plugin._hoverStack.length, 2, '_hoverNestDepth=1 blocks opening C at depth 2');
  assert.equal(fillCalls, 2, 'nest depth 1 blocks _fillHoverPop for C');
});

test('P2: close grace keeps stack on re-enter; pinned ignores grace', async () => {
  const { plugin, context } = loadPlugin();
  const makeEl = setupEl(plugin, context);
  const { items } = makePageFixture();
  plugin._fixtureItems = items;
  context.window.g_universe.itemsByGuid = {
    A: { guid: 'A', rguid: 'REC_PAGE' },
    B: { guid: 'B', rguid: 'REC_PAGE' },
  };
  plugin._hoverCloseMs = 180;

  const page = makeEl('div');
  const listview = makeEl('div');
  listview.className = 'listview-items';
  listview.dataset.guid = 'REC_PAGE';
  const line = makeEl('div');
  line.className = 'listitem';
  line.dataset.guid = 'HOST';
  const chipA = makeEl('span');
  chipA.className = 'lineitem-ref';
  chipA.setAttribute('data-guid', 'A');
  wireChip(makeEl, chipA, page, line, listview);
  const outside = makeOutside(makeEl);

  plugin._handleRefHover({ target: chipA });
  await new Promise((r) => setTimeout(r, 360));
  assert.equal(plugin._hoverStack.length, 1);
  const card0 = plugin._hoverStack[0].pop;

  plugin._handleRefHover({ target: outside });
  assert.equal(plugin._hoverStack.length, 1, 'leave does not pop immediately');
  assert.notEqual(plugin._hoverCloseT, 0, 'leave arms close grace');

  await new Promise((r) => setTimeout(r, 80));
  plugin._handleRefHover({ target: card0 });
  assert.equal(plugin._hoverCloseT, 0, 're-enter card cancels grace');
  assert.equal(plugin._hoverStack.length, 1, 're-enter within grace keeps stack');
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(plugin._hoverStack.length, 1, 'cancelled grace must not close stack');

  plugin._handleRefHover({ target: outside });
  assert.notEqual(plugin._hoverCloseT, 0, 'second leave arms grace again');
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(plugin._hoverStack.length, 0, 'grace expired closes stack');
  assert.equal(plugin._hoverPop, null);

  plugin._handleRefHover({ target: chipA });
  await new Promise((r) => setTimeout(r, 360));
  assert.equal(plugin._hoverStack.length, 1);
  plugin._hoverStackPinned = true;
  plugin._handleRefHover({ target: outside });
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(plugin._hoverStack.length, 1, 'pinned stack survives grace');
  plugin._hoverEscClose({ key: 'Escape' });
  assert.equal(plugin._hoverStack.length, 0, 'Escape closes pinned stack');

  plugin._handleRefHover({ target: chipA });
  await new Promise((r) => setTimeout(r, 360));
  const card0nest = plugin._hoverStack[0].pop;
  const chipB = addChipInCard(makeEl, card0nest, 'B');
  plugin._handleRefHover({ target: chipB });
  await new Promise((r) => setTimeout(r, 360));
  assert.equal(plugin._hoverStack.length, 2);
  const plainInCard0 = makeEl('div');
  card0nest.appendChild(plainInCard0);
  bindClosest(plainInCard0);
  plugin._handleRefHover({ target: plainInCard0 });
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(plugin._hoverStack.length, 1, '_armHoverCloseGrace(0) pops nested card only');
  assert.equal(plugin._hoverStack[0].guid, 'A');
});

test('P3: record body renders capped tree with real ref chips', async () => {
  const { plugin, context } = loadPlugin();
  setupEl(plugin, context);
  const { items } = makePageFixture();
  plugin._fixtureItems = items;
  let nodeCount = 0;
  const origBuild = plugin._buildRefChildTree.bind(plugin);
  plugin._buildRefChildTree = (...args) => {
    const box = origBuild(...args);
    const walk = (n) => {
      for (const c of n.children || []) {
        nodeCount++;
        walk(c);
      }
    };
    walk(box);
    return box;
  };
  const pop = plugin._el('div', 'refalias-pop refx-hoverpop refx-hovercard refx-popup-interactive');
  plugin._fillHoverPop(pop, 'REC_PAGE', () => true, { recursive: true });
  await new Promise((r) => setTimeout(r, 50));
  const chips = [];
  const walk = (n) => {
    for (const c of n.children || []) {
      if (c.classList?.contains('lineitem-ref') && c.dataset?.guid) chips.push(c);
      walk(c);
    }
  };
  walk(pop);
  assert.ok(chips.length > 0, 'body uses chip spans not plain text only');
  assert.ok(nodeCount <= 40, 'tree capped at smallBodyLineCap');
});

test('P4: line target highlights path and scrolls card box only', async () => {
  const { plugin, context } = loadPlugin();
  const makeEl = setupEl(plugin, context);
  const { items, lineC } = makePageFixture();
  plugin._fixtureItems = items;
  context.window.g_universe.itemsByGuid = { LINE_C: { guid: 'LINE_C', rguid: 'REC_PAGE' } };
  const pop = plugin._el('div', 'refalias-pop refx-hoverpop refx-hovercard refx-popup-interactive');
  const docScroll = { scrollIntoView() { this._docScrolled = true; } };
  plugin._fillHoverPop(pop, 'LINE_C', () => true, { recursive: true, pageGuid: 'REC_PAGE' });
  await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(pop.querySelector('.refx-zoom-target'), 'highlight target present');
  const zoom = pop.querySelector('.refx-zoom-target');
  assert.equal(zoom._scrollIntoViewCalls, 1);
  assert.equal(zoom._scrollIntoViewOpts?.block, 'center');
  docScroll.scrollIntoView();
  assert.equal(docScroll._docScrolled, true);
  assert.equal(docScroll._scrollIntoViewCalls, undefined);
});

test('P5: palette visible blocks open; Escape closes stack', async () => {
  const { plugin, context } = loadPlugin();
  const makeEl = setupEl(plugin, context);
  const dialog = makeEl('div');
  dialog.setAttribute('role', 'dialog');
  dialog.offsetParent = {};
  context._queryNodes.push(dialog);
  const chip = makeEl('span');
  chip.className = 'lineitem-ref';
  chip.dataset.guid = 'GUID_A';
  chip.setAttribute('data-guid', 'GUID_A');
  chip.closest = (sel) => (sel.includes('.lineitem-ref') ? chip : null);
  plugin._handleRefHover({ target: chip });
  await new Promise((r) => setTimeout(r, 360));
  assert.equal(plugin._hoverStack.length, 0, 'palette/dialog gate blocks card open');
  dialog.offsetParent = null;
  plugin._handleRefHover({ target: chip });
  await new Promise((r) => setTimeout(r, 360));
  assert.equal(plugin._hoverStack.length, 1);
  let closed = false;
  const origCancel = plugin._cancelHover.bind(plugin);
  plugin._cancelHover = () => { closed = true; origCancel(); };
  plugin._hoverEscClose({ key: 'Escape' });
  assert.ok(closed);
  assert.equal(plugin._hoverStack.length, 0);
});

function countClass(node, className) {
  let n = 0;
  const walk = (el) => {
    if (!el) return;
    if (el.classList?.contains?.(className)) n++;
    for (const c of el.children || []) walk(c);
  };
  walk(node);
  return n;
}

function findClass(node, className) {
  const walk = (el) => {
    if (!el) return null;
    if (el.classList?.contains?.(className)) return el;
    for (const c of el.children || []) {
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  };
  return walk(node);
}

test('M1: mentions footer, heading crumb class, kill switch, early close, popup sections', async () => {
  const { plugin, context } = loadPlugin();
  const makeEl = setupEl(plugin, context);
  delete plugin._renderPopupSections;
  delete plugin._popupSectionContext;
  plugin._hoverMentions = true;
  plugin._isLineRefTarget = () => true;
  plugin._crumbIdentity = (anc) => anc?.guid || null;
  plugin.findPanelStateForNode = () => ({ rootGuid: 'REC_PAGE' });
  plugin.getCachedCountInfo = () => ({ count: 7, capped: false });
  plugin._queryRefLines = async () => Array.from({ length: 7 }, (_, i) => ({
    guid: 'REF' + i,
    record: { guid: 'REC_PAGE' },
    segments: [{ type: 'text', text: 'ref ' + i }],
  }));
  plugin.data.getRecord = (g) => {
    if (g === 'REC_PAGE') {
      return {
        guid: g,
        getName: () => 'Owner Page',
        getLineItems: async () => plugin._fixtureItems || [],
      };
    }
    if (g === 'GUID_A') {
      return { guid: g, getName: () => 'Alpha', getLineItems: async () => [] };
    }
    return null;
  };

  const crumbEl = plugin._el('div', 'trc-ref-popover-crumb');
  const ctx = { onJump: () => {}, sourceRecordGuid: 'REC_PAGE' };
  const mkAncActions = () => plugin._el('span', 'trc-ref-anc-actions');
  plugin._appendFlatAncestorTrail(crumbEl, [{
    guid: 'HEAD1',
    type: 'heading',
    heading_size: 2,
    segments: [{ type: 'text', text: 'Heading crumb' }],
  }], ctx, mkAncActions, {});
  const headingBtn = findClass(crumbEl, 'trc-ref-crumb-heading');
  assert.ok(headingBtn, 'heading ancestor gets trc-ref-crumb-heading');

  const pop = plugin._el('div', 'refalias-pop refx-hoverpop refx-hovercard refx-popup-interactive');
  const alive = () => plugin._hoverStack.some((f) => f.pop === pop);
  plugin._hoverStack = [{
    pop, guid: 'GUID_A', chip: null, depth: 0, parentGuid: '', openedAt: Date.now(), id: 't1', hostLineGuid: '',
  }];
  plugin._fixtureItems = makePageFixture().items;
  context.window['m1-test'] = {};
  plugin._registerPopupSection({
    id: 'm1-pop',
    owner: 'm1-test',
    render: (sectCtx, container) => {
      const mark = context.document.createElement('div');
      mark.className = 'm1-popup-section-mark';
      mark.textContent = sectCtx.targetGuid || '';
      container.appendChild(mark);
    },
    when: (sectCtx) => sectCtx.targetGuid === 'GUID_A',
  });
  plugin._fillHoverPop(pop, 'GUID_A', alive, { recursive: true, pageGuid: 'REC_PAGE' });
  await new Promise((r) => setTimeout(r, 50));
  const mentions = findClass(pop, 'refx-hovercard-mentions');
  assert.ok(mentions, 'mentions footer renders');
  const header = findClass(mentions, 'refx-hovercard-mentions-header');
  assert.ok(header?.textContent?.includes('7 mentions'), 'count header shows cached count');
  assert.equal(countClass(mentions, 'trc-ref-popover-item'), 5, 'footer shows 5 rows');
  assert.ok(findClass(mentions, 'refx-hovercard-mentions-showall'), 'Show all button present');
  assert.equal(countClass(pop, 'm1-popup-section-mark'), 1, 'popup section appears once');

  plugin._hoverMentions = false;
  const popOff = plugin._el('div', 'refalias-pop refx-hoverpop refx-hovercard refx-popup-interactive');
  plugin._hoverStack = [{ pop: popOff, guid: 'GUID_A', chip: null, depth: 0, parentGuid: '', openedAt: Date.now(), id: 't2', hostLineGuid: '' }];
  plugin._fillHoverPop(popOff, 'GUID_A', () => plugin._hoverStack.some((f) => f.pop === popOff), { recursive: true });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(findClass(popOff, 'refx-hovercard-mentions'), null, 'kill switch suppresses footer');

  const popDead = plugin._el('div', 'refalias-pop refx-hoverpop refx-hovercard refx-popup-interactive');
  plugin._hoverStack = [{ pop: popDead, guid: 'GUID_A', chip: null, depth: 0, parentGuid: '', openedAt: Date.now(), id: 't3', hostLineGuid: '' }];
  plugin._hoverMentions = true;
  plugin._fillHoverPop(popDead, 'GUID_A', () => false, { recursive: true });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(findClass(popDead, 'refx-hovercard-mentions'), null, 'card closed before frame renders nothing');
});

test('T1: kinds, parent, dwell, legacy upgrade, single click per path', () => {
  const { plugin, context } = loadPlugin();
  const makeEl = setupEl(plugin, context);
  plugin._trailsEnabled = true;
  plugin._refxTrail = { ring: [], cap: 200 };
  const legacy = { guid: 'OLD', label: 'Legacy', ts: 1000, how: 'jump' };
  plugin._refxTrail.ring = [plugin._trailNormalizeEntry(legacy, 0)];
  assert.equal(plugin._refxTrail.ring[0].kind, 'jump');
  assert.ok(plugin._refxTrail.ring[0].id);
  const hoverId = plugin._trailRecord({ guid: 'H1', kind: 'hover', how: 'hover', parent: 'LINE_HOST' });
  plugin._trailSetDwell(hoverId, 4000);
  const hover = plugin._refxTrail.ring.find((e) => e.id === hoverId);
  assert.equal(hover.kind, 'hover');
  assert.equal(hover.parent, 'LINE_HOST');
  assert.equal(hover.dwellMs, 4000);
  plugin._connRecordHop('SRC', 'DST', 'pick');
  assert.equal(plugin._refxTrail.ring.at(-1).kind, 'click');
  const page = makeEl('div');
  const listview = makeEl('div');
  listview.className = 'listview-items';
  const hostLine = makeEl('div');
  hostLine.className = 'listitem';
  hostLine.dataset.guid = 'LINE_PAGE';
  const pageChip = makeEl('span');
  pageChip.className = 'lineitem-ref refx-lineref-chip';
  pageChip.dataset.guid = 'T_PAGE';
  wireChip(makeEl, pageChip, page, hostLine, listview);
  plugin._trailRecordChipClick(pageChip, 'T_PAGE');
  assert.equal(plugin._refxTrail.ring.filter((e) => e.kind === 'click' && e.guid === 'T_PAGE').length, 1);
  assert.equal(plugin._refxTrail.ring.find((e) => e.guid === 'T_PAGE').parent, 'LINE_PAGE');
  plugin._refxTrail.ring = [];
  const card = makeEl('div');
  card.className = 'refx-hovercard';
  card.dataset.refxGuid = 'CARD_GUID';
  const cardChip = makeEl('span');
  cardChip.className = 'lineitem-ref';
  cardChip.dataset.guid = 'T_CARD';
  card.appendChild(cardChip);
  cardChip.parentElement = card;
  cardChip.closest = (sel) => {
    if (sel.includes('.lineitem-ref')) return cardChip;
    if (sel.includes('.refx-hovercard')) return card;
    return null;
  };
  plugin._installHoverStackListeners(makeEl('span'));
  plugin._trailRecordChipClick(cardChip, 'T_CARD');
  plugin._hoverCardClickTrail({ target: cardChip });
  const cardClicks = plugin._refxTrail.ring.filter((e) => e.kind === 'click' && e.guid === 'T_CARD');
  assert.equal(cardClicks.length, 1);
  assert.equal(cardClicks[0].parent, 'CARD_GUID');
});

test('T2: persistence flush guard, cap, identical JSON skipped', async () => {
  const { plugin } = loadPlugin();
  plugin._trailsEnabled = true;
  plugin._trailsPersist = true;
  plugin._refxTrail = { ring: [], cap: 500 };
  const metaWrites = [];
  const dayLine = {
    guid: 'DAY_LINE',
    props: {},
    segments: [{ type: 'text', text: 'Trail 2026-09-18' }],
    async setMetaProperty(key, value) {
      metaWrites.push([key, value]);
      this.props[key] = value;
      return true;
    },
  };
  const rec = {
    guid: 'TRAILS_REC',
    getName: () => 'RefX Trails',
    async getLineItems() { return [dayLine]; },
    async createLineItem() { return dayLine; },
  };
  plugin._pluginDataRecord = async () => rec;
  plugin._trailsDayLines.set('2026-09-18', dayLine);
  plugin._trailsEnsureDayLine = async () => dayLine;
  plugin._trailsTrashOneOldLine = async () => {};
  const fixedNow = Date.parse('2026-09-18T15:00:00');
  plugin._trailsDayKey = () => '2026-09-18';
  for (let i = 0; i < 405; i++) {
    plugin._refxTrail.ring.push({
      id: 'g' + i,
      guid: 'G' + i,
      label: 'G' + i,
      ts: fixedNow + i,
      how: 'jump',
      kind: 'jump',
      parent: '',
      dwellMs: 0,
    });
  }
  const dayPayload = plugin._trailsEntriesForDay('2026-09-18', fixedNow);
  assert.equal(dayPayload.length, 400, 'persistence trims to 400 entries per day');
  plugin._trailsDirty = true;
  await plugin._trailsFlushNow(fixedNow);
  assert.equal(metaWrites.length, 1);
  plugin._trailsDirty = true;
  await plugin._trailsFlushNow(fixedNow);
  assert.equal(metaWrites.length, 1, 'identical JSON must not rewrite');
});

test('T3: trails.query filters and before() window', () => {
  const { plugin, context } = loadPlugin();
  plugin._refxBridge = { trails: plugin._trailsBuildApi() };
  context.window.__refx = plugin._refxBridge;
  const base = Date.now();
  plugin._refxTrail = {
    ring: [
      { id: '1', guid: 'A', label: 'A', ts: base, kind: 'hover', how: 'hover', parent: 'P1', dwellMs: 0 },
      { id: '2', guid: 'B', label: 'B', ts: base + 1000, kind: 'hover', how: 'hover', parent: 'P1', dwellMs: 0 },
      { id: '3', guid: 'X', label: 'X', ts: base + 2000, kind: 'click', how: 'click', parent: 'P2', dwellMs: 0 },
      { id: '4', guid: 'C', label: 'C', ts: base + 3000, kind: 'hover', how: 'hover', parent: 'P1', dwellMs: 0 },
      { id: '5', guid: 'X', label: 'X', ts: base + 4000, kind: 'jump', how: 'jump', parent: 'P2', dwellMs: 0 },
    ],
    cap: 200,
  };
  plugin._wbTrailLoaded = true;
  plugin._trailsLoadedFromRecord = true;
  const api = context.window.__refx.trails;
  assert.equal(api.query({ guid: 'X', kind: 'click' }).length, 1);
  const hovers = api.before('X', { windowMs: 5000 });
  assert.equal(hovers.map((e) => e.id).join(','), '1,2');
});

test('T4: strip glyphs and commits-only toggle', () => {
  const { plugin, context } = loadPlugin();
  setupEl(plugin, context);
  plugin._wbTrailEnabled = true;
  plugin._trailCommitsOnly = true;
  plugin._trailsLoadedFromRecord = true;
  plugin._wbTrailLoaded = true;
  plugin._refxTrail = {
    ring: [
      { id: 'h1', guid: 'H', label: 'Hover', ts: 1, kind: 'hover', how: 'hover', parent: 'P', dwellMs: 0 },
      { id: 'c1', guid: 'R1', label: 'A', ts: 2, kind: 'jump', how: 'jump', parent: 'P', dwellMs: 3500 },
      { id: 'c2', guid: 'R2', label: 'Beta', ts: 3, kind: 'click', how: 'click', parent: 'P', dwellMs: 0 },
    ],
    cap: 200,
  };
  const panelEl = plugin._el('div');
  const scroller = plugin._el('div');
  scroller.classList.add('panel-scroller-y');
  panelEl.querySelector = (sel) => (sel === '.panel-scroller-y' ? scroller : null);
  panelEl.appendChild(scroller);
  plugin._wbTabsEl = plugin._el('div', 'refx-wb-tabs');
  scroller.appendChild(plugin._wbTabsEl);
  plugin._trailsEnsureLoaded = async () => {};
  plugin._wbLiveTrailPaint(panelEl);
  const hops = plugin._wbTrailEl.children.filter((c) => c.classList?.contains('refx-wb-trail-hop'));
  assert.equal(hops.length, 2, 'commits-only shows jump+click not hover');
  assert.match(hops[0].textContent, /●/);
  assert.match(hops[0].textContent, /·3s/, 'dwell suffix only when shown');
  plugin._wbTrailToggleCommitsOnly();
  assert.equal(plugin._trailCommitsOnly, false);
  plugin._wbLiveTrailPaint(panelEl);
  const hopsAll = plugin._wbTrailEl.children.filter((c) => c.classList?.contains('refx-wb-trail-hop'));
  assert.equal(hopsAll.length, 3);
  assert.ok(hopsAll.some((h) => h.textContent.includes('○')));
});
