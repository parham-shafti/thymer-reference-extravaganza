'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'plugin.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));

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
      createElement: (tag) => {
        const el = {
          tagName: String(tag || 'div').toUpperCase(),
          style: {},
          classList: {
            _c: new Set(),
            add(...a) { a.forEach((x) => this._c.add(x)); },
            remove(...a) { a.forEach((x) => this._c.delete(x)); },
            toggle(x, on) { if (on) this.add(x); else this.remove(x); },
            contains(x) { return this._c.has(x); },
          },
          append(child) { this.children.push(child); child.parentElement = this; child.parentNode = this; },
          appendChild(child) { this.append(child); },
          replaceChildren(...kids) { this.children = kids.length ? [...kids] : []; },
          setAttribute() {},
          addEventListener() {},
          remove() { this.isConnected = false; this.parentNode = null; },
          removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); },
          insertBefore(child, ref) {
            const i = ref ? this.children.indexOf(ref) : this.children.length;
            this.children.splice(i < 0 ? this.children.length : i, 0, child);
            child.parentNode = this;
            child.parentElement = this;
          },
          hidden: false,
          children: [],
          isConnected: true,
          parentElement: null,
          parentNode: null,
          previousElementSibling: null,
          nextSibling: null,
          dataset: {},
          textContent: '',
        };
        return el;
      },
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { clientHeight: 900 },
      body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {} },
      head: { appendChild() {} },
    },
    Element: class {},
    window: {
      CSS: { escape: (s) => String(s) },
      g_universe: { itemsByGuid: {}, workspace: {} },
      addEventListener() {},
      removeEventListener() {},
    },
  };
  context.globalThis = context;
  vm.runInNewContext(source + '\nthis.PluginUnderTest = Plugin;', context, { filename: 'plugin.js' });
  const plugin = new context.PluginUnderTest();
  plugin._unloaded = false;
  plugin._wbHeaders = new Map();
  plugin._bridgeJump = () => {};
  plugin._refRowClipboardActions = () => [];
  plugin._navigatorContextText = (c) => (c?.segments || []).map((s) => s.text || '').join('');
  plugin._mediaLineInfo = () => null;
  plugin._cleanDisplayText = (segs) => (segs || []).map((s) => s.text || '').join('');
  plugin._renderRefLineText = (el, segs) => { el.textContent = plugin._cleanDisplayText(segs); };
  plugin._isTaskLikeLine = () => false;
  plugin._mkRefRowAction = (label) => ({ label });
  plugin._ensureElDataset = (el) => { if (!el.dataset) el.dataset = {}; return el; };
  plugin._el = (tag, cls, text) => {
    const el = context.document.createElement(tag);
    if (cls) cls.split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
    if (text != null) el.textContent = text;
    el.type = 'button';
    return el;
  };
  return { plugin, context };
}

function makeTree() {
  const leaf = { guid: 'LINE_LEAF', parent_guid: 'LINE_MID', segments: [{ type: 'text', text: 'leaf' }], children: [] };
  const mid = { guid: 'LINE_MID', parent_guid: 'LINE_ROOT', segments: [{ type: 'text', text: 'mid' }], children: [leaf] };
  const root = { guid: 'LINE_ROOT', parent_guid: null, segments: [{ type: 'text', text: 'root' }], children: [mid] };
  const sibling = { guid: 'LINE_SIB', parent_guid: 'LINE_ROOT', segments: [{ type: 'text', text: 'sibling' }], children: [] };
  root.children.push(sibling);
  const items = [root];
  return { items, root, mid, leaf, sibling };
}

test('_refZoomExpandPathGuids includes ancestors between crumb and target', () => {
  const { plugin } = loadPlugin();
  const { items, root, mid, leaf } = makeTree();
  const tree = plugin._refContextTree(items);
  const path = plugin._refZoomExpandPathGuids(tree, leaf.guid, root.guid);
  assert.ok(path.has(leaf.guid));
  assert.ok(path.has(mid.guid));
  assert.ok(path.has(root.guid));
  assert.equal(path.size, 3);
});

test('_wbMutationIgnored matches refx-wb-crumbpop', () => {
  const { plugin } = loadPlugin();
  const popNode = {
    nodeType: 1,
    matches: (sel) => sel.includes('refx-wb-crumbpop'),
    closest: () => null,
    classList: { contains: (c) => c === 'refx-wb-crumbpop' },
  };
  assert.equal(plugin._wbMutationIgnored(popNode), true);
});

test('v4.64.1 version locks', () => {
  assert.equal(manifest.version, '4.64.1');
  assert.ok(source.startsWith('// v4.64.1'));
  assert.ok(source.includes('window.__REFX_VERSION = "4.64.1"'));
});
