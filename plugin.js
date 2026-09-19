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
  _editRecordCmd = null;
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
  _themeObs = null; // re-copies card colours on data-theme change
  _blobUrls = new Map(); // file-prop blob guid -> {url} (object URLs, revoked on unload)
  _cardObs = null;
  _cardObsTarget = null;
  _cardEditing = false;
  _cardRaf = 0;
  _cardPopup = null;
  _navHandler = null;
  _recUpdHandler = null;
  _discoverT = 0; // debounce timer for re-discovering embeds (focus / remote edits)
  _discoverRefresh = false; // latched: the pending discovery should also refresh present cards
  _discoverPending = null; // discovery deferred while an editor is open (flushed on close, no timer loop)
  _fieldTypes = null; // lazy {fieldId -> PROP_TYPE} from all collections' config fields (schema-based kind detection)
  _fieldMeta = null;  // fieldId -> {type, filter_colguid} (relation target collection)
  _colByGuid = null;  // collection guid -> PluginCollectionAPI
  _fieldTypesRebuildT = 0; // debounced schema-map self-heal when an unknown declared field is seen
  // lineGuid -> refcount of in-flight commit polls that own that card's refresh
  // (a COUNTING map, not a Set: overlapping commits on two fields of one card must
  // not release ownership when the first poll completes).
  _commitInFlight = new Map();
  _activeEdit = null; // {lineGuid, cancel} of the open inline text/number editor (so teardown paths can close it — removing a focused <input> fires no blur in Chromium)
  _rowRefreshT = new Map(); // lineGuid -> timer: coalesces record.updated bursts into one in-place refresh
  _rehydrateT = 0; // the load-time retry timer (cleared on unload so a late retry can't resurrect a dead instance)
  _unloaded = false;
  // Keyboard nav of the property card: a CLASS-based cursor (refx-nav-focus) over
  // the card's value cells, driven by a window-capture handler — mirrors Thymer's
  // native title→properties arrow-nav (injected DOM can't hold real focus, but a
  // class cursor + our own keydown handler can). _cardNav = {lineGuid, recordGuid,
  // index}; the DOM class is the source of truth for WHICH cell, so it survives a
  // card re-injection (never store element refs).
  _cardNav = null;
  // When an edit is opened from nav, we stash {lineGuid, recordGuid, index} so the
  // cursor is re-established on the same cell after the edit's card re-render (the
  // edit swaps the value cell for an input / rebuilds the card, which would drop
  // the class cursor). Robust to _cardNav being cleared mid-edit by DOM churn.
  _cardNavResume = null;
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
  _CARD_CLASS = "refx-propcard";
  _CARD_SKIP = new Set(["Created", "Modified", "Banner", "Icon", "Scene", "Canvas Text", "Assets", "Assets 2", "Assets 3", "Assets 4", "Scene Rev", "Scene Schema", "Source Note", "Chunks", "Manifest"]);

  // The one always-on listener (capture phase). Cheap-first guards reject the
  // Commit-ownership refcounting (see _commitInFlight): claim before a write,
  // release when its poll settles; owned() gates every competing refresh path.
  _commitClaim(g) { this._commitInFlight.set(g, (this._commitInFlight.get(g) || 0) + 1); }
  _commitRelease(g) { const n = (this._commitInFlight.get(g) || 0) - 1; if (n > 0) this._commitInFlight.set(g, n); else this._commitInFlight.delete(g); }
  _commitOwned(g) { return (this._commitInFlight.get(g) || 0) > 0; }

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
    this._healWedgedEditing(); // an orphaned editor flag would brick all expand/collapse
    if (this._cardEditing) return; // never collapse/expand under an open editor
    const hit = this._detect();
    if (!hit) return;
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

  // Plain ArrowDown on a record reference whose embed is open steps the keyboard
  // "nav cursor" into that embed's property card (like native title→properties).
  // Cheap-first guards keep ordinary arrowing untouched — we only intercept when a
  // record reference is selected AND it has an open card with at least one cell.
  _handleCardNavTrigger = (e) => {
    if (e.key !== "ArrowDown") return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (this._cardNav || this._cardEditing || this._modal || this._link) return;
    if (!this._cards.size) return;
    const hit = this._detect();
    if (!hit) return;
    const ref = this._selectedRef(hit);
    if (!ref || ref.isText) return;              // only record refs have a card
    const lineGuid = this._openEmbedForRef(hit, ref.targetGuid);
    if (!lineGuid) return;                        // no open embed under this ref
    if (!this._cardNavItems(lineGuid).length) return;
    e.preventDefault(); e.stopImmediatePropagation();
    this._enterCardNav(lineGuid, ref.targetGuid, 0);
  };

  // The property card is decorator DOM (not part of the synced document), so it
  // only exists on clients that have DISCOVERED the embed. Switching to an already-
  // open client, or a multiplayer edit, doesn't fire panel.navigated — so re-run
  // discovery when the tab regains focus/visibility (and on record.updated below).
  _discoverTrigger = () => { if (!document.hidden) this._scheduleDiscover(true); };

  onLoad() {
    try { window.__REFX_VERSION = "3.4.0-dev"; } catch (e) {} // live-version tell for debugging
    this._killStaleObservers(); // clear any observer/cards leaked by a hot-reload
    this._injectStyle();
    // Restore the cached native indent-line geometry before the first paint, so a
    // page with no undescribed parent still lands on real measurements.
    try {
      const raw = localStorage.getItem(this._DESC_NATIVE_KEY);
      const v = raw ? JSON.parse(raw) : null;
      if (v && isFinite(v.above) && isFinite(v.below)) this._descNative = v;
    } catch (e) {}
    this._rebuildDescCSS(); // line descriptions: paint before the first frame
    this._ensureThemeObserver();
    this._buildFieldTypes(); // async; schema-based property typing (empty fields)

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
    // Fully keyboard path: cursor on a record reference (or inside a record
    // embed), run this, edit the record's properties in a normal modal.
    this._editRecordCmd = this.ui.addCommandPaletteCommand({
      label: "Edit embedded record (properties)",
      icon: "ti-pencil",
      onSelected: () => { this._onEditEmbedCommand(); },
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
    window.addEventListener("keydown", this._handleCardNavTrigger, true);
    window.addEventListener("keydown", this._handleConvertKey, true);
    for (const t of ["pointerdown", "mousedown", "mouseup", "click", "dblclick"]) window.addEventListener(t, this._handleDescPointer, true);
    window.__refxDescDbl = this._handleDescPointer; // hot-reload stash
    // Window-singleton stash of the always-on handlers: a hot-reload re-runs onLoad
    // on the SAME document without disposing the prior instance, so without this
    // every update stacks another copy of all four capture listeners (and the old
    // ones' stopImmediatePropagation can starve the live instance).
    window.__refxKeyHandlers = [this._handleKeydown, this._handleBracketKey, this._handleExpandKey, this._handleCardNavTrigger, this._handleConvertKey];

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
    // Refresh any open cards for the changed record IN PLACE (its title/props
    // changed) — no teardown, so a local edit (which fires record.updated too) or a
    // remote change doesn't flicker the card. COALESCED per lineGuid: typing in an
    // embed body streams record.updated per keystroke, and an undebounced refresh
    // would re-read all properties every keypress.
    let tracked = false;
    if (g && this._cards.size) {
      for (const [lineGuid, e] of this._cards) {
        if (e.recordGuid !== g) continue;
        tracked = true;
        if (this._rowRefreshT.has(lineGuid)) continue;
        this._rowRefreshT.set(lineGuid, setTimeout(() => {
          this._rowRefreshT.delete(lineGuid);
          if (this._cards.has(lineGuid)) this._refreshCardInPlace(lineGuid, g);
        }, 150));
      }
    }
    // A remote/multiplayer edit may have ADDED or removed an embed on the page
    // we're viewing — re-discover (debounced) so its card appears/clears without a
    // navigation. Skip when the update is for a record we already track (the
    // targeted refresh above handled it — no structural change implied).
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

  // Discovery deferred while an editor was open gets flushed by the editor's own
  // close paths (no self-rescheduling timer loop while a popup sits open).
  _flushDeferredDiscover() {
    if (this._discoverPending == null) return;
    const rp = !!this._discoverPending;
    this._discoverPending = null;
    this._scheduleDiscover(rp);
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
    if (this._activeEdit) { try { this._activeEdit.cancel(); } catch (e) {} this._activeEdit = null; }
    for (const t of this._rowRefreshT.values()) { try { clearTimeout(t); } catch (e) {} }
    this._rowRefreshT.clear();
    this._cards.clear();
    this._queryEmbeds.clear();
    if (this._queryRaf) { try { cancelAnimationFrame(this._queryRaf); } catch (e) {} this._queryRaf = 0; }
    if (this._themeObs) { try { this._themeObs.disconnect(); } catch (e) {} this._themeObs = null; }
    for (const b of this._blobUrls.values()) { try { if (b.url) URL.revokeObjectURL(b.url); } catch (e) {} }
    this._blobUrls.clear();
    if (window.__refxThemeObs) { try { window.__refxThemeObs.disconnect(); } catch (e) {} window.__refxThemeObs = null; }
    window.removeEventListener("keydown", this._handleKeydown, true);
    window.removeEventListener("keydown", this._handleBracketKey, true);
    window.removeEventListener("keydown", this._handleExpandKey, true);
    window.removeEventListener("keydown", this._handleCardNavTrigger, true);
    window.removeEventListener("keydown", this._handleConvertKey, true);
    try { for (const t of ["pointerdown", "mousedown", "mouseup", "click", "dblclick"]) window.removeEventListener(t, this._handleDescPointer, true); } catch (e) {}
    window.__refxDescDbl = null;
    window.__refxKeyHandlers = null;
    this._exitCardNav();
    try { document.removeEventListener("visibilitychange", this._discoverTrigger, false); } catch (e) {}
    try { window.removeEventListener("focus", this._discoverTrigger, false); } catch (e) {}
    window.__refxDiscoverTrigger = null;
    if (this._discoverT) { try { clearTimeout(this._discoverT); } catch (e) {} this._discoverT = 0; }
    // Embeds are real document lines and intentionally PERSIST — only tear down
    // the plugin's own UI (observer + injected cards), never the embeds.
    this._teardownCardObserver();
    if (this._navHandler) { try { this.events.off(this._navHandler); } catch (e) {} this._navHandler = null; }
    if (this._recUpdHandler) { try { this.events.off(this._recUpdHandler); } catch (e) {} this._recUpdHandler = null; }
    this._exitLinkMode();
    this._hotkey = this._convertHotkey = null;
    if (this._cmd && this._cmd.remove) this._cmd.remove();
    if (this._shortcutCmd && this._shortcutCmd.remove) this._shortcutCmd.remove();
    if (this._collapseAllCmd && this._collapseAllCmd.remove) this._collapseAllCmd.remove();
    if (this._editRecordCmd && this._editRecordCmd.remove) this._editRecordCmd.remove();
    if (this._convertCmd && this._convertCmd.remove) this._convertCmd.remove();
    if (this._descCmd && this._descCmd.remove) this._descCmd.remove();
    this._cmd = this._shortcutCmd = this._collapseAllCmd = this._editRecordCmd = this._convertCmd = this._descCmd = null;
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
      descH = parseFloat(getComputedStyle(ld, "::after").height) || 0;
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
    const sels = [], heads = [], indents = [], rules = [], divs = [], divsPlain = [], selsPlain = [];
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
      if (it.type !== "heading") selsPlain.push(sel);
      (it.type === "heading" ? divs : divsPlain).push('.listitem[data-guid="' + esc + '"] .line-div');
      heads.push('.listitem-heading[data-guid="' + esc + '"] .line-div::after');
      indents.push('.listitem[data-guid="' + esc + '"] .listitem-indentline');
      rules.push(sel + '{content:"' + this._escCssString(String(v)) + '";}');
    }
    let css = "";
    if (sels.length) {
      const m = this._descMetrics(firstGuid);
      css = sels.join(",") + "{display:block;margin-top:" + m.base.margin + "px;" +
        "font-size:var(--text-size-small,12px);line-height:1.4;" +
        "color:var(--text-muted,rgba(127,127,127,.9));white-space:pre-wrap;" +
        "font-weight:400;font-style:normal;pointer-events:none;}\n" +
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
        // children below do not move at all.
        (selsPlain.length ? selsPlain.join(",") + "{padding-top:" + this._DESC_PLAIN_NUDGE + "px;margin-bottom:-" + this._DESC_PLAIN_NUDGE + "px;}\n" : "") +
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
        const descH = parseFloat(after.height);
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
        let rank = 0;
        try {
          const pnl = lv.$container && lv.$container.closest && lv.$container.closest(".panel");
          if (pnl && (pnl.classList.contains("has-focus") || pnl.classList.contains("is-target") || pnl.classList.contains("focused-panel"))) rank = 1;
        } catch (e) {}
        if (lv.hasFocus && lv.hasFocus()) rank = 2;
        if (rank > bestRank) { best = { pos }; bestRank = rank; }
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

  // The lineGuid of an OPEN card-bearing embed for `targetGuid` under the caret's
  // block. DOM-synchronous (the keydown handler must decide instantly). The embed
  // line is a child of the ref's block, so it's a descendant of the caret line's
  // node; fall back to any tracked embed for the record with a live rendered node.
  _openEmbedForRef(hit, targetGuid) {
    const scope = hit && hit.lineNode;
    if (scope && scope.querySelectorAll) {
      let nodes = [];
      try { nodes = [...scope.querySelectorAll(".listitem-transclusion[data-guid]")]; } catch (e) {}
      for (const n of nodes) {
        const g = n.getAttribute && n.getAttribute("data-guid");
        const entry = g && this._cards.get(g);
        if (entry && entry.recordGuid === targetGuid) return g;
      }
    }
    for (const [g, entry] of this._cards) if (entry.recordGuid === targetGuid && this._transclusionNode(g)) return g;
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

  // Cheap synchronous test: could Cmd+Up here collapse an embed? (caret on/under
  // one of our embed lines, inside our card, or inside any transclusion render).
  _mightBeInEmbed(hit) {
    try {
      const n = hit.lineNode || hit.anchorNode;
      if (!n || !n.closest) return false;
      if (n.closest("." + this._CARD_CLASS)) return true;
      const li = n.closest(".listitem");
      if (li) { const g = li.getAttribute && li.getAttribute("data-guid"); if (g && this._cards.has(g)) return true; }
      return !!n.closest(".listitem-transclusion, .lineitem-transcludes, [data-itemref]");
    } catch (e) { return false; }
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
    // Close any editor tied to this card first — removing a focused <input> fires
    // no blur in Chromium, which would leave _cardEditing wedged true.
    if (this._activeEdit && this._activeEdit.lineGuid === g) { try { this._activeEdit.cancel(); } catch (e) {} this._activeEdit = null; }
    const savedEntry = this._cards.get(g) || null;
    this._cards.delete(g);
    this._queryEmbeds.delete(g);
    this._lineEmbeds.delete(g);
    if (this._cardNav && this._cardNav.lineGuid === g) this._exitCardNav();
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

  // Keyboard-first property editing. Injected card values can't hold focus inside
  // Thymer's editor, so this opens a normal (focus-owning) modal instead.
  _onEditEmbedCommand() {
    const hit = this._detect();
    if (!hit) return this._toast("Put the cursor on a record reference or inside a record embed.");
    let recordGuid = null;
    const ref = this._selectedRef(hit);
    if (ref && !ref.isText) recordGuid = ref.targetGuid;
    if (!recordGuid && this._mightBeInEmbed(hit) && hit.pageGuid && this.data.getRecord(hit.pageGuid)) recordGuid = hit.pageGuid;
    if (!recordGuid) return this._toast("Put the cursor on a record reference or inside a record embed.");
    const rec = this.data.getRecord(recordGuid);
    if (!rec) return this._toast("Couldn't load that record.");
    this._openRecordEditorModal(rec, recordGuid);
  }

  async _openRecordEditorModal(rec, recordGuid) {
    const fields = this._recCardFields(rec);
    let bodyEmpty = false;
    try { const items = await rec.getLineItems(); bodyEmpty = !items || items.length === 0; } catch (e) {}
    const controls = [];
    this._openModal({
      title: "Edit " + ((rec.getName && rec.getName()) || "record"),
      saveLabel: "Save",
      // _openModal removes the modal DOM before calling onSave, so read the
      // values in value() (called first) and apply them from that snapshot.
      onSave: (vals) => {
        for (const item of (vals || [])) {
          if (!item || item.v === null || item.v === undefined) continue;
          if (String(item.v) !== String(item.field.value == null ? "" : item.field.value)) this._writeCardProp(rec, item.field, item.v);
        }
        for (const [lg, e] of this._cards) if (e.recordGuid === recordGuid) this._renderFreshCard(lg, recordGuid, true);
      },
      render: (body) => {
        if (!fields.length) body.append(this._el("div", "refalias-sub", "This record has no editable properties."));
        for (const f of fields) {
          const row = this._el("div", "refx-modal-row");
          row.append(this._el("div", "refx-modal-label", f.name));
          let ctl, read = null;
          if (f.kind === "relation") {
            ctl = this._el("input", "refalias-input"); ctl.type = "text";
            ctl.value = f.value == null ? "" : String(f.value); ctl.disabled = true;
            ctl.title = "Edit relations by clicking the value in the card";
          } else if (f.kind === "choice") {
            ctl = this._el("select", "refalias-input");
            const blank = this._el("option", null, "—"); blank.value = ""; ctl.append(blank);
            for (const c of (f.choices || [])) { const o = this._el("option", null, c.label); o.value = c.label; if (c.label === f.value) o.selected = true; ctl.append(o); }
            read = () => ctl.value;
          } else if (f.kind === "date") {
            // <input type=date> SANITIZES any non-conforming value to "" — a stored
            // "YYYY-MM-DD HH:MM" would seed as blank and a no-op Save would then
            // silently CLEAR the property. Seed the date part only, carry the time
            // suffix through, and compare against the date-only seed on save.
            ctl = this._el("input", "refalias-input");
            ctl.type = "date";
            const raw = f.value == null ? "" : String(f.value);
            const dateOnly = raw.slice(0, 10);
            const timeSuffix = (/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})/.exec(raw) || [])[1] || "";
            ctl.value = /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : "";
            read = () => (ctl.value ? ctl.value + timeSuffix : "");
            controls.push({ field: Object.assign({}, f, { value: raw }), read });
            row.append(ctl);
            body.append(row);
            continue;
          } else {
            ctl = this._el("input", "refalias-input");
            ctl.type = f.kind === "number" ? "number" : "text";
            ctl.value = f.value == null ? "" : String(f.value);
            read = () => ctl.value;
          }
          controls.push({ field: f, read });
          row.append(ctl);
          body.append(row);
        }
        if (bodyEmpty) {
          const addRow = this._el("div", "refx-modal-row");
          const btn = this._el("button", "refalias-btn", "＋ Add a body line");
          btn.type = "button";
          btn.addEventListener("click", async () => {
            btn.disabled = true; btn.textContent = "Added — close and edit it inline";
            try { await rec.createLineItem(null, null, "text"); } catch (e) {}
            for (const [lg, e] of this._cards) if (e.recordGuid === recordGuid) this._renderFreshCard(lg, recordGuid, true);
          });
          addRow.append(btn);
          body.append(addRow);
        }
        return { value: () => controls.map((c) => ({ field: c.field, v: c.read ? c.read() : null })), focusEl: body.querySelector("input:not([disabled]), select, button") };
      },
    });
  }

  // ------------------------------------------------ record property cards (editable)
  //
  // Native transclusions are body-only — they never show a record's properties.
  // For each of OUR record embeds we inject a small editable card above the body
  // (record title + property name/value rows). Cards are a decorator: rebuilt on
  // load/navigation (embeds persist across reload) and re-injected by a lazily
  // created, panel-scoped, hot-reload-guarded MutationObserver when a native
  // re-render wipes them. Zero cost when no embeds are open.

  async _onNavigated() {
    if (this._unloaded) return;
    this._scheduleDescCSS(); // a new page's lines just entered the model
    // Close any UI tied to the page we just left — UNCONDITIONALLY (previously only
    // the zero-embed branch cleaned up, so programmatic navigation to a page that
    // also had embeds left the nav key-handler armed for a gone card, and an open
    // popup floating over the new page, still writing on Enter).
    if (this._activeEdit) { try { this._activeEdit.cancel(); } catch (e) {} this._activeEdit = null; }
    this._exitCardNav();
    this._closeCardPopup();
    this._removeAllCardEls();
    this._cards.clear();
    this._queryEmbeds.clear();
    this._lineEmbeds.clear();
    await this._indexEmbeds();
    if (this._unloaded) return;
    if (this._cards.size || this._queryEmbeds.size || this._lineEmbeds.size) {
      this._ensureCardObserver();
      this._reattachAllCards();
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
    // Never re-render mid-edit (would wipe an open inline input / picker). LATCH the
    // request — the editor's close paths flush it. (A self-rescheduling timer here
    // sustained a 2.5Hz loop for as long as a popup sat open.)
    if (this._cardEditing) { this._discoverPending = refreshPresent || this._discoverPending || false; return; }
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
    // Add cards for newly-seen embeds, and SILENT-refresh existing ones so that
    // switching back to this client (or a remote property change) shows current
    // values even when the card wasn't wiped (a prop change doesn't re-render the
    // transclusion body). Silent = no loading flash; nav cursor re-lands via the
    // _renderCardInto resume/paint path.
    for (const [lineGuid, f] of found) {
      if (this._commitOwned(lineGuid)) continue; // its commit poll owns this card
      const entry = this._cards.get(lineGuid);
      if (!entry) { this._cards.set(lineGuid, { recordGuid: f.ref, line: f.line }); this._attachPropCard(lineGuid, f.ref); }
      else {
        if (!entry.line) entry.line = f.line; // backfill for collapse support
        if (refreshPresent) this._refreshCardInPlace(lineGuid, entry.recordGuid);
        else if (!(entry.cardEl && entry.cardEl.isConnected)) {
          const esc = (window.CSS && CSS.escape) ? CSS.escape(lineGuid) : lineGuid;
          if (!document.querySelector("." + this._CARD_CLASS + '[data-refx-for="' + esc + '"]')) this._attachPropCard(lineGuid, entry.recordGuid, true);
        }
      }
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

  _reattachAllCards() {
    for (const [lineGuid, e] of this._cards) this._attachPropCard(lineGuid, e.recordGuid);
  }

  // Build {fieldId -> PROP_TYPE} from every collection's config schema. ASYNC —
  // data.getAllCollections() returns a Promise (a sync call silently yields nothing;
  // that's why empty dates kept opening a text editor). Kicked off in onLoad, ready
  // long before any card is edited. Also indexes by label as a fallback, but only
  // labels whose type is unambiguous across all collections.
  async _buildFieldTypes() {
    const map = {}, byLabel = {}, conflicted = new Set();
    const meta = {}, colByGuid = {};
    try {
      const cols = await (this.data.getAllCollections && this.data.getAllCollections());
      for (const col of cols || []) {
        let cfg = null; try { cfg = col.getConfiguration && col.getConfiguration(); } catch (e) {}
        try { const g = col.getGuid && col.getGuid(); if (g) colByGuid[g] = col; } catch (e) {}
        for (const f of (cfg && cfg.fields) || []) {
          if (!f) continue;
          if (f.id != null) { map[f.id] = f.type; meta[f.id] = { type: f.type, filter_colguid: f.filter_colguid || null, many: !!f.many, read_only: !!f.read_only, icon: f.icon || null, active: f.active !== false }; }
          if (f.label) {
            const lk = "label:" + String(f.label).toLowerCase();
            if (lk in byLabel && byLabel[lk] !== f.type) conflicted.add(lk);
            else byLabel[lk] = f.type;
          }
        }
      }
    } catch (e) {}
    for (const lk of conflicted) delete byLabel[lk];
    Object.assign(map, byLabel);
    this._fieldTypes = map;
    this._fieldMeta = meta;      // fieldId -> {type, filter_colguid} (relation browse list)
    this._colByGuid = colByGuid; // collection guid -> PluginCollectionAPI handle
  }

  // The declared type of a property, from the schema map (see _buildFieldTypes).
  // Works for EMPTY fields, which value-probing can't type. PluginProperty.guid is
  // the field id; falls back to the (unambiguous) label. Null → caller probes.
  _fieldTypeFor(p) {
    const m = this._fieldTypes;
    if (!m || !p) return null;
    if (p.guid != null && m[p.guid]) return m[p.guid];
    // Unknown-but-declared field (has a guid the map doesn't know) → a collection
    // or field was created after load. Self-heal with a debounced background
    // rebuild so it types correctly one interaction later; probe fallback covers
    // this one.
    if (p.guid != null && String(p.guid).length > 10 && !this._fieldTypesRebuildT) {
      this._fieldTypesRebuildT = setTimeout(() => { this._fieldTypesRebuildT = 0; if (!this._unloaded) this._buildFieldTypes(); }, 2000);
    }
    if (p.name) return m["label:" + String(p.name).toLowerCase()] || null;
    return null;
  }

  // Read a record's editable properties (ported from the canvas note-card
  // extractor): schema-typed when the field is declared (works for EMPTY fields),
  // value-probing as fallback; format for display, cap at 8. Each probe is
  // isolated — property reads throw on unresolved records.
  _recCardFields(rec) {
    const out = [];
    const prefs = this._cardPrefs();
    let props = [];
    try { props = (rec.getAllProperties && rec.getAllProperties()) || []; } catch (e) {}
    for (const p of props) {
      const name = p && p.name;
      if (!name || this._CARD_SKIP.has(name)) continue;
      if (!this._isUserField(p)) continue; // mirror native: no system/deleted fields
      if (prefs.mode === "custom" && prefs.hidden.has(name)) continue; // checklist applies ONLY in Custom
      let kind = "text", choices = null, value = "", display = "", fileValue = null;
      const ft = this._fieldTypeFor(p);
      if (ft === "choice") { kind = "choice"; try { choices = ((p.choices && p.choices()) || []).map((c) => ({ id: c.id, label: c.label, color: c.color, icon: c.icon || null })); } catch (e) { choices = []; } }
      else if (ft === "file" || ft === "image" || ft === "banner") kind = "file";
      else if (ft === "datetime") kind = "date";
      else if (ft === "record") kind = "relation";
      else if (ft === "number") kind = "number";
      else if (ft === "text" || ft === "url") kind = "text";
      else {
        // Unknown/undeclared (system props) → probe by value, as before.
        try { const ch = p.choices && p.choices(); if (ch && ch.length) { kind = "choice"; choices = ch.map((c) => ({ id: c.id, label: c.label, color: c.color, icon: c.icon || null })); } } catch (e) {}
        if (kind === "text") { try { const d = p.date && p.date(); if (d instanceof Date) kind = "date"; } catch (e) {} }
        if (kind === "text") { try { const lr = p.linkedRecords && p.linkedRecords(); if (lr && lr.length) kind = "relation"; } catch (e) {} }
        if (kind === "text") {
          // p.number() COERCES a leading-digit text value ("26-002-BHP" → 26), which
          // wrongly types a text field (a code/ID/title) as a number and shows the
          // truncated digits. Only treat as a number when the text form is empty or
          // a clean numeric string. (Confirmed: Title "26-002-BHP" displayed as 26.)
          try {
            const n = p.number && p.number();
            if (typeof n === "number") {
              let tv = null; try { tv = p.text && p.text(); } catch (e) {}
              if (tv == null || tv === "" || (typeof tv === "string" && /^\s*-?\d+(?:\.\d+)?\s*$/.test(tv))) kind = "number";
            }
          } catch (e) {}
        }
      }
      try {
        if (kind === "choice") value = (p.choiceLabel && p.choiceLabel()) || "";
        else if (kind === "date") {
          const d = p.date();
          if (d) {
            value = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
            // Read the RAW stored value for the pill text — p.datetime().value()
            // RECONSTRUCTS the value and drops `formatted`, which is exactly where
            // granular pills ("Week 28", "Q3 2026") live. p.values()[0] is the
            // stored object verbatim: {d, r?, t?, formatted?}.
            let fmt = "", hasTime = false, rawv = null;
            try { const vs = p.values && p.values(); rawv = vs && vs[0]; } catch (e) {}
            if (rawv && typeof rawv === "object") {
              fmt = rawv.formatted || "";
              hasTime = !!(rawv.t && rawv.t.t);
              // Granular/ranged value without a stored label → synthesize native text.
              if (!fmt && rawv.r && rawv.r.d) fmt = this._synthDateLabel(rawv.d, rawv.r.d, null) || "";
            }
            if (hasTime) value += " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
            display = fmt || this._fmtDateDisplay(value) || value;
          } else value = "";
        }
        else if (kind === "number") { const n = p.number && p.number(); value = (n == null ? "" : n); }
        else if (kind === "file") {
          let fv = null; try { const vs = p.values && p.values(); fv = vs && vs[0]; } catch (e2) {}
          if (fv && typeof fv === "object") { value = fv.name || "file"; fileValue = fv; }
          else value = "";
        }
        else if (kind === "relation") {
          var relRecs = (p.linkedRecords && p.linkedRecords()) || [];
          var relParts = relRecs.map((r) => (r && r.getName && r.getName()) || "").filter(Boolean);
          var relIcons = relRecs.map((r) => this._iconForRecord(r));
          var relGuids = relRecs.map((r) => { try { return (r._getRow && r._getRow().guid) || null; } catch (e2) { return null; } });
          value = relParts.join(", ");
          // linkedRecords() returns [] for stored-but-unresolved relations AND for
          // legacy plain-text values in a record prop (e.g. Lead = "Svy"). Fall back
          // to the RAW values() and normalize: guid → record name, text → as-is.
          if (!value) {
            let raw = null; try { raw = p.values && p.values(); } catch (e2) {}
            const parts = [], icons2 = [], guids2 = [];
            for (let v of raw || []) {
              if (typeof v === "string" && v.trim().charAt(0) === "[") { try { v = JSON.parse(v); } catch (e2) {} }
              for (const x of (Array.isArray(v) ? v : [v])) {
                if (typeof x === "string" && x) {
                  const r2 = /^[0-9A-Z]{20,}$/.test(x) ? this.data.getRecord(x) : null;
                  if (r2 && r2.getName && r2.getName()) { parts.push(r2.getName()); icons2.push(this._iconForRecord(r2)); guids2.push(x); }
                  else { parts.push(x); icons2.push(null); guids2.push(null); }
                } else if (x && typeof x === "object") {
                  const g = x.guid || (x.getGuid && x.getGuid());
                  const r2 = g ? this.data.getRecord(g) : null;
                  if (r2 && r2.getName && r2.getName()) { parts.push(r2.getName()); icons2.push(this._iconForRecord(r2)); guids2.push(g); }
                }
              }
            }
            relParts = parts.filter(Boolean);
            relIcons = icons2;
            relGuids = guids2;
            value = relParts.join(", ");
          }
        }
        else value = (p.text && p.text()) || "";
      } catch (e) {}
      // Per-value {text, icon} for relation/choice pills (native renders one pill
      // per value with the target's collection icon; splitting the joined display
      // on ", " would break names containing commas).
      let pills = null;
      if (kind === "relation" && typeof relParts !== "undefined" && relParts && relParts.length) {
        pills = relParts.map((t, i) => ({ t, icon: (typeof relIcons !== "undefined" && relIcons && relIcons[i]) || null, guid: (typeof relGuids !== "undefined" && relGuids && relGuids[i]) || null }));
      } else if (kind === "choice" && value) {
        // Carry the chosen option's palette color + icon so the pill renders like
        // native (colored enum pill) instead of always-zinc.
        const co = (choices || []).find((c) => c.label === value) || null;
        let cic = (co && co.icon) || null;
        if (cic && String(cic).indexOf("ti-") !== 0) cic = "ti-" + cic;
        pills = [{ t: String(value), icon: cic, guid: null, color: co ? co.color : null }];
      }
      out.push({ name, id: p.guid || null, kind, value, display: display || "", choices, pills, file: fileValue || null });
      if (out.length >= 32) break; // sanity cap — stop PROBING too, not just slicing
    }
    let res = out.filter((p) => p && p.name);
    if (prefs.mode === "filled") res = res.filter((f) => !(f.value === "" || f.value == null));
    return res.slice(0, 32);
  }

  // Mirror the native property pane's field set: USER-DEFINED collection fields
  // have generated ids ("F" + uppercase alphanumerics, e.g. F35H0RTXPMHK1ZM);
  // system fields carry lowercase ids (title, collection, banner, icon,
  // updated_at, …) and never render in the native pane. Deleted fields get
  // relabeled "Deleted (…)" — hide those too, exactly like native.
  _isUserField(p) {
    const id = String((p && p.guid) || "");
    if (!/^F[0-9A-Z]{8,}$/.test(id)) return false;
    const name = String((p && p.name) || "");
    if (/^Deleted\s*\(/.test(name)) return false;
    // Native's property pane hides ARCHIVED fields (schema `active:false`) — e.g. a
    // retired "Seeds" field still kept in the collection config. getAllProperties()
    // returns them anyway (sometimes duplicated by label), so mirror native and drop
    // them. Fail-open when the schema map isn't built yet (self-heals next render).
    const meta = this._fieldMeta && id ? this._fieldMeta[id] : null;
    if (meta && meta.active === false) return false;
    return true;
  }

  // ---- Properties chooser (like the native "Properties · All ⌄" row) ----

  _cardPrefs() {
    // localStorage, NOT plugin config: saveConfiguration makes Thymer RELOAD the
    // whole plugin (verified live — that reload tore down every card and was THE
    // view-change jump). Per-client persistence is fine for a view preference.
    // Modes: "all" = every user field, ALWAYS · "filled" = non-empty, ALWAYS ·
    // "custom" = the user's own checklist (the only mode where `hidden` applies —
    // a hidden set leaking into All meant "All" lied).
    let c = {};
    try { c = JSON.parse(localStorage.getItem("refx-card-prefs") || "{}") || {}; } catch (e) {}
    const mode = (c.mode === "filled" || c.mode === "custom") ? c.mode : "all";
    return { mode, hidden: new Set(Array.isArray(c.hidden) ? c.hidden : []) };
  }

  async _applyCardPrefs(mode, hidden, keepOpen) {
    try { localStorage.setItem("refx-card-prefs", JSON.stringify({ mode, hidden: [...hidden] })); } catch (e) {}
    // Scroll strategy (measured live): the browser's own scroll anchoring keeps
    // the viewport visually still through the card's height change — DON'T fight
    // it with scrollTop restores (that caused the jump). Shrinks land pixel-
    // stable; growth leaves a ~10px residue from post-anchoring settle, so take
    // ONE gentle correction at the end, anchored on a line the user actually
    // SEES: remember a visible line's viewport offset, and after everything
    // settles nudge its scroller by the drift.
    let anchor = null;
    try {
      const vh = window.innerHeight;
      const it = [...document.querySelectorAll(".listitem")].find((el) => { const r = el.getBoundingClientRect(); return r.top >= 80 && r.top < vh - 120 && r.height > 8; });
      if (it && it.getAttribute("data-guid")) anchor = { guid: it.getAttribute("data-guid"), top: it.getBoundingClientRect().top };
    } catch (e) {}
    if (!keepOpen) this._closeCardPopup();
    await Promise.all([...this._cards].map(([lg, e]) => this._renderFreshCard(lg, e.recordGuid, true)));
    if (anchor) {
      setTimeout(() => {
        try {
          const esc = (window.CSS && CSS.escape) ? CSS.escape(anchor.guid) : anchor.guid;
          const el = document.querySelector('.listitem[data-guid="' + esc + '"]');
          if (!el) return;
          const d = el.getBoundingClientRect().top - anchor.top;
          const sc = el.closest(".panel-scroller-y");
          if (sc && Math.abs(d) > 3) sc.scrollTop += d;
        } catch (e) {}
      }, 650);
    }
  }

  // Popup mirroring the native property chooser: a "View properties ..." filter
  // field, view modes (Filled in / All / Custom), then a per-property checklist.
  // The checkmarks SHOW WHAT THE CARD CURRENTLY SHOWS; toggling a field switches
  // to Custom seeded from the current view, so "All" always means all.
  _openPropsChooser(rec, lineGuid, anchorEl) {
    const pop = this._el("div", "refalias-pop refx-cardpop refx-propchooser");
    const inp = this._el("input", "refalias-input");
    inp.placeholder = "View properties ...";
    const list = this._el("div", "refalias-results");

    // The record's user fields + emptiness (drives "what shows" per mode). Read
    // through _recCardFields UNFILTERED by briefly pinning prefs to "all" — one
    // source of truth for field typing/values, no duplicated probing logic.
    let fields = [];
    try {
      const saved = localStorage.getItem("refx-card-prefs");
      localStorage.setItem("refx-card-prefs", JSON.stringify({ mode: "all", hidden: [] }));
      const allFields = this._recCardFields(rec);
      if (saved != null) localStorage.setItem("refx-card-prefs", saved); else localStorage.removeItem("refx-card-prefs");
      fields = allFields.map((f) => ({ name: f.name, empty: f.value === "" || f.value == null }));
    } catch (e) {}

    const visibleNow = () => {
      const p = this._cardPrefs();
      return new Set(fields.filter((f) => {
        if (p.mode === "filled") return !f.empty;
        if (p.mode === "custom") return !p.hidden.has(f.name);
        return true;
      }).map((f) => f.name));
    };

    const rebuild = () => {
      list.innerHTML = "";
      const p = this._cardPrefs();
      const vis = visibleNow();
      const addRow = (label, checked, cb, isMode) => {
        const r = this._el("div", "refalias-result");
        if (isMode) r.dataset.mode = "1";
        const chk = this._el("span", "refx-chk ti " + (checked ? "ti-check" : ""));
        r.append(chk, this._el("span", "refx-chooser-lbl", label));
        r.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); cb(); });
        list.append(r);
      };
      addRow("Filled in", p.mode === "filled", () => { this._applyCardPrefs("filled", p.hidden, true); rebuild(); }, true);
      addRow("All", p.mode === "all", () => { this._applyCardPrefs("all", p.hidden, true); rebuild(); }, true);
      addRow("Custom", p.mode === "custom", () => { this._applyCardPrefs("custom", p.hidden, true); rebuild(); }, true);
      list.append(this._el("div", "refx-chooser-sep"));
      const q = (inp.value || "").toLowerCase();
      for (const f of fields) {
        if (q && !f.name.toLowerCase().includes(q)) continue;
        addRow(f.name, vis.has(f.name), () => {
          // Toggling a field = switch to Custom, seeded from what's visible NOW.
          const want = visibleNow();
          if (want.has(f.name)) want.delete(f.name); else want.add(f.name);
          const hidden = new Set(fields.map((x) => x.name).filter((n) => !want.has(n)));
          this._applyCardPrefs("custom", hidden, true);
          rebuild();
        });
      }
    };
    inp.addEventListener("input", rebuild);
    rebuild();
    pop.append(inp, list);
    this._openCardPopup(pop, anchorEl, {}); // default: focuses the input → arrows/Enter/Esc work
  }


  _buildPropCard(rec, fields, lineGuid) {
    const card = this._el("div", this._CARD_CLASS);
    card.append(this._el("div", "refx-propcard-title", (rec.getName && rec.getName()) || "Untitled"));
    // "Properties · All ⌄" chooser row, structured like the native pane header
    // (muted label · mode chip).
    const head = this._el("div", "refx-props-header");
    head.append(this._el("span", null, "Properties"), this._el("span", null, "·"));
    const mode = this._el("span", "refx-props-mode");
    const m0 = this._cardPrefs().mode;
    mode.append(document.createTextNode(m0 === "filled" ? "Filled in" : (m0 === "custom" ? "Custom" : "All")));
    const car = this._el("span", "ti ti-selector");
    mode.append(car);
    const openCh = (e) => { e.preventDefault(); e.stopPropagation(); this._openPropsChooser(rec, lineGuid, head); };
    mode.addEventListener("mousedown", openCh);
    mode.addEventListener("click", openCh);
    head.append(mode);
    card.append(head);
    if (fields.length) {
      // Wrap the rows in the native property-editor containers so Thymer's own
      // row/cell/pill CSS applies (native look, theme-following).
      const wrap = this._el("div", "page-props-editor refx-native-props");
      const props = this._el("div", "id--props");
      for (const f of fields) {
        const row = this._el("div", "refx-propcard-row");
        this._fillPropRow(rec, lineGuid, f, row);
        props.append(row);
      }
      wrap.append(props);
      card.append(wrap);
    } else {
      card.append(this._el("div", "refx-propcard-empty", "No properties"));
    }
    // (No "+ Add content" affordance for an empty body: the empty box itself is
    // a stable-height click-to-type target now, and the vanishing button was
    // its own layout jump. _cardNavItems/keyboard-Enter still handle the class
    // defensively if an old card lingers through a hot reload.)
    return card;
  }

  // ---- keyboard nav of the property card (class-based cursor, like native) ----

  // The card's nav cells in DOM order: property values, then the add-body action.
  _cardNavItems(lineGuid) {
    const esc = (window.CSS && CSS.escape) ? CSS.escape(lineGuid) : lineGuid;
    const card = document.querySelector("." + this._CARD_CLASS + '[data-refx-for="' + esc + '"]');
    if (!card) return [];
    return [...card.querySelectorAll(".refx-propcard-value, .refx-propcard-addbody")];
  }

  _enterCardNav(lineGuid, recordGuid, startIndex) {
    this._exitCardNav(); // idempotent: safe to (re)enter from a resume or fresh trigger
    this._cardNav = { lineGuid, recordGuid, index: startIndex || 0 };
    this._paintCardNav();
    window.addEventListener("keydown", this._onCardNavKey, true);
    window.addEventListener("mousedown", this._cardNavClickAway, true);
    window.__refxCardNavKey = this._onCardNavKey;
    window.__refxCardNavClick = this._cardNavClickAway;
  }

  // Paint the cursor onto the current cell (the DOM class is the source of truth).
  // Re-resolves cells live so it survives a card re-injection; clamps the index.
  // If the card is transiently absent (mid re-render), just skip — DON'T exit nav
  // (a spurious exit here was dropping the cursor after an inline edit); a later
  // render repaints, and genuine collapses exit via _deleteEmbedLine.
  // scroll=true only for explicit arrow navigation; a repaint/resume must NOT
  // scrollIntoView (that yanked the page around after an edit — the "it moves" bug).
  _paintCardNav(scroll) {
    const nav = this._cardNav;
    if (!nav) return;
    const items = this._cardNavItems(nav.lineGuid);
    if (!items.length) return;
    if (nav.index >= items.length) nav.index = items.length - 1;
    if (nav.index < 0) nav.index = 0;
    for (const el of document.querySelectorAll(".refx-nav-focus")) el.classList.remove("refx-nav-focus");
    const cur = items[nav.index];
    cur.classList.add("refx-nav-focus");
    if (scroll) { try { cur.scrollIntoView({ block: "nearest" }); } catch (e) {} }
  }

  _moveCardNav(dir) {
    const nav = this._cardNav;
    if (!nav) return;
    const items = this._cardNavItems(nav.lineGuid);
    if (!items.length) { this._exitCardNav(); return; }
    const next = nav.index + dir;
    if (next < 0) return this._handleCardNavExitUp();
    if (next >= items.length) return this._handleCardNavExitDown();
    nav.index = next;
    this._paintCardNav(true);
  }

  _onCardNavKey = (e) => {
    if (!this._cardNav) return;
    if (this._cardEditing) return; // an editor/popup owns the keyboard
    if (e.key === "ArrowDown") { e.preventDefault(); e.stopImmediatePropagation(); this._moveCardNav(1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); e.stopImmediatePropagation(); this._moveCardNav(-1); return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopImmediatePropagation(); this._activateCardNav(); return; }
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); this._handleCardNavExitUp(); return; }
    // Any other navigation/typing key releases the cursor and passes through.
    this._exitCardNav();
  };

  _cardNavClickAway = (e) => {
    const nav = this._cardNav;
    if (!nav) return;
    const esc = (window.CSS && CSS.escape) ? CSS.escape(nav.lineGuid) : nav.lineGuid;
    const card = document.querySelector("." + this._CARD_CLASS + '[data-refx-for="' + esc + '"]');
    if (card && card.contains(e.target)) return; // click within the card keeps nav
    // A choice/relation popup lives on document.body, outside the card.
    try { if (e.target && e.target.closest && e.target.closest(".refx-cardpop, .refx-pop-backdrop")) return; } catch (e2) {}
    this._exitCardNav();
  };

  _activateCardNav() {
    const nav = this._cardNav;
    if (!nav) return;
    const items = this._cardNavItems(nav.lineGuid);
    const el = items[nav.index];
    if (!el) { this._exitCardNav(); return; }
    if (el.classList.contains("refx-propcard-addbody")) {
      // Empty record → create the first body line and drop the caret into it.
      const lineGuid = nav.lineGuid;
      this._exitCardNav();
      this._addBodyLine(lineGuid);
      return;
    }
    const field = el.dataset && el.dataset.refxField;
    const rec = field && this.data.getRecord(nav.recordGuid);
    if (!field || !rec) { this._exitCardNav(); return; }
    const f = this._recCardFields(rec).find((x) => x.name === field);
    const rowEl = el.closest(".refx-propcard-row");
    if (!f || !rowEl) { this._exitCardNav(); return; }
    // Remember where we are so nav is re-established on the same cell after the
    // edit's card re-render (the edit may clear _cardNav via DOM churn).
    this._cardNavResume = { lineGuid: nav.lineGuid, recordGuid: nav.recordGuid, index: nav.index };
    // Reuse the existing real-input editor (it DOES hold focus).
    this._editCardValue(rec, nav.lineGuid, f, el, rowEl);
  }

  _exitCardNav() {
    this._cardNavResume = null;
    if (!this._cardNav) return;
    this._cardNav = null;
    try { window.removeEventListener("keydown", this._onCardNavKey, true); } catch (e) {}
    try { window.removeEventListener("mousedown", this._cardNavClickAway, true); } catch (e) {}
    window.__refxCardNavKey = null; window.__refxCardNavClick = null;
    for (const el of document.querySelectorAll(".refx-nav-focus")) el.classList.remove("refx-nav-focus");
  }

  // Re-establish the nav cursor on the cell that was being edited, once the card is
  // present again. Robust to _cardNav having been cleared mid-edit — it re-adds the
  // listeners via _enterCardNav. Keeps the stash pending if the card isn't ready
  // yet (e.g. a transient "Loading…" render), so the next full render consumes it.
  _consumeNavResume(lineGuid) {
    const r = this._cardNavResume;
    if (!r) return;
    if (lineGuid && r.lineGuid !== lineGuid) return;
    if (!this._cardNavItems(r.lineGuid).length) return; // card not ready → stay pending
    this._cardNavResume = null;
    this._enterCardNav(r.lineGuid, r.recordGuid, r.index);
  }

  // Exit UP: back onto the reference line above the embed (ArrowUp-from-first, Esc).
  _handleCardNavExitUp() {
    const nav = this._cardNav;
    this._exitCardNav();
    if (nav) this._focusRefLineForEmbed(nav.lineGuid);
  }

  // Exit DOWN past the last value: into the embed's body (mirrors native props→body).
  async _handleCardNavExitDown() {
    const nav = this._cardNav;
    this._exitCardNav();
    if (!nav) return;
    const rec = this.data.getRecord(nav.recordGuid);
    let first = null;
    if (rec) { try { const items = await rec.getLineItems(); first = items && items[0] && items[0].guid; } catch (e) {} }
    if (first) this._focusEmbeddedLine(nav.lineGuid, first, 0);
  }

  // Place the native caret on the reference line owning `embedLineGuid`. The embed
  // line is a child of the ref's block, so the nearest non-transclusion .listitem
  // ancestor is that block; hit-test its text span (same mechanism as the embed).
  _focusRefLineForEmbed(embedLineGuid) {
    try {
      const node = this._transclusionNode(embedLineGuid);
      if (!node) return;
      let li = node.parentElement;
      while (li && li !== document.body) {
        if (li.classList && li.classList.contains("listitem") && !li.classList.contains("listitem-transclusion")) {
          const t = li.querySelector && li.querySelector(".lineitem-text");
          if (t) { this._hitTestCaret(t); return; }
        }
        li = li.parentElement;
      }
    } catch (e) {}
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

  // (Re)render a single property row: label + clickable value (— when empty).
  // NATIVE-LOOK ROWS: reuse Thymer's own property-editor classes so the card rows
  // pick up the exact native styling (typography, spacing, pills) and follow the
  // theme for free. Structure mirrors the real .page-props-row (confirmed live):
  //   .page-props-cell.page-prop-type  → type icon + .prop-label-text
  //   .page-props-cell.page-prop-val   → value (pills / plain text) + hover pencil
  // The refx-* classes stay on the same elements — all nav/edit/refresh code keys
  // off them and is unchanged.
  _fillPropRow(rec, lineGuid, field, rowEl) {
    rowEl.innerHTML = "";
    rowEl.dataset.refxRow = field.name; // maps row → field for in-place refresh
    rowEl.classList.add("page-props-row", "id-prop-row");
    const typeCell = this._el("div", "page-props-cell page-prop-type page-props-cell-fixed-width");
    // Native shows the FIELD's own schema icon (e.g. ti-user on People fields),
    // ti-align-left as default, with an inline 8px margin — mirror it exactly
    // so color/size come from the same native classes.
    const meta = this._fieldMeta && field.id ? this._fieldMeta[field.id] : null;
    let tic = (meta && meta.icon) || null;
    if (tic && String(tic).indexOf("ti-") !== 0) tic = "ti-" + tic;
    const icEl = this._el("span", "ti " + (tic || "ti-align-left"));
    icEl.style.marginRight = "8px";
    typeCell.append(icEl);
    typeCell.append(this._el("span", "prop-label-text refx-propcard-label", field.name));
    rowEl.append(typeCell);

    const empty = field.value === "" || field.value == null;
    const shown = empty ? "" : String(field.display || (field.kind === "date" && this._fmtDateDisplay(field.value)) || field.value);
    const valCell = this._el("div", "page-props-cell page-prop-val");
    const val = this._el("span", "refx-propcard-value" + (empty ? " refx-propcard-empty" : ""));
    this._renderValContent(rec, val, field, empty, shown);
    if (!empty) val.title = shown;
    // Keyed by name so the keyboard-nav cursor + in-place refresh can re-derive
    // the field (the row itself is keyed via rowEl.dataset.refxRow above).
    val.dataset.refxField = field.name;
    // Open the editor on mousedown OR click (whichever the environment delivers
    // first); _editCardValue no-ops if an editor is already open, so no double.
    const open = (e) => { e.preventDefault(); e.stopPropagation(); this._editCardValue(rec, lineGuid, field, val, rowEl); };
    val.addEventListener("mousedown", open);
    val.addEventListener("click", open);
    valCell.addEventListener("mousedown", open); // blank cell area edits too (native empties are blank)
    valCell.addEventListener("click", open);
    valCell.append(val);
    // Native-style hover pencil as the edit affordance (empties render blank).
    valCell.append(this._el("span", "refx-propcard-pencil ti ti-pencil"));
    rowEl.append(valCell);
  }

  // Render a value span's CONTENT the way the native property pane does:
  // Thymer's own choice palette, extracted verbatim from the app bundle (the
  // `It` table + `zr()` default): a choice's `color` is an INDEX into this list;
  // missing/out-of-range → 13 = zinc, the native default gray. NOTE the order is
  // NOT the CSS var declaration order (that would map 13 to rose — wrong).
  _ENUM_PALETTE = ["red", "orange", "green", "cyan", "blue", "purple", "pink", "fuchsia", "rose", "stone", "teal", "sky", "indigo", "zinc", "yellow"];
  _enumClass(color) {
    const n = Number(color);
    return (color != null && color !== "" && Number.isFinite(n) && this._ENUM_PALETTE[n]) || "zinc";
  }

  // relation/choice → one pill per value (native .prop-status chip, enum colors,
  // the target's collection icon leading — native markup verbatim);
  // date/text/number → plain text. Empty → blank (native shows nothing).
  // The display string is stashed on the span so refresh can no-op cheaply.
  _renderValContent(rec, val, field, empty, display) {
    val.dataset.refxDisplay = display || "";
    val.innerHTML = "";
    if (empty) return;
    if (field.kind === "file") return this._renderFileValue(rec, val, field);
    if (field.kind === "relation" || field.kind === "choice") {
      let parts = (field.pills && field.pills.length) ? field.pills : null;
      // An OPTIMISTIC row update clones the field with a NEW value but the OLD
      // pills (built for the previous value) — the pill then showed the stale
      // label until the write propagated. For choice, re-derive the pill from
      // the shown label (color+icon come from field.choices, which is current).
      if (field.kind === "choice" && (!parts || parts.length !== 1 || String(parts[0].t) !== display)) {
        const co = (field.choices || []).find((c) => c.label === display) || null;
        let cic = (co && co.icon) || null;
        if (cic && String(cic).indexOf("ti-") !== 0) cic = "ti-" + cic;
        parts = [{ t: display, icon: cic, guid: null, color: co ? co.color : null }];
      }
      if (!parts) parts = [{ t: display, icon: null }];
      const host = parts.length > 1 ? this._el("span", "prop-multi-values") : val;
      for (const p of parts) {
        const chip = this._el("span", "prop-status prop-status-record");
        const en = this._enumClass(p.color); // relations carry no color → zinc, like native record chips
        chip.style.backgroundColor = "var(--enum-" + en + "-bg)";
        chip.style.color = "var(--enum-" + en + "-fg)";
        if (p.icon) { const ic = this._el("span", "ti " + p.icon); ic.style.marginRight = "5px"; chip.append(ic); }
        chip.append(document.createTextNode(p.t != null ? p.t : String(p)));
        // Native record chips end with a clickable ↗ that opens the record (this is
        // also what gives native chips their height — the arrow is the tallest part).
        if (p.guid) {
          const ar = this._el("span", "link-menu-opener ti ti-arrow-up-right refx-chip-arrow");
          // Native arrows carry these data attrs; if Thymer's link-menu handling is
          // event-delegated, our arrows inherit the full native hover menu ("Open in
          // other panel" etc.) for free. Our own click nav stays as the guaranteed
          // baseline (same destination, so a double-handle is harmless).
          ar.setAttribute("data-mode", "link");
          ar.setAttribute("data-guid", p.guid);
          ar.setAttribute("data-padding", "3px");
          const go = (e) => { e.preventDefault(); e.stopPropagation(); this._openRecord(p.guid); };
          ar.addEventListener("mousedown", go);
          ar.addEventListener("click", go);
          chip.append(ar);
        }
        host.append(chip);
      }
      if (host !== val) val.append(host);
    } else {
      // Plain values (dates, text, numbers) get the native plain-value class so
      // size/typography match the real pane exactly and track the theme.
      const span = this._el("span", "prop-status prop-status-0p", display);
      // A URL opens on CLICK of the text itself, like native — no extra chrome.
      // Editing stays on the pencil / the rest of the cell. (An earlier ↗ badge
      // reused link-menu-opener, which dragged in Thymer's big hover menu.)
      if (/^https?:\/\/\S+$/i.test(display)) {
        span.classList.add("refx-url-value");
        span.title = display;
        span.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
        span.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); try { window.open(display, "_blank"); } catch (err) {} });
      }
      val.append(span);
    }
  }

  // File/image property (native shows the image inline; we showed
  // "[object Object]"). imgData/imgUrl render at once; a blob GUID resolves
  // async via prop.fileBlob().download() into a cached object URL — a
  // paperclip+filename chip shows meanwhile and stays for non-image files.
  _renderFileValue(rec, val, field) {
    const fv = field.file;
    const name = (fv && fv.name) || "file";
    const chip = () => {
      val.innerHTML = "";
      const s = this._el("span", "prop-status prop-status-0p");
      s.append(this._el("span", "ti ti-paperclip refx-file-ico"));
      s.append(document.createTextNode(name));
      val.append(s);
    };
    const showImg = (src) => {
      val.innerHTML = "";
      const img = this._el("img", "refx-propcard-img");
      img.alt = name; img.title = name; img.src = src;
      // Native anatomy: click = edit (file picker); right-click = image menu.
      img.addEventListener("contextmenu", (e) => {
        e.preventDefault(); e.stopPropagation();
        this._openImageMenu(rec, val, field, img, name, src);
      });
      val.append(img);
    };
    if (!fv) return chip();
    if (fv.imgData) return showImg(fv.imgData);
    if (fv.imgUrl) return showImg(fv.imgUrl);
    if (!fv.guid) return chip();
    const cached = this._blobUrls.get(fv.guid);
    if (cached) return cached.url ? showImg(cached.url) : chip();
    chip(); // instant; upgraded below when the blob resolves as an image
    (async () => {
      try {
        const p = rec.prop(field.name);
        const blob = p && p.fileBlob && await p.fileBlob();
        if (!blob) return;
        const isImage = /^image\//i.test(blob.contentType || "") || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(blob.fileName || "");
        if (!isImage) { this._blobUrls.set(fv.guid, { url: null }); return; }
        const buf = await blob.download();
        if (!buf) return;
        const url = URL.createObjectURL(new Blob([buf], { type: blob.contentType || "image/*" }));
        this._blobUrls.set(fv.guid, { url });
        if (val.isConnected) showImg(url);
      } catch (e) {}
    })();
  }

  // Replace/add the image on a file property: OS file picker -> uploadBlob ->
  // setFileFromBlob (the SDK's supported write path), then force-refresh the
  // row (same filename must still swap the pixels, so bypass the display
  // dedupe). Native's own "Pick a file" dialog isn't reachable from a plugin.
  _editFileValue(rec, lineGuid, field, valEl, rowEl) {
    const input = this._el("input", "");
    input.type = "file";
    // image/banner fields want images; a plain file field accepts anything
    const mt = this._fieldMeta && field.id ? this._fieldMeta[field.id] : null;
    if (!(mt && mt.type === "file")) input.accept = "image/*";
    input.style.display = "none";
    document.body.append(input);
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      try {
        const blob = await this.data.uploadBlob(file);
        if (!blob) return this._toast("Upload failed.");
        const p = rec.prop(field.name);
        const ok = p && p.setFileFromBlob && p.setFileFromBlob(blob);
        if (!ok) return this._toast("Couldn't set the file property.");
        this._commitClaim(lineGuid);
        setTimeout(() => {
          this._commitRelease(lineGuid);
          try {
            const fresh = this._recCardFields(rec).find((x) => x.name === field.name);
            const row = rowEl && rowEl.isConnected ? rowEl : null;
            if (fresh) { if (valEl) valEl.dataset.refxDisplay = "\u0000"; this._applyRowValue(rec, lineGuid, fresh, row); }
          } catch (e) {}
        }, 500);
      } catch (e) { this._toast("Upload failed."); }
    });
    input.click();
  }

  // Right-click menu on a file-property image: Open image (in-app lightbox),
  // Download, Delete. ("Open to the right" needs Thymer's internal image-panel
  // routing, which no plugin API reaches — deliberately left out.)
  _openImageMenu(rec, valEl, field, img, name, src) {
    const lineGuid = (valEl.closest("." + this._CARD_CLASS) || {}).dataset ? (valEl.closest("." + this._CARD_CLASS).dataset.refxFor || null) : null;
    const pop = this._el("div", "refalias-pop refx-cardpop refx-imgmenu");
    const item = (icon, label, fn, cls) => {
      const r = this._el("div", "refalias-result" + (cls ? " " + cls : ""));
      r.append(this._el("span", "refx-opt-ico ti " + icon));
      r.append(this._el("span", "refalias-result-text", label));
      r.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); this._closeCardPopup(); fn(); });
      pop.append(r);
    };
    item("ti-arrow-up-right", "Open image", () => this._openLightbox(src, name));
    item("ti-download", "Download", () => {
      const a = this._el("a", "");
      a.href = src; a.download = name || "image";
      document.body.append(a); a.click(); a.remove();
    });
    item("ti-trash", "Delete", () => {
      if (lineGuid) this._commitClaim(lineGuid);
      let p = null; try { p = rec.prop(field.name); } catch (e) {}
      if (!p) return;
      // The ONLY clear that lands on a file property is removeValue(value) —
      // set("")/set([])/set(null)/setFile(null)/removeValueAt all silently
      // no-op (verified live against a real Poster).
      try { const vs = (p.values && p.values()) || []; for (const v of vs) { try { p.removeValue(v); } catch (e2) {} } } catch (e) {}
      if (lineGuid) this._commitRefreshRow(rec, lineGuid, field, field.value, null, "", "", null);
    }, "refx-cardpop-clear");
    this._openCardPopup(pop, img, { focusInput: false });
  }

  // Minimal in-app lightbox: full image on a dimmed backdrop, click/Esc closes.
  _openLightbox(src, name) {
    const wrap = this._el("div", "refx-lightbox");
    const img = this._el("img", "");
    img.src = src; img.alt = name || "";
    wrap.append(img);
    const close = () => { try { wrap.remove(); } catch (e) {} window.removeEventListener("keydown", onKey, true); };
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
    wrap.addEventListener("mousedown", (e) => { e.preventDefault(); close(); });
    window.addEventListener("keydown", onKey, true);
    document.body.append(wrap);
  }

  // Open a record in the active panel (the chip arrow's action, like native).
  _openRecord(guid) {
    try {
      const p = this.ui.getActivePanel && this.ui.getActivePanel();
      const ws = (window.g_universe && window.g_universe.workspaceGuid) || null;
      if (p && p.navigateTo) p.navigateTo({ type: "edit_panel", rootId: guid, subId: null, workspaceGuid: ws, state: { positions: [guid, "empty-" + guid, 0, "L"] } });
    } catch (e) {}
  }

  // The icon shown in a native record pill = the record's OWN icon (the "Icon"
  // system property, e.g. ti-check on a Done status record — verified live);
  // fall back to its collection's icon when the record has none set.
  _iconForRecord(rec) {
    let ic = null;
    try { const ip = rec && rec.prop && rec.prop("Icon"); const t = ip && ip.text && ip.text(); if (t && typeof t === "string") ic = t.trim(); } catch (e) {}
    if (!ic) {
      try {
        const row = rec && rec._getRow && rec._getRow();
        const pg = row && row.pguid;
        const col = pg && this._colByGuid && this._colByGuid[pg];
        if (col) { const cfg = col.getConfiguration && col.getConfiguration(); ic = (cfg && cfg.icon) || null; }
      } catch (e) {}
    }
    if (!ic) return null;
    return String(ic).indexOf("ti-") === 0 ? ic : "ti-" + ic;
  }


  // Update ONE row's value IN PLACE — no card teardown/rebuild, so editing a value
  // doesn't flicker the whole card. Handles the value-span-present case
  // (choice/relation/number/date) and the input-present case (a text edit just
  // committed → swap the <input> back to a value span). Preserves the nav cursor
  // class if it's on the span (we set textContent, we don't replace the node).
  // Display `field` (with its .value) in the row — caller passes the value to show
  // (a known optimistic value, or a freshly re-read one). Never re-reads itself.
  _applyRowValue(rec, lineGuid, field, rowEl) {
    // Robust to a stale/detached rowEl: re-find the current row for this field.
    if (!rowEl || !rowEl.isConnected) {
      const esc = (window.CSS && CSS.escape) ? CSS.escape(lineGuid) : lineGuid;
      const card = document.querySelector("." + this._CARD_CLASS + '[data-refx-for="' + esc + '"]');
      rowEl = card ? [...card.querySelectorAll(".refx-propcard-row")].find((r) => r.dataset.refxRow === field.name) : null;
      if (!rowEl) return;
    }
    const empty = field.value === "" || field.value == null;
    const display = empty ? "" : String(field.display || (field.kind === "date" && this._fmtDateDisplay(field.value)) || field.value);
    let val = rowEl.querySelector(".refx-propcard-value");
    if (val) {
      // Skip no-op writes: a DOM swap is a mutation the body observer wakes on —
      // a refresh pass over unchanged rows would otherwise amplify into observer
      // callbacks for nothing. The last-rendered display is stashed on the span.
      if (val.dataset.refxDisplay !== display) this._renderValContent(rec, val, field, empty, display);
      if (val.classList.contains("refx-propcard-empty") !== empty) val.classList.toggle("refx-propcard-empty", empty);
      if (empty) { if (val.hasAttribute("title")) val.removeAttribute("title"); } else if (val.title !== display) val.title = display;
      if (val.dataset.refxField !== field.name) val.dataset.refxField = field.name;
    } else {
      // The open editor is an <input> (number) OR a <textarea> (text) — match
      // both, else a committed/cancelled text edit left its <textarea> stranded
      // beside the new value span (and the row looked wedged).
      const input = rowEl.querySelector("input, textarea");
      val = this._el("span", "refx-propcard-value" + (empty ? " refx-propcard-empty" : ""));
      this._renderValContent(rec, val, field, empty, display);
      val.dataset.refxField = field.name;
      if (!empty) val.title = display;
      const open = (e) => { e.preventDefault(); e.stopPropagation(); this._editCardValue(rec, lineGuid, field, val, rowEl); };
      val.addEventListener("mousedown", open);
      val.addEventListener("click", open);
      const cell = rowEl.querySelector(".page-prop-val") || rowEl;
      if (input) input.replaceWith(val);
      else { const pen = cell.querySelector(".refx-propcard-pencil"); if (pen) cell.insertBefore(val, pen); else cell.append(val); }
    }
  }

  // Smoothly reflect a just-written value with NO card teardown:
  //   1) optimistically show `optimistic` immediately (instant, no flicker/lag), then
  //   2) poll until the async write propagates and re-apply the confirmed value.
  // The row is updated in place both times; the nav cursor is re-established after.
  // NOTE: every caller pre-arms _commitClaim(lineGuid) BEFORE its write (so the
  // write's synchronous record.updated is already gated); this poll RELEASES that
  // claim exactly once when it settles. Do not claim again here.
  _commitRefreshRow(rec, lineGuid, field, prevValue, rowEl, optimistic, optimisticDisplay, optimisticPills) {
    if (arguments.length >= 6) {
      // Replace `display` — the old one belongs to the PREVIOUS value. Callers that
      // know the native formatted text (typed granular dates) pass it; otherwise
      // the date-kind fallback formatter in _applyRowValue keeps it native-looking.
      // Also replace `pills` (they were built for the previous value): the relation
      // editor passes fresh ones from its own state; otherwise null lets
      // _renderValContent re-derive (choice) or fall back to the display text.
      this._applyRowValue(rec, lineGuid, Object.assign({}, field, { value: optimistic, display: optimisticDisplay || "", pills: optimisticPills || null }), rowEl);
      this._consumeNavResume(lineGuid);
    }
    const hasOpt = arguments.length >= 6;
    let n = 0;
    const tick = () => {
      if (!this._cards.has(lineGuid)) { this._commitRelease(lineGuid); return; }
      // Never repaint while an editor is open — replacing a focused <input> fires
      // no blur in Chromium, so its commit/cancel would never run and _cardEditing
      // would wedge true (bricking all card editing). The editor's own close path
      // repaints; we just hand ownership back.
      if (this._cardEditing) { this._commitRelease(lineGuid); return; }
      let fresh = null;
      try { fresh = this._recCardFields(rec).find((x) => x.name === field.name) || null; } catch (e) {}
      const cur = fresh ? fresh.value : null;
      const propagated = String(cur) !== String(prevValue);
      if (propagated || n >= 8) {
        // On a slow write that never propagated within the poll window, do NOT
        // repaint the still-stale read — keep the optimistic (known) value, and
        // schedule one deferred silent refresh to pick up the confirmed/formatted
        // value once it lands.
        const show = (propagated || !hasOpt) ? (fresh || field) : Object.assign({}, field, { value: optimistic, display: "", pills: optimisticPills || null });
        this._applyRowValue(rec, lineGuid, show, rowEl);
        this._consumeNavResume(lineGuid);
        this._commitRelease(lineGuid);
        if (!propagated || !(fresh && fresh.display)) {
          const rg = (this._cards.get(lineGuid) || {}).recordGuid;
          if (rg) setTimeout(() => { if (this._cards.has(lineGuid)) this._refreshCardInPlace(lineGuid, rg); }, 1200);
        }
        return;
      }
      n++; setTimeout(tick, 80);
    };
    tick();
  }

  // Refresh a card's values IN PLACE (no teardown → no flicker) when its record
  // changed. Updates the title + each field's row, matching rows BY NAME. Crucially
  // it NEVER removes/rebuilds the card node — an earlier "structure mismatch → full
  // rebuild" fallback was the real flicker source: the rebuild replaced the node,
  // which then made the keep-alive observer + discovery see a "missing" card and
  // pile on with loading-flash rebuilds (and the value lagged a step because each
  // rebuild read pre-propagation data). A genuinely-absent/loading card still gets a
  // fresh build; a truly changed field SET just won't show the new field until the
  // next expand (rare). Skipped while editing / during a commit poll.
  _refreshCardInPlace(lineGuid, recordGuid) {
    if (this._cardEditing) return;
    if (this._commitOwned(lineGuid)) return; // its own commit poll owns the refresh
    const esc = (window.CSS && CSS.escape) ? CSS.escape(lineGuid) : lineGuid;
    const card = document.querySelector("." + this._CARD_CLASS + '[data-refx-for="' + esc + '"]');
    if (!card || card.classList.contains("refx-propcard-loading")) { this._renderFreshCard(lineGuid, recordGuid, true); return; }
    const rec = this.data.getRecord(recordGuid);
    if (!rec) return;
    let fields; try { fields = this._recCardFields(rec); } catch (e) { return; }
    const titleEl = card.querySelector(".refx-propcard-title");
    if (titleEl) { const nm = (rec.getName && rec.getName()) || "Untitled"; if (titleEl.textContent !== nm) titleEl.textContent = nm; }
    for (const f of fields) {
      const row = [...card.querySelectorAll(".refx-propcard-row")].find((r) => r.dataset.refxRow === f.name);
      if (row) this._applyRowValue(rec, lineGuid, f, row);
    }
    if (this._cardNav && this._cardNav.lineGuid === lineGuid) this._paintCardNav();
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
    // Re-render the card (body is no longer empty → the affordance drops away),
    // then focus the freshly-rendered line for immediate keyboard typing.
    setTimeout(() => { if (this._cards.has(lineGuid)) this._renderFreshCard(lineGuid, entry.recordGuid, true); }, 200);
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
      if (t.closest("." + this._CARD_CLASS)) return false; // the card owns its clicks
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

  // Ensure a current card for this embed. If a HEALTHY card already exists, refresh
  // it IN PLACE (no teardown → no flicker); only build a fresh node when none exists
  // (or just a loading placeholder does). This is the single entry every keep-alive
  // caller (observer, discovery, rehydrate) uses, so none of them flicker the card.
  async _attachPropCard(lineGuid, recordGuid, silent) {
    if (!this._cards.has(lineGuid)) return;
    const escId = (window.CSS && CSS.escape) ? CSS.escape(lineGuid) : lineGuid;
    const existing = document.querySelector("." + this._CARD_CLASS + '[data-refx-for="' + escId + '"]');
    if (existing && !existing.classList.contains("refx-propcard-loading")) { this._refreshCardInPlace(lineGuid, recordGuid); return; }
    return this._renderFreshCard(lineGuid, recordGuid, silent, existing);
  }

  // Build a fresh card NODE: loading state → resolve the record (may not be loaded
  // yet) → render. The ONLY path that creates/replaces the card node — everything
  // else refreshes in place. Called for a genuinely-missing card or a structural
  // change (add-content toggled, field set changed).
  async _renderFreshCard(lineGuid, recordGuid, silent, existing) {
    if (!this._cards.has(lineGuid)) return;
    if (existing === undefined) { const escId = (window.CSS && CSS.escape) ? CSS.escape(lineGuid) : lineGuid; existing = document.querySelector("." + this._CARD_CLASS + '[data-refx-for="' + escId + '"]'); }
    // On a silent refresh of an already-drawn card, skip the loading flash.
    if (!silent || !existing) this._renderCardInto(lineGuid, this._el("div", this._CARD_CLASS + " refx-propcard-loading", "Loading…"));
    let rec = this.data.getRecord(recordGuid);
    for (let i = 0; i < 8 && !rec; i++) { await new Promise((r) => setTimeout(r, 60)); if (!this._cards.has(lineGuid)) return; rec = this.data.getRecord(recordGuid); }
    if (!this._cards.has(lineGuid)) return;
    if (!rec) { this._renderCardInto(lineGuid, this._el("div", this._CARD_CLASS + " refx-propcard-empty", "Record unavailable")); return; }
    let fields = this._recCardFields(rec);
    if (!fields.length) { await new Promise((r) => setTimeout(r, 150)); if (!this._cards.has(lineGuid)) return; fields = this._recCardFields(rec); }
    // An empty record has no body line to type into — the native transclusion
    // renders nothing editable — so the card offers an "add content" affordance.
    if (!this._cards.has(lineGuid)) return;
    this._renderCardInto(lineGuid, this._buildPropCard(rec, fields, lineGuid));
  }

  _renderCardInto(lineGuid, cardEl) {
    const node = this._transclusionNode(lineGuid);
    if (!node) return false;
    cardEl.dataset.refxFor = lineGuid;
    // The card is a plugin UI island injected into the transclusion. Marking it
    // non-editable stops Thymer's editor from swallowing clicks on it as caret
    // placement, so its own click handlers (edit a value) fire reliably.
    cardEl.contentEditable = "false";
    const esc = (window.CSS && CSS.escape) ? CSS.escape(lineGuid) : lineGuid;
    const existing = document.querySelector("." + this._CARD_CLASS + '[data-refx-for="' + esc + '"]');
    const entry = this._cards.get(lineGuid);
    if (existing && existing !== cardEl && node.contains(existing)) {
      // MORPH IN PLACE: keep the existing card NODE (preserve its identity) and adopt
      // the fresh content, instead of remove+insert. Anything holding the card node
      // survives; only rows/value-cells are swapped, so the resume/paint tail below
      // re-lands the nav cursor and _applyRowValue re-finds any in-flight rowEl.
      existing.className = cardEl.className;
      existing.replaceChildren(...cardEl.childNodes);
      if (entry) entry.cardEl = existing; // cache for the observer's zero-flash re-insert
    } else {
      this._removeCardEl(lineGuid);
      // ROOT-CAUSE FIX (2026-07-01, live-proven): Thymer REPLACES the inner
      // `.transclusion-container-div` node on EVERY property write, so a card placed
      // inside it was destroyed as collateral and re-injected with a loading flash
      // (the flicker) + a one-step-stale value. The `.listitem-transclusion` node
      // survives, so inject the card as its FIRST CHILD (a scoped flex-wrap CSS rule
      // stacks it full-width above the body). Now editing never wipes the card.
      node.insertBefore(cardEl, node.firstChild);
      if (entry) entry.cardEl = cardEl; // cache for the observer's zero-flash re-insert
    }
    this._alignCardToBody(lineGuid, node);
    this._wireEmbedBodyClick(node, lineGuid);
    // The card is in the DOM now (paint synchronously). If an edit stashed a resume,
    // re-establish the cursor on that cell; else if a nav cursor is active, re-land it.
    if (this._cardNavResume && this._cardNavResume.lineGuid === lineGuid) this._consumeNavResume(lineGuid);
    else if (this._cardNav && this._cardNav.lineGuid === lineGuid) this._paintCardNav();
    return true;
  }

  // Line the card's edges up with the body box: the transclusion body container has
  // its own left/right margins (e.g. 30px indent / ~10px right, varying per context),
  // and a full-width card overhangs it. Mirror the container's computed margins onto
  // the card so the two boxes fuse edge-to-edge (the width calc keeps the card on its
  // own flex line — outer size still spans the row, so the wrap layout is unchanged).
  _alignCardToBody(lineGuid, node) {
    try {
      node = node || this._transclusionNode(lineGuid);
      if (!node) return;
      const card = node.querySelector(":scope > ." + this._CARD_CLASS);
      const cont = node.querySelector(".transclusion-container-div");
      if (!card || !cont) return;
      const cs = getComputedStyle(cont);
      const ml = cs.marginLeft || "0px", mr = cs.marginRight || "0px";
      card.style.marginLeft = ml;
      card.style.marginRight = mr;
      card.style.width = "calc(100% - " + ml + " - " + mr + ")";
      card.style.flex = "0 0 auto";
      // Fuse with the body box: the stylesheet gives the card the same VARS as
      // .container-border, but custom themes/CSS can restyle the transclusion
      // container specifically (Parham's does) — so copy its ACTUAL computed
      // colours on top. Stale-on-theme-switch is handled by the theme observer
      // (_ensureThemeObserver), which clears + re-copies on data-theme change.
      if (cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)") card.style.backgroundColor = cs.backgroundColor;
      if (cs.borderTopColor) card.style.borderColor = cs.borderTopColor;
    } catch (e) {}
  }

  // Re-copy every card's fused colours when the THEME changes — the inline
  // copies taken at render time otherwise go stale (light: darker gray card;
  // switching back to dark: lighter gray card).
  _ensureThemeObserver() {
    if (this._themeObs || this._unloaded) return;
    try {
      const obs = new MutationObserver(() => {
        setTimeout(() => {
          if (this._unloaded) return;
          for (const [lineGuid] of this._cards) {
            try {
              const node = this._transclusionNode(lineGuid);
              const card = node && node.querySelector(":scope > ." + this._CARD_CLASS);
              if (card) { card.style.backgroundColor = ""; card.style.borderColor = ""; }
              this._alignCardToBody(lineGuid, node);
            } catch (e) {}
          }
        }, 50); // let the new theme's styles apply before re-reading computed colours
      });
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      this._themeObs = obs;
      window.__refxThemeObs = obs;
    } catch (e) {}
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

  _removeCardEl(lineGuid) {
    try {
      const esc = (window.CSS && CSS.escape) ? CSS.escape(lineGuid) : lineGuid;
      document.querySelectorAll("." + this._CARD_CLASS + '[data-refx-for="' + esc + '"]').forEach((n) => n.remove());
    } catch (e) {}
  }

  _removeAllCardEls() {
    try { document.querySelectorAll("." + this._CARD_CLASS).forEach((n) => n.remove()); } catch (e) {}
  }

  // ---- observer (lazy, panel-scoped, hot-reload-guarded) ----

  _ensureCardObserver() {
    if (this._cardObs || this._unloaded) return;
    // Observe the whole document, not a single panel: an embed's card can live in
    // any panel and the active/focused panel isn't necessarily the one holding it
    // (e.g. after a reload with a search panel focused). Cheap-first guards below
    // keep this idle-free whenever no embeds are open.
    const target = document.body;
    const obs = new MutationObserver(() => {
      if (!this._cards.size && !this._queryEmbeds.size && !this._lineEmbeds.size) return;
      // ZERO-FLASH keep-alive: MutationObserver callbacks are microtasks — they run
      // BEFORE the browser paints the mutation. If a native re-render just dropped a
      // card, re-inserting the CACHED node here (synchronously) means no painted
      // frame ever lacks the card → no flicker, and the value it already shows stays
      // continuously visible (instant). The old rAF-deferred rebuild painted a
      // card-less frame first — that was the residual flash.
      // PRESENCE CHECK: cached-node isConnected FIRST — it's O(1), whereas the
      // compound querySelector walks the document per card per mutation batch
      // (Thymer mutates line DOM on essentially every keystroke).
      // The cached-node re-insert runs even while a POPUP editor is open
      // (_cardEditing): a relation write re-renders the whole transclusion node
      // and wiped the card behind the still-open picker (only the search box was
      // left). Re-inserting the SAME node can't disturb the popup (it lives on
      // document.body) and keeps every rowEl/valEl reference valid. Only the
      // REBUILD path below must wait for the editor to close.
      let needRebuild = false;
      for (const [lineGuid, e] of this._cards) {
        if (e.cardEl && e.cardEl.isConnected) continue;
        if (!e.cardEl) {
          const esc = (window.CSS && CSS.escape) ? CSS.escape(lineGuid) : lineGuid;
          if (document.querySelector("." + this._CARD_CLASS + '[data-refx-for="' + esc + '"]')) continue;
        }
        const node = e.cardEl ? this._transclusionNode(lineGuid) : null;
        if (node && e.cardEl) { try { node.insertBefore(e.cardEl, node.firstChild); this._alignCardToBody(lineGuid, node); this._wireEmbedBodyClick(node, lineGuid); } catch (err) { needRebuild = true; } }
        else needRebuild = true;
      }
      if (needRebuild) {
        if (this._cardEditing) { if (this._discoverPending == null) this._discoverPending = false; }
        else if (!this._cardRaf) this._cardRaf = requestAnimationFrame(() => { this._cardRaf = 0; this._onCardMutation(); });
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

  _onCardMutation() {
    if (!this._cards.size || this._cardEditing || this._unloaded) return;
    for (const [lineGuid, e] of this._cards) {
      if (e.cardEl && e.cardEl.isConnected) continue; // O(1) fast path
      const esc = (window.CSS && CSS.escape) ? CSS.escape(lineGuid) : lineGuid;
      // silent=true: a keep-alive re-inject of a card that already existed must
      // never show a "Loading…" flash. (Fallback only — the observer's synchronous
      // cached-node re-insert above handles the common case pre-paint.)
      if (!document.querySelector("." + this._CARD_CLASS + '[data-refx-for="' + esc + '"]')) this._attachPropCard(lineGuid, e.recordGuid, true);
    }
  }

  _teardownCardObserver() {
    this._exitCardNav();
    if (this._cardRaf) { try { cancelAnimationFrame(this._cardRaf); } catch (e) {} this._cardRaf = 0; }
    if (this._queryRaf) { try { cancelAnimationFrame(this._queryRaf); } catch (e) {} this._queryRaf = 0; }
    if (this._lineRaf) { try { cancelAnimationFrame(this._lineRaf); } catch (e) {} this._lineRaf = 0; }
    if (this._cardObs) { try { this._cardObs.disconnect(); } catch (e) {} }
    this._cardObs = null; this._cardObsTarget = null;
    if (window.__refxCardObs) { try { window.__refxCardObs.disconnect(); } catch (e) {} window.__refxCardObs = null; }
    this._closeCardPopup();
    this._removeAllCardEls();
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
    // Orphan popup/backdrop DOM from a prior instance's open interaction.
    try { document.querySelectorAll(".refx-cardpop, .refx-pop-backdrop, .refalias-pop, .refalias-backdrop, .refalias-catch").forEach((n) => n.remove()); } catch (e) {}
    this._removeAllCardEls();
  }

  // ---- inline property editing ----

  // Self-heal a WEDGED editing flag. Chromium fires NO blur when a focused
  // <input>/<textarea> is removed by a re-render, so if the card node was
  // replaced mid-edit (e.g. a record.updated rebuild) the editor's commit never
  // ran and `_cardEditing` stayed true — which silently BRICKS all card editing
  // AND every expand/collapse (they gate on this flag). If the flag is set but
  // no live editor (inline field or popup) exists in the DOM, it's orphaned:
  // clear it. Cheap: only walks the DOM when the flag is actually set.
  _healWedgedEditing() {
    if (!this._cardEditing) return false;
    try {
      if (document.querySelector("." + this._CARD_CLASS + " input, ." + this._CARD_CLASS + " textarea, .refx-cardpop")) return false;
    } catch (e) { return false; }
    this._cardEditing = false;
    this._activeEdit = null;
    return true;
  }

  _editCardValue(rec, lineGuid, field, valEl, rowEl) {
    if (field.kind === "file") { this._editFileValue(rec, lineGuid, field, valEl, rowEl); return; }
    this._healWedgedEditing(); // recover if a prior editor was torn out without committing
    // SWITCHING to another property while an inline text/number editor is open:
    // the row's mousedown-preventDefault keeps the open <textarea>/<input> from
    // blurring, so its blur-commit never fires and _cardEditing would wedge —
    // you couldn't edit any other property. Commit the in-progress edit first
    // (without stealing focus back to the line), then open the new one. A
    // duplicate event for the SAME field (mousedown + click) is a no-op.
    if (this._activeEdit) {
      if (this._activeEdit.field === field.name) return;
      try { this._activeEdit.commit(); } catch (e) {}
    }
    if (this._cardEditing) return; // a popup editor (choice/relation/date) is open
    // Re-resolve the field FRESH at open: the click handlers bound in _fillPropRow
    // capture a build-time snapshot, so after an earlier edit (or a remote change)
    // the closure's `field.value` is stale — a blur-commit of the seeded input
    // would silently revert a newer value, and pickers would mark the wrong
    // current option.
    try { const f = this._recCardFields(rec).find((x) => x.name === field.name); if (f) field = f; } catch (e) {}
    if (field.kind === "choice") return this._editChoice(rec, lineGuid, field, valEl, rowEl);
    if (field.kind === "relation") return this._editRelation(rec, lineGuid, field, valEl, rowEl);
    if (field.kind === "date") return this._editDate(rec, lineGuid, field, valEl, rowEl);
    this._cardEditing = true;
    let done = false;
    const isNum = field.kind === "number";
    // Text fields edit in a WRAPPING, auto-growing <textarea> so long / multi-
    // line values (Synopsis and the like) are fully visible and editable — the
    // old single-line <input> hid everything past the first line. Numbers keep a
    // numeric input.
    const input = this._el(isNum ? "input" : "textarea", "refalias-input refx-propcard-input" + (isNum ? "" : " refx-propcard-textarea"));
    if (isNum) input.type = "number"; else { input.rows = 1; input.wrap = "soft"; }
    input.value = (field.value == null ? "" : String(field.value));
    valEl.replaceWith(input);
    const autosize = () => { if (isNum) return; try { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, Math.round(window.innerHeight * 0.4)) + "px"; } catch (e) {} };
    setTimeout(() => { try { input.focus(); if (input.select) input.select(); autosize(); } catch (e) {} }, 0);
    // commit: write + optimistic in-place row update + poll-confirm (no teardown).
    // cancel: swap the editor back to a value span showing the original value, in
    // place (no innerHTML clear). Both re-establish the nav cursor. `refocus`
    // false skips returning focus to the line (used when we immediately open
    // another editor — a switch).
    const commit = (raw, refocus) => { if (done) return; done = true; this._activeEdit = null; this._commitClaim(lineGuid); this._cardEditing = false; this._writeCardProp(rec, field, raw); this._commitRefreshRow(rec, lineGuid, field, field.value, rowEl, raw); this._flushDeferredDiscover(); if (refocus !== false) this._refocusEditor(); };
    const cancel = () => {
      if (done) return; done = true; this._activeEdit = null; this._cardEditing = false;
      let fresh = field; try { const f = this._recCardFields(rec).find((x) => x.name === field.name); if (f) fresh = f; } catch (e) {}
      this._applyRowValue(rec, lineGuid, fresh, rowEl);
      this._consumeNavResume(lineGuid);
      this._flushDeferredDiscover();
      this._refocusEditor();
    };
    // Track the open editor so teardown paths (collapse, navigation, switching to
    // another property) can close it — removing a focused input fires NO blur in
    // Chromium, which would leave _cardEditing wedged true and brick all editing.
    this._activeEdit = { lineGuid, field: field.name, cancel, commit: () => commit(input.value, false) };
    input.addEventListener("input", autosize);
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      // Enter commits (familiar quick-commit). In a textarea, Shift+Enter inserts
      // a newline instead, for multi-line text.
      if (e.key === "Enter" && !(e.shiftKey && !isNum)) { e.preventDefault(); commit(input.value); }
      else if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
    input.addEventListener("blur", () => commit(input.value));
  }

  // Keyboard-first date editor REPLICATING Thymer's native date picker (studied live
  // on a native record: same placeholder, month header with ‹ ○ › nav, weekday row,
  // 6-week grid including prev/next-month days, and a bottom confirm bar showing the
  // focused date). Type a natural-language date ("next friday", "aug 1", "monday")
  // parsed by Thymer's own DateTime.parseDateTimeString, and/or arrow the grid. Works
  // when the field is EMPTY (seeds to today). Commits via the same pick-ordering as
  // the choice editor (pre-arm _commitInFlight → close → write → in-place refresh).
  _editDate(rec, lineGuid, field, valEl, rowEl) {
    const DT = (typeof DateTime !== "undefined" && DateTime && DateTime.parseDateTimeString) ? DateTime : null;
    const pop = this._el("div", "refalias-pop refx-cardpop refx-datepop");
    const input = this._el("input", "refalias-input");
    input.placeholder = DT ? "Try: today, Aug 1, monday" : "YYYY-MM-DD";
    input.value = field.value && /^\d{4}-\d{2}-\d{2}/.test(field.value) ? field.value : "";
    // Header: month label + ‹ ○ › (prev / today / next), like the native picker.
    const header = this._el("div", "refx-datepop-header");
    const monthLabel = this._el("span", "refx-datepop-month");
    const navBox = this._el("span", "refx-datepop-nav");
    const mkNav = (icon, title, fn) => { const b = this._el("button", "refx-datepop-navbtn"); b.type = "button"; b.title = title; b.append(this._el("span", "ti " + icon)); b.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); fn(); }); return b; };
    const weekdays = this._el("div", "refx-datepop-weekdays");
    ["S","M","T","W","T","F","S"].forEach((w) => weekdays.append(this._el("div", "refx-datepop-dow", w)));
    const grid = this._el("div", "refx-datepop-grid");
    // Bottom confirm bar (native: the selected autocomplete row "📅 Wed Jul 1").
    const confirm = this._el("div", "refx-datepop-confirm");
    pop.append(input, header, weekdays, grid, confirm);

    const iso = (y, m0, d) => y + "-" + String(m0 + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
    const today = this._todayParts();
    // field.value is "YYYY-MM-DD" or "YYYY-MM-DD HH:MM" (time preserved when stored).
    let seed = (field.value && /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2}))?/.exec(field.value));
    let viewY = seed ? +seed[1] : today.y, viewM = seed ? (+seed[2] - 1) : today.m;
    let cur = { y: viewY, m: viewM, d: seed ? +seed[3] : today.d }; // focused date (can be outside viewM)
    let curTime = seed && seed[4] ? seed[4] : null; // "HH:MM" — typed or pre-existing time
    const curIso = seed ? iso(+seed[1], +seed[2] - 1, +seed[3]) : null;

    // typedDtv: the LAST successful parse of the input text, kept as the raw
    // DateTimeValue. Committing it AS-IS is what preserves Thymer's granular date
    // values — "week 28", "Q3 2026", "july 2025", "2027", "last year" all store
    // and render exactly like native pills instead of collapsing to one day.
    // Cleared whenever the user drives the GRID (that's an explicit day choice).
    let typedDtv = null; // { v: DateTimeValue, formatted, machine: "YYYY-MM-DD[ HH:MM]" }
    const pick = (isoStr) => {
      typedDtv = null; // day-granularity commit (grid/clear)
      const raw = isoStr ? (isoStr + (curTime ? " " + curTime : "")) : "";
      this._commitClaim(lineGuid);
      this._closeCardPopup();
      this._writeCardProp(rec, field, raw);
      this._commitRefreshRow(rec, lineGuid, field, field.value, rowEl, raw);
    };
    const pickTyped = (td) => {
      this._commitClaim(lineGuid);
      this._closeCardPopup();
      this._writeCardProp(rec, field, { dtv: td.v });
      this._commitRefreshRow(rec, lineGuid, field, field.value, rowEl, td.machine, td.formatted);
    };
    const MONTHS_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const DOWS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const fmt = (y, m0, d) => { const dt = new Date(y, m0, d); return DOWS[dt.getDay()] + " " + MONTHS[m0] + " " + d + (y !== today.y ? " " + y : ""); };
    header.append(monthLabel, navBox);
    navBox.append(
      mkNav("ti-chevron-left", "Previous month", () => { viewM--; if (viewM < 0) { viewM = 11; viewY--; } render(); }),
      mkNav("ti-point", "Go to today", () => { viewY = today.y; viewM = today.m; cur = { ...today }; render(); }),
      mkNav("ti-chevron-right", "Next month", () => { viewM++; if (viewM > 11) { viewM = 0; viewY++; } render(); })
    );
    const render = () => {
      monthLabel.textContent = MONTHS_FULL[viewM] + " " + viewY;
      grid.innerHTML = "";
      // 6 fixed weeks incl. prev/next-month days, exactly like native.
      const firstDow = new Date(viewY, viewM, 1).getDay();
      const start = new Date(viewY, viewM, 1 - firstDow);
      for (let i = 0; i < 42; i++) {
        const dt = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const y = dt.getFullYear(), m0 = dt.getMonth(), d = dt.getDate();
        const di = iso(y, m0, d);
        let cls = "refx-datepop-day " + (m0 === viewM ? "cur-month" : "adj-month");
        if (y === cur.y && m0 === cur.m && d === cur.d) cls += " refx-datepop-focus";
        if (di === curIso) cls += " refx-datepop-sel";
        if (y === today.y && m0 === today.m && d === today.d) cls += " refx-datepop-today";
        const cell = this._el("div", cls);
        cell.append(this._el("span", "refx-datepop-day-inner", String(d)));
        cell.dataset.iso = di;
        cell.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); pick(di); });
        grid.append(cell);
      }
      confirm.innerHTML = "";
      // Typed granular values show their NATIVE formatted text ("Week 28",
      // "Q3 2026"); grid-driven focus shows the day form.
      const label = typedDtv ? typedDtv.formatted : (fmt(cur.y, cur.m, cur.d) + (curTime ? " " + curTime : ""));
      confirm.append(this._el("span", "ti ti-calendar-event"), this._el("span", "refx-datepop-confirm-label", label));
    };
    // Parse the typed text into {year, month, day, time?}. GUARDS (the "17:00" bug):
    // a TIME-ONLY parse returns a DateTime whose date parts are undefined — feeding
    // those into the grid rendered "undefined undefined" + NaN cells. Date parts that
    // aren't finite fall back to toDate(), then to the currently-focused date (so a
    // bare time means "the focused day at that time", like native). Time is kept as
    // "HH:MM" — native accepts "17:00 tomorrow", "monday 3pm" etc.
    const parseTyped = () => {
      const q = input.value.trim();
      if (!q) return null;
      if (!DT) { const m = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(q); return m ? { year: +m[1], month: +m[2] - 1, day: +m[3], time: m[4] ? String(m[4]).padStart(2, "0") + ":" + m[5] : null } : null; }
      let dt = null; try { dt = DT.parseDateTimeString(q); } catch (e) {}
      if (!dt) return null;
      // Capture the RAW DateTimeValue — for granular inputs ("week 28", "Q3 2026",
      // "july 2025", "2027", "last year") the parser returns a RANGE spanning the
      // period ({d, r:{d}}); committing THAT value (plus the native pill label) is
      // what stores exactly what the native picker stores.
      let dtv = null; try { dtv = dt.value && dt.value(); } catch (e) {}
      let p = null; try { p = dt.getParts(); } catch (e) {}
      let time = null;
      if (p && p.hours != null && isFinite(p.hours)) time = String(p.hours).padStart(2, "0") + ":" + String(p.minutes != null && isFinite(p.minutes) ? p.minutes : 0).padStart(2, "0");
      const ok = p && isFinite(p.year) && isFinite(p.month) && isFinite(p.day);
      if (!ok) {
        let jd = null; try { jd = dt.toDate && dt.toDate(); } catch (e) {}
        if (jd && !isNaN(jd.getTime())) p = { year: jd.getFullYear(), month: jd.getMonth(), day: jd.getDate() };
        else if (time) { p = { year: cur.y, month: cur.m, day: cur.d }; dtv = null; } // time-only → keep the focused day (no raw pass-through)
        else if (dtv && dtv.d && /^\d{8}$/.test(dtv.d)) p = { year: +dtv.d.slice(0, 4), month: +dtv.d.slice(4, 6) - 1, day: +dtv.d.slice(6, 8) }; // granular value: anchor the grid on its start day
        else return null;
      }
      const machine = iso(p.year, p.month, p.day) + (time ? " " + time : "");
      // Only pass the raw value through for RANGED (granular) parses — plain day
      // parses commit via the ISO path (identical result, simpler pipeline). The
      // pill label: the parser leaves `formatted` empty (the native widget fills it
      // at store time), so synthesize the native text and include it in the value.
      let formatted = null;
      if (dtv && dtv.r && dtv.r.d) {
        formatted = dtv.formatted || this._synthDateLabel(dtv.d, dtv.r.d, time);
        if (formatted && !dtv.formatted) dtv = Object.assign({}, dtv, { formatted });
      } else dtv = null;
      return { year: p.year, month: p.month, day: p.day, time, dtv, formatted, machine };
    };
    let t = 0;
    // Apply the current input text to cur/curTime immediately — Enter or a confirm-
    // click landing INSIDE the 120ms parse debounce must not commit the pre-typing
    // date ("aug 1⏎" at normal speed used to write the previously focused day).
    const applyParse = (p) => {
      cur = { y: p.year, m: p.month, d: p.day };
      curTime = p.time || null;
      typedDtv = (p.dtv && p.formatted) ? { v: p.dtv, formatted: p.formatted, machine: p.machine } : null;
    };
    const flushParse = () => {
      if (t) { clearTimeout(t); t = 0; }
      if (document.activeElement !== input || !input.value.trim()) return;
      const p = parseTyped();
      if (p && isFinite(p.year) && isFinite(p.month) && isFinite(p.day)) applyParse(p);
    };
    input.addEventListener("input", () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = 0;
        const p = parseTyped();
        if (p && isFinite(p.year) && isFinite(p.month) && isFinite(p.day)) {
          applyParse(p);
          viewY = p.year; viewM = p.month;
          render();
        }
        else if (!input.value.trim()) { curTime = null; typedDtv = null; render(); }
        else { typedDtv = null; confirm.querySelector(".refx-datepop-confirm-label").textContent = "…"; }
      }, 120);
    });
    confirm.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); flushParse(); if (typedDtv) pickTyped(typedDtv); else pick(iso(cur.y, cur.m, cur.d)); });

    // One window-capture key handler for the whole popup (text input + grid). Passed
    // to _openCardPopup as opts.onKey so its built-in row handler isn't installed.
    const onKey = (e) => {
      // Only while the popup owns focus (a palette stacked on top must get its own
      // keys), and never convert MODIFIED chords (Cmd+Up etc.) into grid moves.
      if (!pop.contains(document.activeElement)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); this._closeCardPopup(); return; }
      if (e.key === "Enter") {
        e.preventDefault(); e.stopImmediatePropagation();
        flushParse();
        const q = input.value.trim();
        // Cleared-out input + Enter on a field that HAD a value = clear it;
        // otherwise Enter commits what the confirm bar shows: the typed value
        // (raw DateTimeValue, granularity preserved) or the grid-focused day.
        if (document.activeElement === input && !q && curIso) { pick(""); return; }
        if (typedDtv) { pickTyped(typedDtv); return; }
        pick(iso(cur.y, cur.m, cur.d));
        return;
      }
      if (e.key === "Backspace" && document.activeElement === input && !input.value && curIso) { e.preventDefault(); e.stopImmediatePropagation(); pick(""); return; } // clear existing date
      // Movement keys drive the calendar grid; the view follows the focused date.
      // Driving the grid is an explicit DAY choice — drop any typed granular value.
      const step = (dd) => { e.preventDefault(); e.stopImmediatePropagation(); typedDtv = null; const dt = new Date(cur.y, cur.m, cur.d + dd); cur = { y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate() }; viewY = cur.y; viewM = cur.m; render(); };
      if (e.key === "ArrowLeft") return step(-1);
      if (e.key === "ArrowRight") return step(1);
      if (e.key === "ArrowUp") return step(-7);
      if (e.key === "ArrowDown") return step(7);
      if (e.key === "PageUp") { e.preventDefault(); e.stopImmediatePropagation(); viewM--; if (viewM < 0) { viewM = 11; viewY--; } render(); return; }
      if (e.key === "PageDown") { e.preventDefault(); e.stopImmediatePropagation(); viewM++; if (viewM > 11) { viewM = 0; viewY++; } render(); return; }
      // other keys (typing) fall through to the focused input
    };

    render();
    this._openCardPopup(pop, valEl, { onKey: onKey });
    setTimeout(() => { try { input.focus(); } catch (e) {} }, 0);
  }

  _todayParts() { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() }; }

  // Native-style display for a machine date value "YYYY-MM-DD[ HH:MM]" →
  // "Sun Jul 12" (+ year when not the current year) (+ " 17:00"). Used as the
  // fallback whenever a stored `formatted` isn't available yet (optimistic paints,
  // pre-propagation reads) so the card NEVER shows raw ISO next to native pills.
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

  // Searchable choice picker (mirrors Thymer's native property editor): a "Search
  // option…" filter box above the options, current value highlighted, ↑/↓ + Enter
  // to pick. Typing filters the list; (None) clears the value (listed last).
  _editChoice(rec, lineGuid, field, valEl, rowEl) {
    const pop = this._el("div", "refalias-pop refx-cardpop refx-choicepop");
    const input = this._el("input", "refalias-input");
    input.placeholder = "Search option…";
    const list = this._el("div", "refalias-results");
    const options = (field.choices || []).map((c) => ({ label: c.label, cls: "" }));
    options.push({ label: "", display: "(None)", cls: "refx-cardpop-clear" });
    const pick = (label) => { this._commitClaim(lineGuid); this._closeCardPopup(); this._writeCardProp(rec, field, label); this._commitRefreshRow(rec, lineGuid, field, field.value, rowEl, label); };
    const render = (q) => {
      list.innerHTML = "";
      const ql = (q || "").trim().toLowerCase();
      const matches = options.filter((o) => { const d = o.display || o.label; return !ql || (d && d.toLowerCase().includes(ql)); });
      for (const o of matches) {
        const row = this._el("div", "refalias-result" + (o.cls ? " " + o.cls : "") + (o.label === field.value ? " refalias-result-sel" : ""));
        row.append(this._el("span", "refalias-result-text", o.display || o.label));
        row.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); pick(o.label); });
        list.append(row);
      }
      if (!matches.length) list.append(this._el("div", "refx-cardpop-empty", "No matching options"));
    };
    render("");
    input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); this._closeCardPopup(); } });
    input.addEventListener("input", () => { render(input.value); if (this._cardPopup && this._cardPopup.resync) this._cardPopup.resync(true); });
    pop.append(input, list);
    this._openCardPopup(pop, valEl);
  }

  // Relation picker with a BROWSE list (like Thymer's native record dropdown): when
  // the field declares a target collection (PropertyField.filter_colguid — e.g.
  // Lead→People, Area→Areas, Goal→Goals), the popup opens with that collection's
  // records listed so ↑/↓ + Enter work immediately; typing filters the list. Fields
  // without a target collection keep workspace-wide search-on-type.
  // Relation picker with native anatomy (verified against the real one):
  //   "Search option ..." field · CURRENT values first with an accent check
  //   (click = remove) · then suggestions with their icons (the target collection
  //   when the field declares one, else recently-edited records workspace-wide) ·
  //   multi-value fields (schema `many`) stay open and toggle; single-value picks
  //   replace and close · "(None)" only for single-value (multi clears by
  //   unchecking).
  _editRelation(rec, lineGuid, field, valEl, rowEl) {
    const meta = this._fieldMeta && field.id ? this._fieldMeta[field.id] : null;
    if (meta && meta.read_only) return this._toast("That property is read-only.");
    const many = !!(meta && meta.many);
    const pop = this._el("div", "refalias-pop refx-cardpop refx-relpop");
    const input = this._el("input", "refalias-input");
    input.placeholder = "Search option ...";
    const list = this._el("div", "refalias-results");
    pop.append(input, list);
    let browse = null;   // [{r, name, lower, icon, guid}] target collection (filter_colguid)
    let recent = null;   // same shape, recently-edited workspace-wide (no filter_colguid)
    let closed = false;

    const currentLinks = () => {
      try {
        return ((rec.prop(field.name).linkedRecords && rec.prop(field.name).linkedRecords()) || []).map((r) => {
          let g = null; try { g = r._getRow && r._getRow().guid; } catch (e) {}
          return { r, guid: g, name: (r.getName && r.getName()) || "Untitled", icon: this._iconForRecord(r) };
        }).filter((x) => x.guid);
      } catch (e) { return []; }
    };
    // Session-local OPTIMISTIC current values. linkedRecords() lags a write:
    // re-reading it right after prop.set returned the OLD list, so a removed
    // value stayed "checked" and the next add wrote the stale list back (the
    // remove-then-can't-re-add / removed-value-comes-back bug). While the popup
    // is open IT owns the truth: every render and every write derives from
    // curList, never from a fresh linkedRecords() read.
    let curList = currentLinks();
    const writeGuids = (guids) => {
      this._commitClaim(lineGuid);
      let p = null; try { p = rec.prop(field.name); } catch (e) {}
      if (!p) return;
      try { p.set(many ? guids : (guids[0] || "")); } catch (e) { try { p.set(guids); } catch (e2) {} }
    };
    // Fresh pills for the optimistic row update (stale field.pills would show
    // the previous chips until the write propagates).
    const pillsOf = (list) => list.map((x) => ({ t: x.name, icon: x.icon || null, guid: x.guid }));
    const refreshRow = (display, pillsNow) => { this._commitRefreshRow(rec, lineGuid, field, field.value, rowEl, display, "", pillsNow || null); };

    const render = (q) => {
      if (closed || !this._cardPopup || this._cardPopup.pop !== pop) return;
      list.innerHTML = "";
      const ql = (q || "").trim().toLowerCase();
      const cur = curList;
      const curGuids = new Set(cur.map((c) => c.guid));
      // 1) current values, accent-checked; click (or the native-style ×) removes
      // (multi) / clears (single)
      for (const c of cur) {
        if (ql && !c.name.toLowerCase().includes(ql)) continue;
        const row = this._el("div", "refalias-result refx-opt-checked");
        const chk = this._el("span", "refx-opt-chkbadge"); chk.append(this._el("span", "ti ti-check")); row.append(chk);
        if (c.icon) row.append(this._el("span", "refx-opt-ico ti " + c.icon));
        row.append(this._el("span", "refalias-result-text", c.name));
        row.append(this._el("span", "refx-opt-x ti ti-x"));
        row.addEventListener("mousedown", (e) => {
          e.preventDefault(); e.stopPropagation();
          curList = curList.filter((x) => x.guid !== c.guid);
          writeGuids(curList.map((x) => x.guid));
          refreshRow(curList.map((x) => x.name).join(", "), pillsOf(curList));
          if (many) render(input.value); else { closed = true; this._closeCardPopup(); }
        });
        list.append(row);
      }
      // 2) suggestions (minus already-picked), each with its record icon. When the
      // user is SEARCHING, rank by relevance like native (exact → prefix → word-
      // start → contains, shorter names first within a tier) instead of leaving the
      // list in its browse order (alphabetical / recency), which buried exact hits
      // (e.g. "Psychology" sat below "Bark scale (psychoacoustic…)").
      const src = browse || recent || [];
      let matches = src.filter((ent) => !curGuids.has(ent.guid) && (!ql || ent.lower.includes(ql)));
      if (ql) {
        const rank = (lo) => lo === ql ? 0 : (lo.startsWith(ql) ? 1 : (lo.split(/[^a-z0-9]+/).some((w) => w && w.startsWith(ql)) ? 2 : 3));
        matches = matches
          .map((ent) => ({ ent, rk: rank(ent.lower) }))
          .sort((a, b) => a.rk - b.rk || a.ent.lower.length - b.ent.lower.length || a.ent.name.localeCompare(b.ent.name))
          .map((x) => x.ent);
      }
      matches = matches.slice(0, 40);
      for (const ent of matches) {
        const row = this._el("div", "refalias-result");
        if (ent.icon) row.append(this._el("span", "refx-opt-ico ti " + ent.icon));
        row.append(this._el("span", "refalias-result-text", ent.name));
        row.addEventListener("mousedown", (e) => {
          e.preventDefault(); e.stopPropagation();
          if (many) {
            curList = curList.concat([{ guid: ent.guid, name: ent.name, icon: ent.icon }]);
            writeGuids(curList.map((x) => x.guid));
            refreshRow(curList.map((x) => x.name).join(", "), pillsOf(curList));
            input.value = ""; render("");
          } else {
            closed = true; this._closeCardPopup();
            writeGuids([ent.guid]);
            refreshRow(ent.name, pillsOf([ent]));
          }
        });
        list.append(row);
      }
      // 2b) "+ Create «query»" (native anatomy: bottom row, target collection name
      // right-aligned): only when the field declares a target collection (so we
      // know WHERE to create) and no current value or suggestion already has that
      // exact name. col.createRecord returns the new guid synchronously.
      let createRow = null;
      const qname = (q || "").trim();
      if (qname && col && col.createRecord && !cur.some((c) => c.name.toLowerCase() === ql) && !src.some((ent) => ent.lower === ql)) {
        createRow = this._el("div", "refalias-result refx-opt-create");
        createRow.append(this._el("span", "refalias-result-text", "+ Create “" + qname + "”"));
        let colName = ""; try { colName = (col.getName && col.getName()) || ""; } catch (e) {}
        if (colName) createRow.append(this._el("span", "refx-opt-createcol", colName));
        createRow.addEventListener("mousedown", (e) => {
          e.preventDefault(); e.stopPropagation();
          let guid = null;
          try { guid = col.createRecord(qname); } catch (err) {}
          if (!guid) { this._toast("Couldn't create “" + qname + "”."); return; }
          // Make the new record known to this popup's browse list right away
          // (getAllRecords already resolved; a re-render must see it as current).
          const ent2 = { r: null, name: qname, lower: qname.toLowerCase(), icon: null, guid };
          if (browse) { browse.push(ent2); browse.sort((a, b) => a.name.localeCompare(b.name)); }
          if (many) {
            curList = curList.concat([{ guid, name: qname, icon: null }]);
            writeGuids(curList.map((x) => x.guid));
            refreshRow(curList.map((x) => x.name).join(", "), pillsOf(curList));
            input.value = ""; render("");
          } else {
            closed = true; this._closeCardPopup();
            writeGuids([guid]);
            refreshRow(qname, [{ t: qname, icon: null, guid }]);
          }
        });
        list.append(createRow);
      }
      if (!cur.length && !matches.length && !createRow) list.append(this._el("div", "refx-cardpop-empty", "No matches"));
      // 3) "(None)" clears — single-value only (multi clears by unchecking)
      if (!many) {
        const clr = this._el("div", "refalias-result refx-cardpop-clear");
        clr.append(this._el("span", "refalias-result-text", "(None)"));
        clr.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); closed = true; this._commitClaim(lineGuid); this._closeCardPopup(); this._clearRelation(rec, field); refreshRow(""); });
        list.append(clr);
      }
      if (this._cardPopup && this._cardPopup.resync) this._cardPopup.resync(false);
    };

    input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); this._closeCardPopup(); } });
    input.addEventListener("input", () => render(input.value));
    this._openCardPopup(pop, valEl);
    setTimeout(() => { try { input.focus(); } catch (e) {} }, 0);
    render("");

    const entify = (r) => {
      // Per-record armour: ONE record with a throwing getName()/prop() must not
      // kill the whole list (it silently did — the "empty suggestions" bug).
      try {
        const name = (r.getName && r.getName()) || "Untitled";
        let g = null; try { g = r._getRow && r._getRow().guid; } catch (e) {}
        let ic = null; try { ic = this._iconForRecord(r); } catch (e) {}
        return { r, name, lower: name.toLowerCase(), icon: ic, guid: g };
      } catch (e) { return { r, name: "", lower: "", icon: null, guid: null }; }
    };
    const col = meta && meta.filter_colguid && this._colByGuid ? this._colByGuid[meta.filter_colguid] : null;
    if (col && col.getAllRecords) {
      // Declared target collection → its records, alphabetical.
      col.getAllRecords().then((recs) => {
        if (closed || !this._cardPopup || this._cardPopup.pop !== pop) return;
        browse = (recs || []).map(entify).filter((x) => x.guid).sort((a, b) => a.name.localeCompare(b.name));
        render(input.value);
      }).catch(() => {});
    } else {
      // No declared collection → recently edited records workspace-wide (what
      // native suggests). u_at lives on the raw row — cheap to sort; only the
      // top slice pays getName/icon resolution.
      setTimeout(() => {
        if (closed || !this._cardPopup || this._cardPopup.pop !== pop) return;
        try {
          const all = (this.data.getAllRecords && this.data.getAllRecords()) || [];
          const rows = [];
          for (const r of all) { try { const row = r._getRow && r._getRow(); if (row && row.guid) rows.push({ r, u: row.u_at || 0 }); } catch (e) {} }
          rows.sort((a, b) => b.u - a.u);
          recent = rows.slice(0, 300).map((x) => entify(x.r)).filter((x) => x.guid); // x.r, NOT x — the wrapper has no record API
          render(input.value);
        } catch (e) {}
      }, 0);
    }
  }

  _writeCardProp(rec, field, raw) {
    let p = null; try { p = rec.prop(field.name); } catch (e) {}
    if (!p) return;
    try {
      if (field.kind === "file") return; // never overwrite a file value with text
      if (field.kind === "choice") {
        if (raw === "" || raw == null) { try { p.set(""); } catch (e) { try { p.set([]); } catch (e2) {} } }
        else p.setChoice(raw);
      } else if (field.kind === "date") {
        // raw = "YYYY-MM-DD"/"YYYY-MM-DD HH:MM" string, OR {dtv: DateTimeValue} —
        // the picker passes the PARSED value straight through for typed text so
        // Thymer's granular dates ("Week 28", "Q3 2026", "July 2025", "Year 2027",
        // ranges) store exactly as native would. Preferred string write: Thymer's
        // own DateTime.parseDateTimeString(raw).value() (rule-42 family). Fallback:
        // a LOCAL Date (noon when no time — never `new Date("YYYY-MM-DD")`, which
        // is UTC-midnight and lands on the previous day in western timezones).
        if (raw && typeof raw === "object" && raw.dtv) {
          try { p.set(raw.dtv); } catch (e) {}
        } else if (raw) {
          const s = String(raw);
          const DT = (typeof DateTime !== "undefined" && DateTime && DateTime.parseDateTimeString) ? DateTime : null;
          let wrote = false;
          if (DT) { try { const v = DT.parseDateTimeString(s); if (v && v.value) { p.set(v.value()); wrote = true; } } catch (e) {} }
          if (!wrote) {
            let dt = null; const m = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(s);
            if (m) dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4] != null ? Number(m[4]) : 12, m[5] != null ? Number(m[5]) : 0, 0);
            else dt = new Date(s);
            try { p.setFromDate(dt); } catch (e) { try { p.set(s); } catch (e2) {} }
          }
        } else {
          // Clearing a datetime is UNRELIABLE via p.set("") alone (verified live:
          // the write silently no-ops server-side while the local read looks
          // cleared). Belt-and-suspenders: try all known clear paths — each is a
          // harmless no-op once the prop is actually empty.
          try { p.set(""); } catch (e) {}
          try { p.setFromDate([]); } catch (e) {}
          try { const n = (p.count && p.count()) || 0; for (let i = n - 1; i >= 0; i--) { try { p.removeValueAt(i); } catch (e2) {} } } catch (e) {}
        }
      } else if (field.kind === "number") {
        p.set(raw === "" || raw == null ? "" : Number(raw));
      } else {
        p.set(raw);
      }
    } catch (e) {}
  }

  // Write the GUID STRING, never the PluginRecord/{guid} object: p.set(object)
  // stores the object, which the plugin's own values() fallback happens to render
  // but the NATIVE property pane shows as "[object Object]" — silent data
  // corruption on the record (caught live 2026-07-01 on Area/Goal).
  _setRelation(rec, field, recObj) {
    let p = null; try { p = rec.prop(field.name); } catch (e) {}
    if (!p) return;
    let guid = null;
    try { guid = (recObj && recObj.getGuid && recObj.getGuid()) || (recObj && recObj.guid) || null; } catch (e) {}
    if (!guid || typeof guid !== "string") return;
    try { p.set(guid); } catch (e) {}
  }

  _clearRelation(rec, field) {
    let p = null; try { p = rec.prop(field.name); } catch (e) {}
    if (!p) return;
    try { p.set(""); } catch (e) { try { p.set([]); } catch (e2) {} }
  }

  // opts.onKey: a custom window-capture keydown handler (the date grid supplies its
  // own). When given, the built-in option-row handler is NOT installed, so the two
  // never conflict (the built-in used stopImmediatePropagation and would swallow the
  // grid's keys). opts.focusInput=false skips the auto-focus (grid manages focus).
  _openCardPopup(pop, anchorEl, opts) {
    opts = opts || {};
    this._closeCardPopup();
    this._cardEditing = true;
    const backdrop = this._el("div", "refx-pop-backdrop");
    document.body.append(backdrop, pop);
    this._positionPopover(pop, [anchorEl]);
    backdrop.addEventListener("mousedown", (e) => { e.preventDefault(); this._closeCardPopup(); });
    let onKey, resync = null;
    if (opts.onKey) {
      onKey = opts.onKey;
    } else {
      // Keyboard nav over the option rows (choice + relation): ↑/↓ move, Enter
      // picks, Esc cancels. Window-capture so it beats the card's own key handlers.
      const rowsOf = () => [...pop.querySelectorAll(".refalias-result")];
      let sel = -1;
      const paint = () => { rowsOf().forEach((r, i) => r.classList.toggle("refalias-result-sel", i === sel)); };
      resync = (preferFirst) => {
        const rs = rowsOf();
        if (!rs.length) { sel = -1; return; }
        const cur = rs.findIndex((r) => r.classList.contains("refalias-result-sel"));
        sel = preferFirst ? 0 : (cur >= 0 ? cur : 0);
        paint();
        if (rs[sel]) { try { rs[sel].scrollIntoView({ block: "nearest" }); } catch (e) {} }
      };
      onKey = (e) => {
        // Only handle keys while the popup owns focus — a UI stacked on top (the
        // command palette) steals focus, and swallowing its Enter/arrows here
        // would drive OUR list invisibly behind it.
        if (!pop.contains(document.activeElement)) return;
        const rs = rowsOf();
        if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); this._closeCardPopup(); return; }
        // Bail (don't swallow) when there are no option rows, so a co-existing popup
        // key handler could work — belt-and-suspenders alongside opts.onKey.
        if (!rs.length) return;
        if (e.key === "ArrowDown") { e.preventDefault(); e.stopImmediatePropagation(); sel = (sel + 1) % rs.length; paint(); rs[sel].scrollIntoView({ block: "nearest" }); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); e.stopImmediatePropagation(); sel = (sel - 1 + rs.length) % rs.length; paint(); rs[sel].scrollIntoView({ block: "nearest" }); return; }
        if (e.key === "Enter") { if (sel >= 0 && rs[sel]) { e.preventDefault(); e.stopImmediatePropagation(); rs[sel].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); } return; }
      };
    }
    window.addEventListener("keydown", onKey, true);
    window.__refxPopupKey = onKey; // hot-reload stash
    this._cardPopup = { pop, backdrop, onKey, resync };
    if (resync) resync(false);
    if (opts.focusInput !== false) { const input = pop.querySelector("input"); setTimeout(() => { try { if (input) input.focus(); } catch (e) {} }, 0); }
  }

  _closeCardPopup() {
    const cp = this._cardPopup;
    this._cardPopup = null;
    this._cardEditing = false;
    if (cp) {
      if (cp.onKey) { try { window.removeEventListener("keydown", cp.onKey, true); } catch (e) {} }
      window.__refxPopupKey = null;
      try { cp.pop.remove(); } catch (e) {}
      try { cp.backdrop.remove(); } catch (e) {}
      // A real popup (choice/relation) just closed — re-establish the nav cursor if
      // an edit stashed one (pick or cancel). Guard on `cp` so the no-op close at
      // the top of _openCardPopup (before the popup exists) doesn't consume it.
      this._consumeNavResume();
      this._flushDeferredDiscover();
      this._refocusEditor();
    }
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
.refalias-sub { font-size: 12px; opacity: .6; }
.refalias-sub b { font-weight: 600; opacity: .95; }
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

/* record property card (rendered above the body inside a record embed) */
.refx-propcard {
  margin: 2px 0 0; padding: 8px 10px;
  /* Same vars as the native .container-border (bg/border/radius), so the card
     tracks EVERY theme switch live — copying computed colours at render went
     stale on theme change (light: darker gray; back to dark: lighter gray).
     Top corners get the block radius; bottom is square, fused with the body. */
  border-radius: var(--ed-radius-block, 6px) var(--ed-radius-block, 6px) 0 0;
  background: var(--ed-container-bg-color, rgba(127,127,127,.08));
  border: 1px solid var(--ed-container-border-color, rgba(127,127,127,.18));
  border-bottom: none;
  color: var(--text-color, #555958);
  /* NO font-size/line-height here: rows and pills inherit through the native
     .page-props-editor scope, so they match the real property pane exactly and
     track the user's theme/typography settings. */
  /* The card is injected as the first child of .listitem-transclusion (a flex row);
     take the full width on its own line above the body (see _renderCardInto). */
  order: -1; flex: 0 0 100%; box-sizing: border-box;
}
/* Only transclusions that carry our card wrap, so the card stacks above the body
   instead of squeezing into the flex row. Scoped via :has() so no other rows change.
   The body container fuses with the card into ONE box (card = top half): square off
   its top corners, drop the doubled top edge and any gap between the two. */
.listitem-transclusion:has(> .refx-propcard) { flex-wrap: wrap; row-gap: 0; }
.listitem-transclusion:has(> .refx-propcard) > .transclusion-container-div {
  margin-top: 0 !important;
  border-top-left-radius: 0 !important;
  border-top-right-radius: 0 !important;
  border-top: 1px solid var(--ed-container-border-color, rgba(127,127,127,.14)) !important;
}
.refx-propcard-title { font-weight: 600; font-size: 13px; margin-bottom: 2px; opacity: .92; }
/* Rows render through Thymer's own .page-props-row/.page-props-cell CSS (native
   look, theme-following). Only additions on top of native: */
.refx-native-props { pointer-events: auto; }
.refx-native-props .page-props-row { cursor: default; }
/* native puts this gap via its container scope; replicate inside the card */
.refx-native-props .page-prop-type { display: flex; align-items: center; gap: 9px; }
/* type icon: no extra dimming — native color comes via .page-prop-type itself */
.refx-native-props .page-prop-val { display: flex; align-items: center; }
.refx-native-props .page-prop-val { cursor: pointer; min-height: 20px; }
.refx-propcard-value { min-width: 24px; min-height: 16px; display: inline-flex; align-items: center; border-radius: 4px; }
.refx-propcard-value.refx-propcard-empty { min-width: 0; } /* empty renders blank → pencil sits at the column start, like native */
.refx-propcard-value .prop-multi-values { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; }
/* native hover pencil as the edit affordance */
.refx-propcard-pencil { margin-left: 4px; font-size: 12px; opacity: 0; transition: opacity .12s; }
.refx-native-props .page-props-row:hover .refx-propcard-pencil { opacity: .45; }
.refx-propcard-empty { opacity: .45; }
/* "Properties · All ⌄" header + chooser popup (structured like native's) */
.refalias-capturing { border-color: var(--input-border-focus, rgba(127,127,127,.6)) !important; box-shadow: 0 0 0 2px rgba(127,127,127,.18); }
.refalias-scrow { display: flex; align-items: center; gap: 12px; }
.refalias-sclabel { flex: 1; font-size: 12.5px; }
.refalias-scrow .refalias-capture { width: 150px; flex: none; text-align: center; padding: 8px 10px; }
.refx-props-header { display: flex; align-items: center; gap: 6px; font-size: 12.5px; opacity: .55; margin: 8px 0 5px; }
.refx-props-mode {
  cursor: pointer; display: inline-flex; align-items: center; gap: 3px;
  background: rgba(127,127,127,.14); border-radius: 5px; padding: 1px 4px 1px 7px;
}
.refx-props-mode:hover { background: rgba(127,127,127,.22); }
.refx-props-mode .ti-selector { font-size: 11px; opacity: .8; }
.refx-propchooser { width: 250px; }
.refx-chk { width: 16px; display: inline-flex; justify-content: center; opacity: .9; font-size: 12px; }
.refx-chooser-lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.refx-chooser-sep { height: 1px; background: rgba(127,127,127,.16); margin: 5px 4px; }
.refx-propcard-loading { opacity: .55; }
.refx-propcard-input { padding: 4px 6px !important; font-size: 12px !important; }
/* keyboard nav cursor (class-based, like Thymer's native property nav) */
.refx-propcard-value.refx-nav-focus, .refx-propcard-addbody.refx-nav-focus {
  outline: 2px solid var(--ed-button-primary-bg, #479797); outline-offset: 1px;
  background: rgba(127,127,127,.12); border-radius: 4px;
}
.refx-propcard-addbody {
  margin-top: 7px; font-size: 12px; opacity: .7; cursor: pointer;
  padding: 3px 5px; border-radius: 6px; display: inline-block;
  border: 1px dashed rgba(127,127,127,.35);
}
.refx-propcard-addbody:hover {
  background: rgba(127,127,127,.14); opacity: 1; border-style: solid;
}

/* inline edit popups (choice / relation) — styled like Thymer's native inline
   palette: flat search field with a divider, compact rows, accent selection */
.refx-pop-backdrop { position: fixed; inset: 0; z-index: 2147483000; background: transparent; }
.refx-cardpop {
  width: 320px; max-width: calc(100vw - 24px); padding: 0; gap: 0;
  background: var(--cmdpal-bg-color, #232327);
  border: 1px solid rgba(127,127,127,.22);
  /* native picker radius: .cmdpal--inline uses var(--radius-larger) */
  border-radius: var(--radius-larger, 5px); overflow: hidden;
}
/* an empty embed body is a near-zero-height strip that's hard to click into —
   give OUR embeds (the ones carrying a property card) a comfortable click
   target; the click handler on the node turns it into caret focus / first line.
   Height = ONE text line (1lh) + the container's paddings/margins/borders
   (38px measured live), so creating the first line on click changes NOTHING
   visually (no jump). */
.listitem-transclusion:has(> .refx-propcard) .transclusion-container-div { min-height: calc(1lh + 38px); cursor: text; }
/* the ↗ on record chips (native: padded, slightly raised, opens the record) */
.refx-chip-arrow { padding: 3px; margin-left: 2px; cursor: pointer; opacity: .85; }
.refx-chip-arrow:hover { opacity: 1; }
.refx-cardpop .refalias-input {
  background: transparent !important; border: none !important;
  border-bottom: 1px solid rgba(127,127,127,.16) !important;
  border-radius: 0 !important; padding: 10px 12px !important;
  margin-bottom: 0 !important; font-size: 13px !important;
}
.refx-cardpop .refalias-results { max-height: 280px; padding: 5px; }
/* the base .refalias-result is a COLUMN flex (from the [[ picker's two-line rows);
   option rows here are native-style single lines → force row + left alignment */
.refx-cardpop .refalias-result {
  display: flex; flex-direction: row; align-items: center; justify-content: flex-start;
  /* native option-row radius: .autocomplete--option uses var(--radius-normal) */
  text-align: left; gap: 7px; padding: 6px 9px; border-radius: var(--radius-normal, 4px); font-size: 13px;
}
.refx-cardpop .refalias-result-sel { background: var(--ed-button-primary-bg, #479797); color: #fff; }
/* inline text/number editor inside a card row: flat + native-like, not a pill */
.refx-propcard .refalias-input.refx-propcard-input {
  border-radius: 4px !important; background: transparent !important;
  border: 1px solid var(--input-border-focus, var(--ed-button-primary-bg, #479797)) !important;
  padding: 1px 6px !important; font-size: inherit !important; line-height: inherit !important;
  flex: 1 1 auto; min-width: 0; width: auto;
}
/* text fields grow with content and wrap, so long/multi-line text is editable */
.refx-propcard .refalias-input.refx-propcard-textarea {
  resize: none; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere;
  font-family: inherit; display: block; width: 100%;
}
.refx-cardpop-clear { opacity: .6; }
/* SQUARE slot (was width-only, rendered 17x13): a fill-the-box icon like
   Thymer's blinking-dot collection icon stretched into an oval; a fixed square
   keeps every icon round. align-items/justify centre a normal glyph inside it. */
.refx-opt-ico { width: 17px; height: 17px; flex: 0 0 17px; align-self: center; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; opacity: .85; }
/* current values in the relation picker: green round check badge (built, not a
   font glyph — ti-circle-check-filled is MISSING from this icon-font build) */
.refx-opt-checked .refalias-result-text { opacity: .75; }
.refx-opt-chkbadge {
  width: 17px; height: 17px; flex: none; border-radius: 50%;
  background: var(--ed-button-primary-bg, #479797); color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
}
.refx-opt-chkbadge .ti { font-size: 11px; }
.refx-cardpop-empty { opacity: .5; font-style: italic; padding: 7px 10px; font-size: 12px; }
/* long plain-text values (Synopsis etc) wrap over lines like the native pane —
   they were clipped to one line in the card */
.refx-propcard .page-prop-val { white-space: normal; }
.refx-propcard .page-prop-val .prop-status-0p { white-space: pre-wrap; overflow-wrap: anywhere; overflow: visible; text-overflow: clip; }
.refx-propcard .refx-propcard-value { flex-wrap: wrap; }
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
/* file/image property values */
.refx-propcard-img { width: 135px; max-width: 100%; height: auto; border-radius: 4px; display: block; cursor: pointer; }
.refx-file-ico { margin-right: 5px; font-size: 12px; opacity: .8; }
.refx-imgmenu { width: 200px; }
.refx-lightbox {
  position: fixed; inset: 0; z-index: 2147483200; background: rgba(0,0,0,.75);
  display: flex; align-items: center; justify-content: center; cursor: zoom-out;
}
.refx-lightbox img { max-width: 92vw; max-height: 92vh; border-radius: 6px; box-shadow: 0 18px 60px rgba(0,0,0,.5); }
/* URL values open on click, like native */
.refx-url-value { cursor: pointer; }
.refx-url-value:hover { text-decoration: underline; }
/* "+ Create «query»" row: target collection right-aligned */
.refx-opt-create .refalias-result-text { flex: 1 1 auto; }
.refx-opt-createcol { flex: none; margin-left: auto; font-size: 11px; opacity: .55; }
/* native-style remove affordance on checked rows (whole row still toggles) */
.refx-opt-x { flex: none; margin-left: auto; font-size: 12px; opacity: 0; }
.refx-opt-checked:hover .refx-opt-x, .refx-opt-checked.refalias-result-sel .refx-opt-x { opacity: .8; }
.refx-datepop { padding: 8px; }
/* keyboard-first date picker — replicates the native Thymer picker's anatomy:
   NL input, month header with ‹ ○ › nav, weekday row, 6-week grid with muted
   adjacent-month days, blue focused day, bottom confirm bar with the date. */
.refx-datepop { width: 264px; }
.refx-datepop-header { display: flex; align-items: center; justify-content: space-between; margin: 2px 2px 4px; }
.refx-datepop-month { font-weight: 600; font-size: 13px; }
.refx-datepop-nav { display: flex; gap: 2px; }
.refx-datepop-navbtn { background: none; border: none; padding: 1px 4px; border-radius: 4px; cursor: pointer; color: inherit; opacity: .65; font-size: 12px; line-height: 1; }
.refx-datepop-navbtn:hover { background: rgba(127,127,127,.15); opacity: 1; }
.refx-datepop-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); margin-bottom: 1px; }
.refx-datepop-dow { text-align: center; font-size: 10.5px; opacity: .45; padding: 2px 0; }
.refx-datepop-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; }
.refx-datepop-day { text-align: center; font-size: 12.5px; padding: 3px 0; border-radius: 4px; cursor: pointer; }
.refx-datepop-day:hover { background: rgba(127,127,127,.14); }
.refx-datepop-day.adj-month { opacity: .38; }
.refx-datepop-today .refx-datepop-day-inner { box-shadow: inset 0 0 0 1px var(--button-primary-bg-color, #2d72d2); border-radius: 3px; padding: 1px 4px; }
.refx-datepop-sel { background: rgba(127,127,127,.18); }
.refx-datepop-day.refx-datepop-focus { background: var(--button-primary-bg-color, #2d72d2); color: var(--button-primary-fg-color, #fff); font-weight: 700; opacity: 1; }
.refx-datepop-day.refx-datepop-focus .refx-datepop-day-inner { box-shadow: none; }
.refx-datepop-confirm {
  display: flex; align-items: center; gap: 7px; margin-top: 7px; padding: 5px 8px;
  border-radius: 4px; cursor: pointer; font-size: 12.5px;
  background: var(--button-primary-bg-color, #2d72d2); color: var(--button-primary-fg-color, #fff);
}
.refx-datepop-confirm .ti { font-size: 13px; }
/* keyboard property-editor modal */
.refx-modal-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.refx-modal-label { flex: 0 0 34%; max-width: 34%; font-size: 12px; opacity: .7; }
.refx-modal-row .refalias-input { flex: 1 1 auto; min-width: 0; }
`;
  }
}
