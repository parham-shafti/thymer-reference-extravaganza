'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'plugin.js'), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeDom() {
  let document = null;
  let layoutReads = 0;
  const observers = [];

  // Tiny computed-layout adapter for behavioral geometry assertions. It applies
  // matching declarations from injected <style> blocks in cascade order; the
  // fake DOM therefore derives menu/scroller geometry from production CSS
  // instead of tests assigning the expected rectangles themselves.
  const computedCssValue = (node, property) => {
    if (!document?.head || !node?.matches) return '';
    let value = '';
    for (const style of document.head.querySelectorAll('style')) {
      const css = String(style.textContent || '');
      const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
      let rule;
      while ((rule = rulePattern.exec(css))) {
        const selectors = rule[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',');
        if (!selectors.some((selector) => node.matches(selector.trim()))) continue;
        for (const declaration of rule[2].split(';')) {
          const colon = declaration.indexOf(':');
          if (colon < 0 || declaration.slice(0, colon).trim() !== property) continue;
          value = declaration.slice(colon + 1).replace(/\s*!important\s*$/, '').trim();
        }
      }
    }
    return value;
  };
  const splitCssArgs = (value) => {
    const args = [];
    let start = 0;
    let depth = 0;
    for (let index = 0; index < value.length; index++) {
      if (value[index] === '(') depth++;
      else if (value[index] === ')') depth--;
      else if (value[index] === ',' && depth === 0) {
        args.push(value.slice(start, index).trim());
        start = index + 1;
      }
    }
    args.push(value.slice(start).trim());
    return args;
  };
  const cssLengthPixels = (raw) => {
    const value = String(raw || '').trim();
    let match = /^(-?(?:\d+\.?\d*|\.\d+))px$/.exec(value);
    if (match) return Number(match[1]);
    match = /^(-?(?:\d+\.?\d*|\.\d+))(vw|vh)$/.exec(value);
    if (match) {
      const viewport = match[2] === 'vw'
        ? Number(document?.defaultView?.innerWidth || 0)
        : Number(document?.defaultView?.innerHeight || 0);
      return viewport * Number(match[1]) / 100;
    }
    match = /^calc\(100(vw|vh)\s*-\s*(-?(?:\d+\.?\d*|\.\d+))px\)$/.exec(value);
    if (match) {
      const viewport = match[1] === 'vw'
        ? Number(document?.defaultView?.innerWidth || 0)
        : Number(document?.defaultView?.innerHeight || 0);
      return viewport - Number(match[2]);
    }
    if (value.startsWith('min(') && value.endsWith(')')) {
      const lengths = splitCssArgs(value.slice(4, -1)).map(cssLengthPixels);
      if (lengths.length && lengths.every(Number.isFinite)) return Math.min(...lengths);
    }
    return Number.NaN;
  };
  const computedCssPixels = (node, property) => {
    const value = cssLengthPixels(computedCssValue(node, property));
    return Number.isFinite(value) ? value : 0;
  };

  class FakeElement {
    constructor(tag = 'div', text = '') {
      this.tagName = String(tag).toUpperCase();
      this.parentNode = null;
      this.children = [];
      this.childNodes = this.children;
      this.style = {
        setProperty(name, value) { this[name] = String(value); },
        removeProperty(name) { delete this[name]; },
      };
      this.dataset = {};
      this._attrs = {};
      this._listeners = {};
      this._classes = new Set();
      this._text = String(text || '');
      this._connected = false;
      this._layoutRect = null;
      this.scrollTop = 0;
      this.clientHeight = 0;
      this.clientWidth = 0;
      this.disabled = false;
      this.value = '';
      this.type = '';
      this.title = '';
      this.placeholder = '';
      this.classList = {
        add: (...names) => names.forEach((name) => this._classes.add(name)),
        remove: (...names) => names.forEach((name) => this._classes.delete(name)),
        toggle: (name, force) => {
          const on = force == null ? !this._classes.has(name) : !!force;
          if (on) this._classes.add(name); else this._classes.delete(name);
          return on;
        },
        contains: (name) => this._classes.has(name),
      };
    }
    get className() { return [...this._classes].join(' '); }
    set className(value) { this._classes = new Set(String(value || '').split(/\s+/).filter(Boolean)); }
    get innerHTML() { return this.textContent; }
    set innerHTML(value) { this.textContent = value; }
    get textContent() { return this._text + this.children.map((child) => child.textContent || '').join(''); }
    set textContent(value) {
      for (const child of this.children) { child.parentNode = null; child._setConnected?.(false); }
      this.children.length = 0;
      this._text = String(value == null ? '' : value);
    }
    get isConnected() { return this._connected; }
    get parentElement() { return this.parentNode; }
    get firstChild() { return this.children[0] || null; }
    get nextSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.children.indexOf(this);
      return i >= 0 ? this.parentNode.children[i + 1] || null : null;
    }
    get nextElementSibling() { return this.nextSibling; }
    get offsetWidth() {
      if (this._layoutRect) return this._layoutRect.width;
      return computedCssPixels(this, 'width') || computedCssPixels(this, 'max-width') || 0;
    }
    get offsetHeight() {
      if (this._layoutRect) return this._layoutRect.height;
      return this.classList.contains('refx-refmenu') ? 360 : 0;
    }
    _setConnected(value) { this._connected = !!value; for (const child of this.children) child._setConnected?.(value); }
    append(...children) {
      for (let child of children) {
        if (child == null) continue;
        if (!(child instanceof FakeElement)) child = new FakeElement('#text', String(child));
        if (child.parentNode) child.remove();
        child.parentNode = this; this.children.push(child); child._setConnected(this.isConnected);
      }
    }
    appendChild(child) { this.append(child); return child; }
    insertBefore(child, before) {
      if (child.parentNode) child.remove();
      const index = before ? this.children.indexOf(before) : -1;
      child.parentNode = this;
      if (index >= 0) this.children.splice(index, 0, child); else this.children.push(child);
      child._setConnected(this.isConnected); return child;
    }
    replaceChildren(...children) { this.textContent = ''; this.append(...children); }
    after(...nodes) {
      const parent = this.parentNode;
      if (!parent) return;
      let anchor = this;
      for (const node of nodes) {
        if (node == null) continue;
        parent.insertBefore(node, anchor.nextSibling);
        anchor = node;
      }
    }
    before(...nodes) {
      const parent = this.parentNode;
      if (!parent) return;
      for (const node of nodes) { if (node != null) parent.insertBefore(node, this); }
    }
    insertAdjacentElement(where, el) {
      if (where === 'beforeend') { this.append(el); return el; }
      if (where === 'afterbegin') { return this.insertBefore(el, this.children[0] || null); }
      const parent = this.parentNode;
      if (!parent) return null;
      const index = parent.children.indexOf(this);
      const before = where === 'afterend' ? parent.children[index + 1] || null : this;
      return parent.insertBefore(el, before);
    }
    remove() {
      if (this.parentNode) {
        const index = this.parentNode.children.indexOf(this);
        if (index >= 0) this.parentNode.children.splice(index, 1);
      }
      this.parentNode = null; this._setConnected(false);
    }
    contains(node) { for (let p = node; p; p = p.parentNode) if (p === this) return true; return false; }
    setAttribute(name, value) { this._attrs[name] = String(value); if (name === 'class') this.className = value; }
    getAttribute(name) { if (name === 'class') return this.className; return this._attrs[name] ?? null; }
    hasAttribute(name) { return name === 'class' ? !!this.className : Object.hasOwn(this._attrs, name); }
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    removeEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).filter((x) => x !== fn); }
    dispatchEvent(event) {
      event = event || {};
      event.type ||= '';
      event.target ||= this; event.currentTarget = this;
      event.preventDefault ||= function () { this.defaultPrevented = true; };
      event.stopPropagation ||= function () { this.propagationStopped = true; };
      event.stopImmediatePropagation ||= function () { this.immediateStopped = true; };
      for (const fn of [...(this._listeners[event.type] || [])]) {
        fn(event);
        if (event.immediateStopped || event.immediatePropagationStopped) break;
      }
      if (event.bubbles && this.isConnected
          && !event.propagationStopped && !event.immediateStopped
          && !event.immediatePropagationStopped) {
        document.defaultView?.dispatchEvent?.(event);
      }
      return !event.defaultPrevented;
    }
    click() { return this.dispatchEvent({ type: 'click' }); }
    focus() { document.activeElement = this; }
    blur() { if (document.activeElement === this) document.activeElement = null; }
    select() { this.selectionStart = 0; this.selectionEnd = this.value.length; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    setLayoutRect(rect) {
      const top = Number(rect?.top) || 0;
      const left = Number(rect?.left) || 0;
      const width = Math.max(0, Number(rect?.width) || 0);
      const height = Math.max(0, Number(rect?.height) || 0);
      this._layoutRect = {
        top, left, width, height,
        right: Number.isFinite(Number(rect?.right)) ? Number(rect.right) : left + width,
        bottom: Number.isFinite(Number(rect?.bottom)) ? Number(rect.bottom) : top + height,
      };
      this.clientHeight = height;
      this.clientWidth = width;
      return this;
    }
    getBoundingClientRect() {
      layoutReads++;
      if (this._layoutRect) return { ...this._layoutRect };
      let left = 30;
      for (let node = this; node; node = node.parentNode) {
        left += computedCssPixels(node, 'margin-left');
      }
      const chainViewport = this.closest?.('.refx-chain-tree-root');
      const menu = this.closest?.('.refx-refmenu');
      const width = computedCssPixels(this, 'width')
        || computedCssPixels(this, 'max-width')
        || (chainViewport ? Math.max(0, (menu?.offsetWidth || 380) - 16) : 150);
      const height = computedCssPixels(this, 'height')
        || computedCssPixels(this, 'max-height')
        || 20;
      let top = 30;
      if (this.classList.contains('refx-chain-tree-row') && chainViewport) {
        const rows = this.closest('.refx-ref-chain-tree')
          ?.querySelectorAll('.refx-chain-tree-row') || [];
        const index = Math.max(0, rows.indexOf(this));
        top = chainViewport.getBoundingClientRect().top + index * 26 - chainViewport.scrollTop;
      }
      return { top, left, right: left + width, bottom: top + height, width, height };
    }
    matches(selector) {
      selector = selector.trim();
      if (!selector) return false;
      const has = /^(.*):has\((.+)\)$/.exec(selector);
      if (has) return this.matches(has[1]) && !!this.querySelector(has[2]);
      const notDisabled = selector.endsWith(':not([disabled])');
      if (notDisabled) { if (this.disabled) return false; selector = selector.slice(0, -16); }
      const attr = selector.match(/\[([^=\]]+)(?:="([^"]*)")?\]$/);
      if (attr) {
        selector = selector.slice(0, attr.index);
        const got = this.getAttribute(attr[1]);
        if (got == null || (attr[2] != null && got !== attr[2])) return false;
      }
      let tag = '', cls = '';
      if (selector.startsWith('.')) cls = selector.slice(1);
      else if (selector.includes('.')) [tag, cls] = selector.split('.', 2);
      else tag = selector;
      if (tag && tag !== '*' && this.tagName !== tag.toUpperCase()) return false;
      if (cls && !this.classList.contains(cls)) return false;
      return true;
    }
    querySelectorAll(selector) {
      const selectors = String(selector).split(',').map((x) => x.trim()).filter(Boolean);
      // `:scope > .x` matches DIRECT children only. The reference-row machinery
      // relies on it to find a row's own fulltext span without reaching into a
      // nested row, so a stub that ignored it would silently exercise the
      // defensive fallback path instead of the real one.
      const scoped = selectors
        .filter((sel) => /^:scope\s*>/.test(sel))
        .map((sel) => sel.replace(/^:scope\s*>\s*/, ''));
      const descendant = selectors.filter((sel) => !/^:scope\s*>/.test(sel));
      const out = [];
      for (const child of this.children) {
        if (scoped.some((sel) => child.matches(sel))) out.push(child);
      }
      if (descendant.length) {
        const walk = (node) => {
          for (const child of node.children) {
            if (descendant.some((sel) => child.matches(sel))) out.push(child);
            walk(child);
          }
        };
        walk(this);
      }
      return out;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { for (let n = this; n; n = n.parentNode) if (n.matches?.(selector)) return n; return null; }
  }

  const body = new FakeElement('body'); body._setConnected(true);
  const head = new FakeElement('head'); head._setConnected(true);
  const docListeners = new Map();
  document = {
    hidden: false, body, head, activeElement: null,
    documentElement: new FakeElement('html'),
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => new FakeElement('#text', text),
    querySelector: (selector) => body.querySelector(selector) || head.querySelector(selector),
    querySelectorAll: (selector) => [...body.querySelectorAll(selector), ...head.querySelectorAll(selector)],
    elementFromPoint: () => null,
    elementsFromPoint: () => [],
    getElementById: (id) => [...body.querySelectorAll('*'), ...head.querySelectorAll('*')].find((node) => node.id === id) || null,
    getElementsByClassName: (name) => body.querySelectorAll('.' + name),
    contains: (node) => !!node?.isConnected,
    addEventListener: (type, fn) => { if (!docListeners.has(type)) docListeners.set(type, []); docListeners.get(type).push(fn); },
    removeEventListener: (type, fn) => { docListeners.set(type, (docListeners.get(type) || []).filter((x) => x !== fn)); },
    dispatchEvent: (event) => { for (const fn of docListeners.get(event.type) || []) fn(event); return true; },
  };
  document.documentElement._setConnected(true);

  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.disconnected = true; }
  }

  return {
    document,
    FakeElement,
    FakeMutationObserver,
    observers,
    layoutReads: () => layoutReads,
    computedCssValue,
  };
}

function loadHarness(options = {}) {
  const dom = makeDom();
  const storage = options.storage || new Map();
  const commands = [];
  const records = new Map();
  const eventHandlers = new Map();
  let eventSequence = 0;
  const winListeners = new Map();
  const add = (map, type, fn) => { if (!map.has(type)) map.set(type, []); map.get(type).push(fn); };
  const remove = (map, type, fn) => map.set(type, (map.get(type) || []).filter((x) => x !== fn));
  const window = {
    CSS: { escape: String }, innerWidth: 1400, innerHeight: 900,
    g_universe: { itemsByGuid: {}, listviews: [], workspace: { guid: 'WS_A2' } },
    addEventListener: (type, fn) => add(winListeners, type, fn),
    removeEventListener: (type, fn) => remove(winListeners, type, fn),
    dispatchEvent: (event) => {
      event.currentTarget = window;
      for (const fn of winListeners.get(event.type) || []) {
        fn(event);
        if (event.immediateStopped || event.immediatePropagationStopped) break;
      }
      return !event.defaultPrevented;
    },
  };
  dom.document.defaultView = window;
  const context = {
    AppPlugin: class {}, console, Promise, Date, Math, Map, Set, WeakMap, WeakSet,
    AbortController,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout,
    requestIdleCallback: (fn) => setTimeout(() => fn({ didTimeout: false }), 0), cancelIdleCallback: clearTimeout,
    performance, CSS: window.CSS, document: dom.document, window,
    Element: dom.FakeElement, MutationObserver: dom.FakeMutationObserver, DateTime: undefined,
    navigator: { platform: 'MacIntel', userAgent: 'Mac', clipboard: { writeText: async () => {}, readText: async () => '' } },
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail || null; } },
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  };
  context.globalThis = context; Object.assign(context, window);
  vm.runInNewContext(source + '\nthis.PluginUnderTest = Plugin;', context, { filename: 'plugin.js' });

  const plugin = new context.PluginUnderTest();
  plugin._unloaded = false; plugin.workspaceGuid = 'WS_A2';
  plugin.data = {
    getRecord: (guid) => records.get(guid) || null,
    getAllCollections: async () => [], getAllRecords: () => [...records.values()],
    searchByQuery: async () => ({ records: [], lines: [] }), getAllGlobalPlugins: async () => [],
  };
  plugin.events = {
    on: (name, callback) => {
      const id = name + ':' + (++eventSequence);
      if (!eventHandlers.has(name)) eventHandlers.set(name, []);
      eventHandlers.get(name).push({ id, callback });
      return id;
    },
    off: (id) => {
      for (const entries of eventHandlers.values()) {
        const index = entries.findIndex((entry) => entry.id === id);
        if (index >= 0) entries.splice(index, 1);
      }
    },
  };
  plugin.ui = {
    addCommandPaletteCommand: (command) => { commands.push(command); return { remove() {} }; },
    addStatusBarItem: () => ({ remove() {} }), getPanels: () => [], getActivePanel: () => null,
  };
  plugin.getConfiguration = () => ({ custom: { aliasChips: true } });
  plugin.refreshAllPanels = () => {};
  plugin._toast = () => {};
  plugin._refocusEditor = () => {};
  return { ...dom, context, plugin, records, commands, storage, window, winListeners, eventHandlers };
}

function event(type, extra = {}) {
  return {
    type, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {}, stopImmediatePropagation() { this.immediatePropagationStopped = true; },
    ...extra,
  };
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, options = {}) {
  const timeout = Math.max(1, Number(options.timeout) || 1000);
  const interval = Math.max(0, Number(options.interval) || 2);
  const deadline = Date.now() + timeout;
  let value = predicate();
  while (!value && Date.now() < deadline) {
    await tick(interval);
    value = predicate();
  }
  return value;
}

function lineRefClickHarness(custom = {}, options = {}) {
  const h = loadHarness(options);
  h.plugin.getConfiguration = () => ({ custom: { aliasChips: false, lineRefClickMenu: true, ...custom } });
  const lifecycleStubs = [
    '_beginAutoTitleGeneration', '_ensureThemeObserver', '_counterInit', '_rehydrate',
    '_wbLiveInit', '_r6MigrateExistingPins', '_scheduleRecordNameIndex', '_r4RegisterCommands',
    '_r10Init', '_wbSyncStatusIcon',
  ];
  if (!options.injectStyle) lifecycleStubs.push('_injectStyle');
  for (const name of lifecycleStubs) h.plugin[name] = () => {};
  h.plugin._buildFieldTypes = async () => {};
  h.plugin.onLoad();

  const root = h.document.createElement('div'); root.className = 'listview-items'; root.setAttribute('data-guid', 'PAGE_CLICK');
  const line = h.document.createElement('div'); line.className = 'listitem'; line.setAttribute('data-guid', 'LINE_CLICK');
  const chip = h.document.createElement('span'); chip.className = 'lineitem-ref refx-lineref-chip'; chip.setAttribute('data-guid', 'TARGET_CLICK');
  root.append(line); line.append(chip); h.document.body.append(root);
  return { ...h, root, line, chip };
}

test('v4.39 bare line-ref left-click opens the context menu and swallows native press navigation', async () => {
  const h = lineRefClickHarness();
  const opened = [];
  h.plugin._openRefMenuForChip = async (chip, _current, options) => opened.push([
    chip.getAttribute('data-guid'), chip, options.withContext,
  ]);

  const pointer = event('pointerdown', { target: h.chip, button: 0 }); h.window.dispatchEvent(pointer);
  assert.equal(pointer.defaultPrevented, false, 'pointerdown is stopped but never canceled');
  assert.equal(pointer.immediatePropagationStopped, true);
  const press = event('mousedown', { target: h.chip, button: 0 }); h.window.dispatchEvent(press);
  assert.equal(press.defaultPrevented, true, 'mousedown navigation is canceled');
  assert.equal(press.immediatePropagationStopped, true);
  const click = event('click', { target: h.chip, button: 0, detail: 1 }); h.window.dispatchEvent(click);
  await tick(310);
  assert.equal(click.defaultPrevented, true);
  assert.equal(click.immediatePropagationStopped, true);
  assert.deepEqual(opened, [['TARGET_CLICK', h.chip, true]]);
  h.plugin.onUnload();
});

test('v4.13.2 bare star-alias click jumps immediately without scheduling or opening the menu', async () => {
  const h = lineRefClickHarness();
  const title = h.document.createElement('span'); title.className = 'lineitem-ref-title'; title.textContent = '*'; h.chip.append(title);
  const jumps = []; let contexts = 0;
  h.plugin._bridgeJump = (guid, opts) => jumps.push([guid, opts]);
  h.plugin._openLineRefContextForChip = () => { contexts++; };

  const press = event('mousedown', { target: title, button: 0 }); h.window.dispatchEvent(press);
  const click = event('click', { target: title, button: 0, detail: 1 }); h.window.dispatchEvent(click);
  assert.equal(press.defaultPrevented, true, 'native mousedown navigation is swallowed');
  assert.equal(click.defaultPrevented, true);
  assert.equal(jumps.length, 1);
  assert.equal(jumps[0][0], 'TARGET_CLICK');
  assert.equal(jumps[0][1]?.skipTrailRecord, true);
  assert.equal(h.plugin._lineRefClickTimer, 0, 'star click has no double-click/context timer');
  await tick(310);
  assert.equal(contexts, 0);
  h.plugin.onUnload();
});

test('v4.39 custom.starAliasClickNavigates=false routes star aliases through the context menu', async () => {
  const h = lineRefClickHarness({ starAliasClickNavigates: false });
  h.chip.textContent = '*';
  const jumps = []; const opened = [];
  h.plugin._bridgeJump = (guid, opts) => jumps.push([guid, opts]);
  h.plugin._openRefMenuForChip = async (chip) => opened.push(chip.getAttribute('data-guid'));

  h.window.dispatchEvent(event('click', { target: h.chip, button: 0, detail: 1 }));
  await tick(310);
  assert.deepEqual(jumps, []);
  assert.deepEqual(opened, ['TARGET_CLICK']);
  h.plugin.onUnload();
});

test('v4.39 false and off route through the real 300ms menu with no context and functional actions', async () => {
  for (const setting of [false, 'off']) {
    const h = lineRefClickHarness({ lineRefClickContext: setting });
    h.plugin._positionPopover = () => {};
    h.plugin._resolveRefForChip = async (chip) => ({
      targetGuid: chip.getAttribute('data-guid'),
      isText: true,
      current: 'Plain target',
      fallback: 'Plain target',
    });
    const jumps = [];
    h.plugin._bridgeJump = (guid, options) => jumps.push([guid, options]);

    h.window.dispatchEvent(event('click', { target: h.chip, button: 0, detail: 1 }));
    await tick(330);
    const menu = h.document.querySelector('.refx-refmenu');
    assert.ok(menu, String(setting) + ' opens the production menu');
    assert.equal(menu.querySelector('.refx-refmenu-context'), null);
    const jump = menu.querySelectorAll('.refalias-result')
      .find((row) => row.textContent.includes('Jump to block'));
    assert.ok(jump);
    jump.dispatchEvent(event('mousedown', { target: jump, button: 0 }));
    assert.equal(jumps[0][0], 'TARGET_CLICK');
    h.plugin.onUnload();
  }
});

test('v4.39 default menu cancels when its chip detaches during source resolution', async () => {
  const h = lineRefClickHarness();
  h.plugin._positionPopover = () => {};
  let releaseResolution;
  h.plugin._resolveRefForChip = () => new Promise((resolve) => { releaseResolution = resolve; });

  const opening = h.plugin._openRefMenuForChip(h.chip);
  await tick();
  h.chip.remove();
  releaseResolution({
    targetGuid: 'TARGET_CLICK',
    isText: true,
    current: 'Detached target',
    fallback: 'Detached target',
  });

  assert.equal(await opening, false);
  assert.equal(h.document.querySelector('.refx-refmenu'), null);
  h.plugin.onUnload();
});

test('v4.13.2 modifier-click on a star alias passes through untouched', () => {
  const h = lineRefClickHarness();
  h.chip.textContent = '*';
  const jumps = []; h.plugin._bridgeJump = (guid, opts) => jumps.push([guid, opts]);
  const press = event('mousedown', { target: h.chip, button: 0, metaKey: true }); h.window.dispatchEvent(press);
  const click = event('click', { target: h.chip, button: 0, detail: 1, metaKey: true }); h.window.dispatchEvent(click);
  assert.equal(press.defaultPrevented, false);
  assert.equal(click.defaultPrevented, false);
  assert.deepEqual(jumps, []);
  h.plugin.onUnload();
});

test('v4.38 line-ref double-click jumps once and never opens block context', async () => {
  const h = lineRefClickHarness();
  let contexts = 0; const jumps = [];
  h.plugin._resolveRefForChip = async () => ({ targetGuid: 'TARGET_CLICK', isText: true });
  h.plugin._openLineRefContextForChip = () => { contexts++; };
  h.plugin._bridgeJump = (guid, opts) => jumps.push([guid, opts]);

  h.window.dispatchEvent(event('click', { target: h.chip, button: 0, detail: 1 }));
  h.window.dispatchEvent(event('click', { target: h.chip, button: 0, detail: 2 }));
  h.window.dispatchEvent(event('dblclick', { target: h.chip, button: 0, detail: 2 }));
  await tick(310);
  assert.equal(contexts, 0, 'double-click cancels the pending single-click context');
  assert.equal(jumps.length, 1);
  assert.equal(jumps[0][0], 'TARGET_CLICK');
  h.plugin.onUnload();
});

test('v4.12 page-reference clicks remain native and unintercepted', () => {
  const h = lineRefClickHarness();
  h.chip.classList.remove('refx-lineref-chip'); h.chip.classList.add('refx-pageref-chip');
  let opened = 0; h.plugin._openLineRefContextForChip = () => { opened++; };
  const press = event('mousedown', { target: h.chip, button: 0 }); h.window.dispatchEvent(press);
  const click = event('click', { target: h.chip, button: 0, detail: 1 }); h.window.dispatchEvent(click);
  assert.equal(press.defaultPrevented, false); assert.equal(press.immediatePropagationStopped, undefined);
  assert.equal(click.defaultPrevented, false); assert.equal(click.immediatePropagationStopped, undefined);
  assert.equal(opened, 0);
  h.plugin.onUnload();
});

test('v4.12 modifier-clicks on line refs pass through untouched', () => {
  const h = lineRefClickHarness();
  let opened = 0; h.plugin._openLineRefContextForChip = () => { opened++; };
  for (const modifier of ['shiftKey', 'metaKey', 'ctrlKey', 'altKey']) {
    const press = event('mousedown', { target: h.chip, button: 0, [modifier]: true }); h.window.dispatchEvent(press);
    const click = event('click', { target: h.chip, button: 0, detail: 1, [modifier]: true }); h.window.dispatchEvent(click);
    assert.equal(press.defaultPrevented, false, modifier + ' press passes');
    assert.equal(click.defaultPrevented, false, modifier + ' click passes');
  }
  assert.equal(opened, 0);
  h.plugin.onUnload();
});

test('v4.12 plugin-owned popup, inline, preview, Workbench, propcard, and popover chips pass through', () => {
  const excluded = [
    'refalias-pop', 'refx-inline-refs', 'refx-record-preview-shell', 'refx-wb',
    'refx-wb-live', 'refx-propcard', 'trc-ref-popover',
    'trc-refcount-badge-wrap', 'trc-target-badge-wrap', 'tf-footnote-ref',
  ];
  for (const className of excluded) {
    const h = lineRefClickHarness();
    const surface = h.document.createElement('div'); surface.className = className;
    h.line.append(surface); surface.append(h.chip);
    let opened = 0; h.plugin._openLineRefContextForChip = () => { opened++; };
    const click = event('click', { target: h.chip, button: 0, detail: 1 }); h.window.dispatchEvent(click);
    assert.equal(click.defaultPrevented, false, className + ' passes through');
    assert.equal(opened, 0);
    h.plugin.onUnload();
  }
});

test('v4.12 custom.lineRefClickMenu=false restores native line-ref navigation', () => {
  const h = lineRefClickHarness({ lineRefClickMenu: false });
  h.chip.textContent = '*';
  const jumps = []; h.plugin._bridgeJump = (guid, opts) => jumps.push([guid, opts]);
  let opened = 0; h.plugin._openLineRefContextForChip = () => { opened++; };
  const click = event('click', { target: h.chip, button: 0, detail: 1 }); h.window.dispatchEvent(click);
  assert.equal(click.defaultPrevented, false);
  assert.equal(opened, 0);
  assert.deepEqual(jumps, [], 'global native-navigation mode does not bridge-jump star aliases');
  assert.equal(h.window.__refxLineRefClick, null);
  h.plugin.onUnload();
});

test('v4.39 right-click opens the real action menu with its default context surface immediately', async () => {
  const h = lineRefClickHarness();
  h.plugin._positionPopover = () => {};
  h.plugin._resolveRefForChip = async (chip) => ({
    targetGuid: chip.getAttribute('data-guid'),
    isText: true,
    current: 'Right-click target',
    fallback: 'Right-click target',
  });
  const contextmenu = event('contextmenu', { target: h.chip, button: 2 });
  h.window.dispatchEvent(contextmenu);
  await tick();
  assert.equal(contextmenu.defaultPrevented, true);
  assert.equal(contextmenu.immediatePropagationStopped, true);
  const menu = h.document.querySelector('.refx-refmenu');
  assert.ok(menu);
  assert.equal(menu.getAttribute('role'), 'menu');
  assert.equal(menu.getAttribute('aria-label'), 'Referenced block actions');
  assert.ok(menu.querySelector('.refx-refmenu-context'));
  assert.equal(menu.querySelector('.refalias-preview-empty').getAttribute('aria-live'), 'polite');
  for (const action of menu.querySelectorAll('.refalias-result')) {
    assert.equal(action.getAttribute('role'), 'menuitem');
    assert.equal(action.tabIndex, -1);
  }
  assert.equal(menu.querySelector('.refalias-results').textContent.includes('Jump to block'), true);
  assert.equal(menu.querySelector('.refalias-results').textContent.includes('Replace with'), true);
  h.plugin.onUnload();
});

test('v4.48 grabber takeover resolves selection overlay, floating handle, and overlaybuttons through the real menu', async () => {
  const cases = [
    {
      className: 'selection-drag-circle',
      guid: 'LINE_CLICK',
      title: 'Coordinate line',
      mount(h, handle) {
        handle.setAttribute('data-guid', 'WRONG_HANDLE_GUID');
        h.document.body.append(handle);
        h.document.elementsFromPoint = () => [handle, h.line];
      },
    },
    {
      className: 'link-menu item-drag-handle-style',
      guid: 'FLOATING_LINE',
      title: 'Floating line',
      mount(h, handle) {
        handle.setAttribute('data-guid', 'FLOATING_LINE');
        h.line.setAttribute('data-guid', 'FLOATING_LINE');
        const scope = h.document.createElement('div'); scope.className = 'grabber-scope';
        h.document.body.append(scope); scope.append(h.root, handle);
        h.document.elementsFromPoint = () => [];
      },
    },
    {
      className: 'listview-overlaybuttons',
      guid: 'LINE_CLICK',
      title: 'Parent-walk line',
      mount(h, handle) {
        h.root.append(handle);
        h.document.elementsFromPoint = () => [];
      },
    },
  ];
  for (const fixture of cases) {
    const h = lineRefClickHarness();
    h.window.g_universe.itemsByGuid[fixture.guid] = {
      guid: fixture.guid, rguid: 'PAGE_CLICK', text_segments: ['text', fixture.title],
    };
    const handle = h.document.createElement('div'); handle.className = fixture.className;
    fixture.mount(h, handle);
    const contextmenu = event('contextmenu', {
      target: handle, button: 2, clientX: 211, clientY: 123,
    });
    h.window.dispatchEvent(contextmenu);
    await tick();
    assert.equal(contextmenu.defaultPrevented, true, fixture.className + ' prevents native menu');
    assert.equal(contextmenu.immediatePropagationStopped, true, fixture.className + ' stops native menu');
    const menu = h.document.querySelector('.refx-linemenu');
    assert.ok(menu, fixture.className + ' opens the production line menu');
    assert.equal(menu.querySelector('.refx-refmenu-head').textContent, fixture.title + ' · line');
    assert.equal(menu.style.left, '211px', 'menu uses the click coordinate, not sibling geometry');
    assert.equal(menu.style.top, '130px');
    h.plugin.onUnload();
  }
});

test('v4.48.2 every noncollapsed selection-handle-family hit opens selection context', async () => {
  for (const className of [
    'selection-drag-circle', 'selection-drag-stem', 'listview-selection-drag-handles',
  ]) {
    const h = lineRefClickHarness();
    h.window.g_range = { collapsed: false };
    h.document.elementsFromPoint = () => [h.line];
    const handle = h.document.createElement('div'); handle.className = className;
    const nestedTarget = h.document.createElement('span'); nestedTarget.className = 'selection-drag-knob';
    h.document.body.append(handle); handle.append(nestedTarget);
    const contextmenu = event('contextmenu', {
      target: nestedTarget, button: 2, clientX: 50, clientY: 70,
    });
    h.window.dispatchEvent(contextmenu);
    await tick();
    const menu = h.document.querySelector('.refx-linemenu');
    assert.ok(menu, className + ' opens the line-menu shell');
    assert.equal(menu.getAttribute('aria-label'), 'Selection actions', className);
    assert.equal(menu.textContent.includes('Add to Workbench'), false, className);
    assert.equal(menu.textContent.includes('Jump to line'), false, className);
    assert.equal(menu.textContent.includes('Copy reference'), false, className);
    assert.equal(menu.textContent.includes('Thymer menu…'), true, className);
    h.plugin.onUnload();
  }
});

test('v4.48 floating GUID fallback proves the rendered line and fails closed on protected copies', () => {
  for (const protectedClass of ['', 'listitem-transclusion', 'refx-wb-live']) {
    const h = lineRefClickHarness();
    const scope = h.document.createElement('div'); scope.className = 'panel';
    const handle = h.document.createElement('div'); handle.className = 'link-menu item-drag-handle-style';
    handle.setAttribute('data-guid', 'LINE_CLICK');
    h.document.body.append(scope); scope.append(handle);
    if (protectedClass) {
      const protectedSurface = h.document.createElement('div'); protectedSurface.className = protectedClass;
      scope.append(protectedSurface); protectedSurface.append(h.root);
    } else {
      scope.append(h.root);
    }
    h.document.elementsFromPoint = () => [];
    const contextmenu = event('contextmenu', {
      target: handle, button: 2, clientX: 90, clientY: 110,
    });
    h.window.dispatchEvent(contextmenu);
    if (!protectedClass) {
      assert.equal(contextmenu.defaultPrevented, true, 'ordinary scoped floating line is taken over');
      assert.ok(h.document.querySelector('.refx-linemenu'));
    } else {
      assert.equal(contextmenu.defaultPrevented, false, protectedClass + ' stays native');
      assert.equal(contextmenu.immediatePropagationStopped, undefined);
      assert.equal(h.document.querySelector('.refx-linemenu'), null);
    }
    h.plugin.onUnload();
  }
});

test('v4.48.2 absorbed native section probes chords once, executes live callbacks, and omits dead Paste', async () => {
  const h = lineRefClickHarness();
  const editor = h.document.createElement('textarea'); editor.id = 'virtualinput';
  h.document.body.append(editor); editor.focus();
  h.window.g_virtual_input = { $textarea: editor };
  const keyEvents = [];
  editor.addEventListener('keydown', (ev) => keyEvents.push(ev));
  h.context.KeyboardEvent = class KeyboardEvent {
    constructor(type, init = {}) { this.type = type; this.isTrusted = false; Object.assign(this, init); }
    preventDefault() { this.defaultPrevented = true; }
    stopImmediatePropagation() { this.immediatePropagationStopped = true; }
  };
  h.context.MouseEvent = class MouseEvent {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
    preventDefault() { this.defaultPrevented = true; }
    stopImmediatePropagation() { this.immediatePropagationStopped = true; }
  };
  h.context.ClipboardEvent = class ClipboardEvent {
    constructor(type, init = {}) {
      this.type = type; Object.assign(this, init);
      this.clipboardData = { getData: () => '' };
    }
  };
  let syntheticPaste = 'not-probed';
  editor.addEventListener('paste', (ev) => { syntheticPaste = ev.clipboardData.getData('text/plain'); });
  editor.dispatchEvent(new h.context.ClipboardEvent('paste', { bubbles: true }));
  assert.equal(syntheticPaste, '', 'synthetic paste has no usable clipboard payload');

  const historyCalls = [];
  const panel = {
    getElement: () => h.root,
    navigateBack: () => historyCalls.push('back'),
    navigateForward: () => historyCalls.push('forward'),
    hasHistoryBack: false,
    hasHistoryForward: true,
  };
  h.plugin.ui.getPanels = () => [panel];
  h.plugin.ui.getActivePanel = () => panel;
  const undoCalls = [];
  h.window.g_view = { undoHandler: {
    newUndoChunk: () => undoCalls.push('chunk'),
    applyUndoChunk: (undo) => undoCalls.push(undo),
  } };
  const clipboardCalls = [];
  h.window.setPendingMenuClipboardAction = (action) => clipboardCalls.push('pending:' + action);
  h.document.execCommand = (action) => { clipboardCalls.push('exec:' + action); return true; };
  const original = event('contextmenu', {
    target: editor, button: 2, clientX: 80, clientY: 90,
  });
  const open = () => {
    h.plugin._openLineMenu('LINE_CLICK', h.plugin._contextMenuPointAnchor(original, h.line), {
      contextEvent: original,
      sourceTarget: editor,
      focusTarget: editor,
      lineNode: h.line,
      selectionContext: true,
    });
    return new Map(h.document.querySelector('.refx-linemenu').querySelectorAll('.refalias-result').map((row) => [
      row.querySelector('.refalias-result-text').textContent, row,
    ]));
  };

  let rows = open();
  assert.deepEqual(Array.from(rows.keys()), [
    'Back', 'Forward', 'Undo', 'Redo', 'Cut', 'Copy', 'Bold', 'Italic', 'Code', 'Thymer menu…',
  ]);
  assert.equal(rows.get('Back').getAttribute('aria-disabled'), 'true');
  assert.equal(keyEvents.filter((ev) => ev.key === 'F24').length, 1, 'one harmless delivery probe runs');
  for (const label of ['Forward', 'Redo', 'Cut', 'Bold', 'Italic', 'Code', 'Thymer menu…']) {
    const icon = rows.get(label).querySelector('.refx-menu-ico');
    assert.ok(icon.classList.contains('ti-arrow-back-up') || icon.classList.contains('ti-copy'), label);
  }
  rows.get('Back').dispatchEvent(event('mousedown', { target: rows.get('Back') }));
  assert.deepEqual(historyCalls, [], 'disabled history action stays inert');
  h.plugin._closeCardPopup();

  rows = open(); rows.get('Forward').dispatchEvent(event('mousedown', { target: rows.get('Forward') }));
  assert.deepEqual(historyCalls, ['forward']);
  rows = open(); rows.get('Undo').dispatchEvent(event('mousedown', { target: rows.get('Undo') }));
  assert.deepEqual(undoCalls, ['chunk', true]);
  rows = open(); await tick(); rows.get('Cut').dispatchEvent(event('mousedown', { target: rows.get('Cut') }));
  await tick();
  assert.deepEqual(clipboardCalls, ['pending:cut', 'exec:cut']);
  rows = open(); await tick(); rows.get('Bold').dispatchEvent(event('mousedown', { target: rows.get('Bold') }));
  await tick();
  assert.equal(keyEvents.at(-1).key, 'b');
  assert.equal(keyEvents.at(-1).metaKey, true);
  assert.equal(h.document.activeElement, editor, 'format chord is delivered at the restored active editor');
  assert.equal(keyEvents.filter((ev) => ev.key === 'F24').length, 1, 'the delivery verdict is cached');
  assert.equal(rows.has('Paste'), false, 'empty synthetic clipboard probe keeps Paste out of the menu');
  h.plugin.onUnload();
});

test('v4.48.2 failed synthetic delivery probe omits formatting and degrades to escape only', () => {
  const h = lineRefClickHarness();
  const virtualInput = h.document.createElement('textarea'); virtualInput.id = 'virtualinput';
  h.document.body.append(virtualInput);
  h.window.g_virtual_input = { $textarea: virtualInput };
  h.context.KeyboardEvent = class KeyboardEvent {
    constructor(type, init = {}) { this.type = type; this.isTrusted = false; Object.assign(this, init); }
  };
  let failedDeliveries = 0;
  virtualInput.dispatchEvent = () => { failedDeliveries += 1; return true; };
  h.window.g_range = { collapsed: false };
  h.document.elementsFromPoint = () => [h.line];
  const handles = h.document.createElement('div'); handles.className = 'listview-selection-drag-handles';
  const originalTarget = h.document.createElement('div'); originalTarget.className = 'selection-drag-circle';
  h.document.body.append(handles); handles.append(originalTarget);
  h.context.MouseEvent = class MouseEvent {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
    preventDefault() { this.defaultPrevented = true; }
    stopImmediatePropagation() { this.immediatePropagationStopped = true; }
  };
  const redispatched = [];
  h.window.addEventListener('contextmenu', (ev) => redispatched.push(ev));
  const original = event('contextmenu', {
    target: originalTarget, button: 2, clientX: 33, clientY: 44,
  });
  h.window.dispatchEvent(original);
  assert.equal(redispatched.length, 0, 'the swallowed original never reaches the native listener');
  const rows = h.document.querySelector('.refx-linemenu').querySelectorAll('.refalias-result');
  assert.deepEqual(rows.map((row) => row.querySelector('.refalias-result-text').textContent), ['Thymer menu…']);
  assert.equal(failedDeliveries, 1, 'KeyboardEvent exists but the one-time probe was not delivered');
  assert.equal(h.document.querySelector('.refx-menu-divider'), null, 'escape-only selection menu has no orphan divider');
  originalTarget.remove();
  const currentTarget = h.document.createElement('div'); h.document.body.append(currentTarget);
  let popupConnectedAtHit = null;
  h.document.elementFromPoint = (x, y) => {
    assert.deepEqual([x, y], [33, 44]);
    popupConnectedAtHit = !!h.document.querySelector('.refx-linemenu');
    return currentTarget;
  };
  rows[0].dispatchEvent(event('mousedown', { target: rows[0] }));
  assert.equal(redispatched.length, 1);
  assert.equal(popupConnectedAtHit, false, 'coordinates are re-hit after the RefX popup closes');
  assert.equal(redispatched[0].target, currentTarget, 'detached original is replaced by the connected coordinate target');
  assert.equal(redispatched[0].shiftKey, true);
  assert.equal(redispatched[0].clientX, 33);
  assert.equal(redispatched[0].clientY, 44);
  assert.equal(redispatched[0].defaultPrevented, undefined);

  const next = event('contextmenu', { target: h.line, button: 2, clientX: 35, clientY: 45 });
  h.window.dispatchEvent(next);
  assert.equal(next.defaultPrevented, true, 'escape suppression is one-shot; the next ordinary event is handled');
  assert.equal(redispatched.length, 1);

  const directShift = event('contextmenu', { target: h.line, button: 2, shiftKey: true });
  h.plugin._handleContextMenu(directShift);
  assert.equal(directShift.defaultPrevented, false);
  assert.equal(directShift.immediatePropagationStopped, undefined);
  h.plugin.onUnload();
});

test('v4.48.2 Redo preserves its stack by skipping newUndoChunk', () => {
  const h = lineRefClickHarness();
  const undoCalls = [];
  h.window.g_view = { undoHandler: {
    newUndoChunk: () => undoCalls.push('chunk'),
    applyUndoChunk: (undo) => undoCalls.push(undo),
  } };
  h.plugin._openLineMenu('LINE_CLICK', h.line, { selectionContext: true, lineNode: h.line });
  const redo = h.document.querySelectorAll('.refalias-result')
    .find((row) => row.querySelector('.refalias-result-text')?.textContent === 'Redo');
  assert.ok(redo);
  redo.dispatchEvent(event('mousedown', { target: redo }));
  assert.deepEqual(undoCalls, [false]);
  h.plugin.onUnload();
});

test('v4.48.2 body focus falls back to virtual input and waits a task before chord dispatch', async () => {
  const h = lineRefClickHarness();
  const virtualInput = h.document.createElement('textarea'); virtualInput.id = 'virtualinput';
  h.document.body.append(virtualInput);
  h.window.g_virtual_input = { $textarea: virtualInput };
  h.document.body.focus = () => {};
  h.document.activeElement = h.document.body;
  let focusOptions = null;
  virtualInput.focus = (options) => { focusOptions = options; h.document.activeElement = virtualInput; };
  const keyEvents = [];
  virtualInput.addEventListener('keydown', (ev) => keyEvents.push(ev));
  h.context.KeyboardEvent = class KeyboardEvent {
    constructor(type, init = {}) { this.type = type; this.isTrusted = false; Object.assign(this, init); }
  };
  h.plugin._openLineMenu('LINE_CLICK', h.line, {
    selectionContext: true, lineNode: h.line, focusTarget: h.document.body,
  });
  await tick();
  const bold = h.document.querySelectorAll('.refalias-result')
    .find((row) => row.querySelector('.refalias-result-text')?.textContent === 'Bold');
  assert.ok(bold);
  bold.dispatchEvent(event('mousedown', { target: bold }));
  assert.deepEqual(keyEvents.map((ev) => ev.key), ['F24'], 'format chord is not synchronous');
  await tick();
  assert.deepEqual(keyEvents.map((ev) => ev.key), ['F24', 'b']);
  assert.equal(keyEvents.at(-1).target, virtualInput);
  assert.equal(h.document.activeElement, virtualInput);
  assert.equal(focusOptions && focusOptions.preventScroll, true);
  h.plugin.onUnload();
});

test('v4.48.2 failed clipboard commands disarm the pending action on false and throw', async () => {
  for (const mode of ['false', 'throw']) {
    const h = lineRefClickHarness();
    const virtualInput = h.document.createElement('textarea'); virtualInput.id = 'virtualinput';
    h.document.body.append(virtualInput);
    h.window.g_virtual_input = { $textarea: virtualInput };
    const pending = [];
    h.window.setPendingMenuClipboardAction = (action) => pending.push(action);
    h.document.execCommand = () => {
      if (mode === 'throw') throw new Error('clipboard bridge failed');
      return false;
    };
    h.plugin._openLineMenu('LINE_CLICK', h.line, {
      selectionContext: true, lineNode: h.line, focusTarget: h.document.body,
    });
    await tick();
    const copy = h.document.querySelectorAll('.refalias-result')
      .find((row) => row.querySelector('.refalias-result-text')?.textContent === 'Copy');
    assert.ok(copy, mode);
    copy.dispatchEvent(event('mousedown', { target: copy }));
    await tick();
    assert.deepEqual(pending, ['copy', null], mode + ' disarms the stale clipboard action');
    assert.match(h.window.__REFX_LAST_ERROR, /native menu copy/);
    h.plugin.onUnload();
  }
});

test('v4.48 throwing internal Undo records failure and never dispatches a fallback chord', () => {
  const h = lineRefClickHarness();
  const editor = h.document.createElement('textarea'); h.document.body.append(editor); editor.focus();
  const keyEvents = [];
  editor.addEventListener('keydown', (ev) => keyEvents.push(ev));
  h.context.KeyboardEvent = class KeyboardEvent {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
  };
  const undoCalls = [];
  h.window.g_view = { undoHandler: {
    newUndoChunk: () => undoCalls.push('chunk'),
    applyUndoChunk: (undo) => { undoCalls.push(undo); throw new Error('partial internal failure'); },
  } };
  h.window.g_range = { collapsed: false };
  h.document.elementsFromPoint = () => [h.line];
  const circle = h.document.createElement('div'); circle.className = 'selection-drag-circle';
  h.document.body.append(circle);
  h.window.dispatchEvent(event('contextmenu', {
    target: circle, button: 2, clientX: 75, clientY: 95,
  }));
  const undo = h.document.querySelectorAll('.refalias-result')
    .find((row) => row.querySelector('.refalias-result-text')?.textContent === 'Undo');
  assert.ok(undo);
  undo.dispatchEvent(event('mousedown', { target: undo }));
  assert.deepEqual(undoCalls, ['chunk', true]);
  assert.deepEqual(keyEvents, [], 'an attempted internal mutation never falls through to Cmd+Z');
  assert.match(h.window.__REFX_LAST_ERROR, /native menu undo:.*partial internal failure/s);
  h.plugin.onUnload();
});

test('v4.48 line takeover stays line-scoped and transclusion right-click falls through', () => {
  const plain = lineRefClickHarness();
  plain.context.MouseEvent = class MouseEvent {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
  };
  plain.document.elementFromPoint = () => plain.line;
  const nativeEvents = [];
  plain.window.addEventListener('contextmenu', (ev) => nativeEvents.push(ev));
  const lineEvent = event('contextmenu', { target: plain.line, button: 2, clientX: 10, clientY: 20 });
  plain.window.dispatchEvent(lineEvent);
  assert.equal(lineEvent.defaultPrevented, true);
  const plainMenu = plain.document.querySelector('.refx-linemenu');
  assert.ok(plainMenu);
  assert.equal(plainMenu.style.left, '30px', 'ordinary line menu stays anchored to the rendered line');
  assert.equal(plainMenu.style.top, '56px');
  const escape = plainMenu.querySelectorAll('.refalias-result')
    .find((row) => row.querySelector('.refalias-result-text')?.textContent === 'Thymer menu…');
  escape.dispatchEvent(event('mousedown', { target: escape }));
  assert.deepEqual([nativeEvents[0].clientX, nativeEvents[0].clientY], [10, 20], 'line anchor does not discard escape coordinates');
  plain.plugin.onUnload();

  const transcluded = lineRefClickHarness();
  const transclusion = transcluded.document.createElement('div');
  transclusion.className = 'listitem-transclusion';
  transcluded.root.append(transclusion); transclusion.append(transcluded.line);
  const transclusionEvent = event('contextmenu', {
    target: transcluded.line, button: 2, clientX: 10, clientY: 20,
  });
  transcluded.window.dispatchEvent(transclusionEvent);
  assert.equal(transclusionEvent.defaultPrevented, false);
  assert.equal(transclusionEvent.immediatePropagationStopped, undefined);
  assert.equal(transcluded.document.querySelector('.refx-linemenu'), null);
  transcluded.plugin.onUnload();
});

test('v4.39 "popover" context restores the v4.38 parent, sibling, target, child order and keeps Jump panel-scoped', async () => {
  const h = lineRefClickHarness({ lineRefClickContext: 'popover' });
  const targetOwner = {
    guid: 'TARGET_PAGE',
    getName: () => 'Target page',
    getLineItems: async () => [{
      guid: 'PARENT', parent_guid: null, type: 'ulist', segments: [{ type: 'text', text: 'Parent' }],
      children: [
        { guid: 'BEFORE', parent_guid: 'PARENT', type: 'ulist', segments: [{ type: 'text', text: 'Before' }], children: [] },
        {
          guid: 'TARGET_CLICK', parent_guid: 'PARENT', type: 'ulist',
          segments: [{ type: 'text', text: 'Target' }],
          children: [{ guid: 'CHILD', parent_guid: 'TARGET_CLICK', type: 'ulist', segments: [{ type: 'text', text: 'Child' }], children: [] }],
        },
        { guid: 'AFTER', parent_guid: 'PARENT', type: 'ulist', segments: [{ type: 'text', text: 'After' }], children: [] },
      ],
    }],
  };
  h.records.set(targetOwner.guid, targetOwner);
  h.plugin._lineOwnerHints.set('TARGET_CLICK', targetOwner.guid);
  h.plugin._positionPopover = () => {};
  const railCalls = [];
  h.plugin._appendPreviewOutlineRails = (_row, depth, _flowy, target) => railCalls.push([depth, target]);
  h.plugin._previewOutlineFlowyStyle = () => ({ colors: null, width: 1, opacity: .45, indentLines: true });
  let sourcePanelOpen = true;
  const sourcePanel = { getElement: () => sourcePanelOpen ? h.root : null };
  const activePanel = { getElement: () => h.root };
  h.plugin.ui.getPanels = () => [sourcePanel];
  h.plugin.ui.getActivePanel = () => activePanel;
  const jumps = [];
  h.plugin._bridgeJump = async (guid, opts) => { jumps.push([guid, opts]); return true; };

  assert.equal(await h.plugin._openLineRefContextForChip(h.chip), true);
  const pop = h.document.querySelector('.refx-line-context-pop');
  assert.ok(pop);
  assert.equal(pop.querySelector('.trc-ref-popover-crumb-rec').textContent, 'Target page');
  assert.deepEqual(
    pop.querySelectorAll('.refx-preview-outline-row').map((row) => [row.dataset.outlineRole, row.dataset.guid]),
    [['parent', 'PARENT'], ['sibling', 'BEFORE'], ['target', 'TARGET_CLICK'], ['child', 'CHILD'], ['sibling', 'AFTER']]
  );
  assert.equal(railCalls.some(([, target]) => target === true), true, 'target uses the shared highlighted outline rail');
  sourcePanelOpen = false;
  pop.querySelector('.refx-line-context-jump').click();
  await tick();
  assert.equal(jumps.length, 1);
  assert.equal(jumps[0][0], 'TARGET_CLICK');
  assert.equal(jumps[0][1].panel, activePanel, 'closed captured panel falls back to the active panel');
  h.plugin.onUnload();
});

test('v4.39 "popover" cold missing target renders explicit unavailable state and never fabricates a row', async () => {
  const h = lineRefClickHarness({ lineRefClickContext: 'popover' });
  let reads = 0;
  const targetOwner = {
    guid: 'COLD_OWNER',
    getName: () => 'Cold owner',
    getLineItems: async () => {
      reads++;
      return [{
        guid: 'OTHER_LINE', parent_guid: null, type: 'ulist',
        segments: [{ type: 'text', text: 'A different loaded block' }], children: [],
      }];
    },
  };
  h.records.set(targetOwner.guid, targetOwner);
  h.plugin._lineOwnerHints.set('TARGET_CLICK', targetOwner.guid);
  h.plugin._positionPopover = () => {};

  assert.equal(await h.plugin._openLineRefContextForChip(h.chip), false);
  const pop = h.document.querySelector('.refx-line-context-pop');
  assert.ok(pop, 'the anchored shell remains available to explain the failure');
  assert.equal(reads, 2, 'cold hydration retries once when the expected target is absent');
  assert.equal(
    pop.querySelector('.refalias-preview-empty').textContent,
    "Couldn't load this block's context"
  );
  assert.equal(pop.querySelectorAll('.refx-preview-outline-row').length, 0);
  assert.equal(pop.textContent.includes('…'), false, 'no synthetic ellipsis context is rendered');
  h.plugin.onUnload();
});

test('v4.39 real single-click router opens one menu with hydrated context above immediate action rows', async () => {
  const h = lineRefClickHarness();
  h.records.set('PAGE_CLICK', {
    guid: 'PAGE_CLICK',
    getLineItems: async () => [{
      guid: 'LINE_CLICK', parent_guid: null, type: 'ulist',
      segments: [{ type: 'ref', text: { guid: 'TARGET_CLICK', title: 'Routed target' } }],
      children: [],
    }],
  });
  const targetOwner = {
    guid: 'ROUTED_OWNER',
    getName: () => 'Routed owner',
    getLineItems: async () => [{
      guid: 'ROUTED_PARENT', parent_guid: null, type: 'ulist',
      segments: [{ type: 'text', text: 'Routed parent' }],
      children: [{
        guid: 'TARGET_CLICK', parent_guid: 'ROUTED_PARENT', type: 'ulist',
        segments: [{ type: 'text', text: 'Routed target' }], children: [],
      }],
    }],
  };
  h.records.set(targetOwner.guid, targetOwner);
  h.plugin._lineOwnerHints.set('TARGET_CLICK', targetOwner.guid);
  h.plugin._positionPopover = () => {};

  h.window.dispatchEvent(event('click', { target: h.chip, button: 0, detail: 1 }));
  await tick(380);
  const pop = h.document.querySelector('.refx-refmenu');
  assert.ok(pop, 'the production 300ms click router opens the production menu');
  assert.ok(pop.querySelector('.refx-refmenu-context'), 'context section is above the action list');
  assert.equal(pop.querySelector('.refalias-results').textContent.includes('Jump to block'), true);
  assert.equal(pop.querySelector('.refalias-results').textContent.includes('Replace with'), true);
  const owner = pop.querySelector('.trc-ref-popover-crumb-rec');
  assert.ok(owner, 'hydrated owner should render; popover text: ' + pop.textContent);
  assert.equal(owner.textContent, 'Routed owner');
  assert.equal(pop.querySelector('.refx-preview-outline-target').dataset.guid, 'TARGET_CLICK');
  h.plugin.onUnload();
});

// PROBE-A/B/C. Every other fixture in this file gives root lines
// `parent_guid: null`, but the SDK gives a root line the OWNING RECORD's guid
// (the shape _renderPreviewLineItem/_hoverPop/_wbRenderRecord all defend
// against with `it.parent_guid !== rec.guid`). The ancestor walk used to bail
// on that unresolvable guid and kill the whole context, so these fixtures are
// the only ones that reproduce what a real line reference does.
test('v4.39 PROBE-A a nested target under SDK-shaped roots renders real context through the router', async () => {
  const h = lineRefClickHarness();
  h.records.set('PAGE_CLICK', {
    guid: 'PAGE_CLICK',
    getLineItems: async () => [{
      guid: 'LINE_CLICK', parent_guid: 'PAGE_CLICK', type: 'ulist',
      segments: [{ type: 'ref', text: { guid: 'TARGET_CLICK', title: 'SDK target' } }],
      children: [],
    }],
  });
  h.records.set('SDK_OWNER', {
    guid: 'SDK_OWNER',
    getName: () => 'SDK owner',
    getLineItems: async () => [{
      guid: 'SDK_ROOT', parent_guid: 'SDK_OWNER', type: 'ulist',
      segments: [{ type: 'text', text: 'SDK root section' }],
      children: [{
        guid: 'TARGET_CLICK', parent_guid: 'SDK_ROOT', type: 'ulist',
        segments: [{ type: 'text', text: 'SDK target' }],
        children: [{
          guid: 'SDK_CHILD', parent_guid: 'TARGET_CLICK', type: 'ulist',
          segments: [{ type: 'text', text: 'SDK child' }], children: [],
        }],
      }],
    }],
  });
  h.plugin._lineOwnerHints.set('TARGET_CLICK', 'SDK_OWNER');
  h.plugin._positionPopover = () => {};

  h.window.dispatchEvent(event('click', { target: h.chip, button: 0, detail: 1 }));
  await tick(380);
  const pop = h.document.querySelector('.refx-refmenu');
  assert.ok(pop);
  assert.equal(
    pop.querySelector('.refalias-preview-empty'),
    null,
    'a root parent_guid of the record guid is not a broken context'
  );
  assert.deepEqual(
    pop.querySelectorAll('.refx-preview-outline-row')
      .map((row) => [row.dataset.outlineRole, row.dataset.guid]),
    [['parent', 'SDK_ROOT'], ['target', 'TARGET_CLICK'], ['child', 'SDK_CHILD']]
  );
  const crumbs = pop.querySelector('.refx-line-context-crumbs');
  assert.ok(crumbs);
  assert.equal(pop.querySelector('.trc-ref-popover-crumb-rec').textContent, 'SDK owner');
  assert.equal(crumbs.querySelector('.trc-ref-crumb-text').textContent, 'SDK root section');
  h.plugin.onUnload();
});

test('v4.39 PROBE-B an SDK-shaped ROOT target resolves with no ancestors and record-scoped peers', () => {
  const h = lineRefClickHarness();
  const items = [
    {
      guid: 'ROOT_BEFORE', parent_guid: 'ROOT_OWNER', type: 'ulist',
      segments: [{ type: 'text', text: 'Root before' }], children: [],
    },
    {
      guid: 'ROOT_TARGET', parent_guid: 'ROOT_OWNER', type: 'ulist',
      segments: [{ type: 'text', text: 'Root target' }],
      children: [{
        guid: 'ROOT_CHILD', parent_guid: 'ROOT_TARGET', type: 'ulist',
        segments: [{ type: 'text', text: 'Root child' }], children: [],
      }],
    },
    {
      guid: 'ROOT_AFTER', parent_guid: 'ROOT_OWNER', type: 'ulist',
      segments: [{ type: 'text', text: 'Root after' }], children: [],
    },
  ];
  const render = (surface) => {
    const host = h.document.createElement('div');
    const body = h.document.createElement('div'); body.className = 'refx-line-context-body';
    host.append(body);
    // No owner guid is supplied here: tolerating the unresolvable ancestor is
    // what carries this, not the owner short-circuit.
    assert.equal(h.plugin._renderLineRefContext(
      host, 'ROOT_TARGET', items, 'Root owner', null, null, { surface }
    ), true);
    return host;
  };

  const menu = render('menu');
  assert.equal(menu.querySelector('.refalias-preview-empty'), null);
  assert.ok(menu.querySelector('.trc-ref-popover-crumb-rec'), 'owner path crumb renders for a root target');
  assert.equal(menu.querySelector('.refx-line-context-sep'), null, 'a root target has no ancestor crumbs');
  assert.deepEqual(
    menu.querySelectorAll('.refx-preview-outline-row')
      .map((row) => [row.dataset.outlineRole, row.dataset.guid]),
    [['target', 'ROOT_TARGET'], ['child', 'ROOT_CHILD']]
  );

  const popover = render('popover');
  assert.deepEqual(
    popover.querySelectorAll('.refx-preview-outline-row')
      .map((row) => [row.dataset.outlineRole, row.dataset.guid]),
    [
      ['sibling', 'ROOT_BEFORE'], ['target', 'ROOT_TARGET'],
      ['child', 'ROOT_CHILD'], ['sibling', 'ROOT_AFTER'],
    ]
  );
  h.plugin.onUnload();
});

test('v4.39 PROBE-C SDK-shaped hydration caches a usable context and stops the walk at the owner', async () => {
  const h = lineRefClickHarness();
  h.records.set('WALK_OWNER', {
    guid: 'WALK_OWNER',
    getName: () => 'Walk owner',
    getLineItems: async () => [{
      guid: 'WALK_ROOT', parent_guid: 'WALK_OWNER', type: 'ulist',
      segments: [{ type: 'text', text: 'Walk root' }],
      children: [{
        guid: 'WALK_MID', parent_guid: 'WALK_ROOT', type: 'ulist',
        segments: [{ type: 'text', text: 'Walk mid' }],
        children: [{
          guid: 'WALK_TARGET', parent_guid: 'WALK_MID', type: 'ulist',
          segments: [{ type: 'text', text: 'Walk target' }], children: [],
        }],
      }],
    }],
  });
  h.plugin._lineOwnerHints.set('WALK_TARGET', 'WALK_OWNER');

  const entry = await h.plugin._loadLineRefContext('WALK_TARGET');
  assert.ok(entry, 'hydration produces an entry rather than a null context');
  assert.equal(entry.ownerGuid, 'WALK_OWNER');
  assert.deepEqual(
    [...entry.context.breadcrumbs].map((crumb) => crumb.guid),
    ['WALK_ROOT', 'WALK_MID'],
    'the walk climbs to the top line and stops at the record, never past it'
  );
  assert.equal(entry.context.parent.guid, 'WALK_MID');
  assert.equal(entry.context.target.depth, 2);
  h.plugin.onUnload();
});

test('v4.39 "popover" config restores the standalone v4.38 surface through the real router', async () => {
  const h = lineRefClickHarness({ lineRefClickContext: 'popover' });
  h.plugin._lineRefContextOwner = async () => null;
  h.plugin._positionPopover = () => {};

  h.window.dispatchEvent(event('click', { target: h.chip, button: 0, detail: 1 }));
  await tick(330);
  assert.ok(h.document.querySelector('.refx-line-context-pop'));
  assert.equal(h.document.querySelector('.refx-refmenu'), null);
  h.plugin.onUnload();
});

test('v4.39 lineRefClickContext normalizes absent, true, menu, popover, false, and off', () => {
  for (const [value, expected] of [
    [undefined, 'menu'], [true, 'menu'], ['menu', 'menu'],
    ['popover', 'popover'], [false, 'off'], ['off', 'off'],
  ]) {
    const custom = value === undefined ? {} : { lineRefClickContext: value };
    const h = lineRefClickHarness(custom);
    assert.equal(h.plugin._lineRefClickContextMode, expected, String(value));
    h.plugin.onUnload();
  }
});

test('v4.39 menu actions render before slow context hydration settles', async () => {
  const h = lineRefClickHarness();
  h.records.set('PAGE_CLICK', {
    guid: 'PAGE_CLICK',
    getLineItems: async () => [{
      guid: 'LINE_CLICK', parent_guid: null, type: 'ulist',
      segments: [{ type: 'ref', text: { guid: 'TARGET_CLICK', title: 'Slow target' } }],
      children: [],
    }],
  });
  let releaseLines;
  h.records.set('SLOW_MENU_OWNER', {
    guid: 'SLOW_MENU_OWNER', getName: () => 'Slow menu owner',
    getLineItems: () => new Promise((resolve) => { releaseLines = resolve; }),
  });
  h.plugin._lineOwnerHints.set('TARGET_CLICK', 'SLOW_MENU_OWNER');
  h.plugin._positionPopover = () => {};

  h.window.dispatchEvent(event('click', { target: h.chip, button: 0, detail: 1 }));
  await tick(330);
  const menu = h.document.querySelector('.refx-refmenu');
  assert.ok(menu);
  assert.equal(menu.querySelector('.refalias-results').textContent.includes('Jump to block'), true);
  assert.ok(menu.querySelector('.refalias-preview-loading'), 'context remains loading independently');
  releaseLines([{
    guid: 'TARGET_CLICK', parent_guid: null, type: 'ulist',
    segments: [{ type: 'text', text: 'Slow target' }], children: [],
  }]);
  await tick();
  assert.ok(menu.querySelector('.refx-preview-outline-target'));
  h.plugin.onUnload();
});

test('v4.39 cold menu keeps actions functional beside the explicit unavailable context state', async () => {
  const h = lineRefClickHarness();
  h.plugin._positionPopover = () => {};
  h.plugin._resolveRefForChip = async () => ({
    targetGuid: 'TARGET_CLICK', isText: true, current: 'Cold target', fallback: 'Cold target',
  });
  h.plugin._lineRefContextOwner = async () => null;
  const jumps = [];
  h.plugin._bridgeJump = (guid, options) => jumps.push([guid, options]);

  h.window.dispatchEvent(event('click', { target: h.chip, button: 0, detail: 1 }));
  await tick(330);
  const menu = h.document.querySelector('.refx-refmenu');
  assert.ok(menu);
  assert.equal(
    menu.querySelector('.refalias-preview-empty').textContent,
    "Couldn't load this block's context"
  );
  const jump = menu.querySelectorAll('.refalias-result').find((row) => row.textContent.includes('Jump to block'));
  assert.ok(jump);
  jump.dispatchEvent(event('mousedown', { target: jump, button: 0 }));
  assert.equal(jumps[0][0], 'TARGET_CLICK');
  h.plugin.onUnload();
});

test('v4.39 context cache is target-keyed, eight-entry LRU, and owner events invalidate hydration', async () => {
  const h = lineRefClickHarness();
  let reads = 0;
  h.records.set('CACHE_OWNER', {
    guid: 'CACHE_OWNER', getName: () => 'Cache owner',
    getLineItems: async () => {
      reads++;
      return [{
        guid: 'TARGET_CLICK', parent_guid: null, type: 'ulist',
        segments: [{ type: 'text', text: 'Cached target' }], children: [],
      }];
    },
  });
  h.plugin._lineOwnerHints.set('TARGET_CLICK', 'CACHE_OWNER');

  assert.ok(await h.plugin._loadLineRefContext('TARGET_CLICK'));
  assert.ok(await h.plugin._loadLineRefContext('TARGET_CLICK'));
  assert.equal(reads, 1, 'second target open performs no second record body read');

  for (const eventName of [
    'lineitem.created', 'lineitem.updated', 'lineitem.moved',
    'lineitem.undeleted', 'lineitem.deleted',
  ]) {
    assert.ok(
      (h.eventHandlers.get(eventName) || [])
        .some((entry) => String(entry.callback).includes('_invalidateLineRefContextForEvent')),
      eventName + ' is subscribed'
    );
  }
  const invalidator = (h.eventHandlers.get('lineitem.updated') || [])
    .find((entry) => String(entry.callback).includes('_invalidateLineRefContextForEvent'));
  assert.ok(invalidator, 'production onLoad subscribes the context invalidator');
  invalidator.callback({ recordGuid: 'CACHE_OWNER', lineItemGuid: 'ANOTHER_LINE' });
  assert.ok(await h.plugin._loadLineRefContext('TARGET_CLICK'));
  assert.equal(reads, 2, 'any owner-record line event invalidates the target entry');

  h.plugin._lineRefContextOwnerMisses.add('TARGET_CLICK');
  invalidator.callback({ guid: 'TARGET_CLICK', recordGuid: null });
  assert.equal(
    h.plugin._lineRefContextOwnerMisses.has('TARGET_CLICK'),
    false,
    'a nullable-owner delete still clears the target negative miss'
  );

  h.plugin._lineRefContextCache.clear();
  for (let index = 0; index < 9; index++) {
    h.plugin._lineRefContextCacheSet('TARGET_' + index, {
      ownerGuid: 'OWNER_' + index, lineGuids: new Set(),
    });
  }
  assert.equal(h.plugin._lineRefContextCache.size, 8);
  assert.equal(h.plugin._lineRefContextCache.has('TARGET_0'), false, 'oldest entry is evicted');
  h.plugin._lineRefContextCacheGet('TARGET_1');
  h.plugin._lineRefContextCacheSet('TARGET_9', {
    ownerGuid: 'OWNER_9', lineGuids: new Set(),
  });
  assert.equal(h.plugin._lineRefContextCache.has('TARGET_1'), true, 'cache hit refreshes LRU recency');
  assert.equal(h.plugin._lineRefContextCache.has('TARGET_2'), false, 'least-recent untouched entry is evicted');
  h.plugin.onUnload();
});

test('v4.39 created and undeleted callbacks behaviorally invalidate their owner context', async () => {
  const h = lineRefClickHarness();
  let reads = 0;
  h.records.set('EVENT_OWNER', {
    guid: 'EVENT_OWNER', getName: () => 'Event owner',
    getLineItems: async () => {
      reads++;
      return [{
        guid: 'EVENT_TARGET', parent_guid: null, type: 'ulist',
        segments: [{ type: 'text', text: 'Version ' + reads }], children: [],
      }];
    },
  });
  h.plugin._lineOwnerHints.set('EVENT_TARGET', 'EVENT_OWNER');
  assert.ok(await h.plugin._loadLineRefContext('EVENT_TARGET'));
  for (const eventName of ['lineitem.created', 'lineitem.undeleted']) {
    const callback = (h.eventHandlers.get(eventName) || [])
      .find((entry) => String(entry.callback).includes('_invalidateLineRefContextForEvent'))
      ?.callback;
    assert.ok(callback, eventName + ' callback is installed');
    callback({
      recordGuid: 'EVENT_OWNER',
      lineItemGuid: eventName === 'lineitem.created' ? 'CREATED_SIBLING' : 'RESTORED_SIBLING',
    });
    const entry = await h.plugin._loadLineRefContext('EVENT_TARGET');
    assert.equal(h.plugin._cleanDisplayText(entry.items[0].segments), 'Version ' + reads);
  }
  assert.equal(reads, 3);
  h.plugin.onUnload();
});

test('v4.39 auxiliary context invalidation state stays bounded under workspace event churn', async () => {
  const h = lineRefClickHarness();
  const created = (h.eventHandlers.get('lineitem.created') || [])
    .find((entry) => String(entry.callback).includes('_invalidateLineRefContextForEvent'))
    ?.callback;
  assert.ok(created);
  const durableOwnerHintCount = h.plugin._lineOwnerHints.size;
  for (let index = 0; index < 200; index++) {
    created({ recordGuid: 'OWNER_' + index, lineItemGuid: 'LINE_' + index });
    h.plugin._lineRefContextRememberOwnerMiss('MISS_' + index);
  }
  assert.equal(h.plugin._lineRefContextEventHints.size, 64);
  assert.equal(h.plugin._lineRefContextEventOwnerHints.size, 64);
  assert.equal(h.plugin._lineRefContextOwnerMisses.size, 128);
  assert.equal(
    h.plugin._lineOwnerHints.size,
    durableOwnerHintCount,
    'new-line event churn never grows the long-lived owner-hint map'
  );

  const unresolvedTickets = [];
  h.plugin._loadLineRefContextFresh = (_targetGuid, ticket) => new Promise((resolve) => {
    unresolvedTickets.push({ ticket, resolve });
  });
  const loads = [];
  for (let index = 0; index < 9; index++) {
    loads.push(h.plugin._loadLineRefContext('PENDING_' + index));
  }
  assert.equal(h.plugin._lineRefContextPending.size, 8);
  assert.equal(unresolvedTickets.length, 8, 'capacity rejection launches no replacement hydration');
  assert.equal(await loads[8], null, 'the ninth distinct request is terminally unavailable');
  assert.equal(
    unresolvedTickets.some(({ ticket }) => ticket.invalidated),
    false,
    'capacity pressure never invalidates unresolved work'
  );
  for (const pending of unresolvedTickets) pending.resolve(null);
  await Promise.all(loads);
  assert.equal(h.plugin._lineRefContextPending.size, 0, 'all pending slots release only after settlement');
  assert.equal(unresolvedTickets.length, 8, 'the rejected request is never resurrected after slots free');
  h.plugin.onUnload();
});

test('v4.39 rapid distinct context opens never exceed eight concurrent SDK hydrations and same-target coalesces', async () => {
  const h = lineRefClickHarness();
  const releases = [];
  let activeReads = 0;
  let maxActiveReads = 0;
  let reads = 0;
  for (let index = 0; index < 9; index++) {
    const targetGuid = 'RAPID_TARGET_' + index;
    const ownerGuid = 'RAPID_OWNER_' + index;
    h.plugin._lineOwnerHints.set(targetGuid, ownerGuid);
    h.records.set(ownerGuid, {
      guid: ownerGuid,
      getLineItems: () => {
        reads++;
        activeReads++;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        return new Promise((resolve) => releases.push(() => {
          activeReads--;
          resolve([{
            guid: targetGuid, parent_guid: null, type: 'ulist',
            segments: [{ type: 'text', text: targetGuid }], children: [],
          }]);
        }));
      },
    });
  }

  const loads = Array.from(
    { length: 9 },
    (_, index) => h.plugin._loadLineRefContext('RAPID_TARGET_' + index)
  );
  const shared = h.plugin._loadLineRefContext('RAPID_TARGET_0');
  await tick();
  assert.equal(reads, 8);
  assert.equal(activeReads, 8);
  assert.equal(maxActiveReads, 8);
  assert.equal(h.plugin._lineRefContextPending.size, 8);
  assert.equal(await loads[8], null);

  for (const release of releases.splice(0)) release();
  const settled = await Promise.all([...loads.slice(0, 8), shared]);
  assert.equal(settled.every(Boolean), true);
  assert.equal(reads, 8, 'same-target consumer shares the original SDK hydration');
  assert.equal(activeReads, 0);
  assert.equal(h.plugin._lineRefContextPending.size, 0);
  await tick();
  assert.equal(reads, 8, 'capacity-rejected load never starts later on its own');
  h.plugin.onUnload();
});

test('v4.39 an update during hydration discards stale data, retries, and never renders it', async () => {
  const h = lineRefClickHarness();
  let releaseStale;
  let reads = 0;
  h.records.set('PENDING_OWNER', {
    guid: 'PENDING_OWNER', getName: () => 'Pending owner',
    getLineItems: () => {
      reads++;
      if (reads === 1) return new Promise((resolve) => { releaseStale = resolve; });
      return Promise.resolve([{
        guid: 'PENDING_TARGET', parent_guid: null, type: 'ulist',
        segments: [{ type: 'text', text: 'Fresh after update' }], children: [],
      }]);
    },
  });
  h.plugin._lineOwnerHints.set('PENDING_TARGET', 'PENDING_OWNER');
  const host = h.document.createElement('div');
  const body = h.document.createElement('div'); body.className = 'refx-line-context-body';
  host.append(body);
  const rendering = h.plugin._hydrateLineRefContext(host, 'PENDING_TARGET');
  const sharedConsumer = h.plugin._loadLineRefContext('PENDING_TARGET');
  await tick();
  const invalidator = (h.eventHandlers.get('lineitem.updated') || [])
    .find((entry) => String(entry.callback).includes('_invalidateLineRefContextForEvent'));
  invalidator.callback({ recordGuid: 'PENDING_OWNER', lineitemGuid: 'PENDING_TARGET' });
  releaseStale([{
    guid: 'PENDING_TARGET', parent_guid: null, type: 'ulist',
    segments: [{ type: 'text', text: 'STALE BEFORE UPDATE' }], children: [],
  }]);

  const [rendered, sharedEntry] = await Promise.all([rendering, sharedConsumer]);
  assert.equal(rendered, true);
  assert.equal(sharedEntry.ownerGuid, 'PENDING_OWNER');
  assert.equal(h.plugin._cleanDisplayText(sharedEntry.items[0].segments), 'Fresh after update');
  assert.equal(reads, 2, 'the invalidated owner is hydrated again');
  assert.equal(body.textContent.includes('Fresh after update'), true);
  assert.equal(body.textContent.includes('STALE BEFORE UPDATE'), false);
  h.plugin.onUnload();
});

test('v4.39 an owner event during cold owner discovery fences the stale body and retries fresh', async () => {
  const h = lineRefClickHarness();
  let releaseOwner;
  let ownerLookups = 0;
  let reads = 0;
  h.plugin._lineRefContextOwner = () => {
    ownerLookups++;
    if (ownerLookups === 1) {
      return new Promise((resolve) => { releaseOwner = resolve; });
    }
    return Promise.resolve('COLD_EVENT_OWNER');
  };
  h.records.set('COLD_EVENT_OWNER', {
    guid: 'COLD_EVENT_OWNER', getName: () => 'Cold event owner',
    getLineItems: async () => {
      reads++;
      const text = ownerLookups === 1
        ? 'STALE COLD OWNER BODY'
        : 'Fresh after cold owner event';
      return [{
        guid: 'COLD_EVENT_TARGET', parent_guid: null, type: 'ulist',
        segments: [{ type: 'text', text }], children: [],
      }];
    },
  });
  const host = h.document.createElement('div');
  const body = h.document.createElement('div'); body.className = 'refx-line-context-body';
  host.append(body);
  const rendering = h.plugin._hydrateLineRefContext(host, 'COLD_EVENT_TARGET');
  await tick();
  const firstTicket = h.plugin._lineRefContextPending.get('COLD_EVENT_TARGET');
  assert.ok(firstTicket);
  assert.equal(firstTicket.ownerGuid, null, 'owner discovery is still unresolved');

  const updated = (h.eventHandlers.get('lineitem.updated') || [])
    .find((entry) => String(entry.callback).includes('_invalidateLineRefContextForEvent'));
  updated.callback({
    recordGuid: 'COLD_EVENT_OWNER',
    lineItemGuid: 'UPDATED_SIBLING',
  });
  assert.equal(
    firstTicket.invalidated,
    false,
    'an owner-unknown ticket is not fenced before it knows what it owns'
  );
  assert.equal(
    firstTicket.ownerUnknownEvents.has('COLD_EVENT_OWNER'),
    true,
    'the record is remembered so the ticket can judge it at resolution'
  );
  releaseOwner('COLD_EVENT_OWNER');

  assert.equal(await rendering, true);
  assert.equal(ownerLookups, 2, 'the invalidated cold discovery gets one bounded retry');
  assert.equal(reads, 1, 'the first-attempt stale body is never read');
  assert.equal(body.textContent.includes('Fresh after cold owner event'), true);
  assert.equal(body.textContent.includes('STALE COLD OWNER BODY'), false);
  const cached = h.plugin._lineRefContextCache.get('COLD_EVENT_TARGET');
  assert.ok(cached);
  assert.equal(
    h.plugin._cleanDisplayText(cached.items[0].segments),
    'Fresh after cold owner event'
  );
  h.plugin.onUnload();
});

test('v4.39 unrelated records never fence a ticket that is still discovering its owner', async () => {
  const h = lineRefClickHarness();
  let ownerLookups = 0;
  let reads = 0;
  let releaseOwner;
  h.plugin._lineRefContextOwner = () => {
    ownerLookups++;
    return new Promise((resolve) => { releaseOwner = resolve; });
  };
  h.records.set('TYPING_OWNER', {
    guid: 'TYPING_OWNER', getName: () => 'Typing owner',
    getLineItems: async () => {
      reads++;
      return [{
        guid: 'TYPING_TARGET', parent_guid: 'TYPING_OWNER', type: 'ulist',
        segments: [{ type: 'text', text: 'Real context' }], children: [],
      }];
    },
  });
  const host = h.document.createElement('div');
  const body = h.document.createElement('div'); body.className = 'refx-line-context-body';
  host.append(body);
  const rendering = h.plugin._hydrateLineRefContext(host, 'TYPING_TARGET');
  await tick();
  const ticket = h.plugin._lineRefContextPending.get('TYPING_TARGET');
  assert.ok(ticket);
  const updated = (h.eventHandlers.get('lineitem.updated') || [])
    .find((entry) => String(entry.callback).includes('_invalidateLineRefContextForEvent'));
  for (let index = 0; index < 5; index++) {
    updated.callback({ recordGuid: 'ELSEWHERE_' + index, lineItemGuid: 'ELSEWHERE_LINE_' + index });
  }
  assert.equal(ticket.invalidated, false, 'typing in other records is not this target changing');
  releaseOwner('TYPING_OWNER');

  assert.equal(await rendering, true);
  assert.equal(ownerLookups, 1, 'unrelated churn costs no bounded attempt');
  assert.equal(reads, 1);
  assert.equal(body.textContent.includes('Real context'), true);
  h.plugin.onUnload();
});

test('v4.39 continuous unrelated churn no longer exhausts both attempts into an unavailable menu', async () => {
  const h = lineRefClickHarness();
  let ownerLookups = 0;
  // Fires while every owner discovery is in flight, so under the former
  // fence-every-owner-unknown-ticket rule BOTH bounded attempts were consumed
  // and a live target rendered "Couldn't load this block's context".
  h.plugin._lineRefContextOwner = async () => {
    ownerLookups++;
    await Promise.resolve();
    const updated = (h.eventHandlers.get('lineitem.updated') || [])
      .find((entry) => String(entry.callback).includes('_invalidateLineRefContextForEvent'));
    for (let index = 0; index < 3; index++) {
      updated.callback({
        recordGuid: 'CHURN_RECORD_' + ownerLookups + '_' + index,
        lineItemGuid: 'CHURN_LINE_' + ownerLookups + '_' + index,
      });
    }
    return 'CHURN_OWNER';
  };
  h.records.set('CHURN_OWNER', {
    guid: 'CHURN_OWNER', getName: () => 'Churn owner',
    getLineItems: async () => [{
      guid: 'CHURN_TARGET', parent_guid: 'CHURN_OWNER', type: 'ulist',
      segments: [{ type: 'text', text: 'Survives the churn' }], children: [],
    }],
  });
  const host = h.document.createElement('div');
  const body = h.document.createElement('div'); body.className = 'refx-line-context-body';
  host.append(body);

  assert.equal(await h.plugin._hydrateLineRefContext(host, 'CHURN_TARGET'), true);
  assert.equal(ownerLookups, 1);
  assert.equal(body.querySelector('.refalias-preview-empty'), null);
  assert.equal(body.textContent.includes('Survives the churn'), true);
  h.plugin.onUnload();
});

test('v4.39 nullable-owner deletion invalidates pending consumers and cannot render the deleted line', async () => {
  const h = lineRefClickHarness();
  let releaseDeleted;
  h.records.set('DELETED_OWNER', {
    guid: 'DELETED_OWNER', getName: () => 'Deleted owner',
    getLineItems: () => new Promise((resolve) => { releaseDeleted = resolve; }),
  });
  h.plugin._lineOwnerHints.set('DELETED_TARGET', 'DELETED_OWNER');
  const loading = h.plugin._loadLineRefContext('DELETED_TARGET');
  await tick();
  h.plugin._lineRefContextOwnerMisses.add('DELETED_TARGET');
  const deleted = (h.eventHandlers.get('lineitem.deleted') || [])
    .find((entry) => String(entry.callback).includes('_invalidateLineRefContextForEvent'));
  deleted.callback({ guid: 'DELETED_TARGET', recordGuid: null });
  releaseDeleted([{
    guid: 'DELETED_TARGET', parent_guid: null, type: 'ulist',
    segments: [{ type: 'text', text: 'Deleted stale body' }], children: [],
  }]);

  assert.equal(await loading, null);
  assert.equal(h.plugin._lineRefContextCache.has('DELETED_TARGET'), false);
  assert.equal(h.plugin._lineRefContextOwnerMisses.has('DELETED_TARGET'), false);
  assert.equal(h.plugin._lineOwnerHints.has('DELETED_TARGET'), false);
  h.plugin.onUnload();
});

test('v4.39 SDK-shaped cross-record move retries the moved target at its destination owner', async () => {
  const h = lineRefClickHarness();
  let releaseOld;
  h.records.set('OLD_OWNER', {
    guid: 'OLD_OWNER', getName: () => 'Old owner',
    getLineItems: () => new Promise((resolve) => { releaseOld = resolve; }),
  });
  h.records.set('NEW_OWNER', {
    guid: 'NEW_OWNER', getName: () => 'New owner',
    getLineItems: async () => [{
      guid: 'MOVED_TARGET', parent_guid: null, type: 'ulist',
      segments: [{ type: 'text', text: 'Moved target in new owner' }], children: [],
    }],
  });
  h.plugin._lineOwnerHints.set('MOVED_TARGET', 'OLD_OWNER');
  const loading = h.plugin._loadLineRefContext('MOVED_TARGET');
  await tick();
  const moved = (h.eventHandlers.get('lineitem.moved') || [])
    .find((entry) => String(entry.callback).includes('_invalidateLineRefContextForEvent'));
  moved.callback({
    recordGuid: 'NEW_OWNER',
    lineItemGuid: 'MOVED_TARGET',
  });
  releaseOld([{
    guid: 'MOVED_TARGET', parent_guid: null, type: 'ulist',
    segments: [{ type: 'text', text: 'Stale old-owner target' }], children: [],
  }]);

  const entry = await loading;
  assert.equal(entry.ownerGuid, 'NEW_OWNER');
  assert.equal(entry.ownerName, 'New owner');
  assert.equal(h.plugin._lineRefContextEventOwnerHints.get('MOVED_TARGET').ownerGuid, 'NEW_OWNER');
  assert.notEqual(
    h.plugin._lineOwnerHints.get('MOVED_TARGET'),
    'NEW_OWNER',
    'move events do not permanently add their destination to durable owner hints'
  );
  assert.equal(
    h.plugin._cleanDisplayText(entry.items[0].segments),
    'Moved target in new owner'
  );
  h.plugin.onUnload();
});

test('v4.39 targetRecordGuid-only move retries the moved target at its destination owner', async () => {
  const h = lineRefClickHarness();
  let releaseOld;
  h.records.set('TARGET_FIELD_OLD_OWNER', {
    guid: 'TARGET_FIELD_OLD_OWNER', getName: () => 'Target-field old owner',
    getLineItems: () => new Promise((resolve) => { releaseOld = resolve; }),
  });
  h.records.set('TARGET_FIELD_NEW_OWNER', {
    guid: 'TARGET_FIELD_NEW_OWNER', getName: () => 'Target-field new owner',
    getLineItems: async () => [{
      guid: 'TARGET_FIELD_MOVED_TARGET', parent_guid: null, type: 'ulist',
      segments: [{ type: 'text', text: 'Moved target from targetRecordGuid owner' }], children: [],
    }],
  });
  h.plugin._lineOwnerHints.set('TARGET_FIELD_MOVED_TARGET', 'TARGET_FIELD_OLD_OWNER');
  const loading = h.plugin._loadLineRefContext('TARGET_FIELD_MOVED_TARGET');
  await tick();
  const moved = (h.eventHandlers.get('lineitem.moved') || [])
    .find((entry) => String(entry.callback).includes('_invalidateLineRefContextForEvent'));
  moved.callback({
    targetRecordGuid: 'TARGET_FIELD_NEW_OWNER',
    lineItemGuid: 'TARGET_FIELD_MOVED_TARGET',
  });
  releaseOld([{
    guid: 'TARGET_FIELD_MOVED_TARGET', parent_guid: null, type: 'ulist',
    segments: [{ type: 'text', text: 'Stale target-field old-owner target' }], children: [],
  }]);

  const entry = await loading;
  assert.equal(entry.ownerGuid, 'TARGET_FIELD_NEW_OWNER');
  assert.equal(entry.ownerName, 'Target-field new owner');
  assert.equal(
    h.plugin._lineRefContextEventOwnerHints.get('TARGET_FIELD_MOVED_TARGET').ownerGuid,
    'TARGET_FIELD_NEW_OWNER'
  );
  assert.equal(
    h.plugin._cleanDisplayText(entry.items[0].segments),
    'Moved target from targetRecordGuid owner'
  );
  h.plugin.onUnload();
});

test('v4.39 destination-only sibling move invalidates another target pending on the old owner with no stale render', async () => {
  const h = lineRefClickHarness();
  let releaseOld;
  let oldReads = 0;
  h.records.set('OLD_SIBLING_OWNER', {
    guid: 'OLD_SIBLING_OWNER', getName: () => 'Old sibling owner',
    getLineItems: () => {
      oldReads++;
      if (oldReads === 1) return new Promise((resolve) => { releaseOld = resolve; });
      return Promise.resolve([{
        guid: 'STAYING_TARGET', parent_guid: null, type: 'ulist',
        segments: [{ type: 'text', text: 'Fresh remaining target' }], children: [],
      }]);
    },
  });
  h.records.set('MOVE_DESTINATION', {
    guid: 'MOVE_DESTINATION', getLineItems: async () => [{
      guid: 'MOVED_SIBLING', parent_guid: null, type: 'ulist',
      segments: [{ type: 'text', text: 'Moved sibling' }], children: [],
    }],
  });
  h.plugin._lineOwnerHints.set('STAYING_TARGET', 'OLD_SIBLING_OWNER');
  const host = h.document.createElement('div');
  const body = h.document.createElement('div'); body.className = 'refx-line-context-body';
  host.append(body);
  const rendering = h.plugin._hydrateLineRefContext(host, 'STAYING_TARGET');
  await tick();
  const moved = (h.eventHandlers.get('lineitem.moved') || [])
    .find((entry) => String(entry.callback).includes('_invalidateLineRefContextForEvent'));
  moved.callback({ recordGuid: 'MOVE_DESTINATION', lineItemGuid: 'MOVED_SIBLING' });
  releaseOld([{
    guid: 'STAYING_TARGET', parent_guid: null, type: 'ulist',
    segments: [{ type: 'text', text: 'STALE BEFORE SIBLING MOVE' }], children: [],
  }]);

  assert.equal(await rendering, true);
  assert.equal(oldReads, 2, 'ambiguous move forces a bounded retry of other pending targets');
  assert.equal(body.textContent.includes('Fresh remaining target'), true);
  assert.equal(body.textContent.includes('STALE BEFORE SIBLING MOVE'), false);
  h.plugin.onUnload();
});

test('v4.39 nullable-owner sibling delete invalidates another pending target with no stale render', async () => {
  const h = lineRefClickHarness();
  let releaseOld;
  let reads = 0;
  h.records.set('DELETE_SIBLING_OWNER', {
    guid: 'DELETE_SIBLING_OWNER', getName: () => 'Delete sibling owner',
    getLineItems: () => {
      reads++;
      if (reads === 1) return new Promise((resolve) => { releaseOld = resolve; });
      return Promise.resolve([{
        guid: 'DELETE_STAYING_TARGET', parent_guid: null, type: 'ulist',
        segments: [{ type: 'text', text: 'Fresh after sibling delete' }], children: [],
      }]);
    },
  });
  h.plugin._lineOwnerHints.set('DELETE_STAYING_TARGET', 'DELETE_SIBLING_OWNER');
  const host = h.document.createElement('div');
  const body = h.document.createElement('div'); body.className = 'refx-line-context-body';
  host.append(body);
  const rendering = h.plugin._hydrateLineRefContext(host, 'DELETE_STAYING_TARGET');
  await tick();
  const deleted = (h.eventHandlers.get('lineitem.deleted') || [])
    .find((entry) => String(entry.callback).includes('_invalidateLineRefContextForEvent'));
  deleted.callback({ recordGuid: null, lineItemGuid: 'DELETED_SIBLING' });
  releaseOld([{
    guid: 'DELETE_STAYING_TARGET', parent_guid: null, type: 'ulist',
    segments: [{ type: 'text', text: 'STALE BEFORE SIBLING DELETE' }], children: [],
  }]);

  assert.equal(await rendering, true);
  assert.equal(reads, 2);
  assert.equal(body.textContent.includes('Fresh after sibling delete'), true);
  assert.equal(body.textContent.includes('STALE BEFORE SIBLING DELETE'), false);
  h.plugin.onUnload();
});

test('v4.39 live target ownership wins over a stale alias owner on cold context load', async () => {
  const h = lineRefClickHarness();
  let staleReads = 0;
  h.records.set('STALE_ALIAS_OWNER', {
    guid: 'STALE_ALIAS_OWNER', getLineItems: async () => { staleReads++; return []; },
  });
  h.records.set('LIVE_OWNER', {
    guid: 'LIVE_OWNER', getName: () => 'Live owner',
    getLineItems: async () => [{
      guid: 'LIVE_TARGET', parent_guid: null, type: 'ulist',
      segments: [{ type: 'text', text: 'Live target' }], children: [],
    }],
  });
  h.plugin._lineAliasGet = () => ({ recordGuid: 'STALE_ALIAS_OWNER' });
  h.plugin._targetOwnerGuid = () => 'LIVE_OWNER';

  const entry = await h.plugin._loadLineRefContext('LIVE_TARGET');
  assert.equal(entry.ownerGuid, 'LIVE_OWNER');
  assert.equal(staleReads, 0);
  h.plugin.onUnload();
});

test('v4.39 menu context caps 205 direct children at four and reports the exact +201 remainder', () => {
  const h = lineRefClickHarness();
  const bodyHost = h.document.createElement('div');
  const body = h.document.createElement('div'); body.className = 'refx-line-context-body';
  bodyHost.append(body);
  const children = Array.from({ length: 205 }, (_, index) => ({
    guid: 'CHILD_' + index, parent_guid: 'TARGET_CLICK', type: 'ulist',
    segments: [{ type: 'text', text: 'Child ' + index }], children: [],
  }));
  const items = [{
    guid: 'TARGET_CLICK', parent_guid: null, type: 'ulist',
    segments: [{ type: 'text', text: 'Target' }], children,
  }];
  assert.equal(h.plugin._renderLineRefContext(bodyHost, 'TARGET_CLICK', items, 'Owner'), true);
  assert.equal(bodyHost.querySelectorAll('.refx-preview-outline-child').length, 4);
  assert.equal(bodyHost.querySelector('.refx-preview-outline-more-text').textContent, '+201 more');
  h.plugin.onUnload();
});

test('v4.39 the popover surface keeps the v4.38 eight-child depth the bounded menu gives up', () => {
  const h = lineRefClickHarness();
  const children = Array.from({ length: 205 }, (_, index) => ({
    guid: 'SURFACE_CHILD_' + index, parent_guid: 'SURFACE_TARGET', type: 'ulist',
    segments: [{ type: 'text', text: 'Surface child ' + index }], children: [],
  }));
  const items = [
    {
      guid: 'SURFACE_BEFORE', parent_guid: null, type: 'ulist',
      segments: [{ type: 'text', text: 'Surface before' }], children: [],
    },
    {
      guid: 'SURFACE_TARGET', parent_guid: null, type: 'ulist',
      segments: [{ type: 'text', text: 'Surface target' }], children,
    },
    {
      guid: 'SURFACE_AFTER', parent_guid: null, type: 'ulist',
      segments: [{ type: 'text', text: 'Surface after' }], children: [],
    },
  ];
  const render = (options) => {
    const host = h.document.createElement('div');
    const body = h.document.createElement('div'); body.className = 'refx-line-context-body';
    host.append(body);
    assert.equal(h.plugin._renderLineRefContext(
      host, 'SURFACE_TARGET', items, 'Owner', null, null, options
    ), true);
    return host;
  };

  const menu = render({ surface: 'menu' });
  assert.equal(menu.querySelectorAll('.refx-preview-outline-child').length, 4);
  assert.equal(menu.querySelectorAll('.refx-preview-outline-sibling').length, 0);
  assert.equal(menu.querySelector('.refx-preview-outline-more-text').textContent, '+201 more');

  const popover = render({ surface: 'popover' });
  assert.equal(popover.querySelectorAll('.refx-preview-outline-child').length, 8);
  assert.equal(popover.querySelector('.refx-preview-outline-more-text').textContent, '+197 more');
  assert.deepEqual(
    popover.querySelectorAll('.refx-preview-outline-sibling').map((row) => row.dataset.guid),
    ['SURFACE_BEFORE', 'SURFACE_AFTER']
  );
  h.plugin.onUnload();
});

test('v4.39 nested descendants never inflate the direct-child +N count', () => {
  const h = lineRefClickHarness();
  const bodyHost = h.document.createElement('div');
  const body = h.document.createElement('div'); body.className = 'refx-line-context-body';
  bodyHost.append(body);
  const grandchildren = Array.from({ length: 205 }, (_, index) => ({
    guid: 'GRANDCHILD_' + index, parent_guid: 'ONLY_CHILD', type: 'ulist',
    segments: [{ type: 'text', text: 'Grandchild ' + index }], children: [],
  }));
  const items = [{
    guid: 'TARGET_CLICK', parent_guid: null, type: 'ulist',
    segments: [{ type: 'text', text: 'Target' }],
    children: [{
      guid: 'ONLY_CHILD', parent_guid: 'TARGET_CLICK', type: 'ulist',
      segments: [{ type: 'text', text: 'Only child' }], children: grandchildren,
    }],
  }];
  assert.equal(h.plugin._renderLineRefContext(bodyHost, 'TARGET_CLICK', items, 'Owner'), true);
  assert.equal(bodyHost.querySelectorAll('.refx-preview-outline-child').length, 1);
  assert.equal(bodyHost.querySelector('.refx-preview-outline-more-text'), null);
  h.plugin.onUnload();
});

test('v4.39 exact direct-child remainder is independent of the 6000-row navigator scan cap', () => {
  const h = lineRefClickHarness();
  const bodyHost = h.document.createElement('div');
  const body = h.document.createElement('div'); body.className = 'refx-line-context-body';
  bodyHost.append(body);
  const children = Array.from({ length: 6005 }, (_, index) => ({
    guid: 'WIDE_CHILD_' + index, parent_guid: 'TARGET_CLICK', type: 'ulist',
    segments: [{ type: 'text', text: 'Wide child ' + index }], children: [],
  }));
  const items = [{
    guid: 'TARGET_CLICK', parent_guid: null, type: 'ulist',
    segments: [{ type: 'text', text: 'Target' }], children,
  }];
  assert.equal(h.plugin._renderLineRefContext(bodyHost, 'TARGET_CLICK', items, 'Owner'), true);
  assert.equal(bodyHost.querySelectorAll('.refx-preview-outline-child').length, 4);
  assert.equal(bodyHost.querySelector('.refx-preview-outline-more-text').textContent, '+6001 more');
  h.plugin.onUnload();
});

test('v4.39 "popover" detached chip during awaited hydration cancels without leaving a stale popover', async () => {
  const h = lineRefClickHarness({ lineRefClickContext: 'popover' });
  let releaseLines;
  const targetOwner = {
    guid: 'SLOW_OWNER',
    getName: () => 'Slow owner',
    getLineItems: () => new Promise((resolve) => { releaseLines = resolve; }),
  };
  h.records.set(targetOwner.guid, targetOwner);
  h.plugin._lineOwnerHints.set('TARGET_CLICK', targetOwner.guid);
  h.plugin._positionPopover = () => {};
  let stillCurrent = true;

  const opening = h.plugin._openLineRefContextForChip(h.chip, () => stillCurrent);
  await tick();
  assert.ok(h.document.querySelector('.refx-line-context-pop'), 'loading shell opens immediately');
  stillCurrent = false;
  h.chip.remove();
  releaseLines([{
    guid: 'TARGET_CLICK', parent_guid: null, type: 'ulist',
    segments: [{ type: 'text', text: 'Late target' }], children: [],
  }]);

  assert.equal(await opening, false);
  assert.equal(h.document.querySelector('.refx-line-context-pop'), null);
  h.plugin.onUnload();
});

test('v4.39 compact context resolves an exact target after 6001 decoy roots without fabricated ellipsis rows', () => {
  const h = lineRefClickHarness();
  const bodyHost = h.document.createElement('div');
  const body = h.document.createElement('div'); body.className = 'refx-line-context-body';
  bodyHost.append(body);
  const decoys = Array.from({ length: 6001 }, (_, index) => ({
    guid: 'DECOY_ROOT_' + index, parent_guid: null, type: 'ulist',
    segments: [{ type: 'text', text: 'Decoy ' + index }], children: [],
  }));
  const children = Array.from({ length: 205 }, (_, index) => ({
    guid: 'LATE_CHILD_' + index, parent_guid: 'LATE_TARGET', type: 'ulist',
    segments: [{ type: 'text', text: 'Late child ' + index }],
    children: index === 0 ? [{
      guid: 'LATE_GRANDCHILD', parent_guid: 'LATE_CHILD_0', type: 'ulist',
      segments: [{ type: 'text', text: 'Nested descendant' }], children: [],
    }] : [],
  }));
  const parent = {
    guid: 'LATE_PARENT', parent_guid: null, type: 'ulist',
    segments: [{ type: 'text', text: 'Real late parent' }],
    children: [{
      guid: 'LATE_TARGET', parent_guid: 'LATE_PARENT', type: 'ulist',
      segments: [{ type: 'text', text: 'Real late target' }], children,
    }],
  };
  const items = [...decoys, parent];

  assert.equal(h.plugin._renderLineRefContext(
    bodyHost, 'LATE_TARGET', items, 'Late owner'
  ), true);
  assert.deepEqual(
    bodyHost.querySelectorAll('.refx-preview-outline-row')
      .map((row) => [row.dataset.outlineRole, row.dataset.guid]),
    [
      ['parent', 'LATE_PARENT'],
      ['target', 'LATE_TARGET'],
      ['child', 'LATE_CHILD_0'],
      ['child', 'LATE_CHILD_1'],
      ['child', 'LATE_CHILD_2'],
      ['child', 'LATE_CHILD_3'],
    ]
  );
  assert.equal(
    bodyHost.querySelector('.refx-preview-outline-target').textContent.includes('Real late target'),
    true
  );
  assert.equal(bodyHost.querySelector('.refx-preview-outline-more-text').textContent, '+201 more');
  assert.equal(bodyHost.textContent.includes('Nested descendant'), false);
  assert.equal(bodyHost.textContent.includes('…'), false);
  h.plugin.onUnload();
});

test('v4.39 "popover" context closes on Escape and outside press through the shared popup shell', async () => {
  const h = lineRefClickHarness({ lineRefClickContext: 'popover' });
  h.plugin._positionPopover = () => {};
  h.plugin._lineRefContextOwner = async () => null;

  await h.plugin._openLineRefContextForChip(h.chip);
  await tick();
  assert.ok(h.document.querySelector('.refx-line-context-pop'));
  const escape = event('keydown', { key: 'Escape', target: h.document.querySelector('.refx-line-context-pop') });
  h.window.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(h.document.querySelector('.refx-line-context-pop'), null);

  await h.plugin._openLineRefContextForChip(h.chip);
  const backdrop = h.document.querySelector('.refx-pop-backdrop');
  assert.ok(backdrop);
  backdrop.dispatchEvent(event('mousedown', { target: backdrop, button: 0 }));
  assert.equal(h.document.querySelector('.refx-line-context-pop'), null);
  h.plugin.onUnload();
});

test('v4.39 menu and popover share hierarchy, bounded renderer, hydration, popup, rails, and forensic errors', () => {
  assert.match(source, /_openLineRefContextForChip[\s\S]*?_openCardPopup\(pop, chip,/);
  assert.match(source, /_renderLineRefContext[\s\S]*?_lineRefContextBuildModel\(targetGuid, adjacency\)/);
  assert.match(source, /_appendPreviewOutlineRow[\s\S]*?_appendPreviewOutlineRails\(/);
  assert.match(source, /refx-line-context-jump[\s\S]*?_bridgeJump\(targetGuid,/);
  assert.match(source, /_recordRefxError\(error, "line context load"\)/);
});

test('v4.48.3 the menu reserves Block Context independently after mounting the chain before its one-shot anchor', () => {
  // _openCardPopup anchors once, before hydration replaces the loading
  // skeleton. The chain has its own preceding scroller, so only Block Context
  // rows contribute to this independent reservation.
  assert.match(source, /\.refx-refmenu-context \.refx-line-context-body \{\s*height: var\(--refx-line-context-height\); overflow-y: auto;/);
  assert.match(source, /_fitLineRefMenuContext\(section, targetGuid, chain = null\)[\s\S]*?const rows = Math\.max\(1, outlineRows \+ chromeRows\);[\s\S]*?Math\.max\(56, Math\.min\(200, rows \* rowH \+ chrome\)\)/);
  assert.match(source, /pop\.append\(contextSection\);\s*this\._ensureLineRefChainBeforeContext\(pop, r\.targetGuid\);[\s\S]*?this\._fitLineRefMenuContext\(contextSection, r\.targetGuid, cachedChain\);[\s\S]*?this\._openCardPopup\(pop,/);
  assert.doesNotMatch(
    source,
    /\.refx-refmenu-context \.refx-line-context-body \{[^}]*(min-height|max-height|overflow: hidden)/
  );
});


test('v4.12 line-ref click listeners are removed on unload and stale hot-reload cleanup', () => {
  const h = lineRefClickHarness();
  const own = {
    click: h.plugin._lineRefClick,
    dblclick: h.plugin._lineRefDblClick,
    press: h.plugin._lineRefPress,
  };
  assert.ok(h.winListeners.get('click').includes(own.click));
  assert.ok(h.winListeners.get('dblclick').includes(own.dblclick));
  assert.ok(h.winListeners.get('mousedown').includes(own.press));
  h.window.dispatchEvent(event('click', { target: h.chip, button: 0, detail: 1 }));
  assert.ok(h.window.__refxLineRefClickTimer, 'single-click window timer is stashed for hot reload');
  h.plugin.onUnload();
  assert.equal(h.winListeners.get('click').includes(own.click), false);
  assert.equal(h.winListeners.get('dblclick').includes(own.dblclick), false);
  assert.equal(h.winListeners.get('mousedown').includes(own.press), false);
  assert.equal(h.window.__refxLineRefClick, null);
  assert.equal(h.window.__refxLineRefDblClick, null);
  assert.equal(h.window.__refxLineRefPress, null);
  assert.equal(h.window.__refxLineRefClickTimer, 0);

  const stale = lineRefClickHarness();
  const staleClick = stale.plugin._lineRefClick;
  stale.plugin._killStaleObservers();
  assert.equal(stale.winListeners.get('click').includes(staleClick), false, 'hot reload sweeps prior click handler');
  assert.equal(stale.window.__refxLineRefClick, null);
  stale.plugin.onUnload();
});

test('v4.39 context event subscriptions are removed on unload and hot-reload sweep', () => {
  const eventNames = [
    'lineitem.created', 'lineitem.updated', 'lineitem.moved',
    'lineitem.undeleted', 'lineitem.deleted',
  ];
  const h = lineRefClickHarness();
  const ids = new Set(h.plugin._lineRefContextEventHandlers);
  assert.equal(ids.size, eventNames.length);
  h.plugin.onUnload();
  for (const eventName of eventNames) {
    assert.equal(
      (h.eventHandlers.get(eventName) || []).some((entry) => ids.has(entry.id)),
      false,
      eventName + ' is removed on unload'
    );
  }

  const stale = lineRefClickHarness();
  const staleIds = new Set(stale.plugin._lineRefContextEventHandlers);
  stale.plugin._killStaleObservers();
  for (const eventName of eventNames) {
    assert.equal(
      (stale.eventHandlers.get(eventName) || []).some((entry) => staleIds.has(entry.id)),
      false,
      eventName + ' is removed by the hot-reload singleton sweep'
    );
  }
  stale.plugin.onUnload();
});

// ── v4.40: Block Context above linked references ─────────────────────────────

// Real badge plumbing: a count badge inside a host line, routed through the
// production _routeBadgeClick. Fixtures use the SDK root shape
// (parent_guid = the owning record's guid), like the PROBE fixtures.
function badgeHarness(targetGuid, custom = {}, options = {}) {
  const h = lineRefClickHarness(custom, options);
  // lineRefClickHarness stubs _counterInit, which is what normally runs the
  // plugin's own idempotent runtime-state init. Reference ROWS need those maps
  // (record names, kind cache), so run the production initializer.
  h.plugin.ensureRuntimeState();
  h.plugin._isPinned = () => false;
  h.plugin._paintPinButton = () => {};
  h.plugin._ensureCardObserver = () => {};
  h.plugin._hasEmbedOpen = () => null;
  h.plugin._fillInlineRefs = async () => {};
  h.plugin._inlineRefsPersistCollapse = false;
  const host = h.document.createElement('div');
  host.className = 'listitem';
  host.setAttribute('data-guid', 'BADGE_HOST');
  const wrap = h.document.createElement('span');
  wrap.className = 'trc-refcount-badge-wrap';
  wrap.dataset.guid = targetGuid;
  host.append(wrap);
  h.root.append(host);
  return { ...h, host, wrap };
}

function badgeOwner(h, ownerGuid, targetGuid, label) {
  let reads = 0;
  h.records.set(ownerGuid, {
    guid: ownerGuid,
    getName: () => label + ' owner',
    getLineItems: async () => {
      reads++;
      return [{
        guid: 'BADGE_ROOT', parent_guid: ownerGuid, type: 'ulist',
        segments: [{ type: 'text', text: label + ' root' }],
        children: [{
          guid: targetGuid, parent_guid: 'BADGE_ROOT', type: 'ulist',
          segments: [{ type: 'text', text: label + ' target' }],
          children: [{
            guid: 'BADGE_CHILD', parent_guid: targetGuid, type: 'ulist',
            segments: [{ type: 'text', text: label + ' child' }], children: [],
          }],
        }],
      }];
    },
  });
  h.plugin._lineOwnerHints.set(targetGuid, ownerGuid);
  return () => reads;
}

test('WO-2 the real badge route is header, filters, then body', async () => {
  const h = badgeHarness('BADGE_TARGET');
  badgeOwner(h, 'BADGE_OWNER', 'BADGE_TARGET', 'Badge');

  h.plugin._routeBadgeClick(event('click', { target: h.wrap, button: 0 }), null, h.wrap);
  await tick(10);
  const section = h.document.querySelector('.refx-inline-refs');
  assert.ok(section, 'the production badge router opens the inline section');
  assert.equal(
    section.children.map((child) => child.className.split(' ')[0]).join(','),
    'refx-inline-refs-header,refx-inline-refs-filters,refx-inline-refs-body',
    'the inline surface is header, hidden filters, then rows'
  );
  const filters = section.querySelector('.refx-inline-refs-filters');
  assert.ok(filters.classList.contains('refx-hidden'), 'filters start hidden');
  assert.equal(section.querySelector('.refx-inline-refs-filter-toggle').getAttribute('aria-expanded'), 'false');
  h.plugin.onUnload();
});


test('v4.48.6 an unresolved chain owner stays explicit and never fabricates page navigation', async () => {
  const h = badgeHarness('UNKNOWN_OWNER_TARGET');
  const target = {
    guid: 'UNKNOWN_OWNER_TARGET', type: 'text', children: [],
    segments: [{ type: 'text', text: 'target' }],
  };
  const unknown = {
    guid: 'UNKNOWN_OWNER_REFERRER', type: 'text', children: [],
    segments: [
      { type: 'ref', text: { guid: target.guid, title: 'target' } },
      { type: 'text', text: ' owner unavailable' },
    ],
  };
  h.window.g_universe.itemsByGuid[target.guid] = {
    guid: target.guid, rguid: 'KNOWN_TARGET_OWNER', lineItem: target,
  };
  h.plugin._lineOwnerHints.set(target.guid, 'KNOWN_TARGET_OWNER');
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async (guid) => guid === target.guid
      ? { items: [{ lineGuid: unknown.guid, line: unknown }], complete: true }
      : { items: [], complete: true },
  };
  h.plugin.data.searchByQuery = async () => ({ records: [], lines: [] });

  const section = h.plugin._appendLazyRefChainTree(h.document.body, target.guid);
  const row = await waitFor(
    () => Array.from(section.querySelectorAll('.refx-chain-tree-row'))
      .find((candidate) => candidate.dataset.guid === unknown.guid) || null,
    { timeout: 1000 }
  );
  assert.ok(row);
  assert.equal(section.querySelector('.refx-chain-source-label').textContent, 'Other references');
  assert.equal(section.querySelector('.refx-chain-source-link'), null,
    'unknown provenance stays visibly unknown instead of inventing a clickable page');
  h.plugin.onUnload();
});

test('v4.40 a record target keeps the previous linked-references shape with no context strip', async () => {
  const h = badgeHarness('BADGE_RECORD');
  let reads = 0;
  h.records.set('BADGE_RECORD', {
    guid: 'BADGE_RECORD',
    getName: () => 'A whole page',
    getLineItems: async () => { reads++; return []; },
  });

  h.plugin._routeBadgeClick(event('click', { target: h.wrap, button: 0 }), null, h.wrap);
  await tick(10);
  const section = h.document.querySelector('.refx-inline-refs');
  assert.ok(section);
  assert.ok(section.querySelector('.refx-inline-refs-filters'), 'filters panel is present');
  assert.equal(section.querySelector('.refx-line-context-body'), null);
  assert.equal(reads, 0, 'no context hydration is attempted for a record target');
  const entry = h.plugin._inlineRefs.get('BADGE_HOST›BADGE_RECORD');
  assert.ok(entry.filtersEl, 'record targets still get the filters panel');
  h.plugin.onUnload();
});

test('WO-2 header controls keep filter toggle, sort, workbench, pin, and close', async () => {
  const h = badgeHarness('CONTROLS_TARGET');
  badgeOwner(h, 'CONTROLS_OWNER', 'CONTROLS_TARGET', 'Controls');

  h.plugin._routeBadgeClick(event('click', { target: h.wrap, button: 0 }), null, h.wrap);
  await tick(10);
  const key = 'BADGE_HOST›CONTROLS_TARGET';
  const entry = h.plugin._inlineRefs.get(key);
  assert.ok(entry?.filterToggleEl, 'the entry owns the filter toggle');
  const header = h.document.querySelector('.refx-inline-refs-header');
  assert.deepEqual(
    header.children.map((child) => child.className.split(' ')[0]),
    [
      'refx-inline-refs-title', 'refx-inline-refs-filter-toggle',
      'refx-inline-refs-sort', 'refx-inline-refs-wb', 'refx-inline-refs-pin', 'refx-inline-refs-close',
    ],
    'the header cluster is title, filter toggle, sort, workbench, pin, close'
  );
  const filters = h.document.querySelector('.refx-inline-refs-filters');
  assert.ok(filters?.querySelector('.refx-gf-note'), 'global-filter note lives in the filters panel');

  let pinToggles = 0;
  h.plugin._togglePin = () => { pinToggles++; };
  header.querySelector('.refx-inline-refs-pin').dispatchEvent(event('click', {}));
  assert.equal(pinToggles, 1, 'pin still routes to the pin handler');

  header.querySelector('.refx-inline-refs-close').dispatchEvent(event('click', {}));
  assert.equal(h.plugin._inlineRefs.has(key), false, 'close still tears the section down');
  assert.equal(h.document.querySelector('.refx-inline-refs'), null);
  h.plugin.onUnload();
});

test('v4.40 the floating popover has no Block Context strip for a record target', async () => {
  const h = badgeHarness('POPOVER_RECORD');
  h.plugin._clickAction = 'popover';
  h.records.set('POPOVER_RECORD', { guid: 'POPOVER_RECORD', getName: () => 'A page' });
  h.plugin.getOrLoadRecordName = () => 'A page';
  h.plugin.positionRefPopover = () => {};

  h.plugin._routeBadgeClick(event('click', { target: h.wrap, button: 0 }), null, h.wrap);
  await tick(10);
  const pop = h.document.querySelector('.trc-ref-popover');
  assert.ok(pop);
  assert.equal(pop.querySelector('.trc-ref-popover-context'), null);
  assert.equal(pop.querySelector('.refx-line-context-body'), null);
  h.plugin.onUnload();
});

test('A2 real onLoad command opens keyboard CRUD modal for the active record', async () => {
  const h = loadHarness();
  const rec = { guid: 'REC_MODAL', getGuid: () => 'REC_MODAL', getName: () => 'Modal Target', getLineItems: async () => [] };
  h.records.set(rec.guid, rec);
  h.plugin.ui.getActivePanel = () => ({ getActiveRecord: () => rec, getElement: () => null });
  h.plugin.ui.getPanels = () => [];
  h.plugin.getConfiguration = () => ({ custom: { aliasChips: false } });
  for (const name of ['_beginAutoTitleGeneration', '_injectStyle', '_ensureThemeObserver', '_counterInit', '_rehydrate', '_wbLiveInit', '_r6MigrateExistingPins', '_scheduleRecordNameIndex', '_r4RegisterCommands', '_r10Init', '_wbSyncStatusIcon']) h.plugin[name] = () => {};
  h.plugin._buildFieldTypes = async () => {};
  h.plugin.onLoad();

  const replace = (texts) => h.plugin._aliasReplaceRecordSet(rec.guid, texts.map((text) => h.plugin._aliasMakeItem(text, 'registry')));
  h.plugin._aliasAdd = async (_guid, text) => { replace([...(h.plugin._aliasGet(rec.guid)?.aliases || []).map((x) => x.text), text]); return { ok: true }; };
  h.plugin._aliasRemove = async (_guid, text) => { replace((h.plugin._aliasGet(rec.guid)?.aliases || []).map((x) => x.text).filter((x) => x !== text)); return { ok: true }; };
  h.plugin._aliasRename = async (_guid, oldText, newText) => { replace((h.plugin._aliasGet(rec.guid)?.aliases || []).map((x) => x.text === oldText ? newText : x)); return { ok: true }; };
  const propagationOffers = [];
  h.plugin._aliasOpenRenamePropagationModal = (...args) => propagationOffers.push(args);
  h.storage.set('refx_alias_rename_receipts_v1_WS_A2', JSON.stringify([{
    v: 1, id: 'RECOVERY', op: 'propagate-alias-rename', oldText: 'Earlier', newText: 'Later',
    applied: [{ lineGuid: 'LINE', sourceRecordGuid: 'SOURCE' }], skipped: [],
  }]));

  const command = h.commands.find((item) => item.label === 'RefX: Aliases for this record…');
  assert.ok(command, 'production onLoad must register the manage command');
  command.onSelected();
  assert.ok(h.document.querySelector('.refx-alias-manage'));
  assert.equal(h.document.querySelectorAll('button').some((button) => button.textContent === 'Undo reference update'), true, 'persisted receipt must remain reachable after reopening aliases');

  let input = h.document.querySelector('.refx-alias-add-input');
  input.value = 'First alias'; input.dispatchEvent(event('keydown', { key: 'Enter' }));
  await tick();
  assert.equal(h.document.querySelector('.refx-alias-manage-text').textContent, 'First alias');

  let rename = h.document.querySelectorAll('button').find((button) => button.textContent === 'Rename');
  rename.click();
  input = h.document.querySelector('.refx-alias-rename'); input.value = 'Renamed alias';
  input.dispatchEvent(event('keydown', { key: 'Enter' })); await tick();
  assert.equal(h.document.querySelector('.refx-alias-manage-text').textContent, 'Renamed alias');
  assert.deepEqual(propagationOffers, [['REC_MODAL', 'First alias', 'Renamed alias']], 'successful UI rename must offer explicit propagation');

  const remove = h.document.querySelectorAll('button').find((button) => button.textContent === 'Remove');
  remove.click(); await tick();
  assert.equal(h.document.querySelector('.refx-alias-manage-text'), null);
  h.plugin.onUnload();
});

test('L3 line command opens keyboard CRUD manager and rename offers guarded propagation', async () => {
  const h = loadHarness();
  h.plugin._caretInfo = () => ({ lineGuid: 'LINE_MODAL', pageGuid: 'OWNER_MODAL' });
  h.plugin._lineTextByGuid = () => 'Current line text';
  h.plugin.ui.getPanels = () => [];
  h.plugin.getConfiguration = () => ({ custom: { aliasChips: false } });
  for (const name of ['_beginAutoTitleGeneration', '_injectStyle', '_ensureThemeObserver', '_counterInit', '_rehydrate', '_wbLiveInit', '_r6MigrateExistingPins', '_scheduleRecordNameIndex', '_r4RegisterCommands', '_r10Init', '_wbSyncStatusIcon']) h.plugin[name] = () => {};
  h.plugin._buildFieldTypes = async () => {};
  h.plugin.onLoad();

  const replace = (texts) => h.plugin._lineAliasReplaceSet('LINE_MODAL', {
    recordGuid: 'OWNER_MODAL', currentText: 'Current line text', status: 'active',
    aliases: texts.map((text) => h.plugin._lineAliasMakeItem(text)),
  });
  h.plugin._lineAliasAdd = async (_guid, text) => { replace([...(h.plugin._lineAliasGet('LINE_MODAL')?.aliases || []).map((item) => item.text), text]); return { ok: true }; };
  h.plugin._lineAliasRemove = async (_guid, text) => { replace((h.plugin._lineAliasGet('LINE_MODAL')?.aliases || []).map((item) => item.text).filter((value) => value !== text)); return { ok: true }; };
  h.plugin._lineAliasRename = async (_guid, oldText, newText) => { replace((h.plugin._lineAliasGet('LINE_MODAL')?.aliases || []).map((item) => item.text === oldText ? newText : item.text)); return { ok: true }; };
  const propagationOffers = [];
  h.plugin._aliasOpenRenamePropagationModal = (...args) => propagationOffers.push(args);

  const command = h.commands.find((item) => item.label === 'RefX: Aliases for this line…');
  assert.ok(command);
  command.onSelected();
  assert.ok(h.document.querySelector('.refx-line-alias-manage'));
  assert.match(h.document.querySelector('.refx-line-alias-current').textContent, /Current line text/);

  let input = h.document.querySelector('.refx-alias-add-input');
  input.value = 'Short claim'; input.dispatchEvent(event('keydown', { key: 'Enter' }));
  await tick();
  assert.equal(h.document.querySelector('.refx-alias-manage-text').textContent, 'Short claim');

  h.document.querySelectorAll('button').find((button) => button.textContent === 'Rename').click();
  input = h.document.querySelector('.refx-alias-rename'); input.value = 'Renamed claim';
  input.dispatchEvent(event('keydown', { key: 'Enter' })); await tick();
  assert.equal(h.document.querySelector('.refx-alias-manage-text').textContent, 'Renamed claim');
  assert.deepEqual(propagationOffers, [['LINE_MODAL', 'Short claim', 'Renamed claim']]);

  h.document.querySelectorAll('button').find((button) => button.textContent === 'Remove').click();
  await tick();
  assert.equal(h.document.querySelector('.refx-alias-manage-text'), null);
  h.plugin.onUnload();
});

test('A5 rename propagation modal mounts the real preview, apply, and undo path', async () => {
  const h = loadHarness();
  h.plugin._aliasInit();
  const line = {
    guid: 'LINE_A5_MODAL',
    segments: [{ type: 'ref', text: { guid: 'TARGET_A5', title: 'Old alias', viewId: 'VIEW_A5' } }],
    async setSegments(next) { this.segments = next; return true; },
  };
  h.records.set('SOURCE_A5', { guid: 'SOURCE_A5', getName: () => 'Source A5', getLineItems: async () => [line] });
  h.plugin._recordNameIndex.set('SOURCE_A5', 'Source A5');
  h.plugin._referenceSurfaceBroker = {
    snapshot: () => ({ status: 'complete' }),
    inEdges: () => [{
      id: 'ref:v1:LINE_A5_MODAL:0:TARGET_A5', kind: 'ref', title: 'Old alias',
      source: { lineGuid: line.guid, recordGuid: 'SOURCE_A5', segmentOrdinal: 0 },
      target: { kind: 'record', guid: 'TARGET_A5' },
    }],
  };
  h.plugin._resolveLiveLine = async (guid) => guid === line.guid ? line : null;

  h.plugin._aliasOpenRenamePropagationModal('TARGET_A5', 'Old alias', 'New alias');
  await tick(5);
  assert.ok(h.document.querySelector('.refx-alias-rename-propagation'), 'real propagation dialog must mount');
  let action = h.document.querySelectorAll('button').find((button) => button.textContent === 'Update 1 reference');
  assert.ok(action, 'broker-indexed preview must reach the live apply button');
  action.click(); await tick(5);
  assert.equal(line.segments[0].text.title, 'New alias');
  assert.equal(line.segments[0].text.viewId, 'VIEW_A5');

  action = h.document.querySelectorAll('button').find((button) => button.textContent === 'Undo updated references');
  assert.ok(action, 'applied receipt must mount an undo action');
  action.click(); await tick(5);
  assert.equal(line.segments[0].text.title, 'Old alias');
  assert.equal(h.document.querySelectorAll('button').some((button) => button.textContent === 'Undo complete'), true);
  h.plugin._closeModal();
});

test('A6 frequent-use suggestion mounts in the real manager and writes only after Add', async () => {
  const h = loadHarness();
  h.plugin._aliasInit();
  const rec = { guid: 'REC_FREQUENT', getGuid: () => 'REC_FREQUENT', getName: () => 'Canonical Target', getLineItems: async () => [] };
  h.records.set(rec.guid, rec);
  h.plugin._aliasFrequentSuggestions.set(rec.guid, Object.freeze({
    recordGuid: rec.guid, query: 'Common shorthand', normalized: 'common shorthand', realTitle: 'Canonical Target', count: 4,
  }));
  const writes = [];
  h.plugin._aliasAdd = async (guid, text) => {
    writes.push([guid, text]);
    h.plugin._aliasReplaceRecordSet(guid, [h.plugin._aliasMakeItem(text, 'registry')]);
    return { ok: true };
  };

  h.plugin._aliasOpenManageModal(rec.guid);
  const suggestion = h.document.querySelector('.refx-alias-frequent');
  assert.ok(suggestion, 'the production management modal must mount the suggestion');
  assert.ok(suggestion.textContent.includes('Frequently used: “Common shorthand” — add as alias?'));
  assert.deepEqual(writes, [], 'mounting and learning must remain read-only');

  const add = suggestion.querySelectorAll('button').find((button) => button.textContent === 'Add');
  assert.ok(add, 'the suggestion must expose an explicit Add action');
  add.click(); await tick();
  assert.deepEqual(writes, [['REC_FREQUENT', 'Common shorthand']]);
  assert.equal(h.plugin._aliasGet(rec.guid).aliases[0].text, 'Common shorthand');
  h.plugin._closeModal();
});

test('A2 picker Option+A uses physical KeyA on macOS even when e.key is å', () => {
  const h = loadHarness();
  h.plugin._aliasInit();
  const link = {
    kind: 'record', query: 'Short name', resultsQuery: 'Short name', searchTimer: null,
    results: [{ guid: 'REC_TARGET', text: 'Long Canonical Record' }], resultsPreSliceCount: 1,
    sel: 0, userSelected: true, br: '[[', closingPair: null,
  };
  h.plugin._link = link;
  let opened = null;
  h.plugin._openAliasPromptInPicker = (activeLink, result) => { opened = [activeLink, result]; };
  const key = event('keydown', {
    key: 'å', code: 'KeyA', metaKey: false, ctrlKey: false, altKey: true, shiftKey: false,
  });
  h.plugin._linkKey(key);
  assert.equal(key.defaultPrevented, true);
  assert.equal(key.immediatePropagationStopped, true);
  assert.equal(opened[0], link);
  assert.equal(opened[1].guid, 'REC_TARGET');
});

test('v4.10.0 picker suppresses result re-render while alias prompt or write is active', () => {
  const h = loadHarness();
  const list = h.document.createElement('div');
  const prompt = h.document.createElement('div'); prompt.className = 'refx-alias-prompt'; list.append(prompt);
  h.document.body.append(list);
  h.plugin._link = {
    kind: 'record', query: 'Canonical', resultsQuery: 'Canonical', searchTimer: null,
    results: [{ guid: 'REC_SUPPRESS', text: 'Canonical' }], resultsPreSliceCount: 1,
    sel: 0, userSelected: true, list,
  };
  const promptKey = event('keydown', { key: 'x', code: 'KeyX', altKey: false, metaKey: false, ctrlKey: false });
  h.plugin._linkKey(promptKey);
  assert.equal(h.plugin._link.query, 'Canonical', 'window-capture picker handler must yield to the focused prompt input');
  assert.equal(promptKey.defaultPrevented, false);
  h.plugin._renderLink();
  assert.equal(list.querySelector('.refx-alias-prompt'), prompt, 'open prompt must survive render');
  prompt.remove();
  const sentinel = h.document.createElement('div'); sentinel.className = 'sentinel'; list.append(sentinel);
  h.plugin._link.aliasCreating = true;
  h.plugin._renderLink();
  assert.equal(list.querySelector('.sentinel'), sentinel, 'alias-write lock must suppress innerHTML clearing');
});

test('v4.10.0 Option+A create row creates the page first and then opens its alias prompt', async () => {
  const h = loadHarness();
  const link = {
    kind: 'record', query: 'Brand New', resultsQuery: 'Brand New', searchTimer: null,
    results: [], sel: 0, userSelected: false,
  };
  h.plugin._link = link;
  let createArgs = null;
  h.plugin._createPageFromPicker = async (...args) => {
    createArgs = args;
    return { guid: 'NEW_PAGE', text: 'Brand New', created: true };
  };
  let opened = null;
  h.plugin._openAliasPromptInPicker = (...args) => { opened = args; };
  const key = event('keydown', { key: 'a', code: 'KeyA', altKey: true, metaKey: false, ctrlKey: false });
  h.plugin._linkKey(key);
  await tick();
  assert.equal(createArgs[0], 'Brand New');
  assert.equal(createArgs[1].deferPick, true);
  assert.equal(opened[0], link);
  assert.equal(opened[1].guid, 'NEW_PAGE');
});

test('v4.10.0 deferred picker creation returns the new record without consuming the bracket text', async () => {
  const h = loadHarness();
  h.plugin._link = {
    kind: 'record', query: 'Brand New', token: 0, results: [], creating: false, synthetic: true,
  };
  h.plugin._renderLink = () => {};
  h.plugin._findExactPageForCreate = async () => null;
  h.plugin._pageCreateCollection = async () => ({ createRecord: (name) => name === 'Brand New' ? 'NEW_DEFERRED' : null });
  h.plugin._pickLink = () => assert.fail('deferred page creation must leave insertion for the alias prompt');
  const created = await h.plugin._createPageFromPicker('Brand New', { deferPick: true });
  assert.equal(created.guid, 'NEW_DEFERRED');
  assert.equal(created.text, 'Brand New');
  assert.equal(h.plugin._link.creating, false);
});

test('v4.10.0 Option+A on a line picker without a target explains what to highlight', () => {
  const h = loadHarness();
  h.plugin._link = { kind: 'line', query: 'missing', resultsQuery: 'missing', searchTimer: null, results: [], sel: 0 };
  let toast = '';
  h.plugin._toast = (message) => { toast = message; };
  h.plugin._linkKey(event('keydown', { key: 'a', code: 'KeyA', altKey: true, metaKey: false, ctrlKey: false }));
  assert.equal(toast, 'Highlight a line to alias it.');
});

test('v4.10.0 Option+A flushes a pending search before resolving the highlighted result', () => {
  const h = loadHarness();
  const link = {
    kind: 'record', query: 'Fresh', resultsQuery: null,
    searchTimer: setTimeout(() => assert.fail('debounced search should be cancelled'), 1000),
    results: [{ guid: 'STALE', text: 'Stale' }], sel: 0, userSelected: true,
  };
  h.plugin._link = link;
  let searched = '';
  h.plugin._runLinkSearch = (query) => {
    searched = query;
    link.results = [{ guid: 'FRESH', text: 'Fresh' }];
    link.resultsQuery = query;
    link.sel = 0;
  };
  let opened = null;
  h.plugin._openAliasPromptInPicker = (_link, result) => { opened = result; };
  h.plugin._linkKey(event('keydown', { key: 'a', code: 'KeyA', altKey: true, metaKey: false, ctrlKey: false }));
  assert.equal(searched, 'Fresh');
  assert.equal(link.searchTimer, null);
  assert.equal(opened.guid, 'FRESH');
});

test('v4.10.0 alias write lock clears on success, !ok, rejection, stale picker, and prompt cancel', async () => {
  for (const outcome of ['success', 'not-ok', 'reject', 'stale']) {
    const h = loadHarness();
    const link = { kind: 'record', query: 'Alias', resultsQuery: 'Alias', results: [], token: 0 };
    h.plugin._link = link;
    h.plugin._renderLink = () => {};
    h.plugin._pickLink = async () => true;
    let resolveWrite;
    if (outcome === 'success') h.plugin._aliasAdd = async () => ({ ok: true });
    if (outcome === 'not-ok') h.plugin._aliasAdd = async () => ({ ok: false, error: 'nope' });
    if (outcome === 'reject') h.plugin._aliasAdd = async () => { throw new Error('boom'); };
    if (outcome === 'stale') h.plugin._aliasAdd = () => new Promise((resolve) => { resolveWrite = resolve; });
    const pending = h.plugin._aliasPickFromPicker(link, {
      result: { guid: 'REC_WRITE', text: 'Canonical' }, query: 'Alias', kind: 'record', selected: 0,
    });
    if (outcome === 'stale') { h.plugin._link = null; resolveWrite({ ok: true }); }
    await pending;
    assert.equal(link.aliasCreating, false, outcome + ' must release aliasCreating');
    assert.equal(link.aliasCreatingTimer, null, outcome + ' must clear the safety timer');
  }

  const h = loadHarness();
  const list = h.document.createElement('div');
  const row = h.document.createElement('div'); row.className = 'refalias-result refalias-result-sel'; list.append(row);
  h.document.body.append(list);
  const link = {
    kind: 'record', query: 'Alias', resultsQuery: 'Alias', searchTimer: null,
    results: [{ guid: 'REC_CANCEL', text: 'Canonical' }], sel: 0, userSelected: true, list, token: 0,
  };
  h.plugin._link = link;
  h.plugin._openAliasPromptInPicker(link, link.results[0]);
  list.querySelector('.refx-alias-prompt-input').dispatchEvent(event('keydown', { key: 'Escape' }));
  assert.equal(link.aliasCreating, false);
  assert.equal(list.querySelector('.refx-alias-prompt'), null);
  assert.ok(source.includes('}, 4000);'), 'alias write must retain the 4-second safety timeout');
});

test('v4.10.0 both picker alias-create flows announce successful persistence', async () => {
  const h = loadHarness();
  const messages = [];
  h.plugin._toast = (message) => messages.push(message);
  h.plugin._renderLink = () => {};
  h.plugin._aliasAdd = async () => ({ ok: true });
  h.plugin._pickLink = async () => true;
  const link = { kind: 'record', query: 'Lorinator', resultsQuery: 'Lorinator', results: [], token: 0 };
  h.plugin._link = link;
  await h.plugin._aliasPickFromPicker(link, {
    result: { guid: 'REC_LORI', text: 'Lori Boyd', realTitle: 'Lori Boyd' },
    query: 'Lorinator', kind: 'record', selected: 0,
  });
  assert.equal(messages.pop(), 'Alias "Lorinator" added to Lori Boyd');

  const list = h.document.createElement('div');
  const row = h.document.createElement('div'); row.className = 'refalias-result refalias-result-sel'; list.append(row);
  h.document.body.append(list);
  const promptLink = {
    kind: 'record', query: 'lori', resultsQuery: 'lori', searchTimer: null,
    results: [{ guid: 'REC_LORI', text: 'Lori Boyd' }], sel: 0, userSelected: true, list, token: 0,
  };
  h.plugin._link = promptLink;
  h.plugin._openAliasPromptInPicker(promptLink, promptLink.results[0]);
  const input = list.querySelector('.refx-alias-prompt-input');
  input.value = 'lori';
  input.dispatchEvent(event('keydown', { key: 'Enter' }));
  await tick();
  assert.equal(messages.pop(), 'Alias "lori" added to Lori Boyd');
});

test('v4.10.0 picker action hint is platform-aware and footer keeps platform preview modifier', () => {
  const renderHint = (isMac) => {
    const h = loadHarness();
    h.plugin._isMac = isMac;
    h.plugin._positionPopover = () => {};
    h.plugin._renderLink = () => {};
    h.plugin._runLinkSearch = () => {};
    h.plugin._prewarmLineSearchCache = () => {};
    h.plugin._enterLinkMode({ lineGuid: 'LINE', pageGuid: 'PAGE', offset: 2, synthetic: true }, 'record');
    return {
      hint: h.document.querySelector('.refx-link-action-hint').textContent,
      footer: h.document.querySelector('.refalias-linkfoot-hints').textContent,
    };
  };
  assert.deepEqual(renderHint(true), {
    hint: '⌥A alias · ⌥↓ pick alias · ⇥/> drill · ⇧⇥ back · ⌃O preview · ↵ insert',
    footer: 'Preview Cmd-O  Drill Tab  Insert ⏎',
  });
  assert.deepEqual(renderHint(false), {
    hint: 'Alt+A alias · Alt+↓ pick alias · ⇥/> drill · ⇧⇥ back · ⌃O preview · ↵ insert',
    footer: 'Preview Ctrl-O  Drill Tab  Insert ⏎',
  });
});

test('v4.10.0 picker scroll/resize anchoring is rAF-throttled and centrally detached', () => {
  const h = loadHarness();
  const adds = [], removes = [], frames = [];
  const add = h.window.addEventListener;
  const remove = h.window.removeEventListener;
  h.window.addEventListener = (type, fn, capture) => { adds.push([type, fn, capture]); add(type, fn, capture); };
  h.window.removeEventListener = (type, fn, capture) => { removes.push([type, fn, capture]); remove(type, fn, capture); };
  h.context.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  h.context.cancelAnimationFrame = () => {};
  let positions = 0;
  h.plugin._positionPopover = () => { positions++; };
  h.plugin._renderLink = () => {};
  h.plugin._runLinkSearch = () => {};
  h.plugin._prewarmLineSearchCache = () => {};
  h.plugin._enterLinkMode({ lineGuid: 'LINE', pageGuid: 'PAGE', offset: 2, synthetic: true }, 'record');
  const scroll = adds.find(([type]) => type === 'scroll');
  const resize = adds.find(([type]) => type === 'resize');
  assert.ok(scroll && scroll[2] === true, 'capture scroll listener catches inner panel scrollers');
  assert.ok(resize);
  scroll[1](); scroll[1](); resize[1]();
  assert.equal(frames.length, 1, 'scroll bursts schedule one positioning frame');
  assert.equal(positions, 1, 'only initial position runs before the queued frame');
  frames.shift()();
  assert.equal(positions, 2);
  h.plugin._exitLinkMode();
  assert.ok(removes.some(([type, fn, capture]) => type === 'scroll' && fn === scroll[1] && capture === true));
  assert.ok(removes.some(([type, fn]) => type === 'resize' && fn === resize[1]));
  assert.equal(h.window.__refxLinkPosition, null);
});

test('v4.10.0 picker exit paths and hot reload share listener cleanup', async () => {
  const h = loadHarness();
  const removed = [];
  const remove = h.window.removeEventListener;
  h.window.removeEventListener = (type, fn, capture) => { removed.push([type, fn, capture]); remove(type, fn, capture); };
  h.plugin._positionPopover = () => {};
  h.plugin._renderLink = () => {};
  h.plugin._runLinkSearch = () => {};
  h.plugin._prewarmLineSearchCache = () => {};
  const open = () => h.plugin._enterLinkMode({ lineGuid: 'LINE', pageGuid: 'PAGE', offset: 2, synthetic: true }, 'record');

  open();
  await h.plugin._abortLink();
  assert.ok(removed.some(([type]) => type === 'scroll'), 'Esc/abort removes positioning listener');

  removed.length = 0; open();
  h.plugin._pendingConnect = { targetGuid: 'TARGET' };
  h.plugin._connectRecords = async () => {};
  h.plugin._pickerMarkRecordLive('PICKED', true);
  await h.plugin._pickLink({ guid: 'PICKED', text: 'Picked' });
  assert.ok(removed.some(([type]) => type === 'scroll'), 'pick/insert removes positioning listener');

  let staleScroll = () => {};
  h.window.__refxLinkPosition = { handler: staleScroll, raf: 0 };
  removed.length = 0;
  // Source guard covers the plugin-unload route, which calls the same central exit.
  assert.match(source.slice(source.indexOf('  onUnload()'), source.indexOf('\n  _killStaleObservers()', source.indexOf('  onUnload()'))), /this\._exitLinkMode\(\)/);
  assert.match(source.slice(source.indexOf('  _killStaleObservers()'), source.indexOf('\n  _startObserver()', source.indexOf('  _killStaleObservers()'))), /__refxLinkPosition/);
});

test('v4.13.1 compact menu CSS preserves dense rows and menu structure tokens', () => {
  assert.match(source, /\.refx-refmenu \.refalias-results,\s*\.refx-submenu \.refalias-results,\s*\.refx-linemenu \.refalias-results \{ gap: 0; padding: 5px; \}/);
  assert.match(source, /\.refx-refmenu \.refalias-result,\s*\.refx-submenu \.refalias-result,\s*\.refx-linemenu \.refalias-result \{[^}]*padding: 5px 9px;[^}]*line-height: 16px;/);
  assert.match(source, /\.refx-refmenu \{ min-width: 240px;/);
  assert.match(source, /\.refx-linemenu \{ min-width: 256px; \}/);
  assert.match(source, /\.refx-refmenu \.refx-menu-divider,\s*\.refx-submenu \.refx-menu-divider,\s*\.refx-linemenu \.refx-menu-divider \{/);
});

test('v4.10.0 highlighted result renders deduped alias chips directly below and chip click picks display title', () => {
  const h = loadHarness();
  h.plugin._aliasInit();
  h.plugin._aliasReplaceRecordSet('REC_CHIPS', [
    h.plugin._aliasMakeItem('First alias', 'registry'),
    h.plugin._aliasMakeItem('first alias', 'registry'),
    h.plugin._aliasMakeItem('Second alias', 'registry'),
  ]);
  const list = h.document.createElement('div'); h.document.body.append(list);
  const result = { guid: 'REC_CHIPS', text: 'Canonical' };
  h.plugin._link = {
    kind: 'record', query: 'Canonical', resultsQuery: 'Canonical', searchTimer: null,
    results: [result], resultsPreSliceCount: 1, sel: 0, userSelected: true, list,
  };
  h.plugin._updateLinkPreviewPane = () => {};
  let picked = null;
  h.plugin._pickLink = (...args) => { picked = args; };
  h.plugin._renderLink();
  const row = list.querySelector('.refalias-result');
  const chooser = list.querySelector('.refx-alias-choose');
  assert.equal(row.nextSibling, chooser, 'chooser must be immediately below the highlighted row');
  assert.equal(chooser.querySelectorAll('.refx-alias-chip').length, 2, 'aliases must be normalized and deduped');
  chooser.querySelectorAll('.refx-alias-chip')[1].click();
  assert.equal(picked[0], result);
  assert.equal(picked[1].displayTitle, 'Second alias');
});

test('v4.10.0 chip × and choose-mode Alt+Backspace remove aliases and refresh in place', async () => {
  const h = loadHarness();
  h.plugin._aliasInit();
  const result = { guid: 'REC_DELETE_CHIP', text: 'Canonical' };
  const replace = (aliases) => h.plugin._aliasReplaceRecordSet(result.guid,
    aliases.map((text) => h.plugin._aliasMakeItem(text, 'registry')));
  replace(['First alias', 'Second alias']);
  const list = h.document.createElement('div'); h.document.body.append(list);
  const link = {
    kind: 'record', query: 'Canonical', resultsQuery: 'Canonical', searchTimer: null,
    results: [result], resultsPreSliceCount: 1, sel: 0, userSelected: true, list,
  };
  h.plugin._link = link;
  h.plugin._updateLinkPreviewPane = () => {};
  const removed = [], searched = [], messages = [];
  h.plugin._aliasRemove = async (_guid, aliasText) => {
    removed.push(aliasText);
    replace(h.plugin._linkAliasesForResult(link, result).filter((text) => text !== aliasText));
    return { ok: true };
  };
  h.plugin._runLinkSearch = async (query) => { searched.push(query); };
  h.plugin._toast = (message) => messages.push(message);
  h.plugin._pickLink = () => assert.fail('remove affordance must never insert the alias');
  h.plugin._renderLink();
  const remove = list.querySelectorAll('.refx-alias-chip-remove')[0];
  remove.dispatchEvent(event('mousedown'));
  remove.click();
  await tick();
  assert.deepEqual(removed, ['First alias']);
  assert.deepEqual(searched, ['Canonical']);
  assert.equal(messages[0], 'Removed alias "First alias"');

  replace(['Second alias', 'Third alias']);
  link.aliasChoose = { resultGuid: result.guid, active: 0, aliases: ['Second alias', 'Third alias'] };
  h.plugin._linkKey(event('keydown', { key: 'Backspace', altKey: true, metaKey: false, ctrlKey: false }));
  await tick();
  assert.deepEqual(removed, ['First alias', 'Second alias']);
  assert.deepEqual([...link.aliasChoose.aliases], ['Third alias'], 'choose-mode stays open on remaining aliases');
  assert.ok(h.document.activeElement?.classList.contains('is-active'), 'remaining active chip keeps keyboard focus');
  h.plugin._linkKey(event('keydown', { key: 'Backspace', altKey: true, metaKey: false, ctrlKey: false }));
  await tick();
  assert.equal(link.aliasChoose, null, 'choose-mode exits only when no aliases remain');
  assert.deepEqual(removed, ['First alias', 'Second alias', 'Third alias']);
  assert.deepEqual(searched, ['Canonical', 'Canonical', 'Canonical']);
});

test('v4.10.0 alias-result Alt+Backspace removes its alias and re-runs search', async () => {
  const h = loadHarness();
  const result = { guid: 'REC_DELETE_ROW', text: 'Lorinator', aliasText: 'Lorinator', matchKind: 'alias', realTitle: 'Lori Boyd' };
  const link = {
    kind: 'record', query: 'Lorinator', resultsQuery: 'Lorinator', searchTimer: null,
    results: [result], sel: 0, userSelected: true,
  };
  h.plugin._link = link;
  let removed = null, searched = null;
  h.plugin._aliasRemove = async (guid, aliasText) => { removed = [guid, aliasText]; return { ok: true }; };
  h.plugin._linkAliasesForResult = () => [];
  h.plugin._runLinkSearch = async (query) => { searched = query; };
  h.plugin._renderLink = () => {};
  const key = event('keydown', { key: 'Backspace', altKey: true, metaKey: false, ctrlKey: false });
  h.plugin._linkKey(key);
  await tick();
  assert.deepEqual(removed, ['REC_DELETE_ROW', 'Lorinator']);
  assert.equal(searched, 'Lorinator');
  assert.equal(key.defaultPrevented, true);
});

test('v4.10.0 zero aliases renders no chooser and Alt+Down + Enter picks the active alias', () => {
  const h = loadHarness();
  h.plugin._aliasInit();
  const list = h.document.createElement('div'); h.document.body.append(list);
  const result = { guid: 'REC_KEY_CHIPS', text: 'Canonical' };
  h.plugin._link = {
    kind: 'record', query: 'Canonical', resultsQuery: 'Canonical', searchTimer: null,
    results: [result], resultsPreSliceCount: 1, sel: 0, userSelected: true, list,
  };
  h.plugin._updateLinkPreviewPane = () => {};
  h.plugin._renderLink();
  assert.equal(list.querySelector('.refx-alias-choose'), null);

  h.plugin._aliasReplaceRecordSet(result.guid, [h.plugin._aliasMakeItem('Keyboard alias', 'registry')]);
  let picked = null;
  h.plugin._pickLink = (...args) => { picked = args; };
  const down = event('keydown', { key: 'ArrowDown', altKey: true, metaKey: false, ctrlKey: false });
  h.plugin._linkKey(down);
  assert.equal(h.plugin._link.aliasChoose.active, 0);
  assert.ok(list.querySelector('.refx-alias-chip').classList.contains('is-active'));
  h.plugin._linkKey(event('keydown', { key: 'Enter', altKey: false, metaKey: false, ctrlKey: false }));
  assert.equal(picked[0], result);
  assert.equal(picked[1].displayTitle, 'Keyboard alias');
});

function refMenuFixture(h, { openEmbed = true } = {}) {
  const anchor = h.document.createElement('div'); h.document.body.append(anchor);
  const r = {
    targetGuid: 'TARGET_MENU', lineGuid: 'HOST_MENU', pageGuid: 'PAGE_MENU',
    current: 'Alias title', fallback: 'Target title', isText: true,
    li: {}, segs: [{ type: 'ref', text: { guid: 'TARGET_MENU', title: 'Alias title' } }], refIdx: 0,
  };
  const calls = [];
  h.plugin._findEmbeds = () => openEmbed ? [{ props: { refx_variant: 'full' } }] : [];
  h.plugin._bridgeJump = (guid, opts) => calls.push(['jump', guid, !!opts?.newPanel]);
  h.plugin._wbAdd = (guid, opts) => calls.push(['workbench', guid, opts?.kind || 'reference']);
  h.plugin._openLinkedRefs = () => calls.push(['linked']);
  h.plugin._menuExpand = () => calls.push(['expand']);
  h.plugin._setEmbedVariant = (_embeds, variant) => calls.push(['variant', variant]);
  h.plugin._replaceWithText = () => calls.push(['replace', 'text']);
  h.plugin._replaceWithAlias = () => calls.push(['replace', 'alias']);
  h.plugin._replaceWithTextAndAlias = () => calls.push(['replace', 'text-alias']);
  h.plugin._replaceWithEmbed = (_r, variant) => calls.push(['replace', 'embed', variant || 'full']);
  h.plugin._replaceWithOriginal = (_r, bringChildren) => calls.push(['replace', 'original', bringChildren !== false]);
  h.plugin._applyChildren = (_r, refs) => calls.push(['children', refs ? 'references' : 'text']);
  h.plugin._openAliasModal = () => calls.push(['alias', 'set']);
  h.plugin._lineAliasOpenManageModal = () => calls.push(['alias', 'manage']);
  h.plugin._aliasOpenFinderForTarget = () => calls.push(['alias', 'finder']);
  h.plugin._copyRefTarget = () => calls.push(['copy', 'reference']);
  h.plugin._pasteRef = () => calls.push(['paste', 'reference']);
  h.plugin._delinkRef = (_r, keep) => calls.push(['delete', keep ? 'keep' : 'all']);
  h.plugin._lineTextByGuid = () => 'Target title';
  h.plugin._caretInfo = () => ({ lineGuid: 'HOST_MENU', pageGuid: 'PAGE_MENU', offset: 0 });
  h.plugin._liveStateByGuid = () => null;
  h.plugin._findLineDeep = () => ({ segments: [{ type: 'text', text: 'body' }], setSegments: () => calls.push(['paste', 'text']) });
  h.records.set('PAGE_MENU', { getLineItems: async () => [] });
  h.plugin._bridgeCreateEmbed = async () => { calls.push(['paste', 'transclusion']); return true; };
  h.plugin._toast = (message) => calls.push(['toast', message]);
  return { anchor, r, calls };
}

function topMenuRows(h) {
  const pop = h.document.querySelector('.refx-refmenu');
  const list = pop?.querySelector('.refalias-results');
  return [...(list?.children || [])].filter((row) => row.classList.contains('refalias-result'));
}

function rowLabel(row) { return row?.querySelector?.('.refalias-result-text')?.textContent || ''; }

function activateTop(h, label) {
  const row = topMenuRows(h).find((candidate) => rowLabel(candidate) === label);
  assert.ok(row, 'top-level row exists: ' + label);
  row.dispatchEvent(event('mousedown'));
  return row;
}

function activateFlyout(h, topLabel, childLabel) {
  activateTop(h, topLabel);
  const submenu = h.document.querySelector('.refx-submenu');
  assert.ok(submenu, 'submenu opens for ' + topLabel);
  const child = [...submenu.querySelectorAll('.refalias-result')].find((row) => rowLabel(row) === childLabel);
  assert.ok(child, topLabel + ' contains ' + childLabel);
  child.dispatchEvent(event('mousedown'));
}

function activateNestedFlyout(h, topLabel, childLabels) {
  activateTop(h, topLabel);
  for (const childLabel of childLabels) {
    const submenus = [...h.document.querySelectorAll('.refx-submenu')];
    const submenu = submenus[submenus.length - 1];
    assert.ok(submenu, 'submenu opens for ' + topLabel);
    const child = [...submenu.querySelectorAll('.refalias-result')].find((row) => rowLabel(row) === childLabel);
    assert.ok(child, topLabel + ' contains ' + childLabel);
    child.dispatchEvent(event('mousedown'));
  }
}

test('v4.29 Roam menu promotes common actions and preserves every grouped action', async () => {
  const h = loadHarness();
  const fx = refMenuFixture(h, { openEmbed: true });
  const open = () => h.plugin._openRefMenu(fx.r, fx.anchor);
  open();
  // WO-18 adds "Show path to…". U6 adds one sibling chain-expansion flyout to the
  // prior compact menu. At this row height the menu remains usable without pushing
  // common actions off-screen.
  assert.equal(topMenuRows(h).length, 16, 'open-embed menu stays within its justified compact viewport budget');
  assert.equal(h.document.querySelector('.refx-menu-section-head'), null, 'headed flat sections are removed');
  for (const label of ['Jump to block', 'Open in side panel', 'Open linked references', 'Copy this reference', 'Remove reference']) {
    assert.ok(topMenuRows(h).some((candidate) => rowLabel(candidate) === label), 'promoted row exists: ' + label);
  }
  assert.equal(topMenuRows(h).some((candidate) => rowLabel(candidate) === 'Open in sidebar'), false);
  const jumpRow = topMenuRows(h).find((row) => rowLabel(row) === 'Jump to block');
  assert.equal(jumpRow.children[1].textContent, 'double-click', 'line-ref jump row advertises the mouse shortcut');
  h.plugin._openRefMenu({ ...fx.r, isText: false }, fx.anchor);
  const pageJumpRow = topMenuRows(h).find((row) => rowLabel(row) === 'Jump to block');
  assert.equal(pageJumpRow.children[1].textContent, '⌘O', 'page-ref jump row keeps its keyboard hint');

  for (const label of ['Jump to block', 'Open in side panel', 'Open linked references', 'Expand inline (embed)', 'Copy this reference', 'Remove reference']) { open(); activateTop(h, label); }
  for (const child of ['Reference', 'Linked references']) { open(); activateFlyout(h, 'Add to Workbench', child); }
  for (const child of ['Full', 'Children only', 'Path']) { open(); activateFlyout(h, 'Embed display', child); }
  for (const child of ['Text', 'Alias', 'Text and alias']) { open(); activateFlyout(h, 'Replace with', child); }
  for (const child of ['Regular Embed', 'Embed with path', 'Embed only children']) { open(); activateNestedFlyout(h, 'Replace with', ['Embed', child]); }
  for (const child of ['Swap blocks only', 'Bring nested items along']) { open(); activateNestedFlyout(h, 'Replace with', ['Original', child]); }
  for (const child of ['As text', 'As references']) { open(); activateFlyout(h, 'Apply children', child); }
  for (const child of ['Set alias', 'Manage aliases…', 'Find unlinked alias mentions']) { open(); activateFlyout(h, 'Aliases', child); }
  for (const child of ['Reference', 'Text', 'As transclusion']) { open(); activateFlyout(h, 'Copy', child); }
  for (const child of ['Reference', 'Text', 'As transclusion']) { open(); activateFlyout(h, 'Paste (at caret)', child); }
  for (const child of ['Reference (keep text)', 'Reference and text']) { open(); activateFlyout(h, 'Delete', child); }
  await tick(5);

  for (const expected of [
    ['jump', 'TARGET_MENU', false], ['jump', 'TARGET_MENU', true], ['expand'],
    ['workbench', 'TARGET_MENU', 'reference'], ['workbench', 'TARGET_MENU', 'linked-refs'], ['linked'],
    ['variant', 'full'], ['variant', 'children'], ['variant', 'path'],
    ['replace', 'text'], ['replace', 'alias'], ['replace', 'text-alias'],
    ['replace', 'embed', 'full'], ['replace', 'embed', 'path'], ['replace', 'embed', 'children'],
    ['replace', 'original', false], ['replace', 'original', true],
    ['children', 'text'], ['children', 'references'], ['alias', 'set'], ['alias', 'manage'], ['alias', 'finder'],
    ['copy', 'reference'], ['paste', 'reference'], ['paste', 'text'], ['paste', 'transclusion'],
    ['delete', 'keep'], ['delete', 'all'],
  ]) assert.equal(fx.calls.some((call) => JSON.stringify(call) === JSON.stringify(expected)), true, 'handler fired: ' + expected.join('/'));
  assert.equal(fx.calls.filter((call) => call[0] === 'toast' && call[1] === 'Text copied').length, 1, 'copy-text handler fires');
});

test('v4.29 submenu stack keyboard enters twice and Left/Esc pop one level', async () => {
  const h = loadHarness();
  const fx = refMenuFixture(h, { openEmbed: false });
  h.plugin._openRefMenu(fx.r, fx.anchor); await tick();
  const key = (name) => h.window.dispatchEvent(event('keydown', { key: name }));
  activateTop(h, 'Replace with');
  assert.equal(h.document.querySelectorAll('.refx-submenu').length, 1);
  key('ArrowRight');
  assert.equal(h.document.querySelectorAll('.refx-submenu').length, 2, 'ArrowRight enters the selected nested Embed flyout');
  let submenus = [...h.document.querySelectorAll('.refx-submenu')];
  assert.equal(submenus[1].querySelectorAll('.refalias-result')[0].classList.contains('refalias-result-sel'), true, 'first grandchild is selected');
  key('ArrowLeft');
  assert.equal(h.document.querySelectorAll('.refx-submenu').length, 1, 'ArrowLeft pops only the nested level');
  assert.ok(h.document.querySelector('.refx-refmenu'), 'parent menu remains open');
  key('ArrowRight'); key('Escape');
  assert.equal(h.document.querySelectorAll('.refx-submenu').length, 1, 'first Esc pops only the nested submenu');
  key('Escape');
  assert.equal(h.document.querySelectorAll('.refx-submenu').length, 0, 'second Esc closes the first-level submenu');
  assert.ok(h.document.querySelector('.refx-refmenu'), 'first Esc preserves the parent menu');
  key('ArrowRight');
  assert.equal(h.document.querySelectorAll('.refx-submenu').length, 1, 'top-level selection is restored so Right re-enters the visible parent row');
  key('Escape'); key('Escape');
  assert.equal(h.document.querySelector('.refx-refmenu'), null, 'third Esc closes the parent menu');
});

test('v4.29.1 submenu hover dwell collapses siblings, returns to parents, and keeps arrows at the entered depth', async () => {
  const h = loadHarness();
  const fx = refMenuFixture(h, { openEmbed: false });
  h.plugin._openRefMenu(fx.r, fx.anchor); await tick();
  const replace = topMenuRows(h).find((row) => rowLabel(row) === 'Replace with');
  replace.dispatchEvent(event('mouseenter')); await tick(160);
  assert.equal(h.document.querySelectorAll('.refx-submenu').length, 1, 'top-level dwell opens one submenu');

  let first = [...h.document.querySelectorAll('.refx-submenu')][0];
  const embed = [...first.querySelectorAll('.refalias-result')].find((row) => rowLabel(row) === 'Embed');
  embed.dispatchEvent(event('mouseenter')); await tick(160);
  assert.equal(h.document.querySelectorAll('.refx-submenu').length, 2, 'nested dwell opens the grandchild menu');

  h.window.dispatchEvent(event('keydown', { key: 'ArrowDown' }));
  assert.equal(
    [...first.querySelectorAll('.refalias-result')].find((row) => rowLabel(row) === 'Text').classList.contains('refalias-result-sel'),
    true,
    'an unopened deepest menu does not throw arrow navigation back to level zero'
  );

  replace.dispatchEvent(event('mouseenter'));
  assert.equal(h.document.querySelectorAll('.refx-submenu').length, 1, 'hovering the level-zero parent closes its grandchild');

  const original = [...first.querySelectorAll('.refalias-result')].find((row) => rowLabel(row) === 'Original');
  original.dispatchEvent(event('mouseenter')); await tick(160);
  assert.equal(h.document.querySelectorAll('.refx-submenu').length, 2);
  assert.equal(
    rowLabel([...h.document.querySelectorAll('.refx-submenu')][1].querySelector('.refalias-result')),
    'Swap blocks only',
    'a level-one sibling replaces the prior grandchild after dwell'
  );

  const copy = topMenuRows(h).find((row) => rowLabel(row) === 'Copy');
  copy.dispatchEvent(event('mouseenter')); await tick(160);
  assert.equal(h.document.querySelectorAll('.refx-submenu').length, 1, 'a top-level sibling collapses the old branch');
  assert.equal(
    rowLabel(h.document.querySelector('.refx-submenu').querySelector('.refalias-result')),
    'Reference',
    'the sibling submenu is the only remaining branch'
  );
});

test('v4.29 Extensions flyout filters by context, survives API replacement, and disposes safely', () => {
  const h = loadHarness();
  const fx = refMenuFixture(h, { openEmbed: false });
  const owner = { id: 'fixture-extension', isAlive: () => true };
  h.plugin._openRefMenu(fx.r, fx.anchor);
  assert.equal(topMenuRows(h).some((row) => rowLabel(row) === 'Extensions'), false, 'empty extension registry renders no row');

  const contexts = [];
  const hidden = h.plugin._registerMenuExtension({
    id: 'hidden', owner, label: 'Hidden', when: () => false, onSelect: () => contexts.push('hidden'),
  });
  const stale = h.plugin._registerMenuExtension({
    id: 'visible', owner, label: 'Old action', when: (ctx) => ctx.isLine, onSelect: () => contexts.push('old'),
  });
  const replacement = h.plugin._registerMenuExtension({
    id: 'visible', owner, label: 'Visible action', icon: 'ti-bolt',
    when: (ctx) => ctx.targetGuid === 'TARGET_MENU',
    onSelect: (ctx) => contexts.push(ctx),
  });
  assert.equal(stale(), false, 'a stale disposer cannot remove a hot-reload replacement with the same id');
  h.plugin._openRefMenu(fx.r, fx.anchor);
  activateFlyout(h, 'Extensions', 'Visible action');
  assert.equal(JSON.stringify(contexts), JSON.stringify([{
    targetGuid: 'TARGET_MENU', lineGuid: 'HOST_MENU', pageGuid: 'PAGE_MENU', isLine: true,
  }]));
  assert.equal(replacement(), true);
  assert.equal(hidden.dispose(), true);
  h.plugin._openRefMenu(fx.r, fx.anchor);
  assert.equal(topMenuRows(h).some((row) => rowLabel(row) === 'Extensions'), false);
});

test('v4.29.1 extension bridge prunes dead owners, enumerates safely, unregisters explicitly, and clears on unload', () => {
  const h = lineRefClickHarness();
  const bridge = h.window.__refx;
  const owner = { id: 'plugin-b', alive: true, isAlive() { return this.alive; } };
  bridge.registerMenuExtension({
    id: 'owned', owner, label: 'Owned action', icon: 'ti-bolt', onSelect() {},
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(bridge.listMenuExtensions())),
    [{ id: 'owned', label: 'Owned action', icon: 'bolt', ownerId: 'plugin-b' }],
    'enumeration exposes descriptors, never callbacks'
  );
  assert.equal(bridge.unregisterMenuExtension('owned', 'wrong-owner'), false, 'owner guard protects another plugin registration');
  owner.alive = false;
  assert.deepEqual([...bridge.listMenuExtensions()], [], 'dead owner is pruned without its disposer');
  assert.equal(h.window.__refxMenuExtensions.has('owned'), false);
  assert.throws(
    () => bridge.registerMenuExtension({ id: 'bad-icon', owner: 'plugin-b', label: 'Bad', icon: 'bolt arbitrary', onSelect() {} }),
    /lowercase letters, digits, and hyphens/
  );
  bridge.registerMenuExtension({ id: 'explicit', owner: 'plugin-b', label: 'Explicit', onSelect() {} });
  assert.equal(bridge.unregisterMenuExtension('explicit', 'plugin-b'), true);
  bridge.registerMenuExtension({ id: 'unload', owner: 'plugin-b', label: 'Unload', onSelect() {} });
  h.window['plugin-b'] = {};
  h.plugin.onUnload();
  assert.equal(h.window.__refx, null);
  assert.ok(h.window.__refxMenuExtensions instanceof Map, 'shared registry survives RefX unload');
  assert.equal(h.window.__refxMenuExtensions.has('unload'), true, 'other plugins keep their menu extensions across reinstall');
  delete h.window['plugin-b'];
  assert.equal(h.plugin._availableMenuExtensions({}).length, 0, 'dead owner pruned on read');
});

test('v4.29.1 Replace with Embed applies the selected display variant only to the embed it creates', async () => {
  const h = loadHarness();
  const applied = [], writes = [];
  const existing = { guid: 'EMBED_EXISTING', props: { itemref: 'TARGET_MENU', refx_variant: 'children' } };
  const created = { guid: 'EMBED_CREATED', props: { itemref: 'TARGET_MENU' } };
  const host = { guid: 'HOST_MENU', children: [existing] };
  h.records.set('PAGE_MENU', { getLineItems: async () => [host] });
  h.plugin._menuExpand = async () => { host.children.push(created); };
  h.plugin._findLineDeep = () => host;
  h.plugin._findEmbeds = (block, target) => block.children.filter((line) => line.props.itemref === target);
  h.plugin._setEmbedVariant = (embeds, variant, silent) => applied.push([embeds[0].guid, variant, silent]);
  h.plugin._toast = () => {};
  await h.plugin._replaceWithEmbed({
    targetGuid: 'TARGET_MENU', lineGuid: 'HOST_MENU', pageGuid: 'PAGE_MENU',
    segs: [{ type: 'ref', text: { guid: 'TARGET_MENU', title: 'Target' } }], refIdx: 0,
    li: { setSegments: (segments) => writes.push(segments) },
  }, 'path');
  assert.deepEqual(applied, [['EMBED_CREATED', 'path', true]]);
  assert.equal(existing.props.refx_variant, 'children', 'pre-existing embed variant is untouched');
  assert.deepEqual(writes, [[]]);
});

test('v4.29.1 Regular Embed skips default metadata while switching to Full clears a non-default variant', () => {
  const h = loadHarness();
  const writes = [];
  const regular = {
    guid: 'REGULAR', props: { itemref: 'TARGET' },
    setMetaProperty: (...args) => writes.push(['regular', ...args]),
  };
  const children = {
    guid: 'CHILDREN', props: { itemref: 'TARGET', refx_variant: 'children' },
    setMetaProperty: (...args) => writes.push(['children', ...args]),
  };
  h.plugin._applyEmbedVariant = () => {};
  h.plugin._setEmbedVariant([regular], 'full', true);
  h.plugin._setEmbedVariant([children], 'full', true);
  assert.deepEqual(writes, [['children', 'refx_variant', null]]);
});

test('v4.29 Replace with Original either lifts direct children in order or carries them along', async () => {
  const run = async (bringChildren) => {
    const h = loadHarness();
    const operations = [], writes = [];
    const marker = {
      guid: 'OLD_SPOT_REF',
      delete: async () => { operations.push(['delete-marker']); return true; },
    };
    const child = (guid) => ({
      guid, parent_guid: 'TARGET_ORIGINAL', children: [],
      move: async (parent, after) => {
        operations.push(['move', guid, parent.guid || 'SRC_RECORD', after?.guid || null]);
        return true;
      },
    });
    const childA = child('CHILD_A'), childB = child('CHILD_B');
    const target = {
      guid: 'TARGET_ORIGINAL', parent_guid: 'SOURCE_PARENT', children: [childA, childB],
      move: async (parent, after) => {
        operations.push(['move', 'TARGET_ORIGINAL', parent.guid || 'DEST_RECORD', after?.guid || null]);
        return true;
      },
    };
    const sourceParent = { guid: 'SOURCE_PARENT', parent_guid: null, children: [target] };
    const sourceRecord = {
      guid: 'SRC_RECORD',
      getLineItems: async () => [sourceParent],
      createLineItem: async (parent, after) => {
        operations.push(['marker', parent?.guid || null, after?.guid || null]);
        return marker;
      },
    };
    const host = { guid: 'HOST_LINE', parent_guid: null, children: [] };
    const destRecord = { guid: 'DEST_RECORD', getLineItems: async () => [host] };
    h.records.set('SRC_RECORD', sourceRecord);
    h.records.set('DEST_RECORD', destRecord);
    h.window.g_universe.itemsByGuid.TARGET_ORIGINAL = { rguid: 'SRC_RECORD' };
    h.plugin._toast = () => {};
    await h.plugin._replaceWithOriginal({
      targetGuid: 'TARGET_ORIGINAL', lineGuid: 'HOST_LINE', pageGuid: 'DEST_RECORD',
      fallback: 'Original', current: 'Original', isText: true,
      segs: [{ type: 'ref', text: { guid: 'TARGET_ORIGINAL', title: 'Original' } }], refIdx: 0,
      li: { setSegments: (segments) => writes.push(segments) },
    }, bringChildren);
    return { operations, writes, childA, childB };
  };

  const swap = await run(false);
  assert.deepEqual(swap.operations, [
    ['marker', 'SOURCE_PARENT', 'TARGET_ORIGINAL'],
    ['move', 'CHILD_A', 'OLD_SPOT_REF', null],
    ['move', 'CHILD_B', 'OLD_SPOT_REF', 'CHILD_A'],
    ['move', 'TARGET_ORIGINAL', 'DEST_RECORD', 'HOST_LINE'],
  ]);
  assert.equal(swap.childA.guid, 'CHILD_A');
  assert.equal(swap.childB.guid, 'CHILD_B');
  assert.deepEqual(swap.writes, [[]]);

  const carry = await run(true);
  assert.deepEqual(carry.operations, [
    ['marker', 'SOURCE_PARENT', 'TARGET_ORIGINAL'],
    ['move', 'TARGET_ORIGINAL', 'DEST_RECORD', 'HOST_LINE'],
  ]);
  assert.deepEqual(carry.writes, [[]]);
});

function originalMoveScenario({
  childGuids = ['CHILD_A', 'CHILD_B'],
  failLift = [],
  failRestore = [],
  failTargetMove = false,
  markerMode = 'ok',
  sameRecord = false,
  cycle = false,
} = {}) {
  const h = loadHarness();
  const operations = [], writes = [], toasts = [];
  const marker = {
    guid: 'OLD_SPOT_REF', children: [],
    delete: async () => { operations.push(['delete-marker']); return true; },
  };
  let target = null;
  const children = childGuids.map((guid) => ({
    guid, parent_guid: 'TARGET_ORIGINAL', children: [],
    move: async (parent, after) => {
      const phase = parent === target ? 'restore' : 'lift';
      operations.push([phase, guid, parent?.guid || null, after?.guid || null]);
      if (phase === 'lift' && failLift.includes(guid)) return false;
      if (phase === 'restore' && failRestore.includes(guid)) return false;
      return true;
    },
  }));
  target = {
    guid: 'TARGET_ORIGINAL', parent_guid: 'SOURCE_PARENT', children,
    move: async (parent, after) => {
      operations.push(['move-target', parent?.guid || null, after?.guid || null]);
      return !failTargetMove;
    },
  };
  const sourceParent = { guid: 'SOURCE_PARENT', parent_guid: null, children: [target] };
  const host = { guid: 'HOST_LINE', parent_guid: cycle ? 'TARGET_ORIGINAL' : null, children: [] };
  if (cycle) target.children.push(host);
  const sourceRecord = {
    guid: 'SRC_RECORD',
    getLineItems: async () => sameRecord || cycle ? [sourceParent, ...(cycle ? [] : [host])] : [sourceParent],
    createLineItem: async (parent, after) => {
      operations.push(['marker', parent?.guid || null, after?.guid || null]);
      if (markerMode === 'throw') throw new Error('marker failed');
      return markerMode === 'missing' ? undefined : marker;
    },
  };
  const destRecord = sameRecord || cycle
    ? sourceRecord
    : { guid: 'DEST_RECORD', getLineItems: async () => [host] };
  h.records.set('SRC_RECORD', sourceRecord);
  if (!sameRecord && !cycle) h.records.set('DEST_RECORD', destRecord);
  h.window.g_universe.itemsByGuid.TARGET_ORIGINAL = { rguid: 'SRC_RECORD' };
  h.plugin._toast = (message) => toasts.push(message);
  const run = () => h.plugin._replaceWithOriginal({
    targetGuid: 'TARGET_ORIGINAL', lineGuid: 'HOST_LINE',
    pageGuid: sameRecord || cycle ? 'SRC_RECORD' : 'DEST_RECORD',
    fallback: 'Original', current: 'Original', isText: true,
    segs: [{ type: 'ref', text: { guid: 'TARGET_ORIGINAL', title: 'Original' } }], refIdx: 0,
    li: { setSegments: (segments) => writes.push(segments) },
  }, false);
  const runCarry = () => h.plugin._replaceWithOriginal({
    targetGuid: 'TARGET_ORIGINAL', lineGuid: 'HOST_LINE',
    pageGuid: sameRecord || cycle ? 'SRC_RECORD' : 'DEST_RECORD',
    fallback: 'Original', current: 'Original', isText: true,
    segs: [{ type: 'ref', text: { guid: 'TARGET_ORIGINAL', title: 'Original' } }], refIdx: 0,
    li: { setSegments: (segments) => writes.push(segments) },
  }, true);
  return { h, operations, writes, toasts, run, runCarry };
}

test('v4.29.1 failed lift restores every moved child and deletes the marker only after complete rollback', async () => {
  const fx = originalMoveScenario({ childGuids: ['A', 'B', 'C'], failLift: ['C'] });
  await fx.run();
  assert.deepEqual(fx.operations, [
    ['marker', 'SOURCE_PARENT', 'TARGET_ORIGINAL'],
    ['lift', 'A', 'OLD_SPOT_REF', null],
    ['lift', 'B', 'OLD_SPOT_REF', 'A'],
    ['lift', 'C', 'OLD_SPOT_REF', 'B'],
    ['restore', 'A', 'TARGET_ORIGINAL', null],
    ['restore', 'B', 'TARGET_ORIGINAL', 'A'],
    ['delete-marker'],
  ]);
  assert.deepEqual(fx.writes, []);
  assert.equal(fx.toasts.at(-1), "Couldn't leave the nested items at the original location.");
});

test('v4.29.1 partial rollback attempts every restore, keeps the marker, identifies damage, and records it', async () => {
  const fx = originalMoveScenario({ childGuids: ['A', 'B', 'C'], failLift: ['C'], failRestore: ['A'] });
  await fx.run();
  assert.equal(fx.operations.some((op) => JSON.stringify(op) === JSON.stringify(['restore', 'B', 'TARGET_ORIGINAL', null])), true, 'B restore is attempted after A fails');
  assert.equal(fx.operations.some((op) => op[0] === 'delete-marker'), false, 'repair breadcrumb remains visible');
  assert.match(fx.toasts.at(-1), /A.*marker was kept for repair/);
  assert.match(fx.h.window.__REFX_LAST_ERROR, /Could not restore children: A/);
  assert.deepEqual(fx.writes, []);
});

test('v4.29.1 Original handles zero children, same-record hosts, and best-effort carry markers', async () => {
  const empty = originalMoveScenario({ childGuids: [] });
  await empty.run();
  assert.equal(empty.operations.some((op) => op[0] === 'move-target'), true);
  assert.deepEqual(empty.writes, [[]]);

  const same = originalMoveScenario({ sameRecord: true });
  await same.run();
  assert.equal(same.operations.some((op) => op[0] === 'move-target' && op[1] === 'SRC_RECORD'), true, 'same-record target and host still use GUID-preserving move');
  assert.deepEqual(same.writes, [[]]);

  const noMarker = originalMoveScenario({ markerMode: 'missing' });
  await noMarker.runCarry();
  assert.equal(noMarker.operations.some((op) => op[0] === 'move-target'), true, 'bring-children mode preserves pre-4.29 best-effort behavior');
  assert.deepEqual(noMarker.writes, [[]]);
  assert.match(noMarker.toasts.at(-1), /couldn't mark its old spot/i);
});

test('v4.29.1 Original cycle guard refuses before marker creation or any move', async () => {
  const fx = originalMoveScenario({ cycle: true });
  await fx.run();
  assert.deepEqual(fx.operations, []);
  assert.deepEqual(fx.writes, []);
  assert.equal(fx.toasts.at(-1), "Can't move a line into its own subtree.");
});

test('v4.11 settled record rename emits one actionable old-title alias offer', async () => {
  const h = loadHarness(); h.plugin._aliasInit();
  const rec = { guid: 'REC_RENAME', getName: () => 'New title' }; h.records.set(rec.guid, rec);
  const offers = [];
  h.plugin._toastAction = (message, label, action) => { offers.push({ message, label, action }); };
  const adds = [];
  h.plugin._aliasAdd = async (...args) => { adds.push(args); return { ok: true }; };
  h.plugin._scheduleRenameAliasOffer(rec.guid, 'Old title', 'N');
  h.plugin._scheduleRenameAliasOffer(rec.guid, 'N', 'New title');
  await tick(2050);
  assert.equal(offers.length, 1, 'typing burst settles to one offer');
  assert.match(offers[0].message, /New title/);
  assert.match(offers[0].label, /Old title/);
  await offers[0].action();
  assert.deepEqual(adds, [[rec.guid, 'Old title']], 'action delegates to the existing alias write');
});

test('v4.11 rename offer captures the cached old name before patching and skips creation, duplicates, and config-off', () => {
  const h = loadHarness(); h.plugin._aliasInit();
  const rec = { guid: 'REC_CAPTURE', getName: () => 'After' }; h.records.set(rec.guid, rec);
  h.plugin._recordNameIndex.set(rec.guid, 'Before');
  h.plugin._clearRecordIndexRetries = () => {};
  h.plugin._markRecordTargetKnown = () => false;
  h.plugin._invalidateBackrefs = () => {};
  h.plugin._patchRecordNameIndex = (guid, record) => h.plugin._recordNameIndex.set(guid, record.getName());
  h.plugin.updateLinePropRefIndexForRecord = () => {};
  h.plugin._updatePropRefIndexForRecord = () => {};
  const captured = [];
  h.plugin._scheduleRenameAliasOffer = (...args) => { captured.push(args); return true; };
  h.plugin.handleRecordUpdated({ recordGuid: rec.guid }, 'updated');
  h.plugin.handleRecordUpdated({ recordGuid: rec.guid }, 'created');
  assert.deepEqual(captured, [[rec.guid, 'Before', 'After']], 'creation never schedules and update sees the pre-patch name');

  h.plugin._aliasReplaceRecordSet(rec.guid, [h.plugin._aliasMakeItem('Before', 'registry')]);
  let shown = 0; h.plugin._toastAction = () => { shown++; };
  assert.equal(h.plugin._showRenameAliasOffer({ recordGuid: rec.guid, oldTitle: 'Before', newTitle: 'After' }), false);
  assert.equal(shown, 0, 'an existing normalized alias suppresses the offer');
  h.plugin.getConfiguration = () => ({ custom: { renameAliasOffer: false } });
  assert.equal(h.plugin._renameAliasOfferEnabled(), false);
});

test('v4.11 rename alias action surfaces the registry cap reason', async () => {
  const h = loadHarness(); h.plugin._aliasInit();
  const rec = { guid: 'REC_CAP', getName: () => 'After' }; h.records.set(rec.guid, rec);
  let action = null; const toasts = [];
  h.plugin._toastAction = (_message, _label, fn) => { action = fn; };
  h.plugin._toast = (message) => toasts.push(message);
  h.plugin._aliasAdd = async () => ({ ok: false, capReason: 'alias-registry-record-cap' });
  assert.equal(h.plugin._showRenameAliasOffer({ recordGuid: rec.guid, oldTitle: 'Before', newTitle: 'After' }), true);
  await action();
  assert.equal(toasts.some((message) => message.includes('2,000 records')), true);
});

test('v4.11 Alias Finder time-slices, aborts with its popup, and caps at 200 occurrences', async () => {
  const h = loadHarness(); h.plugin._aliasInit();
  const record = { guid: 'REC_FIND', getName: () => 'Cardiology' }; h.records.set(record.guid, record);
  h.plugin._aliasReplaceRecordSet(record.guid, [h.plugin._aliasMakeItem('CV', 'registry')]);
  const lines = Array.from({ length: 210 }, (_, index) => ({
    guid: 'LINE_FIND_' + index,
    record: { guid: 'SRC_' + index },
    segments: [{ type: 'text', text: 'Discuss CV markers ' + index }],
  }));
  h.plugin.data.searchByQuery = async () => ({ lines });
  let yields = 0; h.plugin._yieldMacrotask = async () => { yields++; };
  const capped = await h.plugin._aliasFinderScan(record.guid, { entry: { aborted: false } });
  assert.equal(capped.hits.length, 200);
  assert.equal(capped.capped, true);
  assert.ok(yields > 0, 'candidate/index work yields between bounded slices');

  let release;
  h.plugin.data.searchByQuery = () => new Promise((resolve) => { release = resolve; });
  h.plugin._aliasOpenFinder(record.guid);
  h.plugin._closeCardPopup();
  release({ lines: lines.slice(0, 1) });
  await tick(); await tick();
  assert.equal(h.document.querySelector('.refx-alias-finder'), null, 'closing removes the results UI');
  assert.equal(h.plugin._cardPopup, null, 'the aborted scan cannot resurrect its popup');
});

test('v4.11 Alias Finder is preview-only until Link and routes writes through the B2 receipt apply path', async () => {
  const h = loadHarness(); h.plugin._aliasInit();
  const record = { guid: 'REC_LINK', getName: () => 'Cardiology' }; h.records.set(record.guid, record);
  h.plugin._aliasReplaceRecordSet(record.guid, [h.plugin._aliasMakeItem('CV', 'registry')]);
  const line = {
    guid: 'LINE_LINK', record: { guid: 'SRC_LINK' },
    segments: [{ type: 'text', text: 'Review CV today' }],
  };
  h.plugin.data.searchByQuery = async () => ({ lines: [line] });
  h.plugin._yieldMacrotask = async () => {};
  const applied = [];
  h.plugin._aliasApplyRenamePropagationPreview = async (plan) => {
    applied.push(plan);
    return { ok: true, applied: plan.entries.length, receipt: { applied: plan.entries } };
  };
  h.plugin._aliasOpenFinder(record.guid);
  await tick(); await tick();
  assert.equal(applied.length, 0, 'scan and preview perform zero document mutation');
  const link = h.document.querySelector('.refx-alias-finder-link');
  assert.ok(link, 'a per-occurrence Link action is rendered');
  link.click(); await tick();
  assert.equal(applied.length, 1, 'explicit Link delegates to the existing preview/apply machinery');
  const entry = applied[0].entries[0];
  assert.equal(applied[0].op, 'link-alias-mentions');
  assert.deepEqual(JSON.parse(JSON.stringify(entry.beforeSegments)), [{ type: 'text', text: 'Review CV today' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(entry.afterSegments)), [
    { type: 'text', text: 'Review ' },
    { type: 'ref', text: { guid: record.guid, title: 'CV' } },
    { type: 'text', text: ' today' },
  ]);
});

test('v4.11 alias usage counts reuse broker inEdges, cache for the TTL, and sort chooser chips descending', async () => {
  const h = loadHarness(); h.plugin._aliasInit();
  const record = { guid: 'REC_USAGE', getName: () => 'Usage target' }; h.records.set(record.guid, record);
  h.plugin._aliasReplaceRecordSet(record.guid, [
    h.plugin._aliasMakeItem('Low use', 'registry'),
    h.plugin._aliasMakeItem('High use', 'registry'),
    h.plugin._aliasMakeItem('Unused', 'registry'),
  ]);
  let inEdgesCalls = 0;
  h.plugin._referenceSurfaceBroker = {
    inEdges: (guid) => {
      inEdgesCalls++;
      return [
        { kind: 'ref', target: { guid }, title: 'Low use' },
        { kind: 'ref', target: { guid }, title: 'High use' },
        { kind: 'ref', target: { guid }, title: 'HIGH USE' },
        { kind: 'ref', target: { guid }, title: 'High use' },
        { kind: 'claim', target: { guid }, title: 'High use' },
      ];
    },
  };
  const counts = await h.plugin._aliasUsageCounts(record.guid);
  await h.plugin._aliasUsageCounts(record.guid);
  assert.equal(inEdgesCalls, 1, 'the 60-second cache avoids a second broker read');
  assert.equal(counts.get(h.plugin._aliasNormalizeText('High use').normalized), 3);

  const list = h.document.createElement('div'); h.document.body.append(list);
  const result = { guid: record.guid, text: record.getName() };
  const link = {
    kind: 'record', query: 'Usage', resultsQuery: 'Usage', searchTimer: null,
    results: [result], resultsPreSliceCount: 1, sel: 0, userSelected: true, list,
  };
  h.plugin._link = link; h.plugin._updateLinkPreviewPane = () => {};
  assert.deepEqual([...h.plugin._linkAliasesForResult(link, result)], ['High use', 'Low use', 'Unused']);
  h.plugin._renderLink();
  const chips = list.querySelectorAll('.refx-alias-chip');
  assert.deepEqual(chips.map((chip) => chip.querySelector('.refx-alias-chip-text').textContent), ['High use', 'Low use', 'Unused']);
  assert.equal(chips[0].querySelector('.refx-alias-chip-usage').textContent, '×3');
  assert.equal(chips[1].querySelector('.refx-alias-chip-usage').textContent, '×1');
  assert.equal(chips[2].querySelector('.refx-alias-chip-usage'), null, 'zero is omitted from chooser chips');

  h.plugin._aliasOpenManageModal(record.guid);
  await tick();
  assert.equal(h.document.querySelectorAll('.refx-alias-usage').some((node) => node.textContent === '× 3'), true, 'manager shows muted per-alias usage');
});

test('A2 per-reference alias offer is non-automatic and a dismissal never repeats', async () => {
  const storage = new Map();
  const h = loadHarness({ storage });
  h.plugin._aliasInit();
  const r = {
    targetGuid: 'REC_PROMOTE', isText: false, current: '', fallback: 'Canonical', refIdx: 0,
    segs: [{ type: 'ref', text: { guid: 'REC_PROMOTE' } }],
    li: { setSegments: async () => true }, lineNode: null, anchorNode: null,
  };
  h.plugin._openAliasModal(r);
  let input = h.document.querySelector('.refalias-input'); input.value = 'Remember me';
  input.dispatchEvent(event('keydown', { key: 'Enter' })); await tick();
  assert.ok(h.document.querySelector('.refx-alias-promotion'), 'successful display alias write should offer promotion');
  assert.equal(h.plugin._aliasGet(r.targetGuid), null, 'offer must never auto-write a record alias');
  const dismiss = h.document.querySelectorAll('button').find((button) => button.textContent === 'Not now');
  dismiss.click();
  assert.ok(storage.get('refx_alias_promotion_dismissed_v1').includes('REC_PROMOTE'));

  h.plugin._openAliasModal(r);
  input = h.document.querySelector('.refalias-input'); input.value = 'Remember me';
  input.dispatchEvent(event('keydown', { key: 'Enter' })); await tick();
  assert.equal(h.document.querySelector('.refx-alias-promotion'), null, 'dismissed record/text pair must not be offered again');
});

test('A2 active-panel decorator mounts through panel API and cached node reinserts pre-paint with zero layout reads', () => {
  const h = loadHarness();
  h.plugin._aliasInit();
  h.plugin._aliasReplaceRecordSet('REC_PANEL', [h.plugin._aliasMakeItem('Panel alias', 'registry')]);
  const panelEl = h.document.createElement('div');
  let titleHost = h.document.createElement('div'); titleHost.className = 'id--panel-title';
  panelEl.append(titleHost); h.document.body.append(panelEl);
  const rec = { guid: 'REC_PANEL', getGuid: () => 'REC_PANEL', getName: () => 'Panel Record' };
  const panel = { getElement: () => panelEl, getActiveRecord: () => rec };
  h.plugin.ui.getPanels = () => [panel];
  h.plugin._aliasMountPanelRows();
  const first = titleHost.querySelector('.refx-alias-panel-row');
  assert.ok(first); assert.ok(first.textContent.includes('Panel alias'));
  assert.equal(h.layoutReads(), 0, 'mount must not read layout');
  const observer = h.observers.find((item) => item.target === h.document.body);
  assert.ok(observer, 'real shared decorator observer must be mounted');

  titleHost.remove();
  titleHost = h.document.createElement('div'); titleHost.className = 'id--panel-title'; panelEl.append(titleHost);
  assert.equal(first.isConnected, false);
  observer.callback([]);
  assert.equal(titleHost.querySelector('.refx-alias-panel-row'), first, 'same cached decorator node must be reinserted');
  assert.equal(h.layoutReads(), 0, 'pre-paint reinsertion must not read layout');
  assert.match(source, /\.refx-alias-panel-row\s*\{[\s\S]*position:\s*absolute/);
  assert.ok(source.includes("label: \"RefX: Aliases for this record…\""));
  assert.ok(source.includes('item("Manage aliases…", "record"'));
  assert.ok(source.includes("'refx-propcard-aliases'"));
});

function installU6ChainGraph(h) {
  const owner = {
    guid: 'CHAIN_OWNER',
    getName: () => 'Chain owner',
    getLineItems: async () => [lineA, lineB, lineC1, lineC2],
  };
  const page = { guid: 'CHAIN_PAGE', getName: () => 'Chain page' };
  const makeLine = (guid, text, refs = []) => ({
    guid, parent_guid: owner.guid, type: 'ulist',
    segments: [
      { type: 'text', text },
      ...refs.map(([target, title]) => ({ type: 'ref', text: { guid: target, title } })),
    ],
    children: [], getRecord: () => owner,
  });
  const lineA = makeLine('CHAIN_A', 'A', [['CHAIN_B', 'B alias'], ['CHAIN_PAGE', 'Page alias']]);
  const lineB = makeLine('CHAIN_B', 'B', [['CHAIN_C1', 'C1'], ['CHAIN_C2', 'C2'], ['CHAIN_A', 'A cycle']]);
  const lineC1 = makeLine('CHAIN_C1', 'C1');
  const lineC2 = makeLine('CHAIN_C2', 'C2');
  h.records.set(owner.guid, owner);
  h.records.set(page.guid, page);
  for (const line of [lineA, lineB, lineC1, lineC2]) {
    h.window.g_universe.itemsByGuid[line.guid] = {
      guid: line.guid, rguid: owner.guid, lineItem: line,
    };
    h.plugin._lineOwnerHints.set(line.guid, owner.guid);
  }
  return { owner, page, lineA, lineB, lineC1, lineC2 };
}

test('v4.43 general ref-chain resolver guards cycles and enforces depth/fanout caps with line/page classification', async () => {
  const h = lineRefClickHarness();
  const graph = installU6ChainGraph(h);

  const chain = await h.plugin._resolveRefChain('CHAIN_A', { maxDepth: 4, maxFanout: 8 });
  assert.deepEqual(
    Array.from(chain, (hop) => [hop.guid, hop.isLine, hop.title, hop.ownerRecord?.guid, hop.depth]),
    [
      ['CHAIN_B', true, 'B alias', graph.owner.guid, 1],
      ['CHAIN_C1', true, 'C1', graph.owner.guid, 2],
      ['CHAIN_C2', true, 'C2', graph.owner.guid, 2],
      ['CHAIN_PAGE', false, 'Page alias', graph.page.guid, 1],
    ]
  );
  assert.equal(chain.some((hop) => hop.guid === 'CHAIN_A'), false, 'cycle edge back to the root is omitted');

  const shallow = await h.plugin._resolveRefChain('CHAIN_A', { maxDepth: 1, maxFanout: 8 });
  assert.deepEqual(Array.from(shallow, (hop) => hop.guid), ['CHAIN_B', 'CHAIN_PAGE']);
  assert.equal(shallow.deeperCount, 2, 'depth cap reports the two unvisited references below B');

  const narrow = await h.plugin._resolveRefChain('CHAIN_A', { maxDepth: 4, maxFanout: 1 });
  assert.deepEqual(Array.from(narrow, (hop) => hop.guid), ['CHAIN_B', 'CHAIN_C1']);
  assert.equal(narrow.deeperCount, 2, 'fanout omissions are surfaced without counting the cycle edge');

  const externallyVisited = await h.plugin._resolveRefChain('CHAIN_A', {
    maxDepth: 4, maxFanout: 8, visited: new Set(['CHAIN_B']),
  });
  assert.deepEqual(Array.from(externallyVisited, (hop) => hop.guid), ['CHAIN_PAGE']);
  h.plugin.onUnload();
});

test('v4.48.6 public bridge keeps v4 bounded-chain and one-level resolution compatibility', async () => {
  const h = lineRefClickHarness();
  installU6ChainGraph(h);
  assert.equal(h.window.__refx.version, '4.64.1');
  assert.equal(Object.hasOwn(h.window.__refx, 'refChainVersion'), false);
  assert.equal(h.window.__refx.resolveRefChainVersion, 4);
  assert.equal(typeof h.window.__refx.resolveRefChain, 'function');
  assert.equal(typeof h.window.__refx.resolveRefLevel, 'function');
  const pending = h.window.__refx.resolveRefChain('CHAIN_A', { maxDepth: 1, maxFanout: 8 });
  assert.equal(typeof pending?.then, 'function');
  assert.deepEqual(Array.from(await pending, (hop) => hop.guid), ['CHAIN_B', 'CHAIN_PAGE']);
  h.plugin.onUnload();
});

test('v4.48.6 the compact popup remains chain-first and labels cross-page hops', async () => {
  const h = lineRefClickHarness({}, { injectStyle: true });
  let journalLines = [];
  let scratchLines = [];
  const journalOwner = {
    guid: 'S-JOURNAL-20260731', getName: () => 'Fri Jul 31',
    getLineItems: async () => journalLines,
  };
  const scratchOwner = {
    guid: 'SCRATCHPAD_RECORD', getName: () => 'ScratchPad',
    getLineItems: async () => scratchLines,
  };
  const makeLine = (owner, guid, segments) => ({
    guid, parent_guid: owner.guid, type: 'text', children: [], segments,
    getRecord: () => owner,
  });
  const target = makeLine(journalOwner, '16KXTSZYE4PGMAFAM9WSM2S9GH', [{ type: 'text', text: 'target block' }]);
  const middle = makeLine(journalOwner, '1G02X5PH77EDFGGS7DD4G8H7M9', [
    { type: 'ref', text: { guid: target.guid, title: 'target' } },
    { type: 'text', text: ' further optimize speed' },
  ]);
  const top = makeLine(scratchOwner, '1RPB03PCQX7T71XFDSZQ26WXK1', [
    { type: 'ref', text: { guid: middle.guid, title: 'middle' } },
    { type: 'text', text: ' ScratchPad ref of a ref' },
  ]);
  journalLines = [target, middle];
  scratchLines = [top];
  for (const owner of [journalOwner, scratchOwner]) {
    h.records.set(owner.guid, owner);
    h.plugin._recordNameIndex.set(owner.guid, owner.getName());
    for (const line of await owner.getLineItems()) {
      h.window.g_universe.itemsByGuid[line.guid] = { guid: line.guid, rguid: owner.guid, lineItem: line };
      h.plugin._lineOwnerHints.set(line.guid, owner.guid);
    }
  }
  // The fast line index knows hop one, but its cross-page snapshot reports an
  // authoritative-looking empty level for hop two. The exact @linkto route is
  // the source of truth that already contains 1RPB in the user's mirror.
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async (guid) => guid === target.guid
      ? { items: [{ guid: journalOwner.guid, lineGuid: middle.guid, recordGuid: journalOwner.guid }], complete: true }
      : { items: [], complete: true },
  };
  const incoming = new Map([[middle.guid, [top]]]);
  const searches = [];
  h.plugin.data.searchByQuery = async (query, cap) => {
    searches.push([query, cap]);
    const guid = query.match(/"([^"]+)"/)?.[1] || '';
    return { records: [], lines: incoming.get(guid) || [] };
  };
  h.chip.setAttribute('data-guid', target.guid);
  h.plugin._resolveRefForChip = async () => ({
    targetGuid: target.guid,
    isText: true,
    current: 'target block',
    fallback: 'target block',
    lineGuid: 'LINE_CLICK',
    pageGuid: 'PAGE_CLICK',
    segs: [],
    refIdx: 0,
  });

  h.window.dispatchEvent(event('click', { target: h.chip, button: 0, detail: 1 }));
  await tick(380);
  const pop = h.document.querySelector('.refx-refmenu');
  assert.ok(pop, 'the real 300ms click router opens the default production menu');
  assert.equal(pop.offsetWidth, 380, 'the default production menu route measures 380px wide');
  const anchoredTop = pop.style.top;
  const section = pop.querySelector('.refx-ref-chain-tree');
  assert.ok(section);
  assert.equal(section.querySelector('.refx-ref-chain-label').textContent, '⟵ reference chain');
  assert.deepEqual(Array.from(section.querySelectorAll('.refx-chain-tree-row'), (row) => [
    row.dataset.guid, row.dataset.depth,
  ]), [
    [middle.guid, '1'], [top.guid, '2'],
  ]);
  assert.deepEqual(Array.from(section.querySelectorAll('.refx-chain-source-link'), (link) => [
    link.textContent, link.dataset.recordGuid,
  ]), [
    ['Fri Jul 31', journalOwner.guid],
    ['ScratchPad', scratchOwner.guid],
  ], 'the shared renderer suppresses the repeated journal heading and restores ScratchPad at hop two');

  const findTreeRow = (guid) => section.querySelectorAll('.refx-chain-tree-row')
    .find((row) => row.dataset.guid === guid) || null;
  const middleRow = findTreeRow(middle.guid);
  const topRow = findTreeRow(top.guid);
  assert.ok(topRow, 'one chip click reaches 1RPB without any pill gesture');
  assert.equal(topRow.dataset.depth, '2');
  assert.match(topRow.querySelector('.refx-chain-path').textContent, /←/);
  const inlineTarget = middleRow.querySelectorAll('.refx-chain-inline-ref')
    .find((candidate) => candidate.closest('.refx-chain-tree-row') === middleRow) || null;
  assert.ok(inlineTarget, 'a reference inside the expanded row stays interactive');
  assert.equal(inlineTarget.dataset.guid, target.guid);
  const nestedMenus = [];
  h.plugin._openRefChainInlineRef = (guid, title, anchor) => nestedMenus.push([guid, title, anchor]);
  inlineTarget.dispatchEvent(event('click', { target: inlineTarget, button: 0 }));
  assert.equal(nestedMenus.length, 1);
  assert.equal(nestedMenus[0][0], target.guid,
    'nested travel follows the actual inline reference target');
  assert.equal(pop.style.top, anchoredTop, 'tree growth never re-anchors the popup');
  const chainViewport = section.querySelector('.refx-chain-tree-root');
  const viewportRect = chainViewport.getBoundingClientRect();
  const topRect = topRow.getBoundingClientRect();
  const intersects = (rowRect, clipRect) => rowRect.bottom > clipRect.top
    && rowRect.top < clipRect.bottom && rowRect.right > clipRect.left
    && rowRect.left < clipRect.right;
  assert.equal(pop.offsetWidth, 380,
    'the menu width is computed from the injected production :has() rule');
  assert.equal(viewportRect.height, 180,
    'the chain viewport derives its height from the injected production max-height');
  assert.equal(h.computedCssValue(chainViewport, 'overflow-y'), 'auto',
    'the production chain viewport is the clipping scroller');
  assert.equal(intersects(topRect, viewportRect), true,
    'the exact real 1RPB row intersects the chain scroller viewport');
  const blockContext = pop.querySelector('.refx-refmenu-context');
  const blockContextLabel = pop.querySelector('.refx-refmenu-context-label');
  const contextBody = pop.querySelector('.refx-line-context-body');
  assert.equal(section.parentNode, pop, 'the chain is independent of Block Context hydration');
  assert.ok(pop.children.indexOf(section) < pop.children.indexOf(blockContext),
    'the chain section precedes the visible Block Context container');
  assert.ok(pop.children.indexOf(section) < pop.children.indexOf(blockContextLabel.parentNode),
    'the chain section precedes the visible Block Context label');
  assert.equal(contextBody.querySelector('.refx-ref-chain-tree'), null,
    'Block Context body replacement cannot detach the live chain');

  const queryCount = searches.length;
  const filter = section.querySelector('.refx-chain-filter');
  filter.value = '1rpb';
  filter.dispatchEvent({ type: 'input' });
  assert.equal(searches.length, queryCount, 'filtering resolved rows performs no query');
  assert.equal(middleRow.classList.contains('refx-chain-filtered'), false,
    'ancestors of a deep match remain visible as path context');
  assert.equal(topRow.classList.contains('refx-chain-filtered'), false);
  const exactQueries = searches.map(([query]) => query);
  assert.deepEqual([...new Set(exactQueries)], [
    '@linkto = "' + middle.guid + '"',
    '@linkto = "' + top.guid + '"',
  ], 'empty fast-index levels are confirmed exactly, while the warm first hop stays instant');
  assert.equal(exactQueries.includes('@linkto = "' + target.guid + '"'), false,
    'the warm first hop never pays for exact confirmation');
  const searchCaps = searches.map(([, cap]) => cap);
  assert.ok(searchCaps.every((cap) => cap === 200),
    'the automatic lazy tree may request the full 200-row popup safety window');
  h.plugin.onUnload();
});

test('v4.48.3 incoming chain survives Block Context failure on the real default menu route', async () => {
  const h = lineRefClickHarness();
  const rootGuid = 'CTX_FAIL_ROOT';
  const ownerGuid = 'CTX_FAIL_OWNER';
  const first = {
    guid: 'CTX_FAIL_FIRST', type: 'ulist', children: [],
    segments: [{ type: 'text', text: 'first referrer' }],
  };
  const deep = {
    guid: 'CTX_FAIL_DEEP', type: 'ulist', children: [],
    segments: [{ type: 'text', text: 'deep referrer' }],
  };
  for (const line of [first, deep]) {
    h.window.g_universe.itemsByGuid[line.guid] = {
      guid: line.guid, rguid: ownerGuid, lineItem: line,
    };
  }
  h.plugin._recordNameIndex.set(ownerGuid, 'Context failure owner');
  h.plugin._countCache = new Map([
    [first.guid, { count: 1, capped: false, sdkPropCount: 0, updatedAt: Date.now() }],
    [deep.guid, { count: 0, capped: false, sdkPropCount: 0, updatedAt: Date.now() }],
  ]);
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async (guid) => ({
      items: (guid === rootGuid ? [first] : guid === first.guid ? [deep] : [])
        .map((line) => ({ lineGuid: line.guid, recordGuid: ownerGuid })),
      complete: true,
    }),
  };
  h.plugin._loadLineRefContext = async () => null;
  h.plugin._resolveRefForChip = async () => ({
    targetGuid: rootGuid, isText: true, current: 'unavailable target',
    fallback: 'unavailable target', lineGuid: 'LINE_CLICK', pageGuid: 'PAGE_CLICK',
    segs: [], refIdx: 0,
  });
  h.chip.setAttribute('data-guid', rootGuid);
  h.plugin._positionPopover = () => {};

  h.window.dispatchEvent(event('click', { target: h.chip, button: 0, detail: 1 }));
  await tick(380);
  const pop = h.document.querySelector('.refx-refmenu');
  assert.ok(pop);
  assert.equal(pop.querySelector('.refalias-preview-empty').textContent,
    "Couldn't load this block's context");
  assert.ok(pop.querySelectorAll('.refx-chain-tree-row')
    .some((row) => row.dataset.guid === deep.guid),
  'the independent chain reaches depth two even though Block Context failed');
  h.plugin.onUnload();
});

test('v4.48.3 auto walk has no depth constant, traverses branches, guards cycles, and caps concurrency at two', async () => {
  const h = lineRefClickHarness({}, { injectStyle: true });
  const ownerGuid = 'DEEP_OWNER';
  h.plugin._recordNameIndex.set(ownerGuid, 'Deep owner');
  const lines = new Map();
  const line = (guid) => {
    const value = {
      guid, type: 'ulist', children: [], segments: [{ type: 'text', text: guid }],
    };
    lines.set(guid, value);
    h.window.g_universe.itemsByGuid[guid] = {
      guid, rguid: ownerGuid, lineItem: value,
    };
    return value;
  };
  const deep = Array.from({ length: 12 }, (_, index) => line('DEEP_' + (index + 1)));
  const branchA = line('DEEP_BRANCH_A');
  const branchB = line('DEEP_BRANCH_B');
  const graph = new Map([['DEEP_ROOT', [deep[0], branchA]]]);
  for (let index = 0; index < deep.length - 1; index++) {
    graph.set(deep[index].guid, [deep[index + 1]]);
  }
  graph.set(deep.at(-1).guid, []);
  graph.set(branchA.guid, [branchB]);
  graph.set(branchB.guid, [branchA]);
  h.plugin._countCache = new Map([...lines.values()].map((item) => [
    item.guid, {
      count: (graph.get(item.guid) || []).length,
      capped: false, sdkPropCount: 0, updatedAt: Date.now(),
    },
  ]));
  const calls = new Map();
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async (guid) => {
      calls.set(guid, (calls.get(guid) || 0) + 1);
      await tick(1);
      return {
        items: (graph.get(guid) || []).map((item) => ({
          lineGuid: item.guid, recordGuid: ownerGuid,
        })),
        complete: true,
      };
    },
  };
  const body = h.document.createElement('div');
  h.document.body.append(body);
  const section = h.plugin._appendLazyRefChainTree(body, 'DEEP_ROOT');
  await tick(180);
  const deepest = section.querySelectorAll('.refx-chain-tree-row')
    .find((row) => row.dataset.guid === deep.at(-1).guid);
  assert.ok(deepest, 'twelve incoming levels render with no depth setting');
  assert.equal(deepest.dataset.depth, '12');
  assert.ok(section.querySelector('.refx-chain-cycle-row'), 'the side branch terminates as a cycle');
  assert.ok(h.window.__REFX_CHAIN_DIAG.maxConcurrent <= 2);
  assert.equal(h.window.__REFX_CHAIN_DIAG.active, 0);
  assert.ok([...calls.values()].every((count) => count === 1),
    'each canonical level is resolved once');
  const deepRowLefts = deep.map((item) => section.querySelectorAll('.refx-chain-tree-row')
    .find((row) => row.dataset.guid === item.guid).getBoundingClientRect().left);
  const hopDeltas = deepRowLefts.slice(1).map((left, index) => left - deepRowLefts[index]);
  assert.deepEqual(hopDeltas, Array(deep.length - 1).fill(14),
    'successive rows move exactly fourteen layout pixels per hop');
  h.plugin.onUnload();
});

test('v4.48.3 detached hung tree times out, aborts, and yields both slots to its replacement', async () => {
  const h = lineRefClickHarness();
  h.plugin._REF_CHAIN_JOB_TIMEOUT_MS = 25;
  const ownerGuid = 'CANCEL_OWNER';
  const oldRows = Array.from({ length: 4 }, (_, index) => ({
    guid: 'CANCEL_OLD_' + index, type: 'ulist', children: [],
    segments: [{ type: 'text', text: 'old row ' + index }],
  }));
  const replacement = {
    guid: 'CANCEL_REPLACEMENT_ROW', type: 'ulist', children: [],
    segments: [{ type: 'text', text: 'replacement row' }],
  };
  for (const line of [...oldRows, replacement]) {
    h.window.g_universe.itemsByGuid[line.guid] = {
      guid: line.guid, rguid: ownerGuid, lineItem: line,
    };
  }
  h.plugin._recordNameIndex.set(ownerGuid, 'Cancellation owner');
  h.plugin._countCache = new Map([...oldRows, replacement].map((line) => [
    line.guid, { count: 0, capped: false, sdkPropCount: 0, updatedAt: Date.now() },
  ]));
  const oldGuids = new Set(oldRows.map((line) => line.guid));
  let physicalActive = 0;
  let physicalMax = 0;
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async (guid, options = {}) => {
      if (guid === 'CANCEL_ROOT') return {
        items: oldRows.map((line) => ({ lineGuid: line.guid, recordGuid: ownerGuid })),
        complete: true,
      };
      if (guid === 'CANCEL_REPLACEMENT') return {
        items: [{ lineGuid: replacement.guid, recordGuid: ownerGuid }], complete: true,
      };
      if (!oldGuids.has(guid)) return { items: [], complete: true };
      physicalActive++;
      physicalMax = Math.max(physicalMax, physicalActive);
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener?.('abort', () => {
          physicalActive--;
          const error = new Error('aborted stale tree');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    },
  };
  const body = h.document.createElement('div');
  h.document.body.append(body);
  const section = h.plugin._appendLazyRefChainTree(body, 'CANCEL_ROOT');
  assert.ok(await waitFor(() => h.window.__REFX_CHAIN_DIAG.active === 2, { timeout: 500 }));
  section.remove();
  const next = h.plugin._appendLazyRefChainTree(body, 'CANCEL_REPLACEMENT');
  assert.ok(await waitFor(() => (
    next.querySelectorAll('.refx-chain-tree-row')
      .some((row) => row.dataset.guid === replacement.guid)
      && h.window.__REFX_CHAIN_DIAG.active === 0
  ), { timeout: 500 }), 'the replacement tree progresses after the stale timeout');
  assert.equal(section.querySelectorAll('.refx-chain-tree-row').length, oldRows.length,
    'the detached tree receives no stale descendants');
  assert.equal(h.window.__REFX_CHAIN_DIAG.cancellations, 1);
  assert.equal(h.window.__REFX_CHAIN_DIAG.timedOut, 1);
  assert.ok(physicalMax <= 2, 'abort releases physical work before replacement work starts');
  assert.equal(physicalActive, 0);
  assert.equal(h.window.__REFX_CHAIN_DIAG.providerAbandonedActive, 0,
    'cooperative aborted providers settle their abandoned-operation counter');
  assert.equal(h.window.__REFX_CHAIN_DIAG.providerAbandonedTotal, 2);
  assert.equal(h.window.__REFX_CHAIN_DIAG.providerAbandonedSettled, 2);
  assert.equal(h.window.__REFX_CHAIN_DIAG.active, 0);
  h.plugin.onUnload();
});

test('v4.48.3 popup close aborts active jobs, clears queued pills, and starts a new tree', async () => {
  const h = lineRefClickHarness();
  const ownerGuid = 'CLOSE_OWNER';
  const oldRows = Array.from({ length: 4 }, (_, index) => ({
    guid: 'CLOSE_OLD_' + index, type: 'ulist', children: [],
    segments: [{ type: 'text', text: 'close old ' + index }],
  }));
  const nextRow = {
    guid: 'CLOSE_NEXT_ROW', type: 'ulist', children: [],
    segments: [{ type: 'text', text: 'close replacement' }],
  };
  for (const line of [...oldRows, nextRow]) {
    h.window.g_universe.itemsByGuid[line.guid] = {
      guid: line.guid, rguid: ownerGuid, lineItem: line,
    };
  }
  h.plugin._recordNameIndex.set(ownerGuid, 'Close owner');
  h.plugin._countCache = new Map([...oldRows, nextRow].map((line) => [
    line.guid, { count: 1, capped: false, sdkPropCount: 0, updatedAt: Date.now() },
  ]));
  const oldGuids = new Set(oldRows.map((line) => line.guid));
  const lateProviders = [];
  h.window.__thymerLineIndexV1 = {
    // Mirror the current production bridge: it accepts only the guid and its
    // underlying promise may ignore cancellation entirely.
    linesReferencing: async (guid) => {
      if (guid === 'CLOSE_ROOT') return {
        items: oldRows.map((line) => ({ lineGuid: line.guid, recordGuid: ownerGuid })),
        complete: true,
      };
      if (guid === 'CLOSE_NEXT') return {
        items: [{ lineGuid: nextRow.guid, recordGuid: ownerGuid }], complete: true,
      };
      if (!oldGuids.has(guid)) return { items: [], complete: true };
      const late = deferred();
      lateProviders.push(late);
      return late.promise;
    },
  };
  const oldPop = h.document.createElement('div');
  oldPop.className = 'refalias-pop refx-refmenu';
  h.plugin._openCardPopup(oldPop, h.chip, { focusInput: false });
  const oldSection = h.plugin._appendLazyRefChainTree(oldPop, 'CLOSE_ROOT');
  assert.ok(await waitFor(() => h.window.__REFX_CHAIN_DIAG.active === 2, { timeout: 500 }));
  const pills = Array.from(oldSection.querySelectorAll('.refx-chain-count-pill'));
  const children = Array.from(oldSection.querySelectorAll('.refx-chain-tree-children'));
  assert.equal(pills.length, oldRows.length);
  assert.ok(pills.every((pill) => pill.dataset.refxBusy === '1'));
  h.plugin._closeCardPopup();
  assert.equal(h.window.__REFX_CHAIN_DIAG.active, 0);
  assert.ok(pills.every((pill) => pill.dataset.refxBusy === undefined && pill.textContent !== '…'));
  assert.ok(children.every((node) => node.dataset.refxQueued === undefined));

  const nextPop = h.document.createElement('div');
  nextPop.className = 'refalias-pop refx-refmenu';
  h.plugin._openCardPopup(nextPop, h.chip, { focusInput: false });
  const nextSection = h.plugin._appendLazyRefChainTree(nextPop, 'CLOSE_NEXT');
  assert.ok(await waitFor(() => nextSection.querySelectorAll('.refx-chain-tree-row')
    .some((row) => row.dataset.guid === nextRow.guid), { timeout: 500 }),
  'non-cooperative old promises cannot retain the replacement tree scheduler');
  assert.ok(h.window.__REFX_CHAIN_DIAG.maxConcurrent <= 2);
  assert.equal(h.window.__REFX_CHAIN_DIAG.providerAbandonedActive, 2,
    'unsettled non-cooperative providers remain explicitly visible');
  assert.equal(h.window.__REFX_CHAIN_DIAG.providerAbandonedTotal, 2);
  for (const late of lateProviders) late.resolve({ items: [], complete: true });
  assert.ok(await waitFor(() => (
    h.window.__REFX_CHAIN_DIAG.providerAbandonedActive === 0
      && h.window.__REFX_CHAIN_DIAG.providerAbandonedSettled === 2
  ), { timeout: 500 }), 'late provider settlement retires the abandoned counter only');
  h.plugin.onUnload();
});

test('v4.48.3 hot reload carries abandoned-provider truth into the replacement diagnostic', async () => {
  const h = lineRefClickHarness();
  const ownerGuid = 'HOT_DIAG_OWNER';
  const rows = Array.from({ length: 2 }, (_, index) => ({
    guid: 'HOT_DIAG_ROW_' + index, type: 'ulist', children: [],
    segments: [{ type: 'text', text: 'hot diagnostic row ' + index }],
  }));
  for (const line of rows) {
    h.window.g_universe.itemsByGuid[line.guid] = {
      guid: line.guid, rguid: ownerGuid, lineItem: line,
    };
  }
  h.plugin._recordNameIndex.set(ownerGuid, 'Hot diagnostic owner');
  h.plugin._countCache = new Map(rows.map((line) => [
    line.guid, { count: 0, capped: false, sdkPropCount: 0, updatedAt: Date.now() },
  ]));
  const lateProviders = [];
  const rowGuids = new Set(rows.map((line) => line.guid));
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async (guid) => {
      if (guid === 'HOT_DIAG_ROOT') return {
        items: rows.map((line) => ({ lineGuid: line.guid, recordGuid: ownerGuid })),
        complete: true,
      };
      if (!rowGuids.has(guid)) return { items: [], complete: true };
      const late = deferred();
      lateProviders.push(late);
      return late.promise;
    },
  };
  const body = h.document.createElement('div');
  h.document.body.append(body);
  const section = h.plugin._appendLazyRefChainTree(body, 'HOT_DIAG_ROOT');
  assert.ok(await waitFor(() => h.window.__REFX_CHAIN_DIAG.active === 2, { timeout: 500 }));
  const oldDiag = h.window.__REFX_CHAIN_DIAG;
  h.window.__refxCancelChainTrees('hot-reload');
  assert.equal(oldDiag.active, 0);
  assert.equal(oldDiag.providerAbandonedActive, 2);
  const replacementDiag = { version: 2 };
  h.window.__REFX_CHAIN_DIAG = replacementDiag;
  h.plugin._syncRefChainProviderDiagnostics();
  assert.equal(replacementDiag.providerAbandonedActive, 2,
    'the replacement diagnostic adopts unsettled work from the old instance');
  for (const late of lateProviders) late.resolve({ items: [], complete: true });
  assert.ok(await waitFor(() => (
    replacementDiag.providerAbandonedActive === 0
      && replacementDiag.providerAbandonedSettled === 2
  ), { timeout: 500 }));
  assert.equal(section.querySelectorAll('.refx-chain-tree-row').length, rows.length,
    'late old-instance settlement cannot write through its cancelled state');
  h.plugin.onUnload();
});

function incompleteIncomingIndexHarness(rootGuid, indexAnswer, searchReferrers) {
  const h = lineRefClickHarness();
  const owner = { guid: rootGuid + '_OWNER', getName: () => 'Incoming owner' };
  const makeLine = (guid, text) => ({
    guid, type: 'ulist', children: [], segments: [{ type: 'text', text }],
    getRecord: () => owner,
  });
  const root = makeLine(rootGuid, 'incoming root');
  h.window.g_universe.itemsByGuid[root.guid] = {
    guid: root.guid, rguid: owner.guid, lineItem: root,
  };
  const indexCalls = [];
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async (guid) => {
      indexCalls.push(guid);
      return guid === root.guid ? indexAnswer : { items: [], complete: true };
    },
  };
  const searches = [];
  h.plugin.data.searchByQuery = async (query, cap) => {
    searches.push([query, cap]);
    return { records: [], lines: searchReferrers.slice(0, cap) };
  };
  return { h, owner, root, makeLine, indexCalls, searches };
}

test('v4.46.3 incomplete empty line index falls back to search and returns both live referrers', async () => {
  const rootGuid = '16KXTSZYE4PGMAFAM9WSM2S9GH';
  const setup = incompleteIncomingIndexHarness(
    rootGuid,
    { items: [], complete: false, cursor: null, capReason: 'reference-surface-partial' },
    []
  );
  const referrers = [
    setup.makeLine('1330PV7FC5OTHERREFERRER', 'another direct referrer'),
    setup.makeLine('18NEN6T50AZ2YM43GNYPR6YSJJ', 'just testing this out'),
  ];
  setup.h.plugin.data.searchByQuery = async (query, cap) => {
    setup.searches.push([query, cap]);
    return { records: [], lines: referrers.slice(0, cap) };
  };

  const chain = await setup.h.plugin._resolveRefChain(rootGuid, {
    direction: 'in', maxDepth: 1, maxFanout: 8,
  });
  assert.deepEqual(Array.from(chain, (hop) => hop.guid), referrers.map((line) => line.guid));
  assert.equal(chain.truncated, true, 'the incomplete index receipt remains visible in the budget');
  assert.deepEqual(setup.searches, [['@linkto = "' + rootGuid + '"', 32]]);
  setup.h.plugin.onUnload();
});

test('v4.46.3 partial non-empty line index merges search referrers and deduplicates by guid', async () => {
  const rootGuid = 'PARTIAL_INDEX_ROOT';
  const setup = incompleteIncomingIndexHarness(rootGuid, null, []);
  const a = setup.makeLine('PARTIAL_INDEX_A', 'indexed and searched referrer');
  const b = setup.makeLine('PARTIAL_INDEX_B', 'search-only referrer');
  setup.h.window.__thymerLineIndexV1.linesReferencing = async (guid) => {
    setup.indexCalls.push(guid);
    return guid === rootGuid
      ? { items: [a], complete: false, capReason: 'surface-partial' }
      : { items: [], complete: true };
  };
  setup.h.plugin.data.searchByQuery = async (query, cap) => {
    setup.searches.push([query, cap]);
    return { records: [], lines: [a, b].slice(0, cap) };
  };

  const chain = await setup.h.plugin._resolveRefChain(rootGuid, {
    direction: 'in', maxDepth: 1, maxFanout: 8,
  });
  assert.deepEqual(Array.from(chain, (hop) => hop.guid), [a.guid, b.guid]);
  assert.equal(chain.filter((hop) => hop.guid === a.guid).length, 1);
  assert.equal(chain.incomingReturnedLineCount, 2, 'the duplicate does not consume incoming-line budget');
  assert.equal(setup.searches.length, 1);
  setup.h.plugin.onUnload();
});

test('v4.48.1 a non-empty incomplete index skips search when it already fills the requested level', async () => {
  const rootGuid = 'PARTIAL_FULL_LEVEL_ROOT';
  const setup = incompleteIncomingIndexHarness(rootGuid, null, []);
  const indexed = Array.from({ length: 8 }, (_, index) => (
    setup.makeLine('PARTIAL_FULL_LEVEL_' + index, 'indexed referrer ' + index)
  ));
  setup.h.window.__thymerLineIndexV1.linesReferencing = async (guid) => {
    setup.indexCalls.push(guid);
    return guid === rootGuid
      ? { items: indexed, complete: false, capReason: 'surface-partial' }
      : { items: [], complete: true };
  };
  setup.h.plugin.data.searchByQuery = async (query, cap) => {
    setup.searches.push([query, cap]);
    return { records: [], lines: [] };
  };

  const chain = await setup.h.plugin._resolveRefChain(rootGuid, {
    direction: 'in', maxDepth: 1, maxFanout: 8,
  });
  assert.deepEqual(Array.from(chain, (hop) => hop.guid), indexed.map((line) => line.guid));
  assert.equal(setup.searches.length, 0,
    'the eager compatibility resolver does not query beyond a full requested level');

  const level = await setup.h.plugin._resolveRefLevel(rootGuid, {
    direction: 'in', limit: 8,
  });
  assert.deepEqual(Array.from(level, (row) => row.guid), indexed.map((line) => line.guid));
  assert.equal(setup.searches.length, 0,
    'the lazy level resolver follows the same incomplete-nonempty rule');
  setup.h.plugin.onUnload();
});

test('v4.46.3 complete empty line index is authoritative and issues no search', async () => {
  const rootGuid = 'COMPLETE_EMPTY_INDEX_ROOT';
  const setup = incompleteIncomingIndexHarness(
    rootGuid, { items: [], complete: true, cursor: null }, []
  );

  const chain = await setup.h.plugin._resolveRefChain(rootGuid, {
    direction: 'in', maxDepth: 1, maxFanout: 8,
  });
  assert.deepEqual(Array.from(chain), []);
  assert.equal(chain.truncated, false);
  assert.equal(setup.searches.length, 0);
  setup.h.plugin.onUnload();
});

test('v4.46.3 merged partial-index fallback preserves candidate and aggregate incoming caps', async () => {
  const rootGuid = 'PARTIAL_INDEX_CAP_ROOT';
  const setup = incompleteIncomingIndexHarness(rootGuid, null, []);
  const indexed = Array.from({ length: 40 }, (_, index) => (
    setup.makeLine('PARTIAL_CAP_INDEX_' + index, 'indexed referrer ' + index)
  ));
  const searched = Array.from({ length: 40 }, (_, index) => (
    setup.makeLine('PARTIAL_CAP_SEARCH_' + index, 'searched referrer ' + index)
  ));
  setup.h.window.__thymerLineIndexV1.linesReferencing = async (guid) => {
    setup.indexCalls.push(guid);
    return guid === rootGuid
      ? { items: indexed, complete: false, capReason: 'surface-partial' }
      : { items: [], complete: true };
  };
  setup.h.plugin.data.searchByQuery = async (query, cap) => {
    setup.searches.push([query, cap]);
    return { records: [], lines: searched.slice(0, cap) };
  };

  const chain = await setup.h.plugin._resolveRefChain(rootGuid, {
    direction: 'in', maxDepth: 1, maxFanout: 64,
  });
  assert.equal(chain.length, 61,
    'the shared 64-call SDK budget leaves 61 hydrated rows after root and search discovery');
  assert.equal(chain.incomingReturnedLineCount, setup.h.plugin._REF_CHAIN_INCOMING_LINE_CAP);
  assert.equal(chain.incomingQueryCount, 1);
  assert.equal(chain.sdkCallCount, setup.h.plugin._REF_CHAIN_SDK_CALL_CAP);
  assert.equal(chain.truncated, true);
  assert.deepEqual(setup.searches.map(([, cap]) => cap), [32]);
  assert.deepEqual(Array.from(chain, (hop) => hop.guid), [
    ...indexed.slice(0, 32).map((line) => line.guid),
    ...searched.slice(0, 32).map((line) => line.guid),
  ].slice(0, 61));
  setup.h.plugin.onUnload();
});

test('v4.46.2 popup-mode both traversal keeps incoming and outgoing cycle guards independent', async () => {
  const h = lineRefClickHarness();
  const owner = { guid: 'BOTH_OWNER', getName: () => 'Both owner' };
  const makeLine = (guid, targetGuid, text) => ({
    guid, type: 'ulist', children: [], getRecord: () => owner,
    segments: [
      { type: 'ref', text: { guid: targetGuid, title: targetGuid } },
      { type: 'text', text },
    ],
  });
  const a = makeLine('BOTH_A', 'BOTH_B', 'cycle A');
  const b = makeLine('BOTH_B', 'BOTH_A', 'cycle B');
  for (const line of [a, b]) {
    h.window.g_universe.itemsByGuid[line.guid] = { guid: line.guid, rguid: owner.guid, lineItem: line };
  }
  h.window.__thymerLineIndexV1 = {
    linesReferencing: (guid) => guid === a.guid ? [b] : (guid === b.guid ? [a] : []),
  };

  const chain = await h.plugin._resolveRefChain(a.guid, {
    direction: 'both', maxDepth: 4, maxFanout: 8,
  });
  assert.deepEqual(Array.from(chain, (hop) => [hop.guid, hop.via]), [
    [b.guid, 'inline'],
    [b.guid, 'in'],
  ]);
  assert.equal(chain.filter((hop) => hop.via === 'in').length, 1,
    'a real referrer is not suppressed merely because outgoing traversal saw the same GUID');
  h.plugin.onUnload();
});

test('v4.48.1 both traversal gives IN an independent budget after OUT exhausts its half', async () => {
  const h = lineRefClickHarness();
  const owner = { guid: 'BUDGET_OWNER', getName: () => 'Budget owner' };
  const makeLine = (guid, text) => ({
    guid, type: 'ulist', children: [], record: owner,
    segments: [{ type: 'text', text }], getRecord: () => owner,
  });
  const root = makeLine('BUDGET_ROOT', 'budget root');
  const in1 = makeLine('BUDGET_IN_1', 'incoming one');
  const in2 = makeLine('BUDGET_IN_2', 'incoming two');
  const in3 = makeLine('BUDGET_IN_3', 'incoming three');
  for (const line of [root, in1, in2, in3]) {
    h.window.g_universe.itemsByGuid[line.guid] = {
      guid: line.guid, rguid: owner.guid, lineItem: line,
    };
  }
  const incoming = new Map([
    [root.guid, [in1]], [in1.guid, [in2]], [in2.guid, [in3]], [in3.guid, []],
  ]);
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async (guid) => ({ items: incoming.get(guid) || [], complete: true }),
  };
  h.plugin._REF_CHAIN_SDK_CALL_CAP = 5;
  const originalOutgoing = h.plugin._refChainOutgoing.bind(h.plugin);
  h.plugin._refChainOutgoing = async (source, fanout, includeSubtree, budget) => {
    if (source?.guid === root.guid) {
      while (h.plugin._refChainBudgetTake(budget, 'sdk')) {}
      return { admitted: [], omitted: [], scannedLineGuids: new Set() };
    }
    return originalOutgoing(source, fanout, includeSubtree, budget);
  };

  const chain = await h.plugin._resolveRefChain(root.guid, {
    direction: 'both', maxDepth: 3, maxFanout: 1,
  });
  assert.deepEqual(Array.from(chain, (hop) => [hop.guid, hop.depth, hop.via]), [
    [in1.guid, 1, 'in'], [in2.guid, 2, 'in'], [in3.guid, 3, 'in'],
  ]);
  assert.equal(chain.truncated, true, 'the exhausted OUT half remains visible');
  assert.ok(chain.sdkCallCount > h.plugin._REF_CHAIN_SDK_CALL_CAP,
    'reported work aggregates two independently capped direction budgets');
  h.plugin.onUnload();
});

test('v4.46.2 preferred incoming index caps 5000 candidates and clamps the rendered more count', async () => {
  const h = lineRefClickHarness();
  const owner = { guid: 'INDEX_CAP_OWNER', getName: () => 'Index cap owner' };
  const root = {
    guid: 'INDEX_CAP_ROOT', type: 'ulist', children: [], segments: [{ type: 'text', text: 'root' }],
    getRecord: () => owner,
  };
  h.window.g_universe.itemsByGuid[root.guid] = { guid: root.guid, rguid: owner.guid, lineItem: root };
  const referrers = Array.from({ length: 5000 }, (_, index) => ({
    guid: 'INDEX_CAP_REF_' + index,
    type: 'ulist', children: [], segments: [{ type: 'text', text: 'referrer ' + index }],
    getRecord: () => owner,
  }));
  h.window.__thymerLineIndexV1 = {
    linesReferencing: (guid) => guid === root.guid ? referrers : [],
  };

  const chain = await h.plugin._resolveRefChain(root.guid, {
    direction: 'in', maxDepth: 1, maxFanout: 8,
  });
  assert.equal(chain.length, 8);
  assert.equal(chain.inMoreCount, 24, 'only the capped 32-candidate window contributes to +N more');
  assert.equal(chain.sourceLineGuids.length, 32);
  assert.ok(h.plugin._refChainInvalidationIndex.size <= 34,
    'one oversized index result cannot create thousands of invalidation entries');
  const body = h.document.createElement('div'); h.document.body.append(body);
  h.plugin._appendRefChainSection(body, root.guid, chain);
  assert.equal(body.querySelector('.refx-ref-chain-more').textContent, '+24 more');
  h.plugin.onUnload();
});

test('v4.46.2 incoming searches share a 64-returned-line budget, use the SDK lane, and cannot starve', async () => {
  const h = lineRefClickHarness();
  const idleOptions = [];
  h.context.requestIdleCallback = (fn, options) => {
    idleOptions.push(options);
    return setTimeout(() => fn({ didTimeout: false }), 0);
  };
  let searches = 0;
  h.plugin.data.searchByQuery = async (_query, cap) => {
    const batch = searches++;
    return {
      lines: Array.from({ length: cap }, (_, index) => 'SEARCH_' + batch + '_' + index),
    };
  };
  const budget = h.plugin._newRefChainBudget();
  const first = await h.plugin._refChainIncoming('SEARCH_ROOT_1', 32, budget);
  const second = await h.plugin._refChainIncoming('SEARCH_ROOT_2', 32, budget);
  const refused = await h.plugin._refChainIncoming('SEARCH_ROOT_3', 32, budget);

  assert.equal(first.scannedLineGuids.size, 32);
  assert.equal(second.scannedLineGuids.size, 32);
  assert.equal(refused.scannedLineGuids.size, 0);
  assert.equal(searches, 2);
  assert.equal(budget.incomingLines, h.plugin._REF_CHAIN_INCOMING_LINE_CAP);
  assert.equal(budget.sdkCalls, 2, 'each @linkto search is charged to the shared SDK budget');
  assert.equal(budget.incomingQueries, 2);
  assert.equal(budget.truncated, true);
  assert.deepEqual(idleOptions.filter(Boolean).map((options) => options.timeout), [200, 200]);
  h.plugin.onUnload();
});

test('v4.46.2 incoming-only empty cache is invalidated when its root owner gains a line', async () => {
  const h = lineRefClickHarness();
  const owner = { guid: 'IN_ONLY_OWNER', getName: () => 'Incoming only owner' };
  const root = {
    guid: 'IN_ONLY_ROOT', type: 'ulist', children: [], segments: [{ type: 'text', text: 'root' }],
    getRecord: () => owner,
  };
  h.window.g_universe.itemsByGuid[root.guid] = { guid: root.guid, rguid: owner.guid, lineItem: root };
  h.plugin.data.searchByQuery = async () => ({ lines: [] });

  const empty = await h.plugin._resolveRefChain(root.guid, {
    direction: 'in', maxDepth: 4, maxFanout: 8,
  });
  assert.deepEqual(Array.from(empty), []);
  assert.deepEqual(Array.from(empty.ownerRecordGuids), [owner.guid]);
  assert.equal(h.plugin._refChainCacheGet(root.guid, 4, 8, true, 'in'), empty);
  h.plugin._invalidateLineRefContextForEvent({
    lineItemGuid: 'IN_ONLY_NEW_REFERRER', recordGuid: owner.guid,
  }, 'lineitem.created');
  assert.equal(h.plugin._refChainCacheGet(root.guid, 4, 8, true, 'in'), null);
  h.plugin.onUnload();
});

test('v4.47 one-level bridge returns a frozen counted level without warming an eager chain', async () => {
  const h = lineRefClickHarness();
  let bodyReads = 0;
  const owner = {
    guid: 'LEVEL_OWNER', getName: () => 'Level owner',
    getLineItems: async () => { bodyReads++; return []; },
  };
  const child = {
    guid: 'LEVEL_CHILD', type: 'ulist', children: [],
    segments: [{ type: 'text', text: 'level child' }], getRecord: () => owner,
  };
  h.plugin._recordNameIndex.set(owner.guid, owner.getName());
  h.window.g_universe.itemsByGuid[child.guid] = {
    guid: child.guid, rguid: owner.guid, lineItem: child,
  };
  const outChild = {
    guid: 'LEVEL_OUT_CHILD', type: 'ulist', children: [],
    segments: [{ type: 'text', text: 'outgoing child' }],
  };
  h.window.g_universe.itemsByGuid[outChild.guid] = {
    guid: outChild.guid, rguid: owner.guid, lineItem: outChild,
  };
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async (guid) => ({
      items: guid === 'LEVEL_ROOT' ? [{ lineGuid: child.guid, recordGuid: owner.guid }] : [],
      complete: true, knownTotal: guid === 'LEVEL_ROOT' ? 1 : 0,
    }),
  };
  h.plugin._countCache = new Map();
  h.plugin.setCachedCountInfo(child.guid, { count: 2, capped: false });
  h.plugin.setCachedCountInfo(outChild.guid, { count: 4, capped: false });
  h.plugin._referenceSurfaceBroker = {
    revision: 1,
    snapshot: () => ({ complete: true }),
    outEdges: (guid) => guid === 'LEVEL_ROOT' ? [{
      kind: 'ref', title: 'outgoing child',
      target: { guid: outChild.guid, kind: 'line' },
      provenance: { segmentType: 'ref' },
    }] : [],
  };

  const level = await h.window.__refx.resolveRefLevel('LEVEL_ROOT', { direction: 'in' });
  assert.equal(Object.isFrozen(level), true);
  assert.equal(Object.isFrozen(level[0]), true);
  assert.deepEqual(Array.from(level, (row) => [row.guid, row.inboundCount, row.sourceRecordName]), [
    [child.guid, 2, owner.getName()],
  ]);
  assert.equal(Object.hasOwn(level, 'bodyReadCount'), false,
    'the bridge does not publish a hardcoded body-read counter');
  assert.equal(bodyReads, 0, 'the probe observes zero record-body reads');
  assert.ok(level.indexLookupCount >= 1);
  assert.equal(level.countLookupCount, 0);
  const outgoing = await h.window.__refx.resolveRefLevel('LEVEL_ROOT', { direction: 'out' });
  assert.deepEqual(Array.from(outgoing, (row) => [row.guid, row.inboundCount, row.via]), [
    [outChild.guid, 4, 'ref'],
  ]);
  assert.equal(bodyReads, 0, 'outgoing level resolution also performs zero body reads');
  assert.equal(h.plugin._refChainCacheGet('LEVEL_ROOT', 4, 8, true, 'both'), null);
  h.plugin.onUnload();
});

test('v4.48.3 lazy @linkto fallback honors requested limits from 33 through the normalized 200 cap', async () => {
  const h = lineRefClickHarness();
  const ownerGuid = 'LEVEL_LIMIT_OWNER';
  const rows = Array.from({ length: 220 }, (_, index) => {
    const line = {
      guid: 'LEVEL_LIMIT_ROW_' + index,
      type: 'ulist', children: [],
      segments: [{ type: 'text', text: 'level limit row ' + index }],
    };
    h.window.g_universe.itemsByGuid[line.guid] = {
      guid: line.guid, rguid: ownerGuid, lineItem: line,
    };
    return line;
  });
  h.plugin._recordNameIndex.set(ownerGuid, 'Level limit owner');
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async () => ({
      items: [], complete: false, capReason: 'line-index-partial',
    }),
  };
  const searches = [];
  h.plugin.data.searchByQuery = async (query, limit) => {
    searches.push([query, limit]);
    return {
      records: [],
      lines: rows.slice(0, limit),
      complete: rows.length <= limit,
      truncated: rows.length > limit,
      capReason: rows.length > limit ? 'search-provider-cap' : null,
      knownTotal: rows.length,
    };
  };

  const level33 = await h.plugin._resolveRefLevel('LEVEL_LIMIT_ROOT_33', {
    direction: 'in', limit: 33,
  });
  const level200 = await h.plugin._resolveRefLevel('LEVEL_LIMIT_ROOT_200', {
    direction: 'in', limit: 999,
  });

  assert.deepEqual(searches.map(([, limit]) => limit), [33, 200],
    'the lazy fallback receives the normalized caller limit, never the eager 32-row cap');
  assert.equal(level33.length, 33);
  assert.equal(level33.at(-1).guid, rows[32].guid);
  assert.equal(level200.length, 200);
  assert.equal(level200.at(-1).guid, rows[199].guid);
  assert.equal(level200.truncated, true);
  assert.equal(level200.knownTotal, rows.length);
  h.plugin.onUnload();
});

test('v4.48.3 exact under-limit fallback clears stale partial-provider metadata', async () => {
  const h = lineRefClickHarness();
  const ownerGuid = 'EXACT_FALLBACK_OWNER';
  const rows = ['A', 'B'].map((suffix) => {
    const line = {
      guid: 'EXACT_FALLBACK_' + suffix,
      type: 'ulist', children: [],
      segments: [{ type: 'text', text: 'exact fallback ' + suffix }],
    };
    h.window.g_universe.itemsByGuid[line.guid] = {
      guid: line.guid, rguid: ownerGuid, lineItem: line,
    };
    return line;
  });
  h.plugin._recordNameIndex.set(ownerGuid, 'Exact fallback owner');
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async () => ({
      items: [{ lineGuid: rows[0].guid, recordGuid: ownerGuid }],
      complete: false,
      truncated: true,
      knownTotal: 999,
      capReason: 'stale-line-index-cap',
    }),
  };
  h.plugin.data.searchByQuery = async () => ({
    records: [],
    lines: rows,
    complete: true,
    truncated: false,
    knownTotal: rows.length,
  });

  const level = await h.plugin._resolveRefLevel('EXACT_FALLBACK_ROOT', {
    direction: 'in', limit: 200,
  });
  assert.deepEqual(Array.from(level, (row) => row.guid), rows.map((row) => row.guid),
    'the overlapping Line Index row is deduplicated from the exact fallback');
  assert.equal(level.complete, true);
  assert.equal(level.truncated, false);
  assert.equal(level.capReason, null);
  assert.equal(level.knownTotal, rows.length,
    'stale partial-provider totals never survive an authoritative fallback');
  h.plugin.onUnload();
});

test('v4.48.3 partial providers below 200 show a non-exact Workbench escape', async () => {
  const h = lineRefClickHarness();
  const ownerGuid = 'PARTIAL_LEVEL_OWNER';
  const rows = Array.from({ length: 35 }, (_, index) => {
    const line = {
      guid: 'PARTIAL_LEVEL_ROW_' + index,
      type: 'ulist', children: [],
      segments: [{ type: 'text', text: 'partial level row ' + index }],
    };
    h.window.g_universe.itemsByGuid[line.guid] = {
      guid: line.guid, rguid: ownerGuid, lineItem: line,
    };
    return line;
  });
  h.plugin._recordNameIndex.set(ownerGuid, 'Partial level owner');
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async (guid) => guid === 'PARTIAL_LEVEL_ROOT'
      ? { items: rows, complete: false, capReason: 'provider-cap-35' }
      : { items: [], complete: true },
  };
  const searches = [];
  h.plugin.data.searchByQuery = async (query, limit) => {
    searches.push([query, limit]);
    const isRoot = query.includes('PARTIAL_LEVEL_ROOT');
    return {
      records: [], lines: isRoot ? rows.slice(0, 35) : [],
      complete: !isRoot, truncated: isRoot, capReason: isRoot ? 'provider-cap-35' : null,
    };
  };

  const body = h.document.createElement('div');
  h.document.body.append(body);
  const section = h.plugin._appendLazyRefChainTree(body, 'PARTIAL_LEVEL_ROOT');
  assert.ok(await waitFor(() => (
    section.querySelectorAll('.refx-chain-tree-row').length === rows.length
      && section.querySelector('.refx-chain-workbench')
      && h.window.__REFX_CHAIN_DIAG.active === 0
  ), { timeout: 1000 }));
  const rootSearches = searches.filter(([query]) => query.includes('PARTIAL_LEVEL_ROOT'));
  assert.deepEqual(rootSearches.map(([, limit]) => limit), [200],
    'the partial root still performs one exact fallback; empty descendant levels may confirm independently');
  const escape = section.querySelector('.refx-chain-cap-escape');
  assert.equal(escape.dataset.refxEscapeReason, 'provider-partial');
  const note = escape.querySelector('.refx-chain-cap-note');
  assert.equal(note.textContent, 'Some references may be missing from this popup');
  assert.doesNotMatch(note.textContent, /\+\d+|\d+\s+more/i,
    'a partial provider never invents an exact remaining-row count');
  assert.equal(section.querySelector('.refx-chain-workbench').textContent, 'Open in Workbench');
  h.plugin.onUnload();
});

test('v4.48.3 a deep partial escape remains at the tree root when its branch collapses', async () => {
  const h = lineRefClickHarness();
  const ownerGuid = 'DEEP_PARTIAL_OWNER';
  const makeLine = (guid, text) => {
    const line = {
      guid, type: 'ulist', children: [], segments: [{ type: 'text', text }],
    };
    h.window.g_universe.itemsByGuid[guid] = {
      guid, rguid: ownerGuid, lineItem: line,
    };
    return line;
  };
  const parent = makeLine('DEEP_PARTIAL_PARENT', 'deep partial parent');
  const leaf = makeLine('DEEP_PARTIAL_LEAF', 'deep partial leaf');
  h.plugin._recordNameIndex.set(ownerGuid, 'Deep partial owner');
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async (guid) => {
      if (guid === 'DEEP_PARTIAL_ROOT') {
        return {
          items: [{ lineGuid: parent.guid, recordGuid: ownerGuid }], complete: true,
        };
      }
      if (guid === parent.guid) {
        return {
          items: [{ lineGuid: leaf.guid, recordGuid: ownerGuid }],
          complete: false, truncated: true, capReason: 'deep-line-index-cap',
        };
      }
      return { items: [], complete: true };
    },
  };
  h.plugin.data.searchByQuery = async (query) => ({
    records: [],
    lines: query.includes(parent.guid) ? [leaf] : [],
    complete: query.includes(parent.guid) ? false : true,
    truncated: query.includes(parent.guid),
    capReason: query.includes(parent.guid) ? 'deep-search-cap' : null,
  });

  const body = h.document.createElement('div');
  h.document.body.append(body);
  const section = h.plugin._appendLazyRefChainTree(body, 'DEEP_PARTIAL_ROOT');
  assert.ok(await waitFor(() => (
    section.querySelector('.refx-chain-cap-escape')
      && h.window.__REFX_CHAIN_DIAG.active === 0
  ), { timeout: 1000 }));
  const tree = section.querySelector('.refx-chain-tree-root');
  const escape = section.querySelector('.refx-chain-cap-escape');
  const parentRow = section.querySelectorAll('.refx-chain-tree-row')
    .find((row) => row.dataset.guid === parent.guid);
  const children = parentRow.querySelector('.refx-chain-tree-children');
  const pill = parentRow.querySelector('.refx-chain-count-pill');
  assert.equal(escape.parentElement, tree,
    'provider-partial status is a direct root child, not deep branch content');
  assert.equal(escape.closest('.refx-chain-tree-children'), null);
  pill.click();
  assert.equal(children.classList.contains('refx-hidden'), true);
  assert.equal(escape.closest('.refx-hidden'), null,
    'collapsing the partial branch leaves the Workbench escape visible');
  h.plugin.onUnload();
});

test('v4.48.3 level cache identity keeps small and large limits independent in both orders', async () => {
  const h = lineRefClickHarness();
  const ownerGuid = 'LEVEL_CACHE_OWNER';
  const rows = Array.from({ length: 10 }, (_, index) => {
    const line = {
      guid: 'LEVEL_CACHE_ROW_' + index,
      type: 'ulist', children: [],
      segments: [{ type: 'text', text: 'level cache row ' + index }],
    };
    h.window.g_universe.itemsByGuid[line.guid] = {
      guid: line.guid, rguid: ownerGuid, lineItem: line,
    };
    return line;
  });
  const calls = new Map();
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async (guid) => {
      calls.set(guid, (calls.get(guid) || 0) + 1);
      return { items: rows, complete: true, knownTotal: rows.length };
    },
  };

  const smallFirst = await h.plugin._resolveRefLevel('CACHE_SMALL_FIRST', {
    direction: 'in', limit: 3,
  });
  const largeSecond = await h.plugin._resolveRefLevel('CACHE_SMALL_FIRST', {
    direction: 'in', limit: 10,
  });
  assert.equal(smallFirst.length, 3);
  assert.equal(smallFirst.truncated, true);
  assert.equal(smallFirst.knownTotal, rows.length);
  assert.equal(largeSecond.length, 10);
  assert.equal(largeSecond.truncated, false);
  assert.equal(largeSecond.knownTotal, rows.length);
  assert.equal(calls.get('CACHE_SMALL_FIRST'), 2,
    'a small cached level cannot satisfy a later larger request');

  const largeFirst = await h.plugin._resolveRefLevel('CACHE_LARGE_FIRST', {
    direction: 'in', limit: 10,
  });
  const smallSecond = await h.plugin._resolveRefLevel('CACHE_LARGE_FIRST', {
    direction: 'in', limit: 3,
  });
  assert.equal(largeFirst.length, 10);
  assert.equal(smallSecond.length, 3);
  assert.equal(smallSecond.truncated, true);
  assert.equal(calls.get('CACHE_LARGE_FIRST'), 2,
    'a distinct small request keeps its own frozen metadata and row bound');

  const normalized = await h.plugin._resolveRefLevel('CACHE_NORMALIZED', {
    direction: 'in', limit: 999,
  });
  const exactCap = await h.plugin._resolveRefLevel('CACHE_NORMALIZED', {
    direction: 'in', limit: 200,
  });
  assert.equal(exactCap, normalized,
    'equivalent normalized limits reuse the exact cached frozen result');
  assert.equal(calls.get('CACHE_NORMALIZED'), 1);
  h.plugin.onUnload();
});

test('v4.48.3 differently limited concurrent levels never share the wrong pending promise', async () => {
  const h = lineRefClickHarness();
  const ownerGuid = 'LEVEL_PENDING_OWNER';
  const rows = Array.from({ length: 8 }, (_, index) => {
    const line = {
      guid: 'LEVEL_PENDING_ROW_' + index,
      type: 'ulist', children: [],
      segments: [{ type: 'text', text: 'level pending row ' + index }],
    };
    h.window.g_universe.itemsByGuid[line.guid] = {
      guid: line.guid, rguid: ownerGuid, lineItem: line,
    };
    return line;
  });
  const providers = [];
  h.window.__thymerLineIndexV1 = {
    linesReferencing: () => {
      const gate = deferred();
      providers.push(gate);
      return gate.promise;
    },
  };

  const smallPending = h.plugin._resolveRefLevel('PENDING_LIMIT_ROOT', {
    direction: 'in', limit: 2,
  });
  const largePending = h.plugin._resolveRefLevel('PENDING_LIMIT_ROOT', {
    direction: 'in', limit: 8,
  });
  assert.equal(providers.length, 2,
    'different normalized limits have independent pending identities');
  for (const provider of providers) {
    provider.resolve({ items: rows, complete: true, knownTotal: rows.length });
  }
  const [small, large] = await Promise.all([smallPending, largePending]);
  assert.equal(small.length, 2);
  assert.equal(large.length, 8);
  assert.equal(small.knownTotal, rows.length);
  assert.equal(large.knownTotal, rows.length);
  h.plugin.onUnload();
});

test('v4.47 incomplete-empty level fallback preserves its last good snapshot with zero body reads', async () => {
  const h = lineRefClickHarness();
  const owner = { guid: 'SNAP_OWNER', getName: () => 'Snapshot owner' };
  let bodyReads = 0;
  owner.getLineItems = async () => { bodyReads++; return []; };
  const child = {
    guid: 'SNAP_CHILD', type: 'ulist', children: [],
    segments: [{ type: 'text', text: 'snapshot child' }], getRecord: () => owner,
  };
  h.window.g_universe.itemsByGuid[child.guid] = {
    guid: child.guid, rguid: owner.guid, lineItem: child,
  };
  h.plugin._recordNameIndex.set(owner.guid, owner.getName());
  h.plugin._countCache = new Map([[
    child.guid, { count: 3, capped: false, sdkPropCount: 0, updatedAt: Date.now() },
  ]]);
  let indexCalls = 0;
  let searchCalls = 0;
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async () => {
      indexCalls++;
      return { items: [], complete: false, capReason: 'reference-surface-partial' };
    },
  };
  h.plugin.data.searchByQuery = async () => {
    searchCalls++;
    return { records: [], lines: [child] };
  };

  const good = await h.plugin._resolveRefLevel('SNAP_ROOT', { direction: 'in' });
  assert.deepEqual(Array.from(good, (row) => [row.guid, row.inboundCount]), [[child.guid, 3]]);
  assert.equal(bodyReads, 0);
  assert.equal(indexCalls, 1);
  assert.equal(searchCalls, 1, 'an incomplete empty answer falls back to exact @linkto');

  h.window.__thymerLineIndexV1.linesReferencing = async () => { throw new Error('index offline'); };
  h.plugin.data.searchByQuery = async () => { throw new Error('search offline'); };
  const preserved = await h.plugin._resolveRefLevel('SNAP_ROOT', {
    direction: 'in', refresh: true,
  });
  assert.equal(preserved, good, 'a failed refresh returns the exact last-good frozen snapshot');
  assert.equal(bodyReads, 0);
  assert.match(h.window.__REFX_LAST_ERROR, /ref level incoming search/);
  h.plugin.onUnload();
});

test('v4.48.3 all-provider failure is a retryable failed level, while mixed-provider success resolves', async () => {
  const h = lineRefClickHarness();
  const ownerGuid = 'FAIL_LEVEL_OWNER';
  const recovered = {
    guid: 'FAIL_LEVEL_RECOVERED', type: 'ulist', children: [],
    segments: [{ type: 'text', text: 'recovered through search' }],
  };
  h.window.g_universe.itemsByGuid[recovered.guid] = {
    guid: recovered.guid, rguid: ownerGuid, lineItem: recovered,
  };
  h.plugin._recordNameIndex.set(ownerGuid, 'Failure recovery owner');
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async () => { throw new Error('line index offline'); },
  };
  let searchHealthy = false;
  h.plugin.data.searchByQuery = async (query) => {
    if (!searchHealthy) throw new Error('search offline');
    const guid = query.match(/"([^"]+)"/)?.[1] || '';
    return {
      records: [],
      lines: guid === 'FAIL_LEVEL_ROOT' ? [recovered] : [],
    };
  };

  const body = h.document.createElement('div');
  h.document.body.append(body);
  const section = h.plugin._appendLazyRefChainTree(body, 'FAIL_LEVEL_ROOT');
  assert.ok(await waitFor(() => (
    section.querySelector('.refx-chain-level-error')
      && h.window.__REFX_CHAIN_DIAG.active === 0
  ), { timeout: 500 }));
  assert.equal(section.querySelector('.refx-ref-chain-empty'), null,
    'provider outage is never rendered as a false empty leaf');
  assert.equal(h.window.__REFX_CHAIN_DIAG.levelsFailed, 1);
  assert.equal(h.window.__REFX_CHAIN_DIAG.levelsResolved, 0);
  const retry = section.querySelector('.refx-chain-level-retry');
  assert.equal(retry.textContent, 'Retry');

  searchHealthy = true;
  retry.click();
  assert.ok(await waitFor(() => (
    section.querySelectorAll('.refx-chain-tree-row')
      .some((row) => row.dataset.guid === recovered.guid)
      && h.window.__REFX_CHAIN_DIAG.active === 0
  ), { timeout: 500 }), 'successful search recovers even while the line-index provider still fails');
  assert.equal(section.querySelector('.refx-chain-level-error'), null);
  assert.equal(h.window.__REFX_CHAIN_DIAG.levelsFailed, 1,
    'the failed attempt remains truthful after retry');
  assert.ok(h.window.__REFX_CHAIN_DIAG.levelsResolved >= 2,
    'the recovered root and its successful empty child level resolve normally');
  h.plugin.onUnload();
});

test('v4.48.4 auto-expanded cold rows derive pill counts once while confirming empty leaves exactly', async () => {
  const h = lineRefClickHarness();
  const ownerGuid = 'COLD_COUNT_OWNER';
  const row = {
    guid: 'COLD_COUNT_ROW', type: 'ulist', children: [],
    segments: [{ type: 'text', text: 'cold counted row' }],
  };
  h.window.g_universe.itemsByGuid[row.guid] = {
    guid: row.guid, rguid: ownerGuid, lineItem: row,
  };
  const grandchildren = Array.from({ length: 7 }, (_, index) => ({
    guid: 'COLD_COUNT_GRANDCHILD_' + index, type: 'ulist', children: [],
    segments: [{ type: 'text', text: 'cold grandchild ' + index }],
  }));
  for (const line of grandchildren) {
    h.window.g_universe.itemsByGuid[line.guid] = {
      guid: line.guid, rguid: ownerGuid, lineItem: line,
    };
  }
  h.plugin._recordNameIndex.set(ownerGuid, 'Cold count owner');
  h.plugin._countCache = new Map();
  let levelCalls = 0;
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async (guid) => {
      levelCalls++;
      return {
        items: (guid === 'COLD_COUNT_ROOT' ? [row]
          : guid === row.guid ? grandchildren : [])
          .map((line) => ({ lineGuid: line.guid, recordGuid: ownerGuid })),
        complete: true,
        knownTotal: guid === row.guid ? grandchildren.length : null,
      };
    },
  };
  let searchCalls = 0;
  h.plugin.data.searchByQuery = async () => {
    searchCalls++;
    return { records: [], lines: [] };
  };
  let countCalls = 0;
  h.plugin.getCountInfoForGuid = async () => {
    countCalls++;
    throw new Error('auto-expanded rows must not launch a second count query');
  };

  const level = await h.plugin._resolveRefLevel('COLD_COUNT_ROOT', { direction: 'in' });
  assert.equal(searchCalls, 0,
    'a cold count cache causes zero searchByQuery calls from the level resolve path');
  assert.equal(level[0].inboundCount, null);

  const body = h.document.createElement('div');
  h.document.body.append(body);
  const section = h.plugin._appendLazyRefChainTree(body, 'COLD_COUNT_ROOT');
  let rowEl = null;
  assert.ok(await waitFor(() => {
    rowEl = section.querySelectorAll('.refx-chain-tree-row')
      .find((candidate) => candidate.dataset.guid === row.guid) || null;
    return rowEl?.querySelector('.refx-chain-count-pill')?.textContent === '7'
      && h.window.__REFX_CHAIN_DIAG.active === 0;
  }, { timeout: 1000 }));
  const pill = rowEl.querySelector('.refx-chain-count-pill');
  assert.equal(pill.textContent, '7');
  assert.equal(countCalls, 0, 'one level resolution supplies both children and pill status');
  assert.equal(searchCalls, grandchildren.length,
    'each complete-looking empty child level is confirmed once through exact @linkto search');
  const settledLevelCalls = levelCalls;
  const children = rowEl.querySelector('.refx-chain-tree-children');
  assert.equal(children.dataset.refxResolved, '1');
  pill.click();
  assert.equal(children.classList.contains('refx-hidden'), true);
  assert.equal(pill.getAttribute('aria-expanded'), 'false');
  pill.click();
  assert.equal(children.classList.contains('refx-hidden'), false);
  assert.equal(pill.getAttribute('aria-expanded'), 'true');
  assert.equal(levelCalls, settledLevelCalls,
    'collapsing and reopening a resolved pill performs zero extra provider queries');
  h.plugin.onUnload();
});

test('v4.48.3 cold auto rows launch only globally capped level work, never duplicate counts', async () => {
  const h = lineRefClickHarness();
  const ownerGuid = 'COLD_SHARED_OWNER';
  const rows = Array.from({ length: 8 }, (_, index) => {
    const line = {
      guid: 'COLD_SHARED_' + index, type: 'ulist', children: [],
      segments: [{ type: 'text', text: 'shared cold row ' + index }],
    };
    h.window.g_universe.itemsByGuid[line.guid] = {
      guid: line.guid, rguid: ownerGuid, lineItem: line,
    };
    return line;
  });
  h.plugin._recordNameIndex.set(ownerGuid, 'Cold shared owner');
  h.plugin._countCache = new Map();
  let physicalActive = 0;
  let physicalMax = 0;
  const enter = async () => {
    physicalActive++;
    physicalMax = Math.max(physicalMax, physicalActive);
    await tick(4);
    physicalActive--;
  };
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async (guid) => {
      await enter();
      return {
        items: guid === 'COLD_SHARED_ROOT'
          ? rows.map((line) => ({ lineGuid: line.guid, recordGuid: ownerGuid }))
          : [],
        complete: true,
      };
    },
  };
  let countCalls = 0;
  h.plugin.getCountInfoForGuid = async () => {
    countCalls++;
    throw new Error('duplicate count work');
  };
  const body = h.document.createElement('div');
  h.document.body.append(body);
  const section = h.plugin._appendLazyRefChainTree(body, 'COLD_SHARED_ROOT');
  assert.ok(await waitFor(() => (
    section.querySelectorAll('.refx-chain-tree-row').length === rows.length
      && h.window.__REFX_CHAIN_DIAG.active === 0
  ), { timeout: 1000 }));
  assert.equal(countCalls, 0);
  assert.ok(physicalMax <= 2, 'cold auto-level I/O never exceeds two jobs');
  assert.ok(h.window.__REFX_CHAIN_DIAG.maxConcurrent <= 2);
  assert.equal(h.window.__REFX_CHAIN_DIAG.activeLevels, 0);
  h.plugin.onUnload();
});

test('v4.48.1 refresh requested during a pending level resolve runs after stale work settles', async () => {
  const h = lineRefClickHarness();
  const first = deferred();
  let calls = 0;
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async () => {
      calls++;
      if (calls === 1) return first.promise;
      return { items: [{ lineGuid: 'REFRESH_FRESH', recordGuid: 'REFRESH_OWNER' }], complete: true };
    },
  };
  const stalePending = h.plugin._resolveRefLevel('REFRESH_ROOT', { direction: 'in' });
  const refreshedPending = h.plugin._resolveRefLevel('REFRESH_ROOT', {
    direction: 'in', refresh: true,
  });
  first.resolve({
    items: [{ lineGuid: 'REFRESH_STALE', recordGuid: 'REFRESH_OWNER' }], complete: true,
  });
  const stale = await stalePending;
  const refreshed = await refreshedPending;
  assert.deepEqual(Array.from(stale, (item) => item.guid), ['REFRESH_STALE']);
  assert.deepEqual(Array.from(refreshed, (item) => item.guid), ['REFRESH_FRESH']);
  assert.equal(calls, 2, 'refresh chains a distinct resolve after the in-flight answer');
  h.plugin.onUnload();
});

test('v4.48.3 cold row text hydrates through the cooperative line-index lane, never a record body', async () => {
  const h = lineRefClickHarness();
  let bodyReads = 0;
  h.records.set('COLD_OWNER', {
    guid: 'COLD_OWNER', getName: () => 'Cold owner',
    getLineItems: async () => { bodyReads++; return []; },
  });
  h.plugin._recordNameIndex.set('COLD_OWNER', 'Cold owner');
  h.plugin._countCache = new Map([[
    'COLD_ROW', { count: 0, capped: false, sdkPropCount: 0, updatedAt: Date.now() },
  ]]);
  let resolvedTextCalls = 0;
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async () => ({
      items: [{ lineGuid: 'COLD_ROW', recordGuid: 'COLD_OWNER' }], complete: true,
    }),
    resolvedText: async (guid) => {
      resolvedTextCalls++;
      return guid === 'COLD_ROW' ? 'hydrated from line index' : '';
    },
  };
  const body = h.document.createElement('div');
  h.document.body.append(body);
  const section = h.plugin._appendLazyRefChainTree(body, 'COLD_ROOT');
  await tick(40);
  assert.equal(section.querySelector('.refx-chain-node-label').textContent, 'hydrated from line index');
  assert.equal(resolvedTextCalls, 1);
  assert.equal(bodyReads, 0);
  h.plugin.onUnload();
});

test('v4.48.3 auto tree marks cycles and duplicate paths without user expansion or repeat queries', async () => {
  const h = lineRefClickHarness();
  const ownerGuid = 'TREE_OWNER';
  h.plugin._recordNameIndex.set(ownerGuid, 'Tree owner');
  const makeState = (guid, text) => {
    const line = { guid, type: 'ulist', children: [], segments: [{ type: 'text', text }] };
    h.window.g_universe.itemsByGuid[guid] = { guid, rguid: ownerGuid, lineItem: line };
    return line;
  };
  const a = makeState('TREE_A', 'branch A');
  const b = makeState('TREE_B', 'branch B');
  const c = makeState('TREE_C', 'shared C');
  const graph = new Map([
    ['TREE_ROOT', [a, b]],
    [a.guid, [c]],
    [b.guid, [c]],
    [c.guid, [a]],
  ]);
  let levelQueries = 0;
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async (guid) => {
      levelQueries++;
      return {
        items: (graph.get(guid) || []).map((line) => ({ lineGuid: line.guid, recordGuid: ownerGuid })),
        complete: true,
      };
    },
  };
  h.plugin._countCache = new Map([a, b, c].map((line) => [
    line.guid, { count: 1, capped: false, sdkPropCount: 0, updatedAt: Date.now() },
  ]));
  const body = h.document.createElement('div');
  h.document.body.append(body);
  const section = h.plugin._appendLazyRefChainTree(body, 'TREE_ROOT');
  await tick(80);
  const row = (guid) => section.querySelectorAll('.refx-chain-tree-row')
    .find((node) => node.dataset.guid === guid) || null;
  assert.ok(row(a.guid));
  assert.ok(row(c.guid));
  assert.match(section.querySelector('.refx-chain-cycle-row').textContent, /↻ cycle/);
  assert.ok(row(b.guid));
  assert.match(section.querySelector('.refx-chain-duplicate-row').textContent, /↑ already shown · 2 paths/);
  assert.equal(levelQueries, 4, 'root plus exactly one indexed query per canonical node');
  assert.ok(h.window.__REFX_CHAIN_DIAG.maxConcurrent <= 2);
  h.plugin.onUnload();
});

test('v4.48.3 tree cooperatively reveals 8 then 40 automatically and stops at Workbench cap', async () => {
  const h = lineRefClickHarness();
  const ownerGuid = 'CAP_OWNER';
  h.plugin._recordNameIndex.set(ownerGuid, 'Cap owner');
  const children = Array.from({ length: 205 }, (_, index) => {
    const guid = 'CAP_CHILD_' + index;
    const line = { guid, type: 'ulist', children: [], segments: [{ type: 'text', text: 'cap child ' + index }] };
    h.window.g_universe.itemsByGuid[guid] = { guid, rguid: ownerGuid, lineItem: line };
    return line;
  });
  let rootProviderCalls = 0;
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async (guid) => {
      if (guid === 'CAP_ROOT') {
        rootProviderCalls++;
        return {
        items: children.map((line) => ({ lineGuid: line.guid, recordGuid: ownerGuid })),
        complete: true, knownTotal: children.length,
        };
      }
      return new Promise(() => {});
    },
  };
  h.plugin._countCache = new Map(children
    .filter((_line, index) => index !== 199)
    .map((line) => [
      line.guid, { count: 0, capped: false, sdkPropCount: 0, updatedAt: Date.now() },
    ]));
  const frames = [];
  h.context.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  const body = h.document.createElement('div');
  h.document.body.append(body);
  const section = h.plugin._appendLazyRefChainTree(body, 'CAP_ROOT');
  assert.equal(section.querySelectorAll('.refx-chain-tree-row').length, 0,
    'the cold root waits for the first paint frame');
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(rootProviderCalls, 0,
    'running the rAF callback is not itself a paint; no provider starts in that callback');
  await tick(1);
  assert.equal(rootProviderCalls, 1,
    'the root provider starts only after the post-rAF task boundary');
  assert.ok(await waitFor(() => (
    section.querySelectorAll('.refx-chain-tree-row').length === 8 && frames.length > 0
  ), { timeout: 500 }), 'the first resolved level paints exactly the initial batch');
  frames.shift()();
  assert.equal(section.querySelectorAll('.refx-chain-tree-row').length, 48,
    'one cooperative frame adds the configured forty-row batch');
  const deadline = Date.now() + 1000;
  while (!section.querySelector('.refx-chain-workbench') && Date.now() < deadline) {
    const frame = frames.shift();
    if (frame) frame();
    await tick(1);
  }
  assert.equal(section.querySelectorAll('.refx-chain-tree-row').length, 200);
  assert.equal(section.querySelector('.refx-chain-level-more'), null);
  const escape = section.querySelector('.refx-chain-cap-escape');
  assert.equal(escape.querySelector('.refx-chain-workbench').textContent, 'Open in Workbench');
  assert.equal(escape.parentElement, section.querySelector('.refx-chain-tree-root'),
    'a hard-cap escape is also rooted outside any collapsible branch');
  assert.ok(Array.from(section.querySelectorAll('.refx-chain-count-pill'))
    .every((pill) => pill.dataset.refxBusy === undefined && pill.textContent !== '…'),
  'cap truncation clears active and queued pill status');
  assert.ok(Array.from(section.querySelectorAll('.refx-chain-tree-children'))
    .every((node) => node.dataset.refxQueued === undefined),
  'cap truncation clears every queued child container');
  assert.equal(h.window.__REFX_CHAIN_DIAG.active, 0);
  h.plugin.onUnload();
});

test('v4.48.3 first-provider boundary fences disconnect and generation drift before I/O', async () => {
  const h = lineRefClickHarness();
  const frames = [];
  h.context.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  let providerCalls = 0;
  h.window.__thymerLineIndexV1 = {
    linesReferencing: async () => {
      providerCalls++;
      return { items: [], complete: true };
    },
  };
  const body = h.document.createElement('div');
  h.document.body.append(body);

  const detached = h.plugin._appendLazyRefChainTree(body, 'BOUNDARY_DETACHED_ROOT');
  detached.remove();
  assert.equal(frames.length, 1);
  frames.shift()();
  await tick(1);
  assert.equal(providerCalls, 0, 'a disconnected shell cannot start its root provider');

  h.plugin._appendLazyRefChainTree(body, 'BOUNDARY_STALE_ROOT');
  assert.equal(frames.length, 1);
  h.plugin._refChainUiGeneration++;
  h.window.__refxChainUiGeneration = h.plugin._refChainUiGeneration;
  frames.shift()();
  await tick(1);
  assert.equal(providerCalls, 0, 'a stale UI generation cannot start its root provider');
  h.plugin.onUnload();
});

test('v4.46 incoming chains guard cycles, expose fanout truncation, and render an eventual-consistency miss', async () => {
  const h = lineRefClickHarness();
  const owner = { guid: 'IN_OWNER', getName: () => 'Incoming owner' };
  const install = (guid, text) => {
    const line = { guid, type: 'ulist', children: [], segments: [{ type: 'text', text }], getRecord: () => owner };
    h.window.g_universe.itemsByGuid[guid] = { guid, rguid: owner.guid, lineItem: line };
    return line;
  };
  const cycleA = install('IN_CYCLE_A', 'cycle A');
  const cycleB = install('IN_CYCLE_B', 'cycle B');
  const fanRoot = install('IN_FAN_ROOT', 'fan root');
  const fans = [1, 2, 3, 4].map((n) => install('IN_FAN_' + n, 'fan ' + n));
  const miss = install('IN_MISS', 'eventual miss');
  const incoming = new Map([
    [cycleA.guid, [cycleB]], [cycleB.guid, [cycleA]],
    [fanRoot.guid, fans],
  ]);
  h.plugin.data.searchByQuery = async (query) => ({
    lines: incoming.get(query.match(/"([^"]+)"/)?.[1] || '') || [], records: [],
  });

  const cycle = await h.plugin._resolveRefChain(cycleA.guid, {
    direction: 'in', maxDepth: 3, maxFanout: 8,
  });
  assert.deepEqual(Array.from(cycle, (hop) => hop.guid), [cycleB.guid]);

  const capped = await h.plugin._resolveRefChain(fanRoot.guid, {
    direction: 'in', maxDepth: 1, maxFanout: 2,
  });
  assert.deepEqual(Array.from(capped, (hop) => hop.guid), fans.slice(0, 2).map((line) => line.guid));
  assert.equal(capped.inMoreCount, 2);
  assert.equal(capped.truncated, true);
  const cappedBody = h.document.createElement('div'); h.document.body.append(cappedBody);
  h.plugin._appendRefChainSection(cappedBody, fanRoot.guid, capped);
  assert.equal(cappedBody.querySelector('.refx-ref-chain-more').textContent, '+2 more');

  h.window.__REFX_LAST_ERROR = '';
  const empty = await h.plugin._resolveRefChain(miss.guid, {
    direction: 'in', maxDepth: 3, maxFanout: 8,
  });
  assert.equal(empty.length, 0);
  const emptyBody = h.document.createElement('div'); h.document.body.append(emptyBody);
  h.plugin._appendRefChainSection(emptyBody, miss.guid, empty);
  assert.equal(emptyBody.querySelector('.refx-ref-chain-empty').textContent, 'no referrers yet');
  assert.equal(h.window.__REFX_LAST_ERROR, '', 'an eventually-consistent empty index is not an error');
  h.plugin.onUnload();
});

test('v4.46 incoming source preference and referrer-line invalidation stay selective', async () => {
  const h = lineRefClickHarness();
  const owner = { guid: 'INDEX_OWNER', getName: () => 'Index owner' };
  const makeLine = (guid, text) => ({
    guid, type: 'ulist', children: [], segments: [{ type: 'text', text }], getRecord: () => owner,
  });
  const root = makeLine('INDEX_ROOT', 'index root');
  const referrer = makeLine('INDEX_REFERRER', 'indexed referrer');
  const unrelated = makeLine('INDEX_UNRELATED', 'unrelated');
  for (const line of [root, referrer, unrelated]) {
    h.window.g_universe.itemsByGuid[line.guid] = { guid: line.guid, rguid: owner.guid, lineItem: line };
  }
  let searches = 0;
  h.plugin.data.searchByQuery = async () => { searches++; return { lines: [] }; };
  h.window.__thymerLineIndexV1 = {
    linesReferencing: (guid) => guid === root.guid ? [referrer] : [],
  };
  const affected = await h.plugin._resolveRefChain(root.guid, {
    direction: 'in', maxDepth: 3, maxFanout: 8,
  });
  const untouched = await h.plugin._resolveRefChain(unrelated.guid, {
    direction: 'in', maxDepth: 3, maxFanout: 8,
  });
  assert.deepEqual(Array.from(affected, (hop) => hop.guid), [referrer.guid]);
  assert.equal(searches, 0, 'linesReferencing wins without a fallback search');

  h.plugin._invalidateLineRefContextForEvent({
    lineItemGuid: referrer.guid, recordGuid: owner.guid,
  }, 'lineitem.updated');
  assert.equal(h.plugin._refChainCacheGet(root.guid, 3, 8, true, 'in'), null);
  assert.equal(h.plugin._refChainCacheGet(unrelated.guid, 3, 8, true, 'in'), untouched);
  h.plugin.onUnload();
});

test('v4.43.1 ref-chain traversal resolves each guid once and never counts an omitted guid that another branch emits', async () => {
  const h = lineRefClickHarness();
  const owner = { guid: 'ONCE_OWNER', getName: () => 'Once owner' };
  const makeLine = (guid, refs) => ({
    guid, type: 'ulist', children: [], getRecord: () => owner,
    segments: refs.map((target) => ({ type: 'ref', text: { guid: target, title: target } })),
  });
  const lines = [
    makeLine('ONCE_ROOT', ['ONCE_LEFT', 'ONCE_JOIN']),
    makeLine('ONCE_LEFT', ['ONCE_JOIN']),
    makeLine('ONCE_JOIN', []),
  ];
  for (const line of lines) {
    h.window.g_universe.itemsByGuid[line.guid] = {
      guid: line.guid, rguid: owner.guid, lineItem: line,
    };
  }
  const original = h.plugin._resolveRefChainNode.bind(h.plugin);
  const calls = new Map();
  h.plugin._resolveRefChainNode = async (guid) => {
    calls.set(guid, (calls.get(guid) || 0) + 1);
    return original(guid);
  };

  const chain = await h.plugin._resolveRefChain('ONCE_ROOT', { maxDepth: 4, maxFanout: 1 });
  assert.deepEqual(Array.from(chain, (hop) => hop.guid), ['ONCE_LEFT', 'ONCE_JOIN']);
  assert.equal(chain.deeperCount, 0, 'the fanout-dropped join is not also reported after it renders');
  assert.deepEqual(Object.fromEntries(calls), {
    ONCE_ROOT: 1, ONCE_LEFT: 1, ONCE_JOIN: 1,
  });
  h.plugin.onUnload();
});

test('v4.43.1 concurrent resolver callers both receive the public empty fallback when shared work rejects', async () => {
  const h = lineRefClickHarness();
  let rejectFresh = null;
  h.plugin._resolveRefChainFresh = () => new Promise((_resolve, reject) => { rejectFresh = reject; });
  const first = h.plugin._resolveRefChain('FAIL_SHARED');
  const second = h.plugin._resolveRefChain('FAIL_SHARED');
  rejectFresh(new Error('shared resolver failure'));
  assert.deepEqual(JSON.parse(JSON.stringify(await Promise.all([first, second]))), [[], []]);
  assert.match(h.window.__REFX_LAST_ERROR, /ref chain (resolve|pending) FAIL_SHARED:.*shared resolver failure/);
  h.plugin.onUnload();
});

test('v4.43.1 line events invalidate only cached chains that contain the touched guid', async () => {
  const h = lineRefClickHarness();
  installU6ChainGraph(h);
  const affected = await h.plugin._resolveRefChain('CHAIN_A', { maxDepth: 4, maxFanout: 8 });
  const unrelated = await h.plugin._resolveRefChain('CHAIN_C2', { maxDepth: 4, maxFanout: 8 });
  assert.equal(h.plugin._refChainCache.size, 2);
  const invalidate = (h.eventHandlers.get('lineitem.updated') || [])
    .find((entry) => String(entry.callback).includes('_invalidateLineRefContextForEvent'))?.callback;
  assert.ok(invalidate);
  invalidate({ recordGuid: 'CHAIN_OWNER', lineItemGuid: 'CHAIN_C1' });
  assert.equal(h.plugin._refChainCacheGet('CHAIN_A', 4, 8), null);
  assert.equal(h.plugin._refChainCacheGet('CHAIN_C2', 4, 8), unrelated);
  assert.equal(affected.some((hop) => hop.guid === 'CHAIN_C1'), true);
  assert.equal(h.plugin._refChainCache.size, 1);
  h.plugin.onUnload();
});

test('v4.48.3 chip context renders actionable chain rows while the Block Context clamp stays independent', async () => {
  const h = lineRefClickHarness({ lineRefClickContext: 'popover' });
  const graph = installU6ChainGraph(h);
  h.chip.setAttribute('data-guid', 'CHAIN_A');
  h.plugin._positionPopover = () => {};

  assert.equal(await h.plugin._openLineRefContextForChip(h.chip), true);
  await tick(10);
  const pop = h.document.querySelector('.refx-line-context-pop');
  const section = pop.querySelector('.refx-ref-chain-outgoing');
  assert.ok(section);
  assert.equal(section.querySelector('.refx-ref-chain-label').textContent, '→ chain');
  const rows = section.querySelectorAll('.refx-ref-chain-row');
  assert.deepEqual(Array.from(rows, (row) => [row.dataset.guid, row.dataset.depth]), [
    ['CHAIN_B', '1'], ['CHAIN_C1', '2'], ['CHAIN_C2', '2'], ['CHAIN_PAGE', '1'],
  ]);
  assert.deepEqual(
    Array.from(rows[0].querySelectorAll('.trc-ref-popover-action'), (button) => button.textContent),
    ['↗', '◧', '⧉', '⧉⤵'],
    'each hop reuses the shared reference-row action builder'
  );

  const compact = h.plugin._buildLineRefContextStrip('refx-refmenu-context');
  h.document.body.append(compact);
  h.plugin._lineRefContextCacheSet('CHAIN_A', {
    ownerGuid: graph.owner.guid,
    context: {
      target: { guid: 'CHAIN_A' }, parent: null, breadcrumbs: [],
      sections: [{ key: 'children', directItems: [], directTotal: 0 }],
    },
  });
  h.plugin._countCache = new Map();
  h.plugin.setCachedCountInfo('CHAIN_A', { count: 8, capped: false });
  const height = h.plugin._fitLineRefMenuContext(compact, 'CHAIN_A', [
    { guid: 'CHAIN_B', depth: 1 }, { guid: 'CHAIN_C1', depth: 2 },
  ]);
  assert.equal(height, 56,
    'the Block Context fit excludes the chain sibling and reserves only its own target row');
  assert.equal(compact.querySelector('.refx-line-context-body').style['--refx-line-context-height'], '56px');
  h.plugin.onUnload();
});

test('v4.48.3 a cold chain hydrates outside the reserved Block Context body without re-anchoring', async () => {
  const h = lineRefClickHarness();
  installU6ChainGraph(h);
  const context = await h.plugin._loadLineRefContext('CHAIN_A');
  assert.ok(context, 'line context is warm while the chain cache remains cold');
  h.plugin._refChainCache.clear();
  h.plugin._positionPopover = () => {};
  h.plugin._openRefMenu({
    targetGuid: 'CHAIN_A', lineGuid: 'LINE_CLICK', pageGuid: 'PAGE_CLICK',
    isText: true, current: 'A', fallback: 'A', li: null, segs: [], refIdx: 0,
  }, h.chip, { withContext: true });
  const pop = h.document.querySelector('.refx-refmenu');
  const body = pop.querySelector('.refx-line-context-body');
  const anchoredTop = pop.style.top;
  const initialHeight = Number.parseInt(body.style['--refx-line-context-height'], 10);
  await tick(20);
  const settledHeight = Number.parseInt(body.style['--refx-line-context-height'], 10);
  assert.equal(pop.style.top, anchoredTop, 'cold hydration never repositions the popup');
  assert.equal(settledHeight, initialHeight,
    'chain hydration cannot change the independent Block Context reservation');
  const incoming = pop.querySelector('.refx-ref-chain-tree');
  const outgoing = pop.querySelector('.refx-ref-chain-outgoing');
  const blockContext = pop.querySelector('.refx-refmenu-context');
  assert.equal(body.querySelector('.refx-ref-chain'), null);
  assert.equal(outgoing.querySelectorAll('.refx-ref-chain-row').length, 4);
  assert.ok(pop.children.indexOf(incoming) < pop.children.indexOf(blockContext));
  assert.ok(pop.children.indexOf(outgoing) < pop.children.indexOf(blockContext));
  h.plugin.onUnload();
});

test('v4.43.1 cached chain sizes are shown in expansion depth labels', async () => {
  const h = lineRefClickHarness();
  installU6ChainGraph(h);
  await h.plugin._resolveRefChain('CHAIN_A', {
    direction: 'both', maxDepth: 4, maxFanout: 8,
  });
  h.plugin._openRefMenu({
    targetGuid: 'CHAIN_A', lineGuid: 'LINE_CLICK', pageGuid: 'PAGE_CLICK',
    isText: true, current: 'A', fallback: 'A', li: null, segs: [], refIdx: 0,
  }, h.chip, { withContext: true });
  activateTop(h, 'Expand chain');
  const labels = Array.from(
    h.document.querySelector('.refx-submenu').querySelectorAll('.refalias-result'),
    (row) => rowLabel(row)
  );
  assert.deepEqual(labels, ['Depth 1 (3 items)', 'Depth 2 (5 items)', 'Depth 3 (5 items)']);
  h.plugin.onUnload();
});

test('v4.43 chain expansion writes only nested transclusion items and checks every hop for cycles', async () => {
  const h = lineRefClickHarness();
  const hostLine = { guid: 'HOST_LINE', children: [] };
  const creates = [];
  let next = 0;
  const hostRecord = {
    guid: 'HOST_RECORD',
    createLineItem: async (parent, after, type, segments, props) => {
      const line = { guid: 'EMBED_' + (++next), type, props, parent, after, delete: async () => true };
      creates.push({ parent: parent.guid, after: after?.guid || null, type, segments, props: { ...props }, line });
      return line;
    },
  };
  h.plugin._resolveRefChain = async () => [
    { guid: 'CHAIN_B', isLine: true, depth: 1 },
    { guid: 'CHAIN_C', isLine: true, depth: 2 },
    { guid: 'CHAIN_PAGE', isLine: false, depth: 1 },
  ];
  h.plugin._resolveLineItemContextByGuid = async () => ({ line: hostLine, record: hostRecord });
  h.plugin._findEmbeds = () => [];
  h.plugin._targetOwnerGuid = (guid) => guid + '_OWNER';
  const cycleChecks = [];
  h.plugin._wouldCycle = async (parent, pageGuid, targetGuid, ancestors, ownerGuid) => {
    cycleChecks.push([parent.guid, pageGuid, targetGuid, [...ancestors], ownerGuid]);
    return false;
  };
  h.plugin._unfoldHostLine = () => {};

  assert.equal(await h.plugin._menuExpandChain({
    lineGuid: hostLine.guid, pageGuid: hostRecord.guid,
    targetGuid: 'CHAIN_A', isText: true,
  }, 2), true);
  assert.deepEqual(creates.map((entry) => entry.parent), ['HOST_LINE', 'EMBED_1', 'EMBED_2', 'EMBED_1']);
  assert.ok(creates.every((entry) => entry.type === 'transclusion' && entry.segments === null));
  assert.ok(creates.every((entry) => entry.props.refx_embed === 1 && entry.props.itemref));
  assert.ok(creates.every((entry) => !Object.hasOwn(entry.props, 'viewId')), 'no transclusion creates a viewId ref segment');
  assert.deepEqual(cycleChecks.map((entry) => entry[2]), ['CHAIN_A', 'CHAIN_B', 'CHAIN_C', 'CHAIN_PAGE']);
  h.plugin.onUnload();
});

test('v4.43.1 chain expansion uses the real cycle verifier and refuses before creating a line', async () => {
  const h = lineRefClickHarness();
  const hostLine = { guid: 'SELF_CHAIN', children: [] };
  let creates = 0;
  const hostRecord = {
    guid: 'HOST_RECORD',
    createLineItem: async () => { creates++; return null; },
  };
  h.plugin._resolveRefChain = async () => [{ guid: 'CHAIN_AFTER_SELF', isLine: false, depth: 1 }];
  h.plugin._resolveLineItemContextByGuid = async () => ({ line: hostLine, record: hostRecord });
  h.plugin._findEmbeds = () => [];
  const toasts = [];
  h.plugin._toast = (message) => toasts.push(message);

  assert.equal(await h.plugin._menuExpandChain({
    lineGuid: hostLine.guid, pageGuid: hostRecord.guid,
    targetGuid: hostLine.guid, isText: true,
  }, 1), false);
  assert.equal(creates, 0);
  assert.equal(toasts.at(-1), "Can't embed a reference chain inside itself.");
  assert.equal(h.window.__REFX_CYCLE_REFUSALS.at(-1).reason, 'direct-cycle');
  h.plugin.onUnload();
});

test('v4.43.1 a mid-chain writer failure rolls back every line already created', async () => {
  const h = lineRefClickHarness();
  const hostLine = { guid: 'ROLLBACK_HOST', children: [] };
  const deleted = [];
  let createCalls = 0;
  const hostRecord = {
    guid: 'ROLLBACK_RECORD',
    createLineItem: async () => {
      createCalls++;
      if (createCalls === 2) throw new Error('writer lane failed');
      return { guid: 'ROLLBACK_CREATED', delete: async () => { deleted.push('ROLLBACK_CREATED'); } };
    },
  };
  for (const guid of ['ROLLBACK_PAGE_A', 'ROLLBACK_PAGE_B']) {
    h.records.set(guid, { guid, getLineItems: async () => [] });
  }
  h.plugin._resolveRefChain = async () => [{ guid: 'ROLLBACK_PAGE_B', isLine: false, depth: 1 }];
  h.plugin._resolveLineItemContextByGuid = async () => ({ line: hostLine, record: hostRecord });
  h.plugin._findEmbeds = () => [];
  const toasts = [];
  h.plugin._toast = (message) => toasts.push(message);

  assert.equal(await h.plugin._menuExpandChain({
    lineGuid: hostLine.guid, pageGuid: hostRecord.guid,
    targetGuid: 'ROLLBACK_PAGE_A', isText: false,
  }, 1), false);
  assert.equal(createCalls, 2);
  assert.deepEqual(deleted, ['ROLLBACK_CREATED']);
  assert.equal(toasts.at(-1), "Couldn't expand the reference chain.");
  assert.match(h.window.__REFX_LAST_ERROR, /ref chain transclusion ROLLBACK_PAGE_B:.*writer lane failed/);
  h.plugin.onUnload();
});

test('v4.43.1 expansion refuses more than 24 created items before resolving a host or writing', async () => {
  const h = lineRefClickHarness();
  h.plugin._resolveRefChain = async () => Array.from({ length: 24 }, (_, index) => ({
    guid: 'CAP_' + index, isLine: false, depth: 1,
  }));
  let hostResolutions = 0;
  h.plugin._resolveLineItemContextByGuid = async () => { hostResolutions++; return null; };
  const toasts = [];
  h.plugin._toast = (message) => toasts.push(message);
  assert.equal(await h.plugin._menuExpandChain({
    lineGuid: 'CAP_HOST', pageGuid: 'CAP_RECORD', targetGuid: 'CAP_ROOT', isText: false,
  }, 3), false);
  assert.equal(hostResolutions, 0);
  assert.equal(toasts.at(-1), "Can't expand 25 items; the limit is 24.");
  h.plugin.onUnload();
});

test('v4.48.4 chain chip marker uses only the compact pre-reserved zero-layout slot', () => {
  const h = lineRefClickHarness();
  h.plugin._paintRefChainChip(h.chip, [{ guid: 'CHAIN_B', depth: 1 }]);
  assert.equal(h.chip.classList.contains('refx-has-chain'), true);
  assert.equal(h.chip.dataset.refxChainDepth, '1');
  h.plugin._paintRefChainChip(h.chip, []);
  assert.equal(h.chip.classList.contains('refx-has-chain'), false);
  assert.match(source, /body\.trc-zerolayout \.lineitem-ref\.refx-has-chain::after \{[\s\S]*?position: absolute;[\s\S]*?pointer-events: none;/);
  assert.doesNotMatch(source, /\.lineitem-ref\.refx-has-chain\s*\{[^}]*(padding|margin|width)\s*:/);
  h.plugin.onUnload();
});

test('v4.44 ref-chain traversal includes at most 40 child-subtree lines, marks provenance, and keeps inline-only compatibility', async () => {
  const h = lineRefClickHarness();
  const owner = { guid: 'SUBTREE_OWNER', getName: () => 'Subtree owner' };
  const root = {
    guid: 'SUBTREE_ROOT', type: 'ulist', getRecord: () => owner,
    segments: [{ type: 'ref', text: { guid: 'INLINE_PAGE', title: 'Inline page' } }],
    children: [],
  };
  for (let index = 1; index <= 41; index++) {
    root.children.push({
      guid: 'SUBTREE_CHILD_' + index,
      type: 'ulist', children: [],
      segments: index === 40
        ? [{ type: 'ref', text: { guid: 'IN_CAP_PAGE', title: 'Within cap' } }]
        : index === 41
          ? [{ type: 'ref', text: { guid: 'OUT_CAP_PAGE', title: 'Beyond cap' } }]
          : [{ type: 'text', text: 'child ' + index }],
    });
  }
  h.window.g_universe.itemsByGuid[root.guid] = {
    guid: root.guid, rguid: owner.guid, lineItem: root,
  };
  for (const guid of ['INLINE_PAGE', 'IN_CAP_PAGE', 'OUT_CAP_PAGE']) {
    h.records.set(guid, { guid, getName: () => guid });
  }

  const defaultChain = await h.plugin._resolveRefChain(root.guid, { maxDepth: 1, maxFanout: 8 });
  assert.deepEqual(Array.from(defaultChain, (hop) => [hop.guid, hop.via]), [
    ['INLINE_PAGE', 'inline'], ['IN_CAP_PAGE', 'subtree'],
  ]);
  assert.equal(defaultChain.some((hop) => hop.guid === 'OUT_CAP_PAGE'), false);
  assert.equal(defaultChain.includeSubtree, true);
  assert.equal(defaultChain.sourceLineGuids.includes('SUBTREE_CHILD_40'), true);

  const cachedBeforeChildUpdate = h.plugin._refChainCache.size;
  assert.ok(cachedBeforeChildUpdate > 0);
  h.plugin._invalidateLineRefContextForEvent({
    lineItemGuid: 'SUBTREE_CHILD_40', recordGuid: owner.guid,
  }, 'lineitem.updated');
  assert.equal(
    [...h.plugin._refChainCache.values()].some((chain) => chain.sourceLineGuids?.includes('SUBTREE_CHILD_40')),
    false,
    'a changed subtree source selectively invalidates the chains that scanned it',
  );

  const inlineOnly = await h.plugin._resolveRefChain(root.guid, {
    maxDepth: 1, maxFanout: 8, includeSubtree: false,
  });
  assert.deepEqual(Array.from(inlineOnly, (hop) => [hop.guid, hop.via]), [
    ['INLINE_PAGE', 'inline'],
  ]);
  assert.equal(inlineOnly.includeSubtree, false);

  const narrow = await h.plugin._resolveRefChain(root.guid, { maxDepth: 1, maxFanout: 1 });
  assert.deepEqual(Array.from(narrow, (hop) => hop.guid), ['INLINE_PAGE']);
  assert.equal(narrow.deeperCount, 1, 'inline and subtree refs share one fanout budget');

  const body = h.document.createElement('div'); h.document.body.append(body);
  h.plugin._appendRefChainSection(body, root.guid, defaultChain);
  const subtreeRow = body.querySelectorAll('.refx-ref-chain-row').find((row) => row.dataset.guid === 'IN_CAP_PAGE');
  assert.equal(subtreeRow.dataset.via, 'subtree');
  assert.equal(subtreeRow.querySelector('.refx-ref-chain-via').textContent, 'subtree');
  h.plugin.onUnload();
});

test('v4.44 popup-section bridge renders frozen contexts after native hover/menu content and token-fences replacement', () => {
  const h = lineRefClickHarness();
  h.plugin._positionPopover = () => {};
  const owner = { id: 'popup-owner', active: true };
  const contexts = [];
  const firstDispose = h.window.__refx.registerPopupSection({
    id: 'remarks', owner,
    when: (ctx) => ctx.isLine,
    render: (ctx, container) => {
      contexts.push(ctx);
      container.append(h.document.createElement('span'));
      container.children[0].textContent = ctx.surface + ':' + ctx.targetGuid;
    },
  });
  h.window.g_universe.itemsByGuid.POP_TARGET = {
    guid: 'POP_TARGET', rguid: 'POP_OWNER',
    lineItem: { guid: 'POP_TARGET', type: 'text', segments: [{ type: 'text', text: 'Popup target' }] },
  };

  const hover = h.document.createElement('div'); h.document.body.append(hover);
  h.plugin._fillHoverPop(hover, 'POP_TARGET', () => true, {
    lineGuid: 'POP_SOURCE', pageGuid: 'POP_PAGE',
  });
  assert.equal(hover.children[0].classList.contains('refx-popup-native'), true);
  assert.equal(hover.children[1].classList.contains('refx-popup-sections'), true);
  assert.equal(hover.querySelector('.refx-popup-section').textContent, 'hoverpop:POP_TARGET');

  const menu = h.plugin._openRefMenu({
    targetGuid: 'POP_TARGET', lineGuid: 'POP_SOURCE', pageGuid: 'POP_PAGE',
    isText: true, current: 'Popup target', fallback: 'Popup target', li: null, segs: [], refIdx: 0,
  }, h.chip, { withContext: false });
  const menuSections = menu.querySelector('.refx-popup-sections-refmenu');
  assert.ok(menuSections);
  assert.equal(menu.children.indexOf(menuSections) < menu.children.indexOf(menu.querySelector('.refalias-results')), true);
  assert.equal(menuSections.querySelector('.refx-popup-section').textContent, 'refmenu:POP_TARGET');
  assert.equal(contexts.length, 2);
  assert.ok(contexts.every(Object.isFrozen));
  assert.deepEqual(JSON.parse(JSON.stringify(contexts)), [
    { targetGuid: 'POP_TARGET', lineGuid: 'POP_SOURCE', pageGuid: 'POP_PAGE', isLine: true, surface: 'hoverpop' },
    { targetGuid: 'POP_TARGET', lineGuid: 'POP_SOURCE', pageGuid: 'POP_PAGE', isLine: true, surface: 'refmenu' },
  ]);

  const secondDispose = h.window.__refx.registerPopupSection({
    id: 'remarks', owner, render: (_ctx, container) => { container.textContent = 'replacement'; },
  });
  assert.equal(firstDispose(), false, 'stale disposer cannot remove a replacement registration');
  assert.deepEqual(JSON.parse(JSON.stringify(h.window.__refx.listPopupSections())), [
    { id: 'remarks', ownerId: 'popup-owner' },
  ]);
  assert.equal(secondDispose(), true);
  h.plugin.onUnload();
});

test('v4.44 popup sections fail closed and record both predicate and renderer failures', () => {
  const h = lineRefClickHarness();
  const owner = { id: 'failing-owner', active: true };
  h.window.__refx.registerPopupSection({
    id: 'bad-when', owner,
    when: () => { throw new Error('predicate exploded'); },
    render: () => { throw new Error('must not render'); },
  });
  const badRenderDispose = h.window.__refx.registerPopupSection({
    id: 'bad-render', owner,
    render: () => { throw new Error('renderer exploded'); },
  });
  const pop = h.document.createElement('div'); h.document.body.append(pop);
  h.plugin._fillHoverPop(pop, 'MISSING_POP_TARGET', () => true, {});
  assert.equal(pop.querySelectorAll('.refx-popup-section').length, 0);
  assert.match(h.window.__REFX_LAST_ERROR, /popup section render bad-render:.*renderer exploded/);
  assert.equal(badRenderDispose(), true);
  h.plugin.onUnload();
});

test('v4.44 cycle guard converges through rendered-listview then g_universe owners and records all refusal attempts', async () => {
  const makeHost = () => ({ guid: 'CYCLE_HOST', getParent: async () => ({ guid: 'HOST_RECORD', getLineItems() {} }) });

  const domCase = lineRefClickHarness();
  const domTarget = { guid: 'DOM_TARGET', type: 'text', children: [] };
  domCase.records.set('DOM_OWNER', { guid: 'DOM_OWNER', getLineItems: async () => [domTarget] });
  const root = domCase.document.createElement('div'); root.className = 'listview-items'; root.setAttribute('data-guid', 'DOM_OWNER');
  const line = domCase.document.createElement('div'); line.className = 'listitem'; line.setAttribute('data-guid', domTarget.guid);
  root.append(line); domCase.document.body.append(root);
  domCase.plugin._resolveLineItemContextByGuid = async () => null;
  assert.equal(await domCase.plugin._wouldCycle(makeHost(), 'HOST_RECORD', domTarget.guid), false);
  assert.equal(domCase.plugin._lineOwnerHints.get(domTarget.guid), 'DOM_OWNER');
  domCase.plugin.onUnload();

  const universeCase = lineRefClickHarness();
  const universeTarget = { guid: 'UNIVERSE_TARGET', type: 'text', children: [] };
  universeCase.records.set('UNIVERSE_OWNER', { guid: 'UNIVERSE_OWNER', getLineItems: async () => [universeTarget] });
  universeCase.window.g_universe.itemsByGuid[universeTarget.guid] = { guid: universeTarget.guid, rguid: 'UNIVERSE_OWNER' };
  universeCase.plugin._resolveLineItemContextByGuid = async () => null;
  universeCase.plugin._targetOwnerGuid = (_guid, explicit) => explicit || null;
  assert.equal(await universeCase.plugin._wouldCycle(makeHost(), 'HOST_RECORD', universeTarget.guid), false);
  assert.equal(universeCase.plugin._lineOwnerHints.get(universeTarget.guid), 'UNIVERSE_OWNER');
  universeCase.plugin.onUnload();

  const staleDomCase = lineRefClickHarness();
  const convergedTarget = { guid: 'CONVERGED_TARGET', type: 'text', children: [] };
  staleDomCase.records.set('CONVERGED_OWNER', {
    guid: 'CONVERGED_OWNER', getLineItems: async () => [convergedTarget],
  });
  staleDomCase.window.g_universe.itemsByGuid[convergedTarget.guid] = {
    guid: convergedTarget.guid, rguid: 'CONVERGED_OWNER',
  };
  const staleRoot = staleDomCase.document.createElement('div');
  staleRoot.className = 'listview-items'; staleRoot.setAttribute('data-guid', 'STALE_DOM_OWNER');
  const staleLine = staleDomCase.document.createElement('div');
  staleLine.className = 'listitem'; staleLine.setAttribute('data-guid', convergedTarget.guid);
  staleRoot.append(staleLine); staleDomCase.document.body.append(staleRoot);
  staleDomCase.plugin._resolveLineItemContextByGuid = async () => null;
  staleDomCase.plugin._targetOwnerGuid = (_guid, explicit) => explicit || null;
  assert.equal(await staleDomCase.plugin._wouldCycle(makeHost(), 'HOST_RECORD', convergedTarget.guid), false);
  assert.equal(
    staleDomCase.plugin._lineOwnerHints.get(convergedTarget.guid), 'CONVERGED_OWNER',
    'a stale rendered owner does not prevent the later live-state fallback',
  );
  staleDomCase.plugin.onUnload();

  const refusalCase = lineRefClickHarness();
  refusalCase.plugin._resolveLineItemContextByGuid = async () => null;
  assert.equal(await refusalCase.plugin._wouldCycle(makeHost(), 'HOST_RECORD', 'NOWHERE_TARGET'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(refusalCase.window.__REFX_CYCLE_REFUSALS.at(-1).attemptedFallbacks)), [
    'warm-context', 'rendered-listview', 'g_universe.itemsByGuid.rguid', 'line-ref-context-owner',
  ]);
  refusalCase.plugin.onUnload();
});

test('v4.45.2 nested rendered ownership is nearest, body-verified, and cannot poison the mutual-cycle guard', async () => {
  const h = lineRefClickHarness();
  const target = {
    guid: 'NESTED_TARGET', type: 'text', segments: [],
    children: [{
      guid: 'BACK_TO_HOST', type: 'transclusion', props: { itemref: 'HOST_RECORD' }, children: [],
    }],
  };
  h.records.set('TRUE_OWNER', {
    guid: 'TRUE_OWNER', getLineItems: async () => [target],
  });
  h.records.set('HOST_RECORD', {
    guid: 'HOST_RECORD', getLineItems: async () => [{ guid: 'HOST_ONLY', children: [] }],
  });
  const outer = h.document.createElement('div');
  outer.className = 'listview-items'; outer.setAttribute('data-guid', 'HOST_RECORD');
  const transclusion = h.document.createElement('div'); transclusion.className = 'transclusion-container-div';
  const inner = h.document.createElement('div');
  inner.className = 'listview-items'; inner.setAttribute('data-guid', 'TRUE_OWNER');
  const renderedLine = h.document.createElement('div');
  renderedLine.className = 'listitem'; renderedLine.setAttribute('data-guid', target.guid);
  inner.append(renderedLine); transclusion.append(inner); outer.append(transclusion); h.document.body.append(outer);
  h.plugin._resolveLineItemContextByGuid = async () => null;
  const hostLine = {
    guid: 'HOST_LINE',
    getParent: async () => ({ guid: 'HOST_RECORD', getLineItems() {} }),
  };

  assert.equal(await h.plugin._wouldCycle(hostLine, 'HOST_RECORD', target.guid), true);
  assert.equal(h.plugin._lineOwnerHints.get(target.guid), 'TRUE_OWNER');
  assert.notEqual(h.plugin._lineOwnerHints.get(target.guid), 'HOST_RECORD');
  assert.equal(h.window.__REFX_CYCLE_REFUSALS.at(-1).reason, 'target-subtree-cycle');
  h.plugin.onUnload();
});

test('v4.45.2 cold cycle ownership consults line-context search and refuses only after all four rungs fail', async () => {
  const makeHost = () => ({
    guid: 'COLD_HOST_LINE',
    getParent: async () => ({ guid: 'COLD_HOST_RECORD', getLineItems() {} }),
  });
  const resolved = lineRefClickHarness();
  const owner = { guid: 'COLD_TRUE_OWNER', getLineItems: async () => [{ guid: 'COLD_TARGET', children: [] }] };
  const searchableLine = { guid: 'COLD_TARGET', getRecord: () => owner };
  resolved.window.g_universe.itemsByGuid.COLD_TARGET = {
    guid: 'COLD_TARGET', text_segments: ['text', 'cold searchable title'],
  };
  resolved.records.set(owner.guid, owner);
  resolved.plugin.data.searchByQuery = async () => ({ lines: [searchableLine] });
  resolved.plugin._resolveLineItemContextByGuid = async () => null;
  let resolvedCalls = 0;
  const realResolvedColdOwner = resolved.plugin._lineRefContextOwner.bind(resolved.plugin);
  resolved.plugin._lineRefContextOwner = async (guid) => { resolvedCalls++; return realResolvedColdOwner(guid); };
  assert.equal(await resolved.plugin._wouldCycle(makeHost(), 'COLD_HOST_RECORD', 'COLD_TARGET'), false);
  assert.equal(resolvedCalls, 1);
  assert.equal(resolved.plugin._lineOwnerHints.get('COLD_TARGET'), owner.guid);
  resolved.plugin.onUnload();

  const refused = lineRefClickHarness();
  refused.plugin._resolveLineItemContextByGuid = async () => null;
  let refusedCalls = 0;
  const realRefusedColdOwner = refused.plugin._lineRefContextOwner.bind(refused.plugin);
  refused.plugin._lineRefContextOwner = async (guid) => { refusedCalls++; return realRefusedColdOwner(guid); };
  assert.equal(await refused.plugin._wouldCycle(makeHost(), 'COLD_HOST_RECORD', 'COLD_NOWHERE'), true);
  assert.equal(refusedCalls, 1);
  assert.equal(refused.window.__REFX_CYCLE_REFUSALS.at(-1).reason, 'owner-unresolved');
  assert.deepEqual(JSON.parse(JSON.stringify(refused.window.__REFX_CYCLE_REFUSALS.at(-1).attemptedFallbacks)), [
    'warm-context', 'rendered-listview', 'g_universe.itemsByGuid.rguid', 'line-ref-context-owner',
  ]);
  refused.plugin.onUnload();
});

test('v4.45.2 chain invalidation uses one O(1) index lookup on the typing path', () => {
  const h = lineRefClickHarness();
  const chain = (sourceGuid, ownerGuid) => {
    const value = [];
    Object.defineProperties(value, {
      sourceLineGuids: { value: Object.freeze([sourceGuid]), enumerable: false },
      ownerRecordGuids: { value: Object.freeze([ownerGuid]), enumerable: false },
    });
    return Object.freeze(value);
  };
  for (let index = 0; index < 64; index++) {
    h.plugin._refChainCacheSet('INDEX_ROOT_' + index, 4, 8, chain('INDEX_SOURCE_' + index, 'INDEX_OWNER_' + index));
  }
  h.plugin._refChainInvalidationStats = { lookups: 0, hits: 0, keysVisited: 0 };
  h.plugin._invalidateLineRefContextForEvent({
    lineItemGuid: 'UNRELATED_TYPING_LINE', recordGuid: 'UNRELATED_OWNER',
  }, 'lineitem.updated');
  assert.deepEqual(JSON.parse(JSON.stringify(h.plugin._refChainInvalidationStats)), {
    lookups: 1, hits: 0, keysVisited: 0,
  });
  assert.equal(h.plugin._refChainCache.size, 64);

  h.plugin._invalidateLineRefContextForEvent({
    lineItemGuid: 'INDEX_SOURCE_31', recordGuid: 'INDEX_OWNER_31',
  }, 'lineitem.updated');
  assert.deepEqual(JSON.parse(JSON.stringify(h.plugin._refChainInvalidationStats)), {
    lookups: 2, hits: 1, keysVisited: 1,
  });
  assert.equal(h.plugin._refChainCache.size, 63);
  h.plugin.onUnload();
});

test('v4.45.2 created moved and deleted events invalidate chains by scanned owner record', () => {
  const h = lineRefClickHarness();
  const makeChain = () => {
    const value = [];
    Object.defineProperties(value, {
      sourceLineGuids: { value: Object.freeze(['OWNER_ROOT']), enumerable: false },
      ownerRecordGuids: { value: Object.freeze(['SCANNED_OWNER']), enumerable: false },
    });
    return Object.freeze(value);
  };
  for (const eventName of ['lineitem.created', 'lineitem.moved', 'lineitem.deleted']) {
    h.plugin._refChainCacheSet('OWNER_ROOT', 4, 8, makeChain());
    assert.ok(h.plugin._refChainCacheGet('OWNER_ROOT', 4, 8));
    h.plugin._invalidateLineRefContextForEvent({
      lineItemGuid: 'NEW_OR_STRUCTURAL_LINE_' + eventName,
      recordGuid: 'SCANNED_OWNER',
    }, eventName);
    assert.equal(h.plugin._refChainCacheGet('OWNER_ROOT', 4, 8), null, eventName);
  }
  h.plugin.onUnload();
});

test('v4.45.2 aggregate chain scanning stops at the global line budget and reports truncation', async () => {
  const h = lineRefClickHarness();
  const owner = { guid: 'BUDGET_OWNER' };
  const refs = [];
  for (let branch = 0; branch < 8; branch++) {
    const guid = 'BUDGET_BRANCH_' + branch;
    refs.push({ type: 'ref', text: { guid } });
    const children = Array.from({ length: 40 }, (_, index) => ({
      guid: guid + '_CHILD_' + index, segments: [{ type: 'text', text: 'child' }], children: [],
    }));
    h.window.g_universe.itemsByGuid[guid] = {
      guid, record: owner, segments: [], children,
    };
  }
  h.window.g_universe.itemsByGuid.BUDGET_ROOT = {
    guid: 'BUDGET_ROOT', record: owner, segments: refs, children: [],
  };

  const result = await h.plugin._resolveRefChain('BUDGET_ROOT', { maxDepth: 1, maxFanout: 8 });
  assert.equal(result.truncated, true);
  assert.equal(result.scannedLineCount, h.plugin._REF_CHAIN_TOTAL_LINE_CAP);
  assert.ok(result.sdkCallCount <= h.plugin._REF_CHAIN_SDK_CALL_CAP);
  h.plugin.onUnload();
});

test('v4.45.2 aggregate chain hydration stops exactly at the global SDK-call budget', async () => {
  const h = lineRefClickHarness();
  const owner = { guid: 'SDK_BUDGET_OWNER' };
  const encodedRefs = [];
  for (let index = 0; index < 40; index++) {
    const guid = 'SDK_BUDGET_TARGET_' + index;
    encodedRefs.push('ref', { guid });
    h.window.g_universe.itemsByGuid[guid] = {
      guid, children: [], getRecord: () => owner, getSegments: () => [],
    };
  }
  h.window.g_universe.itemsByGuid.SDK_BUDGET_ROOT = {
    guid: 'SDK_BUDGET_ROOT', children: [], text_segments: encodedRefs, getRecord: () => owner,
  };

  const result = await h.plugin._resolveRefChain('SDK_BUDGET_ROOT', { maxDepth: 1, maxFanout: 64 });
  assert.equal(result.truncated, true);
  assert.equal(result.sdkCallCount, h.plugin._REF_CHAIN_SDK_CALL_CAP);
  assert.ok(result.scannedLineCount < h.plugin._REF_CHAIN_TOTAL_LINE_CAP);
  h.plugin.onUnload();
});

test('v4.45.2 chain LRU scales from 64 to rendered-chip demand and never exceeds 256', () => {
  const h = lineRefClickHarness();
  const empty = Object.freeze([]);
  for (let index = 0; index < 70; index++) h.plugin._refChainCacheSet('BASE_' + index, 4, 8, empty);
  assert.equal(h.plugin._refChainCache.size, 64);
  h.plugin._refChainCacheClear();
  for (let index = 0; index < 99; index++) {
    const chip = h.document.createElement('span'); chip.className = 'lineitem-ref'; chip.setAttribute('data-guid', 'RENDERED_' + index);
    h.document.body.append(chip);
  }
  for (let index = 0; index < 110; index++) h.plugin._refChainCacheSet('GROWN_' + index, 4, 8, empty);
  assert.equal(h.plugin._refChainCache.size, 100, '99 added chips plus the harness chip size the cache');
  h.plugin._refChainCacheClear();
  for (let index = 99; index < 300; index++) {
    const chip = h.document.createElement('span'); chip.className = 'lineitem-ref'; chip.setAttribute('data-guid', 'RENDERED_' + index);
    h.document.body.append(chip);
  }
  for (let index = 0; index < 270; index++) h.plugin._refChainCacheSet('CEILING_' + index, 4, 8, empty);
  assert.equal(h.plugin._refChainCache.size, 256);
  h.plugin.onUnload();
});

test('v4.44 shared honest-title synthesizer names media, dates, ref-only, empty, and truly unreadable lines', () => {
  const h = lineRefClickHarness();
  h.records.set('TITLE_PAGE', { guid: 'TITLE_PAGE', getName: () => 'Named target' });
  assert.equal(h.plugin._readableLineTitle({
    guid: 'IMAGE_LINE', type: 'image', props: { filename: 'photo.png' }, segments: [],
  }, []), 'photo.png');
  assert.equal(h.plugin._readableLineTitle({ guid: 'DATE_LINE' }, [
    { type: 'datetime', text: { formatted: 'Friday at 17:30' } },
  ]), 'Friday at 17:30');
  assert.equal(h.plugin._readableLineTitle({ guid: 'REF_LINE' }, [
    { type: 'ref', text: { guid: 'TITLE_PAGE' } },
  ]), 'Named target');
  assert.equal(h.plugin._readableLineTitle({ guid: 'EMPTY_LINE', segments: [] }, []), '(empty line)');
  assert.equal(h.plugin._readableLineTitle('UNREADABLE_LINE'), null);

  const imageLine = { guid: 'IMAGE_HOVER', type: 'image', props: { filename: 'hover-image.png' }, segments: [] };
  h.window.g_universe.itemsByGuid[imageLine.guid] = { guid: imageLine.guid, lineItem: imageLine };
  const readablePop = h.document.createElement('div'); h.document.body.append(readablePop);
  h.plugin._fillHoverPop(readablePop, imageLine.guid, () => true, {});
  assert.equal(readablePop.querySelector('.refx-hoverpop-title').textContent, 'hover-image.png');
  const missingPop = h.document.createElement('div'); h.document.body.append(missingPop);
  h.plugin._fillHoverPop(missingPop, 'UNREADABLE_LINE', () => true, {});
  assert.equal(missingPop.querySelector('.refx-hoverpop-title').textContent, '[unresolved line]');
  h.plugin.onUnload();
});

test('v4.45.2 readable titles reuse BFS synthesis and reference-menu aliases keep precedence', () => {
  const h = lineRefClickHarness();
  h.plugin._positionPopover = () => {};
  h.window.g_universe.itemsByGuid.EMPTY_PARENT = {
    guid: 'EMPTY_PARENT', text_segments: [], children: ['NAMED_CHILD'],
  };
  h.window.g_universe.itemsByGuid.NAMED_CHILD = {
    guid: 'NAMED_CHILD', text_segments: ['text', 'First readable descendant'], children: [],
  };
  assert.equal(
    h.plugin._readableLineTitle({ guid: 'EMPTY_PARENT', segments: [] }, []),
    'First readable descendant',
  );
  const menu = h.plugin._openRefMenu({
    targetGuid: 'EMPTY_PARENT', lineGuid: 'LINE_CLICK', pageGuid: 'PAGE_CLICK',
    isText: true, current: 'My chip alias', fallback: 'Fallback', li: null, segs: [], refIdx: 0,
  }, h.chip, { withContext: false });
  assert.equal(menu.querySelector('.refx-refmenu-head').textContent, 'My chip alias · line');
  h.plugin.onUnload();
});

test('v4.45.2 hover previews are click-through unless a mounted section makes them interactive', () => {
  const h = lineRefClickHarness();
  const plain = h.document.createElement('div'); plain.className = 'refx-hoverpop'; h.document.body.append(plain);
  h.plugin._fillHoverPop(plain, 'NO_SECTION_TARGET', () => true, {});
  assert.equal(plain.classList.contains('refx-popup-interactive'), false);
  assert.match(source, /\.refx-hoverpop \{[^}]*pointer-events: none;/);
  assert.match(source, /\.refx-hoverpop\.refx-popup-interactive \{ pointer-events: auto; \}/);

  const owner = { id: 'interactive-owner', active: true };
  h.window.__refx.registerPopupSection({
    id: 'interactive', owner,
    render: (_ctx, container) => { container.textContent = 'Interactive controls'; },
  });
  const interactive = h.document.createElement('div'); interactive.className = 'refx-hoverpop'; h.document.body.append(interactive);
  h.plugin._fillHoverPop(interactive, 'SECTION_TARGET', () => true, {});
  assert.equal(interactive.classList.contains('refx-popup-interactive'), true);
  assert.ok(interactive.querySelector('.refx-popup-section-host'));
  assert.equal(interactive.querySelector('.refx-refmenu-context'), null);
  h.plugin._hoverPop = interactive;
  interactive.dispatchEvent(event('mouseleave', { target: interactive }));
  assert.equal(h.plugin._hoverPop, null, 'interactive hover closes when the pointer leaves it');
  h.plugin.onUnload();
});

test('v4.45.2 async ref-menu sections occupy a fixed pre-anchor host without context-class collision', async () => {
  const h = lineRefClickHarness();
  let anchors = 0;
  h.plugin._positionPopover = () => { anchors++; };
  let release;
  h.window.__refx.registerPopupSection({
    id: 'late-section', owner: { id: 'late-owner', active: true },
    when: (ctx) => ctx.surface === 'refmenu',
    render: async (_ctx, container) => {
      await new Promise((resolve) => { release = resolve; });
      container.textContent = 'Late content';
    },
  });
  const menu = h.plugin._openRefMenu({
    targetGuid: 'LATE_SECTION_TARGET', lineGuid: 'LINE_CLICK', pageGuid: 'PAGE_CLICK',
    isText: true, current: 'Late section target', fallback: '', li: null, segs: [], refIdx: 0,
  }, h.chip, { withContext: false });
  const host = menu.querySelector('.refx-popup-section-host');
  assert.ok(host);
  assert.equal(host.classList.contains('refx-refmenu-context'), false);
  assert.equal(menu.querySelector('.refx-refmenu-context'), null, 'sections alone do not force the 380px context menu');
  assert.equal(host.style['--refx-popup-section-height'], '64px');
  assert.equal(anchors, 1);
  const list = menu.querySelector('.refalias-results');
  const actionCount = list.children.length;
  release(); await tick();
  assert.equal(host.textContent, 'Late content');
  assert.equal(host.style['--refx-popup-section-height'], '64px');
  assert.equal(list.children.length, actionCount);
  assert.equal(anchors, 1, 'async content never re-anchors the menu');
  h.plugin.onUnload();
});

test('v4.44 property-sourced popup and Navigator rows reuse record-to-context breadcrumbs', async () => {
  const h = lineRefClickHarness();
  h.plugin._bodyLineCache = new Map();
  h.plugin._cacheTtlMs = 120000;
  h.plugin._propNamesReferencing = () => 'Source Line';
  h.plugin.getOrLoadRecordName = (guid) => h.records.get(guid)?.getName?.() || guid;
  const source = { guid: 'PROP_SOURCE', getName: () => 'Highlight record' };
  const contextLine = { guid: 'PROP_CONTEXT', type: 'text', segments: [{ type: 'text', text: 'test tes tes' }], children: [] };
  h.records.set(source.guid, source);
  h.window.g_universe.itemsByGuid[source.guid] = { guid: source.guid, children: [contextLine] };

  const popupBody = h.document.createElement('div'); h.document.body.append(popupBody);
  h.plugin._renderPropertyRefsGroup(popupBody, [source.guid], 'TARGET_LINE', { showBodyLines: false });
  const popupCrumb = popupBody.querySelector('.refx-property-breadcrumb');
  assert.ok(popupCrumb);
  assert.match(popupCrumb.textContent, /Highlight record.*›.*test tes tes/);

  const sdkBody = h.document.createElement('div'); h.document.body.append(sdkBody);
  h.plugin._renderSdkPropertyRefsGroup(sdkBody, [{
    recordGuid: source.guid, recordName: 'Highlight record', propNames: ['Source Line'],
  }]);
  assert.match(sdkBody.querySelector('.refx-property-breadcrumb').textContent, /Highlight record.*›.*test tes tes/);

  const target = { guid: 'PROPERTY_TARGET', getName: () => 'Target page' };
  h.records.set(target.guid, target);
  h.plugin._queryRefLines = async () => [];
  h.plugin._fetchBackrefs = async () => [{
    kind: 'property', record: source, propertyName: 'Source Line', propertyId: 'PROP_FIELD',
  }];
  h.plugin.loadPropertyReferenceRecordCount = async () => ({ recordGuids: new Set() });
  const navHost = h.document.createElement('div'); h.document.body.append(navHost);
  await h.plugin._loadNavigatorReferences({ guid: target.guid, type: 'record' }, navHost, () => true);
  const navCrumb = navHost.querySelector('.refx-nav-property-reference')
    ?.querySelector('.refx-property-breadcrumb');
  assert.ok(navCrumb);
  assert.match(navCrumb.textContent, /Highlight record.*›.*test tes tes/);
  h.plugin.onUnload();
});

test('v4.48.4 a Remark property-reference title preserves the source panel', async () => {
  const h = lineRefClickHarness();
  h.plugin._bodyLineCache = new Map();
  h.plugin._cacheTtlMs = 120000;
  h.plugin._propNamesReferencing = () => 'Source Line';
  h.plugin.getOrLoadRecordName = () => 'Highlight - ScratchPad - Aug 1';
  const jumps = [];
  h.plugin._bridgeJump = async (guid, options) => {
    jumps.push([guid, options]);
    return true;
  };
  const body = h.document.createElement('div');
  h.document.body.append(body);
  h.plugin._renderPropertyRefsGroup(body, ['REMARK_RECORD'], 'TARGET_LINE', {
    showBodyLines: true,
  });
  const title = body.querySelector('.refx-property-breadcrumb-record');
  assert.ok(title);
  title.dispatchEvent(event('click', { target: title, button: 0 }));
  await tick();
  assert.equal(jumps.length, 1);
  assert.deepEqual(jumps.map(([guid]) => guid), ['REMARK_RECORD']);
  assert.ok(jumps.every(([, options]) => options?.newPanel === true),
    'the large Remark title never replaces the panel that owns the source line');
  h.plugin.onUnload();
});

test('v4.48.4 repeated side-panel jumps share one in-flight panel transaction', async () => {
  const h = lineRefClickHarness();
  h.plugin.ensureRuntimeState();
  const record = { guid: 'REMARK_RECORD', getName: () => 'Remark' };
  h.records.set(record.guid, record);
  let releasePanel;
  let creates = 0;
  let navigations = 0;
  h.plugin.ui.createPanel = async () => {
    creates++;
    await new Promise((resolve) => { releasePanel = resolve; });
    return { navigateTo: async () => { navigations++; return true; } };
  };
  const first = h.plugin._bridgeJump(record.guid, { newPanel: true });
  const second = h.plugin._bridgeJump(record.guid, { newPanel: true });
  assert.equal(creates, 1);
  releasePanel();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(navigations, 1);
  assert.equal(h.plugin._newPanelJumpPending.size, 0);
  h.plugin.onUnload();
});

test('v4.48.4 inline counts use a quiet Roam-like superscript instead of a filled pill', () => {
  const h = lineRefClickHarness();
  h.plugin.ensureRuntimeState();
  h.plugin.injectCounterCss();
  const css = h.document.getElementById('trc-reference-counter-style').textContent;
  const start = css.indexOf('\n      .trc-refcount-badge {');
  const badgeRule = start >= 0
    ? css.slice(start, css.indexOf('\n      }', start) + 8)
    : '';
  assert.match(badgeRule, /background:\s*transparent/);
  assert.match(badgeRule, /font-weight:\s*600/);
  assert.match(badgeRule, /padding:\s*3px 4px/);
  assert.doesNotMatch(badgeRule, /border-radius/);
  h.plugin.onUnload();
});
