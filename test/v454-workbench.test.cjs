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
  let mutationObserverFn = null;
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
    MutationObserver: class {
      constructor(fn) { mutationObserverFn = fn; }
      observe() {}
      disconnect() {}
    },
    document: {
      createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, append() {}, setAttribute() {}, appendChild() {} }),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { clientHeight: 900 },
      body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {} },
      head: { appendChild() {} },
    },
    Element: class {},
    window: { CSS: { escape: (s) => String(s) }, g_universe: { itemsByGuid: {}, workspace: {} }, innerWidth: 1200 },
  };
  context.globalThis = context;
  vm.runInNewContext(source + '\nthis.PluginUnderTest = Plugin;', context, { filename: 'plugin.js' });
  const plugin = new context.PluginUnderTest();
  plugin._unloaded = false;
  plugin._recheckBackgroundGate = async () => true;
  plugin._isMac = true;
  plugin._toast = () => {};
  plugin.getOrLoadRecordName = (g) => ({ TARGET_A: 'Alpha', TARGET_B: 'Beta', TARGET_C: 'Gamma' }[g] || g);
  plugin.data = { getRecord: (g) => (g.startsWith('TARGET_') ? { guid: g, getName: () => plugin.getOrLoadRecordName(g) } : null), getAllCollections: async () => [] };
  return { plugin, storage, context, getMutationObserverFn: () => mutationObserverFn };
}

function initWorkbenchHarness(plugin, context, workspaceGuid = 'WORKSPACE_WB') {
  plugin.workspaceGuid = workspaceGuid;
  plugin._isUnloading = false;
  plugin._unloaded = false;
  plugin._initWorkbenchRuntimeOwner();
  return plugin._wbOwner;
}

function workbenchLine(guid, props = {}) {
  const line = {
    guid,
    type: 'transclusion',
    props: { ...props },
    async setMetaProperty(key, value) { this.props[key] = value; return true; },
    async delete() { return true; },
    async move() { return true; },
  };
  return line;
}

function workbenchRecord(guid, lines, options = {}) {
  let sequence = 0;
  const bindDelete = (line) => {
    line.delete = async () => { const i = lines.indexOf(line); if (i >= 0) lines.splice(i, 1); return true; };
    return line;
  };
  for (const line of lines) bindDelete(line);
  const record = {
    guid,
    getName: () => options.name || 'Reference Workbench State',
    async getLineItems() { return lines; },
    async createLineItem(_parent, after, type, _segments, props) {
      const line = bindDelete(workbenchLine(`WB_LINE_${++sequence}`, props));
      line.type = type;
      const idx = after ? lines.findIndex((l) => l === after) + 1 : lines.length;
      lines.splice(idx < 0 ? lines.length : idx, 0, line);
      options.onCreate?.(line, props);
      return line;
    },
  };
  if (options.trash) record.trash = options.trash;
  return record;
}

function stackRecord(name, lines, options = {}) {
  return workbenchRecord(`STACK_${name}`, lines, { name: `Workbench Stack: ${name}`, ...options });
}

function workbenchCollection(name, records, options = {}) {
  let created = [];
  return {
    guid: `COL_${name.toUpperCase()}`,
    getName: () => name,
    async getAllRecords() { return [...records, ...created]; },
    createRecord(recordName) {
      const guid = `CREATED_${created.length + 1}`;
      const lines = [];
      const rec = workbenchRecord(guid, lines, { name: recordName, onCreate: options.onStackCreate });
      if (options.onStackCreateRecord) options.onStackCreateRecord(rec);
      created.push(rec);
      records.push(rec);
      return guid;
    },
  };
}

function setupBacking(plugin, context, shelfLines, extraRecords = []) {
  const lines = shelfLines.slice();
  const backing = workbenchRecord('WB_RECORD', lines);
  const settings = workbenchCollection('Settings', [backing, ...extraRecords]);
  plugin.data = {
    getRecord: (g) => {
      if (g === 'WB_RECORD') return backing;
      const hit = [...extraRecords, backing].find((r) => r.guid === g);
      return hit || null;
    },
    getAllCollections: async () => [settings],
  };
  plugin._wbBackingRecord = backing;
  plugin._wbBackingGuid = 'WB_RECORD';
  plugin._wbBackingValidatedGuid = 'WB_RECORD';
  plugin._wbBackingValidatedCollectionGuid = settings.guid;
  initWorkbenchHarness(plugin, context);
  return { backing, lines, settings };
}

test('stack save writes shelf lines in pinned-first order', async () => {
  const { plugin, context } = loadPlugin();
  const stackLines = [];
  const stack = stackRecord('Mine', stackLines);
  const shelf = [
    workbenchLine('L1', { itemref: 'TARGET_A', refx_wb: 1, refx_variant: 'full' }),
    workbenchLine('L2', { itemref: 'TARGET_B', refx_wb: 1, refx_variant: 'full', refx_pinned: '1' }),
  ];
  setupBacking(plugin, context, shelf, [stack]);
  await plugin._wbStackSave('Mine', stack.guid);
  assert.equal(stackLines.length, 2);
  assert.equal(stackLines[0].props.itemref, 'TARGET_B');
  assert.equal(stackLines[1].props.itemref, 'TARGET_A');
});

test('stack load replaces unpinned items and keeps pinned', async () => {
  const { plugin, context } = loadPlugin();
  const stackLines = [
    workbenchLine('S1', { itemref: 'TARGET_C', refx_wb: 1, refx_variant: 'full' }),
    workbenchLine('S2', { itemref: 'TARGET_A', refx_wb: 1, refx_variant: 'refs' }),
  ];
  const stack = stackRecord('LoadMe', stackLines);
  const shelf = [
    workbenchLine('P1', { itemref: 'TARGET_B', refx_wb: 1, refx_variant: 'full', refx_pinned: '1' }),
    workbenchLine('U1', { itemref: 'TARGET_A', refx_wb: 1, refx_variant: 'full' }),
  ];
  const { lines } = setupBacking(plugin, context, shelf, [stack]);
  await plugin._wbStackLoad(stack.guid);
  assert.ok(lines.some((l) => l.props.itemref === 'TARGET_B' && l.props.refx_pinned === '1'));
  assert.ok(lines.some((l) => l.props.itemref === 'TARGET_C'));
  assert.ok(lines.some((l) => l.props.itemref === 'TARGET_A' && l.props.refx_variant === 'refs'));
  assert.equal(lines.filter((l) => l.props.itemref === 'TARGET_A' && l.props.refx_variant === 'full').length, 0);
});

test('stack delete trashes the record', async () => {
  const { plugin, context } = loadPlugin();
  let trashed = null;
  const stackLines = [];
  const stack = stackRecord('Gone', stackLines, {
    trash: async () => { trashed = stack.guid; return true; },
  });
  setupBacking(plugin, context, [], [stack]);
  await plugin._wbStackDelete(stack.guid);
  assert.equal(trashed, stack.guid);
});

test('Ctrl+Shift+2 loads the second stack by name order', async () => {
  const { plugin, context } = loadPlugin();
  const stackA = stackRecord('Alpha', [workbenchLine('SA', { itemref: 'TARGET_A', refx_wb: 1, refx_variant: 'full' })]);
  const stackB = stackRecord('Beta', [workbenchLine('SB', { itemref: 'TARGET_B', refx_wb: 1, refx_variant: 'full' })]);
  const { lines } = setupBacking(plugin, context, [], [stackB, stackA]);
  const loads = [];
  plugin._wbStackLoad = async (guid) => { loads.push(guid); };
  const panel = { classList: { contains: () => true } };
  const ev = {
    key: '2', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false,
    preventDefault() {}, stopImmediatePropagation() {},
    target: { closest: (sel) => (sel === '.refx-wb-live' ? panel : null) },
  };
  plugin._onWbPanelKey(ev);
  const stacks = await plugin._wbStackList(true);
  assert.equal(loads[0], stacks[1].guid);
});

test('remove pushes to closed list bounded and deduped; reopen restores variant and pin', async () => {
  const { plugin, context } = loadPlugin();
  const shelf = [
    workbenchLine('L1', { itemref: 'TARGET_A', refx_wb: 1, refx_variant: 'refs', refx_pinned: '1' }),
  ];
  setupBacking(plugin, context, shelf);
  const it = { lineGuid: 'L1', target: 'TARGET_A', variant: 'refs', pinned: true, line: shelf[0] };
  await plugin._wbLiveRemove(it, true);
  const key = plugin._wbClosedStorageKey();
  let list = JSON.parse(context.localStorage.getItem(key));
  assert.equal(list.length, 1);
  assert.equal(list[0].variant, 'refs');
  assert.equal(list[0].pinned, true);
  plugin._wbLiveRemove({ ...it, target: 'TARGET_B', variant: 'full', pinned: false, lineGuid: 'L2', line: workbenchLine('L2', {}) }, true);
  list = JSON.parse(context.localStorage.getItem(key));
  assert.equal(list.length, 2);
  for (let i = 0; i < 12; i++) {
    plugin._wbPushClosed({ target: `T${i}`, variant: 'full', pinned: false });
  }
  list = JSON.parse(context.localStorage.getItem(key));
  assert.equal(list.length, 10);
  plugin._wbPushClosed({ target: 'TARGET_A', variant: 'refs', pinned: true });
  list = JSON.parse(context.localStorage.getItem(key));
  assert.equal(list.filter((x) => x.target === 'TARGET_A' && x.variant === 'refs').length, 1);
  assert.equal(list[0].target, 'TARGET_A');

  const added = [];
  plugin._wbAddLive = async (guid, opts) => { added.push({ guid, opts }); };
  plugin._wbLoadLive = async () => [{ target: 'TARGET_A', variant: 'refs', pinned: false, line: { setMetaProperty: async () => true } }];
  plugin._wbLiveTogglePin = async () => {};
  context.localStorage.setItem(key, JSON.stringify([{ target: 'TARGET_A', variant: 'refs', pinned: true, ts: Date.now() }]));
  await plugin._wbReopenLast();
  assert.equal(added[0].guid, 'TARGET_A');
  assert.equal(added[0].opts.kind, 'linked-refs');
});

test('tab strip order mirrors shelf lines and click scrolls', async () => {
  const { plugin, context } = loadPlugin();
  const makeEl = (tag) => {
    const classes = new Set();
    const el = {
      tagName: String(tag).toUpperCase(),
      style: {}, dataset: {}, children: [], scrollTop: 0,
      classList: {
        add(...n) { n.forEach((x) => classes.add(x)); },
        remove(...n) { n.forEach((x) => classes.delete(x)); },
        contains: (x) => classes.has(x),
        toggle(n, f) { if (f === undefined) f = !classes.has(n); if (f) classes.add(n); else classes.delete(n); return f; },
      },
      appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
      append(...c) { for (const n of c) this.appendChild(n); },
      setAttribute(n, v) { this[n] = String(v); if (n.startsWith('data-')) this.dataset[n.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v); },
      querySelector(sel) {
        const attrMatch = sel.match(/\[data-refx-wb-line="([^"]+)"\]/);
        const clsMatch = sel.match(/^\.([^\[]+)/);
        const walk = (node) => {
          for (const c of node.children || []) {
            let ok = clsMatch || attrMatch;
            if (clsMatch && !c.classList?.contains(clsMatch[1])) ok = false;
            if (attrMatch && c.dataset?.refxWbLine !== attrMatch[1]) ok = false;
            if (ok && (clsMatch || attrMatch)) return c;
            const hit = walk(c);
            if (hit) return hit;
          }
          return null;
        };
        return walk(this);
      },
      querySelectorAll(sel) {
        const out = [];
        const cls = sel.startsWith('.') ? sel.slice(1) : '';
        const walk = (node) => {
          for (const c of node.children || []) {
            if (!cls || c.classList?.contains(cls)) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
      replaceChildren(...nodes) { this.children = nodes; },
      addEventListener(type, fn) { (this._listeners ||= {})[type] = (this._listeners[type] || []).concat(fn); },
      dispatchEvent(ev) {
        for (const fn of (this._listeners?.[ev.type] || [])) fn(ev);
        return true;
      },
    };
    Object.defineProperty(el, 'className', { get: () => [...classes].join(' '), set: (v) => { classes.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((x) => classes.add(x)); } });
    return el;
  };
  plugin._el = (tag, cls, text) => { const el = makeEl(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const shelf = [
    workbenchLine('L1', { itemref: 'TARGET_A', refx_wb: 1, refx_variant: 'full' }),
    workbenchLine('L2', { itemref: 'TARGET_B', refx_wb: 1, refx_variant: 'full' }),
  ];
  setupBacking(plugin, context, shelf);
  const scroller = makeEl('div');
  scroller.classList.add('panel-scroller-y');
  const panelEl = makeEl('div');
  panelEl.classList.add('refx-wb-live');
  panelEl.appendChild(scroller);
  const hdr1 = makeEl('div');
  hdr1.className = 'refx-wb-hdr';
  hdr1.dataset.refxWbLine = 'L1';
  hdr1.offsetTop = 120;
  hdr1.offsetParent = scroller;
  hdr1.closest = (sel) => { if (sel === '.refx-wb-filtered') return null; if (sel === '.refx-wb-live') return panelEl; return null; };
  const hdr2 = makeEl('div');
  hdr2.className = 'refx-wb-hdr';
  hdr2.dataset.refxWbLine = 'L2';
  hdr2.offsetTop = 360;
  hdr2.offsetParent = scroller;
  hdr2.closest = (sel) => { if (sel === '.refx-wb-filtered') return null; if (sel === '.refx-wb-live') return panelEl; return null; };
  scroller.appendChild(hdr1);
  scroller.appendChild(hdr2);
  plugin._wbHeaders.set('L1', { el: hdr1 });
  plugin._wbHeaders.set('L2', { el: hdr2 });
  const items = await plugin._wbLoadLive(null, plugin._wbOwner);
  plugin._wbLiveTabsEnsure(panelEl, items);
  const tabs = plugin._wbTabsEl.children.filter((c) => c.classList.contains('refx-wb-tab'));
  assert.equal(tabs.length, 2);
  assert.equal(tabs[0].dataset.refxWbLine, 'L1');
  assert.equal(tabs[1].dataset.refxWbLine, 'L2');
  tabs[1].dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {}, target: tabs[1] });
  assert.equal(scroller.scrollTop, 352);
});

test('Alt+Down Alt+Enter Alt+W route to workbench helpers', () => {
  const { plugin, context } = loadPlugin();
  setupBacking(plugin, context, []);
  const panel = { classList: { contains: () => true } };
  const target = { closest: (sel) => (sel === '.refx-wb-live' ? panel : null) };
  const active = { target: 'TARGET_A', lineGuid: 'L1' };
  plugin._wbLiveActiveItem = () => active;
  let moved = 0;
  let swapped = null;
  let removed = null;
  plugin._wbLiveMoveActive = (d) => { moved = d; };
  plugin._wbLiveSwapToMain = async (it) => { swapped = it; };
  plugin._wbLiveRemove = async (it) => { removed = it; };
  const base = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: true, preventDefault() {}, stopImmediatePropagation() {}, target };
  plugin._onWbPanelKey({ ...base, key: 'ArrowDown' });
  assert.equal(moved, 1);
  plugin._onWbPanelKey({ ...base, key: 'Enter' });
  assert.equal(swapped, active);
  plugin._onWbPanelKey({ ...base, key: 'w' });
  assert.equal(removed, active);
});

function installWbDom(plugin) {
  const makeEl = (tag) => {
    const listeners = {};
    const classes = new Set();
    const el = {
      tagName: String(tag).toUpperCase(),
      textContent: '', title: '', children: [], hidden: false,
      style: {}, dataset: {}, disabled: false, _listeners: listeners,
      parentElement: null, previousElementSibling: null, nextSibling: null,
      isConnected: true,
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
        this.children.push(child);
        return child;
      },
      append(...nodes) { for (const n of nodes) this.appendChild(n); },
      setAttribute(n, v) { this[n] = String(v); if (n.startsWith('data-')) this.dataset[n.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v); },
      querySelector(sel) {
        const attrMatch = sel.match(/\[data-guid="([^"]+)"\]/);
        const clsMatch = sel.match(/^\.([^\[]+)/);
        const walk = (node) => {
          for (const c of node.children || []) {
            let ok = clsMatch || attrMatch;
            if (clsMatch && !c.classList?.contains(clsMatch[1])) ok = false;
            if (attrMatch && c.dataset?.guid !== attrMatch[1] && c.getAttribute?.('data-guid') !== attrMatch[1]) ok = false;
            if (ok && (clsMatch || attrMatch)) return c;
            const hit = walk(c);
            if (hit) return hit;
          }
          return null;
        };
        return walk(this);
      },
      querySelectorAll(sel) {
        const out = [];
        const cls = sel.startsWith('.') ? sel.slice(1) : '';
        const walk = (node) => {
          for (const c of node.children || []) {
            if (!cls || c.classList?.contains(cls)) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
      replaceChildren(...nodes) { this.children = nodes; for (const n of nodes) n.parentElement = this; },
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
      dispatchEvent(ev) { for (const fn of (listeners[ev.type] || [])) fn(ev); return true; },
      remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((c) => c !== this); },
    };
    Object.defineProperty(el, 'className', { get: () => [...classes].join(' '), set: (v) => { classes.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((x) => classes.add(x)); } });
    return el;
  };
  plugin._el = (tag, cls, text) => { const el = makeEl(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  return makeEl;
}

function makeWbPanel(plugin, shelfItems) {
  const makeEl = installWbDom(plugin);
  const scroller = makeEl('div');
  scroller.classList.add('panel-scroller-y');
  const panelEl = makeEl('div');
  panelEl.classList.add('refx-wb-live');
  panelEl.appendChild(scroller);
  for (const it of shelfItems) {
    const tx = makeEl('div');
    tx.className = 'listitem-transclusion';
    tx.dataset.guid = it.lineGuid;
    scroller.appendChild(tx);
  }
  plugin._wbLivePanel = () => ({ getElement: () => panelEl });
  plugin._wbMainPanel = () => ({ getActiveRecord: () => ({ guid: 'MAIN_PAGE' }) });
  return { panelEl, scroller, makeEl };
}

test('related strip renders at most five chips from referencing records', async () => {
  const { plugin, context } = loadPlugin();
  installWbDom(plugin);
  const shelf = [
    workbenchLine('L1', { itemref: 'TARGET_A', refx_wb: 1, refx_variant: 'full' }),
    workbenchLine('L2', { itemref: 'TARGET_B', refx_wb: 1, refx_variant: 'full' }),
  ];
  setupBacking(plugin, context, shelf);
  const items = [
    { lineGuid: 'L1', target: 'TARGET_A', variant: 'full' },
    { lineGuid: 'L2', target: 'TARGET_B', variant: 'full' },
  ];
  let call = 0;
  plugin._queryRefLines = async () => {
    call++;
    return Array.from({ length: 4 }, (_, i) => ({ guid: 'LN' + call + '_' + i, record: { guid: 'REC_' + call + '_' + i }, segments: [{ type: 'text', text: 'row ' + i }] }));
  };
  plugin.getOrLoadRecordName = (g) => {
    if (g === 'TARGET_A') return 'Alpha';
    if (g === 'TARGET_B') return 'Beta';
    if (g.startsWith('REC_')) return 'Page ' + g.slice(4);
    return g;
  };
  const chips = await plugin._wbRelatedGather(items, null);
  assert.equal(chips.length, 5);
  assert.equal(call, 2);
  assert.ok(chips.every((c) => c.reason.startsWith('references ')));
});

test('related strip dedupes shelf targets and hides when empty', async () => {
  const { plugin, context } = loadPlugin();
  installWbDom(plugin);
  const shelf = [workbenchLine('L1', { itemref: 'TARGET_A', refx_wb: 1, refx_variant: 'full' })];
  setupBacking(plugin, context, shelf);
  const items = [{ lineGuid: 'L1', target: 'TARGET_A', variant: 'full' }];
  plugin._queryRefLines = async () => [{ guid: 'LN1', record: { guid: 'TARGET_A' }, segments: [{ type: 'text', text: 'self' }] }];
  const empty = await plugin._wbRelatedGather(items, null);
  assert.equal(empty.length, 0);
  const { panelEl } = makeWbPanel(plugin, items);
  plugin._wbLiveRelatedPaint(panelEl, items, []);
  assert.ok(!plugin._wbRelatedEl || plugin._wbRelatedEl.hidden === true);
});

test('related strip respects custom.workbench.related=false', () => {
  const { plugin, context } = loadPlugin();
  installWbDom(plugin);
  setupBacking(plugin, context, [workbenchLine('L1', { itemref: 'TARGET_A', refx_wb: 1, refx_variant: 'full' })]);
  plugin._wbRelatedEnabled = false;
  const { panelEl } = makeWbPanel(plugin, [{ lineGuid: 'L1', target: 'TARGET_A', variant: 'full' }]);
  plugin._wbLiveRelatedPaint(panelEl, [{ lineGuid: 'L1', target: 'TARGET_A', variant: 'full' }], [{ guid: 'REC_X', name: 'Extra', reason: 'references Alpha' }]);
  assert.equal(plugin._wbRelatedEl, null);
});

test('stale related generation never paints', async () => {
  const { plugin, context } = loadPlugin();
  installWbDom(plugin);
  setupBacking(plugin, context, [workbenchLine('L1', { itemref: 'TARGET_A', refx_wb: 1, refx_variant: 'full' })]);
  const items = [{ lineGuid: 'L1', target: 'TARGET_A', variant: 'full' }];
  const { panelEl } = makeWbPanel(plugin, items);
  let painted = null;
  const origPaint = plugin._wbLiveRelatedPaint.bind(plugin);
  plugin._wbLiveRelatedPaint = (pe, it, chips) => { painted = chips; origPaint(pe, it, chips); };
  plugin._queryRefLines = async () => new Promise((resolve) => setTimeout(() => resolve([{ guid: 'LN1', record: { guid: 'REC_OUT' }, segments: [{ type: 'text', text: 'out' }] }]), 5));
  plugin.getOrLoadRecordName = (g) => (g === 'REC_OUT' ? 'Outside' : 'Alpha');
  plugin._wbRelatedGen = 2;
  const p = plugin._wbRelatedRefresh(2);
  plugin._wbRelatedGen = 3;
  await p;
  assert.equal(painted, null);
  plugin._wbRelatedGen = 4;
  await plugin._wbRelatedRefresh(4);
  assert.ok(painted && painted.length >= 1);
});

test('related chip click calls _wbAdd', () => {
  const { plugin, context } = loadPlugin();
  installWbDom(plugin);
  setupBacking(plugin, context, [workbenchLine('L1', { itemref: 'TARGET_A', refx_wb: 1, refx_variant: 'full' })]);
  const items = [{ lineGuid: 'L1', target: 'TARGET_A', variant: 'full' }];
  const { panelEl } = makeWbPanel(plugin, items);
  const added = [];
  plugin._wbAdd = (guid, opts) => added.push({ guid, opts });
  plugin._wbLiveRelatedPaint(panelEl, items, [{ guid: 'REC_Z', name: 'Zed', reason: 'references Alpha' }]);
  const chip = plugin._wbRelatedEl.querySelector('.refx-wb-related-chip');
  chip.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(added[0], { guid: 'REC_Z', opts: undefined });
});

test('header count click calls _wbAdd with linked-refs kind', async () => {
  const { plugin } = loadPlugin();
  installWbDom(plugin);
  const added = [];
  plugin._wbAdd = (guid, opts) => added.push({ guid, opts });
  plugin.getCountInfoForGuid = async () => ({ count: 3, lines: 3 });
  plugin.getOrLoadRecordName = () => 'Alpha';
  plugin.data = { getRecord: (g) => (g === 'TARGET_A' ? { guid: g } : null) };
  const it = { lineGuid: 'L1', target: 'TARGET_A', variant: 'full', collapsed: false, pinned: false, line: {} };
  const el = plugin._el('div', 'refx-wb-hdr');
  plugin._wbLiveHeaderSync(el, it, false);
  await new Promise((r) => setTimeout(r, 0));
  const cnt = el.querySelector('.refx-wb-hdr-count');
  assert.equal(cnt.title, 'Open linked references as a Workbench item');
  cnt.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  assert.equal(added.length, 1);
  assert.equal(added[0].guid, 'TARGET_A');
  assert.equal(added[0].opts.kind, 'linked-refs');
});

test('v4.64.1 version locks stay green', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.version, '4.64.1');
  assert.ok(source.startsWith('// v4.64.1'));
  assert.ok(source.includes('window.__REFX_VERSION = "4.64.1"'));
  assert.ok(source.includes('_wbRelatedBuildCanonCtx'));
  assert.ok(source.includes('_wbRefreshStormRecordRun'));
  assert.ok(source.includes('refx_wb_disable'));
});

test('storm breaker trips after 60 runs in 30 s and tears down observer', async () => {
  const { plugin, context } = loadPlugin();
  setupBacking(plugin, context, []);
  plugin._wbLiveObs = { disconnect() {} };
  plugin._wbLiveObsEl = {};
  let toasts = [];
  plugin._toast = (msg) => { toasts.push(msg); };
  const t0 = Date.now();
  for (let i = 0; i < 59; i++) {
    plugin._wbRefreshRunTimes.push(t0 + i);
  }
  plugin._wbRefreshStormRecordRun();
  assert.equal(plugin._wbStormTripped, true);
  assert.equal(plugin._wbLiveObs, null);
  assert.ok(toasts.some((m) => /refresh storm/i.test(m)));
});

test('observer ignores mutations inside tabs, trail, and related strip', () => {
  const { plugin, context, getMutationObserverFn } = loadPlugin();
  setupBacking(plugin, context, []);
  let scheduled = 0;
  plugin._wbLiveScheduleRefresh = () => { scheduled++; return true; };
  const panelEl = { appendChild() {}, querySelector: () => null, querySelectorAll: () => [] };
  const tabs = { nodeType: 1, classList: { contains: (c) => c === 'refx-wb-tabs' }, closest: (sel) => (sel.includes('refx-wb-tabs') ? tabs : null), matches: () => false, querySelector: () => null };
  const trail = { nodeType: 1, classList: { contains: (c) => c === 'refx-wb-trail' }, closest: (sel) => (sel.includes('refx-wb-trail') ? trail : null), matches: () => false, querySelector: () => null };
  const related = { nodeType: 1, classList: { contains: (c) => c === 'refx-wb-related' }, closest: (sel) => (sel.includes('refx-wb-related') ? related : null), matches: () => false, querySelector: () => null };
  plugin._wbHeaders = new Map();
  plugin._wbFoldTwists = new Map();
  plugin._wbLiveTeardownObserver = () => {};
  plugin._wbLiveEnsureObserver(panelEl);
  const obsFn = getMutationObserverFn();
  assert.ok(obsFn);
  obsFn([{ target: tabs, addedNodes: [related] }]);
  obsFn([{ target: trail, addedNodes: [related] }]);
  assert.equal(scheduled, 0);
  const tx = { nodeType: 1, classList: { contains: () => false }, closest: () => null, matches: (sel) => sel === '.listitem-transclusion[data-guid]', querySelector: () => null };
  obsFn([{ target: panelEl, addedNodes: [tx] }]);
  assert.equal(scheduled, 1);
});

test('scroll handler never calls _wbLiveScheduleRefresh', () => {
  const { plugin } = loadPlugin();
  installWbDom(plugin);
  let scheduled = 0;
  plugin._wbLiveScheduleRefresh = () => { scheduled++; return true; };
  plugin._wbLiveTabsUpdateActiveOnly = () => {};
  const scroller = plugin._el('div', 'panel-scroller-y');
  plugin._wbLiveTabsWireScroll(scroller);
  assert.ok(plugin._wbTabsScrollFn);
  scroller.dispatchEvent({ type: 'scroll' });
  assert.equal(scheduled, 0);
});

test('tabs painter skips identical fingerprints', () => {
  const { plugin, context } = loadPlugin();
  installWbDom(plugin);
  setupBacking(plugin, context, [workbenchLine('L1', { itemref: 'TARGET_A', refx_wb: 1, refx_variant: 'full' })]);
  const items = [{ lineGuid: 'L1', target: 'TARGET_A', variant: 'full', collapsed: false, pinned: false }];
  const { panelEl } = makeWbPanel(plugin, items);
  plugin._wbTabsEl = plugin._el('div', 'refx-wb-tabs');
  plugin._wbTabsEl.appendChild(plugin._el('button', 'refx-wb-tab'));
  plugin._wbTabsFingerprint = plugin._wbTabsFingerprintOf(items);
  const before = plugin._wbTabsEl.children.length;
  plugin._wbLiveTabsPaint(panelEl, items);
  assert.equal(plugin._wbTabsEl.children.length, before);
  plugin._wbTabsFingerprint = '';
  plugin._wbLiveTabsPaint(panelEl, items);
  assert.equal(plugin._wbTabsEl.children.length, 1);
});

test('kill switch makes _openWorkbenchLive a no-op', async () => {
  const { plugin, context, storage } = loadPlugin();
  setupBacking(plugin, context, []);
  storage.set('refx_wb_disable', '1');
  let opened = false;
  plugin.ui = { createPanel: async () => { opened = true; return {}; }, getPanels: () => [] };
  plugin._wbLiveInit = async () => true;
  plugin._wbRestorePanels = async () => {};
  await plugin._openWorkbenchLive();
  assert.equal(opened, false);
});

test('related strip excludes main record shelf targets and dedupes by record guid', async () => {
  const { plugin, context } = loadPlugin();
  setupBacking(plugin, context, [workbenchLine('L1', { itemref: 'TARGET_A', refx_wb: 1, refx_variant: 'full' })]);
  const items = [{ lineGuid: 'L1', target: 'TARGET_A', variant: 'full' }];
  plugin._queryRefLines = async (guid) => {
    if (guid === 'TARGET_A') {
      return [
        { guid: 'LN1', record: { guid: 'TARGET_A' }, segments: [{ type: 'text', text: 'self' }] },
        { guid: 'LN2', record: { guid: 'REC_DUP' }, segments: [{ type: 'text', text: 'once' }] },
      ];
    }
    if (guid === 'MAIN_PAGE') {
      return [
        { guid: 'LN3', record: { guid: 'REC_DUP' }, segments: [{ type: 'text', text: 'dup' }] },
        { guid: 'LN4', record: { guid: 'MAIN_PAGE' }, segments: [{ type: 'text', text: 'main self' }] },
      ];
    }
    return [];
  };
  plugin.getOrLoadRecordName = (g) => ({ TARGET_A: 'Alpha', REC_DUP: 'Dup', MAIN_PAGE: 'Main' }[g] || g);
  const chips = await plugin._wbRelatedGather(items, 'MAIN_PAGE');
  assert.ok(!chips.some((c) => c.guid === 'TARGET_A'));
  assert.ok(!chips.some((c) => c.guid === 'MAIN_PAGE'));
  assert.equal(chips.filter((c) => c.guid === 'REC_DUP').length, 1);
});

test('related strip excludes main record under synthetic or real journal guid', async () => {
  const { plugin, context } = loadPlugin();
  const synthetic = 'S-JOURNAL-COL-USER-0-20260909';
  const realGuid = 'REAL_JOURNAL_SEP9';
  const journalRec = {
    guid: realGuid,
    getName: () => 'Wed Sep 9',
    getJournalDetails: () => ({ date: '2026-09-09', collectionGuid: 'JOURNAL-COL' }),
  };
  plugin.data = {
    getRecord: (g) => (g === realGuid ? journalRec : ({ TARGET_A: { guid: 'TARGET_A', getName: () => 'Alpha' } }[g] || null)),
    getAllCollections: async () => [],
  };
  plugin.getOrLoadRecordName = (g) => ({ TARGET_A: 'Alpha', [realGuid]: 'Wed Sep 9', [synthetic]: 'Wed Sep 9' }[g] || g);
  setupBacking(plugin, context, [workbenchLine('L1', { itemref: 'TARGET_A', refx_wb: 1, refx_variant: 'full' })]);
  const items = [{ lineGuid: 'L1', target: 'TARGET_A', variant: 'full' }];
  plugin._queryRefLines = async (guid) => {
    if (guid === 'TARGET_A') {
      return [{ guid: 'LN1', record: { guid: realGuid }, segments: [{ type: 'text', text: 'journal ref' }] }];
    }
    if (guid === synthetic || guid === realGuid) {
      return [
        { guid: 'LN_SELF1', record: { guid: realGuid }, segments: [{ type: 'text', text: 'self line' }] },
        { guid: 'LN_SELF2', record: { guid: synthetic }, segments: [{ type: 'text', text: 'alias self' }] },
        { guid: 'LN_OTHER', record: { guid: 'OTHER_PAGE' }, segments: [{ type: 'text', text: 'other mention' }] },
      ];
    }
    return [];
  };
  plugin._wbMainPanel = () => ({ getActiveRecord: () => ({ guid: synthetic }) });
  const chips = await plugin._wbRelatedGather(items, synthetic);
  assert.ok(!chips.some((c) => c.guid === 'LN_SELF1' || c.guid === 'LN_SELF2'));
  assert.ok(!chips.some((c) => c.guid === 'LN1'));
  assert.ok(chips.some((c) => c.guid === 'LN_OTHER' && c.reason === 'mentions Wed Sep 9'));
});

test('related strip collapses duplicate journal guid forms to one chip', async () => {
  const { plugin, context } = loadPlugin();
  const synthetic = 'S-JOURNAL-COL-USER-0-20260908';
  const realGuid = 'REAL_JOURNAL_SEP8';
  plugin.data = {
    getRecord: (g) => {
      if (g === realGuid) {
        return { guid: realGuid, getName: () => 'Tue Sep 8', getJournalDetails: () => ({ date: '2026-09-08', collectionGuid: 'JOURNAL-COL' }) };
      }
      if (g === 'TARGET_A') return { guid: 'TARGET_A', getName: () => 'Alpha' };
      return null;
    },
    getAllCollections: async () => [],
  };
  plugin.getOrLoadRecordName = (g) => ({ TARGET_A: 'Alpha', OTHER: 'Other', [realGuid]: 'Tue Sep 8' }[g] || g);
  setupBacking(plugin, context, [workbenchLine('L1', { itemref: 'TARGET_A', refx_wb: 1, refx_variant: 'full' })]);
  const items = [{ lineGuid: 'L1', target: 'TARGET_A', variant: 'full' }];
  plugin._queryRefLines = async (guid) => {
    if (guid !== 'TARGET_A') return [];
    return [
      { guid: 'LN_A', record: { guid: realGuid }, segments: [{ type: 'text', text: 'via real' }] },
      { guid: 'LN_B', record: { guid: synthetic }, segments: [{ type: 'text', text: 'via synthetic' }] },
      { guid: 'LN_C', record: { guid: 'OTHER' }, segments: [{ type: 'text', text: 'distinct' }] },
    ];
  };
  const chips = await plugin._wbRelatedGather(items, null);
  assert.equal(chips.filter((c) => c.name === 'Tue Sep 8').length, 1);
  assert.ok(chips.some((c) => c.name === 'Other'));
});

test('navigation schedules related refresh with canonical main key in cache', async () => {
  const { plugin, context } = loadPlugin();
  installWbDom(plugin);
  setupBacking(plugin, context, [workbenchLine('L1', { itemref: 'TARGET_A', refx_wb: 1, refx_variant: 'full' })]);
  const items = [{ lineGuid: 'L1', target: 'TARGET_A', variant: 'full' }];
  const { panelEl } = makeWbPanel(plugin, items);
  plugin._wbLoadLive = async () => items;
  plugin._wbOwnerCurrent = () => true;
  plugin._wbRelatedEnabled = true;
  plugin._wbRelatedCache = new Map();
  plugin._wbLivePanel = () => ({ getElement: () => panelEl });
  let mainGuid = 'MAIN_WED';
  plugin._wbMainPanel = () => ({ getActiveRecord: () => ({ guid: mainGuid }) });
  let gatherCalls = 0;
  plugin._wbRelatedGather = async (it, main) => {
    gatherCalls++;
    return [{ guid: 'CHIP_' + main, name: 'Chip ' + main, reason: 'references Alpha' }];
  };
  plugin._wbRelatedGen = 1;
  await plugin._wbRelatedRefresh(1);
  assert.equal(gatherCalls, 1);
  const wedKey = plugin._wbRelatedCacheKey(items, 'MAIN_WED', plugin._wbRelatedBuildCanonCtx(items, 'MAIN_WED'));
  assert.ok(plugin._wbRelatedCache.has(wedKey));
  mainGuid = 'MAIN_TUE';
  plugin._wbRelatedGen = 2;
  await plugin._wbRelatedRefresh(2);
  assert.equal(gatherCalls, 2);
  const tueKey = plugin._wbRelatedCacheKey(items, 'MAIN_TUE', plugin._wbRelatedBuildCanonCtx(items, 'MAIN_TUE'));
  assert.notEqual(wedKey, tueKey);
  assert.ok(plugin._wbRelatedCache.has(tueKey));
  let navScheduled = 0;
  const origSchedule = plugin._wbRelatedScheduleRefresh.bind(plugin);
  plugin._wbRelatedScheduleRefresh = (delay) => { navScheduled++; return origSchedule(delay); };
  await plugin._onNavigated({ panel: {} });
  assert.equal(navScheduled, 1);
});

test('fold mount gate includes children variant', () => {
  const decorateSite = source.match(/if \(!it\.collapsed && !dangling && \(it\.variant === "full" \|\| it\.variant === "children"\)\)/);
  assert.ok(decorateSite, '_wbFoldMount runs for full and children variants');
});

test('stack save invalidates the cache', async () => {
  const { plugin, context } = loadPlugin();
  const stackLines = [];
  const stack = stackRecord('Fresh', stackLines);
  setupBacking(plugin, context, [workbenchLine('L1', { itemref: 'TARGET_A', refx_wb: 1, refx_variant: 'full' })], [stack]);
  plugin._wbStackListCache = [{ guid: 'STALE', getName: () => 'Workbench Stack: Stale' }];
  await plugin._wbStackSave('Fresh', stack.guid);
  assert.equal(plugin._wbStackListCache, null);
  const stacks = await plugin._wbStackList();
  assert.ok(stacks.some((r) => r.guid === stack.guid));
});
