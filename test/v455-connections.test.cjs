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
  plugin._referenceIndexDataGeneration = 0;
  plugin._refLevelCacheStamp = () => '0:0';
  plugin.getOrLoadRecordName = (g) => {
    const names = {
      REC_A: 'Alpha', REC_B: 'Beta', REC_C: 'Gamma', REC_D: 'Delta',
      REC_M: 'Middle', REC_X: 'Cross', REC_Y: 'Yield', REC_Z: 'Zeta',
      SRC1: 'Source One', SRC2: 'Source Two', SRC3: 'Source Three',
      CAND_HIGH: 'Candidate High', CAND_LOW: 'Candidate Low',
    };
    return names[g] || g;
  };
  const records = new Map();
  plugin.isExistingRecordGuid = (g) => records.has(g);
  plugin.data = {
    getRecord: (g) => records.get(g) || null,
  };
  if (!plugin._connDiagnostics) {
    plugin._connDiagnostics = {
      version: 1,
      indexBuilds: 0,
      indexHits: 0,
      indexCold: 0,
      pathJobs: 0,
      pathsFound: 0,
      pathTimeouts: 0,
      pathBudgetHits: 0,
      sharedQueries: 0,
      active: 0,
      maxConcurrent: 0,
    };
  }
  return { plugin, storage, context, records };
}

function seedRefLine(ctx, lineGuid, recordGuid, targetGuid) {
  ctx.window.g_universe.itemsByGuid[lineGuid] = {
    guid: lineGuid,
    rguid: recordGuid,
    text_segments: ['text', 'link', 'ref', targetGuid],
  };
}

function makeRecord(records, guid, name, extra = {}) {
  const rec = {
    guid,
    getName: () => name,
    getJournalDetails: extra.journal ? () => ({}) : undefined,
    getBackReferenceRecords: extra.backrefs
      ? async () => extra.backrefs.map((g) => ({ guid: g }))
      : async () => [],
    getAllProperties: extra.props
      ? () => extra.props
      : () => [],
  };
  records.set(guid, rec);
  return rec;
}

test('forward index is built in the same pass as reverse and records both targets', async () => {
  const { plugin, context, records } = loadPlugin();
  makeRecord(records, 'REC_SRC', 'Source');
  seedRefLine(context, 'LINE1', 'REC_SRC', 'TGT_A');
  seedRefLine(context, 'LINE2', 'REC_SRC', 'TGT_B');

  const idx = await plugin._connIndexesReady();
  assert.ok(idx.forwardRefIndex.get('REC_SRC'));
  const fwd = idx.forwardRefIndex.get('REC_SRC');
  assert.equal(fwd.has('TGT_A'), true);
  assert.equal(fwd.has('TGT_B'), true);
  assert.equal((idx.reverseRefIndex.get('TGT_A') || []).length, 1);
  assert.equal((idx.reverseRefIndex.get('TGT_B') || []).length, 1);
});

test('unchanged stamp hits cache; stamp change forces rebuild', async () => {
  const { plugin, context, records } = loadPlugin();
  makeRecord(records, 'REC_SRC', 'Source');
  seedRefLine(context, 'LINE1', 'REC_SRC', 'TGT_A');
  plugin._refLevelCacheStamp = () => '1:0';

  await plugin._connIndexesReady();
  const buildsBefore = plugin._connDiagnostics.indexBuilds;
  const idx2 = plugin._connIndexes();
  assert.equal(plugin._connDiagnostics.indexHits, 1);
  assert.equal(idx2.stamp, '1:0');
  assert.equal(plugin._connDiagnostics.indexBuilds, buildsBefore);

  plugin._refLevelCacheStamp = () => '2:0';
  const cold = plugin._connIndexes();
  assert.equal(cold, null);
  await plugin._connIndexesReady();
  assert.equal(plugin._connDiagnostics.indexBuilds, buildsBefore + 1);
  assert.equal(plugin._connIndexCache.stamp, '2:0');
});

test('cold _connIndexes returns null and enqueues connection-index background job', async () => {
  const { plugin } = loadPlugin();
  plugin._connIndexCache = null;
  plugin._refLevelCacheStamp = () => '9:9';
  const jobs = [];
  const orig = plugin._runBackgroundWork.bind(plugin);
  plugin._runBackgroundWork = (name, task) => {
    jobs.push(name);
    return orig(name, task);
  };

  const result = plugin._connIndexes();
  assert.equal(result, null);
  assert.equal(plugin._connDiagnostics.indexCold, 1);
  assert.deepEqual(jobs, ['connection-index']);
});

test('_connPathsBetween finds three-hop path shortest first', async () => {
  const { plugin, context, records } = loadPlugin();
  for (const g of ['REC_A', 'REC_B', 'REC_C']) makeRecord(records, g, g);
  seedRefLine(context, 'L_AB', 'REC_A', 'REC_B');
  seedRefLine(context, 'L_BC', 'REC_B', 'REC_C');
  const idx = await plugin._connIndexesReady();

  const out = await plugin._connPathsBetween('REC_A', 'REC_C', { indexes: idx });
  assert.equal(out.complete, true);
  assert.equal(out.paths.length, 1);
  assert.equal(out.paths[0].hops.length, 3);
  assert.equal(out.paths[0].hops[0].guid, 'REC_A');
  assert.equal(out.paths[0].hops[1].guid, 'REC_B');
  assert.equal(out.paths[0].hops[2].guid, 'REC_C');
});

test('_connPathsBetween terminates on a cycle and reports unconnected nodes', async () => {
  const { plugin, context, records } = loadPlugin();
  for (const g of ['REC_A', 'REC_B', 'REC_C', 'REC_D']) makeRecord(records, g, g);
  seedRefLine(context, 'L_AB', 'REC_A', 'REC_B');
  seedRefLine(context, 'L_BC', 'REC_B', 'REC_C');
  seedRefLine(context, 'L_CA', 'REC_C', 'REC_A');
  const idx = await plugin._connIndexesReady();

  const out = await plugin._connPathsBetween('REC_A', 'REC_D', { indexes: idx });
  assert.equal(out.paths.length, 0);
  assert.equal(out.complete, true);
  assert.equal(out.capReason, null);
});

test('_connPathsBetween respects node budget and reports capReason', async () => {
  const { plugin, records } = loadPlugin();
  makeRecord(records, 'REC_A', 'A');
  makeRecord(records, 'REC_B', 'B');
  const forwardRefIndex = new Map();
  const reverseRefIndex = new Map();
  const wide = new Set();
  const inboundB = [];
  for (let i = 0; i < 450; i++) {
    const leaf = 'LEAF' + i;
    makeRecord(records, leaf, leaf);
    wide.add(leaf);
    inboundB.push({ rguid: leaf, guid: 'LB' + i });
  }
  forwardRefIndex.set('REC_A', wide);
  reverseRefIndex.set('REC_B', inboundB);
  const idx = {
    reverseRefIndex,
    forwardRefIndex,
    rguidIndex: new Map(),
    builtAt: Date.now(),
    stamp: '0:0',
  };
  const out = await plugin._connPathsBetween('REC_A', 'REC_B', { indexes: idx });
  assert.equal(out.capReason, 'frontier-cap');
  assert.equal(out.complete, false);
});

test('property hops are admitted at depth 1 and refused at depth 2', async () => {
  const { plugin, context, records } = loadPlugin();
  makeRecord(records, 'REC_B', 'B');
  makeRecord(records, 'REC_PROP', 'Prop', {
    props: [{ name: 'Link', values: () => ['REC_B'] }],
  });
  makeRecord(records, 'REC_C', 'C');
  seedRefLine(context, 'L_BC', 'REC_B', 'REC_C');
  const idx = await plugin._connIndexesReady();

  const shallow = await plugin._connPathsBetween('REC_PROP', 'REC_C', { indexes: idx });
  assert.ok(shallow.paths.length >= 1);
  const viaProp = shallow.paths[0].hops.find((h) => h.kind === 'property');
  assert.ok(viaProp, 'expected a property hop at depth 1');

  makeRecord(records, 'REC_M', 'M');
  seedRefLine(context, 'L_MB', 'REC_M', 'REC_B');
  const deep = await plugin._connPathsBetween('REC_M', 'REC_C', { indexes: idx });
  const propAtDepth2 = deep.paths.some((p) => p.hops.slice(2).some((h) => h.kind === 'property'));
  assert.equal(propAtDepth2, false);
});

test('_connHopWeight returns 0 in this release', () => {
  const { plugin } = loadPlugin();
  assert.equal(plugin._connHopWeight('A', 'B'), 0);
});

test('_connSharedNeighbours over three targets ranks by coCount and excludes inputs', async () => {
  const { plugin, context, records } = loadPlugin();
  for (const g of ['T1', 'T2', 'T3', 'CAND_HIGH', 'CAND_LOW', 'SRC1', 'SRC2', 'SRC3']) {
    makeRecord(records, g, g);
  }
  seedRefLine(context, 'LT1', 'SRC1', 'T1');
  seedRefLine(context, 'LT2', 'SRC2', 'T2');
  seedRefLine(context, 'LT3', 'SRC3', 'T3');
  seedRefLine(context, 'LC1_T1', 'SRC1', 'CAND_HIGH');
  seedRefLine(context, 'LC2_T2', 'SRC2', 'CAND_HIGH');
  seedRefLine(context, 'LC3_T3', 'SRC3', 'CAND_HIGH');
  seedRefLine(context, 'LL1', 'SRC1', 'CAND_LOW');
  seedRefLine(context, 'LL2', 'SRC2', 'CAND_LOW');
  const idx = await plugin._connIndexesReady();

  const rows = plugin._connSharedNeighbours(['T1', 'T2', 'T3'], {
    reverseRefIndex: idx.reverseRefIndex,
    rguidIndex: idx.rguidIndex,
  });
  assert.ok(!rows.some((r) => ['T1', 'T2', 'T3'].includes(r.guid)));
  assert.equal(rows[0].guid, 'CAND_HIGH');
  assert.equal(rows[0].coCount, 3);
  const low = rows.find((r) => r.guid === 'CAND_LOW');
  assert.ok(low);
  assert.equal(low.coCount, 2);
});

test('single-guid _connSharedNeighbours matches _scoreSuggestedConnections', async () => {
  const { plugin, context, records } = loadPlugin();
  makeRecord(records, 'TARGET', 'Target');
  makeRecord(records, 'CAND', 'Candidate');
  makeRecord(records, 'SRC1', 'S1');
  makeRecord(records, 'SRC2', 'S2');
  seedRefLine(context, 'LT1', 'SRC1', 'TARGET');
  seedRefLine(context, 'LT2', 'SRC2', 'TARGET');
  seedRefLine(context, 'LC1', 'SRC1', 'CAND');
  seedRefLine(context, 'LC2', 'SRC2', 'CAND');
  const idx = await plugin._connIndexesReady();
  const direct = new Set();

  const legacy = plugin._scoreSuggestedConnections('TARGET', direct, idx.reverseRefIndex, idx.rguidIndex);
  const modern = plugin._connSharedNeighbours(['TARGET'], {
    directSourceGuids: direct,
    reverseRefIndex: idx.reverseRefIndex,
    rguidIndex: idx.rguidIndex,
  });
  assert.deepEqual(
    legacy.map((r) => ({ guid: r.recordGuid, score: r.score })),
    modern.map((r) => ({ guid: r.guid, score: r.coCount })),
  );
});

function installFakeDom(context) {
  const makeEl = (tag) => {
    const listeners = {};
    const classes = new Set();
    const syncClassName = () => {
      el.className = [...classes].join(' ');
    };
    const el = {
      tagName: String(tag).toUpperCase(),
      textContent: '', title: '', children: [], isConnected: true,
      style: {}, dataset: {}, disabled: false, _listeners: listeners,
      parentElement: null,
      classList: {
        add(...names) { names.forEach((name) => classes.add(name)); syncClassName(); },
        remove(...names) { names.forEach((name) => classes.delete(name)); syncClassName(); },
        contains(name) { return classes.has(name); },
        toggle(name, force) {
          if (force === undefined) force = !classes.has(name);
          if (force) classes.add(name); else classes.delete(name);
          syncClassName();
          return force;
        },
      },
      get className() { return [...classes].join(' '); },
      set className(value) {
        classes.clear();
        for (const part of String(value || '').split(/\s+/)) {
          if (part) classes.add(part);
        }
      },
      appendChild(child) {
        child.parentElement = this;
        child.isConnected = this.isConnected;
        this.children.push(child);
        return child;
      },
      append(...nodes) { nodes.forEach((n) => this.appendChild(n)); },
      remove() { this.isConnected = false; },
      addEventListener(type, fn) { listeners[type] = fn; },
      dispatchEvent(ev) { const fn = listeners[ev.type]; if (fn) fn(ev); return true; },
      querySelector(sel) {
        const walk = (node) => {
          if (node.matches?.(sel)) return node;
          for (const c of node.children || []) {
            const hit = walk(c);
            if (hit) return hit;
          }
          return null;
        };
        return walk(this);
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (node) => {
          if (node.matches?.(sel)) out.push(node);
          for (const c of node.children || []) walk(c);
        };
        walk(this);
        return out;
      },
      matches(sel) {
        if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
        return false;
      },
      setAttribute() {},
    };
    return el;
  };
  const textOf = (node) => {
    if (!node) return '';
    if (node.children?.length) return node.children.map(textOf).join('');
    return node.textContent || '';
  };
  context.document.createElement = makeEl;
  context.document.createTextNode = (t) => ({ nodeType: 3, textContent: String(t) });
  context.document.body.appendChild = (n) => { n.parentElement = context.document.body; n.isConnected = true; };
  return { textOf };
}

test('reference menu includes Show path to… row wired to _connOpenPathTargetPicker', () => {
  const source = fs.readFileSync(path.join(root, 'plugin.js'), 'utf8');
  const menuBlock = source.slice(source.indexOf('_openRefMenu(r, anchorEl'), source.indexOf('async _menuExpand(r)'));
  assert.match(menuBlock, /row\("Show path to…"/);
  assert.match(menuBlock, /_connOpenPathTargetPicker\(r\.targetGuid\)/);
});

test('_connOpenPathTargetPicker sets pending intent and opens synthetic record picker', () => {
  const { plugin } = loadPlugin();
  let entered = null;
  plugin._enterLinkMode = (info, kind) => { entered = { info, kind }; plugin._link = { kind, synthetic: info.synthetic }; };
  plugin._connOpenPathTargetPicker('REC_FROM');
  assert.equal(plugin._pendingConnPath?.fromGuid, 'REC_FROM');
  assert.equal(entered.kind, 'record');
  assert.equal(entered.info.synthetic, true);
  assert.equal(entered.info.lineGuid, null);
});

test('_pickLink pendingConnPath branch calls _connPathsBetween and does not insert a reference', async () => {
  const { plugin } = loadPlugin();
  plugin._link = { kind: 'record', picking: false, br: '[[', query: '', docQuery: '' };
  plugin._pendingConnPath = { fromGuid: 'REC_A' };
  plugin._pickerCanUseResult = () => true;
  plugin._r5RecordFrecency = () => {};
  plugin._searchPlan = () => ({ clauses: [] });
  plugin._pickMemoryRecord = () => {};
  let pathsArgs = null;
  plugin._connIndexesReady = async () => ({ stamp: '0:0' });
  plugin._connPathsBetween = async (a, b, opts) => {
    pathsArgs = { a, b, opts };
    return { paths: [{ hops: [{ guid: 'REC_A', label: 'A' }, { guid: 'REC_B', label: 'B' }], score: 0 }], complete: true, capReason: null };
  };
  let shown = null;
  plugin._connShowPathsResult = (from, to, out) => { shown = { from, to, out }; };
  plugin._exitLinkMode = () => { plugin._link = null; };
  let resolved = false;
  plugin._resolveLineItemByGuid = async () => { resolved = true; return null; };
  const ok = await plugin._pickLink({ guid: 'REC_B', text: 'Beta' });
  assert.equal(ok, true);
  assert.equal(pathsArgs?.a, 'REC_A');
  assert.equal(pathsArgs?.b, 'REC_B');
  assert.ok(pathsArgs?.opts?.indexes);
  assert.equal(shown.from, 'REC_A');
  assert.equal(shown.to, 'REC_B');
  assert.equal(resolved, false);
  assert.equal(plugin._pendingConnPath, null);
});

test('_connRenderPathsContainer builds one deep row per path with hop count and jump handlers', () => {
  const { plugin, context } = loadPlugin();
  installFakeDom(context);
  let jumped = null;
  plugin._closeModal = () => {};
  plugin._bridgeJump = (g) => { jumped = g; };
  const result = {
    paths: [
      { hops: [{ guid: 'REC_A', label: 'Alpha', kind: 'ref' }, { guid: 'REC_M', label: 'Mid', kind: 'ref' }, { guid: 'REC_B', label: 'Beta', kind: 'ref' }], score: 0 },
      { hops: [{ guid: 'REC_A', label: 'Alpha', kind: 'ref' }, { guid: 'REC_B', label: 'Beta', kind: 'property' }], score: 0 },
    ],
    complete: true,
    capReason: null,
  };
  const container = plugin._connRenderPathsContainer('REC_A', 'REC_B', result);
  assert.equal(container.className, 'refx-conn-paths');
  const rows = container.children.filter((c) => c.classList.contains('refx-deep-row'));
  assert.equal(rows.length, 2);
  const trail0 = rows[0].children.find((c) => c.classList.contains('refx-deep-trail'));
  const nodes0 = trail0.children.filter((c) => c.classList.contains('refx-deep-trail-node'));
  assert.equal(nodes0.length, 3);
  nodes0[1].dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  assert.equal(jumped, 'REC_M');
});

test('_connRenderPathsContainer shows empty and budget-capped messages', () => {
  const { plugin, context } = loadPlugin();
  const { textOf } = installFakeDom(context);
  const empty = plugin._connRenderPathsContainer('REC_A', 'REC_B', { paths: [], complete: true, capReason: null });
  assert.match(textOf(empty), /No path within 3 hops/);
  const capped = plugin._connRenderPathsContainer('REC_A', 'REC_B', { paths: [], complete: false, capReason: 'frontier-cap' });
  assert.match(textOf(capped), /No path within 3 hops/);
  assert.match(textOf(capped), /frontier-cap/);
  const partial = plugin._connRenderPathsContainer('REC_A', 'REC_B', {
    paths: [{ hops: [{ guid: 'REC_A', label: 'A' }, { guid: 'REC_B', label: 'B' }], score: 0 }],
    complete: false,
    capReason: 'node-budget',
  });
  assert.match(textOf(partial), /node-budget/);
  assert.match(textOf(partial), /1 path/);
});

test('_wbConnPathsAmongItems caps pairs, skips directly linked pairs, and limits paths per pair', async () => {
  const { plugin, context } = loadPlugin();
  const { textOf } = installFakeDom(context);
  plugin._wbOwner = 'OWNER';
  plugin._wbOwnerCurrent = () => true;
  plugin._wbLoadLive = async () => {
    const guids = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'];
    return guids.map((g, i) => ({ target: g, pinned: false, lineGuid: 'L' + i }));
  };
  const forwardRefIndex = new Map([['G0', new Set(['G1'])]]);
  plugin._connIndexesReady = async () => ({ forwardRefIndex, reverseRefIndex: new Map(), rguidIndex: new Map(), stamp: '0:0' });
  const calls = [];
  plugin._connPathsBetween = async (a, b, opts) => {
    calls.push({ a, b, maxPaths: opts.maxPaths });
    return { paths: [], complete: true, capReason: null };
  };
  let modalBody = null;
  plugin._openModal = ({ render }) => {
    modalBody = context.document.createElement('div');
    render(modalBody);
  };
  await plugin._wbConnPathsAmongItems();
  assert.equal(calls.length, 6);
  assert.ok(calls.every((c) => c.maxPaths === 3));
  assert.ok(!calls.some((c) => (c.a === 'G0' && c.b === 'G1') || (c.a === 'G1' && c.b === 'G0')));
  const scroll = modalBody.children[0];
  const container = scroll.children[0];
  assert.match(textOf(container), /directly linked skipped/);
});

function seedLine(context, lineGuid, recordGuid, text, extra = {}) {
  context.window.g_universe.itemsByGuid[lineGuid] = {
    guid: lineGuid,
    rguid: recordGuid,
    text_segments: ['text', text],
    ...extra,
  };
}

test('line whose rguid is the destination record yields containment not empty', async () => {
  const { plugin, context, records } = loadPlugin();
  makeRecord(records, 'MCU_PAGE', 'MCU Watch Order');
  seedLine(context, 'LINE_S3', 'MCU_PAGE', '33. Watch Agents of S.H.I.E.L.D. S3');
  const idx = await plugin._connIndexesReady();

  const out = await plugin._connPathsBetween('LINE_S3', 'MCU_PAGE', { indexes: idx });
  assert.ok(out.trivial || out.paths.length > 0, 'expected containment relationship');
  if (out.trivial) {
    assert.equal(out.trivial.lineGuid, 'LINE_S3');
    assert.equal(out.trivial.recordGuid, 'MCU_PAGE');
  } else {
    const hop = out.paths[0].hops.find((h) => h.kind === 'contains');
    assert.ok(hop, 'expected a contains hop');
  }
});

test('trivial single containment renders sentence not trail', () => {
  const { plugin, context } = loadPlugin();
  const { textOf } = installFakeDom(context);
  plugin._closeModal = () => {};
  plugin._bridgeJump = () => {};
  const container = plugin._connRenderPathsContainer('LINE_S3', 'MCU_PAGE', {
    paths: [],
    complete: true,
    capReason: null,
    trivial: {
      kind: 'line-on-record',
      lineGuid: 'LINE_S3',
      recordGuid: 'MCU_PAGE',
      lineLabel: '33. Watch Agents of S.H.I.E.L.D. S3',
      recordLabel: 'MCU Watch Order',
    },
  });
  const body = textOf(container);
  assert.match(body, /is a line on/);
  assert.match(body, /33\. Watch Agents of S\.H\.I\.E\.L\.D\. S3/);
  assert.match(body, /MCU Watch Order/);
  assert.equal(container.querySelectorAll('.refx-deep-row').length, 0);
});

test('all-reference path outranks equal-length path with containment hop', () => {
  const { plugin } = loadPlugin();
  const refOnly = {
    hops: [
      { guid: 'A', kind: 'ref' },
      { guid: 'B', kind: 'ref' },
      { guid: 'C', kind: 'ref' },
    ],
    score: 0,
  };
  const withContain = {
    hops: [
      { guid: 'L', kind: 'ref' },
      { guid: 'P', kind: 'contains' },
      { guid: 'C', kind: 'ref' },
    ],
    score: 0,
  };
  assert.equal(refOnly.hops.length, withContain.hops.length);
  assert.ok(
    plugin._connPathSortPenalty(refOnly) < plugin._connPathSortPenalty(withContain),
    'reference path should rank above containment at equal length',
  );
});

test('record to lines fan-out capped at 200 and counts against node budget', async () => {
  const { plugin, records } = loadPlugin();
  makeRecord(records, 'BIG_PAGE', 'Big Page');
  const rguidIndex = new Map();
  const ownerByLine = new Map();
  const lines = [];
  for (let i = 0; i < 250; i++) {
    const lg = 'LINE' + i;
    lines.push({ guid: lg, rguid: 'BIG_PAGE', text_segments: ['text', 'row ' + i] });
    ownerByLine.set(lg, 'BIG_PAGE');
  }
  rguidIndex.set('BIG_PAGE', lines);
  const idx = {
    reverseRefIndex: new Map(),
    forwardRefIndex: new Map(),
    rguidIndex,
    ownerByLine,
    childrenByLine: new Map(),
    childRefInbound: new Map(),
    builtAt: Date.now(),
    stamp: '0:0',
  };
  const out = await plugin._connPathsBetween('BIG_PAGE', 'LINE0', { indexes: idx });
  assert.ok(out.paths.length >= 1 || out.trivial);
  const visited = new Set();
  for (const p of out.paths) for (const h of p.hops) visited.add(h.guid);
  let lineHops = 0;
  for (const p of out.paths) {
    lineHops += p.hops.filter((h) => h.kind === 'contains' && ownerByLine.has(h.guid)).length;
  }
  assert.ok(lineHops <= 200, 'record→lines fan-out must cap at 200');
});

test('ref carried by direct child reachable in one via-child hop; great-grandchild is not', async () => {
  const { plugin, context, records } = loadPlugin();
  makeRecord(records, 'PAGE', 'Page');
  seedLine(context, 'PARENT', 'PAGE', 'parent');
  seedLine(context, 'CHILD', 'PAGE', 'child', { parent_guid: 'PARENT' });
  seedLine(context, 'GRAND', 'PAGE', 'grand', { parent_guid: 'CHILD' });
  seedLine(context, 'GREAT', 'PAGE', 'great', { parent_guid: 'GRAND' });
  context.window.g_universe.itemsByGuid.CHILD.text_segments = ['text', 'child', 'ref', 'TGT_NEAR'];
  context.window.g_universe.itemsByGuid.GREAT.text_segments = ['text', 'great', 'ref', 'TGT_FAR'];
  makeRecord(records, 'TGT_NEAR', 'Near');
  makeRecord(records, 'TGT_FAR', 'Far');
  const idx = await plugin._connIndexesReady();

  const near = await plugin._connPathsBetween('PARENT', 'TGT_NEAR', { indexes: idx });
  assert.ok(
    near.paths.some((p) => p.hops.length === 2 && p.hops[1].kind === 'child-ref'),
    'child ref hop expected in one step from parent line',
  );
  const far = await plugin._connPathsBetween('PARENT', 'TGT_FAR', { indexes: idx });
  assert.ok(
    !far.paths.some((p) => p.hops.length === 2 && p.hops[1].kind === 'child-ref'),
    'great-grandchild ref must not be one via-child hop from parent',
  );
});

test('_connSharedNeighbours reports shared owner distinctly from shared reference', async () => {
  const { plugin, context, records } = loadPlugin();
  const baseName = plugin.getOrLoadRecordName.bind(plugin);
  plugin.getOrLoadRecordName = (g) => ({
    SHARED_PAGE: 'MCU Watch Order',
    SHARED_REF: 'Shared Ref Target',
    SRC: 'Source',
    T1: 'T1',
    T2: 'T2',
  }[g] || baseName(g));
  makeRecord(records, 'SHARED_PAGE', 'MCU Watch Order');
  makeRecord(records, 'SHARED_REF', 'Shared Ref Target');
  makeRecord(records, 'SRC', 'Source');
  seedLine(context, 'LINE_A', 'SHARED_PAGE', 'line A');
  seedLine(context, 'LINE_B', 'SHARED_PAGE', 'line B');
  seedRefLine(context, 'L_REF_A', 'SRC', 'SHARED_REF');
  seedRefLine(context, 'L_REF_B', 'SRC', 'SHARED_REF');
  const idx = await plugin._connIndexesReady();

  const ownerRows = plugin._connSharedNeighbours(['LINE_A', 'LINE_B'], {
    reverseRefIndex: idx.reverseRefIndex,
    rguidIndex: idx.rguidIndex,
    ownerByLine: idx.ownerByLine,
  });
  const ownerHit = ownerRows.find((r) => r.sharedVia === 'owner');
  assert.ok(ownerHit, 'expected shared owner row');
  assert.equal(ownerHit.guid, 'SHARED_PAGE');
  assert.match(ownerHit.ownerLabel, /both on MCU Watch Order/);

  makeRecord(records, 'T1', 'T1');
  makeRecord(records, 'T2', 'T2');
  seedRefLine(context, 'LT1', 'SRC', 'T1');
  seedRefLine(context, 'LT2', 'SRC', 'T2');
  seedRefLine(context, 'LC1', 'SRC', 'SHARED_REF');
  plugin._connIndexCache = null;
  plugin._refLevelCacheStamp = () => '1:0';
  const idx2 = await plugin._connIndexesReady();
  const refRows = plugin._connSharedNeighbours(['T1', 'T2'], {
    reverseRefIndex: idx2.reverseRefIndex,
    rguidIndex: idx2.rguidIndex,
    ownerByLine: idx2.ownerByLine,
  });
  const refHit = refRows.find((r) => r.guid === 'SHARED_REF');
  assert.ok(refHit, 'expected shared reference candidate');
  assert.equal(refHit.sharedVia, 'reference');
  assert.notEqual(refHit.sharedVia, 'owner');
});

test('v4.64.1 version locks', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.version, '4.64.1');
  assert.ok(source.startsWith('// v4.64.1'));
  assert.ok(source.includes('window.__REFX_VERSION = "4.64.1"'));
});
