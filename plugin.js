// Reference Extravaganza
//
// • Type [[ to reference a regular line of text inline: a search box opens at
//   the cursor, pick a line, and a reference is inserted (it displays that
//   line's text by default; re-label it later with the alias command).
// • "Set alias for reference"     — rename what a reference chip displays.
// • "Set alias keyboard shortcut" — rebind the alias shortcut, no code/JSON.
//
// An "alias" in Thymer is just the `title` field on a `ref` segment
// ({type:"ref", text:{guid, title?}}). This plugin reads/writes that field.
//
// PERFORMANCE: the plugin is idle until you act. Its only always-on cost is two
// keydown listeners whose first line rejects nearly every keystroke instantly
// (one checks for the alias-shortcut modifiers, one checks for "["), so normal
// typing pays a single comparison. No MutationObservers, no polling, no rAF
// loops, no work on scroll or render.

/* ── VIEW OPTIONS: registration ─────────────────────────────────────────────
 * The ⋯ chip on a line and the menu behind it belong to the View Options
 * plugin. We contribute ONE provider record — plain data plus our own
 * callbacks — and it does all of the rendering: the chip, the menu surface,
 * the in-block filter, the geometry. Nothing here draws anything.
 *
 * With View Options not installed every call below is a no-op: there is no
 * host to poke, our record simply sits in a list nobody reads, and this plugin
 * keeps all its other features. That is the whole dependency, and it is on the
 * plugin that provides the menu, not on another contributor.
 *
 * THIS SNIPPET IS STABLE — the contract is what is shared, not this code, so
 * there is nothing to re-sync when the menu changes. Its canonical text, the
 * provider shape and the contract live in
 * Thymer_plugins/shared/SHARED-VIEW-OPTIONS.md. */
const REFX_VO_GLOBAL = '__thymerViewOptions';
const REFX_VO_CONTRACT = 1;
/* OUR STABLE IDENTITY in the registry, and the one thing in this snippet a
 * plugin must change: registering replaces the record with the same id, and
 * unregistering removes it by id. */
const REFX_VO_ID = 'reference-extravaganza.description';

/* Either side may create the record — load order between plugins is nobody's
 * to decide — so we seed it too. It holds DATA and never implementation, which
 * is what makes that safe: nothing of ours can end up imposed on anyone else,
 * whatever version each plugin happens to be. */
function refxVoRoot() {
	let R = null;
	try { R = window[REFX_VO_GLOBAL]; } catch (e) { return null; }
	if (!R) {
		R = { contract: REFX_VO_CONTRACT, providers: [], rev: 0, host: null };
		try { window[REFX_VO_GLOBAL] = R; } catch (e) { return null; }
		return R;
	}
	/* a contract we do not know is a shape we cannot write safely: stand down
	 * entirely rather than guess */
	if (R.contract !== REFX_VO_CONTRACT) return null;
	if (!Array.isArray(R.providers)) R.providers = [];
	if (typeof R.rev !== 'number') R.rev = 0;
	return R;
}

/* Registering REPLACES the record with the same id, which is what keeps a hot
 * reload — a fresh evaluation of this file while the previous one's record is
 * still in the registry — from contributing our rows twice. */
function refxVoRegister(rec) {
	const R = refxVoRoot();
	if (!R || !rec || !rec.id) return;
	const i = R.providers.findIndex((p) => p && p.id === rec.id);
	if (i >= 0) R.providers.splice(i, 1, rec); else R.providers.push(rec);
	refxVoPoke(R);
}

/* onUnload. Safe on an instance whose onLoad never ran (playbook §2). */
function refxVoUnregister(id) {
	const R = refxVoRoot();
	if (!R) return;
	const i = R.providers.findIndex((p) => p && p.id === id);
	if (i >= 0) R.providers.splice(i, 1);
	refxVoPoke(R);
}

/* "What I contribute just changed" — bump the shared rev and ask the renderer
 * to repaint NOW. Its own cycle would get there on the next scroll or pointer
 * release, which is fine for a passive change and reads as "it did nothing"
 * after a direct user action (measured at ~0.5s, his report 2026-08-13). */
function refxVoPoke(R) {
	const RR = R || refxVoRoot();
	if (!RR) return;
	RR.rev++;
	const h = RR.host;
	if (h && typeof h.poke === 'function') { try { h.poke(); } catch (e) {} }
}

class Plugin extends AppPlugin {
  // Instance state as class fields (Thymer may call onUnload on an instance
  // whose onLoad never ran — never rely on onLoad to initialise these).
  _cmd = null;
  _shortcutCmd = null;
  _collapseAllCmd = null;
  _modal = null;
  _link = null;
  _linePreviewEl = null;
  _lastBracketTs = 0;
  _hotkey = null;
  _convertCmd = null;
  _descCmd = null;
  _convertHotkey = null;
  // Multiple embeds are real document lines (the source of truth); we keep no
  // single-slot state. _expandInFlight only debounces double-creates from fast
  // keypresses. _cards indexes THIS page's plugin-created record embeds
  // (lineGuid -> {recordGuid, line}) so the property-card observer can re-inject.
  _expandInFlight = new Set();
  _cards = new Map();
  // Embeds spawned from LIVE-SEARCH result rows (embedLineGuid -> {resultRealGuid,
  // node?, row?, parked?}). The embed LINE lives after the query block (queries
  // can't render children), but its rendered NODE is parked directly under the
  // result row; the observer re-parks it when a re-render moves/replaces either.
  _queryEmbeds = new Map();
  _queryRaf = 0;
  // Standalone LINE-ref embeds (embedLineGuid -> {node?}). A [[ line ref whose
  // target has no children of its own renders just that one line; we give it the
  // same "click the strip to add an indented child" affordance the live-search
  // line embeds have. Marked with .refx-lineembed (the CSS writing strip) and
  // wired via _wireEmbedBodyClick; the observer re-marks after a re-render.
  _lineEmbeds = new Map();
  _lineRaf = 0;
  // PAGE EMBEDS (2026-11-02): a page reference expanded on the desktop shows the REAL page panel
  // (Thymer's own properties + body) inside our transclusion line, instead of a homemade card.
  // embedLineGuid -> {recordGuid, panel, slot, ready}. See "page embeds: the real page panel".
  _pageEmbeds = new Map();
  _pePark = null;
  _peWatchT = 0;
  _peCreating = null; // the last attach in flight (they are chained, see _peAttach)
  _pePool = [];       // idle borrowed panels {panel, slot}, parked, reused by the next expand
  _peHide = new Map(); // embed lineGuid -> 0 (open/opening) or the time its hiding may end (closing)
  _peHideT = 0;
  _PE_POOL = 3;
  _PE_CAP = 6; // panels Thymer allows are limited (it warns at 10); beyond this the native body shows
  _cardObs = null;
  _cardObsTarget = null;
  _navHandler = null;
  _recUpdHandler = null;
  _discoverT = 0; // debounce timer for re-discovering embeds (focus / remote edits)
  _discoverRefresh = false; // latched: the pending discovery should also refresh present cards
  _rehydrateT = 0; // the load-time retry timer (cleared on unload so a late retry can't resurrect a dead instance)
  _unloaded = false;
  _isMac = /Mac|iPhone|iPad/.test((typeof navigator !== "undefined" && (navigator.platform || navigator.userAgent)) || "");
  _STYLE_ID = "refalias-style";
  // Line DESCRIPTIONS: a subtitle under a line, stored as the line's own meta
  // property `refx_desc` and rendered ENTIRELY through a generated stylesheet
  // (own <style> element, rebuilt on demand). Never a DOM node inside the line —
  // the editor derives caret offsets from its own node tree, so an injected span
  // flickers, eats Backspaces and walks the caret backwards (THYMER-LESSONS §1.2).
  // CSS keyed on [data-guid] survives every re-render for free and costs nothing
  // while typing, and the outline structure is untouched (no child line).
  _DESC_STYLE_ID = "refx-desc-style";
  _DESC_PROP = "refx_desc";
  // Optical gap between a heading's glyphs and its description, in px. Tuned on H1
  // (Parham approved that one), then applied to every level via _descMetrics.
  _DESC_GAP = 2.8;
  // Target heading->description gap, MEASURED from where the glyphs actually end.
  // 8px is what h1 rendered at when Parham approved its spacing; the refine pass
  // corrects every other level onto it.
  _DESC_HEAD_GAP = 7;
  // Extra space below the description, pushing the child block (and any progress
  // bar drawn between) down so the line does not crowd its children.
  _DESC_BLOCK_PUSH = 5;
  // Non-heading (todo/plain) lines want the block tighter than headings do, so the
  // progress bar sits closer under the description.
  _DESC_BLOCK_PUSH_PLAIN = 0;
  // How much lower a todo/plain description sits than a heading's, without giving
  // the line any extra height (so nothing below it moves).
  _DESC_PLAIN_NUDGE = 2;
  // Ceiling on the per-heading-level gap equalisation (it only ever needs ~3px).
  _DESC_EQUALISE_MAX = 4;
  // Frozen indent-line geometry (see _refineDescClips) — approved look, no drift.
  _DESC_NATIVE_FIXED = { above: -1.94, below: -1.28 };
  // Shorten the indent line at the TOP only (bottom stays put), so there is a
  // little air between the progress bar and where the line starts.
  _DESC_LINE_TRIM = 2;
  // How far ABOVE the first child the indent line starts. Matches the h2 look
  // Parham approved and is applied to every level and plain lines alike.
  _DESC_LINE_PAD = 4;
  _descT = 0;      // debounce timer for stylesheet rebuilds
  _descCSS = "";   // last emitted CSS — skip no-op DOM writes
  _descClipCSS = ""; // measured indent-line clips, appended after the base rules
  _descClipRaf = 0;
  _descClipT = 0;
  _descObs = null;   // re-measures the indent line when the outline changes
  _descObsT = 0;
  _descNative = null; // {above, below}: how far a NATIVE indent line overshoots its children
  _descLastDown = null;    // first press of a possible double-click on a description
  _descSwallowUntil = 0;   // eat the rest of that pointer sequence
  _DESC_NATIVE_KEY = "refx-desc-native";
  // vast majority of keystrokes (plain typing) before doing anything else.
  _handleKeydown = (e) => {
    if (this._modal) return;            // a dialog is open — don't re-trigger
    const h = this._hotkey;
    if (!h) return;
    if (e.metaKey !== h.meta) return;
    if (e.ctrlKey !== h.ctrl) return;
    if (e.shiftKey !== h.shift) return;
    if (e.altKey !== h.alt) return;
    if (this._link) return;
    if (e.code !== h.code && (e.key || "").toLowerCase() !== h.key) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this._onCommand();
  };

  // Shortcut for "Convert reference ↔ embedded line". Same cheap-first guards.
  _handleConvertKey = (e) => {
    if (this._modal || this._link) return;
    const h = this._convertHotkey;
    if (!h) return;
    if (e.metaKey !== h.meta || e.ctrlKey !== h.ctrl || e.shiftKey !== h.shift || e.altKey !== h.alt) return;
    if (e.code !== h.code && (e.key || "").toLowerCase() !== h.key) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this._onConvert();
  };

  // Watches for "[" only (first line rejects every other key). When a second
  // "[" lands at the caret, opens the line-reference picker. Does NOT prevent
  // the keystroke — Thymer inserts the "[" normally; we just react afterwards.
  _handleBracketKey = (e) => {
    if (e.key !== "[") { this._lastBracketTs = 0; return; }
    if (this._modal || this._link) { this._lastBracketTs = 0; return; }
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) { this._lastBracketTs = 0; return; }
    const now = Date.now();
    if (this._lastBracketTs && now - this._lastBracketTs < 1200) {
      this._lastBracketTs = 0;
      setTimeout(() => this._triggerLink(), 0); // two consecutive "[" → open
    } else {
      this._lastBracketTs = now;
    }
  };

  // While [[ link mode is open: navigation keys are handled here at the window
  // capture phase; other keys fall through to the editor (which keeps focus),
  // then we re-read the inline query.
  _linkKey = (e) => {
    const link = this._link;
    if (!link) return;
    if (e.key === "ArrowDown") { e.preventDefault(); e.stopImmediatePropagation(); if (link.results.length) { link.sel = (link.sel + 1) % link.results.length; this._renderLink(); } return; }
    if (e.key === "ArrowUp") { e.preventDefault(); e.stopImmediatePropagation(); if (link.results.length) { link.sel = (link.sel - 1 + link.results.length) % link.results.length; this._renderLink(); } return; }
    if (e.key === "Enter") { const r = link.results[link.sel]; if (r) { e.preventDefault(); e.stopImmediatePropagation(); this._pickLink(r); } else { this._exitLinkMode(); } return; }
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); this._abortLink(); return; }
    // The query is tracked from keystrokes (NOT by re-reading the line, which
    // can be stale right after typing and wrongly close the box). Keys still
    // fall through to the editor, so the inline text and the query stay in sync.
    if (e.key === "Backspace") {
      if (link.query.length === 0) { this._exitLinkMode(); return; } // about to delete a bracket
      link.query = link.query.slice(0, -1);
      this._scheduleLinkSearch();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End" || e.key === "Tab") { this._exitLinkMode(); return; }
    if (e.key && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      link.query += e.key;
      this._scheduleLinkSearch();
    }
  };

  _linkClickOutside = (e) => {
    if (!this._link) return;
    if (this._link.pop.contains(e.target)) return;
    this._exitLinkMode();
  };

  // Expand/collapse references (Tana-style), now MANY at once. Cmd/Ctrl+Down
  // expands the selected reference inline as a native transclusion (the target +
  // its children, editable); for a record reference an editable property card is
  // added above the body. Cmd/Ctrl+Up collapses — but ONLY from the reference's
  // own line (embed open) or from the embed line itself: everywhere else,
  // including INSIDE an embed's body, the chord stays native (fold indents).
  // Embeds are real document lines, so several coexist and they persist across
  // reload. Cheap-first guards keep ordinary typing/arrowing untouched.
  _handleExpandKey = (e) => {
    const primary = this._isMac ? e.metaKey : e.ctrlKey;
    if (!primary || e.shiftKey || e.altKey) return;
    const isDown = e.key === "ArrowDown", isUp = e.key === "ArrowUp";
    if (!isDown && !isUp) return;
    if (this._modal || this._link) return;
    const hit = this._detect();
    if (!hit) return;
    // THE KEYBOARD BELONGS TO THE FOCUSED PANEL. _detect() falls back to any
    // listview still carrying a caret, and a caret goes stale in a panel you
    // have clicked away from. With a custom view focused in the other half of
    // a split (Timeline's calendar list, 2026-09-21), Cmd+Down expanded a ref
    // under the journal's OLD caret and swallowed the key, so the view that
    // owned the keyboard never got its own Cmd+Down. With no focused panel, or
    // the caret in the focused one, nothing changes.
    const fp = document.querySelector(".panel.focused-panel");
    if (fp && hit.panel && hit.panel !== fp) return;
    if (isUp) {
      // Collapse ONLY from the reference's own line (with its embed open) or from
      // our embed line itself. INSIDE the embed body Cmd+Up must fall through to
      // Thymer — it's the native fold-indent chord, and swallowing it there made
      // outlines inside a transclusion impossible to collapse.
      let can = false;
      if (hit.queryLineGuid) can = this._queryEmbedOpenSync(hit);
      else can = this._lineEmbedOpenSync(hit);
      if (!can) can = this._caretOnEmbedLine(hit);
      if (!can) return;
      e.preventDefault(); e.stopImmediatePropagation();
      this._collapseAtCaret(hit);
      return;
    }
    // Cmd+Down: expand — on a reference, or on any live-search result line
    // (children can't be known synchronously for a non-open source page; the
    // async query path decides line-vs-ref. Swallowing is safe there: native
    // Cmd+Down is a no-op inside query results — children never render).
    const ref = this._selectedRef(hit);
    if (!ref && !hit.queryLineGuid) return; // native handles (incl. folded no-ref lines)
    // COLLAPSED line with a reference: let NATIVE Cmd+Down unfold the block first
    // (exactly as it does for a plain folded block) — only a SECOND Cmd+Down
    // (line now unfolded) reaches us and opens the transclusion. We must NOT
    // swallow here: returning lets the native fold shortcut run. (A prior version
    // drove the unfold ourselves by clicking the "…" control, but a folded line
    // can instead show a chevron fold toggle, so that click found nothing and
    // left Cmd+Down dead on those lines.) Live-search rows never fold.
    if (hit.isFolded && !hit.queryLineGuid) return;
    e.preventDefault(); e.stopImmediatePropagation();
    this._expandRef(hit, ref);
  };

  // The property card is decorator DOM (not part of the synced document), so it
  // only exists on clients that have DISCOVERED the embed. Switching to an already-
  // open client, or a multiplayer edit, doesn't fire panel.navigated — so re-run
  // discovery when the tab regains focus/visibility (and on record.updated below).
  _discoverTrigger = () => { if (!document.hidden) this._scheduleDiscover(true); };

  onLoad() {
    try { window.__REFX_VERSION = "3.5.0-dev"; } catch (e) {} // live-version tell for debugging
    // Build tag, bumped on every dev deploy: the app can serve a STALE plugin
    // snapshot right after a restart (server had the new code, the renderer ran
    // the old), so deploy verification must check THIS in the live page, not
    // just md5 the server copy.
    try { window.__REFX_BUILD = "3.5.0-dev.3"; } catch (e) {}
    this._killStaleObservers(); // clear any observer/cards leaked by a hot-reload
    // Code-load counter: tools/hotpush.mjs requires it to rise, which proves the push reached the
    // running instance and not only the store.
    try { window.__refxGen = (window.__refxGen || 0) + 1; } catch (e) {}
    this._peCloseOrphans();
    this._injectStyle();
    // Restore the cached native indent-line geometry before the first paint, so a
    // page with no undescribed parent still lands on real measurements.
    try {
      const raw = localStorage.getItem(this._DESC_NATIVE_KEY);
      const v = raw ? JSON.parse(raw) : null;
      if (v && isFinite(v.above) && isFinite(v.below)) this._descNative = v;
    } catch (e) {}
    this._rebuildDescCSS(); // line descriptions: paint before the first frame
    // The property card (gone 2026-11-02) kept its view choice per device here; nothing reads it now.
    try { localStorage.removeItem("refx-card-prefs"); } catch (e) {}

    this._cmd = this.ui.addCommandPaletteCommand({
      label: "Set alias for reference",
      icon: "ti-pencil",
      onSelected: () => { this._onCommand(); },
    });
    this._shortcutCmd = this.ui.addCommandPaletteCommand({
      label: "Set Reference Extravaganza shortcuts",
      icon: "ti-keyboard",
      onSelected: () => { this._openShortcutModal(); },
    });
    this._collapseAllCmd = this.ui.addCommandPaletteCommand({
      label: "Collapse all embeds (this page)",
      icon: "ti-arrows-minimize",
      onSelected: () => { this._collapseAllOnPage(); },
    });
    this._convertCmd = this.ui.addCommandPaletteCommand({
      label: "Convert reference ↔ embedded line",
      icon: "ti-arrows-exchange",
      onSelected: () => { this._onConvert(); },
    });
    this._descCmd = this.ui.addCommandPaletteCommand({
      label: "Set Description for Line",
      icon: "ti-file-description",
      onSelected: () => { this._onDescCommand(); },
    });

    const cfg = (this.getConfiguration && this.getConfiguration()) || {};
    const shortcutStr = (cfg.custom && cfg.custom.shortcut) || "Mod+Shift+A";
    this._hotkey = this._parseShortcut(shortcutStr);
    const convertStr = (cfg.custom && cfg.custom.convertShortcut) || "Mod+Ctrl+R";
    this._convertHotkey = this._parseShortcut(convertStr);
    window.addEventListener("keydown", this._handleKeydown, true);
    window.addEventListener("keydown", this._handleBracketKey, true);
    window.addEventListener("keydown", this._handleExpandKey, true);
    window.addEventListener("keydown", this._handleConvertKey, true);
    window.addEventListener("keydown", this._peKey, true);
    for (const t of ["pointerdown", "mousedown", "mouseup", "click", "dblclick"]) window.addEventListener(t, this._handleDescPointer, true);
    window.__refxDescDbl = this._handleDescPointer; // hot-reload stash
    // Window-singleton stash of the always-on handlers: a hot-reload re-runs onLoad
    // on the SAME document without disposing the prior instance, so without this
    // every update stacks another copy of all four capture listeners (and the old
    // ones' stopImmediatePropagation can starve the live instance).
    window.__refxKeyHandlers = [this._handleKeydown, this._handleBracketKey, this._handleExpandKey, this._handleConvertKey, this._peKey];

    // Embeds persist across reload, so re-discover the record embeds on the
    // active page and (re)attach their property cards; repeat on navigation.
    try { this._navHandler = this.events.on("panel.navigated", () => this._onNavigated()); } catch (e) {}
    // Keep cards current when the embedded record changes elsewhere (e.g. you
    // rename it, or edit its properties on another page).
    try { this._recUpdHandler = this.events.on("record.updated", (ev) => this._onRecordUpdated(ev)); } catch (e) {}
    // Re-discover embeds when this client regains focus/visibility (switching back
    // from the desktop app or another tab doesn't fire panel.navigated).
    document.addEventListener("visibilitychange", this._discoverTrigger, false);
    window.addEventListener("focus", this._discoverTrigger, false);
    window.__refxDiscoverTrigger = this._discoverTrigger;
    // The shared View Options menu, which the View Options PLUGIN renders.
    // Registering REPLACES any record with our id (so a hot reload cannot
    // duplicate the row) and pokes it so the row is offered at once. With View
    // Options not installed this is a no-op and we simply have no menu row.
    try { refxVoRegister(this._voProvider()); } catch (e) {}
    this._rehydrate(0);
  }

  _onRecordUpdated(ev) {
    let g = null; try { g = ev && ev.recordGuid; } catch (e) {}
    // Descriptions can change on another client (or on a page that just loaded
    // its lines) — a debounced stylesheet rebuild is the whole keep-alive.
    this._scheduleDescCSS();
    // An embedded page that changed needs nothing from us: its panel is Thymer's own and live.
    let tracked = false;
    if (g && this._cards.size) for (const e of this._cards.values()) if (e.recordGuid === g) { tracked = true; break; }
    // A remote/multiplayer edit may have ADDED or removed an embed on the page
    // we're viewing — re-discover (debounced) so it appears/clears without a
    // navigation. Skip when the update is for a page we already embed (typing in an
    // embedded body streams record.updated per keystroke; no structural change implied).
    if (!tracked) this._scheduleDiscover(false);
  }

  // Coalesce bursts of triggers (focus, a stream of record.updated during a remote
  // edit) into a single additive discovery pass. TRAILING debounce — each trigger
  // re-arms the timer, so a sustained typing/edit burst runs discovery ONCE at the
  // end instead of every 400ms mid-burst. refreshPresent latches ON across the
  // window so a focus event isn't downgraded by a concurrent edit burst.
  _scheduleDiscover(refreshPresent) {
    if (refreshPresent) this._discoverRefresh = true;
    if (this._discoverT) { try { clearTimeout(this._discoverT); } catch (e) {} }
    this._discoverT = setTimeout(() => { this._discoverT = 0; const rp = this._discoverRefresh; this._discoverRefresh = false; this._discover(rp); }, 400);
  }

  onUnload() {
    // Mark dead FIRST: in-flight async continuations (_discover awaits, the
    // _rehydrate retry, _attachPropCard record polls) all bail on this flag /
    // on the emptied _cards, so a disabled instance can't resurrect itself or
    // clobber a newer instance's state.
    this._unloaded = true;
    // Leave the shared View Options menu: drop our provider by id, so our row
    // goes and View Options repaints without it. Safe on an instance whose
    // onLoad never ran — the snippet guards that itself.
    try { refxVoUnregister(REFX_VO_ID); } catch (e) {}
    if (this._rehydrateT) { try { clearTimeout(this._rehydrateT); } catch (e) {} this._rehydrateT = 0; }
    this._cards.clear();
    this._queryEmbeds.clear();
    if (this._queryRaf) { try { cancelAnimationFrame(this._queryRaf); } catch (e) {} this._queryRaf = 0; }
    window.removeEventListener("keydown", this._handleKeydown, true);
    window.removeEventListener("keydown", this._handleBracketKey, true);
    window.removeEventListener("keydown", this._handleExpandKey, true);
    window.removeEventListener("keydown", this._handleConvertKey, true);
    window.removeEventListener("keydown", this._peKey, true);
    try { for (const t of ["pointerdown", "mousedown", "mouseup", "click", "dblclick"]) window.removeEventListener(t, this._handleDescPointer, true); } catch (e) {}
    window.__refxDescDbl = null;
    window.__refxKeyHandlers = null;
    try { document.removeEventListener("visibilitychange", this._discoverTrigger, false); } catch (e) {}
    try { window.removeEventListener("focus", this._discoverTrigger, false); } catch (e) {}
    window.__refxDiscoverTrigger = null;
    if (this._discoverT) { try { clearTimeout(this._discoverT); } catch (e) {} this._discoverT = 0; }
    // Embeds are real document lines and intentionally PERSIST — only tear down
    // the plugin's own UI (observer + injected cards + borrowed page panels), never the embeds.
    this._peCloseAll();
    this._teardownCardObserver();
    if (this._navHandler) { try { this.events.off(this._navHandler); } catch (e) {} this._navHandler = null; }
    if (this._recUpdHandler) { try { this.events.off(this._recUpdHandler); } catch (e) {} this._recUpdHandler = null; }
    this._exitLinkMode();
    this._hotkey = this._convertHotkey = null;
    if (this._cmd && this._cmd.remove) this._cmd.remove();
    if (this._shortcutCmd && this._shortcutCmd.remove) this._shortcutCmd.remove();
    if (this._collapseAllCmd && this._collapseAllCmd.remove) this._collapseAllCmd.remove();
    if (this._convertCmd && this._convertCmd.remove) this._convertCmd.remove();
    if (this._descCmd && this._descCmd.remove) this._descCmd.remove();
    this._cmd = this._shortcutCmd = this._collapseAllCmd = this._convertCmd = this._descCmd = null;
    this._closeModal();
    const st = document.getElementById(this._STYLE_ID);
    if (st) st.remove();
    // Descriptions are plugin-rendered: with the plugin gone the lines go back to
    // plain (the data stays in refx_desc, so it returns when it loads again).
    if (this._descT) { try { clearTimeout(this._descT); } catch (e) {} this._descT = 0; }
    if (this._descClipRaf) { try { cancelAnimationFrame(this._descClipRaf); } catch (e) {} this._descClipRaf = 0; }
    if (this._descClipT) { try { clearTimeout(this._descClipT); } catch (e) {} this._descClipT = 0; }
    this._teardownDescObserver();
    this._descCSS = "";
    this._descClipCSS = "";
    const dst = document.getElementById(this._DESC_STYLE_ID);
    if (dst) dst.remove();
  }

  // ------------------------------------------------------- line descriptions

  // A description is a subtitle shown under a line. It is NOT a document line:
  // it lives in the line's meta property `refx_desc`, so the outline structure
  // is untouched (no child appears, nothing folds/moves/exports differently) and
  // it cannot be deleted by a stray Backspace. It renders through a generated
  // stylesheet — see the _DESC_STYLE_ID note for why nothing is ever injected
  // into the line's DOM. Set/edit/remove it with the command (no hover, no
  // placeholder: an unset line looks exactly like today).
  _descTextFor(lineGuid) {
    try {
      const st = ((window.g_universe && window.g_universe.itemsByGuid) || {})[lineGuid];
      const v = st && st.props && st.props[this._DESC_PROP];
      return typeof v === "string" ? v : (v == null ? "" : String(v));
    } catch (e) { return ""; }
  }

  // Double-click ON the description opens its editor. The description is a CSS
  // ::after with pointer-events:none, so there is nothing to attach a listener to —
  // instead watch presses on the line and test whether they landed inside the band
  // the description occupies (the bottom of .line-div's content box, above the
  // padding we add). Returns the line guid, or null when the press was elsewhere.
  _descBandHit(e) {
    if (this._unloaded || this._modal || this._link) return null;
    if (e.button !== undefined && e.button !== 0) return null;
    let li = null;
    try { li = e.target && e.target.closest && e.target.closest(".listitem[data-guid]"); } catch (err) {}
    if (!li) return null;
    const guid = li.getAttribute("data-guid");
    if (!guid || !this._descTextFor(guid)) return null;
    const ld = li.querySelector(".line-div");
    if (!ld) return null;
    let descH = 0, padB = 0;
    try {
      const aCS = getComputedStyle(ld, "::after");
      descH = parseFloat(aCS.height) || 0;
      // border-box: computed height includes the cover padding — strip it so
      // the double-click band matches the visible text, not the padded box.
      if (aCS.boxSizing === "border-box") descH -= (parseFloat(aCS.paddingTop) || 0) + (parseFloat(aCS.paddingBottom) || 0);
      padB = parseFloat(getComputedStyle(ld).paddingBottom) || 0;
    } catch (err) { return null; }
    if (!descH) return null;
    const r = ld.getBoundingClientRect();
    const bandBottom = r.bottom - padB, bandTop = bandBottom - descH;
    if (e.clientY < bandTop - 1 || e.clientY > bandBottom + 1) return null;
    if (e.clientX < r.left || e.clientX > r.right) return null;
    return { guid, li };
  }

  // Swallowing only `dblclick` was too late: by then Thymer had already handled the
  // SECOND mousedown and selected the word (Parham saw the line highlight behind the
  // modal). So detect the double ourselves on the press, eat that whole pointer
  // sequence, and open the editor from there. The FIRST press is left alone, so a
  // single click still behaves natively.
  _handleDescPointer = (e) => {
    const now = Date.now();
    if (this._descSwallowUntil && now < this._descSwallowUntil) {
      // tail of a double we already handled (mouseup / click / dblclick)
      if (this._descBandHit(e)) { e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation(); }
      return;
    }
    if (e.type !== "pointerdown" && e.type !== "mousedown") return;
    const hit = this._descBandHit(e);
    if (!hit) { this._descLastDown = null; return; }
    const prev = this._descLastDown;
    if (prev && prev.guid === hit.guid && now - prev.t < 450) {
      this._descLastDown = null;
      this._descSwallowUntil = now + 700;
      e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
      const st = ((window.g_universe && window.g_universe.itemsByGuid) || {})[hit.guid];
      this._openDescModal({ lineGuid: hit.guid, pageGuid: st && st.rguid, lineNode: hit.li, anchorNode: null });
      return;
    }
    this._descLastDown = { guid: hit.guid, t: now };
  };

  _onDescCommand() {
    const hit = this._detect();
    if (!hit || !hit.lineGuid) return this._toast("Put the cursor on a line first.");
    // A live-search result row is virtual; _detect already remapped it to the
    // real line, so the description lands on the source line (and shows in both).
    this._openDescModal(hit);
  }

  // Popover editor anchored under the line. We tried an inline field rendered in
  // place of the description; it never stopped shifting by a few pixels on open, so
  // Parham called it: back to the popover, which at least never jumps.
  _openDescModal(hit) {
    this._closeModal();
    const current = this._descTextFor(hit.lineGuid);
    const catcher = this._el("div", "refalias-catch");
    const pop = this._el("div", "refalias-pop");

    const field = this._el("div", "refalias-field");
    const input = this._el("input", "refalias-input");
    input.type = "text";
    input.value = current;
    const clear = this._el("button", "refalias-clear", "×");
    clear.title = "Clear";
    clear.addEventListener("click", () => { input.value = ""; input.focus(); });
    field.append(input, clear);

    const foot = this._el("div", "refalias-foot");
    foot.append(this._el("span", "refalias-hint", "Enter to save · Empty removes the description"));
    const save = this._el("button", "refalias-btn refalias-primary refalias-save", "Save");
    foot.append(save);

    pop.append(field, foot);
    catcher.append(pop);
    document.body.append(catcher);
    this._modal = { backdrop: catcher };

    // The caret is sacred: a changed value leaves the user exactly where they
    // stood, so closing only hands the keyboard back.
    const close = () => { this._closeModal(); this._refocusEditor(); };
    const doSave = () => { close(); this._writeDescription(hit, input.value); };
    save.addEventListener("click", doSave);
    catcher.addEventListener("mousedown", (e) => { if (e.target === catcher) close(); });
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); doSave(); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
    });

    this._positionPopover(pop, [hit.lineNode, hit.anchorNode]);
    setTimeout(() => { try { input.focus(); const n = input.value.length; input.setSelectionRange(n, n); } catch (e) {} }, 0);
  }

  async _writeDescription(hit, raw) {
    const text = String(raw == null ? "" : raw).trim();
    // _pageRecord, not getRecord: an unmaterialized future journal day has a
    // synthetic page guid that getRecord cannot resolve.
    const rec = await this._pageRecord(hit.pageGuid);
    if (!rec) return this._toast("Couldn't find the current page.");
    let items; try { items = await rec.getLineItems(); } catch (e) { items = []; }
    const line = this._findLineDeep(items, hit.lineGuid);
    if (!line) return this._toast("Couldn't find the line you're on.");
    try { await line.setMetaProperty(this._DESC_PROP, text || null); } catch (e) { return this._toast("Couldn't save the description."); }
    this._rebuildDescCSS(); // repaint now; the debounced hooks cover everything else
    // which lines we claim in the shared menu just changed (we only claim lines
    // that HAVE a description) — tell View Options to repaint now
    try { refxVoPoke(); } catch (e) {}
    this._toast(text ? "Description set" : "Description removed");
  }

  // ---- the shared View Options menu: this plugin's provider ----------------
  // The "..." chip on a line is shared property (see the generated region at the
  // top of this file). We contribute one row, "Description", and the module
  // renders it next to whatever Supertask and anyone else contribute for the
  // same line. The module never learns what the row does: onSelect is ours.
  //
  // TWO PREDICATES, and the split is the whole point (2026-08-13, his question
  // "do I have to ask Reference Extravaganza to add a Description now?"):
  //
  //   appliesTo     — WE SUMMON A CHIP only on a line that already HAS a
  //                   description. His rule for this feature is "no hover, no
  //                   placeholder: an unset line looks exactly like today"
  //                   (2026-08-12), and a chip on every text line would be both
  //                   noise and a measurable cost on every scroll frame.
  //   appliesToRow  — but wherever a chip is ALREADY there for someone else's
  //                   reason, offering Description costs nothing and is the
  //                   obvious place to reach for it. So the row shows on any
  //                   line that can carry one, set or not.
  //
  // Net effect: a line with a chip can gain a description from the menu; a bare
  // line still uses the command, because it has no chip to hang a menu on.
  _voProvider() {
    let version = "";
    try { version = String(window.__REFX_VERSION || ""); } catch (e) {}
    const live = (st) => !!st && !st.is_trashed && !st.is_deleted && !st.is_virtual;
    return {
      id: REFX_VO_ID,
      version: version,
      order: 20,
      appliesTo: (ctx) => live(ctx.state) && !!this._descTextFor(ctx.guid),
      appliesToRow: (ctx) => {
        const st = ctx.state;
        if (!live(st)) return false;
        // An embed / transclusion row is a REAL line whose props.itemref points
        // at the target: its description belongs to the TARGET, not to it.
        if (st.props && st.props.itemref) return false;
        return ctx.type === "heading" || ctx.type === "task" || ctx.type === "text";
      },
      build: (ctx) => [{
        key: "desc",
        label: "Description",
        icon: "ti-file-description",
        checked: !!this._descTextFor(ctx.guid), // accent when this line has one
        onSelect: (c, api) => {
          api.close();
          const st = c.state || {};
          // c.node is the exact rendered row the chip sat on, so the popover
          // anchors under THAT copy of the line (a transclusion renders the
          // same guid twice). Falls back to centred when the row has gone.
          this._openDescModal({ lineGuid: c.guid, pageGuid: st.rguid, lineNode: c.node || null, anchorNode: null });
        },
      }],
    };
  }

  _ensureDescStyle() {
    let st = document.getElementById(this._DESC_STYLE_ID);
    if (!st) { st = document.createElement("style"); st.id = this._DESC_STYLE_ID; document.head.appendChild(st); }
    return st;
  }

  // Coalesce rebuilds (navigation + a burst of record.updated during typing).
  _scheduleDescCSS() {
    if (this._unloaded) return;
    if (this._descT) { try { clearTimeout(this._descT); } catch (e) {} }
    this._descT = setTimeout(() => { this._descT = 0; this._rebuildDescCSS(); }, 250);
  }

  // Rebuild the whole description stylesheet from the model. Rules are keyed on
  // [data-guid], so they keep working through every re-render, apply to the line
  // wherever it renders (including inside a transclusion), and are harmless when
  // the line isn't on screen. The look is emitted ONCE as a selector list; only
  // the content string is per line.
  _rebuildDescCSS() {
    if (this._unloaded) return;
    const map = (window.g_universe && window.g_universe.itemsByGuid) || {};
    const sels = [], heads = [], indents = [], rules = [], divs = [], divsPlain = [], selsPlain = [], selsTrans = [], bars = [];
    let firstGuid = null;
    for (const g in map) {
      const it = map[g];
      if (!it || it.is_deleted || it.is_trashed) continue;
      const v = it.props && it.props[this._DESC_PROP];
      if (!v) continue;
      if (!firstGuid) firstGuid = g;
      const esc = this._escCssAttr(g);
      // ON .line-div, NOT .lineitem-text: the text is an INLINE span, so a block
      // ::after inside it breaks the inline flow and shoves anything trailing the
      // text sideways/down — that is what displaced Supertask's per-line "…"
      // button. .line-div is a block, so the description lands cleanly underneath
      // and every inline decoration keeps its exact place.
      const sel = '.listitem[data-guid="' + esc + '"] .line-div::after';
      sels.push(sel);
      selsTrans.push('.transclusion-container-div ' + sel);
      if (it.type !== "heading") selsPlain.push(sel);
      (it.type === "heading" ? divs : divsPlain).push('.listitem[data-guid="' + esc + '"] .line-div');
      heads.push('.listitem-heading[data-guid="' + esc + '"] .line-div::after');
      indents.push('.listitem[data-guid="' + esc + '"] .listitem-indentline');
      // Supertask draws its progress bar as absolutely positioned ::before /
      // ::after pseudos ON THE LISTITEM. .line-div is position:relative, so it
      // (and our opaque description background inside it) paints AFTER those
      // pseudos in tree order and was HIDING the bar ("nu har du ritat över
      // Progress baren också"). z-index:1 lifts them back above the background;
      // they are already pointer-events:none, and on lines without a bar the
      // pseudos have no content, so this is a no-op there.
      bars.push('.listitem[data-guid="' + esc + '"]::before,.listitem[data-guid="' + esc + '"]::after');
      rules.push(sel + '{content:"' + this._escCssString(String(v)) + '";}');
    }
    let css = "";
    if (sels.length) {
      const m = this._descMetrics(firstGuid);
      css = sels.join(",") + "{display:block;margin-top:" + m.base.margin + "px;" +
        "font-size:var(--text-size-small,12px);line-height:1.4;" +
        "color:var(--text-muted,rgba(127,127,127,.9));white-space:pre-wrap;" +
        // OPAQUE page-coloured background: the text-selection overlay paints
        // BELOW the line content, so selecting a described line tinted the
        // description too, and every timing-based countermeasure lost a race
        // somewhere (per-rect clip = one unclipped frame per resize, filmed
        // twice; a mask on the overlay layer is impossible - the layer is
        // 0px tall, so mask-clip either hides everything or masks nothing).
        // A background on the ::after simply COVERS whatever the overlay
        // paints under it, with no timing involved. Same var the panel
        // paints behind lines, so it is invisible until a selection passes
        // underneath; transclusions layer their translucent container tint
        // on top, mirrored in the extra rule below.
        "background:var(--panel-bg-color,transparent);" +
        "font-weight:400;font-style:normal;pointer-events:none;}\n" +
        (selsTrans.length ? selsTrans.join(",") + "{background:linear-gradient(var(--ed-container-bg-color,transparent),var(--ed-container-bg-color,transparent)),var(--panel-bg-color,transparent);}\n" : "") +
        (bars.length ? bars.join(",") + "{z-index:1;}\n" : "") +
        // The indent line is absolutely positioned inside .line-div at a FIXED top
        // Thymer computed WITHOUT the description, so it starts too high and crosses
        // it (and anything drawn under the line, e.g. Supertask's progress bar).
        // CLIP the top rather than pushing with margin-top: margin moved the whole
        // box, so its BOTTOM overshot into the row below. clip-path hides exactly
        // the overlapping strip and leaves the box (and its bottom) where Thymer put
        // it. The line is painted as a dotted border-left, which clip-path clips.
        indents.join(",") + "{clip-path:inset(" + m.base.clip + "px 0 0 0);}\n" +
        // Breathing room UNDER the description, so the whole child block (and the
        // progress bar other plugins draw between them) sits a little lower —
        // Parham: "du behöver skjuta hela childblocket ner pyttelite". Padding on
        // .line-div grows the line, and Thymer's layout moves the rows below it.
        (divs.length ? divs.join(",") + "{padding-bottom:" + this._DESC_BLOCK_PUSH + "px !important;}\n" : "") +
        (divsPlain.length ? divsPlain.join(",") + "{padding-bottom:" + this._DESC_BLOCK_PUSH_PLAIN + "px !important;}\n" : "") +
        // Todo/plain descriptions rest a touch lower (that is where Parham wants
        // them). padding-top moves the TEXT down; the matching negative
        // margin-bottom gives the height straight back, so the progress bar and the
        // children below do not move at all. padding-BOTTOM stretches the opaque
        // background down to the line's real bottom edge (the negative-margin zone
        // otherwise shows a slim selection-coloured line under the description,
        // which Parham spotted), and the widened margin compensates the height.
        (selsPlain.length ? selsPlain.join(",") + "{padding-top:" + this._DESC_PLAIN_NUDGE + "px;padding-bottom:" + this._DESC_PLAIN_NUDGE + "px;margin-bottom:-" + (2 * this._DESC_PLAIN_NUDGE) + "px;}\n" : "") +
        // Same background stretch for HEADINGS, whose line-div carries
        // _DESC_BLOCK_PUSH px of padding below the description box.
        (heads.length ? heads.join(",") + "{padding-bottom:" + this._DESC_BLOCK_PUSH + "px;margin-bottom:-" + this._DESC_BLOCK_PUSH + "px;}\n" : "") +
        rules.join("\n");
      // Per HEADING LEVEL, MEASURED live instead of one fixed nudge: every level has
      // its own line box (h1 47px around 27.4px text, h2 30.4/21.3, h3 28.9/18.1,
      // h4 28.4/16.3), so a single -7px hugged h1 nicely but bit into h2/h3/h4.
      // Deriving the pull-up from each level's own half-leading keeps the SAME
      // optical gap under every heading, and the clip follows what the description
      // actually adds at that level.
      for (const lvl in m.heads) {
        const hm = m.heads[lvl];
        css += "\n" + heads.map((s) => s.replace(".line-div::after", ".line-div.heading-h" + lvl + "::after")).join(",") +
          "{margin-top:" + hm.margin + "px;}\n" +
          indents.map((s) => s.replace(".listitem-indentline", ".line-div.heading-h" + lvl + " .listitem-indentline")).join(",") +
          "{clip-path:inset(" + hm.clip + "px 0 0 0);}";
      }
    }
    // With no described lines the refine pass never runs again (the else branch
    // below tears the observer down), so drop the measured clip/chevron rules
    // here — otherwise removing the LAST description left them applied forever.
    if (css !== this._descCSS || (!sels.length && this._descClipCSS)) {
      if (!sels.length) this._descClipCSS = "";
      this._descCSS = css;
      this._ensureDescStyle().textContent = css + this._descClipCSS;
    }
    // The analytic clip above only knows about OUR description. Anything else drawn
    // between the line and its children (Supertask's progress bar) still gets
    // crossed. Measuring against the first child instead is exact whatever sits in
    // between, so refine on the next frame. clip-path does not affect layout, so
    // this measure-then-clip pass cannot oscillate.
    // Measure on the next frame AND once more shortly after: other plugins inject
    // their own per-line decorations (Supertask's progress bar) after us, and an
    // rAF-only pass caught a pre-decoration layout (it produced an 8px clip where
    // ~36px was needed).
    // One-time repair: a 2026-09-19 build wrote inline mask-image on the
    // selection overlay layers, which HID every selection on pages with a
    // described line (the layer is 0px tall, so the mask swallowed all of it).
    // Its observer also survives hot reloads as a zombie that keeps rewriting
    // the mask, so disconnect the stash too. Safe to remove after a few releases.
    try { if (window.__refxSelObs) { window.__refxSelObs.disconnect(); window.__refxSelObs = null; } } catch (e) {}
    try { for (const l of document.querySelectorAll(".listview-selections")) { if (l.style.maskImage || l.style.webkitMaskImage) { l.style.maskImage = ""; l.style.webkitMaskImage = ""; l.style.maskSize = ""; l.style.maskRepeat = ""; l.style.maskClip = ""; } } } catch (e) {}
    if (sels.length) {
      this._ensureDescObserver();
      if (!this._descClipRaf) {
        this._descClipRaf = requestAnimationFrame(() => { this._descClipRaf = 0; this._refineDescClips(); });
      }
      // The timeout is scheduled UNCONDITIONALLY, never gated on the rAF flag:
      // rAF is SUSPENDED while the window is occluded, so a pending frame can sit
      // forever with _descClipRaf still set — and when the timeout lived inside
      // that gate, every later rebuild skipped BOTH paths and the refine pass
      // simply never ran again (seen live: the indent line stayed on the analytic
      // clip, half cut off, with a child right there under it).
      if (this._descClipT) { try { clearTimeout(this._descClipT); } catch (e) {} }
      this._descClipT = setTimeout(() => { this._descClipT = 0; this._refineDescClips(); }, 350);
    } else this._teardownDescObserver();
  }

  // Clip each described line's indent line so it STARTS exactly at the top of its
  // first child ("i linje med översta childen") and keeps Thymer's own bottom, so
  // it spans the children and stops before the next sibling.
  _refineDescClips() {
    if (this._unloaded) return;
    const map = (window.g_universe && window.g_universe.itemsByGuid) || {};
    const parts = [];
    // FIXED, not measured. Calibrating against "a native line" looked principled
    // but there is no single native value to match: undescribed lines measured
    // -5.9, -3.9, +3.1 and +18 depending on type and context, so whichever one the
    // pass happened to pick changed the geometry between repaints — that is the
    // spacing Parham kept seeing shift on its own, including headings he had
    // already approved and I had not touched. These two numbers are the values that
    // were live when he approved the look. Do NOT replace this with a measurement.
    const nat = this._DESC_NATIVE_FIXED;
    const gapByLvl = {};
    // Equalise the heading -> description gap ACROSS LEVELS by measuring what
    // actually rendered and correcting the error. Deriving it from font metrics left
    // h1 at 8.0px but h2/h3/h4 at 5.8-6.5px, because glyphs do not fill their em box
    // the same way at every size. One sample per level is enough; the correction is
    // exact, so it converges in a single pass and then stops emitting changes
    // (identical CSS = no DOM write = no further mutation = no loop).
    // FREEZE the per-level correction while an inline editor is open. Opening one
    // re-runs this pass, and if a level's correction landed on a new value right
    // then, the description shifted a pixel or two out from under the field — which
    // is exactly the "heading 4 hoppar lite" he saw. Reuse the last settled values.
    const lvlFix = {};
    for (const g in map) {
      const it = map[g];
      if (!it || !(it.props && it.props[this._DESC_PROP])) continue;
      try {
        const n = document.querySelector('.listitem[data-guid="' + this._escCssAttr(g) + '"]');
        const ld = n && n.querySelector(".line-div");
        const tx = n && n.querySelector(".lineitem-text");
        if (!ld || !tx) continue;
        const lvl = (String(ld.className).match(/heading-h(\d)/) || [])[1];
        if (!lvl || lvlFix[lvl] !== undefined) continue;
        const after = getComputedStyle(ld, "::after");
        // CONTENT height. Thymer's global box-sizing is border-box, so computed
        // height INCLUDES the ::after's own padding — and since v3.4.0 the
        // bottom cover puts real padding there. Reading it raw inflated descH
        // by ~9px, the equalizer "corrected" the gap it thought was too small,
        // and every described heading sat ~9px too low (his report the same
        // night). Strip the padding so the formulas mean the visible text box.
        let descH = parseFloat(after.height);
        if (after.boxSizing === "border-box") descH -= (parseFloat(after.paddingTop) || 0) + (parseFloat(after.paddingBottom) || 0);
        const cur = parseFloat(after.marginTop);
        if (!isFinite(descH) || !isFinite(cur)) continue;
        // Read the padding that actually landed, never the constant: Thymer's own
        // heading rules can beat ours, and assuming 5px where 3.04px applied threw
        // the correction off by ~2px (the 8px gap came out at 10px).
        const padB = parseFloat(getComputedStyle(ld).paddingBottom) || 0;
        const gap = (ld.getBoundingClientRect().bottom - padB - descH) - tx.getBoundingClientRect().bottom;
        if (!isFinite(gap)) continue;
        lvlFix[lvl] = Math.round((cur - (gap - this._DESC_HEAD_GAP)) * 100) / 100;
      } catch (e) {}
    }
    for (const lvl in lvlFix) {
      const hs = [];
      for (const g in map) {
        const it = map[g];
        if (it && it.props && it.props[this._DESC_PROP]) hs.push('.listitem-heading[data-guid="' + this._escCssAttr(g) + '"] .line-div.heading-h' + lvl + "::after");
      }
      if (hs.length) parts.push(hs.join(",") + "{margin-top:" + lvlFix[lvl] + "px !important;}");
    }
    for (const g in map) {
      const it = map[g];
      if (!it || it.is_deleted || it.is_trashed) continue;
      if (!(it.props && it.props[this._DESC_PROP])) continue;
      try {
        const esc = this._escCssAttr(g);
        const node = document.querySelector('.listitem[data-guid="' + esc + '"]');
        if (!node) continue;
        // FOLD CHEVRON. Thymer positions it per line via an inline
        // --line-fold-chevron-top-px it measures from the line's FULL rendered
        // height — description included — so on a described line it centres on
        // the whole taller box and lands well below the main row (8.8px low on
        // the line Parham screenshotted). Re-centre it on the text's FIRST line
        // fragment (getClientRects()[0], not the union rect: a wrapped line's
        // union spans every row). Stylesheet !important beats the inline var,
        // and correcting from the rendered rect converges in one pass.
        const chev = node.querySelector(":scope > .line-fold-chevron");
        const chTx = node.querySelector(".lineitem-text");
        if (chev && chTx) {
          const fr = chTx.getClientRects()[0] || chTx.getBoundingClientRect();
          const cr = chev.getBoundingClientRect();
          let chevCssTop = parseFloat(getComputedStyle(chev).top);
          if (cr.height && fr.height && isFinite(chevCssTop)) {
            const wantChevTop = (fr.top + fr.height / 2) - cr.height / 2;
            const chevPx = Math.round((chevCssTop + (wantChevTop - cr.top)) * 100) / 100;
            parts.push('.listitem[data-guid="' + esc + '"] > .line-fold-chevron{top:' + chevPx + "px !important;}");
          }
        }
        // GUTTER COVER. Thymer paints a second, narrow selection rect for the
        // control column (checkbox/bullet) left of .line-div, at full line
        // height, so a teal strip showed beside the description. Stretch the
        // opaque background over exactly that measured gutter: the strip spans
        // only THIS line's own column, and ancestor indent lines run left of
        // this listitem's box, so nothing that must stay visible is covered.
        {
          const ldEl = node.querySelector(".line-div");
          if (ldEl) {
            // The cover may not cross an ANCESTOR's indent line: those are
            // drawn with negative left offsets and reach INTO this line's
            // gutter (measured: a parent's line at x 291.3 inside a child box
            // starting at 289.3), and an opaque cover would cut a hole in them
            // at the description rows. Start the cover just right of the
            // rightmost ancestor line instead of at the listitem edge.
            let coverLeft = node.getBoundingClientRect().left;
            try {
              let pg = (it.parent && it.parent.guid) || it.parent_guid;
              let hops = 0;
              while (pg && map[pg] && hops++ < 20) {
                const pn = document.querySelector('.listitem[data-guid="' + this._escCssAttr(pg) + '"]');
                const pil = pn && pn.querySelector(".listitem-indentline");
                if (pil) { const pr = pil.getBoundingClientRect(); if (pr.width && pr.right + 1 > coverLeft) coverLeft = pr.right + 1; }
                const pit = map[pg];
                pg = (pit.parent && pit.parent.guid) || pit.parent_guid;
              }
            } catch (e) {}
            const gut = Math.round((ldEl.getBoundingClientRect().left - coverLeft) * 100) / 100;
            if (gut > 0.5) parts.push('.listitem[data-guid="' + esc + '"] .line-div::after{margin-left:-' + gut + "px;padding-left:" + gut + "px;}");
            // BOTTOM COVER, measured. The static padding stretch assumes the
            // description ends the line box, but another plugin can grow the
            // LISTITEM below the line-div itself: Supertask's progress bar adds
            // ~15px there, and the selection showed straight through that strip
            // ("Om det blir en progress bar under sa lacker den igenom").
            // Stretch the background down to the LISTITEM's bottom edge, plus
            // the usual 2px. Where the box actually ends CANNOT be derived from
            // the box model: line-div carries an EXPLICIT height, so the flow
            // equations lied by ~7px and a thin selection line still peeked out
            // under the bar (his fourth screenshot). Measure the rendered flow
            // bottom instead — line-div top + scrollHeight IS the ::after's
            // border bottom, the lowest in-flow box — and correct the padding
            // by the difference, feedback-style like the chevron and indent
            // line. scrollHeight rounds to whole px, so only re-emit when the
            // error is beyond that noise; margin-bottom keeps handing the
            // height back so nothing below moves.
            try {
              const aCS = getComputedStyle(ldEl, "::after");
              const pt = parseFloat(aCS.paddingTop) || 0;
              const pbCur = parseFloat(aCS.paddingBottom) || 0;
              // scrollHeight also spans absolutely positioned children, and OUR
              // repositioned indent line runs far below the line (it poisoned
              // the first read: 118 vs a 62px listitem, so the correction went
              // negative and never fired). Collapse it for the read — same
              // task, nothing paints in between — with !important, because our
              // own stylesheet rule for it carries !important and would win
              // over a plain inline write. Then scrollHeight is the in-flow
              // extent: the ::after's border bottom plus line-div's padding.
              const il2 = node.querySelector(".listitem-indentline");
              let flowBottom;
              try {
                if (il2) { il2.style.setProperty("height", "0px", "important"); il2.style.setProperty("top", "0px", "important"); }
                const ldPadB2 = parseFloat(getComputedStyle(ldEl).paddingBottom) || 0;
                flowBottom = ldEl.getBoundingClientRect().top + ldEl.scrollHeight - ldPadB2;
              } finally {
                if (il2) { il2.style.removeProperty("height"); il2.style.removeProperty("top"); }
              }
              const delta = (node.getBoundingClientRect().bottom + 2) - flowBottom;
              let pbNew = pbCur;
              if (Math.abs(delta) > 1.5) pbNew = Math.max(0, Math.round((pbCur + delta) * 100) / 100);
              const mbNew = Math.round((-(pt + pbNew)) * 100) / 100;
              if (pbNew > 0.5) parts.push('.listitem[data-guid="' + esc + '"] .line-div::after{padding-bottom:' + pbNew + "px;margin-bottom:" + mbNew + "px;}");
            } catch (e) {}
          }
        }
        const il = node.querySelector(".listitem-indentline");
        if (!il) continue;
        // Span of ALL rendered descendants. Lines render FLAT, so a child is a
        // SIBLING node — never look for it inside the parent's node; walk the model.
        let top = Infinity, bottom = -Infinity;
        const walk = (parentGuid) => {
          for (const k in map) {
            const kid = map[k];
            if (!kid || kid.is_deleted || kid.is_trashed) continue;
            const pg = (kid.parent && kid.parent.guid) || kid.parent_guid;
            if (pg !== parentGuid) continue;
            const kn = document.querySelector('.listitem[data-guid="' + this._escCssAttr(k) + '"]');
            if (kn) {
              const r = kn.getBoundingClientRect();
              if (r.height) { if (r.top < top) top = r.top; if (r.bottom > bottom) bottom = r.bottom; }
            }
            walk(k);
          }
        };
        walk(g);
        if (!isFinite(top) || !isFinite(bottom)) continue;
        // SET BOTH ENDS from the measurement instead of clipping. clip-path can only
        // REMOVE, and on a heading the box already starts BELOW the first child, so
        // clipping could never reach UP to it (it computed 0 and the line stayed
        // short — "inte i linje med översta childen"). Positioning it outright gives
        // exactly the picture he drew: start a little before the first child, end a
        // little after the last. The element is absolutely positioned inside
        // .line-div, so writing top/height cannot feed back into layout. !important
        // because the per-heading-level rule carries more specificity (5 vs 3).
        const ld = node.querySelector(".line-div");
        if (!ld) continue;
        const r2 = (n) => Math.round(n * 100) / 100;
        // Headings only — todo/plain lines keep Thymer's own line start.
        // Trim the top on headings AND plain text lines, so a described line's
        // indent line reads the same length as an undescribed one. NOT on todos —
        // he explicitly excluded those, their bar/checkbox already sets the rhythm.
        const trim = (it.type === "task") ? 0 : this._DESC_LINE_TRIM;
        // Where we WANT the two ends, in viewport coords.
        const wantTop = top - nat.above + trim;
        const wantBottom = bottom + nat.below;
        // CORRECT FROM WHERE IT ACTUALLY IS, rather than computing an offset from
        // .line-div's top. That offset was measured before our own padding had
        // landed, so the line ended up ~2.8px low on plain text lines (native −1.9,
        // ours −4.7 — "bara pyttelite men ändå"). Feeding back from the rendered
        // rect is immune to that ordering: top/height are absolute, so writing them
        // never moves anything else, and the next pass lands exactly on target.
        const cur = il.getBoundingClientRect();
        let curTop = parseFloat(getComputedStyle(il).top);
        if (!isFinite(curTop)) curTop = 0;
        const topPx = r2(curTop + (wantTop - cur.top));
        const hPx = r2(wantBottom - wantTop);
        if (!(hPx > 0)) continue;
        parts.push('.listitem[data-guid="' + esc + '"] .listitem-indentline{top:' + topPx + 'px !important;height:' + hPx + 'px !important;bottom:auto !important;clip-path:none !important;}');
        // Thymer's OWN spacing between the end of the line box and the first child.
        // It differs per heading level (h2 gives 12px where h1/h3/h4 give 15), which
        // is what made h2 read tighter. Independent of our padding: padding moves the
        // line box bottom and the child down by the same amount, so this stays put
        // and equalising with it cannot feed back.
        const lvl2 = (String(ld.className).match(/heading-h(\d)/) || [])[1];
        if (lvl2) {
          const tg = Math.round((top - ld.getBoundingClientRect().bottom) * 100) / 100;
          // Only trust a PLAUSIBLE sample. A line measured mid-edit (or before its
          // description had rendered) reported a near-zero gap, and the equaliser
          // "compensated" with ~15px of padding — that is what shoved h4's children
          // far down the page. Thymer's real spacing here is ~12-16px.
          if (tg >= 6 && tg <= 30 && gapByLvl[lvl2] === undefined) gapByLvl[lvl2] = tg;
        }
      } catch (e) {}
    }
    // Equalise the description -> first-child gap across levels by topping up the
    // padding on the levels Thymer spaces more tightly (h2).
    const gaps = Object.keys(gapByLvl).map((k) => gapByLvl[k]).filter((v) => isFinite(v));
    if (gaps.length > 1) {
      const maxGap = Math.max.apply(null, gaps);
      for (const lvl in gapByLvl) {
        // Hard ceiling as a second guard: this correction exists to even out a ~3px
        // difference between heading levels, never to move a block.
        const extra = Math.min(this._DESC_EQUALISE_MAX, Math.round((maxGap - gapByLvl[lvl]) * 100) / 100);
        if (!(extra > 0.1)) continue;
        const sel = [];
        for (const g2 in map) {
          const it2 = map[g2];
          if (!(it2 && it2.props && it2.props[this._DESC_PROP])) continue;
          sel.push('.listitem[data-guid="' + this._escCssAttr(g2) + '"] .line-div.heading-h' + lvl);
        }
        if (sel.length) parts.push(sel.join(",") + "{padding-bottom:" + (this._DESC_BLOCK_PUSH + extra) + "px !important;}");
      }
    }
    const clipCSS = parts.length ? "\n" + parts.join("\n") : "";
    if (clipCSS === this._descClipCSS) return;
    this._descClipCSS = clipCSS;
    this._ensureDescStyle().textContent = this._descCSS + clipCSS;
  }

  // The measured top/height is a FIXED px pair, so it goes STALE the moment the
  // outline under a described line changes — add a child and the line stops short
  // of it (seen live: h2 ended before its second child). Re-measure on DOM changes.
  // Sanctioned by THYMER-LESSONS §7: an observer that only regenerates a
  // plugin-owned stylesheet, debounced, costs nothing — we never touch a line.
  _ensureDescObserver() {
    if (this._descObs || this._unloaded) return;
    const obs = new MutationObserver((muts) => {
      // No gate on _descClipCSS: it starts empty (a described line with no
      // rendered children emits nothing), and gating on it made the observer
      // permanently deaf — when the first child later arrived, the very mutation
      // that should have triggered the measurement was the one being ignored.
      if (this._unloaded) return;
      // Only structural changes matter; typing mutates text nodes inside a line.
      let structural = false;
      for (const m of muts) { if (m.type === "childList" && (m.addedNodes.length || m.removedNodes.length)) { structural = true; break; } }
      if (!structural) return;
      if (this._descObsT) return; // already queued
      this._descObsT = setTimeout(() => { this._descObsT = 0; this._refineDescClips(); }, 150);
    });
    try { obs.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    this._descObs = obs;
    window.__refxDescObs = obs; // hot-reload stash (onLoad re-runs without disposing)
  }

  _teardownDescObserver() {
    if (this._descObsT) { try { clearTimeout(this._descObsT); } catch (e) {} this._descObsT = 0; }
    if (this._descObs) { try { this._descObs.disconnect(); } catch (e) {} this._descObs = null; }
    if (window.__refxDescObs) { try { window.__refxDescObs.disconnect(); } catch (e) {} window.__refxDescObs = null; }
    // Strip anything the retired selection-overlay experiments left behind
    // (inline masks on the layers, clip-path on individual rects).
    try {
      for (const layer of document.querySelectorAll(".listview-selections")) { if (layer.style.maskImage || layer.style.webkitMaskImage) { layer.style.maskImage = ""; layer.style.webkitMaskImage = ""; layer.style.maskSize = ""; layer.style.maskRepeat = ""; layer.style.maskClip = ""; } }
      for (const el of document.querySelectorAll(".listview-selections .text-selection, .listview-selections .text-selection-self")) { if (el.style.clipPath) el.style.clipPath = ""; }
    } catch (e) {}
  }

  // Measure what the description costs, from the LIVE styles rather than hardcoded
  // numbers, so it follows his theme and type scale instead of drifting when either
  // changes. Returns the pull-up margin and the indent-line clip for plain lines and
  // for each heading level found on screen.
  //   halfLeading = the empty space a line box leaves under its glyphs, (line-height
  //   of .line-div − font-size of .lineitem-text) / 2. Sitting the description
  //   _DESC_GAP below the glyphs means margin-top = _DESC_GAP − halfLeading.
  //   clip = how much taller .line-div actually got = description line + that margin.
  // KNOWN LIMIT: sized for a ONE-LINE description; a wrapped one under-clips.
  _descMetrics(sampleGuid) {
    const px = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
    // --text-size-small is declared in REM in his theme, so a bare parseFloat read
    // it as 0.875 and every derived number collapsed (the clip came out 0.22px and
    // headings ended up not clipped at all). Resolve the unit properly.
    let fs = 12;
    try {
      const rootCS = getComputedStyle(document.documentElement);
      const rootFS = px(rootCS.fontSize, 16);
      const raw = String(rootCS.getPropertyValue("--text-size-small") || "").trim();
      const n = parseFloat(raw);
      if (isFinite(n)) fs = /rem|em$/.test(raw) ? n * rootFS : n;
    } catch (e) {}
    // Prefer the size the browser actually resolved on a REAL rendered description
    // (must be a described line — any other .line-div has no ::after of ours and
    // would report the inherited size).
    try {
      if (sampleGuid) {
        const el = document.querySelector('.listitem[data-guid="' + this._escCssAttr(sampleGuid) + '"] .line-div');
        const got = el ? px(getComputedStyle(el, "::after").fontSize, NaN) : NaN;
        if (isFinite(got) && got > 4) fs = got;
      }
    } catch (e) {}
    const lh = fs * 1.4;
    const round = (n) => Math.round(n * 100) / 100;
    const out = { base: { margin: -1, clip: Math.max(0, round(lh - 1)) }, heads: {} };
    for (let n = 1; n <= 6; n++) {
      try {
        const ld = document.querySelector(".line-div.heading-h" + n);
        if (!ld) continue;
        const t = ld.querySelector(".lineitem-text");
        if (!t) continue;
        const boxLH = px(getComputedStyle(ld).lineHeight, NaN);
        const textFS = px(getComputedStyle(t).fontSize, NaN);
        if (!isFinite(boxLH) || !isFinite(textFS)) continue;
        const margin = round(this._DESC_GAP - (boxLH - textFS) / 2);
        out.heads[n] = { margin, clip: Math.max(0, round(lh + margin)) };
      } catch (e) {}
    }
    return out;
  }

  _escCssAttr(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  // CSS string escaping for content: backslash and quote escape, newlines become
  // the CSS newline escape (rendered thanks to white-space:pre-wrap).
  _escCssString(s) {
    return String(s)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r\n|\r|\n/g, "\\A ");
  }

  // ---------------------------------------------------------------- detection

  // Read the editor selection from the focus-independent global registry.
  // Works even while a dialog/palette holds focus, because the selection lives
  // on the listview, not on the focused component.
  _detect() {
    const lvs = (window.g_universe && window.g_universe.listviews) || [];
    // Pick the listview DELIBERATELY (THYMER-LESSONS §3). hasFocus() is false for
    // EVERY listview while a dialog or the command palette holds focus, and the
    // FIRST listview carrying a caret is the WRONG panel in a split view — it
    // still holds a stale caret from the last time you typed there. That is how a
    // command run from the palette edited a line in the OTHER panel instead of the
    // one under the caret (verified live: with the palette open every hasFocus()
    // was false, yet the right panel still carried .has-focus/.is-target).
    // Rank: focused > inside the active panel > merely has a caret.
    let best = null, bestRank = -1;
    for (const lv of lvs) {
      try {
        const pos = lv.selection && lv.selection._caret && lv.selection._caret.pos;
        if (!pos || !pos.list_item || !pos.list_item.state) continue;
        let rank = 0, pnl = null;
        try {
          pnl = lv.$container && lv.$container.closest && lv.$container.closest(".panel");
          if (pnl && (pnl.classList.contains("has-focus") || pnl.classList.contains("is-target") || pnl.classList.contains("focused-panel"))) rank = 1;
        } catch (e) {}
        if (lv.hasFocus && lv.hasFocus()) rank = 2;
        if (rank > bestRank) { best = { pos, panel: pnl || null }; bestRank = rank; }
        if (rank === 2) break;
      } catch (e) {}
    }
    if (!best) return null;
    const st = best.pos.list_item.state;
    const span = best.pos.linespan;
    // LIVE-SEARCH results are VIRTUAL lines (state.is_virtual, ephemeral V-guid,
    // rguid null, EMPTY text_segments) whose props.itemref points at the REAL
    // line. Remap to the real line so every consumer (ref resolution, alias,
    // convert, expand) reads/writes the true source; keep the query context
    // (the query block's line + host page) so expand knows where to place the
    // embed — query results can't render children (verified live).
    let lineGuid = st.guid, pageGuid = st.rguid, queryLineGuid = null, queryHostGuid = null;
    if (st.is_virtual && st.props && st.props.itemref) {
      const realSt = ((window.g_universe && window.g_universe.itemsByGuid) || {})[st.props.itemref];
      if (realSt) {
        lineGuid = st.props.itemref;
        pageGuid = realSt.rguid || pageGuid;
        try {
          const node = best.pos.list_item.$node;
          const qc = node && node.closest && node.closest(".query-container-div");
          const qli = qc && qc.closest(".listitem:not(.listitem-transclusion)");
          const qg = qli && qli.getAttribute && qli.getAttribute("data-guid");
          const qst = qg && window.g_universe.itemsByGuid[qg];
          if (qst && qst.type === "query") { queryLineGuid = qg; queryHostGuid = qst.rguid || null; }
        } catch (e) {}
      }
    }
    return {
      lineGuid,
      pageGuid,
      queryLineGuid,
      queryHostGuid,
      panel: best.panel, // the .panel the caret was found in (see _handleExpandKey)
      segIndex: span && typeof span.segment_index === "number" ? span.segment_index : null,
      linespanType: span ? span.type : null,
      anchorNode: span ? span.$node : null,
      // The line's DOM container (carries the ref chips); used to anchor the
      // alias popover even when the caret isn't on a ref span (linespan null).
      lineNode: best.pos.list_item.$node || null,
      // Native fold state of the caret's line (children hidden). Cmd+Down on a
      // folded line unfolds it first (see _handleExpandKey) instead of jumping
      // straight to expanding a transclusion, so collapsed outlines behave.
      isFolded: !!(best.pos.list_item && best.pos.list_item.is_folded),
    };
  }

  // Resolve a page guid to its record, including UNMATERIALIZED journal days.
  // A journal day that does not exist yet (tomorrow and later) has a SYNTHETIC
  // page guid — S-<collectionGuid>-P…-YYYYMMDD — that data.getRecord() cannot
  // resolve, so every command run on such a page (alias, convert, expand,
  // collapse, the [[ picker) died with "Couldn't find the current page."
  // getJournalRecord() is the way in. The user ref MUST carry the USER guid —
  // passing the collection guid silently creates a duplicate journal page.
  // Same fix as reschedule's journalRecord().
  async _pageRecord(pageGuid) {
    const rec = this.data.getRecord(pageGuid);
    if (rec) return rec;
    const m = /^S-([A-Z0-9]+)-.+-(\d{8})$/.exec(pageGuid || "");
    if (!m) return null;
    try {
      const cols = await this.data.getAllCollections();
      const journals = (cols || []).filter((c) => { try { return c.isJournalPlugin && c.isJournalPlugin(); } catch (e) { return false; } });
      const col = journals.find((c) => { try { return (c.getGuid ? c.getGuid() : null) === m[1]; } catch (e) { return false; } }) || journals[0];
      if (!col) return null;
      let userGuid = null;
      try { userGuid = (window.g_universe && window.g_universe.userId) || null; } catch (e) {}
      if (!userGuid) {
        try {
          const us = await this.data.getActiveUsers();
          const self = (us || []).find((u) => u && (u.is_self || (u._getRow && u._getRow().is_self))) || (us || [])[0];
          userGuid = self && (self.guid || (self._getRow && self._getRow().guid));
        } catch (e) {}
      }
      // ref.guid is interpolated into the record id, so a non-string mints a page
      // called S-<coll>-[object Object]-0-<date> that breaks Markdown Mirror sync
      if (typeof userGuid !== 'string' || !userGuid) return null;
      const wsGuid = (window.g_universe && window.g_universe.workspaceGuid) || null;
      const y = +m[2].slice(0, 4), mo = +m[2].slice(4, 6) - 1, d = +m[2].slice(6, 8);
      // getJournalRecord only ever calls .toDate() on its date argument
      return await col.getJournalRecord({ workspaceGuid: wsGuid, guid: userGuid }, { toDate: () => new Date(y, mo, d) });
    } catch (e) { return null; }
  }

  // Resolve the targeted reference segment via the stable Data API.
  // Returns a result object, or an error string for the toaster.
  async _resolveRef(hit) {
    const rec = await this._pageRecord(hit.pageGuid);
    if (!rec) return "Couldn't find the current page.";
    const items = await rec.getLineItems();
    const li = this._findLineDeep(items, hit.lineGuid);
    if (!li) return "Couldn't find the line you're on.";
    const segs = (li.segments || []).map((s) => ({ type: s.type, text: s.text }));
    const segRefs = segs.map((s, i) => (s.type === "ref" ? i : -1)).filter((i) => i >= 0);
    if (!segRefs.length) return "Select a reference first.";

    // Which ref on the line did the user target? linespan.segment_index indexes
    // the PAIR-ENCODED internal model (every other slot: type, data, type, …),
    // so the ordinal in the unpacked list is segment_index / 2. We resolve the
    // ordinal against the live model, then map to li.segments by ref ORDER — the
    // two representations may split text differently, but their refs are in the
    // same left-to-right order. (Indexing li.segments with the raw pair index is
    // the bug that made a line with several refs always resolve to the last one.)
    let refIdx = -1;
    const live = this._liveSegs(hit.lineGuid);
    if (live && live.length) {
      const liveRefs = live.map((s, i) => (s.type === "ref" ? i : -1)).filter((i) => i >= 0);
      const ai = typeof hit.segIndex === "number" ? Math.floor(hit.segIndex / 2) : null;
      let liveIdx = -1;
      if (hit.linespanType === "ref" && ai != null && live[ai] && live[ai].type === "ref") liveIdx = ai;
      else if (liveRefs.length === 1) liveIdx = liveRefs[0];
      else if (ai != null && liveRefs.length) liveIdx = liveRefs.reduce((a, b) => (Math.abs(b - ai) < Math.abs(a - ai) ? b : a), liveRefs[0]);
      const k = liveRefs.indexOf(liveIdx);
      if (k >= 0 && k < segRefs.length) refIdx = segRefs[k];
    }
    if (refIdx < 0) {
      // No live model to align against — single ref, else nearest by pair-index/2.
      if (segRefs.length === 1) refIdx = segRefs[0];
      else {
        const ai = typeof hit.segIndex === "number" ? Math.floor(hit.segIndex / 2) : null;
        refIdx = ai == null ? segRefs[segRefs.length - 1] : segRefs.reduce((a, b) => (Math.abs(b - ai) < Math.abs(a - ai) ? b : a), segRefs[0]);
      }
    }

    const seg = segs[refIdx];
    const targetGuid = seg.text && seg.text.guid;
    if (!targetGuid) return "Select a reference first.";
    const current = (seg.text && seg.text.title) || "";
    // A page reference targets a record; a text reference (from [[) targets a
    // line item, which has no record. Page refs fall back to the page's name
    // when blank; text refs have no such fallback, so their blank-fallback is
    // the target line's own current text.
    const targetRec = this.data.getRecord(targetGuid);
    const isText = !targetRec;
    const fallback = isText
      ? (this._lineTextByGuid(targetGuid) || current)
      : ((targetRec.getName && targetRec.getName()) || "");
    return {
      li,
      segs,
      refIdx,
      targetGuid,
      anchorNode: hit.anchorNode,
      lineNode: hit.lineNode,
      current,
      fallback,
      isText,
    };
  }

  // Live, unpacked {type, text} segments of a line by guid, read from the global
  // registry (every loaded line, rendered or not) and falling back to an open
  // listview copy. Aligned so that linespan.segment_index / 2 indexes it.
  _liveSegs(guid) {
    const st = ((window.g_universe && window.g_universe.itemsByGuid) || {})[guid] || this._liveStateByGuid(guid);
    return st && st.text_segments ? this._segmentsFromState(st) : null;
  }

  // Current display text of a line item by guid. Used as the blank-fallback for
  // text-reference aliases (a line ref has no page name to fall back to).
  _lineTextByGuid(guid) {
    const segs = this._liveSegs(guid);
    return segs ? this._displayText(segs).trim() : "";
  }

  _writeAlias(r, value) {
    const v = (value || "").trim();
    const newSeg = { type: "ref", text: { guid: r.targetGuid } };
    let toast;
    if (v) {
      newSeg.text.title = v;
      toast = 'Alias set to "' + v + '"';
    } else if (r.isText) {
      // A text reference can't display anything without a title, so "clear"
      // re-syncs it to the target line's current text instead of blanking it.
      const t = (r.fallback || "").trim();
      if (t) newSeg.text.title = t;
      toast = t ? "Alias reset to the line's text" : "Alias cleared";
    } else {
      toast = "Alias removed — showing the page's name";
    }
    const next = r.segs.slice();
    next[r.refIdx] = newSeg;
    r.li.setSegments(next);
    this._toast(toast);
    this._refocusEditor(); // hand the keyboard back to the editor (Space after alias must type, not scroll)
  }

  async _onCommand() {
    const hit = this._detect();
    if (!hit) return this._toast("Select a reference first.");
    const r = await this._resolveRef(hit);
    if (typeof r === "string") return this._toast(r);
    this._openAliasModal(r);
  }

  // ------------------------------------------------ expand/collapse references

  // ------------------------------------------------ convert embedded ↔ reference

  // Toggle between the two ways to point at another line:
  //   • an EMBEDDED line = a `type:"ref"` line item with `props.itemref` (mirrors
  //     the whole target line inline, checkbox/date and all), and
  //   • a REFERENCE = a compact chip: a normal line holding one `ref` segment
  //     (what `[[` inserts).
  // On an embedded line → collapse to a reference; on a standalone reference line
  // → expand to an embedded line. Both directions recreate the line (setSegments
  // is ignored on a `type:"ref"` line), preserving position, then delete the old.
  async _onConvert() {
    const hit = this._detect();
    if (!hit) return this._toast("Select a reference, or put your cursor on an embedded line.");
    const it = ((window.g_universe && window.g_universe.itemsByGuid) || {})[hit.lineGuid];

    // Embedded line → reference.
    const embRef = it && it.type === "ref" && it.props && it.props.itemref;
    if (embRef) return this._replaceLine(hit, "text", (line) => line.setSegments([{ type: "ref", text: { guid: embRef, title: this._lineTextByGuid(embRef) || "" } }]), "Converted to a reference");

    // Standalone reference line → embedded line. Only when the line is JUST one
    // reference (whitespace around it is fine); a mid-sentence chip can't become
    // a whole-line embed.
    const live = this._liveSegs(hit.lineGuid) || [];
    const refs = live.filter((s) => s.type === "ref");
    const otherText = live.filter((s) => s.type !== "ref" && !(typeof s.text === "string" && s.text.trim() === ""));
    const targetGuid = refs.length === 1 && !otherText.length && refs[0].text && refs[0].text.guid;
    if (targetGuid) return this._replaceLine(hit, "ref", (line) => line.setMetaProperty("itemref", targetGuid), "Converted to an embedded line");

    return this._toast("Select a reference, or put your cursor on an embedded line.");
  }

  // Recreate the caret's line as `newType`, run `apply(newLine)` to fill it, then
  // delete the original. Preserves parent + position, including for nested lines.
  async _replaceLine(hit, newType, apply, okMsg) {
    const rec = await this._pageRecord(hit.pageGuid);
    if (!rec) return this._toast("Couldn't find the current page.");
    let items; try { items = await rec.getLineItems(); } catch (e) { items = []; }
    const found = this._findWithParent(items, hit.lineGuid, null);
    if (!found) return this._toast("Couldn't find the line.");
    const old = found.item;
    // Use the parent from the tree, NOT old.getParent() — the latter returns an
    // object with no .guid for a nested line, which we can't pass to
    // createLineItem, so the new line would land at the ROOT (top of the page).
    const parent = found.parent; // a real line item when nested, null at the root
    let line = null;
    try { line = await rec.createLineItem(parent, old, newType); } catch (e) {}
    if (!line) return this._toast("Couldn't convert the line.");
    try { apply(line); } catch (e) {}
    try { if (old.delete) await old.delete(); } catch (e) {}
    this._toast(okMsg);
  }

  // Find a line item by guid anywhere in the record's tree, with its parent line
  // item (null when the line is top-level).
  _findWithParent(items, guid, parent) {
    for (const it of items || []) {
      if (it && it.guid === guid) return { item: it, parent: parent || null };
      if (it && it.children && it.children.length) { const f = this._findWithParent(it.children, guid, it); if (f) return f; }
    }
    return null;
  }

  // Synchronously work out which reference (if any) is selected on the current
  // line, and its target. No async (no getLineItems) so the keydown handler can
  // decide instantly whether to intercept. Mirrors _resolveRef's ref-picking
  // (segment_index is a pair index → /2; pick the targeted ref by order).
  _selectedRef(hit) {
    const live = this._liveSegs(hit.lineGuid);
    if (!live || !live.length) return null;
    const refs = live.map((s, i) => (s.type === "ref" ? i : -1)).filter((i) => i >= 0);
    if (!refs.length) return null;
    const ai = typeof hit.segIndex === "number" ? Math.floor(hit.segIndex / 2) : null;
    let idx = -1;
    if (hit.linespanType === "ref" && ai != null && live[ai] && live[ai].type === "ref") idx = ai;
    else if (refs.length === 1) idx = refs[0];
    else if (ai != null) idx = refs.reduce((a, b) => (Math.abs(b - ai) < Math.abs(a - ai) ? b : a), refs[0]);
    if (idx < 0) return null;
    const targetGuid = live[idx].text && live[idx].text.guid;
    if (!targetGuid) return null;
    return { targetGuid, isText: !this.data.getRecord(targetGuid) };
  }

  // Expand: insert a native transclusion of the reference's target as a child of
  // the block the reference sits in — for line AND page references. Thymer renders
  // it inline (target as a heading with its children, or a page's body), editable
  // and native-styled, exactly like its built-in transclusions. MANY can be open
  // at once; each is a real, synced, undoable line tagged `refx_embed` so we can
  // find/collapse our own without touching Thymer's native transclusions. A
  // transclusion is `type:"transclusion"` with `props.itemref` = the target guid.
  // For a RECORD reference we also attach an editable property card (see below).
  async _expandRef(hit, ref) {
    // From a LIVE-SEARCH result: query blocks never render children of result
    // lines (verified live), so a child transclusion of the source line would be
    // an invisible write. Place the embed on the HOST page instead, as the
    // sibling right after the query block's line — visible, real, synced.
    if (hit.queryLineGuid && hit.queryHostGuid) return this._expandRefFromQuery(hit, ref);
    const key = hit.lineGuid + "›" + ref.targetGuid;
    if (this._expandInFlight.has(key)) return; // debounce double-create on fast keys
    this._expandInFlight.add(key);
    try {
      const rec = await this._pageRecord(hit.pageGuid);
      if (!rec) return this._toast("Couldn't find the current page.");
      let items; try { items = await rec.getLineItems(); } catch (e) { items = []; }
      // DEEP lookup — a plain items.find() only saw top-level lines, so
      // expanding from an INDENTED ref line failed with this toast.
      const block = this._findLineDeep(items, hit.lineGuid);
      if (!block) return this._toast("Couldn't find the line you're on.");
      if (this._findEmbeds(block, ref.targetGuid).length) {
        // Already open. On a multi-ref line the "selected" ref is a nearest-
        // GUESS (distance ties go to the earlier ref), so a plain toggle-no-op
        // made Cmd+Down a dead key when that guess was open — expand the
        // line's next UNOPENED ref instead; only no-op when all are open.
        let alt = null;
        try {
          for (const s of block.segments || []) {
            const g = s && s.type === "ref" && s.text && s.text.guid;
            if (g && g !== ref.targetGuid && !this._findEmbeds(block, g).length) { alt = g; break; }
          }
        } catch (e) {}
        if (!alt) return;
        ref = { targetGuid: alt, isText: !this.data.getRecord(alt) };
      }
      if (await this._wouldCycle(block, hit.pageGuid, ref.targetGuid)) return this._toast("Can't embed a block inside itself.");
      const kids = block.children || [];
      const after = kids.length ? kids[kids.length - 1] : null; // append at the bottom of the block
      let line = null;
      try { line = await rec.createLineItem(block, after, "transclusion", null, { itemref: ref.targetGuid, refx_embed: 1 }); } catch (e) {}
      if (!line) return this._toast("Couldn't expand the reference.");
      // Defensive: ensure itemref applied even if the create-props path didn't.
      try { if (!(line.props && line.props.itemref)) line.setMetaProperty("itemref", ref.targetGuid); } catch (e) {}
      // Record (page) reference → show its properties as an editable card.
      if (!ref.isText) {
        if (this._peOn()) this._peHideOn(line.guid); // before its first paint: never Thymer's own body
        this._cards.set(line.guid, { recordGuid: ref.targetGuid, line });
        this._ensureCardObserver();
        this._attachPropCard(line.guid, ref.targetGuid);
      } else {
        // LINE reference → no card, but give it the writing strip so a childless
        // target can still gain an indented child by clicking the embed's dead
        // space (same affordance the live-search line embeds already have).
        this._lineEmbeds.set(line.guid, { node: null });
        this._ensureCardObserver();
        this._markLineEmbed(line.guid, 0);
      }
      // If the host line sits FOLDED (native fold state persists per line), the
      // fresh embed renders hidden behind "…" dots — unfold so it shows.
      this._unfoldHostLine(hit.lineGuid);
      setTimeout(() => this._unfoldHostLine(hit.lineGuid), 450);
    } finally {
      this._expandInFlight.delete(key);
    }
  }

  // Expand from a live-search result. Precedence: a result line WITH children
  // expands as a LINE transclusion (the line + its children); otherwise the
  // selected reference's target expands. Queries can't render children of
  // result lines (verified live), so the embed LINE is created on the host page
  // right after the query block — and its rendered NODE is then PARKED directly
  // under the result row inside the query (flat-render makes this a plain
  // sibling move; the observer keeps it parked across re-renders). Tags:
  // refx_from = the query line, refx_at = the result's real line (collapse key).
  async _expandRefFromQuery(hit, ref) {
    // ALWAYS expand the RESULT LINE itself (line transclusion) — children or
    // not, ref or not (Parham's spec): an empty line opens so you can add
    // indented content inside it, and any page refs it holds can be expanded
    // NESTED inside the opened transclusion. `ref` is unused here on purpose.
    const targetGuid = hit.lineGuid;
    const key = hit.queryLineGuid + "›" + targetGuid;
    if (this._expandInFlight.has(key)) return;
    this._expandInFlight.add(key);
    try {
      if (targetGuid === hit.queryHostGuid) return this._toast("Can't embed a page inside itself.");
      const host = await this._pageRecord(hit.queryHostGuid);
      if (!host) return this._toast("Couldn't find the page holding this search.");
      let items; try { items = await host.getLineItems(); } catch (e) { items = []; }
      const byGuid = {};
      const idx = (arr) => { for (const it of arr || []) { if (!it) continue; byGuid[it.guid] = it; if (it.children) idx(it.children); } };
      idx(items);
      const qline = byGuid[hit.queryLineGuid];
      if (!qline) return this._toast("Couldn't find the search block.");
      const parent = qline.parent_guid ? byGuid[qline.parent_guid] : null;
      const sibs = parent ? (parent.children || []) : items;
      const dup = sibs.some((c) => c && c.type === "transclusion" && c.props && c.props.refx_embed && c.props.refx_at === hit.lineGuid && c.props.itemref === targetGuid);
      if (dup) return; // already open → no-op (toggle)
      let line = null;
      try { line = await host.createLineItem(parent, qline, "transclusion", null, { itemref: targetGuid, refx_embed: 1, refx_from: hit.queryLineGuid, refx_at: hit.lineGuid }); } catch (e) {}
      if (!line) return this._toast("Couldn't expand the reference.");
      try { if (!(line.props && line.props.itemref)) line.setMetaProperty("itemref", targetGuid); } catch (e) {}
      // A search can return PAGES too — then the "line" IS a record, and the
      // embed gets the editable property card like any page embed.
      if (this.data.getRecord(targetGuid)) {
        if (this._peOn()) this._peHideOn(line.guid);
        this._cards.set(line.guid, { recordGuid: targetGuid, line });
        this._attachPropCard(line.guid, targetGuid);
      }
      this._queryEmbeds.set(line.guid, { resultRealGuid: hit.lineGuid, queryLineGuid: hit.queryLineGuid });
      this._ensureCardObserver();
      this._placeQueryEmbed(line.guid, hit.lineGuid, 0);
    } finally {
      this._expandInFlight.delete(key);
    }
  }

  // Park a query-spawned embed's rendered node directly under its result row.
  // Both nodes render async (and the row's V-guid changes every query render),
  // so resolve fresh each time and retry briefly. On success, cache node+row so
  // the observer's staleness check is O(1); when the row is gone (result no
  // longer matches), PARK the entry so the observer doesn't grind retries —
  // the embed then just shows at its model position below the block.
  _placeQueryEmbed(embedGuid, resultRealGuid, attempt) {
    attempt = attempt || 0;
    if (this._unloaded) return;
    const qe = this._queryEmbeds.get(embedGuid);
    if (!qe) return;
    const emb = this._transclusionNode(embedGuid);
    const row = this._queryRowNode(resultRealGuid, qe.queryLineGuid);
    if (emb && row) {
      if (row.nextElementSibling !== emb) { try { row.insertAdjacentElement("afterend", emb); } catch (e) {} }
      try { emb.classList.add("refx-qembed"); } catch (e) {}
      this._wireEmbedBodyClick(emb, embedGuid);
      qe.node = emb; qe.row = row; qe.parked = false;
      return;
    }
    if (attempt < 15) { setTimeout(() => this._placeQueryEmbed(embedGuid, resultRealGuid, attempt + 1), 120); return; }
    qe.node = emb || null; qe.row = null; qe.parked = true;
  }

  // Mark a STANDALONE line-ref embed's rendered node: add the .refx-lineembed
  // class (its CSS writing strip) and wire the dead-space click handler. Unlike a
  // query embed there's NO reparent — the node already sits at its model position
  // (a real sibling child of the ref line). The node renders async and Thymer
  // REPLACES it on every re-render, so retry until it appears; the observer
  // re-marks a replacement node afterwards.
  _markLineEmbed(embedGuid, attempt) {
    attempt = attempt || 0;
    if (this._unloaded) return;
    const le = this._lineEmbeds.get(embedGuid);
    if (!le) return;
    const node = this._transclusionNode(embedGuid);
    if (node) {
      try { node.classList.add("refx-lineembed"); } catch (e) {}
      this._wireEmbedBodyClick(node, embedGuid);
      le.node = node;
      return;
    }
    if (attempt < 15) setTimeout(() => this._markLineEmbed(embedGuid, attempt + 1), 120);
  }

  // The rendered row node of a live-search result, found by the REAL line it
  // points at (row guids are ephemeral V-guids — never key on them). Two traps,
  // both hit live: (1) the page listview's getItems() does NOT include the
  // query's virtual rows — they live in the query line ITEM's nested
  // `container` listview; (2) the auxiliary "Upcoming" view keeps a hidden
  // zero-height virtual copy of the same real line, which is what a naive
  // cross-view scan finds first (the embed then parked invisibly). So: resolve
  // the query line item by guid, then search ITS container's rows only.
  _queryRowNode(resultRealGuid, queryLineGuid) {
    if (!queryLineGuid) return null;
    try {
      for (const lv of (window.g_universe && window.g_universe.listviews) || []) {
        let items; try { items = lv.getItems(); } catch (e) { continue; }
        for (const it of items || []) {
          try {
            if (!(it && it.state && it.state.guid === queryLineGuid && it.container && it.container.getItems)) continue;
            for (const r of it.container.getItems() || []) {
              const st = r.state;
              if (st && st.props && st.props.itemref === resultRealGuid && r.$node && r.$node.isConnected) return r.$node;
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    return null;
  }

  // Collapse the embed associated with the caret. Stateless — reads the real
  // document, so it works after a reload when no in-memory state survives:
  //   (a) caret on a ref → delete that ref's transclusion child of the line;
  //   (b) caret IS our transclusion line → delete it;
  //   (c) caret inside the rendered embed (DOM) → delete the owning embed line.
  async _collapseAtCaret(hit) {
    // Live-search context: collapse the embeds spawned from THIS result row
    // (refx_at tag) — they live on the host page, not under the result line's
    // source block.
    if (hit.queryLineGuid && hit.queryHostGuid) {
      const host = await this._pageRecord(hit.queryHostGuid);
      if (host) {
        let hitems = null; try { hitems = await host.getLineItems(); } catch (e) {}
        const ours = [];
        const walk = (arr) => { for (const it of arr || []) { if (!it) continue; if (it.type === "transclusion" && it.props && it.props.refx_embed && it.props.refx_at === hit.lineGuid) ours.push(it); if (it.children) walk(it.children); } };
        walk(hitems);
        for (const l of ours) await this._deleteEmbedLine(l);
      }
      return;
    }
    const rec = await this._pageRecord(hit.pageGuid);
    let items = null;
    if (rec) { try { items = await rec.getLineItems(); } catch (e) {} }
    const ref = this._selectedRef(hit);
    if (items) {
      const block = this._findLineDeep(items, hit.lineGuid);
      if (block) {
        // The selected ref's embeds first; on a multi-ref line the selection is
        // a nearest-guess, so fall back to ALL our embeds under the line — a
        // no-op Cmd+Up here would otherwise leave native fold to hide them.
        let found = ref ? this._findEmbeds(block, ref.targetGuid) : [];
        if (!found.length) found = ((block.children) || []).filter((c) => c && c.type === "transclusion" && c.props && c.props.refx_embed);
        if (found.length) { for (const l of found) await this._deleteEmbedLine(l); return; }
      }
    }
    if (items) {
      const encl = this._enclosingEmbed(items, hit.lineGuid);
      if (encl) { await this._deleteEmbedLine(encl); return; }
    }
    const g = this._enclosingEmbedGuidFromDom(hit);
    if (g) { const e = this._cards.get(g); if (e && e.line) await this._deleteEmbedLine(e.line); }
  }

  // Click the native "…" unfold button on a line (Thymer's fold state is
  // per-line and persistent; its UI button accepts synthetic clicks — verified
  // live). No-op when the line isn't folded / isn't rendered.
  _unfoldHostLine(lineGuid) {
    try {
      const esc = (window.CSS && CSS.escape) ? CSS.escape(lineGuid) : lineGuid;
      const li = document.querySelector('.listitem[data-guid="' + esc + '"]');
      const btn = li && li.querySelector(".lineitem-btn-unfold");
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      if (!(r.width || r.height)) return;
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
      const down = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 };
      const up = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 0 };
      try { btn.dispatchEvent(new PointerEvent("pointerdown", down)); } catch (e) {}
      btn.dispatchEvent(new MouseEvent("mousedown", down));
      try { btn.dispatchEvent(new PointerEvent("pointerup", up)); } catch (e) {}
      btn.dispatchEvent(new MouseEvent("mouseup", up));
      btn.dispatchEvent(new MouseEvent("click", up));
    } catch (e) {}
  }

  // Find a line ANYWHERE in a getLineItems() tree (items.find is top-level only).
  _findLineDeep(items, guid) {
    for (const it of items || []) {
      if (!it) continue;
      if (it.guid === guid) return it;
      if (it.children) { const r = this._findLineDeep(it.children, guid); if (r) return r; }
    }
    return null;
  }

  // Our transclusion children of `block` that target `targetGuid`.
  _findEmbeds(block, targetGuid) {
    const kids = (block && block.children) || [];
    return kids.filter((c) => c && c.type === "transclusion" && c.props && c.props.itemref === targetGuid);
  }

  // Walk up parent_guid from the caret line to the first of OUR transclusion
  // ancestors (or the line itself).
  _enclosingEmbed(items, lineGuid) {
    const byGuid = {};
    const index = (arr) => { for (const it of arr || []) { if (!it) continue; byGuid[it.guid] = it; if (it.children) index(it.children); } };
    index(items);
    let cur = byGuid[lineGuid], guard = 0;
    while (cur && guard++ < 300) {
      if (cur.type === "transclusion" && cur.props && cur.props.refx_embed) return cur;
      cur = cur.parent_guid ? byGuid[cur.parent_guid] : null;
    }
    return null;
  }

  // DOM fallback: climb from the caret node to the nearest element whose
  // data-guid is one of our tracked embeds (caret inside the rendered target).
  _enclosingEmbedGuidFromDom(hit) {
    try {
      let n = hit.lineNode || hit.anchorNode;
      while (n && n !== document.body) {
        const g = n.getAttribute && n.getAttribute("data-guid");
        if (g && this._cards.has(g)) return g;
        n = n.parentElement;
      }
    } catch (e) {}
    return null;
  }

  // Sync (keydown-time) test: does the caret's LINE have any of our embeds
  // open under it? Line-level on purpose: on a multi-ref line the "selected"
  // ref is a nearest-guess, and gating per target let Cmd+Up fall through to
  // NATIVE fold — which hid the embed as a folded child ("…" dots that
  // re-open it, the indent-lookalike bug). NOTE Thymer renders lines FLAT — a
  // child's node is a SIBLING in .listview-items, not nested (verified live),
  // so a DOM scan under the caret line finds nothing; use the model registry:
  // an open embed = a live refx_embed transclusion whose PARENT is this line.
  _lineEmbedOpenSync(hit) {
    try {
      const m = (window.g_universe && window.g_universe.itemsByGuid) || {};
      for (const g in m) {
        const it = m[g];
        if (!it || it.type !== "transclusion" || it.is_deleted || it.is_trashed) continue;
        if (!(it.props && it.props.refx_embed)) continue;
        const pg = (it.parent && it.parent.guid) || it.parent_guid;
        if (pg === hit.lineGuid) return true;
      }
    } catch (e) {}
    return false;
  }

  // Sync test for the live-search case: does THIS result row (refx_at tag) have
  // one of our embeds open?
  _queryEmbedOpenSync(hit) {
    try {
      const m = (window.g_universe && window.g_universe.itemsByGuid) || {};
      for (const g in m) {
        const it = m[g];
        if (it && it.type === "transclusion" && !it.is_deleted && !it.is_trashed &&
            it.props && it.props.refx_embed && it.props.refx_at === hit.lineGuid) return true;
      }
    } catch (e) {}
    return false;
  }


  // Is the caret ON one of our embed transclusion lines itself?
  _caretOnEmbedLine(hit) {
    try {
      const it = ((window.g_universe && window.g_universe.itemsByGuid) || {})[hit.lineGuid];
      if (it && it.type === "transclusion" && it.props && it.props.refx_embed) return true;
    } catch (e) {}
    try { return !!(hit.lineNode && hit.lineNode.classList && hit.lineNode.classList.contains("listitem-transclusion") && this._cards.has(hit.lineGuid)); } catch (e) { return false; }
  }

  // Refuse to embed a block into itself, an ancestor, OR a target whose own
  // subtree already embeds us (a mutual A⇄B embed is durable synced state that
  // recurses on render — the same "would loop forever" class as the linear case).
  async _wouldCycle(block, pageGuid, targetGuid) {
    if (!targetGuid) return false;
    if (targetGuid === (block && block.guid) || targetGuid === pageGuid) return true;
    const ours = new Set([pageGuid, block && block.guid].filter(Boolean));
    try {
      const ctx = await block.getTreeContext();
      for (const a of (ctx && ctx.ancestors) || []) { if (a && a.guid) { if (a.guid === targetGuid) return true; ours.add(a.guid); } }
    } catch (e) {}
    // Bounded walk of the TARGET's tree for one of OUR embeds pointing back at us.
    try {
      const trec = this.data.getRecord(targetGuid);
      if (trec && trec.getLineItems) {
        const items = await trec.getLineItems();
        let hit = false;
        const walk = (arr, depth) => {
          if (hit || depth > 5) return;
          for (const it of arr || []) {
            if (!it) continue;
            if (it.type === "transclusion" && it.props && it.props.refx_embed && ours.has(it.props.itemref)) { hit = true; return; }
            if (it.children) walk(it.children, depth + 1);
          }
        };
        walk(items, 0);
        if (hit) return true;
      }
    } catch (e) {}
    return false;
  }

  // Safe delete of an embed line (backend rejects delete if it has children).
  async _deleteEmbedLine(line) {
    if (!line) return;
    const g = line.guid;
    const savedEntry = this._cards.get(g) || null;
    this._cards.delete(g);
    this._queryEmbeds.delete(g);
    this._lineEmbeds.delete(g);
    this._removeCardEl(g);
    try {
      let ok = await line.delete();
      if (ok === false) {
        // delete() returns false when the line has CHILDREN. The plugin never
        // creates children under its embed line, so any children are the USER's
        // own lines Tab-indented under it — never delete those silently. Refuse,
        // restore the card, and tell them.
        if (savedEntry) { this._cards.set(g, savedEntry); this._attachPropCard(g, savedEntry.recordGuid, true); }
        this._toast("Embed has your own lines nested under it — move them out first.");
        return;
      }
    } catch (e) {}
    if (!this._cards.size && !this._queryEmbeds.size && !this._lineEmbeds.size) this._teardownCardObserver();
  }

  async _collapseAllOnPage() {
    const rec = this._activeRecord();
    if (!rec) return this._toast("Open a page first.");
    let items; try { items = await rec.getLineItems(); } catch (e) { return; }
    const all = [];
    const walk = (arr) => { for (const it of arr || []) { if (!it) continue; if (it.type === "transclusion" && it.props && it.props.refx_embed) all.push(it); if (it.children) walk(it.children); } };
    walk(items);
    if (!all.length) return this._toast("No embeds on this page.");
    for (const l of all) await this._deleteEmbedLine(l);
    this._toast("Collapsed " + all.length + " embed" + (all.length === 1 ? "" : "s") + ".");
  }

  _activeRecord() {
    try { const p = this.ui.getActivePanel && this.ui.getActivePanel(); return (p && p.getActiveRecord && p.getActiveRecord()) || null; } catch (e) { return null; }
  }

  // ------------------------------------------------ page embeds: the real page panel
  //
  // A page reference expanded on the desktop shows THYMER'S OWN page panel (its properties and its
  // body, editable, exactly as on the page) inside our transclusion line. The line stays the data:
  // synced, undoable, and on the phone (one panel at a time, so nothing to borrow) or without this
  // plugin it renders as Thymer's native transclusion, the body only.
  // The machinery is Storyroom's and Timer's (playbook §7, "The real editor"): borrow a panel with
  // ui.createPanel, keep it out of the grid (park, grid columns put back), navigate it to the page,
  // move its .panel into the row, hide its chrome (tab bar, banner, title, backlinks) by CSS.
  // Proven in his app on 2026-11-02 (prototype, his OK): it grows with its content, scrolls with the
  // document, and survives Thymer rebuilding the row (the observer puts it back before the paint).
  // Two looks, after Tana: a line that is ONLY the reference unfolds in place without a frame
  // ("line"); a reference inside text opens a framed box under its line ("box").

  _peOn() {
    if (document.documentElement.getAttribute("data-mobile-type") === "phone") return false;
    return !!(this.ui && this.ui.createPanel);
  }
  // Shared with Storyroom and Timer: a panel in this set is someone's embedded editor.
  _peClaims() { return (window.__thymerPanelClaims = window.__thymerPanelClaims || new Set()); }
  _pePid(p) { try { return p.getId(); } catch (e) { return null; } }
  _peWs() { return (window.g_universe && window.g_universe.workspaceGuid) || null; }
  _peNav(root) { return { type: "edit_panel", rootId: root, subId: null, workspaceGuid: this._peWs(), state: { positions: [root, "empty-" + root, 0, "L"], refxEmbed: 1 } }; }
  // createPanel adds a real column to the grid and closePanel recomputes it: put his columns back
  // after either, or a blank split appears beside his page.
  _peGridCols() { const g = document.querySelector(".panels-grid"); return g ? g.style.gridTemplateColumns : null; }
  _peGridRestore(cols) {
    const g = document.querySelector(".panels-grid");
    if (g && cols != null && g.style.gridTemplateColumns !== cols) g.style.gridTemplateColumns = cols;
    this._peNormaliseGrid();
  }
  // The template must have exactly one track per panel really IN the grid (Timer's rule): a
  // borrowed panel that left the grid once left a blank second column beside his page. Only a
  // MISMATCH is corrected, so widths he dragged himself are kept.
  _peNormaliseGrid() {
    try {
      const g = document.querySelector(".panels-grid");
      if (!g) return;
      const n = [...g.children].filter((c) => c.classList && c.classList.contains("panel")).length;
      const cur = g.style.gridTemplateColumns || "";
      if (!n || !cur) return;
      if (cur.split("var(--panel-sizer-width)").length !== n) {
        const a = []; for (let i = 0; i < n; i++) a.push("1fr");
        g.style.gridTemplateColumns = a.join(" var(--panel-sizer-width) ");
      }
    } catch (e) {}
  }
  // A panel loads, and waits for its row, here: clipped but laid out (an unlaid-out editor
  // renders no lines), and still in the document (a detached panel may be closed by the app).
  _peParkEl() {
    let p = this._pePark;
    if (!p || !p.isConnected) {
      p = document.querySelector(".refx-pe-park") || this._el("div", "refx-pe-park");
      if (!p.isConnected) document.body.appendChild(p);
      this._pePark = p;
    }
    return p;
  }
  // Thymer's "open in the other panel" must never pick a borrowed panel (Storyroom's flag + patch).
  _peGuardTargeting(panel) {
    try {
      const inner = panel && panel._getPanel ? panel._getPanel() : null;
      if (!inner) return;
      inner.srEmbedded = true;
      const layout = inner.getParentLayout ? inner.getParentLayout() : null;
      const proto = layout ? Object.getPrototypeOf(layout) : null;
      if (!proto || proto.__srTargetGuard) return;
      const orig = proto.isExcludedFromTargeting;
      if (typeof orig !== "function") return;
      proto.isExcludedFromTargeting = function (pn) { try { if (pn && pn.srEmbedded) return true; } catch (e) {} return orig.call(this, pn); };
      proto.__srTargetGuard = true;
    } catch (e) {}
  }

  // ONE panel opens at a time, from createPanel until its navigation has landed: two embeds opened
  // together were handed the SAME panel, and a panel created while the previous one was still
  // navigating left that one empty for good (both seen 2026-11-02). So attaches are chained.
  _peAttach(lineGuid, recordGuid) {
    const prev = this._peCreating || Promise.resolve();
    const run = prev.catch(() => {}).then(() => this._peAttachInner(lineGuid, recordGuid)).then((ok) => {
      // not ours after all (cap reached, collapsed meanwhile): let Thymer's own body show again
      if (!ok && !this._pageEmbeds.has(lineGuid)) this._peHideOff(lineGuid);
      return ok;
    });
    this._peCreating = run.catch(() => {});
    return run;
  }

  async _peAttachInner(lineGuid, recordGuid) {
    if (this._unloaded || !this._peOn()) return false;
    let e = this._pageEmbeds.get(lineGuid);
    if (e) {
      if (e.recordGuid === recordGuid) { this._pePlace(lineGuid); return true; }
      this._peClose(lineGuid);
    }
    if (!this._cards.has(lineGuid)) return false; // collapsed while it waited its turn
    if (this._pageEmbeds.size >= this._PE_CAP) return false;
    e = { recordGuid, panel: null, slot: null, ready: false };
    this._pageEmbeds.set(lineGuid, e);
    this._peHideOn(lineGuid);
    const mine = () => !this._unloaded && this._pageEmbeds.get(lineGuid) === e;
    // give the panel back exactly once: through _peClose while the entry is still ours
    const drop = () => { if (this._pageEmbeds.get(lineGuid) === e) this._peClose(lineGuid, e); else this._peDispose(e); };
    const cols = this._peGridCols();
    // an idle panel from the pool first (no createPanel, no grid churn at all)
    let panel = null, slot = null;
    while (!panel && this._pePool.length) {
      const idle = this._pePool.shift();
      if (this._peAlive(idle.panel) && idle.slot) { panel = idle.panel; slot = idle.slot; }
      else this._peDispose(idle, true);
    }
    // A fresh createPanel writes a split template and puts the new panel in the grid (his page went
    // to a third of its width for ~7 ms, measured). Timer's guard: while mounting, every panel that
    // was already there is marked to stay, any other is taken out of the grid by CSS, and his
    // columns are held.
    const unmount = panel ? null : this._peMountGuard(cols);
    // refuse a panel someone already claimed (Timer's rule: createPanel can hand out one in use)
    for (let t = 0; t < 5 && !panel && mine(); t++) {
      let got = null;
      try { got = await this.ui.createPanel(); } catch (err) {}
      if (!got) break;
      const id = this._pePid(got);
      if (id && this._peClaims().has(id)) { await new Promise((r) => setTimeout(r, 220)); continue; }
      panel = got;
    }
    if (panel) { e.panel = panel; this._peClaims().add(this._pePid(panel)); this._peGuardTargeting(panel); }
    if (!panel || !mine()) { if (unmount) unmount(); if (panel) e.slot = slot; drop(); this._peGridRestore(cols); return false; }
    for (let i = 0; i < 40 && !slot; i++) {
      try { const el = panel.getElement(); slot = el && el.closest ? el.closest(".panel") : null; } catch (err) {}
      if (!slot) await new Promise((r) => setTimeout(r, 25));
    }
    if (!slot || !mine()) { if (unmount) unmount(); drop(); this._peGridRestore(cols); return false; }
    e.slot = slot;
    slot.classList.add("refx-pemb");
    slot.style.clipPath = "inset(100%)";
    this._peParkEl().appendChild(slot);
    if (unmount) unmount();
    this._peGridRestore(cols);
    // poll the NAVIGATION, never "has any line": a fresh panel shows its default page first.
    // Re-issued every second in case one does not land.
    let ok = false;
    for (let i = 0; i < 100 && !ok; i++) {
      if (i % 20 === 0) { try { Promise.resolve(panel.navigateTo(this._peNav(recordGuid))).catch(() => {}); } catch (err) {} }
      await new Promise((r) => setTimeout(r, 50));
      if (!mine()) return false;
      let nv = null; try { nv = panel.getNavigation(); } catch (err) {}
      ok = !!(nv && nv.rootId === recordGuid && slot.querySelector(".page-props-editor-container, .listview-items"));
    }
    this._peGridRestore(cols);
    if (!ok) { this._peClose(lineGuid); return false; }
    e.ready = true;
    this._pePlace(lineGuid);
    this._peEnsureWatch();
    return true;
  }

  // Into its row when the row is rendered, else back to the park.
  _pePlace(lineGuid) {
    const e = this._pageEmbeds.get(lineGuid);
    if (!e || !e.slot) return;
    const host = e.ready ? this._transclusionNode(lineGuid) : null;
    if (!host || !host.classList.contains("listitem-transclusion")) {
      const park = this._peParkEl();
      if (e.slot.parentNode !== park) { e.slot.style.clipPath = "inset(100%)"; park.appendChild(e.slot); }
      return;
    }
    if (!host.classList.contains("refx-pemb-host")) host.classList.add("refx-pemb-host");
    const mode = this._peMode(lineGuid);
    if (e.slot.dataset.mode !== mode) e.slot.dataset.mode = mode;
    if (e.slot.parentNode !== host) host.appendChild(e.slot);
    if (e.slot.style.clipPath) e.slot.style.clipPath = "";
  }

  // A recycled row element can keep our host class for a line that is not embedded any more.
  _peSweepHosts() {
    try {
      for (const n of document.querySelectorAll(".listitem-transclusion.refx-pemb-host")) {
        const g = n.getAttribute("data-guid");
        const e = g && this._pageEmbeds.get(g);
        if (!e || e.slot.parentNode !== n) n.classList.remove("refx-pemb-host");
      }
    } catch (e) {}
  }

  // "line" when the reference line holds nothing but the reference, else "box" (Tana's two looks).
  _peMode(lineGuid) {
    const m = (window.g_universe && window.g_universe.itemsByGuid) || {};
    const it = m[lineGuid];
    if (!it || (it.props && it.props.refx_at)) return "box"; // a live-search embed sits under a result row
    const pg = (it.parent && it.parent.guid) || it.parent_guid;
    const segs = pg && m[pg] ? this._segmentsFromState(m[pg]) : [];
    const refs = segs.filter((s) => s.type === "ref");
    const other = segs.filter((s) => s.type !== "ref" && !(typeof s.text === "string" && !s.text.trim()));
    return refs.length === 1 && !other.length ? "line" : "box";
  }

  // closePanel makes Thymer recompute the grid into an EQUAL split for a moment before the panel
  // goes: his page jumped to half width with an empty column beside it for ~0.2 s on every collapse
  // (his recording 2026-11-02, frames 226-253). Quick Capture's cure (2026-06-28): put the panel on
  // <body>, hidden, BEFORE closing it; out of the grid there is nothing for Thymer to split.
  // Thymer's own rendering of an embed row (the page BODY in a frame) must never show on the
  // desktop: not while the panel is still on its way, and not in the ~50 ms between our closing it
  // and the line being deleted (both flashed in his recording 2026-11-02, 21:54). A class on the
  // row could not do it: the row may not exist yet, and Thymer recycles row elements for other
  // lines. So a stylesheet keyed on the line's guid, from the moment we take it until a while after
  // we let go.
  _peHideOn(g) { this._peHide.set(g, 0); this._peHideSync(); }
  _peHideOff(g) {
    if (!this._peHide.has(g)) return;
    this._peHide.set(g, Date.now() + 1500);
    if (!this._peHideT) this._peHideT = setTimeout(() => { this._peHideT = 0; this._peHideSync(); }, 1600);
  }
  _peHideSync() {
    const now = Date.now();
    for (const [g, until] of [...this._peHide]) if (until && until <= now && !this._pageEmbeds.has(g)) this._peHide.delete(g);
    let st = document.getElementById("refx-pe-hide");
    if (!this._peHide.size) { if (st) st.textContent = ""; return; }
    if (!st) { st = document.createElement("style"); st.id = "refx-pe-hide"; document.head.appendChild(st); }
    const sel = [];
    for (const g of this._peHide.keys()) {
      const k = '.listitem-transclusion[data-guid="' + this._escCssAttr(g) + '"]';
      sel.push(k + " > .transclusion-container-div", k + " > .line-fold-chevron");
    }
    const css = sel.join(",") + "{display:none !important;}";
    if (st.textContent !== css) st.textContent = css;
    if ([...this._peHide.values()].some((u) => u) && !this._peHideT) this._peHideT = setTimeout(() => { this._peHideT = 0; this._peHideSync(); }, 1600);
  }

  // Returns the release function. Safe to call twice.
  _peMountGuard(cols) {
    const g = document.querySelector(".panels-grid");
    if (!g) return () => {};
    for (const pn of g.querySelectorAll(":scope > .panel")) pn.dataset.refxKeep = "1";
    g.classList.add("refx-pe-mounting");
    let lock = null;
    if (cols != null) {
      lock = new MutationObserver(() => { if (g.style.gridTemplateColumns !== cols) g.style.gridTemplateColumns = cols; });
      try { lock.observe(g, { attributes: true, attributeFilter: ["style"] }); } catch (e) { lock = null; }
    }
    let done = false;
    return () => {
      if (done) return; done = true;
      if (lock) lock.disconnect();
      g.classList.remove("refx-pe-mounting");
      for (const pn of g.querySelectorAll(":scope > .panel[data-refx-keep]")) delete pn.dataset.refxKeep;
    };
  }

  _peAlive(panel) {
    try { const id = this._pePid(panel); return !!id && (this.ui.getPanels() || []).some((p) => this._pePid(p) === id); } catch (e) { return false; }
  }

  // EVERY closePanel flashes a split of his page (see below), so a collapsed embed's panel is NOT
  // closed: it goes back to the park, hidden, and the next expand reuses it. Only unload (final)
  // or a pool that is full really closes one.
  _peDispose(e, final) {
    if (!e) return;
    if (!final && e.panel && e.slot && this._pePool.length < this._PE_POOL && !this._unloaded && this._peAlive(e.panel)) {
      try { e.slot.style.clipPath = "inset(100%)"; delete e.slot.dataset.mode; this._peParkEl().appendChild(e.slot); } catch (err) {}
      this._pePool.push({ panel: e.panel, slot: e.slot });
      return;
    }
    const slot = e.slot;
    if (slot) {
      try { slot.style.setProperty("display", "none", "important"); document.body.appendChild(slot); } catch (err) {}
    }
    if (e.panel) {
      this._peClaims().delete(this._pePid(e.panel));
      // ...and that alone did NOT stop it (his second recording): Thymer still counts the closing
      // panel while it animates out, and writes a split template meanwhile. So HOLD his columns
      // for the length of the close (Timer's embLockGrid idea): any template written in that
      // window is put straight back, synchronously, before it paints.
      // Measured: the closing panel is put BACK into the grid for its animation (his page went to
      // width 0 for a moment). The mount guard takes it out of the grid and holds his columns.
      const cols = this._peGridCols();
      const release = this._peMountGuard(cols);
      try { this.ui.closePanel(e.panel); } catch (err) {}
      this._peGridRestore(cols);
      setTimeout(() => { release(); this._peNormaliseGrid(); }, 700);
    }
    if (slot) setTimeout(() => { try { if (slot.parentNode === document.body) slot.remove(); } catch (err) {} }, 700);
  }

  // only: close it only while the entry is still that one (a newer attach may have replaced it)
  _peClose(lineGuid, only) {
    const e = this._pageEmbeds.get(lineGuid);
    if (!e || (only && e !== only)) return;
    this._pageEmbeds.delete(lineGuid);
    this._peDispose(e);
    this._peHideOff(lineGuid);
    setTimeout(() => this._peSweepHosts(), 1600);
    if (!this._pageEmbeds.size) this._peStopWatch();
  }

  _peCloseAll() {
    for (const [g, e] of [...this._pageEmbeds]) { this._pageEmbeds.delete(g); this._peDispose(e, true); }
    for (const idle of this._pePool.splice(0)) this._peDispose(idle, true);
    this._peStopWatch();
    try { document.querySelectorAll(".refx-pemb-host").forEach((n) => n.classList.remove("refx-pemb-host")); } catch (e) {}
    try { document.querySelectorAll(".refx-pe-park").forEach((n) => n.remove()); } catch (e) {}
    this._pePark = null;
    this._peHide.clear();
    if (this._peHideT) { clearTimeout(this._peHideT); this._peHideT = 0; }
    try { const st = document.getElementById("refx-pe-hide"); if (st) st.remove(); } catch (e) {}
  }

  // A panel an earlier load of this plugin borrowed and never handed back (a reload, a crash).
  _peCloseOrphans() {
    try {
      const own = new Set([...this._pageEmbeds.values(), ...this._pePool].map((x) => x.panel && this._pePid(x.panel)));
      for (const p of (this.ui.getPanels() || [])) {
        const id = this._pePid(p);
        if (own.has(id)) continue;
        let nv = null; try { nv = p.getNavigation(); } catch (e) {}
        if (!(nv && nv.state && nv.state.refxEmbed)) continue;
        this._peDispose({ panel: p, slot: (() => { try { const s = p.getElement().closest(".panel"); return s && !(s.parentNode && s.parentNode.classList && s.parentNode.classList.contains("panels-grid")) ? s : null; } catch (e) { return null; } })() }, true);
      }
    } catch (e) {}
  }

  _peEnsureWatch() { if (!this._peWatchT && !this._unloaded) this._peWatchT = setInterval(() => this._peTick(), 250); }
  _peStopWatch() { if (this._peWatchT) { clearInterval(this._peWatchT); this._peWatchT = 0; } }
  // Every 250 ms while a page panel is open: drop one the app closed, and send a link followed
  // INSIDE the panel to the page it sits on (the panel itself goes back to its page).
  _peTick() {
    if (this._unloaded || !this._pageEmbeds.size) { this._peStopWatch(); return; }
    this._peNormaliseGrid();
    let ids = null; try { ids = new Set((this.ui.getPanels() || []).map((p) => this._pePid(p))); } catch (e) {}
    for (const [g, e] of [...this._pageEmbeds]) {
      if (!e.ready || !e.panel) continue;
      if (ids && !ids.has(this._pePid(e.panel))) { this._pageEmbeds.delete(g); try { if (e.slot && e.slot.parentNode) e.slot.parentNode.removeChild(e.slot); } catch (err) {} continue; }
      let nv = null; try { nv = e.panel.getNavigation(); } catch (err) {}
      if (nv && nv.rootId && nv.rootId !== e.recordGuid) {
        this._peOpenInHost(e, nv);
        try { Promise.resolve(e.panel.navigateTo(this._peNav(e.recordGuid))).catch(() => {}); } catch (err) {}
      }
    }
  }
  _peOpenInHost(e, nv) {
    try {
      const outer = e.slot && e.slot.parentElement && e.slot.parentElement.closest(".panel");
      const host = outer && (this.ui.getPanels() || []).find((p) => { try { return p.getElement().closest(".panel") === outer; } catch (err) { return false; } });
      if (!host) return;
      Promise.resolve(host.navigateTo({ type: nv.type || "edit_panel", rootId: nv.rootId, subId: nv.subId || null, workspaceGuid: nv.workspaceGuid || this._peWs() })).catch(() => {});
    } catch (err) {}
  }

  // ---- page embeds: the keyboard ----
  // The page's own editor does not know the panel is there: from the reference line, ArrowDown
  // would walk into the transclusion row's HIDDEN body and the caret would vanish. So, on plain
  // ArrowUp/ArrowDown at a line's top/bottom VISUAL line (a wrapped line walks within itself first):
  //   page line just above an open page panel  -> its first body line;
  //   page line just below it                  -> its last body line;
  //   first / last body line of the panel      -> the page line above / below the panel.
  // Neighbours are found by GEOMETRY within the same panel (rows are flat and absolutely placed).
  _peKey = (ev) => {
    if (!this._pageEmbeds.size) return;
    if (ev.key !== "ArrowUp" && ev.key !== "ArrowDown") return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
    if (this._modal || this._link) return;
    // A page panel's PROPERTIES have the keyboard: Thymer walks them itself (arrows, Enter edits,
    // past the last one into the body). Only ArrowUp on the first one is ours: Thymer would send
    // it to the page title, which is hidden here, so it goes back to the page line above instead.
    const fc = window.g_focusedComponent;
    const fcEmbed = fc && fc.node && fc.node.closest && fc.node.closest(".panel.refx-pemb");
    if (fcEmbed) {
      // Thymer moves its own focus after this handler; keep the row it lands on in view
      if (!(fc.focusState && fc.focusState.isEditing)) setTimeout(() => this._peShowFocusedRow(fc), 0);
      if (ev.key !== "ArrowUp" || !fc.focusState || fc.focusState.isEditing) return;
      const t = this._pePropTargets(fc);
      if (!t.length || fc.focusState.fieldId !== t[0]) return;
      const host = fcEmbed.parentNode;
      const target = host && host.classList && host.classList.contains("refx-pemb-host") ? this._peRowNear(host, "before") : null;
      if (!target) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      this._peCaretAt(target, "end", this._pePosClass());
      return;
    }
    const c = this._peCaret();
    if (!c) return;
    const down = ev.key === "ArrowDown";
    if (!this._peOnEdge(c, down ? "bottom" : "top")) return;
    let target = null, where = down ? "start" : "end";
    if (c.embed) {
      const lines = this._peLines(c.embed);
      if (!lines.length || c.li !== (down ? lines[lines.length - 1] : lines[0])) return;
      // up from the first body line: into the properties (their last row), as on a page
      if (!down && this._pePropTargets(this._pePropsOf(c.embed)).length) {
        ev.preventDefault(); ev.stopImmediatePropagation();
        this._peEnterProps(c.embed, true);
        return;
      }
      const host = c.embed.slot.parentNode;
      target = host && (down ? this._peRowNear(host, "after") : this._peRowNear(host, "before"));
    } else {
      const e = this._peAdjacent(c.li, down);
      // down from the page line above: into the properties first (their first row), as on a page
      if (e && down && this._pePropTargets(this._pePropsOf(e)).length) {
        ev.preventDefault(); ev.stopImmediatePropagation();
        this._peEnterProps(e, false);
        return;
      }
      const lines = e ? this._peLines(e) : [];
      target = lines.length ? (down ? lines[0] : lines[lines.length - 1]) : null;
    }
    if (!target) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    this._peCaretAt(target, where, c.PosC);
  };

  // The page panel's own properties editor (Thymer's component: body.children[i].propseditor).
  _pePropsOf(e) {
    try {
      const body = e && e.panel && e.panel._getPanel && e.panel._getPanel().body;
      for (const c of (body && body.children) || []) if (c && c.propseditor && typeof c.propseditor.focusFirstRow === "function") return c.propseditor;
    } catch (err) {}
    return null;
  }
  // The rows Thymer's arrows walk; none when the properties are folded into pills or hidden.
  _pePropTargets(pe) {
    try {
      if (!pe || (pe._isTableVisible && !pe._isTableVisible())) return [];
      return (pe._getKeyboardNavTargets && pe._getKeyboardNavTargets()) || [];
    } catch (e) { return []; }
  }
  // Give the panel, then its properties editor, the keyboard: focusFirstRow / focusLastRow are
  // Thymer's own (they make the editor the focused component), so from there it is all native.
  _peEnterProps(e, last) {
    const pe = this._pePropsOf(e);
    if (!pe) return false;
    try { if (this.ui.setActivePanel) this.ui.setActivePanel(e.panel); } catch (err) {}
    try { if (last) pe.focusLastRow(); else pe.focusFirstRow(); } catch (err) { return false; }
    this._peShowFocusedRow(pe);
    return true;
  }
  // Keep the property row that has the keyboard on screen, and move the page NO more than that.
  // Never scroll the whole panel into view: it is usually taller than the window, and "nearest"
  // then lines up its BOTTOM edge, throwing the page up past the very row just focused (his
  // recording 2026-11-02 22:37: ~250 px on the first Down, the first property out of sight).
  _peShowFocusedRow(pe) {
    try {
      const id = pe && pe.focusState && pe.focusState.fieldId;
      const row = id && pe.node && pe.node.querySelector('[data-field-id="' + this._escCssAttr(id) + '"]');
      if (row) row.scrollIntoView({ block: "nearest" });
    } catch (e) {}
  }
  _pePosClass() {
    for (const lv of (window.g_universe && window.g_universe.listviews) || []) { try { const p = lv.selection._caret.pos; if (p) return p.constructor; } catch (e) {} }
    return null;
  }

  // The caret's line element, its panel, and the page embed it is in (null in a page itself).
  _peCaret() {
    for (const lv of (window.g_universe && window.g_universe.listviews) || []) {
      try {
        if (!(lv.hasFocus && lv.hasFocus())) continue;
        const car = lv.selection && lv.selection._caret;
        const pos = car && car.pos;
        const li = pos && pos.list_item && pos.list_item.$node;
        if (!li) continue;
        const pnl = lv.$container && lv.$container.closest && lv.$container.closest(".panel");
        let embed = null;
        if (pnl && pnl.classList.contains("refx-pemb")) for (const e of this._pageEmbeds.values()) if (e.slot === pnl) embed = e;
        return { li, caretEl: car.$caret, embed, PosC: pos.constructor };
      } catch (e) {}
    }
    return null;
  }

  // Is the caret on the first (top) or last (bottom) visual line of its line?
  _peOnEdge(c, edge) {
    try {
      const cr = c.caretEl.getBoundingClientRect();
      const tx = c.li.querySelector(".lineitem-text");
      const rs = tx ? [...tx.getClientRects()].filter((r) => r.height) : [];
      if (!rs.length) return true;
      return edge === "top" ? cr.top < rs[0].bottom - 1 : cr.top >= rs[rs.length - 1].top - 2;
    } catch (e) { return true; }
  }

  // The body lines of a page panel a person can stand on, top to bottom.
  _peLines(e) {
    if (!e || !e.slot) return [];
    return [...e.slot.querySelectorAll(".listview-items > .listitem")]
      .filter((li) => li.closest(".panel") === e.slot && li.offsetHeight > 0)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  }

  // An open page panel whose row starts right below (down) or ends right above (up) this line.
  _peAdjacent(li, down) {
    const pnl = li.closest(".panel");
    const r = li.getBoundingClientRect();
    for (const e of this._pageEmbeds.values()) {
      const host = e.ready && e.slot && e.slot.parentNode;
      if (!host || !host.classList || !host.classList.contains("refx-pemb-host") || host.closest(".panel") !== pnl) continue;
      const h = host.getBoundingClientRect();
      if (down ? Math.abs(h.top - r.bottom) < 6 : Math.abs(r.top - h.bottom) < 6) return e;
    }
    return null;
  }

  // The page line just after / before a row, in the row's own panel.
  _peRowNear(row, side) {
    const pnl = row.closest(".panel");
    const h = row.getBoundingClientRect();
    let best = null, bestY = side === "after" ? Infinity : -Infinity;
    for (const li of pnl.querySelectorAll(".listitem[data-guid]")) {
      if (li === row || li.closest(".panel") !== pnl || !li.offsetHeight) continue;
      const r = li.getBoundingClientRect();
      if (side === "after" ? (r.top >= h.bottom - 2 && r.top < bestY) : (r.bottom <= h.top + 2 && r.bottom > bestY)) { best = li; bestY = side === "after" ? r.top : r.bottom; }
    }
    return best;
  }

  // Put the caret at the start/end of a line in whichever panel holds it, the deterministic way
  // (playbook §3: build a Pos from the line's view, collapse the selection onto it, give that panel
  // the keyboard). A synthetic click is only the fallback: a chip-only line (a bare reference)
  // ignores synthetic presses entirely.
  _peCaretAt(li, where, PosC) {
    const guid = li.getAttribute("data-guid");
    const pnl = li.closest(".panel");
    for (const lv of (window.g_universe && window.g_universe.listviews) || []) {
      try {
        if (!lv.$container || lv.$container.closest(".panel") !== pnl) continue;
        let iv = null;
        for (const c of lv.containers || []) { if (c && c.items_by_guid && c.items_by_guid[guid]) { iv = c.items_by_guid[guid]; break; } }
        if (!iv) continue;
        const spans = iv.linespans || [];
        if (!PosC || !spans.length) break;
        const sp = where === "end" ? spans[spans.length - 1] : spans[0];
        const pos = new PosC(iv, sp, where === "end" ? (sp.grapheme_length || 0) : 0, "L");
        const P = (this.ui.getPanels() || []).find((p) => { try { return p.getElement().closest(".panel") === pnl; } catch (e) { return false; } });
        if (P && this.ui.setActivePanel) this.ui.setActivePanel(P);
        lv.selection.collapse(pos, true);
        try { window.g_virtual_input.$textarea.focus({ preventScroll: true }); } catch (e) {}
        try { li.scrollIntoView({ block: "nearest" }); } catch (e) {}
        return true;
      } catch (e) {}
    }
    return this._hitTestCaret(li.querySelector(".lineitem-text") || li);
  }

  async _onNavigated() {
    if (this._unloaded) return;
    this._scheduleDescCSS(); // a new page's lines just entered the model
    this._cards.clear();
    this._queryEmbeds.clear();
    this._lineEmbeds.clear();
    await this._indexEmbeds();
    if (this._unloaded) return;
    // Page panels are NOT all closed here (navigating ONE panel must not close and reopen the
    // embeds showing in another): close only those whose embed line is gone.
    for (const g of [...this._pageEmbeds.keys()]) if (!this._cards.has(g)) this._peClose(g);
    if (this._cards.size || this._queryEmbeds.size || this._lineEmbeds.size) {
      this._ensureCardObserver();
      for (const [lineGuid, e] of this._cards) this._attachPropCard(lineGuid, e.recordGuid);
      for (const [g, qe] of this._queryEmbeds) this._placeQueryEmbed(g, qe.resultRealGuid, 0);
      for (const g of this._lineEmbeds.keys()) this._markLineEmbed(g, 0);
    } else this._teardownCardObserver();
  }

  // ADDITIVE discovery (for focus/visibility + remote record.updated): find the
  // refx_embed transclusions across open panels and ensure each has a card WITHOUT
  // the clear-and-reattach flicker of _onNavigated. Adds cards for embeds a remote
  // client created; drops entries whose embed line is gone everywhere. This is why
  // a card appears on a second client / after switching tabs, not just on nav.
  // refreshPresent=true (focus/switch): also silent-refresh cards already showing,
  // so switching back shows current values even if the card wasn't wiped. false
  // (a remote record.updated burst): only discover NEW/missing embeds — value
  // changes are handled by _onRecordUpdated's targeted refresh, so we avoid
  // re-rendering every open card on each keystroke a remote edit streams.
  async _discover(refreshPresent) {
    if (this._unloaded) return;
    // Cheap empty-case gate: with no tracked cards AND no transclusion rendered
    // anywhere, there is nothing to discover — skip the per-panel getLineItems +
    // full tree walk entirely (this is what keeps the plugin idle-cheap while
    // typing on pages that never use embeds). getElementsByClassName is a live
    // collection — O(1). A remote-added embed renders a transclusion node, so the
    // gate passes exactly when there could be work.
    if (!this._cards.size && !document.getElementsByClassName("listitem-transclusion").length) return;
    let panels = [];
    try { panels = (this.ui.getPanels && this.ui.getPanels()) || []; } catch (e) {}
    const recs = [];
    for (const p of panels) { let r = null; try { r = p.getActiveRecord && p.getActiveRecord(); } catch (e) {} if (r) recs.push(r); }
    if (!recs.length) { const r = this._activeRecord(); if (r) recs.push(r); }
    const found = new Map(), foundQ = new Map(), foundL = new Map();
    const walk = (arr) => {
      for (const it of arr || []) {
        if (!it) continue;
        // Keep the walked ITEM (not just the target guid): _collapseAtCaret's DOM
        // fallback needs entry.line, and entries created here without it made
        // Cmd+Up from inside a discover-adopted embed a swallowed dead key.
        if (it.type === "transclusion" && it.props && it.props.refx_embed && it.props.itemref && this.data.getRecord(it.props.itemref)) found.set(it.guid, { ref: it.props.itemref, line: it });
        if (it.type === "transclusion" && it.props && it.props.refx_embed && it.props.refx_at) foundQ.set(it.guid, { at: it.props.refx_at, from: it.props.refx_from || null });
        // Standalone line-ref embed: line target (not a record), not a query embed.
        if (it.type === "transclusion" && it.props && it.props.refx_embed && it.props.itemref && !it.props.refx_at && !this.data.getRecord(it.props.itemref)) foundL.set(it.guid, true);
        if (it.children) walk(it.children);
      }
    };
    const seen = new Set();
    for (const rec of recs) {
      let rg = null; try { rg = rec.getGuid && rec.getGuid(); } catch (e) {}
      if (rg) { if (seen.has(rg)) continue; seen.add(rg); }
      let items; try { items = await rec.getLineItems(); } catch (e) { continue; }
      walk(items);
    }
    if (this._unloaded) return;
    // Register newly seen page embeds, and make sure every one has its page panel (an existing
    // panel is only re-placed, which is cheap).
    for (const [lineGuid, f] of found) {
      const entry = this._cards.get(lineGuid);
      if (!entry) this._cards.set(lineGuid, { recordGuid: f.ref, line: f.line });
      else if (!entry.line) entry.line = f.line; // backfill for collapse support
      this._attachPropCard(lineGuid, f.ref);
    }
    // Drop entries whose embed line no longer exists anywhere (collapsed elsewhere).
    for (const lineGuid of [...this._cards.keys()]) {
      if (!found.has(lineGuid) && !this._transclusionNode(lineGuid)) { this._cards.delete(lineGuid); this._removeCardEl(lineGuid); }
    }
    // Query-spawned embeds: (re)register + re-park (a parked one gets a fresh
    // attempt — its result row may have reappeared); drop gone lines.
    for (const [g, f] of foundQ) {
      let qe = this._queryEmbeds.get(g);
      if (!qe) { qe = { resultRealGuid: f.at, queryLineGuid: f.from }; this._queryEmbeds.set(g, qe); }
      qe.parked = false;
      this._placeQueryEmbed(g, qe.resultRealGuid, 0);
    }
    for (const g of [...this._queryEmbeds.keys()]) {
      if (!foundQ.has(g) && !this._transclusionNode(g)) this._queryEmbeds.delete(g);
    }
    // Standalone line-ref embeds: (re)register + re-mark; drop gone lines.
    for (const g of foundL.keys()) {
      if (!this._lineEmbeds.has(g)) this._lineEmbeds.set(g, { node: null });
      this._markLineEmbed(g, 0);
    }
    for (const g of [...this._lineEmbeds.keys()]) {
      if (!foundL.has(g) && !this._transclusionNode(g)) this._lineEmbeds.delete(g);
    }
    if (this._cards.size || this._queryEmbeds.size || this._lineEmbeds.size) this._ensureCardObserver(); else this._teardownCardObserver();
  }

  async _indexEmbeds() {
    // Index across ALL open panels (not just the active one) so cards rehydrate
    // regardless of which panel currently has focus after a reload.
    let panels = [];
    try { panels = (this.ui.getPanels && this.ui.getPanels()) || []; } catch (e) {}
    const recs = [];
    for (const p of panels) { let r = null; try { r = p.getActiveRecord && p.getActiveRecord(); } catch (e) {} if (r) recs.push(r); }
    if (!recs.length) { const r = this._activeRecord(); if (r) recs.push(r); }
    const seen = new Set();
    const walk = (arr) => {
      for (const it of arr || []) {
        if (!it) continue;
        if (it.type === "transclusion" && it.props && it.props.refx_embed && it.props.itemref && this.data.getRecord(it.props.itemref)) {
          this._cards.set(it.guid, { recordGuid: it.props.itemref, line: it });
        }
        // Query-spawned embeds (line targets included) re-register for parking.
        if (it.type === "transclusion" && it.props && it.props.refx_embed && it.props.refx_at) {
          this._queryEmbeds.set(it.guid, { resultRealGuid: it.props.refx_at, queryLineGuid: it.props.refx_from || null });
        }
        // Standalone line-ref embeds (line target, not a query embed) re-register.
        if (it.type === "transclusion" && it.props && it.props.refx_embed && it.props.itemref && !it.props.refx_at && !this.data.getRecord(it.props.itemref)) {
          this._lineEmbeds.set(it.guid, { node: null });
        }
        if (it.children) walk(it.children);
      }
    };
    for (const rec of recs) {
      let rg = null; try { rg = rec.getGuid && rec.getGuid(); } catch (e) {}
      if (rg) { if (seen.has(rg)) continue; seen.add(rg); }
      let items; try { items = await rec.getLineItems(); } catch (e) { continue; }
      walk(items);
    }
  }

  // On initial load the panels' records may not be ready yet — retry the reindex
  // a few times (backing off) until cards attach or there's nothing to attach.
  _rehydrate(attempt) {
    if (this._unloaded) return;
    this._onNavigated().then(() => {
      if (this._unloaded) return;
      if (this._cards.size === 0 && attempt < 6 && document.querySelector(".listitem-transclusion")) {
        // Tracked so onUnload can cancel it — a late untracked retry used to
        // resurrect the dead instance (clobbering window.__refxCardObs and deleting
        // a NEW instance's cards).
        this._rehydrateT = setTimeout(() => this._rehydrate(attempt + 1), 350 + attempt * 350);
      }
    }).catch(() => {});
  }

  // Place Thymer's (model-based, not DOM-selection) caret by hit-testing a click on
  // a line's text span, exactly as a real click there would. Returns true if fired.
  _hitTestCaret(t) {
    if (!t) return false;
    try { t.scrollIntoView({ block: "nearest" }); } catch (e) {}
    try {
      const r = t.getBoundingClientRect();
      if (!(r.width || r.height)) return false;
      const x = Math.round(r.left + Math.min(6, r.width || 6)), y = Math.round(r.top + r.height / 2);
      const down = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 };
      const up = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 0 };
      try { t.dispatchEvent(new PointerEvent("pointerdown", down)); } catch (e) {}
      t.dispatchEvent(new MouseEvent("mousedown", down));
      try { t.dispatchEvent(new PointerEvent("pointerup", up)); } catch (e) {}
      t.dispatchEvent(new MouseEvent("mouseup", up));
      t.dispatchEvent(new MouseEvent("click", up));
      return true;
    } catch (e) { return false; }
  }

  // Give an empty record a first body line to type into, then focus it. The
  // transclusion mirrors the target's body, so the new line renders in the embed.
  async _addBodyLine(lineGuid) {
    const entry = this._cards.get(lineGuid);
    if (!entry) return;
    const rec = this.data.getRecord(entry.recordGuid);
    if (!rec) return;
    let line = null;
    try { line = await rec.createLineItem(null, null, "text"); } catch (e) {}
    if (!line) return;
    this._focusEmbeddedLine(lineGuid, line.guid, 0);
  }

  // A record embed with an empty (or sparse) body gives Thymer nothing to hit:
  // a click in the box's dead space fell through and the caret landed on the
  // line AFTER the embed, outside the box. Don't fight the native mousedown —
  // let it land, then on the click (after native is done) re-place the caret
  // where the user aimed: the last body line, or a freshly created first line
  // when the body is empty. Wired once per embed NODE (flagged on the element,
  // so a native re-render that replaces the node gets re-wired on re-attach).
  _wireEmbedBodyClick(node, lineGuid) {
    if (!node || node.__refxBodyClick) return;
    node.__refxBodyClick = true;
    // CAPTURE-phase interception of the whole pointer sequence: the earlier
    // correct-after-the-fact approach let Thymer place the caret on the line
    // AFTER the embed first, then moved it — a visible caret dance. Now dead-
    // space presses never reach Thymer; we place the caret ourselves at once.
    // Our own synthetic hit-test events pass straight through (their target is
    // a real .listitem line, filtered out below).
    const deadSpace = (e) => {
      if (e.button !== 0 || this._unloaded) return false;
      if (!this._cards.has(lineGuid) && !this._queryEmbeds.has(lineGuid) && !this._lineEmbeds.has(lineGuid)) return false;
      const t = e.target;
      if (!(t instanceof Element)) return false;
      if (this._pageEmbeds.has(lineGuid) || t.closest(".panel.refx-pemb")) return false; // the real page panel takes its own clicks
      const li = t.closest(".listitem");
      if (li && li !== node) return false; // a real body line — native caret placement works
      if (t !== node && !t.closest(".transclusion-container-div")) return false; // outside the body box
      return true;
    };
    const act = () => {
      if (this._unloaded) return;
      // LINE transclusion (live-search embeds): dead space below the line adds
      // a NEW INDENTED CHILD under the target line and focuses it — that's the
      // whole point of opening the row (write more under it). Record embeds
      // keep the old behaviour (focus last body line / create the first one).
      const st = ((window.g_universe && window.g_universe.itemsByGuid) || {})[lineGuid];
      const target = st && st.props && st.props.itemref;
      if (target && !this.data.getRecord(target)) { this._addChildToLineEmbed(lineGuid, target); return; }
      const n2 = this._transclusionNode(lineGuid);
      const lines = n2 ? n2.querySelectorAll(".transclusion-container-div .lineitem-text") : [];
      if (lines.length) this._hitTestCaret(lines[lines.length - 1]);
      else this._addBodyLine(lineGuid);
    };
    for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
      node.addEventListener(type, (e) => {
        if (!deadSpace(e)) return;
        e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
        if (type === "pointerdown") act(); // once per press; the rest are just muted
      }, true);
    }
  }

  // Append a new indented child under a LINE transclusion's target line and
  // focus it inside the embed (the transclusion renders the target's children).
  async _addChildToLineEmbed(embedGuid, targetGuid) {
    try {
      const st = ((window.g_universe && window.g_universe.itemsByGuid) || {})[targetGuid];
      const rg = st && st.rguid;
      const rec = rg && this.data.getRecord(rg);
      if (!rec) return;
      const items = await rec.getLineItems();
      const target = this._findLineDeep(items, targetGuid);
      if (!target) return;
      const kids = target.children || [];
      const line = await rec.createLineItem(target, kids.length ? kids[kids.length - 1] : null, "text");
      if (line) this._focusEmbeddedLine(embedGuid, line.guid, 0);
    } catch (e) {}
  }

  _focusEmbeddedLine(embedGuid, targetLineGuid, attempt) {
    attempt = attempt || 0;
    const node = this._transclusionNode(embedGuid);
    let line = null;
    if (node && node.querySelector) {
      const esc = (window.CSS && CSS.escape) ? CSS.escape(targetLineGuid) : targetLineGuid;
      line = node.querySelector('.listitem[data-guid="' + esc + '"]') || node.querySelector('[data-guid="' + esc + '"]');
    }
    if (line) {
      const t = (line.querySelector && line.querySelector(".lineitem-text")) || line;
      if (this._hitTestCaret(t)) return;
    }
    if (attempt < 14) setTimeout(() => this._focusEmbeddedLine(embedGuid, targetLineGuid, attempt + 1), 90);
  }

  // The single entry every caller uses (expand, discovery, rehydrate, a refused collapse) to
  // give a page embed its page panel. On the phone there is none: Thymer's own transclusion
  // shows the body, and that is the whole of it there.
  _attachPropCard(lineGuid, recordGuid) {
    if (!this._cards.has(lineGuid) || !this._peOn()) return;
    this._peAttach(lineGuid, recordGuid);
  }

  // The embed's rendered node. Primary = DOM query on the line's data-guid (the
  // embed line is `.listitem.listitem-transclusion[data-guid=<lineGuid>]`,
  // confirmed live; works in any execution context). Fallback = the registry's
  // $node (only reachable from the plugin's own runtime world).
  _transclusionNode(lineGuid) {
    try {
      const esc = (window.CSS && CSS.escape) ? CSS.escape(lineGuid) : lineGuid;
      const n = document.querySelector('.listitem-transclusion[data-guid="' + esc + '"], .listitem[data-guid="' + esc + '"], [data-guid="' + esc + '"]');
      if (n) return (n.closest && (n.closest(".listitem-transclusion") || n.closest(".listitem"))) || n;
    } catch (e) {}
    try {
      const lvs = (window.g_universe && window.g_universe.listviews) || [];
      for (const lv of lvs) {
        let items; try { items = lv.getItems(); } catch (e) { continue; }
        for (const it of items || []) { try { if (it && it.state && it.state.guid === lineGuid && it.$node) return it.$node; } catch (e) {} }
      }
    } catch (e) {}
    return null;
  }

  _removeCardEl(lineGuid) { this._peClose(lineGuid); }

  _ensureCardObserver() {
    if (this._cardObs || this._unloaded) return;
    // Observe the whole document, not a single panel: an embed's card can live in
    // any panel and the active/focused panel isn't necessarily the one holding it
    // (e.g. after a reload with a search panel focused). Cheap-first guards below
    // keep this idle-free whenever no embeds are open.
    const target = document.body;
    const obs = new MutationObserver(() => {
      if (!this._cards.size && !this._queryEmbeds.size && !this._lineEmbeds.size) return;
      // MutationObserver callbacks are microtasks: they run BEFORE the browser paints, so whatever
      // is put back here never shows a frame without it.
      // PAGE PANELS: Thymer rebuilds a transclusion row on every change to it and drops the
      // borrowed panel (it stays alive, detached), and it RECYCLES row elements for other lines
      // (a panel was found inside an element that now carried the next row's guid). Put each one
      // back into the row that is really its own, before the paint.
      if (this._pageEmbeds.size) {
        let moved = false;
        for (const [g, pe] of this._pageEmbeds) {
          if (!pe.ready || !pe.slot) continue;
          const par = pe.slot.parentNode;
          if (pe.slot.isConnected && par && par.getAttribute && par.getAttribute("data-guid") === g && par.classList.contains("refx-pemb-host")) continue;
          this._pePlace(g); moved = true;
        }
        if (moved) this._peSweepHosts();
      }
      // Query-spawned embeds: keep each node parked under its result row. The
      // row node is REPLACED on every query re-render, and a host re-render can
      // put the embed back at its model position below the block. O(1) checks
      // per entry; the actual (listview-scanning) re-park runs rAF-debounced.
      let needPlace = false;
      for (const qe of this._queryEmbeds.values()) {
        if (qe.parked) continue; // row gone — resting at model position
        if (qe.node && qe.node.isConnected && qe.row && qe.row.isConnected && qe.node.previousElementSibling === qe.row) continue;
        needPlace = true; break;
      }
      if (needPlace && !this._queryRaf) this._queryRaf = requestAnimationFrame(() => {
        this._queryRaf = 0;
        for (const [g, qe] of this._queryEmbeds) if (!qe.parked) this._placeQueryEmbed(g, qe.resultRealGuid, 0);
      });
      // Standalone line-ref embeds: keep the marker class + dead-space wiring on
      // each node. Thymer REPLACES the transclusion node on re-render, dropping
      // both, so a lost class/flag means re-mark. O(1) isConnected/flag checks per
      // entry; the actual re-mark runs rAF-debounced.
      let needMark = false;
      for (const le of this._lineEmbeds.values()) {
        if (le.node && le.node.isConnected && le.node.__refxBodyClick && le.node.classList.contains("refx-lineembed")) continue;
        needMark = true; break;
      }
      if (needMark && !this._lineRaf) this._lineRaf = requestAnimationFrame(() => {
        this._lineRaf = 0;
        for (const g of this._lineEmbeds.keys()) this._markLineEmbed(g, 0);
      });
    });
    try { obs.observe(target, { childList: true, subtree: true }); } catch (e) {}
    this._cardObs = obs; this._cardObsTarget = target;
    window.__refxCardObs = obs;
  }

  _teardownCardObserver() {
    if (this._queryRaf) { try { cancelAnimationFrame(this._queryRaf); } catch (e) {} this._queryRaf = 0; }
    if (this._lineRaf) { try { cancelAnimationFrame(this._lineRaf); } catch (e) {} this._lineRaf = 0; }
    if (this._cardObs) { try { this._cardObs.disconnect(); } catch (e) {} }
    this._cardObs = null; this._cardObsTarget = null;
    if (window.__refxCardObs) { try { window.__refxCardObs.disconnect(); } catch (e) {} window.__refxCardObs = null; }
  }

  // Disconnect observers + window listeners + remove orphan DOM left by a previous
  // instance (Thymer hot-reloads by re-running onLoad on the same document WITHOUT
  // disposing the prior instance — anything not window-stashed leaks).
  _killStaleObservers() {
    try { if (window.__refxCardObs && window.__refxCardObs.disconnect) window.__refxCardObs.disconnect(); } catch (e) {}
    window.__refxCardObs = null;
    try { if (window.__refxThemeObs && window.__refxThemeObs.disconnect) window.__refxThemeObs.disconnect(); } catch (e) {}
    window.__refxThemeObs = null;
    try { if (window.__refxDescObs && window.__refxDescObs.disconnect) window.__refxDescObs.disconnect(); } catch (e) {}
    window.__refxDescObs = null;
    // The prior instance's ALWAYS-ON capture listeners (its arrow-field refs are
    // unreachable — only the window stash can remove them).
    try { for (const h of window.__refxKeyHandlers || []) window.removeEventListener("keydown", h, true); } catch (e) {}
    try { for (const t of ["pointerdown", "mousedown", "mouseup", "click", "dblclick"]) { if (window.__refxDescDbl) window.removeEventListener(t, window.__refxDescDbl, true); } } catch (e) {}
    window.__refxDescDbl = null;
    window.__refxKeyHandlers = null;
    // Session listeners a prior instance may have left mid-interaction.
    try { if (window.__refxCardNavKey) window.removeEventListener("keydown", window.__refxCardNavKey, true); } catch (e) {}
    try { if (window.__refxCardNavClick) window.removeEventListener("mousedown", window.__refxCardNavClick, true); } catch (e) {}
    window.__refxCardNavKey = null; window.__refxCardNavClick = null;
    try { if (window.__refxPopupKey) window.removeEventListener("keydown", window.__refxPopupKey, true); } catch (e) {}
    window.__refxPopupKey = null;
    try { if (window.__refxLinkKey) window.removeEventListener("keydown", window.__refxLinkKey, true); } catch (e) {}
    try { if (window.__refxLinkClick) document.removeEventListener("mousedown", window.__refxLinkClick, true); } catch (e) {}
    window.__refxLinkKey = null; window.__refxLinkClick = null;
    // Orphan a prior instance's hover preview / picker DOM (transient, not stashed).
    try { document.querySelectorAll(".refalias-linepreview").forEach((n) => n.remove()); } catch (e) {}
    try { if (window.__refxShortcutCap) window.removeEventListener("keydown", window.__refxShortcutCap, true); } catch (e) {}
    window.__refxShortcutCap = null;
    try { if (window.__refxDiscoverTrigger) { document.removeEventListener("visibilitychange", window.__refxDiscoverTrigger, false); window.removeEventListener("focus", window.__refxDiscoverTrigger, false); } } catch (e) {}
    window.__refxDiscoverTrigger = null;
    try { document.querySelectorAll(".refx-nav-focus").forEach((el) => el.classList.remove("refx-nav-focus")); } catch (e) {}
    // Orphan popup/backdrop DOM from a prior instance's open interaction. The card-era classes
    // (.refx-propcard, .refx-cardpop, .refx-pop-backdrop, .refx-nav-focus and the
    // __refxThemeObs / __refxCardNav* / __refxPopupKey stashes above) belong to builds before
    // 2026-11-02 that may still be the instance a reload replaces: keep sweeping them for a while.
    try { document.querySelectorAll(".refx-propcard, .refx-cardpop, .refx-pop-backdrop, .refalias-pop, .refalias-backdrop, .refalias-catch").forEach((n) => n.remove()); } catch (e) {}
  }

  // Native-style display for a machine date value "YYYY-MM-DD[ HH:MM]" →
  // "Sun Jul 12" (+ year when not the current year) (+ " 17:00"). Used as the
  // fallback whenever a date segment has no stored `formatted` (see _dateSegmentText).
  _fmtDateDisplay(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}:\d{2}))?$/.exec(String(v == null ? "" : v));
    if (!m) return null;
    const dt = new Date(+m[1], +m[2] - 1, +m[3]);
    if (isNaN(dt.getTime())) return null;
    const DOWS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    let s = DOWS[dt.getDay()] + " " + MONTHS[dt.getMonth()] + " " + dt.getDate();
    if (+m[1] !== new Date().getFullYear()) s += " " + m[1];
    if (m[4]) s += " " + m[4];
    return s;
  }

  // Synthesize the NATIVE pill label for a granular/ranged DateTimeValue when the
  // parser didn't provide `formatted` (only the native picker widget computes it at
  // store time). Stored shape (captured live): {d:"YYYYMMDD", r:{d:"YYYYMMDD"},
  // formatted:"Week 28" | "Q3 2026" | "July 2025" | "Year 2027"}. The label is what
  // the property pane renders, so committing without one would show a blank pill.
  _synthDateLabel(startYmd, endYmd, time) {
    const MF = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const parse = (s) => (/^\d{8}$/.test(s || "") ? { y: +s.slice(0, 4), m: +s.slice(4, 6) - 1, d: +s.slice(6, 8) } : null);
    const a = parse(startYmd);
    if (!a) return null;
    const dayLabel = (p) => this._fmtDateDisplay(p.y + "-" + String(p.m + 1).padStart(2, "0") + "-" + String(p.d).padStart(2, "0"));
    const b = parse(endYmd);
    if (!b) return dayLabel(a) + (time ? " " + time : "");
    const thisYear = new Date().getFullYear();
    const lastDom = (y, m) => new Date(y, m + 1, 0).getDate();
    if (a.y === b.y && a.m === 0 && a.d === 1 && b.m === 11 && b.d === 31) return "Year " + a.y;
    if (a.y === b.y && a.d === 1 && a.m % 3 === 0 && b.m === a.m + 2 && b.d === lastDom(b.y, b.m)) return "Q" + (a.m / 3 + 1) + " " + a.y;
    if (a.y === b.y && a.m === b.m && a.d === 1 && b.d === lastDom(b.y, b.m)) return MF[a.m] + " " + a.y;
    const da = new Date(a.y, a.m, a.d), db = new Date(b.y, b.m, b.d);
    if (Math.round((db - da) / 86400000) === 6) {
      // 7-day span → week number, native scheme: week 1 = the week containing Jan 1
      // (weeks start Sunday); verified against a live sample (Jul 5 2026 → Week 28).
      // ROUND the day count before dividing by 7 — a DST transition inside the span
      // shorts the raw ms difference by an hour, and floor() then drops a whole week.
      const jan1 = new Date(da.getFullYear(), 0, 1);
      const firstSunday = new Date(jan1.getFullYear(), 0, 1 - jan1.getDay());
      const days = Math.round((da - firstSunday) / 86400000);
      const wk = Math.floor(days / 7) + 1;
      return "Week " + wk + (da.getFullYear() !== thisYear ? " " + da.getFullYear() : "");
    }
    return dayLabel(a) + " – " + dayLabel(b);
  }

  // The popup's <input> takes DOM focus; when it closes, activeElement falls back
  // to <body> and Thymer's editor stops receiving keys (the ↓-into-card nav and
  // plain typing both die until you click). Thymer captures keys through a virtual
  // textarea — focusing it re-engages the editor at the current caret.
  _refocusEditor() {
    setTimeout(() => {
      // preventScroll is ESSENTIAL: the virtual input sits at the CARET's position,
      // which can be anywhere on the page — a plain focus() scrolls it into view
      // and "jumps" the page (the view-change jump bug).
      try { const vi = window.g_virtual_input; if (vi && vi.$textarea && vi.$textarea.focus) { vi.$textarea.focus({ preventScroll: true }); return; } } catch (e) {}
      try { const ta = document.getElementById("virtualinput"); if (ta && ta.focus) ta.focus({ preventScroll: true }); } catch (e) {}
    }, 0);
  }

  // ------------------------------------------------- inline [[ text references

  // The caret's line + grapheme offset, read from the global listview registry.
  _caretInfo() {
    const lvs = (window.g_universe && window.g_universe.listviews) || [];
    let best = null;
    for (const lv of lvs) {
      try {
        const caret = lv.selection && lv.selection._caret;
        const pos = caret && caret.pos;
        if (!pos || !pos.list_item || !pos.list_item.state) continue;
        const cand = { pos, caret, focused: !!(lv.hasFocus && lv.hasFocus()) };
        if (cand.focused) { best = cand; break; }
        if (!best) best = cand;
      } catch (e) {}
    }
    if (!best) return null;
    const st = best.pos.list_item.state;
    return {
      lineGuid: st.guid,
      pageGuid: st.rguid,
      offset: best.pos.grapheme_offset,
      state: st,
      caretEl: best.caret && best.caret.$caret,
      anchorNode: best.pos.linespan ? best.pos.linespan.$node : null,
    };
  }

  // Plain text of a line's segments; non-text segments count as one grapheme so
  // offsets line up with how Thymer counts the caret position.
  _lineText(segments) {
    return (segments || []).map((s) => (typeof s.text === "string" ? s.text : " ")).join("");
  }

  // Reconstruct clean {type, text} segments from the LIVE internal model
  // (state.text_segments is pair-encoded: [typeStr, data, typeStr, data, ...]).
  // This reflects what's being typed right now; getLineItems() can lag behind.
  _segmentsFromState(state) {
    const ts = (state && state.text_segments) || [];
    const segs = [];
    for (let i = 0; i + 1 < ts.length; i += 2) segs.push({ type: String(ts[i]), text: ts[i + 1] });
    return segs;
  }

  // Find a line's live internal state by guid, across all listviews.
  _liveStateByGuid(guid) {
    const lvs = (window.g_universe && window.g_universe.listviews) || [];
    for (const lv of lvs) {
      let items;
      try { items = lv.getItems(); } catch (e) { continue; }
      for (const it of items || []) { try { if (it.state && it.state.guid === guid) return it.state; } catch (e) {} }
    }
    return null;
  }

  // Two consecutive "[" keystrokes opened the picker. We detect via keystrokes,
  // not by reading the line — the editor model can be stale right after typing
  // (it reads back empty), which previously made re-triggering unreliable.
  _triggerLink() {
    if (this._modal || this._link) return;
    const info = this._caretInfo();
    if (!info || !info.lineGuid || typeof info.offset !== "number" || info.offset < 2) return;
    this._enterLinkMode(info);
  }

  // Inline [[ link mode. The editor KEEPS focus (no focus steal — that was the
  // cause of the stuck caret); the text you type after [[ is the query, shown
  // inline like Thymer's own @ menu. Navigation keys are handled in _linkKey.
  _enterLinkMode(info) {
    this._closeModal();
    this._exitLinkMode();
    const pop = this._el("div", "refalias-pop refalias-linkpop");
    const list = this._el("div", "refalias-results");
    pop.append(list);
    document.body.append(pop);
    this._link = {
      lineGuid: info.lineGuid,
      pageGuid: info.pageGuid,
      bracketStart: info.offset - 2,
      query: "",
      pop, list, results: [], sel: 0, token: 0,
    };
    // Anchor under the triggered LINE, left-aligned to its editor column. (The
    // caret sits at the end of "[[query", far to the right, so anchoring there
    // pushed a wide box across a split-view divider and over the other panel.)
    const lineNode = (info.anchorNode && info.anchorNode.closest && info.anchorNode.closest(".listitem"))
      || (info.caretEl && info.caretEl.closest && info.caretEl.closest(".listitem"))
      || null;
    this._positionPopover(pop, [lineNode, info.caretEl, info.anchorNode]);
    window.addEventListener("keydown", this._linkKey, true);
    document.addEventListener("mousedown", this._linkClickOutside, true);
    window.__refxLinkKey = this._linkKey; window.__refxLinkClick = this._linkClickOutside; // hot-reload stash
    this._renderLink();
    this._runLinkSearch("");
  }

  _exitLinkMode() {
    if (!this._link) return;
    this._hideLinePreview();
    if (this._link.searchTimer) { try { clearTimeout(this._link.searchTimer); } catch (e) {} }
    window.removeEventListener("keydown", this._linkKey, true);
    document.removeEventListener("mousedown", this._linkClickOutside, true);
    window.__refxLinkKey = null; window.__refxLinkClick = null;
    try { this._link.pop.remove(); } catch (e) {}
    this._link = null;
  }

  // Debounce searches: query only when typing pauses. Calling searchByQuery on
  // every keystroke makes Thymer's search return flaky/empty results.
  _scheduleLinkSearch() {
    const link = this._link;
    if (!link) return;
    if (link.searchTimer) clearTimeout(link.searchTimer);
    link.searchTimer = setTimeout(() => { link.searchTimer = null; if (this._link === link) this._runLinkSearch(link.query); }, 130);
  }

  // Cancel: remove the "[[query" you typed so the line is clean (and re-typing
  // [[ works straight away). Guarded so a stale/empty read can't wipe the line.
  async _abortLink() {
    const link = this._link;
    if (!link) return;
    const lineGuid = link.lineGuid, pageGuid = link.pageGuid, query = link.query;
    this._exitLinkMode();
    const rec = await this._pageRecord(pageGuid);
    if (!rec) return;
    const items = await rec.getLineItems();
    const li = this._findLineDeep(items, lineGuid);
    if (!li) return;
    const liveState = this._liveStateByGuid(lineGuid);
    const source = liveState ? this._segmentsFromState(liveState) : null;
    if (!source || !source.length) return; // don't risk wiping on a stale read
    // Only remove the exact "[[query" we know we typed (leave it otherwise).
    const graphemes = [...this._lineText(source)];
    const seq = [..."[[" + query];
    let start = -1;
    for (let i = graphemes.length - seq.length; i >= 0; i--) {
      let ok = true;
      for (let j = 0; j < seq.length; j++) { if (graphemes[i + j] !== seq[j]) { ok = false; break; } }
      if (ok) { start = i; break; }
    }
    if (start < 0) return;
    li.setSegments(this._replaceRange(source, start, start + seq.length, null));
  }

  async _runLinkSearch(query) {
    const link = this._link;
    if (!link) return;
    const q = (query || "").trim();
    const my = ++link.token;
    if (!q) { link.results = []; link.sel = 0; this._renderLink(); return; }
    const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
    // "+" means AND: each part must appear somewhere in the line (any order).
    const parts = q.split("+").map((p) => norm(p)).filter(Boolean);
    if (!parts.length) { link.results = []; link.sel = 0; this._renderLink(); return; }
    // Search terms: each part as a phrase plus its most distinctive word; union
    // the candidates (Thymer's results vary per query), then keep only lines that
    // contain every part.
    const terms = new Set();
    for (const p of parts) {
      terms.add(p);
      const w = p.split(/\s+/).filter((x) => x.length >= 2).sort((a, b) => b.length - a.length)[0];
      if (w) terms.add(w);
    }
    const seen = new Set();
    const out = [];
    const curLine = link.lineGuid;
    // Session-scoped normalized-text cache: the registry scan below runs on every
    // keystroke pause; recomputing _segmentsFromState + _displayText + toLowerCase
    // for every loaded line each time was the hot path. A [[ session lasts seconds,
    // so staleness is a non-issue.
    if (!link.textCache) link.textCache = new Map();
    const consider = (guid, segments, pageFn, cacheable) => {
      if (!guid || guid === curLine || seen.has(guid)) return; // never the line you're on
      seen.add(guid);
      let text, lt;
      const hit = cacheable ? link.textCache.get(guid) : null;
      if (hit) { text = hit.text; lt = hit.lt; }
      else {
        text = this._displayText(segments).trim();
        lt = norm(text);
        if (cacheable) link.textCache.set(guid, { text, lt });
      }
      if (!text) return;
      if (!parts.every((p) => lt.includes(p))) return; // every "+" part must appear
      let page = "";
      try { page = pageFn() || ""; } catch (e) {}
      out.push({ guid, text, page });
    };
    const scanRegistry = () => {
      // 1) Scan the loaded lines directly. This gives reliable substring AND
      //    matching and, crucially, sees lines you JUST typed — Thymer's search
      //    index lags behind, so searchByQuery often misses fresh content (the
      //    main "+ doesn't work" cause). Limited to loaded lines; the search
      //    phase covers the rest of the workspace.
      const byGuid = (window.g_universe && window.g_universe.itemsByGuid) || {};
      for (const guid in byGuid) {
        const it = byGuid[guid];
        if (!it || it.is_deleted || it.is_trashed || it.type === "document") continue;
        if (!it.text_segments || !it.text_segments.length) continue;
        consider(it.guid || guid, this._segmentsFromState(it), () => {
          const r = it.rguid && this.data.getRecord(it.rguid);
          return r && r.getName && r.getName();
        }, true);
        if (out.length >= 40) break;
      }
    };
    const searchPhase = async () => {
      // 2) Workspace-wide search for anything not currently loaded.
      for (const sq of terms) {
        let res;
        try { res = await this.data.searchByQuery(sq, 60); } catch (e) { res = { lines: [] }; }
        if (this._link !== link || my !== link.token) return false;
        for (const li of res.lines || []) {
          consider(li.guid, li.segments, () => {
            const r = li.getRecord && li.getRecord();
            return r && r.getName && r.getName();
          }, false);
        }
      }
      return true;
    };
    seen.clear(); out.length = 0;
    scanRegistry();
    if (!(await searchPhase())) return;
    let results = out;
    if (results.length === 0) {
      // The retry exists for the FLAKY SEARCH INDEX — the local registry cannot
      // have new matches 170ms later while typing is suspended, so re-run only
      // the search phase (the registry re-scan was the wasted double cost).
      await new Promise((r) => setTimeout(r, 170));
      if (this._link !== link || my !== link.token) return;
      if (!(await searchPhase())) return;
      results = out;
    }
    if (!results || this._link !== link || my !== link.token) return;
    link.results = results.slice(0, 8);
    link.sel = 0;
    this._renderLink();
  }

  _renderLink() {
    const link = this._link;
    if (!link) return;
    const list = link.list;
    this._hideLinePreview(); // a re-render replaces the rows the preview anchored to
    list.innerHTML = "";
    if (!link.results.length) {
      list.append(this._el("div", "refalias-result-empty", "Type after [[ to search…"));
      return;
    }
    link.results.forEach((r, i) => {
      const row = this._el("div", "refalias-result" + (i === link.sel ? " refalias-result-sel" : ""));
      const txt = this._el("span", "refalias-result-text");
      txt.innerHTML = this._snippetHTML(r.text, link.query);
      row.append(txt);
      if (r.page) row.append(this._el("span", "refalias-result-page", r.page));
      row.addEventListener("mousedown", (e) => { e.preventDefault(); this._pickLink(r); });
      row.addEventListener("mousemove", () => { if (link.sel !== i) { link.sel = i; this._renderLink(); } });
      // Hover shows a floating preview of the FULL line text beside the picker
      // (rows only show a windowed snippet — the preview is the whole line /
      // paragraph, matches bolded). Ported from Quick Capture.
      row.addEventListener("mouseenter", () => this._showLinePreview(row, r, link.query));
      list.append(row);
    });
    // Leaving the list entirely hides the preview (moving between rows re-shows it).
    if (!list.__refxHoverWired) { list.__refxHoverWired = true; list.addEventListener("mouseleave", () => this._hideLinePreview()); list.addEventListener("scroll", () => this._hideLinePreview()); }
  }

  // Floating preview of a result line's FULL text on hover, placed BELOW the
  // hovered row, left-aligned with it. ALWAYS below (never flipped above like
  // QC does): the [[ picker opens under the caret line, so a preview above a row
  // would cover the text you're typing — below keeps it clear.
  _showLinePreview(rowEl, r, query) {
    this._hideLinePreview();
    if (!r || !r.text || !this._link) return;
    const box = this._el("div", "refalias-linepreview");
    const t = this._el("div", "refalias-lp-text");
    t.innerHTML = this._highlightAll(r.text, query);
    box.append(t);
    if (r.page) box.append(this._el("div", "refalias-lp-ctx", r.page));
    document.body.append(box);
    this._linePreviewEl = box;
    try {
      const rect = rowEl.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const belowSpace = vh - rect.bottom - 12;
      // cap height to the space BELOW the row so it fits without needing to flip
      // above (which would overlap the editor line being typed)
      box.style.maxHeight = Math.max(80, Math.min(belowSpace, Math.round(vh * 0.6))) + "px";
      const bw = box.offsetWidth, bh = box.offsetHeight;
      const left = Math.max(8, Math.min(rect.left, vw - bw - 8));
      let top = rect.bottom + 4;
      top = Math.max(8, Math.min(top, vh - bh - 8));
      box.style.left = Math.round(left) + "px";
      box.style.top = Math.round(top) + "px";
    } catch (e) {}
  }

  _hideLinePreview() {
    if (this._linePreviewEl) { try { this._linePreviewEl.remove(); } catch (e) {} this._linePreviewEl = null; }
  }

  // Bold every query match across the FULL text (no windowing) — the preview's
  // highlight, matching the row snippet's bolding.
  _highlightAll(text, query) {
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const full = (text || "").trim();
    const q = (query || "").trim();
    if (!q) return esc(full);
    const words = [...new Set([q].concat(q.split(/\s+/)).filter((w) => w.length >= 2))].sort((a, b) => b.length - a.length);
    if (!words.length) return esc(full);
    const re = new RegExp("(" + words.map(escRe).join("|") + ")", "ig");
    let html = "", last = 0, m;
    while ((m = re.exec(full)) !== null) { html += esc(full.slice(last, m.index)) + "<b>" + esc(m[0]) + "</b>"; last = m.index + m[0].length; if (m.index === re.lastIndex) re.lastIndex++; }
    html += esc(full.slice(last));
    return html;
  }

  // A short, single-line snippet centred on the matched query (with the match
  // bolded), so long passages show the relevant part instead of the line start.
  _snippetHTML(text, query) {
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const full = (text || "").replace(/\s+/g, " ").trim();
    const q = (query || "").trim();
    const tail = (s, n) => s.slice(0, n) + (s.length > n ? "…" : "");
    if (!q) return esc(tail(full, 130));
    // Match the whole query and each word (Thymer search is per-word/stemmed),
    // longest first so phrases win over their fragments.
    const words = [...new Set([q].concat(q.split(/\s+/)).filter((w) => w.length >= 2))].sort((a, b) => b.length - a.length);
    const lower = full.toLowerCase();
    // Centre on the full phrase if it's present; only fall back to the earliest
    // single word when the phrase isn't there verbatim.
    let first = lower.indexOf(q.toLowerCase());
    if (first < 0) {
      for (const w of words) { const i = lower.indexOf(w.toLowerCase()); if (i >= 0 && (first < 0 || i < first)) first = i; }
    }
    if (first < 0) return esc(tail(full, 130));
    // Window centred on the first match.
    const start = Math.max(0, first - 45);
    const end = Math.min(full.length, first + 90);
    const win = full.slice(start, end);
    // Highlight every query word within the window.
    const re = new RegExp("(" + words.map(escRe).join("|") + ")", "ig");
    let html = "", last = 0, m;
    while ((m = re.exec(win)) !== null) {
      html += esc(win.slice(last, m.index)) + "<b>" + esc(m[0]) + "</b>";
      last = m.index + m[0].length;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    html += esc(win.slice(last));
    return (start > 0 ? "…" : "") + html + (end < full.length ? "…" : "");
  }

  // Replace "[[query" with an inline reference to the picked line.
  async _pickLink(result) {
    const link = this._link;
    if (!link) return;
    const lineGuid = link.lineGuid, pageGuid = link.pageGuid, query = link.query;
    this._exitLinkMode();
    const rec = await this._pageRecord(pageGuid);
    if (!rec) return;
    const items = await rec.getLineItems();
    const li = this._findLineDeep(items, lineGuid);
    if (!li) return;
    const ref = { type: "ref", text: { guid: result.guid, title: result.text } };
    // WRITE + VERIFY + RETRY. A single write raced the editor's own flush of
    // freshly typed text: our splice (derived from a possibly stale read) went
    // through, the toast fired, and then the editor's state clobbered the line
    // back — "said it referenced but nothing is there". So: attempt against the
    // freshest segs, poll the live model for the ref, and re-apply if it isn't
    // (or no longer is) there. Toast only reports the VERIFIED outcome.
    let done = false;
    for (let attempt = 0; attempt < 4 && !done; attempt++) {
      const liveState = this._liveStateByGuid(lineGuid);
      const segs = liveState ? this._segmentsFromState(liveState) : (li.segments || []).map((s) => ({ type: s.type, text: s.text }));
      const hasRef = segs.some((s) => s.type === "ref" && s.text && s.text.guid === result.guid);
      if (!hasRef) {
        const range = this._findBracketRange(segs, query);
        if (!range) { if (attempt === 0) return; break; } // "[[query" gone — nothing to safely replace
        li.setSegments(this._replaceRange(segs, range.start, range.end, ref));
      }
      // settle, then confirm it SURVIVED (not just that our write landed)
      await new Promise((r) => setTimeout(r, 220));
      const after = this._liveSegs(lineGuid) || [];
      done = after.some((s) => s.type === "ref" && s.text && s.text.guid === result.guid);
    }
    if (done) this._toast('Referenced "' + String(result.text).slice(0, 40) + '"');
    else this._toast("Couldn't insert the reference — try [[ again.");
  }

  // Locate the "[[query" the user is typing in the live line by searching the
  // reconstructed text (references count as one grapheme, same as _replaceRange),
  // so the splice lands correctly even with a preceding reference on the line.
  _findBracketRange(segments, query) {
    const graphemes = [...this._lineText(segments)];
    const find = (seq) => {
      for (let i = graphemes.length - seq.length; i >= 0; i--) {
        let ok = true;
        for (let j = 0; j < seq.length; j++) { if (graphemes[i + j] !== seq[j]) { ok = false; break; } }
        if (ok) return i;
      }
      return -1;
    };
    const q = [...query];
    let start = find(["[", "["].concat(q));
    if (start >= 0) return { start, end: start + 2 + q.length };
    start = find(["[", "["]);
    if (start >= 0) return { start, end: start + 2 };
    return null;
  }

  // Readable text of a line, rendering references by their alias/target name and
  // dates by their native-looking label, so result rows and alias fallbacks
  // aren't full of blanks where references and dates are.
  _displayText(segments) {
    return (segments || [])
      .map((s) => {
        if (typeof s.text === "string") return s.text;
        const t = s.text || {};
        if (s.type === "ref") {
          if (t.title) return t.title;
          try { const r = t.guid && this.data.getRecord(t.guid); if (r && r.getName) return r.getName(); } catch (e) {}
          return "↗";
        }
        if (s.type === "datetime") return this._dateSegmentText(t);
        return t.title || t.text || t.name || "";
      })
      .join("");
  }

  // Render a datetime SEGMENT's value the way native does ("Thu Jul 16", a time,
  // or a granular label). The segment stores a compact shape (verified live):
  // {d:"YYYYMMDD"} for a date, {d:"", t:{t:"HHMMSS"|"HHMM"}} for a journal time,
  // optionally r:{d} for a range and formatted for granular labels. No `formatted`
  // on plain dates — Thymer computes the label at render, so we do too, reusing
  // the card's own formatters. Previously these rendered blank, dropping the date
  // from search snippets and the alias fallback.
  _dateSegmentText(t) {
    if (!t || typeof t !== "object") return "";
    if (t.formatted) return t.formatted;
    const timeStr = t.t && t.t.t != null ? String(t.t.t) : null; // "HHMMSS" or "HHMM"
    const hhmm = timeStr && timeStr.length >= 4 ? timeStr.slice(0, 2) + ":" + timeStr.slice(2, 4) : null;
    const ymd = /^\d{8}$/.test(t.d || "") ? t.d.slice(0, 4) + "-" + t.d.slice(4, 6) + "-" + t.d.slice(6, 8) : null;
    if (ymd) {
      if (t.r && t.r.d) { const lbl = this._synthDateLabel(t.d, t.r.d, hhmm); if (lbl) return lbl; }
      return this._fmtDateDisplay(hhmm ? ymd + " " + hhmm : ymd) || ymd;
    }
    return hhmm || "";
  }

  // Remove graphemes [start,end) across segments and insert `ref` at `start`.
  // If `ref` is null, the range is just deleted.
  _replaceRange(segments, start, end, ref) {
    const out = [];
    let acc = 0, inserted = false;
    for (const seg of segments) {
      const isText = typeof seg.text === "string";
      const len = isText ? [...seg.text].length : 1;
      const segStart = acc, segEnd = acc + len;
      acc = segEnd;
      if (segEnd <= start || segStart >= end) { out.push(seg); continue; }
      if (isText) {
        const chars = [...seg.text];
        const left = chars.slice(0, Math.max(0, start - segStart)).join("");
        const right = chars.slice(Math.min(len, end - segStart)).join("");
        if (left) out.push({ type: seg.type, text: left });
        if (!inserted) { if (ref) out.push(ref); inserted = true; }
        if (right) out.push({ type: seg.type, text: right });
      } else {
        out.push(seg);
      }
    }
    if (!inserted && ref) out.push(ref);
    return out;
  }

  // ---------------------------------------------------------------- shortcut

  // Parse "Mod+Shift+A" into exact modifier flags + key. "Mod" = Cmd on macOS,
  // Ctrl elsewhere. Requires at least one of Cmd/Ctrl/Alt (so a stray config
  // can't hijack plain typing). Returns null if unusable.
  _parseShortcut(str) {
    if (!str || typeof str !== "string") return null;
    const h = { meta: false, ctrl: false, shift: false, alt: false, key: null, code: null };
    for (const p of str.split("+").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      if (p === "mod") { if (this._isMac) h.meta = true; else h.ctrl = true; }
      else if (p === "cmd" || p === "meta" || p === "super" || p === "win") h.meta = true;
      else if (p === "ctrl" || p === "control") h.ctrl = true;
      else if (p === "shift") h.shift = true;
      else if (p === "alt" || p === "option" || p === "opt") h.alt = true;
      else {
        h.key = p;
        if (/^[a-z]$/.test(p)) h.code = "Key" + p.toUpperCase();
        else if (/^[0-9]$/.test(p)) h.code = "Digit" + p;
      }
    }
    if (!h.key) return null;
    if (!h.meta && !h.ctrl && !h.alt) return null;
    return h;
  }

  // Human-readable form of a shortcut string for display.
  _prettyShortcut(str) {
    const map = this._isMac
      ? { mod: "⌘", cmd: "⌘", meta: "⌘", ctrl: "⌃", control: "⌃", alt: "⌥", option: "⌥", opt: "⌥", shift: "⇧" }
      : { mod: "Ctrl", cmd: "Win", meta: "Win", ctrl: "Ctrl", control: "Ctrl", alt: "Alt", option: "Alt", opt: "Alt", shift: "Shift" };
    const sep = this._isMac ? "" : "+";
    return str
      .split("+")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => map[s.toLowerCase()] || s.toUpperCase())
      .join(sep);
  }

  // Build the canonical shortcut string from a keydown event, or null.
  _eventToShortcut(e) {
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return null;
    let key = null;
    if (/^Key([A-Z])$/.test(e.code)) key = RegExp.$1;
    else if (/^Digit([0-9])$/.test(e.code)) key = RegExp.$1;
    else if ((e.key || "").length === 1) key = e.key.toUpperCase();
    if (!key) return null;
    const primary = this._isMac ? e.metaKey : e.ctrlKey;
    const secondary = this._isMac ? e.ctrlKey : e.metaKey;
    if (!primary && !secondary && !e.altKey) return null; // need a real modifier
    const parts = [];
    if (primary) parts.push("Mod");
    if (secondary) parts.push(this._isMac ? "Ctrl" : "Meta");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    parts.push(key);
    return parts.join("+");
  }

  // Persist both shortcuts at once and rebind them live (the listeners read
  // this._hotkey / this._convertHotkey). NOTE: saveConfiguration triggers a plugin
  // reload — acceptable here (rare, explicit action), NOT for view prefs.
  async _saveShortcuts(aliasStr, convertStr) {
    const a = this._parseShortcut(aliasStr), c = this._parseShortcut(convertStr);
    if (!a || !c) return this._toast("Each shortcut needs Cmd/Ctrl or Alt plus a key.");
    try {
      const conf = this.getConfiguration();
      conf.custom = conf.custom || {};
      conf.custom.shortcut = aliasStr;
      conf.custom.convertShortcut = convertStr;
      const all = await this.data.getAllGlobalPlugins();
      const me = all.find((g) => g.getGuid && g.getGuid() === this.getGuid());
      if (me && me.saveConfiguration) me.saveConfiguration(conf);
    } catch (e) {}
    this._hotkey = a;
    this._convertHotkey = c;
    this._toast("Shortcuts saved");
  }

  // ------------------------------------------------------------------- modals

  _el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // Generic modal shell (backdrop + header + body + footer). `render(body)`
  // returns { value(), canSave?(), enterSaves?, focusEl? }.
  _openModal({ title, render, onSave, saveLabel }) {
    this._closeModal();
    const backdrop = this._el("div", "refalias-backdrop");
    const modal = this._el("div", "refalias-modal");
    const header = this._el("div", "refalias-header");
    header.append(this._el("div", "refalias-title", title));
    const x = this._el("button", "refalias-x", "×");
    header.append(x);
    const body = this._el("div", "refalias-body");
    const footer = this._el("div", "refalias-footer");
    const cancel = this._el("button", "refalias-btn", "Cancel");
    const save = this._el("button", "refalias-btn refalias-primary", saveLabel || "Save");
    footer.append(cancel, save);
    modal.append(header, body, footer);
    backdrop.append(modal);
    document.body.append(backdrop);

    const close = () => this._closeModal();
    this._modal = { backdrop, save };

    const ctl = render(body) || {};
    const refreshSave = () => { if (ctl.canSave) save.disabled = !ctl.canSave(); };
    refreshSave();
    ctl._refreshSave = refreshSave;

    const doSave = () => {
      if (ctl.canSave && !ctl.canSave()) return;
      const v = ctl.value ? ctl.value() : undefined;
      close();
      onSave(v);
    };
    save.addEventListener("click", doSave);
    cancel.addEventListener("click", close);
    x.addEventListener("click", close);
    backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) close(); });
    modal.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Enter" && ctl.enterSaves) { e.preventDefault(); doSave(); }
    });

    setTimeout(() => { try { (ctl.focusEl || body.querySelector("input, .refalias-capture")).focus(); if (ctl.afterFocus) ctl.afterFocus(); } catch (e) {} }, 0);
    return ctl;
  }

  _closeModal() {
    if (this._modal) {
      if (this._modal.cleanup) { try { this._modal.cleanup(); } catch (e) {} }
      try { this._modal.backdrop.remove(); } catch (e) {}
      this._modal = null;
    }
  }

  // Compact popover anchored directly under the reference chip. The single
  // field is pre-filled with the existing alias, or the page's title when there
  // is none yet — so you can trim it to the part you want, or clear it to type
  // a new one (empty = no alias, the chip falls back to the page's name).
  _openAliasModal(r) {
    this._closeModal();
    const catcher = this._el("div", "refalias-catch");
    const pop = this._el("div", "refalias-pop");

    const field = this._el("div", "refalias-field");
    const input = this._el("input", "refalias-input");
    input.type = "text";
    input.value = r.current || r.fallback;
    input.placeholder = r.fallback || "alias";
    const clear = this._el("button", "refalias-clear", "×");
    clear.title = "Clear";
    clear.addEventListener("click", () => { input.value = ""; input.focus(); });
    field.append(input, clear);

    const foot = this._el("div", "refalias-foot");
    foot.append(this._el("span", "refalias-hint", r.isText ? "Enter to save · Empty resets to the line's text" : "Enter to save · Empty clears"));
    const save = this._el("button", "refalias-btn refalias-primary refalias-save", "Save");
    foot.append(save);

    pop.append(field, foot);
    catcher.append(pop);
    document.body.append(catcher);
    this._modal = { backdrop: catcher };

    const close = () => { this._closeModal(); this._refocusEditor(); };
    const doSave = () => { close(); this._writeAlias(r, input.value); };
    save.addEventListener("click", doSave);
    catcher.addEventListener("mousedown", (e) => { if (e.target === catcher) close(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); doSave(); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
    });

    // Anchor under the exact reference chip on this line (located by target guid
    // within the line's DOM). The linespan node is null for a standalone line
    // ref, which previously dropped the popover to a centred fallback; the line
    // node is the final fallback so it still appears by the line, not centred.
    let chip = null;
    try {
      const sel = 'span.lineitem-ref[data-guid="' + (window.CSS && CSS.escape ? CSS.escape(r.targetGuid) : r.targetGuid) + '"]';
      chip = (r.lineNode && r.lineNode.querySelector && r.lineNode.querySelector(sel)) || null;
    } catch (e) {}
    this._positionPopover(pop, [chip, r.anchorNode, r.lineNode]);
    setTimeout(() => { try { input.focus(); const n = input.value.length; input.setSelectionRange(n, n); } catch (e) {} }, 0);
  }

  // Place the popover just below the anchor (flips above if it would overflow),
  // kept inside the anchor's own panel so it never spills into a neighbouring
  // split-view panel and covers its text.
  _positionPopover(pop, anchors) {
    const list = (Array.isArray(anchors) ? anchors : [anchors]).filter(Boolean);
    let rect = null, anchorEl = null;
    for (const a of list) {
      try {
        if (!a.getBoundingClientRect || !document.contains(a)) continue;
        const r = a.getBoundingClientRect();
        if ((r.width || r.height) && r.top >= 0 && r.top < window.innerHeight && r.left >= 0) { rect = r; anchorEl = a; break; }
      } catch (e) {}
    }
    const m = 12;
    const vw = window.innerWidth, vh = window.innerHeight;
    // Horizontal bounds = the panel the anchor lives in (fall back to viewport).
    let bL = m, bR = vw - m;
    try {
      const panel = anchorEl && anchorEl.closest && anchorEl.closest(".panel");
      if (panel) { const pr = panel.getBoundingClientRect(); if (pr.width) { bL = Math.max(m, pr.left + 8); bR = Math.min(vw - m, pr.right - 8); } }
    } catch (e) {}
    if (!rect) {
      const fw = pop.offsetWidth || 320;
      pop.style.left = Math.round(Math.max(bL, (bL + bR) / 2 - fw / 2)) + "px";
      pop.style.top = "18vh"; pop.style.transform = "none";
      return;
    }
    // Shrink to fit the column if the popover is wider than the panel.
    let w = pop.offsetWidth || 320;
    const maxW = bR - bL;
    if (w > maxW) { pop.style.width = Math.round(maxW) + "px"; w = maxW; }
    const h = pop.offsetHeight || 90;
    let left = rect.left;
    if (left + w > bR) left = bR - w;
    if (left < bL) left = bL;
    let top = rect.bottom + 6;
    if (top + h > vh - m && rect.top - h - 6 >= m) top = rect.top - h - 6;
    pop.style.left = Math.round(left) + "px";
    pop.style.top = Math.round(top) + "px";
  }

  // One dialog with both shortcuts (alias + convert). One row is always the
  // "active" one (highlighted); the next combo captures into it. Click a row (or
  // Tab) to switch. Does NOT rely on DOM focus — focusable divs don't focus
  // reliably inside this modal.
  _openShortcutModal() {
    const cust = ((this.getConfiguration() || {}).custom) || {};
    const val = { alias: cust.shortcut || "Mod+Shift+A", convert: cust.convertShortcut || "Mod+Ctrl+R" };
    const order = ["alias", "convert"];
    const fields = {};
    let active = "alias";

    const setActive = (key) => { active = key; order.forEach((k) => fields[k].classList.toggle("refalias-capturing", k === key)); };

    const addRow = (body, key, label) => {
      const row = this._el("div", "refalias-scrow");
      row.append(this._el("div", "refalias-sclabel", label));
      const field = this._el("div", "refalias-capture", this._prettyShortcut(val[key]));
      row.append(field);
      row.addEventListener("mousedown", (e) => { e.preventDefault(); setActive(key); });
      fields[key] = field;
      body.append(row);
    };

    this._openModal({
      title: "Reference Extravaganza shortcuts",
      saveLabel: "Save",
      onSave: () => { this._saveShortcuts(val.alias, val.convert); },
      render: (body) => {
        addRow(body, "alias", "Set alias for reference");
        addRow(body, "convert", "Convert reference ↔ embedded line");
        body.append(this._el("div", "refalias-hint", "Click a row to pick it (or Tab), then press the keys: hold ⌘/Ctrl (or ⌥/Alt), optionally ⇧, then a key."));
        setActive("alias");
        return { value: () => val };
      },
    });

    // Window CAPTURE phase (same level the shortcuts fire) so the combo is caught
    // before Thymer's own handling. The dialog owns every keystroke while open.
    const cap = (e) => {
      if (e.key === "Escape") { e.preventDefault(); this._closeModal(); return; }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Tab") { setActive(active === "alias" ? "convert" : "alias"); return; }
      if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
      const s2 = this._eventToShortcut(e);
      const field = fields[active];
      if (!s2) field.textContent = "Add ⌘/Ctrl or ⌥/Alt…";
      else { val[active] = s2; field.textContent = this._prettyShortcut(s2); }
    };
    window.addEventListener("keydown", cap, true);
    window.__refxShortcutCap = cap; // hot-reload stash
    if (this._modal) this._modal.cleanup = () => { window.removeEventListener("keydown", cap, true); window.__refxShortcutCap = null; };
  }

  _toast(msg) {
    this.ui.addToaster({ title: "Reference Extravaganza", message: msg, dismissible: true, autoDestroyTime: 3200 });
  }

  // ------------------------------------------------------------------- styles

  _injectStyle() {
    let st = document.getElementById(this._STYLE_ID);
    if (!st) { st = document.createElement("style"); st.id = this._STYLE_ID; document.head.appendChild(st); }
    st.textContent = `
.refalias-backdrop {
  position: fixed; inset: 0; z-index: 2147483000;
  background: rgba(0,0,0,.38); backdrop-filter: blur(2px);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 14vh 16px 16px;
}
.refalias-modal {
  width: min(460px, 96vw);
  display: flex; flex-direction: column;
  background: var(--modal-bg, var(--cmdpal-bg-color, #fcfcfd));
  border: 1px solid rgba(127,127,127,.30);
  box-shadow: var(--shadow-dialog, 0 20px 70px rgba(0,0,0,.45));
  border-radius: 4px; overflow: hidden;
  color: var(--text-color, #555958);
  font-size: 13px; line-height: 1.5;
}
.refalias-header {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px; border-bottom: 1px solid rgba(127,127,127,.16);
}
.refalias-title { font-size: 15px; font-weight: 600; flex: 1; }
.refalias-x {
  border: 0; background: transparent; color: inherit; cursor: pointer;
  font-size: 20px; line-height: 1; opacity: .55; width: 28px; height: 28px;
  border-radius: 4px; display: flex; align-items: center; justify-content: center;
}
.refalias-x:hover { background: rgba(127,127,127,.18); opacity: 1; }
.refalias-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
.refalias-input, .refalias-capture {
  width: 100%; box-sizing: border-box;
  padding: 11px 12px; border-radius: 4px;
  border: 1px solid rgba(127,127,127,.28); background: rgba(127,127,127,.08);
  color: inherit; font-size: 13px; outline: none;
}
.refalias-input::placeholder { color: currentColor; opacity: .4; }
.refalias-input:focus, .refalias-capture:focus { border-color: rgba(127,127,127,.5); }
.refalias-capture { cursor: pointer; user-select: none; }
.refalias-capture-empty { opacity: .45; }
.refalias-hint { font-size: 11px; opacity: .5; }

/* compact popover anchored under the reference */
.refalias-catch { position: fixed; inset: 0; z-index: 2147483000; background: transparent; }
.refalias-pop {
  position: fixed; z-index: 2147483001;
  width: 500px; max-width: calc(100vw - 24px); box-sizing: border-box;
  display: flex; flex-direction: column; gap: 10px; padding: 12px;
  background: var(--modal-bg, var(--cmdpal-bg-color, #fcfcfd));
  border: 1px solid rgba(127,127,127,.30);
  box-shadow: var(--shadow-dialog, 0 12px 40px rgba(0,0,0,.35));
  border-radius: 4px; color: var(--text-color, #555958);
  font-size: 13px; line-height: 1.5;
}
.refalias-field { position: relative; display: flex; align-items: center; }
.refalias-field .refalias-input { padding-right: 32px; }
.refalias-clear {
  position: absolute; right: 5px; top: 50%; transform: translateY(-50%);
  border: 0; background: transparent; color: inherit; cursor: pointer; opacity: .5;
  width: 22px; height: 22px; border-radius: 4px; font-size: 16px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
}
.refalias-clear:hover { background: rgba(127,127,127,.18); opacity: 1; }
.refalias-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.refalias-foot .refalias-hint { flex: 1; }
.refalias-save { padding: 6px 16px; }

/* shared result-list base (the [[ picker overrides most of this to the native
   command-palette look below; card popups override via .refx-cardpop) */
.refalias-results { display: flex; flex-direction: column; gap: 3px; max-height: 300px; overflow-y: auto; }
.refalias-result {
  padding: 8px 11px; border-radius: 4px; cursor: pointer; line-height: 1.3;
  display: flex; flex-direction: column; gap: 3px;
}
.refalias-result-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.refalias-result-page { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; opacity: .5; }
.refalias-result b { font-weight: 700; color: var(--ed-button-primary-bg, #479797); }
.refalias-result:hover { background: rgba(127,127,127,.10); }
.refalias-result-sel { background: rgba(127,127,127,.16); }
.refalias-result-empty { padding: 9px 11px; opacity: .5; font-size: 12px; }

/* [[ line-reference picker — native command-palette look (mirrors Quick Capture
   and Thymer's own @ menu): flush cmdpal surface, mono type, accent selection,
   single-line rows with the source page as an inline muted sub, bold hilite. */
.refalias-pop.refalias-linkpop {
  width: 640px; max-width: calc(100vw - 24px);
  padding: 0; gap: 0;
  background: var(--cmdpal-bg-color, var(--modal-bg, #26262b));
  color: var(--cmdpal-fg-color, var(--text-color, #ddd));
  font-family: var(--font-mono, inherit);
  border: 1px solid var(--cmdpal-border-color, rgba(127,127,127,.30));
  border-radius: var(--radius-larger, 5px);
  box-shadow: var(--shadow-dialog, 0 16px 48px rgba(0,0,0,.5));
}
.refalias-linkpop .refalias-results { gap: 0; padding: 5px; }
.refalias-linkpop .refalias-result {
  flex-direction: row; align-items: center; gap: 8px;
  padding: 6px 9px; border-radius: var(--radius-normal, 4px);
  font-size: var(--text-size-small, 13px); line-height: 16px;
}
.refalias-linkpop .refalias-result-text { flex: 1 1 auto; min-width: 0; }
.refalias-linkpop .refalias-result-page { flex: 0 0 auto; margin-left: auto; max-width: 190px; font-size: 11.5px; opacity: .5; }
.refalias-linkpop .refalias-result:hover:not(.refalias-result-sel) { background: rgba(127,127,127,.12); }
.refalias-linkpop .refalias-result-sel { background: var(--cmdpal-selected-bg-color, var(--ed-button-primary-bg, #479797)); color: var(--cmdpal-selected-fg-color, #fff); }
.refalias-linkpop .refalias-result-sel .refalias-result-page { color: var(--cmdpal-selected-fg-color, #fff); opacity: .8; }
.refalias-linkpop .refalias-result b { color: var(--cmdpal-hilite-color, var(--color-blackwhite-0, #fff)); font-weight: var(--font-weight-bold, 700); }
.refalias-linkpop .refalias-result-sel b { color: var(--cmdpal-selected-fg-color, #fff); }
.refalias-linkpop .refalias-result-empty { padding: 9px 11px; opacity: .5; font-size: 12px; }

/* hover preview of a result line's FULL text, beside the [[ picker (mirrors
   Quick Capture's line preview) */
.refalias-linepreview {
  position: fixed; z-index: 2147483002; max-width: 440px; box-sizing: border-box;
  padding: 10px 12px; border-radius: var(--radius-larger, 6px); pointer-events: none;
  background: var(--cmdpal-bg-color, var(--modal-bg, #26262b));
  color: var(--cmdpal-fg-color, var(--text-color, #ddd));
  border: 1px solid var(--cmdpal-border-color, rgba(127,127,127,.3));
  box-shadow: var(--shadow-dialog, 0 12px 40px rgba(0,0,0,.5));
  font-family: var(--font-mono, inherit); font-size: var(--text-size-small, 13px); line-height: 1.5;
  overflow-y: auto;
}
.refalias-lp-text { white-space: pre-wrap; overflow-wrap: anywhere; }
/* match highlight = Quick Capture's preview accent (primary teal; steps to the
   darker 700 on light themes where 500 is too pale) */
.refalias-lp-text b { font-weight: var(--font-weight-bold, 700); color: var(--color-primary-500, #4caea1); }
html.is-light .refalias-lp-text b { color: var(--color-primary-700, #2f8873); }
.refalias-lp-ctx { margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(127,127,127,.2); opacity: .55; font-size: 11.5px; }
.refalias-footer {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 13px 18px; border-top: 1px solid rgba(127,127,127,.16);
  background: rgba(127,127,127,.04);
}
.refalias-btn {
  border: 1px solid rgba(127,127,127,.28); background: var(--ed-button-bg, transparent);
  color: inherit; cursor: pointer; border-radius: 4px; padding: 8px 16px; font-size: 13px;
}
.refalias-btn:hover { background: rgba(127,127,127,.14); }
.refalias-primary {
  background: var(--ed-button-primary-bg, #479797) !important;
  border-color: transparent !important; color: #fff !important; font-weight: 600;
}
.refalias-primary:disabled { opacity: .5; cursor: default; }

/* PAGE EMBEDS: the real page panel inside our transclusion line (see "page embeds") */
.refx-pe-park { position: fixed; left: 0; top: 0; width: 800px; height: 600px; clip-path: inset(100%); pointer-events: none; z-index: -1; }
.refx-pe-park > .panel { position: relative !important; width: 100% !important; height: 100% !important; }
.panels-grid.refx-pe-mounting > .panel:not([data-refx-keep]) { position: absolute !important; left: -100000px !important; top: 0 !important; width: 900px !important; height: 600px !important; opacity: 0 !important; pointer-events: none !important; }
.listitem-transclusion.refx-pemb-host { flex-wrap: wrap; }
/* Thymer's own body of these rows is hidden by guid (stylesheet refx-pe-hide), see _peHideSync */
.panel.refx-pemb {
  --layout-margin-size: 0px; position: relative !important; display: block !important;
  height: auto !important; min-height: 0 !important; flex: none !important;
  margin: 0 0 0 30px !important; width: calc(100% - 30px) !important;
  background: transparent !important; background-image: none !important; overflow: visible !important;
  border: 0 !important; box-shadow: none !important; padding: 0 !important;
}
.panel.refx-pemb::before, .panel.refx-pemb::after { display: none !important; }
.panel.refx-pemb .panel-scroller-y { overflow: visible !important; height: auto !important; padding: 0 !important; }
.panel.refx-pemb .panel-body, .panel.refx-pemb .layout-margin, .panel.refx-pemb .editor-panel { height: auto !important; padding: 0 !important; margin: 0 !important; min-height: 0 !important; }
.panel.refx-pemb .content-container { margin: 0 !important; max-width: none !important; padding: 0 !important; }
.panel.refx-pemb .panel-bar, .panel.refx-pemb .id--versions-area, .panel.refx-pemb .backrefs-footer, .panel.refx-pemb .vscrollbar { display: none !important; }
.panel.refx-pemb[data-mode="box"] {
  border: 1px solid color-mix(in srgb, var(--text-color) 22%, transparent) !important;
  border-radius: var(--ed-radius-block, 6px) !important; padding: 6px 14px 10px !important;
  margin-top: 6px !important; margin-bottom: 6px !important; box-sizing: border-box !important;
}

/* shortcuts dialog: one capture row per shortcut */
.refalias-capturing { border-color: var(--input-border-focus, rgba(127,127,127,.6)) !important; box-shadow: 0 0 0 2px rgba(127,127,127,.18); }
.refalias-scrow { display: flex; align-items: center; gap: 12px; }
.refalias-sclabel { flex: 1; font-size: 12.5px; }
.refalias-scrow .refalias-capture { width: 150px; flex: none; text-align: center; padding: 8px 10px; }
/* live-search AND standalone line-ref embeds keep a writing strip at the bottom:
   clicking it appends a new indented child under the transcluded line. ZERO-JUMP:
   the strip reserves exactly one child line's worth of space (1lh + line margins),
   and the moment the child appears the :has() rule collapses the strip to the
   container's natural 12px padding — the collapse cancels the added line in the
   SAME layout pass, so nothing below shifts (verified: box height unchanged across
   the add). Once a child exists you extend with Enter (native, no strip needed). */
.listitem-transclusion.refx-qembed .transclusion-container-div,
.listitem-transclusion.refx-lineembed .transclusion-container-div { padding-bottom: calc(1lh + 24px); cursor: text; }
.listitem-transclusion.refx-qembed .transclusion-container-div:has(.listitem ~ .listitem),
.listitem-transclusion.refx-lineembed .transclusion-container-div:has(.listitem ~ .listitem) { padding-bottom: 12px; }
`;
  }
}
