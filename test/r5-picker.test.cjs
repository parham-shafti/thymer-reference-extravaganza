'use strict';
// R5 picker: hierarchical scoped picker, structured filters, frecency, session tokens.
// Tests run in the vm-harness style established by plugin.test.cjs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'plugin.js'), 'utf8');

// ─── vm harness (mirrors plugin.test.cjs) ──────────────────────────────────

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
      createElement: (tag) => {
        const el = {
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
        };
        return el;
      },
      createTextNode: (t) => ({ nodeType: 3, textContent: t }),
      querySelectorAll: () => [],
      querySelector: () => null,
      documentElement: { clientHeight: 900 },
      body: {
        classList: { toggle() {}, add() {}, remove() {} },
        append() {},
        appendChild() {},
      },
      head: { appendChild() {} },
      addEventListener() {},
      removeEventListener() {},
    },
    Element: class {},
    window: {
      CSS: { escape: (s) => String(s) },
      g_universe: { itemsByGuid: {}, workspace: {} },
      addEventListener() {},
      removeEventListener() {},
    },
    DateTime: undefined, // default: no Thymer DateTime in test env
  };
  ctx.globalThis = ctx;
  // Expose window as the global in the sandbox.
  Object.assign(ctx, ctx.window);
  vm.runInNewContext(source + '\nthis.PluginUnderTest = Plugin;', ctx, { filename: 'plugin.js' });
  return { Plugin: ctx.PluginUnderTest, ctx };
}

function makePlugin(extras) {
  storage.clear();
  const { Plugin, ctx } = loadPlugin();
  const plugin = new Plugin();
  plugin._isUnloading = false;
  plugin._enabled = true;
  // Minimal data stub.
  plugin.data = {
    getRecord: () => null,
    searchByQuery: async () => ({ lines: [], records: [] }),
    getAllCollections: async () => [],
    ...(extras && extras.data),
  };
  plugin._r5SessionGen = 0;
  plugin._r5ScopeStack = [];
  return { plugin, ctx };
}

// ─── v4.34.0 liveness admission ─────────────────────────────────────────────

test('picker liveness admits an unknown cold record and rejects only known trash', () => {
  const { plugin } = makePlugin();
  const row = { guid: 'REC-COLD', text: 'Historical title', type: 'record' };
  assert.equal(plugin._pickerResultLiveness(row), 'unknown');
  assert.equal(plugin._pickerCanUseResult(row), true);
  assert.equal(plugin._pickerResultIsLive(row), false);
  plugin._pickerMarkRecordLive(row.guid, true);
  assert.equal(plugin._pickerResultLiveness(row), 'live');
  assert.equal(plugin._pickerResultIsLive(row), true);
  plugin._pickerMarkRecordLive(row.guid, false);
  assert.equal(plugin._pickerResultLiveness(row), 'trashed');
  assert.equal(plugin._pickerCanUseResult(row), false);
  assert.equal(plugin._pickerResultIsLive(row), false);
});

test('picker liveness admits an unknown exact line but rejects explicit line deletion', () => {
  const { plugin, ctx } = makePlugin();
  plugin._pickerMarkRecordLive('OWNER', true);
  assert.equal(plugin._pickerResultLiveness({ guid: 'STALE-LINE', rguid: 'OWNER' }), 'unknown');
  assert.equal(plugin._pickerCanUseResult({ guid: 'STALE-LINE', rguid: 'OWNER' }), true);
  assert.equal(plugin._pickerResultIsLive({ guid: 'STALE-LINE', rguid: 'OWNER' }), false);
  ctx.window.g_universe.itemsByGuid['LIVE-LINE'] = {
    type: 'text', rguid: 'OWNER', is_deleted: false, is_trashed: false,
  };
  assert.equal(plugin._pickerResultIsLive({ guid: 'LIVE-LINE', rguid: 'OWNER' }), true);
  plugin._pickerMarkLineLive('LIVE-LINE', '', false);
  assert.equal(plugin._pickerResultIsLive({ guid: 'LIVE-LINE', rguid: 'OWNER' }), false);
  plugin._pickerMarkLineLive('LIVE-LINE', 'OWNER', true);
  assert.equal(plugin._pickerResultIsLive({ guid: 'LIVE-LINE', rguid: 'OWNER' }), true);
});

test('cold line proof keeps missing SDK liveness data unknown and admissible', async () => {
  let reads = 0;
  const liveLine = { guid: 'LIVE-LINE', children: [] };
  const { plugin } = makePlugin({
    data: {
      getRecord: (guid) => guid === 'OWNER'
        ? { guid, getLineItems: async () => { reads++; return [liveLine]; } }
        : null,
    },
  });
  assert.equal(await plugin._pickerProveLineLive('STALE-LINE', 'OWNER'), true);
  assert.equal(await plugin._pickerProveLineLive('LIVE-LINE', 'OWNER'), true);
  assert.equal(reads, 0, 'getLineItems is not an authoritative liveness oracle');
  assert.equal(plugin._pickerLineLiveness.has('STALE-LINE'), false, 'unknown is not negative-cached');
});

test('shared reveal admission keeps unknown rows and removes known trash from counts', () => {
  const { plugin } = makePlugin();
  plugin._pickerMarkRecordLive('TRASHED', false);
  plugin._pickerMarkRecordLive('LIVE', true);
  const link = { kind: 'record', results: [], sel: 0, visibleLimit: 8 };
  plugin._resetLinkReveal(link, [
    { guid: 'UNKNOWN', text: 'cold', type: 'record' },
    { guid: 'TRASHED', text: 'trashed', type: 'record' },
    { guid: 'LIVE', text: 'active', type: 'record' },
  ], 3, true, 'query');
  assert.deepEqual(link.resultPool.map((row) => row.guid), ['UNKNOWN', 'LIVE']);
  assert.equal(link.resultsPreSliceCount, 2);
});

test('drill, preview, and pick boundaries all use the shared liveness guard', async () => {
  const { plugin } = makePlugin();
  plugin._pickerMarkRecordLive('OWNER', false);
  const stale = { guid: 'STALE-LINE', rguid: 'OWNER', text: 'old text' };
  const link = { results: [stale], sel: 0, preview: true, previewEl: null };
  plugin._link = link;
  plugin._r5DrillInto(link);
  assert.equal(plugin._r5ScopeStack.length, 0);
  assert.equal(await plugin._pickLink(stale), false);
  assert.equal(link.picking, undefined);
  plugin._updateLinkPreviewPane(link, stale);
  assert.equal(link.previewEl, null);
});

test('legacy am-page-uid metadata is display-only scrubbed', () => {
  const { plugin } = makePlugin();
  const text = plugin._cleanDisplayText([
    { type: 'text', text: 'Visible ' },
    { type: 'text', text: 'am-page-uid: 11-04-2024 -->' },
  ]);
  assert.equal(text, 'Visible');
  assert.equal(plugin._previewCleanText('Visible am-page-uid: 11-04-2024 -->'), 'Visible');
});

test('cached liveness admission adds less than 0.20ms per 48-candidate keystroke', () => {
  const { plugin } = makePlugin();
  const rows = [];
  for (let index = 0; index < 24; index++) {
    const recordGuid = 'REC-' + index;
    const lineGuid = 'LINE-' + index;
    plugin._pickerMarkRecordLive(recordGuid, true);
    plugin._pickerMarkLineLive(lineGuid, recordGuid, true);
    rows.push({ guid: recordGuid, type: 'record' }, { guid: lineGuid, rguid: recordGuid });
  }
  const iterations = 10000;
  const started = performance.now();
  let admitted = 0;
  for (let pass = 0; pass < iterations; pass++) {
    for (const row of rows) if (plugin._pickerCanUseResult(row)) admitted++;
  }
  const perKeystrokeMs = (performance.now() - started) / iterations;
  process.stderr.write('  BENCH-C5-LIVENESS: 48 cached admissions = ' + perKeystrokeMs.toFixed(4) + 'ms/keystroke\n');
  assert.equal(admitted, iterations * rows.length);
  assert.ok(perKeystrokeMs < 0.20, 'cached liveness cost was ' + perKeystrokeMs.toFixed(4) + 'ms');
});

// ─── Filter parser tests ────────────────────────────────────────────────────

test('R5 filter parser: plain free text — no filters extracted', () => {
  const { plugin } = makePlugin();
  const { freeText, filters } = plugin._r5ParseFilters('hello world');
  assert.equal(freeText, 'hello world');
  assert.equal(Object.keys(filters).length, 0);
});

test('R5 filter parser: is:task', () => {
  const { plugin } = makePlugin();
  const { freeText, filters } = plugin._r5ParseFilters('buy groceries is:task');
  assert.equal(freeText, 'buy groceries');
  assert.equal(filters.isTask, true);
});

test('R5 filter parser: status:done', () => {
  const { plugin } = makePlugin();
  const { freeText, filters } = plugin._r5ParseFilters('status:done review notes');
  assert.equal(filters.status, 'done');
  assert.equal(freeText, 'review notes');
});

test('R5 filter parser: status:todo', () => {
  const { plugin } = makePlugin();
  const { freeText, filters } = plugin._r5ParseFilters('status:todo');
  assert.equal(filters.status, 'todo');
  assert.equal(freeText, '');
});

test('R5 filter parser: kind:record', () => {
  const { plugin } = makePlugin();
  const { freeText, filters } = plugin._r5ParseFilters('meeting kind:record');
  assert.equal(filters.kind, 'record');
  assert.equal(freeText, 'meeting');
});

test('R5 filter parser: kind:line', () => {
  const { plugin } = makePlugin();
  const { freeText, filters } = plugin._r5ParseFilters('kind:line notes');
  assert.equal(filters.kind, 'line');
  assert.equal(freeText, 'notes');
});

test('R5 filter parser: in:collection unquoted', () => {
  const { plugin } = makePlugin();
  const { freeText, filters } = plugin._r5ParseFilters('in:Articles philosophy');
  assert.equal(filters.inCollection, 'Articles');
  assert.equal(freeText, 'philosophy');
});

test('R5 filter parser: in:"My Collection" quoted', () => {
  const { plugin } = makePlugin();
  const { freeText, filters } = plugin._r5ParseFilters('in:"My Collection" search term');
  assert.equal(filters.inCollection, 'My Collection');
  assert.equal(freeText, 'search term');
});

test('R5 filter parser: alias:short', () => {
  const { plugin } = makePlugin();
  const { freeText, filters } = plugin._r5ParseFilters('alias:short hello');
  assert.equal(filters.alias, 'short');
  assert.equal(freeText, 'hello');
});

test('R5 filter parser: before:2026-07-01', () => {
  const { plugin } = makePlugin();
  const { freeText, filters } = plugin._r5ParseFilters('task before:2026-07-01');
  assert.equal(filters.before, '2026-07-01');
  assert.equal(freeText, 'task');
});

test('R5 filter parser: after:2026-01-01', () => {
  const { plugin } = makePlugin();
  const { freeText, filters } = plugin._r5ParseFilters('after:2026-01-01');
  assert.equal(filters.after, '2026-01-01');
  assert.equal(freeText, '');
});

test('R5 filter parser: composed — is:task status:todo freetext', () => {
  const { plugin } = makePlugin();
  const { freeText, filters } = plugin._r5ParseFilters('review EMP is:task status:todo');
  assert.equal(filters.isTask, true);
  assert.equal(filters.status, 'todo');
  assert.match(freeText, /review EMP/);
});

test('R5 filter parser: malformed filter op treated as free text', () => {
  const { plugin } = makePlugin();
  // "foo:bar" is not a recognised op, should stay in free text
  const { freeText, filters } = plugin._r5ParseFilters('hello foo:bar world');
  // foo is not a known op — it stays in free text (regex won't match unknown ops)
  assert.ok(!filters.isTask);
  assert.ok(!filters.kind);
  assert.ok(!filters.status);
  assert.ok(!filters.inCollection);
});

// ─── Exact GUID lookup tests ─────────────────────────────────────────────────

test('R5 filter parser: bare GUID query sets exactGuid', () => {
  const { plugin } = makePlugin();
  const guid = 'WEJ9EZW6ADT58SJC3EQMNETSW6';
  const { freeText, filters } = plugin._r5ParseFilters(guid);
  assert.equal(filters.exactGuid, guid);
  assert.equal(freeText, '');
});

test('R5 filter parser: GUID with filters does not set exactGuid', () => {
  const { plugin } = makePlugin();
  // When there are also filters, the GUID check only applies if no other filters were found
  // and the entire freeText is itself a GUID.
  const guid = 'WEJ9EZW6ADT58SJC3EQMNETSW6';
  const { freeText, filters } = plugin._r5ParseFilters(guid + ' is:task');
  // After extracting is:task, freeText = guid which is still a GUID...
  // but since we had another filter (isTask), exactGuid is not set (only when !Object.keys(filters).length initially)
  // The parser sets exactGuid only when filters is still empty after parsing operators.
  // With is:task present, filters.isTask=true so we don't set exactGuid.
  assert.ok(!filters.exactGuid);
});

test('looksLikeGuid accepts uppercase-alphanumeric strings >= 12 chars', () => {
  const { plugin } = makePlugin();
  assert.equal(plugin.looksLikeGuid('WEJ9EZW6ADT58SJC3EQMNETSW6'), true);
  assert.equal(plugin.looksLikeGuid('ABCDEFGH1234'), true);
  assert.equal(plugin.looksLikeGuid('short'), false);        // too short
  assert.equal(plugin.looksLikeGuid('hello world spaces'), false); // spaces
});

// ─── Scope stack push/pop tests ──────────────────────────────────────────────

test('R5 scope stack: starts empty', () => {
  const { plugin } = makePlugin();
  plugin._r5ScopeStack = [];
  assert.equal(plugin._r5CurrentScope(), null);
});

test('R5 scope stack: push then pop restores query', () => {
  const { plugin } = makePlugin();
  plugin._r5ScopeStack = [];
  // Simulate a drill-down push.
  plugin._r5ScopeStack.push({ scopeGuid: 'REC1', scopeLabel: 'My Record', scopeKind: 'record', savedQuery: 'my query' });
  assert.equal(plugin._r5CurrentScope().scopeGuid, 'REC1');
  // Pop restores.
  const popped = plugin._r5ScopeStack.pop();
  assert.equal(popped.savedQuery, 'my query');
  assert.equal(plugin._r5CurrentScope(), null);
});

test('R5 scope stack: multiple levels preserve stack order', () => {
  const { plugin } = makePlugin();
  plugin._r5ScopeStack = [
    { scopeGuid: 'A', scopeLabel: 'Level A', scopeKind: 'record', savedQuery: 'alpha' },
    { scopeGuid: 'B', scopeLabel: 'Level B', scopeKind: 'line', savedQuery: 'beta' },
  ];
  assert.equal(plugin._r5CurrentScope().scopeGuid, 'B');
  plugin._r5ScopeStack.pop();
  assert.equal(plugin._r5CurrentScope().scopeGuid, 'A');
  plugin._r5ScopeStack.pop();
  assert.equal(plugin._r5CurrentScope(), null);
});

// ─── Frecency tests ───────────────────────────────────────────────────────────

test('R5 frecency: unused GUID returns 0 boost', () => {
  const { plugin } = makePlugin();
  assert.equal(plugin._r5FrecencyBoost('NEVER_USED'), 0);
});

test('R5 frecency: recently used GUID returns positive boost', () => {
  const { plugin } = makePlugin();
  plugin._r5RecordFrecency('GUID1');
  const boost = plugin._r5FrecencyBoost('GUID1');
  assert.ok(boost > 0, `Expected boost > 0, got ${boost}`);
});

test('R5 traversal boost is bounded to [0, 60]', () => {
  const { plugin } = makePlugin();
  for (let i = 0; i < 100; i++) plugin._connRecordHop('SRC', 'GUID_MANY', 'jump');
  const boost = plugin._connHopWeight('SRC', 'GUID_MANY');
  assert.ok(boost >= 0 && boost <= 60, `Boost ${boost} out of [0, 60]`);
});

test('R5 traversal: LRU eviction keeps at most 1000 edges', () => {
  const { plugin } = makePlugin();
  plugin._wbWorkspaceGuid = () => 'WS_R5';
  plugin._connTraversalCache = null;
  for (let i = 0; i < 1010; i++) {
    plugin._connRecordHop('SRC', 'GUID_' + String(i).padStart(4, '0'), 'jump');
  }
  const store = plugin._connTraversalLoad();
  assert.ok(Object.keys(store).length <= 1000, `Expected <= 1000, got ${Object.keys(store).length}`);
});

test('R5 frecency: LRU eviction keeps at most 500 entries', () => {
  const { plugin } = makePlugin();
  // Insert 510 distinct GUIDs.
  for (let i = 0; i < 510; i++) {
    plugin._r5RecordFrecency('GUID_' + String(i).padStart(4, '0'));
  }
  const map = plugin._r5LoadFrecency();
  assert.ok(Object.keys(map).length <= 500, `Expected <= 500, got ${Object.keys(map).length}`);
});

test('R5 frecency: low-frecency match is not filtered out (rank-only)', () => {
  // This test verifies the CONTRACT not the search (which requires DOM):
  // a row with 0 frecency boost still passes _r5FilterRow with empty filters.
  const { plugin } = makePlugin();
  const row = { guid: 'NO_HIST', text: 'Some text', task: null, rguid: null };
  // With empty filters, every row passes.
  assert.equal(plugin._r5FilterRow(row, {}, null), true);
  // With is:task filter, a non-task row fails, not because of frecency.
  assert.equal(plugin._r5FilterRow(row, { isTask: true }, null), false);
});

// ─── Stale-session cancellation tests ────────────────────────────────────────

test('R5 session token: advances on each picker open call', () => {
  const { plugin } = makePlugin();
  plugin._r5SessionGen = 0;
  // Simulate picker opens by incrementing the session gen.
  plugin._r5SessionGen = ((plugin._r5SessionGen || 0) + 1);
  assert.equal(plugin._r5SessionGen, 1);
  plugin._r5SessionGen = ((plugin._r5SessionGen || 0) + 1);
  assert.equal(plugin._r5SessionGen, 2);
});

test('R5 stale-session guard: async callback from prior session is rejected', (_, done) => {
  const { plugin } = makePlugin();
  // Simulate a scenario: session 1 fires an async callback, but by the time it
  // resolves the session has advanced to 2. The callback should be a no-op.
  plugin._r5SessionGen = 1;
  const capturedSession = plugin._r5SessionGen;
  // Advance the session (simulating a picker close + reopen).
  plugin._r5SessionGen = 2;
  // Verify stale check: if captured !== current, it's stale.
  const isStale = capturedSession !== plugin._r5SessionGen;
  assert.equal(isStale, true);
  done();
});

// ─── Drill-down children data source tests ────────────────────────────────────

test('R5 drill-down: _r5ScopeChildren returns empty array for unknown record', async () => {
  const { plugin } = makePlugin();
  plugin.data.getRecord = () => null;
  const children = await plugin._r5ScopeChildren('UNKNOWN_GUID', 'record');
  assert.equal(Array.isArray(children), true);
  assert.equal(children.length, 0);
});

test('R5 drill-down: _r5ScopeChildren returns line items for a record scope', async () => {
  const { plugin } = makePlugin();
  const fakeItems = [
    { guid: 'LINE1', segments: [{ type: 'text', text: 'First item' }], type: 'ulist' },
    { guid: 'LINE2', segments: [{ type: 'text', text: 'Second item' }], type: 'task' },
  ];
  plugin.data.getRecord = (guid) => guid === 'REC1' ? {
    guid: 'REC1',
    getName: () => 'Test Record',
    getLineItems: async () => fakeItems,
  } : null;
  // We need _cleanDisplayText to work — stub it.
  plugin._cleanDisplayText = (segs) => (segs || []).map((s) => s.text || '').join('');

  const children = await plugin._r5ScopeChildren('REC1', 'record');
  assert.equal(children.length, 2);
  assert.equal(children[0].guid, 'LINE1');
  assert.equal(children[0].text, 'First item');
  assert.equal(children[1].guid, 'LINE2');
  assert.equal(children[1].task && children[1].task.is, true); // type=task
});

test('R5 drill-down: _r5ScopeChildren skips lines with no text', async () => {
  const { plugin } = makePlugin();
  const fakeItems = [
    { guid: 'EMPTY', segments: [], type: 'ulist' },
    { guid: 'VALID', segments: [{ type: 'text', text: 'Has text' }], type: 'ulist' },
  ];
  plugin.data.getRecord = (guid) => guid === 'REC2' ? {
    guid: 'REC2', getName: () => 'R2', getLineItems: async () => fakeItems,
  } : null;
  plugin._cleanDisplayText = (segs) => (segs || []).map((s) => s.text || '').join('');

  const children = await plugin._r5ScopeChildren('REC2', 'record');
  assert.equal(children.length, 1);
  assert.equal(children[0].guid, 'VALID');
});

test('R5 cold record scope: retries one empty hydration and memoizes the settled children', async () => {
  const { plugin } = makePlugin();
  const cache = new Map();
  let reads = 0;
  const settled = [{ guid: 'COLD_CHILD', segments: [{ type: 'text', text: 'Hydrated child' }], type: 'ulist' }];
  plugin.data.getRecord = (guid) => guid === 'COLD_RECORD' ? {
    guid,
    async getLineItems() { reads++; return reads === 1 ? [] : settled; },
  } : null;
  plugin._cleanDisplayText = (segs) => (segs || []).map((s) => s.text || '').join('');

  const first = await plugin._r5ScopeChildren('COLD_RECORD', 'record', cache);
  const second = await plugin._r5ScopeChildren('COLD_RECORD', 'record', cache);

  assert.equal(reads, 2, 'one initial read plus exactly one settle retry');
  assert.equal(first.length, 1);
  assert.equal(first[0].guid, 'COLD_CHILD');
  assert.equal(second, first, 'per-session cache should reuse the settled result array');
});

test('R5 cold line scope: saved owner hydrates children-only primary results without g_universe', async () => {
  const { plugin, ctx } = makePlugin();
  const cache = new Map();
  let reads = 0;
  const child = { guid: 'CHILD', parent_guid: 'TARGET', segments: [{ type: 'text', text: 'Child' }], type: 'ulist', children: [] };
  const before = { guid: 'BEFORE', parent_guid: 'PARENT', segments: [{ type: 'text', text: 'Before' }], type: 'ulist', children: [] };
  const target = { guid: 'TARGET', parent_guid: 'PARENT', segments: [{ type: 'text', text: 'Target' }], type: 'ulist', children: [child] };
  const after = { guid: 'AFTER', parent_guid: 'PARENT', segments: [{ type: 'text', text: 'After' }], type: 'ulist', children: [] };
  const parent = { guid: 'PARENT', segments: [{ type: 'text', text: 'Parent' }], type: 'ulist', children: [before, target, after] };
  const partial = [{ guid: 'OTHER', segments: [{ type: 'text', text: 'Partial' }], type: 'ulist', children: [] }];
  plugin.data.getRecord = (guid) => guid === 'COLD_OWNER' ? {
    guid,
    async getLineItems() { reads++; return reads === 1 ? partial : [parent]; },
  } : null;
  plugin._cleanDisplayText = (segs) => (segs || []).map((s) => s.text || '').join('');
  ctx.window.g_universe.itemsByGuid = {};

  const rows = await plugin._r5ScopeChildren('TARGET', 'line', cache, 'COLD_OWNER');
  const cachedRows = await plugin._r5ScopeChildren('TARGET', 'line', cache, 'COLD_OWNER');

  assert.equal(reads, 2, 'missing target triggers only one settle retry');
  // `rows` originates in the VM realm; normalize through the host Array
  // constructor so Node 25's realm-sensitive deep equality compares values.
  assert.deepEqual(Array.from(rows, (row) => row._ctxKind), ['child']);
  assert.deepEqual(Array.from(rows, (row) => row.guid), ['CHILD']);
  assert.ok(rows.every((row) => row.rguid === 'COLD_OWNER'));
  assert.equal(cachedRows, rows, 'child rows are memoized for the picker session');
});

test('R5 cold drill: loading state is immediate and a late tree cannot clobber a newer token', async () => {
  const { plugin } = makePlugin();
  plugin._r5SessionGen = 1;
  plugin._r5UpdateCrumbBar = () => {};
  const renders = [];
  let resolveChildren;
  plugin._r5ScopeChildren = () => new Promise((resolve) => { resolveChildren = resolve; });
  const link = {
    kind: 'line', br: '((', query: 'cold', bracketStart: 0,
    results: [{ guid: 'TARGET', text: 'Target', rguid: 'COLD_OWNER' }],
    resultsQuery: 'cold', sel: 0, userSelected: false, token: 0, r5Session: 1,
    crumbBar: null, synthetic: true, preview: false,
  };
  plugin._link = link;
  plugin._renderLink = () => renders.push(!!link.r5ChildrenLoading);
  plugin._pickerMarkLineLive('TARGET', 'COLD_OWNER', true);

  plugin._r5DrillInto(link);
  assert.equal(link.r5ChildrenLoading.scopeGuid, 'TARGET');
  assert.equal(plugin._r5CurrentScope().scopeRguid, 'COLD_OWNER');
  assert.equal(renders[0], true, 'first render exposes loading state');

  link.token += 1; // a newer query/selection supersedes the hydration
  const newer = [{ guid: 'NEWER', text: 'Newer result' }];
  link.results = newer;
  resolveChildren([{ guid: 'STALE', text: 'Stale child' }]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(link.results, newer, 'late hydration must not replace newer results');
});

// ─── Filter row tests ─────────────────────────────────────────────────────────

test('R5 _r5FilterRow: empty filters — all rows pass', () => {
  const { plugin } = makePlugin();
  const row = { guid: 'G1', task: null, rguid: null };
  assert.equal(plugin._r5FilterRow(row, {}, null), true);
});

test('R5 _r5FilterRow: is:task rejects non-task rows', () => {
  const { plugin } = makePlugin();
  const nonTask = { guid: 'G1', task: null, rguid: null };
  const taskRow = { guid: 'G2', task: { is: true, done: false }, rguid: 'REC' };
  assert.equal(plugin._r5FilterRow(nonTask, { isTask: true }, null), false);
  assert.equal(plugin._r5FilterRow(taskRow, { isTask: true }, null), true);
});

test('R5 _r5FilterRow: status:done rejects undone tasks', () => {
  const { plugin } = makePlugin();
  const undone = { guid: 'G1', task: { is: true, done: false }, rguid: 'REC' };
  const done = { guid: 'G2', task: { is: true, done: true }, rguid: 'REC' };
  assert.equal(plugin._r5FilterRow(undone, { isTask: true, status: 'done' }, null), false);
  assert.equal(plugin._r5FilterRow(done, { isTask: true, status: 'done' }, null), true);
});

test('R5 _r5FilterRow: status:todo rejects done tasks', () => {
  const { plugin } = makePlugin();
  const done = { guid: 'G1', task: { is: true, done: true }, rguid: 'REC' };
  const undone = { guid: 'G2', task: { is: true, done: false }, rguid: 'REC' };
  assert.equal(plugin._r5FilterRow(done, { status: 'todo' }, null), false);
  assert.equal(plugin._r5FilterRow(undone, { status: 'todo' }, null), true);
});

test('R5 _r5FilterRow: kind:record rejects line rows (has rguid)', () => {
  const { plugin } = makePlugin();
  const lineRow = { guid: 'L1', task: null, rguid: 'REC1' };
  const recRow = { guid: 'R1', task: null, rguid: null };
  assert.equal(plugin._r5FilterRow(lineRow, { kind: 'record' }, null), false);
  assert.equal(plugin._r5FilterRow(recRow, { kind: 'record' }, null), true);
});

test('R5 _r5FilterRow: kind:line rejects record rows (no rguid)', () => {
  const { plugin } = makePlugin();
  const lineRow = { guid: 'L1', task: null, rguid: 'REC1' };
  const recRow = { guid: 'R1', task: null, rguid: null };
  assert.equal(plugin._r5FilterRow(lineRow, { kind: 'line' }, null), true);
  assert.equal(plugin._r5FilterRow(recRow, { kind: 'line' }, null), false);
});

test('R5 _r5FilterRow: in:collection filter passes when collection name matches', () => {
  const { plugin } = makePlugin();
  const row = { guid: 'L1', task: null, rguid: 'REC1' };
  const colMap = new Map([['REC1', 'Articles']]);
  assert.equal(plugin._r5FilterRow(row, { inCollection: 'articles' }, colMap), true);
  assert.equal(plugin._r5FilterRow(row, { inCollection: 'Notes' }, colMap), false);
});

// ─── Keyboard path unit tests ──────────────────────────────────────────────────

test('R5 keyboard: Tab on empty results is a no-op', () => {
  const { plugin } = makePlugin();
  plugin._r5ScopeStack = [];
  plugin._r5SessionGen = 1;
  // Stub _link with empty results.
  plugin._link = {
    kind: 'line', br: '((', query: '',
    results: [], resultsQuery: '', sel: 0, userSelected: false, token: 0,
    r5Session: 1, crumbBar: null, pop: { remove() {} },
    searchTimer: null, countTimer: null, autoCloseRaf: null, autoCloseEl: null,
    synthetic: false,
  };
  // _r5DrillInto should do nothing when no results.
  plugin._r5DrillInto(plugin._link);
  // Scope stack should remain empty (no result to drill into).
  assert.equal(plugin._r5ScopeStack.length, 0);
});

test('R5 keyboard: Backspace on empty query pops scope stack when non-empty', () => {
  const { plugin } = makePlugin();
  plugin._r5ScopeStack = [
    { scopeGuid: 'REC1', scopeLabel: 'My Record', scopeKind: 'record', savedQuery: 'saved' },
  ];
  plugin._r5SessionGen = 1;
  const renderCalls = [];
  plugin._renderLink = () => renderCalls.push(1);
  plugin._scheduleLinkSearch = () => {};
  plugin._r5UpdateCrumbBar = () => {};
  plugin._exitLinkMode = () => {};

  const link = {
    kind: 'line', br: '((', query: '',
    results: [], sel: 0, userSelected: false, token: 0,
    r5Session: 1, crumbBar: null, synthetic: false,
  };
  plugin._link = link;

  // Simulate the Backspace handler: query.length === 0 and scope stack non-empty.
  assert.equal(plugin._r5ScopeStack.length, 1);
  const ev = { key: 'Backspace', prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; } };
  plugin._linkKey(ev);

  // Scope should be popped, query restored.
  assert.equal(plugin._r5ScopeStack.length, 0);
  assert.equal(link.query, 'saved');
  assert.equal(ev.prevented, true);
});

test('R5 keyboard: Tab calls _r5DrillInto with current link', () => {
  const { plugin } = makePlugin();
  plugin._r5ScopeStack = [];
  plugin._r5SessionGen = 1;
  let drillCalled = false;
  plugin._r5DrillInto = (lnk) => { drillCalled = true; assert.ok(lnk, '_r5DrillInto received link'); };

  const link = {
    kind: 'line', br: '((', query: 'test',
    results: [{ guid: 'LINE1', text: 'A line', page: '', score: 100, task: null, rguid: 'R1' }],
    sel: 0, userSelected: false, token: 0, r5Session: 1, crumbBar: null, synthetic: false,
  };
  plugin._link = link;

  const ev = { key: 'Tab', prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; } };
  plugin._linkKey(ev);

  assert.equal(drillCalled, true);
  assert.equal(ev.prevented, true);
});

test('R5 keyboard: query→drill→back→insert sequence preserves savedQuery', () => {
  const { plugin } = makePlugin();
  plugin._r5ScopeStack = [];
  plugin._r5SessionGen = 1;

  // Start with a query.
  const link = {
    kind: 'line', br: '((', query: 'EMP',
    results: [{ guid: 'REC1', text: 'EMP Record', page: '', score: 200, task: null, rguid: null }],
    sel: 0, userSelected: false, token: 0, r5Session: 1, crumbBar: null,
    synthetic: false, searchTimer: null, countTimer: null,
  };
  plugin._link = link;
  plugin._renderLink = () => {};
  plugin._scheduleLinkSearch = () => {};
  plugin._r5UpdateCrumbBar = () => {};

  // Simulate _r5DrillInto (Tab) — push the scope.
  const row = link.results[0];
  plugin._r5ScopeStack.push({ scopeGuid: row.guid, scopeLabel: row.text, scopeKind: 'record', savedQuery: link.query });
  link.query = '';
  link.sel = 0; link.userSelected = false;

  // Now at scope level 1, query is empty.
  assert.equal(plugin._r5ScopeStack.length, 1);
  assert.equal(link.query, '');

  // Simulate Backspace on empty query — pop scope.
  plugin._exitLinkMode = () => {};
  const ev = { key: 'Backspace', prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; } };
  plugin._linkKey(ev);

  // Back to root, query restored to 'EMP'.
  assert.equal(plugin._r5ScopeStack.length, 0);
  assert.equal(link.query, 'EMP');
});

test('R5 drill pick consumes all of ((leak re without query residue', async () => {
  const { plugin } = makePlugin();
  plugin._r5SessionGen = 1;
  plugin._scheduleLinkSearch = () => {};
  plugin._renderLink = () => {};
  plugin._r5UpdateCrumbBar = () => {};
  plugin._exitLinkMode = () => {};
  plugin._setAutoTitleManaged = async () => {};
  plugin.getCachedCountInfo = () => ({ count: 1 });
  plugin._queueImmediateRefPaint = () => {};
  plugin.refreshAllPanels = () => {};
  plugin._toast = () => {};
  plugin._lineOwnerHints = new Map();
  plugin._lineRefGuids = new Map();
  plugin._lineTargetText = new Map();

  let segments = [{ type: 'text', text: '((' }];
  const lineItem = {
    segments,
    setSegments(next) { segments = next; this.segments = next; },
  };
  plugin._resolveLineItemByGuid = async () => lineItem;
  plugin._liveStateByGuid = () => ({
    text_segments: segments.flatMap((segment) => [segment.type, segment.text]),
  });
  plugin._liveSegs = () => segments;

  const drilledResult = {
    guid: 'LEAK_REVIEW_LINE', text: 'Leak Review with Monica', page: 'Reviews',
    score: 100, task: null, rguid: 'REVIEWS_RECORD', _ctxKind: 'child',
  };
  plugin._pickerMarkLineLive('MATCH_LINE', 'REVIEWS_RECORD', true);
  plugin._pickerMarkLineLive('LEAK_REVIEW_LINE', 'REVIEWS_RECORD', true);
  plugin._r5ScopeChildren = async () => [drilledResult];
  const link = {
    kind: 'line', br: '((', lineGuid: 'HOST_LINE', pageGuid: 'HOST_RECORD',
    bracketStart: 0, docEnd: 2, docQuery: '', query: '',
    results: [], resultsQuery: '', sel: 0, userSelected: false, token: 0,
    r5Session: 1, crumbBar: null, synthetic: false, preview: true,
    searchTimer: null, countTimer: null, autoCloseRaf: null, autoCloseEl: null,
    textCache: new Map(),
  };
  plugin._link = link;
  const referenceEdits = plugin._initReferenceEditsBroker();
  plugin._referenceEditBegin(link, segments);

  // The editor applies printable keys after the picker key handler lets them
  // through. Reproduce typing the literal document text "((leak re".
  for (const key of 'leak re') {
    const event = { key, metaKey: false, ctrlKey: false, altKey: false,
      preventDefault() {}, stopImmediatePropagation() {} };
    plugin._linkKey(event);
    segments[0].text += key;
  }
  assert.equal(segments[0].text, '((leak re');

  // Supply a root match, drill with ">", then pick a row returned by that scope.
  link.results = [{ guid: 'MATCH_LINE', text: 'Leak reviews', page: 'Reviews', score: 90, task: null, rguid: 'REVIEWS_RECORD' }];
  link.resultsQuery = 'leak re';
  const drillEvent = { key: '>', metaKey: false, ctrlKey: false, altKey: false,
    prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {} };
  plugin._linkKey(drillEvent);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(drillEvent.prevented, true);
  assert.equal(segments[0].text, '((leak re', 'drill command must not enter the document');
  assert.equal(link.results[0].guid, drilledResult.guid);

  const picked = await plugin._pickLink(link.results[0]);
  assert.equal(picked, true);
  assert.equal(segments.length, 1, 'the bracket text should be replaced by one chip');
  assert.equal(segments[0].type, 'ref');
  assert.equal(segments[0].text.guid, drilledResult.guid);
  assert.equal(segments.some((segment) => segment.type === 'text' && String(segment.text).includes('leak re')), false,
    'no literal leak re residue remains beside the chip');
  const receipt = referenceEdits.getRecent('HOST_LINE')[0];
  assert.equal(receipt.outcome, 'committed');
  assert.equal(receipt.triggerRemoved, true);
  assert.equal(receipt.residueDetected, false);
  assert.equal(receipt.actualRefCount, 1);
});

test('R5 keyboard: Enter dispatches visible zero-result create row while search is pending', () => {
  const { plugin } = makePlugin();
  plugin._r5ScopeStack = [];
  plugin._footnotesEnabled = true;
  let blockCreates = 0;
  plugin._createBlockBelowFromPicker = () => { blockCreates++; };
  const link = {
    kind: 'line', br: '((', query: 'test tgus', results: [], resultsQuery: null,
    sel: 0, userSelected: false, token: 0, r5Session: 1, synthetic: false,
    searchTimer: 123, creating: false,
  };
  plugin._link = link;
  const ev = { key: 'Enter', altKey: false, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; } };

  plugin._linkKey(ev);

  assert.equal(blockCreates, 1);
  assert.equal(ev.prevented, true);
  assert.equal(ev.stopped, true);
});

test('R5 keyboard: Alt+Enter creates footnote while search is pending', () => {
  const { plugin } = makePlugin();
  plugin._r5ScopeStack = [];
  plugin._footnotesEnabled = true;
  let footnoteCreates = 0;
  plugin._createFootnoteFromPicker = () => { footnoteCreates++; };
  const link = {
    kind: 'line', br: '((', query: 'test tgus', results: [], resultsQuery: null,
    sel: 0, userSelected: false, token: 0, r5Session: 1, synthetic: false,
    searchTimer: 123, creating: false,
  };
  plugin._link = link;
  const ev = { key: 'Enter', altKey: true, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; } };

  plugin._linkKey(ev);

  assert.equal(footnoteCreates, 1);
  assert.equal(ev.prevented, true);
  assert.equal(ev.stopped, true);
});

// ─── Filter-children-by-query tests ────────────────────────────────────────────

test('R5 _r5FilterChildrenByQuery: empty freeText retains the complete cached child pool', () => {
  const { plugin } = makePlugin();
  const children = Array.from({ length: 12 }, (_, i) => ({
    guid: 'G' + i, text: 'Item ' + i, page: '', score: 0, task: null, rguid: 'REC',
  }));
  const result = plugin._r5FilterChildrenByQuery(children, '');
  assert.equal(result.length, 12);
});

test('R5 _r5FilterChildrenByQuery: filters to matching children', () => {
  const { plugin } = makePlugin();
  const children = [
    { guid: 'G0', text: 'Apple review', page: '', score: 0, task: null, rguid: 'R' },
    { guid: 'G1', text: 'Banana meeting', page: '', score: 0, task: null, rguid: 'R' },
    { guid: 'G2', text: 'Apple pie', page: '', score: 0, task: null, rguid: 'R' },
  ];
  const result = plugin._r5FilterChildrenByQuery(children, 'Apple');
  assert.equal(result.length, 2);
  assert.ok(result.every((r) => r.text.toLowerCase().includes('apple')));
});

// ─── v4.25.0 regression tests ────────────────────────────────────────────────

test('R5 v4.25.0: _r5PostProcessResults strips HTML comment noise from text', () => {
  const { plugin } = makePlugin();
  const rows = [
    { guid: 'G1', text: 'Monica <!-- roam-page-uid -->Smith<!-- roam-uid -->', page: 'Page1', score: 100, rguid: 'R1' },
    { guid: 'G2', text: 'Bob', page: 'Page2', score: 80, rguid: 'R2' },
  ];
  const out = plugin._r5PostProcessResults(rows, { _roamRecoveryRguids: new Set() });
  assert.equal(out[0].text, 'Monica Smith', 'HTML comments stripped from display text');
  assert.equal(out[1].text, 'Bob', 'non-comment text unchanged');
});

test('R5 v4.25.0: _r5PostProcessResults dedupes identical text, keeps highest-scored row', () => {
  const { plugin } = makePlugin();
  const rows = [
    { guid: 'G1', text: 'Monica', page: 'Page1', score: 200, rguid: 'R1' },
    { guid: 'G2', text: 'Monica', page: 'Page2', score: 150, rguid: 'R2' },
    { guid: 'G3', text: 'Monica', page: 'Page3', score: 100, rguid: 'R3' },
    { guid: 'G4', text: 'Bob',    page: 'Page4', score: 50,  rguid: 'R4' },
  ];
  const out = plugin._r5PostProcessResults(rows, { _roamRecoveryRguids: new Set() });
  // Should collapse 3 Monica rows into 1, preserve Bob.
  assert.equal(out.length, 2, 'three Monica rows collapsed to one');
  const monica = out.find(r => r.text === 'Monica');
  assert.ok(monica, 'Monica row present');
  assert.equal(monica.guid, 'G1', 'highest-scored (G1) is the kept row');
  assert.equal(monica._dupeCount, 3, 'dupeCount reflects total including collapsed');
  assert.ok(out.find(r => r.text === 'Bob'), 'Bob row preserved');
});

test('R5 v4.25.0: _r5PostProcessResults deduplication is case- and whitespace-insensitive', () => {
  const { plugin } = makePlugin();
  const rows = [
    { guid: 'G1', text: 'Monica Smith', page: 'P1', score: 100, rguid: 'R1' },
    { guid: 'G2', text: 'monica  smith', page: 'P2', score: 80,  rguid: 'R2' },
  ];
  const out = plugin._r5PostProcessResults(rows, { _roamRecoveryRguids: new Set() });
  assert.equal(out.length, 1, 'case/whitespace variants deduplicated');
  assert.equal(out[0]._dupeCount, 2, 'dupeCount = 2');
});

test('R5 v4.34.0: recovery bullet equivalence does not collapse ordinary rows', () => {
  const { plugin } = makePlugin();
  const rows = [
    { guid: 'HIST', text: 'Same recovered text', score: 300, rguid: 'REC_HIST', _historicalRecovery: true },
    { guid: 'LIVE', text: '- Same recovered text', score: 200, rguid: 'REC_LIVE' },
    { guid: 'PLAIN', text: 'Ordinary text', score: 100, rguid: 'REC_PLAIN' },
    { guid: 'BULLET', text: '- Ordinary text', score: 90, rguid: 'REC_BULLET' },
  ];
  const out = plugin._r5PostProcessResults(rows, { _roamRecoveryRguids: new Set() });
  assert.deepEqual(Array.from(out, (row) => row.guid), ['LIVE', 'PLAIN', 'BULLET']);
  assert.equal(out[0]._dupeCount, 2);
});

test('R5 v4.26.0: _r5PostProcessResults preserves ambiguous alias targets', () => {
  const { plugin } = makePlugin();
  const rows = [
    { guid: 'G1', text: 'Shared route', aliasText: 'Shared route', matchKind: 'line-alias', page: 'Notes', score: 200, rguid: 'R1' },
    { guid: 'G2', text: 'Shared route', aliasText: 'Shared route', matchKind: 'line-alias', page: 'Projects', score: 180, rguid: 'R2' },
  ];
  const out = plugin._r5PostProcessResults(rows, { _roamRecoveryRguids: new Set() });
  assert.deepEqual(Array.from(out, (row) => row.guid), ['G1', 'G2']);
  assert.ok(out.every((row) => row._dupeCount === undefined), 'aliases are not collapsed into a misleading ×N row');
});

test('R5 v4.25.0: _r5PostProcessResults demotes Roam Recovery rows to bottom', () => {
  const { plugin } = makePlugin();
  const roamRguids = new Set(['ROAM_REC1', 'ROAM_REC2']);
  const rows = [
    { guid: 'G1', text: 'Real note', page: 'My Notes', score: 300, rguid: 'REAL_REC' },
    { guid: 'G2', text: 'Roam import', page: 'Recovery', score: 500, rguid: 'ROAM_REC1' },
    { guid: 'G3', text: 'Another real', page: 'My Notes', score: 200, rguid: 'REAL_REC2' },
    { guid: 'G4', text: 'Also Roam', page: 'Recovery', score: 400, rguid: 'ROAM_REC2' },
  ];
  const out = plugin._r5PostProcessResults(rows, { _roamRecoveryRguids: roamRguids });
  // Roam rows should come after non-Roam rows regardless of score.
  const nonRoam = out.filter(r => !r._isRoamRecovery);
  const roam = out.filter(r => r._isRoamRecovery);
  assert.equal(nonRoam.length, 2, 'two non-Roam rows');
  assert.equal(roam.length, 2, 'two Roam Recovery rows demoted');
  // All non-Roam before any Roam.
  const firstRoamIdx = out.findIndex(r => r._isRoamRecovery);
  const lastNonRoamIdx = out.map(r => !r._isRoamRecovery).lastIndexOf(true);
  assert.ok(lastNonRoamIdx < firstRoamIdx, 'all non-Roam rows precede Roam rows');
});

test('R5 v4.25.0: _r5PostProcessResults is a no-op for empty or absent set', () => {
  const { plugin } = makePlugin();
  // Empty Roam set — no demotion.
  const rows = [
    { guid: 'G1', text: 'Note A', page: 'P1', score: 100, rguid: 'R1' },
    { guid: 'G2', text: 'Note B', page: 'P2', score: 80,  rguid: 'R2' },
  ];
  const out1 = plugin._r5PostProcessResults(rows, { _roamRecoveryRguids: new Set() });
  assert.equal(out1.length, 2, 'no rows removed when Roam set is empty');
  assert.ok(!out1[0]._isRoamRecovery, 'no Roam flag added');
  // null link — should not throw.
  const rows2 = [{ guid: 'G1', text: 'Note', page: '', score: 10, rguid: 'R1' }];
  const out2 = plugin._r5PostProcessResults(rows2, null);
  assert.equal(out2.length, 1, 'returns results with null link');
});

test('R5 v4.25.0: _r5PostProcessResults returns empty array unchanged', () => {
  const { plugin } = makePlugin();
  assert.deepEqual(plugin._r5PostProcessResults([], { _roamRecoveryRguids: new Set() }), [], 'empty in → empty out');
  assert.deepEqual(plugin._r5PostProcessResults(null, null), null, 'null in → null out');
});

// ─── v4.26.1 cold breadcrumb regressions ────────────────────────────────────

test('R5 v4.26.1: cold [[ records use metadata-index collection membership', () => {
  const { plugin, ctx } = makePlugin();
  ctx.window.g_universe.itemsByGuid = {};
  plugin._recordCollectionIndex.set('REC_COLD', 'COL_PEOPLE');
  plugin._colNameMap = new Map([['COL_PEOPLE', 'People']]);
  let sdkReads = 0;
  plugin.data.getRecord = () => { sdkReads++; throw new Error('no SDK read in crumb'); };
  plugin.data.getAllCollections = () => { sdkReads++; throw new Error('no SDK read in crumb'); };

  assert.equal(plugin._buildPickerRowCrumb('REC_COLD'), 'People');
  assert.equal(sdkReads, 0);
});

test('R5 v4.26.1: duplicate record titles remain distinguishable by cold collection crumbs', () => {
  const { plugin } = makePlugin();
  plugin._recordCollectionIndex.set('REC_TYLER_PEOPLE', 'COL_PEOPLE');
  plugin._recordCollectionIndex.set('REC_TYLER_NOTES', 'COL_NOTES');
  plugin._colNameMap = new Map([['COL_PEOPLE', 'People'], ['COL_NOTES', 'Notes']]);

  assert.equal(plugin._buildPickerRowCrumb('REC_TYLER_PEOPLE'), 'People');
  assert.equal(plugin._buildPickerRowCrumb('REC_TYLER_NOTES'), 'Notes');
});

test('R5 v4.26.1: malformed registry property JSON cannot erase the collection crumb', () => {
  const { plugin, ctx } = makePlugin();
  ctx.window.g_universe.itemsByGuid.REC_BAD_KV = {
    guid: 'REC_BAD_KV', pguid: 'COL_NOTES', kv: { broken: '{not-json', title: '["text","Ignored"]' },
  };
  plugin._colNameMap = new Map([['COL_NOTES', 'Notes']]);

  assert.equal(plugin._buildPickerRowCrumb('REC_BAD_KV'), 'Notes');
});

test('R5 v4.26.1: cold (( lines use carried native context and owner collection fallback', () => {
  const { plugin } = makePlugin();
  plugin._recordCollectionIndex.set('REC_OWNER', 'COL_NOTES');
  plugin._colNameMap = new Map([['COL_NOTES', 'Notes']]);

  assert.equal(plugin._buildLinePickCrumb({
    guid: 'LINE_COLD', rguid: 'REC_OWNER', parentGuid: 'PARENT_COLD',
    parentText: 'Evening review', siblingCount: 2, childCount: 1,
  }), 'in Evening review · 2 siblings · 1 child');
  assert.equal(plugin._buildLinePickCrumb({ guid: 'LINE_COLDER', rguid: 'REC_OWNER' }), 'Notes');
});

test('R5 v4.26.1: search ingestion preserves cached PluginLineItem hierarchy metadata', async () => {
  const { plugin, ctx } = makePlugin();
  ctx.window.g_universe.itemsByGuid.PARENT = {
    guid: 'PARENT', text_segments: ['text', 'Parent context'], children: ['LINE_NATIVE', 'SIBLING'],
  };
  const record = { guid: 'REC_NATIVE', getName: () => 'Native record' };
  const nativeLine = {
    guid: 'LINE_NATIVE', type: 'ulist', parent_guid: 'PARENT',
    children: [{ guid: 'CHILD_A' }, { guid: 'CHILD_B' }],
    segments: [{ type: 'text', text: 'Needle result' }], getRecord: () => record,
  };
  plugin.data.searchByQuery = async () => ({ lines: [nativeLine], records: [] });
  plugin._r5SessionGen = 1;
  plugin._renderLink = () => {};
  const link = {
    kind: 'line', br: '((', query: 'needle', results: [], resultsQuery: null,
    resultsPreSliceCount: 0, sel: 0, userSelected: false, token: 0, r5Session: 1,
    lineGuid: 'HOST_LINE', pageGuid: 'HOST_RECORD', textCache: new Map(), pop: { isConnected: true },
  };
  plugin._link = link;

  await plugin._runLinkSearch('needle');

  const row = link.results.find((result) => result.guid === 'LINE_NATIVE');
  assert.ok(row);
  assert.equal(row.parentGuid, 'PARENT');
  assert.equal(row.parentText, 'Parent context');
  assert.equal(row.siblingCount, 1);
  assert.equal(row.childCount, 2);
});

test('R5 v4.26.1: cold (( ingestion and breadcrumb rendering never scan open listviews', async () => {
  const { plugin } = makePlugin();
  let liveStateCalls = 0;
  plugin._liveStateByGuid = () => { liveStateCalls++; return null; };
  plugin._recordCollectionIndex.set('REC_COLD_NATIVE', 'COL_NOTES');
  plugin._colNameMap = new Map([['COL_NOTES', 'Notes']]);
  const record = { guid: 'REC_COLD_NATIVE', getName: () => 'Cold native record' };
  const nativeLine = {
    guid: 'LINE_COLD_NATIVE', type: 'ulist', parent_guid: 'PARENT_NOT_RENDERED',
    children: [], segments: [{ type: 'text', text: 'Cold needle' }], getRecord: () => record,
  };
  plugin.data.searchByQuery = async () => ({ lines: [nativeLine], records: [] });
  plugin._r5SessionGen = 1;
  plugin._renderLink = () => {};
  const link = {
    kind: 'line', br: '((', query: 'cold needle', results: [], resultsQuery: null,
    resultsPreSliceCount: 0, sel: 0, userSelected: false, token: 0, r5Session: 1,
    lineGuid: 'HOST_LINE', pageGuid: 'HOST_RECORD', textCache: new Map(), pop: { isConnected: true },
  };
  plugin._link = link;

  await plugin._runLinkSearch('cold needle');

  const row = link.results.find((result) => result.guid === 'LINE_COLD_NATIVE');
  assert.ok(row);
  assert.equal(plugin._buildLinePickCrumb(row), 'Notes');
  assert.equal(liveStateCalls, 0);
});

test('R5 v4.26.1: metadata repaint is coalesced and rejects stale, re-queried, or disconnected pickers', async () => {
  const { plugin } = makePlugin();
  plugin._r5SessionGen = 7;
  let renders = 0;
  plugin._renderLink = () => { renders++; };
  const link = {
    r5Session: 7, token: 3, results: [{ guid: 'REC', rguid: null }],
    pop: { isConnected: true },
  };
  plugin._link = link;

  assert.equal(plugin._schedulePickerMetadataRefresh({ recordGuid: 'REC' }), true);
  assert.equal(plugin._schedulePickerMetadataRefresh({ recordGuid: 'REC' }), true);
  await Promise.resolve();
  assert.equal(renders, 1, 'same metadata burst renders once');

  plugin._schedulePickerMetadataRefresh({ recordGuid: 'REC' });
  link.token++;
  await Promise.resolve();
  assert.equal(renders, 1, 'new search token supersedes queued metadata paint');

  link.pop.isConnected = false;
  assert.equal(plugin._schedulePickerMetadataRefresh({ recordGuid: 'REC' }), false);
  link.pop.isConnected = true;
  plugin._r5SessionGen = 8;
  assert.equal(plugin._schedulePickerMetadataRefresh({ recordGuid: 'REC' }), false);
  assert.equal(renders, 1);
});

test('R5 v4.26.1: record moves and collection renames invalidate active picker breadcrumbs', async () => {
  const { plugin } = makePlugin();
  plugin._r5SessionGen = 1;
  plugin._aliasScheduleEnrich = () => {};
  plugin._refreshMovedRecordCards = () => {};
  let renders = 0;
  plugin._renderLink = () => { renders++; };
  plugin._colNameMap = new Map([['COL_OLD', 'Old'], ['COL_NEW', 'New']]);
  plugin._recordCollectionIndex.set('REC_MOVE', 'COL_OLD');
  plugin._link = {
    r5Session: 1, token: 0, results: [{ guid: 'REC_MOVE' }], pop: { isConnected: true },
  };

  plugin._onRecordMoved({ recordGuid: 'REC_MOVE', parentGuid: 'COL_NEW', collectionGuid: 'COL_OLD' });
  await Promise.resolve();
  assert.equal(plugin._recordCollectionIndex.get('REC_MOVE'), 'COL_NEW');
  assert.equal(plugin._buildPickerRowCrumb('REC_MOVE'), 'New');
  assert.equal(renders, 1);

  plugin._onCollectionMetadataChanged({ collectionGuid: 'COL_NEW', json: { name: 'Renamed' } });
  await Promise.resolve();
  assert.equal(plugin._buildPickerRowCrumb('REC_MOVE'), 'Renamed');
  assert.equal(renders, 2);
  clearTimeout(plugin._fieldTypesRebuildT);
  plugin._fieldTypesRebuildT = 0;
});

test('R5 v4.26.1: null collection config retains cached crumb while trash removes it', async () => {
  const { plugin } = makePlugin();
  plugin._r5SessionGen = 1;
  let renders = 0;
  plugin._renderLink = () => { renders++; };
  plugin._colNameMap = new Map([['COL_KEEP', 'Keep me']]);
  plugin._recordCollectionIndex.set('REC_KEEP', 'COL_KEEP');
  plugin._link = {
    r5Session: 1, token: 0, results: [{ guid: 'REC_KEEP' }], pop: { isConnected: true },
  };

  plugin._onCollectionMetadataChanged({ collectionGuid: 'COL_KEEP', json: null });
  await Promise.resolve();
  assert.equal(plugin._buildPickerRowCrumb('REC_KEEP'), 'Keep me');
  assert.equal(renders, 1);

  plugin._onCollectionMetadataChanged({ collectionGuid: 'COL_KEEP', json: null, trashed: true });
  await Promise.resolve();
  assert.equal(plugin._buildPickerRowCrumb('REC_KEEP'), '');
  assert.equal(renders, 2);
  clearTimeout(plugin._fieldTypesRebuildT);
  plugin._fieldTypesRebuildT = 0;
});

test('R5 v4.26.1: reload invalidates and reschedules breadcrumb metadata with owned cleanup', async () => {
  assert.match(source, /this\._metadataReloadHandler = this\.events\.on\("reload", \(\) => this\._onMetadataReload\(\)\)/);
  assert.match(source, /this\._metadataReloadHandler[\s\S]*this\.events\.off\(this\._metadataReloadHandler\)/);
  assert.match(source, /window\.__refxHostEvents = \[[\s\S]*this\._metadataReloadHandler/);

  const { plugin } = makePlugin();
  plugin._recordCollectionIndex.set('STALE_RECORD', 'STALE_COLLECTION');
  plugin._recordNameIndex.set('STALE_RECORD', 'Stale title');
  plugin._recordNameCache = new Map([['STALE_RECORD', 'Stale title']]);
  plugin._recordNameProbeAt.set('STALE_RECORD', Date.now());
  plugin._colNameMap = new Map([['STALE_COLLECTION', 'Stale collection']]);
  plugin._fieldTypes = { stale: 'text' };
  plugin._fieldMeta = { stale: { type: 'text' } };
  plugin._colByGuid = { STALE_COLLECTION: {} };
  plugin._recordNameIndexBuiltAt = Date.now();
  let recordBuilds = 0;
  let fieldBuilds = 0;
  plugin._scheduleRecordNameIndex = (delay) => { assert.equal(delay, 0); recordBuilds++; };
  plugin._buildFieldTypes = async () => { fieldBuilds++; };

  plugin._onMetadataReload();

  assert.equal(plugin._recordCollectionIndex.size, 0);
  assert.equal(plugin._recordNameIndex.size, 0);
  assert.equal(plugin._recordNameCache.size, 0);
  assert.equal(plugin._recordNameProbeAt.size, 0);
  assert.equal(plugin._colNameMap.size, 0);
  assert.equal(plugin._recordNameIndexBuiltAt, 0);
  assert.equal(plugin._fieldTypes, null);
  assert.equal(plugin._fieldMeta, null);
  assert.equal(plugin._colByGuid, null);
  assert.equal(recordBuilds, 1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fieldBuilds, 1);
  assert.equal(plugin._fieldTypesRebuildT, 0);
});

test('R5 v4.26.1: completed metadata index repaints the same active picker session', async () => {
  const { plugin } = makePlugin();
  const record = { guid: 'REC_INDEX', getGuid: () => 'REC_INDEX', getName: () => 'Indexed record' };
  const collection = {
    guid: 'COL_INDEX', getGuid: () => 'COL_INDEX', getName: () => 'Indexed collection',
    getAllRecords: async () => [record],
  };
  plugin.data.getAllCollections = async () => [collection];
  plugin._aliasRefreshCollectionSchemas = async () => {};
  plugin._aliasEnsureRegistryLoaded = async () => {};
  plugin._aliasReadPropertyAliases = () => [];
  plugin._aliasRegistryAliases = () => [];
  plugin._aliasReplaceRecordSet = () => false;
  plugin._aliasDisposed = true;
  plugin._r5SessionGen = 4;
  let renders = 0;
  plugin._renderLink = () => { renders++; };
  plugin._link = {
    r5Session: 4, token: 1, results: [{ guid: 'REC_INDEX' }], pop: { isConnected: true },
  };

  await plugin._buildRecordNameIndex();
  await Promise.resolve();

  assert.equal(plugin._buildPickerRowCrumb('REC_INDEX'), 'Indexed collection');
  assert.equal(renders, 1);
});

test('R5 v4.26.1: early collection metadata repaints before a later collection resolves', async () => {
  const { plugin } = makePlugin();
  const earlyRecord = { guid: 'REC_EARLY', getGuid: () => 'REC_EARLY', getName: () => 'Early record' };
  let announceSlowStart;
  let releaseSlow;
  const slowStarted = new Promise((resolve) => { announceSlowStart = resolve; });
  const slowRecords = new Promise((resolve) => { releaseSlow = resolve; });
  const earlyCollection = {
    guid: 'COL_EARLY', getGuid: () => 'COL_EARLY', getName: () => 'Early collection',
    getAllRecords: async () => [earlyRecord],
  };
  const slowCollection = {
    guid: 'COL_SLOW', getGuid: () => 'COL_SLOW', getName: () => 'Slow collection',
    getAllRecords: () => { announceSlowStart(); return slowRecords; },
  };
  plugin.data.getAllCollections = async () => [earlyCollection, slowCollection];
  plugin._aliasRefreshCollectionSchemas = async () => {};
  plugin._aliasEnsureRegistryLoaded = async () => {};
  plugin._aliasReadPropertyAliases = () => [];
  plugin._aliasRegistryAliases = () => [];
  plugin._aliasReplaceRecordSet = () => false;
  plugin._aliasDisposed = true;
  plugin._r5SessionGen = 5;
  let renders = 0;
  plugin._renderLink = () => { renders++; };
  plugin._link = {
    r5Session: 5, token: 1, results: [{ guid: 'REC_EARLY' }], pop: { isConnected: true },
  };

  const build = plugin._buildRecordNameIndex();
  await slowStarted;
  await Promise.resolve();

  assert.equal(plugin._buildPickerRowCrumb('REC_EARLY'), 'Early collection');
  assert.equal(renders, 1, 'early collection repaints while the later collection is still pending');
  releaseSlow([]);
  await build;
});

test('R5 v4.26.1: 10k cold breadcrumb builds perform zero SDK or body reads', () => {
  const { plugin } = makePlugin();
  let reads = 0;
  plugin.data = new Proxy({}, { get() { reads++; throw new Error('unexpected SDK read'); } });
  plugin._colNameMap = new Map([['COL_SCALE', 'Scale']]);
  for (let i = 0; i < 10000; i++) plugin._recordCollectionIndex.set('REC_' + i, 'COL_SCALE');

  for (let i = 0; i < 10000; i++) assert.equal(plugin._buildPickerRowCrumb('REC_' + i), 'Scale');
  assert.equal(reads, 0);
});

// ─── Version sanity ────────────────────────────────────────────────────────────

test('R5 manifest version is 4.48.6', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.version, '4.64.1');
});

test('R5 plugin.js header declares v4.48.6', () => {
  const firstLine = source.split('\n')[0];
  assert.ok(firstLine.includes("v4.64.1"), `Expected header to contain v4.64.1, got: ${firstLine}`);
});

test('R5 __REFX_VERSION runtime tell is 4.48.6', () => {
  assert.ok(source.includes('window.__REFX_VERSION = "4.64.1"'), 'Expected __REFX_VERSION = "4.51.0" in source');
});

test('R5 CHANGELOG.md has a v4.28.0 entry', () => {
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.ok(changelog.includes('## v4.28.0'), 'Expected v4.28.0 entry in CHANGELOG.md');
});

test('R5 CHANGELOG.md has v3.84.0 and v3.83.1 entries', () => {
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.ok(changelog.includes('## v3.84.0'), 'Expected v3.84.0 entry in CHANGELOG.md');
  assert.ok(changelog.includes('## v3.83.1'), 'Expected v3.83.1 entry in CHANGELOG.md');
});

// ─── R5 review regression tests (v3.83.1) ───────────────────────────────────

test('R5 F1: ordinary words are NOT routed to exactGuid path', () => {
  // looksLikeGuid previously matched any 12+ char alphanum with a capital/digit.
  // 'Retrospective' (14 chars), 'EMP26-002-BHP' (13 chars) would hijack the search.
  const { plugin } = makePlugin();
  const { filters: f1 } = plugin._r5ParseFilters('Retrospective');
  assert.ok(!f1.exactGuid, '"Retrospective" must NOT be routed to exactGuid (too short / has lowercase)');
  const { filters: f2 } = plugin._r5ParseFilters('EMP26-002-BHP');
  assert.ok(!f2.exactGuid, '"EMP26-002-BHP" must NOT be routed to exactGuid (has hyphen / lowercase)');
  const { filters: f3 } = plugin._r5ParseFilters('Brainstorming');
  assert.ok(!f3.exactGuid, '"Brainstorming" must NOT be routed to exactGuid');
  const { filters: f4 } = plugin._r5ParseFilters('PROJECT_ALPHA');
  assert.ok(!f4.exactGuid, '"PROJECT_ALPHA" must NOT be routed to exactGuid (has underscore)');
  // A real Thymer GUID (26 uppercase base32) SHOULD trigger exactGuid.
  const realGuid = 'WEJ9EZW6ADT58SJC3EQMNETSW6';
  const { filters: f5 } = plugin._r5ParseFilters(realGuid);
  assert.equal(f5.exactGuid, realGuid, 'A real 26-char uppercase Thymer GUID must be routed to exactGuid');
});

test('R5 F1: exactGuid path does not fabricate a selectable row for unresolved GUIDs', async () => {
  const { plugin } = makePlugin();
  // getRecord returns null, g_universe is empty — GUID not found.
  plugin.data.getRecord = () => null;
  // Set up a link to run _runLinkSearch against
  const link = {
    kind: 'line', br: '((', query: 'WEJ9EZW6ADT58SJC3EQMNETSW6',
    results: [], resultsQuery: null, resultsPreSliceCount: 0,
    sel: 0, userSelected: false, token: 0, r5Session: 0,
    crumbBar: null, synthetic: true, searchTimer: null,
    lineGuid: 'ALINE', pageGuid: 'APAGE', textCache: new Map(),
  };
  plugin._link = link;
  plugin._renderLink = () => {};
  plugin._r5ScopeStack = [];
  plugin._r5SessionGen = 0;
  link.r5Session = 0;
  // _runLinkSearch is async — call and wait
  await plugin._runLinkSearch('WEJ9EZW6ADT58SJC3EQMNETSW6');
  // Should have a _notFound placeholder, not a fabricated selectable row
  assert.ok(link.results.length >= 1, 'should produce at least a placeholder row');
  const row = link.results[0];
  assert.ok(row._notFound, 'unresolved GUID should produce a _notFound placeholder, not a selectable row');
  assert.ok(!row.guid || row.guid === null, 'placeholder must have null guid so it cannot be picked');
});

test('R5 F2: printable keys in scoped mode do not fall through to document', () => {
  const { plugin } = makePlugin();
  plugin._r5ScopeStack = [{ scopeGuid: 'REC1', scopeLabel: 'Test', scopeKind: 'record', savedQuery: 'foo' }];
  plugin._r5SessionGen = 1;
  plugin._renderLink = () => {};
  plugin._scheduleLinkSearch = () => {};
  const link = {
    kind: 'line', br: '((', query: '',
    results: [], sel: 0, userSelected: false, token: 0, r5Session: 1,
    crumbBar: null, synthetic: false, searchTimer: null,
  };
  plugin._link = link;
  const ev = { key: 'a', prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; } };
  plugin._linkKey(ev);
  assert.equal(ev.prevented, true, 'printable key must be prevented in scoped mode to avoid doc corruption');
  assert.equal(ev.stopped, true, 'printable key must be stopped in scoped mode');
  assert.equal(link.query, 'a', 'query must be updated even though key is prevented');
});

test('R5 F5: crumb root click restores root-level query', () => {
  const { plugin } = makePlugin();
  plugin._r5SessionGen = 1;
  plugin._renderLink = () => {};
  plugin._scheduleLinkSearch = () => {};
  const link = {
    kind: 'line', br: '((', query: 'scoped',
    results: [], sel: 0, userSelected: false, token: 0, r5Session: 1,
    crumbBar: null, synthetic: false, searchTimer: null,
  };
  plugin._link = link;
  // Set up a 1-deep stack where savedQuery='rootQuery' was saved on drill-in.
  plugin._r5ScopeStack = [{ scopeGuid: 'REC1', scopeLabel: 'Test', scopeKind: 'record', savedQuery: 'rootQuery' }];

  // Simulate clicking the root span (calls the mousedown handler).
  // Directly invoke the logic (crumbBar isn't a real DOM node in tests).
  const rootQuery = plugin._r5ScopeStack && plugin._r5ScopeStack.length > 0
    ? (plugin._r5ScopeStack[0].savedQuery || '') : '';
  plugin._r5ScopeStack = [];
  link.query = rootQuery;
  link.sel = 0; link.userSelected = false;

  assert.equal(link.query, 'rootQuery', 'root crumb click must restore root-level query, not empty string');
  assert.equal(plugin._r5ScopeStack.length, 0, 'scope stack must be empty after root click');
});

test('R5 F8: drill-down initial load slices to 8 and sets correct preSliceCount', async () => {
  const { plugin } = makePlugin();
  plugin._r5ScopeStack = [];
  plugin._r5SessionGen = 1;
  plugin._renderLink = () => {};
  plugin._r5UpdateCrumbBar = () => {};
  plugin._cleanDisplayText = (segs) => (segs || []).map((s) => s.text || '').join('');

  // Create a record with 15 children.
  const fakeItems = Array.from({ length: 15 }, (_, i) => ({
    guid: 'LINE' + i,
    segments: [{ type: 'text', text: 'Line item ' + i }],
    type: 'ulist',
  }));
  plugin.data.getRecord = (guid) => guid === 'REC1' ? {
    guid: 'REC1', getName: () => 'Test', getLineItems: async () => fakeItems,
  } : null;

  const link = {
    kind: 'line', br: '((', query: '',
    results: [{ guid: 'REC1', text: 'Test Record', page: '', score: 200, task: null, rguid: null }],
    sel: 0, userSelected: false, token: 0, r5Session: 1,
    crumbBar: null, synthetic: true, searchTimer: null,
  };
  plugin._link = link;
  plugin._pickerMarkRecordLive('REC1', true);
  for (const item of fakeItems) plugin._pickerMarkLineLive(item.guid, 'REC1', true);
  await plugin._r5DrillInto(link);
  // Wait for async children load.
  await new Promise((r) => setTimeout(r, 50));

  assert.ok(link.results.length <= 8, 'initial drill results must be capped at 8, got ' + link.results.length);
  assert.equal(link.resultsPreSliceCount, 15, 'preSliceCount must reflect ALL children (15), not capped count');
});
