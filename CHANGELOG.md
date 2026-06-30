# Changelog

## v2.0.1 — 2026-06-30

- **Fixed: `+` (multi-term) search in the `[[` picker** now reliably finds matching lines, including ones you just typed. It scans your loaded lines directly instead of relying only on Thymer's search index, which lags behind fresh edits.
- **Fixed: the `[[` search box now stays inside its own panel** in split view, opening under the line you typed on, instead of spilling across the divider and covering the other panel's text.

## v2.0.0 — 2026-06-30

Renamed from **Reference Aliases** to **Reference Extravaganza**: the plugin now creates references, not just aliases them.

- **Type `[[` to reference a line of text inline.** A search box opens at your cursor; keep typing to search, then pick a line (↑/↓ + Enter, or click) to insert a reference to it. The reference shows that line's text. Esc cancels and removes the `[[` you typed.
- **Phrase and multi-term search.** Results match the phrase you type; use `+` to require several terms in the same line in any order (for example `bestäm + leda`). Each result shows a snippet centred on the match (matched words highlighted) with its source page beneath.
- The box opens at the caret and the editor keeps focus, so it works mid-sentence and with several references in one paragraph without breaking your flow.
- **Set alias for reference now works on line references too,** not just page references. Clearing a line reference's alias re-syncs it to the target line's current text (a line reference has no page-name to fall back to).
- **Fixed: aliasing a reference on a line with several references** now targets the one you selected, instead of always the last one.
- **Fixed: the alias box for a line reference** now opens right under the reference (it previously appeared centred on screen).

## v1.2.0 — 2026-06-29

- New command **Set alias keyboard shortcut** — rebind the shortcut from a small "press your keys" dialog; applies immediately, no JSON or restart.
- The alias box now opens **right under the reference**, themed (light/dark), rounded, with an accent Save button.
- The box is **pre-filled with the page's title** (or your current alias) so you can trim it to the part you want; a **×** clears it to type a fresh alias.

## v1.1.0 — 2026-06-29

- The **Set alias for reference** command now also runs from a keyboard shortcut — default **Cmd+Shift+A** (macOS) / **Ctrl+Shift+A** (Windows/Linux). Change it in the **Configuration** tab via `custom.shortcut` (e.g. `Mod+Shift+L`); `Mod` = Cmd on macOS, Ctrl elsewhere.
- The shortcut uses a single keydown listener whose first line is a modifier check that returns immediately for non-matching keys, so it doesn't affect typing performance.

## v1.0.0 — 2026-06-21

- Adds a **Set alias for reference** command: select a page reference, run it, and type an alias to change what the reference chip displays. Run it again to change the alias, or clear the box to revert to the page's real name.
- An alias is just the `title` field on the reference segment, so this never recreates or moves the link — it only updates that one segment.
- The popup follows the active theme (light or dark) via Thymer's own CSS variables.
- Zero idle cost: the plugin only does work when its command is invoked — no background observers, polling, or global listeners — so it doesn't affect typing or scrolling.
- This release covers **page** references. Aliasing plain-text references is planned for a later version.
