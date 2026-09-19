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
    this._classes = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => this._classes.add(x)),
      remove: (...c) => c.forEach((x) => this._classes.delete(x)),
      toggle: (c, force) => {
        const on = force === undefined ? !this._classes.has(c) : force;
        if (on) this._classes.add(c); else this._classes.delete(c);
        return on;
      },
      contains: (c) => this._classes.has(c),
    };
    this.children = [];
    this.textContent = '';
    this._listeners = {};
    this.isConnected = true;
    this.parentNode = null;
  }
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
    if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
    if (sel.includes('[')) {
      const m = sel.match(/\[([^=\]]+)(?:="([^"]*)")?\]/);
      if (m) {
        const got = this.getAttribute(m[1]);
        if (got == null || (m[2] != null && got !== m[2])) return false;
        sel = sel.slice(0, m.index);
      }
    }
    return !sel || sel === '*' || this.tagName === sel.toUpperCase();
  }
  setAttribute(k, v) { this._attrs = this._attrs || {}; this._attrs[k] = String(v); }
  getAttribute(k) { return this._attrs?.[k] ?? null; }
  addEventListener() {}
}

function loadPlugin(workspaceGuid = 'WS_TEST') {
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
    window: {
      CSS: { escape: (s) => String(s) },
      g_universe: { itemsByGuid: {}, workspace: { guid: workspaceGuid } },
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
  plugin.workspaceGuid = workspaceGuid;
  plugin.isExistingRecordGuid = () => false;
  plugin.data = { getRecord: () => null, searchByQuery: async () => ({ lines: [], records: [] }) };
  plugin._renderLink = () => {};
  plugin._r5SessionGen = 1;
  return { plugin, storage, context, body };
}

function seedLine(ctx, guid, text, rguid = 'PAGE1') {
  ctx.window.g_universe.itemsByGuid[guid] = {
    guid, rguid, type: 'ulist', text_segments: ['text', text],
  };
}

function makeLink(plugin, overrides = {}) {
  return {
    kind: 'line', br: '((', query: '', docQuery: null,
    results: [], resultPool: [], resultsQuery: null, resultsPreSliceCount: 0,
    sel: 0, userSelected: false, token: 0, r5Session: 1,
    lineGuid: 'HOST', pageGuid: 'HOST_PAGE', textCache: new Map(),
    pop: { isConnected: true }, fuzzyPool: new Map(),
    ...overrides,
  };
}

test('pick records query tokens in workspace-scoped localStorage', () => {
  const { plugin, storage } = loadPlugin('WS_A');
  plugin._pickMemoryRecord('LINE1', ['alpha', 'beta']);
  const raw = storage.get('refx_pick_memory_v1:WS_A');
  assert.ok(raw);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.alpha.LINE1, parsed.beta.LINE1);
});

test('pick memory keys are namespaced per workspace', () => {
  const { plugin: pA, storage: sA } = loadPlugin('WS_A');
  const { plugin: pB } = loadPlugin('WS_B');
  pA._pickMemoryRecord('LINE1', ['token']);
  pB._pickMemoryRecord('LINE2', ['token']);
  assert.ok(sA.get('refx_pick_memory_v1:WS_A'));
  assert.ok(!sA.has('refx_pick_memory_v1:WS_B'));
  const hitsB = pB._pickMemoryHits(['token']);
  assert.equal(hitsB.get('LINE2'), 1);
  assert.ok(!hitsB.has('LINE1'));
});

test('pick memory store is bounded to 300 token-guid pairs', () => {
  const { plugin, storage } = loadPlugin('WS_CAP');
  for (let i = 0; i < 350; i++) plugin._pickMemoryRecord('G' + i, ['t' + i]);
  const parsed = JSON.parse(storage.get('refx_pick_memory_v1:WS_CAP'));
  let pairs = 0;
  for (const guids of Object.values(parsed)) pairs += Object.keys(guids).length;
  assert.equal(pairs, 300);
});

test('learned token ranks matching guid first with matchKind learned even when other tokens miss', async () => {
  const { plugin, context } = loadPlugin();
  seedLine(context, 'LEARNED', 'Unrelated zephyr content', 'PAGE1');
  seedLine(context, 'OTHER', 'alpha bravo exact match', 'PAGE1');
  plugin._recordNameIndex = new Map([['PAGE1', 'Test Page']]);
  plugin._pickMemoryRecord('LEARNED', ['alpha', 'beta', 'gamma']);
  plugin._link = makeLink(plugin, { query: 'alpha bogus' });
  await plugin._runLinkSearch('alpha bogus');
  await plugin._link.scanDone;
  const learned = plugin._link.results.find((r) => r.guid === 'LEARNED');
  const other = plugin._link.results.find((r) => r.guid === 'OTHER');
  assert.ok(learned, 'learned row must appear despite bogus token');
  assert.equal(learned.matchKind, 'learned');
  assert.ok(!other || learned.score >= (other.score || 0), 'learned guid should rank first');
});

test('memory never filters rows out of the result pool', async () => {
  const { plugin, context } = loadPlugin();
  seedLine(context, 'ONLY', 'totally different words here', 'PAGE1');
  plugin._recordNameIndex = new Map([['PAGE1', 'Page']]);
  plugin._pickMemoryRecord('ONLY', ['needle']);
  plugin._link = makeLink(plugin);
  await plugin._runLinkSearch('needle noise');
  await plugin._link.scanDone;
  assert.ok(plugin._link.results.some((r) => r.guid === 'ONLY'));
});

test('empty query lists learned guids after recent suggestions', () => {
  const { plugin, context } = loadPlugin();
  seedLine(context, 'LEARNED_EMPTY', 'Learned empty state line', 'PAGE1');
  plugin._recordNameIndex = new Map([['PAGE1', 'Page']]);
  plugin._r5RecordFrecency('RECENT1');
  plugin._pickMemoryRecord('LEARNED_EMPTY', ['picked']);
  const rows = plugin._r5EmptyPickerCandidates('line', 'HOST', 12);
  const recentIdx = rows.findIndex((r) => r.suggestionKind === 'recent');
  const learnedIdx = rows.findIndex((r) => r.guid === 'LEARNED_EMPTY' && r.suggestionKind === 'learned');
  assert.ok(learnedIdx >= 0, 'learned guid should appear in empty suggestions');
  if (recentIdx >= 0) assert.ok(learnedIdx > recentIdx, 'learned follows recent');
});

test('_wbLiveApplyFilter matches s3 against season 3 header title', () => {
  const { plugin, body } = loadPlugin();
  const panelEl = new FakeEl('div');
  const node = new FakeEl('div');
  node.classList.add('listitem-transclusion');
  node.setAttribute('data-guid', 'WB_LINE');
  panelEl.appendChild(node);
  body.appendChild(panelEl);
  const hdr = new FakeEl('div');
  const title = new FakeEl('span');
  title.classList.add('refx-wb-hdr-title');
  title.textContent = 'season 3 recap';
  hdr.appendChild(title);
  plugin._wbHeaders = new Map([['WB_LINE', { el: hdr }]]);
  plugin._wbLivePanel = () => ({ getElement: () => panelEl });
  plugin._wbLiveFilter = 's3';
  plugin._wbLiveApplyFilter();
  assert.ok(!node.classList.contains('refx-wb-filtered'));
});

test('_applyInlineRefsFilter matches s3 against season 3 row text', () => {
  const { plugin } = loadPlugin();
  const bodyEl = new FakeEl('div');
  const group = new FakeEl('div');
  group.classList.add('refx-inline-refs-group');
  const gname = new FakeEl('div');
  gname.classList.add('refx-inline-refs-group-name');
  gname.textContent = 'Source';
  const row = new FakeEl('div');
  row.classList.add('refx-inline-refs-row');
  row.textContent = 'Watch season 3 tonight';
  group.append(gname, row);
  bodyEl.appendChild(group);
  const entry = { bodyEl, filterEl: { value: 's3' } };
  plugin._applyInlineRefsFilter(entry);
  assert.ok(!row.classList.contains('refx-hidden'));
});

test('v4.64.1 source guards', () => {
  assert.match(source, /_pickMemoryRecord\(/);
  assert.match(source, /_pickMemoryHits\(/);
  assert.match(source, /refx_pick_memory_v1:/);
  assert.equal(manifest.version, '4.64.1');
  assert.ok(source.startsWith('// v4.64.1'));
  assert.ok(source.includes('window.__REFX_VERSION = "4.64.1"'));
});
