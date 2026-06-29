# Changelog

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
