// Reference Aliases — page references
//
// Commands (command palette + configurable keyboard shortcut):
//   • "Set alias for reference"     — rename what a reference chip displays.
//   • "Set alias keyboard shortcut" — rebind the shortcut, no code/JSON editing.
//
// An "alias" in Thymer is just the `title` field on a `ref` segment
// ({type:"ref", text:{guid, title?}}). This plugin reads/writes that field.
//
// PERFORMANCE: the plugin is idle until you act. Its only always-on cost is a
// single keydown listener for the shortcut, whose first lines are a modifier
// check that returns immediately for every non-matching keystroke — so normal
// typing pays one boolean comparison and nothing else. No MutationObservers,
// no polling, no requestAnimationFrame loops, no work on scroll or render.

class Plugin extends AppPlugin {
  // Instance state as class fields (Thymer may call onUnload on an instance
  // whose onLoad never ran — never rely on onLoad to initialise these).
  _cmd = null;
  _shortcutCmd = null;
  _modal = null;
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
    if (e.code !== h.code && (e.key || "").toLowerCase() !== h.key) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this._onCommand();
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
  }

  onUnload() {
    window.removeEventListener("keydown", this._handleKeydown, true);
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
      if (refs.length === 1) refIdx = refs[0];
      else if (refs.length > 1 && typeof hit.segIndex === "number")
        refIdx = refs.reduce((a, b) => (Math.abs(b - hit.segIndex) < Math.abs(a - hit.segIndex) ? b : a), refs[0]);
    }
    if (refIdx < 0) return "Select a reference first.";

    const seg = segs[refIdx];
    const targetGuid = seg.text && seg.text.guid;
    const targetRec = targetGuid && this.data.getRecord(targetGuid);
    if (!targetRec) {
      // A text reference points at a line item (no record). v1 = page refs only.
      return "Text reference aliases come in a later version — for now this supports page references.";
    }
    return {
      li,
      segs,
      refIdx,
      targetGuid,
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
    if (!hit) return this._toast("Select a reference first.");
    const r = await this._resolveRef(hit);
    if (typeof r === "string") return this._toast(r);
    this._openAliasModal(r);
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
    input.value = r.current || r.pageName;
    input.placeholder = r.pageName || "alias";
    const clear = this._el("button", "refalias-clear", "×");
    clear.title = "Clear";
    clear.addEventListener("click", () => { input.value = ""; input.focus(); });
    field.append(input, clear);

    const foot = this._el("div", "refalias-foot");
    foot.append(this._el("span", "refalias-hint", "Enter to save · Empty clears"));
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

    this._positionPopover(pop, r.anchorNode);
    setTimeout(() => { try { input.focus(); const n = input.value.length; input.setSelectionRange(n, n); } catch (e) {} }, 0);
  }

  // Place the popover just below the reference (flips above if it would overflow).
  _positionPopover(pop, anchorNode) {
    let rect = null;
    try { if (anchorNode && anchorNode.getBoundingClientRect && document.contains(anchorNode)) rect = anchorNode.getBoundingClientRect(); } catch (e) {}
    if (!rect || !rect.width) {
      pop.style.left = "50%"; pop.style.top = "18vh"; pop.style.transform = "translateX(-50%)";
      return;
    }
    const m = 12;
    const w = pop.offsetWidth || 320;
    const h = pop.offsetHeight || 90;
    let left = rect.left;
    if (left + w > window.innerWidth - m) left = window.innerWidth - w - m;
    if (left < m) left = m;
    let top = rect.bottom + 6;
    if (top + h > window.innerHeight - m && rect.top - h - 6 >= m) top = rect.top - h - 6;
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
    this.ui.addToaster({ title: "Reference Aliases", message: msg, dismissible: true, autoDestroyTime: 3200 });
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
