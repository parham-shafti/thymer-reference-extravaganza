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
  plugin._wbHeaders = new Map();
  plugin._wbOwner = { token: 1 };
  plugin._wbRefreshCurrent = () => false;
  plugin._wbRefreshSeq = 1;
  return { plugin, context, storage };
}

// Measured cold-boot DOM: transclusion inside Workbench backing .listview-items.
function makeMeasuredShelfDom(targetGuid, backingGuid) {
  const listview = {
    getAttribute: (k) => (k === 'data-guid' ? backingGuid : null),
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

function warmRetrySlice(name) {
  const start = source.indexOf(`  ${name}(`);
  assert.ok(start > 0, `${name} must exist`);
  const end = source.indexOf('\n  _wbCtx', start + 1);
  return source.slice(start, end > start ? end : start + 1200);
}

test('_wbCtxOwnerFromShelfDom returns null when nearest listview is the backing record', () => {
  const { plugin } = loadPlugin();
  const target = '1K5YEBZ1TM29';
  const backing = '1KKKKKKKKKKKKKKKKKKKKKKKKK';
  plugin._wbBackingGuid = backing;
  const shelfNode = makeMeasuredShelfDom(target, backing);
  assert.equal(plugin._wbCtxOwnerFromShelfDom(target, shelfNode), null);
});

test('_wbCtxResolveOwner returns null when every source yields the backing guid', () => {
  const { plugin } = loadPlugin();
  const target = '1K5YEBZ1TM29';
  const backing = '1KKKKKKKKKKKKKKKKKKKKKKKKK';
  plugin._wbBackingGuid = backing;
  plugin._liveStateByGuid = () => ({ rguid: backing });
  plugin._pageGuidFromDom = () => backing;
  plugin._targetOwnerGuid = () => backing;
  const shelfNode = makeMeasuredShelfDom(target, backing);
  const resolved = plugin._wbCtxResolveOwner(target, shelfNode);
  assert.equal(resolved.ownerGuid, null);
  assert.equal(resolved.source, null);
});

test('_wbCtxResolveOwner prefers liveState over later dom sources', () => {
  const { plugin } = loadPlugin();
  const target = 'LINE_A';
  const liveOwner = 'REC_LIVE';
  const domOwner = 'REC_DOM';
  plugin._wbBackingGuid = 'BACKING';
  plugin._liveStateByGuid = () => ({ rguid: liveOwner });
  plugin._pageGuidFromDom = () => domOwner;
  plugin._targetOwnerGuid = () => domOwner;
  const resolved = plugin._wbCtxResolveOwner(target, null);
  assert.equal(resolved.ownerGuid, liveOwner);
  assert.equal(resolved.source, 'liveState');
});

test('_wbCtxResolveOwner falls through when shelf DOM resolves to backing record', () => {
  const { plugin } = loadPlugin();
  const target = '1K5YEBZ1TM29';
  const backing = '1KKKKKKKKKKKKKKKKKKKKKKKKK';
  const realOwner = 'REC_REAL_OWNER';
  plugin._wbBackingGuid = backing;
  plugin._pageGuidFromDom = () => realOwner;
  plugin._targetOwnerGuid = () => null;
  const shelfNode = makeMeasuredShelfDom(target, backing);
  const resolved = plugin._wbCtxResolveOwner(target, shelfNode);
  assert.equal(resolved.ownerGuid, realOwner);
  assert.equal(resolved.source, 'dom');
});

test('_wbCtxScheduleWarmRetry still fires after _wbRefreshSeq is bumped', async () => {
  const { plugin } = loadPlugin();
  const h = { ctxResolveGen: 1, ctxRetryTimer: 0, ctxChain: null };
  const it = { lineGuid: 'WB1', target: 'LINE_X' };
  plugin._wbHeaders.set(it.lineGuid, h);
  const node = { querySelector: () => null };
  let warmCalls = 0;
  plugin._wbCtxWarmResolve = () => { warmCalls++; };
  plugin._wbRefreshCurrent = () => false;
  plugin._wbRefreshSeq++;
  plugin._wbCtxScheduleWarmRetry(h, it, node, false, null, plugin._wbOwner, 1, 0);
  assert.ok(h.ctxRetryTimer);
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(warmCalls, 1);
});

test('warm retry stops once h.ctxResolveGen changes', async () => {
  const { plugin } = loadPlugin();
  const h = { ctxResolveGen: 1, ctxRetryTimer: 0, ctxChain: null };
  const it = { lineGuid: 'WB2', target: 'LINE_Y' };
  plugin._wbHeaders.set(it.lineGuid, h);
  const node = { querySelector: () => null };
  let warmCalls = 0;
  plugin._wbCtxWarmResolve = () => { warmCalls++; };
  plugin._wbCtxScheduleWarmRetry(h, it, node, false, null, plugin._wbOwner, 1, 0);
  h.ctxResolveGen = 2;
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(warmCalls, 0);
});

test('warm retry delay list is bounded and strictly increasing', () => {
  const slice = warmRetrySlice('_wbCtxWarmDelays');
  const match = slice.match(/return \[([^\]]+)\]/);
  assert.ok(match, 'delays array must exist');
  const delays = match[1].split(',').map((s) => Number.parseInt(s.trim(), 10));
  assert.equal(delays.length, 9);
  assert.equal(delays[0], 120);
  for (let i = 1; i < delays.length; i++) {
    assert.ok(delays[i] > delays[i - 1], `delay ${delays[i]} must exceed ${delays[i - 1]}`);
  }
});

test('warm resolve paths do not reference _wbRefreshCurrent', () => {
  const schedule = warmRetrySlice('_wbCtxScheduleWarmRetry');
  const warm = warmRetrySlice('_wbCtxWarmResolve');
  assert.doesNotMatch(schedule, /_wbRefreshCurrent/);
  assert.doesNotMatch(warm, /_wbRefreshCurrent/);
});

test('v4.64.1 version locks', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.version, '4.64.1');
  assert.ok(source.startsWith('// v4.64.1'));
  assert.ok(source.includes('window.__REFX_VERSION = "4.64.1"'));
});
