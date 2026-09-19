// v4.49.0 — Roam-faithful inline reference look + CSS-variable appearance knobs.
// Speed law: an appearance change is a body style/class write. It must never
// walk chips (querySelectorAll), rescan panels, or refetch counts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'plugin.js'), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
// The rule whose selector LIST contains `selector`. v4.49.8 gave the page-ref
// rules a second, guid-keyed fallback selector (an unclassified chip must paint
// the page appearance without waiting on JS), so a selector is no longer
// guaranteed to be the only one in its group. The pure transition-only group is
// still skipped: a match must carry declarations other than `transition`.
const rule = (selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(?<![\\w-])' + esc + '(\\s*,[^{]*?)?\\s*\\{([^}]*)\\}', 'g');
  const body = stripComments(source);
  let m;
  while ((m = re.exec(body))) {
    const decls = m[2];
    if (/[a-z-]+\s*:/.test(decls.replace(/transition\s*:[^;]*;?/g, ''))) return decls;
  }
  return null;
};
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));

function classListSet(initial = []) {
  const set = new Set(initial);
  return {
    add: (...names) => names.forEach((n) => set.add(n)),
    remove: (...names) => names.forEach((n) => set.delete(n)),
    contains: (name) => set.has(name),
    toggle(name, force) {
      if (force === undefined) force = !set.has(name);
      if (force) set.add(name); else set.delete(name);
      return force;
    }
  };
}

function styleDecl() {
  const props = new Map();
  return {
    props,
    setProperty: (k, v) => props.set(k, String(v)),
    removeProperty: (k) => props.delete(k),
    getPropertyValue: (k) => props.get(k) || ''
  };
}

function el(tag) {
  const children = [];
  const listeners = {};
  const node = {
    tagName: String(tag).toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    value: '',
    children,
    classList: classListSet(),
    style: styleDecl(),
    dataset: {},
    append: (...n) => children.push(...n),
    appendChild: (n) => { children.push(n); return n; },
    remove() {},
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k] == null ? null : String(this[k]); },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    _listeners: listeners
  };
  return node;
}

function loadPlugin() {
  const styles = new Map();
  const store = new Map();
  const spies = { querySelectorAll: 0 };
  const body = { classList: classListSet(), style: styleDecl(), querySelectorAll: () => { spies.querySelectorAll++; return []; } };
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
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    document: {
      getElementById: (id) => styles.get(id) || null,
      createElement: (tag) => el(tag),
      querySelectorAll: () => { spies.querySelectorAll++; return []; },
      querySelector: () => null,
      documentElement: { clientHeight: 900 },
      body,
      head: {
        appendChild(node) {
          node.isConnected = true;
          if (node.id) styles.set(node.id, node);
          return node;
        }
      }
    },
    Element: class {},
    window: {
      CSS: { escape: (s) => String(s) },
      g_universe: { itemsByGuid: {}, workspace: {} }
    }
  };
  context.globalThis = context;
  vm.runInNewContext(source + '\nthis.PluginUnderTest = Plugin;', context, { filename: 'plugin.js' });
  return { Plugin: context.PluginUnderTest, context, styles, store, spies, body };
}

function instance() {
  const h = loadPlugin();
  const plugin = new h.Plugin();
  plugin._storageKeyReferenceStyle = 'refx_reference_style_v1';
  plugin._storageKeyAppearance = 'refx_appearance_v1';
  plugin._referenceStyle = 'roam';
  plugin._appearance = plugin._appearanceDefaults();
  const calls = { refreshAllPanels: 0, scanPanel: 0, tag: 0 };
  plugin.refreshAllPanels = () => { calls.refreshAllPanels++; };
  plugin.scanPanel = () => { calls.scanPanel++; };
  plugin._tagReferenceChipsIn = () => { calls.tag++; };
  return { ...h, plugin, calls };
}

test('version locks 4.64.1', () => {
  assert.equal(manifest.version, '4.64.1');
  assert.ok(source.startsWith('// v4.64.1'), 'first line must be // v4.64.1');
  assert.match(source, /window\.__REFX_VERSION = "4\.64\.1"/);
});

test('settings modal scrolls when the window is short', () => {
  assert.match(source, /\.refalias-body \{[\s\S]*?overflow-y: auto;/);
  assert.match(source, /\.refalias-modal \{[\s\S]*?max-height:/);
});

test('plugin.json default referenceStyle is roam; code fallback agrees', () => {
  assert.equal(manifest.custom.referenceStyle, 'roam');
  assert.match(source, /const configuredReferenceStyle = cfg\?\.custom\?\.referenceStyle \|\| 'roam';/);
});

test('roam preset CSS: line refs inherit color, no text-decoration, hairline via box-shadow; page refs use the page-link color without underline', () => {
  const lineRule = rule('body.refx-links-roam .refx-lineref-chip');
  assert.ok(lineRule, 'roam lineref rule present');
  assert.match(lineRule, /color: inherit !important;/);
  assert.match(lineRule, /text-decoration: none;/);
  assert.match(lineRule, /background: transparent;/);
  assert.match(lineRule, /box-shadow: inset 0 -1px 0 var\(--refx-line-underline,/);
  assert.doesNotMatch(lineRule, /padding|border-width|border-bottom|font-size|min-width/);

  const pageRule = rule('body.refx-links-roam .refx-pageref-chip');
  assert.ok(pageRule, 'roam pageref rule present');
  assert.match(pageRule, /color: var\(--refx-page-link-color, #106ba3\) !important;/);
  assert.match(pageRule, /text-decoration: none;/);
  assert.doesNotMatch(pageRule, /padding|border|font-size|min-width/);

  // hover wash + underline style variants
  assert.match(source, /body\.refx-links-roam \.refx-lineref-chip:hover \{[^}]*background-color: var\(--refx-line-hover-bg, rgba\(127,127,127,\.08\)\);/);
  assert.match(source, /body\.refx-links-roam\.refx-line-underline-none \.refx-lineref-chip \{\s*box-shadow: none;\s*\}/);
  assert.match(source, /body\.refx-links-roam\.refx-line-underline-dotted \.refx-lineref-chip \{[^}]*background-image: repeating-linear-gradient/);
});

test('roam preset counts: 0.8em / 0.5 opacity / weight 400 via CSS variables; inherit color, transparent bg', () => {
  assert.match(source, /body\.refx-links-roam \{\s*--refx-count-size-preset: 0\.8em;\s*--refx-count-opacity-preset: 0\.5;\s*--refx-count-weight-preset: 400;\s*\}/);
  assert.match(source, /\.trc-target-badge-wrap \.trc-target-badge \{\s*font-size: var\(--refx-count-size, var\(--refx-count-size-preset, var\(--refx-count-size-scale, 12px\)\)\);\s*opacity: var\(--refx-count-opacity, var\(--refx-count-opacity-preset, \$\{this\._opacity\}\)\);\s*font-weight: var\(--refx-count-weight, var\(--refx-count-weight-preset, 600\)\);/);
  assert.match(source, /\.trc-refcount-badge-wrap \.trc-refcount-badge \{\s*font-size: var\(--refx-count-size, var\(--refx-count-size-preset, var\(--refx-count-size-scale, 11px\)\)\);/);
  assert.match(source, /body\.refx-links-roam \.trc-target-badge,\s*body\.refx-links-roam \.trc-refcount-badge \{\s*color: inherit;\s*background: transparent;\s*\}/);
  // legacy Badge size classes still work by feeding the scale var
  assert.match(source, /\.trc-target-badge-wrap\.trc-size-medium \{ --refx-count-size-scale: 12px; \}/);
  assert.match(source, /\.trc-refcount-badge-wrap\.trc-size-medium \{ --refx-count-size-scale: 11px; \}/);
});

test('count wraps keep zero-layout geometry (V7): absolute + width 0', () => {
  assert.match(source, /\.trc-target-badge-wrap \{[\s\S]*?position: absolute;[\s\S]*?width: 0;[\s\S]*?min-width: 0;/);
});

test('distinct and native presets still exist', () => {
  const { plugin } = instance();
  assert.equal(plugin.normalizeReferenceStyle('distinct'), 'distinct');
  assert.equal(plugin.normalizeReferenceStyle('native'), 'native');
  assert.equal(plugin.normalizeReferenceStyle('roam'), 'roam');
  const distinctPage = rule('body.refx-links-distinct .refx-pageref-chip');
  assert.ok(distinctPage, 'distinct pageref rule present');
  assert.match(distinctPage, /text-decoration: underline solid currentColor;/);
  assert.match(source, /body\.refx-links-distinct \.refx-lineref-chip \{[^}]*text-decoration: underline dotted currentColor;/);
});

test('changing a knob writes one CSS variable on body and persists, without walking chips or rescanning panels', () => {
  const { plugin, body, store, spies, calls } = instance();
  spies.querySelectorAll = 0;

  plugin.setAppearance('pageLinkColor', '#ff0000');
  assert.equal(body.style.getPropertyValue('--refx-page-link-color'), '#ff0000');
  plugin.setAppearance('countOpacity', '0.9');
  assert.equal(body.style.getPropertyValue('--refx-count-opacity'), '0.9');
  plugin.setAppearance('countSize', '1em');
  assert.equal(body.style.getPropertyValue('--refx-count-size'), '1em');
  plugin.setAppearance('countWeight', '600');
  assert.equal(body.style.getPropertyValue('--refx-count-weight'), '600');
  plugin.setAppearance('lineUnderlineStyle', 'dotted');
  assert.equal(body.classList.contains('refx-line-underline-dotted'), true);
  assert.equal(body.classList.contains('refx-line-underline-solid'), false);
  plugin.setAppearance('lineHoverBg', '');
  assert.equal(body.style.getPropertyValue('--refx-line-hover-bg'), 'transparent');

  const saved = JSON.parse(store.get('refx_appearance_v1'));
  assert.equal(saved.pageLinkColor, '#ff0000');
  assert.equal(saved.countOpacity, '0.9');
  assert.equal(saved.lineUnderlineStyle, 'dotted');

  assert.equal(spies.querySelectorAll, 0, 'no querySelectorAll over chips');
  assert.equal(calls.refreshAllPanels, 0, 'no refreshAllPanels');
  assert.equal(calls.scanPanel, 0, 'no scanPanel');
  assert.equal(calls.tag, 0, 'no _tagReferenceChipsIn');
});

test('switching the preset is a body-class toggle only', () => {
  const { plugin, body, spies, calls, store } = instance();
  spies.querySelectorAll = 0;
  plugin.setReferenceStyle('distinct');
  assert.equal(body.classList.contains('refx-links-distinct'), true);
  assert.equal(body.classList.contains('refx-links-roam'), false);
  assert.equal(store.get('refx_reference_style_v1'), 'distinct');
  plugin.setReferenceStyle('roam');
  assert.equal(body.classList.contains('refx-links-roam'), true);
  assert.equal(spies.querySelectorAll, 0);
  assert.equal(calls.tag, 0);
  assert.equal(calls.refreshAllPanels, 0);
  const fn = stripComments(source.slice(source.indexOf('  setReferenceStyle(value) {'), source.indexOf('  static get APPEARANCE_KNOBS()')));
  assert.doesNotMatch(fn, /_tagReferenceChipsIn|querySelectorAll|refreshAllPanels|scanPanel/);
});

test('appearance values are sanitized and clamped; stored JSON wins over config seed', () => {
  const { plugin, store } = instance();
  assert.equal(plugin._sanitizeAppearanceValue('countOpacity', '5'), '1');
  assert.equal(plugin._sanitizeAppearanceValue('countOpacity', '0'), '0.2');
  assert.equal(plugin._sanitizeAppearanceValue('countOpacity', 'abc'), '0.5');
  assert.equal(plugin._sanitizeAppearanceValue('countSize', '3em'), '0.8em');
  assert.equal(plugin._sanitizeAppearanceValue('lineUnderlineStyle', 'wavy'), 'solid');
  assert.equal(plugin._sanitizeAppearanceValue('pageLinkColor', 'red; } body { display:none'), '#106ba3');
  assert.equal(plugin._sanitizeAppearanceValue('pageLinkColor', 'rgb(16,107,163)'), 'rgb(16,107,163)');

  store.set('refx_appearance_v1', JSON.stringify({ pageLinkColor: '#123456' }));
  const a = plugin._loadAppearance({ pageLinkColor: '#abcdef', countWeight: '600' });
  assert.equal(a.pageLinkColor, '#123456', 'localStorage beats config seed');
  assert.equal(a.countWeight, '600', 'config seed fills unset knobs');
  assert.equal(a.lineUnderline, 'rgba(138,155,168,.62)');
  assert.equal(a.countSize, '0.8em');
  assert.equal(a.countOpacity, '0.5');

  plugin.setAppearance('pageLinkColor', '#00ff00');
  plugin.resetAppearance();
  assert.equal(store.has('refx_appearance_v1'), false);
  assert.equal(plugin._appearance.pageLinkColor, '#106ba3');
});

test('no padding / border-width / font-size / min-width lands on editable chips in any preset', () => {
  const block = stripComments(source.slice(source.indexOf('/* Reference appearance. Classification is explicit'), source.indexOf('/* RefX already exposes Open / Open in side panel')));
  for (const m of block.matchAll(/\{([^}]*)\}/g)) {
    assert.doesNotMatch(m[1], /(^|[^-])padding\s*:|border-width|border-bottom|font-size|min-width/, 'caret law: ' + m[1].trim().slice(0, 60));
  }
});

test('CHANGELOG has no deterministic-test count line for 4.49.0', () => {
  const log = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const section = log.slice(log.indexOf('## v4.49.0'), log.indexOf('## v4.48.9'));
  assert.doesNotMatch(section, /\*\*Verification:\*\*/);
});
