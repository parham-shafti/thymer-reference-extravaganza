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
    CSS: { escape: (s) => String(s) },
    navigator: { platform: 'MacIntel', clipboard: {} },
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    document: {
      createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, append() {}, setAttribute() {}, appendChild() {} }),
      createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { clientHeight: 900 },
      body: { classList: { add() {}, remove() {}, contains: () => false } },
      head: { appendChild() {} },
    },
    Element: class {},
    Node: class Node { static get ELEMENT_NODE() { return 1; } static get TEXT_NODE() { return 3; } },
    window: { CSS: { escape: (s) => String(s) }, g_universe: { itemsByGuid: {}, workspace: {} } },
  };
  context.document.createTextNode = (t) => {
    const node = { nodeType: 3, textContent: String(t), nodeName: '#text' };
    Object.setPrototypeOf(node, context.Node.prototype);
    return node;
  };
  context.globalThis = context;
  vm.runInNewContext(source + '\nthis.PluginUnderTest = Plugin;', context, { filename: 'plugin.js' });
  const plugin = new context.PluginUnderTest();
  plugin._unloaded = false;
  plugin._lineConnectionsEnabled = true;
  plugin._lineRefProps = ['Source Line'];
  plugin._autoLineRefs = true;
  plugin._referenceTargetKind = (g) => (g === 'REC1' ? 'record' : 'line');
  plugin.isExistingRecordGuid = (g) => g === 'REC1';
  plugin.data = { getRecord: () => null, getActiveUsers: () => [] };
  return { plugin, storage, context };
}

function installFakeDom(context) {
  context.Node = class Node {
    static get ELEMENT_NODE() { return 1; }
    static get TEXT_NODE() { return 3; }
  };
  context.document.createTextNode = (t) => {
    const node = { nodeType: 3, textContent: String(t), nodeName: '#text' };
    Object.setPrototypeOf(node, context.Node.prototype);
    return node;
  };

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

  const makeEl = (tag) => {
    const listeners = {};
    const classes = new Set();
    const el = {
      tagName: String(tag).toUpperCase(),
      nodeType: 1,
      nodeName: String(tag).toUpperCase(),
      title: '', children: [], isConnected: true,
      style: {}, dataset: {}, disabled: false, _listeners: listeners,
      parentElement: null,
      previousElementSibling: null,
      nextElementSibling: null,
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
        child.isConnected = this.isConnected;
        const prev = this.children[this.children.length - 1];
        if (prev) prev.nextElementSibling = child;
        child.previousElementSibling = prev || null;
        this.children.push(child);
        return child;
      },
      append(...children) { for (const child of children) this.appendChild(child); },
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
      setAttribute(name, value) {
        this[name] = String(value);
        if (name === 'data-guid') this.dataset.guid = String(value);
      },
      getAttribute(name) { return this[name] ?? null; },
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
        const roots = scoped ? (this.children || []) : [this];
        const walk = (node) => {
          for (const child of node.children || []) {
            if (selector.includes('.bridge-marker') && child.classList?.contains('bridge-marker')) return child;
            const attr = rest.match(/^\[data-guid="([^"]+)"\]/);
            if (attr && child.dataset?.guid === attr[1]) return child;
            if (matchSelector(child, rest.split('[')[0]) || matchSelector(child, rest)) return child;
            const hit = walk(child);
            if (hit) return hit;
          }
          return null;
        };
        if (scoped) {
          for (const child of this.children || []) {
            if (matchSelector(child, rest.split('[')[0]) || matchSelector(child, rest)) return child;
          }
          return null;
        }
        for (const root of roots) {
          const hit = walk(root);
          if (hit) return hit;
        }
        return null;
      },
      querySelectorAll(selector) {
        const out = [];
        const scoped = selector.startsWith(':scope > ');
        const rest = scoped ? selector.slice(9) : selector;
        const walk = (node, directOnly) => {
          for (const child of node.children || []) {
            if (matchSelector(child, rest) || matchMultiSelector(child, rest)) out.push(child);
            if (!directOnly) walk(child, false);
          }
        };
        if (scoped) walk(this, true);
        else walk(this, false);
        return out;
      },
      remove() {
        if (this.parentElement) {
          this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
        }
        this.parentElement = null;
        this.isConnected = false;
      },
    };
    Object.defineProperty(el, 'className', {
      get: () => [...classes].join(' '),
      set: (value) => {
        classes.clear();
        String(value || '').split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
      },
    });
    Object.defineProperty(el, 'textContent', {
      get: () => el.children.map((c) => c.textContent || '').join(''),
      set: (value) => {
        el.children.length = 0;
        if (value != null && value !== '') el.appendChild(context.document.createTextNode(String(value)));
      },
    });
    Object.setPrototypeOf(el, context.Node.prototype);
    return el;
  };

  context.document.createElement = makeEl;
  return makeEl;
}

function setupRendererPlugin() {
  const { plugin, context } = loadPlugin();
  const makeEl = installFakeDom(context);
  delete context.window.__thymerBackrefs;
  plugin._el = (tag, cls, text) => {
    const el = makeEl(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };
  plugin._mediaLineInfo = () => null;
  plugin._isTaskLikeLine = () => false;
  plugin._renderPreviewLineItem = (el, line) => { el.textContent = (line.segments || []).map((s) => s.text || '').join(''); };
  plugin._mkRefRowAction = (label, title, fn) => {
    const btn = makeEl('button');
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
    return btn;
  };
  plugin._refRowClipboardActions = () => [];
  plugin._resolveLineOwnerGuid = () => 'PAGE';
  plugin._isLineRefTarget = (g) => g !== 'REC1';
  plugin._resolveRefTargetText = (g) => (g === 'AAAAAA' ? '' : 'resolved');
  plugin.getOrLoadRecordName = (g) => (g === 'REC1' ? 'Record One' : '');
  plugin._countCache = new Map();
  plugin.getCachedCountInfo = (g) => {
    const e = plugin._countCache.get(g);
    return e && typeof e.count === 'number' ? e : null;
  };
  plugin.getCountInfoForGuid = (g) => Promise.resolve(plugin.getCachedCountInfo(g) || { count: 0, capped: false, sdkPropCount: 0 });
  plugin._refChipCounts = true;
  return { plugin, makeEl, context };
}

test('WO-9 own renderer paints ref, hashtag, datetime without bridge', () => {
  const { plugin, makeEl } = setupRendererPlugin();
  const el = makeEl('div');
  const segments = [
    { type: 'text', text: 'Watch ' },
    { type: 'ref', text: { guid: 'AAAAAA', title: 'Iron Man' } },
    { type: 'text', text: ' ' },
    { type: 'hashtag', text: '#mcu' },
    { type: 'datetime', text: { d: '20260101', formatted: 'Jan 1' } },
  ];
  plugin._renderRefLineText(el, segments);

  const refChip = el.querySelector('.lineitem-ref[data-guid="AAAAAA"]');
  assert.ok(refChip, 'ref chip exists');
  assert.equal(refChip.textContent, 'Iron Man');
  assert.ok(refChip.classList.contains('refx-own-chip'));
  assert.ok(el.querySelector('.lineitem-hashtag'));
  assert.ok(el.querySelector('.lineitem-datetime'));
  assert.equal(el.children.some((c) => c.nodeType === 1 && c.tagName === 'SPAN'), true, 'built element nodes, not HTML strings');
});

test('WO-9 invalid ref guid renders as text without data-guid', () => {
  const { plugin, makeEl } = setupRendererPlugin();
  const el = makeEl('div');
  plugin._renderRefLineText(el, [{ type: 'ref', text: { guid: 'bad!', title: 'Nope' } }]);
  assert.equal(el.querySelector('.lineitem-ref'), null);
  assert.ok(String(el.textContent || '').length > 0);
});

test('WO-9 bridge renderSegments is preferred when present', () => {
  const { plugin, makeEl, context } = setupRendererPlugin();
  const marker = makeEl('span');
  marker.className = 'bridge-marker';
  context.window.__thymerBackrefs = {
    renderSegments: () => marker,
  };
  const el = makeEl('div');
  plugin._renderRefLineText(el, [{ type: 'ref', text: { guid: 'AAAAAA', title: 'Iron Man' } }]);
  assert.ok(el.querySelector('.bridge-marker'));
  assert.equal(el.querySelector('.refx-own-chip'), null);
});

test('WO-9 tree node text contains own ref chip without bridge', () => {
  const { plugin, makeEl } = setupRendererPlugin();
  const target = {
    guid: 'ROOT',
    children: [{
      guid: 'L1',
      segments: [{ type: 'ref', text: { guid: 'AAAAAA', title: 'Iron Man' } }],
      children: [],
    }],
  };
  const ctx = { alive: () => true, onJump() {}, canEdit: false };
  const box = plugin._buildRefChildTree(target, ctx);
  const treeText = box.querySelector('.refx-wb-tree-text');
  assert.ok(treeText);
  assert.ok(treeText.querySelector('.lineitem-ref[data-guid="AAAAAA"]'));
});

test('WO-9 WO-6 selector and nested counts find own chips', async () => {
  const { plugin, makeEl } = setupRendererPlugin();
  const surface = makeEl('div');
  surface.className = 'trc-ref-popover';
  const row = makeEl('div');
  row.className = 'trc-ref-popover-item';
  const ctx = { alive: () => true, treeCache: new Map(), onJump() {}, canEdit: false };
  row.__refxCtx = ctx;
  const full = makeEl('div');
  full.className = 'trc-ref-popover-fulltext';
  row.append(full);
  surface.appendChild(row);

  plugin._renderRefLineText(full, [{ type: 'ref', text: { guid: 'AAAAAA', title: 'Iron Man' } }]);
  const chip = full.querySelector('.lineitem-ref[data-guid="AAAAAA"]');
  assert.ok(chip);
  assert.ok(chip.closest(plugin._refContentChipSelector().split(',')[0].trim()) || chip.matches?.('.lineitem-ref'));

  plugin._countCache.set('AAAAAA', { count: 4 });
  plugin._paintRefRowNestedCounts(row, ctx);
  await new Promise((r) => setTimeout(r, 5));
  const count = row.querySelector('.refx-nested-count');
  assert.ok(count, 'nested count appended');
  assert.equal(count.getAttribute('data-count'), '4');
});

test('WO-9 version locks', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.version, '4.64.1');
  assert.ok(source.startsWith('// v4.64.1'));
  assert.ok(source.includes('window.__REFX_VERSION = "4.64.1"'));
});
