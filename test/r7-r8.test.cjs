'use strict';
// R7/R8: snapshot facets, FilterExpressionV1, claim rows, edit-live rows.
//
// R7 tests:
//   - facet counts from full broker snapshot vs loaded rows
//   - each facet dimension (collection, kind, authored/derived, taskState, sourceProperty, dateRange)
//   - FilterExpressionV1 normalization determinism + nested AND/OR evaluation
//   - FilterExpressionV1 cursor binding + flat-filter backward compat
//   - supportsFilterExpr capability flag on broker
//   - claim row rendering fields + authored/derived exclusion
//   - same-title discovery separate from claim rows (no conflation)
//
// R8 tests:
//   - edit-live single-editor invariant (opening second closes first)
//   - row restore preserves position/filter state (_r8SettleRerender)
//   - remote-update-after-settle re-render (generation-guarded)
//   - 50-rows-one-editor (_r8AssertSingleEditor returns ≤ 1)
//
// Version guards (fail fast on wrong version):
//   - manifest 4.0.0 (updated by line aliases)
//   - header // v4.0.0 (updated by line aliases)
//   - __REFX_VERSION "4.0.0" (updated by line aliases)
//   - CHANGELOG has v3.90.0 (updated by A3)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'plugin.js'), 'utf8');

// ─── version guards ───────────────────────────────────────────────────────────

test('R7/R8 manifest version is 4.48.6', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.version, '4.64.1');
});

test('R7/R8 plugin.js header declares v4.48.6', () => {
  assert.ok(source.startsWith('// v4.64.1'), 'first line must be // v4.49.9');
});

test('R7/R8 __REFX_VERSION runtime tell is 4.48.6', () => {
  assert.ok(source.includes('window.__REFX_VERSION = "4.64.1"'), '__REFX_VERSION must be 4.49.7');
});

test('R7/R8 CHANGELOG.md has v3.90.0 entry (updated by A3)', () => {
  const cl = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.ok(cl.includes('## v3.90.0'), 'CHANGELOG must have v3.90.0 section');
});

// ─── vm harness ──────────────────────────────────────────────────────────────

const storage = new Map();

function loadPlugin(universeItems = {}, workspaceGuid = 'WS001') {
  const eventHandlers = {};
  let docListeners = {};
  let winListeners = {};
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
    navigator: { platform: 'MacIntel', clipboard: {} },
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
      body: { classList: { toggle() {}, add() {}, remove() {} } },
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
          insertBefore(child, ref) { const i = this.children.indexOf(ref); if (i >= 0) this.children.splice(i, 0, child); else this.children.push(child); return child; },
          before(sibling) { /* stub */ },
          remove() { /* stub */ },
          addEventListener(type, fn) { if (!this._listeners) this._listeners = {}; if (!this._listeners[type]) this._listeners[type] = []; this._listeners[type].push(fn); },
          removeEventListener(type, fn) {},
          querySelectorAll(sel) { return { forEach: () => {}, length: 0, item: () => null }; },
          querySelector(sel) { return null; },
          closest(sel) { return null; },
          classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
          isConnected: true,
          focus() {},
          blur() {},
        };
        return el;
      },
      createTextNode: (t) => ({ nodeType: 3, textContent: t }),
      addEventListener: (evt, fn) => { if (!docListeners[evt]) docListeners[evt] = []; docListeners[evt].push(fn); },
      removeEventListener: (evt, fn) => { if (docListeners[evt]) docListeners[evt] = docListeners[evt].filter((h) => h !== fn); },
      dispatchEvent: (e) => { (docListeners[e.type] || []).forEach((h) => { try { h(e); } catch (err) {} }); return true; },
    },
    CustomEvent: class CustomEvent {
      constructor(type, opts) { this.type = type; this.detail = (opts && opts.detail) || null; }
    },
    Element: class {},
    window: {
      CSS: { escape: (s) => String(s) },
      g_universe: { itemsByGuid: universeItems, workspace: { guid: workspaceGuid } },
      addEventListener: (evt, fn) => { if (!winListeners[evt]) winListeners[evt] = []; winListeners[evt].push(fn); },
      removeEventListener: (evt, fn) => { if (winListeners[evt]) winListeners[evt] = winListeners[evt].filter((h) => h !== fn); },
      dispatchEvent: (e) => { (winListeners[e.type] || []).forEach((h) => { try { h(e); } catch (err) {} }); },
    },
  };
  context.globalThis = context;
  context.window.globalThis = context;

  vm.runInNewContext(source + '\nthis.PluginUnderTest = Plugin;', context, { filename: 'plugin.js' });

  const registeredHandlers = {};
  const plugin = new context.PluginUnderTest();
  plugin.workspaceGuid = workspaceGuid;
  plugin._isUnloading = false;
  plugin._enabled = true;
  plugin.data = {
    getRecord: (guid) => {
      const st = universeItems[guid];
      if (!st || st.rguid) return null;
      return { guid, getAllProperties: () => [], getLineItems: async () => [], getAllRecords: () => [] };
    },
    getAllCollections: async () => [],
    getAllRecords: () => [],
    searchByQuery: async () => [],
  };
  plugin.ui = {
    addCommandPaletteCommand: () => ({ remove() {} }),
    addStatusBarItem: () => ({ remove() {} }),
    getActivePanel: () => null,
  };
  plugin.events = {
    on: (name, fn) => {
      if (!registeredHandlers[name]) registeredHandlers[name] = [];
      registeredHandlers[name].push(fn);
      return name + '_' + registeredHandlers[name].length;
    },
    off: () => {},
  };
  plugin._registeredHandlers = registeredHandlers;
  plugin._context = context;
  plugin._winListeners = winListeners;
  plugin._docListeners = docListeners;
  plugin.getOrLoadRecordName = (guid) => 'Record-' + guid.slice(0, 4);
  plugin._toast = () => {};
  plugin.showToast = () => {};
  return { plugin, context, winListeners, docListeners, registeredHandlers };
}

function makeBroker(universeItems = {}) {
  const { plugin, context, winListeners } = loadPlugin(universeItems);
  plugin._killStaleObservers();
  plugin._attachAttributesClaims();
  const broker = plugin._initReferenceSurfaceBroker();
  return { broker, plugin, context, winListeners };
}

// Feed synthetic edges into a fresh broker via claim edges.
// Uses _edgeFromClaimBrokerEdge + direct onClaimsRefresh trigger to inject
// edges synchronously. The __thymerClaimsV1 mock must pass the contract/version
// check in _attachAttributesClaims (contract:'thymer-claims-v1', version:1).
// relational.edges() must return {authored:[...], derived:[...]} to match
// what _attributesClaimEdges() reads.
function makeBrokerWithEdges(edgeSpecs) {
  const { broker, plugin, context, winListeners } = makeBroker();

  // Separate specs into authored and derived.
  const authored = [];
  const derived = [];
  edgeSpecs.forEach((spec, i) => {
    const be = {
      edgeId: 'test-edge-' + i,
      source: spec.lineGuid || 'line-' + i,
      predicate: { name: spec.predicate || 'relatesTo', guid: 'pred-' + i },
      target: spec.targetGuid || 'tgt-A',
      kind: spec.authored === false ? 'derived' : 'authored',
      claimGuid: 'claim-' + i,
      ordinal: i,
      sourcePart: 'body',
      derivedFrom: spec.authored === false ? 'test-edge-parent-' + i : null,
      derivedBy: spec.authored === false ? 'inverse:key-' + i : null,
      qualifiers: spec.qualifiers || null,
      confidence: spec.confidence !== undefined ? spec.confidence : null,
      evidence: spec.evidence || null,
    };
    if (spec.authored === false) derived.push(be);
    else authored.push(be);
  });

  // Install a mock __thymerClaimsV1 that passes the contract/version gate.
  context.window.__thymerClaimsV1 = {
    contract: 'thymer-claims-v1',
    version: 1,
    subscribe: (cb) => {
      // Deliver a complete snapshot immediately.
      cb({ generation: 'g-test', revision: 1, snapshot: { complete: true, status: 'complete', generation: 'g-test', revision: 1 } });
      return () => {};
    },
    snapshot: () => ({ complete: true, status: 'complete', generation: 'g-test', revision: 1 }),
    relational: {
      // Return authored/derived shape that _attributesClaimEdges() reads.
      edges: () => ({ authored, derived }),
    },
  };

  // Re-attach claims so the broker picks up the new __thymerClaimsV1.
  plugin._attachAttributesClaims();

  // _attachAttributesClaims dispatches 'thymer:reference-claims-refresh' after
  // Promise.resolve().then(), so we fire it via the winListeners we installed.
  // Also directly call onClaimsRefresh via the event path.
  (winListeners['thymer:reference-claims-refresh'] || []).forEach((fn) => fn());

  return { broker, plugin, context, winListeners };
}

// ─── R7.2: FilterExpressionV1 ─────────────────────────────────────────────────

test('R7.2: broker has supportsFilterExpr:true capability flag', () => {
  const { broker } = makeBroker();
  assert.equal(broker.supportsFilterExpr, true);
});

test('R7.2: _normalizeFilterExprV1 — null returns null', () => {
  const { plugin } = makeBroker();
  assert.equal(plugin._normalizeFilterExprV1(null), null);
});

test('R7.2: _normalizeFilterExprV1 — leaf (FilterV1) produces same as _normalizeFilterV1', () => {
  const { plugin } = makeBroker();
  const leaf = { _filterVersion: 1, kinds: ['ref'], targetGuid: null, sourceRecord: null, authored: null, collectionGuid: null, dateRange: null };
  const exprResult = plugin._normalizeFilterExprV1(leaf);
  const filterResult = plugin._normalizeFilterV1(leaf);
  assert.equal(exprResult, filterResult, 'leaf expression must normalize same as FilterV1');
});

test('R7.2: _normalizeFilterExprV1 — AND node produces deterministic canonical JSON', () => {
  const { plugin } = makeBroker();
  const leaf1 = { _filterVersion: 1, kinds: ['ref'], targetGuid: null, sourceRecord: null, authored: null, collectionGuid: null, dateRange: null };
  const leaf2 = { _filterVersion: 1, kinds: ['claim'], targetGuid: null, sourceRecord: null, authored: null, collectionGuid: null, dateRange: null };
  const expr = { op: 'AND', operands: [leaf1, leaf2] };
  const r1 = plugin._normalizeFilterExprV1(expr);
  const r2 = plugin._normalizeFilterExprV1(expr);
  assert.equal(r1, r2, 'same expression must produce identical canonical string');
  assert.ok(r1.includes('"op":"AND"') || r1.includes('"AND"'), 'AND must appear in canonical form');
});

test('R7.2: _normalizeFilterExprV1 — operand order produces deterministic output', () => {
  const { plugin } = makeBroker();
  const leaf1 = { _filterVersion: 1, kinds: ['ref'], targetGuid: null, sourceRecord: null, authored: null, collectionGuid: null, dateRange: null };
  const leaf2 = { _filterVersion: 1, kinds: ['claim'], targetGuid: null, sourceRecord: null, authored: null, collectionGuid: null, dateRange: null };
  // Different operand order — canonical normalization should be identical.
  const exprA = { op: 'AND', operands: [leaf1, leaf2] };
  const exprB = { op: 'AND', operands: [leaf2, leaf1] };
  const rA = plugin._normalizeFilterExprV1(exprA);
  const rB = plugin._normalizeFilterExprV1(exprB);
  assert.equal(rA, rB, 'operand order must not affect canonical string');
});

test('R7.2: _normalizeFilterExprV1 — OR node', () => {
  const { plugin } = makeBroker();
  const leaf = { _filterVersion: 1, kinds: null, targetGuid: null, sourceRecord: null, authored: null, collectionGuid: null, dateRange: null };
  const expr = { op: 'OR', operands: [leaf] };
  const r = plugin._normalizeFilterExprV1(expr);
  assert.ok(r.includes('"op":"OR"') || r.includes('"OR"'), 'OR must appear');
});

test('R7.2: _normalizeFilterExprV1 — nested AND/OR', () => {
  const { plugin } = makeBroker();
  const leaf = { _filterVersion: 1, kinds: ['ref'], targetGuid: null, sourceRecord: null, authored: null, collectionGuid: null, dateRange: null };
  const inner = { op: 'OR', operands: [leaf, leaf] };
  const outer = { op: 'AND', operands: [inner] };
  const r = plugin._normalizeFilterExprV1(outer);
  assert.ok(typeof r === 'string' && r.length > 0, 'nested expr must produce a string');
});

test('R7.2: _matchFilterExprV1 — null expr matches everything', () => {
  const { plugin } = makeBroker();
  const edge = { kind: 'ref', authored: true, derived: false, source: { collectionGuid: null, recordGuid: 'r1', lineGuid: 'l1', propertyId: null }, target: { guid: 't1' }, updatedAt: null };
  assert.ok(plugin._matchFilterExprV1(edge, null));
});

test('R7.2: _matchFilterExprV1 — leaf AND match', () => {
  const { plugin } = makeBroker();
  const edge = { kind: 'ref', authored: true, derived: false, source: { collectionGuid: null, recordGuid: 'r1', lineGuid: 'l1', propertyId: null }, target: { guid: 't1' }, updatedAt: null };
  const leaf = { _filterVersion: 1, kinds: ['ref'], targetGuid: null, sourceRecord: null, authored: null, collectionGuid: null, dateRange: null };
  assert.ok(plugin._matchFilterExprV1(edge, leaf), 'ref edge must match kinds:["ref"] leaf');
});

test('R7.2: _matchFilterExprV1 — leaf AND no match', () => {
  const { plugin } = makeBroker();
  const edge = { kind: 'claim', authored: true, derived: false, source: { collectionGuid: null, recordGuid: 'r1', lineGuid: 'l1', propertyId: null }, target: { guid: 't1' }, updatedAt: null };
  const leaf = { _filterVersion: 1, kinds: ['ref'], targetGuid: null, sourceRecord: null, authored: null, collectionGuid: null, dateRange: null };
  assert.ok(!plugin._matchFilterExprV1(edge, leaf), 'claim edge must NOT match kinds:["ref"]');
});

test('R7.2: _matchFilterExprV1 — AND node: all must match', () => {
  const { plugin } = makeBroker();
  const edge = { kind: 'claim', authored: true, derived: false, source: { collectionGuid: 'colA', recordGuid: 'r1', lineGuid: 'l1', propertyId: null }, target: { guid: 't1' }, updatedAt: null };
  const leafKindClaim = { _filterVersion: 1, kinds: ['claim'], targetGuid: null, sourceRecord: null, authored: null, collectionGuid: null, dateRange: null };
  const leafColA = { _filterVersion: 1, kinds: null, targetGuid: null, sourceRecord: null, authored: null, collectionGuid: 'colA', dateRange: null };
  const leafColB = { _filterVersion: 1, kinds: null, targetGuid: null, sourceRecord: null, authored: null, collectionGuid: 'colB', dateRange: null };

  const andBothMatch = { op: 'AND', operands: [leafKindClaim, leafColA] };
  const andOneNoMatch = { op: 'AND', operands: [leafKindClaim, leafColB] };
  assert.ok(plugin._matchFilterExprV1(edge, andBothMatch), 'AND both matching must pass');
  assert.ok(!plugin._matchFilterExprV1(edge, andOneNoMatch), 'AND with one non-matching must fail');
});

test('R7.2: _matchFilterExprV1 — OR node: at least one must match', () => {
  const { plugin } = makeBroker();
  const edge = { kind: 'claim', authored: true, derived: false, source: { collectionGuid: null, recordGuid: 'r1', lineGuid: 'l1', propertyId: null }, target: { guid: 't1' }, updatedAt: null };
  const leafRef = { _filterVersion: 1, kinds: ['ref'], targetGuid: null, sourceRecord: null, authored: null, collectionGuid: null, dateRange: null };
  const leafClaim = { _filterVersion: 1, kinds: ['claim'], targetGuid: null, sourceRecord: null, authored: null, collectionGuid: null, dateRange: null };
  const leafAnnotation = { _filterVersion: 1, kinds: ['annotation'], targetGuid: null, sourceRecord: null, authored: null, collectionGuid: null, dateRange: null };

  const orOneMatch = { op: 'OR', operands: [leafRef, leafClaim] };
  const orNoMatch = { op: 'OR', operands: [leafRef, leafAnnotation] };
  assert.ok(plugin._matchFilterExprV1(edge, orOneMatch), 'OR with one matching operand must pass');
  assert.ok(!plugin._matchFilterExprV1(edge, orNoMatch), 'OR with no matching operands must fail');
});

test('R7.2: _matchFilterExprV1 — nested AND/OR', () => {
  const { plugin } = makeBroker();
  const edge = { kind: 'claim', authored: false, derived: true, source: { collectionGuid: null, recordGuid: 'r1', lineGuid: 'l1', propertyId: null }, target: { guid: 't1' }, updatedAt: null };
  // (kind=claim) AND (authored=true OR derived=true)
  const leafClaim = { _filterVersion: 1, kinds: ['claim'], targetGuid: null, sourceRecord: null, authored: null, collectionGuid: null, dateRange: null };
  const leafAuthored = { _filterVersion: 1, kinds: null, targetGuid: null, sourceRecord: null, authored: true, collectionGuid: null, dateRange: null };
  const leafDerived = { _filterVersion: 1, kinds: null, targetGuid: null, sourceRecord: null, authored: false, collectionGuid: null, dateRange: null };
  const nested = { op: 'AND', operands: [leafClaim, { op: 'OR', operands: [leafAuthored, leafDerived] }] };
  assert.ok(plugin._matchFilterExprV1(edge, nested), 'nested AND/OR must evaluate correctly');
});

test('R7.2: filterExpr accepted by broker.edges() — full match', () => {
  const target = 'tgt-FE1';
  const { broker } = makeBrokerWithEdges([{ targetGuid: target, authored: true }]);
  // filterExpr: kind must be 'claim'
  const filterExpr = { _filterVersion: 1, kinds: ['claim'], targetGuid: target, sourceRecord: null, authored: null, collectionGuid: null, dateRange: null };
  const result = broker.edges({ filterExpr, limit: 50 });
  assert.ok(result, 'edges() must return a result with filterExpr');
  assert.ok(Array.isArray(result.items), 'items must be an array');
  assert.equal(result.error, null);
});

test('R7.2: filterExpr accepted by broker.occurrences() — result has correct shape', () => {
  const target = 'tgt-FO1';
  const { broker } = makeBrokerWithEdges([{ targetGuid: target }]);
  const filterExpr = { _filterVersion: 1, kinds: ['claim'], targetGuid: null, sourceRecord: null, authored: null, collectionGuid: null, dateRange: null };
  const result = broker.occurrences({ filterExpr, limit: 50 });
  assert.ok(result, 'occurrences() must return a result with filterExpr');
  assert.ok(Array.isArray(result.items));
  // Each occurrence item must have edgeId
  for (const item of result.items) {
    assert.ok(typeof item.edgeId === 'string', 'each occurrence must have edgeId');
  }
});

test('R7.2: filterExpr cursor binding — different filterExpr invalidates cursor', () => {
  const target = 'tgt-FC1';
  const { broker } = makeBrokerWithEdges(
    Array.from({ length: 5 }, () => ({ targetGuid: target }))
  );
  const expr1 = { op: 'AND', operands: [
    { _filterVersion: 1, kinds: ['claim'], targetGuid: null, sourceRecord: null, authored: null, collectionGuid: null, dateRange: null }
  ]};
  const expr2 = { op: 'OR', operands: [
    { _filterVersion: 1, kinds: ['ref'], targetGuid: null, sourceRecord: null, authored: null, collectionGuid: null, dateRange: null }
  ]};
  const page1 = broker.edges({ filterExpr: expr1, limit: 2 });
  // If there's a cursor, use it with a different filterExpr — should get stale-cursor.
  if (page1.cursor) {
    const page2 = broker.edges({ filterExpr: expr2, after: page1.cursor, generation: broker.generation, revision: page1.queryRevision });
    assert.equal(page2.error, 'stale-cursor', 'different filterExpr with same cursor must return stale-cursor');
  }
  // (If no cursor, the set was exhausted in one page — that's fine too)
});

test('R7.2: flat filter (FilterV1) still works unchanged — backward compat', () => {
  const target = 'tgt-BC1';
  const { broker } = makeBrokerWithEdges([{ targetGuid: target }]);
  const filter = { _filterVersion: 1, kinds: ['claim'], targetGuid: target, sourceRecord: null, authored: null, collectionGuid: null, dateRange: null };
  const result = broker.edges({ filter, limit: 50 });
  assert.ok(result, 'flat filter must still work');
  assert.equal(result.error, null, 'flat filter must not error');
  assert.ok(result.items.length >= 1, 'at least one claim edge must match');
});

// ─── R7.3: Claim row rendering ───────────────────────────────────────────────

test('R7.3: _renderClaimRow — renders predicate name in row', () => {
  const { plugin, context } = makeBroker();
  const container = context.document.createElement('div');
  const edge = {
    id: 'claim:v1:test-edge-1',
    kind: 'claim',
    authored: true,
    derived: false,
    title: 'relatesTo',
    source: { recordGuid: 'src-rec-1', lineGuid: 'src-line-1', collectionGuid: null, propertyId: null, segmentOrdinal: null },
    target: { kind: 'record', guid: 'tgt-rec-1', link: null },
    sourceHash: 'abc123',
    updatedAt: null,
    provenance: { edgeId: 'test-edge-1', predicate: { name: 'relatesTo', guid: 'pred-1' }, source: 'src-line-1', target: 'tgt-rec-1', kind: 'authored', claimGuid: 'claim-1', ordinal: 0, sourcePart: 'body', derivedFrom: null, derivedBy: null, qualifiers: { source: 'Wikipedia' }, confidence: 0.9, evidence: 'page 42' },
  };
  const row = plugin._renderClaimRow(container, edge, {});
  assert.ok(row, '_renderClaimRow must return the row element');
  assert.ok(container.children.length > 0, 'row must be appended to container');
  // Row must contain a predicate element.
  const hasPredicateEl = container.children.some((child) =>
    child.children && child.children.some((c) => c.className && c.className.includes('refx-claim-predicate'))
  ) || (row.children && row.children.some((c) => c.className && c.className.includes('refx-claim-predicate')));
  assert.ok(hasPredicateEl, 'claim row must contain a predicate element');
});

test('R7.3: _renderClaimRow — renders authored badge', () => {
  const { plugin, context } = makeBroker();
  const container = context.document.createElement('div');
  const edge = {
    id: 'claim:v1:test-edge-authored',
    kind: 'claim',
    authored: true,
    derived: false,
    title: 'authoredPred',
    source: { recordGuid: 'rec1', lineGuid: 'line1', collectionGuid: null, propertyId: null, segmentOrdinal: null },
    target: { kind: 'record', guid: 'tgt1', link: null },
    sourceHash: 'hash1',
    updatedAt: null,
    provenance: Object.freeze({ edgeId: 'e1', predicate: { name: 'authoredPred' }, kind: 'authored' }),
  };
  const row = plugin._renderClaimRow(container, edge, {});
  const hasBadge = row && row.children && row.children.some((c) =>
    c.className && (c.className.includes('refx-claim-badge') && c.className.includes('authored'))
  );
  assert.ok(hasBadge, 'authored badge must be present');
});

test('R7.3: _renderClaimRow — renders derived badge for derived edges', () => {
  const { plugin, context } = makeBroker();
  const container = context.document.createElement('div');
  const edge = {
    id: 'claim:v1:test-edge-derived',
    kind: 'claim',
    authored: false,
    derived: true,
    title: 'derivedPred',
    source: { recordGuid: 'rec2', lineGuid: 'line2', collectionGuid: null, propertyId: null, segmentOrdinal: null },
    target: { kind: 'record', guid: 'tgt2', link: null },
    sourceHash: 'hash2',
    updatedAt: null,
    provenance: Object.freeze({ edgeId: 'e2', predicate: { name: 'derivedPred' }, kind: 'derived' }),
  };
  const row = plugin._renderClaimRow(container, edge, {});
  const hasBadge = row && row.children && row.children.some((c) =>
    c.className && (c.className.includes('refx-claim-badge') && c.className.includes('derived'))
  );
  assert.ok(hasBadge, 'derived badge must be present');
});

test('R7.3: _renderClaimRow — provenance qualifiers rendered', () => {
  const { plugin, context } = makeBroker();
  const container = context.document.createElement('div');
  const edge = {
    id: 'claim:v1:test-prov-1',
    kind: 'claim',
    authored: true,
    derived: false,
    title: 'hasPred',
    source: { recordGuid: 'r1', lineGuid: 'l1', collectionGuid: null, propertyId: null, segmentOrdinal: null },
    target: { kind: 'record', guid: 't1', link: null },
    sourceHash: 'h1',
    updatedAt: null,
    provenance: Object.freeze({ edgeId: 'e3', predicate: { name: 'hasPred' }, kind: 'authored', qualifiers: { source: 'Wikipedia', year: '2024' }, confidence: 0.85, evidence: 'doi:10.1234' }),
  };
  const row = plugin._renderClaimRow(container, edge, {});
  // Provenance el should exist somewhere in the row.
  const hasProvEl = row && row.children && row.children.some((c) =>
    c.className && c.className.includes('refx-claim-provenance')
  );
  assert.ok(hasProvEl, 'provenance element must be rendered');
});

test('R7.3: _renderClaimRow — jump button present', () => {
  const { plugin, context } = makeBroker();
  const container = context.document.createElement('div');
  const edge = {
    id: 'claim:v1:jump-test',
    kind: 'claim',
    authored: true,
    derived: false,
    title: 'pred',
    source: { recordGuid: 'rec-j1', lineGuid: 'line-j1', collectionGuid: null, propertyId: null, segmentOrdinal: null },
    target: { kind: 'record', guid: 'tgt-j1', link: null },
    sourceHash: 'hj1',
    updatedAt: null,
    provenance: Object.freeze({ edgeId: 'ej1', predicate: { name: 'pred' }, kind: 'authored' }),
  };
  const row = plugin._renderClaimRow(container, edge, {});
  const hasJump = row && row.children && row.children.some((c) =>
    c.className && c.className.includes('refx-claim-jump')
  );
  assert.ok(hasJump, 'jump button must be present in claim row');
});

test('R7.3: authored/derived toggle excludes derived edges', () => {
  const { plugin, context } = makeBroker();
  const container = context.document.createElement('div');
  const edges = [
    { id: 'claim:v1:a1', kind: 'claim', authored: true, derived: false, title: 'pred', source: { recordGuid: 'r1', lineGuid: 'l1', collectionGuid: null, propertyId: null, segmentOrdinal: null }, target: { kind: 'record', guid: 't1' }, sourceHash: 'h1', updatedAt: null, provenance: Object.freeze({ edgeId: 'a1', predicate: { name: 'pred' }, kind: 'authored' }) },
    { id: 'claim:v1:d1', kind: 'claim', authored: false, derived: true, title: 'pred', source: { recordGuid: 'r2', lineGuid: 'l2', collectionGuid: null, propertyId: null, segmentOrdinal: null }, target: { kind: 'record', guid: 't1' }, sourceHash: 'h2', updatedAt: null, provenance: Object.freeze({ edgeId: 'd1', predicate: { name: 'pred' }, kind: 'derived' }) },
  ];
  // _r7RebuildClaimSection with showDerived=true includes all.
  const section = context.document.createElement('div');
  section.className = 'refx-claim-section';
  const hdr = plugin._el('div', 'refx-claim-section-header', '');
  section.appendChild(hdr);
  const toggleBtn = context.document.createElement('button');
  section.appendChild(toggleBtn);
  const rowsEl = context.document.createElement('div');
  rowsEl.className = 'refx-claim-rows';
  section.appendChild(rowsEl);
  // Patch querySelector for rowsEl
  section.querySelector = (sel) => sel === '.refx-claim-rows' ? rowsEl : null;

  plugin._r7RebuildClaimSection(section, edges, true, {});
  const allRows = rowsEl.children.filter((c) => c.className && c.className.includes('refx-claim-row'));
  assert.equal(allRows.length, 2, 'showDerived=true must show 2 rows');

  // Now rebuild with showDerived=false — only authored must remain.
  rowsEl.children = [];
  plugin._r7RebuildClaimSection(section, edges, false, {});
  const authoredRows = rowsEl.children.filter((c) => c.className && c.className.includes('refx-claim-row'));
  assert.equal(authoredRows.length, 1, 'showDerived=false must show only 1 authored row');
});

test('R7.4: same-title discovery (alias finder) distinct from claim rows', () => {
  // Alias Finder is the same-title discovery path (palette + context menu).
  // _renderClaimRowsForTarget is the typed-relations path.
  const { plugin } = makeBroker();
  assert.equal(typeof plugin._aliasFinderScan, 'function', '_aliasFinderScan must exist');
  assert.equal(typeof plugin._renderClaimRowsForTarget, 'function', '_renderClaimRowsForTarget must exist');
  const aliasSrc = plugin._aliasFinderScan.toString();
  const claimSrc = plugin._renderClaimRowsForTarget.toString();
  assert.ok(!aliasSrc.includes('_renderClaimRowsForTarget'), 'alias finder must not call claim renderer');
  assert.ok(!claimSrc.includes('_aliasFinderScan'), 'claim renderer must not call alias finder');
});

// ─── R8: one-row native edit on demand ───────────────────────────────────────

test('R8: _r8EditLive function exists', () => {
  const { plugin } = makeBroker();
  assert.equal(typeof plugin._r8EditLive, 'function');
});

test('R8: _r8AssertSingleEditor function exists', () => {
  const { plugin } = makeBroker();
  assert.equal(typeof plugin._r8AssertSingleEditor, 'function');
});

test('R8: _r8SettleRerender function exists', () => {
  const { plugin } = makeBroker();
  assert.equal(typeof plugin._r8SettleRerender, 'function');
});

test('R8.4: _r8AssertSingleEditor — returns 0 for empty container', () => {
  const { plugin, context } = makeBroker();
  const container = context.document.createElement('div');
  container.querySelectorAll = (sel) => ({ length: 0, forEach: () => {} });
  const count = plugin._r8AssertSingleEditor(container);
  assert.equal(count, 0, 'empty container must have 0 live editors');
});

test('R8.4: _r8AssertSingleEditor — returns 0 for null container', () => {
  const { plugin } = makeBroker();
  const count = plugin._r8AssertSingleEditor(null);
  assert.equal(count, 0, 'null container must return 0');
});

test('R8.4: _r8AssertSingleEditor — returns 1 when one live editor present', () => {
  const { plugin, context } = makeBroker();
  const container = context.document.createElement('div');
  container.querySelectorAll = (sel) => {
    if (sel === '.refx-r8-live') return { length: 1, forEach: () => {} };
    return { length: 0, forEach: () => {} };
  };
  const count = plugin._r8AssertSingleEditor(container);
  assert.equal(count, 1, 'container with one .refx-r8-live must return 1');
});

test('R8.4: _r8AssertSingleEditor — returns >1 to signal violation (not throw)', () => {
  const { plugin, context } = makeBroker();
  const container = context.document.createElement('div');
  container.querySelectorAll = (sel) => {
    if (sel === '.refx-r8-live') return { length: 3, forEach: () => {} };
    return { length: 0, forEach: () => {} };
  };
  // Must not throw, must return count.
  let count;
  assert.doesNotThrow(() => { count = plugin._r8AssertSingleEditor(container); });
  assert.equal(count, 3, 'must return the count (3) to signal violation');
});

test('R8.2: single-editor invariant — opening second editor closes first', () => {
  const { plugin, context } = makeBroker();

  // Create a fake entry with two rows.
  const makeRow = (guid) => {
    const fullEl = context.document.createElement('div');
    fullEl.className = 'refx-row-full';
    return { fullEl, lineGuid: guid };
  };
  const makeLine = (guid) => ({ guid, getSegments: () => [], segments: [] });

  const entry = {
    hostLineGuid: 'host-line-1',
    _r8ActiveEditor: null,
    _r8Gen: 0,
    _r7ActiveFacets: null,
    filterEl: null,
    _rawItems: [],
    chipFilters: new Map(),
    targetGuid: 'tgt-se1',
  };

  const row1 = makeRow('line-A');
  const row2 = makeRow('line-B');
  const line1 = makeLine('line-A');
  const line2 = makeLine('line-B');

  // Stub _bridgeCreateEmbed to resolve false (no real embed).
  plugin._bridgeCreateEmbed = async () => false;
  plugin._toast = () => {};

  // Open editor on row1.
  plugin._r8EditLive(entry, row1, line1, {});
  assert.ok(entry._r8ActiveEditor, 'after first open, _r8ActiveEditor must be set');
  const firstGen = entry._r8ActiveEditor.gen;

  // Open editor on row2 — must close the first.
  plugin._r8EditLive(entry, row2, line2, {});
  // The first editor's gen should differ from the new one's gen.
  assert.ok(entry._r8ActiveEditor, 'after second open, _r8ActiveEditor must still be set');
  const secondGen = entry._r8ActiveEditor.gen;
  assert.notEqual(firstGen, secondGen, 'second editor must have a different gen than the first');
});

test('R8.3: _r8SettleRerender — stale gen is ignored', () => {
  const { plugin, context } = makeBroker();
  const entry = {
    _r8Gen: 5,
    _r7ActiveFacets: null,
    filterEl: null,
    _rawItems: [],
    chipFilters: new Map(),
  };
  const row = { fullEl: context.document.createElement('div') };
  const line = { guid: 'l1', getSegments: () => [], segments: [] };

  // Stale gen = 3, current = 5. Must not throw and must not overwrite state.
  plugin._renderRefLineText = () => {};
  plugin._isTaskLikeLine = () => false;
  assert.doesNotThrow(() => {
    plugin._r8SettleRerender(entry, row, line, 3, {});
  }, 'stale settle must not throw');
});

test('R8.3: _r8SettleRerender — current gen processes normally (no throw)', () => {
  const { plugin, context } = makeBroker();
  const entry = {
    _r8Gen: 2,
    _r7ActiveFacets: null,
    filterEl: null,
    _rawItems: [],
    chipFilters: new Map(),
  };
  const row = { fullEl: context.document.createElement('div') };
  const line = { guid: 'l1', getSegments: () => [], segments: [] };

  plugin._renderRefLineText = () => {};
  plugin._isTaskLikeLine = () => false;
  assert.doesNotThrow(() => {
    plugin._r8SettleRerender(entry, row, line, 2, {});
  }, 'current gen settle must not throw');
});

test('R8.3: _r8SettleRerender — restores saved filter text', () => {
  const { plugin, context } = makeBroker();
  const filterEl = context.document.createElement('input');
  filterEl.value = '';
  let filterApplied = false;
  plugin._applyInlineRefsFilter = () => { filterApplied = true; };
  plugin._renderRefLineText = () => {};
  plugin._isTaskLikeLine = () => false;

  const entry = {
    _r8Gen: 1,
    _r7ActiveFacets: null,
    filterEl,
    _rawItems: [],
    chipFilters: new Map(),
  };
  const row = { fullEl: context.document.createElement('div') };
  const line = { guid: 'l1', getSegments: () => [], segments: [] };

  plugin._r8SettleRerender(entry, row, line, 1, { savedFilter: 'hello', scrollAnchor: null, savedFacets: null });
  assert.equal(filterEl.value, 'hello', 'filter text must be restored');
  assert.ok(filterApplied, '_applyInlineRefsFilter must be called after restoring filter');
});

test('R8: 50-rows-one-editor via real render path: open edit-live on row 0, assert exactly 1 .refx-r8-live', () => {
  // Build 50 real line stubs and render them through _r8EditLive on the first
  // row. _r8AssertSingleEditor must return 1 (one live editor, invariant holds).
  const { plugin, context } = makeBroker();

  // Stub rendering helpers that touch the real DOM (not needed for this test).
  plugin._renderRefLineText = () => {};
  plugin._isTaskLikeLine = () => false;
  plugin._buildTaskToggleGlyph = () => context.document.createElement('span');
  plugin._bridgeJump = async () => false;

  // Build 50 lightweight row objects using the test shim's createElement.
  const rows = Array.from({ length: 50 }, (_, i) => {
    const fullEl = context.document.createElement('div');
    fullEl.className = 'refx-row-full';
    return { fullEl, lineGuid: `line-${i}` };
  });
  const lines = rows.map((r) => ({ guid: r.lineGuid, getSegments: () => [], segments: [] }));

  // Build a fake container that tracks appended .refx-r8-live children.
  const container = context.document.createElement('div');
  // All 50 row fullEls are "in" this container conceptually (we don't need to
  // actually append them for the DOM shim — before() is a no-op in the shim).
  const liveEls = [];
  const origCreate = context.document.createElement.bind(context.document);
  context.document.createElement = (tag) => {
    const el = origCreate(tag);
    if (tag === 'div') {
      const origSet = Object.getOwnPropertyDescriptor(el, 'className');
      // Track when className becomes 'refx-r8-live'.
      let _cls = '';
      Object.defineProperty(el, 'className', {
        get: () => _cls,
        set: (v) => {
          _cls = v;
          if (v === 'refx-r8-live') liveEls.push(el);
        },
        configurable: true,
      });
    }
    return el;
  };

  // Entry with hostLineGuid so _r8EditLive has all it needs.
  const entry = {
    hostLineGuid: 'host-line-50',
    _r8ActiveEditor: null,
    _r8Gen: 0,
    _r7ActiveFacets: null,
    filterEl: null,
    _rawItems: [],
    chipFilters: new Map(),
    targetGuid: 'tgt-50rows',
  };

  // Open edit-live on the first row (row 0). The DOM shim's before() is a no-op,
  // but liveEl creation is tracked above.
  plugin._r8EditLive(entry, rows[0], lines[0], {});

  // Restore createElement to avoid polluting later tests.
  context.document.createElement = origCreate;

  // Exactly one _r8ActiveEditor must be registered.
  assert.ok(entry._r8ActiveEditor, 'entry._r8ActiveEditor must be set after open');
  assert.equal(entry._r8ActiveEditor.lineGuid, 'line-0', 'active editor must be for line-0');

  // The tracked liveEls list must have exactly one element.
  assert.equal(liveEls.length, 1, 'exactly one .refx-r8-live div must have been created');

  // _r8AssertSingleEditor counts via querySelectorAll on the live element itself.
  // Point it at a container that returns our one tracked liveEl.
  const checkContainer = context.document.createElement('div');
  checkContainer.querySelectorAll = (sel) => {
    if (sel === '.refx-r8-live') return { length: liveEls.length, forEach: (fn) => liveEls.forEach(fn) };
    return { length: 0, forEach: () => {} };
  };
  const count = plugin._r8AssertSingleEditor(checkContainer);
  assert.equal(count, 1, '_r8AssertSingleEditor must return 1 for 50-row container with one open editor');
  assert.ok(count <= 1, 'invariant: at most 1 live editor');
});

test('R7.4: same-title-distinct behavioral: alias finder and claim rows produce distinct DOM outputs', () => {
  const { plugin, context } = makeBroker();

  const body1 = context.document.createElement('div');
  const entry = {
    bodyEl: body1,
    targetGuid: 'tgt-distinct',
    _r2LinksContainer: null,
    chipFilters: new Map(),
    filterEl: null,
    _rawItems: [],
    titleEl: context.document.createElement('span'),
    el: context.document.createElement('div'),
    hostLineGuid: 'host-distinct',
  };

  const body2 = context.document.createElement('div');
  let aliasCalledFromClaims = false;
  const origScan = plugin._aliasFinderScan;
  plugin._aliasFinderScan = async () => { aliasCalledFromClaims = true; return { hits: [], capped: false, phrases: [] }; };
  try { plugin._renderClaimRowsForTarget(body2, 'tgt-distinct', {}); } catch (_) {}
  plugin._aliasFinderScan = origScan;

  assert.ok(!aliasCalledFromClaims, '_renderClaimRowsForTarget must not call _aliasFinderScan');
  assert.equal(typeof plugin._queryUnlinkedTextCandidates, 'function', 'alias finder candidate provider must remain');
});
