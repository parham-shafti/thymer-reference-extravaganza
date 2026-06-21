// Reference Aliases — v1 (page references)
//
// Adds a command-palette command "Set alias for reference" that lets you rename
// what a reference chip displays. Put your cursor on a page reference, run the
// command, type an alias (or clear it to revert to the page's real name).
//
// An "alias" in Thymer is just the `title` field on a `ref` segment
// ({type:"ref", text:{guid, title?}}). This plugin reads/writes that field.
//
// PERFORMANCE: zero idle cost. The plugin does work ONLY when its command is
// invoked. No MutationObservers, no polling, no requestAnimationFrame loops,
// no global selection/keydown listeners. When you are not actively aliasing a
// reference it contributes nothing to Thymer's typing/scroll/render hot paths.
// The only transient listeners live on the little popup's own <input> and are
// removed the moment the popup closes.

class Plugin extends AppPlugin {
  // Instance state as class fields (Thymer may call onUnload on an instance
  // whose onLoad never ran — never rely on onLoad to initialise these).
  _cmd = null;
  _popup = null;

  onLoad() {
    this.ui.injectCSS(`
      .refalias-popup {
        position: absolute;
        z-index: 2147483000;
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 280px;
        padding: 12px;
        border-radius: 4px;
        border: none;
        background: var(--cmdpal-bg-color, var(--modal-opaque-bg-color, #f7f7f8));
        box-shadow: var(--shadow-dialog, 0 4px 30px rgba(0,0,0,0.25), 0 0 10px rgba(0,0,0,0.22));
        font-size: 13px;
      }
      .refalias-popup input {
        all: unset;
        box-sizing: border-box;
        width: 100%;
        padding: 9px 11px;
        border-radius: 4px;
        background: var(--input-bg-color, #f9f9fa);
        border: var(--input-border, 1px solid #dbdbdf);
        color: var(--text-color, #555958);
        font-size: 13px;
      }
      .refalias-popup input:focus {
        border: var(--input-border-focus, 1px solid #90c3c3);
      }
      .refalias-popup .refalias-hint {
        color: var(--text-muted, #969b9a);
        font-size: 11px;
        line-height: 1.3;
      }
    `);

    this._cmd = this.ui.addCommandPaletteCommand({
      label: "Set alias for reference",
      icon: "ti-pencil",
      onSelected: () => { this._onCommand(); },
    });
  }

  onUnload() {
    if (this._cmd && this._cmd.remove) this._cmd.remove();
    this._cmd = null;
    this._closePopup();
  }

  // Read the editor selection from the focus-independent global registry.
  // Works even while the command palette holds focus, because the selection
  // lives on the listview, not on the focused component.
  _detect() {
    const uni = window.g_universe;
    const lvs = (uni && uni.listviews) || [];
    let best = null;
    for (const lv of lvs) {
      try {
        const sel = lv.selection;
        const pos = sel && sel._caret && sel._caret.pos;
        if (!pos || !pos.list_item || !pos.list_item.state) continue;
        const focused = !!(lv.hasFocus && lv.hasFocus());
        const cand = { lv, pos, focused };
        if (focused) { best = cand; break; }
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

    let refIdx = -1;
    if (hit.linespanType === "ref" && segs[hit.segIndex] && segs[hit.segIndex].type === "ref") {
      refIdx = hit.segIndex;
    } else {
      const refs = segs.map((s, i) => (s.type === "ref" ? i : -1)).filter((i) => i >= 0);
      if (refs.length === 1) {
        refIdx = refs[0];
      } else if (refs.length > 1 && typeof hit.segIndex === "number") {
        refIdx = refs.reduce((a, b) => (Math.abs(b - hit.segIndex) < Math.abs(a - hit.segIndex) ? b : a), refs[0]);
      }
    }
    if (refIdx < 0) return "Put your cursor on a reference first.";

    const seg = segs[refIdx];
    const targetGuid = seg.text && seg.text.guid;
    const targetRec = targetGuid && this.data.getRecord(targetGuid);
    if (!targetRec) {
      // A text reference points at a line item (no record). v1 = page refs only.
      return "Text reference aliases come in a later version — v1 supports page references.";
    }
    return {
      li,
      segs,
      refIdx,
      targetGuid,
      lineGuid: hit.lineGuid,
      anchorNode: hit.anchorNode,
      current: (seg.text && seg.text.title) || "",
      pageName: (targetRec.getName && targetRec.getName()) || "",
    };
  }

  _writeAlias(r, value) {
    const v = (value || "").trim();
    const newSeg = { type: "ref", text: { guid: r.targetGuid } };
    if (v) newSeg.text.title = v;
    const next = r.segs.slice();
    next[r.refIdx] = newSeg;
    r.li.setSegments(next);
    this._toast(v ? 'Alias set to "' + v + '"' : "Alias removed — showing the page's name");
  }

  async _onCommand() {
    const hit = this._detect();
    if (!hit) return this._toast("Place your cursor on a reference first.");
    const r = await this._resolveRef(hit);
    if (typeof r === "string") return this._toast(r);
    this._openPopup(r);
  }

  _openPopup(r) {
    this._closePopup();
    const el = document.createElement("div");
    el.className = "refalias-popup";
    const input = document.createElement("input");
    input.type = "text";
    input.value = r.current;
    input.placeholder = r.pageName || "alias";
    const hint = document.createElement("div");
    hint.className = "refalias-hint";
    hint.textContent = "Enter to save · Esc to cancel · empty to clear the alias";
    el.appendChild(input);
    el.appendChild(hint);
    document.body.appendChild(el);

    // Position under the reference chip (fallback: viewport area).
    let rect = null;
    try { if (r.anchorNode && r.anchorNode.getBoundingClientRect) rect = r.anchorNode.getBoundingClientRect(); } catch (e) {}
    const left = rect ? Math.max(8, Math.round(rect.left)) : 120;
    const top = rect ? Math.round(rect.bottom + 6) : 120;
    el.style.left = Math.min(left, window.innerWidth - el.offsetWidth - 8) + "px";
    el.style.top = top + "px";

    this._popup = el;

    const close = () => this._closePopup();
    const onKey = (e) => {
      if (e.key === "Enter") { e.preventDefault(); this._writeAlias(r, input.value); close(); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
    };
    input.addEventListener("keydown", onKey);
    input.addEventListener("blur", () => setTimeout(close, 120));

    setTimeout(() => { try { input.focus(); input.select(); } catch (e) {} }, 0);
  }

  _closePopup() {
    if (this._popup) { try { this._popup.remove(); } catch (e) {} this._popup = null; }
  }

  _toast(msg) {
    this.ui.addToaster({
      title: "Reference Aliases",
      message: msg,
      dismissible: true,
      autoDestroyTime: 3200,
    });
  }
}
