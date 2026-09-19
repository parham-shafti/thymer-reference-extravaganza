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
      createElement: () => ({
        style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        append() {}, setAttribute() {}, appendChild() {}, replaceChildren() {},
        addEventListener() {}, remove() {},
        hidden: false, children: [], isConnected: true, parentElement: null,
        previousElementSibling: null, nextSibling: null, dataset: {},
      }),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { clientHeight: 900 },
      body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {} },
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
  plugin._connDiagnostics = { indexHits: 0, indexCold: 0, indexBuilds: 0 };
  plugin._recheckBackgroundGate = async () => true;
  plugin._runBackgroundWork = (_name, task) => task(null);
  plugin._toast = () => {};
  plugin._wbHeaders = new Map();
  plugin._wbOwner = { token: 1 };
  plugin._wbOwnerCurrent = () => true;
  plugin._wbRefreshCurrent = () => true;
  plugin._wbRefreshSeq = 1;
  plugin.getOrLoadRecordName = (g) => ({ REC_OWNER: 'Owner Page', REC_A: 'Alpha' }[g] || g);
  plugin._bridgeJump = () => {};
  plugin._refRowClipboardActions = () => [];
  plugin._navigatorContextText = (anc) => (anc?.segments || []).map((s) => s.text).join('');
  plugin._mediaLineInfo = () => null;
  plugin._cleanDisplayText = (segs) => (segs || []).map((s) => s.text || '').join('');
  plugin._mkRefRowAction = (label, title, fn) => ({ label, title, fn });
  plugin.data = {
    getRecord: (g) => (['REC_OWNER', 'REC_A'].includes(g) ? { guid: g, getName: () => plugin.getOrLoadRecordName(g), getLineItems: async () => [] } : null),
    getAllCollections: async () => [],
  };
  return { plugin, context, storage };
}

function seedParentObjectRegistry(ctx, ownerGuid) {
  ctx.window.g_universe.itemsByGuid = {
    LINE_LEAF: {
      guid: 'LINE_LEAF', rguid: ownerGuid, type: 'task',
      text_segments: ['text', 'leaf text'],
      parent: { guid: 'LINE_MID', type: 'text' },
    },
    LINE_MID: {
      guid: 'LINE_MID', rguid: ownerGuid, type: 'text',
      text_segments: ['text', 'mid text'],
      parent: { guid: 'LINE_ROOT', type: 'text' },
    },
    LINE_ROOT: {
      guid: 'LINE_ROOT', rguid: ownerGuid, type: 'text',
      text_segments: ['text', 'root text'],
      parent: { guid: ownerGuid, type: 'document' },
    },
    [ownerGuid]: {
      guid: ownerGuid, rguid: ownerGuid, type: 'document', parent_unknown: true,
    },
  };
}

function seedParentGuidRegistry(ctx, ownerGuid) {
  ctx.window.g_universe.itemsByGuid = {
    LINE_LEAF: {
      guid: 'LINE_LEAF', rguid: ownerGuid, type: 'text',
      text_segments: ['text', 'leaf'],
      parent_guid: 'LINE_MID',
    },
    LINE_MID: {
      guid: 'LINE_MID', rguid: ownerGuid, type: 'text',
      text_segments: ['text', 'mid'],
      parent_guid: ownerGuid,
    },
    [ownerGuid]: {
      guid: ownerGuid, rguid: ownerGuid, type: 'document', parent_unknown: true,
    },
  };
}

function seedFourLevelChain(ctx) {
  const owner = 'REC_OWNER';
  ctx.window.g_universe.itemsByGuid = {
    LINE_D: {
      guid: 'LINE_D', rguid: owner, type: 'task',
      text_segments: ['text', 'd'],
      parent: { guid: 'LINE_C', type: 'text' },
    },
    LINE_C: {
      guid: 'LINE_C', rguid: owner, type: 'text',
      text_segments: ['text', 'c'],
      parent: { guid: 'LINE_B', type: 'text' },
    },
    LINE_B: {
      guid: 'LINE_B', rguid: owner, type: 'text',
      text_segments: ['text', 'b'],
      parent: { guid: 'LINE_A', type: 'text' },
    },
    LINE_A: {
      guid: 'LINE_A', rguid: owner, type: 'text',
      text_segments: ['text', 'a'],
      parent: { guid: owner, type: 'document' },
    },
    [owner]: { guid: owner, rguid: owner, type: 'document', parent_unknown: true },
  };
}

test('childrenByLine populated when registry uses parent objects only', async () => {
  const { plugin, context } = loadPlugin();
  seedParentObjectRegistry(context, 'REC_OWNER');
  const idx = await plugin._buildConnIndexesChunked(null, '0:0');
  assert.ok(idx.childrenByLine.get('LINE_MID'));
  assert.equal(idx.childrenByLine.get('LINE_MID')[0], 'LINE_LEAF');
  assert.ok(idx.childrenByLine.get('LINE_ROOT'));
  assert.equal(idx.childrenByLine.get('LINE_ROOT')[0], 'LINE_MID');
});

test('childrenByLine populated when registry uses parent_guid strings', async () => {
  const { plugin, context } = loadPlugin();
  seedParentGuidRegistry(context, 'REC_OWNER');
  const idx = await plugin._buildConnIndexesChunked(null, '0:0');
  assert.equal(idx.childrenByLine.get('LINE_MID')?.[0], 'LINE_LEAF');
  assert.equal(idx.childrenByLine.get('REC_OWNER')?.[0], 'LINE_MID');
});

test('childRefInbound ancestor walk advances under parent objects', async () => {
  const { plugin, context } = loadPlugin();
  seedParentObjectRegistry(context, 'REC_OWNER');
  context.window.g_universe.itemsByGuid.LINE_MID.text_segments = ['text', 'x', 'ref', 'TGT_X'];
  const idx = await plugin._buildConnIndexesChunked(null, '0:0');
  const inbound = idx.childRefInbound.get('TGT_X') || [];
  assert.ok(inbound.some((e) => e.carrier === 'LINE_ROOT'));
});

test('childRefInbound ancestor walk advances under parent_guid strings', async () => {
  const { plugin, context } = loadPlugin();
  seedParentGuidRegistry(context, 'REC_OWNER');
  context.window.g_universe.itemsByGuid.LINE_MID.text_segments = ['text', 'x', 'ref', 'TGT_Y'];
  const idx = await plugin._buildConnIndexesChunked(null, '0:0');
  const inbound = idx.childRefInbound.get('TGT_Y') || [];
  assert.ok(inbound.some((e) => e.carrier === 'REC_OWNER'));
});

test('_wbCtxChain resolves nearest-first and excludes target and owner', () => {
  const { plugin, context } = loadPlugin();
  seedFourLevelChain(context);
  const out = plugin._wbCtxChain('LINE_D');
  assert.equal(out.ownerGuid, 'REC_OWNER');
  assert.equal(out.complete, true);
  assert.equal(out.chain.length, 3);
  assert.equal(out.chain[0].guid, 'LINE_C');
  assert.equal(out.chain[1].guid, 'LINE_B');
  assert.equal(out.chain[2].guid, 'LINE_A');
  assert.ok(!out.chain.some((c) => c.guid === 'LINE_D'));
  assert.ok(!out.chain.some((c) => c.guid === 'REC_OWNER'));
});

test('_wbCtxChain stops at document type', () => {
  const { plugin, context } = loadPlugin();
  seedFourLevelChain(context);
  const out = plugin._wbCtxChain('LINE_A');
  assert.equal(out.chain.length, 0);
  assert.equal(out.complete, true);
});

test('_wbCtxChain stops on parent_unknown', () => {
  const { plugin, context } = loadPlugin();
  context.window.g_universe.itemsByGuid = {
    LINE_X: {
      guid: 'LINE_X', rguid: 'REC_OWNER', type: 'text',
      text_segments: ['text', 'x'], parent_unknown: true,
    },
  };
  const out = plugin._wbCtxChain('LINE_X');
  assert.equal(out.chain.length, 0);
  assert.equal(out.complete, false);
});

test('_wbCtxChain cycle guard', () => {
  const { plugin, context } = loadPlugin();
  context.window.g_universe.itemsByGuid = {
    A: { guid: 'A', rguid: 'REC_OWNER', type: 'text', text_segments: ['text', 'a'], parent: { guid: 'B', type: 'text' } },
    B: { guid: 'B', rguid: 'REC_OWNER', type: 'text', text_segments: ['text', 'b'], parent: { guid: 'A', type: 'text' } },
  };
  const out = plugin._wbCtxChain('A');
  assert.equal(out.complete, false);
});

test('_wbCtxChain 12-hop cap', () => {
  const { plugin, context } = loadPlugin();
  const reg = {};
  let prev = null;
  for (let i = 0; i < 14; i++) {
    const g = 'H' + i;
    reg[g] = {
      guid: g, rguid: 'REC_OWNER', type: 'text',
      text_segments: ['text', String(i)],
      parent: prev ? { guid: prev, type: 'text' } : { guid: 'REC_OWNER', type: 'document' },
    };
    prev = g;
  }
  reg.REC_OWNER = { guid: 'REC_OWNER', rguid: 'REC_OWNER', type: 'document', parent_unknown: true };
  context.window.g_universe.itemsByGuid = reg;
  const out = plugin._wbCtxChain('H13');
  assert.ok(out.chain.length <= 12);
});

test('cold hop yields complete:false', () => {
  const { plugin } = loadPlugin();
  const out = plugin._wbCtxChain('MISSING_GUID');
  assert.equal(out.complete, false);
  assert.equal(out.chain.length, 0);
});

test('_wbCtxTrailPlan shows all ancestors when count is 3', () => {
  const { plugin } = loadPlugin();
  const chain = [{ guid: 'A' }, { guid: 'B' }, { guid: 'C' }];
  const plan = plugin._wbCtxTrailPlan(chain);
  assert.equal(plan.hidden.length, 0);
  assert.equal(plan.tail.length, 3);
});

test('_wbCtxTrailPlan collapses 10 ancestors to hidden plus last 8', () => {
  const { plugin } = loadPlugin();
  const chain = [];
  for (let i = 1; i <= 10; i++) chain.push({ guid: 'P' + i });
  const plan = plugin._wbCtxTrailPlan(chain);
  assert.equal(plan.hidden.length, 2);
  assert.equal(plan.tail.length, 8);
  assert.equal(plan.tail[0].guid, 'P1');
  assert.equal(plan.tail[7].guid, 'P8');
  assert.equal(plan.hidden[0].guid, 'P9');
});

test('_crumbIdentity drops pure self-ref crumb', () => {
  const { plugin } = loadPlugin();
  const line = { segments: [{ type: 'ref', text: 'SELF_GUID' }] };
  assert.equal(plugin._crumbIdentity(line), 'SELF_GUID');
  assert.equal(plugin._isPureSelfRef(line, 'SELF_GUID'), true);
});

test('_wbLiveRenderContext mounts nothing for record target', () => {
  const { plugin } = loadPlugin();
  const node = {
    classList: { toggle() {}, contains: () => false, add() {} },
    insertBefore() {},
    firstChild: null,
  };
  const h = { el: { nextSibling: null, isConnected: true } };
  const it = { target: 'REC_A', lineGuid: 'WB1', variant: 'full' };
  plugin._wbLiveRenderContext(node, it, h, false);
  assert.equal(h.ctx, undefined);
});

test('_wbCtxDropRedundantOwner exact match drops owner', () => {
  const { plugin } = loadPlugin();
  const owner = 'both forms assume one fixed site list';
  const chain = ['both forms assume one fixed site list'];
  assert.equal(plugin._wbCtxDropRedundantOwner(owner, chain), true);
});

test('_wbCtxDropRedundantOwner prefix match drops owner', () => {
  const { plugin } = loadPlugin();
  const owner = 'both forms assume';
  const chain = ['both forms assume one fixed site list. If you swab different locations'];
  assert.equal(plugin._wbCtxDropRedundantOwner(owner, chain), true);
});

test('_wbCtxDropRedundantOwner ellipsis-stripped match drops owner', () => {
  const { plugin } = loadPlugin();
  const owner = 'both forms assume one fixed site l…';
  const chain = ['both forms assume one fixed site list'];
  assert.equal(plugin._wbCtxDropRedundantOwner(owner, chain), true);
});

test('_wbCtxDropRedundantOwner case and whitespace differences drop owner', () => {
  const { plugin } = loadPlugin();
  const owner = '  BOTH   forms assume  ';
  const chain = ['both forms assume one fixed site list'];
  assert.equal(plugin._wbCtxDropRedundantOwner(owner, chain), true);
});

test('_wbCtxDropRedundantOwner no-match keeps owner', () => {
  const { plugin } = loadPlugin();
  assert.equal(plugin._wbCtxDropRedundantOwner('Alpha Page', ['unrelated ancestor text']), false);
});

test('_wbCtxDropRedundantOwner empty chain keeps owner', () => {
  const { plugin } = loadPlugin();
  assert.equal(plugin._wbCtxDropRedundantOwner('Owner Page', []), false);
  assert.equal(plugin._wbCtxDropRedundantOwner('Owner Page', null), false);
});

test('_wbCtxTruncateCrumbLabels caps display at 28 chars with full title', () => {
  const { plugin } = loadPlugin();
  const full = 'A'.repeat(60);
  const btn = { textContent: full, title: '' };
  const crumbEl = {
    querySelectorAll: (sel) => (sel.includes('trc-ref-popover-crumb-parent') ? [btn] : []),
  };
  plugin._wbCtxTruncateCrumbLabels(crumbEl);
  assert.equal(btn.textContent, 'A'.repeat(28) + '…');
  assert.equal(btn.title, full);
});

test('wb context trail wrap CSS scoped under .refx-wb-ctx only', () => {
  const scoped = [
    '.refx-wb-ctx .trc-ref-popover-crumb',
    '.refx-wb-ctx .trc-ref-popover-crumb-rec',
    '.refx-wb-ctx .trc-ref-crumb-anc',
    '.refx-wb-ctx .refx-wb-ctx-dots',
    '.refx-wb-ctx .trc-ref-popover-crumb-sep',
  ];
  for (const sel of scoped) assert.ok(source.includes(sel), `missing scoped rule ${sel}`);
  assert.match(source, /\.refx-wb-item > \.refx-wb-ctx \{[^}]*display: flex[^}]*flex-wrap: wrap/);
  const ctxBlock = source.match(/\.refx-wb-item > \.refx-wb-ctx \{[^}]+\}/);
  assert.ok(ctxBlock, 'missing .refx-wb-item > .refx-wb-ctx block');
  assert.doesNotMatch(ctxBlock[0], /text-overflow: ellipsis/);
  assert.doesNotMatch(source, /(?<!\.refx-wb-ctx )\.trc-ref-crumb-anc,\s*\n\s*\.refx-wb-ctx-dots/);
});

function makeShelfNode(targetGuid, ownerGuid) {
  const listview = {
    getAttribute: (k) => (k === 'data-guid' ? ownerGuid : null),
    closest: () => null,
  };
  const li = {
    getAttribute: (k) => (k === 'data-guid' ? targetGuid : null),
    closest: (sel) => (sel && sel.includes('listview-items') ? listview : null),
  };
  return {
    querySelector: (sel) => {
      if (sel.includes('transclusion-container-div') && sel.includes(targetGuid)) return li;
      if (sel.includes(targetGuid)) return li;
      return null;
    },
  };
}

function makeWbHeader(plugin, lineGuid = 'WB1') {
  const h = {
    el: { nextSibling: null, isConnected: true, querySelector: () => null },
    ctx: null,
    ctxChain: null,
    ctxExpanded: false,
    ctxRetryTimer: 0,
    ctxResolveGen: 0,
  };
  plugin._el = (tag, cls) => ({
    tagName: tag,
    className: cls,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {},
    replaceChildren() {},
    remove() {},
    append() {},
    appendChild() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    isConnected: false,
  });
  plugin._wbHeaders.set(lineGuid, h);
  return h;
}

test('empty registry + sdk owner resolves async chain and paints once', async () => {
  const { plugin } = loadPlugin();
  plugin._lineOwnerHints = new Map([['LINE_COLD', 'REC_OWNER']]);
  plugin._refContextTree = () => ({});
  plugin._refContextRelations = () => ({
    target: { guid: 'LINE_COLD' },
    chain: [{ guid: 'LINE_COLD', segments: [{ text: 'leaf' }] }, { guid: 'LINE_A', segments: [{ text: 'a' }] }],
  });
  plugin._appendFlatAncestorTrail = () => {};
  plugin._wbCtxTruncateCrumbLabels = () => {};
  let paints = 0;
  plugin._wbLiveRenderContextPaint = () => { paints++; };
  const it = { target: 'LINE_COLD', lineGuid: 'WB1', variant: 'full' };
  const h = makeWbHeader(plugin, it.lineGuid);
  const node = makeShelfNode('LINE_COLD', 'REC_OWNER');
  plugin._wbLiveRenderContext(node, it, h, false);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(paints, 1);
  assert.equal(h.ctxChain?.complete, true);
  assert.equal(h.ctxChain?.ownerGuid, 'REC_OWNER');
});

test('empty registry + unresolvable owner mounts nothing and stops retrying', () => {
  const { plugin } = loadPlugin();
  plugin._wbLiveRenderContextPaint = () => { throw new Error('should not paint'); };
  const it = { target: 'MISSING', lineGuid: 'WB2', variant: 'full' };
  const h = makeWbHeader(plugin, it.lineGuid);
  const node = { querySelector: () => null };
  for (let attempt = 0; attempt < 8; attempt++) {
    plugin._wbCtxCancelWarmRetry(h);
    plugin._wbCtxWarmResolve(h, it, node, false, null, plugin._wbOwner, 1, attempt);
  }
  assert.equal(h.ctxChain, null);
  plugin._wbCtxCancelWarmRetry(h);
  plugin._wbCtxScheduleWarmRetry(h, it, node, false, null, plugin._wbOwner, 1, 9);
  assert.equal(h.ctxRetryTimer, 0);
});

test('retry cancellation clears timer when item removed mid-backoff', () => {
  const { plugin } = loadPlugin();
  const it = { target: 'LINE_X', lineGuid: 'WB3', variant: 'full' };
  const h = makeWbHeader(plugin, it.lineGuid);
  h.ctxResolveGen = 1;
  const node = { querySelector: () => null };
  plugin._wbCtxScheduleWarmRetry(h, it, node, false, null, plugin._wbOwner, 1, 0);
  assert.ok(h.ctxRetryTimer);
  plugin._wbCtxCancelWarmRetry(h);
  assert.equal(h.ctxRetryTimer, 0);
});

test('generation guard blocks stale resolve paint', async () => {
  const { plugin } = loadPlugin();
  plugin._lineOwnerHints = new Map([['LINE_COLD', 'REC_OWNER']]);
  plugin._refContextTree = () => ({});
  plugin._refContextRelations = () => ({
    target: { guid: 'LINE_COLD' },
    chain: [{ guid: 'LINE_A', segments: [{ text: 'a' }] }],
  });
  let paints = 0;
  plugin._wbLiveRenderContextPaint = () => { paints++; };
  const h = makeWbHeader(plugin, 'WB4');
  h.ctxResolveGen = 1;
  plugin._wbCtxChainAsync('LINE_COLD', 'REC_OWNER').then((result) => {
    h.ctxResolveGen = 2;
    const alive = () => h.ctxResolveGen === 1;
    plugin._wbCtxWarmPaint(h, { lineGuid: 'WB4', target: 'LINE_COLD' }, null, result, alive, null);
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(paints, 0);
});

test('successful warm resolve paints exactly once across retry ticks', async () => {
  const { plugin, context } = loadPlugin();
  const owner = 'REC_OWNER';
  let paints = 0;
  plugin._wbLiveRenderContextPaint = () => { paints++; };
  plugin._appendFlatAncestorTrail = () => {};
  plugin._wbCtxTruncateCrumbLabels = () => {};
  plugin._lineOwnerHints = new Map([['LINE_WARM', owner]]);
  plugin._refContextTree = () => ({});
  plugin._refContextRelations = () => ({ target: null, chain: [] });
  const it = { target: 'LINE_WARM', lineGuid: 'WB5', variant: 'full' };
  const h = makeWbHeader(plugin, it.lineGuid);
  h.ctx = plugin._el('div', 'refx-wb-ctx');
  h.ctxResolveGen = 1;
  const node = makeShelfNode('LINE_WARM', owner);
  for (let attempt = 0; attempt < 2; attempt++) {
    plugin._wbCtxCancelWarmRetry(h);
    plugin._wbCtxWarmResolve(h, it, node, false, null, plugin._wbOwner, 1, attempt);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(paints, 0);
  }
  context.window.g_universe.itemsByGuid = {
    LINE_WARM: {
      guid: 'LINE_WARM', rguid: owner, type: 'task',
      text_segments: ['text', 'warm'],
      parent: { guid: 'LINE_A', type: 'text' },
    },
    LINE_A: {
      guid: 'LINE_A', rguid: owner, type: 'text',
      text_segments: ['text', 'a'],
      parent: { guid: owner, type: 'document' },
    },
    [owner]: { guid: owner, rguid: owner, type: 'document', parent_unknown: true },
  };
  plugin._wbCtxCancelWarmRetry(h);
  plugin._wbCtxWarmResolve(h, it, node, false, null, plugin._wbOwner, 1, 2);
  await new Promise((r) => setTimeout(r, 0));
  plugin._wbCtxWarmResolve(h, it, node, false, null, plugin._wbOwner, 1, 3);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(paints, 1);
  assert.equal(h.ctxChain?.complete, true);
});

test('registry warms on attempt 3 paints once and schedules no attempt 4', async () => {
  const { plugin, context } = loadPlugin();
  const owner = 'REC_OWNER';
  let paints = 0;
  plugin._wbLiveRenderContextPaint = () => { paints++; };
  plugin._appendFlatAncestorTrail = () => {};
  plugin._wbCtxTruncateCrumbLabels = () => {};
  plugin._lineOwnerHints = new Map([['LINE_WARM3', owner]]);
  plugin._refContextTree = () => ({});
  plugin._refContextRelations = () => ({ target: null, chain: [] });
  const it = { target: 'LINE_WARM3', lineGuid: 'WB6', variant: 'full' };
  const h = makeWbHeader(plugin, it.lineGuid);
  const node = makeShelfNode('LINE_WARM3', owner);
  let attempt = 0;
  const origWarm = plugin._wbCtxWarmResolve.bind(plugin);
  plugin._wbCtxWarmResolve = (...args) => {
    attempt++;
    if (attempt === 3) {
      context.window.g_universe.itemsByGuid = {
        LINE_WARM3: {
          guid: 'LINE_WARM3', rguid: owner, type: 'task',
          text_segments: ['text', 'warm'],
          parent: { guid: 'LINE_A', type: 'text' },
        },
        LINE_A: {
          guid: 'LINE_A', rguid: owner, type: 'text',
          text_segments: ['text', 'a'],
          parent: { guid: owner, type: 'document' },
        },
        [owner]: { guid: owner, rguid: owner, type: 'document', parent_unknown: true },
      };
      plugin._refContextRelations = () => ({
        target: { guid: 'LINE_WARM3' },
        chain: [{ guid: 'LINE_A', segments: [{ text: 'a' }] }],
      });
    }
    return origWarm(...args);
  };
  plugin._wbLiveRenderContext(node, it, h, false);
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0));
    plugin._wbCtxWarmResolve(h, it, node, false, null, plugin._wbOwner, 1, i);
    await new Promise((r) => setTimeout(r, 0));
  }
  assert.equal(paints, 1);
  assert.equal(h.ctxChain?.complete, true);
  assert.equal(h.ctxRetryTimer, 0);
});

test('_wbCtxResolveOwner prefers liveState then shelf dom then sdk', () => {
  const { plugin, context } = loadPlugin();
  context.window.g_universe.listviews = [{
    getItems: () => [{ state: { guid: 'LINE_A', rguid: 'REC_LIVE' } }],
  }];
  const outLive = plugin._wbCtxResolveOwner('LINE_A', null);
  assert.equal(outLive.source, 'liveState');
  assert.equal(outLive.ownerGuid, 'REC_LIVE');
  const node = makeShelfNode('LINE_B', 'REC_DOM');
  const outDom = plugin._wbCtxResolveOwner('LINE_B', node);
  assert.equal(outDom.source, 'dom');
  assert.equal(outDom.ownerGuid, 'REC_DOM');
  plugin._lineOwnerHints = new Map([['LINE_C', 'REC_SDK']]);
  const outSdk = plugin._wbCtxResolveOwner('LINE_C', null);
  assert.equal(outSdk.source, 'sdk');
  assert.equal(outSdk.ownerGuid, 'REC_SDK');
});

test('v4.64.1 version locks', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.version, '4.64.1');
  assert.ok(source.startsWith('// v4.64.1'));
  assert.ok(source.includes('window.__REFX_VERSION = "4.64.1"'));
});

test('_wbMutationIgnored matches refx-wb-ctx but not native hosts', () => {
  const { plugin } = loadPlugin();
  const ctxNode = {
    nodeType: 1,
    matches: (sel) => sel.includes('refx-wb-ctx'),
    closest: () => null,
    classList: { contains: (c) => c === 'refx-wb-ctx' },
  };
  const lineDiv = {
    nodeType: 1,
    matches: () => false,
    closest: () => null,
    classList: { contains: (c) => c === 'line-div' },
  };
  const lineitemRef = {
    nodeType: 1,
    matches: () => false,
    closest: () => null,
    classList: { contains: (c) => c === 'lineitem-ref' },
  };
  assert.equal(plugin._wbMutationIgnored(ctxNode), true);
  assert.equal(plugin._wbMutationIgnored(lineDiv), false);
  assert.equal(plugin._wbMutationIgnored(lineitemRef), false);
});
