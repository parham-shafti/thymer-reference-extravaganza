'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const pluginSource = fs.readFileSync(path.join(root, 'plugin.js'), 'utf8');
const source = pluginSource;

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
    Node: class Node {},
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
  plugin.isExistingRecordGuid = (g) => g === 'REC1';
  plugin.data = { getRecord: () => null };
  return { plugin, storage, context };
}

function installFakeDom(context) {
  context.Node = class Node {};
  const makeEl = (tag) => {
    const listeners = {};
    const classes = new Set();
    const el = {
      tagName: String(tag).toUpperCase(),
      nodeType: 1,
      textContent: '', title: '', children: [], isConnected: true,
      style: {}, dataset: {}, disabled: false, _listeners: listeners,
      parentElement: null,
      previousElementSibling: null,
      nextElementSibling: null,
      scrollTop: 0,
      clientHeight: 300,
      offsetTop: 0,
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
        const setConn = (n, v) => { n.isConnected = v; for (const c of n.children || []) setConn(c, v); };
        setConn(child, this.isConnected);
        const prev = this.children[this.children.length - 1];
        if (prev) prev.nextElementSibling = child;
        child.previousElementSibling = prev || null;
        this.children.push(child);
        return child;
      },
      append(...children) { for (const child of children) this.appendChild(child); },
      insertBefore(child, before) {
        const index = this.children.indexOf(before);
        if (index < 0) return this.appendChild(child);
        this.children.splice(index, 0, child);
        child.parentElement = this;
        const setConn = (n, v) => { n.isConnected = v; for (const c of n.children || []) setConn(c, v); };
        setConn(child, this.isConnected);
        const prev = index > 0 ? this.children[index - 1] : null;
        const next = this.children[index + 1] || null;
        child.previousElementSibling = prev;
        child.nextElementSibling = next;
        if (prev) prev.nextElementSibling = child;
        if (next) next.previousElementSibling = child;
        return child;
      },
      insertAdjacentElement(pos, child) {
        if (pos === 'afterend') {
          const parent = this.parentElement;
          if (!parent) return child;
          const idx = parent.children.indexOf(this);
          parent.children.splice(idx + 1, 0, child);
          child.parentElement = parent;
          child.isConnected = parent.isConnected;
          child.previousElementSibling = this;
          child.nextElementSibling = this.nextElementSibling;
          this.nextElementSibling = child;
          return child;
        }
        return this.appendChild(child);
      },
      addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
      removeEventListener(type, fn) {
        const list = listeners[type];
        if (!list) return;
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      },
      setAttribute(name, value) { this[name] = String(value); },
      removeAttribute(name) { delete this[name]; },
      hasAttribute(name) { return this[name] != null; },
      tabIndex: -1,
      getAttribute(name) { return this[name] ?? null; },
      dispatchEvent(ev) {
        ev.target = ev.target || this;
        if (!ev.stopPropagation) ev.stopPropagation = function() { this.cancelBubble = true; };
        let node = this;
        while (node) {
          const list = node._listeners?.[ev.type] || [];
          for (const fn of list.slice()) fn(ev);
          if (ev.cancelBubble) break;
          node = node.parentElement;
        }
        return true;
      },
      closest(selector) {
        let node = this;
        while (node) {
          if (matchClosest(node, selector)) return node;
          node = node.parentElement;
        }
        return null;
      },
      querySelector(selector) {
        const scoped = selector.startsWith(':scope > ');
        const rest = scoped ? selector.slice(9) : selector;
        if (scoped && rest.startsWith('.')) {
          const cls = rest.slice(1).split(/[\s.#\[]/)[0];
          for (const child of this.children || []) {
            if (child.classList?.contains(cls)) return child;
          }
          return null;
        }
        const attrMatch = rest.match(/^\[data-guid="([^"]+)"\]$/);
        const roots = scoped ? this.children : walkAll(this);
        for (const node of roots) {
          if (attrMatch && node.dataset?.guid === attrMatch[1]) return node;
          const hit = matchSelector(node, rest);
          if (hit) return hit;
        }
        return null;
      },
      querySelectorAll(selector) {
        const scoped = selector.startsWith(':scope > ');
        const rest = scoped ? selector.slice(9) : selector;
        const out = [];
        const roots = scoped ? this.children : null;
        const walk = (node) => {
          for (const child of node.children || []) {
            if (matchSelector(child, rest) || matchMultiSelector(child, rest)) out.push(child);
            if (!scoped) walk(child);
          }
        };
        if (scoped) walk({ children: roots });
        else walk(this);
        return out;
      },
      remove() {
        if (this.parentElement) {
          const sibs = this.parentElement.children;
          const idx = sibs.indexOf(this);
          if (idx >= 0) {
            const prev = sibs[idx - 1];
            const next = sibs[idx + 1];
            if (prev) prev.nextElementSibling = next || null;
            if (next) next.previousElementSibling = prev || null;
            sibs.splice(idx, 1);
          }
        }
        const setConn = (n, v) => { n.isConnected = v; for (const c of n.children || []) setConn(c, v); };
        setConn(this, false);
        this.parentElement = null;
      },
    };
    Object.defineProperty(el, 'className', {
      get: () => [...classes].join(' '),
      set: (value) => {
        classes.clear();
        String(value || '').split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
      },
    });
    Object.setPrototypeOf(el, context.Node.prototype);
    return el;
  };

  function walkAll(node, out = []) {
    for (const child of node.children || []) {
      out.push(child);
      walkAll(child, out);
    }
    return out;
  }

  function matchSelector(node, selector) {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1).split(/[\s.#\[]/)[0];
      return node.classList?.contains(cls) ? node : null;
    }
    return null;
  }

  function matchMultiSelector(node, selector) {
    const parts = selector.split(',').map((s) => s.trim());
    for (const part of parts) {
      if (part.startsWith('.')) {
        const cls = part.slice(1).split(/[\s\[]/)[0];
        if (node.classList?.contains(cls)) return true;
      }
    }
    return false;
  }

  function matchClosest(node, selector) {
    if (selector.includes(',')) return matchMultiSelector(node, selector) ? node : null;
    if (selector.startsWith('.')) {
      const cls = selector.slice(1).split(/[\s\[]/)[0];
      return node.classList?.contains(cls) ? node : null;
    }
    return null;
  }

  context.document.createElement = makeEl;
  return makeEl;
}


function revealed(root) {
  return [...root.querySelectorAll('.refx-nested-count')].filter((e) => e.getAttribute('data-count'));
}

function nestedItems(root) {
  const out = [];
  for (const box of root.querySelectorAll('.refx-nested-refs')) {
    for (const page of box.children || []) {
      for (const child of page.children || []) {
        if (child.classList?.contains('trc-ref-popover-item')) out.push(child);
      }
      if (page.classList?.contains('trc-ref-popover-item')) out.push(page);
    }
  }
  return out;
}

function tick(ms = 20) {
  return new Promise((r) => setTimeout(r, ms));
}

const A = '1AAAAAAAAAAAAAAAAAAAAAAAAA';
const H1 = '1BBBBBBBBBBBBBBBBBBBBBBBBB';
const H2 = '1CCCCCCCCCCCCCCCCCCCCCCCCC';
const C = '1DDDDDDDDDDDDDDDDDDDDDDDDD';
const COMMENTS = '1EEEEEEEEEEEEEEEEEEEEEEEEE';
const SEP14 = '1GGGGGGGGGGGGGGGGGGGGGGGGG';
const APR10 = '1FFFFFFFFFFFFFFFFFFFFFFFFF';

function setupV460Plugin() {
  const { plugin, context } = loadPlugin();
  const makeEl = installFakeDom(context);
  plugin._el = (tag, cls, text) => {
    const el = makeEl(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };
  plugin._cleanDisplayText = (segs) => (segs || []).map((s) => s.text || '').join('');
  plugin._navigatorContextText = (line) => plugin._cleanDisplayText(line.segments || []);
  plugin._mediaLineInfo = () => null;
  plugin._isTaskLikeLine = () => false;
  plugin._renderPreviewLineItem = (el, line) => { el.textContent = plugin._cleanDisplayText(line.segments || []); };
  plugin._renderRefLineText = (el, segs) => {
    for (const s of segs || []) {
      if (s.type === 'ref') {
        const chip = makeEl('span');
        chip.className = 'lineitem-ref tlr-seg-ref';
        chip.dataset.guid = s.text;
        chip.setAttribute('data-guid', s.text);
        chip.setAttribute('data-ref-guid', s.text);
        chip.dataset.refGuid = s.text;
        el.appendChild(chip);
      } else if (s.type === 'datetime') {
        const dt = makeEl('span');
        dt.className = 'lineitem-datetime';
        dt.textContent = s.text || '';
        el.appendChild(dt);
      } else {
        const tx = makeEl('span');
        tx.textContent = s.text || '';
        el.appendChild(tx);
      }
    }
  };
  plugin._mkRefRowAction = (label, title, fn) => {
    const btn = makeEl('button');
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
    return btn;
  };
  plugin._refRowClipboardActions = () => [];
  plugin._isLineRefTarget = (g) => g !== 'REC1';
  plugin.isExistingRecordGuid = (g) => g === 'REC1';
  plugin._hydrateColdRefLineText = (el, line) => {
    if (el && line?.segments) plugin._renderRefLineText(el, line.segments);
  };
  plugin._relativeTime = (d) => d ? { rel: '2d', absShort: 'Sep 7', abs: 'Sep 7, 2026' } : null;
  plugin._lineCreatedAt = (line) => line?.createdAt || null;
  plugin.getOrLoadRecordName = (g) => ({ [APR10]: 'Fri Apr 10', [SEP14]: 'Mon Sep 14', [COMMENTS]: 'Comments' }[g] || g);
  plugin._recordNameIndex = new Map();
  plugin._bridgeJump = () => Promise.resolve(true);
  plugin._bridgeCreateEmbed = () => Promise.resolve(true);
  plugin._pageGuidFromDom = () => 'PAGE';
  plugin._resolveRefTargetText = () => 'target text';
  plugin._countCache = new Map();
  plugin.getCachedCountInfo = (g) => {
    const e = plugin._countCache.get(g);
    return e && typeof e.count === 'number' ? e : null;
  };
  plugin.getCountInfoForGuid = (g) => Promise.resolve(plugin.getCachedCountInfo(g) || { count: 0, capped: false, sdkPropCount: 0 });
  plugin.data = { getRecord: () => null };
  return { plugin, makeEl, context };
}

function chainFixtures() {
  const Cline = {
    guid: C,
    parent_guid: H2,
    segments: [{ type: 'text', text: "Follow-up comment on the sample task " }, { type: 'datetime', text: 'Tue Sep 15' }],
    children: [],
    record: { guid: COMMENTS },
  };
  const H2line = {
    guid: H2,
    parent_guid: '1JJJJJJJJJJJJJJJJJJJJJJJJJ',
    segments: [{ type: 'ref', text: H1 }],
    children: [Cline],
    record: { guid: COMMENTS },
  };
  const H1line = {
    guid: H1,
    parent_guid: SEP14,
    segments: [{ type: 'datetime', text: 'Mon Sep 14 17:00 — 18:15' }, { type: 'text', text: ' ' }, { type: 'ref', text: A }],
    children: [],
    record: { guid: SEP14 },
  };
  const Alines = { guid: A, parent_guid: 'PARENT_A', segments: [{ type: 'text', text: 'Sample task' }, { type: 'ref', text: A }], children: [], record: { guid: APR10 } };
  const records = {
    [APR10]: [{ guid: 'PARENT_A', parent_guid: null, segments: [{ type: 'text', text: "Parent block for the sample task" }], children: [Alines] }],
    [SEP14]: [{ guid: SEP14, parent_guid: null, segments: [{ type: 'text', text: 'Time Block #TimeBlock #nautilus' }], children: [H1line] }],
    [COMMENTS]: [
      { guid: '1HHHHHHHHHHHHHHHHHHHHHHHHH', parent_guid: null, segments: [{ type: 'ref', text: SEP14 }], children: [] },
      { guid: '1JJJJJJJJJJJJJJJJJJJJJJJJJ', parent_guid: '1HHHHHHHHHHHHHHHHHHHHHHHHH', segments: [{ type: 'mention', text: '@Author' }], children: [H2line] },
      H2line,
      Cline,
    ],
  };
  return { H1line, H2line, Cline, Alines, records };
}

function wireChainData(plugin, records) {
  plugin.data.getRecord = (g) => {
    const roots = records[g];
    if (!roots) return null;
    return { getLineItems: async () => roots };
  };
  plugin._queryRefLines = async (g) => {
    if (g === A) return [records[SEP14][0].children[0]];
    if (g === H1) return [records[COMMENTS][2]];
    return [];
  };
  plugin._countCache.set(A, { count: 2 });
  plugin._countCache.set(H1, { count: 1 });
  plugin._countCache.set(H2, { count: 0 });
  plugin._countCache.set(C, { count: 0 });
}

test('T1 real chain A→H1→H2→C via own-count clicks', async () => {
  const { plugin, makeEl } = setupV460Plugin();
  const { H1line, records } = chainFixtures();
  wireChainData(plugin, records);
  const surface = makeEl('div');
  surface.className = 'refx-inline-refs';
  plugin._wireRefSurfaceChipNav(surface);
  plugin._renderRefsGroups(surface, [H1line], { flat: true, targetGuid: A, alive: () => true, actionsFor: () => [] });
  await tick(30);
  const row = surface.querySelector('.trc-ref-popover-item');
  assert.ok(row);
  const full = row.querySelector(':scope > .trc-ref-popover-fulltext');
  const counts = revealed(row);
  assert.equal(counts.length, 1);
  assert.equal(counts[0].dataset.guid, H1);
  assert.equal(counts[0].getAttribute('data-count'), '1');
  assert.equal(full.children[full.children.length - 1], counts[0]);
  assert.equal(counts[0].getAttribute('role'), 'button');
  assert.equal(counts[0].tabIndex, 0);
  for (const c of row.querySelectorAll('.refx-nested-count')) assert.notEqual(c.dataset.guid, A);
  counts[0].dispatchEvent({ type: 'click', button: 0, preventDefault() {}, stopPropagation() {}, target: counts[0] });
  await tick(30);
  const box = full.nextElementSibling;
  assert.ok(box?.classList?.contains('refx-nested-refs'));
  assert.equal(box.dataset.refxNestTarget, H1);
  const nested = box.querySelector('.trc-ref-popover-item');
  assert.equal(nested.__refxLine?.guid, H2);
  assert.equal(nested.__refxNestDepth, 1);
  assert.deepEqual([...nested.__refxNestPath], [A, H1]);
  assert.equal(nested.dataset.refxSelfRef, '1');
  assert.ok(nested.querySelector('.trc-ref-crumb-self'));
  assert.ok(nested.querySelector('.refx-wb-tree-line[data-guid="' + C + '"]') || nested.querySelector('.refx-wb-tree-line'));
  const cLine = nested.querySelector('.refx-wb-tree-line');
  assert.equal(cLine?.dataset?.guid, C);
  assert.equal(revealed(nested).length, 0);
});

test('T2 home row suppression', async () => {
  const { plugin, makeEl } = setupV460Plugin();
  const { Alines, records } = chainFixtures();
  wireChainData(plugin, records);
  plugin._countCache.set(A, { count: 2 });
  plugin._buildRefHomeLine = () => Alines;
  const surface = makeEl('div');
  await plugin._appendRefHomeRow(surface, A, { targetGuid: A, alive: () => true, treeCache: new Map(), onJump() {} });
  await tick(30);
  const home = surface.querySelector('.refx-row-home');
  assert.ok(home);
  for (const c of home.querySelectorAll('.refx-nested-count')) {
    if (c.getAttribute('data-count')) assert.notEqual(c.dataset.guid, A);
  }
  assert.equal(revealed(home).filter((c) => c.dataset.guid === A).length, 0);
});

test('T3 cycle guard', async () => {
  const { plugin, makeEl } = setupV460Plugin();
  const B = 'BBBBBBBBBBBBBBBBBBBBBBBBBB';
  const Y = 'YYYYYYYYYYYYYYYYYYYYYYYYYY';
  const X1 = 'X1X1X1X1X1X1X1X1X1X1X1X1';
  const X2 = 'X2X2X2X2X2X2X2X2X2X2X2X2';
  const Aline = { guid: A, segments: [{ type: 'ref', text: B }], children: [], record: { guid: 'RA' } };
  const Bline = { guid: B, segments: [{ type: 'ref', text: A }], children: [], record: { guid: 'RB' } };
  plugin._countCache.set(A, { count: 1 });
  plugin._countCache.set(B, { count: 1 });
  plugin._countCache.set(Y, { count: 1 });
  plugin._queryRefLines = async (g) => (g === B ? [Aline] : []);
  plugin.data.getRecord = (g) => ({ getLineItems: async () => (g === 'RB' ? [Bline] : [Aline]) });
  const surface = makeEl('div');
  plugin._wireRefSurfaceChipNav(surface);
  plugin._renderRefsGroups(surface, [Bline], { flat: true, targetGuid: A, alive: () => true, actionsFor: () => [] });
  await tick(30);
  const row = surface.querySelector('.trc-ref-popover-item');
  plugin._paintRefRowNestedCounts(row, row.__refxCtx);
  const ownB = revealed(row).find((c) => c.dataset.guid === B);
  assert.ok(ownB);
  assert.equal(revealed(row).filter((c) => c.dataset.guid === A).length, 0);
  ownB.dispatchEvent({ type: 'click', button: 0, preventDefault() {}, stopPropagation() {}, target: ownB });
  await tick(30);
  const nested = nestedItems(surface)[0];
  assert.ok(nested);
  assert.equal(revealed(nested).length, 0);
  const qSpy = [];
  plugin._queryRefLines = async (g) => { qSpy.push(g); return []; };
  const stub = makeEl('span');
  stub.className = 'refx-nested-count';
  stub.dataset.guid = A;
  await plugin._toggleRefNestedRefs(stub, A, nested, nested.__refxCtx);
  assert.equal(qSpy.filter((g) => g === A).length, 0);
  // sibling branches
  const X1line = { guid: X1, segments: [{ type: 'ref', text: Y }], children: [], record: { guid: 'RX' } };
  const X2line = { guid: X2, segments: [{ type: 'ref', text: Y }], children: [], record: { guid: 'RX' } };
  const body = makeEl('div');
  plugin._renderRefsGroups(body, [X1line, X2line], { flat: true, targetGuid: 'ROOT', alive: () => true, actionsFor: () => [] });
  await tick(30);
  const rows = body.querySelectorAll('.trc-ref-popover-item');
  for (let i = 0; i < rows.length; i++) {
    const line = i === 0 ? X1line : X2line;
    rows[i].__refxLine = line;
    const full = rows[i].querySelector('.trc-ref-popover-fulltext');
    plugin._renderRefLineText(full, line.segments);
    plugin._paintRefRowNestedCounts(rows[i], rows[i].__refxCtx || { alive: () => true, gestureAlive: () => true, targetGuid: 'ROOT', nestPath: Object.freeze(['ROOT']) });
  }
  plugin._countCache.set(X1, { count: 2 });
  plugin._countCache.set(X2, { count: 3 });
  rows[0].__refxLine = X1line;
  rows[1].__refxLine = X2line;
  plugin._paintRefRowNestedCounts(rows[0], rows[0].__refxCtx);
  plugin._paintRefRowNestedCounts(rows[1], rows[1].__refxCtx);
  assert.equal(revealed(rows[0]).filter((c) => c.dataset.guid === X1).length, 1);
  assert.equal(revealed(rows[1]).filter((c) => c.dataset.guid === X2).length, 1);
});

test('T4 depth >= 3', async () => {
  const { plugin, makeEl } = setupV460Plugin();
  const guids = ['L0', 'L1', 'L2', 'L3', 'L4'];
  for (let i = 1; i < 5; i++) plugin._countCache.set(guids[i], { count: 1 });
  const lines = {};
  for (let i = 0; i < 5; i++) {
    lines['L' + i] = { guid: guids[i], segments: i ? [{ type: 'ref', text: guids[i - 1] }] : [{ type: 'text', text: 'root' }], children: [], record: { guid: 'REC' } };
  }
  plugin._queryRefLines = async (g) => {
    const idx = guids.indexOf(g);
    return idx >= 0 && idx < 4 ? [lines['L' + (idx + 1)]] : [];
  };
  lines.L0.children = [lines.L1];
  lines.L1.parent_guid = lines.L0.guid;
  plugin.data.getRecord = () => ({ getLineItems: async () => [lines.L0] });
  const surface = makeEl('div');
  plugin._wireRefSurfaceChipNav(surface);
  plugin._renderRefsGroups(surface, [lines.L1], { flat: true, targetGuid: guids[0], alive: () => true, actionsFor: () => [] });
  await tick(30);
  const row1 = surface.querySelector('.trc-ref-popover-item');
  row1.__refxLine = lines.L1;
  plugin._paintRefRowNestedCounts(row1, row1.__refxCtx || { alive: () => true, gestureAlive: () => true, targetGuid: guids[0], nestPath: Object.freeze([guids[0]]) });
  const c1 = revealed(row1).find((c) => c.dataset.guid === guids[1]);
  assert.ok(c1);
  plugin._activateRefNestedCount(c1);
  await tick(30);
  const row2 = nestedItems(surface)[0];
  assert.ok(row2);
  assert.equal(row2.__refxNestDepth, 1);
  row2.__refxLine = lines.L2;
  plugin._paintRefRowNestedCounts(row2, row2.__refxCtx);
  const c2 = revealed(row2).find((c) => c.dataset.guid === guids[2]);
  assert.ok(c2);
  plugin._activateRefNestedCount(c2);
  await tick(30);
  const row3 = nestedItems(surface)[1];
  row3.__refxLine = lines.L3;
  plugin._paintRefRowNestedCounts(row3, row3.__refxCtx);
  const c3 = revealed(row3).find((c) => c.dataset.guid === guids[3] && c.getAttribute('data-count') === '1');
  assert.ok(c3);
  plugin._activateRefNestedCount(c3);
  await tick(30);
  const row4 = nestedItems(surface)[2];
  assert.ok(row4);
  assert.equal(row4.__refxNestDepth, 3);
  assert.equal(row4.__refxNestPath.length, 4);
});

test('T5 budget and pool', async () => {
  const { plugin, makeEl } = setupV460Plugin();
  const calls = [];
  let inFlight = 0;
  let peak = 0;
  plugin.getCountInfoForGuid = (g) => {
    calls.push(g);
    inFlight++;
    peak = Math.max(peak, inFlight);
    return new Promise((resolve) => {
      setTimeout(() => { inFlight--; resolve({ count: 1, capped: false, sdkPropCount: 0 }); }, 5);
    });
  };
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const kids = [];
    for (let k = 0; k < 30; k++) {
      const g = 'K' + r + '_' + k;
      kids.push({ guid: g, segments: [{ type: 'text', text: 'x' }], children: [], parent_guid: 'P' + r });
    }
    rows.push({ guid: 'P' + r, segments: [{ type: 'text', text: 'row' }], children: kids, record: { guid: 'REC' + r } });
    plugin._countCache.delete('P' + r);
  }
  plugin.data.getRecord = (g) => ({ getLineItems: async () => rows.find((x) => x.record.guid === g) ? [rows.find((x) => x.record.guid === g)] : [] });
  const body = makeEl('div');
  plugin._renderRefsGroups(body, rows, { flat: true, targetGuid: 'ROOT', alive: () => true, actionsFor: () => [] });
  await tick(50);
  const allRows = body.querySelectorAll('.trc-ref-popover-item');
  for (const row of allRows) {
    const owned = [...row.querySelectorAll('.refx-nested-count')].filter((e) => e.closest('.trc-ref-popover-item') === row);
    assert.ok(owned.length <= 24);
  }
  assert.ok(peak <= 4);
  assert.ok(calls.length <= 3 + 60);
  const row3 = allRows[2];
  row3.remove();
  await tick(100);
  const afterDetach = calls.filter((g) => String(g).startsWith('K2_'));
  assert.equal(afterDetach.length, 0);
});

test('T6 attribute-only reveal', async () => {
  const { plugin, makeEl } = setupV460Plugin();
  plugin._refChipCounts = true;
  const { row, ctx } = (() => {
    const surface = makeEl('div');
    const row = makeEl('div');
    row.className = 'trc-ref-popover-item';
    const full = makeEl('div');
    full.className = 'trc-ref-popover-fulltext';
    const chip = makeEl('span');
    chip.className = 'tlr-seg-ref';
    chip.dataset.refGuid = 'UNCACHED';
    chip.setAttribute('data-ref-guid', 'UNCACHED');
    full.appendChild(chip);
    row.appendChild(full);
    row.__refxCtx = { alive: () => true, targetGuid: 'ROOT', nestPath: Object.freeze(['ROOT']) };
    return { row, ctx: row.__refxCtx };
  })();
  let resolveLate;
  plugin.getCountInfoForGuid = () => new Promise((r) => { resolveLate = () => r({ count: 5, capped: false, sdkPropCount: 0 }); });
  plugin._paintRefRowNestedCounts(row, ctx);
  let structural = 0;
  const wrap = (el, name) => {
    const orig = el[name]?.bind(el);
    if (!orig) return;
    el[name] = (...args) => { structural++; return orig(...args); };
  };
  for (const el of [row, ...row.querySelectorAll('*')]) {
    wrap(el, 'appendChild');
    wrap(el, 'insertBefore');
    wrap(el, 'insertAdjacentElement');
    wrap(el, 'remove');
  }
  resolveLate();
  await tick(30);
  assert.equal(structural, 0);
  const count = row.querySelector('.refx-nested-count');
  assert.equal(count.getAttribute('data-count'), '5');
  assert.equal(count.textContent, '');
  assert.equal(plugin._moRecordSkippable({ type: 'childList', target: row.querySelector('.trc-ref-popover-fulltext') }), true);
  const box = makeEl('div');
  box.className = 'refx-nested-refs';
  assert.equal(plugin._moRecordSkippable({ type: 'childList', target: box }), true);
});

test('T7 keyed boxes', async () => {
  const { plugin, makeEl } = setupV460Plugin();
  plugin._refChipCounts = true;
  plugin._queryRefLines = async () => [{ guid: 'N1', segments: [{ type: 'text', text: 'nested' }], children: [], record: { guid: 'REC' } }];
  plugin.data.getRecord = () => ({ getLineItems: async () => [] });
  const surface = makeEl('div');
  const row = makeEl('div');
  row.className = 'trc-ref-popover-item';
  const full = makeEl('div');
  full.className = 'trc-ref-popover-fulltext';
  const chipX = makeEl('span');
  chipX.className = 'tlr-seg-ref';
  chipX.dataset.refGuid = 'X';
  chipX.setAttribute('data-ref-guid', 'X');
  full.appendChild(chipX);
  row.appendChild(full);
  row.__refxLine = { guid: H1 };
  row.__refxCtx = { alive: () => true, gestureAlive: () => true, targetGuid: 'ROOT', nestPath: Object.freeze(['ROOT']), nestDepth: 0 };
  plugin._countCache.set('X', { count: 3 });
  plugin._countCache.set(H1, { count: 1 });
  plugin._paintRefRowNestedCounts(row, row.__refxCtx);
  const cx = revealed(row).find((c) => c.dataset.guid === 'X');
  const ch = revealed(row).find((c) => c.dataset.guid === H1);
  await plugin._toggleRefNestedRefs(cx, 'X', row, row.__refxCtx);
  await plugin._toggleRefNestedRefs(ch, H1, row, row.__refxCtx);
  const nestBoxes = [...row.querySelectorAll('.refx-nested-refs')];
  assert.equal(nestBoxes.length, 2);
  assert.notEqual(nestBoxes[0].dataset.refxNestTarget, nestBoxes[1].dataset.refxNestTarget);
  const boxMap = full.__refxNestedBoxes;
  const xBox = boxMap.get('X');
  const hBox = boxMap.get(H1);
  assert.ok(xBox && hBox);
  assert.ok(!xBox.classList.contains('refx-hidden'));
  assert.ok(!hBox.classList.contains('refx-hidden'));
  const cx2 = revealed(row).find((c) => c.dataset.guid === 'X');
  await plugin._toggleRefNestedRefs(cx2, 'X', row, row.__refxCtx);
  assert.ok(xBox.classList.contains('refx-hidden'));
  assert.ok(!hBox.classList.contains('refx-hidden'));
  assert.equal(cx2.getAttribute('aria-expanded'), 'false');
});

test('T8 keyboard activation', async () => {
  const { plugin, makeEl } = setupV460Plugin();
  const surface = makeEl('div');
  plugin._wireRefSurfaceChipNav(surface);
  const row = makeEl('div');
  row.className = 'trc-ref-popover-item';
  const full = makeEl('div');
  full.className = 'trc-ref-popover-fulltext';
  const count = makeEl('span');
  count.className = 'refx-nested-count';
  count.dataset.guid = H1;
  full.appendChild(count);
  row.appendChild(full);
  row.__refxCtx = { alive: () => true, gestureAlive: () => true, targetGuid: A, nestPath: Object.freeze([A]) };
  surface.appendChild(row);
  const toggles = [];
  plugin._toggleRefNestedRefs = (...args) => { toggles.push(args); return Promise.resolve(); };
  let prevented = false;
  let stopped = false;
  count.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; }, target: count, isComposing: false, metaKey: false, ctrlKey: false, altKey: false });
  assert.equal(toggles.length, 1);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  toggles.length = 0;
  count.dispatchEvent({ type: 'keydown', key: ' ', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; }, target: count, isComposing: false, metaKey: false, ctrlKey: false, altKey: false });
  assert.equal(toggles.length, 1);
  toggles.length = 0;
  prevented = false;
  count.dispatchEvent({ type: 'keydown', key: 'a', preventDefault() { prevented = true; }, target: count, isComposing: false, metaKey: false, ctrlKey: false, altKey: false });
  assert.equal(toggles.length, 0);
  assert.equal(prevented, false);
  count.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() { prevented = true; }, target: count, isComposing: false, metaKey: true, ctrlKey: false, altKey: false });
  assert.equal(toggles.length, 0);
  let mdPrevented = false;
  count.dispatchEvent({ type: 'mousedown', button: 0, preventDefault() { mdPrevented = true; }, stopPropagation() {}, target: count });
  assert.equal(mdPrevented, true);
});

test('T9 rule 141 gesture alive after token replace', async () => {
  const { plugin, makeEl } = setupV460Plugin();
  const body = makeEl('div');
  const line = { guid: H1, segments: [{ type: 'text', text: 'x' }], children: [], record: { guid: SEP14 } };
  plugin._countCache.set(H1, { count: 1 });
  plugin._queryRefLines = async () => [{ guid: H2, segments: [{ type: 'text', text: 'nested' }], children: [], record: { guid: COMMENTS } }];
  plugin.data.getRecord = () => ({ getLineItems: async () => [line] });
  plugin._wireRefSurfaceChipNav(body);
  plugin._renderRefsGroups(body, [line], { flat: true, targetGuid: A, alive: () => true, actionsFor: () => [] });
  await tick(30);
  const page1Row = body.querySelector('.trc-ref-popover-item');
  plugin._renderRefsGroups(body, [{ guid: 'OTHER', segments: [{ type: 'text', text: 'p2' }], children: [], record: { guid: 'R2' } }], { flat: true, targetGuid: A, alive: () => true, actionsFor: () => [] });
  await tick(30);
  const count = revealed(page1Row).find((c) => c.dataset.guid === H1);
  assert.ok(count);
  plugin._activateRefNestedCount(count);
  await tick(50);
  const box = page1Row.querySelector('.refx-nested-refs');
  assert.ok(box);
  assert.equal(box.querySelector('.refx-ref-line-loading'), null);
  box.classList.add('refx-hidden');
  count.setAttribute('aria-expanded', 'false');
  plugin._activateRefNestedCount(count);
  await tick(50);
  assert.ok(!box.classList.contains('refx-hidden'));
});

test('T10 outer-row hijack guard', () => {
  const { plugin, makeEl } = setupV460Plugin();
  const outer = makeEl('div');
  outer.className = 'trc-ref-popover-item';
  outer.__refxCtx = { alive: () => true, gestureAlive: () => true };
  plugin._wireRefRowZoomClicks(outer);
  const nested = makeEl('div');
  nested.className = 'trc-ref-popover-item';
  const crumb = makeEl('button');
  crumb.className = 'trc-ref-popover-crumb-parent';
  nested.appendChild(crumb);
  outer.appendChild(nested);
  const zooms = [];
  plugin._zoomRefRow = (...args) => { zooms.push(args); return Promise.resolve(); };
  const listeners = outer._listeners?.click || [];
  for (const fn of listeners) {
    fn({ target: crumb, preventDefault() {}, stopPropagation() {}, closest(sel) { return crumb; } });
  }
  assert.equal(zooms.length, 0);
});

test('T11 scoped repaint preserves nested counts', async () => {
  const { plugin, makeEl } = setupV460Plugin();
  const surface = makeEl('div');
  plugin._wireRefSurfaceChipNav(surface);
  const { H1line, records } = chainFixtures();
  wireChainData(plugin, records);
  plugin._renderRefsGroups(surface, [H1line], { flat: true, targetGuid: A, alive: () => true, actionsFor: () => [] });
  await tick(30);
  const outer = surface.querySelector('.trc-ref-popover-item');
  const count = revealed(outer)[0];
  count.dispatchEvent({ type: 'click', button: 0, preventDefault() {}, stopPropagation() {}, target: count });
  await tick(30);
  const nested = nestedItems(surface)[0];
  const nestedCounts = [...nested.querySelectorAll('.refx-nested-count')];
  const gen = nested.__refxNestedCountGen;
  plugin._paintRefRowNestedCounts(outer, outer.__refxCtx);
  for (const el of nestedCounts) {
    const still = nested.querySelector('.refx-nested-count[data-guid="' + el.dataset.guid + '"]');
    assert.equal(still, el);
    if (el.getAttribute('data-count')) assert.equal(still.getAttribute('data-count'), el.getAttribute('data-count'));
  }
  assert.equal(nested.__refxNestedCountGen, gen);
});

test('T12 box paging and overflowDefer', async () => {
  const { plugin, makeEl } = setupV460Plugin();
  const lines = [];
  for (let i = 0; i < 45; i++) {
    lines.push({ guid: 'LN' + i, segments: [{ type: 'text', text: 'line ' + i }], children: [], record: { guid: 'SRC' + (i % 10) } });
  }
  plugin._queryRefLines = async () => lines;
  plugin.data.getRecord = (g) => ({ getLineItems: async () => [{ guid: 'root', segments: [], children: [], record: { guid: g } }] });
  const row = makeEl('div');
  row.className = 'trc-ref-popover-item';
  const full = makeEl('div');
  full.className = 'trc-ref-popover-fulltext';
  row.appendChild(full);
  row.__refxCtx = { alive: () => true, gestureAlive: () => true, targetGuid: A, nestPath: Object.freeze([A]), nestDepth: 0 };
  row.__refxLine = { guid: H1 };
  const count = makeEl('span');
  count.className = 'refx-nested-count';
  count.dataset.guid = H1;
  full.appendChild(count);
  await plugin._toggleRefNestedRefs(count, H1, row, row.__refxCtx);
  await tick(50);
  const box = full.nextElementSibling;
  assert.ok(box);
  let rows = box.querySelectorAll('.trc-ref-popover-item');
  assert.equal(rows.length, 30);
  const more = box.querySelector('.refx-inline-refs-showmore');
  assert.ok(more);
  more.dispatchEvent({ type: 'click', button: 0, preventDefault() {}, stopPropagation() {}, target: more });
  await tick(20);
  rows = box.querySelectorAll('.trc-ref-popover-item');
  assert.equal(rows.length, 45);
  const deferred = box.querySelector('.refx-ref-context-load');
  assert.ok(deferred);
});

test('T13 zoom park reference view twisty', async () => {
  const { plugin, makeEl } = setupV460Plugin();
  const H1line = { guid: H1, parent_guid: SEP14, segments: [{ type: 'text', text: 'hop line' }], children: [], record: { guid: SEP14 } };
  plugin.data.getRecord = () => ({ getLineItems: async () => [{ guid: SEP14, parent_guid: null, segments: [{ type: 'text', text: 'page' }], children: [H1line] }] });
  const row = makeEl('div');
  row.className = 'trc-ref-popover-item';
  const top = makeEl('div');
  top.className = 'trc-ref-popover-item-top';
  const crumb = makeEl('div');
  crumb.className = 'trc-ref-popover-crumb';
  top.appendChild(crumb);
  const full = makeEl('div');
  full.className = 'trc-ref-popover-fulltext';
  const childBox = makeEl('div');
  childBox.className = 'refx-ref-context-children';
  const box = makeEl('div');
  box.className = 'refx-nested-refs';
  row.append(top, full, box, childBox);
  row.__refxCrumbEl = crumb;
  row.__refxChildBox = childBox;
  row.__refxLine = H1line;
  row.__refxCtx = { alive: () => true, gestureAlive: () => true, targetGuid: A, nestPath: Object.freeze([A]), treeCache: new Map() };
  plugin._countCache.set(H1, { count: 1 });
  plugin._paintRefRowNestedCounts(row, row.__refxCtx);
  row.__refxZoom = { refLineGuid: H1, refSourceGuid: SEP14, stack: [], view: { sourceGuid: SEP14, rootGuid: null } };
  await plugin._zoomRefRow(row, row.__refxCtx, { sourceGuid: SEP14, rootGuid: null });
  assert.ok(box.classList.contains('refx-nest-parked'));
  await plugin._renderRefRowReferenceView(row.__refxCtx, row.__refxLine, row);
  assert.ok(!box.classList.contains('refx-nest-parked'));
  assert.ok(revealed(row).find((c) => c.dataset.guid === H1));
  const kids = makeEl('div');
  kids.className = 'refx-wb-tree-kids refx-hidden';
  const treeLine = makeEl('div');
  treeLine.className = 'refx-wb-tree-line';
  treeLine.dataset.guid = 'TL1';
  const text = makeEl('span');
  text.className = 'refx-wb-tree-text';
  treeLine.append(text);
  kids.appendChild(treeLine);
  childBox.appendChild(kids);
  plugin._countCache.set('TL1', { count: 1 });
  plugin._paintRefRowNestedCounts(row, row.__refxCtx);
  assert.equal(revealed(treeLine).length, 0);
  kids.classList.remove('refx-hidden');
  plugin._paintRefRowNestedCounts(row, row.__refxCtx);
  assert.equal(revealed(treeLine).length, 1);
  const surface = makeEl('div');
  plugin._wireRefSurfaceChipNav(surface);
  surface.appendChild(row);
  const twist = makeEl('button');
  twist.className = 'refx-wb-tree-twist';
  treeLine.insertBefore(twist, text);
  kids.classList.add('refx-hidden');
  plugin._paintRefRowNestedCounts(row, row.__refxCtx);
  assert.equal(revealed(treeLine).length, 0);
  twist.dispatchEvent({ type: 'click', button: 0, preventDefault() {}, stopPropagation() {}, target: twist });
  await tick(20);
  kids.classList.remove('refx-hidden');
  await tick(20);
  plugin._paintRefRowNestedCounts(row, row.__refxCtx);
  assert.equal(revealed(treeLine).length, 1);
});

test('T14 unwired surfaces and source guards', () => {
  const { plugin, makeEl } = setupV460Plugin();
  const row = makeEl('div');
  row.className = 'trc-ref-popover-item';
  const full = makeEl('div');
  full.className = 'trc-ref-popover-fulltext';
  const chip = makeEl('span');
  chip.className = 'tlr-seg-ref';
  chip.dataset.refGuid = 'Z';
  chip.setAttribute('data-ref-guid', 'Z');
  full.appendChild(chip);
  row.appendChild(full);
  plugin._countCache.set('Z', { count: 2 });
  plugin._paintRefRowNestedCounts(row, { alive: () => true, targetGuid: 'ROOT', nestedCounts: false });
  assert.equal(row.querySelectorAll('.refx-nested-count').length, 0);
  assert.match(pluginSource, /nestedCounts:\s*false/);
  const cssBlock = pluginSource.match(/\.refx-nested-count\s*\{[\s\S]*?\.refx-nest-folded\s*\{[^}]*\}/);
  assert.ok(cssBlock, 'nested-count CSS block');
  const css = cssBlock[0];
  assert.match(css, /padding:\s*3px\s+4px/);
  assert.match(css, /margin:\s*-3px\s+-4px\s+-3px\s+0/);
  assert.match(css, /content:\s*attr\(data-count\)/);
  assert.match(css, /\.refx-nested-count:not\(\[data-count\]\)/);
  assert.match(css, /var\(--refx-count-size-preset/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /--refx-page-link-color/);
  assert.doesNotMatch(pluginSource, /depth\s*>=\s*2/);
  assert.match(pluginSource, /_beginInlineRowEdit[\s\S]*?_paintRefRowNestedCounts/);
  assert.match(pluginSource, /_beginTreeLineEdit[\s\S]*?_paintRefRowNestedCounts/);
});

test('T15 retry after query failure', async () => {
  const { plugin, makeEl } = setupV460Plugin();
  const { H2line } = chainFixtures();
  let fail = true;
  const { records } = chainFixtures();
  plugin.data.getRecord = (g) => {
    const roots = records[g];
    return roots ? { getLineItems: async () => roots } : { getLineItems: async () => [H2line] };
  };
  plugin._queryRefLines = async (g) => {
    if (g === H1 && fail) throw new Error('fail');
    if (g === H1) return [H2line];
    return [];
  };
  const row = makeEl('div');
  row.className = 'trc-ref-popover-item';
  const full = makeEl('div');
  full.className = 'trc-ref-popover-fulltext';
  row.appendChild(full);
  row.__refxCtx = { alive: () => true, gestureAlive: () => true, targetGuid: A, nestPath: Object.freeze([A]), nestDepth: 0 };
  row.__refxLine = { guid: H1 };
  const count = makeEl('span');
  count.className = 'refx-nested-count';
  count.dataset.guid = H1;
  full.appendChild(count);
  await plugin._toggleRefNestedRefs(count, H1, row, row.__refxCtx);
  await tick(20);
  const box = full.nextElementSibling;
  assert.ok(box.textContent.includes('(unavailable)') || box.querySelector('.refx-ref-line-empty'));
  fail = false;
  await plugin._toggleRefNestedRefs(count, H1, row, row.__refxCtx);
  await tick(30);
  const box2 = full.nextElementSibling;
  assert.ok(box2 && box2.classList.contains('refx-nested-refs'));
  assert.ok(box2.querySelector('.trc-ref-popover-item'));
});
