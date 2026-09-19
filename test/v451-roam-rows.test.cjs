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
  plugin.isExistingRecordGuid = () => false;
  plugin.data = { getRecord: () => null };
  return { plugin, storage, context };
}

function installFakeDom(context) {
  const makeEl = (tag) => {
    const listeners = {};
    const classes = new Set();
    const el = {
      tagName: String(tag).toUpperCase(),
      textContent: '', title: '', children: [], isConnected: true,
      style: {}, dataset: {}, disabled: false, _listeners: listeners,
      parentElement: null,
      previousElementSibling: null,
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
      addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
      setAttribute(name, value) { this[name] = String(value); },
      getAttribute(name) { return this[name] ?? null; },
      closest(selector) {
        let node = this;
        const wanted = selector.startsWith('.') ? selector.slice(1).split(/[\s\[:]/)[0] : '';
        while (node) {
          if (wanted && node.classList?.contains(wanted)) return node;
          node = node.parentElement;
        }
        return null;
      },
      querySelector(selector) {
        const scoped = selector.startsWith(':scope > ');
        const rest = scoped ? selector.slice(9) : selector;
        const roots = scoped ? this.children : walkAll(this);
        for (const node of roots) {
          const hit = matchSelector(node, rest);
          if (hit) return hit;
        }
        return null;
      },
      querySelectorAll(selector) {
        const wanted = selector.startsWith('.') ? selector.slice(1).split(/[\s\[:]/)[0] : '';
        const out = [];
        const walk = (node) => {
          for (const child of node.children || []) {
            if (wanted && child.classList?.contains(wanted)) out.push(child);
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

  context.document.createElement = makeEl;
  return makeEl;
}

test('v4.51.0 _crumbIdentity resolves ref-only crumbs', () => {
  const { plugin } = loadPlugin();
  assert.equal(plugin._crumbIdentity({ segments: [{ type: 'ref', text: { guid: 'G1' } }] }), 'G1');
  assert.equal(plugin._crumbIdentity({ segments: [{ type: 'ref', text: 'G2' }] }), 'G2');
  assert.equal(plugin._crumbIdentity({ segments: [{ type: 'text', text: 'hello' }] }), null);
  assert.equal(plugin._crumbIdentity({ segments: [{ type: 'text', text: ' ' }, { type: 'ref', text: { guid: 'G3' } }] }), 'G3');
});

test('v4.51.0 _isPureSelfRef matches target guid only', () => {
  const { plugin } = loadPlugin();
  const line = { segments: [{ type: 'ref', text: { guid: 'T1' } }] };
  assert.equal(plugin._isPureSelfRef(line, 'T1'), true);
  assert.equal(plugin._isPureSelfRef(line, 'T2'), false);
  assert.equal(plugin._isPureSelfRef({ segments: [{ type: 'text', text: 'x' }, { type: 'ref', text: { guid: 'T1' } }] }, 'T1'), false);
});

test('v4.51.0 source slices: trail self-ref, flat groups, no outline remnants', () => {
  assert.match(source, /_appendFlatAncestorTrail\(crumbEl, chain, ctx, mkAncActions, \{ selfRef, lineGuid, targetLine: target \}\)/);
  assert.match(source, /ctx\.sourceRecordGuid = srcGuid/);
  assert.match(source, /trc-ref-crumb-self/);
  assert.doesNotMatch(source, /refx-ref-children-heading/);
  assert.doesNotMatch(source, /refx-ref-outline/);
  assert.doesNotMatch(source, /refx-ref-childfold/);
  assert.equal(source.includes('_attachRemarkChips'), false);
  assert.doesNotMatch(source, /_rowPathEnabled/);
  assert.match(source, /const flat = opts\.flat === true/);
});

test('v4.51.0 self-ref row renders ○ trail, hidden fulltext, and child tree', async () => {
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
  plugin._mkRefRowAction = () => makeEl('button');
  plugin._refRowClipboardActions = () => [];
  plugin._isLineRefTarget = () => true;
  plugin.getOrLoadRecordName = () => 'Page';
  plugin._recordNameIndex = new Map([['R1', 'Page']]);
  plugin.data = { getRecord: () => null };

  const items = [{
    guid: 'A1',
    parent_guid: 'R1',
    segments: [{ type: 'ref', text: { guid: 'R1', title: 'Page' } }],
    children: [{
      guid: 'A2',
      parent_guid: 'A1',
      segments: [{ type: 'mention', text: '@Svy' }],
      children: [{
        guid: 'L1',
        parent_guid: 'A2',
        segments: [{ type: 'ref', text: { guid: 'T1', title: 'x' } }],
        children: [{
          guid: 'C1',
          parent_guid: 'L1',
          segments: [{ type: 'text', text: 'child text' }],
          children: [],
        }],
      }],
    }],
  }];
  const tree = plugin._refContextTree(items);
  const line = {
    guid: 'L1',
    record: { guid: 'R1' },
    segments: [{ type: 'ref', text: { guid: 'T1', title: 'x' } }],
  };
  const row = plugin._buildRefContextRow(line, { showRecordCrumb: true, tag: 'div', actions: [] });
  const ctx = {
    alive: () => true,
    treeCache: new Map([['R1', Promise.resolve(tree)]]),
    targetGuid: 'T1',
    onJump() {},
    canEdit: false,
  };
  await plugin._fillRefContextRow(ctx, line, row.crumbEl, row.childBox);

  const crumbParents = row.crumbEl.querySelectorAll('.trc-ref-popover-crumb-parent');
  assert.equal(
    [...crumbParents].some((c) => plugin._crumbIdentity({ segments: [{ type: 'ref', text: { guid: 'R1' } }] }) && c.textContent.includes('Page')),
    false,
    'dedupes the ancestor that only refs the source record'
  );
  assert.ok(row.crumbEl.querySelector('.trc-ref-crumb-mention'), 'mention ancestor crumb renders');
  assert.ok(row.crumbEl.querySelector('.trc-ref-crumb-self'), 'self-ref ○ crumb renders');
  const fulltext = row.rowEl.querySelector('.trc-ref-popover-fulltext');
  assert.ok(fulltext.classList.contains('refx-hidden'), 'self-ref hides the redundant fulltext');
  assert.equal(row.childBox.querySelectorAll('.refx-wb-tree-text').length, 1);
  assert.equal(row.childBox.querySelector('.refx-wb-tree-text').textContent, 'child text');
  assert.equal(row.childBox.querySelector('.refx-ref-children-heading'), null);
});


test('WO-2 inline section drops legacy chrome and adds filter toggle panel', () => {
  for (const needle of [
    'refx-inline-refs-context',
    'refx-r7-facet-bar',
    'refx-unlinked-section',
    '_renderR7FacetBar',
    '_appendUnlinkedSection',
    '_hydrateRefRowContext',
  ]) {
    assert.equal(source.includes(needle), false, 'plugin.js must not contain ' + needle);
  }
  const buildStart = source.indexOf('async _buildInlineRefsSection(');
  const buildEnd = source.indexOf('async _fillInlineRefs(', buildStart);
  assert.ok(buildStart > 0 && buildEnd > buildStart);
  const buildBlock = source.slice(buildStart, buildEnd);
  assert.match(buildBlock, /refx-inline-refs-filter-toggle/);
  assert.match(buildBlock, /refx-inline-refs-filters/);
  assert.doesNotMatch(buildBlock, /All reference paths/);
});

test('WO-3 menu context path crumbs and remark subsystem removed', () => {
  for (const needle of [
    '_attachRemarkChips',
    'refx-remark',
    '_refLevelRemarkRows',
    'refx-chain-remark-section',
    '1ZG05C7ST1T13EWAF5S2M4VNQR',
    "'Source Line'",
  ]) {
    assert.equal(source.includes(needle), false, 'plugin.js must not contain ' + needle);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  assert.deepEqual(manifest.custom.lineRefProperties, []);
  const renderBlock = source.slice(
    source.indexOf('_renderLineRefContext('),
    source.indexOf('_refChainTreeSearchText(', source.indexOf('_renderLineRefContext('))
  );
  assert.match(renderBlock, /trc-ref-popover-crumb-rec/);
  assert.doesNotMatch(renderBlock, /refx-line-context-owner/);
});

test('WO-3 menu context renders owner record crumb and deduped ancestor path', () => {
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
  plugin._appendPreviewOutlineRails = () => {};
  plugin._previewOutlineFlowyStyle = () => ({});
  plugin._appendRefChainSection = () => {};
  plugin._ensureLineRefChainBeforeContext = () => {};
  plugin._resetLineRefContextBody = (body) => {
    body.textContent = '';
    if (Array.isArray(body.children)) body.children.length = 0;
  };
  plugin._bridgeJump = () => Promise.resolve(true);

  const items = [{
    guid: 'PAGE_REF', parent_guid: 'OWNER_REC', type: 'ulist',
    segments: [{ type: 'ref', text: { guid: 'OWNER_REC', title: 'Owner' } }],
    children: [{
      guid: 'TARGET', parent_guid: 'PAGE_REF', type: 'ulist',
      segments: [{ type: 'text', text: 'Target line' }],
      children: [],
    }],
  }];
  const adjacency = plugin._lineRefContextAdjacency(items);
  const ctxModel = plugin._lineRefContextBuildModel('TARGET', adjacency, 'OWNER_REC');
  const host = makeEl('div');
  const body = makeEl('div'); body.className = 'refx-line-context-body';
  host.appendChild(body);

  assert.equal(plugin._renderLineRefContext(
    host, 'TARGET', items, 'Owner Page', adjacency, ctxModel, { surface: 'menu', chain: [] }
  ), true);

  const crumbs = body.querySelector('.refx-line-context-crumbs');
  assert.ok(crumbs, 'path crumbs render');
  const ownerCrumb = body.querySelector('.trc-ref-popover-crumb-rec');
  assert.ok(ownerCrumb, 'owner is the first record crumb');
  assert.equal(ownerCrumb.textContent, 'Owner Page');
  assert.equal(body.querySelector('.refx-line-context-owner'), null);
  assert.equal(body.querySelectorAll('.refx-line-context-sep').length, 0, 'owner-only record ref dedupes the ancestor ref crumb');
  assert.equal(body.querySelector('.trc-ref-crumb-ref'), null);
});
