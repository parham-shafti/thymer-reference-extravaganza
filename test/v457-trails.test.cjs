'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'plugin.js'), 'utf8');

function loadPlugin(workspace = 'WS_TRAIL') {
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
    window: {
      CSS: { escape: (s) => String(s) },
      g_universe: { itemsByGuid: {}, workspace: { guid: workspace } },
      addEventListener() {},
      removeEventListener() {},
    },
  };
  context.globalThis = context;
  vm.runInNewContext(source + '\nthis.PluginUnderTest = Plugin;', context, { filename: 'plugin.js' });
  const plugin = new context.PluginUnderTest();
  plugin._unloaded = false;
  plugin._refxTrail = { ring: [], cap: 200 };
  plugin._trailsEnabled = true;
  plugin._trailsLoadedFromRecord = true;
  plugin._trailsEnsureLoaded = async () => {};
  plugin._wbTrailEnabled = true;
  plugin._wbWorkspaceGuid = () => workspace;
  plugin._wbOwner = { token: 1 };
  plugin._wbOwnerCurrent = () => true;
  plugin._wbOperationCurrent = () => true;
  plugin.getOrLoadRecordName = (g) => ({ R1: 'Alpha', R2: 'Beta', R3: 'Gamma', GONE: 'Ghost' }[g] || g);
  plugin._lineTextByGuid = () => '';
  plugin.data = {
    getRecord: (g) => (['R1', 'R2', 'R3'].includes(g) ? { guid: g, getName: () => plugin.getOrLoadRecordName(g) } : null),
    getAllCollections: async () => [],
  };
  plugin._el = (tag, cls, text) => {
    const listeners = {};
    const classes = new Set();
    const el = {
      tagName: String(tag).toUpperCase(),
      textContent: text != null ? String(text) : '',
      title: '', children: [], hidden: false, isConnected: true,
      style: {}, dataset: {}, disabled: false, _listeners: listeners,
      parentElement: null, previousElementSibling: null, nextSibling: null,
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
      appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
      append(...nodes) { for (const n of nodes) this.appendChild(n); },
      setAttribute(n, v) { this[n] = String(v); },
      addEventListener(type, fn) { listeners[type] = fn; },
      dispatchEvent(ev) { const fn = listeners[ev.type]; if (fn) fn(ev); return true; },
      replaceChildren(...nodes) { this.children = []; for (const n of nodes) this.appendChild(n); },
      remove() { this.isConnected = false; },
    };
    if (cls) el.classList.add(...cls.split(' '));
    return el;
  };
  plugin._toast = () => {};
  plugin._openModal = () => {};
  plugin._wbLivePanel = () => ({ getElement: () => panelEl });
  let panelEl = null;
  plugin._setPanelEl = (el) => { panelEl = el; };
  return { plugin, storage, context };
}

function makePanel(plugin) {
  const scroller = plugin._el('div');
  scroller.classList.add('panel-scroller-y');
  const panelEl = plugin._el('div');
  panelEl.classList.add('refx-wb-live');
  panelEl.querySelector = (sel) => (sel === '.panel-scroller-y' ? scroller : null);
  panelEl.appendChild(scroller);
  plugin._wbTabsEl = plugin._el('div', 'refx-wb-tabs');
  scroller.appendChild(plugin._wbTabsEl);
  plugin._setPanelEl(panelEl);
  return { panelEl, scroller };
}

test('trail ring caps at 200 and persists debounced', async () => {
  const { plugin, storage } = loadPlugin();
  for (let i = 0; i < 205; i++) plugin._connRecordHop('SRC', 'R' + i, 'jump');
  assert.equal(plugin._refxTrail.ring.length, 200);
  assert.equal(storage.get('refx_trail_v1:WS_TRAIL'), undefined);
  await new Promise((r) => setTimeout(r, 300));
  const raw = storage.get('refx_trail_v1:WS_TRAIL');
  assert.ok(raw);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.v, 2);
  assert.equal(parsed.ring.length, 200);
});

test('strip renders last 8 commits newest-last with ellipsis when longer', () => {
  const { plugin } = loadPlugin();
  const ring = [];
  for (let i = 0; i < 10; i++) {
    ring.push({ id: 'j' + i, guid: 'R' + i, label: 'Hop ' + i, ts: Date.now() - i * 60000, how: 'jump', kind: 'jump', parent: '', dwellMs: 0 });
    ring.push({ id: 'h' + i, guid: 'H' + i, label: 'Hover ' + i, ts: Date.now() - i * 60000, how: 'hover', kind: 'hover', parent: '', dwellMs: 0 });
  }
  plugin._refxTrail = { ring, cap: 200 };
  plugin._trailCommitsOnly = true;
  const { panelEl } = makePanel(plugin);
  plugin._wbLiveTrailPaint(panelEl);
  const hops = plugin._wbTrailEl.children.filter((c) => c.classList.contains('refx-wb-trail-hop'));
  assert.equal(hops.length, 8);
  assert.ok(plugin._wbTrailEl.children.some((c) => c.classList.contains('refx-wb-trail-more')));
  assert.match(hops[0].textContent, /Hop 2/);
  assert.match(hops[7].textContent, /Hop 9/);
});

test('hop click calls _bridgeJump', () => {
  const { plugin } = loadPlugin();
  plugin._refxTrail = { ring: [{ id: 'j1', guid: 'R1', label: 'Alpha', ts: Date.now(), how: 'jump', kind: 'jump', parent: '', dwellMs: 0 }], cap: 200 };
  const jumps = [];
  plugin._bridgeJump = (g, opts) => { jumps.push({ g, opts }); };
  const { panelEl } = makePanel(plugin);
  plugin._wbLiveTrailPaint(panelEl);
  const hop = plugin._wbTrailEl.children.find((c) => c.classList.contains('refx-wb-trail-hop'));
  hop.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  assert.equal(jumps.length, 1);
  assert.equal(jumps[0].g, 'R1');
});

test('save-as-stack passes distinct record guids in walk order', async () => {
  const { plugin } = loadPlugin();
  plugin._refxTrail = {
    ring: [
      { id: 'j1', guid: 'R1', label: 'Alpha', ts: 1, how: 'jump', kind: 'jump', parent: '', dwellMs: 0 },
      { id: 'j2', guid: 'R2', label: 'Beta', ts: 2, how: 'jump', kind: 'jump', parent: '', dwellMs: 0 },
      { id: 'j3', guid: 'R1', label: 'Alpha', ts: 3, how: 'jump', kind: 'jump', parent: '', dwellMs: 0 },
      { id: 'j4', guid: 'GONE', label: 'Ghost', ts: 4, how: 'jump', kind: 'jump', parent: '', dwellMs: 0 },
      { id: 'j5', guid: 'R3', label: 'Gamma', ts: 5, how: 'jump', kind: 'jump', parent: '', dwellMs: 0 },
    ],
    cap: 200,
  };
  let saved = null;
  plugin._wbStackSaveTargets = async (name, guids) => { saved = { name, guids }; return true; };
  plugin._openModal = ({ onSave }) => { onSave('Walk'); };
  plugin._wbTrailSaveAsStackModal();
  assert.ok(saved);
  assert.equal(saved.name, 'Walk');
  assert.equal(saved.guids.length, 3);
  assert.equal(saved.guids[0], 'R1');
  assert.equal(saved.guids[1], 'R2');
  assert.equal(saved.guids[2], 'R3');
});

test('replay advances in order, supersedes on generation bump, stops on unload', async () => {
  const { plugin } = loadPlugin();
  plugin._refxTrail = {
    ring: [
      { id: 'j1', guid: 'R1', label: 'Alpha', ts: 1, how: 'jump', kind: 'jump', parent: '', dwellMs: 0 },
      { id: 'j2', guid: 'R2', label: 'Beta', ts: 2, how: 'jump', kind: 'jump', parent: '', dwellMs: 0 },
    ],
    cap: 200,
  };
  makePanel(plugin);
  const order = [];
  plugin._bridgeJump = async (g) => { order.push(g); };
  const run = plugin._wbTrailReplay();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(order, ['R1']);
  plugin._wbTrailReplayGen++;
  await run;
  assert.equal(order.length, 1);
  plugin._unloaded = true;
  plugin._wbTrailReplayActive = false;
  plugin._wbTrailReplayGen = 0;
  await plugin._wbTrailReplay();
  assert.equal(order.length, 1);
});

test('clear button needs two presses', () => {
  const { plugin, storage } = loadPlugin();
  plugin._refxTrail = { ring: [{ id: 'j1', guid: 'R1', label: 'Alpha', ts: Date.now(), how: 'jump', kind: 'jump', parent: '', dwellMs: 0 }], cap: 200 };
  storage.set('refx_trail_v1:WS_TRAIL', JSON.stringify(plugin._refxTrail));
  const toasts = [];
  plugin._toast = (m) => toasts.push(m);
  plugin._wbTrailClear();
  assert.equal(plugin._refxTrail.ring.length, 1);
  plugin._wbTrailClear();
  assert.equal(plugin._refxTrail.ring.length, 0);
  assert.equal(storage.get('refx_trail_v1:WS_TRAIL'), undefined);
  assert.ok(toasts.some((m) => /again/i.test(m)));
});

test('strip registered in mutation-ignore lists and teardown selector', () => {
  assert.match(source, /\.refx-wb-trail/);
  assert.match(source, /refx-wb-tabs, \.refx-wb-trail, \.refx-wb-related/);
  assert.match(source, /refx-wb-tabs, \.refx-wb-trail, \.refx-wb-related, \.refx-wb-shared/);
});

test('strip hidden when ring is empty', () => {
  const { plugin } = loadPlugin();
  plugin._refxTrail = { ring: [], cap: 200 };
  plugin._trailsEnabled = true;
  plugin._trailsLoadedFromRecord = true;
  plugin._trailsEnsureLoaded = async () => {};
  const { panelEl } = makePanel(plugin);
  plugin._wbLiveTrailEnsure(panelEl, []);
  assert.equal(plugin._wbTrailEl.hidden, true);
});

test('v4.64.1 version locks', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.version, '4.64.1');
  assert.ok(source.startsWith('// v4.64.1'));
  assert.ok(source.includes('window.__REFX_VERSION = "4.64.1"'));
  assert.ok(source.includes('_wbLiveTrailEnsure'));
  assert.ok(source.includes('custom.workbench.trail'));
});
