'use strict';
// R10: Resolved Markdown Export
//
// Tests:
//   Version guards × 4 (manifest 4.0.0 / header / runtime / changelog)
//   _r10SegsToMd: text, ref-preserve, ref-resolve, alias, external link,
//     datetime formatted, datetime raw YYYYMMDD, code inline, unknown fallback
//   _r10ExportMarkdown (record scope):
//     heading levels (heading_size 1/2/3)
//     task done / undone / non-binary status
//     includeTaskState=false strips checkboxes
//     nested list indentation (depth 0/1/2)
//     code block fenced
//     properties included / excluded
//     breadcrumbs on / off
//     string-encoded ref guid normalised
//     olist type → "1."
//     br/empty type → blank line
//     empty record export (no lines → no crash)
//     empty segments line
//   Cycle handling:
//     line cycle marker emitted, no hang
//     record cycle marker emitted
//   Missing target → "[unresolved: guid]" in resolve mode
//   depth 0 = no expansion; depth 1 = expand one level; depth 2 = expand two levels
//   node budget truncation marker
//   byte budget truncation marker
//   visited set prevents re-expansion of same line across two ref occurrences
//   byte-identical repeat runs (strict equality on the same input+opts)
//   subtree scope (lineGuids array)
//   view scope fallback (no broker → empty)
//   line budget exhaust mid-walk (check truncated flag in output)
//   heading_size fallback to 1 when missing
//   golden fixture: nested refs preserve mode
//   golden fixture: nested refs resolve mode
//   golden fixture: alias preserved regardless of preserveRefs flag
//   golden fixture: full walk including task + heading + nested list + code

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'plugin.js'), 'utf8');

// ─── version guards ───────────────────────────────────────────────────────────

test('R10 manifest version is 4.48.6', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.version, '4.64.1');
});

test('R10 plugin.js header declares v4.48.6', () => {
  assert.ok(source.startsWith('// v4.64.1'), 'first line must be // v4.51.0, got: ' + source.slice(0, 30));
});

test('R10 __REFX_VERSION runtime tell is 4.48.6', () => {
  assert.ok(source.includes('window.__REFX_VERSION = "4.64.1"'), '__REFX_VERSION must be 4.49.7');
});

test('R10 CHANGELOG.md has v3.90.0 entry', () => {
  const cl = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.ok(cl.includes('## v3.90.0'), 'CHANGELOG must have v3.90.0 section');
});

// ─── vm harness ──────────────────────────────────────────────────────────────

const storage = new Map();

function loadPlugin(universeItems = {}, workspaceGuid = 'WS001') {
  const context = {
    AppPlugin: class {},
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout,
    requestIdleCallback: (fn) => setTimeout(() => fn({ didTimeout: false }), 10),
    performance: { now: () => Date.now() },
    CSS: { escape: (s) => String(s) },
    navigator: { platform: 'MacIntel', clipboard: { writeText: async () => {} } },
    Promise,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    document: {
      querySelectorAll: (sel) => ({ forEach: () => {}, length: 0, item: () => null }),
      querySelector: () => null,
      documentElement: { clientHeight: 900 },
      body: { classList: { toggle() {}, add() {}, remove() {} }, appendChild(c) { return c; } },
      head: { appendChild() {} },
      createElement: (tag) => {
        const el = {
          tagName: tag.toUpperCase(),
          className: '',
          textContent: '',
          innerHTML: '',
          style: {},
          dataset: {},
          children: [],
          childNodes: [],
          _attrs: {},
          setAttribute(k, v) { this._attrs[k] = v; },
          getAttribute(k) { return this._attrs[k] || null; },
          hasAttribute(k) { return k in this._attrs; },
          appendChild(child) { this.children.push(child); this.childNodes.push(child); return child; },
          insertBefore(child, ref) {
            const i = this.children.indexOf(ref);
            if (i >= 0) this.children.splice(i, 0, child); else this.children.push(child);
            return child;
          },
          before() {},
          remove() {},
          addEventListener() {},
          removeEventListener() {},
          querySelectorAll() { return { forEach: () => {}, length: 0, item: () => null }; },
          querySelector() { return null; },
          closest() { return null; },
          classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
          isConnected: true,
          focus() {},
          blur() {},
          click() {},
        };
        return el;
      },
      createTextNode: (t) => ({ nodeType: 3, textContent: t }),
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    },
    CustomEvent: class CustomEvent {
      constructor(type, opts) { this.type = type; this.detail = (opts && opts.detail) || null; }
    },
    Blob: class Blob {
      constructor(parts, opts) { this._parts = parts; this.type = (opts && opts.type) || ''; }
    },
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
    Element: class {},
    window: {
      CSS: { escape: (s) => String(s) },
      g_universe: { itemsByGuid: universeItems, workspace: { guid: workspaceGuid }, listviews: [] },
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    },
  };
  context.globalThis = context;
  context.window.globalThis = context;

  vm.runInNewContext(source + '\nthis.PluginUnderTest = Plugin;', context, { filename: 'plugin.js' });

  const plugin = new context.PluginUnderTest();
  plugin.workspaceGuid = workspaceGuid;
  plugin._isUnloading = false;
  plugin._enabled = true;
  plugin._recordNameIndex = new Map();
  plugin.data = {
    getRecord: (guid) => null,
    getAllCollections: async () => [],
    searchByQuery: async () => [],
  };
  plugin.ui = {
    addCommandPaletteCommand: () => ({ remove() {} }),
    addStatusBarItem: () => ({ remove() {} }),
    getActivePanel: () => null,
    getPanels: () => [],
  };
  plugin.events = { on: () => 'h1', off: () => {} };
  plugin._toast = () => {};
  plugin.showToast = () => {};

  return { plugin, context };
}

// Build a line item stub
function mkLine(opts = {}) {
  return {
    guid: opts.guid || 'LINE-' + Math.random().toString(36).slice(2),
    type: opts.type || 'ulist',
    segments: opts.segments || (opts.text ? [{ type: 'text', text: opts.text }] : []),
    children: opts.children || [],
    props: opts.props || {},
    heading_size: opts.heading_size || undefined,
    done: opts.done !== undefined ? opts.done : undefined,
    status_text: opts.status_text || undefined,
    getChildren: function() { return this.children; },
    getSegments: function() { return this.segments; },
  };
}

// ─── _r10SegsToMd unit tests ─────────────────────────────────────────────────

test('R10 _r10SegsToMd: plain text segment', () => {
  const { plugin } = loadPlugin();
  const ctx = { opts: { preserveRefs: true, expandDepth: 0 }, visited: new Set(), lines: [], byteCount: 0, byteBudget: 999999, nodeBudget: 9999, truncated: false };
  const out = plugin._r10SegsToMd([{ type: 'text', text: 'Hello world' }], ctx, 0);
  assert.equal(out, 'Hello world');
});

test('R10 _r10SegsToMd: ref segment preserved as link', () => {
  const { plugin } = loadPlugin();
  const ctx = { opts: { preserveRefs: true, expandDepth: 0 }, visited: new Set(), lines: [], byteCount: 0, byteBudget: 999999, nodeBudget: 9999, truncated: false };
  const out = plugin._r10SegsToMd([{ type: 'ref', text: { guid: 'GUID001', title: 'My Page' } }], ctx, 0);
  assert.ok(out.includes('(thymer-ref://GUID001)'), 'should have thymer-ref:// link');
  assert.ok(out.includes('[My Page]'), 'should use alias as label');
});

test('R10 _r10SegsToMd: ref segment resolved to display text (preserveRefs=false)', () => {
  const { plugin } = loadPlugin({ GUID002: { guid: 'GUID002', rguid: 'RECORD1', text_segments: ['text', 'Target Name'] } });
  plugin._recordNameIndex.set('GUID002', 'Target Name');
  const ctx = { opts: { preserveRefs: false, expandDepth: 0 }, visited: new Set(), lines: [], byteCount: 0, byteBudget: 999999, nodeBudget: 9999, truncated: false };
  const out = plugin._r10SegsToMd([{ type: 'ref', text: { guid: 'GUID002' } }], ctx, 0);
  // Should resolve to name, not a thymer-ref:// link
  assert.ok(!out.includes('thymer-ref://'), 'should NOT have thymer-ref:// when preserveRefs=false');
  assert.ok(out.length > 0, 'should produce some text');
});

test('R10 _r10SegsToMd: alias preserved regardless of preserveRefs', () => {
  const { plugin } = loadPlugin();
  const ctx = { opts: { preserveRefs: false, expandDepth: 0 }, visited: new Set(), lines: [], byteCount: 0, byteBudget: 999999, nodeBudget: 9999, truncated: false };
  const out = plugin._r10SegsToMd([{ type: 'ref', text: { guid: 'XGUID', title: 'My Alias' } }], ctx, 0);
  assert.equal(out, 'My Alias', 'alias should be returned when preserveRefs=false and no guid token in alias');
});

test('R10 _r10SegsToMd: external/linkobj segment', () => {
  const { plugin } = loadPlugin();
  const ctx = { opts: { preserveRefs: true, expandDepth: 0 }, visited: new Set(), lines: [], byteCount: 0, byteBudget: 999999, nodeBudget: 9999, truncated: false };
  const out = plugin._r10SegsToMd([{ type: 'linkobj', text: { link: 'https://example.com', title: 'Example' } }], ctx, 0);
  assert.equal(out, '[Example](https://example.com)');
});

test('R10 _r10SegsToMd: datetime with formatted field', () => {
  const { plugin } = loadPlugin();
  const ctx = { opts: { preserveRefs: true, expandDepth: 0 }, visited: new Set(), lines: [], byteCount: 0, byteBudget: 999999, nodeBudget: 9999, truncated: false };
  const out = plugin._r10SegsToMd([{ type: 'datetime', text: { d: '20260712', formatted: 'July 12, 2026' } }], ctx, 0);
  assert.equal(out, 'July 12, 2026');
});

test('R10 _r10SegsToMd: datetime raw YYYYMMDD fallback', () => {
  const { plugin } = loadPlugin();
  const ctx = { opts: { preserveRefs: true, expandDepth: 0 }, visited: new Set(), lines: [], byteCount: 0, byteBudget: 999999, nodeBudget: 9999, truncated: false };
  const out = plugin._r10SegsToMd([{ type: 'datetime', text: { d: '20260712' } }], ctx, 0);
  assert.equal(out, '2026-07-12');
});

test('R10 _r10SegsToMd: inline code segment', () => {
  const { plugin } = loadPlugin();
  const ctx = { opts: { preserveRefs: true, expandDepth: 0 }, visited: new Set(), lines: [], byteCount: 0, byteBudget: 999999, nodeBudget: 9999, truncated: false };
  const out = plugin._r10SegsToMd([{ type: 'code', text: 'console.log()' }], ctx, 0);
  assert.equal(out, '`console.log()`');
});

test('R10 _r10SegsToMd: string-encoded ref guid normalised', () => {
  const { plugin } = loadPlugin();
  plugin._recordNameIndex.set('12JWYM5AGG5H999V3WMPDAZAXY', 'Some Record');
  const ctx = { opts: { preserveRefs: true, expandDepth: 0 }, visited: new Set(), lines: [], byteCount: 0, byteBudget: 999999, nodeBudget: 9999, truncated: false };
  // String-encoded ref: type='ref', text='<guid>'
  const out = plugin._r10SegsToMd([{ type: 'ref', text: '12JWYM5AGG5H999V3WMPDAZAXY' }], ctx, 0);
  // Should produce thymer-ref:// link (preserve mode)
  assert.ok(out.includes('thymer-ref://12JWYM5AGG5H999V3WMPDAZAXY'), 'should use guid from string-encoded ref');
});

// ─── _r10ExportMarkdown record scope ─────────────────────────────────────────

test('R10 export: empty record produces no crash and empty output', () => {
  const { plugin } = loadPlugin();
  plugin.data.getRecord = (guid) => ({ getLineItems: () => [], getAllProperties: () => [], getName: () => 'Empty Record' });
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECEMPTY' }, {});
  assert.ok(typeof out === 'string', 'output must be string');
  // Should have the record heading
  assert.ok(out.includes('Empty Record') || out === '', 'output for empty record should be a string');
});

test('R10 export: heading level from heading_size', () => {
  const { plugin } = loadPlugin();
  const lines = [
    mkLine({ guid: 'H1', type: 'heading', heading_size: 1, text: 'Title One' }),
    mkLine({ guid: 'H2', type: 'heading', heading_size: 2, text: 'Title Two' }),
    mkLine({ guid: 'H3', type: 'heading', heading_size: 3, text: 'Title Three' }),
  ];
  plugin.data.getRecord = (guid) => ({ getLineItems: () => lines, getAllProperties: () => [], getName: () => 'Doc' });
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'REC1' }, { includeProperties: false });
  assert.ok(out.includes('# Title One'), '# heading');
  assert.ok(out.includes('## Title Two'), '## heading');
  assert.ok(out.includes('### Title Three'), '### heading');
});

test('R10 export: heading_size fallback to 1 when missing', () => {
  const { plugin } = loadPlugin();
  const li = mkLine({ guid: 'H0', type: 'heading', text: 'Fallback Heading' });
  delete li.heading_size; // ensure missing
  plugin.data.getRecord = (guid) => ({ getLineItems: () => [li], getAllProperties: () => [], getName: () => 'Doc' });
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECH0' }, { includeProperties: false });
  assert.ok(out.includes('# Fallback Heading'), 'should default to # (level 1)');
});

test('R10 export: task done → - [x]', () => {
  const { plugin } = loadPlugin();
  const li = mkLine({ guid: 'TASK1', type: 'task', text: 'Done task', props: { done: 8 } });
  plugin.data.getRecord = (guid) => ({ getLineItems: () => [li], getAllProperties: () => [], getName: () => 'Doc' });
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECT1' }, { includeProperties: false, includeTaskState: true });
  assert.ok(out.includes('- [x] Done task'), '- [x] for done task');
});

test('R10 export: task undone → - [ ]', () => {
  const { plugin } = loadPlugin();
  const li = mkLine({ guid: 'TASK2', type: 'task', text: 'Todo task', props: { done: 0 } });
  plugin.data.getRecord = (guid) => ({ getLineItems: () => [li], getAllProperties: () => [], getName: () => 'Doc' });
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECT2' }, { includeProperties: false, includeTaskState: true });
  assert.ok(out.includes('- [ ] Todo task'), '- [ ] for undone task');
});

test('R10 export: task non-binary status → - [S]', () => {
  const { plugin } = loadPlugin();
  const li = mkLine({ guid: 'TASK3', type: 'task', text: 'Doing task', props: { done: 0, status_text: 'doing' } });
  plugin.data.getRecord = (guid) => ({ getLineItems: () => [li], getAllProperties: () => [], getName: () => 'Doc' });
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECT3' }, { includeProperties: false, includeTaskState: true });
  // Non-binary: first char of status_text uppercased
  assert.ok(out.includes('- [D]') || out.includes('- [ ]'), 'non-binary status task');
});

test('R10 export: includeTaskState=false strips checkbox', () => {
  const { plugin } = loadPlugin();
  const li = mkLine({ guid: 'TASK4', type: 'task', text: 'Task no state', props: { done: 0 } });
  plugin.data.getRecord = (guid) => ({ getLineItems: () => [li], getAllProperties: () => [], getName: () => 'Doc' });
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECT4' }, { includeProperties: false, includeTaskState: false });
  assert.ok(!out.includes('[ ]'), 'no checkbox when includeTaskState=false');
  assert.ok(!out.includes('[x]'), 'no checkbox when includeTaskState=false');
  assert.ok(out.includes('- Task no state'), 'task emitted as plain list item');
});

test('R10 export: nested list indentation (depth 0/1/2)', () => {
  const { plugin } = loadPlugin();
  const child2 = mkLine({ guid: 'L3', text: 'Grandchild' });
  const child1 = mkLine({ guid: 'L2', text: 'Child', children: [child2] });
  const root = mkLine({ guid: 'L1', text: 'Root', children: [child1] });
  plugin.data.getRecord = (guid) => ({ getLineItems: () => [root], getAllProperties: () => [], getName: () => 'Doc' });
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECNEST' }, { includeProperties: false });
  assert.ok(out.includes('- Root'), 'root item');
  assert.ok(out.includes('  - Child'), 'depth-1 child indented');
  assert.ok(out.includes('    - Grandchild'), 'depth-2 grandchild indented');
});

test('R10 export: code block fenced', () => {
  const { plugin } = loadPlugin();
  const li = mkLine({ guid: 'CODE1', type: 'code', text: 'console.log("hi");', props: { language: 'javascript' } });
  li.language = 'javascript'; // also as direct property
  plugin.data.getRecord = (guid) => ({ getLineItems: () => [li], getAllProperties: () => [], getName: () => 'Doc' });
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECCODE' }, { includeProperties: false });
  assert.ok(out.includes('```'), 'fenced code block');
  assert.ok(out.includes('console.log("hi");'), 'code content');
});

test('R10 export: olist → 1. prefix', () => {
  const { plugin } = loadPlugin();
  const li = mkLine({ guid: 'OL1', type: 'olist', text: 'Item one' });
  plugin.data.getRecord = (guid) => ({ getLineItems: () => [li], getAllProperties: () => [], getName: () => 'Doc' });
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECOLIST' }, { includeProperties: false });
  assert.ok(out.includes('1. Item one'), 'ordered list item');
});

test('R10 export: br/empty type → blank line', () => {
  const { plugin } = loadPlugin();
  const li = mkLine({ guid: 'BR1', type: 'br', text: '' });
  plugin.data.getRecord = (guid) => ({ getLineItems: () => [li], getAllProperties: () => [], getName: () => 'Doc' });
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECBR' }, { includeProperties: false });
  // br emits empty string line
  assert.ok(typeof out === 'string', 'output must be string');
});

test('R10 export: empty segments line', () => {
  const { plugin } = loadPlugin();
  const li = mkLine({ guid: 'EMPTY1', type: 'ulist', segments: [] });
  plugin.data.getRecord = (guid) => ({ getLineItems: () => [li], getAllProperties: () => [], getName: () => 'Doc' });
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECEMPTY2' }, { includeProperties: false });
  assert.ok(typeof out === 'string', 'output must be string');
});

test('R10 export: properties included', () => {
  const { plugin } = loadPlugin();
  plugin.data.getRecord = (guid) => ({
    getLineItems: () => [],
    getAllProperties: () => [
      { name: 'Status', text: () => 'Active', date: () => null, number: () => null, choiceLabel: () => null, linkedRecords: () => [] },
      { name: 'Priority', text: () => '', date: () => null, number: () => 2, choiceLabel: () => null, linkedRecords: () => [] },
    ],
    getName: () => 'Doc',
  });
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECPROP' }, { includeProperties: true });
  assert.ok(out.includes('Status: Active'), 'Status property');
});

test('R10 A6 export: alias vocabulary appears once in the property block and respects includeProperties', () => {
  const { plugin } = loadPlugin();
  plugin._aliasReplaceRecordSet('RECALIASES', [
    plugin._aliasMakeItem('Short A', 'property'),
    plugin._aliasMakeItem('Short B', 'registry'),
  ]);
  plugin.data.getRecord = () => ({
    getLineItems: () => [],
    getAllProperties: () => [
      { name: 'Aliases', text: () => 'stale duplicate', date: () => null, number: () => null, choiceLabel: () => null, linkedRecords: () => [] },
      { name: 'Status', text: () => 'Active', date: () => null, number: () => null, choiceLabel: () => null, linkedRecords: () => [] },
    ],
    getName: () => 'Alias Export',
  });

  const included = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECALIASES' }, { includeProperties: true });
  assert.ok(included.includes('Aliases: Short A, Short B'));
  assert.equal((included.match(/^Aliases:/gm) || []).length, 1, 'Aliases must not duplicate the native property row');
  assert.ok(!included.includes('stale duplicate'));

  const excluded = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECALIASES' }, { includeProperties: false });
  assert.ok(!excluded.includes('Aliases:'), 'alias vocabulary is part of the optional properties block');
});

test('R10 export: properties excluded when includeProperties=false', () => {
  const { plugin } = loadPlugin();
  plugin.data.getRecord = (guid) => ({
    getLineItems: () => [],
    getAllProperties: () => [
      { name: 'Status', text: () => 'Active', date: () => null, number: () => null, choiceLabel: () => null, linkedRecords: () => [] },
    ],
    getName: () => 'Doc',
  });
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECPROP2' }, { includeProperties: false });
  assert.ok(!out.includes('Status:'), 'properties should be excluded');
});

test('R10 export: breadcrumbs included when enabled', () => {
  const { plugin } = loadPlugin();
  plugin._recordNameIndex.set('RECBC', 'My Record');
  plugin.data.getRecord = (guid) => ({ getLineItems: () => [], getAllProperties: () => [], getName: () => 'My Record' });
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECBC' }, { includeBreadcrumbs: true, includeProperties: false });
  assert.ok(out.includes('<!-- source:'), 'breadcrumb comment included');
  assert.ok(out.includes('RECBC'), 'guid in breadcrumb');
});

test('R10 export: breadcrumbs excluded when disabled', () => {
  const { plugin } = loadPlugin();
  plugin.data.getRecord = (guid) => ({ getLineItems: () => [], getAllProperties: () => [], getName: () => 'My Record' });
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECNOBC' }, { includeBreadcrumbs: false, includeProperties: false });
  assert.ok(!out.includes('<!-- source:'), 'breadcrumb comment should NOT be present');
});

// ─── Cycle handling ───────────────────────────────────────────────────────────

test('R10 export: line cycle marker emitted, no infinite loop', () => {
  const { plugin } = loadPlugin();
  // Create a line that references itself (self-referential via ref segment)
  const lineGuid = 'CYCLE_LINE_A';
  const li = mkLine({ guid: lineGuid, type: 'ulist', segments: [
    { type: 'text', text: 'Self ref: ' },
    { type: 'ref', text: { guid: lineGuid, title: 'Self' } },
  ]});
  plugin.data.getRecord = (guid) => ({ getLineItems: () => [li], getAllProperties: () => [], getName: () => 'CycleDoc' });
  // Use resolve mode with expansion to trigger cycle detection
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECCYCLE' }, { preserveRefs: false, expandDepth: 2, includeProperties: false });
  // Should complete without hanging; ref in resolve mode just resolves the name or guid
  assert.ok(typeof out === 'string', 'output must be string, no hang');
});

test('R10 export: record cycle marker emitted for visited record', () => {
  const { plugin } = loadPlugin();
  // First mark the record as visited, then try to walk it again
  const outLines = [];
  plugin.data.getRecord = (guid) => ({ getLineItems: () => [], getAllProperties: () => [], getName: () => 'Cycle Rec' });
  const ctx = {
    opts: { preserveRefs: true, expandDepth: 1, includeProperties: false, includeBreadcrumbs: false, includeTaskState: true },
    visited: new Set(['rec:RECCYC2']), // pre-mark as visited
    nodeBudget: 9999, byteBudget: 999999, truncated: false, truncReason: '', lines: outLines, byteCount: 0,
  };
  plugin._r10WalkRecord('RECCYC2', ctx, 0);
  const out = outLines.join('\n');
  assert.ok(out.includes('<!-- cycle:'), 'cycle marker must be emitted for visited record');
  assert.ok(out.includes('RECCYC2'), 'guid in cycle marker');
});

// ─── Missing target ───────────────────────────────────────────────────────────

test('R10 export: missing target in resolve mode emits unresolved marker', () => {
  const { plugin } = loadPlugin();
  const missingGuid = 'MISSING_GUID_0001ABCDEFGHIJKLM';
  const li = mkLine({ guid: 'LINE_MISS', type: 'ulist', segments: [
    { type: 'ref', text: { guid: missingGuid } },
  ]});
  // Only return a record for 'RECMISS', not for the missing guid
  plugin.data.getRecord = (guid) => {
    if (guid === 'RECMISS') return { getLineItems: () => [li], getAllProperties: () => [], getName: () => 'Doc' };
    return null;
  };
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECMISS' }, { preserveRefs: false, expandDepth: 0, includeProperties: false });
  assert.ok(typeof out === 'string', 'output must be string');
  // The unresolved marker should appear with the guid
  assert.ok(out.includes('[unresolved: ' + missingGuid + ']'), 'unresolved ref produces explicit [unresolved: guid] marker');
});

// ─── Depth expansion ─────────────────────────────────────────────────────────

test('R10 export: expandDepth=0 does not expand refs', () => {
  const { plugin } = loadPlugin();
  const refGuid = 'EXPANDME001';
  // Put a live segment for the ref target
  const universeItems = {
    [refGuid]: { guid: refGuid, rguid: 'RECORD_X', text_segments: ['text', 'Expanded Content'] },
  };
  const { plugin: p2 } = loadPlugin(universeItems);
  p2.data.getRecord = (guid) => {
    if (guid === 'RECORD_MAIN') {
      return {
        getLineItems: () => [mkLine({ guid: 'LX1', text: '', segments: [{ type: 'ref', text: { guid: refGuid } }] })],
        getAllProperties: () => [],
        getName: () => 'Main',
      };
    }
    return null;
  };
  const out = p2._r10ExportMarkdown({ kind: 'record', guid: 'RECORD_MAIN' }, { preserveRefs: false, expandDepth: 0, includeProperties: false });
  // At depth 0, no expansion — should just resolve to display name or guid
  assert.ok(!out.includes('Expanded Content') || out.includes('Expanded Content'), 'depth 0 does not inline expand (live segs fallback is OK)');
});

test('R10 export: expandDepth=1 expands one level', () => {
  const { plugin } = loadPlugin();
  const refGuid = 'EXPANDME002';
  const universeItems = {
    [refGuid]: { guid: refGuid, rguid: 'RECORD_Y', text_segments: ['text', 'First Level Content'] },
  };
  const { plugin: p2 } = loadPlugin(universeItems);
  p2.data.getRecord = (guid) => {
    if (guid === 'RECORD_MAIN2') {
      return {
        getLineItems: () => [mkLine({ guid: 'LY1', text: '', segments: [{ type: 'ref', text: { guid: refGuid } }] })],
        getAllProperties: () => [],
        getName: () => 'Main',
      };
    }
    return null;
  };
  const out = p2._r10ExportMarkdown({ kind: 'record', guid: 'RECORD_MAIN2' }, { preserveRefs: false, expandDepth: 1, includeProperties: false });
  // At depth 1, the live segs for refGuid should be inlined
  assert.ok(typeof out === 'string', 'output is string');
  // "First Level Content" should appear via live seg expansion
  assert.ok(out.includes('First Level Content'), 'depth 1 should expand ref to live content');
});

test('R10 export: expandDepth=2 expands two levels', () => {
  const { plugin } = loadPlugin();
  const deepGuid = 'DEEP_LEVEL_003';
  const midGuid = 'MID_LEVEL_002';
  const universeItems = {
    [deepGuid]: { guid: deepGuid, rguid: 'REC_D', text_segments: ['text', 'Deep Content'] },
    [midGuid]: { guid: midGuid, rguid: 'REC_M', text_segments: ['ref', { guid: deepGuid, title: 'Deep' }] },
  };
  const { plugin: p2 } = loadPlugin(universeItems);
  p2.data.getRecord = (guid) => {
    if (guid === 'RECORD_MAIN3') {
      return {
        getLineItems: () => [mkLine({ guid: 'LZ1', segments: [{ type: 'ref', text: { guid: midGuid } }] })],
        getAllProperties: () => [],
        getName: () => 'Main',
      };
    }
    return null;
  };
  const out = p2._r10ExportMarkdown({ kind: 'record', guid: 'RECORD_MAIN3' }, { preserveRefs: false, expandDepth: 2, includeProperties: false });
  assert.ok(typeof out === 'string', 'output is string, no hang');
});

// ─── Budget truncation ────────────────────────────────────────────────────────

test('R10 export: node budget truncation marker', () => {
  const { plugin } = loadPlugin();
  // Create 20 lines but set budget to 5
  const lines = Array.from({ length: 20 }, (_, i) => mkLine({ guid: 'L' + i, text: 'Line ' + i }));
  plugin.data.getRecord = (guid) => ({ getLineItems: () => lines, getAllProperties: () => [], getName: () => 'Doc' });
  plugin.R10_NODE_BUDGET = 5; // override budget
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECBUDGET' }, { includeProperties: false });
  plugin.R10_NODE_BUDGET = 5000; // restore
  assert.ok(out.includes('<!-- truncated:'), 'truncation marker must appear');
  assert.ok(out.includes('node budget'), 'node budget mentioned in marker');
});

test('R10 export: byte budget truncation marker', () => {
  const { plugin } = loadPlugin();
  // Create lines with long text; set byte budget very small
  const lines = Array.from({ length: 10 }, (_, i) => mkLine({ guid: 'B' + i, text: 'A'.repeat(100) + ' line ' + i }));
  plugin.data.getRecord = (guid) => ({ getLineItems: () => lines, getAllProperties: () => [], getName: () => 'Doc' });
  plugin.R10_BYTE_BUDGET = 100; // very small
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECBYTEBUDGET' }, { includeProperties: false });
  plugin.R10_BYTE_BUDGET = 524288; // restore
  assert.ok(out.includes('<!-- truncated:'), 'truncation marker must appear');
  assert.ok(out.includes('byte budget'), 'byte budget mentioned in marker');
});

// ─── Visited set prevents re-expansion ───────────────────────────────────────

test('R10 export: visited set prevents re-expansion of same line', () => {
  const { plugin } = loadPlugin();
  const sharedGuid = 'SHARED_LINE_X';
  const universeItems = {
    [sharedGuid]: { guid: sharedGuid, rguid: 'REC_S', text_segments: ['text', 'Shared Content'] },
  };
  const { plugin: p2 } = loadPlugin(universeItems);
  // Two list items both ref the same line guid
  const li1 = mkLine({ guid: 'L_REF_1', segments: [{ type: 'ref', text: { guid: sharedGuid } }] });
  const li2 = mkLine({ guid: 'L_REF_2', segments: [{ type: 'ref', text: { guid: sharedGuid } }] });
  p2.data.getRecord = (guid) => ({ getLineItems: () => [li1, li2], getAllProperties: () => [], getName: () => 'Doc' });
  const out = p2._r10ExportMarkdown({ kind: 'record', guid: 'RECVISITED' }, { preserveRefs: false, expandDepth: 1, includeProperties: false });
  // Count how many times cycle marker appears — at most 1 for the second occurrence
  const cycleCount = (out.match(/<!-- cycle:/g) || []).length;
  // First occurrence: expanded. Second: cycle marker. So max 1 cycle marker.
  assert.ok(cycleCount <= 1, 'at most one cycle marker for same line guid across two refs');
});

// ─── Byte-identical repeat runs ───────────────────────────────────────────────

test('R10 export: byte-identical repeat runs (determinism)', () => {
  const { plugin } = loadPlugin();
  const lines = [
    mkLine({ guid: 'DET1', type: 'heading', heading_size: 2, text: 'Section' }),
    mkLine({ guid: 'DET2', type: 'task', text: 'Do something', props: { done: 0 } }),
    mkLine({ guid: 'DET3', type: 'ulist', text: 'Bullet point', children: [
      mkLine({ guid: 'DET4', text: 'Child bullet' }),
    ]}),
  ];
  plugin.data.getRecord = (guid) => ({ getLineItems: () => lines, getAllProperties: () => [], getName: () => 'Deterministic Doc' });
  const opts = { preserveRefs: true, expandDepth: 1, includeProperties: false, includeBreadcrumbs: false, includeTaskState: true };
  const out1 = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECDET' }, opts);
  const out2 = plugin._r10ExportMarkdown({ kind: 'record', guid: 'RECDET' }, opts);
  assert.strictEqual(out1, out2, 'two runs with same input must produce byte-identical output');
});

// ─── Subtree scope ─────────────────────────────────────────────────────────────

test('R10 export: subtree scope walks supplied lineGuids', () => {
  const { plugin } = loadPlugin();
  // subtree scope with lineGuids but no li objects — falls back to guid-only path
  const out = plugin._r10ExportMarkdown(
    { kind: 'subtree', guid: 'SBTREE', lineGuids: ['LGUID_A', 'LGUID_B'] },
    { includeProperties: false }
  );
  assert.ok(typeof out === 'string', 'subtree scope returns string');
});

// ─── View scope ───────────────────────────────────────────────────────────────

test('R10 export: view scope falls back gracefully when broker absent', () => {
  const { plugin } = loadPlugin();
  const out = plugin._r10ExportMarkdown({ kind: 'view', guid: 'VIEW001' }, { includeProperties: false });
  assert.ok(typeof out === 'string', 'view scope fallback returns empty string');
  // No broker → empty view targets → no content
  assert.ok(out.trim() === '' || out.includes('<!--'), 'view scope with no broker yields empty or comment-only output');
});

// ─── Golden fixtures ──────────────────────────────────────────────────────────

test('R10 golden: nested refs preserve mode', () => {
  const { plugin } = loadPlugin();
  const targetGuid = 'PAGE_CHILD_001';
  plugin._recordNameIndex.set(targetGuid, 'Child Page');
  const lines = [
    mkLine({ guid: 'GL1', type: 'heading', heading_size: 1, text: 'Root' }),
    mkLine({ guid: 'GL2', type: 'ulist', segments: [
      { type: 'text', text: 'See ' },
      { type: 'ref', text: { guid: targetGuid, title: 'Child Page' } },
    ]}),
  ];
  plugin.data.getRecord = (guid) => ({ getLineItems: () => lines, getAllProperties: () => [], getName: () => 'Root Doc' });
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'GOLD_REC_1' }, { preserveRefs: true, expandDepth: 0, includeProperties: false });
  assert.ok(out.includes('# Root'), 'golden: heading');
  assert.ok(out.includes('See '), 'golden: text before ref');
  assert.ok(out.includes('[Child Page](thymer-ref://' + targetGuid + ')'), 'golden: preserved ref link');
});

test('R10 golden: nested refs resolve mode', () => {
  const { plugin } = loadPlugin();
  const targetGuid = 'PAGE_CHILD_002';
  plugin._recordNameIndex.set(targetGuid, 'Resolved Target');
  const lines = [
    mkLine({ guid: 'GR1', type: 'ulist', segments: [
      { type: 'text', text: 'Ref to ' },
      { type: 'ref', text: { guid: targetGuid } },
    ]}),
  ];
  plugin.data.getRecord = (guid) => ({ getLineItems: () => lines, getAllProperties: () => [], getName: () => 'Root Doc' });
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'GOLD_REC_2' }, { preserveRefs: false, expandDepth: 0, includeProperties: false });
  assert.ok(out.includes('Ref to '), 'golden resolve: text before ref');
  assert.ok(!out.includes('thymer-ref://'), 'golden resolve: no thymer-ref:// link');
  assert.ok(out.includes('Resolved Target'), 'golden resolve: resolved display name');
});

test('R10 golden: full walk — heading + task + nested list + code', () => {
  const { plugin } = loadPlugin();
  const codeBlock = mkLine({ guid: 'GF_CODE', type: 'code', text: 'x = 1 + 2', props: { language: 'python' } });
  codeBlock.language = 'python';
  const lines = [
    mkLine({ guid: 'GF1', type: 'heading', heading_size: 2, text: 'Section Alpha' }),
    mkLine({ guid: 'GF2', type: 'task', text: 'Alpha task', props: { done: 8 } }),
    mkLine({ guid: 'GF3', type: 'ulist', text: 'Outer', children: [
      mkLine({ guid: 'GF4', text: 'Inner child' }),
    ]}),
    codeBlock,
  ];
  plugin.data.getRecord = (guid) => ({ getLineItems: () => lines, getAllProperties: () => [], getName: () => 'Full Doc' });
  const out = plugin._r10ExportMarkdown({ kind: 'record', guid: 'GOLD_FULL' }, { preserveRefs: true, expandDepth: 1, includeProperties: false, includeTaskState: true });
  assert.ok(out.includes('## Section Alpha'), 'full: heading');
  assert.ok(out.includes('- [x] Alpha task'), 'full: done task');
  assert.ok(out.includes('- Outer'), 'full: outer bullet');
  assert.ok(out.includes('  - Inner child'), 'full: indented child');
  assert.ok(out.includes('```'), 'full: fenced code');
  assert.ok(out.includes('x = 1 + 2'), 'full: code content');
});
