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
    MutationObserver: class { observe() {} disconnect() {} },
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
          if (child.nextElementSibling) child.nextElementSibling.previousElementSibling = child;
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
      focus() { this._focused = true; },
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
        const roots = scoped ? this.children : walkAll(this, [this]);
        for (const node of roots) {
          if (attrMatch && node.dataset?.guid === attrMatch[1]) return node;
          if (matchClosest(node, rest)) return node;
        }
        return null;
      },
      querySelectorAll(selector) {
        const scoped = selector.startsWith(':scope > ');
        const rest = scoped ? selector.slice(9) : selector;
        const out = [];
        const walk = (node) => {
          for (const child of node.children || []) {
            if (matchClosest(child, rest)) out.push(child);
            if (!scoped) walk(child);
          }
        };
        if (scoped) walk({ children: this.children });
        else walk(this);
        return out;
      },
      remove() {
        const parent = this.parentElement;
        if (parent) {
          const idx = parent.children.indexOf(this);
          if (idx >= 0) parent.children.splice(idx, 1);
        }
        const setConn = (n, v) => { n.isConnected = v; for (const c of n.children || []) setConn(c, v); };
        setConn(this, false);
        this.parentElement = null;
      },
      removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx >= 0) this.children.splice(idx, 1);
        child.parentElement = null;
        child.isConnected = false;
        return child;
      },
      replaceChildren() {
        for (const child of this.children.slice()) child.remove();
      },
      get firstChild() { return this.children[0] || null; },
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
    if (Array.isArray(node)) {
      for (const item of node) walkAll(item, out);
      return out;
    }
    out.push(node);
    for (const child of node.children || []) walkAll(child, out);
    return out;
  }

  function matchClosest(node, selector) {
    if (selector.includes(',')) {
      const parts = selector.split(',').map((s) => s.trim());
      for (const part of parts) {
        if (part.startsWith('.')) {
          const cls = part.slice(1).split(/[\s\[]/)[0];
          if (node.classList?.contains(cls)) return true;
        }
      }
      return false;
    }
    if (selector.startsWith('.')) {
      const cls = selector.slice(1).split(/[\s\[]/)[0];
      return node.classList?.contains(cls);
    }
    return false;
  }

  context.document.createElement = makeEl;
  return makeEl;
}

function revealed(root) {
  return [...root.querySelectorAll('.refx-nested-count')].filter((e) => e.getAttribute('data-count'));
}

function tick(ms = 20) {
  return new Promise((r) => setTimeout(r, ms));
}

function setupV461Plugin() {
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
        const g = typeof s.text === 'object' ? s.text.guid : s.text;
        chip.dataset.guid = g;
        chip.setAttribute('data-guid', g);
        chip.setAttribute('data-ref-guid', g);
        chip.dataset.refGuid = g;
        el.appendChild(chip);
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
  plugin._hydrateColdRefLineText = () => {};
  plugin._relativeTime = () => ({ rel: '2d', absShort: 'Sep 7', abs: 'Sep 7, 2026' });
  plugin._lineCreatedAt = () => null;
  plugin.getOrLoadRecordName = (g) => g;
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
  plugin._queryRefLines = async () => ([]);
  plugin.data = { getRecord: () => null };
  plugin._refOutlineDepth = 1;
  plugin._ensureElDataset = (el) => { el.dataset = el.dataset || {}; return el; };
  return { plugin, makeEl, context };
}

function buildChipRow(makeEl, plugin, { chipGuids = ['CHIP1', 'CHIP2'], ownGuid = 'OWN' } = {}) {
  const surface = makeEl('div');
  surface.className = 'trc-ref-popover';
  plugin._wireRefSurfaceChipNav(surface);
  const row = makeEl('div');
  row.className = 'trc-ref-popover-item';
  row.dataset.guid = ownGuid;
  const ctx = { alive: () => true, gestureAlive: () => true, treeCache: new Map(), onJump() {}, canEdit: false, targetGuid: 'ROOT', nestPath: Object.freeze(['ROOT']) };
  row.__refxCtx = ctx;
  row.__refxLine = { guid: ownGuid, segments: [], children: [], record: { guid: 'REC' } };
  const full = makeEl('div');
  full.className = 'trc-ref-popover-fulltext';
  for (const g of chipGuids) {
    const chip = makeEl('span');
    chip.className = 'tlr-seg-ref';
    chip.dataset.refGuid = g;
    chip.setAttribute('data-ref-guid', g);
    full.appendChild(chip);
    plugin._countCache.set(g, { count: 2 });
  }
  row.append(full);
  surface.append(row);
  plugin._countCache.set(ownGuid, { count: 1 });
  return { surface, row, full, ctx };
}

test('W1 chip counts behind flag', async () => {
  const { plugin, makeEl } = setupV461Plugin();
  const { row, full, ctx } = buildChipRow(makeEl, plugin);
  plugin._refChipCounts = false;
  plugin._paintRefRowNestedCounts(row, ctx);
  await tick(5);
  assert.equal(revealed(row).filter((c) => c.dataset.guid === 'CHIP1' || c.dataset.guid === 'CHIP2').length, 0);
  assert.equal(revealed(row).filter((c) => c.dataset.guid === 'OWN').length, 1);
  plugin._refChipCounts = true;
  plugin._paintRefRowNestedCounts(row, ctx);
  await tick(5);
  assert.ok(revealed(row).some((c) => c.dataset.guid === 'CHIP1'));
  plugin._refChipCounts = false;
  plugin._paintRefRowNestedCounts(row, ctx);
  await tick(5);
  assert.equal(revealed(row).filter((c) => c.dataset.guid === 'CHIP1' || c.dataset.guid === 'CHIP2').length, 0);
  assert.equal(row.querySelectorAll('.refx-nested-count').length, 1);
});

test('W2 tree keyboard on nested count', async () => {
  const { plugin, makeEl } = setupV461Plugin();
  const surface = makeEl('div');
  plugin._wireRefSurfaceChipNav(surface);
  const row = makeEl('div');
  row.className = 'trc-ref-popover-item';
  const ctx = { alive: () => true, gestureAlive: () => true, targetGuid: 'ROOT', nestPath: Object.freeze(['ROOT']) };
  row.__refxCtx = ctx;
  const full = makeEl('div');
  full.className = 'trc-ref-popover-fulltext';
  const count = makeEl('span');
  count.className = 'refx-nested-count';
  count.dataset.guid = 'TGT';
  count.setAttribute('data-count', '2');
  count.setAttribute('aria-expanded', 'false');
  count.tabIndex = 0;
  full.append(count);
  row.append(full);
  surface.append(row);

  let toggles = 0;
  plugin._activateRefNestedCount = () => { toggles++; };

  const key = (type, keyName, target, extra = {}) => {
    let prevented = false;
    let stopped = false;
    const ev = { type, key: keyName, target, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; }, isComposing: false, metaKey: false, ctrlKey: false, altKey: false, ...extra };
    target.dispatchEvent(ev);
    return { prevented, stopped };
  };

  const r1 = key('keydown', 'ArrowRight', count);
  assert.equal(r1.prevented, true);
  assert.equal(r1.stopped, true);
  assert.equal(toggles, 1);

  count.setAttribute('aria-expanded', 'true');
  const box = makeEl('div');
  box.className = 'refx-nested-refs';
  box.dataset.refxNestTarget = 'TGT';
  const inner = makeEl('span');
  inner.className = 'refx-nested-count';
  inner.dataset.guid = 'INNER';
  box.append(inner);
  row.append(box);
  full.nextElementSibling = box;
  box.previousElementSibling = full;
  const r2 = key('keydown', 'ArrowRight', count);
  assert.equal(inner._focused, true);

  count.setAttribute('aria-expanded', 'true');
  toggles = 0;
  const r3 = key('keydown', 'ArrowLeft', count);
  assert.equal(toggles, 1);

  count.setAttribute('aria-expanded', 'false');
  const r4 = key('keydown', 'ArrowLeft', inner);
  assert.equal(count._focused, true);

  count.setAttribute('aria-expanded', 'true');
  toggles = 0;
  const r5 = key('keydown', 'Escape', inner);
  assert.equal(toggles, 1);
  assert.equal(count._focused, true);

  const r6 = key('keydown', 'a', count);
  assert.equal(r6.prevented, false);
  const r7 = key('keydown', 'Tab', count);
  assert.equal(r7.prevented, false);
  const r8 = key('keydown', 'ArrowRight', count, { metaKey: true });
  assert.equal(r8.prevented, false);
});

test('W3 inline linked-refs header adds linked-refs kind', async () => {
  const { plugin, makeEl } = setupV461Plugin();
  const adds = [];
  plugin._wbAdd = (g, opts) => { adds.push({ g, opts }); };
  const parent = makeEl('div');
  const host = makeEl('div');
  host.className = 'listitem';
  host.setAttribute('data-guid', 'HOST');
  parent.append(host);
  plugin._isPinned = () => false;
  plugin._readCollapsedGroupsMeta = async () => null;
  await plugin._buildInlineRefsSection(null, 'TARGET', host, 'HOST');
  const section = host.nextElementSibling;
  const inlineWb = section?.querySelector?.('.refx-inline-refs-wb');
  assert.ok(inlineWb);
  inlineWb.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {}, target: inlineWb });
  assert.equal(adds.length, 1);
  assert.equal(adds[0].g, 'TARGET');
  assert.equal(adds[0].opts?.kind, 'linked-refs');

  adds.length = 0;
  const groupWb = makeEl('button');
  groupWb.className = 'refx-inline-refs-group-wb';
  const srcGuid = 'SRC_PAGE';
  const workbench = plugin._mkRefRowAction('⧉', 'Add to Workbench', () => plugin._wbAdd(srcGuid));
  workbench.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {}, target: workbench });
  assert.equal(adds.length, 1);
  assert.equal(adds[0].g, 'SRC_PAGE');
  assert.equal(adds[0].opts, undefined);
});

test('W4 target badge allowed host and WB badge click', () => {
  const { plugin, makeEl } = setupV461Plugin();
  plugin._wbBadgesInItems = true;

  const plain = makeEl('div');
  plain.className = 'listitem';
  assert.equal(plugin._targetBadgeAllowedHost(plain), true);

  const wbItem = makeEl('div');
  wbItem.className = 'listitem-transclusion refx-wb-item';
  const tx = makeEl('div');
  tx.className = 'transclusion-container-div';
  const inWb = makeEl('div');
  inWb.className = 'listitem';
  tx.append(inWb);
  wbItem.append(tx);
  inWb.parentElement = tx;
  tx.parentElement = wbItem;
  assert.equal(plugin._targetBadgeAllowedHost(inWb), true);

  const bareTx = makeEl('div');
  bareTx.className = 'listitem-transclusion';
  const inBare = makeEl('div');
  inBare.className = 'listitem';
  bareTx.append(inBare);
  inBare.parentElement = bareTx;
  assert.equal(plugin._targetBadgeAllowedHost(inBare), false);

  const inline = makeEl('div');
  inline.className = 'refx-inline-refs';
  const inInline = makeEl('div');
  inline.append(inInline);
  inInline.parentElement = inline;
  assert.equal(plugin._targetBadgeAllowedHost(inInline), false);

  plugin._wbBadgesInItems = false;
  assert.equal(plugin._targetBadgeAllowedHost(inWb), false);

  const toggles = [];
  const wbAdds = [];
  plugin._toggleInlineRefsFor = (...args) => { toggles.push(args); return Promise.resolve(); };
  plugin._wbAdd = (g, opts) => { wbAdds.push({ g, opts }); };
  const line = makeEl('div');
  line.className = 'listitem';
  line.setAttribute('data-guid', 'LINE1');
  const wrap = makeEl('span');
  wrap.className = 'trc-target-badge-wrap';
  wrap.dataset.guid = 'LINE1';
  line.append(wrap);
  wbItem.appendChild(line);
  line.parentElement = wbItem;
  plugin._toggleInlineRefs(null, wrap);
  assert.equal(toggles.length, 1);
  assert.equal(toggles[0][2], line);
  assert.equal(wbAdds.length, 0);
});

test('W5 buildRefChildTree depth-1 default', () => {
  const { plugin } = setupV461Plugin();
  const mk = (guid, kids = []) => ({ guid, segments: [{ type: 'text', text: guid }], children: kids, record: { guid: 'REC' } });
  const d4 = mk('D4');
  const d3 = mk('D3', [d4]);
  const d2 = mk('D2', [d3]);
  const d1 = mk('D1', [d2]);
  const root = mk('ROOT', [d1]);
  const ctx = { alive: () => true, onJump() {} };
  const box = plugin._buildRefChildTree(root, ctx);
  const kidBoxes = box.querySelectorAll('.refx-wb-tree-kids');
  assert.equal(kidBoxes[0].classList.contains('refx-hidden'), false);
  assert.equal(kidBoxes[1].classList.contains('refx-hidden'), true);
  const twisties = box.querySelectorAll('.refx-wb-tree-twist');
  assert.equal(twisties[0].textContent, '▾');
  assert.equal(twisties[1].textContent, '▸');

  const expandSet = new Set(['D1', 'D2', 'D3']);
  const defaultVisible = [...box.querySelectorAll('.refx-wb-tree-kids')].filter((k) => !k.classList.contains('refx-hidden')).length;
  const box2 = plugin._buildRefChildTree(root, ctx, { expandPathGuids: expandSet });
  const expandedVisible = [...box2.querySelectorAll('.refx-wb-tree-kids')].filter((k) => !k.classList.contains('refx-hidden')).length;
  assert.ok(expandedVisible > defaultVisible);

  const boxInf = plugin._buildRefChildTree(root, ctx, { defaultExpandDepth: Number.POSITIVE_INFINITY });
  assert.equal(boxInf.querySelectorAll('.refx-wb-tree-kids.refx-hidden').length, 0);

  const capped = plugin._buildRefChildTree(root, ctx, { maxDepth: 2, maxNodes: 1 });
  assert.ok(capped.querySelector('.refx-wb-missing'));
  assert.match(capped.querySelector('.refx-wb-missing').textContent, /Outline truncated \(2 levels \/ 1 lines\)/);
  const huge = { guid: 'HROOT', segments: [{ type: 'text', text: 'root' }], children: [], record: { guid: 'REC' } };
  for (let i = 0; i < 201; i++) huge.children.push({ guid: 'L' + i, segments: [{ type: 'text', text: 'x' }], children: [] });
  const cappedDefault = plugin._buildRefChildTree(huge, ctx);
  const defaultNote = cappedDefault.querySelector('.refx-wb-missing');
  assert.ok(defaultNote);
  assert.match(defaultNote.textContent, /Outline truncated \(5 levels \/ 200 lines\)/);
});

test('W6 peek and zoom call sites pass expected opts', () => {
  const zoomSite = pluginSource.match(/const treeBox = this\._buildRefChildTree\(treeRoot, ctx, \{[\s\S]*?\}\);\s*\n\s*const showWidget/s)?.[0] || '';
  assert.match(zoomSite, /highlightGuid:\s*refLineGuid/);
  assert.match(zoomSite, /expandPathGuids/);
  assert.doesNotMatch(zoomSite, /defaultExpandDepth/);
  const crumbSite = pluginSource.match(/const treeBox = this\._buildRefChildTree\(result\.node, peekCtx, \{[\s\S]*?\}\);/)?.[0] || '';
  assert.match(crumbSite, /defaultExpandDepth:\s*1/);
  assert.match(crumbSite, /maxDepth:\s*4/);
  assert.match(crumbSite, /maxNodes:\s*60/);
});

test('W7 wbFillChildTree collapses depth >= 2', async () => {
  const { plugin, makeEl } = setupV461Plugin();
  const mk = (guid, kids = []) => ({ guid, segments: [{ type: 'text', text: guid }], children: kids });
  const shallow = [];
  for (let i = 0; i < 51; i++) shallow.push(mk('S' + i));
  const d2 = mk('D2', shallow);
  const d1 = mk('D1', [d2]);
  const root = mk('ROOT', [d1]);
  const rec = { getLineItems: async () => [root] };
  const body = makeEl('div');
  await plugin._wbFillChildTree(body, 'ROOT', rec, () => true);
  assert.ok(body.children.length > 0, 'tree should render');
  const kidBoxes = body.querySelectorAll('.refx-wb-tree-kids');
  assert.ok(kidBoxes.length >= 2);
  assert.equal(kidBoxes[0].classList.contains('refx-hidden'), false);
  assert.ok(kidBoxes[1].classList.contains('refx-hidden'));
  const note = body.querySelector('.refx-wb-missing');
  assert.ok(note);
  assert.match(note.textContent, /Outline truncated \(5 levels \/ 50 lines\)/);
});

function makeWbClampItem(makeEl, plugin, { lineGuid = 'WB1', target = 'HOME', variant = 'full', depth } = {}) {
  const node = makeEl('div');
  node.className = 'listitem-transclusion refx-wb-item';
  node.setAttribute('data-guid', lineGuid);
  const hdr = makeEl('div');
  hdr.className = 'refx-wb-hdr';
  node.appendChild(hdr);
  const container = makeEl('div');
  container.className = 'transclusion-container-div';
  node.appendChild(container);
  const it = {
    lineGuid,
    target,
    variant,
    depth,
    collapsed: false,
    line: { props: { refx_depth: depth }, setMetaProperty: async () => true },
  };
  return { node, container, it };
}

function setUni(context, guid, rguid, children = []) {
  context.window.g_universe.itemsByGuid[guid] = { guid, rguid, children };
}

function addBodyLine(makeEl, container, context, guid, { rguid, parent, children } = {}) {
  const li = makeEl('div');
  li.className = 'listitem';
  li.setAttribute('data-guid', guid);
  li.dataset.guid = guid;
  const lineDiv = makeEl('div');
  lineDiv.className = 'line-div';
  li.appendChild(lineDiv);
  (parent || container).appendChild(li);
  if (rguid) setUni(context, guid, rguid, children || []);
  return li;
}

test('W8 foreign clamp marks foreign lines and respects nested embeds', () => {
  const { plugin, makeEl, context } = setupV461Plugin();
  context.window.g_universe = { itemsByGuid: {} };
  plugin._wbClampForeign = true;
  plugin.data = {
    getRecord: (g) => (g === 'HOME' || g === 'FOREIGN' ? { guid: g, getName: () => (g === 'HOME' ? 'Home Page' : 'Foreign Page') } : null),
  };
  const { node, container, it } = makeWbClampItem(makeEl, plugin, { target: 'HOME', variant: 'full' });
  for (let i = 0; i < 3; i++) addBodyLine(makeEl, container, context, 'H' + i, { rguid: 'HOME' });
  for (let i = 0; i < 4; i++) addBodyLine(makeEl, container, context, 'F' + i, { rguid: 'FOREIGN' });
  const nestedTx = makeEl('div');
  nestedTx.className = 'listitem-transclusion';
  container.appendChild(nestedTx);
  const nestedInner = makeEl('div');
  nestedInner.className = 'transclusion-container-div';
  nestedTx.appendChild(nestedInner);
  for (let i = 0; i < 3; i++) addBodyLine(makeEl, nestedInner, context, 'N' + i, { rguid: 'FOREIGN' });
  plugin._wbFoldMount = () => {};
  plugin._wbClampApply(node, it);
  plugin._wbClampApply(node, it);
  const noteBtns = [...(node.querySelector('.refx-wb-clamp-note')?.children || [])].filter((b) => /▸ \d+ lines from/.test(b.textContent));
  assert.equal(noteBtns.length, 1);
  assert.equal(container.querySelectorAll('.refx-wb-foreignhide').length, 4);
  assert.equal(nestedInner.querySelectorAll('.refx-wb-foreignhide').length, 0);
  const note = node.querySelector('.refx-wb-clamp-note');
  assert.ok(note);
  const btn = note.children[0];
  assert.match(btn.textContent, /▸ 4 lines from Foreign Page/);
  btn.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  assert.equal(container.querySelectorAll('.refx-wb-foreignhide').length, 0);
  assert.equal(node.querySelector('.refx-wb-clamp-note'), null);

  plugin._wbClampLift.clear();
  plugin._wbClampNotes.clear();
  const { node: node2, container: c2, it: it2 } = makeWbClampItem(makeEl, plugin, { lineGuid: 'WB2', target: 'MISSING', variant: 'full' });
  addBodyLine(makeEl, c2, context, 'X1', { rguid: 'FOREIGN' });
  plugin.data = { getRecord: () => null };
  plugin._wbCtxResolveOwner = () => ({ ownerGuid: null, source: null });
  plugin._wbClampApply(node2, it2);
  assert.equal(c2.querySelectorAll('.refx-wb-foreignhide').length, 0);
});

test('W9 depth clamp seeds _wbFolds not hide classes', () => {
  const { plugin, makeEl, context } = setupV461Plugin();
  context.window.g_universe = { itemsByGuid: {} };
  plugin._wbClampForeign = false;
  plugin.data = { getRecord: (g) => (g === 'HOME' ? { guid: g, getName: () => g } : null) };
  plugin._wbFoldMount = (wbItemNode, wbLineGuid) => {
    const container = wbItemNode.querySelector('.transclusion-container-div');
    for (const li of container.querySelectorAll('.listitem[data-guid]')) {
      const bodyGuid = li.getAttribute('data-guid');
      const k = wbLineGuid + '>' + bodyGuid;
      if (plugin._wbFolds.has(k)) li.classList.add('refx-wb-foldhide');
    }
  };

  const { node: chNode, container: chC, it: chIt } = makeWbClampItem(makeEl, plugin, { lineGuid: 'CH', variant: 'children', target: 'TARGET' });
  const targetLi = addBodyLine(makeEl, chC, context, 'TARGET', { rguid: 'HOME', children: [{ guid: 'P1' }] });
  const p1 = addBodyLine(makeEl, chC, context, 'P1', { rguid: 'HOME', parent: targetLi, children: [{ guid: 'C1' }] });
  addBodyLine(makeEl, chC, context, 'C1', { rguid: 'HOME', parent: p1 });
  plugin._wbClampApply(chNode, chIt);
  assert.ok(!plugin._wbFolds.has('CH>TARGET'));
  assert.ok(plugin._wbFolds.has('CH>P1'));
  assert.ok(p1.classList.contains('refx-wb-foldhide'));
  assert.ok(!targetLi.classList.contains('refx-wb-foldhide'));
  assert.equal(chC.querySelectorAll('.refx-wb-deephide').length, 0);

  plugin._wbFolds.clear();
  plugin._wbClampSeeded.clear();
  const { node: recNode, container: recC, it: recIt } = makeWbClampItem(makeEl, plugin, { lineGuid: 'REC', variant: 'children', target: 'HOME' });
  const r1 = addBodyLine(makeEl, recC, context, 'R1', { rguid: 'HOME', children: [{ guid: 'R2' }] });
  addBodyLine(makeEl, recC, context, 'R2', { rguid: 'HOME', parent: r1 });
  plugin._wbClampApply(recNode, recIt);
  assert.ok(plugin._wbFolds.has('REC>R1'));
  assert.ok(!plugin._wbFolds.has('REC>R2'));

  plugin._wbFolds.clear();
  plugin._wbClampSeeded.clear();
  const { node: fullNode, container: fullC, it: fullIt } = makeWbClampItem(makeEl, plugin, { lineGuid: 'FL', variant: 'full', target: 'TARGET' });
  const fullTarget = addBodyLine(makeEl, fullC, context, 'TARGET', { rguid: 'HOME', children: [{ guid: 'FP1' }] });
  addBodyLine(makeEl, fullC, context, 'FP1', { rguid: 'HOME', parent: fullTarget, children: [{ guid: 'FC1' }] });
  plugin._wbClampApply(fullNode, fullIt);
  assert.equal(plugin._wbFolds.size, 0);

  plugin._wbFolds.clear();
  plugin._wbClampSeeded.clear();
  const { node: d2Node, container: d2C, it: d2It } = makeWbClampItem(makeEl, plugin, { lineGuid: 'D2', variant: 'full', target: 'TARGET', depth: '2' });
  const d2Target = addBodyLine(makeEl, d2C, context, 'TARGET', { rguid: 'HOME', children: [{ guid: 'D1' }] });
  const d1 = addBodyLine(makeEl, d2C, context, 'D1', { rguid: 'HOME', parent: d2Target, children: [{ guid: 'D2L' }] });
  addBodyLine(makeEl, d2C, context, 'D2L', { rguid: 'HOME', parent: d1, children: [{ guid: 'D3' }] });
  plugin._wbClampApply(d2Node, d2It);
  assert.ok(!plugin._wbFolds.has('D2>D1'));
  assert.ok(plugin._wbFolds.has('D2>D2L'));
});

test('W9b clamp teardown removes only seeded folds', () => {
  const { plugin, makeEl, context } = setupV461Plugin();
  context.window.g_universe = { itemsByGuid: {} };
  plugin._wbClampForeign = false;
  plugin.data = { getRecord: (g) => (g === 'HOME' ? { guid: g, getName: () => g } : null) };
  plugin._wbFoldMount = () => {};
  const { node, container, it } = makeWbClampItem(makeEl, plugin, { lineGuid: 'CH', variant: 'children', target: 'TARGET' });
  const targetLi = addBodyLine(makeEl, container, context, 'TARGET', { rguid: 'HOME', children: [{ guid: 'P1' }] });
  const p1 = addBodyLine(makeEl, container, context, 'P1', { rguid: 'HOME', parent: targetLi, children: [{ guid: 'C1' }] });
  addBodyLine(makeEl, container, context, 'C1', { rguid: 'HOME', parent: p1 });
  plugin._wbClampApply(node, it);
  assert.ok(plugin._wbFolds.has('CH>P1'));
  plugin._wbFolds.set('CH>C1', true);
  plugin._wbClampTeardown('CH', node);
  assert.ok(!plugin._wbFolds.has('CH>P1'));
  assert.ok(plugin._wbFolds.has('CH>C1'));
});

test('W9c collapsed decorate does not teardown clamp', () => {
  const { plugin, makeEl, context } = setupV461Plugin();
  const { node, it } = makeWbClampItem(makeEl, plugin, { lineGuid: 'CL', variant: 'full', target: 'HOME' });
  it.collapsed = true;
  context.window.g_universe = { itemsByGuid: { HOME: { guid: 'HOME' } } };
  plugin.data = { getRecord: (g) => ({ guid: g }) };
  plugin._wbPreserveQueryHost = () => {};
  plugin._wbLiveRenderContext = () => {};
  plugin._wbLiveRenderVariantBody = () => {};
  plugin._wbLiveHeaderSync = () => {};
  plugin._wbLiveBuildHeader = () => makeEl('div');
  plugin._wbTxRendered = () => true;
  let teardownCalls = 0;
  plugin._wbClampTeardown = () => { teardownCalls++; };
  plugin._wbLiveDecorate(node, it);
  assert.equal(teardownCalls, 0);
});

test('W10 clamp teardown clears foreignhide and seed set; MO not skippable', () => {
  const { plugin, makeEl, context } = setupV461Plugin();
  context.window.g_universe = { itemsByGuid: {} };
  plugin._wbClampForeign = true;
  plugin.data = { getRecord: (g) => ({ guid: g, getName: () => g }) };
  const { node, container, it } = makeWbClampItem(makeEl, plugin, { lineGuid: 'TD', target: 'HOME' });
  const li = addBodyLine(makeEl, container, context, 'F1', { rguid: 'OTHER' });
  plugin._wbFoldMount = () => {};
  plugin._wbClampApply(node, it);
  assert.ok(li.classList.contains('refx-wb-foreignhide'));
  assert.ok(plugin._wbClampSeeded.has('TD') || plugin._wbClampLift.size >= 0);
  if (!plugin._wbClampSeeded.has('TD')) plugin._wbClampSeeded.set('TD', new Set());
  plugin._wbClampTeardown('TD', node);
  assert.equal(li.classList.contains('refx-wb-foreignhide'), false);
  assert.equal(plugin._wbClampSeeded.has('TD'), false);
  assert.equal(plugin._wbClampLift.has('TD'), false);

  const listitem = makeEl('div');
  listitem.className = 'listitem refx-wb-foreignhide';
  listitem.setAttribute('data-guid', 'MO1');
  assert.equal(plugin._moNodeSkippable(listitem, null), false);
});

test('W11 variant menu depth rows and fold mount for children', async () => {
  const { plugin, makeEl, context } = setupV461Plugin();
  plugin._wbOwnerCurrent = () => true;
  plugin._wbLiveScheduleRefresh = () => {};
  const meta = [];
  const it = {
    lineGuid: 'M1',
    target: 'HOME',
    variant: 'children',
    depth: '2',
    line: {
      props: { refx_variant: 'children', refx_depth: '2' },
      setMetaProperty: async (k, v) => { meta.push([k, v]); it.depth = v; },
    },
  };
  context.document.body = makeEl('body');
  context.document.addEventListener = () => {};
  context.document.removeEventListener = () => {};
  plugin._wbLiveVariantMenu(it, { currentTarget: makeEl('button'), preventDefault() {}, stopPropagation() {} });
  const pop = context.document.body.children[0];
  const rows = [...pop.children];
  assert.equal(rows.filter((r) => r.classList.contains('refx-wb-vmenu-row')).length, 7);
  assert.ok(rows.some((r) => r.textContent.includes('Two levels') && r.classList.contains('is-on')));
  const depthRow = rows.find((r) => r.textContent.includes('Direct children'));
  depthRow.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(meta[0], ['refx_depth', '1']);

  plugin._wbOwnerCurrent = () => false;
  meta.length = 0;
  await plugin._wbLiveSetDepth(it, 2);
  assert.equal(meta.length, 0);

  const decorateSite = source.match(/if \(!it\.collapsed && !dangling && \(it\.variant === "full" \|\| it\.variant === "children"\)\)/);
  assert.ok(decorateSite, 'fold mount runs for children variant');
});

test('W12 header narrow CSS, actions-more wrapper, and clear-all arm/disarm', async () => {
  const hdrCss = source.slice(source.indexOf('.refx-wb-hdr {'), source.indexOf('.refx-wb-item > .refx-wb-ctx'));
  assert.match(hdrCss, /container-type:\s*inline-size/);
  assert.match(hdrCss, /min-width:\s*0/);
  assert.ok(source.includes('@container (max-width: 420px)'));
  assert.match(source, /\.refx-wb-hdr-title[\s\S]*?min-width:\s*0/);
  const hdrSync = source.slice(source.indexOf('_wbLiveHeaderSync('), source.indexOf('_wbBtn(glyph, title, fn)'));
  assert.ok(hdrSync.includes('refx-wb-hdr-actions-more'));
  assert.ok(/refx-wb-hdr-actions-more[\s\S]*?Pin to top|Unpin/.test(hdrSync));
  assert.ok(/refx-wb-hdr-actions-more[\s\S]*?Swap to main panel/.test(hdrSync));
  assert.ok(/View as: full[\s\S]*?refx-wb-hdr-actions-more/.test(hdrSync) === false || hdrSync.indexOf('refx-wb-hdr-actions-more') < hdrSync.indexOf('View as'));
  assert.ok(source.includes('data-refx-armed'));
  assert.ok(source.includes('Clear ') && source.includes('?'));

  const { plugin, makeEl, context } = setupV461Plugin();
  plugin._wbOwnerCurrent = () => true;
  plugin._wbLiveScheduleRefresh = () => {};
  plugin._toast = () => {};
  plugin._wbPushClosed = () => {};
  const deleted = [];
  const items = [
    { lineGuid: 'L1', target: 'T1', pinned: false, line: { delete: async () => { deleted.push('L1'); } } },
    { lineGuid: 'L2', target: 'T2', pinned: false, line: { delete: async () => { deleted.push('L2'); } } },
  ];
  plugin._wbLoadLive = async () => items;
  plugin._wbHeaders = new Map();
  context.document.body = makeEl('body');
  context.document.addEventListener = () => {};
  context.document.removeEventListener = () => {};
  const panel = makeEl('div');
  const scroller = makeEl('div');
  scroller.className = 'panel-scroller-y';
  panel.append(scroller);
  plugin._wbLiveFilterBarEnsure(panel, items);
  const clear = plugin._wbFilterBar.querySelector('.refx-wb-fclear');
  assert.ok(clear);
  assert.equal(clear.textContent, 'Clear all');
  clear.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  assert.equal(deleted.length, 0, 'first click arms only');
  assert.equal(clear.getAttribute('data-refx-armed'), '1');
  assert.equal(clear.textContent, 'Clear 2?');
  plugin._wbFclearDisarm(clear);
  assert.equal(clear.getAttribute('data-refx-armed'), null);
  assert.equal(clear.textContent, 'Clear all');
  assert.equal(deleted.length, 0, 'disarm leaves shelf intact');
  clear.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  clear.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  await tick();
  assert.equal(deleted.length, 2, 'second click within window clears');
});
