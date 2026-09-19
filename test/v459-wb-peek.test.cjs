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
  const styles = new Map();
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
      createElement: (tag) => {
        const el = {
          tagName: String(tag || 'div').toUpperCase(),
          style: {},
          classList: {
            _c: new Set(),
            add(...a) { a.forEach((x) => this._c.add(x)); },
            remove(...a) { a.forEach((x) => this._c.delete(x)); },
            toggle(x, on) { if (on) this.add(x); else this.remove(x); },
            contains(x) { return this._c.has(x); },
          },
          append(child) { this.children.push(child); child.parentElement = this; child.parentNode = this; },
          appendChild(child) { this.append(child); },
          replaceChildren(...kids) { this.children = kids.length ? [...kids] : []; },
          setAttribute() {},
          addEventListener() {},
          remove() { this.isConnected = false; this.parentNode = null; },
          removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); },
          insertBefore(child, ref) {
            const i = ref ? this.children.indexOf(ref) : this.children.length;
            this.children.splice(i < 0 ? this.children.length : i, 0, child);
            child.parentNode = this;
            child.parentElement = this;
          },
          hidden: false,
          children: [],
          isConnected: true,
          parentElement: null,
          parentNode: null,
          previousElementSibling: null,
          nextSibling: null,
          dataset: {},
          textContent: '',
        };
        return el;
      },
      getElementById: (id) => styles.get(id) || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { clientHeight: 900 },
      body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {} },
      head: { appendChild(node) { node.isConnected = true; styles.set(node.id, node); return node; } },
    },
    Element: class {},
    window: {
      CSS: { escape: (s) => String(s) },
      g_universe: { itemsByGuid: {}, workspace: {} },
      addEventListener() {},
      removeEventListener() {},
    },
  };
  context.globalThis = context;
  vm.runInNewContext(source + '\nthis.PluginUnderTest = Plugin;', context, { filename: 'plugin.js' });
  const plugin = new context.PluginUnderTest();
  plugin._unloaded = false;
  plugin._wbHeaders = new Map();
  plugin._bridgeJump = () => {};
  plugin._refRowClipboardActions = () => [];
  plugin._navigatorContextText = (c) => (c?.segments || []).map((s) => s.text || '').join('');
  plugin._mediaLineInfo = () => null;
  plugin._cleanDisplayText = (segs) => (segs || []).map((s) => s.text || '').join('');
  plugin._renderRefLineText = (el, segs) => { el.textContent = plugin._cleanDisplayText(segs); };
  plugin._isTaskLikeLine = () => false;
  plugin._mkRefRowAction = (label) => ({ label });
  plugin._ensureElDataset = (el) => { if (!el.dataset) el.dataset = {}; return el; };
  plugin._el = (tag, cls, text) => {
    const el = context.document.createElement(tag);
    if (cls) cls.split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
    if (text != null) el.textContent = text;
    el.type = 'button';
    return el;
  };
  return { plugin, context, styles };
}

test('boot cloak CSS hides panel-heading and panel-body, not listview-items or panel-bar', () => {
  const { plugin, styles } = loadPlugin();
  plugin.injectCounterCss();
  const css = styles.get('trc-reference-counter-style').textContent;
  assert.match(css, /\.panel\[data-refx-wb-boot="1"\] \.panel-heading,\s*\n\s*\.panel\[data-refx-wb-boot="1"\] \.panel-body \{ visibility: hidden; \}/);
  assert.doesNotMatch(css, /\.panel\[data-refx-wb-boot="1"\] \.listview-items/);
  assert.doesNotMatch(css, /\.panel\[data-refx-wb-boot="1"\] \.panel-bar/);
});

test('_wbClearBootCloak removes data-refx-wb-boot from every cloaked element', () => {
  const { plugin, context } = loadPlugin();
  const panelA = { dataset: { refxWbBoot: '1' } };
  const panelB = { dataset: { refxWbBoot: '1' } };
  context.document.querySelectorAll = (sel) => (sel === '[data-refx-wb-boot]' ? [panelA, panelB] : []);
  plugin._wbClearBootCloak(panelA);
  assert.equal(panelA.dataset.refxWbBoot, undefined);
  assert.equal(panelB.dataset.refxWbBoot, undefined);
});

test('startup DOM sweep strips stale data-refx-wb-boot attributes', () => {
  const idx = source.indexOf('.refx-wb-shared").forEach((n) => n.remove())');
  assert.ok(idx > 0, 'startup sweep block must exist');
  const slice = source.slice(idx, idx + 300);
  assert.match(slice, /querySelectorAll\('\[data-refx-wb-boot\]'\)/);
  assert.match(slice, /delete el\.dataset\.refxWbBoot/);
});

test('teardown clears boot cloak as well as the timer', () => {
  const slice = source.slice(source.indexOf('    if (this._wbBootClearT)'), source.indexOf('    if (this._wbRelatedT)'));
  assert.match(slice, /clearTimeout\(this\._wbBootClearT\)/);
  assert.match(slice, /this\._wbClearBootCloak\(null\)/);
});

test('_wbApplyBootCloak sets nothing when getElement is null then attaches on a later frame', async () => {
  const { plugin, context } = loadPlugin();
  let frames = 0;
  const panelEl = { dataset: {} };
  const content = { dataset: {}, closest: (sel) => (sel === '.panel' ? panelEl : null) };
  const panel = {
    getElement: () => (frames++ >= 2 ? content : null),
  };
  context.requestAnimationFrame = (fn) => {
    context._rafQueue = context._rafQueue || [];
    context._rafQueue.push(fn);
    return context._rafQueue.length;
  };
  context.cancelAnimationFrame = (id) => {
    context._rafCancelled = id;
  };
  plugin._wbBootDiagOpenAt = performance.now();
  plugin._wbBootDiag = { elementNullFrames: 0, attachedAt: null };
  plugin._wbOwnerCurrent = () => true;
  plugin._wbApplyBootCloak(panel);
  assert.equal(panelEl.dataset.refxWbBoot, undefined);
  assert.ok(plugin._wbBootAttachRaf);
  while (context._rafQueue?.length) {
    const fn = context._rafQueue.shift();
    fn();
  }
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(panelEl.dataset.refxWbBoot, '1');
  assert.equal(content.dataset.refxWbBoot, undefined, 'placeholder content root must not carry the cloak');
  assert.equal(plugin._wbBootAttachRaf, 0);
  assert.ok(plugin._wbBootDiag.elementNullFrames >= 1);
  assert.ok(plugin._wbBootDiag.attachedAt != null);
});

test('_wbApplyBootCloak rAF retry is bounded and cancelled by _wbClearBootCloak', () => {
  const { plugin, context } = loadPlugin();
  const panel = { getElement: () => null };
  let rafCalls = 0;
  context.requestAnimationFrame = (fn) => {
    rafCalls++;
    if (rafCalls <= 45) fn();
    return rafCalls;
  };
  context.cancelAnimationFrame = () => {};
  plugin._wbBootDiag = { elementNullFrames: 0 };
  plugin._wbOwnerCurrent = () => true;
  plugin._wbApplyBootCloak(panel);
  assert.ok(rafCalls <= 41, `expected bounded rAF loop, got ${rafCalls}`);
  plugin._wbBootAttachRaf = 99;
  plugin._wbClearBootCloak(null);
  assert.equal(plugin._wbBootAttachRaf, 0);
});

test('teardown cancels boot cloak rAF attach loop', () => {
  const slice = source.slice(source.indexOf('    if (this._wbBootClearT)'), source.indexOf('    if (this._wbRelatedT)'));
  assert.match(slice, /cancelAnimationFrame\(this\._wbBootAttachRaf\)/);
});

test('boot cloak failsafe has no _unloaded guard', () => {
  const apply = source.slice(source.indexOf('  _wbApplyBootCloak('), source.indexOf('  _wbLiveScheduleRefresh('));
  assert.match(apply, /this\._wbBootClearT = setTimeout\(\(\) => \{[\s\S]*this\._wbClearBootCloak\(pe, 'failsafe'\);[\s\S]*\}, 1500\)/);
  assert.doesNotMatch(apply, /!this\._unloaded.*_wbClearBootCloak/);
});

test('open path calls _wbApplyBootCloak after createPanel and navigateTo', () => {
  const open = source.slice(source.indexOf('  async _openWorkbenchLive('), source.indexOf('  _wbApplyBootCloak(panel) {'));
  assert.doesNotMatch(open, /dataset\.refxWbBoot/);
  assert.match(open, /this\._wbApplyBootCloak\(panel\)/);
  assert.equal((open.match(/this\._wbApplyBootCloak\(panel\)/g) || []).length, 2);
});

test('immediate open refresh bypasses background queue but keeps storm checks', () => {
  const schedule = source.slice(source.indexOf('  _wbLiveScheduleRefresh('), source.indexOf('  // (Re)inject the per-item'));
  assert.match(schedule, /if \(immediate\) \{[\s\S]*this\._wbLiveRefresh\(null, owner, refreshSeq\)/);
  assert.match(schedule, /this\._wbStormTripped/);
  assert.match(schedule, /now < this\._wbRefreshStormBackoffUntil/);
});

test('__REFX_WB_BOOT_DIAG is initialized on open', () => {
  const open = source.slice(source.indexOf('  async _openWorkbenchLive('), source.indexOf('  _wbApplyBootCloak('));
  assert.match(open, /window\.__REFX_WB_BOOT_DIAG = this\._wbBootDiag/);
  assert.match(open, /createdAt: 0, elementNullFrames: 0, attachedAt: null/);
  assert.match(source, /window\.__REFX_WB_BOOT_DIAG = this\._wbBootDiag/);
});

function bootRefreshFixture(plugin, { items = [], nodeFor = () => null, activeGuid = 'BACKING' } = {}) {
  const host = { dataset: { refxWbBoot: '1' } };
  const panelEl = {
    dataset: {}, classList: { add() {} },
    closest: (sel) => (sel === '.panel' ? host : null),
    querySelector: (sel) => nodeFor(sel),
    querySelectorAll: () => [],
  };
  const panel = { getElement: () => panelEl, getActiveRecord: () => ({ guid: activeGuid }), setTitle() {} };
  plugin._wbBackingGuid = 'BACKING';
  plugin._wbStormTripped = false;
  plugin._wbOwnerCurrent = () => true;
  plugin._wbRefreshCurrent = () => true;
  plugin._wbLivePanel = () => panel;
  plugin._wbLoadLive = async () => items;
  for (const k of ['_wbLiveEnsureObserver', '_wbLiveDecorate', '_wbLiveFocusRulesSync', '_wbLiveFilterBarEnsure',
    '_wbLiveTabsEnsure', '_wbLiveTrailEnsure', '_wbLiveSharedEnsure', '_wbLiveApplyFilter', '_wbSyncStatusIcon',
    '_wbPokeDatacore', '_wbRelatedScheduleRefresh', '_wbSharedScheduleRefresh']) plugin[k] = () => {};
  plugin._wbHeaders = new Map();
  plugin._wbCtxGroupAnnot = new Map();
  plugin._wbCtxGroupsFp = '';
  return host;
}

test('refresh does not lift the cloak before the shelf has rendered', async () => {
  const { plugin } = loadPlugin();
  const host = bootRefreshFixture(plugin, { items: [{ lineGuid: 'L1', target: 'T1' }], nodeFor: () => null });
  plugin._wbLiveDecorate = () => {};
  await plugin._wbLiveRefresh(1, {}, 1);
  assert.equal(host.dataset.refxWbBoot, '1', 'no shelf node decorated yet, cloak must stay');
});

test('refresh does not lift the cloak while the panel is not on the backing record', async () => {
  const { plugin } = loadPlugin();
  const host = bootRefreshFixture(plugin, { items: [], activeGuid: 'SOMETHING-ELSE' });
  await plugin._wbLiveRefresh(1, {}, 1);
  assert.equal(host.dataset.refxWbBoot, '1');
});

test('successful refresh clears boot cloak attribute', async () => {
  const { plugin } = loadPlugin();
  const host = bootRefreshFixture(plugin, { items: [] });
  await plugin._wbLiveRefresh(1, {}, 1);
  assert.equal(host.dataset.refxWbBoot, undefined);
});

test('boot cloak failsafe clears attribute when refresh bails early', async () => {
  const { plugin } = loadPlugin();
  const panelEl = { dataset: { refxWbBoot: '1' } };
  plugin._wbBootClearT = setTimeout(() => plugin._wbClearBootCloak(panelEl), 10);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(panelEl.dataset.refxWbBoot, undefined);
});

test('_wbLiveScheduleRefresh immediate still respects storm breaker', () => {
  const { plugin } = loadPlugin();
  plugin._wbBackingGuid = 'BACKING';
  plugin._wbOwnerCurrent = () => true;
  plugin._wbStormTripped = true;
  assert.equal(plugin._wbLiveScheduleRefresh(0, { immediate: true }), false);
  const schedule = source.slice(source.indexOf('  _wbLiveScheduleRefresh('), source.indexOf('  // (Re)inject the per-item'));
  assert.match(schedule, /!immediate && sinceLast < 250/, 'immediate must bypass only the sinceLast throttle');
  assert.match(schedule, /now < this\._wbRefreshStormBackoffUntil/, 'storm backoff must remain unconditional');
});

test('v4.64.1 version locks', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.version, '4.64.1');
  assert.ok(source.startsWith('// v4.64.1'));
  assert.ok(source.includes('window.__REFX_VERSION = "4.64.1"'));
});
