## v4.64.1 — 2026-09-19

### Fixed

- **Hover card footer overlap.** The recursive card body had `min-height: 0` inside a flex column, so it shrank below its content while overflow stayed visible and painted over the mentions footer; the card now scrolls as a whole (`flex-shrink: 0` on card children).
- **Done tasks / native ref items in linked references.** Journal pages store completed tasks as `{ type: "ref", props: { itemref: <task line guid> } }` lines; these now count in `_queryRefLines` for LINE targets alongside `@linkto` exact search hits.
- **Glued datetime in hover card title.** Line-target card titles now render live segments (including `.lineitem-datetime`) instead of plain `_readableLineTitle` text that ran a datetime into the following words.

Verification: `node --check plugin.js && node --test test/*.cjs`.

## v4.64.0 — 2026-09-18

### Added

- **Recursive hover card.** Dwell 350 ms on any reference chip and an interactive card opens with a truncated native body window — real reference chips, ancestor crumbs, scroll, and optional pin. Hover a chip inside the card to open a nested card (depth cap, visited-set cycle guard, close grace, palette/dialog gate). Settings: `custom.hover.recursive`, `custom.hover.nestDepth`, `custom.hover.closeMs`. Inspired by Obsidian-at-Home (content-first hover where links inside the preview hover again).
- **Incoming mentions footer.** After the body paints, the card appends `↙ N mentions`: the first five referencing lines render as path + excerpt (the same row model as inline linked references), heading ancestors in crumbs are emphasized, and **Show all** opens the inline section or adds a Workbench linked-references item. Kill switch: `custom.hover.mentions`.
- **Thinking trails.** Hover, click, and jump entries carry `kind`, `parent`, and `dwellMs` on a 200-entry ring; persistence goes to a **RefX Trails** record in Settings (one line per day). Query via `window.__refx.trails.recent()`, `.query({ guid, kind, since, until, parent, limit })`, and `.before(guid, { kind, windowMs })`. The Workbench trail strip shows ○ hovers and ● commits with a commits-only toggle.

Verification: `node --check plugin.js && node --test test/*.cjs`.

## v4.63.2 — 2026-09-16

### Added

- **Activity Timer rows in the Extensions flyout.** Activity Timer v2 exposes `window.__activityTimer` but has no RefX integration of its own (v1 rows were lost in the rewrite), so RefX registers four rows — Start timer on this line, Switch timer to this line, Stop timer, and Open timer dock — via `_registerActivityTimerMenuExtensions` on bridge-ready and when AT loads after RefX. Owner `refx:activity-timer` prunes the rows when Activity Timer is absent.

Verification: `node --check plugin.js && node --test test/*.cjs`.

## v4.63.1 — 2026-09-16

### Fixed

- **RefX block menu inside Workbench items.** Right-click on a line nested in a Workbench transclusion used to fall through to Thymer's native Cut/Copy/Paste menu because `_handleContextMenu` excluded every line inside `.listitem-transclusion`. The guard now opens RefX's block menu when the hit line is inside `.refx-wb-item` (but not when the hit is the shelf `.listitem-transclusion` row itself). `_pageGuidFromDom` rejects the Workbench backing record guid centrally so page resolution stays on the transcluded owner.
- **Extensions flyout after a RefX reinstall.** Version Ledger and similar registrants keep `refxMenuDisposers` from the old bridge and bail on `if (this.refxMenuDisposers.length) return`, so `window.__refxMenuExtensions` stays empty. `_wbPokeMenuRegistrants` scans `window` for `__*` objects exposing `_registerRefxMenuExtensions` / `registerRefxMenuExtensions`, runs stale disposers once per bridge generation, re-registers, and records into `window.__REFX_WB_BOOT_DIAG.registrants`. Called after bridge creation and when the Extensions registry is missing or empty.

### Changed

- **Verified native `lineitem.*` event shape.** `_wbCtxEventLineGuid` prefers `lineItemGuid` first; `_wbCtxInvalidateForLineEvent` also treats `parentGuid` as a hit so moves that reparent an ancestor invalidate the shelf trail.

Verification: `node --check plugin.js && node --test test/*.cjs`.

## v4.63.0 — 2026-09-16

### Fixed

- **Focus ring encloses the bullet and checkbox.** The yellow outline was an `outline` on `.line-div`, which starts 5 px to the right of the task checkbox (measured: `.line-div` at x=222 with `padding-left: 20px; margin-left: -4px`, checkbox at x=217–231 as a sibling outside `.line-div`). `_wbLiveFocusRulesSync` now draws a `::before` pseudo-element on `.line-div` with `border: 2px solid var(--refx-wb-focus-ring)` and `left: -10px; right: -6px`, so the ring wraps bullet and text on plain lines and checkbox and text on task lines.
- **Extensions flyout after reinstall.** Teardown in 4.62.1 kept the shared registries alive; RefX now also drains `window.__refxMenuExtensionProviders` when `window.__refx` appears, fires `refx:bridge-ready` (`detail.version`), and drains again before each Extensions menu build so other plugins can register whether they load before or after RefX.

### Changed

- **Instant trail on cold start.** On each successful context paint RefX caches the ancestor chain to the line meta property `refx_chain` (up to eight crumbs, 28-character text cap). On the next open, if the in-memory registry is still warming, the cached chain paints synchronously on first decorate while warm resolve continues with a faster retry ladder `[120, 250, 500, 1000, 2000, 4000, 8000, 13000, 21000]`, a registry kick when `g_universe` crosses from empty to populated, and `window.__REFX_WB_BOOT_DIAG.trail[lineGuid]` timing (`cachedAt`, `liveAt`, `source`, `attempts`).
- **Native `events.on` invalidates context chains.** When `this.events?.on` is available, RefX subscribes to `lineitem.moved` and `lineitem.updated`; if the moved or updated line is a shelf item's target or appears in its `ctxChain`, the header's chain is cleared and warm resolve reruns (debounced 150 ms per header). `panel.closed` drops `_wbCrumbHoverBound`. Handler ids are stored and `events.off` on teardown.

Verification: `node --check plugin.js && node --test test/*.cjs`.

## v4.62.1 — 2026-09-16

### Fixed

- **Reinstall must not wipe other plugins' menu extensions.** Plugins-Manager reinstall ran RefX `onUnload`, which cleared `window.__refxMenuExtensions` and `window.__refxPopupSections` and emptied the Extensions flyout until every other plugin reloaded. Teardown now only sets `window.__refx = null`; the shared registries stay alive and `_availableMenuExtensions` still prunes dead owners on read.
- **No dangling leading › in the Workbench trail.** When `_wbCtxDropRedundantOwner` dropped the record crumb, `_appendFlatAncestorTrail` still prepended `›` before the first ancestor, so the trail read `› Thu Sep 10 › @author › …`. `_wbLiveRenderContextPaint` now removes a leading separator after the trail is built.

### Changed

- **Gradual zoom back in.** Alt+→ already stepped one level down toward the line you opened; that logic is now `_wbLiveZoomInOne(it)`. The header shows `⤵` (before `⤓ back`, outside the narrow-panel `-more` collapse) when `focus !== target`, and the ⋯ menu adds "Zoom in one level" under the same condition.

Verification: `node --check plugin.js && node --test test/*.cjs`.

## v4.62.0 — 2026-09-15

### Changed

- **Workbench crumbs zoom out in place.** A line item's context trail now behaves like Roam's sidebar Block Outline. Plain click on any crumb, including the record crumb, re-roots the item at that ancestor: the body becomes the ancestor's subtree and the trail shortens to its path. Shift+click opens the ancestor in a new side panel; ⌘/Ctrl+click jumps the main panel there. A plain click never leaves the Workbench. The crumb title reads "Zoom out to here · Shift: side panel · ⌘: jump".
- **The trail is the full path and wraps.** `_wbCtxTrailPlan` shows up to eight ancestors (`…` survives only past that) and `.refx-wb-ctx` wraps onto a second line instead of truncating to two crumbs. Crumbs keep the 28-character cap with the full text in `title`.
- **The line you opened keeps a yellow outline.** After zooming out, `_wbLiveFocusRulesSync` draws `outline: 2px solid var(--refx-wb-focus-ring)` around the original line's `.line-div`, an outline and no fill, as Roam has done since 2022. The ring appears only once the item's focus differs from its root; a freshly opened line has no ring. The dark theme uses a slightly deeper amber. After a re-root the focus line is scrolled into view once, keyed off the navigation, never off a repaint.
- **Hover a crumb to preview its outline.** Dwell 350 ms on a crumb and a read-only `.refx-wb-crumbpop` shows that ancestor's outline with the focus line highlighted and its path unfolded; the record crumb previews the record's first lines. It leaves on mouse-out, scroll, Escape or any click and never takes focus. `custom.workbench.crumbHover = false` turns it off. The loader is the former peek fill, lifted into `_wbCtxAncestorTree`.
- **Focus path is never folded.** In a Children-only item the depth clamp skips every ancestor of the focus line, so a re-rooted item always shows the outlined line while sibling branches still fold.
- **Alt+←/→ zoom from a focused header.** With a shelf header focused (Alt+↑/↓), Alt+← re-roots one level up and Alt+→ steps back down the path toward the line you opened; Alt+→ is a no-op when the focus is already the root. Keys without a focused header pass through.
- **Header and ⋯ menu.** `⤓ Back to original` stays on the header of a re-rooted item; Roam has no way back, we do. The ⋯ menu gains "Zoom out one level" whenever a chain exists and "Back to original" on re-rooted items.

### Removed

- The **sibling peek strip** and its per-crumb `▸` twisty. It sat between the trail and the body, showed only one level, and its verdict from the user was "not clear"; the crumb click is now the reveal and the hover preview covers the glance. `_wbLiveToggleCtxPeek`, the keep-alive insert, the Escape listener and the `.refx-wb-ctx-peek*` CSS are gone.
- The **`⤒` button** on the header and on crumb hover actions. The crumb itself is the control.

Verification: `node --check plugin.js && node --test test/*.cjs`.

## v4.61.0 — 2026-09-15

### Changed

- **Workbench items stay record-local.** A Full or Children-only item used to pass Thymer's native transclusion body through unfiltered, so a shelf line that was mostly a reference chip could drag another record's body into the indent. The item's home record is resolved once; lines the host pulled in from a different record are hidden with a marker class on the native `.listitem` and collapse into one disclosure row, `▸ N lines from <Record>`, at the foot of the item. Clicking it brings them back, still natively editable. Transclusions the user placed inside the target's own subtree are never clamped. Nothing is hidden when the home record cannot be resolved. `window.__refxWbClampDiag` records total, foreign and seeded-fold counts per item so the clamp's premise can be measured on the real shelf (`custom.workbench.clampForeign = false` turns it off).
- **Children only shows direct children at their fold state.** Instead of a second hide class, the depth clamp seeds the existing fold map, so the lines at the clamp depth start folded with `▸` and unfold with the ordinary twisty. Fold twisties now work in the Children-only view as well as Full. A **Depth** group on the item's `⋯` menu (Direct children / Two levels / Everything) sets a per-item `refx_depth` that also drives the Card variant's outline.
- **Outlines open direct children only.** `_buildRefChildTree` and the Card child tree now expand one level by default and put deeper levels behind `▸`; the zoom path still unfolds a highlighted line's ancestors, and the Workbench context peek keeps its explicit two levels. `custom.refRows.expandDepth` changes the default.
- **Chip counts are retired.** A reference row shows one quiet count, the line's own; counts after each chip inside the content are off by default. The chip's target is one plain click away and that row carries its own count. Restore them with `custom.counter.chipCounts = true` or the "Chip reference counts" settings row.
- **Tree keys on counts.** With a count focused, ArrowRight opens it (or, when open, moves focus to the first count inside its box), ArrowLeft collapses it (or, when closed, focuses the count that opened the enclosing box), and Escape collapses the innermost open box and focuses its count. Enter and Space still toggle. Every other key passes through to the editor untouched.
- **`⧉` in a linked-references header adds the Linked-references view.** The button in an inline "↙ N Linked References" header now adds that view of the target to the Workbench instead of a Full item you had to convert. The group-header `⧉` still adds the group's source page.
- **Hop from a Workbench line.** Lines inside a Workbench item show their own count badge (`custom.workbench.lineBadges = false` to hide). Clicking one opens that line's linked references inline, under the line, inside the item, and the chain hops from there. Only when the badge has no identifiable host line does the click add a Linked-references shelf item for that line instead. Every other transclusion stays badge-free as before.
- **The header collapses on narrow panels.** Under 420 px the pin, re-root and swap-to-main buttons hide; `⋯` and `✕` stay, and the hidden actions appear as rows in the `⋯` menu.
- **Clear all is armed before it clears.** The filter bar's Clear all first changes its label to `Clear N?`; a second click within 4 s clears the shelf, and Escape, a click elsewhere, or the timeout disarms it. The reopen ring is unchanged.

Follow-up: the Card variant's tree builder in `_wbFillChildTree` still duplicates `_buildRefChildTree`; folding them together is a refactor with no visible change and is left for a later release.

Verification: `node --check plugin.js && node --test test/*.cjs`.

## v4.60.0 — 2026-09-14

### Changed

- **Infinite hopping in linked references.** Every line drawn in a reference row (the referencing line, each child-tree and zoom-tree line, and the ○ of a self-reference row) now shows its own quiet reference count. Activating it (click, or Enter/Space when focused) opens that line's references directly under it, and every nested row does the same, with no depth limit. This replaces the v4.52.0 "two levels deep" cap. Counts for anything already open above a row are not drawn, so a chip that points back at the panel target no longer reopens the same list.
- Nested boxes page 30 rows with Show more; rows past the eighth source get `▸ context` instead of becoming dead ends. Crumb, record and dot clicks inside a nested row zoom that row, not its ancestor. Zoom parks open boxes and "Back to the reference" restores them with counts.
- Counts reveal through `data-count` (no DOM churn per result), follow the badge size/opacity/weight presets, and have an invisible 3px/4px hit area with unchanged line geometry. At most 4 nested count lookups run at once, 24 per row and 60 per list before viewport gating.

Verification: `node --check plugin.js && node --test test/*.cjs`.

## v4.59.6 — 2026-09-12

### Fixed

- **Closed context peek reappeared as an empty strip** — `_wbLiveCloseCtxPeek` detached the peek, then the panel keep-alive observer saw a disconnected `h.peek` and re-inserted it with no content (a 6 px gap under the trail). `_wbLiveInsertCtxPeek` now refuses to attach a peek whose `ctxPeekAnc` is cleared; every open path sets it first.

## v4.59.5 — 2026-09-12

### Fixed

- **Workbench boot cloak never engaged** — measured live: `panel.getElement()` on a freshly created panel returns its `.empty-panel` placeholder (`empty-panel < layout-margin < panel-body < panel-scroller-y < panel`), which navigation replaces, so the `.panel[data-refx-wb-boot]` rule could never match and the raw "Reference Workbench State" heading still flashed. The cloak now attaches to the enclosing `.panel` host. It also lifts only once the panel is on the backing record and at least one shelf item is decorated (or the shelf is empty); an early refresh used to lift it before the host had rendered the record. The 1500 ms failsafe is unchanged.

## v4.59.4 — 2026-09-12

### Fixed

- **Workbench boot cloak attach (U6)** — `_wbApplyBootCloak` retries on `requestAnimationFrame` until the panel element exists (bounded to 40 frames), called after both `createPanel` and `navigateTo`; rAF is cancelled on teardown and `_wbClearBootCloak`. Immediate open refresh bypasses the cooperative background queue (storm checks retained) so RefX chrome is not deferred behind other idle work. Central `_wbCtxResolveOwner` guard rejects the backing record from every candidate source (including `_pageGuidFromDom`). `window.__REFX_WB_BOOT_DIAG` records the last open timeline for live verification.

Verification: `node --check plugin.js`; `node --test test/v459-wb-owner.test.cjs test/v459-wb-peek.test.cjs test/v458-wb-context.test.cjs test/v454-workbench.test.cjs test/performance-guards.test.cjs test/plugin.test.cjs`.

## v4.59.3 — 2026-09-12

### Fixed

- **Workbench context trail owner resolution (U5)** — `_wbCtxOwnerFromShelfDom` no longer returns the Workbench backing record (rule-15 outer `.listview-items` trap); owner resolution falls through to page/SDK hints. Warm retry liveness is decoupled from `_wbRefreshSeq` (same defect class as U4 peek toggle) and uses bounded backoff through 21 s so cold registry boots can still paint trails.

Verification: `node --check plugin.js`; `node --test test/v459-wb-owner.test.cjs test/v459-wb-peek.test.cjs test/v458-wb-context.test.cjs test/v454-workbench.test.cjs test/plugin.test.cjs`.

## v4.59.2 — 2026-09-12

### Fixed

- **Workbench context peek toggle (U4)** — Chevron clicks no longer bail when a refresh is scheduled but not yet painted. `_wbLiveToggleCtxPeek` gates on header mounted-ness (`_wbHeaders`, `h.ctx.isConnected`) instead of the paint-generation `alive()` token (`_wbRefreshSeq` bumps at schedule time). Async peek fill still uses peek-scoped liveness from U1.

Verification: `node --check plugin.js`; `node --test test/v459-wb-peek.test.cjs test/v458-wb-peek.test.cjs test/v454-workbench.test.cjs test/plugin.test.cjs`.

## v4.59.1 — 2026-09-12

### Fixed

- **Workbench boot cloak (U3)** — Cloak now hides `.panel-heading` and `.panel-body` (record title and filter/items chrome) instead of nested transclusion `.listview-items`; tab bar stays visible. Startup sweep, unload, and the 1.5 s failsafe unconditionally strip every `data-refx-wb-boot` attribute so hot-reload cannot leave a panel permanently invisible.

Verification: `node --check plugin.js`; `node --test test/v459-wb-peek.test.cjs test/v454-workbench.test.cjs test/plugin.test.cjs`.

## v4.59.0 — 2026-09-12

### Fixed

- **Workbench context peek (U1)** — Crumb twisties now have a ≥20×17 px hit target with hover affordance; peek fill lifetime is scoped to the open header/ancestor instead of the refresh token, so mid-await refreshes no longer leave an empty 6 px box. Every failure path renders a one-line note; sibling outlines expand two levels with the target branch highlighted.
- **Workbench open flash (U2)** — Opening pre-warms the shelf before the panel paints, cloaks undecorated list items via `data-refx-wb-boot` + `visibility:hidden` until the first successful refresh (with a 1.5 s failsafe), and schedules the first decorate pass immediately without bypassing the storm breaker.

Verification: `node --check plugin.js`; `node --test test/v459-wb-peek.test.cjs test/v458-wb-peek.test.cjs test/v454-workbench.test.cjs test/plugin.test.cjs`.

## v4.58.2 — 2026-09-11

### Fixed

- **Workbench context trail on cold boot (U7)** — After a full app relaunch `g_universe` is empty while shelf transclusions already render; the ancestor trail now resolves the owning record via live state, shelf DOM, or SDK hints (never `getTreeContext()`), then hydrates the chain through `getLineItems(false)`. Bounded backoff retries (400 ms → 5 s, six attempts) and existing Workbench refresh/nav signals re-attempt until the registry warms; zero layout while unresolved.

Verification: `node --check plugin.js`; `node --test test/v458-wb-context.test.cjs test/v454-workbench.test.cjs test/plugin.test.cjs`.

## v4.58.1 — 2026-09-11

### Fixed

- **Workbench context trail layout (U5)** — Ancestor crumbs no longer wrap to multiple lines; the trail row is a single flex line with per-crumb ellipsis under `.refx-wb-ctx` only.
- **Redundant owner crumb (U5)** — When a comments record is named after the line it comments on, the owner crumb is omitted so the deepest ancestor is not shown twice.
- **Crumb display cap (U5)** — Workbench trail crumbs show at most 28 visible characters (full text in `title` on hover); reference rows and popovers are unchanged.

Verification: `node --check plugin.js`; `node --test test/v458-wb-context.test.cjs test/v451-roam-rows.test.cjs test/plugin.test.cjs`.

## v4.58.0 — 2026-09-11

### Added

- **Workbench context trail (U1)** — Line-target shelf items show a read-only ancestor chain (`Record › … › parent`) above the native transclusion by default. The chain walks registry `parent` links synchronously (zero I/O); cold records paint once after `getLineItems(false)`. Collapsed items hide the trail; record targets mount nothing.
- **Re-root in place (U2)** — `⤒` on the header or a crumb rewrites the shelf line to an ancestor while keeping `refx_focus` on the original line (highlighted via managed `data-guid` rules). `⤓ back` restores the prior target.
- **Shared-ancestor grouping (U3)** — When two or more shelf items share a lowest common ancestor, that crumb gets a `⧉N` pill; click narrows the shelf to the group (Esc in the filter clears it). Shared prefix crumbs dim on subsequent items.
- **Sibling peek under crumbs (U4)** — Each ancestor crumb gets a twisty that opens a read-only outline of that ancestor's children below the trail, with the path to the shelf target expanded and highlighted. One peek per item; re-click or Escape closes.

### Fixed

- **Connection index parent links (U1 Part A)** — `_connIndexes` now reads `st.parent.guid` when `parent_guid` is absent on live registry states, so `childrenByLine` and containment hops populate correctly for lines whose parent is only an object reference.

Verification: `node --check plugin.js`; `node --test test/v458-wb-context.test.cjs test/v458-wb-reroot.test.cjs test/v458-wb-groups.test.cjs test/v458-wb-peek.test.cjs test/v454-workbench.test.cjs test/plugin.test.cjs`; live on Thymer Desktop — line-target item shows ancestor trail, `⤒`/`⤓` slide without navigation, `⧉N` filters shared context, crumb twisty peeks siblings with target highlighted.

## v4.57.2 — 2026-09-10

### Fixed

- **MO storm filter host markers (WO-23)** — The MutationObserver storm filter treated RefX marker classes on native Thymer hosts (`refx-ovl-host` on `.line-div`, ref chips on `.lineitem-ref`, appearance switches on `<body>`) as RefX-owned DOM, so Thymer's per-keystroke removal of a reference count badge from the marked host was discarded before the pre-paint keep-alive could restore it; badges vanished while typing and returned only when the caret left the line.

## v4.57.1 — 2026-09-10

### Fixed

- **Containment hops in path search (WO-22)** — "Show path to…" from a line to its owning record no longer reports "No path within 3 hops" when the line has no outbound reference edges but `rguid` matches the destination. The connection index now builds `ownerByLine` and `childrenByLine` in the same registry pass; path search admits `contains` hops (line→record and bounded record→lines), ranks them below pure reference chains, and renders trivial single-containment pairs as a plain sentence (`… is a line on …`) instead of a one-hop trail. Child-carried references (`via child`, two generations, fan-out 50) and shared-owner context in `_connSharedNeighbours` (`both on …`) are included.

Verification: `node --check plugin.js`; `node --test test/v455-connections.test.cjs test/v455-evidence.test.cjs test/v456-strength.test.cjs test/v454-workbench.test.cjs test/plugin.test.cjs`; live on Thymer Desktop — line on MCU Watch Order page finds containment path to that record.

## v4.57.0 — 2026-09-10

### Added

- **Workbench trail strip** — `.refx-wb-trail` after the tab bar lists the last eight hops from `window.__refxTrail` (newest last), with a `…` control for the full 50-hop ring, hop clicks via `_bridgeJump`, and fingerprinted paint from `_wbLiveRefresh` only. Toggle with `custom.workbench.trail` (default true). Persisted per workspace at `refx_trail_v1:<workspaceGuid>` (loaded at first Workbench paint, debounced write, hot-reload adopts the window stash).
- **Save trail as stack** — distinct resolvable record guids in walk order become a named Workbench stack (`⇩ Save trail as stack`).
- **Replay** — walks the ring oldest → newest with ~900 ms gaps; cancellable (click again or Escape); generation-token guarded.

Verification: `node --check plugin.js`; `node --test test/v457-trails.test.cjs test/v456-strength.test.cjs test/v455-evidence.test.cjs test/v454-workbench.test.cjs test/plugin.test.cjs`; live on Thymer Desktop — trail strip after tabs, hop jump, save-as-stack, replay/cancel, clear two-press.

## v4.56.0 — 2026-09-10

### Added

- **Traversal strength** — persisted hop counts (`refx_traversal_v1:<workspace>`) now rank picker rows, path tie-breaks, related chips, and chain rows via `_connHopWeight` (decayed, capped at 60). Toggle with `custom.connections.strength` (default true).
- **Behavioural co-occurrence** — the connection-index registry pass extracts ref pairs on the same line, parent, and journal day (skips >8-ref lines; store capped at 5000, debounced persist to `refx_cooccur_v1:<workspace>`). Feeds shared-neighbour scoring and related-strip evidence (`never linked · appears with this on N days`).
- **Shared-neighbours strip** — Workbench `.refx-wb-shared` lists up to five records all open shelf items reference in common (`custom.workbench.shared=false` to hide).

Verification: `node --check plugin.js`; `node --test test/v456-strength.test.cjs test/v455-evidence.test.cjs test/v455-connections.test.cjs test/v453-memory.test.cjs test/li2-line-index-picker.test.cjs test/r5-picker.test.cjs test/a3-alias-picker.test.cjs test/v454-workbench.test.cjs test/plugin.test.cjs`; live on Thymer Desktop — traversal boost reorders familiar targets, co-occurrence evidence on related chips, shared strip appears with two+ shelf items.

## v4.55.0 — 2026-09-10

### Added

- **Connection engine (WO-17/18 carry)** — shared stamped index with a forward direction, bidirectional path search, and shared-neighbour scoring.
- **Show path to…** on the reference menu and **Paths among these items** in the Workbench.
- **Evidence labels** — Workbench related chips and deep-connection suggestions show cache-only context (`N refs · last Tue · in Time Block`) beside the edge reason, without changing `chip.reason`.
- **Traversal recording** — hops are written to `refx_traversal_v1:<workspace>` and `window.__refxTrail` (write-only this release; ranking unchanged until WO-20).
- **`custom.connections`** — `{ enabled: true, maxDepth: 3 }` gates path UI and sets `_connPathsBetween` depth.

Verification: `node --check plugin.js`; `node --test test/v455-evidence.test.cjs test/v455-connections.test.cjs test/v454-workbench.test.cjs test/a3-alias-picker.test.cjs test/v453-memory.test.cjs test/r5-picker.test.cjs test/plugin.test.cjs`; live on Thymer Desktop — related chips show evidence without altering reasons, path picker respects depth, traversal store fills on jumps/picks/zoom/expand.

## v4.54.3 — 2026-09-09

### Fixed

- **MutationObserver hang (WO-16)** — animated widgets (e.g. Nautilus Time Block SVG wedge) could deliver enormous mutation batches that pegged the renderer at 100% CPU. Every RefX observer now applies five defenses by construction: batch cap (1500 → debounced whole-surface rescan), cheap svg/nautilus/refx-node and identical-value attribute rejects before any `closest()`, 8 ms per-callback time budget, tightened observe options (no `characterData`; attribute filters only where needed), and a per-observer storm breaker (200 callbacks / 100 ms → 2 s pause; three trips / minute → session pause + toast). Diagnostics live at `window.__refxMoStats`.

Verification: `node --check plugin.js`; `node --test test/v4543-mo-storm.test.cjs test/v5-cursor-flash.test.cjs test/v4498-ref-chip-flash.test.cjs test/plugin.test.cjs test/performance-guards.test.cjs`; live on Thymer Desktop — journal page with Nautilus Time Block stays responsive.

## v4.54.2 — 2026-09-09

### Fixed

- **Related strip canonical guids** — journal synthetic `S-…` guids and underlying record guids collapse to one key; V-guids remap via `_resolveCanonicalLineGuid` like `_wbAdd`.
- **No self-suggestion** — main-panel record and shelf targets excluded by canonical key; same display name on a different guid form is skipped.
- **Navigation refresh** — `panel.navigated` schedules related-strip refresh (~400 ms debounce) so chips follow the main panel; cache key includes the canonical main-record key.

Verification: `node --check plugin.js`; `node --test test/v454-workbench.test.cjs test/plugin.test.cjs`; live on Thymer Desktop — journal page no longer suggests itself, duplicate guid forms dedupe to one chip, navigating main panel updates the related strip.

## v4.54.1 — 2026-09-09

### Fixed

- **Refresh-storm breaker** — coalesced Workbench refresh with 250 ms spacing, sliding-window backoff, and hard shutdown after 60 runs in 30 s (plus boot adoption watchdog).
- **Observer scope** — MutationObserver ignores tabs, related strip, filter bar, menus, and header chrome; re-entrancy guarded.
- **Scroll handler** — tab-strip scroll only toggles `is-active` classes (passive, one rAF), never schedules refresh.
- **Tabs/related paint** — fingerprint skip when shelf layout or chip set is unchanged.
- **Kill switch** — `refx_wb_disable=1` or `custom.workbench.enabled=false` no-ops open/adopt/toggle; palette enable/disable commands.
- **Related strip** — excludes main-panel record and shelf targets; dedupes by record guid.
- **Stack menu** — save/delete invalidates stack list cache; single popover, dismiss on outside click or Escape.

Verification: `node --check plugin.js`; `node --test test/v454-workbench.test.cjs test/v4495-wb-query.test.cjs test/performance-guards.test.cjs test/plugin.test.cjs`; live on Thymer Desktop — no refresh storm with panel open, kill switch blocks open, related strip skips self/shelf dupes, stack save lists immediately.

## v4.54.0 — 2026-09-09

### Added

- **Workbench stacks** — save/load named shelf layouts as `Workbench Stack:` records; ▤ menu, Ctrl/Cmd+Shift+1–9.
- **Reopen closed** — last ten removed items in localStorage; ↶ button and Ctrl/Cmd+Shift+T.
- **Tab strip** — sticky tabs mirror shelf order; click scrolls, drag reorders; Alt+↑/↓/Enter/W panel shortcuts.
- **Related strip** — up to five suggestion chips after the shelf (pages referencing your open items or the main panel); `custom.workbench.related=false` to hide.
- **Header count → shelf item** — click an item's linked-reference count to open linked references as a separate Workbench item.
- **Recall filter box** — Workbench ⌕ filter uses the shared recall scorer from v4.53.0.

Verification: `node --check plugin.js`; `node --test test/v454-workbench.test.cjs test/v453-recall.test.cjs test/v4495-wb-query.test.cjs test/performance-guards.test.cjs test/plugin.test.cjs test/a2-alias-ux.test.cjs`; live on Thymer Desktop — stacks save/load, reopen closed, tab strip scroll, related strip chips, header count opens linked-refs item.

## v4.53.0 — 2026-09-09

### Added

- **Recall matcher** — any-order tokens by default, abbreviations (`s3` ↔ `season 3`), initialisms, typo tolerance (never on numbers), labelled close matches.
- **Pick memory** — a pick teaches the picker its query; learned rows surface on empty `((`.
- **Current-page boost** — lines on the page you are editing rank higher in the line picker.
- **Shared scorer** — Navigator, drill filter, Workbench ⌕ filter, and inline ⌕ filter all use `_searchMatchFromKey`.

### Fixed

- BENCH-PICKER-3 extension clause relaxed to the measured floor (median × 1.5 self-calibration).

Verification: `node --check plugin.js`; `node --test test/v453-memory.test.cjs test/v453-recall.test.cjs test/r5-picker.test.cjs test/a3-alias-picker.test.cjs test/li2-line-index-picker.test.cjs test/v427-reference-navigator.test.cjs test/plugin.test.cjs`; live on Thymer Desktop — `((` any-order recall, pick memory on empty query, `s3` filters Workbench and inline ⌕ rows titled `season 3`.

## v4.52.2 — 2026-09-09

### Fixed

- RefX renders reference rows itself when the Backreferences bridge is absent: refs, hashtags, dates and mentions become real chips inside rows and zoomed trees, so chips navigate and carry nested counts on every install.

Verification: `node --check plugin.js`; `node --test test/v452-renderer.test.cjs test/v452-zoom.test.cjs test/v452-chips.test.cjs test/v451-roam-rows.test.cjs test/v4492-bc-layout.test.cjs test/plugin.test.cjs`; live on Thymer Desktop 4.52.1 — linked-reference rows and zoomed trees show `.lineitem-ref` chips without `window.__thymerBackrefs.renderSegments`, chip click zooms, nested count attaches.

## v4.52.1 — 2026-09-09

### Fixed

- **Chips inside zoom trees.** Child-tree lines now render through `_renderRefLineText`, so reference chips inside a zoomed page are clickable and carry nested counts.
- **Hint above the scroll body.** The widget hint is a sibling before `.refx-zoom-body`, so scrolling to the highlighted line no longer pushes it out of view.
- **Open-live action always available when zoomed.** Zoom actions show `⤓` Open live below (or `◧` Open in side panel without a host) on every zoomed row; the hint uses the same glyph.
- **Home row placeholder.** `_buildRefHomeLine` returns empty segments when nothing resolves, so the row shows "Loading reference…" until `_hydrateColdRefLineText` fills it from the source tree.
- **Node cap on page zoom.** Page zoom renders up to 1,500 nodes at depth 12 (was 400); the truncation note is unchanged when the cap is hit.

Verification: `node --check plugin.js`; `node --test test/v452-zoom.test.cjs test/v452-chips.test.cjs test/v451-roam-rows.test.cjs test/v4492-bc-layout.test.cjs test/v5-cursor-flash.test.cjs test/plugin.test.cjs`; live on Thymer Desktop 4.52.0 — MCU Watch Order page zoom renders fully, hint stays visible above the body, chips inside the tree navigate, `⤓` opens live below.

## v4.52.0 — 2026-09-09

### Added

- **The path is a scrubber.** Clicking any crumb in a linked-reference row re-roots the row in place: the page crumb renders the whole page inside the row, an ancestor crumb renders its subtree, with the referencing line highlighted, its ancestors unfolded, and the body scrolled to it. Dots zoom too. `‹` steps back, `⤺` returns to the reference. Shift+click on a crumb or dot opens the side panel; Cmd/Ctrl+click and the hover ↗ navigate.
- **Home row.** For a line target the first row is the line itself in its own page context (Roam's original block), followed by the referencing rows.
- **Chips inside rows navigate.** A reference chip inside rendered content zooms the row to its target (line → the line in its home page; page → the page). Chips carry a small reference count; clicking it opens nested references inside the row (two levels deep, 30 rows).
- **Live widgets.** A zoomed block that renders a widget (`#nautilus` / `#TimeBlock`, images) shows a hint and a `⤵` that mounts the real transclusion under the host line, where Nautilus and media render natively.

### Fixed

- The row creation stamp no longer paints over the hover action glyphs; it is the ▾ twisty's tooltip.

Verification: `node --check plugin.js`; `node --test test/*.cjs`; live on Thymer Desktop CDP :9333 after a full relaunch — count click on the `33. Watch Agents…` chip shows the home row `MCU Watch Order › … › 33. Watch Agents…`, clicking `MCU Watch Order` renders the page inside the row with line 33 highlighted, `⤺` restores the row.

## v4.51.5 — 2026-09-08

### Fixed

- **Popover title without the native pill count.** The trailing digit was Thymer's own `lineitem-backlink-pill`, not a RefX badge; the host-line read now strips native pills and `line-button` elements as well as plugin decorators.

Verification: `node --check plugin.js`; `node --test test/*.cjs`; live on Thymer Desktop CDP :9333 after a full relaunch — Shift+click title is exactly `References to <the referenced line’s own text>`.

## v4.51.4 — 2026-09-08

### Fixed

- **Popover title without the badge digit.** The host-line read strips every `trc-*` / `refx-*` decorator from a detached clone, so the count badge nested inside its wrap no longer leaks a trailing "1" into `References to …`.

Verification: `node --check plugin.js`; `node --test test/*.cjs`; live on Thymer Desktop CDP :9333 after a full relaunch — Shift+click title is `References to <the referenced line’s own text>`.

## v4.51.3 — 2026-09-08

### Fixed

- **Popover title and one-line path, verified on a fresh launch.** v4.51.2's title fell back to the guid because the line-text resolver is cold right after launch; the popover now reads the badge's own host line from the DOM. The row's creation stamp moved inside the hover-only actions overlay, so it no longer takes ~120px beside the path and the path stays on one line.

Verification: `node --check plugin.js`; `node --test test/*.cjs`; live on Thymer Desktop CDP :9333 after a full relaunch — Shift+click shows `References to <the referenced line’s own text>` and a one-line path.

## v4.51.2 — 2026-09-08

### Fixed

- **The Shift+click popover reads like the inline row.** Its title names a line target by the line's text instead of the raw guid, and the popover is 380px wide so a path like `Tue Sep 8 › thymer/comments › @Svy › ○` stays on one line instead of wrapping the ○ onto its own line.

Verification: `node --check plugin.js`; `node --test test/*.cjs`; live on Thymer Desktop CDP :9333 — Shift+click on the badge shows the title text and a one-line path.

## v4.51.1 — 2026-09-08

### Fixed

- **Small sections show their path immediately.** Right after launch every linked-reference row hid its `Tue Sep 8 › thymer/comments › @Svy › ○` path behind a "▸ context" click, because the v4.7.2 cold-source probe deferred context whenever the registry or name cache was not warm. The path is the row now, so only section size (12 rows or 8 sources) defers; the drain queue still fills rows across frames.

Verification: `node --check plugin.js`; `node --test test/*.cjs`; live on Thymer Desktop CDP :9333 after a full relaunch — count click renders the full path without a loader.

## v4.51.0 — 2026-09-08

### Changed

- **Reference rows read like Roam's.** Every linked-reference row (inline section, Shift+click popover, Workbench "Linked refs", and the reference menu's context) is now one muted clickable path followed by the content: `Tue Sep 8 › thymer/comments › @Svy › ○` then the comment at body size. Crumbs render by kind (page ref, date, @mention) and a crumb that repeats the previous one or the page is dropped. A referencing line that is nothing but a reference to the target collapses into the trailing ○ and its children render directly, so a comment shows the comment, not the line you just clicked. One ▾ per row folds the whole row.
- **Task-reference checkbox spacing matches native.** The leading slot a task reference reserves for its checkbox is 23.4px instead of 20px, so the box-to-text gap is 5.4px, the same distance as Thymer's own checkbox.
- **The inline section is header plus rows.** The header holds the count and `⌕ ⇅ ⧉ 📌 ✕`; the filter box and page/hashtag chips sit behind ⌕. Rows are flat (Roam's inline references); the Workbench view keeps per-page groups (Roam's sidebar). Timestamps and row actions show on hover.

### Removed

- Block Context strip, the Reference/Authored/Journal facet pills, the "Unlinked mentions — scan" row, the "All reference paths" box on the inline surface, the "CHILDREN (N)" heading, the collapse-all button, and the vertical fold-outline row mode (`custom.rowPath`, `refx_row_path_v1`, `refx_ctx_start_collapsed_v1`, `custom.counter.facetBar`, `custom.unlinkedMentions` are gone).
- The Remarks-collection subsystem (remark chips in context rows, Remarks-filtered chain rows, `custom.remarksCollection`). thymer-remark now writes ordinary lines whose thread root is a plain reference, which RefX already counts natively. `custom.lineRefProperties` defaults to `[]`; the property index and auto-detect stay for other plugins.

Verification: `node --check plugin.js`; `node --test test/*.cjs`; live on Thymer Desktop CDP :9333 — count click on a commented line renders one row `Tue Sep 8 › thymer/comments › @Svy › ○` with the comment beneath and zero Block Context / facet / unlinked / paths nodes.

## v4.50.1 — 2026-09-08

- Mention segments render as @DisplayName in crumbs/rows (the author group in a roam/comments-style path showed the raw user guid).

## v4.50.0 — 2026-09-08

- Reference rows (count-badge popup + inline linked-references) now default to a
  Roam-style flat path breadcrumb in the row header — `Page › roam/comments ›
  date › author` — instead of relocating the row into the vertical fold outline.
  The outline remains available: Settings → "Flat path breadcrumb on reference
  rows" (per-client) or `custom.rowPath = false` (kill-switch).

# Changelog

## v4.49.12 — 2026-09-07

### Fixed

- **Count no longer paints on the last letters of a `[[` / `((` chip** when Space after reference is None (the default). The overlay was still clamping the digit inside `chip.right`, so a 3 sat on `of`. If the reserved slot cannot hold gap + digit, the count now sits after the chip. Wide (36) still parks it in the padding. Layout padding is unchanged, so the wrap-to-empty-line bug stays gone.

## v4.49.11 — 2026-09-07

### Changed

- **Default no reserved space after `[[` / `((` chips.** The old 36px `padding-right` on every `.lineitem-ref` wrapped the last word and parked the caret after a large gap. Settings now offers **Space after reference**: None (0, default), Tight (10), Snug (18), Wide (36 — the previous behaviour). Count digits still paint as zero-width overflow. Badge distance is a separate 0–20 px clamp, not `slot - 8`.

### Fixed

- Mid-line reference chips no longer wrap their last word into empty trailing space; the caret sits against the last glyph unless you opt into Wide.

## v4.49.10 — 2026-09-07

### Fixed

- **A reference chip's appearance now weighs the same in every state**, which is what finally stops the blinking when another plugin also colours references. Indent Rainbow's "Color references and tags on the path" ships `body.thymer-ir-path-refs .listitem[data-thymer-ir-path] :is(.lineitem-ref, [class*="hashtag"]) { color: … !important }` — specificity (0,4,1). That outranked RefX's classified rules (0,2,1) but **lost** to the v4.49.9 line-kind bridge (0,5,1), so a line ref on the rainbow path flipped orange → teal → orange on every rebuild while a page ref on the same line never moved. Measured off the user's recording: page ref stable for all 212 frames, line ref flipping.
- The rule now enforced by test: **a bridge rule weighs exactly what the classified rule it stands in for weighs**, and the unclassified default weighs one class *less*. Whoever wins the cascade then wins in every state of the chip, so no rebuild can change its colour — RefX does not need to know which other plugin is involved. The bridge still outranks the unclassified default, so stylesheet order remains irrelevant.
- Mechanically: the four default paint/hover selectors are wrapped in `:where(…)`, and the bridge moved from `:is(<guids>).lineitem-ref:not(…):not(…)` to `.lineitem-ref:where(<guids>):where(:not(…, …))`. The `transition: none` group deliberately keeps its full weight — it is uncontested and must keep beating Thymer's own `.lineitem-ref` colour transition.
- Tests gained a CSS specificity calculator (`:where()` free, `:is()`/`:not()` take the max argument) so the invariant is checked against the real Indent Rainbow selector rather than by eye.

## v4.49.9 — 2026-09-06

### Fixed

- **Line references (`((`) stop blinking too — including refs to a TODO.** v4.49.8 killed the flash for page refs by giving every unclassified `.lineitem-ref[data-guid]` the page-ref appearance from static CSS. That made LINE refs worse: a rebuilt line-ref chip now fell back to page blue instead of Thymer's near-identical native teal, a much larger visible jump. Measured on Thymer Desktop with a second class writer, on one line carrying both kinds: the page chip held **913 of 913** correct frames while the line-ref chip on the same line painted page blue for **779 of 913**.
- Thymer renders page refs and line refs with byte-identical DOM — same classes, same children, only `data-guid` differs — so no native selector tells them apart. A guid's kind is immutable, though, so RefX now keeps a bounded, guid-keyed **bridge stylesheet** built from positive classifications: a rebuilt line-ref chip paints the line appearance before any JavaScript runs. Every bridge selector ends in `:not(.refx-pageref-chip):not(.refx-lineref-chip)`, so it stops matching the instant our class lands and can never override the classified rules or the underline-style knob; it sits one class above the v4.49.8 page-ref default by construction, so stylesheet order is irrelevant. The declarations are checked against the classified rules by a drift test.
- The bridge is one adopted `<style>` node updated by `textContent` only, flushed on a microtask inside the same observer checkpoint that restores chip classes (never `requestAnimationFrame`), capped at 300 guids with oldest-first eviction, and dropped on teardown.

## v4.49.8 — 2026-09-06

### Fixed

- **Reference chips no longer blink while you type on their line.** Thymer rebuilds a line's reference chips on every keystroke. RefX re-applied its appearance class pre-paint, which held only while RefX was the sole writer of that class — a second writer (a leaked instance still live after a Plugins-Manager update, or RefX's own classifier returning a transient `unknown` against a cold model) stripped it again in the same microtask checkpoint. The chip then fell back to Thymer's native chip paint *and* replayed the host's 200 ms colour transition. Measured on Thymer Desktop against 4.49.7 with a second writer present: **425 of 715 painted frames were native**, animating through the whole `rgb(16,107,163)` → `rgb(105,201,197)` ramp. Two fixes, both structural:
  - Appearance no longer depends on our class being present. Static CSS gives every `.lineitem-ref[data-guid]` the page-reference paint unless it is positively classified as a line ref (`:not(.refx-lineref-chip)`), so a freshly rebuilt chip is already correct before any JavaScript runs. Same run with the rule in place: **0 of 727 painted frames native**. The declarations are shared with the classified selector, so there is still one source of truth per preset, and the `transition: none` group covers the fallback too.
  - Chip classification is monotonic. `unknown` is a cold-index verdict (the registry, the name index and `getRecord()` can all miss for a second while the host model streams in), not evidence that a chip is not a reference — it no longer strips an existing classification, and a 20-keystroke burst against a cold classifier now performs zero class writes.
- `referenceStyle: "native"` is unaffected: the fallback is gated on `body.refx-links-distinct` / `body.refx-links-roam`, neither of which the native preset sets.

## v4.49.7 — 2026-09-06

### Fixed

- Typing `@today` inside a Workbench transclusion inserts the date again: a visible native picker (including Thymer's `.omni-overlay`) now suppresses both the Workbench Enter interception and the split-focus click repair, so neither steals the commit.
- Enter also yields when the caret line still ends in an uncommitted `@…` trigger, even if the picker portal is not one we can match.
- Datacore `dc:` / `dc.js:` widgets added to the Workbench mount instead of showing their source: RefX pokes `window.__plexusDatacoreEmbed.refresh(true)` after the shelf decorates or an item is added.

### Added

- Drag a Workbench item's header to reorder the shelf; the move is a real reorder of the backing record's transclusion line, so it syncs across devices.

## v4.49.5 — 2026-09-06

### Fixed

- Workbench add from a `q:` live-search row uses the real source line.
- Datacore JS/query widgets pinned to the Workbench keep the original host record (`this`).

## v4.49.4 — 2026-09-06

### Fixed

- Left-click ref menu no longer clips off the bottom of a windowed Thymer: the popover clamps to the remaining pocket under or above the chip, and chain / Block Context reservations shrink so action rows stay visible.
- Outgoing chain insertion, post-hydrate Block Context refit, and lazy incoming chain growth no longer slide action rows after the one-shot anchor.
- Outgoing chain reservation now runs on the menu surface (it was unreachable behind the incoming-tree early return).
- Standalone Block Context popover reserves its full height at anchor time so it clamps to the pocket under or above the chip and the Jump / Open actions bar stays on screen.
- Submenu and hover preview overflow is capped via inline max-height and overflow hidden.
- The (( / [[ picker keeps its pre-4.49.4 placement; the pocket clamp applies only to fitted popovers.

### Improved

- Hover preview reads structure-only record bodies (`getLineItems(false)`).
- Chip chain decoration scan resolves at most 12 cold guids per idle pass and re-queues the remainder.
- Line-target count badges share the inbound `@linkto` search with inline fill.

## v4.49.3 — 2026-09-06

### Fixed

- Inline linked-reference fill no longer waits on collapse-meta hydration before issuing the first `@linkto` query.
- The inline chain root reuses direct-reference rows from fill instead of racing a 3 s root resolve that timed out on cold search.
- Fill and chain share one inbound `@linkto` search per target guid; chain timeout/abort no longer cancels that shared query.
- Fill failure shows "Couldn't load references" with Retry instead of hanging on "Loading references…".
- Line-target badges prefer a fresh RefX count from the settled inline section over the native pill floor (the floor still protects stale zeros, disk seeds, optimistic placeholders, and capped counts).

## v4.49.2 — 2026-09-06

### Fixed

- Line-target badge and headline count unique `@linkto` lines only; property references stay in the footer and subtitle, with the split shown in the tooltip (`N via properties`).
- Remark-only line targets still show a badge when property references exist and no inline `@linkto` hits.

### Changed

- Block Context starts collapsed when Linked References opens; Settings adds "Block context starts collapsed" (default on). The twisty no longer persists last-expanded state.
- The menu compact Block Context strip remains always expanded (height-reserved); the setting governs the inline section and floating popover only.

### Improved

- Sibling and ancestor image lines render as viewport-loaded thumbnails in the Block Context outline.
- Relation labels (Parent → Reference → Children/Siblings) read as a clearer hierarchy with nested rails.

## v4.49.1 — 2026-09-06

### Fixed

- The source-line count now sits in Thymer's native backlink-pill slot at the far right of the row (Roam `.rm-block__ref-count`), not glued after the last glyph of `.line-div`.
- The settings modal body scrolls when the window is short (`min-height: 0` so flex content cannot defeat `max-height`; header/footer stay pinned).

## v4.49.0 — 2026-09-06

### Added

- Inline line references now match Roam Research's `.rm-block-ref`: inherit the body text color, a hairline bottom underline, and a light hover wash. Page references stay Roam link blue (`#106ba3`) with no underline. Reference counts are a quiet number at 0.8em and 50% opacity, regular weight, inheriting the text color. `referenceStyle: "roam"` is now the Configuration default; a stored Distinct / Native choice still wins.
- Settings → Reference appearance knobs: page-link color, line-ref underline color and style (none / solid / dotted), line-ref hover background, count size, count opacity, count weight, and a reset button. Each knob writes one CSS custom property on `<body>` and applies instantly; nothing rescans chips or panels, so a change costs the same on a 10-line page and a 10,000,000-reference page. `custom.appearance {...}` seeds defaults.

### Changed

- Switching the appearance preset no longer walks the document to reclassify chips; classification stays on the existing scan path and the preset is a body-class toggle.
- Chip padding, border-width, and font-size are untouched on editable chips (caret law); the hairline is an inset box-shadow (solid) or a 1px background-image (dotted).

## v4.48.9 — 2026-09-05

### Fixed

- The Roam-style source-line count (`1` at the end of a referenced line) stayed
  hidden on the focused/caret line while "Hide Thymer's native backlink pill"
  was on, so the replacement looked missing. Target-line badges no longer use
  the chip hide-on-caret rule; the native pill still hides; click still opens
  Linked References.
- A stale cached zero no longer blanks a live native-pill count, and an
  icon-only host pill still seeds a count of at least 1.

## v4.48.8 — 2026-09-05

### Fixed

- Thymer's host now paints untitled line refs as underscore slugs instead of "[Title missing]"; heal those chips back to the live line text so they look like Roam block refs.

## v4.48.7 — 2026-09-05

### Fixed

- Cmd/Ctrl+V of a `thymer-ref://` URI no longer falls through to native paste when the caret is only known via `g_range` or the caret-line DOM class. A missing grapheme offset inserts the chip at the end of the line.
- A Copy transclusion stash embeds once; later pastes of the same clipboard insert a chip.
- Live text selections (`g_range` non-collapsed on one line) no longer hijack paste via the caret-line DOM fallback; transclusion `consumedAt` is set only after embed succeeds; Tier B offset uses grapheme position when `segment_index` is absent.

### Tests

- `test/paste-inline-ref.test.cjs` covers caret tiers, preventDefault, end-of-line insert, and consumedAt.

## v4.48.6 — 2026-08-01

### Fixed

- The inline count-badge surface now reads **Block Context → direct references
  → All reference paths**. The transitive tree remains a synchronously mounted,
  independently cancelable sibling at the bottom, so context/direct hydration
  failures cannot detach it. Compact popups retain their chain-first ordering.
- Incoming-tree source ownership now survives every traversal level. Same-page
  descendants inherit one heading; a cross-page hop restores a nested source
  heading, so the real `1RPB…` row is visibly grouped under **ScratchPad** instead
  of incorrectly appearing beneath **Fri Jul 31**.
- Source headings are explicit page-navigation buttons with accessible labels;
  exact block travel remains on each row's separate ↗ action. The renderer uses
  existing resolver metadata and performs no additional owner or body reads.
- Inline and path filter labels now state their independent scopes without
  changing direct counts, bridge v4, or resolver signatures.

### Tests

- Added mixed-owner production routes for the real `16K…` → `1G02…` →
  `1RPB…` topology, same-page heading suppression, cross-page restoration,
  explicit source navigation, context-first inline order, popup-order retention,
  hydration-failure isolation, and bounded viewport visibility.
- **Repository verification:** 1,129 deterministic Node tests pass serially.

## v4.48.5 — 2026-08-01

### Fixed

- The real count-badge/`_toggleInlineRefsFor` surface now mounts the reusable
  unlimited incoming tree synchronously, before Block Context and the direct
  linked-reference body. The known `16K…` → `1G02…` → `1RPB…` path therefore
  appears after one inline expansion with no pill gesture.
- Inline traversal is labeled **All reference paths** while its superscript and
  header retain direct-only counts. The tree owns a 220px bounded scroller,
  constant 14px-per-hop indentation, interactive nested refs, explicit jump
  controls, cycle/duplicate markers, concurrency two, and the 200-row Workbench
  escape shared with popup chains.
- Inline close, host removal, panel navigation, generation replacement, and hot
  reload cancel pending tree work. Block Context and direct-fill failures remain
  isolated siblings and cannot detach a valid chain.

### Tests

- Added the real count-badge route for the exact `16K…` → `1G02…` → `1RPB…`
  topology, including direct-count isolation, Block Context failure, viewport
  intersection, nested ref preservation, and immediate close cancellation.
- **Repository verification:** 1,128 deterministic Node tests pass serially.

## v4.48.4 — 2026-08-01

### Fixed

- The production incoming tree now follows the user's real
  `16KXTSZYE4PGMAFAM9WSM2S9GH` → `1G02X5PH77EDFGGS7DD4G8H7M9` →
  `1RPB03PCQX7T71XFDSZQ26WXK1` topology after one normal click. A complete-looking
  empty Line Index level is treated as provisional and confirmed by exact
  `@linkto` search after first paint; non-empty complete levels keep their warm
  zero-search path.
- Incoming provider envelopes prefer `lineGuid` and other explicit line IDs
  over a generic `guid`, which may identify the owner record. Recursion now
  queries the referrer block instead of accidentally walking its page.
- Chain rows preserve their real segment order and render nested refs as
  interactive links. Clicking one opens its Block Context and incoming tree, so
  ref-of-ref travel can continue repeatedly without making pills the only path.
- Property-reference record/context breadcrumbs open alongside the source in a
  native side panel. Same-target rapid clicks share one awaited create/navigate
  transaction, preventing the disappearing-source and duplicate-panel race seen
  when opening a Remark row quickly.
- Inline and target-line counts now paint as a plain, muted Roam-like
  superscript. The redundant chain arrow and filled pill are gone, and the
  rule-99 reserved inline slot is tightened from 48px to 36px without changing
  editable caret geometry.

### Tests

- Replaced the synthetic old chain fixture with the exact text-line GUIDs and
  cross-page empty-index condition from the user's mirror. Added production
  300ms click, 380px viewport intersection, nested-ref travel, provider-envelope
  identity, side-panel single-flight, and quiet-count CSS coverage.
- **Repository verification:** 1,127 deterministic Node tests pass serially.

## v4.48.3 — 2026-08-01

### Fixed

- One normal line-reference chip click now progressively resolves the complete
  incoming reference tree. Traversal has no hop-count constant; cycle and
  duplicate aliases terminate repeated paths, while two RefX-owned active
  leases keep newly started cold level reads bounded. Each resolved level also
  supplies its branch pill count, so auto-expanded rows never launch a second
  cold count query.
- The incoming chain shell is the first popup section, mounted as a sibling
  before the visible Block Context container. It remains connected if that
  independent owner/body hydration fails, so a slow or unavailable outline
  cannot hide valid reverse-reference topology.
- Cold level providers do not start in the click task or a pre-paint `rAF`.
  The mounted shell crosses an `rAF`-then-task boundary first, fenced by popup
  identity, connection, generation, cancellation, and unload state.
- Topology rows reveal automatically in cooperative 8-then-40 batches until the
  existing 200-row popup limit. Exact `@linkto` fallback now receives that full
  normalized limit, keeps differently limited cache/pending entries separate,
  and clears stale partial Line Index metadata when it completes authoritatively
  below the cap. Partial providers and the popup cap expose one root-level
  **Open in Workbench** escape that cannot disappear inside a collapsed branch.
- Nested containers now add one constant 14px indent per hop instead of
  compounding absolute-depth margins. The tree owns a bounded scroll region in
  the 380px menu, row labels no longer navigate implicitly, and an explicit ↗
  action remains beside each fold/status pill.
- Generation, disconnect, and hot-reload fences stop stale async tree writes.
  Popup close, cap, and a bounded timeout synchronously revoke scheduler leases;
  AbortSignal is forwarded as a best effort. `window.__REFX_CHAIN_DIAG` exposes
  queued/resolved/failed levels, cancellations, rendered rows, capped trees,
  timeouts, and RefX-owned active/max concurrency. Its window-persistent
  `providerAbandonedActive`, `providerAbandonedTotal`, and
  `providerAbandonedSettled` counters separately disclose provider promises
  that had not settled when their lease was revoked, including across hot reload.
- If every incoming provider fails, the level now renders a retryable error and
  increments `levelsFailed` instead of pretending the outage is an empty,
  successfully resolved leaf. A successful provider still wins when another
  provider fails.

### Tests

- Added the production-default 300ms click route for the exact
  `16KXTSZYE4PGMAFAM9WSM2S9GH` → `145CM19TGWJ9AS3JP7X95P6Y7N`
  depth-three fixture, viewport intersection, Block Context failure isolation,
  twelve-level traversal, branching/cycles, duplicate-count suppression,
  cooperative and non-cooperative cancellation, hot-reload diagnostics, and
  automatic 200-row cutoff with deterministic frame-controlled batching. The
  visible-order assertion compares the chain sibling with the real Block
  Context container, and its 380px/180px geometry is derived from injected
  production CSS rather than test-assigned rectangles. Provider-outage coverage
  proves truthful failed diagnostics, retry, mixed-provider recovery, requested
  limits through 200, cache identity by limit, authoritative fallback metadata,
  and a root-visible Workbench escape after deep collapse.
- **Repository verification:** 1,124 deterministic Node tests pass serially.

## v4.48.2 — 2026-08-01

### Fixed

- Replaced the formatting-row capability tautology with a one-time, cached
  synthetic-key delivery probe on Thymer's virtual input. Bold, Italic, and
  Code are omitted unless the capture-phase probe proves delivery.
- Native menu chords and clipboard commands now reject `body` as an editor
  sink, focus `g_virtual_input.$textarea` / `#virtualinput` without scrolling,
  and wait through a task boundary before dispatch.
- Redo no longer opens a new undo chunk, preserving the redo stack.
- Failed or throwing `execCommand` calls disarm the pending clipboard bridge so
  the next real copy/cut chord cannot inherit stale menu state.
- Noncollapsed selection context now recognizes the selection circle, stem,
  and handles container rather than only the circle.
- Replaced the six newly introduced unverified Tabler icon names with the
  known-present `ti-arrow-back-up` and `ti-copy` icons.

### Tests

- Added delivery-failure degradation with `KeyboardEvent` present, one-time
  probe caching, body-to-virtual-input targeting and task ordering, Redo stack,
  clipboard false/throw disarm, selection-handle-family, and icon regressions.
- **Repository verification:** 1,110 deterministic Node tests pass serially.

## v4.48.1 — 2026-08-01

### Fixed

- Removed cold count discovery from `resolveRefLevel`. A cache miss now remains
  unknown through the indexed resolve, paints as a neutral `·`, and refines
  only after its row is rendered through the existing background count lane.
  The hardcoded `bodyReadCount` property was removed; behavioral probes remain
  the body-read authority.
- Corrected the depth-three diagnosis: the resolver already emitted
  `depth <= maxDepth` in v4.46.3. The live miss was caused by one shared
  total-line/SDK budget across the OUT and IN halves of `direction: "both"`.
  Each half now resolves sequentially with an independent bounded budget, so
  an exhausted OUT walk cannot starve a complete IN chain through depth three.
- Restored the bounded incomplete-index fallback rule. Empty incomplete answers
  still use exact `@linkto`; non-empty answers query only when they do not fill
  the requested level.
- A refresh requested during an in-flight level resolve now chains a fresh
  resolve after the pending work instead of returning that stale answer.
- The fixed menu reservation now estimates the lazy tree's first paint from the
  target's cached hop-one count, capped at eight rows, plus filter/header chrome.
- The chain filter uses `--input-bg-color`. Per-level resolve limits and the
  total rendered-row cap now have separate constants.

### Tests

- Added cold-cache zero-query/refinement, pending-refresh, independent
  direction-budget depth-three, full partial-index level, and cached menu-fit
  regressions. No typing-path work was added.
- **Repository verification:** 1,107 deterministic Node tests pass serially.

## v4.48.0 — 2026-08-01

- Right-clicking Thymer's sibling drag overlays, selection circle/stem,
  floating six-dot handle, or overlay buttons now resolves the underlying line
  coordinate-first and opens the RefX line menu. Floating-handle GUID and the
  bounded Version Ledger parent walk remain cold/legacy fallbacks.
- A noncollapsed drag-circle selection opens selection context without
  line-only RefX actions. Ordinary lines, reference chips, and transclusions
  retain their previous routing.
- The line menu absorbs feature-detected Back/Forward, Undo/Redo, Cut/Copy,
  and Bold/Italic/Code actions. Missing/unknown native internals fail closed;
  disabled history is explicit; action failures reach `__REFX_LAST_ERROR`.
- Synthetic paste events expose no trusted clipboard payload, so the dead
  Paste row is intentionally omitted. **Thymer menu…** redispatches the
  original coordinates with Shift for the native escape path.

## v4.47.0 — 2026-08-01

- Defined `maxDepth` as an inclusive emitted-hop bound and pinned the live
  `145CM → 1AW5 → 18NEN → 16KX` reverse topology at depth three.
- Added bridge v4 `resolveRefLevel(guid, {direction})`, which resolves exactly
  one indexed incoming or outgoing level, carries an inbound count per row,
  preserves the last good snapshot across refresh failures, and performs zero
  record-body reads.
- Replaced eager popup reverse-chain rendering with a self-similar lazy tree:
  source-record grouping, per-row expansion pills, clickable depth-two path
  breadcrumbs, duplicate/cycle aliases, 8-then-40 paging, a 200-row Workbench
  escape, client-only filtering, and a separate typed Remarks section.
- Chain growth stays inside the existing scroll/reserved context boxes. Cold
  row text may refine only through the existing cooperative background lane;
  editor typing paths gained no new work.

## v4.46.3 — 2026-08-01

### Fixed

- Treated an incomplete empty line-index response as inconclusive, allowing the
  exact `@linkto` query to recover referrers from surfaces the index does not
  cover.
- Merged and GUID-deduplicated exact-query results with non-empty partial index
  results, so partial coverage cannot hide additional referrers while all
  existing query, SDK-call, candidate, and aggregate incoming-line caps remain
  enforced.

### Tests

- Added behavioral resolver regressions for incomplete empty and partial index
  responses, authoritative complete-empty responses, merged deduplication, and
  the existing 64-line aggregate cap.

## v4.46.2 — 2026-08-01

### Fixed

- Split reverse-chain cycle tracking by direction, so the popup's combined
  traversal can render the same line truthfully as both an outgoing target and
  an incoming referrer without reopening cycles.
- Capped preferred line-index candidates at 32, limited all incoming discovery
  to 64 returned lines per resolve, and clamped the displayed incoming
  remainder. Oversized indexes can no longer create thousands of cache
  invalidation entries or nonsensical `+N more` labels.
- Charged each fallback `@linkto` search to the existing SDK-call budget and
  gave its idle gate a 200 ms deadline, preventing well-connected chains from
  escaping the shared work ceiling or starving during continuous input.
- Indexed an incoming-only chain under its root owner record even when it has
  no referrers, so a later line creation invalidates that cached empty result.
- Restored popup chain hydration to depth 4 and made **Expand chain** counts
  reuse the popup's combined depth-4 cache instead of consulting a separately
  warmed outgoing cache.

### Tests

- Added executable regressions for mutual-cycle combined traversal, a 5,000-
  candidate preferred index, the aggregate incoming search ceiling, empty
  incoming-cache invalidation, and popup/flyout cache-key alignment. The v4.46.1
  20-keystroke zero-write fixture remains unchanged.

## v4.46.1 — 2026-08-01

### Fixed

- Made reference-chip classification, chain markers, count badges, task
  overlays, target-line badges, and overlay-host state strictly
  read-compare-write. An unchanged decorated-line scan now emits no class,
  dataset, title, or ARIA mutations.
- Stopped the badge upsert from treating a cached line-host count overlay as a
  legacy in-chip sibling. That reap removed the `trc-` overlay during typing
  and the overlay synchronizer immediately re-added it; the cached node now
  stays mounted unless Thymer itself replaces the host.
- Added a 20-keystroke decorated-line fixture that asserts zero unchanged
  plugin attribute writes, preserved node identity, and zero sampled absent
  frames while Thymer-owned detach cycles restore the same cached node.

## v4.46.0 — 2026-08-01

### Added

- Extended the public reference-chain resolver to contract version 3 with
  `direction: "out" | "in" | "both"`. Incoming traversal follows referrer
  lines recursively with a shared cycle guard, bounded depth/fanout, truthful
  source-line titles, and direction-aware cache keys. The bridge keeps its
  outgoing default for existing consumers.
- Line-reference chip popovers and action menus now show a
  **⟵ referenced by** section. Direct referrers appear as ordinary actionable
  reference rows and each referrer's own referrers nest beneath it to depth 3;
  capped results show `+N more`, while a successful empty search says
  `no referrers yet` because Thymer's `@linkto` index is eventually consistent.

### Performance

- Incoming edges prefer `__thymerLineIndexV1.linesReferencing`, then use an
  idle-gated exact `@linkto` search capped at 32 results/queries per resolve,
  and finally fall back to native backreferences when available. No incoming
  lookup runs from the typing or chip-rescan path.
- Reverse-chain results reuse the existing LRU, pending-work deduplication, and
  inverted selective invalidation. Editing a referrer invalidates only chains
  indexed through that source line; capped results expose `truncated: true`.
- The fixed pre-anchor menu fit now reserves the incoming label, rows, empty
  state, and `+N more` affordance before the one-shot popup anchor.

## v4.45.4 — 2026-07-31

### Fixed

- Attributed the wrapped-line gap to the target-count badge being left between segment
  nodes: its zero-width wrapper did not reserve flow, but its 24px painted overflow covered
  the following word when the stale slot landed at the wrap boundary. The target badge is
  now an absolute overlay immediately before a stable native-host `::after` 24px inline slot.
  Only the last visual row reserves that slot. The pre-paint keep-alive also re-homes a
  still-connected badge to the true DOM end after later segments arrive.
- Hardened both reference-row action overlays: the containers are click-through with only
  buttons interactive, use a bounded horizontally scrollable strip and a controlled z-band,
  align to the first visual row, and fade into the row's actual token/color-mix background in
  both themes.
- Keyed task-reference 20px reservations to Thymer's stable line/chip selectors and known
  target GUIDs, so a `.line-div` swap cannot drop the slot while `refx-ovl-host` is restored.
- Replaced the static V5 assertions with a two-row geometric fixture. It measures the parent
  layout's 24px following-word obstruction versus 0px after the absolute last-row overlay,
  then exercises twenty connected segment-reappend cycles that must restore the badge to the
  true DOM end.

## v4.45.3 — 2026-07-31

### Fixed

- Removed the last fixed-width hidden decorators from reference context rows.
  Hover/focus action strips now paint as absolute overlays, so their presence
  contributes zero inline width and cannot open shifting word-sized gaps.
- Preserved the target-line badge's rule-99 geometry contract: its native host
  reserves one stable end slot, its wrapper remains zero-width, and the same
  cached node is restored synchronously by the existing pre-paint observer.
- Added an executable decorated-line DOM harness that replaces a combined line
  through twenty typing cycles and proves contiguous text, same-node target
  badge restoration, and zero geometry-changing decorator re-adds.

## v4.45.2 — 2026-07-31

### Fixed

- Zero layout shift, for real: image skeletons now hold `is-pending` until
  `img.decode()`/load settles, and the reserved box is pinned to the declared
  or decoded aspect ratio BEFORE the box→image swap. Auto-loads no longer
  shift twice (96→0→decoded height); `_mediaLineInfo` reads declared image
  dimensions so the box can be pinned from first paint.
- The viewport pending queue refuses registration past 200 instead of
  evicting FIFO — the old policy dropped the oldest-registered (the TOP,
  visible) rows and each eviction's cancel collapsed a live reserved box. A
  refused never-fired entry keeps its reserved box and its manual "Show
  image" toggle. Recycled/removed rows (`card.isConnected === false`) are
  reaped on every registration and observer fire, freeing slots for live rows
  and releasing detached subtrees.
- Hover media detection no longer runs an O(all rendered lines)
  `_liveStateByGuid` sweep for every text chip: the fallback is gated to
  state-less targets with no text evidence (image/file lines carry no text
  segments). Counted via `__REFX_MEDIA_STATS.hoverMediaSweeps`.
- Deleting an attachment mid-load no longer leaves a permanently pulsing
  skeleton next to a dead button: every `!available()` early-return clears
  pending and renders the unavailable state in place of the box, and
  `_retireInlineMediaConsumers` does the same on cards it marks unavailable.
- A transient IntersectionObserver constructor throw no longer disables
  viewport gating for the session: the failure latch resets in
  `_initInlineMediaRuntime` and on dispose, and each trip bumps
  `__REFX_MEDIA_STATS.observerFailures`.
- Post-dispose resurrection refused: `_gateMediaViewportLoad` returns null
  when the plugin is unloaded or the runtime generation was disposed, so a
  late async row build cannot construct an observer nothing can disconnect.
- Cold media resolve misses (neither live state nor the owner-tree read
  yields a blob handle) now bump `__REFX_MEDIA_STATS.failures` and record
  `__REFX_LAST_ERROR` with the target guid instead of returning null silently.

## v4.45.1 — 2026-07-31

### Fixed

- Cycle checks now take the nearest rendered listview owner, verify that the
  candidate record really contains the target line before retaining a durable
  hint, and consult the cold line-context owner resolver as the fourth forensic
  fallback. Transcluded or Workbench-rendered lines therefore cannot poison
  ownership or permit mutual A⇄B embeds.
- Reference-chain caches now invalidate newly created, moved, restored, and
  deleted subtree lines by the owner records scanned during resolution. The
  per-keystroke update path uses a single inverted index instead of scanning
  every cached chain and its source-line array.
- Hover previews are click-through by default. They become interactive only
  when a popup extension section is actually mounted, and leave/outside paths
  still dismiss them. Popup section hosts have their own class and a fixed,
  pre-anchor reservation, so late async content neither forces context-menu
  width nor moves action rows under the pointer.
- Contentless line labels reuse the existing breadth-first title synthesizer,
  while authored chip aliases remain ahead of synthesized titles in reference
  menu headers.

### Performance and safety

- Each chain resolution has aggregate caps of 160 scanned lines and 64 SDK
  calls and reports `truncated: true` when a cap stops traversal. The chain LRU
  now holds at least 64 entries, grows with rendered reference-chip demand, and
  remains hard-capped at 256.

### Verification

- **Verification:** 231 deterministic Node tests in the main plugin contract;
  1,069 tests across all 28 suites; `node --check plugin.js` passes.

## v4.45.0 — 2026-08-01

### Added

- Image and file lines now render real previews inside every RefX-built
  reference surface: linked-reference rows and their child subtrees,
  block-context outlines, and reference-chain rows. Rows built from cold stubs
  (native backreferences, chain hops, unseen lines) rehydrate to a
  blob-capable line by guid — live state first, then one targeted owner-tree
  read — so the preview toggle always works or the card fails closed to its
  filename chip.
- Automatic image loads are viewport-gated through one shared
  IntersectionObserver with a 240px prefetch margin and a hard-bounded pending
  queue (over-cap rows keep their explicit toggle), so scrolling past large
  reference sections triggers no fetch storms. A reserved skeleton box holds
  the layout from gate registration until the asset or its fail-closed state
  replaces it, keeping lazy loads layout-shift free; the skeleton pulse honors
  `prefers-reduced-motion`. The download lane stays serialized and the blob
  URL cache keeps its 48MB byte cap with active-URL pinning.
- A chip whose target is an image or file line now shows a small lazy
  thumbnail directly under the hover-popup title, resolved from live state so
  cold and synthetic journal owners still render it; text-line targets are
  untouched.
- Forensics: `window.__REFX_MEDIA_STATS` exposes bounded counters (loads,
  failures, evictions, byte-cap declines, viewport queued/fired/dropped), and
  every new failure path records `window.__REFX_LAST_ERROR` before failing
  closed.

### Verification

- **Verification:** 231 deterministic Node tests in the main plugin contract;
  1,059 tests across all suites; `node --check plugin.js` passes.

## v4.44.0 — 2026-07-31

### Added

- Reference-chain traversal now includes up to 40 child-subtree lines per hop,
  shares the existing depth/fanout budget, labels each hop as inline or subtree,
  and selectively invalidates caches when a scanned subtree line changes.
- The public bridge exposes lifecycle-safe popup sections for hover previews and
  reference menus, with frozen contexts, token-fenced replacement, viewport-aware
  placement, and fail-closed diagnostics.
- Cold cycle checks now converge through rendered-listview ownership and live
  `g_universe` ownership before refusing, with every attempted fallback retained
  in the forensic refusal entry.
- One title synthesizer supplies media filenames, formatted dates, referenced
  target names, and explicit empty/unresolved states across reference surfaces.
- Property-sourced reference rows now show cached record › context breadcrumbs in
  popups, SDK fallback groups, and Reference Navigator results without new scans.

### Verification

- **Verification:** 231 deterministic Node tests in the main plugin contract;
  1,046 tests across all suites; `node --check plugin.js` passes.

## v4.43.1 — 2026-07-31

### Fixed

- Reference-chain cache invalidation is selective by changed line, while chip
  chain discovery is coalesced behind the quiet-browser lane and never blocks
  the per-line typing rescan. Disabled counters skip the decorative scan.
- Chain traversal resolves each GUID once, coalesced callers retain the public
  never-throws contract, and `+N deeper` excludes targets rendered elsewhere.
- Cold Block Context menus grow their reserved body downward after chain
  hydration without re-anchoring, keeping newly loaded rows visible.
- Nested chain expansion is capped at 24 created items, reports cached counts in
  its depth labels, refuses oversized writes before mutation, and retains
  rollback on partial failure.
- The public bridge exposes one chain capability field, and the zero-layout chip
  slot now separates three-digit counts from the chain marker.

### Verification

- Added executable coverage for genuine cycle refusal, partial-write rollback,
  selective cache invalidation, cold-cache menu fitting, expansion caps, and
  concurrent resolver failures.

## v4.43.0 — 2026-07-31

### Added

- A bounded, cycle-safe, LRU-cached general reference-chain resolver, exposed as
  `window.__refx.resolveRefChain()` with bridge capability version 1. It follows
  each target line's own outgoing reference segments and classifies every hop as
  a line or page.
- Chip Block Context surfaces now show an indented `→ chain` section with jump,
  side-panel, copy-reference, and copy-transclusion actions for every hop. The
  menu's pre-anchor height clamp includes cached chain rows and reports bounded
  deeper hops.
- Reference menus now offer nested chain expansion at depths 1–3. Every created
  item is a native `transclusion` with `itemref` and `refx_embed:1`, and every
  hop passes the existing truthful cycle verifier before document mutation.
- Reference chips whose targets continue into a chain receive a rule-99
  zero-layout marker in the already-reserved badge slot.

### Verification

- Resolver coverage includes cycles, depth/fanout bounds, and line/page
  classification; bridge and popup coverage verifies the public shape, chain
  rows, row actions, and height accounting.

## v4.42.0 — 2026-07-31

### Added

- Truthful cycle-refusal reasons, a 20-entry `__REFX_CYCLE_REFUSALS` diagnostic
  ring, and one forced owner-context warm retry for cold or stale line owners.
- Copy-reference and copy-transclusion glyph actions across reference context
  rows. Transclusion copies paste as real `transclusion` lines with `itemref`
  and `refx_embed:1` rather than inline reference segments.
- Plain-line menu extensions and cached-model, pre-anchor Block Context sizing.

### Fixed

- Target-line count badges are now rule-99 layout-neutral: native line hosts
  reserve the slot, the injected wrapper is zero-width, and the inner pill owns
  the hit box. Caret-line hiding and hover action strips no longer change row
  geometry.
- **Verification:** 231 deterministic Node tests in the core plugin suite and
  1,026 tests across all suites; `node --check plugin.js` passes.

## v4.41.0 — 2026-07-31

### Added

- **Remarks in Block Context.** A reference row's context now shows every
  remark (org-remark) attached to THAT referencing line: a pen-colored chip
  carrying the remark's first body line ("doing this tonight."), click to open
  the remark record. The same chip renders on sibling rows that carry remarks,
  so the context view surfaces every commented line in the neighbourhood. This
  is the relational read-back for comments made on a projected/referencing
  block (e.g. a Time Block task line): from the original block's Linked
  References, the referencing line's row shows the remark that was made on it.
  **Scope: the Block Context surfaces only** — the Reference row and its
  sibling rows on the inline section's and badge popover's Block Context
  strips. The generic linked-references rows, the delete-guard modal, and
  Workbench rows carry no remark chips this release.
  Data: a lazy cached `SourceLine → [remark]` map over the Remarks collection
  (built on first context render, never at onLoad), refreshed only by
  Remarks-collection record events (payload-filtered — collection-less foreign
  payloads fail closed at zero record/property reads; `record.moved` handled by
  destination), with bounded lazy body reads per rendered remark only, cached
  (FIFO cap; transient read failures are not cached and retry next render).
  The map's build is identity-fenced: a metadata reload or plugin unload
  during an in-flight build cannot resurrect a stale map.
  Config: `custom.remarksCollection` overrides the Remarks collection GUID
  (default `1ZG05C7ST1T13EWAF5S2M4VNQR`). The `lineRefProperties` kill switch
  is honored: `false` or `[]` makes remark chips fully inert — the documented
  "disable (zero cost)" promise — skipping even the one-per-session collection
  enumeration.

- **Collapsible Block Context.** The Block Context strip in the inline Linked
  References section and the floating badge popover now has a fold twisty
  beside its label, collapsing the rows container. While collapsed the strip
  pays nothing: hydration is deferred and the first expand runs it. State
  persists per-device in localStorage (default EXPANDED) — localStorage rather
  than `saveConfiguration`, which would reload the whole plugin for a view
  preference.

### Known limits

- A remark trashed in another client keeps its chip until the next Remarks
  record event or plugin reload if the host emits no `trashed` payload to
  scoped listeners (pre-existing host-behavior bet, shared with the record
  name index). Live acceptance: trash a remark, confirm the chip vanishes
  without a reload.
- The cold build is collection-scoped while warm event patches are
  property-scoped, so a record carrying `Source Line` that never belonged to
  the Remarks collection can enter the map via a Remarks-addressed event but
  would not be in a cold build; the next reload/rebuild converges.
- The line-property reference index (`recordsByTarget`, background-built for
  badges) and this release's remark map both index the same `Source Line`
  convention. Keeping them separate is deliberate: the remark map is lazy,
  excerpt-carrying, and event-patched in place, and it must stay inert when
  `lineRefProperties` is disabled.

## v4.40.1 — 2026-07-27

### Changed

- Block Context in the inline **Linked References** section and the floating
  badge popover now renders as an ordinary reference row: the source-record
  group header, the foldable ancestor outline, the line with its children and
  siblings, and the same per-row actions every backlink below it carries. It is
  built with the same `_renderRefsGroups` / `_buildRefContextRow` /
  `_fillRefContextRow` machinery those rows use, under the same
  **BLOCK CONTEXT** label — the presentation the reader already recognises,
  applied to the block they are looking at.
- Those two surfaces no longer reserve any height. The 200px box left roughly
  120px of blank space under a one-row target; the strip now carries a label, a
  separator, and its row, so it is exactly as tall as its content — no
  min-height, no empty scroll area, as compact as any backlink group.
- The **action menu** is unchanged: anchored once against the chip, it keeps
  the compact drill outline in its reserved box.

### Preserved

- Line-target gating, the teardown/generation guards, record targets rendering
  no strip at all, and owner resolution shared with the menu's context path.

## v4.40.0 — 2026-07-26

### Added

- Linked references for a **line** target now open with the original block
  above them. Clicking a reference-count badge renders the same Block Context
  strip the action menu uses — owner, breadcrumbs, parent, highlighted target,
  and up to four direct children — between the section header and the
  facet chips, and the floating Shift+badge popover gets the same strip above
  its rows.
- Record targets are unchanged on both surfaces: a page reference's context is
  the page itself, so it keeps the previous shape. The gate is the same
  `r.isText` test the reference menu applies.

### Performance

- All three surfaces share one eight-entry context LRU. Opening a badge section
  for a target the action menu already hydrated performs no second record body
  read.

### Fixed

- The inline strip is reserved at its final height when the section mounts,
  before the shell is inserted. This section sits inline in the document, so a
  box that grew when context settled would push the reader's own lines down the
  page; long context scrolls inside the reserved box instead. The popover strip
  is mounted before the shell is positioned, for the same reason.

## v4.39.0 — 2026-07-26

### Changed

- A bare left-click on a line-reference chip now opens the familiar action menu
  with Block Context above it. Action rows mount immediately; the context header
  hydrates asynchronously through the complete-tree retry path.
- `custom.lineRefClickContext` is tri-state: absent, `true`, or `"menu"` uses
  the new menu-with-context default; `"popover"` restores the v4.38 standalone
  popover, including its nearby siblings and eight-child depth inside the
  560x420 scrollable shell; `false` or `"off"` keeps the plain action menu.

### Performance

- Successful block context is cached in an eight-entry session LRU keyed by
  target line GUID. Any created, updated, moved, undeleted, or deleted line in
  the owning record invalidates its cached targets.
- The **menu** surface is bounded to a one-line breadcrumb bar, parent, target,
  four direct children, and an exact `+N more` remainder, and it renders into a
  reserved fixed-height strip. The menu is anchored once, before context
  arrives, so hydration can never grow the popup under the pointer or slide the
  action rows — long context scrolls inside the reserved box instead.

### Fixed

- Line-item events now generation-fence in-flight context hydration, clear
  negative owner misses, and seed moved targets with their new owner. Stale
  old-owner bodies can neither enter the cache nor render after an update,
  cross-record move, or nullable-owner deletion.
- A hydration whose owner is not yet known is no longer fenced by events from
  unrelated records. It records what it saw and revalidates once against the
  owner it actually resolves, so typing elsewhere in the workspace can no
  longer exhaust both bounded attempts and blank a live target with
  "Couldn't load this block's context".
- The ancestor walk tolerates a root line whose `parent_guid` is its owning
  record's GUID — the shape this SDK actually returns. It previously discarded
  the entire context on that guid, which affected every real line reference.

### Preserved

- Double-click jump, star-alias jump, modifiers, right-click, badge routing,
  footnote exclusions, popup dismissal/focus, and literal theme fallbacks keep
  their prior behavior. Cold context failures remain explicit while every menu
  action stays usable.

## v4.38.1 — 2026-07-26

### Added

- A bare left-click on a line-reference chip now opens a compact block-context
  popover with its ancestor trail, immediate parent, nearby siblings, highlighted
  target, and direct children. The outline reuses the Navigator hierarchy model
  and drill-preview rails, and offers explicit **Jump** and **Open menu** actions.
- `custom.lineRefClickContext` defaults to `true`; set it to `false` to restore
  the former single-click action-menu behavior.

### Preserved

- Right-click remains the direct reference-menu route, double-click still jumps,
  star aliases still jump immediately, modifier and page-reference clicks remain
  native, and popup dismissal uses the existing Escape/outside-click shell.

### Fixed

- Cold line references now hydrate through the complete-tree retry path and show
  an explicit unavailable state when the target block still cannot be loaded;
  missing targets never render a synthetic ellipsis row or report success.
- Popover focus, stale-click cancellation, badge routing, owner discovery, and
  closed-panel Jump fallback now remain correct across delayed loads.

## v4.37.0 — 2026-07-26

### Added

- `((` search now admits contentless image/file lines. Their filename supplies
  the visible label, while Line Index context matches retain explicit
  `contextOnly` provenance and rank below every direct text match.
- Visible picker media rows lazily load up to three compact thumbnails through
  the existing serialized inline-media resolver. Picker-owned object URLs are
  retired on re-render and revoked on close; no additional blob cache exists.
- Parent, sibling, and child rows in the 420px drill outline can now render
  compact media thumbnails. The selected target retains the larger preview.

### Removed

- Deleted the unused `_previewImageEl` path and its orphaned CSS; Navigator
  gallery media continues to use its existing byte-bounded cache.

## v4.36.1 — 2026-07-26

### Fixed

- The drill outline scrolls the target row back into view when the preview pane
  overflows. The pane is capped at 420px and the header, properties, target and
  outbound blocks can consume 250-300px before a single neighbourhood row is
  drawn, so on a property-heavy record the target could land below the fold —
  showing surrounding context is pointless if the thing being looked at is
  off-screen. Runs once after layout, and only when the pane actually overflows.

## v4.36.0 — 2026-07-26

### Changed

- Line drill previews now present the immediate parent, two siblings on either
  side, the selected target, and up to two direct children as one compact
  document outline instead of separate Children and Nearby accordions.
- The selected target uses a full-contrast tinted row and a depth-coloured
  accent rail. Hierarchy rails mirror Indent Rainbow through
  `flowythymerGetState()` and fall back to the active theme's card-border token.
- References remains a separate collapsed section with its existing lazy load
  and pane-click guard. Properties, task checkboxes, outbound references,
  highlighting, cleaned text, and capped `+N more` rows remain intact.

### Verified

- Regression coverage includes document order, root and edge siblings,
  childless and long lines, palette and fallback rails, and lazy References.

## v4.35.0 — 2026-07-26

### Fixed

- Line-reference display resolution now proves the target kind before reading
  any record name. A mismatched owning-record facade can no longer make a line
  reference display its container page's title; genuine record references
  continue to resolve from their exact record GUID.
- Existing `refx_auto_titles_v1` entries are repaired selectively when the
  segment is still plugin-managed, the cached title equals the line owner's
  page name, and the Line Index independently resolves different line text.
  Correct cached line titles, record titles, and user aliases are preserved.
- **Verification:** 229 deterministic Node tests in the core plugin suite and
  all 26 test files (956 tests) pass. Live browser checks cover the repaired
  cached ref, a drilled cold-owner line ref, and an exact record ref.
  `node --check plugin.js` passes.

## v4.34.0 — 2026-07-25

### Fixed

- `((`, `[[`, and Reference Navigator now share one three-state liveness gate at
  result admission, drill, preview, click, Enter, open, and insert boundaries.
  Explicitly trashed records and deleted lines are rejected, while cold title,
  alias, Line Index, semantic, frecency, exact-GUID, and cached scope rows stay
  visible when liveness is unknown rather than disappearing on a transient miss.
- One shared native query positively corroborates cold Line Index candidates
  without treating absent results as trash proof. Record, line, trash, and
  reload events update or invalidate the corresponding cached state immediately.
- When an imported recovery facade and a current list row resolve to the same
  text, the picker keeps the clean current row without collapsing unrelated
  bullet/no-bullet results.
- Imported orphan `am-page-uid` metadata is removed from picker and preview
  display text without changing stored segments.

## v4.33.0 — 2026-07-25

### Added

- The selected `((` / `[[` picker row now expands in place to show its complete
  wrapped text while unselected rows stay dense. Query terms use theme-derived
  background highlighting in both result rows and the preview pane.
- Line previews now show the owning record's full property summary, task
  checkboxes on the target and context rows, outbound references, and truthful
  `+N more` context counts.
- `Alt+1`, `Alt+2`, and `Alt+3` toggle Children, Nearby, and References without
  moving editor focus.

### Fixed

- Pressing a preview section heading no longer reaches the pane-wide pick
  handler, so expanding Children, Nearby, or References cannot silently insert
  the selected reference. References now reaches its lazy native-backlink load.
- Repeated preview fills retain one pane `mousedown` listener instead of
  accumulating one per selection change.
- Compact snippets preserve the sentence opening for near-start matches and
  otherwise center their window on the first match. Preview rendering strips
  imported `<!-- roam-… -->` metadata defensively.

## v4.32.0 — 2026-07-25

### Fixed

- The optional `— N mentions →` landmark now appears only when the Line Index
  broker is installed, ranks below exact block matches, never becomes the
  default Enter action, suppresses cached zero-count rows, and cannot be
  mistaken for a block by preview clicks or Alt+A.
- Authoritative Line Index results now wait for the current registry scan.
  Legitimate filter rejections remain authoritative, while unresolved hits and
  empty pages retain native fallback. Warm lines whose reference targets are
  cold retry through broker-resolved text without losing native filter metadata.
- Empty-picker traversal stops after its bounded candidate window, landmark
  counts use the existing settle debounce, and up to 48 cold broker hits hydrate
  concurrently instead of serially.
- Every Line Index partial reason has a specific status label. Exact-GUID and
  unparseable-query exits replace stale completeness metadata, and semantic
  lookup errors remain in semantic diagnostics.
- RefX cancellation options now reach Line Index co-occurrence and resolved-text
  calls through the broker's public signatures.

## v4.31.0 — 2026-07-25

### Added

- The empty `((` and `[[` pickers now open with recent, frecent, and loaded
  candidates so users can recognize a target before recalling its exact name.
- Single-clause `((` searches offer an exact page landmark such as
  `Celisse — 7 mentions →`; activating it opens that page in Reference
  Navigator with references and mentions expanded.
- Picker matching now accepts unordered token prefixes and compact initials in
  addition to exact token sets.

### Fixed

- Empty or unevaluated Line Index pages, empty co-occurrence intersections,
  unresolved collection GUIDs, rejected cold hits, and 1.5-second broker
  timeouts all retain native search and report partial coverage truthfully.
- Filtered cold hits retry with broker-resolved text while keeping native task
  and date metadata for filters.
- Registry fallback no longer depends on the old co-occurrence/C2 gate, so a
  changed query still runs its native scan and search.
- Broker and semantic timers are cleared, cancellation reaches co-occurrence
  and text-resolution calls, semantic rows enter the complete result pool, and
  semantic failures no longer overwrite Line Index diagnostics.

## v4.30.0 — 2026-07-25

### Added

- The `((` picker now feature-detects Thymer Line Index v1 and searches its
  resolved own/reference text before falling back to native stored-text search.
  Cold line hits resolve without requiring the target in `g_universe`, and
  replacement queries abort the preceding broker request immediately.
- Two uniquely resolved `+` clauses use the line index's exact reference
  co-occurrence intersection. Unresolved clauses retain the existing text-AND
  behavior.
- Restored the bounded semantic line-search supplement for sparse lexical
  results, with graceful absence and a 1.5-second timeout.

### Fixed

- Broker `complete` and `capReason` coverage now flow into the picker's partial
  result status without upgrading incomplete result sets.
- Swallowed line-index and semantic failures leave diagnostic detail in
  `window.__REFX_LINEINDEX_LAST_ERROR`.

## v4.29.1 — 2026-07-24

### Fixed

- **Original rollback is loss-visible.** Every lifted child is offered a restore
  even after an earlier restore fails. A partial rollback keeps the
  original-location marker, reports the exact child GUIDs that could not be
  restored, and records the failure in `window.__REFX_LAST_ERROR`.
- **Swap blocks only preserves depth.** Direct children now move beneath the
  marker occupying the original's former slot instead of being promoted to the
  former parent. The bring-children path treats marker creation as best-effort,
  retaining its pre-4.29 behavior on read-only or temporarily conflicting
  source locations.
- Creation-time embed display changes only the transclusion created by that
  action. Existing embeds of the same target keep their variants, and a regular
  embed no longer writes redundant `refx_variant: "full"` metadata.
- Returning from a submenu now restores the real top-level keyboard selection.
  Mouse-opened nested menus keep arrows at the deepest entered level, hovering
  back to a parent closes deeper descendants, and sibling hover replacement
  remains dwell-gated.
- Menu extensions now carry an owner tag, prune failed owner guards, validate
  icon suffixes, and expose `unregisterMenuExtension` plus
  `listMenuExtensions`. Registrations deliberately survive a RefX hot reload;
  a true RefX unload clears the registry so callbacks cannot outlive disabled
  plugins.
- Removed the unsupported modifier-click hint from **Open linked references**,
  removed that main-panel action from **Add to Workbench**, renamed the
  keep-text action to **Remove reference**, and completed **Jump to block**
  wording across RefX surfaces.
- README and manifest copy now use **Open in side panel** and **Add to
  Workbench** consistently and document the menu-extension bridge.

### Verification

- Added failure-injection coverage for lift/rollback failures, zero-child and
  same-record moves, cycle refusal, owner teardown, and multi-level hover
  navigation.
- `node --check plugin.js` and the complete deterministic Node suite pass.

## v4.29.0 — 2026-07-24

### Added

- The reference popup now supports a depth-aware submenu stack. Nested rows use
  the same hover dwell and side placement as existing flyouts; Right enters the
  selected child menu, Left or Escape pops one level, and Enter invokes only a
  focused leaf. Existing one-level menu callers retain their prior behavior.
- **Replace with → Embed** now chooses **Regular Embed**, **Embed with path**, or
  **Embed only children** as the embed is created. The existing **Embed display**
  flyout remains available for changing an already-open embed.
- **Replace with → Original** now offers **Swap blocks only** and **Bring nested
  items along**. Swap re-parents the original's direct children, in order, to
  its former parent before moving the original; every move preserves the
  existing line GUID and therefore inbound references.
- `window.__refx.registerMenuExtension({ id, owner, label, icon?, when?, onSelect })`
  lets another plugin contribute a context-filtered menu action. Registrations
  live in a window singleton across RefX hot reloads, same-id replacement is
  safe against stale disposers, and an empty Extensions menu is never rendered.

### Changed

- **Open linked references**, **Copy this reference**, and **Delete reference**
  are promoted to top-level rows while their grouped variants remain
  available. The navigation row now says **Jump to block**.
- Navigation vocabulary is unambiguous: **Open in side panel** opens a real
  Thymer panel, while plugin-owned shelf actions live under **Add to Workbench**.
- The dormant section-heading design remains unused; dividers keep the expanded
  menu readable without adding non-action rows.

### Verification

- Added deterministic coverage for nested mouse/keyboard navigation, promoted
  and retained actions, extension filtering/replacement/disposal, creation-time
  embed variants, and both GUID-preserving Original move modes.
- `node --check plugin.js` and all 901 deterministic Node tests pass.

## v4.28.4 — 2026-07-24

### Fixed

- `_pinReferenceNavigator`: when a navigator panel already exists (detected by
  the `refx-nav-panel-host` class on its element), the method now reuses that
  panel instead of calling `createPanel` + `navigateToCustomType`. On reuse
  Thymer skips the registered mount callback, causing the pinned navigator to
  show stale or blank content. The fix scans `ui.getPanels()` for an existing
  host panel, updates `_navigatorPanelTargets` with the current nav, and calls
  `_renderNavigatorPanel` directly; the fresh-panel code path is unchanged.

- **Verification:** 226 deterministic Node tests in the core plugin suite. `node --check plugin.js` passes. Pre-existing failures in r10-export, r5–r7, and performance-guards are unchanged.

## v4.28.3 — 2026-07-23

### Fixed

- `refxCaretLine()`: insert Tier 0 — `window.g_range.first_pos.list_item.state.guid`
  before the existing `g_item` tier. `g_range` tracks arrow-key caret movement in real
  time; `g_item` goes stale on arrow-only navigation and caused cursor commands to
  resolve the wrong line. The GUID validation regex (`/^[A-Za-z0-9-]{6,64}$/`) and
  DOM-element existence guard are applied to the range GUID before returning.

- **Verification:** 226 deterministic Node tests in the core plugin suite and
  898/898 across the complete repository matrix. Syntax, JSON, version, and
  whitespace checks pass.

## v4.28.2 — 2026-07-23

### Fixed

- Fleet caret-detection fix (U7c): `refxCaretLine()` three-tier helper replaces
  `.listitem-with-caret` queries in caret guards and `_selectionLineEl`.

- **Verification:** 226 deterministic Node tests in the core plugin suite and
  898/898 across the complete repository matrix. Syntax, JSON, version, and
  whitespace checks pass.

## v4.28.1 — 2026-07-22

### Fixed

- `(( scope picker`: re-trigger children load when the cached entry for a scope
  key is still a pending Promise (avoids stale "no results" when a fast
  keystroke races an in-flight load).
- Scope loading row now only renders when `loadingState.token` matches the
  current link token, preventing a stale loading indicator from a prior query
  from bleeding into a new picker session.
- Scope loading row additionally gated on `loadingState.session === undefined ||
  loadingState.session === this._r5SessionGen`, preventing loading rows from one
  picker session leaking into the next.

## v4.28.0 — 2026-07-22

### Added

- Extreme line transclusions now mount an instant native-backed outline before a
  cold targeted SDK read begins. The preview retains at
  most 300 already-read descriptors and mounts only 40 rows at a time; paging,
  selection, and hierarchy indentation perform no new search, body read,
  backlink lookup, or document write.
- **Edit selected** and Enter open the exact selected line in a native Thymer
  side panel. **Load complete inline — may be slow** remains available for the
  full native editable transclusion, and the bounded outline stays painted until
  Thymer's native transclusion DOM actually exists.
- Image and file line items now render as meaningful cards throughout record
  body previews, line/context previews, linked-reference surfaces, hover/picker
  previews, Workbench, and the Reference Navigator hierarchy. Empty segment
  arrays no longer appear as empty bullets.
- Local raster image blobs load after a short settled-attention delay, with a
  three-image surface cap and 5 MiB file limit. PDF metadata paints immediately;
  the local blob is downloaded and mounted only after **Preview PDF**, with a
  25 MiB limit. SVG, unsupported file types, oversized blobs, and external URLs
  remain blocked.
- Media rows in the exceptional 1,500+ line outline perform no automatic blob or
  second body read. Their explicit **Show image** / **Preview PDF** control lazily
  resolves only that exact native line, preserving the outline's instant paint.

### Performance and lifecycle

- Inline media uses a dedicated 48 MiB byte-bounded LRU, one download in flight,
  generation guards, and complete object-URL/timer cleanup on unload and hot
  reload. Closing Reference Navigator cannot revoke media still visible in an
  inline preview.
- The existing exact-host mutation lock, cycle checks, persisted-marker reread,
  rollback receipts, and no-duplicate guarantees are unchanged.
- **Verification:** 226 deterministic Node tests in the core plugin suite and
  898/898 across the complete repository matrix, including pre-SDK cold-shell
  paint, one-read reuse, 40-row DOM bounds, native-mount handoff, image/PDF lazy
  activation, byte limits, and unload revocation. Syntax, JSON, version, and
  whitespace checks pass.

### Upgrade and rollback

- Install `plugin.js` and `plugin.json` from v4.28.0 together, save, and fully
  reload Thymer. Rollback restores both files from v4.27.8. The release adds no
  schema, migration, background scan, or document write.

## v4.27.8 — 2026-07-22

### Fixed

- The bounded lightweight-preview count now participates in normal document
  flow. It no longer uses a sticky position or negative margins, so the footer
  cannot cover the final visible body line near the bottom of the preview.
- Choice-field keyboard navigation now paints its cursor on the stable native-
  style value cell as well as the volatile value child. Choosing with Enter
  therefore leaves one continuous highlight while Thymer settles the property
  write—there is no disappear-then-repaint step—and ↑/↓ still continues to the
  adjacent field without a mouse click.
- Cursor cleanup covers both paint layers during navigation changes, hot reload,
  and unload so the continuity fix cannot leave a stale highlight behind.
- **Verification:** 224 deterministic Node tests in the core plugin suite and
  885/885 across the complete repository matrix, including normal-flow footer
  guards, stable-host choice cursor continuity, and post-selection Arrow
  navigation. Syntax, JSON, version, and whitespace checks pass.

### Upgrade and rollback

- Install `plugin.js` and `plugin.json` from v4.27.8 together, save, and fully
  reload Thymer. Rollback restores both files from v4.27.7; no data migration is
  needed.

## v4.27.7 — 2026-07-22

### Fixed

- Long non-empty record bodies once again keep a useful lightweight preview.
  The already-loaded probe result is windowed to `custom.smallBodyLineCap`
  (40 lines by default) and labeled truthfully as “40 of N”; no second body
  read, native transclusion mount, or document write is introduced.
- **＋ Add body content** remains strictly empty-only. A long body never shows
  the action, and **Load full body** remains available for an explicit editable
  native transclusion.
- Choice and other property popups now own a durable snapshot of the property-
  card keyboard cursor. After choosing with Enter, the selected field remains
  highlighted and ↑/↓ continues through properties even if Thymer repainted the
  surrounding native property DOM while the popup was open.
- **Verification:** 224 deterministic Node tests in the core plugin suite and
  885/885 across the complete repository matrix, including long-body bounds,
  empty-only creation, choice Enter restoration, and post-selection Arrow
  navigation. Syntax, JSON, version, and whitespace checks pass.

### Upgrade and rollback

- Install `plugin.js` and `plugin.json` from v4.27.7 together, save, and fully
  reload Thymer. Rollback restores both files from v4.27.6; no data migration is
  needed.

## v4.27.6 — 2026-07-22

### Fixed

- Restored the stable empty-transclusion workflow for the evolved lightweight
  record preview: after the existing targeted body probe proves a record empty,
  the preview now shows a keyboard-accessible **＋ Add body content** action.
- Activating the action creates exactly one first body line, replaces the
  lightweight shell with the real native editable transclusion, and targets the
  new line. The action is single-flight so mouse event pairs and rapid repeats
  cannot create duplicate blank lines.
- Failed writes leave the action visible and retryable. If the line is created
  but native transclusion mounting fails, the new content is retained and the
  ordinary **Load full body** recovery action is restored.
- The behavior is adapted from the stable upstream implementation by
  [Parham Shafti](https://github.com/parham-shafti/thymer-reference-extravaganza)
  without replacing the current preview, navigation, Workbench, performance, or
  reference-surface architecture.

### Upgrade and rollback

- Install `plugin.js` and `plugin.json` from v4.27.6 together, save, and fully
  reload Thymer. Rollback restores both files from v4.27.5; no data migration is
  needed.

## v4.27.5 — 2026-07-21

### Fixed

- Removed Reference Workbench storage discovery and body migration from the
  ordinary cold-start path. A closed Workbench now performs zero collection,
  record, or line-body reads until the user explicitly opens or adds to it.
- A Workbench panel that Thymer restores visibly is synchronously adopted only
  when its GUID matches a workspace-scoped receipt previously validated by exact
  Settings/Examples enumeration. Same-title collisions are ignored; late panel
  settlement receives five bounded, input-gated attempts.
- Legacy shelf migration is serialized and semantic-keyed by target plus
  full/linked-references view. Partial failures retain legacy state, and retries
  converge only missing lines/meta without duplicates. Cleanup runs only after
  `getLineItems(false)` verifies every required line and metadata value.
- Cached the resolved backing `PluginRecord`, eliminating repeated
  `data.getRecord()` workspace-map expansion from Workbench reads, writes,
  pin moves, and sorting.
- Visible refreshes re-enter the input/visibility gate after every awaited SDK
  boundary; their timer only enqueues shared-lane work and cannot call the body
  reader directly. A window-stashed owner generation fences migration, adds,
  edits, refreshes, and cleanup across hot reload. Trash, move, metadata reload,
  and unload invalidate cached handles and in-flight resolution.
- Legacy provenance detection joins the line's rich text segments rather than
  relying on the optional `li.text` convenience field.
- Backing authorization now binds the record to its exact validated
  Settings/Examples collection. Renaming or trashing that host collection
  revokes the cached handle and persisted receipt before any later write.
- Restored-panel adoption uses independent per-panel generations, so an
  unrelated main-panel navigation cannot cancel a still-settling Workbench.

### Upgrade and rollback

- Install `plugin.js` and `plugin.json` from v4.27.5 together, save, and fully
  reload Thymer. Rollback restores both files from v4.27.4; no data migration is
  needed.
- **Verification:** 223 deterministic Node tests in the primary plugin suite,
  including Workbench failure/retry, concurrent migration, collision, lifecycle,
  late-panel, input-gate, and hot-reload behavior; the complete repository suite,
  syntax, JSON, version, and whitespace checks are release gates.

## v4.27.4 — 2026-07-21

### Fixed

- Serialized Reference Surface hydration, record-name/alias indexing, relation
  indexing, and line-property indexing through one cooperative background lane.
  Whole-workspace passes yield every ~6 ms, pause for recent input and native
  autocomplete, and are generation-cancelled on unload or hot reload.
- Removed idle-callback timeouts from those passes so browser scheduling can no
  longer force RefX indexing through Thymer's first `@`, Task Table, Calendar,
  or week-view paint.
- Native picker detection is document-global and covers `.cmdpal--inline`,
  `.autocomplete`, and ARIA listbox/combobox portals. Pure picker mutation batches
  return before line, card, counter, or live-overlay registry enumeration.
- Initial panels are scanned once instead of receiving an additional forced
  350 ms refresh. Reference Surface progress revisions are bounded to at most
  one per 750 ms slice window, preventing startup repaint storms.
- Target-line badge startup paint now uses the event-maintained observed-line
  cache, native backlink pills, and persisted counts; it no longer walks every
  `g_universe` item for each newly opened panel.

### Upgrade and rollback

- Install `plugin.js` and `plugin.json` from v4.27.4 together, save, and fully
  reload Thymer. Rollback restores both files from v4.27.3; no data migration is
  needed.
- **Verification:** all 867 deterministic repository tests, including 227
  focused startup/picker/performance cases, plus syntax, JSON, version, and
  whitespace checks.

## v4.27.3 — 2026-07-21

### Fixed

- Ordinary segment-bearing non-task `lineitem.updated` events never call
  `event.getLineItem()`. Explicit/known tasks hydrate when needed; a cold,
  segmentless event gets one bounded classification read so a first-time task is
  discoverable, and its positive or negative result suppresses repeat reads.
- The RT-3 typed-hashtag offer path is payload-only. Segmentless and ref-only
  updates perform no line hydration or typed-provider reads, and a committed
  hashtag is proven before provider status/warmup work begins.
- RefX applies safe reference appearance classes during a visible native
  `.cmdpal--inline` picker, queues the exact affected line without forcing
  layout, and reconciles it once after the picker closes.
- Reference Surface v1 now compares line edges semantically. Identical and
  proven-segmentless updates stay quiet; timestamp-only changes publish a
  metadata-only targeted revision so `updatedAt` and date filters stay correct
  without repainting Backreferences. Reference changes publish old/new target
  GUIDs plus the source-line GUID; `capabilities.targetedDeltas = 1` enables
  feature detection without changing the v1 API.
- The Reference Surface ready event now dispatches on `window` for cross-plugin
  listeners and remains on `document` for existing consumers.

### Upgrade and rollback

- Install `plugin.js` and `plugin.json` from v4.27.3 together, save, and fully
  reload Thymer so no observer from an older hot-reloaded instance remains.
  Rollback restores both files from v4.27.2; no data migration is needed.
- **Verification:** 208 deterministic Node tests in the primary plugin suite,
  plus the complete repository suite, syntax, JSON, version, and whitespace
  checks.

## v4.27.2 — 2026-07-21

### Fixed

- Thymer's native `@` autocomplete rows no longer enter RefX's reference
  mutation pipeline. Native picker subtrees and mutations outside connected,
  committed `.listitem[data-guid]` rows are rejected before tagging or rescans.
- A generic `data-record-guid` is no longer treated as proof of a committed
  reference. Real native reference classes, `data-ref-guid`, and
  `data-link-guid` remain authoritative, so existing chips, transclusions, and
  target badges continue to reconcile normally.
- Overlay mutation work is now exact-row only: a mutation can schedule an rAF
  only when that line already has a registered count or checkbox overlay.
  Oversized native UI mutation bursts can no longer fall through to a full
  overlay layout pass. Scroll/resize and explicit mode changes still perform the
  intentional bounded full pass.
- Ordinary `@` keydown remains a strict no-op for RefX detection and search.
  Existing singleton observer/listener teardown continues to cover hot reload
  and unload.

### Upgrade and rollback

- Install `plugin.js` and `plugin.json` from v4.27.2 together, save, and fully
  reload Thymer so no observer from an older hot-reloaded instance remains.
  Rollback restores both files from v4.27.1; no data migration is needed.
- **Verification:** 201 deterministic Node tests in the primary plugin suite,
  plus the complete repository test matrix, syntax, JSON, version, and whitespace
  checks.

## v4.27.1 — 2026-07-21

### Fixed

- Line references now open as real native editable Thymer transclusions by
  default. The large-target guard measures the selected line's subtree instead
  of its entire owner, removing the false read-only preview for ordinary lines
  inside large Journal pages.
- Loaded line handles use target-local `getChildren()` checks, with short-lived
  event-invalidated receipts and a one-owner non-expanding cold fallback. The
  exceptional preview reuses a 300-row bounded snapshot and no longer scans or
  retains the loaded workspace registry.
- **Load editable transclusion** now uses one host/target mutation lock, resolves
  the source line fresh, verifies both `itemref` and `refx_embed`, rolls back an
  unverifiable create by exact GUID, and blocks duplicate creation while a
  backend-refused cleanup remains pending. Exact cleanup receipts survive
  same-document hot reload. The preview survives backend, stale-session, or
  lifecycle failure.
- Mutual line-target cycles are checked through the target line's real owner with
  complete cooperative traversal only when native state will be created. Live
  search uses the same size, owner, cycle, preview, and materialization rules.
  Owner updates invalidate in-flight size and cycle conclusions; missing/stale
  owners and read failures fail closed. Live-search placement metadata is also
  persisted and verified before its preview is removed.
- Alternate-target expansion, preview conversion, and ordinary native expansion
  share the canonical host/target lock and generation fence. A known extreme
  target never falls through to an unbounded native mount merely because its DOM
  row is temporarily unavailable. Deferred focus/unfold work is unload-fenced,
  and Cmd/Ctrl+Up restores focus to the exact authored host after closing a
  performance preview.

### Changed

- Only an actual target subtree above 1,500 lines starts with a session-only
  performance preview. It paints 100 cached rows initially, reveals up to 300,
  and always exposes a keyboard-accessible native editable-load action.

### Upgrade and rollback

- Install `plugin.js` and `plugin.json` from v4.27.1 together, save, and reload
  Thymer. Rollback restores both files from v4.27.0; no data migration is needed.
- **Verification:** 199 deterministic Node tests in the primary plugin suite,
  plus the complete repository test matrix, syntax, JSON, version, and whitespace
  checks.

## v4.27.0 — 2026-07-20

### Added

- Replaced the **Advanced block reference search** command with the focused
  **Reference Navigator** command. It opens with Ctrl+Shift+9, also accepts
  Cmd+Shift+9 on macOS, and lets an explicit `custom.drillShortcut` replace the
  default bindings.
- Added a user-visible **Pin** action that transfers the current Navigator
  session into a persistent SDK custom side panel. A session without a valid
  editor origin remains browse-only and never guesses an insertion target.
- Added the frozen `window.__thymerReferenceNavigatorV1` integration surface
  with feature-detectable `open`, `close`, and `getStatus` methods.

### Changed

- Search results now paint progressively: 8 rows initially and 8 more per
  reveal, with separate available/completed state so a partial first paint is
  never presented as exhaustive. Partial line results expose **Show 8 more**
  and a truthful **8 of N blocks returned · more may exist** status.
- Selected-result previews now put **Children** first, followed by **Nearby**
  outline context and lazily expanded **References & mentions**. Native Thymer
  tree handles remain the preferred context source; record property mentions
  augment inbound line references without hydrating record bodies.
- Preview images are selected-only and delayed by default. Only raster
  `image/*` workspace blobs up to 5 MiB are eligible; SVG is excluded, object
  URLs are held in a 32 MiB byte-bounded cache, and external images stay blocked
  unless explicitly enabled.

### Configuration

- Added bounded `custom.navigator` defaults:
  `enabled: true`, `initialResults: 8`, `revealBatch: 8`,
  `mediaMode: "selected"`, `allowExternalImages: false`, and
  `nativeContext: true`.

### Upgrade and rollback

- Install `plugin.js` and `plugin.json` from v4.27.0 together, save, and reload
  Thymer. Rollback restores the previous code and manifest together; Navigator
  sessions and pinned panels require no data migration.

## v4.26.1 — 2026-07-20

### Fixed

- `[[` result breadcrumbs now resolve cold records through the metadata-only
  record-to-collection index instead of requiring the record to be present in
  Thymer's rendered-item registry.
- `((` search results retain native `parent_guid` and cached child context, then
  fall back to their owning record's collection when structural context is not
  loaded.
- Active pickers repaint when the collection/name indexes become ready and when
  relevant record moves, record lifecycle events, or collection renames change
  breadcrumb metadata. Session and search tokens reject stale async repaint.
- Thymer re-index/reload events now invalidate and rebuild collection membership,
  collection-name, and record-name metadata without accepting an older in-flight
  index generation. Rebuilt collections repaint relevant picker rows progressively
  rather than waiting for the complete workspace walk.
- Collection names are captured during existing metadata enumeration, so 10,000
  synchronous breadcrumb builds perform zero SDK calls and zero body reads.
- **Verification:** 152 deterministic Node tests in the primary plugin suite,
  plus focused cold-record, cold-line, event lifecycle, stale-session, malformed
  metadata, duplicate-title, and 10k performance regressions.

## v4.26.0 — 2026-07-19

### Added

- Added the frozen, metadata-only `window.__thymerReferenceEditsV1` contract.
  RefX now announces picker sessions before derived plugins can observe the
  transient `[[query`/`((query` state and publishes a terminal receipt only
  after the target reference count and trigger removal have been re-read.
- Added `RefX: Reference platform health`, a read-only feature-detection view
  for Reference Edit v1, Reference Surface v1, Attributes Claims v1, and the
  optional Markdown Mirror bridge.

### Changed

- Ambiguous record and line-alias results remain separately selectable even
  when they share identical display text; ordinary duplicate text still
  collapses into a single counted row.
- Same-line picker supersession now emits a failed terminal receipt for the old
  session and fences its late completion from the newer session.
- Picker writes now await `setSegments()` and verify both the new reference and
  absence of raw trigger residue. Failed and cancelled sessions remain visible
  as bounded diagnostic receipts without exposing authored text.
- Hot reload and unload terminate active edit sessions and fully dispose the
  broker, subscribers, command handle, and global ownership tell.
- **Verification:** 152 deterministic Node tests in the primary plugin suite,
  plus the contract and picker regression suites.

## [4.25.2] — 2026-07-18

- Fixed cold-page drill children/context and line previews by hydrating real line trees, showing loading state, retrying one partial read after ~400ms, caching per picker session, and discarding stale async fills.

## v4.25.1 — 2026-07-18

- Fix commit residue: the picker tracks the literal document bracket range
  (docQuery/docEnd synced on root typing, frozen at drill) so Enter consumes
  the ENTIRE typed "((…" text for every row kind — no more leftover query text
  beside the inserted chip.
- Drill-scope UX: drilled target rendered as a selectable row; clearer
  parent/sibling/child grouping; breadcrumb navigation back.

## v4.25.0 — 2026-07-18

- **Structural context in `((` drill scopes.** Drilling into a line with children now renders its parent first, up to two siblings above and two below, then its children. Parent and sibling rows are muted/indented while child rows remain primary; every scoped result is tagged with `_ctxKind` as `parent`, `sibling`, or `child`.
- **Scoped filtering preserves child priority.** Typing filters all three structural groups, with matching children ranked ahead of parent and sibling matches. Leaf targets retain the existing selectable self-row instead of showing unrelated context.
- **Keyboard and preview behavior are unchanged.** Enter references the selected row, `>` / Tab drills into it, Shift+Tab navigates up, and the preview pane continues to follow selection or hover.

## v4.24.1 — 2026-07-18

- **Fix — childless-scope drill preview now fills with spatial context.** Drilling into a line with no children (e.g. "Monica") now shows the full spatial preview — record header, ancestor rail, 2 dim siblings before/after, highlighted target — rather than a nearly empty pane. Root cause: `_updateLinkPreviewPane` was called with a bare GUID string instead of a result object; the fix builds a proper synthetic result `{guid, rguid, text, …}` resolving the line's owning record from `g_universe`.

- **`((` result quality: dedupe, demote, and cleanup.**
  - *Text dedupe*: identical-text results collapse to one row (highest-scored wins). A muted `×N` chip on the row shows how many duplicate lines were collapsed; the kept row still inserts its own stable GUID.
  - *Roam Recovery demote*: results whose source record lives in the Roam Recovery collection (`1S1RE861Y88DJN2VN8179G5HCD`) are sorted to the bottom and labeled with a muted `[Roam]` crumb. Collection membership is resolved once per picker session in the background via `getAllCollections`.
  - *Comment noise strip*: `<!-- roam-… -->` HTML comment text is removed from display text before dedup and render (display only — the pick target GUID is unchanged).
  - *Disambiguation*: the page crumb is always rendered for deduplicated and Roam Recovery rows so same-text rows from different pages remain distinguishable.
  - Dedupe and demote also apply to scoped (drill) results.

## v4.24.0 — 2026-07-18

- **Fix — `_renderClaimRow` now renders a `refx-claim-provenance` element** when the
  edge's `provenance` carries `qualifiers`, `evidence`, or `confidence`. The element is
  appended before the jump button and uses the `.refx-claim-provenance` CSS class so
  downstream CSS can style it. Edges with bare provenance (no qualifiers/evidence) are
  unaffected.
- **Fix — `_r7RebuildClaimSection` normalizes flat edge arrays.** Callers that pass raw
  edge objects (rather than the internal `{edge, count}` wrappers produced by
  `_renderClaimRowsForTarget`'s dedupeMap) now work correctly. The authored/derived
  toggle and row count assertions no longer crash with "Cannot read properties of
  undefined (reading 'provenance')" when the section is rebuilt from raw edges.
- **Fix — action hint tests updated to match the v4.21.0 extended hint.** The picker
  action hint was expanded in v4.21.0 to `⇥/> drill · ⇧⇥ back · ⌃O preview · ↵ insert`;
  the a2-alias-ux test now asserts the correct string for both Mac and non-Mac platforms.
- **Fix — version guard tests updated from `4.16.2` / `4.23.2` to `4.24.0`.** r5-picker,
  r6-reference-views, r7-r8, r10-export, and performance-guards tests all pinned to an
  old release; updated to the current version.
- **Fix — Bug 1: `[Title missing]` chip via `((` → `>` drill → Enter.** `_pickLink` title
  guard now uses `_visiblyEmpty` (strips zero-width unicode) and tries g_universe fast-path
  before falling back to listview and BFS synthesis. Self-heal scan (`_healLineRefTitleScan`)
  runs on every panel scan and rewrites stored empty/placeholder titles once per session
  using the same 3-step resolution chain, repairing existing bad chips on sight.
- **Fix — Bug 2: Drill into a childless line no longer shows empty dead-end.** When
  `_r5ScopeChildren` returns 0 rows, `_renderLink` now injects the scope target itself as a
  selectable row (`refx-r5-scope-self`) with a muted "no children — ↵ references this line"
  hint below it. The preview pane stays on the target for context. Enter in this state picks
  the target directly via the scope-self Enter branch.
- **Fix — Bug 3: Create block below / Create as footnote dead on journal pages.** Preflight
  bracket-range check in `_createBlockBelowFromPicker` and `_createFootnoteFromPicker` now
  uses `liveState` alone (not `!li`) so journal lines with synthetic S-... guids no longer
  fail the gate. `_createBlockBelowFromPicker` falls back to `_activeRecord()` when
  `data.getRecord(rguid)` returns null. `_findFnSection` gains the same fallback so footnote
  creation works on journal pages. Root cause: `data.getRecord('S-...')` returns null for
  journal-page synthetic guids even though the line is fully writable via the active panel.
- **Fix — Bug 4: `((` search recall via Omni/semantic bridge.** After `searchPhase()`, when
  fewer than 8 results are in the set, `_runLinkSearch` queries `window.__thymerSemanticV1`
  (Smart Connections dense index) for line-kind hits (those with `lineGuid`), resolves their
  text from g_universe, and injects them via `_addBoundedSearchResult`. Graceful absence:
  skipped if the service is not installed or the query is < 2 chars. Timeout: 1500 ms.
- **Verification:** 53 Node tests pass; `node --check plugin.js` clean.

## v4.23.2 — 2026-07-18

- **Fix — `((` picker searches LINES only, not records.** `searchPhase` in
  `_runLinkSearch` now filters out pseudo-line hits that have no `rguid`
  (record-root title matches that Thymer can return as `lines` entries; these
  are not drillable and not insertable as block refs). Under the Thymer 2026-07
  update `searchByQuery(text, 60)` became records-primary — `res.lines` comes
  back empty for most plain text queries. Two mitigations added: (1) when the
  text query returns records but no lines, loaded `g_universe` lines belonging
  to those records are harvested and scored directly; (2) a supplemental
  `@task <q>` structured query is fired when the result set is still sparse —
  task lines are reliably returned as `lines` by structured queries. Together
  these restore (( line coverage without leaking page records into results.
  `>` drill unblocked as a consequence: record rows that had no `rguid` could
  not trigger the line-child drill path; now every result row has a real `rguid`.

## v4.23.1 — 2026-07-18

- Fixed the zero-result `((` picker create rows: Enter now dispatches the
  highlighted create action, and Option/Alt+Enter creates a footnote, even
  while the latest debounced search is still pending. Stale result rows remain
  protected from accidental insertion.

## v4.23.0 — 2026-07-18

- **Spatial preview pane redesign.** `.refalias-linkpreview` fully restyled for both
  line-fill and record-fill modes. Breadcrumb header block (`refalias-preview-header`)
  groups record name + muted collection crumb. Ancestor chain rendered with a dotted
  left-rail (`color-mix` CSS, zero hardcoded colors). Focal target row: 2px accent
  left-border (`--button-primary-bg-color`), `--sidebar-bg-hover` fill, emphasis
  `--color-text-50` text, padded. Children wrap: dotted rail, capped at 5 with "+N more"
  muted footer (was 30). Siblings: CSS-only padding, no inline style. Record-fill body
  lines use same ancestor-rail treatment. Props block retains native-density grid.
  Removed old duplicate CSS rules for `refx-preview-colcrumb/props/proprow/proplabel/propval`
  and the old `refalias-preview-sib` block. All spacing/color via tokens only.
- **`((` `>` drill verified end-to-end.** Plugin gate is correct: a real keyboard
  produces `e.key = ">"` (Shift+.) and the drill fires. CDP's `press_key "Shift+."`
  delivers `e.key = "."` (a known CDP limitation) — the plugin is not at fault. Confirmed
  with synthetic `KeyboardEvent` dispatch. Stale-desktop diagnosis if user is on 4.22.1
  web tab: deploy 4.23.0 and hard-reload.

## v4.22.1 — 2026-07-18

- CRITICAL: the footnote INDEX path created "Footnotes" sections on every
  visited page (and raced itself into duplicates). Index/decoration now uses
  find-only `_findFnSection` (never writes); creation is single-flight and
  happens only from explicit footnote-creation flows. Sectionless records get
  a negative cache (zero decoration cost).

## v4.22.0 — 2026-07-18

- **Feature — `((` drill extended to line mode** (`link.kind === 'line'`). The `>` drill
  trigger previously only worked in record (`[[`) mode; now `((` pickers can also drill into
  a line's children by pressing `>`.

- **Feature — Roam-style footnote infra.** New methods: `_ensureFnSection(rguid)` finds/creates
  a `Footnotes` heading under the record; `_ensureFnIndex(rguid)` builds a model-order
  depth-first Map of `{sectionGuid, fnGuids, order}` (invalidated on `handleLineItemUpdated`
  and `handleLineItemDeleted`). Config knob `custom.footnotes` (default true).

- **Feature — `((` create rows: block-below and footnote.** When the `((` picker has a
  non-empty query and zero results, `_lineCreateOptions` returns two rows: "＋ Create block
  below ↵" and "＋ Create as footnote ⌥↵". `_createBlockBelowFromPicker` and
  `_createFootnoteFromPicker` run bracket-range preflight before `createLineItem`, then
  `_pickLink` to insert the ref chip. Alt+Enter dispatched from the Enter handler.

- **Feature — Footnote chip decoration.** `_decorateFootnoteChips` (called from
  `_scanPanelImpl`) scans panel chips, queries `_fnIndex`, and stamps `.refx-fn-chip` +
  `data-fn-n` on chips that are footnote refs, which `.refx-fn-chip::after` renders as a
  `[N]` superscript.

- **Feature — Palette command `RefX: Insert or remove footnote` (Mod+Shift+F).** Opens the
  `((` picker in footnote mode. Handler joins `window.__refxKeyHandlers` for hot-reload
  safety; removed in `onUnload`.

- **Feature — Preview per-row branch (`rowIsLine`).** `_fillLinkPreview` now uses
  `rowIsLine = !!result.rguid || link.kind !== 'record'` instead of `link.kind === 'record'`
  so drilled child rows always get the line-preview path (fixes "Preview unavailable" when
  `((` picker drills into a record's children).

- **Feature — Spatial siblings in line preview.** Two rows before and two rows after the
  target line are rendered as dimmed `.refalias-preview-sib` rows in the preview pane
  (before-sibs above the target, after-sibs stashed on `pane._refxAfterSibs` and rendered
  after the children block).

- **Feature — Image thumbnails in preview.** `_resolveBlobUrl(li)` fetches `getBlob()` →
  `objectURL` with a Map cache capped at 20 entries (LRU eviction + `URL.revokeObjectURL`).
  `_previewImageEl(li, pane, alive)` creates `≤120px` `<img>` elements (max 3 per pane).
  Image lines in a record body or line children are rendered as thumbnails in the preview.

- **Fix — `[Title missing]` chips on task/cold lines.** `_synthesizeLineTitle(lineGuid)` does
  a BFS walk up to depth 6 over parent items to find a non-empty display title, falling back
  to parent text. `_pickLink` guard uses it before falling back to `'(untitled block)'`.

## v4.21.1 — 2026-07-18

- **Fix — Drill-picker child refs inserted "[Title missing]" chip.** Root cause: `_r5ScopeChildren`
  calls `getLineItems()` which can return items with empty `segments` when the line's segment
  data hasn't loaded yet (cold lines). `_cleanDisplayText([])` returned `''`, so real lines
  fell through to the `'(empty) ▸'` placeholder, which became the ref title. Three changes:
  1. **Cold-segment fallback in `_r5ScopeChildren`** (both record and line branches): when
     `rawText` is empty after reading `li.segments`, re-read from
     `g_universe.itemsByGuid[guid].text_segments` via `_segmentsFromState` before giving up.
     Real lines now show their actual text even when `getLineItems` returns cold data.
  2. **Defensive guard in `_pickLink`**: if the computed `lineDisplayTitle` is empty or the
     literal `'(empty) ▸'` placeholder at pick time (e.g. a structural-empty node was
     explicitly selected), re-reads the target line's live text via `_liveStateByGuid` →
     `_segmentsFromState` before falling back to the guid. Prevents `[Title missing]` in
     the inserted chip under any remaining cold-segment race.
  3. **Default selection skips `(empty) ▸` rows**: after a drill loads children, the initial
     selection (`link.sel`) is now advanced past any leading structural-empty rows to the
     first row with real text, so pressing Enter immediately after `>` picks a real line.

## v4.20.1 — 2026-07-18

- **Fix 1 — Property reference rows showed raw GUIDs.** Both the "Property references"
  and "Via property" sections called `getOrLoadRecordName(g)` synchronously. When the
  source record isn't in `g_universe` (cross-collection, lazy-loaded), that returns the
  bare GUID. Now each name `<span>` patches its `.textContent` asynchronously via
  `data.getRecord(g).getName()` and caches the result in `_recordNameCache`, so the row
  shows the real name ~1 frame after first render rather than a GUID string.

- **Fix 2 — Typed relations section: "Unknown source" rows, no dedup, unstyled.**
  Three problems in `_renderClaimRowsForTarget` / `_renderClaimRow`:
  - **Source unresolved:** `getOrLoadRecordName(srcGuid)` returned raw GUID for cold
    records, displayed as "Unknown source". Now resolves async: renders "…" placeholder,
    patches to real name on resolution, removes the row entirely if the source record
    doesn't exist in the workspace (permanently unresolvable broker-internal edge).
  - **Duplicate rows:** broker can emit multiple edges with the same (predicate,
    sourceGuid). Now deduped via a Map before rendering; a `×N` count pill appears when
    N > 1. Section hidden entirely when all rows are unresolvable after dedup.
  - **Unstyled "Hide derived" button:** was a bare HTML `<button>` with no CSS.
    Added `refx-claim-*` CSS rules (section header, toggle button, rows, badges, source
    name, count pill, empty state) using native Thymer color tokens.

- **Fix 3 — First chip click latency 2-3s; subsequent clicks fast.**
  Cold-open cost came from three caches being built on first click: `_fetchBackrefs`,
  `ensureCollectionIndex`, and context/claim row fetches.
  - **Warm-on-hover** (`_handleRefHover`): when hovering a `.lineitem-ref` chip whose
    `data-guid` is a record target, kicks `_fetchBackrefs` + `ensureCollectionIndex`
    fire-and-forget so the 350ms hover delay pre-warms both before the click lands.
  - **Idle collection index pre-warm**: `requestIdleCallback(fn, {timeout:3000})` at
    the end of `_counterInit` calls `ensureCollectionIndex` once when
    `excludeCollections` is non-empty, avoiding any first-click rebuild cost.

## v4.20.0 — 2026-07-18

- **R7 facet chip bar: native-sourced, same-paint, ON by default.**
  - The facet bar now computes counts synchronously from `_capturedBackrefs` (the
    eviction-proof native backref array snapshotted before any async yields) on the
    native path. Counts are exact (no "≥" prefix), cover `kind` (Inline ref / Property),
    `collection` (from `g_universe` record state), and `taskState` (Open task / Completed).
  - The bar renders **before** `_renderRefsGroups` — both land in the same browser
    paint with no post-hoc mutation.
  - Chip click filtering rewired: on the native path, `_r7ApplyFacetFilter` uses
    `entry._r7NativeEdgeMap` (lineGuid → native backref, built during snapshot
    computation) instead of `broker.inEdges()`.
  - **Broker fallback retained**: for line targets and journal pages where
    `_capturedBackrefs` is null, the existing late-render path with "≥N" labels
    runs unchanged.
  - **Gate flipped to opt-OUT**: facet bar is ON by default; disable with
    `custom.counter.facetBar = false`.
  - CSS added for `.refx-r7-facet-bar` and `.refx-r7-facet-chip` using native
    Thymer color tokens (`--cards-border-color`, `--input-bg-color`,
    `--sidebar-bg-hover`, `--color-text-400`, `--button-primary-bg-color`).

## v4.19.2 — 2026-07-18

- R7 facet chip bar in inline sections is OFF by default (late-paint churn +
  visual noise). Re-enable with custom.counter.facetBar = true.

## v4.19.1 — 2026-07-18

- **Bug A — missing space after ref chips in row renderer**: Thymer segment data
  has no separator character between a `ref` chip and the following text segment,
  so `renderSegments` produced DOM like `<span.tlr-seg-ref>lori</span>agrees`
  (no space). Fixed with a scoped CSS rule
  `.trc-ref-popover-fulltext .tlr-seg-ref::after { content: ' ' }` for the
  primary `renderSegments` path, and a spaced-join in the `_renderRefLineText`
  fallback path that inserts a leading space before text segments that follow a
  ref or linkobj chip. Applies to inline-section rows, count popover rows, and
  Workbench rows (all use `_buildRefContextRow` → `_renderRefLineText`).
- **Bug B — property/claim sections STILL arriving late despite v4.19.0**:
  The `_backrefCache` entry for `targetGuid` was being evicted between
  `_queryRefLines` returning and the code that reads
  `this._backrefCache?.get(targetGuid)?.refs` — because `_sortInlineRefLines` is
  async and record-update events can call `_invalidateBackrefs` /
  `_invalidateAllBackrefs` during that await. Fixed by capturing `.refs` into a
  `_capturedBackrefs` local constant immediately after `_queryRefLines` resolves
  (before any subsequent `await`), then using `_capturedBackrefs` where the code
  previously re-read the cache. The local variable is eviction-proof; further
  invalidation events have no effect on already-captured data.

## v4.19.0 — 2026-07-18

- **Property/claim sections: same-paint render on native path**: `_fillInlineRefs`
  now derives property-ref source-record guids from the already-cached
  `_fetchBackrefs` result (cached ~14ms prior by `_queryRefLines`) instead of
  issuing two more serial async queries (`_queryPropertyRefRecords` +
  `_querySdkPropertyBackrefs`). On the native path, the local prop-ref index
  and SDK section now run in parallel via `Promise.all`, and all three sections
  (line rows, "Property references", "Via property") render in ONE paint —
  eliminating the visible late-arrival flash. Fallback paths (line targets,
  journal pages, cold records, cache-miss) run the original serial logic
  unchanged.
- **Picker-preview (Cmd+Down) property rows: native two-column grid**: the
  `refx-preview-proprow / refx-preview-proplabel / refx-preview-propval` CSS is
  restyled from a simple flex row to a two-column grid (`label minmax(60px,100px)`
  / `value 1fr`) at 12px with native color tokens (`--color-text-600` label,
  `--color-text-400` value), matching the density of Thymer's native property
  editor. Colon suffix removed (native renders labels without one).
- **Preview body heading clamp**: native `.listitem-heading` elements inside the
  `refx-record-preview-shell` transclusion body (which loads async) previously
  rendered at full page-level font sizes (~20-24px), making "Goal" / "Task"
  headings look overscaled. Scoped CSS now clamps `heading-h1/h2/h3` and
  `.listitem-heading .line-div` to `font-size: inherit; font-weight: 600` inside
  the preview shell, matching the surrounding body's type scale.

## v4.18.0 — 2026-07-18

- **Native primary data source for ref-count badges**: `loadCountInfo` now tries
  `_fetchBackrefs(guid)` first for record targets. One cached
  `getBackReferences()` call (~14ms, server-complete) produces line-ref count,
  property-ref record count, and source-record count in a single pass — no
  serial `searchByQuery` + prop-index + SDK-backref calls. `'records'` mode
  dedupes all edge kinds from the same array. `'combined'` mode still consults
  the local prop-ref index for plain-value properties not covered by native
  edges, then dedupes against line refs. Fallback to the previous per-kind
  loaders when the native API is absent (line targets, journal pages, cold
  workspaces).
- **Linked-references section: no warm→async reorder flash**: `_fillInlineRefs`
  detects when `getBackReferences()` is available for a record target and skips
  the warm registry pre-render pass. The async `_queryRefLines` native path
  completes in ~14ms and produces the authoritative sorted result in one shot —
  the warm pass existed only to hide `searchByQuery` latency. Line targets and
  journal pages (where native returns nothing) continue to use the warm pass
  unchanged.
- **Context-tree cache threading**: the async `_renderRefsGroups` call for the
  first page now receives `treeCache: entry.bodyEl.__refxContextTreeCache`,
  inheriting source trees already fetched by the warm pass (when it ran) and
  avoiding ~100 redundant context fetches on fallback paths.
- **`_countCache` Map LRU bound**: `setCachedCountInfo` evicts the oldest Map
  entry when the live count exceeds 8000, preventing unbounded session growth.
  The persisted snapshot cap (`_countCacheStoreMax` = 4000) was already in
  place; the Map itself was unbounded.

## v4.17.1 — 2026-07-18

- Picker commit: consume the typed "[[query" text even when a ref to the picked
  target already exists on the line (duplicate picks are legal). The old hasRef
  fast-path skipped the write, leaving raw bracket text — "select does nothing".
  Verify is now count-based (expects prior-count + 1).
- Cycle-guard the hIndex walker in Replace-with-Original (missed in v4.17.0).
- _trueTargetSize: journal pages report Infinity (windowed path) instead of
  reading the full day-page body just to count lines.

## v4.17.0 — 2026-07-18

- Cycle-guard EVERY recursive line-tree walk (findBlock, _findLineDeep,
  _countLineTree, embed discover/rescan, owner resolve, context resolver,
  segment resolver, 9 byGuid/itemMap indexers). Thymer 2026-07 update made
  getRecord() resolve journal S-guids AND can return cyclic children trees;
  unguarded recursion threw "Maximum call stack size exceeded", killing
  Cmd+Down expansion and the right-click reference menu on Journal pages and
  degrading count-badge sections (slow, out-of-order rows). Live-verified:
  guarded walk terminates in 52 steps and finds the caret line.

## v4.16.4 — 2026-07-18

- Suppress the rename-alias "Keep" toast for system records: a "__"-prefixed
  title (Task Engine leader lock heartbeat) is never a human rename.

## v4.16.3 — 2026-07-18

- Ref-count chip popover: stable case-insensitive alphabetical sort by source
  record name, matching the backrefs panel ordering.

## v4.16.2 — 2026-07-17

- Fixed `[[` / `((` result selection on Journal pages. Picker commit, cancel,
  page-creation preflight, and paste now resolve the writable line through the
  canonical live-line/open-panel path instead of trying to reopen Thymer's
  synthetic `S-...` Journal owner with `data.getRecord()`.
- Fixed direct Cmd/Ctrl+Down expansion on Journal lines. Record references now
  open their persisted preview and line references retain native transclusion
  creation through the real panel record.
- **Verification:** 152 deterministic Node tests in the main plugin contract;
  703 tests across all suites; `node --check plugin.js` passes.

## v4.16.1 — 2026-07-17

- Extended the native hashtag bridge from exact-only to exact, prefix, and
  bounded fuzzy matches. Non-exact actions name the target type, ambiguity is
  explicit, `#mov` maps to `Movie`, and distant rows are rejected.
- Bound offers, mode persistence, and acceptance to the exact Attributes owner
  and definition generation. Every awaited continuation rechecks the current
  RefX lifecycle; stale consumers cannot emit late toasts or store receipts.
- Added a bounded token-matched receipt handoff across Attributes provider and
  RefX consumer replacement. A replacement consumer can recover ownership-safe
  undo state without replaying document mutation.
- Made partial failure messaging truthful: exact rollback, recoverable apply,
  retryable mid-delete undo, explicit partial/conflict, and unverified outcomes
  are distinguished instead of claiming the hashtag was unchanged.
- Focused RT-3 coverage now proves prefix/ambiguity/distant-match behavior,
  generation drift, provider replacement, consumer unload/replacement, and
  recoverable apply/undo handoff.

## v4.16.0 — 2026-07-17

- Added the RT-3 native hashtag bridge. A committed hashtag that exactly
  matches an Attributes type gets an explicit, layout-neutral line action;
  native `#` input is never intercepted and decline performs no write.
- `Option+Enter` accepts, `Option+M` changes and remembers that type's
  active/passive default, Escape declines, and a palette command undoes the
  last capture.
- Acceptance calls only Attributes' versioned typed-capture broker, preserves
  the hashtag, requires it to still be present, awaits full materialization,
  and keeps the immutable receipt for ownership-gated undo.
- Hot reload now sweeps the bridge subscription, key/position listeners,
  palette handle, and affordance DOM.

## v4.15.1 — 2026-07-17

- Bind every delegated R4 preview and planned undo to the exact authoritative
  Outline O5 provider object and generation that created it.
- Capability checks now call `status()` safely and require phase O5,
  `mutationEnabled: true`, exact mode `integrated-planned-undo`, and matching
  provider/status generations. Missing or unknown modes fail closed.
- Apply and undo refuse hot replacement, unload, generation drift, or degraded
  status before requesting the immutable apply token. Duplicate applies still
  delegate the same exact request so Outline retains idempotency ownership.

## v4.15.0 — 2026-07-17

- Replaced R4's legacy Outline capability stub with the authoritative
  `window.__thymerOutlineRefactorV1` O5 contract.
- Added destination/type/replacement/depth/undo inputs to the R4 selection
  panel and a separate `Apply reviewed plan` action.
- Extract, detach, move, copy, sibling sort, and bounded move/sort undo now use
  Outline-owned runtime capture, preview, exact apply tokens, verification,
  Version Ledger wrapping, and receipts.
- Kept copy-as-reference and native transclusion as RefX-owned primitives while
  making transclusion preview/apply an explicit two-action workflow.
- Added R4 contract tests proving plan-only preview and exact-token delegation.

## v4.14.1 — 2026-07-16

- **Group-header action strip completed — ⤵ Embed here (tracked, toggles, torn down on section close); matches the row strip's order.** Source-record embeds route through `_sectionToggleEmbed(entry, srcGuid)` and are offered only when `_renderRefsGroups` receives the inline section's `collapseEntry`. ✎⊞ is omitted because RefX has no distinct record-level edit-live surface: R8 is line-only, its Open-to-edit control duplicates Jump, and the record preview already uses the same embed path as ⤵.
- **Verification:** 152 deterministic Node tests in the main plugin contract; 678 tests across all suites; `node --check plugin.js` passes.

## v4.14.0 — 2026-07-16

- **Linked-reference group actions:** Source-record headers reveal explicit hover actions for Jump, Open in side panel, and Add to Workbench without collapsing the group.
- **Smooth full-body materialization:** Record previews reserve their exact rendered height, keep the same property-card node continuously visible, fade the shell out and native embed in, and release the spacer on native placement, retry exhaustion, fallback, failure, navigation, unload, or hot reload.
- **Small records become editable automatically:** `custom.autoLoadSmallBodies` defaults to `true` and sends non-empty bodies at or below `custom.smallBodyLineCap` through the same native materialization choreography; disabling it retains the read-only peek.
- **Cross-plugin embed lifecycle hook:** RefX dispatches `refx:embed-mounted` with `{ lineGuid, targetGuid, container }` after materialized, newly expanded, and persisted/reattached native embeds resolve in the DOM.
- **Cmd+P limitation documented:** The Inline Transclusion guide warns that Thymer line-format commands can target and collapse the transclusion host line, and directs formatting through the source record until core target resolution is fixed.
- **Verification:** 152 deterministic Node tests in the main plugin contract; 678 tests across all suites; `node --check plugin.js` passes.

## v4.13.2 — 2026-07-16

- **Reference-chip polish:** Star-alias chips (Replace with alias / text-and-alias) no longer render the task checkbox — just the star; Thymer's native open arrows on reference chips can be hidden (on by default) via Settings / `custom.hideNativeOpenGlyphs`.
- Star-alias chips navigate directly on click like Roam — `custom.starAliasClickNavigates=false` routes them through the menu instead.
- **Verification:** 151 deterministic Node tests in the main plugin contract; 674 tests across all suites; `node --check plugin.js` passes.

## v4.13.1 — 2026-07-16

- **Native command-palette menus:** Reference/line right-click menus and their flyout submenus adopt the native command-palette look, matching the restyled picker — all rows, shortcuts, flyouts and density preserved.
- **Verification:** 146 deterministic Node tests in the main plugin contract; 666 tests across all suites; `node --check plugin.js` passes.

## v4.13.0 — 2026-07-16

- **Upstream v3.2.x polish:** Ported upstream v3.2.x polish: native command-palette picker look (blended with the alias UI), auto-growing text-property editor, commit-on-switch + self-healing editor state, folded-line Cmd+Down unfolds first, native date/time labels in results/previews/alias box.
- **Verification:** 146 deterministic Node tests in the main plugin contract; 666 tests across all suites; `node --check plugin.js` passes.

## v4.12.0 — 2026-07-16

- **Roam left-click semantics:** clicking a line reference opens its menu (double-click jumps); page references still navigate. `custom.lineRefClickMenu=false` restores navigate-on-click.
- **Verification:** 140 deterministic Node tests in the main plugin contract; 660 tests across all suites; `node --check plugin.js` passes.

## v4.11.0 — 2026-07-15

- **Alias documentation deep-dive:** rewrites the README around the current ⌥A/Alt+A creation flow, Tab drill-down, chooser/deletion controls, ranking/dedup, filters, configuration, caps, bridges, and a keyboard-first 60-second walkthrough.
- **Compact Roam-style reference menu:** replaces five headed flat sections with at most 11 top-level rows and reusable right/left-flipping flyouts. Hover intent, click, ArrowRight/ArrowLeft, two-stage Escape, and the shared outside-click dismissal tree retain every existing action and handler.
- **Keep a renamed title as an alias:** record title changes settle for two seconds before one eight-second action toast offers the original title. Creation, empty/equal/duplicate titles, and `custom.renameAliasOffer: false` suppress the offer; alias writes remain explicit and cap-aware.
- **Alias Finder:** a palette command and the Aliases flyout find up to 200 case-insensitive, word-boundary plain-text alias occurrences for the active record. The abortable/time-sliced results UI offers per-row Link and Link all, while all writes reuse the segment-preserving unlinked splice plus alias preview/apply receipt and undo machinery.
- **Alias usage stats:** record and line managers display `× N`; picker chooser chips sort most-used-first and omit zero badges. Counts reuse Reference Surface `inEdges`, are computed only when alias UI opens, time-sliced, and cached per target for 60 seconds.
- **Verification:** 140 deterministic Node tests in the main plugin contract; 653 tests across all suites; `node --check plugin.js` passes.

## v4.10.0 — 2026-07-15

- **Visible, trustworthy alias search:** the hydrated record-alias index is searched directly even when a record name is cold, exact/prefix aliases outrank unrelated fuzzy title hits, and one-row-per-record dedup preserves the winning row while annotating canonical-title matches with `· alias: …`. Alias rows use a clearer `↳ canonical title` suffix, and successful picker-created aliases now toast the alias and target.
- **Delete aliases without leaving the picker:** highlighted alias chips expose a hover/active `×`; ⌥/Alt+Backspace removes the active choose-mode chip or a highlighted alias-result row, keeps choose-mode open when aliases remain, and refreshes search results with a success/error toast.
- **Scroll-anchored picker:** the fixed `[[` / `((` picker follows inner-panel scrolling and viewport resize through one rAF-throttled capture listener, retains its last clamped position when the anchor is off-screen, and centrally removes listeners/rAF state on pick, cancel, unload, and hot reload.
- **Compact context menus:** reference and line right-click rows now use Roam-like 4px vertical padding and 1.25 line-height, with a ref-menu-only 2px result gap; existing theme-token hover/selection colors, icons, dividers, headings, hints, and widths are unchanged.
- **Verification:** 645 tests across all suites; `node --check plugin.js` passes.

## v4.9.0 — 2026-07-15

- **Reliable inline alias creation:** Alias prompts now cancel pending searches, invalidate in-flight results, and suppress picker re-renders while the prompt or alias write is active. Every completion, error, stale-picker, cancel, and 4-second safety-timeout path releases the alias lock. ⌥A/Alt+A flushes pending search work before resolving the highlight, and a selected missing-page row creates the page before opening its alias prompt.
- **Platform-aware picker help:** The action row now advertises `⌥A` / `⌥↓` on macOS and `Alt+A` / `Alt+↓` elsewhere, while the existing preview footer continues to use Cmd-O or Ctrl-O.
- **Highlighted-result alias chooser:** Stored record or line aliases appear on demand as compact chips directly below the highlighted result. Click a chip to insert it as the reference title, or press ⌥↓/Alt+↓, navigate with arrow keys, and press Enter; Escape returns to result navigation.
- **Verification:** 637 tests across all suites; `node --check plugin.js` passes.

## v4.8.1 — 2026-07-15

- **Refined linked-reference group headers:** Collapsible linked-reference group headers are larger and show each source record's last-changed date (same faint stamp as the reference rows).
- **Verification:** 140 deterministic Node tests in the main plugin contract; 14 record-preview tests; 629 tests across all suites.

## v4.8.0 — 2026-07-15

- **Relation/People fields open on type:** the class-based property-card cursor now routes printable keys for relation fields through the seeded relation picker, preventing the keystroke from reaching Thymer's editor and moving the caret. The obsolete cell-level choice/relation keydown handler was removed; click-to-open remains unchanged.
- **Collapsible linked-reference source groups:** every inline source group has an independent ▸/▾ toggle, while a section-level ⊟/⊞ control collapses or expands all current groups. Entry-owned state survives filters, sorts, and refills.
- **Configurable, synced collapse state:** `custom.inlineRefsGroupsDefault` selects `expanded` (default) or `collapsed`; `custom.inlineRefsPersistCollapse` defaults to `true` and stores one JSON source-GUID set in the host line's `refx_collapsedGroups` meta. Both options are exposed in Settings and saved together on Done.
- **Verification:** 139 deterministic Node tests in the main plugin contract; 14 record-preview tests; 628 tests across all suites.

## v4.7.5 — 2026-07-15

- **Load full body no longer flickers the property card:** the existing preview card is reused in place (re-keyed to the mounted line) instead of being torn down and rebuilt; the body mounts smoothly using the warmed record.
- **Verification:** 134 deterministic Node tests in the main plugin contract; 14 record-preview tests; 623 tests across all suites.

## v4.7.4 — 2026-07-15

- **Relation typing and clean full-body loading:** Relation/People property fields now open the picker on typing (seeded with the character) instead of leaking the keystroke to the editor and bouncing the caret out of a transclusion; Load full body cleanly replaces the peek and refreshes both properties and body, using the warmed record for speed.
- **Verification:** 134 deterministic Node tests in the main plugin contract; 622 tests across all suites.

## v4.7.3 — 2026-07-15

- **Truthful, responsive record previews:** An abortable async body probe runs only after the lightweight shell mounts. Empty records lose the false “Load full body” affordance, while small bodies (40 top-level lines by default) render immediately as a read-only segment-aware inline peek without paying the native-transclusion mount cost. `custom.previewBodyProbe`, `custom.previewBodyPeek`, and `custom.smallBodyLineCap` control the behavior.
- **Complete preview keyboard path:** Preview actions remain navigation stops even when the property card is cold or has zero property rows; Enter and Space activate “Load full body.”
- **Choice-field typing stays put:** Printable keys on a choice cell now open and seed its filter, popup arrows/Enter commit choices, and focused popup inputs block structural or in-place card refreshes so Thymer cannot steal the keystroke or bounce the caret.
- **Verification:** 133 deterministic Node tests in the main plugin contract; 13 record-preview tests; 621 tests across all suites.

## v4.7.2 — 2026-07-15

- **Adaptive linked-reference context:** Large / cold linked-reference sections defer per-row context (children, siblings, breadcrumb) to on-demand load, eliminating the multi-second SDK record-materialization that froze open/close; small warm sections still show context eagerly. `custom.eagerContext` / `custom.deferContextThreshold` override.
- **Verification:** 130 deterministic Node tests in the main plugin contract; 614 tests across all suites.

## v4.7.1 — 2026-07-15

- **Interruptible cold inline fills:** Large linked-reference sections render in abortable chunks, so closing one mid-hydration is instant even on cold/unwarmed sessions where the registry isn't populated.
- **Bounded source resolution:** Inline source names resolve once per source in time-sliced preparation before sorting, while badge and section queries continue to share the existing backreference TTL cache.
- **Verification:** 126 deterministic Node tests in the main plugin contract; 610 tests across all suites.

## v4.7.0 — 2026-07-15

- **Responsive inline-section teardown:** Inline-section collapse now tears down embeds it spawned (Roam count-click parity); warm reference walk is time-sliced so closing a large section mid-hydration is instant.
- **Verification:** 123 deterministic Node tests in the main plugin contract; 607 tests across all suites.

## v4.6.1 — 2026-07-15

- **Inline-row embed toggle survives section refreshes:** every inline-section ⤵ action now captures immutable host/target GUID strings at render time. Invalidated SDK row handles can no longer degrade the target to `''`; missing identity is guarded with a toast before the bridge. The existing line-target open detection and host-scoped collapse path remain unchanged and are now covered directly.
- **Human-readable RefX facets:** collection facets resolve through the picker/schema collection cache, broker `resolveTarget`, and the RefX name bridge. Source-property facets prefer edge-provenance `propertyName`. Page chips use the same per-render cached resolver. Unresolved opaque IDs render as six characters plus an ellipsis with `title="unresolved"`, never as a full raw GUID.
- **Verification:** 120 deterministic Node tests in the main plugin contract; 604 tests across all suites.

## v4.6.0 — 2026-07-14

- **Native editable full-body loading:** “Load full body” always attempts a real native `refx_embed: 1` transclusion, regardless of target size, and retains the exact `createLineItem` handle in `_cards` for O(1) same-session close. Cmd/Ctrl+Down inside the compact record-preview shell triggers the same native action; its button remains a normal tab stop. Read-only windowing is limited to automatic expansion of truly extreme targets (>1,500 authoritative lines) and native-creation failure.
- **O(1) DOM-first collapse:** Cmd/Ctrl+Up now resolves an enclosing `.listitem-transclusion[data-guid]` before caret-model target identity. Collapse priority is DOM slot → retained `_cards` handle → cold host-record lookup. The cold path opens only the host record and calls `getLineItems(false)`; it never touches the target record. Exactly one plugin embed line is deleted directly, with no confirmation or other document mutation.
- **Collapse diagnostics:** Every fast resolver writes `window.__refxDiag.lastCollapse = {ms, path, hostGuid, targetGuid, coldFallback}` so future latency reports identify the active path with one console read.
- **Card reveal and native containment:** Shell-mounted record-property cards now align and reveal even though compact preview shells have no `.transclusion-container-div`. The containment selector now explicitly matches `.transclusion-container-div` descendants of `.listitem-transclusion`, including record-preview-created native embeds, while caret-containing bodies remain visible.
- **True-size routing:** Automatic native/windowed selection uses an SDK count or a complete `getLineItems(false)` tree count cached by target owner. Unknown cold sizes provisionally choose native; partially-loaded `g_universe` counts no longer drive the decision.
- **Verification:** 117 deterministic Node tests in the main plugin contract; 9 record-preview tests; 598 tests across all suites. Focused regressions cover shell reveal, DOM/body-caret collapse without line-tree reads, retained-handle close, host-only cold fallback with `false`, target non-access, diagnostics, <50 ms warm close, true-size routing, native full-body creation, keyboard loading, and containment matching.

## v4.5.1 — 2026-07-14

- **Journal-safe record-preview toggle:** `_bridgeCreateEmbed` now detects the exact synthetic record-preview key before resolving the host record, so an open preview on a journal page collapses instead of falling through to the already-open no-op path.
- **Complete, truthful collapse:** The close path resolves the cached/live host line without depending on `data.getRecord(S-…)`, verifies preview metadata is cleared, removes the shell/card/crumb registries, cancels pending host-arrival retries, and returns `false` as the resulting collapsed bridge state.
- **Regression coverage:** A synthetic-journal host test exercises open → close → timer flush → reopen while `data.getRecord(journalGuid)` returns `null`.
- **Verification:** 114 deterministic Node tests in the main plugin contract; 592 tests across all suites, including the journal record-preview bridge lifecycle regression.

## v4.5.0 — 2026-07-14

- **macOS alias shortcut:** The picker recognizes physical `KeyA` for ⌥A (with `a`/`A`/`å`/`Å` fallback), and a visible `⌥A alias · ⇥ drill · ↵ insert` row makes aliasing discoverable.
- **Record-preview toggling:** Count badges now detect and collapse persisted record-property previews as well as native transclusions and windowed previews, clearing preview metadata, DOM, and card state through both inline and popover routes.
- **Fast Cmd+Up:** Every plugin-preview collapse path uses cached/universe line identity and avoids whole-page `getLineItems()` reads and confirmation prompts, including when the caret is inside an embed.
- **Cmd+Down property cards:** Normal reference expansion once again reaches the record-preview/property-card path; windowed show-more handling is limited to key events originating inside an already-open windowed preview.
- **Instant badge shells:** Both floating and inline linked-reference routes attach their loading shells before yielding to asynchronous query/context filling, with identity and generation guards against stale fills.
- **Fast `((` picker:** Line search now shares prefix candidates and normalized text caching, publishes a bounded first slice, and continues the 50k-line scan asynchronously behind the session token.
- **Verification:** 114 deterministic Node tests in the main plugin contract; 591 tests across all suites, including record-preview routing, keyboard regressions, async paint ordering, and a 50k-line `((` latency benchmark.

## v4.4.0 — 2026-07-14

- **A2 — fast close:** New `_collapseEmbedFast(hostLineGuid, targetGuid)` resolves the embed line via `g_universe.itemsByGuid` + the plugin's own `_cards` map — never `getLineItems()` on the whole host page. For plugin-created embeds (`refx_embed` prop) the confirm dialog is skipped entirely (plugin chrome, no data loss). Close time drops from ~30s (O(page lines) `getLineItems`) to <50ms. Both `_collapseAtCaret` (Cmd+Up) and A1 route through this path.
- **A1 — count-badge / popover collapse-when-open:** `_routeBadgeClick` and `openRefPopover` now check `_hasEmbedOpen(hostLineGuid, targetGuid)` (O(open-embeds) sync scan of `_cards` + `g_universe` parent chain) before routing. If an embed for the target is already open under the host line, `_collapseEmbedFast` collapses it and toasts "Embed collapsed". In the popover, per-row actions swap from "Embed here ⤵" to "Collapse embed ⤴" whenever `_hasEmbedOpen` returns a match. New `_hasEmbedOpen` also detects windowed (Tier B) previews via DOM scan.
- **A3 — windowed huge targets + keyboard load + no flicker:** `_LARGE_TRANSCLUSION_THRESHOLD` lowered 300→100 (100 lines ≈ routine page limit; large journals/research pages always get the windowed path which opens and closes in <50ms). Windowed preview is now keyboard-first: the shell is `tabindex="-1"` and focused on open; Cmd+Down inside it triggers show-more or open-full without mouse. Property card flicker fixed: new inserts park with `visibility:hidden`, then `_alignCardToBody` runs align+color-copy in ONE rAF pass and reveals (no unaligned frame ever paints).
- **A4 — popover open latency:** Generation counter `_popoverGen` added; post-query guard checks both `_popoverEl !== pop` (existing) AND `_popoverGen !== myGen` so a fast re-click/close cancels stale row fills. Popover shell + "Loading references…" are already inserted synchronously before the `await searchByQuery`, so first paint is instant (no change needed there).
- **B1 — Tab always drills:** Alias-offer branch removed from the Tab handler (`_linkKey`). Tab unconditionally drills into children (`_r5DrillInto`) when a drillable row exists. Alias creation moved to **Alt+A (⌥A)**: highlight any result → ⌥A → `_openAliasPromptInPicker` inserts a small inline `<input>` pre-filled with the current query text (fully editable) → Enter writes the alias via the shipped `_aliasAdd`/`_lineAliasAdd` AND inserts a ref titled with the alias; Esc cancels back to the picker. No new alias store — reuses existing `_aliasAdd` machinery.
- **B2 — keyboard scroll:** `_moveLinkSelection` calls `selectedRow.scrollIntoView({block:'nearest'})` after every re-render, matching the existing pattern at lines ~4253/6880. Keyboard highlight no longer scrolls off-screen past the 300px `.refalias-results` fold.
- **Verification:** 110 deterministic Node tests in the main plugin contract. bench-picker.test.cjs updated to assert threshold=100. All existing suites green.

## v4.3.2 — 2026-07-14
Badge-click collapse now routes through the _bridgeCreateEmbed toggle — the direct getRecord(rguid) resolution failed on journal pages (synthetic guids). Live-verified.

## v4.3.1 — 2026-07-14
Live-build fix: the transclusion badge renders as .block-nstype-button (not .lineitem-transcludes) — badge-click collapse selector extended to both. Verified live.

## v4.3.0 — 2026-07-14

- **Enter creates children inside inline transclusions (A1):** The WB Enter workaround (v3.52.0) is generalized from Workbench-only to ALL `.transclusion-container-div` elements in the document. Plain Enter inside any plugin-created embed or user-authored native transclusion creates a line directly on the SOURCE record via the data API: caret on the transcluded root → first-child (`createLineItem(root, null, "text")`); caret on a descendant → sibling-after (existing correct behavior). Focus retry loop falls back to a document-wide `[data-guid]` query if the container is disconnected. Kill-switch: localStorage flag `refx_transclusion_enter` (default on; `0` = off) + palette command "RefX: Toggle transclusion Enter handling". All existing guards (modifier keys, modal, link, cardEditing, cardNav) are preserved. The handler remains in `window.__refxKeyHandlers` for hot-reload singleton disposal.
- **Badge-click collapse for plugin embeds (A2):** Clicking the Thymer native transclusion badge (`.lineitem-transcludes`) on a plugin-created embed (`refx_embed: 1` in g_universe state props) collapses it via `_deleteEmbedLine` + "Embed collapsed" toast. Capture-phase `pointerdown`+`click` interceptors follow the rule-94 badge pattern (cheap `closest()` reject, `stopImmediatePropagation` on match, `preventDefault` on click only). User-authored native transclusions (no `refx_embed` prop) fall through untouched. Handlers stashed as `window.__refxEmbedBadgeClick` / `__refxEmbedBadgePress` and swept by `_counterDispose` + `_killStaleObservers`. Routing audit: all "Embed here" action entry points route through `_bridgeCreateEmbed` (which already handles the toggle/collapse); no bypass paths found.
- **Verification:** 101 deterministic Node tests in the main plugin contract. New suite test/transclusion-enter.test.cjs (21 tests covering Enter-on-root/descendant, modifier/modal guards, kill-switch, WB backward-compatibility, badge-click collapse, native-transclusion guard, routing audit). All tests green.

## v4.2.0 — 2026-07-14

- **Picker latency — incremental narrowing:** `_runLinkSearch` now stores the candidate set (guids + metadata) that passed text scoring in the previous registry scan into `link.scanCandidates`. On subsequent keystrokes where the new query extends the previous query (prefix extension, same filter set), the full O(50k) `g_universe` scan is skipped — only the O(candidates) set from the last scan is re-scored with the narrower plan. Full rescan on any non-prefix edit, filter change, or new picker session. Before: every prefix keystroke = full 50k scan ≈ 110ms. After: prefix extension keystroke ≈ 4ms (O(candidates) ≈ 30× faster). First keystroke is unchanged (still the one full scan needed to populate candidates).
- **Picker latency — alias key session cache:** `_searchKey(alias.text)` (NFKD normalisation + 4 regex passes) is now memoised into `link.aliasKeyCache` keyed by lineGuid+aliasText. Previously recomputed on every alias × every keystroke. Also caches `currentText` search keys used in composed-alias scoring.
- **Transclusion containment — Tier A (always-on):** CSS `content-visibility: auto; contain-intrinsic-size: auto 480px` is injected on `.transclusion-container-div` when `body.refx-cv-transclusions` is present (default ON). Off-screen transcluded subtrees skip layout and paint, making fold/unfold over large transclusions cheap. Palette command "RefX: Toggle transclusion containment" toggles the body class and shows a confirmation toast. Caret exclusion: the `:has(.flowythymer-thread-target)` and `:has(.listitem-with-caret)` rules restore `content-visibility: visible` so typing inside a transclusion always has correct geometry. No mutation of user-authored documents.
- **Transclusion containment — Tier B (threshold-gated, plugin surfaces only):** when the plugin's own `_expandRef` (line refs via Cmd+Down, ⤵ menu, palette) is about to create a native transclusion and the target's loaded record exceeds 300 lines (`_LARGE_TRANSCLUSION_THRESHOLD`), it mounts a windowed read-only DOM preview instead: first 100 lines + "Show more" (appends 100 at a time, no re-render) + "Open record ↗" jump. Tier B NEVER intercepts user-authored native transclusions in documents — only the plugin's own expand code path. Fallback: if the DOM is not ready when Tier B fires, normal native transclusion proceeds.
- **Verification:** 93 deterministic Node tests in the main plugin contract, plus 7 bench tests (bench-10k.test.cjs), all green. New tests in test/bench-picker.test.cjs cover picker prefix-narrowing, alias key caching, Tier A CSS/kill-switch/caret-exclusion, and Tier B threshold routing and windowed pagination (18 tests).

## v4.1.0 — 2026-07-14

- **`broker.edges()` sorted-list cache:** sort and filter fire once per `(revision, filter)` pair; subsequent pages and per-keystroke calls at the same revision are O(1) array slices. Before: 200-page full pagination = 996ms; after = 10ms (99× faster). Before: 100 per-keystroke `edges()` calls at 10k edges = 392ms; after = 8ms (49× faster, 0.08ms/call).
- **Binary search cursor seek:** upgraded from O(n) linear scan to O(log n) binary search for cursor position in the sorted array. Eliminates repeated full-scan on every page boundary.
- **Pre-keyed sort:** the one-time sort inside each cache-miss path now pre-computes sort keys (one 5-element array per edge) and sorts keyed pairs, eliminating the 2×N array allocations per comparison that `_compareEdges` previously produced across ~130k comparisons for 10k edges.
- Cache is cleared on every `bumpRevision()` — correctness is fully maintained, stale data is structurally impossible.
- Adds `bench-10k.test.cjs` (7 tests) covering first-page latency, full pagination, `inEdges()`, sort cost, warm registry scan, per-keystroke cost, and facet snapshot at 10k-edge scale. All thresholds are 4× measured targets.
- **Verification:** 93 deterministic Node tests in the main plugin contract; 527 total across all test files (520 pre-existing + 7 new bench tests in bench-10k.test.cjs), all green.

## v4.0.6 — 2026-07-14

- Reference-surface hydration now enumerates native record handles once, seeds the complete record-identity set, and only then classifies relation-property targets. This removes hundreds of synchronous `getRecord()` bridge probes from cold startup without adding a second scanner or database.
- Startup no longer calls `getLineItems(false)` for every workspace record. Historical line edges hydrate through cached, single-flight `ensureTarget()` / `ensureSource()` calls only when a consumer opens that exact target or source; snapshots and pages remain explicitly partial until that bounded scope has a positive completeness receipt.
- Metadata enumeration remains cancelable and cooperatively sliced; hot-path target classification remains synchronous and O(1).
- **Verification:** 93 deterministic Node tests in the main plugin contract, plus the fleet performance guards covering pre-seeded hydration and zero startup alias tax.

## v4.0.5 — 2026-07-14

- Cold native backreference stubs now trigger one bounded exact `@linkto` enrichment request for the result page. This removes the old dependency on the 20-source context-hydration cap without introducing per-result body reads.
- Exact-search results with no authored text render `(empty reference line)`; failed cold enrichment renders `(source line unavailable)` instead of a permanent empty/loading cell.
- **Verification:** 93 deterministic Node tests in the main plugin contract, including bounded cold enrichment, failed-index fallback, and frozen SDK handles.

## v4.0.4 — 2026-07-14

- Fixed keyboard entry into persisted lightweight record previews by resolving the exact host-line/record preview key before searching native transclusions.
- Arrow navigation now reaches **Open record** and **Load full body**, and both actions are explicit accessible tab stops with descriptive labels.
- Fixed intermittently blank linked-reference rows: cold native backreference stubs now hydrate their exact authored source text from the source tree already loaded for parent/sibling context.
- **Verification:** 90 deterministic Node tests, including exact-source preview-key isolation and cold-row text hydration.

## v4.0.3 — 2026-07-13

- Record/page references now expand into a persisted lightweight preview with editable title, collection, properties, aliases, and keyboard navigation. This avoids mounting an unbounded record outline during an ordinary shortcut.
- Added explicit **Open record** and **Load full body** actions. The latter is the only preview path that creates the native full record transclusion; line references remain native transclusions by default.
- Removed the surviving target `getLineItems()` call from in-place property-card refreshes, including the immediate post-render refresh.
- Added reload/hot-reload rehydration, exact-source collapse, safe preview-to-native rollback, and performance regression guards.

## v4.0.2 — 2026-07-13

- Removed the whole-target-body read that Cmd/Ctrl+Down expansion used only to detect an empty body.
- Removed broad active-page rediscovery from arbitrary `record.updated` events; exact tracked cards still refresh in place and navigation/focus still performs additive adoption.
- Scoped the document-wide card/decorator observer to mutations that touch a managed line, title row, or query embed. Ordinary mutations in a newly rendered transclusion no longer trigger a second reference-chip walk.
- Deferred initial property-card alignment to the next frame and reduced folded-host activation to one native click.

## v4.0.1 — 2026-07-13

- Learned-alias analysis now runs only while a record or line alias manager is open, removing an invisible full-edge pass from startup.
- Cold reference enrichment and learned-alias aggregation yield in bounded slices so large event bursts cannot form editor-blocking long tasks.

## v4.0.0 — 2026-07-13

**Durable aliases for stable line GUIDs**

- Added the synced `RefX Line Alias Registry`, separate from record aliases and per-reference display titles. It supports multiple normalized aliases per line, legal collisions, per-line verified write queues, compaction, a 10,000-aliased-line cap, and default exclusion of deleted targets.
- Added payload-first lifecycle maintenance for line edits, moves, deletes, undeletes, and creates. Aliases remain attached to GUID identity across text/owner changes; deleted lines retain diagnostic tombstones. Hot reload disposes timers, queues, subscribers, and owned globals.
- Extended Reference Surface v1 additively with `supportsLineAliases` and synchronous `lineAliases.get/resolve/all/subscribe`; `resolveTarget(lineGuid)` now exposes current text/status/aliases. `window.__refx.lineAliases` adds `add/remove/rename/refresh/status` writes.
- Extended `((` with synchronous line-alias rows, collision preservation, a restrictive/composable `alias:` filter, real-GUID insertion, and explicit Tab-to-create. `[[` remains record-only and record/line namespaces never collide.
- Added `RefX: Aliases for this line…`, the line-reference menu entry, non-automatic display-title promotion, line-scoped dismissal memory, three-distinct-edge learned suggestions, and guarded preview/apply/receipt/undo after a line-alias rename.
- Added the frozen `LineAliasSurfaceV1` contract, LC1-LC14 roadmap, SDK-faithful registry fixtures, 10k performance evidence, and 17 focused line-alias tests. 502 deterministic tests total.

## v3.92.0 — 2026-07-13

**A6: Alias health, maintenance, and export**

- Added an idle, debounced learning pass over the immutable Reference Surface ref-edge index. It counts authored display titles per target, requires at least three distinct edge IDs, excludes canonical titles/current aliases/dismissals, and keeps exactly one best suggestion per record.
- Bound learning to both RefX alias generation and broker generation/revision. A partial or changing snapshot is discarded without replacing the last stable suggestions; hot reload cancels pending timer and idle work.
- Mounted the suggestion in the real aliases manager as `Frequently used: “text” — add as alias?`. Opening or learning is read-only; only the explicit **Add** action enters the existing verified alias write queue.
- Added the complete RefX alias vocabulary to R10's optional properties block while suppressing duplicate native `Aliases` rows.
- Extended the Datacore adapter contract for `Aliases contains X`, synced-registry fallback coverage, Omni collision preservation, synchronous reads, and bridge-owned writes.
- Added 5 focused A6 tests for threshold/ranking, stale revision discard, unload cancellation, real modal click gating, and R10 export. 485 total tests.

## v3.91.0 — 2026-07-13

**A5: Alias-preserving display and reversible rename propagation**

- Taught managed live-title refresh that every current record alias is user-authored vocabulary. Record renames still update managed/non-aliased titles, while alias-titled refs keep their GUID and display text.
- Extended the real alias-management rename path with an explicit second-step preview. The preview uses the existing Reference Surface target index, groups multiple matching refs into one line write, lists affected source records, and labels partial broker state truthfully. Renaming the alias itself does not mutate any reference.
- Added serialized preview/apply/undo. Apply rereads each source, refuses a changed or actively edited line, rewrites only matching native ref payloads, preserves rich segments and all payload fields including `viewId`, and records per-line before/after hashes.
- Added a bounded per-workspace receipt store (20 operations), with the newest pending recovery exposed again whenever the aliases manager opens. Undo is idempotent, restores only when the current line still matches the applied hash, retains partially blocked receipts for retry, and never claims SDK-level atomicity.
- Added 7 A5 tests for the rename matrix, payload fidelity, deduped preview/apply/receipt/undo, stale apply, stale undo, receipt bounds, and the real mounted propagation dialog; extended the existing A2 mounted modal test to prove the offer is reached only after a successful rename.

## v3.90.0 — 2026-07-13

**A3: Alias-aware picker, filtering, and learned vocabulary**

- Extended the `[[` record picker with synchronous alias-index matching using the same separator-insensitive identifier normalization as title search. Alias rows display `Alias ↳ Real Title`, retain the real record GUID as identity, and preserve the alias as the inserted ref title.
- Kept exact alias matches in the exact-title tier and demoted prefix/fuzzy alias matches one semantic tier below equivalent title matches. Target frecency and per-(alias→record) use counts affect ordering only; they never remove a result.
- Restored `alias:` as a restrictive, composable structured filter. `alias:` search reads the complete hydrated in-memory index and adds zero remote awaits; ambiguous aliases return every labeled target.
- Added one-shot learned-alias suggestions after three verified non-alias query outcomes resolve to the same record. Save is explicit; dismissal and prior offers are remembered in a bounded per-device store.
- Documented the guarded `window.__refx.aliases` and Reference Surface alias APIs for Datacore consumers.
- Added 6 A3 production-path tests covering rendering and `{guid,title}` insertion, ranking tiers, `alias:` plus `in:` composition, ambiguity, separator normalization, learning/dismissal, per-alias use, and the await-free local path.

## v3.89.0 — 2026-07-13

**A2: Alias creation and management UX**

- Added the keyboard-complete `RefX: Aliases for this record…` modal from the palette, record-reference menu, and embedded-record property card. Both storage tiers are labeled; add, remove, and queue-atomic rename remain inside the A1 write path.
- Added the explicit `Tab⇥ add “query” as alias of “Result”` row under a highlighted fuzzy `[[` result. Tab saves the record alias first and then inserts a real GUID reference with the typed query as its display title; Enter retains its existing insert/create behavior.
- Extended the per-reference display-alias popover with a non-automatic `Also save … as a record alias?` offer. Dismissed record/text pairs are kept in a bounded per-device set and never nag again.
- Added default-on `custom.aliasChips` title decorators for active records. They are absolutely positioned, write no document lines, and reuse the same cached DOM node through pre-paint observer reinsertion without layout reads.
- Added 5 A2 production-path tests covering the real `onLoad` command, modal keyboard CRUD, Tab write-before-insert shape, picker action rendering, promotion dismissal, and zero-layout cached decorator reinsertion. The exact pre-version suite passed 467/467.

## v3.88.0 — 2026-07-13

**A1: Global alias data layer, synced fallback, and broker/bridge surface**

- Added frozen `AliasSetV1` in-memory indexes, hydrated alongside the existing time-sliced record-name index. Matching reuses RefX's identifier-aware title scorer, stays synchronous, and preserves every ambiguous target.
- Adopted an exact, multi-value text property named `Aliases` using `prop.values()` reads and label-addressed array writes. Property values win over registry values.
- Added the lazy `RefX Alias Registry` native-record fallback for unprovisioned collections. Registry lines use the real SDK `createLineItem(null, null, "ulist", segments, null)` shape, a truthful 2,000-record cap, and deterministic duplicate resolution.
- Added queue-serialized `add`, `remove`, and atomic `rename` writes with verification/retry convergence. Two clients adding different aliases merge instead of last-write-wins. A registry entry migrates only after the native property rereads successfully, then its verified lines are deleted.
- Extended Reference Surface v1 additively (`apiVersion` remains `1`) with `supportsAliases`, `aliases.get/resolve/all/subscribe`, broker revision coupling, and `resolveTarget(...).aliases`. `window.__refx.aliases` exposes the same reads plus queued writes.
- Added payload-first `record.updated` maintenance, debounced enrichment, focus-time schema self-healing, hot-reload singleton disposal, and `RefX: Provision Aliases property…`, which copies the MCP setup command and lists missing/incompatible collections without pretending plugins can add stored fields.
- Added 16 A1 tests covering fixture conformance, normalization, property and registry tiers, verified migration, two-client property/registry convergence, collision policy, broker revision/target fields, payload-first events, schema adoption, cap truthfulness, 10k synchronous lookups, and the production `onLoad` mount path.

## v3.87.0 — 2026-07-12

**R10: Resolved Markdown Export — bounded walk, cycle/truncation markers, golden fixtures**

### R10 — Export entry points

Palette command `RefX: Export as Markdown…` opens a modal scoped to the active record. The modal provides five checkboxes/selects for export options (preserve refs as links, expand depth 0–3, include properties, include source breadcrumbs, include task state), a live preview pane, Copy to clipboard, and Save to file via a browser Blob download. Options are persisted per-device in localStorage (`refx_r10_opts_v1`).

### R10 — Walk engine

`_r10ExportMarkdown(scope, opts)` is a pure synchronous function producing byte-identical output for the same input. Scope kinds: `record` (full record with properties + line tree), `line` (one line), `subtree` (selected line subtrees from R4), `view` (saved R6 reference view targets). Walk is GUID-keyed with a shared `visited` Set covering both records (`rec:<guid>`) and lines (`line:<guid>`). Cycles emit an explicit `<!-- cycle: name (guid) — not re-expanded -->` marker. Node budget (default 5000) and byte budget (default 512 KB) are explicit constants; exhaustion emits `<!-- truncated: ... -->` — never silent omission.

### R10 — Segment fidelity

`_r10SegsToMd(segs, ctx, refDepth)` handles all live segment types: `text` (literal), `ref` (preserved as `[alias](thymer-ref://guid)` when `preserveRefs=true`, or resolved to display text / inline-expanded at depth N when false), `datetime` (`formatted` field if present, else `YYYY-MM-DD`), `external`/`linkobj` (`[title](url)`), `code` (backtick inline). Line types: `heading` (`#`–`######` from `heading_size`), `task` (`- [ ]`/`- [x]`/`- [S]` with `includeTaskState`), `olist` (`1.`), `code` (fenced block), `br`/`empty` (blank line), all others (`- `).

### R10 — Tests (50 in test/r10-export.test.cjs)

Version guards × 4 (manifest/header/runtime/changelog). Exporter: golden nested refs (preserve + resolve modes), alias preserved, external link, datetime formatted/raw, code block, heading levels, task done/undone/non-binary status, properties included/excluded, breadcrumbs on/off, depth 0/1/2 expansion differences, cycle marker emitted (no hang), missing target `[unresolved: guid]` marker, node budget truncation marker, byte budget truncation marker, visited set prevents re-expansion, byte-identical repeat runs (strict equality), record scope, subtree scope, view scope fallback, line budget exhaust mid-walk, heading_size prop fallback, empty record export, empty segments line, string-encoded ref guid, olist type, br/empty type.

## v3.86.1 — 2026-07-12

**R7/R8 review fixes: document-neutral edit-live, render-path wiring, partial-snapshot labeling, facet correctness, performance, test quality**

### R7R8-2 — Edit-live is document-neutral (critical)

`_r8EditLive` no longer calls `_bridgeCreateEmbed`. The old implementation created a real persisted transclusion line item in the document on every open; a crashed close would strand it permanently, and the toggle branch in `_bridgeCreateEmbed` would delete pre-existing embeds on re-open. Thymer's SDK provides no injectable caret-ready editor primitive for an arbitrary container. The new implementation shows a lightweight read-only preview strip (segment text rendered via `_renderRefLineText`) plus an "Open to edit ↗" jump button that calls `_bridgeJump` — same navigation path as the existing `↗` action, zero document mutation.

### R7R8-1 — Wire facet/claim/edit-live into the real render path (critical)

`entry.r7FacetBarEl` was read in `_renderR7FacetBar` but never assigned. `_r7FacetSnapshot`, `_renderR7FacetBar`, `_renderClaimRowsForTarget`, and `_r8AssertSingleEditor` had zero production callers — the real render path `_fillInlineRefs` never mounted them. Fixes: `_buildInlineRefsSection` now creates and appends `facetBar` (`refx-r7-facet-bar`) and stores it as `entry.r7FacetBarEl`. `_fillInlineRefs` populates the facet bar after the async fill and appends claim rows (`_renderClaimRowsForTarget`) after the footer sections. The `actionsFor` list in all three render sites now includes the `✎⊞` edit-live action.

### R7R8-3 — Remote-update invalidation (major)

`_r8SettleRerender` re-reads current line state from `g_universe.itemsByGuid` via `_segmentsFromState` instead of the frozen `line` closure captured at open time. `_r8EditLive` registers the open editor's lineGuid in `this._r8OpenEditors` (plugin-level Map); `handleLineItemUpdated` checks this map and sets `_needsSettle` on the entry's active editor record. The close path deregisters from `_r8OpenEditors` via `entry._r8ActiveEditor.deregister()`.

### R7R8-4 — Partial-snapshot labeling (major)

`_r7FacetSnapshot` reads `broker.snapshot().status`; when not `'complete'`, sets `partial: true` on the returned snapshot. `_renderR7FacetBar` checks `snapshot.partial` and labels chip counts as `≥N` with a tooltip noting broker is still loading.

### R7R8-5 — sourceProperty facet chip count correctness (major)

`_r7FacetSnapshot` excluded lineGuid-less edges from `propCounts`. Property/annotation edges with `null lineGuid` are counted in the snapshot but the row filter matches only by `lineGuid`, making chip counts exceed filtered-row populations. Now only edges with a `lineGuid` contribute to the `sourceProperty` dimension.

### R7R8-6 — O(rows + edges) facet filter (major)

`_r7ApplyFacetFilter` previously called `broker.inEdges(targetGuid)` inside the per-row filter predicate (O(rows × edges)). Now hoists one `inEdges()` call before the loop and builds a `lineGuid → edge` Map for O(1) per-row lookup.

### R7R8-7 — Real render-path test (minor)

Replaced the tautological `50-rows-one-editor` test (which stubbed the very `querySelectorAll` it asserted) with a test that tracks real `.refx-r8-live` div creation via `document.createElement` instrumentation, calls `_r8EditLive` on row 0 of 50, and asserts `_r8AssertSingleEditor` returns 1. Added a behavioral same-title-distinct test that monkey-patches `_appendUnlinkedSection` to assert `_renderClaimRowsForTarget` never calls it.

### R7R8-8 — filterExpr AND flat-filter non-index predicates (minor)

`broker.edges()`: when both `filterExpr` and flat `filter` are present, the flat filter was used only for index lookups (targetGuid/sourceRecord) and its additional predicates (kinds, authored, …) were silently dropped. Now ANDs both: `_matchFilterExprV1(e, filterExpr) && _edgeMatchesFilter(e, filter)`.

### R7R8-9 — Skip scroll-anchor restore on 'replaced' (minor)

Already handled correctly in the R7R8-2 `close()` rewrite: scroll-anchor restore is guarded by `reason !== 'replaced'` throughout.

---

## v3.86.0 — 2026-07-12

**R7/R8: snapshot facets, FilterExpressionV1, claim rows, edit-live rows**

### R7 — Rich facets and typed claim-edge rendering

- **Snapshot facets (R7.1):** `_r7FacetSnapshot(targetGuid)` aggregates facet counts from the broker's authoritative `inEdges()` snapshot for the target. Facet dimensions: collection, source property, edge kind, authored/derived, task state, Journal/date range. Counts equal the full broker set; applying a facet filters already-loaded rows client-side without re-querying. `_renderR7FacetBar(entry, snapshot, targetGuid)` renders the chip bar.
- **FilterExpressionV1 (R7.2):** Nested AND/OR over FilterV1 leaf predicates. `filterExpr` param accepted by `broker.edges()`/`broker.occurrences()` alongside flat `filter` (unchanged, zero breakage). `_normalizeFilterExprV1(expr)` deterministic canonical JSON. `_matchFilterExprV1(edge, expr)` evaluates trees. Cursors bind to normalized expression. `broker.supportsFilterExpr = true`. `apiVersion` stays 1.
- **Claim edges as first-class typed rows (R7.3):** `_renderClaimRow(container, edge, opts)` renders predicate name, authored/derived badge, provenance (qualifiers/confidence/evidence). Row navigable to source. Authored/derived facet toggle excludes derived without losing authored.
- **Same-title discovery distinct (R7.4):** Unlinked mentions stay in `_appendUnlinkedSection`. Claim typed rows never appear there.
- **Datacore alignment (R7.5):** `docs/DATACORE-ADAPTER.md` updated with canonical edge-kind names and FilterExpressionV1 shape.

### R8 — One-row native edit on demand

- **Edit live action (R8.1):** `_r8EditLive(entry, row, line, opts)` replaces chosen row with native transclusion via `_bridgeCreateEmbed`. Scroll anchor and filter state preserved on open/close.
- **One active editor per view (R8.2):** `entry._r8ActiveEditor` tracks current editor; opening second row closes first. No measured-cap escalation.
- **Remote updates (R8.3):** Remote `lineitem.updated` on open editor does not yank it. On close, `_r8SettleRerender` rerenders lightweight row from current data (generation-guarded via `entry._r8Gen`).
- **50-rows-1-editor structural invariant (R8.4):** `_r8AssertSingleEditor(container)` verified in tests.

54 new tests in `test/r7-r8.test.cjs`.

## v3.85.1 — 2026-07-12

**R6 review fixes: SDK-faithful persistence, write serialization, no last-writer-wins reads, migration guard**

- **F1 (critical):** `_r6AppendRevision` was calling `rec.createLineItem(text, null, 'ulist', null, null)` — passing the revision JSON as the `parentItem` argument (real SDK signature is `createLineItem(parent, after, type, segments, props)`). No revision was ever written to the real SDK; `_r6ReadRevisions` found nothing; the entire R6 feature was dead in production. Fixed: `createLineItem(null, null, 'ulist', [{type:'text', text}], null)`. `_r6ReadRevisions` fixed to extract text by joining `text`-type segments from `li.segments` (real SDK field) instead of the nonexistent `li.text`. Test mock corrected to the real `(parent, after, type, segments, props)` signature with `segments`-based line items.
- **F2 (critical):** `_r6AppendRevision` unconditionally deleted every line not in the snapshot on every save (including concurrent peers' freshly-written entries). Fixed: delete pass only runs when `currentLines.length > _R6_REVISION_CAP`; lines are re-read at delete time so concurrent writes are visible. Writes serialized per `viewGuid` through `this._r6WriteQueues` (chained promise queue).
- **F3 (critical):** Pin migration set `refx_r6_pin_mig_v1=done` permanently when `_pins` was empty, even though `_pins` is only populated after the first `_onNavigated` walk — users with pins never migrated. Fixed: empty `_pins` with `_r6PinWalkDone=false` → defer (reset session guard, retry on next load); done-flag only set when every found target is verifiably saved.
- **F4 (major):** `list()` and `get()` used last-writer-wins (`heads.reduce(newest)`) when `heads.length > 1`. Fixed: return `{conflict:true, viewGuid, config:null}` sentinel — consumers must call `heads()`/`resolveConflict()` for explicit resolution.
- **F5 (major):** `save()` without `parentRevisionId` created a parentless root revision on every call, permanently forking the head and growing the log unboundedly. Fixed: when `parentRevisionId` is omitted and exactly one head exists, default parent to that head, maintaining a linear chain. Parentless roots only for genuinely new views (zero existing revisions).
- **F6:** No code change — Backreferences save/open UI shipped in `thymer-backreferences` v0.25.0 commit `0fe8446`. Corrected handoff and CHANGELOG to note the split.
- **F7 (minor):** `onUnload` disposed `window.__refxSavedViews` without checking if it belonged to this instance. Fixed: only dispose when `window.__refxSavedViews === window.__refx.referenceViews` (this instance's api ref).
- **F8 (minor):** `revisionId` lacked client identity — cross-client same-millisecond saves could collide on the head-derivation hash. Fixed: append `_r6ClientId().slice(-6)` to every `revisionId` (save and merge paths).
- **F9 (minor):** Compaction sliced non-heads by array position (insertion order), which is not reliable recency when interleaved saves reorder entries. Fixed: sort non-heads by `savedAt` descending before slicing. Abort any drop that changes the derived head set (protects fork-point ancestors while >1 head exists).
- **F10 (minor):** `_r6ResolveViewRecord` was dead code (never called after `_r6FindViewRecord` superseded it). Deleted.
- **Tests:** 15 new regression tests added (real-signature round-trip, concurrent save survival, under-cap no-delete, parent-defaulting, LWW removed, migration-defer-on-empty-walk, clientId in revisionId, compaction sort). 38 → 53 total in `test/r6-reference-views.test.cjs`. All suites pass (337 → 352 total).

## v3.85.0 — 2026-07-11

**R6: Synced Saved Reference Views**

- **ReferenceViewV1 schema** (`schemaVersion`, `viewGuid`, `name`, `targets`, `edgeKinds`, `filterExpression`, `sort`, `contextDepth`, `descendantMentions`, `displayMode`, `pageSize`, `inboxStateSync`) — normalised and validated on every save.
- **Native-record persistence** following the Workbench pattern: saved views are stored as records in the "Settings" or "Examples" collection via `PluginCollectionAPI.createRecord()`. One record per view (name = view name). `data.createNewRecord()` is never called. No localStorage for synced state.
- **Append-only revision log** (`ReferenceViewRevisionV1`): each record body accumulates revision entries as JSON line items. Fields: `revisionId` (configHash + timestamp), `parentRevisionIds`, `configHash` (djb2 of deterministic stable-JSON config), `fullConfig`, `authorClientId`, `savedAt`. Bounded to 50 revisions (compact older non-heads; heads are never dropped).
- **Head derivation**: current head(s) = revisions not referenced as any parent. One head = no conflict. Two heads from the same parent = explicit conflict exposed by `heads()` API.
- **Conflict model**: two concurrent saves from the same parent create two heads. Consumers show the last-saved head or surface the conflict. `resolveConflict()` appends a merge revision citing both parents — no last-writer-wins.
- **`window.__refx.referenceViews` API**: `list()`, `get(viewGuid)`, `save(config, parentRevisionId?)`, `heads(viewGuid)`, `resolveConflict(viewGuid, opts)`, `subscribe(cb)`, `_dispose()`. Generation-guarded, hot-reload-safe (`window.__refxSavedViews` singleton swept in `_killStaleObservers`).
- **Pin migration**: legacy target-only pins (`refx_pin` meta) migrate idempotently to view GUIDs. Each unique legacy pin target gets a derived saved view with a deterministic name (`Pin View:<guid[:12]>`). Migration runs once per client (localStorage `refx_r6_pin_mig_v1=done` flag). Re-running creates nothing new.
- **Per-device presentation prefs** stay in localStorage (`refx_r6_client_id`, `refx_r6_dev_prefs_*`); these are explicitly not synced.
- **Tests**: 40 tests in `test/r6-reference-views.test.cjs`.

## v3.84.1 — 2026-07-12

**R4 review fixes**

- **R4-1 (critical):** `_r4RegisterCommands` used the non-existent `ui.registerCommand({label,action})` and `ui.getOpenPanels()`. Both are silently swallowed by try/catch, making the palette command unreachable. Fixed to use `ui.addCommandPaletteCommand({label,icon,onSelected})` and `ui.getPanels()` (the real SDK surface).
- **R4-2 (major):** `_r4CopyAsRefs` embedded the line title in the clipboard text (`thymer-ref://<guid> <title>`), breaking the paste round-trip. The existing `_handlePaste` and `_pasteRef` parsers use `/^thymer-ref:\/\/([A-Za-z0-9]+)\s*$/` — whole-line anchored, no title. Fixed to emit bare `thymer-ref://<guid>` per line; titles stashed in `window.__refxCopiedRef` (single) or `.multi` array (multi).
- **R4-3 (major):** `_r4NormalizeSelection` only walked one ancestor level (unconditional `break` after checking `parentGuid`), so a grandparent+grandchild selection incorrectly listed both as roots. Fixed to build a `byGuid` map and walk the full ancestor chain. Also fixed `moveCopySort` plan to emit one step per normalized root (not per `selectedNodes`), preventing child steps that would rip children from already-moved parents.
- **R4-4 (major):** Preview `sourceGuids` accessed nonexistent `e.sourceGuid`; real broker edges have `source:{lineGuid,recordGuid,...}`. Fixed to `e.source?.lineGuid || e.source?.recordGuid`. Plan `impact.propertyEdges` and `.claims` were hardcoded 0; fixed to partition by `e.kind` from `_r4QueryInboundImpact`.
- **R4-5 (major):** The R4 panel keydown handler (`window.addEventListener('keydown', onKey, true)`) was outside the singleton disposal pattern. Hot-reload leaked the handler. Fixed: stash as `window.__refxR4PanelKey` / `window.__refxR4PanelEl`; `closePanel` nulls both; `_killStaleObservers` removes the handler and element; `onUnload` removes `_r4Cmd`.
- **R4-6 (minor):** Footer selection counter never updated — `patchedUpdateRowStyles` was created but never installed. Fixed to reassign `updateRowStyles` in place before wiring handlers.
- **R4-7 (minor):** Op buttons wired to `mousedown` only — keyboard Enter/Space on a focused button fires `click`, not `mousedown`. Fixed to `click`. Added Enter branch to `onKey`. Added `tabindex="-1"` to rows.
- **Verification:** 88 deterministic Node tests plus the Attributes broker contract tests; 7 new R4 regression tests (now 299 total across all suites).

## v3.84.0 — 2026-07-11

**R4: selection surface, op previews/plans, executor capability gating**

- **Selection surface:** Plugin-owned tree/picker panel (`_r4OpenSelectionPanel`) lists the active record's line tree with depth-preserving indentation, checkboxes, shift-click range select, select-subtree affordance (▸) on parent rows, and keyboard navigation (ArrowUp/Down/Space/Escape/Enter). The SDK has no editor multi-selection getter (R0-proven); this panel is the documented baseline. Feature flag: `refx_r4_ops` localStorage key (default ON).
- **Capability registry:** `_r4CapabilityRegistry` maps each operation to its executor requirement. `_r4CapabilityCheck(opName)` detects `window.__thymerOutlineRefactor` / `window.__thymerVersionLedger` at action time; absent executors return `{ enabled: false, reason: 'Requires Outline Refactor plugin — not installed' }`. Disabled actions render with an explanatory tooltip.
- **Enabled operation — copy as refs:** `_r4CopyAsRefs` builds a clipboard payload of `thymer-ref://<lineGuid> <title>` per selected line (the existing copy-ref format). Multi-line clipboard text, one URI per line.
- **Enabled operation — transclude subtree:** `_r4TranscludeSubtree` inserts a transclusion of the selected subtree root via the existing `_bridgeCreateEmbed` primitive. Enabled only for a single contiguous subtree (exactly one root + all descendants in the selection); otherwise disabled with reason.
- **Previews (side-effect-free, all ops):** `_r4BuildPreview` computes target collection, inbound-impact count/source list from the R1 broker `inEdges()` O(1) lookup (no body scans), and an undo plan description. Gated ops include `'plan only — executor not installed'` note.
- **Plan objects (OutlinePlanV1):** `_r4BuildPlan` emits the immutable plan shape from OUTLINE-REFACTOR-ROADMAP.md (`id`, `schemaVersion:1`, `workspaceGuid`, `operation`, `sourceRevision`, `selection.{roots,expandedGuids,order}`, `destination`, `guidPolicy`, `referencePolicy`, `steps[{id,kind,targetGuid,precondition,payload,compensation}]`, `impact.{inboundEdges,propertyEdges,claims,danglingRisk,cycles}`, `warnings`, `unsupported`, `estimatedWrites`). Plans stored in `_r4Plans` (last 8, in-memory only). A future Outline Refactor executor can consume these plans unchanged.
- **External blocker documented:** See `docs/handoffs/R4-HANDOFF.md`. `extractSubtree` → O3; `detachAsRichText` → O4; `moveCopySort` → O2; `undoCheckpoint` → O5/V4. Outline Refactor and Version Ledger plugins do not exist; no mutations implemented.
- **Palette command:** `Reference Extravaganza: Open line selection panel (R4)` registered when R4 is enabled.
- **Anti-patterns:** Zero mutations; zero `window.prompt`/`confirm`/`alert`; previews use broker O(1) `inEdges()` only (no body scans); no layout reads in observers.
- **Tests:** 37 checks in `test/r4-operations.test.cjs`. Full suite: 88 + 37 + 30 + 63 + 51 + 19 + 1 = 289 pass.

## v3.83.1 — 2026-07-11

**R5 review fixes**

- **F1 (critical): Ordinary words no longer hijack the exactGuid path.** `looksLikeGuid` in `_r5ParseFilters` now uses a strict Thymer GUID pattern (`^[0-9A-Z]{20,34}$` with at least one digit and one uppercase letter) instead of the broad 12-64 char heuristic. Words like `Retrospective`, `Brainstorming`, and compact identifiers like `EMP26-002-BHP` no longer route to exactGuid — they go through the normal search. The broad `looksLikeGuid` function is preserved for other callers (backref, ref-surface) which use it with test GUIDs that have underscores.
- **F1 (critical): No fabricated rows for unresolved GUIDs.** When `exactGuid` is set but neither `data.getRecord` nor the registry resolve the GUID, the old code fabricated a selectable row `{guid: query, text: query, score:9999}` that was immediately insertable, creating dangling refs. Now a non-selectable `_notFound` placeholder is shown instead; `_pickLink` refuses to pick it.
- **F2 (critical): Document/query desync in scoped mode fixed.** Printable keys in a drill-down scope are now `preventDefault`/`stopImmediatePropagation`'d (like synthetic mode) so the document text is frozen at `((rootQuery` after Tab. `_r5DrillInto` saves `link.docQuery` on first drill; `_abortLink` and `_pickLink` use `link.docQuery` (not `link.query`) for `_findBracketRange` in scoped mode.
- **F3 (major): in:collection filter now applies to registry pass.** `ensureColMap()` is awaited before `scanRegistry()` when `r5Filters.inCollection` is set; the built map is passed into `_r5FilterRow` via the `r5ColMap` closure variable. Previously the registry scan always passed `null` as the colMap, so the filter was silently ignored for all loaded content.
- **F4 (major): Unimplemented alias: filter removed from TOKEN_RE.** `alias:` was parsed into `filters.alias` but never read in `_r5FilterRow`, so `alias:foo bar` silently discarded `alias:foo` and searched only `bar`. Removed from `TOKEN_RE` so the full text stays searchable. Re-add when alias matching is implemented.
- **F5 (major): Crumb-bar click restores correct scope query.** Root chip now restores `stack[0].savedQuery` (the root-level query) instead of clearing to `''`. Chip `i` now restores `stack[i+1].savedQuery` (the query typed within scope i before drilling deeper) instead of `entry.savedQuery` (the parent's query).
- **F6 (major): Create row and create-on-Enter suppressed while scoped.** `appendCreateRow` returns `false` when `_r5ScopeStack.length > 0`; the Enter handler's create branch is also gated, preventing accidental top-level page creation from a scoped child query.
- **F7 (major): Date filters no longer drop remote rows.** `_r5FilterRow` now falls back to scanning `row.segments` (available from `consider()` for searchByQuery rows) when the g_universe registry has no entry. Rows with genuinely unknown dates pass through (previously `return false` silently excluded all remote content from date-filtered queries).
- **F8 (major): Scoped search resultsPreSliceCount set before slice.** Both the initial `_r5DrillInto` children load and the `_runLinkSearch` scoped path now set `resultsPreSliceCount` to the unsliced count, so the "showing top 8 — keep typing to narrow" hint fires in scoped mode. Initial drill also slices to 8 immediately (prevents 300-row mounts).
- **F11 (minor): Tab falls back to native when no drillable row.** Tab is only prevented/`_r5DrillInto`'d when a real drillable row is highlighted; otherwise it exits so native Tab (indent) works on an empty or all-create picker.
- **F12 (minor): Housekeeping.** `_exitLinkMode` now clears `_r5ScopeStack` (the doc-comment said "cleared on close" but it wasn't). `_r5ScopeChildren` accepts and populates a per-session `Map` cache on the `link` object to avoid redundant `getLineItems()` fetches on every debounced keystroke in the same scope. `ensureColMap` is pre-built before `scanRegistry` for `in:` queries (covers F3 above).

## v3.83.0 — 2026-07-11

**R5: hierarchical scoped picker — drill-down, structured filters, frecency, session tokens**

- **Drill-down (Tab):** Tab on a highlighted picker row drills into that record's line-item children (for record rows) or a line's sub-children (for line rows). The picker shows only the scope's children with a breadcrumb bar above the list. Backspace on an empty query pops the scope stack one level (restoring the saved query). Clicking a breadcrumb chip jumps to that exact scope level. The root "Pages"/"All" chip resets to the global search.
- **Structured filters:** Parsed from the query string before the free-text search plan. Supported: `in:<collection-name>` (quoted names supported: `in:"My Collection"`), `is:task`, `status:<todo|done>`, `kind:<record|line>`, `alias:<text>`, `before:<date>`, `after:<date>`. Filters compose with free text. The `in:` filter builds a collection→record map asynchronously (deferred until needed, guarded by the session token). Date values parsed via `DateTime.parseDateTimeString` when available, else ISO YYYY-MM-DD fallback.
- **Exact GUID lookup:** A query that is itself a GUID (satisfies `looksLikeGuid`) resolves that target directly without a free-text search — shows the matching record or line in the picker immediately.
- **Frecency ranking:** A small localStorage map (`refx_r5_frecency_v1`, bounded to 500 entries LRU) tracks `{uses, lastUsedAt}` per target GUID. On every pick, the GUID's frecency is bumped. The frecency boost [0, 120] is added to the semantic score — recency (80pt today, decays over 30 days) + log-scaled use count (up to 40pt). Frecency is a rank-only signal: a low-frecency match is never hidden.
- **Session token:** Each picker open advances `_r5SessionGen`. Every async callback (broker page arrivals, scope-children loads, collection-map builds) validates the session before committing results. This is in addition to the existing per-keystroke `link.token` debounce guard.
- **Breadcrumb bar:** A `div.refx-r5-crumb` is rendered inside `.refalias-linkbody` above the results list, hidden at root scope. When drilling into a scope, it shows "Pages > Scope Label" (or "All > …"), each chip clickable to jump back.
- **Footer hint:** "Drill Tab" added to the picker's footer hint row.
- **Backspace on empty query in scope:** Instead of exiting the picker, pops the scope stack (navigates back to parent). On root scope with empty query, exits as before.
- **Zero regression:** The root-level fast normalized search (`scanRegistry` + `searchPhase`) path is unchanged in structure and latency. Structured filters are evaluated in the existing `consider` closure without additional body scans. The existing 48-item bounded reservoir and 8-result display cap are preserved.

## v3.82.1 — 2026-07-11

**R2 review fixes: display-side pagination correctness**

- **F1 — partial-status title when capped:** `_fillInlineRefs` now appends `— showing first N, more may exist` to the section title whenever `items.length >= this._maxResults`, satisfying the reference-surface-v1.md consumer rule that requires a status indicator when results are not complete. Previously the title stated `↙ 250 Linked References` as if authoritative.
- **F2 — continuation groups inside linksContainer:** A dedicated `div.refx-inline-refs-links` container is now created inside `bodyEl` to hold all linked-reference groups and the Show-more button. Continuation pages from `appendNextPage` are appended into this container, so they always precede the property-refs / SDK / unlinked / deep-connections footer sections. Previously `_renderRefsGroups(entry.bodyEl, ...)` appended groups at the end of `bodyEl`, after the footers.
- **F3 — Show-more click does not delete property-overflow note:** The defensive `querySelector` inside `appendNextPage` is now scoped to `.refx-inline-refs-showmore` (the button class) instead of `.refx-inline-refs-more` (the shared base class). Previously clicking Show-more silently removed the `+N more property references` note when `propRecs.length > 50`, eliminating a truthfulness affordance.
- **F4 — chip re-render uses page model:** The chip-click re-render path now uses the same `chipPageSize = 30` + `appendChipPage` model as `_fillInlineRefs`, replacing the pre-R2 static `slice(0, 30)` + static `+N more — Shift+click` note. Toggling chips no longer permanently truncates the view without Show-more.
- **F5 — text filter applied to appended rows:** `appendNextPage` now calls `_applyInlineRefsFilter(entry)` at its end when `entry.filterEl` has an active query. Previously rows appended by Show-more ignored an active text filter until the user typed another character.
- **F6 — warm pass capped to PAGE_SIZE:** The warm (provisional) registry pass now renders only the first `WARM_PAGE_SIZE = 30` rows (matching the async pass's first page) to avoid a large transient DOM spike for heavily-referenced targets. The full warm count is still shown in the title (`(updating…)`), so the count is accurate even though only the first page is rendered.
- **F7 — capability ledger updated:** `R0-CAPABILITY-LEDGER.md` rows 32-33 now read `Keep + truthfulness affordance` with rationale, correcting the stale `Replace | R2 | Replace with cursor/page model` disposition that misstated the shipped state.
- **F8 — _cappedAt32 probes one past the cap:** The property probe loop now breaks at `out.length > 32` (not `>= 32`) so a record with exactly 32 properties does not falsely trip the `_cappedAt32` flag. The modal and propcard messages now report the actual rendered count (`${fields.length} of 32+`) rather than the hardcoded `32`.
- **F9 — picker hint only when > 8 candidates existed:** Both `_runLinkSearch` publish functions now store `link.resultsPreSliceCount = byResultGuid.size` (before the `.slice(0, 8)`) and the render checks `resultsPreSliceCount > 8` before appending the "showing top 8" hint. Previously the hint fired for a query with exactly 8 total matches, where the set is complete.
- **Regression tests:** 8 new tests in `test/r2-pagination.test.cjs` covering F1–F5, F8, F9. Total: 201 pass (88 plugin + 30 r2-pagination + 63 broker + 19 fixtures + 1 claims).

## v3.82.0 — 2026-07-12

**R2: cursor/page model for inline refs, related views, picker truthfulness**

- **Inline-ref warm pass (R2 item 1):** Removed the `slice(0, 30)` cap from the warm (provisional) pass in `_fillInlineRefs`. All in-memory registry hits are now shown immediately with an `(updating…)` title instead of silently truncating to 30. The warm count in the title always matches the number of rendered rows.
- **Inline-ref final render — Show more (R2 items 2, 3, 4, 5, 6):** The final render now uses a `PAGE_SIZE = 30` display-pagination model instead of a hard `maxItems = 30` truncation. The first page (up to 30 rows) renders immediately; a `+N more referencing lines — Show more` button appends the next 30 rows WITHOUT rebuilding existing rows (geometry-stable append below). Each continuation is guarded by `_r2FillId` (incremented per `_fillInlineRefs` call) so stale continuations from re-fills (filter/sort/target change) are dropped automatically. No re-query on append — all items are in memory from the authoritative `_queryRefLines` result. No transclusions mounted on append.
- **Type-ahead picker truthfulness (R2 item 2):** The `((`/`[[` picker shows "showing top 8 — keep typing to narrow" below results when exactly 8 candidates are displayed (the display cap). The 48-item bounded reservoir used during scanning is retained for latency reasons; only the truthfulness indication is new. The note is non-selectable (`aria-hidden`).
- **Card property fields truthfulness (R2 items 2, 6):** `_recCardFields` now sets `result._cappedAt32 = true` on the returned array when the 32-field probe cap was hit. `_buildPropCard` and the record editor modal render a muted "32 properties shown — open record for all" / "Showing 32 of this record's properties" note when the flag is set.
- **Stale continuation cancellation (R2 item 4):** A pending Show-more closure is invalidated (no-op) when `entry._r2FillId` changes, which happens on every `_fillInlineRefs` re-entry (any filter/sort/target/broker-revision change that triggers a re-fill). The entry-map identity check (`this._inlineRefs.get(key) === entry`) also guards against collapsed-and-reopened sections.
- **Verification:** 88 pass (plugin.test.cjs), 63 pass (reference-surface-broker.test.cjs), 19 pass (reference-surface-fixtures.test.cjs), claims contract pass. New test/r2-pagination.test.cjs: synthetic fixture sets at 0/1/30/31/250/2500 occurrences paginate to complete authoritative set with no duplicate/skipped occurrence; stale continuation cancellation; remote-edge reconciliation; three zero/partial language states.

## v3.81.1 — 2026-07-11

**R1 review fixes: 10 correctness defects in the Reference Surface v1 broker**

- **onLoad order (dead-on-arrival):** `_killStaleObservers` now runs BEFORE `_initReferenceSurfaceBroker` in `onLoad`, so the prior broker's dispose fn is invoked before the new broker stashes its own. Previously, `_initReferenceSurfaceBroker` stashed its dispose fn first, then `_killStaleObservers` called it — killing the broker created 7 lines earlier; revision stayed frozen at 0, hydration aborted, incremental maintenance produced zero edges.
- **Async `getAllRecords` in hydration:** `col.getAllRecords()` is now properly awaited inside `startHydration` (it returns a Promise on the live SDK). Previously the Promise was truthy, bypassed `Array.isArray`, set `records = []` for every collection, and hydration completed claiming `status:'complete'` over an empty index.
- **SDK event field extraction:** All five broker event handlers now read `ev.lineItemGuid` (with `lineGuid`/`guid` fallbacks) and resolve segments via `getSegments()`/`hasSegments()` first, matching the shape the live Thymer event bus emits (same logic as the battle-tested `handleLineItemUpdated`). Previously all handlers used `ev.lineGuid` and `ev.segments`, which are absent from real SDK events — handlers silently no-op'd on production events.
- **Segmentless `lineitem.updated` must not drop edges:** `onLineupdated` no longer calls `removeEdgesBySourceLine` before confirming a segments payload is available. A task status toggle (no segments) previously permanently deleted that line's edges; now existing edges are preserved and cold-enrich only queues a rebuild.
- **`propRecs` cold-enrich was dead code:** `scheduleColdEnrich` now iterates `propRecs` and rebuilds property/annotation edges via `_edgesFromRecord` for each guid, matching the `record.updated` rebuild contract. Previously the snapshot was captured but never iterated — every property edit silently erased its relation edges forever.
- **`byLine` index for O(1) line removal:** Added a `byLine: Map<lineGuid, Set<edgeId>>` index maintained by `indexEdges`/`_removeEdge`. `removeEdgesBySourceLine` is now O(edges-on-that-line) instead of O(total-edges). `bumpRevision` only fires when the index actually changed.
- **Cursor stale-cursor: revision and filter axes:** `edges()` now validates `decoded.qr === queryRevision` AND `decoded.f === normalizedFilter` in addition to generation. Previously only generation was checked; a cursor from a stale revision or different filter silently resumed against a re-sorted snapshot.
- **Pagination tuple comparison:** The cursor resume scan now uses element-wise numeric comparison instead of `JSON.stringify(ek) > JSON.stringify(cursorKey)`. String comparison mis-sorts ordinals ≥ 10 (`'10' < '9'` lexicographically); `Infinity` serialized to `null` was unreliable as a sentinel (replaced with `1e15`).
- **Linkobj bare-string GUID:** `_edgesFromSegments` now handles `{type:'linkobj', text:'<guid-string>'}` (contract storage shape 1) — the bare string is the GUID directly. Previously neither the object-gate nor the external-URL branch matched a string, dropping the segment entirely.
- **Status recomputed on claims transitions:** Added `recomputeStatus()` called at hydration end, in `onClaimsRefresh`, and tracked via a `hydrationDone` flag. Late-arriving claims no longer leave `status:'degraded'` permanently; claims going away after completion correctly downgrades from `'complete'`.
- **`dateRange` filter canonicalization:** `_normalizeFilterV1` now emits `{from: Number, to: Number}` with fixed key order so `{from,to}` and `{to,from}` produce the same canonical string (prerequisite for the stale-cursor filter-mismatch check above).
- **Verification:** 88 deterministic Node tests plus the Attributes broker contract test; 10 new regression tests in `test/reference-surface-broker.test.cjs` (62 total behavioral tests); all suites pass.

## v3.81.0 — 2026-07-11

**R1: Reference Surface v1 broker**

- Adds `window.__thymerReferenceSurfaceV1` — a versioned, hot-reload-safe broker exposing all reference edge families (ref, external-link, property, annotation, claim) through a unified paginated API.
- Handles all three live-proven pair-encoded segment storage shapes (bare string / {guid} / {text:{guid}}) for both `ref` and `linkobj` segments; GUID-bearing linkobjs positively resolved to internal records are classified as `ref` with `provenance.segmentType:'linkobj'` (gap refxA-gap-1 fix).
- Authoritative chunked hydration (idle-scheduled, ~8ms yield, generation-guarded); starts at `status:'partial'` and advances to `complete` after all collections enumerated. Claims broker absent → `status:'degraded'` with diagnostic.
- Incremental maintenance from `lineitem.created/updated/deleted/moved` and `record.updated` events — builds from event payload GUIDs, never calls `data.getRecord()` inside the handler; enriches cold handles on a coalesced debounced retry.
- Broker interface per frozen contract: `apiVersion:1`, `generation`, `revision`, `subscribe` (sync replay + idempotent unsubscribe), `snapshot`, `edges` (FilterV1, opaque cursors, stale-cursor detection, deterministic sort), `occurrences`, `resolveTarget`, `inEdges` (Datacore seam).
- Hot-reload adoption: `_killStaleObservers` disposes the prior broker (unsubscribes handlers, cancels hydration) before the new instance installs itself.
- **Verification:** 88 deterministic Node tests plus the Attributes broker contract test; new `test/reference-surface-broker.test.cjs` (50 behavioral tests) + `test/reference-surface-fixtures.test.cjs` (19 contract tests) all pass.

## v3.80.2 — 2026-07-11

**Flash-free Roam and Distinct reference appearance while typing**

- Fixes the active-editor blink where a page reference briefly animated from Thymer's native dark color back to RefX blue after every keystroke. RefX was already classifying the replacement chip in the same mutation checkpoint; Thymer's host-chip rule was applying 200ms `color` and `text-decoration-color` transitions to each new DOM node.
- Styled modes now disable Thymer's host transitions only on explicitly classified RefX page/line chips. The existing hover treatment remains but applies immediately, including under custom themes. Native and unclassified appearance are untouched, and the badge pipeline remains unchanged because the count node and its reserved geometry stayed stable throughout the reported GIF.
- **Verification:** 88 deterministic Node tests plus the Attributes broker contract test; live CDP mutation tracing confirmed five successive chip identities stayed blue and underlined from their first observable state through type and undo.

## v3.80.1 — 2026-07-11

**Stable flash-free style lifecycle and durable execution roadmaps**

- Preserves and transfers the existing `trc-reference-counter-style` node during RefX's hot-reload handoff, then updates its `textContent` in place. A real unload still removes the owned style. The badge geometry, synchronous cached-node repair, persisted truth seeds, observer scoping, and renderer are intentionally unchanged because the current implementation already exceeds the generic flash-free guidance.
- Adds fresh-session, goal-executable roadmaps for the shared Reference Platform P0–P2 work, focused Backreferences improvements, Version Ledger, Outline Refactor, and Spaced Review.
- **Verification:** 87 deterministic Node tests plus the Attributes broker contract test; syntax, JSON, whitespace, version-sync, and roadmap-link checks pass.

## v3.80.0 — 2026-07-11

**Versioned Attributes claim-edge consumption**

- Negotiates the `thymer-claims-v1` broker and consumes its canonical claim IDs and authored/derived edges without rescanning the Attributes collection.
- Coalesces one refresh per broker generation/revision, disposes subscriptions on hot reload, and exposes explicit partial/degraded/unavailable state.
- **Verification:** 86 deterministic Node tests plus the Attributes broker contract test; the broker-ready adapter contains zero collection, record-body, or line-body scanners.

## v3.79.1 — 2026-07-10

**Emergency speed and stability refactor — same behavior, near-zero steady-state overhead**

- **Fixed the v3.79.0 freeze at its measured source:** a Chrome CPU trace showed about
  **1.12 seconds** of sampled main-thread time inside Thymer's workspace record resolver,
  called by Reference Extravaganza's line-property index. v3.79.0 had replaced the prior
  O(1) registry check with `data.getRecord()` for every GUID-shaped property across the
  workspace. Classification is now cache/registry-first, and the full index builds one
  live-record GUID set so property classification performs zero per-value host lookups.
- **Removed a true refresh loop:** a cold record could be classified as unknown, discovered
  by the background name index, trigger a panel refresh, and then become unknown again
  because the classifier ignored its own positive cache. Positive record proof is now the
  first fast path, so unknown → record is terminal and cannot re-arm the same full scan.
- **Eliminated recurring two-minute workspace scans:** relation and line-property indexes
  are maintained incrementally by Thymer's record events. A built index no longer expires
  on the generic 120-second cache TTL; the lightweight record-count safety check is reduced
  to 30 seconds and rebuilds only when the workspace record set actually settles at a new size.
- **Made cold-name indexing bounded:** bursts of unknown targets coalesce behind one timer,
  a completed index has a five-minute reconciliation cooldown, large collections yield every
  200 records, and the initial walk refreshes panels only for targets that were actually
  waiting—not merely because thousands of unrelated names entered the index.
- **Reduced edit-time observer work:** mutation handling now ignores plain lines in a mixed
  batch and styles only newly inserted reference subtrees before the `[[` / `((` picker guard.
  The normal debounced line rescan remains the correctness backstop, so page/line styling and
  instant badges are unchanged without repeatedly scanning every chip on every touched line.
- **Hardened expanded reference context:** the first rich contexts remain immediate; remaining
  parent/sibling/child contexts hydrate at most two rows concurrently and await each batch
  instead of appending hundreds of controls in one microtask. Render tokens cancel stale queues,
  filter-only rerenders reuse source trees, and sibling candidates normalize once per parent.
  Malformed cyclic child data is visited iteratively with a hard bound. All rows/actions remain.
- **Kept event-maintained indexes truthful:** record creation and trash lifecycle events now
  add/remove memberships directly. A transient cold `getRecord()` during a remote update preserves
  the prior entry and keeps one coalesced, delayed record retry rather than falsely deleting it or
  restarting a whole-workspace scan.
- **Closed the remaining resolver paths:** registry-proven text/task/body lines make zero host
  lookups, and unresolved display-name paints honor the same negative/line cache with a bounded
  probe lease instead of re-querying Thymer on every repaint.
- **Measured call-count reduction:** 10,000 repeated warm target classifications now make
  **1 host lookup instead of 10,000**; 10,000 workspace property candidates make **0 host
  lookups instead of 10,000**.
- **Verification:** 86 deterministic Node tests cover hot-cache call counts, proven-record
  non-oscillation, cold-target
  negative caching, zero-probe workspace indexing, index event maintenance, name-index
  coalescing/chunking, mixed mutation batches, cyclic context data, and all prior reference,
  search, checkbox, cache, title, collection-move, and race regressions. Syntax and JSON checks pass.

## v3.79.0 — 2026-07-10

**Truthful inline counts, clearer reference context, distinct links, and collection moves**

- **Fixed the exact phantom-badge case on `1XGN0TM5H0G3FSEFQJCJZHWFXY`:** Thymer
  document/record registry entries also carry an `rguid`, so the old auto-detector incorrectly
  classified the record's `Attendees` and `Meeting` relations (`Lori Boyd` and `Svy/Lori 1:1`)
  as line annotations. A second path then assigned a synthetic count of 1 to every meaningful
  body line, even though `@linkto` returned zero. Target classification now positively separates
  records, lines, and cold/unknown values; confirmed record relations are never line refs.
- **Counts are inbound-only:** outbound record properties no longer manufacture a linked-reference
  badge on each body line or render a contradictory `0 Linked References / Annotates …` section.
  Legitimate inbound `Source Line` property references still count and render normally. Both the
  persisted count cache and line-property index use new versioned keys, so v3.78 phantom positives
  cannot flash or return after refresh.
- **Parents, reference, siblings, and children are visually explicit:** linked-reference rows label
  their ancestor/parent levels, the referenced source line, direct siblings, and children. Siblings
  reuse the already-loaded source tree (no additional SDK query), preserve source order, expose the
  same jump/side-panel/edit/embed actions, and start with eight visible rows. More siblings render in
  keyboard-friendly batches of 40 (hard-capped at 200, then a source-jump action) to protect huge
  flat outlines from DOM freezes.
- **Configurable, reliable link appearance:** Settings now offers **Distinct** (default: blue solid
  page links, teal dotted line links), **Roam-inspired**, and **Native Thymer**. Classification runs
  before count visibility, so zero-count links are styled too; cold page targets stay unknown rather
  than being falsely styled as lines. Styling is paint-only and does not change editable-chip layout.
- **Move an embedded record between collections:** page transclusion cards show their current
  collection as the second keyboard stop. Press Enter/click it, type to filter collections, use
  Up/Down, and press Enter to move. The official `moveToCollection(collectionObject)` API preserves
  the record GUID, body, references, and source properties; the current and Journal collections are
  excluded. Destination schemas refresh every open card, while source-only fields remain stored and
  may simply be hidden until the record returns to a collection that exposes them.
- **Performance/lifecycle hardening:** reference-kind lookup is O(1) per visible chip, context rows
  share one source-tree promise per record, move events are hot-reload-safe, and structural card
  refreshes are settle-retried after a move without adding work to typing or scroll paths.
- **Verification:** 70 deterministic Node tests cover the reported record-relation failure, strict
  inbound counts, record/line/unknown classification, zero-count styling, style persistence,
  sibling derivation, picker-time chip rebuilds, disabled-counter styling, keyboard card order,
  collection-move success/failure, async intent races, edit-safe refresh, hot-reload generations,
  timer coalescing, and all prior search, checkbox, cache, title, and race regressions. Syntax, JSON,
  and whitespace checks pass.

## v3.78.0 — 2026-07-10

**Reliable badges, faster fuzzy reference search, attached task checkboxes, and live transclusion titles**

- **No phantom badges on empty lines:** target-line discovery now checks the authoritative
  line model before accepting a persisted count seed. Plain empty lines are excluded (including
  after refresh), while meaningful task/ref-only lines remain eligible. A failed authoritative
  count read also drops a disk-only positive seed instead of leaving stale UI behind.
- **Faster, more forgiving `[[` and `((` search:** punctuation, whitespace, accents, and
  letter/number boundaries are normalized, so searches such as `EMP 26` find
  `EMP26-002-BHP` and `QUAL 4507 11` finds `QUAL-4507.11`. Loaded records/lines publish
  synchronously before any SDK wait; normalized candidate keys are cached, result working sets
  and remote fan-out are bounded, and identifier-strength ranking keeps the best match first.
- **Complete keyboard flow:** the `+ Create page` row is now a real selectable option with
  correct visible selection and ARIA state. Arrow keys move between create and fuzzy results;
  Enter always executes the visible current choice. Stale results from an older query cannot be
  inserted, and the final exact-name recheck still prevents duplicate pages.
- **Task checkbox stays with the reference:** referenced-task checkboxes now use a stable leading
  slot keyed to the task chip's GUID and are positioned from the chip's own geometry—not the
  source row gutter. They remain at the front of the referenced text even when ordinary text
  precedes the chip, survive Thymer chip re-renders, and are pruned/batched without style churn.
- **Line-reference titles follow transclusion edits:** line refs created by the plugin are marked
  as managed snapshots. Editing the source line—including inside an inline transclusion—updates
  those chip titles automatically. A manually set alias is detected and preserved; clearing an
  alias opts that ref back into live title tracking. Legacy auto-titled refs migrate safely when
  their stored title still matches the prior source text.
- **Rename records from the transclusion card:** a record embed's title is the first keyboard
  navigation target. Press Enter to edit it, Enter/blur to save, or Esc to cancel; the reference
  chip and breadcrumb then follow the record's live name. Writes prefer Thymer's built-in `Title`
  property, retain `Name` only as a compatibility fallback, and are verified through `getName()`
  before the UI reports success.
- **Race and reload hardening:** title updates are serialized per source line, rebased on the
  freshest model segments immediately before writing, skipped while that source has the caret,
  and generation-cancelled across reload/hot-reload. Delayed callbacks and task-style frames are
  window-stashed for cleanup so an obsolete plugin instance cannot mutate the new one.
- **Verification:** 47 deterministic Node regression tests cover the reported cases plus stale
  search, cache failure, alias preservation, write serialization, SDK title-field variants, and
  task geometry; syntax, JSON, and whitespace checks are included in the release gate.

## v3.77.0 — 2026-07-10

**Instant first paint, reliable task checkboxes, and Roam-style missing-page creation**

- **Badges at native speed:** reload now preserves numeric count/index seeds instead of
  discarding them, model ref changes paint their affected chips/target lines immediately,
  and native backlink-pill mutations are mirrored in the same observer microtask. Slow
  authoritative reads refine per target without blocking the rest of the page.
- **Race-safe counts:** pre-edit count/backref promises are generation-cancelled; default
  combined mode uses a safe lower-bound instead of an incorrect blind `+1`; two settle reads
  correct Thymer index lag. Scan-local mounted-node maps avoid a document-wide selector/layout
  storm for every completed target.
- **Task refs stay checkable:** task detection accepts Thymer's `getType()`, `.type`, and
  task-status-only handle variants. Unknown cold lines are never negative-cached, status-only
  events repaint directly, retries are bounded, and durable GUID-to-owner hints resolve aliased
  task refs after restart without requiring a page re-index.
- **Create missing `[[pages]]`:** Enter performs an exact-name recheck, prevents stale search
  results/duplicates, creates a missing page in Notes (workspace default fallback), then uses the
  existing verified reference-write path. Fuzzy matches remain explicitly selectable.
- **Lifecycle/perf hardening:** full scans supersede queued scoped scans, disabled counters cannot
  resurrect decorators, and property-reference indexing remains cancellable background work.
- **Verification:** syntax/JSON/diff checks, focused Node regression tests, adversarial review,
  and a non-persistent Thymer plugin preview.

## v3.76.0 — 2026-07-09

**Lower layout cost for overlay badges and large-page cleanup**

- Split overlay positioning into batched read and write phases, reducing forced synchronous
  layout from roughly one reflow per overlay to one layout pass per frame.
- Shared line/chip lookup caches across orphan sweeps, scoped rescans, panel disposal, and
  keep-alive pruning instead of repeating whole-document queries per badge.
- Deduplicated scroll-anchor geometry reads and retained a bounded remeasure fallback for
  viewport-culled overlays.
- Includes the v3.75.1/v3.75.2 follow-ups for disk-seed invalidation and non-blocking block-view
  property-reference loading.

## v3.75.0 — 2026-07-09

**Perf: org-remark "Source Line" refs resolve INSTANTLY on reload (persisted line-prop index)**

v3.74.0 moved the line-prop-ref index build off the critical path, but a cold reload still had
to wait for the ~540ms background walk of every workspace record before org-remark "Source Line"
(and any other `lineRefProperties`) refs would resolve. This mirrors the v3.73.0 count-cache
persistence pattern for that index so those refs paint synchronously from disk on load.

- **Persist to localStorage**: the built index (record → line it references via a configured
  property) is serialized as `{ t, r: { [targetLineGuid]: [recordGuids…] } }` under a
  workspace-scoped key (`refx_linepropidx_v1_<workspace>`), debounced 5s after each real
  background build and flushed on dispose. Capped at 6000 targets to bound store size; a
  quota/serialization failure is tolerated silently.
- **Seed on load**: `_seedLinePropRefIndexFromDisk()` (called from `_counterInit`, before the
  first scan) reconstructs `recordsByTarget` + inverts it into `targetsByRecord`, marking the
  seed `fromDisk:true` / `builtAt:0`. Rejects a snapshot older than 7 days (same freshness gate
  as the count cache).
- **Usable-but-refined**: `getLinePropRefIndexIfReady()` now returns a fromDisk seed for
  IMMEDIATE use (so refs paint at once) AND schedules a background rebuild to refine it. The
  rebuild's existing delta-invalidation corrects any target whose membership changed while the
  plugin was unloaded (`before.recordsByTarget` is present on the fromDisk index), then persists
  the fresh build for the next reload. The fromDisk seed itself is never re-persisted, so its
  own timestamp can't defeat the freshness gate.

No behavior change beyond the faster first paint; the feature stays zero-cost when
`lineRefProperties` is empty and `autoLineRefs` is off (nothing seeds, nothing persists).

## v3.74.0 — 2026-07-09

**Perf + reliability: the line-prop-ref index (org-remark "Source Line" refs) no longer blocks the badge scan, and refs appear without a manual refresh**

Profiling a slow-badge / "org-remark reference only appears after a refresh" report found the
line-prop-ref index — which maps a line guid held in a record property (e.g. org-remark's
"Source Line") to the referencing records — walks EVERY workspace record (~540–620ms on a
7.8k-record graph) and was built **synchronously inside the badge scan**, blocking even
disk-cached badges. It also had a 2-min TTL and was first built during boot when
`getAllRecords()` could still be incomplete, so a ref could stay missing until a manual
refresh nulled+rebuilt the index.

- **Non-blocking build**: new `getLinePropRefIndexIfReady()` returns the fresh index or null +
  schedules a background (requestIdleCallback) build; the badge scan and count path never pay
  the ~540ms build on the critical path. When the index isn't ready, prop-refs are treated as
  absent for that pass and the background build refreshes them in.
- **Auto-rebuild + no-manual-refresh**: the background build delta-invalidates the count cache
  for targets whose prop-ref membership changed and refreshes, so a just-resolved org-remark
  ref lights up on its own. A record-set size change (records finished streaming in) triggers
  a rebuild — bounded: only after the count SETTLES (two agreeing probes) and hard-capped so a
  trickling record source can't rebuild forever (adversarial-review fix for a boot storm).
- **Target badges react to the native pill**: `nodeHasReferenceHint` now recognizes Thymer's
  `.lineitem-backlink-pill`. A referenced target line renders with a pill but no ref-chip, so
  previously its render didn't trigger refx's fast scoped rescan (which has a synchronous
  native-pill immediate paint) — the badge waited for the timer-driven full scan. Caret-safe
  (overlay path).
- Aligned `updateLinePropRefIndexForRecord`'s guard so incremental invalidation also runs in
  autoLineRefs-only mode.

Opus adversarial review: the org-remark-lights-up-after-first-build path and null-safety were
verified correct; the rebuild-storm, flag-clear-timing, and auto-only-guard findings are fixed
above. Note: the intermittent org-remark repro could not be reproduced in profiling (records
load fast locally), so that path is a reasoned safety net; the ~540ms boot block removal is
measured.

## v3.73.0 — 2026-07-09

**Perf: ref-count badges paint at native speed on cold load (was ~1.7s late)**

Cold-load timeline probing (Chrome DevTools) showed our count badges appearing ~1.7s
AFTER Thymer's own native backlink pill. Root cause: the badge count came from an async
`getBackReferences()` cascade that runs *during Thymer's boot main-thread crunch* — each
call measured 300–1000ms under contention (vs ~86ms idle) — while the authoritative count
was already in the DOM (native pill) or computable synchronously. Two fixes:

### 1. Persisted count cache (localStorage) — chip badges

The in-memory `_countCache` is now persisted to `localStorage` (workspace-scoped, versioned,
bounded to 4000 positive-count entries, 7-day freshness gate) and seeded on load as
`fromDisk` entries. `scanPanel` gains a synchronous immediate-paint pass that paints every
chip badge whose count is already known (disk-seeded or in-memory) *before* the async
authoritative pass. On a warm reload every ref-count badge now appears with the editor
instead of ~1.7s later. `fromDisk` entries never short-circuit the async refine (which
replaces them with a fresh count and removes the badge if it dropped to 0), so a stale disk
count self-corrects on first scan. Measured: chip badge 5102ms → 4013ms cold (tracks the
native pill).

### 2. Native-pill immediate paint — target-line badges

`scanTargetLineBadges` / `_rescanTargetBadgesForLines` now read Thymer's own
`.lineitem-backlink-pill` integer synchronously (`_nativePillCount`) and paint the target-line
badge immediately from `max(registry pre-count, native pill, disk count)`, then refine async.
The native pill is server-indexed and lands the instant the editor mounts, so our badge now
tracks it. Works even though we CSS-hide the pill (`display:none` retains `textContent`).
Abbreviated counts ("1.2k", "99+") are rejected so a placeholder is never wrong.

The native pill stays fully hidden (`refx-hide-native-pill`, unchanged) — ours is now fast
enough that no placeholder swap is needed.

## v3.72.1 — 2026-07-09

**Bug fixes: LINE-target badges, RECORD over-count, stale cache for line targets, in-flight dedup**

### 1. LINE-target count badges and sections now return correct results (blocker fix)

`loadLineReferenceCount` and `_queryRefLines` both used `r.lineItemGuid === targetLineGuid`
to filter `getBackReferences()` results to a specific LINE target. The SDK contract for
`PluginBackReference.lineItemGuid` is the SOURCE line guid (the line containing the
reference), not the target line guid. This comparison never matched, so line badges always
returned 0 and inline "Linked References" sections for line targets were always empty.

Fix: `getBackReferences()` carries no field identifying the specific TARGET line-item of
a record that was referenced. The LINE-target path now always falls through to
`searchByQuery('@linkto = "lineGuid"')`, which correctly filters by target line guid.

### 2. RECORD-target counts no longer inflate for records with referenced child lines (major fix)

`getBackReferences()` on a record returns refs to the record AND any of its child line
items. The previous RECORD path counted all of them, so any record whose child lines are
themselves referenced would show an inflated badge (refs to children counted toward the
parent's badge, diverging from the `searchByQuery` behaviour it replaced).

Fix: for warm source lines (present in `g_universe.itemsByGuid`), verify via decoded
segments that at least one `ref`/`linkobj` segment targets the RECORD ROOT guid exactly.
Refs whose source line actually targets a child line are skipped. Cold lines are passed
through (rare; corrected by the fallback `searchByQuery` path on the async render pass).

### 3. Cache invalidation now fires for LINE targets (major fix)

`_backrefCache` is keyed by owning-record guid. `handleLineItemUpdated` built an
`affected` set of ref-target guids from segment extraction; for a line reference the
target guid is the TARGET LINE guid (never an owning-record guid), so
`_backrefCache.has(targetLineGuid)` was always false and the target's owning record's
cache entry was never invalidated. Line badges showed stale counts for up to 30 min after
an edit.

Fix: for each guid in `affected`, also resolve its owning record via the registry
(`reg[guid]?.rguid`) and delete that owning-record entry from `_backrefCache`.

### 4. In-flight dedup in `_fetchBackrefs` (minor fix)

Concurrent callers (idle prefetch + an on-open badge load) could both miss the cache and
issue two `getBackReferences()` calls for the same record before either resolved.

Fix: a `_backrefInFlight` Map coalesces concurrent callers onto one pending Promise per
guid; the entry is cleared in a `finally` block.

---

## v3.72.0 — 2026-07-09

**Perf: counts + inline refs near-instant via native backref API, persistent cache, and idle prefetch**

### 1. Native `getBackReferences()` replaces `searchByQuery` for counts and section refs

`loadLineReferenceCount` and `_queryRefLines` previously called `searchByQuery('@linkto = "guid"')`
for every badge and every section open. Cold, that call takes ~3.2 s per target.

Both functions now use `record.getBackReferences()` (native SDK, server-maintained inverse index,
estimated <100 ms) when available:

- **RECORD target** (most chip badges, most sections): call `getBackReferences()` directly on
  the record, filter `kind === 'line'` entries. Single call, zero scan. Deduplication, self-ref,
  excludeCollections, and isLineSharedIgnored filters are all preserved.
- **LINE target** (body-line badge): look up the owning record guid in `g_universe.itemsByGuid`
  (synchronous, zero cost when the target line is visible). Call `getBackReferences()` on the
  owning record, then filter `.lineItemGuid === targetLineGuid`. One native call.
- **Fallback**: if the API is absent or the owning record is registry-cold, falls back to
  `searchByQuery` as before (no accuracy regression).

### 2. Persistent per-owning-record backref cache (`_backrefCache`)

`_fetchBackrefs(owningRecordGuid)` wraps `getBackReferences()` with a
`Map<guid, {refs, ts}>` cache (TTL = `_countTtlMs`, 30 min by default).

- Cache survives navigation (lives on the plugin instance, never cleared on `panel.navigated`).
- LRU eviction at 512 entries.
- Invalidated precisely on `lineitem.updated` (affected target guids + source line owner),
  `record.updated` (the updated record's entry), `clearCountCache()`, and `_counterDispose()`.
- Multiple line badges under the same owning record share one `getBackReferences()` call:
  the first badge fetch populates the entry; subsequent badges filter in-memory (zero extra calls).

### 3. Idle prefetch after page scan

After `scanTargetLineBadges` completes, a background pass pre-warms `_backrefCache` for:

- **Chip target record guids** (queried from `.listitem-ref[data-guid]` in the editor root) —
  the targets most likely to have their section opened next.
- **Owning records for visible line-target badges** with count > 0.

Uses `requestIdleCallback` (or a 200 ms `setTimeout` fallback). Concurrency capped at 4 to
not contend with badge rendering. Aborted automatically on navigation via a per-panel cancel token.

Result: first section open on a freshly loaded page renders from a warm cache hit (O(1) filter)
instead of a ~3.2 s `searchByQuery` cold call.

---

## v3.71.0 — 2026-07-08

**Fix: warm-pass self-ref filter matches async semantics; Fix: badge-count decode covers all three ref shapes**

### Fix: warm-pass self-ref filter matches async `_queryRefLines` semantics

`_fillInlineRefs`'s warm registry walk (added in v3.70.0) filtered self-refs by
`st.guid === targetGuid`. The authoritative async pass (`_queryRefLines`) filters by
`sourceRecordGuid === targetGuid` (i.e. `st.rguid`). For a record target with references
inside its own body, a body line's guid never equals the record guid, so the warm pass
INCLUDED those rows while the async pass EXCLUDED them — causing a visible row shrink /
count drop when the async result replaced the warm render. Fixed by checking
`st.rguid === targetGuid || st.guid === targetGuid` so the warm subset is always a true
subset of the async result.

### Fix: `_registryInboundCountMap` covers all three ref storage shapes

The badge pre-count in `_registryInboundCountMap` decoded ref targets with two shapes
(bare string and `data.guid`), while the warm-pass walk also handled `data.text.guid`.
A ref stored in the `{text:{guid}}` shape could produce a warm section row that the badge
count did not include — a transient mismatch. Added the `data.text.guid` branch to
`_registryInboundCountMap` so both registry walks use the same decode.

---

## v3.70.0 — 2026-07-08

**Perf: registry-first inline linked-refs render; Fix: stray overlay badge at 0,0 on navigation**

### Fix 1 - Registry-first inline linked-refs render (`_fillInlineRefs`)

Inline sections previously showed "Loading references..." for 2-3 s (cold) / 575 ms (warm)
before any rows appeared because `_fillInlineRefs` issued three sequential async
`searchByQuery` / SDK round-trips before touching the DOM.

New approach: at the top of `_fillInlineRefs`, BEFORE the first `await`, walk
`g_universe.itemsByGuid` (the same registry walk `scanTargetLineBadges` uses for its
immediate-paint pre-count). Collect every loaded line whose `text_segments` contain a
`ref` or `linkobj` segment pointing at `targetGuid` (mirrors `_registryInboundCountMap`'s
3-shape decode: bare string / `{guid}` / `{text:{guid}}`). If any warm lines are found,
immediately render them via `_renderRefsGroups` with a provisional
`↙ N Linked References (updating...)` title, replacing the "Loading..." placeholder.
The three async awaits then run as before; when they resolve the body is cleared and
repainted with the authoritative result and the `(updating...)` suffix is removed.

Result: rows appear in under one frame for any target whose referencers are on the
currently-loaded page; degrades gracefully to the existing "Loading..." flow for
cold/unloaded targets.

### Fix 2 - Stray overlay badge at 0,0 on navigation (`_syncOverlayBadge`, `_positionOverlay`, `scanPanel`)

After navigation, count overlay badges (`position:absolute` on `.line-div`) occasionally
rendered at top-left (0,0) of the panel. Three root causes, three guards:

**Guard 1 (`_syncOverlayBadge`):** The chip liveness check (`chipEl.isConnected`) was
missing. When `_syncOverlayBadge` was called during a scan that completed just after
navigation (stale `querySelectorAll` result), the chip existed in the registry but was
not yet connected to the live DOM. The overlay node was created, appended, and the
subsequent `_positionOverlay` rAF found `_findRefChip` returning null -- leaving the
node at its initial `-9999px` park which renders at 0,0 in some layout contexts.
Fix: early-return from `_syncOverlayBadge` when `!chipEl.isConnected`.

**Guard 2 (`_positionOverlay`):** When `cr.width <= 0` (chip mid-rebuild) and the node
has never been positioned (`node._rx === undefined`), the code left the node visible with
its initial `-9999px` style -- which, before layout runs on the host, can appear at 0,0.
Fix: set `node.style.display = 'none'` when `cr.width <= 0` AND `node._rx === undefined`.
The next rAF re-shows it once the chip is fully rendered and positioning succeeds.

**Guard 3 (`scanPanel`):** The existing `_sweepOverlayOrphans` only ran AFTER the async
count fetch completed (end of `scanPanel`), so stale overlays from the prior page were
visible for the full scan latency on every navigation. Added a synchronous pre-sweep at
the top of `scanPanel` (after `editorRoot` is resolved) that removes any overlay node
inside this `editorRoot` whose chip is absent or belongs to a different root. O(N_overlays)
with one `contains()` check per entry -- negligible cost, eliminates the first-frame stray.

## v3.69.0 — 2026-07-08

**Block View fixes: plugin.json version bump, tab keyboard nav, outline wrap + depth**

- **plugin.json version** corrected to 3.69.0 (was stuck at 3.68.1 — PM could not detect the update).
- **Tabs view (t): L/R arrow keys now work immediately on open.** Tab bar is programmatically focused (`tabBar.focus()`) in the same `requestAnimationFrame` that scrolls the active tab into view; previously the bar was never auto-focused so arrow navigation was dead until the user clicked a tab or tabbed into the bar manually. Removed stale `.refx-bv-tabfocused` header comment (the class was never implemented).
- **Outline wrap toggle (paragraph sign) now works.** Outline renders text in `.refx-bv-line-text` spans, not `.refx-bv-line`; the wrap CSS rule now covers both so toggling wraps Outline text too.
- **Outline nested indentation is now correct beyond depth 1.** `renderTree` was recursing with a hardcoded `depth 0` for all grandchildren (flush-left collapse). Changed to `depth + 1` so each level indents by 18 px (capped by buildTree's depth-6 limit).

## v3.68.1 — 2026-07-08

**Fix: registry pre-count is now a true lower bound; remove dead immediatePaintKeep variable**

### Fix 1 — `_registryInboundCountMap` true lower bound

The v3.68.0 pre-count comment claimed "LOWER BOUND" but the implementation could
overshoot the authoritative `loadLineReferenceCount` in three cases, causing a visible
downward count flip and — in the worst case — a badge appearing then vanishing:

1. **Deleted/trashed source states**: `g_universe.itemsByGuid` retains `is_deleted` and
   `is_trashed` entries; the authoritative pass excludes them (mirrors the alias scan at
   line 12494). Pre-count now skips states where `st.is_deleted || st.is_trashed`.

2. **Multiple chips from one source line to the same target**: the authoritative pass
   deduplicates by source line via `uniqueLineRefs` (keyed by `line.guid`), so two
   `ref` segments on the same source line pointing at the same target count as ONE.
   Pre-count now tracks a `hitOnThisSource` Set per source state and counts at most
   one hit per target per source.

3. **Self-references when `_showSelf` is false**: authoritative excludes sources whose
   `sourceRecordGuid === guid`. Pre-count now skips `st.guid === targetGuid` when
   `!_showSelf`.

Excluded-collection sources cannot be checked synchronously (schema not in the
registry). An overshoot from that vector is accepted — the async authoritative pass
always corrects it, and excluded collections are rare in practice.

### Fix 2 — Remove dead `immediatePaintKeep` Set

`immediatePaintKeep` was populated in the immediate-paint pass
(`immediatePaintKeep.add(wrap)`) but never read. The final paint pass uses its own
`keep` Set to reconcile survivors via `removeOrphanTargetBadges`, so `immediatePaintKeep`
had no effect on correctness. Removed the declaration and the `.add` call.

## v3.68.0 — 2026-07-08

**Perf: immediate target-badge paint via registry pre-count; Auto-detect line-guid properties for all plugins**

### Change 1 - Target-badge render speed

`scanTargetLineBadges` previously issued one `searchByQuery` (WebSocket round-trip) per
visible line not in cache, serialised at concurrency=8. On a 72-line daily-journal page
this cost 9 rounds x ~80-100 ms each = ~700-900 ms before the first badge appeared.

New approach - two-phase paint:

1. **Synchronous registry pre-count** (`_registryInboundCountMap`): walks
   `g_universe.itemsByGuid` in O(N_loaded_lines) and counts inbound `ref`/`linkobj`
   segment hits for every visible line guid. Zero network. Executes before the async
   pass and immediately paints badges for lines whose pre-count is > 0 -- a number
   appears in <1 frame after navigation.
2. **Async-skip optimisation**: lines with pre-count === 0 AND no entries in the
   synchronous `linePropRefIndex` skip the `searchByQuery` call entirely. On a page
   where most lines have 0 inbound refs (the common case) this eliminates the dominant
   serial round-trip cost. Only lines with pre-count > 0 (or prop-based refs) queue an
   authoritative async refine.
3. **Authoritative correction**: the async pass runs only for the short subset of guids
   that might have a non-zero count, updating the already-painted badge if the
   authoritative count differs from the pre-count (e.g. refs from cold/unnavigated
   records not yet in the registry).

The pre-count is a LOWER BOUND (registry-cold lines from unnavigated records are
absent), but it is always correct for the warm session, and the async correction path
handles cold sources.

Config unchanged -- `custom.counter.targetLineBadgesMaxLines` / `refreshDebounceMs` /
`countConcurrency` all behave as before.

### Change 2 - Auto-detect line-guid properties (works everywhere, zero config)

Previously `custom.lineRefProperties` (default `["Source Line"]`) was the only way to
connect a record's property-stored line guid to the target line's badge and Linked
References section. Any new plugin (PDF highlights, custom annotation tools, etc.)
required explicit registration.

New: `custom.autoLineRefs` (default `true`). When ON, `getLinePropTargetsForRecord`
and `ensureLinePropRefIndex` scan EVERY property of every record and treat a
guid-shaped value as a LINE reference when the registry confirms it resolves to a LINE
state (has `rguid` in `g_universe.itemsByGuid`, not a document/record). This makes:

- **org-remark Remarks** ("Source Line" property) - already worked; continues to work.
- **PDF Highlights** ("Source Note" points to the record, not a line -- no change needed
  there, but if a "Line" property were added to PDF Highlights, it would auto-connect
  with zero refx config).
- **Any future plugin** storing a line guid in any property: deep-connects automatically.

The named `lineRefProperties` list remains as an EXPLICIT union -- it always indexes
those names even for cold (registry-unloaded) targets. `autoLineRefs` only fires for
registry-warm lines (since it must resolve the guid to confirm it is a line, not a
record). For the named list, the cold guarantee is preserved exactly.

Settings: new "Auto-detect line-guid properties (works for all plugins, no registration
needed)" checkbox in the Settings modal. Storage key: `refx_auto_line_refs_v1`.

New method `setAutoLineRefs(on)` -- rebuilds the linePropRef index + clears count cache.

`loadCountInfo`, `loadLinePropReferenceRecordCount`, `ensureLinePropRefIndex`,
`_queryPropertyRefRecords`, and the outbound-annotation (P2) path all updated to check
`_autoLineRefs || _lineRefProps.length` instead of `_lineRefProps.length` alone.

## v3.67.1 — 2026-07-08

**Review fixes: dead mode field, paste reload-survival, bundled icon**

- Removed unused `mode:'embed'` field from `window.__refxCopiedRef` stash in "Copy as transclusion" and corrected the inaccurate comment (the paste actions never branched on it).
- "Paste as transclusion" (ref menu + line menu) and "Paste text" (ref menu) now recover the guid via the same clipboard race as `_pasteRef` — a thymer-ref:// URI on the OS clipboard survives a reload and these actions now honor it, matching the reload-survival contract the Copy side advertises.
- "Paste text" additionally falls back to `_lineTextByGuid(guid)` when the in-session stash is absent, so clipboard-recovered paste-text still produces the line's live text.
- Fixed line-menu "Paste as transclusion" icon from `ti-clipboard-plus` (not in Thymer's bundled ~438-icon Tabler subset -- would render blank) to `ti-copy` (bundled, confirmed live).

## v3.67.0 — 2026-07-08

**F1: Nested Copy/Paste groups in the reference menu + F2: (( picker breadcrumbs for line results**

### Feature 1 — Nested Copy/Paste groups in the reference and line menus

`_openRefMenu` is now structured into four named sections with visual group labels (`refx-menu-section-head`) and dividers:

- **Navigate**: Jump to source, Open in side panel, Expand inline, embed display variants, Open linked references, Open in sidebar, Open linked refs in sidebar (all existing).
- **Edit & Transform**: Replace-with family, Apply children, Set alias (all existing).
- **Copy** (new + existing): "Copy reference" (existing), "Copy text" (new — writes the ref's display text or record name to clipboard), "Copy as transclusion" (new — same clipboard payload but stash is tagged `mode:'embed'` so the paste counterpart uses `_bridgeCreateEmbed`).
- **Paste (at caret)** (new): "Paste reference" (existing `_pasteRef()`), "Paste text" (new — inserts the stashed ref's display text as a plain-text segment at the caret via `_insertAt`), "Paste as transclusion" (new — calls `_bridgeCreateEmbed(caretLineGuid, stash.guid)`, full cycle-guard applies).
- **Delete**: existing delink rows, now clearly separated by a divider.

`_openLineMenu` gains "Paste reference" and "Paste as transclusion" rows after the existing copy rows (same logic, icons added).

New CSS class `.refx-menu-section-head`: non-interactive uppercase label row, `pointer-events: none`, 9.5px font.

### Feature 2 — (( picker breadcrumbs for line results

New `_buildLinePickCrumb(result)` method: registry-only, synchronous, zero SDK calls per row. Produces a compact breadcrumb for `((` line results showing:
- `in <parent text>` (truncated to 30 chars) when the line's parent is loaded in the registry.
- `N siblings` when the parent has multiple children.
- `N children` / `N child` when the line has children.
- Falls back to `_buildPickerRowCrumb(result.rguid)` (owning record's collection + props) for cold lines not in the registry.

`_renderLink` now emits this crumb for `link.kind === "line"` results using the existing `.refx-pickrow-crumb` class (same styling as [[ record crumbs).

`_fillLinkPreview` line-kind async block gains three enhancements:
- **Collection crumb header**: `_buildPickerRowCrumb(rguid)` inserted after the record name.
- **Owning-record properties block**: reuses `_recCardFields(rec)` (memoized) and the existing `refx-preview-props / -proprow / -proplabel / -propval` classes, capped at 4 fields.
- **Sibling count suffix on the target row**: `· N siblings` appended as `.refalias-preview-sibs` span when the parent has siblings.

New CSS class `.refalias-preview-sibs`: 10px, 45% opacity, 6px left margin.

## v3.66.0 — 2026-07-08

Two regression fixes (both root-caused live):

- **Auto-close ghost `]]` / `))` shows again.** `_showAutoClose` anchored the ghost to `document.querySelector('.listview-caret-self')`, but Thymer renders one such element per listview and idle ones are 0x0 — querySelector grabbed the first (often the 0x0 idle caret), the `r.width || r.height` guard rejected it, and the ghost was never positioned (rendered at 0,0 / off-screen). Now iterates all `.listview-caret-self` and picks the one with real geometry (the active-input caret). No editor-flow change; ghost-positioning only.
- **Block View body no longer empty.** `.refx-bv-panel` had `max-height: 88vh` but no `height`; with the backdrop's `align-items: flex-start` the panel sized to its intrinsic content (header only), so `.refx-bv-body { flex: 1 1 0 }` collapsed to 0 height and hid all content (the header-only strip). Added a definite `height` (88vh panel / 70vh popout) so the flex body fills and scrolls. Pure CSS; buildTree/renderView unchanged.


## v3.65.0 — 2026-07-08

**Polish: annotating-record rows in source-line sections hardened + body-line badge**

- **[P1] "annotates" pill on property-ref rows** — when the inline Linked References section is open for a SOURCE LINE (a line whose guid appears in another record's `Source Line` / `lineRefProperties` property), each referencing-record row now carries a small "annotates" pill so it is visually distinct from ordinary relation backrefs.
- **[P1] Body-preview lines for cold (registry-unloaded) records** — the existing F3A body-line sub-block previously only appeared when the referencing record was warm in the Thymer registry (`g_universe.itemsByGuid`). Records that have never been navigated to were silently skipped. Now an async SDK fallback (`this.data.getRecord(g).getLineItems()`) fills the preview for cold records. The result is cached in `_bodyLineCache` (TTL 120 s, invalidated on workspace-invalidate) so at most one fetch per record per session. A "loading…" placeholder is shown while the fetch is in flight; if the record has no body lines the placeholder is removed without adding a toggle.
- **[P2] Count badge on body lines inside annotating records** — `loadCountInfo` for a LINE guid now adds 1 when the line's owning record has outbound `lineRefProperties` targets AND the line currently has zero inbound refs. This makes the badge appear on body lines of remark-like records (e.g. a Highlight record whose body lines were previously badge-less), giving the user an entry point to click and see the "Annotates" group. Gated on `custom.lineConnections` (default true); uses the registry `rguid` fast path — no async cost on the hot badge-scan path; skipped when the owner record is registry-cold.
- **[B2 verified]** refx inline section on the source line (`1WKRBSBYGSDBF7FJBGDQ1W9XEH`): the feature works correctly. `_queryPropertyRefRecords` returns the remark guid, `isLineTgt = true`, badge count = 1, F3A body-line chain resolves. No code change needed.

## v3.61.0 — 2026-07-08

**Highlight text + type [[ to wrap the selection as a record reference (Roam [[ on selection)**

- Select any text on a line and type `[[` — the selection is replaced with a `[[RecordName]]` ref chip. Exact-match on an existing record links to it; a single containment match links to it; ambiguous or no match creates a new record in the configured collection (default: Notes). The feature is gated by `custom.wrapSelectionEnabled` (default true) and `custom.wrapCreateCollection` (default "Notes"). Uses the `_pickLink` write-verify-retry pattern (4 attempts, 220ms settle).

## v3.60.1 — 2026-07-08

Review-fix batch (v3.60.0 code review):

- **[blocker] `_pendingConnect` dead code / caret-line write hazard** — `_pickLink` now intercepts `_pendingConnect` before the normal splice path (same pattern as `_pendingMentionsPin`), so "+ Add connection..." picks correctly call `_connectRecords` instead of attempting to splice a ref into the caret line. `_exitLinkMode` clears `_pendingConnect` alongside the other one-shot flags. `_abortLink` guards synthetic pickers with `if (link.synthetic) { _exitLinkMode(); return; }` so escape-abort can no longer delete document text when a synthetic picker is open.
- **[major] Connect duplicate guard missed cold target records** — `_connectRecords` now loads the target record's real lines via `await rec.getLineItems()` and deep-walks them (checking `segments` for ref chips) before the registry fast-path. Cold/background records whose body lines are absent from `g_universe` no longer produce duplicate "Related:" lines on every connect.
- **[major] Chip-toggle re-render bypassed global filters and dropped Deep-connections section** — chip click handler now applies `_applyGlobalFilterToItems` on top of `_applyChipFilterToItems` (matching the initial fill path). After clearing `bodyEl`, the `.refx-deep-section` is re-appended if it was wiped (mirrors the existing unlinked-section re-append).
- **[major] hop2 `getBackReferenceRecords` re-introduced line-ref sources and duplicate paths** — The hop2 property-backref loop in `_findDeepPaths` now filters via `_propNamesReferencing(rg, intermediateGuid)` (skips records with no genuine relation-property link, matching the v3.59 `_querySdkPropertyBackrefs` guard) and tracks a per-intermediate `seenHop2RecGuids` set so records already emitted by the line pass are never re-emitted with a bogus "property" label.
- **[major] Direct-referencer exclusion missed "Via property" (sdkSection) sources** — `_fillInlineRefs` now stores `entry._rawSdkRecs` (the SDK-section record guids), and `_runDeepConnectionsScan` adds them to `directSourceGuids` alongside `_rawItems` and `_rawPropRecs`. SDK-relation-only sources no longer appear as deep connections or suggested connections.
- **[major] Global filters not applied in Workbench linked-refs cards** — `_wbFillLinkedRefs` now runs `this._applyGlobalFilterToItems(lines)` before count/slice/render, consistent with `_fillInlineRefs`.
- **[major] Settings global-filter chip removal dead after two clicks** — replaced nested `renderGfChips(…, null)` termination with a stable `rerender` closure, so removal works for any number of chips in a single modal session. Enter-add path also calls `rerender()`.
- **[minor] "Related:" line prepended instead of appended** — `_connectRecords` now fetches the last root child via `getLineItems()` and passes it as the `after` argument to `createLineItem`, so the new line lands at the end of the record body.
- **[minor] Deep-path trail: ◆ glyph inverted, hop2 "via PropName" never rendered** — property-sourced paths (hop2Label set) now render "via PropName →" before the intermediate name and use the plain intermediate name (no ◆); ref-chip paths get "◆ IntermediateName" as before. `addTrailHop` remains defined but is effectively superseded by the inline render; it is not called (dead code removal deferred to avoid changing the surrounding block scope unnecessarily).
- **[minor] Hardcoded 40 in "40+" header duplicated `MAX_PATHS`** — promoted to class-level constants `_DEEP_MAX_PATHS = 40` and `_DEEP_MAX_INTERMEDIATES = 15`; `_findDeepPaths` and the header renderer both reference them.
- **[minor] `_loadGlobalFilters` accepted non-string array elements** — now filters to `typeof s === 'string'` on both inc and exc, preventing a downstream `s.toLowerCase()` throw from a hand-edited value. `_applyGlobalFilterToItems` accepts an optional pre-loaded `gf` arg; `_fillInlineRefs` loads once and passes it in.
- **[minor] Editing global filters did not refresh open inline sections** — `saveGf` now iterates `this._inlineRefs` and re-fills each live entry after saving.
- **[minor] Suggested connections: WB State records, journal pages, and already-outbound records could be suggested** — `_scoreSuggestedConnections` (signature extended with `rguidIndex`) now skips WB State records by name, journal pages via `getJournalDetails`, and candidates the target already outbound-refs (detected via `rguidIndex.get(targetGuid)` line scan).

## v3.60.0 — 2026-07-08

Three new features:

- **F1: Deep connections (transitive backlinks).** A lazy "Deep connections -- scan" collapsible subsection at the bottom of every inline Linked-References section for RECORD targets (mirrors the v3.56.0 unlinked-mentions subsection pattern exactly). On click, a single registry pass builds reverseRefIndex + rguidIndex, then BFS backward from the target at depth 2 finds 2-hop paths (source -> intermediate -> target). Direct (1-hop) references already shown in the main section are excluded. Edge types: ref-chip edges (lines whose ref segments point at the frontier record or any line owned by it, resolved via the registry rguid) and property edges (SDK getBackReferenceRecords, feature-detected). Paths capped at 40 total, intermediates at 15. Excludes Workbench State records and journal-to-journal-only paths (journal SOURCE lines are kept -- the motivating example is a journal task -> Rich Task record -> EMP project). Renders each path as: source line snippet (clickable, jumps to the source line) + muted path trail (-> IntermediateName -> via PropName ->) with clickable intermediate. Grouped by intermediate when > 6 paths share one. Kill-switch: `custom.deepConnections = false`. Gated on record targets only (line targets have no property backrefs to traverse).
- **F2: Suggested + manual connections.** Computed from the same registry pass as F1, a second pass scores co-references: for each candidate record, count distinct records that reference BOTH the candidate and the target. Score >= 2 qualifies; top 10 shown. Each row: record name, "N shared references", optional graph button (feature-detect `window.__refgraph`), "Connect" button. Connect appends "Related: [[chosen]]" to the target record body via `createLineItem + setSegments` (never touches existing lines), with a duplicate guard (toasts "Already connected" if a ref to that record already exists anywhere in the target). After connect, the section auto-refreshes. A manual "+ Add connection..." row opens a synthetic `[[` picker (same flow as the palette "Insert mentions" command). Global filter note in the header shows "global filters active (N)" and is clickable to open Settings.
- **F3: Global reference filters (Roam parity).** Settings modal gains a "Global reference filters" section: two token lists (Include / Exclude) of page names or #hashtags, persisted in localStorage (`refx_global_filters_v1`, JSON `{inc:[], exc:[]}`), editable via text input + x chips. Semantics: every inline Linked-References section applies global filters ON TOP of per-section chip filters -- a row survives only if it matches ALL includes (when any) and NO excludes, testing the row's source page name and hashtags. When active, a subtle teal "global filters active (N)" pill appears in section headers, clickable to open Settings. Count badges are NOT filtered (filtering is a view concern; counts stay true).

## v3.59.0 — 2026-07-08

Review-fix batch (v3.58.0 code review):

- **Fix (major)**: `setCachedCountInfo` now persists `sdkPropCount` and `getCachedCountInfo` returns it, so the "M via properties" tooltip suffix is stable across cached re-renders instead of disappearing after the first paint.
- **Fix (major)**: `sdkPropCount` in the count cache is now the post-dedupe SDK-only count (`sdkOnlyCount` from `combineLinePropertyAndSdkCounts`) rather than the pre-dedupe `recordGuids.size`, so the tooltip arithmetic matches the displayed count.
- **Fix (major)**: Fallback path (Backreferences absent) in `loadSdkPropertyBackrefCount` and `_querySdkPropertyBackrefs` now filters candidates via `_propNamesReferencing`, so only genuine relation-property sources are counted/shown — prevents line-ref sources from inflating the "via properties" figure.
- **Fix (major)**: In `_fillInlineRefs`, the SDK section query now runs BEFORE the empty-state early return and before building the header total, so a record referenced ONLY via relation properties no longer shows "No referencing lines found." with a non-zero badge, and the header count includes `sdkSection.length`.
- **Fix (minor)**: `setPropRefsEnabled` now re-fills all open inline sections after toggling, so the "Via property" group appears / disappears immediately without requiring the user to close and reopen the section.
- **Fix (minor)**: Badge tooltip em dash restored: `--` → `—` in `formatBadgeTooltip` (all three badge tooltip variants).

## v3.58.0 — 2026-07-08

**Unified reference count — property backrefs from the Backreferences plugin**

- **(a) COUNT**: For record targets in `combined` count mode, badges now include references via relation properties. Prefers `window.__thymerBackrefs.getPropertyBackrefs` (the Backreferences plugin's SDK export) when present; falls back to `rec.getBackReferenceRecords()`. A record appearing via two different properties counts once; a record that also line-refs the target adds a count (different reference kinds, Roam semantics). The component rides the existing count cache (invalidation-driven TTL, no per-render calls).
- **(b) SECTION**: The inline Linked References section for record targets gains a **"Via property"** group after the existing property-references group, rendered as card-style rows (record name + muted "via PropName, PropName" suffix, click navigates). Deduped against the already-shown line-ref and local-prop-index rows.
- **(c) SETTINGS**: New **"Count property references (relation backrefs)"** toggle (default ON) in the Settings palette modal. Persisted as `refx_prop_refs_v1`. Toggling clears the count cache so badges refresh live.
- **(d) TOOLTIP**: Badge tooltip now appends `(M via properties)` when the property-backref component contributes to the total, e.g. `5 references to Foo -- click to view (2 via properties)`. Line-end target badges use the same logic.

## v3.57.0 — 2026-07-08

Review-fix batch (all findings from v3.56.0 code review):

- **[blocker] F3b flags leak on picker cancel** — `_pendingMentionsPin` / `_pendingEmbedHost` are now cleared in `_exitLinkMode` (not only on a successful pick of the matching kind). A cancelled palette flow can no longer hijack the user's next genuine `[[` / `((` pick.
- **[blocker] F3b typed query injected into document** — palette-opened pickers (Insert mentions / embed) now mark `link.synthetic = true`. In synthetic mode `_linkKey` intercepts printable keys and Backspace with `preventDefault` so the query never reaches the editor. Auto-close ghost is skipped (`_showAutoClose`) for the same reason. The unused `hostSt` variable is removed from the mentions interceptor path.
- **[major] Word-boundary guard for unlinked mentions** — scan filter and `_spliceRefOverPhrase` now accept a match only when adjacent characters are non-alphanumeric (`\p{L}\p{N}` Unicode regex). `_spliceRefOverPhrase` scans forward to the first boundary-clean occurrence rather than taking the first `indexOf` hit; also verifies the original-case slice equals the lowercase phrase (guards length-changing `toLowerCase`).
- **[major] Gate/splice text-model divergence** — `_linkUnlinkedHit` now uses the splice's flat-text model (non-text segs → `' '`) for the gate check instead of `_cleanDisplayText` (which renders ref chips as alias titles). Splice no-change returns `segs === result` which maps to `return false`, preventing the "row dims, button shows ✓, no ref inserted" phantom success.
- **[major] F2 chip overflow toggle nonfunctional** — `const cap = entry.chipOverflowOpen ? Infinity : 12;` (was unconditionally `12`). The `+N` button now actually reveals the hidden chips.
- **[major] F1 "Scan next 30" dead code removed** — `scanState.offset` is never incremented so `hits.length > 30` was unreachable; the stub handler's "All results shown" message confirmed it. Removed the dead branch; CHANGELOG corrected to remove the "Scan next 30 continuation" claim.
- **[minor] `_spliceRefOverPhrase` insert-once guard inverted** — was `!s._unlinked_placeholder` (always true for the freshly inserted ref), now `s._unlinked_placeholder` (detects the own insertion correctly, preventing double-chip on adjacent text runs).
- **[minor] F3a path-variant breadcrumb lifecycle** — dropped the `prevEnabled` temp-flag flip. `_attachBreadcrumb` now checks `this._variants.get(lineGuid)?.variant === 'path'` as an override of `_breadcrumbsEnabled`. `_setEmbedVariant` removes the forced crumb entry when leaving 'path' with global breadcrumbs off.
- **[minor] Dead code removed** — unused `newSegs` / `before` / `after` block in `_linkUnlinkedHit` (the splice result was already computed by `_spliceRefOverPhrase`); unused `hostSt` in `_pickLink` mentions interceptor.

## v3.56.0 — 2026-07-07

Three new features:

- **F1: Unlinked mentions (Roam Unlinked References + Alias Finder).** A lazy "Unlinked mentions -- scan" subsection appears at the bottom of every inline Linked References section. Collapsed by default -- no scan runs until clicked. On first click, builds a phrase set from the target's display name plus any alias titles found on existing ref segments, then searches the workspace via `searchByQuery`. Already-linked lines and the target's own lines are excluded. Results render with an amber "unlinked" pill, per-row "Link" button, and a "Link all (N)" header action. Max 30 per batch. Link action splices a `ref` segment over the matched phrase in-place (`_spliceRefOverPhrase` / `_linkUnlinkedHit`), word-boundary-guarded, caret-line guarded. Configurable via `custom.unlinkedMentions` (default true).
- **F2: Include/exclude filter chips.** A frequency-ordered chip row of source pages and hashtags appears between the inline refs header and body. Click to include; Shift+click to exclude; click again cycles include -> exclude -> clear. Capped at 12 with a "+N" overflow toggle. State (`chipFilters` Map, `chipOverflowOpen`) lives on the entry object. Chip filtering composes with the existing substring search box; re-render uses stored raw data -- instantaneous, no re-query.
- **F3a: "path" embed-display variant.** A third `refx_variant` value `"path"` joins "full" and "children". When active, the embed shows a forced breadcrumb header (`.refx-embed-path > .refx-breadcrumb { display:flex!important }`) plus the full body -- breadcrumb visible even when global breadcrumbs are disabled. Persists in `refx_variant` meta. Reference right-click menu gains "Embed display: path (breadcrumb + body)" as a third option.
- **F3b: Palette commands for mentions + embed insertion.** Two new command-palette entries: "Insert mentions block here" (opens `[[` picker, on pick pins an inline refs section on the caret line via existing `_applyPins`/`_writePinMeta`) and "Insert embed here" (opens `((` picker, on pick calls `_bridgeCreateEmbed`). One-shot `_pendingMentionsPin`/`_pendingEmbedHost` flags are intercepted at the top of `_pickLink` before normal splice flow.

## v3.55.0 — 2026-07-07

Two Workbench quality-of-life improvements:

- **WB body fold twisties (Task 1).** Inside an expanded Workbench item whose transcluded body has nested lines (parent lines with children), a small `▸/▾` button now appears at left-40px from each parent line's stable `.line-div`. Click to fold/unfold: descendant rows get `refx-wb-foldhide` (`display:none`) scoped strictly to that transclusion body; state is session-only. Twisty nodes are kept alive by the WB panel observer (line-div swap re-appends them pre-paint, exact same pattern as checkbox overlays). Caret-safe: nothing enters the editable `.lineitem-text` flow.
- **Zero-delay propcard on WB expand (Task 2).** The 180-220ms gap between "body un-hides" (4ms) and "propcard appears" (180-220ms) is eliminated. Root cause: `_wbLiveSyncPropCard` blocked card creation with `!it.collapsed`, so expanding triggered `_wbLiveScheduleRefresh` -> `_wbLoadLive` (~80ms `getLineItems`) -> `_wbLiveSyncPropCard` -> `_attachPropCard`. Fix: remove the `!it.collapsed` guard so cards build while the item is still collapsed (hidden by CSS rule `.refx-wb-item.refx-wb-collapsed > *:not(.refx-wb-hdr) { display: none }`). On expand the class lifts and the pre-built card is immediately visible. A `_scheduleAlign` call on expand re-computes the card's left/right margins with real rects (they were 0 while hidden).

## v3.54.0 — 2026-07-07

Two follow-ups on the v3.53.0 Workbench work (both root-caused in code from the user's repro):

- **WB fold/unfold "flash then revert" fixed.** The v3.53 optimistic toggle applied instantly, but the debounced `_wbLiveRefresh` re-reads `refx_collapsed` from the line's PROPS — and the `setMetaProperty` write propagates slower than the 120ms refresh, so a stale read re-applied the old state over the optimistic one (also hiding the freshly attached property card, which read as "properties still lagging"). New `_wbPendingCollapse` override: the intended state wins in `_wbLoadLive` until the meta read-back CONFIRMS it (or 8s expiry).
- **Post-Enter caret jump to the first WB item fixed.** `_wbFocusFix` (the v3.48 split-focus corrector) fired on our own SYNTHETIC focus click after Enter-created children; at settle time the thread-target still pointed at the previous caret line in the main panel, so the "fix" hit-tested the caret over there. It now ignores untrusted events entirely, and `_wbCreateSiblingBelow` arms a 1.5s suppress window around its programmatic focus placement.


## v3.53.0 — 2026-07-07

Five live-diagnosed fixes (all root-caused via instrumentation on svyat.thymer.com):

- **Checkbox overlay stops blinking.** Root cause: `isLikelyReferenceElement` contained a `cls.includes('lineref')` guard that returned `false` for any element whose class string contained the substring "lineref". Line-ref chips (class `lineitem-ref refx-lineref-chip`) tripped this guard, so `collectReferenceTargets` excluded all task-ref chips from `refs`. `scanChipTaskGlyphs` iterated an empty set, the `keep` set stayed size 0, and `removeOrphanChipTaskGlyphs` swept every overlay. The `lineref` substring check was redundant for its original purpose (`.lineitem-lineref` arrow icons are also caught by the adjacent `link-menu-opener` check). Fix: scope the `lineref` guard with `&& !el.classList.contains('lineitem-ref')` so it only excludes non-chip elements.
- **Workbench collapse/expand is now instant.** The 200-300ms perceived latency was entirely due to the absence of any DOM feedback before the async `_wbLiveRefresh` cycle (gated on `rec.getLineItems()` ~80ms). Fix: `_wbLiveToggleCollapse` now performs an immediate optimistic DOM update -- toggling `refx-wb-collapsed` on the transclusion node and flipping the chevron text -- before awaiting `setMetaProperty`. The full refresh still runs for state consistency; the user sees the visual change in 0ms.
- **WB Enter on the root line now creates a CHILD (not a sibling above scope).** When the caret was on the transcluded root line, the old code resolved the root's parent and called `createLineItem(parent, root, "text")`, inserting a sibling of the root -- outside the transclusion's visible scope. Fix: detect the root case by walking `.listitem-transclusion[data-guid]` -> `slotSt.props.itemref` and comparing to `hit.lineGuid`. If on the root, call `createLineItem(li, null, "text")` (first-child) so the new line appears immediately below the root text inside the WB view.
- **Auto-close ghost: higher contrast + zero-frame lag.** Opacity raised from 0.45 to 0.9; `color` now tracks `--color-text-400` (semantic main-body token) and is also copied from the live `.lineitem-text` computed style at creation. The `pos()` function is extracted and called synchronously before the rAF loop so the ghost is positioned on frame 0 instead of frame 1. Each printable keydown also synchronously updates `left/top` so the ghost never trails a frame behind fast typing.
- **Preview pane now shows children for search-phase results.** Root cause: `consider()` in `_runLinkSearch` did not store `rguid` on result objects. In `_fillLinkPreview`, `rguid` was resolved via `g_universe.itemsByGuid[result.guid]?.rguid` -- which is null for cold (search-phase) lines not yet loaded. `this.data.getRecord(undefined)` returned null and the entire async children/ancestor block was skipped. Fix: add `rguid` as a 6th parameter to `consider()` and pass it from both the registry scan and search phase call-sites. `_fillLinkPreview` now falls back to `result.rguid` when the registry lookup misses. Children are wrapped in `.refalias-preview-children-wrap` (border-left indent guide); target gets a bold weight and accent left border; ancestor rows are muted and smaller.

## v3.52.0 — 2026-07-07

Hands-on fix round (all five reported issues live-diagnosed):

- **Checkbox at the NATIVE position.** Measured live: a native task line's `.line-check-div` sits 16px wide at exactly `lineDiv.x − 25`, replacing the bullet visually. The leading checkbox overlay now uses that exact offset (`left: −25px` from the line-div, z-index 25 to paint over the rainbow marker dot) whenever the ref chip is the first content of its line and the row has no native checkbox of its own. The v3.50 `spaceLeft >= 20` condition could never pass — the line-div starts AT the chip, so the gutter is outside the host box; positioning is now allowed to go negative (host doesn't clip, verified).
- **Auto-close brackets REDESIGNED as a caret ghost.** The v3.51 document-write approach was architecturally impossible: while the picker is open the editor holds the freshly-typed `((` UNCOMMITTED — the model registry provably lacks it for seconds — so `setSegments` fought the editor's state and never survived a frame (measured live), and the verify step read the stale registry anyway. The closing `))`/`]]` is now a fixed-position ghost overlay glued to the painted caret (per-frame reposition, editor font-matched, removed on pick/abort). Zero document writes, zero cleanup, zero corruption risk. Typing the closing char while the picker is open is swallowed (Roam type-over). `custom.autoCloseBrackets: false` still disables.
- **Workbench "typing next to a link jumps a little".** The v3.46 no-in-chip-badge gate only covered main-document chips; WB/transclusion chips (whose bodies are EDITABLE — the whole point of the Workbench) still got wrap nodes re-created by the debounced scan ~180ms after each keystroke — sporadic node insertion into an editable chip, the exact caret-disruption mechanism of the v3.44–47 saga. The gate now covers every chip in overlay mode; embedded/WB copies no longer show in-chip counts (the main document does).
- **Workbench Enter creates a line now.** Native Thymer drops structural edits inside transclusion renders (typing works, Enter doesn't). Plain Enter with the caret inside a WB item body is intercepted and the sibling line is created in the SOURCE record via the data API, then focused inside the WB copy. Scoped strictly to the Workbench panel; main-document embeds keep native behavior.
- **Property-card delay eliminated for real.** The residual delay was the `await rec.getLineItems()` body-empty probe blocking every render (even cache hits). Cards now render immediately; the "＋ Add content" banner attaches asynchronously if the probe finds an empty body. Additionally the counter scan prewarms the field cache for every record-ref chip it visits, so even the FIRST Cmd+Down expand of a never-opened record renders its card instantly.
- **Ctrl-O preview polished toward Roam**: wider reading panel with its own background and divider, bold page-title header with rule, wrapped (never clipped) text, bulleted ancestor/child outline rows, soft rounded highlight on the target block. Ghost + preview both theme-token based.

**Part 1: Roam-style auto-closing brackets.** Typing `((` now immediately appends `))` (or `[[` appends `]]`) so the picker opens inside `(( ))` / `[[ ]]` with the caret between them — matching Roam's behavior. The insert is a WRITE+VERIFY+RETRY (3 attempts, 220 ms settle) async to the main `_enterLinkMode` call; on success `link.closingPair` is set and all downstream paths consume the full form. `_findBracketRange` accepts an optional fourth `closingPair` param and tries `br+query+closingPair` first (backward scan finds the most-recent trigger) before falling back to the bare forms; `_abortLink` and `_pickLink` both pass `link.closingPair`. Escape removes `br+query+))`; Backspace-with-empty-query also removes both trigger and closing pair (event is prevented and `_abortLink` is called instead of `_exitLinkMode` when `closingPair` is set, so the editor does not double-delete). Gated on `custom.autoCloseBrackets` (default `true`).

**Part 2: Picker footer bar.** The `((` / `[[` picker popup now shows a compact muted footer: left side shows "Block search" (for `((`) or "Page search" (for `[[`); right side shows "Preview Ctrl-O  Insert reference ⏎" keyboard hints -- matching Roam's picker footer. Pure DOM addition inside a new `.refalias-linkbody` wrapper div (list + footer); zero impact on the results list or search logic. CSS classes: `.refalias-linkbody`, `.refalias-linkfoot`, `.refalias-linkfoot-label`, `.refalias-linkfoot-hints`, `.refalias-linkfoot-kbd`.

**Part 3: Ctrl-O preview pane.** Pressing Ctrl+O (Cmd+O on Mac) while the picker is open toggles a 300px preview pane to the right of the results list. The preference persists for the session (`this._linkPreviewOn`). For `((` line results: shows record name header, then the full ancestor chain (walked from `parent_guid` via `getLineItems()` tree, depth cap 12) with progressive indentation, then the target line highlighted, then up to 30 child lines (depth 3). For `[[` record results: shows record name + first 10 top-level body lines. All body content is async (placeholder `…` renders immediately; the full tree fills after `getLineItems()` settles). Stale async fills are guarded by a per-call `_previewToken` so only the current selection wins. Clicking anywhere in the pane picks the result. The popup widens to flex-row when the pane is shown and clamps its left position via a `setTimeout(0)` so it never overflows the viewport right edge. CSS classes: `.refalias-linkpop-with-preview`, `.refalias-linkpreview`, `.refalias-preview-recname`, `.refalias-preview-target`, `.refalias-preview-anc`, `.refalias-preview-child`, `.refalias-preview-line`, `.refalias-preview-loading`, `.refalias-preview-empty`, `.refalias-preview-more`.

## v3.50.0 — 2026-07-07

**Bug 1 fix: checkbox overlay now appears at the FRONT on task lines (and all normal lines).** Root cause in v3.49: condition 2 (`noNativeCheck`) in `_positionCheckOverlay` forced trailing-slot placement whenever a native `.line-check-div` was present on the same `.listitem` — meaning a reference chip on a task line always landed in the trailing slot even when it was the first content of the visual line. The trailing position could fall outside `.line-div`'s content box on narrow layouts, making the overlay effectively invisible. Fix: drop condition 2. LEADING is now the default when (1) the chip is the first content of its visual line and (2) >=20px of space exists left of the chip inside the host rect. The leading position is CLAMPED — never left of the native `.line-check-div` right edge + 2px, never left of the host rect left — and the caret rule is enforced: if `clampedBx + 16 > chipTextStartBx - 2` (overlay would overlap chip text), fall back to the trailing slot. This means task lines where the native checkbox sits to the left of `.line-div` naturally clamp and then fall through to trailing (safe, visible), while non-task lines with ample leading space get the intended leading position.

**Bug 2 fix: property card fold chevron now works in the Workbench.** Root cause: `_renderCardInto`'s morph-in-place path (`existing.replaceChildren(...cardEl.childNodes)`) moves the freshly-built child nodes — including `foldCaret` — into the existing card DOM node, but the `toggleFold` closure still captured the LOCAL `card` variable (`cardEl`), which becomes detached from the DOM after the move. Toggling a class on a detached element is a no-op. Fix: `toggleFold` now resolves the live card at click time via `foldCaret.closest('.' + this._CARD_CLASS)`, which always returns the node currently in the DOM regardless of whether it arrived via fresh insert or morph-in-place.

**Bug 3 fix: first-unfold property card now renders instantly (prewarm).** Added `_scheduleCardFieldsPrewarm(guids)`: an idle 300ms `setTimeout` that calls `_recCardFields(rec)` for up to 30 record guids not yet in `_cardFieldsCache`. Called (a) at the end of `_wbLiveRefresh` for all WB item record targets (collapsed or not), and (b) in `_onNavigated` after `_reattachAllCards` for main-doc embed records. Because `_recCardFields` populates the cache as a side-effect, the next unfold / attach finds a cache hit and renders synchronously with no Loading... flash. The timer is cancel-safe (a newer call replaces the pending one) and cleared in `onUnload`. Cap: 30 guids per pass to keep the idle task cheap.

## v3.49.0 — 2026-07-07

**A: Adaptive leading checkbox placement.** The task-checkbox overlay now places itself LEADING (before the chip text, like a native Roam checkbox) when all three conditions hold: (1) the chip is the first content of its visual line (chip left edge within 4px of the `lineitem-text` content-box left), (2) the row has no native `.line-check-div` occupying that zone, and (3) there is at least 20px of space left of the chip inside the host row rect. Otherwise the existing trailing-slot placement is used (unchanged). The decision is stored on the registry entry (`e.leading`) and the rAF loop positions CHECK overlays first so the decision is fresh when `_positionOverlay` reads it to decide whether to shift the count digit right past a trailing checkbox (`e.leading !== true` guard). Leading checkbox: vertically centred on the chip's FIRST client rect; trailing: centred on the LAST rect (unchanged). All overlay geometry is zero-layout (position:absolute on the stable `.line-div`); the caret rule is not affected.

**B: Roam-style `((` line-reference appearance.** Line-ref chips (target is a line, not a record) receive class `refx-lineref-chip` (zero-geometry, caret-safe). The class is applied in both the full counter scan and `rescanLines`, and kept alive in `_adoptDecoratorsOnLines` on every caret-line rebuild. Gated on `body.refx-roam-linerefs` (Settings toggle "Roam-style line references", default ON, persisted as `refx_roam_linerefs_v1`). CSS: color/background/box-shadow/text-decoration only -- no padding, border, or font-size. The chip shows as plain text with a subtle inset bottom shadow (`box-shadow: inset 0 -1px 0 rgba(136,153,168,.55)`) instead of Thymer's native blue underline link look; hover tints with `--sidebar-bg-hover`. Live computed facts used: native chip has `textDecorationLine: underline`, `color: rgb(28,60,102)`, `backgroundColor: transparent`, `boxShadow: none` on Blueprint-light -- all overridden by the Roam-style rules. `box-shadow inset` is used instead of `border-bottom` because border adds geometry.

**C: Transclusion inserts as FIRST child (Roam behavior).** `_expandRef` previously inserted the embed as the LAST child of the host block (`after = kids[kids.length - 1]`). Changed to `after = null` (first child). Semantics confirmed: the empty-children branch of the old code always passed `null` and produced a first-and-only child, proving that `createLineItem(parent, null, ...)` = "insert as first child of parent". `_expandRefFromQuery` (query-row parking, `after = qline`) and `_addChildToLineEmbed` (last-child append) are intentionally unchanged.

**D: Property card fold toggle.** A chevron caret (`.refx-card-fold`, `ti-chevron-down` / `ti-chevron-right` -- both bundled) appears at the start of the `.refx-props-header` row. Click (or Enter/Space in keyboard nav) toggles `refx-card-folded` on the card element; CSS hides `.refx-native-props`, `.refx-propcard-empty`, and `.refx-propcard-addbody` when folded (`display:none`). Fold state is stored in the `_cards` entry (`entry.cardFolded`) so re-renders survive. New `_cardFoldedDefault()` helper reads `refx_card_folded_default_v1` (default OFF). Settings modal gains toggle "Property cards start folded". Keyboard nav: `.refx-card-fold` is nav stop 0 (before the mode chip); `_cardNavItems` filters hidden elements (`offsetParent === null`) so folded cards expose only fold caret + mode chip. Activating the fold stop dispatches a click on the caret. New `_cards.set` call sites pass `cardFolded: this._cardFoldedDefault()` for fresh embeds.

## v3.48.0 — 2026-07-07

**Bug D fix: Enter and Tab now work inside Reference Workbench transclusion bodies.** Root cause: when clicking into a WB transclusion whose source line is also visible in the main panel, Thymer routes the caret to the main panel (canonical location) but gives `focused-component` to the WB panel (which received the mousedown). In that split state -- WB is `focused-component` but has no caret -- Enter/Tab were silently dropped. Fix: a capture-phase `mousedown` listener on window detects the split (WB has `focused-component`, `flowythymer-thread-target` is in a different panel) and re-fires a trusted pointer sequence on the thread-target's `.lineitem-text` via `_hitTestCaret`, which re-routes `focused-component` to the panel that owns the caret. This is a workaround for a Thymer-native focus routing edge case, not a plugin bug. Zero impact on non-split clicks (header clicks, card clicks, already-correct-focus clicks are all excluded by the target guards).

**Bug E fix: property card appears immediately on Workbench item unfold (no lag).** Two parts:
- `_recCardFields(rec)` is now memoized per `rec.guid` in `_cardFieldsCache` (LRU-capped at 200 entries). On cache hit the expensive synchronous property enumeration is skipped entirely; the result is served immediately. Cache is invalidated per record on `record.updated` events, and fully cleared on `_buildFieldTypes` schema rebuild. A background `_refreshCardInPlace` always runs after serving from cache to pick up any value changes.
- `_wbLiveToggleCollapse` now calls `_attachPropCard` directly when expanding (not only via the 120ms debounced refresh), so the card renders without waiting for the next refresh cycle.

## v3.47.0 — 2026-07-07

**Caret-jump: THE definitive fix (root cause measured live, per painted frame).** v3.46.0 removed every node from the editable chip, yet the painted caret still lagged. Per-frame measurement of Thymer's caret element (`.listview-caret-self`) against the true text end nailed it: **Thymer computes the painted caret x per keystroke from the line layout BEFORE our keep-alive re-adds the class Thymer just wiped — so the v3.45/46 class-keyed `padding-left: 18px` gutter shifted the text +18px under a caret that only recomputes on selection changes** (measured: painted caret exactly 18px left of the true position after typing right after a chip; ArrowRight snapped it back to correct). Rule extracted: NEVER key GEOMETRY of the editable line on a per-chip class — Thymer wipes per-chip classes every keystroke and the caret paint races the re-add. Only body-class-gated native selectors (the count-slot `body.trc-zerolayout` lesson) or out-of-flow overlays are safe.

- **The in-document checkbox is now an overlay node on the stable `.line-div`** — the count-badge overlay pattern verbatim (`_syncCheckOverlay` / `_positionCheckOverlay` / `_liveCheckOverlays`, shared reposition rAF, sync pre-paint re-append keep-alive, viewport cull, panel-scoped orphan sweep, adoption). It paints into the chip's EXISTING 36px trailing slot (before the count digit, which shifts 18px right when a checkbox shares the chip). ZERO nodes, classes, or geometry inside the editable flow.
- The node carries `.refx-chip-task` so the native-look visuals (16px, 2px radius, `--ed-check-*` tokens) and the existing click/toggle path are reused unchanged; `.refx-check-overlay` adds only positioning. Visual change: the checkbox now sits AFTER the chip text (in the slot, next to the count), not before it — the trailing slot is the only place with reserved, caret-safe space.
- v3.45/46 pseudo classes (`refx-has-check`/`refx-check-done`) fully retired; legacy strays stripped at scan time. `_paintChipTaskGlyph` no longer writes a unicode glyph char into node checkboxes (the box is CSS-drawn; the char double-painted).
- Other surfaces (inline linked-ref rows, count popover, Workbench) keep their in-flow node checkboxes — they are not in the editable document.

**Caret-jump root cause, part 2 (live-isolated): the in-chip COUNT-BADGE node.** After v3.45.0 removed the checkbox node from the editable chip, typing after a checkbox line-ref still landed the cursor one position back. Live isolation (keep-alive disconnected + in-chip badge wrap removed → caret held perfectly) proved the remaining disruptor was the `.trc-refcount-badge-wrap` NODE: the decorator keep-alive re-inserted it into the rebuilt editable chip on every keystroke — a childList mutation inside the editable region that collapses the selection. In overlay mode the node was dead weight anyway: its digit is CSS-hidden and the `.line-div` overlay paints the count and owns clicks.

- **Overlay mode (default): in-document editable chips carry NO in-chip badge node at all.** `upsertBadge` skips wrap creation for them (and removes legacy strays); the keep-alive's chipBadge re-insert loop and `_adoptDecoratorsOnLines` adoption are gated off in overlay mode; `removeOrphanBadges` no longer strips the anchor slot classes from an active wrap-less anchor (the overlay's reserved slot padding must survive). Anchor classes are attribute writes — proven harmless to the caret.
- Transclusion/Workbench chip copies keep the in-chip wrap (overlays skip those surfaces, so it is their only count display). Legacy inline (non-overlay) mode is unchanged.
- Checkbox stays class+pseudo (v3.45.0) — class re-application by the keep-alive is attribute-only and does not disturb the caret.
- Fixed the stale `window.__REFX_VERSION` banner (stuck at "3.43.0" through two releases).

## v3.45.0 — 2026-07-06

- **Bug fix: caret-jump on typing after a task-ref chip (definitive fix).** The v3.44.0 attempt (absolute-positioned `contenteditable=false` node inside the chip) did not fix the bug: an absolutely-positioned node is still a child of the editable region and still counts as a caret position in Chromium. The root cause was confirmed live — removing the node from the DOM entirely stopped all caret jumping. The definitive fix draws the checkbox as a CSS `::before` pseudo-element on the chip element itself (class `refx-has-check` on the `.lineitem-ref` chip, plus `refx-check-done` for the done state). A `::before` pseudo has no DOM node and therefore can never be a caret position, guaranteed. The `::before` is absolutely positioned in the same 18px left gutter, with identical visual tokens and dimensions as v3.44.0. The keep-alive system stores the chip element in `_liveGlyphs` (`pseudo: true`) and re-applies classes to the new chip on Thymer's per-keystroke chip rebuilds instead of reinserting a node. Other surfaces (inline linked-ref rows, count popover, Workbench) still render real `.refx-chip-task` DOM nodes — those are not in the editable document and never caused caret jumps. Click handling for in-document chips uses a gutter coordinate gate (`clientX <= chip.left + 18`) instead of `closest('.refx-chip-task')`.

## v3.44.0 — 2026-07-06

- **Bug fix: Rich Task / Events property cards no longer show "No properties".** `_isUserField` regex changed from `/^F[0-9A-Z]{8,}$/` to `/^[Ff][0-9A-Z]{8,}$/` — the uppercase-only leading char silently discarded every lowercase-`f` field id used by plugin-managed collections (Rich Tasks `18VFNSQGGGX81C1SEB322Q5GKC`, Events `155TKGTX2AT1BATTYWBNM3BJ2T`). Mixed-case collections (People, Projects) were also partially broken. System fields (title, collection, banner, icon, created_at, updated_at, updated_by) all use lowercase-word ids without the 8+ uppercase-alnum body, so they still pass through the filter correctly.
- **Bug fix: caret no longer jumps when typing after a line-ref that has a checkbox.** The `.refx-chip-task` glyph is now absolutely positioned inside a relative-positioned `.lineitem-ref:has(> .refx-chip-task)` chip (reserved left gutter of 18px). Previously the glyph was a `contenteditable=false` inline island as the first child of the ref chip; Thymer rebuilds the caret line's chip DOM on every keystroke, and re-inserting a c-e=false inline element made Chromium collapse the selection, causing the caret to jump. An absolutely-positioned element is invisible to the inline text-flow and cannot anchor the caret. The checkbox remains visible, clickable, and non-shifting on all non-edited lines.
- **Checkbox glyph restyled to match Thymer's native `.line-check-div`** — 16px square (was ~13px), 2px border-radius (was 3px), 1.11px border, box-sizing border-box. Unchecked = transparent fill with the gray native border token `--ed-check-div-border` (rgb(171,179,191)); done = green fill via `--ed-check-done-bg` (#238551) with border `--ed-check-done-border` and a white check `--ed-check-done-fg` (previously hardcoded blue `--button-primary-bg-color`). Hover/focus use the native `--ed-check-div-hover-border`. All tokens carry hardcoded fallbacks so the glyph tracks the active theme instead of a fixed color. The reserved left gutter widened 1.3em → 18px to fit the larger box without overlapping the title text.

## v3.43.0 — 2026-07-05

**Upstream v3.1.0 port (parham-shafti `b559a73`), hand-merged onto our v3.42.0** — all our v3.x layers (Roam-parity refs, counter, Workbench, overlay badges, breadcrumbs, add-content banner) preserved.

- **Live-search transclusions (new).** Cmd/Ctrl+Down on a live-search / query result expands it in place as an inline transclusion parked right under the result row (the embed line is created on the host page after the query block — query blocks can't render children — and its node is re-parked across re-renders by the card observer). Empty results open too, with a zero-jump writing strip at the bottom to add indented content. Page refs inside a result expand nested; a result that is itself a page gets the editable property card. Cmd/Ctrl+Up on the result collapses. Embeds re-register after reload via `refx_at`/`refx_from` line meta.
- **Editable image/file properties.** Image properties render the actual image (blob GUIDs resolve async via `prop.fileBlob().download()` into cached object URLs; paperclip chip meanwhile and for non-image files) instead of "[object Object]". Click the image or pencil to replace/add via the OS file picker (`uploadBlob` → `setFileFromBlob`); right-click for Open image (in-app lightbox), Download, Delete (`removeValue` — the only clear that lands on file props).
- **URL properties.** Click a URL value to open it in the browser, like native; editing stays on the pencil/cell.
- **Property-card polish.** Rows show each field's own native schema type icon (from collection config `f.icon`) instead of a generic one; long text values wrap over lines; choice pills render in their real palette colour (Thymer's own 15-colour enum table, index-mapped) with the option's icon; card colours/radius now come from the native `--ed-container-*` vars + a `data-theme` observer, so theme switches re-fuse live.
- **Inline transclusion fixes.** Empty embeds are a stable click-to-type area (capture-phase dead-space interception — no caret dance, min-height reserves one line so nothing jumps); Cmd/Ctrl+Up no longer hijacks the native fold-indent chord inside an embed body (gating is now model-registry-based: only the ref's own line or the embed line itself collapse); collapsing can't leave fold dots (line-level fallback collapses ALL our embeds under the line); expanding onto a natively-folded host line auto-unfolds it; on a multi-ref line Cmd+Down expands the next unopened ref when the nearest guess is already open.
- **Reference / picker fixes.** `[[`/`((` inserts are write+verify+retry (a single write raced the editor's flush of freshly-typed text — "Referenced ..." with nothing inserted; the toast now reports the VERIFIED outcome). Relation picker: session-local optimistic `curList` owns the truth while open (remove-then-re-add works; a removed value can't resurrect from a stale `linkedRecords()` read), checked rows carry a native remove ×, optimistic row updates pass fresh pills (no stale chips), and "+ Create «query»" creates a record inline in the field's target collection (native anatomy, collection name right-aligned).
- **Deep line lookups everywhere.** `_findLineDeep` replaces top-level `items.find` in `_resolveRef`, `_pickLink`, `_abortLink`, `_collapseAtCaret` — and additionally in our own `_resolveRefAt`, paste-ref, and `_replaceWithEmbed` (same bug class: acting on a ref on an INDENTED line failed with "Couldn't find the line").
- **Observer fix (upstream).** The card keep-alive's cached-node re-insert now runs even while a popup editor is open — a relation write re-renders the transclusion node and wiped the card behind the still-open picker; re-inserting the same node can't disturb the popup. Only the rebuild path (and decorator adoption) still waits for the editor to close.
- Kept ours over upstream where ours is ahead: the keyboard-reachable "＋ Add content" banner for empty records (upstream removed theirs in favour of click-only), `_openRecord` routing through `_bridgeJump`, per-record armour in the relation picker, and the input-guard on cell clicks.

## v3.16.0 — 2026-07-02

Live-verification fixes for the v3.15.0 editable Workbench:
- **Fixed false "(target deleted)".** A valid workbench item whose target line lives in a record that isn't currently open was wrongly flagged dangling (registry-absence alone). Dangling now also checks whether the native transclusion actually rendered its content — if it did, the target exists, so it's never flagged. Only a genuinely unresolvable target shows "(target deleted)".
- **Removed the provenance clutter line.** The backing "Reference Workbench State" record no longer carries a "managed by the plugin, do not edit." body line (it was editable clutter, and could duplicate). The record's body is now purely the shelf's transclusion items; any legacy provenance line is swept once on load (after migrating its JSON).
- **Hardened workbench-panel identification.** `getActiveRecord()` can transiently return null; the panel is now found by a cached panel id (set at open) with active-record and DOM-class fallbacks, so the toggle/refresh/decorate can't lose the panel to a momentary null.


## v3.15.0 — 2026-07-02

**Reference Workbench — Roam's editable right sidebar.** The Workbench is now **natively editable**: every item opens as a real Thymer **transclusion** in the rightmost panel, so you click in and **type, add children, check tasks, edit properties** — all saved straight to the source, exactly like Roam's sidebar windows. No more read-only cards.

- **Backed by a record body.** The shelf's source of truth is the "Reference Workbench State" record's **body** — one `transclusion` line per item. Order = line order, so drag-reorder and content **sync natively across devices** (no JSON). The old localStorage/meta JSON shelf is **migrated once** into transclusion lines on first load.
- **Per-item header** (a decorator injected above each transclusion, kept alive across native re-renders like the property cards): **▾ collapse**, **📍 pin** (pinned items hold the top; new items land below), **⋯ view-as** — **Full (editable, default)** / **Children only** / **Card (read-only)** / **Linked references** — **⇱ swap to main**, **✕ remove**. Clicking the title jumps to source.
- **Filter box + count + Clear-all** in a sticky bar at the top of the panel (client-side, no re-query; Clear-all keeps pinned items on the first press).
- **Dangling items** (target deleted) show a "(target deleted)" header with a remove affordance instead of a broken embed.
- **Every entry point unchanged** — Shift+click a chip / page link / line bullet, Ctrl/Cmd+Shift+O, the reference menu's "Open in sidebar" / "Open linked refs in sidebar", the ⧉ in an inline section, and the "Add current line/page to Workbench" palette commands — only the storage moved to the backing body. The statusbar toggle opens/closes the rightmost native panel.
- **Speed & flexibility:** native editor virtualization + event-driven decorators (panel.navigated + record.updated on the backing record + a panel-scoped keep-alive observer) — no polling. Any item is convertible between the four views and back, per item (Roam shows one form per window). Because items are real transclusions, a Workbench item can itself be expanded, task-checked, get a property card, and be referenced.
- **`custom.workbenchMode`** (default `"live"`): set to `"cards"` to keep the previous read-only-card Workbench as a fallback for one release.

## v3.14.4 — 2026-07-02

Bug fix — property card vanished on a record embed whose body contains a datacore query:

- **Symptom**: Cmd+Down on a reference to a record whose body has a `dc:` (or `dc.js:` / `dc=`) line rendered "only the datacore query and nothing else" — the editable property card was missing.
- **Reproduced + traced live** (chrome-devtools): the card DOES attach and render correctly (title + property rows). The whole `.listitem-transclusion` embed then gets `display: none`. Root cause is in the **plexus-datacore** plugin, not this one: its embed poll scans every `.listitem[data-guid]`, reads the node's first `.listitem-text` as the "marker text", and collapses matches with `.pdc-marker-collapsed { display: none !important }`. Our transclusion WRAPPER contains the embedded `dc:` line as its first text descendant, so the scan mis-identifies the entire embed as a `dc:` marker line and collapses it — hiding the card, the breadcrumb, and the datacore all at once (it also mounts a stray duplicate datacore table as the transclusion's sibling; that stray is a separate plexus-datacore issue left for an upstream fix).
- **Fix (refx-side defense)**: a scoped CSS rule un-collapses any of OUR transclusions — `.listitem-transclusion.pdc-marker-collapsed:has(> .refx-propcard)` / `:has(> .refx-breadcrumb)` → `display: flex !important` — restoring the native `.listitem` display so the property card AND the datacore render together. Scoped via `:has()` to refx-decorated nodes only, so genuine `dc:` source lines still collapse as designed. Live-verified: card (Topic/Category/Source) and the "showing 21 of 21" datacore table both visible in one embed. The real cure is in plexus-datacore's scan (skip `.listitem-transclusion` wrappers); this rule makes reference-extravaganza resilient to the collateral collapse regardless.

## v3.14.3 — 2026-07-02

Bug fix — count badge on long/wrapping reference chips:

- **Chip count badge now flows IN LINE after the chip's last character.** It was `position: absolute` anchored to the chip's `position: relative` box (`right: 2.5px; top: 0`, or `left: 100%` when the chip carried the native ↗ arrow). On a long reference that wraps across multiple lines, those insets resolve against the chip's **multi-line bounding box**, so the badge landed at the box's top-right corner — floating far from the actual end of the reference text. Fix: convert `.trc-refcount-badge-wrap` to an in-flow inline superscript (`display: inline-flex; vertical-align: super`), modeled on the already-correct `.trc-target-badge-wrap`, so the count follows the chip naturally on any wrap. Preserved: the ≥16px padded hit area (rule 94 — the wrap stays the click target so `closest('.trc-refcount-badge-wrap')` still routes the toggle), ≥2px clearance from the arrow (now a `margin-left` gap instead of an absolute offset), hover-only/size/opacity classes, and the badge-click routing (toggles the inline references section, never navigates).

## v3.14.1 — 2026-07-02

Surgical correctness + lifecycle/perf fixes (no behavior change):

- **In-flight count placeholder no longer poisons `getCachedCountInfo`.** The pending-fetch placeholder used to carry `count:0`, so a synchronous cache read returned a phantom 0 and suppressed a real reference badge/chip. The placeholder now carries `{pending:true}` (no numeric count), `getCachedCountInfo` returns `null` for it, and `getCountInfoForGuid` checks the pending promise BEFORE the cache short-circuit so a placeholder never stands in for the real awaited count. Fixes intermittent (race-only) badge suppression when two panels' scans interleave.
- **Seed `_lineRefGuids` during the reference scan.** The first `lineitem.updated` per line used to diff against an empty prior ref set, so a same-event ref REMOVAL left the removed target's count badge stale until the 120s TTL. The scan now records each line's visible reference targets, so a first-edit removal is diffed correctly and the removed target's cache is invalidated immediately. (Seeding is additive and never overwrites the authoritative set the update handler maintains.)
- **Defer keep-alive `getComputedStyle` out of the MutationObserver microtask.** The card keep-alive re-inserts the cached node synchronously (zero-flash, unchanged) but now schedules `_alignCardToBody` — which calls `getComputedStyle` (a forced style/layout flush) — into a coalesced rAF instead of running it inside the pre-paint MO microtask on every container swap. One-frame margin/color settle; the node is already visible.
- **Sweep the two host `events.on` subscriptions on hot-reload.** `panel.navigated` / `record.updated` handlers are now window-stashed (`__refxHostEvents`) and `events.off`'d in `_killStaleObservers`, so an in-session PM reinstall (which re-runs `onLoad` without `onUnload`) no longer leaks a copy of `_onRecordUpdated` per reinstall (it streams per keystroke inside an embedded body).
- **Remove the hover-preview scroll-close listener on every close path.** The `once:true` scroll-to-close listener is now idempotently removed in `_cancelHover` (and thus on unload), closing the mouseout/unload teardown gap.

## v3.14.0 — 2026-07-02

Reference Workbench upgrades toward Roam's right sidebar:
- **Per-card ⧉ "open as native panel", remembered** — promote any card to a real Thymer panel; the Workbench reopens those panels next time it opens (remembered layout).
- **Full-width** cards fill the panel.
- **Renamed** the panel titlebar from "Custom Panel" to "Reference Workbench".
- **Synced across logins/devices** — the shelf's source of truth is a `refx_workbench` meta property on a "Reference Workbench State" record (meta syncs, never renders; not `saveConfiguration`, which would reload the plugin). localStorage stays a fast cache; one-time migration; 1s-debounced writes; flush on unload.
- **Shift+click any line's bullet** (not just a link/chip) sends that line to the Workbench — Roam parity. Text-span Shift+click stays the editor's selection-extend.

## v3.13.1 — 2026-07-02

**Statusbar toggle + always-rightmost dock (Roam's persistent sidebar toggle)**

- **Statusbar icon** (`ui.addStatusBarItem`, ti-stack, tooltip "Reference Workbench"), available on every view like Roam's top-right sidebar toggle. Click **toggles** the Workbench: open → the panel closes (the shelf in localStorage is untouched — reopening shows the same cards); closed → it opens. The icon is dim while the Workbench is closed and full-opacity while open, synced on the `_renderWorkbench` open path, the toggle's close path, and `panel.closed` (native ✕). Registered in onLoad, removed in onUnload; a hot-reload-leaked prior icon is removed via the `window.__refxWbStatusItem` stash in `_killStaleObservers`.
- **Always-rightmost dock**: the Workbench panel now opens after the LAST panel (`createPanel({afterPanel})`), so it docks as the rightmost panel — Roam's sidebar position — instead of wherever the panel system defaulted.

## v3.13.0 — 2026-07-02

**Reference Workbench → full Roam right-sidebar parity** (semantics reconciled against the Roam help graph's [[Right Sidebar]] page: Shift+click and Ctrl+Shift+O key commands, drag-rearranging, expand/collapse, and pin-to-top — pinned windows stick to the top, new windows open below them, and closing a pinned window requires confirmation).

- **New item type: linked-refs cards** (Roam's sidebar mentions window). "Open linked refs in sidebar" in the reference menu collects a card listing *every line that references the target*, grouped by source page through the same renderer as the inline sections (extracted as the shared `_queryRefLines` + `_renderRefsGroups`), each row with breadcrumb context, working task checkbox, ✎ anchor-preserving editing, and ◧ open-in-side-panel. Each linked-refs card has its **own filter box, persisted with the shelf**.
- **Richer existing cards.** Page cards now show the first **25** lines (with a "+N more" note). Line cards render the line's **full children tree** — nested and collapsible per node, capped at 5 levels / 50 lines, task children checkable, every tree line clickable to jump.
- **More ways to open.** **Shift+click now also collects page links** (`.lineitem-linkobj`), not just reference chips. **Ctrl/Cmd+Shift+O** with the caret on a reference sends it to the Workbench — Roam's exact chord for "open link under cursor in sidebar"; `custom.sidebarChord: "panel"` restores the previous open-in-native-side-panel behavior. The reference menu's "Add to Workbench" is now **"Open in sidebar"**, joined by "Open linked refs in sidebar". New palette commands: **Add current line to Workbench** and **Add current page to Workbench**. Anything landing on the shelf **opens the Workbench panel automatically** (Roam opens the sidebar too).
- **Drag-reorder.** Card headers are drag handles (HTML5 DnD) with a before/after drop indicator; the order persists. Dragging never flips a pin — an unpinned card dropped between pinned ones snaps just below the pinned block.
- **Pin to top** (from the help graph — absent from the original plan). 📍 on a card pins it: pinned cards hold the top of the shelf, new items open below them, the cap never drops them, and **✕ / Clear all ask for a second press** before closing a pinned card (Roam's "closing pinned windows shouldn't happen accidentally" confirmation; cleared pinned cards don't resurrect). Unpin drops the card to the top of the unpinned zone.
- **Swap to main.** ⇱ opens the item in the main (non-Workbench) panel and removes it from the shelf — `_bridgeJump` gained `opts.panel`, and `_wbMainPanel` picks the active panel unless it *is* the Workbench (DOM-checked). A pinned card opens in main but stays on the shelf.
- **Lazy + cached + event-driven.** Collapsed cards render header-only. Card bodies are **cached across shelf re-renders** and invalidated **event-driven**: a `record.updated` naming a card's source record drops just that body (`_wbInvalidate`, debounced re-render, the open-✎-editor guard still applies); linked-refs bodies also age out on a 30s TTL, since a brand-new reference from another page never names this card's records in its update event. No observers, no polling.
- **Cap 50 + "+N older" fold.** The shelf holds 50 items (was 20); past 12 cards the rest fold behind one "+N older — show all" row (and fold back). Adding past the cap drops the oldest **unpinned** item; a shelf full of pinned items refuses the add instead of silently closing a pinned card.
- **Registration hygiene.** `registerCustomPanelType` has no unregister, so the registered closure now routes through `window.__refxWbRender` — whichever registration the panel system kept, rendering always runs on the newest live instance, and `_renderWorkbench`'s `_unloaded` guard no-ops a dead one.
- **Editing ceiling documented** in README: cards are decorator DOM and can't host Thymer's native editor — parity is ✎ anchor-preserving edits + checkable task boxes + swap-to-main for everything else. Out of scope from the help graph's sidebar inventory: graph view in sidebar (Thymer has no graph view) and query/kanban windows (Thymer's equivalent is collection views in native panels).

## v3.12.1 — 2026-07-02

**Checkable task references (Roam behavior)**
- **A reference to a task line now renders a working checkbox everywhere the plugin shows one.** The write path is `PluginLineItem.setTaskStatus(status): Promise<boolean>` (SDK `types.d.ts:2398`, live-verified on both tree items and search-result line handles): optimistic flip, then a short poll-confirm re-reads a fresh handle and settles the glyph; a failed write reverts with a toast.
- **Ref chips**: during the counter scan, every chip whose target guid is a task LINE grows a leading ☐/☑ inside the chip (decorator DOM, `contenteditable=false`, excluded from `.listitem-transclusion` embeds and the plugin's own UI, cleared/re-upserted with the badges). Clicking it toggles the SOURCE line's status — the press is swallowed window-capture before Thymer's mousedown navigation (never `preventDefault` on pointerdown), and Shift+click still collects the chip to the Workbench. A successful toggle also **re-syncs a STALE chip title** — one whose stored text still embeds a guid token from the pre-3.12.0 leak — to the task's clean current text; clean aliases are never touched. Task-ness/done-state per guid sits in a 15s TTL cache with negatives, so non-task chips cost nothing after their first look-up.
- **Context rows** (inline "N Linked References" sections, the count popover, Workbench cards): the previously read-only ☐/☑ glyph is now a click target with the same toggle machinery; the Workbench line adapter passes `setTaskStatus` through to the real handle. The post-✎-edit optimistic re-render keeps the interactive glyph too.
- **`((` picker rows**: task lines show ☐/☑ before the snippet (display only — clicking the row still picks). Search-result rows read done-state synchronously from the handle; registry rows (lines the search index hasn't caught up with) resolve it async and repaint the glyph in place.

**GUID-leak fix at the display boundary**
- **The `((` picker (and everything downstream) no longer shows or stores raw GUIDs.** Live-reproduced root cause: a ref segment can carry a **bare-guid STRING payload** (`{type:"ref", text:"12JWYM…"}` — what MCP/automation writes; the editor writes `{guid, title?}` objects), and `_displayText`'s string fast-path returned that guid verbatim. Searching the "Update EMP Tracker …" journal line therefore showed the guid in the picker row — and picking it **stored** the guid inside the inserted reference's title (the second-order leak: `title:"Update EMP Tracker 12JWYM… #ctx/work"`).
- **New `_cleanDisplayText` display-boundary scrub**, now used by: picker row text, inserted ref titles (pick, paste, copy-reference, Apply-children-as-references), `_lineTextByGuid` (alias fallbacks, workbench names), transclusion breadcrumbs, hover previews, context-row parent/children text, workbench record cards, and popover snippets. Rules: a ref's bare-guid string payload is normalized and **re-resolved live** (record name, else the target line's own clean text — recursion depth-capped, cycle-safe — else "↗"); a stored title that contains a guid token is re-resolved the same way (clean aliases always win; a dirty title falls back to a token-stripped copy); plain strings lose standalone guid tokens only when flanked by word boundaries AND the string otherwise has words — a string that IS just a guid is intentional content and survives. A guid token requires ≥1 digit and ≥1 letter, so long ALL-CAPS words and long numbers never false-positive.
- **Stored data is never mutated** — the scrub is display-only; existing dirty titles in documents render clean but stay as written until you re-alias them.

**Reference Workbench (Roam's right sidebar)**
- **New side panel: a stacked shelf of collected references.** Run **Open Reference Workbench** (Command Palette) and a panel opens holding every line and page you've collected — each a collapsible card rendered through the same context-row machinery as the popover and inline sections: a page shows its name and first lines; a line shows its source breadcrumb (record › parent, both clickable), task glyph, the full rich line, and up to 3 children.
- **Three ways to collect:** **Shift+click any reference chip** (the press is intercepted before Thymer's navigation, so nothing jumps — count badges keep their own Shift+click meaning); the reference menu's new **Add to Workbench** row; or the **⧉** button in an inline "↙ N Linked References" section header (adds that section's target). Items land on top; adding a duplicate moves it to the top instead.
- **Card actions:** click the title (or the row) to **jump**, **◧** open in a side panel, **✕** remove from the shelf, and — for lines — **✎ edit in place** with the same anchor-preserving editor the inline sections use (references/dates/tags pass through byte-identical; broken anchors refuse the write). The twisty collapses a card to one row; collapse state persists.
- **The shelf survives reloads** (localStorage, per client), holds **20 items** (adding past the cap drops the oldest), and has a **Clear all** button. Removing shelf items never touches your documents — the shelf holds references, not lines.

## v3.10.0 — 2026-07-02

**Pinned inline reference sections (Roam's `{{mentions}}`, zero document lines)**
- **Every inline "↙ N Linked References" section now has a 📌 pin in its header.** Unpinned sections stay session-only, exactly as before. Pin one and it *persists*: the pin is stored as `refx_pin` meta on the host line (a bare target guid, or a JSON list when one line pins several targets — never a visible document line), and the plugin's discovery passes rebuild pinned sections automatically — after a reload, after navigating away and back, and on your other clients once they sync. The result is a durable, live "all references to X, right here" block anywhere you want one.
- **Unpin** by clicking the 📌 again (grey = session-only, full color = pinned) — the meta is removed and the section goes back to session-only. **Collapsing a pinned section (✕, Esc, or re-clicking the count) also unpins it** — otherwise the next discovery pass would immediately reopen what you just closed. Sweeps that aren't deliberate (navigation replacing the page, hot-reload) never touch the pin.
- Pins ride the existing discovery machinery: found while walking open panels for embeds (no extra queries), applied additively (open sections just sync their pin state, including a remote pin/unpin flipping the 📌), with a bounded retry when the host line hasn't rendered yet. A pin on a line inside a *transclusion copy* is ignored — the section belongs under the original line only.

## v3.9.0 — 2026-07-02

**Delete guard (Roam's "this block has references")**
- **The plugin's destructive paths now check inbound references first.** Collapsing an embed (`Cmd/Ctrl+Up`, Collapse all) and the reference menu's **Delete reference (keep text)** / **Delete reference and text** rows run a quick cached inbound-count check on the affected line: zero references (the overwhelmingly common case) proceeds silently with no dialog and no query beyond the counter's shared TTL cache; when other lines DO point at it, a confirm dialog opens — up to 5 of the referencing lines rendered with the shared full-context rows (breadcrumb, task glyph, full line, children; click a row to jump there, which cancels) and **[Delete anyway] / [Cancel]**. Enter never confirms; Esc/backdrop cancel.
- **New palette command: "Check references to this line"** — the guard's read-only sibling. Put the caret on any line and run it: the inline **↙ N Linked References** section (the same one a badge click opens) expands under that line showing everything that points at it, no badge needed.
- **Documented limitation:** native deletes can't be guarded — Thymer's editor owns Backspace/Delete/cut, so deleting a line with the keyboard bypasses the guard. The guard covers exactly the plugin's own delete paths; run "Check references to this line" before reorganizing if you want the same safety on manual edits. (See README "Notes & limitations".)

## v3.8.0 — 2026-07-02

**Hover previews in the `((` / `[[` picker**
- **Dwell 300ms on any result row** and a preview card opens beside the picker — the same card the chip hover shows (a page: its name + first lines; a line: its text, source page, and up to 2 children), slightly lighter. It sits to the picker's right (flips left when there's no room), top-aligned with the hovered row.
- The preview lives and dies with the picker: it closes when the pointer leaves the row, when typing changes the results, on pick/Esc, and it never opens over a dialog. The content fill is shared with the chip hover preview (`_fillHoverPop`) — one renderer, two surfaces.

## v3.7.0 — 2026-07-02

**Target-line badges (Roam outline counts)**
- **Lines that are themselves referenced now carry a count** — a subtle pill at the END of the line (after its last segment), outline-wide, wherever a line's own guid has inbound references (`@linkto` works for line guids). Distinct from the superscript chip badges (those count a *chip's target*; these count *this line*): in-flow, one size smaller, quieter pill styling.
- **Clicking the pill toggles the same inline "N Linked References" section** directly under that line — the line is both host and target, so the expansion shows every line that references it, grouped by source page, with the full-context editable rows from v3.5.0. Shift+click opens the floating popover, Alt+click instant-embeds the top reference — identical routing to chip badges (`custom.counter.clickAction` swaps plain/Shift as before).
- **Exclusions (hard rules):** never inside `.listitem-transclusion` embeds (a transcluded line's guid belongs to its original), never on the plugin's own decorator DOM (inline sections, property cards, popovers), and inbound only — a line's own outbound references never inflate its badge.
- **Performance:** the pass rides the existing mutation-debounced scan and the counter's shared TTL count cache — negative results are cached too, so lines that are never referenced cost zero queries after their first look-up; badge upserts are diffed (no-op DOM writes skipped). Uncached lines resolve in small sequential batches that abort when a newer scan supersedes them; the pass caps at `custom.counter.targetLineBadgesMaxLines` rendered lines (default 300). Hover-only mode, font scale, `minCount`, and the enable toggle all apply.
- Config: `custom.counter.targetLineBadges` (default **true**) turns the pass off entirely.

## v3.6.0 — 2026-07-02

**Upstream native-look pass by parham-shafti (their v3.0.0, commit `014a530` on `upstream/main`), ported by hand onto our v3.5.x** — their release was built on the older v2.10.x base (our PR #1), so this is a re-implementation into the current code, not a merge. All our v3.x behavior is preserved: keyboard-nav cursor, editors, commit machinery (optimistic row + poll-confirm), zero-flash keep-alive.

**Native-look property card**
- Card rows render through Thymer's own property-pane classes (`.page-props-editor` wrap, `.page-props-row`, `.page-props-cell` type/value cells, `.prop-label-text`): type icons, value pills (`.prop-status` chips with enum colors), each relation pill leading with the record's OWN icon (Icon property, collection-icon fallback via `_iconForRecord`), a clickable ↗ on record pills (routed through our `_bridgeJump`, not upstream's raw `navigateTo` — same destination, keeps the Navigation-plugin pulse), native plain dates, and blank empties with a native hover pencil. The `refx-*` classes stay on the same elements, so `_cardNavItems` / `_paintCardNav` / `_applyRowValue` / `_editCardValue` all keep working unchanged.
- Card background/border are copied from the transclusion body's computed style at render (`_alignCardToBody`) so card + body read as ONE box on any theme.
- `_applyRowValue` refresh now diffs against a stashed `data-refx-display` and re-renders CONTENT through `_renderValContent` (span node — and any nav-cursor class on it — survives; no-op writes still skipped so the body observer stays quiet).
- Fixed an upstream regression while porting: their value-cell mousedown handler `preventDefault()`ed unconditionally, which would have killed caret placement / mouse selection inside the inline text `<input>` (it lives inside that cell) — our cell handler bails on presses inside an open editor.

**"Properties · All ⌄" view chooser**
- Card header row like the native pane: All / Filled in / Custom, with a filterable per-property checklist popup (`_openPropsChooser`, running through our `_openCardPopup` keyboard nav). Checkmarks always reflect what the card currently shows; toggling a field switches to Custom seeded from the current view. Field set mirrors native via `_isUserField` (user `F…` field ids only; system + "Deleted (…)" fields excluded). Display cap raised 8 → 32.
- Preference persists in **localStorage** (`refx-card-prefs`), NOT `saveConfiguration` — see root-cause fixes below.

**Native-anatomy relation picker**
- `_editRelation` rebuilt: current values listed first with round accent check badges (click = remove), icon'd suggestions below — the field's declared target collection when present, else the 300 most recently edited records workspace-wide; multi-value fields (schema `many`, now read into `_fieldMeta` with `read_only`) toggle without closing, single-value picks replace and close; "(None)" only for single-value; read-only fields refuse politely. Writes stay guid-strings (our `_setRelation` corruption rule); `many` writes the guid array. Our `_openCardPopup` ↑/↓/Enter/Esc nav is unchanged.

**Root-cause fixes (principles applied, audited across our tree)**
- **`saveConfiguration()` reloads the whole plugin** (verified live upstream — that reload was their view-change jump). Audit: our only call is `_saveShortcut` (rare, explicit user action — acceptable, now documented in-code); the new view prefs live in localStorage.
- **Manual scrollTop saves/restores fight browser scroll anchoring.** Audit: our tree has ZERO scrollTop save/restore code (nothing to remove); the ported `_applyCardPrefs` follows upstream's model — let scroll anchoring do the work, with one gentle drift correction anchored on a visible line after cards re-render.
- **`_refocusEditor`** (with `focus({ preventScroll: true })` — a plain focus scrolls the caret's virtual textarea into view and jumps the page): keyboard returns to the editor after closing any card popup, committing/canceling an inline edit, and the alias box — previously the next keystroke could scroll the page instead of typing.

**Explicitly NOT ported** (out of the requested scope; skipped rather than risk our machinery): upstream's "Convert reference ↔ embedded line" command (Cmd+Ctrl+R, `_onConvert`/`_replaceLine`) and the consolidated two-row shortcuts dialog (`_saveShortcuts`) — our single-shortcut `_openShortcutModal`/`_saveShortcut` stays as-is.

## v3.5.1 — 2026-07-02

**Fix: reference-count badge vs the native ↗ arrow (badge was nearly unclickable)**
- Root cause, two halves: (1) `resolveBadgeAnchorElement` deliberately anchored the badge INSIDE the chip's native "open in other panel" ↗ arrow (`.lineitem-lineref`), so the ≥16px padded badge hit box sat directly on top of the arrow's click zone; (2) Thymer's chip/arrow navigation acts on **mousedown** (capture), while the plugin only listened for window-level **click** — the native handler had already navigated before the badge handler ever fired. Video-confirmed: clicking the digit navigated instead of toggling.
- **Press interception**: a window-capture handler now swallows `pointerdown` / `mousedown` / `pointerup` / `mouseup` on `.trc-refcount-badge-wrap` (first line rejects everything else) — `preventDefault` + `stopImmediatePropagation` for the mouse events, propagation-stop only for pointer events (canceling `pointerdown` would suppress the compat mouse events and make `click` dispatch browser-dependent). The action still fires on the existing window click handler, itself upgraded to `stopImmediatePropagation`. Handler stashed on `window.__refxBadgePress`, removed in `_counterDispose`/onUnload and by the `_killStaleObservers` hot-reload sweeper.
- **Geometry separation**: the badge no longer attaches inside the arrow — it attaches to the chip root (`.lineitem-ref`), and when the chip carries an arrow (`trc-anchor-has-arrow`) CSS places the badge past the chip's right edge (`left: 100%` + `translate(6px, -0.5em)`), so badge and arrow are visually adjacent but their click zones never stack. Old arrow-anchored badges are cleaned up by the existing orphan sweep.
- Net effect: clicking the digit ALWAYS toggles the inline refs section (or the popover per `clickAction`), never navigates; the arrow keeps its own unobstructed click zone.

## v3.5.0 — 2026-07-02

**Inline linked references (Roam's count-click)**
- **Clicking a reference-count badge now toggles an inline "↙ N Linked References" section directly under the line**, pushing content down exactly like Roam — the floating popover moves to **Shift+click** (swap the roles back with `custom.counter.clickAction: "popover"`; **Alt+click** still instant-embeds the top reference). Rows are grouped by **source page** (page name clickable, per-page count), each a full-context card: breadcrumb (parent line, clickable → jump to parent), task glyph ☐/☑, the full line (rich segments via the Backreferences renderer when present), and up to 3 children. Row click jumps to the source (pulsing via the Navigation plugin); hover actions: **✎ edit**, **◧ open in side panel**, **⤵ Embed here**. Capped at 30 rows with a "+N more" pointer to the full popover.
- **Filter box** in the section header (better than Roam's chips for the 90% case): client-side substring filter over row text — no re-query; groups with no matches hide.
- **Rows are editable in place** (Roam's editable linked refs): ✎ swaps the line for a textarea seeded with its display text — Enter commits, Esc cancels, blur commits. Commits rebuild the segments with the anchor-preserving algorithm (references/dates/tags pass through byte-identical; the edit is refused when an anchor was deleted or reordered) — through the Backreferences v0.7.2 `rebuildSegments` export when present, else a local copy (no hard dependency). The write lands via `setSegments` on the source line and invalidates that target's count cache.
- **Non-destructive by design**: the section is decorator DOM (`contenteditable=false`), never a document line — zero mutation of your notes; real embeds stay one ⤵ away per row. Session-only (a reload clears it, like Roam), collapsed automatically when the panel navigates to another record, kept alive against Thymer's re-renders by the same pre-paint cached-node re-insert the property card uses (no flicker, works while typing above it).
- **Keyboard**: Esc inside the filter closes an open row editor first, then the section; ✕ collapses.
- Shared row builder: the floating popover and the inline section now render rows through one `_buildRefContextRow` — the popover gains the task glyph and a clickable parent crumb.

## v3.4.1 — 2026-07-02

**Fixes**
- **Reference-count badges are clickable on Journal day pages** (and any other panel with no `getActiveRecord`). The popover's click handler was attached per panel by `handlePanelChanged`, which bailed (and disposed the panel state) whenever `panel.getActiveRecord()` returned null — true on Journal pages — so badges painted there had no click owner. Two-part fix: (1) `handlePanelChanged` no longer requires an active record; it scans whenever the panel has an editor root, so Journal panels get their own observer/scan/click state. (2) A single window-level capture click handler (`window.__refxBadgeClick`, removed on unload and by the hot-reload sweeper) now catches every `.trc-refcount-badge-wrap` click as a backstop and opens the popover, resolving the owning panel state when one exists (the popover tolerates a null state by falling back to the active panel for jumps). Alt+click embed-top behavior is preserved.

## v3.4.0 — 2026-07-01

**Fixes**
- **"Open in side panel" no longer leaves an empty "Custom Panel"** when the target can't be opened: the destination record is resolved BEFORE any panel is created (a fresh panel defaults to a custom-panel view), the new panel is pointed at the record first and only then line-highlighted, and a failed navigation closes the panel and falls back to the active panel.
- **Badge counts are actually clickable now**: the count's hit area is a padded ≥16px square (visually unchanged — matching negative margins), sitting above the chip so the click opens the popover instead of navigating the page.

**Reference popover — full context (Roam-style)**
- Each referencing line now shows a **breadcrumb** (source record › its parent line), the **full line text** (wrapped, not a one-line snippet), and up to **3 of its children** indented and dimmed. Context loads lazily per row (one tree read per source record, first 20 rows). The popover is wider (460px) and taller (420px). If a sibling plugin exports `window.__thymerBackrefs.renderSegments`, line text renders through it. Row actions (jump, ◧ side panel, ⤵ Embed here, Embed all) are unchanged.

**Native paste**
- **Cmd/Ctrl+V of a copied reference pastes the chip** — pasting `thymer-ref://<guid>` into the editor no longer dumps the literal URI text; it inserts a real ref segment at the caret (line targets carry the target's text as title; record targets stay untitled so the chip tracks the live page name). Pastes into the plugin's own inputs and non-matching clipboard text fall through untouched.

**Embeds (deferred items from v3.3.0)**
- **Breadcrumb headers on embeds**: every open embed gets a slim clickable header — "RecordName › parent line" — record crumb jumps to the record, parent crumb jumps to that line. Injected like the property card (survives Thymer's re-renders via the same keep-alive), sits above the card. Kill-switch: `custom.breadcrumbs: false`.
- **Embed display variants**: right-click a line reference whose embed is open → "Embed display: full / children only". Children-only hides the embed target's own row and keeps its children. Persisted as line meta (`refx_variant`), re-applied after reload/re-render and on other clients. (Line refs only — a record embed is body-only, its first line is real content.)

## v3.3.0 — 2026-07-01

- **Hover previews** on reference chips (Roam-style peek): dwell 350ms on any chip for a read-only card — a page shows its name + first lines, a line shows its text, source page, and children. Closes the instant you move off, on scroll, and never appears over open pickers/menus.
- **Apply children** in the reference menu: **as text** (plain, severed copies) or **as references** (a linked chip per child), preserving the subtree hierarchy under your line. Caps at depth 5 / 50 lines and refuses beyond them rather than truncating silently.
- Deferred (documented, not dropped): transclusion breadcrumb headers, embed-children display variants, the shared segment renderer, and Unlinked-references "Link All" — next iteration.

## v3.2.0 — 2026-07-01

- **Replace with →** family in the reference menu (Roam parity): **Text** (target's live text, severed), **Alias (*)**, **Text and alias** ("target text [*]"), **Embed** (chip removed only once the embed actually lands — the cycle guard can refuse), and — for line references — **Original (move here)**: the referenced line MOVES under your line (guid preserved, children ride along) and a reference is left at its old spot, so every other ref keeps resolving.
- **Badges on line references too**: `((` chips now show counts (the record-only gate is lifted; line targets count via `@linkto`, which works for line guids). The popover header shows the line's text.
- **Clickable badge popover**: rows gain hover actions — ◧ open in side panel, ⤵ **Embed here** (pulls the referencing line inline under the badge's line) — plus **Embed all (N)** for 2–10 results. **Alt+click a badge** embeds the top referencing line instantly.
- **Reference counts in the `((`/`[[` picker** — each result row shows how often its target is referenced (async, from the counter cache).

## v3.1.0 — 2026-07-01

- **Reference context menu** (Roam parity): right-click any reference chip (or run **Reference actions** with the caret on one). Rows: Jump to source, Open in side panel, Expand inline (embed), Open linked references, Set alias, Copy reference, Delete reference (keep text) / Delete reference and text. Keyboard: ↑/↓/Enter; Esc closes; Shift+right-click falls through to the native menu.
- **Cmd/Ctrl+O / Cmd/Ctrl+Shift+O** with the caret on a reference: jump to source / open it in a side panel (Roam's chords). Anything that isn't the exact chord over a reference falls through.
- **Inline reference-count badges absorbed** from the standalone Reference Counter plugin — same superscript badges, click-to-view popover, count modes (combined/lines/records), per-collection excludes, and `plugin.refs.v1.ignore` handling, byte-identical behavior. Its palette commands ("Reference Counter: …") now live here; settings migrate automatically from the standalone's localStorage; config knobs moved under `custom.counter` (flat keys still work). The standalone plugin is retired.
- **`window.__refx` bridge (v1)** for other plugins (the Backreferences panel): `{version, createEmbed(hostLineGuid, targetGuid), openRefMenu({lineGuid, ordinal, anchorEl}), jumpToLine(guid, {newPanel})}`.

## v3.0.0 — 2026-07-01

- **BREAKING: the line-reference picker moved from `[[` to `((`** (Roam's block-ref syntax). Two `(` within 1.2s at the caret opens the same picker; Esc still cleans up the typed `((query`. Disable with `custom.lineRefTrigger: false`.
- **New: `[[` is now a PAGE-reference picker** (Roam page refs). Same inline box, searches records by name (workspace search + local registry for just-created pages), and inserts an *untitled* record ref — the chip renders the page's live name and follows renames. Thymer has no native `[[` handler (its native link flow is the `@` command), so nothing is displaced. Disable with `custom.pageRefTrigger: false`.
- New: **Copy reference to current line** and **Paste reference** (Command Palette) — Roam's copy-block-ref flow. Copy stashes the caret line and mirrors `thymer-ref://<guid>` to the OS clipboard; Paste inserts the reference chip at the caret (clipboard wins if it holds a `thymer-ref://` URI, so it survives a reload; the read is timeout-raced so a clipboard-permission prompt can't hang the command).
- Pasted/inserted line refs always carry the target's text as their title — a bare line ref renders "[Title missing]" natively (Thymer only auto-names record targets).

## v2.10.3 — 2026-07-01

- Fixed a daylight-saving off-by-one in the week-number label (Week 27 shown for Week 28).

## v2.10.2 — 2026-07-01

- Fixed: granular pills ("Week 28") stored by the native picker displayed as their start day in the card — the display now reads the stored value verbatim (the reconstructed read was dropping the label).

## v2.10.1 — 2026-07-01

- Granular dates now store the full native shape: "week 28" / "Q3 2026" / "july 2025" / "2027" / "last year" commit as the period RANGE with the native pill label ("Week 28", "Q3 2026", "July 2025", "Year 2027") — verified byte-identical to what the native picker stores. The confirm bar previews the pill text as you type.

## v2.10.0 — 2026-07-01

- **Dates display exactly like native everywhere.** Card values show "Sun Jul 12" (year added when it isn't this year, time when set) instead of raw "2026-07-12" — including the instant just after you commit.
- **Granular and relative dates, like native.** Typing "week 28", "Q3 2026", "July 2025", "2027", "last year", "next month", etc. now stores Thymer's real granular date value — the property renders the native pill ("Week 28", "Q3 2026") instead of collapsing to a single day. The confirm bar previews the native text as you type; committing from the calendar grid still writes a specific day. Whatever Thymer's own date engine understands, the picker now passes through unchanged.

## v2.9.1 — 2026-07-01

- Fixed: clearing a date could silently fail to save (the property write no-ops sometimes in Thymer) — the clear now uses every available removal path, and the card re-checks the stored value shortly after so the display can't mask a failed write.

## v2.9.0 — 2026-07-01

Pre-publish hardening: a 5-dimension review (performance idle/scale, lifecycle, edit paths, keyboard nav/embeds) confirmed 27 issues; all fixed.

**Data safety**
- **Fixed: picking a relation wrote a raw object into the property**, which the native property pane showed as "[object Object]". Relations now store the record id correctly.
- **Fixed: the Edit-record dialog could silently clear a date that had a time** (the date input can't hold a time, so an untouched Save wrote back empty). Times are preserved through the dialog now.
- **Collapsing an embed no longer deletes your own lines.** If you had Tab-indented lines under an embed, collapse used to remove them along with it; it now refuses with a message instead.
- Mutual embeds (A embeds B while B embeds A) are now refused like direct self-embeds — they created a permanent render loop.

**Correctness**
- Editing a value right after a previous edit no longer risks reverting to the older value (editors now re-read the current value when they open).
- Overlapping edits on two fields of the same card no longer let a stale refresh sneak in between them.
- An update poll can no longer replace an input you've just re-opened (which could permanently wedge editing until reload).
- Typing a date and pressing Enter quickly no longer commits the previously focused day; the confirm bar and grid always reflect what you typed.
- The relation picker can no longer be flooded by a late workspace-wide search replacing its collection list (which could let you link a wrong-collection record).
- Collapse now works on embeds that were discovered (created on another device) — previously the key was swallowed with no effect.
- Navigating away mid-edit or mid-keyboard-nav now cleans up properly (no floating pickers, no swallowed first keystroke on the new page).
- Popups no longer intercept Enter/arrows meant for the command palette stacked above them, and modified chords (Cmd+arrows) pass through the date picker.

**Performance**
- Typing anywhere no longer triggers periodic full-page scans: change-driven discovery now runs once per burst, skips entirely when no embeds exist anywhere, and pauses (instead of looping) while a picker is open.
- The keep-alive check is now O(1) per card (was a whole-document query per card on every DOM change).
- Card refreshes are coalesced per card (was one full property re-read per keystroke while typing in an embed body) and skip all no-op DOM writes.
- Property probing stops at the 8-field display cap (was probing every property on large records).
- The `[[` picker caches line text across a session and no longer re-scans everything on its empty-result retry; the relation browse list computes names once instead of per keystroke.
- Plugin updates (hot-reload) no longer stack leaked keyboard listeners, observers, timers, or orphaned popups from the previous version.

## v2.8.1 — 2026-07-01

- **Times work in the date picker, like native.** Type "17:00 tomorrow", "monday 3pm", or just "17:00" (applies to the focused day) — the time is kept, shown in the confirm bar and the card ("Thu Jul 2 17:00"), and written to the property with the date. Picking a day from the grid keeps a typed time.
- Fixed: a time-only entry ("17:00") used to blow the calendar up into "undefined/NaN" — partial parses are now guarded and fall back sensibly.
- Date values now display in Thymer's own format ("Fri Jul 3", with time when set) instead of raw ISO.

## v2.8.0 — 2026-07-01

- **Relation fields open with a browsable list.** When a record property declares a target collection (Lead → People, Area → Areas, Goal → Goals, …), the picker now opens with that collection's records already listed — arrow through with ↑/↓ and Enter, or type to filter instantly. Fields without a declared collection keep search-as-you-type.
- **The date picker now mirrors Thymer's native one** (studied side-by-side): "Try: today, Aug 1, monday" input, month header with ‹ ○ › (previous / today / next), weekday row, a full 6-week grid including the muted adjacent-month days (clickable), the focused day in the accent color, and a confirm bar at the bottom showing the focused date — Enter or click commits it. Backspace on an emptied input clears an existing date.
- **Subtle property/body distinction:** the property card sits one gentle shade above the body, so the two halves of the box read as header + content without any loud styling.

## v2.7.3 — 2026-07-01

- Relation values that Thymer can't resolve to a record (older plain-text values like Lead = "Svy", or not-yet-loaded records) now display again — read from the raw stored value instead of showing "—".

## v2.7.2 — 2026-07-01

- **Empty date fields really open the calendar now** (the v2.7.1 schema lookup was accidentally reading a Promise and always came back empty).
- **Card and body edges line up exactly** — the card mirrors the body box's own left/right margins instead of spanning full width.

## v2.7.1 — 2026-07-01

- **Empty date fields now open the calendar.** Property types come from the collection's schema instead of probing the current value — an empty Due Date was indistinguishable from text, so Enter opened a text input. Now Enter on any date field (empty or not) opens the keyboard date picker; empty relation fields likewise open the record search instead of a text box.
- **Card and body are one box again.** Moving the card out of the (volatile) body container had left them as two separate boxes with a gap; they now fuse — card on top, body below, single border.
- **Killed the residual flash and made updates instant.** When Thymer re-renders the embed, the card is re-inserted synchronously before the browser paints (previously the re-add waited a frame, so one frame painted without the card — the flicker you saw). The value you picked stays continuously visible.

## v2.7.0 — 2026-07-01

- **Edit flicker + one-step-stale value finally fixed (real root cause).** Live instrumentation proved Thymer REPLACES the embed's inner content container on every property write — the card was injected inside it, so it was destroyed and re-injected with a "Loading…" flash, and the rebuild read the value one tick before it propagated (hence one-behind). The card is now injected into the stable outer transclusion node (above the body), so an edit never wipes it; plus the commit now claims the card before the write so the value updates in place, instantly and correctly. No flash, no jump, no stale value.
- **Date field: a real keyboard-first picker.** Editing a date now opens a picker where you can type a natural-language date ("next friday", "sep 5", "2026-09-05") — parsed by Thymer's own date engine — and/or arrow through a month calendar (←/→ day, ↑/↓ week, PageUp/Down month, Enter to pick, Esc to cancel). It works even when the field is empty (starts on today). Replaces the old inline field that only worked with an existing date.

## v2.6.8 — 2026-07-01

- **Actually fixed the edit flicker + one-step-stale value.** Traced with live DOM instrumentation: the card wasn't wiped by Thymer — the plugin's own in-place refresh had a "structure changed → rebuild the whole card" fallback that mis-fired on a property write (the property list can come back in a slightly different order right after a write), which replaced the card node and made the keep-alive watchers re-add it with a flash, and the value lagged a step. The in-place refresh now matches rows **by name** and never rebuilds the card on an edit, so editing a value is smooth and updates immediately. Also stopped a stray scroll ("it moves") on refresh.
- **Date calendar now actually pops.** The picker call needs to run in the same click/keypress, but it was deferred a tick and lost its user-gesture, so nothing appeared. It now opens the calendar immediately when you edit a date field.

## v2.6.7 — 2026-07-01

- **Really fixed the edit flicker + stale value.** v2.6.6 still rebuilt the whole card in two cases — the keep-alive watcher re-attaching, and the update the write triggers — which flashed the card and (because the rebuild replaced the row the edit was updating) left the old value showing until you re-entered the line. Now every card refresh updates in place and only builds a fresh card when one is genuinely missing, so editing never tears the card down and the new value shows immediately.
- **Date fields open a calendar.** Editing a Due Date (or any date property) now pops the date picker immediately, instead of showing a field you had to click into. Also fixed a timezone off-by-one when saving a date.

## v2.6.6 — 2026-07-01

- **No more flicker when editing a value.** Picking a choice, setting a relation, or editing a text/number/date value used to rebuild the whole card (a visible flash). Now only the edited value updates, in place, and instantly — the picked value shows immediately, then the confirmed value settles in. Cards changed by another client (or on switching back) also update in place instead of rebuilding, so nothing flashes there either.

## v2.6.5 — 2026-07-01

- When you switch back to a client (from the desktop app or another tab), the property cards now refresh their values, not just reappear — so a property another person changed while you were away shows up without a reload. (Refresh happens on focus only, and never while you have a value open for editing, so it doesn't churn or interrupt you.)

## v2.6.4 — 2026-07-01

- Fixed: a text property whose value starts with digits (a code, ID, or title like "26-002-BHP") showed only the leading number ("26") in the card. The type detection was letting the numeric probe coerce the leading digits; it now keeps such values as text and shows them in full.

## v2.6.3 — 2026-07-01

- Choice properties now open a **searchable** picker, like Thymer's native property editor: a "Search option…" box filters the options as you type, the current value is highlighted, and ↑/↓ + Enter pick (mouse still works too). Clearing the value is the **(None)** entry at the bottom.

## v2.6.2 — 2026-07-01

- Fixed: the property card sometimes went missing (leaving just the bare embed box) when switching between the web app and the desktop app, or when someone else edited the page. The card is drawn per-client, and was only (re)discovered on load or when you navigated; now it's also re-discovered when the tab regains focus/visibility and when the page changes remotely, so it reappears on its own — no navigation or reload needed. Discovery is debounced and additive (no flicker on the cards already showing).

## v2.6.1 — 2026-07-01

- Fixed: after editing a value from the keyboard, the highlight now returns to that value (previously it was dropped, so you had to press Down again to re-enter the card). The cursor is re-established on the edited field once the card refreshes; on cancel it returns immediately.

## v2.6.0 — 2026-07-01

- **Keyboard-navigate the property card, like Thymer's own records.** Put the cursor on a record reference whose embed is open and press **↓** to step into its property card. **↑/↓** move a highlight through the values, **Enter** edits the highlighted one (text/number/date inline, or the choice/relation picker), and after you save the highlight returns to where you were. **↑** from the first value (or **Esc**) puts the cursor back on the reference line; **↓** past the last value drops the cursor into the embed's body. No mouse needed.
- **Empty record → arrow down and start typing.** For a record with no content, **↓** highlights **＋ Add content**; press **Enter** and the first body line is created with the cursor already in it, ready to type.

## v2.5.0 — 2026-07-01

- **Card stays current with the record.** If you rename an embedded record or change its properties elsewhere, the card in the embed now updates to match (it listens for record changes instead of only refreshing on its own edits).
- **Empty record → drop straight into typing.** After **＋ Add content** creates the first body line, the caret is placed in it so you can start writing immediately.

## v2.4.2 — 2026-07-01

- Fixed: the **Edit embedded record** dialog now applies your changes on Save. It was reading the fields after the dialog had already closed, so edits didn't stick; it now snapshots the values before closing.

## v2.4.1 — 2026-07-01

- **Keyboard-first property editing.** New command **Edit embedded record (properties)** — put the cursor on a record reference (or inside a record embed) and run it to edit that record's properties in a normal, fully keyboard-navigable dialog (Tab between fields, native dropdowns for choices, Save/Esc). If the record is empty, the dialog also offers **＋ Add a body line**. This is the reliable keyboard path, since values drawn inside the embed can't hold focus (Thymer's editor owns focus within it).

## v2.4.0 — 2026-07-01

- **Edit the body of an empty record.** A record with no content used to render an empty embed you couldn't type into. Its card now shows a **＋ Add content** action that adds a first body line so you can start writing.
- Choice/relation pickers are keyboard-navigable once open (↑/↓ move, Enter selects, Esc cancels).

## v2.3.4 — 2026-07-01

- Edited property values now show their new value immediately. After a save the card polls for the write to land (property writes propagate asynchronously and don't re-render the body) and re-draws with the fresh value instead of showing the pre-edit value.

## v2.3.3 — 2026-07-01

- After editing a property, the card now reliably updates in place. The keep-alive watcher now covers all panels, so when saving a value re-renders the embed the card is re-drawn (previously it could disappear until you navigated).

## v2.3.2 — 2026-07-01

- Property cards now reliably **reappear after a reload**. On load the plugin re-scans every open panel (not just the focused one) and retries while the workspace finishes loading, so a persisted record embed gets its property card back without you having to touch it.

## v2.3.1 — 2026-07-01

- Property card reliability: the card is marked non-editable (it lives inside the transclusion's editable region), so clicking a value to edit it registers reliably instead of being treated as a cursor placement. Value editing now also opens on click, not only mousedown.

## v2.3.0 — 2026-07-01

- **Multiple embeds at once.** Inline Transclusion is no longer one-at-a-time — expand as many references as you like and they all stay open. Expanding a second reference no longer collapses the first.
- **Embeds persist across reload.** An expanded embed is a real line, so it stays until you collapse it — even after a reload. **Cmd+Up** / **Ctrl+Up** collapses the embed for the reference under the caret (or the one the caret is inside). New command **Collapse all embeds (this page)** clears them all at once.
- **Editable property card on record embeds.** Expanding a *page* reference now shows the record's properties as a card above the body — Status, Due, numbers, relations, and so on. Click any value to edit it inline (text, number, date, a choice picker, or a record search for relations); changes save straight to the record. (Line references still show just the line and its children — line items have no properties.)
- Won't embed a block inside itself (cycle guard), and re-expanding an already-open reference is a no-op.

## v2.2.0 — 2026-07-01

- Declared a plugin **version** so Thymer shows the plugin's version and updates correctly (earlier releases declared none, which showed as "undefined").
- The expand-a-reference feature introduced in 2.1.0 is now called **Inline Transclusion**.

## v2.1.0 — 2026-06-30

- **Inline Transclusion.** Select a reference and press **Cmd+Down** (**Ctrl+Down** on Windows/Linux) to expand what it points to, inline and nested right under it: a line reference shows that line and its children, a page reference shows the page's content. It's the real editor, so you can edit in place and changes save to the source. **Cmd+Up** / **Ctrl+Up** collapses it. (Built on Thymer's native transclusion; a page's properties aren't part of a transclusion, so an expanded page shows its body rather than its fields.)

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
