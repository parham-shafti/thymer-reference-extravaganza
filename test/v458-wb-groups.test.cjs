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
  const context = {
    AppPlugin: class {},
    console,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout,
    performance: { now: () => Date.now() },
    CSS: { escape: (s) => String(s).replace(/"/g, '\\"') },
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
        addEventListener() {}, remove() {}, removeChild() {},
        hidden: false, children: [], isConnected: true, parentElement: null,
        previousElementSibling: null, nextSibling: null, dataset: {},
        querySelector: () => null, querySelectorAll: () => [],
      }),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { clientHeight: 900 },
      body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {} },
      head: { appendChild() {} },
    },
    Element: class {},
    window: { CSS: { escape: (s) => String(s).replace(/"/g, '\\"') }, g_universe: { itemsByGuid: {}, workspace: {} } },
  };
  context.globalThis = context;
  vm.runInNewContext(source + '\nthis.PluginUnderTest = Plugin;', context, { filename: 'plugin.js' });
  const plugin = new context.PluginUnderTest();
  plugin._unloaded = false;
  plugin._wbHeaders = new Map();
  plugin._wbOwner = { token: 1 };
  plugin._wbOwnerCurrent = () => true;
  plugin._wbCtxGroupsFp = '';
  plugin._wbCtxGroupAnnot = new Map();
  plugin._wbLiveGuidFilter = null;
  plugin._wbLiveFilter = '';
  plugin._el = (tag, cls, text) => {
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      className: cls || '',
      classList: {
        _c: new Set(String(cls || '').split(/\s+/).filter(Boolean)),
        add(...a) { a.forEach((x) => this._c.add(x)); el.className = [...this._c].join(' '); },
        remove(...a) { a.forEach((x) => this._c.delete(x)); el.className = [...this._c].join(' '); },
        toggle(x, on) { if (on) this.add(x); else this.remove(x); },
        contains(x) { return this._c.has(x); },
      },
      children: [],
      dataset: {},
      type: 'button',
      textContent: text || '',
      title: '',
      append(child) { this.children.push(child); child.parentElement = this; },
      remove() {},
      querySelector(sel) {
        const walk = (n) => {
          if (!n) return null;
          if (sel.includes('trc-ref-popover-crumb') && n.classList.contains('trc-ref-popover-crumb')) return n;
          if (sel.startsWith('[data-guid="')) {
            const g = sel.slice('[data-guid="'.length, -2);
            if (n.dataset && n.dataset.guid === g) return n;
          }
          if (sel === '.refx-wb-ctx-pill' && n.classList.contains('refx-wb-ctx-pill')) return n;
          for (const c of n.children || []) { const hit = walk(c); if (hit) return hit; }
          return null;
        };
        return walk(this);
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          if (!n) return;
          if (sel === '.refx-wb-ctx-pill' && n.classList?.contains('refx-wb-ctx-pill')) out.push(n);
          if (sel === '.is-shared' && n.classList?.contains('is-shared')) out.push(n);
          if (sel === '[data-guid]') {
            if (n.dataset?.guid) out.push(n);
          }
          for (const c of n.children || []) walk(c);
        };
        walk(this);
        return out;
      },
      setAttribute() {},
      addEventListener() {},
      closest(cls) {
        if (cls === '.trc-ref-crumb-anc' && this.classList.contains('trc-ref-crumb-anc')) return this;
        return null;
      },
      parentElement: null,
      isConnected: true,
    };
    if (text != null) el.textContent = text;
    return el;
  };
  plugin._ensureElDataset = (el) => el.dataset || (el.dataset = {});
  plugin._wbLiveApplyFilter = function mockApply() {
    const guidFilter = this._wbLiveGuidFilter;
    for (const [lg, hdr] of this._wbHeaders) {
      const node = hdr.node;
      if (!node) continue;
      const hide = guidFilter && guidFilter.size ? !guidFilter.has(lg) : false;
      node.filtered = hide;
      if (hide) node.classList.add('refx-wb-filtered');
      else node.classList.remove('refx-wb-filtered');
    }
  };
  return { plugin };
}

function chainEntry(lineGuid, ownerGuid, chain) {
  return { lineGuid, ownerGuid, chain, complete: true };
}

function anc(guid) {
  return { guid, segments: [{ type: 'text', text: guid }], type: 'text' };
}

test('_wbCtxGroups finds deepest shared ancestor for two of three items', () => {
  const { plugin } = loadPlugin();
  const owner = 'REC_DAY';
  const shared = 'ANC_SHARED';
  const chains = [
    chainEntry('WB1', owner, [anc('LEAF_A'), anc(shared)]),
    chainEntry('WB2', owner, [anc('LEAF_B'), anc(shared)]),
    chainEntry('WB3', 'REC_OTHER', [anc('OTHER_ROOT')]),
  ];
  const groups = plugin._wbCtxGroups(chains);
  assert.equal(groups.size, 1);
  assert.deepEqual(groups.get(shared), ['WB1', 'WB2']);
  assert.ok(!groups.has(owner));
});

test('_wbCtxGroups excludes singletons and owner-only pairs fall back to owner', () => {
  const { plugin } = loadPlugin();
  const owner = 'REC_DAY';
  const onlyOwner = [
    chainEntry('WB1', owner, [anc('A1')]),
    chainEntry('WB2', owner, [anc('A2')]),
  ];
  const ownerGroups = plugin._wbCtxGroups(onlyOwner);
  assert.equal(ownerGroups.size, 1);
  assert.deepEqual(ownerGroups.get(owner), ['WB1', 'WB2']);

  const singleton = plugin._wbCtxGroups([chainEntry('WB9', owner, [anc('X')])]);
  assert.equal(singleton.size, 0);
});

test('_wbCtxGroups assigns item to deepest group only', () => {
  const { plugin } = loadPlugin();
  const owner = 'REC_DAY';
  const mid = 'ANC_MID';
  const chains = [
    chainEntry('WB1', owner, [anc('L1'), anc(mid)]),
    chainEntry('WB2', owner, [anc('L2'), anc(mid)]),
    chainEntry('WB3', owner, [anc('OTHER')]),
  ];
  const groups = plugin._wbCtxGroups(chains);
  assert.equal(groups.size, 1);
  assert.deepEqual(groups.get(mid), ['WB1', 'WB2']);
  const assigned = new Set();
  for (const members of groups.values()) members.forEach((m) => assigned.add(m));
  assert.equal(assigned.size, 2);
  assert.ok(!assigned.has('WB3'));
});

test('_wbCtxGroups ordering is deterministic', () => {
  const { plugin } = loadPlugin();
  const owner = 'REC_DAY';
  const shared = 'ANC_Z';
  const chains = [
    chainEntry('WB_B', owner, [anc(shared)]),
    chainEntry('WB_A', owner, [anc(shared)]),
  ];
  const g1 = plugin._wbCtxGroups(chains);
  const g2 = plugin._wbCtxGroups(chains.slice().reverse());
  assert.equal(plugin._wbCtxGroupsFingerprint(g1), plugin._wbCtxGroupsFingerprint(g2));
  assert.deepEqual(g1.get(shared), ['WB_A', 'WB_B']);
});

test('_wbLiveGuidFilter toggles refx-wb-filtered on shelf nodes', () => {
  const { plugin } = loadPlugin();
  const mkNode = () => ({
    filtered: false,
    classList: {
      _c: new Set(),
      add(x) { this._c.add(x); },
      remove(x) { this._c.delete(x); },
      contains(x) { return this._c.has(x); },
      toggle(x, on) { if (on) this.add(x); else this.remove(x); },
    },
  });
  plugin._wbHeaders.set('WB1', { node: mkNode() });
  plugin._wbHeaders.set('WB2', { node: mkNode() });
  plugin._wbHeaders.set('WB3', { node: mkNode() });
  plugin._wbLiveToggleGuidFilter(['WB1', 'WB2'], 'REC_DAY');
  assert.ok(plugin._wbLiveGuidFilter.has('WB1'));
  assert.ok(plugin._wbLiveGuidFilter.has('WB2'));
  assert.equal(plugin._wbHeaders.get('WB1').node.filtered, false);
  assert.equal(plugin._wbHeaders.get('WB2').node.filtered, false);
  assert.equal(plugin._wbHeaders.get('WB3').node.filtered, true);
  plugin._wbLiveToggleGuidFilter(['WB1', 'WB2'], 'REC_DAY');
  assert.equal(plugin._wbLiveGuidFilter, null);
  assert.equal(plugin._wbHeaders.get('WB3').node.filtered, false);
});

test('identical group fingerprint skips apply DOM writes', () => {
  const { plugin } = loadPlugin();
  const owner = 'REC_DAY';
  const shared = 'ANC_SHARED';
  const chains = [
    chainEntry('WB1', owner, [anc(shared)]),
    chainEntry('WB2', owner, [anc(shared)]),
  ];
  const groups = plugin._wbCtxGroups(chains);
  const fp = plugin._wbCtxGroupsFingerprint(groups);
  const crumbEl = plugin._el('span', 'trc-ref-popover-crumb');
  const recBtn = plugin._el('button', 'trc-ref-popover-crumb-rec');
  recBtn.dataset.guid = shared;
  crumbEl.append(recBtn);
  const ctx = plugin._el('div', 'refx-wb-ctx');
  ctx.append(crumbEl);
  const h = { ctx, ctxGroupsFp: fp };
  const annot = {
    shared: new Set([owner]),
    dimPrefix: false,
    pill: { guid: shared, n: 2, members: ['WB1', 'WB2'] },
  };
  assert.equal(plugin._wbLiveRenderContextApplyGroups(h, annot, fp), 0);
  const fp2 = plugin._wbCtxGroupsFingerprint(plugin._wbCtxGroups(chains));
  assert.equal(fp, fp2);
  h.ctxGroupsFp = null;
  const writes = plugin._wbLiveRenderContextApplyGroups(h, annot, fp);
  assert.ok(writes > 0);
  assert.equal(plugin._wbLiveRenderContextApplyGroups(h, annot, fp), 0);
});
