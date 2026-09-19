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
        child.isConnected = this.isConnected;
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
        child.isConnected = this.isConnected;
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
      getAttribute(name) { return this[name] ?? null; },
      dispatchEvent(ev) {
        ev.target = ev.target || this;
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
        const out = [];
        const walk = (node) => {
          for (const child of node.children || []) {
            if (matchSelector(child, selector) || matchMultiSelector(child, selector)) out.push(child);
            walk(child);
          }
        };
        walk(this);
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

function setupChipPlugin() {
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
  plugin._isPureSelfRef = () => false;
  plugin._hydrateColdRefLineText = () => {};
  plugin._relativeTime = (d) => d ? { rel: '2d', absShort: 'Sep 7', abs: 'Sep 7, 2026' } : null;
  plugin._lineCreatedAt = (line) => line?.createdAt || null;
  plugin.getOrLoadRecordName = (g) => (g === 'PAGE' ? 'page' : g);
  plugin._recordNameIndex = new Map([['PAGE', 'page']]);
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
  plugin._queryRefLines = async () => ([
    { guid: 'NEST1', record: { guid: 'PAGE' }, segments: [{ type: 'text', text: 'nested ref' }] },
  ]);
  plugin.data = { getRecord: () => null };
  plugin._refChipCounts = true;
  return { plugin, makeEl, context };
}

function buildChipFixture(makeEl, plugin, { chipGuid = 'CHIP_LINE', inCrumb = false } = {}) {
  const surface = makeEl('div');
  surface.className = 'trc-ref-popover';
  plugin._wireRefSurfaceChipNav(surface);

  const row = makeEl('div');
  row.className = 'trc-ref-popover-item';
  const ctx = { alive: () => true, treeCache: new Map(), onJump() {}, canEdit: false, targetGuid: 'REF' };
  row.__refxCtx = ctx;

  const crumb = makeEl('div');
  crumb.className = 'trc-ref-popover-crumb';
  const full = makeEl('div');
  full.className = 'trc-ref-popover-fulltext';

  const chip = makeEl('span');
  chip.className = 'tlr-seg-ref';
  chip.dataset.refGuid = chipGuid;
  chip.setAttribute('data-ref-guid', chipGuid);

  if (inCrumb) crumb.appendChild(chip);
  else full.appendChild(chip);

  row.append(crumb, full);
  surface.appendChild(row);
  return { surface, row, crumb, full, chip, ctx };
}

test('WO-6 content chip plain click zooms line target with owner', () => {
  const { plugin, makeEl } = setupChipPlugin();
  const zooms = [];
  plugin._zoomRefRow = (row, ctx, view) => { zooms.push({ row, view }); return Promise.resolve(); };
  plugin._resolveLineOwnerGuid = () => 'PAGE';

  const { surface, chip } = buildChipFixture(makeEl, plugin, { chipGuid: 'CHIP_LINE' });
  chip.dispatchEvent({ type: 'mousedown', button: 0, preventDefault() {}, stopPropagation() {}, target: chip });
  chip.dispatchEvent({ type: 'click', button: 0, preventDefault() {}, stopPropagation() {}, target: chip, shiftKey: false, metaKey: false, ctrlKey: false });

  assert.equal(zooms.length, 1);
  assert.equal(zooms[0].view.sourceGuid, 'PAGE');
  assert.equal(zooms[0].view.rootGuid, 'CHIP_LINE');
});

test('WO-6 content chip plain click zooms record target', () => {
  const { plugin, makeEl } = setupChipPlugin();
  const zooms = [];
  plugin._zoomRefRow = (row, ctx, view) => { zooms.push({ row, view }); return Promise.resolve(); };

  const { chip } = buildChipFixture(makeEl, plugin, { chipGuid: 'REC1' });
  chip.dispatchEvent({ type: 'click', button: 0, preventDefault() {}, stopPropagation() {}, target: chip, shiftKey: false, metaKey: false, ctrlKey: false });

  assert.equal(zooms.length, 1);
  assert.equal(zooms[0].view.sourceGuid, 'REC1');
  assert.equal(zooms[0].view.rootGuid, null);
});

test('WO-6 content chip modifier keys bridge-jump; mousedown prevented', () => {
  const { plugin, makeEl } = setupChipPlugin();
  const bridge = [];
  plugin._bridgeJump = (g, opts) => { bridge.push({ g, opts }); return Promise.resolve(true); };
  plugin._zoomRefRow = () => Promise.resolve();

  const { chip } = buildChipFixture(makeEl, plugin, { chipGuid: 'CHIP_LINE' });
  let prevented = false;
  const md = { type: 'mousedown', button: 0, preventDefault() { prevented = true; }, stopPropagation() {}, target: chip };
  chip.dispatchEvent(md);
  assert.equal(prevented, true);

  chip.dispatchEvent({ type: 'click', button: 0, preventDefault() {}, stopPropagation() {}, target: chip, shiftKey: true, metaKey: false, ctrlKey: false });
  assert.equal(bridge.at(-1).g, 'CHIP_LINE');
  assert.equal(bridge.at(-1).opts.newPanel, true);

  chip.dispatchEvent({ type: 'click', button: 0, preventDefault() {}, stopPropagation() {}, target: chip, shiftKey: false, metaKey: true, ctrlKey: false });
  assert.equal(bridge.at(-1).g, 'CHIP_LINE');
  assert.equal(bridge.at(-1).opts.newPanel, undefined);
});

test('WO-6 crumb chip is ignored by content chip handler', () => {
  const { plugin, makeEl } = setupChipPlugin();
  const zooms = [];
  plugin._zoomRefRow = () => { zooms.push(1); return Promise.resolve(); };

  const { chip } = buildChipFixture(makeEl, plugin, { chipGuid: 'CHIP_LINE', inCrumb: true });
  chip.dispatchEvent({ type: 'click', button: 0, preventDefault() {}, stopPropagation() {}, target: chip, shiftKey: false, metaKey: false, ctrlKey: false });
  assert.equal(zooms.length, 0);
});

function revealed(root) {
  return [...root.querySelectorAll('.refx-nested-count')].filter((e) => e.getAttribute('data-count'));
}

test('WO-6 nested count reveals only when count > 0 and not for guids on the nest path', async () => {
  const { plugin, makeEl } = setupChipPlugin();
  const { row, full, chip } = buildChipFixture(makeEl, plugin, { chipGuid: 'ZERO' });
  plugin._countCache.set('ZERO', { count: 0 });
  plugin._countCache.set('THREE', { count: 3 });
  const chip3 = makeEl('span');
  chip3.className = 'tlr-seg-ref';
  chip3.dataset.refGuid = 'THREE';
  chip3.setAttribute('data-ref-guid', 'THREE');
  full.appendChild(chip3);

  plugin._paintRefRowNestedCounts(row, row.__refxCtx);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(revealed(row).length, 1);
  assert.equal(revealed(row)[0].getAttribute('data-count'), '3');

  row.__refxCtx.nestPath = Object.freeze(['REF', 'THREE']);
  plugin._paintRefRowNestedCounts(row, row.__refxCtx);
  assert.equal(revealed(row).length, 0);
});

test('WO-6 nested count click toggles nested refs with nest depth 1', async () => {
  const { plugin, makeEl } = setupChipPlugin();
  const { row, full, chip, ctx } = buildChipFixture(makeEl, plugin, { chipGuid: 'TGT' });
  plugin._countCache.set('TGT', { count: 2 });
  plugin._paintRefRowNestedCounts(row, ctx);
  await new Promise((r) => setTimeout(r, 5));
  const count = row.querySelector('.refx-nested-count');
  assert.ok(count);

  await plugin._toggleRefNestedRefs(count, 'TGT', row, ctx);

  const box = full.__refxNestedRefsEl;
  assert.ok(box, 'nested box is tracked on the line element');
  assert.ok(box?.classList?.contains('refx-nested-refs'));
  const nestedRows = box.querySelectorAll('.trc-ref-popover-item');
  assert.ok(nestedRows.length > 0);
  assert.equal(nestedRows[0].__refxNestDepth, 1);

  const freshCount = row.querySelector('.refx-nested-count');
  assert.ok(freshCount);
  await plugin._toggleRefNestedRefs(freshCount, 'TGT', row, ctx);
  assert.ok(box.classList.contains('refx-hidden'), 'second toggle hides nested refs');
});

test('WO-8 tree node with ref segment renders chip inside .refx-wb-tree-text', () => {
  const { plugin, makeEl, context } = setupChipPlugin();
  context.window.__thymerBackrefs = {
    renderSegments: () => {
      const chip = makeEl('span');
      chip.className = 'lineitem-ref';
      chip.dataset.guid = 'CHIP_TARGET';
      chip.setAttribute('data-guid', 'CHIP_TARGET');
      return chip;
    },
  };

  const target = {
    guid: 'ROOT',
    children: [{
      guid: 'L1',
      segments: [{ type: 'ref', text: 'CHIP_TARGET' }],
      children: [],
    }],
  };
  const ctx = { alive: () => true, onJump() {}, canEdit: false };
  const box = plugin._buildRefChildTree(target, ctx);
  const treeText = box.querySelector('.refx-wb-tree-text');
  assert.ok(treeText);
  assert.ok(treeText.querySelector('.lineitem-ref[data-guid="CHIP_TARGET"]'));
});

test('WO-8 tree chip click zooms via delegated handler', () => {
  const { plugin, makeEl, context } = setupChipPlugin();
  const zooms = [];
  plugin._zoomRefRow = (row, rowCtx, view) => { zooms.push({ row, view }); return Promise.resolve(); };
  plugin._resolveLineOwnerGuid = () => 'PAGE';
  context.window.__thymerBackrefs = {
    renderSegments: () => {
      const chip = makeEl('span');
      chip.className = 'lineitem-ref';
      chip.dataset.guid = 'CHIP_LINE';
      chip.setAttribute('data-guid', 'CHIP_LINE');
      return chip;
    },
  };

  const surface = makeEl('div');
  surface.className = 'trc-ref-popover';
  plugin._wireRefSurfaceChipNav(surface);
  const row = makeEl('div');
  row.className = 'trc-ref-popover-item';
  const ctx = { alive: () => true, treeCache: new Map(), onJump() {}, canEdit: false };
  row.__refxCtx = ctx;
  const treeText = makeEl('span');
  treeText.className = 'refx-wb-tree-text';
  const chip = makeEl('span');
  chip.className = 'lineitem-ref';
  chip.dataset.guid = 'CHIP_LINE';
  chip.setAttribute('data-guid', 'CHIP_LINE');
  treeText.appendChild(chip);
  row.appendChild(treeText);
  surface.appendChild(row);

  chip.dispatchEvent({ type: 'click', button: 0, preventDefault() {}, stopPropagation() {}, target: chip, shiftKey: false, metaKey: false, ctrlKey: false });
  assert.equal(zooms.length, 1);
  assert.equal(zooms[0].view.sourceGuid, 'PAGE');
  assert.equal(zooms[0].view.rootGuid, 'CHIP_LINE');
});

test('WO-6 later zoom invalidates stale async nested count paint', async () => {
  const { plugin, makeEl } = setupChipPlugin();
  const { row, full, chip, ctx } = buildChipFixture(makeEl, plugin, { chipGuid: 'ASYNC' });
  plugin._countCache.delete('ASYNC');
  let resolveLate;
  plugin.getCountInfoForGuid = () => new Promise((r) => { resolveLate = () => r({ count: 5, capped: false, sdkPropCount: 0 }); });

  plugin._paintRefRowNestedCounts(row, ctx);
  row.__refxNestedCountGen = (row.__refxNestedCountGen || 0) + 1;
  resolveLate();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(revealed(row).length, 0);
});
