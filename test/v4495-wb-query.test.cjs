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
      toggle: (c) => {
        if (this._classes.has(c)) { this._classes.delete(c); return false; }
        this._classes.add(c);
        return true;
      },
      contains: (c) => this._classes.has(c),
    };
    this.children = [];
    this.childNodes = this.children;
    this._attrs = {};
    this._listeners = {};
    this.isConnected = true;
    this.parentNode = null;
    this.textContent = '';
  }
  get className() { return [...this._classes].join(' '); }
  set className(v) {
    this._classes = new Set(String(v || '').split(/\s+/).filter(Boolean));
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
    const parts = String(sel).split(',').map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const hit = this._querySelectorOne(part);
      if (hit) return hit;
    }
    return null;
  }
  _querySelectorOne(sel) {
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
    const parts = String(sel).split(',').map((s) => s.trim()).filter(Boolean);
    const seen = new Set();
    for (const part of parts) {
      const walk = (n) => {
        if (n.matches?.(part) && !seen.has(n)) { seen.add(n); out.push(n); }
        for (const c of n.children || []) walk(c);
      };
      walk(this);
    }
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
  plugin._recordRefxError = () => {};
  plugin.data = { getRecord: () => null, searchByQuery: async () => ({ lines: [], error: null }) };
  return { plugin, body, document: context.document, window: context.window };
}

test('_resolveCanonicalLineGuid remaps virtual q: rows', () => {
  const { plugin, window } = loadPlugin();
  window.g_universe.itemsByGuid.V1 = { is_virtual: true, props: { itemref: 'REAL1' } };
  assert.equal(plugin._resolveCanonicalLineGuid('V1'), 'REAL1');
  assert.equal(plugin._resolveCanonicalLineGuid('PLAIN'), 'PLAIN');
});

test('_openLineMenu uses canonical title for virtual rows', () => {
  const { plugin, body, window } = loadPlugin();
  window.g_universe.itemsByGuid.V1 = { is_virtual: true, props: { itemref: 'REAL1' } };
  window.g_universe.itemsByGuid.REAL1 = { text_segments: ['text', 'Watch S2'] };
  const line = new FakeEl('div');
  line.classList.add('listitem');
  line.setAttribute('data-guid', 'V1');
  plugin._renderPopupSections = () => {};
  plugin._openCardPopup = (pop) => { body.appendChild(pop); };
  plugin._nativeLineMenuContext = () => ({ actions: [] });
  plugin._availableMenuExtensions = () => [];
  plugin._isMac = true;
  plugin._openLineMenu('V1', line, { lineNode: line });
  const head = body.querySelector('.refx-refmenu-head');
  assert.ok(head, 'line menu renders');
  assert.equal(head.textContent, 'Watch S2 · line');
});

test('_wbAdd passes canonical guid to _wbAddLive', () => {
  const { plugin, window } = loadPlugin();
  window.g_universe.itemsByGuid.V1 = { is_virtual: true, props: { itemref: 'REAL1' } };
  let captured = null;
  plugin._wbAddLive = (guid) => { captured = guid; return Promise.resolve(); };
  plugin._wbAdd('V1');
  assert.equal(captured, 'REAL1');
});

test('_wbPreserveQueryHost stamps line query transclusions with host record guid', () => {
  const { plugin } = loadPlugin();
  plugin._wbBackingGuid = 'WB';
  plugin._wbItemRecordGuid = () => 'HOST1';
  plugin.data.getRecord = () => null;
  const node = new FakeEl('div');
  const container = new FakeEl('div');
  container.classList.add('transclusion-container-div');
  const embed = new FakeEl('div');
  embed.classList.add('pdc-embed-root');
  container.appendChild(embed);
  node.appendChild(container);
  plugin._wbPreserveQueryHost(node, { target: 'LINE1' });
  assert.ok(container.classList.contains('listview-items'));
  assert.equal(container.getAttribute('data-guid'), 'HOST1');
});

test('_wbPreserveQueryHost skips record targets', () => {
  const { plugin } = loadPlugin();
  plugin._wbBackingGuid = 'WB';
  plugin._wbItemRecordGuid = () => 'HOST1';
  plugin.data.getRecord = (g) => (g === 'REC1' ? { guid: 'REC1' } : null);
  const node = new FakeEl('div');
  const container = new FakeEl('div');
  container.classList.add('transclusion-container-div');
  const embed = new FakeEl('div');
  embed.classList.add('pdc-embed-root');
  container.appendChild(embed);
  node.appendChild(container);
  plugin._wbPreserveQueryHost(node, { target: 'REC1' });
  assert.ok(!container.classList.contains('listview-items'));
  assert.equal(container.getAttribute('data-guid'), null);
});

test('v4.49.5 source guards', () => {
  assert.match(source, /_resolveCanonicalLineGuid\(/);
  assert.match(source, /_wbPreserveQueryHost\(/);
  assert.match(source, /_wbTargetLabel\(/);
  assert.equal(manifest.version, '4.64.1');
  assert.ok(source.startsWith('// v4.64.1'));
  assert.ok(source.includes('window.__REFX_VERSION = "4.64.1"'));
});
