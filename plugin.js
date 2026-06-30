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

class Plugin extends AppPlugin {
  // Instance state as class fields (Thymer may call onUnload on an instance
  // whose onLoad never ran — never rely on onLoad to initialise these).
  _cmd = null;
  _shortcutCmd = null;
  _modal = null;
  _link = null;
  _lastBracketTs = 0;
  _hotkey = null;
  _isMac = /Mac|iPhone|iPad/.test((typeof navigator !== "undefined" && (navigator.platform || navigator.userAgent)) || "");
  _STYLE_ID = "refalias-style";

  // The one always-on listener (capture phase). Cheap-first guards reject the
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

  onLoad() {
    this._injectStyle();

    this._cmd = this.ui.addCommandPaletteCommand({
      label: "Set alias for reference",
      icon: "ti-pencil",
      onSelected: () => { this._onCommand(); },
    });
    this._shortcutCmd = this.ui.addCommandPaletteCommand({
      label: "Set alias keyboard shortcut",
      icon: "ti-keyboard",
      onSelected: () => { this._openShortcutModal(); },
    });

    const cfg = (this.getConfiguration && this.getConfiguration()) || {};
    const shortcutStr = (cfg.custom && cfg.custom.shortcut) || "Mod+Shift+A";
    this._hotkey = this._parseShortcut(shortcutStr);
    window.addEventListener("keydown", this._handleKeydown, true);
    window.addEventListener("keydown", this._handleBracketKey, true);
  }

  onUnload() {
    window.removeEventListener("keydown", this._handleKeydown, true);
    window.removeEventListener("keydown", this._handleBracketKey, true);
    this._exitLinkMode();
    this._hotkey = null;
    if (this._cmd && this._cmd.remove) this._cmd.remove();
    if (this._shortcutCmd && this._shortcutCmd.remove) this._shortcutCmd.remove();
    this._cmd = this._shortcutCmd = null;
    this._closeModal();
    const st = document.getElementById(this._STYLE_ID);
    if (st) st.remove();
  }

  // ---------------------------------------------------------------- detection

  // Read the editor selection from the focus-independent global registry.
  // Works even while a dialog/palette holds focus, because the selection lives
  // on the listview, not on the focused component.
  _detect() {
    const lvs = (window.g_universe && window.g_universe.listviews) || [];
    let best = null;
    for (const lv of lvs) {
      try {
        const pos = lv.selection && lv.selection._caret && lv.selection._caret.pos;
        if (!pos || !pos.list_item || !pos.list_item.state) continue;
        const cand = { pos, focused: !!(lv.hasFocus && lv.hasFocus()) };
        if (cand.focused) { best = cand; break; }
        if (!best) best = cand;
      } catch (e) {}
    }
    if (!best) return null;
    const st = best.pos.list_item.state;
    const span = best.pos.linespan;
    return {
      lineGuid: st.guid,
      pageGuid: st.rguid,
      segIndex: span && typeof span.segment_index === "number" ? span.segment_index : null,
      linespanType: span ? span.type : null,
      anchorNode: span ? span.$node : null,
      // The line's DOM container (carries the ref chips); used to anchor the
      // alias popover even when the caret isn't on a ref span (linespan null).
      lineNode: best.pos.list_item.$node || null,
    };
  }

  // Resolve the targeted reference segment via the stable Data API.
  // Returns a result object, or an error string for the toaster.
  async _resolveRef(hit) {
    const rec = this.data.getRecord(hit.pageGuid);
    if (!rec) return "Couldn't find the current page.";
    const items = await rec.getLineItems();
    const li = items.find((x) => x.guid === hit.lineGuid);
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
  }

  async _onCommand() {
    const hit = this._detect();
    if (!hit) return this._toast("Select a reference first.");
    const r = await this._resolveRef(hit);
    if (typeof r === "string") return this._toast(r);
    this._openAliasModal(r);
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
    this._renderLink();
    this._runLinkSearch("");
  }

  _exitLinkMode() {
    if (!this._link) return;
    if (this._link.searchTimer) { try { clearTimeout(this._link.searchTimer); } catch (e) {} }
    window.removeEventListener("keydown", this._linkKey, true);
    document.removeEventListener("mousedown", this._linkClickOutside, true);
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
    const rec = this.data.getRecord(pageGuid);
    if (!rec) return;
    const items = await rec.getLineItems();
    const li = items.find((x) => x.guid === lineGuid);
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
    const consider = (guid, segments, pageFn) => {
      if (!guid || guid === curLine || seen.has(guid)) return; // never the line you're on
      seen.add(guid);
      const text = this._displayText(segments).trim();
      if (!text) return;
      const lt = norm(text);
      if (!parts.every((p) => lt.includes(p))) return; // every "+" part must appear
      let page = "";
      try { page = pageFn() || ""; } catch (e) {}
      out.push({ guid, text, page });
    };
    const gather = async () => {
      seen.clear();
      out.length = 0;
      // 1) Scan the loaded lines directly. This gives reliable substring AND
      //    matching and, crucially, sees lines you JUST typed — Thymer's search
      //    index lags behind, so searchByQuery often misses fresh content (the
      //    main "+ doesn't work" cause). Limited to loaded lines; (2) covers the
      //    rest of the workspace.
      const byGuid = (window.g_universe && window.g_universe.itemsByGuid) || {};
      for (const guid in byGuid) {
        const it = byGuid[guid];
        if (!it || it.is_deleted || it.is_trashed || it.type === "document") continue;
        if (!it.text_segments || !it.text_segments.length) continue;
        consider(it.guid || guid, this._segmentsFromState(it), () => {
          const r = it.rguid && this.data.getRecord(it.rguid);
          return r && r.getName && r.getName();
        });
        if (out.length >= 40) break;
      }
      // 2) Workspace-wide search for anything not currently loaded.
      for (const sq of terms) {
        let res;
        try { res = await this.data.searchByQuery(sq, 60); } catch (e) { res = { lines: [] }; }
        if (this._link !== link || my !== link.token) return null;
        for (const li of res.lines || []) {
          consider(li.guid, li.segments, () => {
            const r = li.getRecord && li.getRecord();
            return r && r.getName && r.getName();
          });
        }
      }
      return out;
    };
    let results = await gather();
    if (results && results.length === 0) {
      await new Promise((r) => setTimeout(r, 170)); // search can return empty transiently; retry once
      if (this._link !== link || my !== link.token) return;
      const retry = await gather();
      if (retry) results = retry;
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
      row.title = r.text + (r.page ? " · " + r.page : "");
      row.addEventListener("mousedown", (e) => { e.preventDefault(); this._pickLink(r); });
      row.addEventListener("mousemove", () => { if (link.sel !== i) { link.sel = i; this._renderLink(); } });
      list.append(row);
    });
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
    const rec = this.data.getRecord(pageGuid);
    if (!rec) return;
    const items = await rec.getLineItems();
    const li = items.find((x) => x.guid === lineGuid);
    if (!li) return;
    const liveState = this._liveStateByGuid(lineGuid);
    const segs = liveState ? this._segmentsFromState(liveState) : (li.segments || []).map((s) => ({ type: s.type, text: s.text }));
    const range = this._findBracketRange(segs, query);
    if (!range) return; // couldn't locate "[[query" — bail rather than corrupt the line
    const ref = { type: "ref", text: { guid: result.guid, title: result.text } };
    li.setSegments(this._replaceRange(segs, range.start, range.end, ref));
    this._toast('Referenced "' + String(result.text).slice(0, 40) + '"');
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

  // Readable text of a line, rendering references by their alias/target name so
  // result rows aren't full of blanks where references and dates are.
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
        return t.title || t.text || t.name || "";
      })
      .join("");
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

  async _saveShortcut(str) {
    const parsed = this._parseShortcut(str);
    if (!parsed) return this._toast("That shortcut needs Cmd/Ctrl or Alt plus a key.");
    try {
      const conf = this.getConfiguration();
      conf.custom = conf.custom || {};
      conf.custom.shortcut = str;
      const all = await this.data.getAllGlobalPlugins();
      const me = all.find((g) => g.getGuid && g.getGuid() === this.getGuid());
      if (me && me.saveConfiguration) me.saveConfiguration(conf);
    } catch (e) {}
    this._hotkey = parsed; // rebind live — the listener reads this._hotkey
    this._toast("Shortcut set to " + this._prettyShortcut(str));
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

    const close = () => this._closeModal();
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

  _openShortcutModal() {
    const currentStr = ((this.getConfiguration() || {}).custom || {}).shortcut || "Mod+Shift+A";
    let captured = null;
    let fieldRef = null;
    const ctl = this._openModal({
      title: "Alias keyboard shortcut",
      saveLabel: "Save shortcut",
      onSave: () => { if (captured) this._saveShortcut(captured); },
      render: (body) => {
        const sub = this._el("div", "refalias-sub");
        sub.innerHTML = "Current: <b></b>";
        sub.querySelector("b").textContent = this._prettyShortcut(currentStr);
        fieldRef = this._el("div", "refalias-capture refalias-capture-empty", "Press your shortcut…");
        fieldRef.tabIndex = 0;
        const hint = this._el("div", "refalias-hint", "Hold ⌘/Ctrl (or ⌥/Alt), optionally ⇧, then a key. Esc to cancel.");
        body.append(sub, fieldRef, hint);
        return { value: () => captured, canSave: () => !!captured, focusEl: fieldRef };
      },
    });

    // Capture at the window CAPTURE phase (the same level the main shortcut
    // uses), so the combo is intercepted before Thymer's own shortcut handling.
    // A field/target-level listener silently loses any combo Thymer claims.
    const cap = (e) => {
      if (e.key === "Escape") { e.preventDefault(); this._closeModal(); return; }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
      const s = this._eventToShortcut(e);
      fieldRef.classList.remove("refalias-capture-empty");
      if (!s) { fieldRef.textContent = "Add ⌘/Ctrl or ⌥/Alt…"; captured = null; }
      else { fieldRef.textContent = this._prettyShortcut(s); captured = s; }
      if (ctl && ctl._refreshSave) ctl._refreshSave();
    };
    window.addEventListener("keydown", cap, true);
    if (this._modal) this._modal.cleanup = () => window.removeEventListener("keydown", cap, true);
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
  border-radius: 14px; overflow: hidden;
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
  border-radius: 7px; display: flex; align-items: center; justify-content: center;
}
.refalias-x:hover { background: rgba(127,127,127,.18); opacity: 1; }
.refalias-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
.refalias-sub { font-size: 12px; opacity: .6; }
.refalias-sub b { font-weight: 600; opacity: .95; }
.refalias-input, .refalias-capture {
  width: 100%; box-sizing: border-box;
  padding: 11px 12px; border-radius: 9px;
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
  border-radius: 12px; color: var(--text-color, #555958);
  font-size: 13px; line-height: 1.5;
}
.refalias-field { position: relative; display: flex; align-items: center; }
.refalias-field .refalias-input { padding-right: 32px; }
.refalias-clear {
  position: absolute; right: 5px; top: 50%; transform: translateY(-50%);
  border: 0; background: transparent; color: inherit; cursor: pointer; opacity: .5;
  width: 22px; height: 22px; border-radius: 6px; font-size: 16px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
}
.refalias-clear:hover { background: rgba(127,127,127,.18); opacity: 1; }
.refalias-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.refalias-foot .refalias-hint { flex: 1; }
.refalias-save { padding: 6px 16px; }

/* [[ line-reference picker */
.refalias-linkpop { width: 680px; gap: 8px; }
.refalias-results { display: flex; flex-direction: column; gap: 3px; max-height: 300px; overflow-y: auto; }
.refalias-result {
  padding: 8px 11px; border-radius: 7px; cursor: pointer; line-height: 1.3;
  display: flex; flex-direction: column; gap: 3px;
}
.refalias-result-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.refalias-result-page { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; opacity: .5; }
.refalias-result b { font-weight: 700; color: var(--ed-button-primary-bg, #479797); }
.refalias-result:hover { background: rgba(127,127,127,.10); }
.refalias-result-sel { background: rgba(127,127,127,.16); }
.refalias-result-empty { padding: 9px 11px; opacity: .5; font-size: 12px; }
.refalias-footer {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 13px 18px; border-top: 1px solid rgba(127,127,127,.16);
  background: rgba(127,127,127,.04);
}
.refalias-btn {
  border: 1px solid rgba(127,127,127,.28); background: var(--ed-button-bg, transparent);
  color: inherit; cursor: pointer; border-radius: 9px; padding: 8px 16px; font-size: 13px;
}
.refalias-btn:hover { background: rgba(127,127,127,.14); }
.refalias-primary {
  background: var(--ed-button-primary-bg, #479797) !important;
  border-color: transparent !important; color: #fff !important; font-weight: 600;
}
.refalias-primary:disabled { opacity: .5; cursor: default; }
`;
  }
}
