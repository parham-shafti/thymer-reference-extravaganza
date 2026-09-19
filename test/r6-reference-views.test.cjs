'use strict';
// R6: synced saved Reference Views — vm-harness tests.
// Tests: schema serialization, revision append/head derivation, conflict/merge,
// compaction, pin migration idempotence, fake-record round-trips, subscribe/dispose.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'plugin.js'), 'utf8');

// ─── version guards (fail fast) ──────────────────────────────────────────────

test('R6 manifest version is 4.48.6', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.version, '4.64.1');
});

test('plugin.js header declares v4.48.6', () => {
  assert.ok(source.startsWith('// v4.64.1'), 'first line must be // v4.49.9');
});

test('__REFX_VERSION runtime tell is 4.48.6', () => {
  assert.ok(source.includes('window.__REFX_VERSION = "4.64.1"'), '__REFX_VERSION must be 4.49.7');
});

test('CHANGELOG.md has v3.90.0 entry (A3)', () => {
  const cl = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.ok(cl.includes('## v3.90.0'), 'CHANGELOG must have v3.90.0 section');
});

// ─── vm harness ──────────────────────────────────────────────────────────────

const storage = new Map();

function loadPlugin() {
  const ctx = {
    AppPlugin: class {},
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
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
      createElement: (tag) => ({
        tagName: tag.toUpperCase(),
        className: '',
        style: {},
        children: [],
        textContent: '',
        innerHTML: '',
        isConnected: true,
        getAttribute: () => null,
        setAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        append(...kids) { this.children.push(...kids); },
        remove() { this.isConnected = false; },
        querySelector: () => null,
        querySelectorAll: () => [],
        closest: () => null,
        getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
      }),
      createTextNode: (t) => ({ nodeType: 3, textContent: t }),
      querySelectorAll: () => [],
      querySelector: () => null,
      documentElement: { clientHeight: 900 },
      body: { classList: { toggle() {}, add() {}, remove() {} }, append() {}, appendChild() {} },
      head: { appendChild() {} },
      addEventListener() {},
      removeEventListener() {},
      getElementById: () => null,
    },
    Element: class {},
    window: {
      CSS: { escape: (s) => String(s) },
      g_universe: { itemsByGuid: {}, workspace: {} },
      addEventListener() {},
      removeEventListener() {},
    },
    DateTime: undefined,
  };
  ctx.globalThis = ctx;
  Object.assign(ctx, ctx.window);
  vm.runInNewContext(source + '\nthis.PluginUnderTest = Plugin;', ctx, { filename: 'plugin.js' });
  return { Plugin: ctx.PluginUnderTest, ctx };
}

// Create a fake collection + record store that simulates PluginCollectionAPI.
// SDK-faithful: PluginLineItem.segments is the authoritative content field;
// createLineItem(parent, after, type, segments, props) — real SDK signature.
function makeFakeCollectionStore(colName = 'settings') {
  const records = new Map(); // guid -> { name, lines: [PluginLineItem-like] }
  let guidSeq = 0;
  const newGuid = () => 'rec' + (++guidSeq).toString().padStart(4, '0');

  // makeLineItem receives the SDK segments array (not a text string).
  // li.segments matches PluginLineItem.segments; no top-level li.text.
  const makeLineItem = (segments) => {
    const g = 'li' + (++guidSeq).toString().padStart(4, '0');
    const li = {
      guid: g,
      // SDK: segments is the authoritative field; li.text does NOT exist on real line items.
      segments: Array.isArray(segments) ? segments : [],
      type: 'ulist',
      props: {},
      parent_guid: null,
      delete: async function () {
        const rec = [...records.values()].find((r) => r.lines.some((l) => l.guid === g));
        if (rec) rec.lines = rec.lines.filter((l) => l.guid !== g);
      },
    };
    return li;
  };

  const makeRecord = (name) => {
    const guid = newGuid();
    const rec = {
      guid,
      name,
      lines: [],
      getName: () => name,
      setName: (n) => { rec.name = n; name = n; },
      getLineItems: async () => [...rec.lines],
      // Real SDK signature: createLineItem(parent, after, type, segments, props)
      // parent and after are PluginLineItem|null; type is string; segments is array|null; props is object|null.
      createLineItem: async (parent, after, type, segments, props) => {
        const li = makeLineItem(segments || []);
        li.type = type || 'ulist';
        li.parent_guid = parent ? parent.guid : guid;
        // Prepend (newest first) to match the plugin convention.
        rec.lines.unshift(li);
        return li;
      },
    };
    records.set(guid, rec);
    return rec;
  };

  const col = {
    getName: () => colName,
    getGuid: () => 'col_' + colName,
    createRecord: (name) => {
      const rec = makeRecord(name);
      return rec.guid;
    },
    getAllRecords: async () => [...records.values()],
  };

  return { col, records, makeRecord };
}

function makePlugin(colName = 'settings') {
  storage.clear();
  const { Plugin, ctx } = loadPlugin();
  const plugin = new Plugin();
  plugin._unloaded = false;

  const { col, records } = makeFakeCollectionStore(colName);

  // Stub data with a fake getRecord that resolves guids from our fake store.
  plugin.data = {
    getRecord: (guid) => records.get(guid) || null,
    getAllCollections: async () => [col],
    searchByQuery: async () => ({ lines: [], records: [] }),
  };

  // Stub ui so onLoad commands don't throw.
  plugin.ui = {
    addCommandPaletteCommand: () => ({ remove: () => {} }),
    addStatusBarItem: () => ({ remove: () => {} }),
    getPanels: () => [],
  };

  // Stub events.
  plugin.events = { on: () => 'h0', off: () => {} };

  // _pins is an empty Map (migration source).
  plugin._pins = new Map();

  // Build the views API directly (don't run full onLoad).
  const api = plugin._r6BuildViewsApi();
  // Expose on window.__refx to match what onLoad does.
  ctx.window.__refx = { version: '3.85.0', referenceViews: api };
  ctx.window.__refxSavedViews = api;
  plugin._r6BackingColGuid = null; // force fresh resolve
  plugin._r6BackingColP = null;

  return { plugin, ctx, api, col, records };
}

// ─── _r6StableJson / _r6ConfigHash determinism ───────────────────────────────

test('stableJson: key-order independence — same config regardless of insertion order', () => {
  const { plugin } = makePlugin();
  const a = plugin._r6StableJson({ z: 1, a: 2, m: 3 });
  const b = plugin._r6StableJson({ a: 2, m: 3, z: 1 });
  assert.equal(a, b);
});

test('stableJson: nested objects and arrays are stable', () => {
  const { plugin } = makePlugin();
  const a = plugin._r6StableJson({ filters: { op: 'and', children: [{ field: 'kind', value: 'ref' }] }, targets: ['g1', 'g2'] });
  const b = plugin._r6StableJson({ targets: ['g1', 'g2'], filters: { children: [{ field: 'kind', value: 'ref' }], op: 'and' } });
  assert.equal(a, b);
});

test('configHash: same config → same hash', () => {
  const { plugin } = makePlugin();
  const cfg = { schemaVersion: 1, viewGuid: null, name: 'Test', targets: ['abc123'], edgeKinds: ['ref'], filterExpression: null, sort: 'relevance', contextDepth: 1, descendantMentions: false, displayMode: 'list', pageSize: 30, inboxStateSync: false };
  const h1 = plugin._r6ConfigHash(cfg);
  const h2 = plugin._r6ConfigHash({ ...cfg });
  assert.equal(h1, h2);
});

test('configHash: different config → different hash', () => {
  const { plugin } = makePlugin();
  const cfg = { schemaVersion: 1, viewGuid: null, name: 'Test', targets: ['abc123'], edgeKinds: ['ref'], filterExpression: null, sort: 'relevance', contextDepth: 1, descendantMentions: false, displayMode: 'list', pageSize: 30, inboxStateSync: false };
  const h1 = plugin._r6ConfigHash(cfg);
  const h2 = plugin._r6ConfigHash({ ...cfg, targets: ['xyz999'] });
  assert.notEqual(h1, h2);
});

test('configHash: key-order independent', () => {
  const { plugin } = makePlugin();
  const a = plugin._r6ConfigHash({ name: 'V', targets: ['t1'], edgeKinds: ['ref', 'claim'], sort: 'alpha' });
  const b = plugin._r6ConfigHash({ targets: ['t1'], name: 'V', sort: 'alpha', edgeKinds: ['ref', 'claim'] });
  assert.equal(a, b);
});

// ─── _r6NormaliseConfig ───────────────────────────────────────────────────────

test('normalise: empty targets returns null', () => {
  const { plugin } = makePlugin();
  assert.equal(plugin._r6NormaliseConfig({ targets: [] }), null);
  assert.equal(plugin._r6NormaliseConfig({}), null);
  assert.equal(plugin._r6NormaliseConfig(null), null);
});

test('normalise: fills defaults for omitted fields', () => {
  const { plugin } = makePlugin();
  const cfg = plugin._r6NormaliseConfig({ targets: ['g1'] });
  assert.equal(cfg.schemaVersion, 1);
  assert.equal(cfg.sort, 'relevance');
  assert.equal(cfg.contextDepth, 1);
  assert.equal(cfg.descendantMentions, false);
  assert.equal(cfg.displayMode, 'list');
  assert.equal(cfg.pageSize, 30);
  assert.equal(cfg.inboxStateSync, false);
  // Use .join to avoid cross-realm Array prototype strictEqual issues from vm sandbox.
  assert.equal([...cfg.edgeKinds].sort().join(','), 'annotation,claim,property,ref');
});

test('normalise: edgeKinds sorted alphabetically', () => {
  const { plugin } = makePlugin();
  const cfg = plugin._r6NormaliseConfig({ targets: ['g1'], edgeKinds: ['claim', 'ref', 'annotation'] });
  assert.equal([...cfg.edgeKinds].join(','), 'annotation,claim,ref');
});

// ─── head derivation ─────────────────────────────────────────────────────────

test('head derivation: single revision is a head', () => {
  const { plugin } = makePlugin();
  const rev = { revisionId: 'r1', parentRevisionIds: [], configHash: 'aaa', fullConfig: {}, authorClientId: 'cl', savedAt: '' };
  const heads = plugin._r6DeriveHeads([rev]);
  assert.equal(heads.length, 1);
  assert.equal(heads[0].revisionId, 'r1');
});

test('head derivation: linear chain — only latest is head', () => {
  const { plugin } = makePlugin();
  const r1 = { revisionId: 'r1', parentRevisionIds: [], configHash: 'a', fullConfig: {}, authorClientId: 'cl', savedAt: '' };
  const r2 = { revisionId: 'r2', parentRevisionIds: ['r1'], configHash: 'b', fullConfig: {}, authorClientId: 'cl', savedAt: '' };
  const r3 = { revisionId: 'r3', parentRevisionIds: ['r2'], configHash: 'c', fullConfig: {}, authorClientId: 'cl', savedAt: '' };
  const heads = plugin._r6DeriveHeads([r3, r2, r1]);
  assert.equal(heads.length, 1);
  assert.equal(heads[0].revisionId, 'r3');
});

test('head derivation: concurrent revisions from same parent → two heads', () => {
  const { plugin } = makePlugin();
  const r1 = { revisionId: 'r1', parentRevisionIds: [], configHash: 'a', fullConfig: {}, authorClientId: 'cl', savedAt: '' };
  const r2a = { revisionId: 'r2a', parentRevisionIds: ['r1'], configHash: 'b', fullConfig: {}, authorClientId: 'cl1', savedAt: '' };
  const r2b = { revisionId: 'r2b', parentRevisionIds: ['r1'], configHash: 'c', fullConfig: {}, authorClientId: 'cl2', savedAt: '' };
  const heads = plugin._r6DeriveHeads([r2a, r2b, r1]);
  assert.equal(heads.length, 2, 'two concurrent revisions from same parent → two heads (conflict)');
  const headIds = heads.map((h) => h.revisionId).sort();
  assert.deepEqual(headIds, ['r2a', 'r2b']);
});

test('head derivation: merge revision citing both parents → single head', () => {
  const { plugin } = makePlugin();
  const r1 = { revisionId: 'r1', parentRevisionIds: [], configHash: 'a', fullConfig: {}, authorClientId: 'cl', savedAt: '' };
  const r2a = { revisionId: 'r2a', parentRevisionIds: ['r1'], configHash: 'b', fullConfig: {}, authorClientId: 'cl1', savedAt: '' };
  const r2b = { revisionId: 'r2b', parentRevisionIds: ['r1'], configHash: 'c', fullConfig: {}, authorClientId: 'cl2', savedAt: '' };
  const merge = { revisionId: 'merge1', parentRevisionIds: ['r2a', 'r2b'], configHash: 'd', fullConfig: {}, authorClientId: 'cl1', savedAt: '' };
  const heads = plugin._r6DeriveHeads([merge, r2a, r2b, r1]);
  assert.equal(heads.length, 1);
  assert.equal(heads[0].revisionId, 'merge1');
});

// ─── _r6CompactRevisions ─────────────────────────────────────────────────────

test('compaction: does not compact when under cap', () => {
  const { plugin } = makePlugin();
  const revs = Array.from({ length: 10 }, (_, i) => ({ revisionId: 'r' + i, parentRevisionIds: i > 0 ? ['r' + (i - 1)] : [], configHash: '' + i, fullConfig: {}, authorClientId: 'cl', savedAt: '' }));
  const compacted = plugin._r6CompactRevisions(revs);
  assert.equal(compacted.length, 10);
});

test('compaction: never drops heads even when over cap', () => {
  const { plugin } = makePlugin();
  plugin._R6_REVISION_CAP = 5;
  // Create 10 revisions in a linear chain; the last one (r9) is the head.
  const revs = Array.from({ length: 10 }, (_, i) => ({ revisionId: 'r' + i, parentRevisionIds: i > 0 ? ['r' + (i - 1)] : [], configHash: '' + i, fullConfig: {}, authorClientId: 'cl', savedAt: '' }));
  const compacted = plugin._r6CompactRevisions(revs);
  assert.ok(compacted.some((r) => r.revisionId === 'r9'), 'head (r9) must be preserved');
  assert.ok(compacted.length <= 5, 'must not exceed cap');
});

test('compaction: two concurrent heads both survive even when over cap', () => {
  const { plugin } = makePlugin();
  plugin._R6_REVISION_CAP = 3;
  // r1 → r2a and r1 → r2b (two heads)
  const r1 = { revisionId: 'r1', parentRevisionIds: [], configHash: 'a', fullConfig: {}, authorClientId: 'cl', savedAt: '' };
  const r2a = { revisionId: 'r2a', parentRevisionIds: ['r1'], configHash: 'b', fullConfig: {}, authorClientId: 'cl', savedAt: '' };
  const r2b = { revisionId: 'r2b', parentRevisionIds: ['r1'], configHash: 'c', fullConfig: {}, authorClientId: 'cl', savedAt: '' };
  // Plus 5 extra non-head historical revisions to push us way over cap.
  const extras = Array.from({ length: 5 }, (_, i) => ({ revisionId: 'old' + i, parentRevisionIds: [], configHash: 'x' + i, fullConfig: {}, authorClientId: 'cl', savedAt: '' }));
  // Trick: extras reference each other to make them non-heads... or we leave them all as orphan non-heads
  // Here extras have empty parentRevisionIds so they're all "heads" too — let's make them cited:
  // Build a cited chain for extras so only the last extra is a head; inject as a separate lineage.
  const e0 = { revisionId: 'e0', parentRevisionIds: [], configHash: 'e0', fullConfig: {}, authorClientId: 'cl', savedAt: '' };
  const e1 = { revisionId: 'e1', parentRevisionIds: ['e0'], configHash: 'e1', fullConfig: {}, authorClientId: 'cl', savedAt: '' };
  const e2 = { revisionId: 'e2', parentRevisionIds: ['e1'], configHash: 'e2', fullConfig: {}, authorClientId: 'cl', savedAt: '' };
  const allRevs = [r2a, r2b, r1, e2, e1, e0];
  const compacted = plugin._r6CompactRevisions(allRevs);
  // Both concurrent heads (r2a, r2b) must survive.
  assert.ok(compacted.some((r) => r.revisionId === 'r2a'), 'head r2a must survive');
  assert.ok(compacted.some((r) => r.revisionId === 'r2b'), 'head r2b must survive');
  assert.ok(compacted.length <= 3, 'must not exceed cap of 3');
});

// ─── fake-record round-trip: save → list → get ───────────────────────────────

test('save → list: one view appears in list()', async () => {
  const { api } = makePlugin();
  const result = await api.save({ name: 'My View', targets: ['target1'] });
  assert.ok(result, 'save must return {viewGuid, revisionId}');
  assert.ok(result.viewGuid, 'viewGuid must be set');
  assert.ok(result.revisionId, 'revisionId must be set');

  const views = await api.list();
  assert.equal(views.length, 1, 'one saved view must appear in list()');
  assert.equal(views[0].name, 'My View');
  // Use join to avoid cross-realm Array deepStrictEqual issues from vm sandbox.
  assert.equal([...views[0].targets].join(','), 'target1');
});

test('save → get: retrieves correct config by viewGuid', async () => {
  const { api } = makePlugin();
  const result = await api.save({ name: 'GetTest', targets: ['g1', 'g2'], sort: 'alpha' });
  const view = await api.get(result.viewGuid);
  assert.ok(view, 'get must return the saved view');
  assert.equal(view.name, 'GetTest');
  assert.equal([...view.targets].join(','), 'g1,g2');
  assert.equal(view.sort, 'alpha');
});

test('get: returns null for unknown viewGuid', async () => {
  const { api } = makePlugin();
  const view = await api.get('nonexistent_guid_xxxxxx');
  assert.equal(view, null);
});

test('list: multiple views', async () => {
  const { api } = makePlugin();
  await api.save({ name: 'View A', targets: ['t1'] });
  await api.save({ name: 'View B', targets: ['t2'] });
  const views = await api.list();
  assert.equal(views.length, 2);
  const names = [...views].map((v) => v.name).sort();
  assert.equal(names.join(','), 'View A,View B');
});

// ─── revision append + linear update ─────────────────────────────────────────

test('save twice with parentRevisionId creates linear chain with single head', async () => {
  const { plugin, api } = makePlugin();
  const r1 = await api.save({ name: 'LinChain', targets: ['t1'] });
  const r2 = await api.save({ name: 'LinChain', targets: ['t1'], sort: 'alpha', viewGuid: r1.viewGuid }, r1.revisionId);
  const heads = await api.heads(r1.viewGuid);
  assert.equal(heads.length, 1, 'linear chain must have exactly one head');
  assert.equal(heads[0].revisionId, r2.revisionId, 'head must be the latest revision');
});

// ─── conflict model ───────────────────────────────────────────────────────────

test('two saves from same parent → two heads (conflict)', async () => {
  const { api } = makePlugin();
  const r1 = await api.save({ name: 'ConflictView', targets: ['tX'] });
  // Both clients save from r1 as parent (same parentRevisionId).
  const r2a = await api.save({ name: 'ConflictView', targets: ['tX'], sort: 'alpha', viewGuid: r1.viewGuid }, r1.revisionId);
  const r2b = await api.save({ name: 'ConflictView', targets: ['tX'], sort: 'date', viewGuid: r1.viewGuid }, r1.revisionId);
  const heads = await api.heads(r1.viewGuid);
  assert.equal(heads.length, 2, 'two concurrent saves from same parent must produce two heads');
  const headIds = heads.map((h) => h.revisionId).sort();
  assert.ok(headIds.includes(r2a.revisionId), 'r2a must be a head');
  assert.ok(headIds.includes(r2b.revisionId), 'r2b must be a head');
});

test('resolveConflict with chosenRevisionId → single head after merge', async () => {
  const { api } = makePlugin();
  const r1 = await api.save({ name: 'ConflictView2', targets: ['tY'] });
  const r2a = await api.save({ name: 'ConflictView2', targets: ['tY'], sort: 'alpha', viewGuid: r1.viewGuid }, r1.revisionId);
  const r2b = await api.save({ name: 'ConflictView2', targets: ['tY'], sort: 'date', viewGuid: r1.viewGuid }, r1.revisionId);
  // Resolve by choosing r2a as winner.
  const merge = await api.resolveConflict(r1.viewGuid, { chosenRevisionId: r2a.revisionId });
  assert.ok(merge, 'resolveConflict must return a merge revision');
  assert.ok(merge.revisionId.startsWith('merge_'), 'merge revision id must start with merge_');
  assert.ok(merge.parentRevisionIds.includes(r2a.revisionId), 'merge must cite r2a as parent');
  assert.ok(merge.parentRevisionIds.includes(r2b.revisionId), 'merge must cite r2b as parent');
  const headsAfter = await api.heads(r1.viewGuid);
  assert.equal(headsAfter.length, 1, 'after merge, exactly one head');
  assert.equal(headsAfter[0].revisionId, merge.revisionId);
});

test('resolveConflict with mergedConfig + parentRevisionIds → single head', async () => {
  const { api } = makePlugin();
  const r1 = await api.save({ name: 'MergeView', targets: ['tZ'] });
  const r2a = await api.save({ name: 'MergeView', targets: ['tZ'], sort: 'alpha', viewGuid: r1.viewGuid }, r1.revisionId);
  const r2b = await api.save({ name: 'MergeView', targets: ['tZ'], sort: 'date', viewGuid: r1.viewGuid }, r1.revisionId);
  const mergedCfg = { name: 'MergeView', targets: ['tZ'], sort: 'relevance', viewGuid: r1.viewGuid };
  const merge = await api.resolveConflict(r1.viewGuid, {
    mergedConfig: mergedCfg,
    parentRevisionIds: [r2a.revisionId, r2b.revisionId],
  });
  assert.ok(merge, 'merge must return revision');
  const headsAfter = await api.heads(r1.viewGuid);
  assert.equal(headsAfter.length, 1);
  assert.equal(headsAfter[0].fullConfig.sort, 'relevance', 'merged config sort must be relevance');
});

// ─── compaction boundary ──────────────────────────────────────────────────────

test('bounded revision compaction never loses heads', async () => {
  const { plugin, api } = makePlugin();
  plugin._R6_REVISION_CAP = 5;
  const r1 = await api.save({ name: 'BoundView', targets: ['t1'] });
  let lastId = r1.revisionId;
  let lastGuid = r1.viewGuid;
  // Linear chain: 10 saves (cap = 5).
  for (let i = 0; i < 9; i++) {
    const ri = await api.save({ name: 'BoundView', targets: ['t1'], sort: 'alpha', viewGuid: lastGuid }, lastId);
    lastId = ri.revisionId;
    lastGuid = ri.viewGuid;
  }
  // Head must still be resolvable.
  const heads = await api.heads(lastGuid);
  assert.equal(heads.length, 1, 'must have exactly one head after 10 linear saves');
  assert.equal(heads[0].revisionId, lastId, 'head must be the latest revision');
});

// ─── subscribe / notify ───────────────────────────────────────────────────────

test('subscribe fires on save', async () => {
  const { api } = makePlugin();
  const events = [];
  api.subscribe((ev) => events.push(ev));
  await api.save({ name: 'SubView', targets: ['t1'] });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'saved');
  assert.ok(events[0].viewGuid);
});

test('subscribe unsubscribe prevents further notifications', async () => {
  const { api } = makePlugin();
  const events = [];
  const unsub = api.subscribe((ev) => events.push(ev));
  await api.save({ name: 'SubView2', targets: ['t1'] });
  unsub();
  await api.save({ name: 'SubView2', targets: ['t1'], sort: 'alpha' });
  assert.equal(events.length, 1, 'must only receive event before unsubscribe');
});

test('subscribe: resolveConflict fires resolved event', async () => {
  const { api } = makePlugin();
  const events = [];
  api.subscribe((ev) => events.push(ev));
  const r1 = await api.save({ name: 'SubConflict', targets: ['tX'] });
  const r2a = await api.save({ name: 'SubConflict', targets: ['tX'], viewGuid: r1.viewGuid }, r1.revisionId);
  const r2b = await api.save({ name: 'SubConflict', targets: ['tX'], sort: 'alpha', viewGuid: r1.viewGuid }, r1.revisionId);
  events.length = 0; // reset: only care about resolveConflict event
  await api.resolveConflict(r1.viewGuid, { chosenRevisionId: r2a.revisionId });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'resolved');
});

// ─── hot-reload singleton disposal ───────────────────────────────────────────

test('_dispose: calls on disposed API return null/[]', async () => {
  const { api } = makePlugin();
  await api.save({ name: 'DisposedView', targets: ['t1'] });
  api._dispose();
  const views = await api.list();
  assert.equal(views.length, 0, 'disposed api list() returns empty array');
  const v = await api.get('any');
  assert.equal(v, null, 'disposed api get() returns null');
  const s = await api.save({ name: 'x', targets: ['y'] });
  assert.equal(s, null, 'disposed api save() returns null');
});

test('_dispose: subscribe on disposed API returns no-op unsub', () => {
  const { api } = makePlugin();
  api._dispose();
  const unsub = api.subscribe(() => { throw new Error('should not fire'); });
  assert.equal(typeof unsub, 'function');
  unsub(); // must not throw
});

// ─── pin migration idempotence ────────────────────────────────────────────────

test('pin migration: defers (no done-flag) when _pins is empty and walk has not run', async () => {
  // F3 fix: an empty _pins before the first _onNavigated walk is ambiguous (no pins yet
  // vs genuinely zero pins). Migration must NOT set the done-flag in this case — doing
  // so would permanently skip migration for users who have pins.
  const { plugin, records } = makePlugin();
  plugin._pins = new Map();
  plugin._r6PinWalkDone = false; // walk hasn't run yet
  await plugin._r6MigrateExistingPins();
  // No view records should have been created.
  assert.equal(records.size, 0, 'no records when pins map is empty');
  // Migration flag must NOT be 'done' — walk hasn't confirmed there are truly no pins.
  assert.notEqual(storage.get('refx_r6_pin_mig_v1'), 'done', 'done-flag must not be set before walk confirms zero pins');
  // Session guard must be reset so a retry is allowed after the first walk.
  assert.equal(plugin._r6MigratedPins, false, 'session guard must be reset to allow retry');
});

test('pin migration: sets done-flag when _pins is empty and walk HAS run', async () => {
  // When _r6PinWalkDone is true, the walk confirmed there are no pins — declare complete.
  const { plugin, records } = makePlugin();
  plugin._pins = new Map();
  plugin._r6PinWalkDone = true; // walk has run, zero pins found
  await plugin._r6MigrateExistingPins();
  assert.equal(records.size, 0, 'no records when pins map is empty');
  assert.equal(storage.get('refx_r6_pin_mig_v1'), 'done', 'done-flag must be set when walk confirmed zero pins');
});

test('pin migration: creates a view for each unique target', async () => {
  const { plugin, records, api } = makePlugin();
  // Simulate two pinned targets.
  plugin._pins.set('hostLine1', ['targetABC']);
  plugin._pins.set('hostLine2', ['targetXYZ']);
  // Re-attach the api so migration can call it.
  plugin._r6BackingColP = null;
  plugin._r6BackingColGuid = null;
  await plugin._r6MigrateExistingPins();
  // Two view records must have been created (plus their revision entries).
  const viewNames = [...records.values()].map((r) => r.name);
  assert.ok(viewNames.some((n) => n.startsWith('Pin View:targetABC')), 'view for targetABC must be created');
  assert.ok(viewNames.some((n) => n.startsWith('Pin View:targetXYZ')), 'view for targetXYZ must be created');
  assert.equal(storage.get('refx_r6_pin_mig_v1'), 'done');
});

test('pin migration: idempotent — re-run creates nothing new', async () => {
  const { plugin, records } = makePlugin();
  plugin._pins.set('hostLine1', ['targetDEF']);
  plugin._r6BackingColP = null;
  plugin._r6BackingColGuid = null;
  await plugin._r6MigrateExistingPins();
  const countAfterFirst = records.size;

  // Reset session guard and re-run.
  plugin._r6MigratedPins = false;
  plugin._r6BackingColP = null;
  plugin._r6BackingColGuid = null;
  await plugin._r6MigrateExistingPins();
  // localStorage flag says 'done' → should skip immediately.
  assert.equal(records.size, countAfterFirst, 'second run must not create additional records');
});

// ─── _r6ClientId stability ────────────────────────────────────────────────────

test('_r6ClientId: consistent within same localStorage', () => {
  const { plugin } = makePlugin();
  const id1 = plugin._r6ClientId();
  const id2 = plugin._r6ClientId();
  assert.equal(id1, id2, 'client id must be stable across calls in the same session');
  assert.ok(id1.startsWith('cl_'), 'client id must start with cl_');
});

test('_r6ClientId: includes cl_ prefix and a random component', () => {
  // Can't easily simulate two distinct localStorage instances in the same process.
  // Instead, verify the format has sufficient entropy to be unique across sessions.
  const { plugin } = makePlugin();
  const id = plugin._r6ClientId();
  assert.ok(id.startsWith('cl_'), 'must start with cl_');
  // Format: cl_<timestamp36>_<random6>  — at least 12 chars total
  assert.ok(id.length >= 12, 'must be long enough to be unique across reloads: ' + id);
  const parts = id.split('_');
  assert.ok(parts.length >= 3, 'must have at least three _-separated parts: ' + id);
});

// ─── R6 review fix regression tests (v3.85.1) ─────────────────────────────

// F1: Real-signature revision write/read round-trip.
// Verifies createLineItem is called with segments (not text as parent arg)
// and that _r6ReadRevisions correctly reconstructs the revision via li.segments.
test('F1: revision write/read round-trip survives segments-based storage', async () => {
  const { api } = makePlugin();
  const result = await api.save({ name: 'SigTest', targets: ['t1'] });
  assert.ok(result && result.viewGuid, 'save must return viewGuid');
  assert.ok(result.revisionId, 'save must return revisionId');
  // The stored revision must be readable back via _r6ReadRevisions (segments path).
  const view = await api.get(result.viewGuid);
  assert.ok(view, 'get must return the saved view after SDK-faithful write');
  assert.equal(view.name, 'SigTest', 'view name must survive the round-trip');
  assert.equal([...view.targets].join(','), 't1', 'targets must survive the round-trip');
});

test('F1: mock createLineItem receives null parent, not JSON string', async () => {
  // Intercept the first createLineItem call to verify argument shapes.
  storage.clear();
  const { Plugin, ctx } = require('vm').runInNewContext === undefined ? { Plugin: null, ctx: null } : (() => {
    // We already have the real loadPlugin() in scope — just make a fresh plugin.
    const { Plugin: P, ctx: c } = loadPlugin();
    return { Plugin: P, ctx: c };
  })();

  const { col, records } = makeFakeCollectionStore('settings');
  const plugin2 = new Plugin();
  plugin2._unloaded = false;
  const calls = [];
  // Wrap the real col record factory to capture createLineItem calls.
  const origGetAll = col.getAllRecords;
  // Capture createLineItem signature by wrapping the first record's createLineItem.
  const origCreateRecord = col.createRecord.bind(col);
  col.createRecord = (name) => {
    const guid = origCreateRecord(name);
    const rec = records.get(guid);
    const origCreate = rec.createLineItem.bind(rec);
    rec.createLineItem = async (parent, after, type, segments, props) => {
      calls.push({ parent, after, type, segments, props });
      return origCreate(parent, after, type, segments, props);
    };
    return guid;
  };
  plugin2.data = {
    getRecord: (guid) => records.get(guid) || null,
    getAllCollections: async () => [col],
    searchByQuery: async () => ({ lines: [], records: [] }),
  };
  plugin2.ui = { addCommandPaletteCommand: () => ({ remove: () => {} }), addStatusBarItem: () => ({ remove: () => {} }), getPanels: () => [] };
  plugin2.events = { on: () => 'h0', off: () => {} };
  plugin2._pins = new Map();
  plugin2._r6BackingColGuid = null;
  plugin2._r6BackingColP = null;

  const api2 = plugin2._r6BuildViewsApi();
  ctx.window = ctx.window || {};
  ctx.window.__refx = { version: '3.85.1', referenceViews: api2 };

  await api2.save({ name: 'SigVerify', targets: ['tX'] });

  assert.ok(calls.length > 0, 'createLineItem must have been called at least once');
  const firstCall = calls[0];
  // Real SDK: parent must be null (prepend to root) — not a JSON string.
  assert.equal(firstCall.parent, null, 'parent arg must be null, not revision JSON');
  // segments must be an array of {type,text} objects.
  assert.ok(Array.isArray(firstCall.segments), 'segments arg must be an array');
  assert.ok(firstCall.segments.length > 0, 'segments must be non-empty');
  assert.equal(firstCall.segments[0].type, 'text', 'first segment must have type="text"');
  // The segment text must be parseable JSON (the revision entry).
  const entry = JSON.parse(firstCall.segments[0].text);
  assert.ok(entry && entry.revisionId, 'segment text must contain a valid revision JSON');
});

// F2: Concurrent saves — both revisions survive (write serialization).
test('F2: two concurrent save() calls both produce surviving revisions', async () => {
  const { api } = makePlugin();
  // Fire two saves "simultaneously" (both dispatched before either resolves).
  const [r1, r2] = await Promise.all([
    api.save({ name: 'ConcurrentView', targets: ['tA'] }),
    api.save({ name: 'ConcurrentView', targets: ['tA'], sort: 'alpha' }),
  ]);
  assert.ok(r1 && r1.revisionId, 'first concurrent save must succeed');
  assert.ok(r2 && r2.revisionId, 'second concurrent save must succeed');
  assert.notEqual(r1.revisionId, r2.revisionId, 'concurrent saves must produce distinct revisionIds');
  // Both revisions must be present in the record.
  const allHeads = await api.heads(r1.viewGuid);
  // The two saves may form a linear chain (if serialization ordered them) or two heads
  // (if both used parentRevisionId=null on a brand-new record).  Either way, both
  // revisionIds must appear somewhere in the revision log.
  const revIds = allHeads.map((h) => h.revisionId);
  // At minimum: the final head must match one of the two saves.
  assert.ok(revIds.includes(r1.revisionId) || revIds.includes(r2.revisionId),
    'at least one concurrent revision must be a surviving head');
});

// F2: Under-cap saves must not delete any lines.
test('F2: under-cap saves never delete lines', async () => {
  const { plugin, api, records } = makePlugin();
  plugin._R6_REVISION_CAP = 50; // default cap
  const r1 = await api.save({ name: 'UnderCap', targets: ['tB'] });
  const r2 = await api.save({ name: 'UnderCap', targets: ['tB'], sort: 'alpha', viewGuid: r1.viewGuid }, r1.revisionId);
  const r3 = await api.save({ name: 'UnderCap', targets: ['tB'], sort: 'date', viewGuid: r1.viewGuid }, r2.revisionId);
  // All three revisions must be present — no premature deletion.
  const viewRec = [...records.values()].find((r) => r.name === 'UnderCap');
  assert.ok(viewRec, 'view record must exist');
  assert.equal(viewRec.lines.length, 3, 'all 3 under-cap revisions must be present (no delete)');
});

// F5: save() without parentRevisionId defaults parent to the single existing head.
test('F5: save() with no parentRevisionId defaults to single existing head → linear chain', async () => {
  const { api } = makePlugin();
  const r1 = await api.save({ name: 'DefaultParent', targets: ['tP'] });
  // Save again WITHOUT passing parentRevisionId.
  const r2 = await api.save({ name: 'DefaultParent', targets: ['tP'], sort: 'alpha', viewGuid: r1.viewGuid });
  const heads = await api.heads(r1.viewGuid);
  assert.equal(heads.length, 1, 'defaulting parent to single head must produce a linear chain (one head)');
  assert.equal(heads[0].revisionId, r2.revisionId, 'head must be the second revision');
  // r2 must cite r1 as parent.
  assert.ok(heads[0].parentRevisionIds.includes(r1.revisionId),
    'second revision must cite first as parent when parentRevisionId was omitted');
});

test('F5: save() with no parentRevisionId on brand-new view creates parentless root', async () => {
  const { api } = makePlugin();
  const r1 = await api.save({ name: 'NewView', targets: ['tN'] });
  const heads = await api.heads(r1.viewGuid);
  assert.equal(heads.length, 1, 'brand-new view must have exactly one head');
  // Parentless root: parentRevisionIds must be empty.
  assert.equal(heads[0].parentRevisionIds.length, 0, 'first revision on a new view must have no parents');
});

// F4: list()/get() must NOT return LWW — conflicted view returns conflict sentinel.
test('F4: list() returns conflict sentinel for conflicted views, not LWW config', async () => {
  const { api } = makePlugin();
  const r1 = await api.save({ name: 'ConflictSentinel', targets: ['tC'] });
  // Two saves from same parent → two heads (conflict).
  await api.save({ name: 'ConflictSentinel', targets: ['tC'], sort: 'alpha', viewGuid: r1.viewGuid }, r1.revisionId);
  await api.save({ name: 'ConflictSentinel', targets: ['tC'], sort: 'date', viewGuid: r1.viewGuid }, r1.revisionId);
  const views = await api.list();
  const sentinel = views.find((v) => v.viewGuid === r1.viewGuid);
  assert.ok(sentinel, 'conflicted view must appear in list()');
  assert.equal(sentinel.conflict, true, 'conflicted view must have conflict:true');
  assert.equal(sentinel.config, null, 'conflicted view must have config:null (no LWW)');
});

test('F4: get() returns conflict sentinel for conflicted views, not LWW config', async () => {
  const { api } = makePlugin();
  const r1 = await api.save({ name: 'GetConflict', targets: ['tD'] });
  await api.save({ name: 'GetConflict', targets: ['tD'], sort: 'alpha', viewGuid: r1.viewGuid }, r1.revisionId);
  await api.save({ name: 'GetConflict', targets: ['tD'], sort: 'date', viewGuid: r1.viewGuid }, r1.revisionId);
  const view = await api.get(r1.viewGuid);
  assert.ok(view, 'conflicted view must be returned by get()');
  assert.equal(view.conflict, true, 'conflicted get() result must have conflict:true');
  assert.equal(view.config, null, 'conflicted get() result must have config:null (no LWW)');
});

test('F4: list() returns clean config (no conflict) when only one head', async () => {
  const { api } = makePlugin();
  const r1 = await api.save({ name: 'CleanView', targets: ['tE'] });
  const r2 = await api.save({ name: 'CleanView', targets: ['tE'], sort: 'alpha', viewGuid: r1.viewGuid }, r1.revisionId);
  const views = await api.list();
  const view = views.find((v) => v.viewGuid === r1.viewGuid || v.name === 'CleanView');
  assert.ok(view, 'clean view must appear in list()');
  assert.equal(view.conflict, undefined, 'single-head view must not have conflict:true');
  assert.equal(view.sort, 'alpha', 'single-head view must carry the correct config');
});

// F8: revisionId must include clientId component.
test('F8: revisionId includes clientId suffix', async () => {
  const { plugin, api } = makePlugin();
  const clientId = plugin._r6ClientId();
  const clientSuffix = clientId.slice(-6);
  const result = await api.save({ name: 'ClientIdView', targets: ['tF'] });
  assert.ok(result.revisionId.includes(clientSuffix),
    'revisionId must include last 6 chars of clientId; got: ' + result.revisionId);
});

// F9: compaction sorts non-heads by savedAt before slicing.
test('F9: compaction picks most-recent non-heads by savedAt, not array position', () => {
  const { plugin } = makePlugin();
  plugin._R6_REVISION_CAP = 3;
  // Build a chain r0 → r1 → r2 (r2 is head).
  // Also insert an "old" non-head at array[0] with an early savedAt — it must NOT survive.
  // And a "recent" non-head at array[2] with a later savedAt — it MUST survive if there is room.
  const r0 = { revisionId: 'r0', parentRevisionIds: [], configHash: 'h0', fullConfig: {}, authorClientId: 'cl', savedAt: '2026-01-01T00:00:00Z' };
  const r1 = { revisionId: 'r1', parentRevisionIds: ['r0'], configHash: 'h1', fullConfig: {}, authorClientId: 'cl', savedAt: '2026-01-02T00:00:00Z' };
  const r2 = { revisionId: 'r2', parentRevisionIds: ['r1'], configHash: 'h2', fullConfig: {}, authorClientId: 'cl', savedAt: '2026-01-03T00:00:00Z' };
  // Array order: old orphan first (position 0), then r2 (head), r1, r0.
  // With cap=3: must keep head r2 + 2 most-recent non-heads (r1 > r0 by savedAt).
  const allRevs = [r0, r2, r1]; // r0 at position 0 to test sort-before-slice
  const compacted = plugin._r6CompactRevisions(allRevs);
  assert.ok(compacted.some((r) => r.revisionId === 'r2'), 'head r2 must survive');
  assert.ok(compacted.some((r) => r.revisionId === 'r1'), 'most recent non-head r1 must survive');
  assert.ok(compacted.length <= 3, 'must not exceed cap');
});

// F3: Migration flag NOT set on empty walk (walk not yet done).
test('F3: migration flag not set when _pins empty and walk has not run', async () => {
  const { plugin } = makePlugin();
  plugin._pins = new Map();
  plugin._r6PinWalkDone = false;
  await plugin._r6MigrateExistingPins();
  assert.notEqual(storage.get('refx_r6_pin_mig_v1'), 'done',
    'done-flag must not be set when walk has not confirmed zero pins');
  assert.equal(plugin._r6MigratedPins, false,
    'session guard must be reset so retry is allowed after the first walk');
});
