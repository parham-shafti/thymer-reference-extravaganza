# Changelog

## v1.0.0 — 2026-06-21

- Adds a **Set alias for reference** command: put your cursor on a page reference, run it, and type an alias to change what the reference chip displays. Run it again to change the alias, or clear the box to revert to the page's real name.
- An alias is just the `title` field on the reference segment, so this never recreates or moves the link — it only updates that one segment.
- The popup follows the active theme (light or dark) via Thymer's own CSS variables.
- Zero idle cost: the plugin only does work when its command is invoked — no background observers, polling, or global listeners — so it doesn't affect typing or scrolling.
- This release covers **page** references. Aliasing plain-text references is planned for a later version.
