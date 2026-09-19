# Reference Extravaganza

## Current release (v4.64.1)

Line-target **Workbench** items behave like Roam's sidebar **Block Outline**: the full ancestor **trail** (`Record › ancestor › …`, wrapping when long) sits above the native editable body. **Click a crumb to zoom out in place** (the item re-roots at that ancestor and the line you opened keeps a **yellow outline** that encloses the bullet or checkbox), **Shift+click** opens it in a side panel, **⌘/Ctrl+click** jumps the main panel. **Hover** a crumb to preview its outline. With a header focused, **Alt+←/→** zoom out and back in. **`⤓ Back to original`** restores the line as root. When several shelf items share context, the lowest common ancestor gets a **`⧉N`** pill — click to filter the shelf to that group (Esc in the filter clears it).

Cold starts no longer wait on the registry for that ancestor trail. Each time a Workbench item paints a complete context chain, RefX serializes it to the line's `refx_chain` meta property; on the next open, if the in-memory registry is still warming, the cached chain paints synchronously on first decorate while warm resolve runs in the background with a faster retry ladder and a kick when the global registry first becomes non-empty. `window.__REFX_WB_BOOT_DIAG.trail` records per-item `cachedAt`, `liveAt`, `source`, and `attempts` (milliseconds since boot) so you can confirm cold-start trail timing on a live shelf.

RefX also surfaces your **reference walk** on the Workbench: a **trail strip** after the tab bar lists recent hops from `window.__refxTrail` (persisted at `refx_trail_v1:<workspace>`), lets you jump back to any hop, **save the walk as a named stack**, or **replay** it hop-by-hop. Hide it with `custom.workbench.trail=false`.

**Thinking trails** record every hover, click, and jump with parent and dwell on a structured ring. Query it with `window.__refx.trails.recent(n)`, `window.__refx.trails.query({ guid, kind, since, until, parent, limit })`, and `window.__refx.trails.before(guid, { kind, windowMs })` — for example, what you hovered before clicking a target. Entries persist to the **RefX Trails** record in Settings; the Workbench strip shows ○ for hovers and ● for commits (toggle commits-only to keep it quiet). Disable recording with `custom.trails.enabled=false`.

The Workbench still remembers your layout: **stacks**, **reopen closed**, **tab strip**, **trail strip**, **related strip**, and **shared-neighbours strip**. The ⌕ filter shares the v4.53.0 recall scorer. If the panel pegs CPU, use palette **Disable Reference Workbench (safe mode)** or set `custom.workbench.enabled=false`.

The `((` line picker still matches tokens in any order by default (`+` still means AND; quotes force a phrase). Abbreviations (`s3` ↔ `season 3`), initialisms, and light typo tolerance (never on numbers) surface close matches; a pick teaches later queries via pick memory, and lines on the current page get a small ranking boost. Add your own
abbreviations under `custom.picker.abbreviations` in the Configuration tab.

Linked-reference rows still read like Roam: one muted clickable path
(`Tue Sep 8 › thymer/comments › @Svy › ○`) followed by the content at body
size. Crumbs render by kind (page ref, date, @mention), dedupe repeats, and a
line that is only a reference to the target collapses into the trailing ○ so
children show directly. The inline section is a compact header (count,
`⌕ ⇅ ⧉ 📌 ✕`) with flat rows beneath; filters sit behind ⌕. Task-reference
checkbox spacing matches Thymer native (23.4px slot, 5.4px box-to-text gap).
Rows also zoom in place from v4.52.x: click a crumb and the row re-roots on that
node, chips inside the content keep navigating, each line's own count opens its
references without leaving the row (chip counts are off; `custom.counter.chipCounts:
true` restores them), and a widget-bearing block offers a live transclusion.

Block Context, facet pills, the unlinked-mention scan, the CHILDREN heading,
collapse-all, vertical fold-outline mode, and remark chips are gone. The
**"All reference paths" box was removed from the inline section only** — the
multi-hop reference chain itself is intact and still opens from the reference
menu and the context popover, described under
[The reference menu](#the-reference-menu). thymer-remark threads count through
ordinary reference lines; the property index remains for other plugins.

## Native picker and event performance

Version 4.28.0 keeps Thymer's native inline autocomplete independent from RefX,
including picker portals rendered as `.cmdpal--inline`, `.autocomplete`, or an
ARIA listbox outside the active editor panel.
Opening or navigating the native picker performs no RefX reference search,
rescan, backlink/body read, or overlay layout pass. Suggestion rows are treated
as transient UI rather than committed references; real reference chips and
transclusions continue to reconcile from their enclosing authored line.

Startup enrichment is now serialized through one cooperative background lane.
Reference Surface hydration, record-title/alias indexing, property references,
and line-property references cannot overlap. Each pass yields after roughly six
milliseconds and pauses while input or a native picker is active; idle callbacks
have no timeout that can force work through a busy paint. Initial panel discovery
runs once, and visible target badges no longer pre-scan the complete loaded graph.

Reference Workbench storage is also demand-driven. A closed Workbench performs
no collection enumeration, backing-record lookup, or body read during startup;
the first explicit Open/Add action initializes it. If Thymer restores an already
visible Workbench panel, RefX adopts it synchronously only when its GUID matches
a workspace-scoped receipt previously validated by exact Settings/Examples
enumeration; a same-title page is never trusted. Late panel restore gets five
bounded, input-gated attempts. Legacy migration and cleanup are still deferred
until an explicit Workbench action, so startup never writes its backing body.
Migration is semantic-keyed by target plus full/linked-references view, resumes
after partial failure without duplicating completed items, and removes legacy
state only after an authoritative `getLineItems(false)` reread verifies every
required native line and metadata value. Trash, move, reload, input, unload, and
hot reload all fence stale Workbench continuations before their next write.

Bounded lightweight body previews keep their line-count footer in normal flow,
so the status never overlaps the final preview line. In editable property cards,
choice selection keeps a continuous native-style keyboard cursor through the
property-write repaint; after Enter, ↑/↓ continues immediately without a mouse
click or a disappear-then-reappear flash.

Very large line transclusions now mount an instant, native-backed outline before
the cold SDK read instead of leaving a blank wait. Only 40 rows are live at once;
paging reuses the already-read 300-line snapshot, and **Edit selected** opens that
exact source line in Thymer's native side panel. The complete native inline body
remains available explicitly and the outline stays visible until Thymer's native
DOM has actually mounted.

Lightweight page, line, linked-reference, hover, and Workbench previews are now
aware of Thymer `image` and `file` line items. Those items intentionally have no
text segments, so RefX renders a filename/type card instead of an empty bullet.
Local raster images settle lazily after attention rests on the preview (up to
three per surface, 5 MiB each). PDFs render only after **Preview PDF** is chosen
and are capped at 25 MiB. External media URLs are never fetched.

Line-update work is now evidence-gated. Ordinary segment-bearing non-task
updates never hydrate a line handle; a cold segmentless event is classified at
most once. The typed-hashtag bridge uses only committed event payloads and
proves a hashtag before consulting or warming its provider. While a visible
native `.cmdpal--inline` picker owns the caret line, RefX still applies safe
reference appearance classes, queues that exact line, and reconciles it once
after the picker closes.

Reference Surface v1 retains its existing API and now advertises
`capabilities.targetedDeltas = 1`. Revision envelopes add a frozen `delta` with
the affected old/new target GUIDs and source-line GUIDs. Reference-identical
timestamp changes are labeled `metadataOnly` so date filters remain correct
while backlink views skip repainting; proven segmentless updates publish no
speculative revision.

The document observer now admits only connected `.listitem[data-guid]` content,
and the overlay observer schedules a row only when that exact row already owns
a live RefX overlay. Scroll, resize, and explicit mode changes retain their
bounded full-pass behavior. No document content or reference semantics changed.

## Editable line transclusions

Version 4.27.1 makes `((` line expansion native and editable by default. The
performance guard measures only the referenced line and its descendants, never
the size of the Journal/page that owns it, so an ordinary line inside a huge day
still opens as a real Thymer transclusion.

Only an actual target subtree above 1,500 lines stays in the session-only instant
outline. A cold target receives a provisional shell before SDK work begins; the
same targeted SDK read fills a maximum 300-line snapshot without scanning the
loaded workspace registry. Exactly 40 rows are mounted per page. ↑/↓ selects,
Page Up/Page Down changes the window, and Enter or **Edit selected** opens the
exact line in a native side panel for editing. This makes browsing and editing
immediate without asking Thymer to synchronously lay out thousands of inline rows.

Choose **Load complete inline — may be slow**, press Enter/Space on that action,
or press **Cmd/Ctrl+Down** inside the outline to request the complete native
editable transclusion. The outline remains painted until the native transclusion
DOM is present. **Cmd/Ctrl+Up** closes the outline and restores the authored line.
Failed or stale conversions preserve the outline and verify cleanup of the exact
created line. If Thymer refuses that cleanup, RefX reports it as pending and blocks
duplicate creation; the exact receipt survives same-document hot reload. Known-
large targets never bypass the guard between paints. Native creation also fails
closed when the owner or complete cycle check cannot be verified, and every
persisted transclusion marker is reread before the fallback retires.

## Reference Edit transaction contract

Version 4.26.1 exposes a frozen `window.__thymerReferenceEditsV1` coordination
surface for plugins that derive data from line edits. A `begin` envelope is
published when RefX opens a real `[[` or `((` picker. A terminal `settled`
receipt is published only after RefX re-reads the line and verifies the
reference-count increase and removal of the raw trigger text.

The bridge contains GUIDs, segment hashes, outcomes, and verification counts;
it never contains note text. Consumers should defer the affected line while
`getActive(lineGuid)` is non-null and accept a terminal state only when
`triggerRemoved === true` and `residueDetected === false`. The
`RefX: Reference platform health` command reports current feature availability
without scanning records or document bodies.

## Picker breadcrumb reliability

Version 4.26.1 keeps collection and hierarchy breadcrumbs visible when `[[` or
`((` returns a record or line that is not currently rendered. Record rows use
RefX's metadata-only collection index; line rows retain the parent and cached
child context supplied by Thymer's native search result. An open picker repaints
when those indexes become ready or relevant record/collection metadata changes,
while session guards prevent a late refresh from touching a closed or newer
picker. Breadcrumb painting performs no record-body reads or per-row SDK calls.

## Reference Navigator

The ordinary inline `[[` and `((` pickers remain the fastest insertion path.
They still paint 8 matches first, but now retain ranked matches behind a
non-selectable **Show 8 more** action; Page Down reveals the same cached batch
without another search, body read, backlink lookup, or media request. `[[`
indexes record titles and aliases from metadata. `((` combines loaded-line
metadata with Thymer's bounded native search and labels the result partial when
the SDK cannot prove workspace-wide completeness. Tab or `>` drills,
Shift+Tab (or empty Backspace) backs up, Enter inserts, and Ctrl/Cmd+O toggles
the inline preview.

Version 4.27.0 replaces the **Advanced block reference search** command with a
focused **Reference Navigator** command. Open it from the Command Palette or press
**Ctrl+Shift+9**. On macOS, **Cmd+Shift+9** is accepted as an additional
default. Setting `custom.drillShortcut` explicitly replaces both defaults; it
does not add a third binding.

The Navigator paints the first 8 results immediately and reveals 8 more at a
time from the same retained cached result pool. Page-title search retains the
complete metadata-only match set. Block search retains up to 20,000 ranked
matches and labels both that safety cap and Thymer's cursorless native-search
partiality rather than implying workspace-wide completeness. Its progress
indicator distinguishes "more results are available" from "search is complete,"
so a short first paint never pretends to be the whole result set. For example,
a partial line search offers **Show 8 more** and reports
**8 of N blocks returned · more may exist**.
Arrow keys move the selection, Page Down reveals the next batch, Enter uses the
launch editor origin while it remains valid, and Escape closes the focused
overlay.

Pages and Blocks share the same Navigator shell. **This branch**, **This page**,
and **Workspace** scopes let you narrow an outline without losing the trail;
Back and Forward restore earlier exploration states. In the panel-owned search
field, `#heading` narrows block results to headings without intercepting
Thymer's native inline hashtag picker. Right/Left drill and back up, Up/Down
select, Enter inserts, Shift+Enter opens with native highlighting, and Space
opens the selected target's lazy media gallery while the result list or a
Navigator control has focus. The search field keeps normal spacebar typing. A
browse-only session offers Open and Copy Reference rather than inventing an
insertion origin.

The selected result gets a children-first preview:

- **Children** — direct outline context first, using Thymer's native tree
  handles when available.
- **Nearby** — surrounding lines that disambiguate the target.
- **References** — inbound line references and property mentions, loaded only
  when the section is expanded and shown after the target's own outline.

Choose **Pin** to transfer the current Navigator session into a persistent SDK
side panel for browsing while you work elsewhere. A pinned Navigator with no
valid editor origin is deliberately browse-only; it never guesses an insertion
location or writes to the active page.

Preview media is private and lazy by default. With
`custom.navigator.mediaMode: "selected"`, only the selected row may load media,
after a short selection dwell. RefX accepts raster `image/*` workspace blobs
only (SVG is excluded), rejects files over 5 MiB, and bounds object URLs to a
32 MiB cache. External images are blocked unless
`custom.navigator.allowExternalImages` is explicitly enabled. Cached object
URLs are revoked when evicted, when the Navigator closes, or when RefX unloads.

### Navigator settings

All Navigator settings live under `custom.navigator`:

| Setting | Default | Effect |
|---|---:|---|
| `enabled` | `true` | Enables Navigator entry points. |
| `initialResults` | `8` | Results shown on the first paint; clamped to 1–40. |
| `revealBatch` | `8` | Additional results revealed per request; clamped to 1–40. |
| `mediaMode` | `"selected"` | Accepts `"off"`, `"selected"`, or `"gallery"`; the default loads eligible media only for the stable selected result. |
| `allowExternalImages` | `false` | Keeps remote image URLs blocked unless explicitly opted in. |
| `nativeContext` | `true` | Uses native Thymer outline context for the selected preview. |

### Navigator API

Other plugins can feature-detect the frozen v1 surface:

```js
const navigatorApi = window.__thymerReferenceNavigatorV1;
if (navigatorApi) {
  navigatorApi.open();
  const status = navigatorApi.getStatus();
  navigatorApi.close();
}
```

The surface exposes only `open`, `close`, and `getStatus`. Callers should treat
the returned status as read-only and feature-detect the contract instead of
depending on RefX internals. Open requests without a valid editor origin are
browse-only.

Reference Extravaganza is a [Thymer](https://thymer.com) plugin for references. Its core workflows are:

- **Browse references progressively:** open the Reference Navigator, inspect
  children-first context, and pin the session into a side panel when needed.
- **Reference a line of text inline:** type `((` (Roam block refs), search, and link any line in your workspace.
- **Reference a page by name:** type `[[` (Roam page refs) — search or create a page, and the inserted chip renders the page's live name.
- **Copy/paste a reference:** Roam's copy-block-ref flow — copy a reference to the line you're on, paste it as a chip anywhere.
- **Alias a reference:** change what any reference chip displays (a page reference or an inline `((` text reference), without retyping or recreating the link.
- **Inline Reference Preview:** expand a selected reference in place. Line references use native editable transclusions (with an explicit editable-load action only for a target subtree above 1,500 lines); page references use a fast, persisted, editable property preview with an explicit **Load full body** action.
- **Make a native hashtag typed:** when `#movie`, a safe prefix such as `#mov`, or a bounded fuzzy spelling matches an Attributes type, explicitly accept the truthful line action to keep the hashtag and apply that type's fields/defaults.

## Native hashtag → typed item

This bridge requires Attributes Engine v0.42.1 or newer. Type and commit a
normal Thymer hashtag; RefX does not intercept the native `#` picker. If the
hashtag safely matches an Attributes type, a small line action names the exact
target (`Type #mov as Movie`) and reports ambiguity when alternatives exist:

- Click **Make #tag typed** or press **Option+Enter** to accept.
- Click the active/passive label or press **Option+M** to change and remember
  that type's default mode.
- Press **Escape** or click × to decline with no document write.
- Run **RefX: Undo last typed capture** to remove the type token and only the
  unchanged generated fields owned by that receipt.

Acceptance keeps the native hashtag, adds `++Type` for active materialization
or `##Type` for passive membership, and waits for Attributes to finish before
reporting success. Undo refuses if you edited the source or generated output.
Provider generation changes and RefX/Attributes hot reloads use an exact,
bounded receipt handoff; recoverable or partial outcomes keep undo/retry state
and never claim that nothing changed without proof.

## Reference a line of text with `((`

Thymer references a whole page out of the box; this adds references to an individual line.

1. Type `((` anywhere in a line. A search box opens right at your cursor.
2. Keep typing to search. Results show a snippet centred on the match (matched words highlighted) with the source page beneath.
   - **Any-order tokens (default):** `season 3 agents` finds `… S.H.I.E.L.D. S3` without typing words in line order.
   - **Explicit AND:** `+` still requires every clause (`bestäm + leda`).
   - **Phrase search:** wrap a clause in quotes to match it as one phrase.
   - **Abbreviations:** `s3` matches `season 3` (and vice versa); add your own under `custom.picker.abbreviations`.
   - **Typos & close matches:** one wrong letter can still surface a row; numeric tokens never fuzz across values.
   - **Pick memory:** a previous pick teaches the picker — empty `((` shows learned targets after recent picks.
   - **Identifier search:** punctuation, spaces, and letter/number boundaries are interchangeable—`EMP 26` finds `EMP26-002-BHP`, and `QUAL 4507 11` finds `QUAL-4507.11`.
3. Pick a line with **↑/↓ then Enter**, or click it. A reference to that line is inserted, displaying the line's text.
4. **Esc** cancels and removes the `((` you typed.

The box opens at the caret and the editor keeps focus, so it works mid-sentence and with several references in one paragraph. To turn the trigger off, set `custom.lineRefTrigger: false` in the plugin's **Configuration** tab.

**Previews while you pick:** rest the pointer on a result row for a moment and a preview card opens beside the picker — the line's text, its source page, and its first children (a page shows its name and first lines) — so you can confirm the target before inserting. It closes as soon as you move off the row or keep typing.

## Reference a page with `[[`

Type `[[` and the same fast, identifier-aware box searches **pages** by name instead (Thymer has no native `[[` handler — its native link flow is the `@` command, which keeps working untouched). Pick a page and an untitled record reference is inserted: the chip renders the page's live name, so it follows renames.

If no page has the exact title you typed, the **+ Create page** row is selected by default; press **Enter** to create it and insert the reference, matching Roam's `[[new page]]` behavior. New pages go to the **Notes** collection; if Notes is unavailable, the workspace's default new-page collection is used. Fuzzy matches remain available—use ↑/↓ or the pointer to choose one explicitly instead of creating the exact title. The entire search/create flow works by keyboard. Turn the trigger off with `custom.pageRefTrigger: false`.

### Distinguish page links from line links

Open **Reference Extravaganza — Settings** and choose **Reference appearance**:

- **Roam-inspired** (default) — matches Roam Research's live styling: line references (`((uid))`) inherit the body text color with a hairline bottom underline and a light hover wash, like Roam's `.rm-block-ref`; page references are Roam link blue (`#106ba3`) with no underline, like `.rm-page-ref--link`; the reference count is a quiet number at 0.8em and 50% opacity, like `.rm-block__ref-count`.
- **Distinct** — page references are blue with a solid underline; line references use a teal dotted underline.
- **Native Thymer** — the plugin adds no link colors or underline treatment.

Under the preset, the same Settings modal exposes appearance knobs: page-link color, line-ref underline color and style (none / solid hairline / dotted), line-ref hover background, count size (0.7em–1em), count opacity (0.2–1), and count weight (regular / semibold), plus a reset button. Each knob writes one CSS custom property on `<body>` (`--refx-page-link-color`, `--refx-line-underline`, `--refx-line-hover-bg`, `--refx-count-size`, `--refx-count-opacity`, `--refx-count-weight`) and applies instantly without rescanning the document, so it is just as fast on a page with millions of references. Knobs persist in localStorage; `custom.appearance: { pageLinkColor, lineUnderline, lineUnderlineStyle, lineHoverBg, countSize, countOpacity, countWeight }` seeds defaults.

The setting applies to every reference, including targets with no count badge, and changes paint only—typing/caret geometry is untouched (no padding, border, or font-size enters an editable chip). The Configuration default is `custom.referenceStyle: "roam"` (`"distinct"` and `"native"` are also accepted; a stored choice wins).

## Copy and paste a reference

The `((` picker covers the search side; these cover the "I'm looking at the source" side, like copying a block ref in Roam.

1. Put the caret on the line you want to reference and run **Copy reference to current line** (Command Palette). The line is stashed and `thymer-ref://<guid>` lands on your clipboard.
2. Put the caret where the reference should go — any line, any page — and run **Paste reference**. The chip is inserted at the caret, displaying the source line's text.

**Or just press Cmd/Ctrl+V.** A native paste of the copied `thymer-ref://` URI inserts the reference chip directly (instead of the literal URI text). Ordinary pastes are untouched.

## The reference menu

Right-click any reference chip — or put the caret on one and run **Reference actions** — for the compact Roam-style menu. A bare **left-click on a line reference opens that same menu with the reference chain first and a compact path-context strip below it** (the same Roam-clear crumbs as inline rows). **Double-click** still jumps to the source line. Page-reference left-clicks still navigate normally, and modifier-clicks keep their native/Workbench behavior. `custom.lineRefClickContext` is tri-state: absent, `true`, or `"menu"` uses the context menu (default); `"popover"` restores the standalone context popover; `false` or `"off"` opens the plain action menu. Set `custom.lineRefClickMenu: false` to restore native navigate-on-click for line references.

The menu's **⟵ reference chain** appears first. It automatically walks every incoming-reference branch with no depth
setting, marks cycles and convergent paths instead of repeating them, and keeps
at most two cold level resolutions active. Rows arrive cooperatively (8, then
40 at a time) inside their own scroll region; the 200-row limit offers **Open in
Workbench**. Each count pill reports and folds its resolved branch. Navigation
is deliberate through the row's ↗ button, so exploring the tree never yanks the
current panel away.

`window.__REFX_CHAIN_DIAG` reports the scheduler without overstating provider
control. `active`, `activeLevels`, and `maxConcurrent` count RefX-owned leases,
which never exceed two; `timedOut` reports bounded-timeout revocations. Because
an older provider may ignore `AbortSignal`, `providerAbandonedActive` separately
counts revoked calls whose provider promise is still unsettled, while
`providerAbandonedTotal` and `providerAbandonedSettled` retain lifecycle totals.
Those provider counters are window-persistent across same-document hot reload,
so installing a replacement instance cannot make abandoned work disappear from
the diagnostic tell.

Navigation stays at the top; **Replace with**, **Apply children**, **Aliases**, **Copy**, **Paste**, and **Delete** open flyouts. **Open in side panel** uses a real Thymer panel, while **Add to Workbench ▸** collects either the reference or its linked-references view. **Open linked references** is its own top-level action. Line-reference child application remains subtree-preserving and capped at depth 5 / 50 lines. Dwell on any chip for 350 ms and a **recursive hover card** opens: a scrollable body window with live reference chips, ancestor crumbs, optional pin, and nested cards when you hover chips inside (cycle guard, close grace, palette gate; `custom.hover.*`). **↑/↓** navigates, **→** enters a flyout, **←** returns, Enter picks, and Esc closes the flyout before the parent menu. Shift+right-click gives you the normal browser menu.

**Replace with…** (straight from Roam):
- **Text** — the chip becomes the target's text, fully severed.
- **Alias (\*)** — keep the link, display `*`.
- **Text and alias** — the target's text followed by a starred link back to it.
- **Embed** — the target is embedded under the line and the chip goes away.
- **Original (move here)** — line references only: choose **Bring nested items along** to move the referenced line and its subtree, or **Swap blocks only** to keep its direct children at exactly the old depth beneath the marker reference. All moves preserve line GUIDs.

### Reference-menu extensions

Other plugins can add context-aware actions through `window.__refx.registerMenuExtension({ id, owner, label, icon?, when?, onSelect })`. `owner` is required: use the name of a window singleton your plugin clears on unload, or an object with `id` and `isAlive()`. Dead-owner rows are pruned before render and checked again on selection. The call returns a same-id-safe disposer. Integrations can also call `window.__refx.unregisterMenuExtension(id, ownerId?)` and inspect callback-free descriptors from `window.__refx.listMenuExtensions()`. Icons must be lowercase Tabler suffixes such as `bolt` or `ti-bolt`.

If RefX loads after your plugin, register three ways: call `window.__refx.registerMenuExtension(...)` when the bridge is already present; push `(bridge) => bridge.registerMenuExtension(...)` onto `window.__refxMenuExtensionProviders`; or listen for the `refx:bridge-ready` document event (`detail.version`) and register in the handler. Queued providers drain once when the bridge appears and again before each Extensions menu build.

## Reference counts on every chip

Every reference chip — page *and* line references — shows a small superscript count of how many places reference its target (absorbed from the standalone Reference Counter plugin — that plugin is retired). **Click the count** (the hit area is comfortably larger than the digit) to toggle the [inline linked-references section](#inline-linked-references) under the line; **Shift+click** for the **full-context popover** of the referencing lines. Each row shows a muted clickable path then the content. Click the explicit ↗ action to jump, or hover for **◧ open in side panel**, **✎ edit** (where supported), and **⤵ Embed here**. **Alt+click** a badge instantly embeds the top referencing line. The `((`/`[[` picker shows the same counts per result. Palette commands: toggle counters, hover-only mode, count mode (combined / lines / records), refresh, clear cache. Tune under `custom.counter` in the Configuration tab (`clickAction`, `minCount`, `showZero`, `showSelf`, `maxResults`, `opacity`, `fontScale`, `excludeCollections`, …).

## Counts on referenced lines (outline counts)

The reverse view of the chip badges: any line whose **own guid is referenced elsewhere** shows a subtle count pill at the end of the line, outline-wide — just like Roam's counts on referenced blocks. Click the pill to expand that line's inbound references as the same inline section below it (Shift+click for the floating popover, Alt+click to instant-embed the top reference). Counts are inbound-only, never appear inside embeds or plugin UI, come from the same cache as the chip badges, and turn off with `custom.counter.targetLineBadges: false`.

## Inline linked references

Roam's count-click. Clicking a reference-count badge expands an **↙ N Linked References** section directly under that line, pushing the page content down. Each row is one muted clickable path (`Page › parent › date › @mention › ○`) followed by the referencing content at body size; crumbs render by kind and dedupe repeats, and a line that is only a reference to the target collapses into the trailing ○ so its children render directly. One ▾ per row folds the whole row. Rows are flat (Roam's inline references); the Workbench linked-refs view keeps per-page groups. The header holds the count and `⌕ ⇅ ⧉ 📌 ✕`; the filter box and page/hashtag chips sit behind ⌕. Timestamps and row actions show on hover. The floating Shift+badge popover uses the same row model. Click the count again (or ✕) to collapse.

Crumbs zoom the row in place: the page crumb renders the whole page inside the row with the referencing line highlighted; ancestor crumbs and tree dots zoom deeper. For a line target the first row is the target line in its own page context (the home row), then the referencing rows. Reference chips inside rendered content zoom to their target. Every line in a row — the referencing line, its children, and the ○ of a line that is only a reference — carries its own quiet count; click it (or focus it and press Enter/Space) to open that line's references right under it, and keep going from there as deep as the references go. Counts for lines already open above you are not drawn, so hops never loop back. Click a count again to fold its references.

Editing a row rewrites only the text *between* the line's references/dates/tags — those anchors pass through byte-identical, and the edit is refused if you delete or reorder one (jump to the source for that). Enter commits, Esc cancels (Esc closes the editor first, then the section), blur commits.

The section is **not part of your document** — it's plugin-drawn (no lines are created; use ⤵ when you want a real embed), survives Thymer's re-renders while you type, and is session-only: it collapses when the panel navigates elsewhere and doesn't persist across reloads, exactly like Roam. Default clicks: plain = inline section, Shift = floating popover, Alt = instant embed; set `custom.counter.clickAction: "popover"` to swap plain and Shift.

### Pin a section (Roam's `{{mentions}}`)

Want a section that *doesn't* go away? Click the **📌** in its header. A pinned section persists — it reopens on every load, after navigating away and back, and on your other clients — giving you a durable, live "all references to X, right here" block. Still zero document lines: the pin is stored as invisible meta on the host line, and the section is rebuilt by the plugin's normal discovery passes, live and editable like any other.

One line can pin several sections (one per target). Click the 📌 again to unpin (grey = session-only, colored = pinned); **collapsing a pinned section also unpins it** — a deliberate close means "stop showing this", not "hide it until the next discovery pass reopens it".

## Reference Workbench — Roam's editable right sidebar

A right-docked panel holding the pages, lines, and linked-reference views you're working with — Roam's right sidebar, semantics checked against the Roam help graph's [[Right Sidebar]] page. Run **Open Reference Workbench** from the Command Palette (or the statusbar toggle) to open it; sending anything to it opens it automatically, like Roam.

**Everything is natively editable (v3.15.0, default).** Each item opens as a real Thymer **transclusion**: click into it and **type, add children, check tasks, edit properties** — saved straight to the source, exactly like Roam's sidebar windows. The shelf's source of truth is the body of a **"Reference Workbench State"** record (one transclusion line per item), so order and content **sync natively across your devices** — no JSON, no localStorage store. Your existing shelf is migrated into it automatically on first load.

Each item gets a slim **header** above it: **▾ collapse**, **📍 pin** (pinned items hold the top; new items land below them), **⋯ view-as** (**Full editable** shows the block with its whole subtree, like Roam's `{{embed}}`; **Children only** shows its direct children at their fold state, deeper levels behind `▸`; **Card (read-only)** shows a read-only outline; **Linked references** shows the pages that reference it; convert any item to another form and back, per item). A reference inside the body is a pointer: the referenced record's own lines never ride along, and any the host pulls in fold into a `▸ N lines from <Record>` row at the foot of the item that brings them back on click. **⋯ ▸ Depth** (Direct children / Two levels / Everything) sets how deep an item opens; **⋯ ▸ Zoom out one level** and **Back to original** re-root a line target up its chain and back; **`⤓ Back to original`** on the header does the same; **⇱ swap to main**, **✕ remove**; the title jumps to source. Line targets also get the **Block Outline** trail described above: click a crumb to zoom out in place with the opened line outlined, Shift for a side panel, ⌘ to jump, hover to preview, Alt+←/→ from a focused header. Click the header **linked-reference count** to open linked references as a separate shelf item. A sticky **filter box + count + Clear-all** sits at the top (⌕ uses the shared recall scorer). **Stacks** (▤ menu, Ctrl/Cmd+Shift+1–9) save and restore named shelf layouts as `Workbench Stack:` records. **Reopen closed** (↶ or Ctrl/Cmd+Shift+T) brings back recently removed items. A **tab strip** mirrors shelf order (click scrolls; Alt+↑/↓/Enter/W for keyboard navigation). A **trail strip** (`.refx-wb-trail`, after the tab strip) shows your last reference hops from `window.__refxTrail`, with jump, save-as-stack, replay, and clear (`custom.workbench.trail=false` to hide). A **related strip** after the last shelf item suggests up to five pages referencing your open items or the main panel (`custom.workbench.related=false` to hide). A **shared-neighbours strip** (`.refx-wb-shared`, after the trail strip) lists up to five records your open shelf items all reference in common (`custom.workbench.shared=false` to hide). An item whose target was deleted shows a "(target deleted)" header instead of a broken embed. Drag-reorder is the **native** line drag. Width is the native panel divider.

**Ways to collect:**
- **Shift+click any reference chip or page link** — intercepted before navigation, so the page doesn't jump (count badges keep their own Shift+click behavior).
- **Ctrl/Cmd+Shift+O** with the caret on a reference — Roam's "open link under cursor in the sidebar" chord. Set `custom.sidebarChord: "panel"` to restore the old behavior (open in a native side panel) instead.
- The reference menu's **Add to Workbench ▸ Reference** and **Add to Workbench ▸ Linked references** rows.
- The **⧉** button in an inline "↙ N Linked References" section header adds that Linked-references view (the group-header ⧉ adds the group's source page).
- Palette: **Add current line to Workbench** / **Add current page to Workbench**.

Duplicates move to the top instead of stacking; new items land **below the pinned block**.

**What a Workbench line can do:** every line inside an item carries its own quiet reference count, the same badge the page shows. Click it and that line's linked references open inline under the line, inside the item, and you can keep hopping from there. Set `custom.workbench.lineBadges: false` to hide the badges again.

## Connections

The connection engine builds a **stamped in-memory index** (reverse references, record lines, forward refs, line ownership, child lines) and runs **bidirectional path search** between two record or line guids, including **containment hops** (line on page) and **child-carried references** (`via child`). Default **max depth is 3** with frontier and node budgets; override via `custom.connections.maxDepth` (1–12). Set `custom.connections.enabled=false` to hide **Show path to…** and skip path picker entry. Set `custom.connections.strength=false` to disable traversal hop ranking (recording still runs).

**Evidence labels** on related chips and suggested connections summarize why an item might matter: reference count from the badge cache, the newest resolvable journal date among referencing lines, and the most common structural parent label — all cache-only, no extra SDK I/O. Behavioural **co-occurrence** (`refx_cooccur_v1:<workspace>`) adds evidence such as `never linked · appears with this on 6 days` when targets co-occur on journal lines without a direct link. **Traversal strength** ranks familiar hops from `refx_traversal_v1:<workspace>` (decayed, capped at 60) in the picker, path search, related/shared strips, and reference chain — toggle with `custom.connections.strength` (default true). Hops are also recorded in a 50-entry `window.__refxTrail` ring (persisted at `refx_trail_v1:<workspace>` and surfaced on the Workbench trail strip).

## Delete guard

Roam warns you before deleting a block that other blocks reference — this plugin does the same for its own destructive actions. Collapsing an embed and the reference menu's **Delete reference…** rows first check (from the counter's cache — free when the answer is zero) whether other lines reference the line being touched; if so, a confirm dialog lists up to 5 of the referencing lines in full context (click one to jump to it) with **Delete anyway** / **Cancel**.

The palette command **Check references to this line** is the read-only version: with the caret on any line, it expands the inline **↙ N Linked References** section for that line — no badge required.

**Limitation:** native deletes bypass the guard. Thymer's editor owns Backspace/Delete/cut, so removing a line with the keyboard can't be intercepted by a plugin — the guard covers exactly this plugin's own delete paths. Run **Check references to this line** before reorganizing when you want the same safety on manual edits.

## Alias a reference

### Quick start: aliases in 60 seconds

Aliases give one page or line several memorable names without changing its GUID. Type `[[Math`, highlight **Math**, press **⌥A**, type `stats`, then press **Enter**. The inserted chip says **stats** but still links to **Math**, and RefX confirms the saved alias with a toast. Later, `[[stats` finds the same page. If Math has several aliases, press **⌥↓** on its highlighted result, move across the chips with **←/→**, and press **Enter** to choose the title the new reference should show. Click a chip's **×** (or press **Alt+Backspace**) to delete that alias.

| Action | macOS | Windows/Linux |
|---|---|---|
| Create an alias from the picker | **⌥A** | **Alt+A** |
| Choose an existing alias | **⌥↓** | **Alt+↓** |
| Alias the selected reference | **⌘⇧A** | **Ctrl+Shift+A** |
| Delete the active alias | **Alt+Backspace** | **Alt+Backspace** |

The picker prints the platform-appropriate **⌥** or **Alt+** hints. **Tab now drills into the highlighted page or line's children**; it no longer creates an alias.

### Change what one reference displays

This is a display alias for one chip, not a durable search name. Select a page or line reference and run **Set alias for reference**, or press **⌘⇧A** / **Ctrl+Shift+A**. The themed input opens under the chip, pre-filled with its current text: trim it, replace it, or clear it. **Enter** saves; **Esc** cancels. Clearing a page alias restores the page's live title; clearing a line alias resumes tracking the source line's text, including edits made through an inline transclusion.

If that display text is not yet a durable record/line alias, RefX offers **Also save as an alias?** It never writes the durable alias unless you choose **Add**.

### Changing the keyboard shortcut

The default is **Cmd+Shift+A** (macOS) / **Ctrl+Shift+A** (Windows/Linux). To rebind it, run **Set alias keyboard shortcut**, press the new chord, and save. It applies immediately. The equivalent configuration is `custom.shortcut: "Mod+Shift+A"` (`Mod` means Cmd on macOS and Ctrl elsewhere); at least one of Cmd/Ctrl/Alt is required.

## Record aliases

Record aliases are durable alternative names, separate from the display alias on one reference. The record GUID always remains the identity: two records may legally share an alias, picker/search surfaces show every target, and RefX never guesses which ambiguous record you meant.

Alias storage has two synced tiers:

- A collection with an exact multi-value text property named `Aliases` uses that native field. It stays visible/editable in Thymer and is queryable by Datacore.
- Every other collection uses RefX's synced `RefX Alias Registry` record. If the native property later becomes available, RefX verifies a one-time migration into it and removes the fallback entry only after the property reread succeeds.

Property values win when both tiers temporarily contain the same normalized alias. RefX merges both tiers into one in-memory vocabulary and serializes writes per record. The fallback registry accepts at most **2,000 records with aliases**; the cap blocks only a new entry, so existing entries remain editable and collections with a native `Aliases` property are unaffected.

Run **RefX: Aliases for this record…**, choose **Aliases ▸ Manage aliases…** from a page-reference menu, or use the **Aliases · …** entry on an embedded record's property card. The modal labels native-property and synced-registry values separately; Enter adds, and every alias can be renamed or removed with the keyboard. Its muted **× N** is the number of live reference chips currently titled with that alias.

In the `[[` picker, type the alias as naturally as a page name. Alias matches rank above ordinary title matches and render as `Alias ↳ Real Title`. When both the title and an alias match, RefX keeps one row and annotates it `· alias: X` instead of duplicating the target. `alias:phrase` restricts the picker to aliases without a remote search; ambiguous aliases remain separate rows because RefX never guesses the target.

To create an alias while picking, highlight any result, press **⌥A** / **Alt+A**, edit the query-seeded input, and press **Enter**. RefX saves the alias, shows a success toast, and inserts the real GUID using that alias as its visible title. On a highlighted **+ Create page** row, the same chord creates the page first and then opens the alias input. **Tab drills into children**; **Enter** keeps its ordinary insert/create-page behavior.

Press **⌥↓** / **Alt+↓** on a highlighted result to reveal all its aliases as chips immediately underneath. **←/→** (or ↑/↓) moves, **Enter** inserts with that alias, and **Esc** returns to result navigation. Delete through a chip's **×** or **Alt+Backspace** while a chip, chooser alias, or highlighted `Alias ↳ Real Title` result is active. Set `custom.aliasChips: false` to hide the separate alias-chip row under active panel titles.

Chooser chips are ordered by live usage, most-used first, and show **×N** when N is nonzero. RefX reads the same inbound-reference broker used by alias-rename previews, only when the manager or chooser is shown, and caches the display-only counts for about 60 seconds.

When **Set alias for reference** creates a display label that is not already a record alias, the same popover offers **Also save as a record alias?** This is never automatic; **Not now**, Esc, or clicking away dismisses that record/text pair permanently on the current device.

RefX also learns from authored reference titles during idle time. Three or more uses of the same display text for one target queue at most one **Frequently used: “text” — add as alias?** row in the manager. The scan is broker-generation/revision guarded and read-only; only clicking **Add** writes.

Renaming a record never breaks these links because references keep the GUID. After title typing settles for about two seconds, RefX can offer **Keep “old title” as alias** for eight seconds; it never adds the alias automatically, skips duplicate/empty names and new-record creation, and can be disabled with `custom.renameAliasOffer: false`. Renaming an alias offers a separate preview of chips still displaying the old text; **Update references** is explicit, preserves rich segments and `viewId`, refuses changed lines, and leaves a bounded receipt for hash-gated undo.

To wire existing prose to the active record, run **RefX: Find unlinked alias mentions (this record)** or choose **Aliases ▸ Find unlinked alias mentions**. Alias Finder scans plain-text, word-boundary matches for the record's aliases (optionally its title), shows the source crumb, highlighted text, and `via “alias”`, and changes nothing until **Link** or **Link all** is clicked. The preview is abortable, capped at 200 matches, titles the new chips with the matched alias, and uses the same hash-gated receipt/undo write path as alias-rename propagation.

Other alias-aware surfaces use the same vocabulary:

- `[[` and `alias:` search label hits as `Alias ↳ Real Title`; collisions remain separate rows.
- Backreferences 0.29 or newer finds unlinked record and focused-line alias mentions, labels the matched alias, and links them through preview/apply/undo.
- Reference Health 0.7 or newer reports record and line alias collisions plus deleted-line tombstones, with navigation to every GUID and no automatic repair.
- R10 Markdown export writes one `Aliases: ...` line when **Include properties** is enabled.

For integrations, `window.__refx.aliases` exposes `get`, `resolve`, `all`, `subscribe`, `add`, `remove`, `rename`, and `status`. Reads are synchronous; writes are guarded and return structured results, including cap-refusal reasons.

## Line aliases

Line aliases are durable alternative names for one stable line GUID. They are separate from both record aliases and the display title on one reference chip. A line may have several aliases; editing its text or moving it to another record keeps them attached to the same GUID.

- Run **RefX: Aliases for this line…** with the caret on a line, or choose **Aliases ▸ Manage aliases…** from a line-reference menu. The keyboard-complete manager adds, renames, and removes aliases and shows the current text, owner, lifecycle status, GUID, and live **× N** usage for each alias.
- Type `((` to search current line text and line aliases. Alias hits rank first and render `Alias ↳ current text · owner`; selecting one inserts the real line GUID with the alias as its display title. The same one-row `· alias: X` dedup applies when text and alias both match.
- `alias:phrase` inside `((` restricts the picker to line aliases and performs no remote search. `[[` remains record-only, so a record and line may safely share the same alias text.
- Highlight a `((` result and press **⌥A** / **Alt+A** to create a query-seeded line alias, or **⌥↓** / **Alt+↓** to choose among its existing aliases. **Tab drills into children** and Enter keeps ordinary insertion behavior.
- Three distinct authored refs using the same non-current display title can produce one **Frequently used… add as alias?** suggestion. Suggestions and display-alias promotion never write until **Add** is clicked.
- Renaming a line alias can preview matching chips, apply segment-preserving updates with stale-source checks, and undo from a bounded hash-gated receipt.

Line aliases live in the synced **RefX Line Alias Registry**, capped at 10,000 aliased lines. The cap blocks only a new aliased line; existing entries remain editable. Deleting a target leaves a tombstone for diagnostics and removes it from normal `((` resolution; undeleting restores it. RefX maintains the registry from line event payloads and never scans every workspace line.

For integrations, `window.__refx.lineAliases` exposes `get`, `resolve`, `all`, `subscribe`, `add`, `remove`, `rename`, and `status` (plus `refresh` for lifecycle metadata).

## Inline Transclusion

See what a reference points to without leaving the page you're on — and open as many as you like.

1. Select the reference (a page reference or a `((` line reference).
2. Press **Cmd+Down** (macOS) / **Ctrl+Down** (Windows/Linux) to expand it. A line reference opens as a native editable transclusion. Only a referenced line whose own subtree exceeds 1,500 lines stays in the instant bounded outline; edit its selected line in a native side panel, or choose **Load complete inline — may be slow** (or press Cmd/Ctrl+Down again) to request every line inline. A page reference opens as a lightweight persisted preview: its title, collection, aliases, properties, and bounded body window remain available without mounting an arbitrarily large body. Choose **Load full body** when you explicitly want the complete native editable body inline, or **Open record ↗** to navigate without mounting it.
3. Press **Cmd+Up** / **Ctrl+Up** to collapse the embed for the reference under the caret (or the one the caret is inside). To clear them all, run **Collapse all embeds (this page)** from the Command Palette.

**Many at once, and they persist.** Expanding a second reference no longer collapses the first — every native embed stays open. Because each native embed is a real line in your document, it survives a reload; it stays until you collapse it. The exceptional large-subtree outline is session-only until **Load complete inline — may be slow** creates the persisted native transclusion.

**Breadcrumb header.** Every embed carries a slim "RecordName › parent line" header: click the record name to open the source page, click the parent crumb to jump to that line. Turn off with `custom.breadcrumbs: false`.

**Display variants.** Right-click a line reference whose embed is open for **Embed display: full / children only** — children-only hides the embedded line itself and shows just its children. The choice persists (and syncs) with the embed.

**Property preview on record references.** When you expand a *page* reference, its title, current collection, aliases, and properties appear immediately — Status, Due, numbers, relations, and so on. Click the title to rename the record, click the collection row to move it to another non-Journal collection, or click any property value to edit it inline. Moving uses Thymer's GUID-preserving record move, so the preview and every reference keep pointing to the same record. The preview is persisted on the exact authored source line and survives reload. When the referenced record has no body, choose **＋ Add body content** to create exactly one first line and replace the preview with the real editable native transclusion. Line references have no properties and remain native transclusions except for the explicit >1,500-line safety gate described above.

**Keyboard navigation of an exceptional line preview.** With the cursor on its
`((` reference, press **↓** to enter **Edit selected ↗**, **Load complete inline
— may be slow**, Previous/Next, and **Open source ↗**. Inside the outline, ↑/↓
selects a source line, Page Up/Page Down swaps the 40-row window, and Enter opens
the selected line in Thymer's native side panel. Normal Tab/Shift+Tab traverses
the actions. Escape or ↑ from the first action returns to the exact authored
line. The bounded read retains at most 300 descriptors; only 40 rows are ever
mounted at once.

Image and PDF rows in that exceptional outline stay metadata-only during initial
paint. Activate **Show image** or **Preview PDF** to resolve just that native line
and load its bounded local blob; selecting or paging the outline never downloads
media or performs another body read.

**Keyboard navigation of the card.** With the cursor on the record reference, press **↓** to step into the card. The record title is first, **Aliases** second, and **collection** third. Press **Enter** on Aliases to manage them. Press Enter on the collection, type to filter, use **↑/↓**, then press **Enter** to move (Esc cancels). Continue through property values with ↑/↓; Enter edits the highlighted value and returns the highlight after saving. ↑ from the title, or Esc, returns to the reference line; ↓ past the final value drops into the embed body. For an empty record, ↓ highlights **＋ Add content** — press Enter and you're typing the first line. (A Command-Palette path, **Edit embedded record (properties)**, still opens a normal Tab-through dialog if you prefer it.)

Under the hood a page preview is decorator UI backed by one synced meta value on the authored reference line; it does not create a shadow record. Its one targeted body probe renders a bounded lightweight window for long records—up to `custom.smallBodyLineCap` lines (40 by default), with a truthful “40 of N” label—without a second read or document write. Non-empty records at or below that cap automatically become native editable transclusions when `custom.autoLoadSmallBodies` is enabled (the default); turn it off to keep the read-only peek. **＋ Add body content** appears only when the probe proves the body empty. **Load full body** performs the native replacement explicitly and keeps the property card above that body.

**Known Thymer limitation:** while the caret is inside a transclusion, the command palette's line-format commands (Heading 1/2/3 …) can act on the transclusion line itself instead of the caret line — which collapses the embed (undo restores it). Until Thymer fixes the palette's target resolution, apply formatting from the source record (**Open source ↗** / **Jump to block**).

## Notes & limitations

- **Property cards show up to 8 properties** (system/internal fields are always hidden). Open the record itself for the full set.
- **Cards are drawn per client**, not synced content: on a device that didn't open the embed, the card appears after discovery (typically well under a second after a change, or on focus/navigation) rather than instantly.
- **Schema changes made mid-session** (a brand-new property or collection) may take one interaction to be picked up — the plugin refreshes its schema map in the background and self-corrects.
- **Relations in the "Edit embedded record" dialog are read-only** — edit them by clicking/Enter-ing the value on the card, which opens the record picker.
- **Record moves exclude Journal collections.** Source properties are preserved across a move, but fields not present in the destination collection's schema remain hidden there.
- **Collapse refuses if you've nested your own lines under an embed** (move them out first) — this protects them from being deleted with the embed.
- **The delete guard only covers the plugin's own delete paths.** Native Backspace/Delete/cut belong to Thymer's editor and cannot be intercepted — deleting a referenced line manually shows no warning. Use **Check references to this line** first when in doubt.
- After updating the plugin, a page reload is still the cleanest way to ensure a single fresh instance.

## Installation

Before upgrading, copy the current **Custom Code** and **Configuration** to a
local backup. Version 4.28.0 requires `plugin.js` and `plugin.json` from the
same release; replacing only one can leave the runtime and manifest out of
sync.

1. In Thymer, open the Command Palette (`Cmd+P` / `Ctrl+P`), run **Plugins**, and click **Create Plugin** under Global Plugins.
2. In the plugin's dialog, go to the code editor (click **Edit as Code** if you see the settings view).
3. In the **Custom Code** tab, replace the contents with [`plugin.js`](plugin.js).
4. In the **Configuration** tab, replace the contents with [`plugin.json`](plugin.json).
5. Click **Save**.

Reload Thymer after saving, then confirm **Reference Navigator**
opens and `window.__thymerReferenceNavigatorV1?.getStatus()` returns a status
object. To roll back, restore the backed-up `plugin.js` and `plugin.json`
together, save, and reload. Navigator sessions and pinned panels require no
data migration; references inserted through the Navigator are ordinary Thymer
reference segments and remain valid. Close any remaining pinned panel after
the older plugin loads.

Don't enable Hot Reload — it's a development feature and can leave the plugin in a state where saved data stops persisting.

### Provisioning the native `Aliases` property

The Aliases roadmap uses an optional multi-value text property named exactly
`Aliases`. RefX is a global plugin and cannot add stored fields to arbitrary
collections itself. Provision the collections you choose with the idempotent
MCP helper:

```bash
python3 scripts/aliases_setup.py Notes Projects
```

Records in collections without that field use RefX's synced Alias Registry.
Reinstalling global RefX is safe, but reinstalling a *collection plugin* can
reapply its manifest schema and remove MCP-added properties that the manifest
does not declare. Re-run the helper after such a collection-plugin reinstall.
The helper refuses to alter an existing incompatible field named `Aliases`.

## Roadmaps

These plans are self-contained entrypoints for a fresh Codex goal. Each starts with a copy-ready objective, current-tree reconciliation, status ledger, phase gates, tests, live verification, and handoff requirements:

- [Reference Platform P0–P2](docs/REFERENCE-PLATFORM-P0-P2-ROADMAP.md) — shared Reference Surface, complete results, durable inbox state, reference operations, saved views, facets, health, editing and export across RefX, Backreferences, and Reference Graph.
- [Backreferences improvements](docs/BACKREFERENCES-IMPROVEMENTS-ROADMAP.md) — direct current-line entry, provisional truth, reversible unlinked review, typed relations, facets, inbox state and saved views.
- [Time Machine / Version Ledger](docs/VERSION-LEDGER-ROADMAP.md) — meaningful edit history, semantic diffs, checkpoints, verified restore and transaction receipts.
- [Outline Refactor](docs/OUTLINE-REFACTOR-ROADMAP.md) — previewed subtree operations with reference impact, GUID policy, verified writes and recoverable receipts.
- [Spaced Review / Incremental Reading](docs/SPACED-REVIEW-ROADMAP.md) — provenance-preserving review items, deterministic scheduling, cloze and a daily queue.

## How it works

- An "alias" in Thymer is just the `title` field on a reference segment (`{type:"ref", text:{guid, title?}}`). The plugin reads and writes that field — set it to your alias, or clear it to fall back to the target's name (the page's title for a page reference, the line's current text for a line reference). Nothing else on the line is touched, and the link target never changes.
- A `((` line reference targets a line item rather than a page; the plugin inserts it as the same `ref` segment, with the line's text as the initial title.
- It finds the reference you're on from the editor's current selection when you run the command.
- **Expanding a reference:** line targets insert a tagged native, editable transclusion by default. Only an actual referenced subtree over 1,500 lines stays in the 40-row instant outline; edit a selected source line natively or use **Load complete inline — may be slow** to materialize the full transclusion. Record targets persist a lightweight preview target on the exact authored host line; explicit **Load full body** materializes the tagged native transclusion. All forms support multiple open targets and exact collapse after reload without touching unrelated native transclusions.
- **Decorator lifecycle:** a shared document-scoped observer keeps property cards, breadcrumbs, inline reference sections, badges, and task overlays attached when Thymer replaces editor DOM, while restricting its work to mutated lines. It stays active only while its mounted decorators need it; separate panel counter observers reject non-reference mutations before scheduling count work.
- **Low steady-state cost:** event, keyboard, and observer callbacks fast-reject unrelated changes; count/relationship indexes are maintained incrementally; and geometry reads are batched outside the pre-paint repair path. Static pages do not trigger recurring body or workspace scans.

## License

[MIT](LICENSE)

## Changelog

### v4.0.0 (durable line aliases)

- Added a separate, synced line-GUID alias registry with multiple aliases, collision preservation, delete/undelete tombstones, per-line verified write queues, and a truthful 10,000-line cap.
- Extended Reference Surface v1 and `window.__refx.lineAliases` with synchronous reads, subscriptions, and guarded writes while keeping record aliases fully backward compatible.
- Added `((` alias rows, restrictive/composable `alias:`, real-GUID insertion, and explicit picker alias creation (moved from the original Tab binding to **⌥A/Alt+A** in v4.9). `[[` remains record-only.
- Added the line manager, display-alias promotion, three-edge learned suggestions, and segment-preserving preview/apply/undo for alias renames.
- Added the frozen cross-plugin contract, traceable roadmap, and 17 focused line-alias tests; 502 deterministic tests total.

### v3.92.0 (A6: alias health, maintenance, and export)

- RefX learns repeated authored display aliases from the broker during idle time and offers at most one candidate per target after three uses.
- Suggestions appear only in the real aliases manager and remain read-only until **Add** is clicked. Partial or stale broker scans are discarded.
- R10 Markdown export includes `Aliases: ...` once when properties are enabled, using the complete property-plus-registry vocabulary.
- The Datacore adapter now specifies native `Aliases` query behavior, fallback registry coverage, collision-preserving Omni results, and bridge-only writes.
- 5 focused A6 tests; 485 total deterministic tests before cross-repo contract scripts.

### v3.91.0 (A5: alias-preserving display and reversible rename propagation)

- Record-title refresh now leaves ref titles matching a current record alias untouched; managed non-alias titles continue to follow the target.
- Renaming a record alias opens an explicit preview of affected ref chips. Apply rewrites only matching ref segments, preserves `viewId` and surrounding rich content, and refuses lines changed after preview.
- The update produces a bounded per-workspace receipt. Undo is hash-gated, idempotent, keeps partial receipts when a source changed, and remains reachable from the aliases manager after reopening.
- 7 focused A5 tests plus the production manage-modal entrypoint assertion; 480 total deterministic tests before cross-repo contract scripts.

### v3.90.0 (A3: alias-aware picker)

- `[[` now searches record aliases with the same separator-insensitive identifier matching as record titles and labels hits `Alias ↳ Real Title`.
- Alias hits insert the real record GUID while preserving the selected alias as the reference title; ambiguous aliases remain separate, labeled rows.
- Restored the composable `alias:` filter. Alias-only search is synchronous and never performs a remote workspace query.
- Alias-mediated picks track per-alias use; three repeated non-alias routes to the same record produce one remembered `Save “query” as alias?` suggestion.
- Documented `window.__refx.aliases` for Datacore and other guarded consumers; added 6 A3 production-path tests.

### v3.89.0 (A2: alias creation and management UX)

- Added the tier-labeled, keyboard-complete record-alias manager from the palette, record-ref menu, and property card.
- Added the explicit picker alias-save flow (moved from the original Tab binding to **⌥A/Alt+A** in v4.9) before inserting a GUID reference with the typed display title; Enter behavior is unchanged.
- Added one-time, non-automatic promotion from a per-reference display alias to a record alias.
- Added default-on, zero-document-mutation active-panel alias chips with cached pre-paint reinsertion.
- 5 new A2 production-path tests; 467 tests passed before the version-guard update.

### v3.88.0 (A1: global alias data layer)

- RefX now owns a global `AliasSetV1` index, separate from one reference chip's display alias.
- Exact multi-value text `Aliases` properties are adopted when present; other collections use a lazy synced `RefX Alias Registry` record.
- Property/registry writes are queue-serialized and verified, concurrent additions converge, and registry values migrate into a newly provisioned property before registry deletion.
- Reference Surface v1 adds `supportsAliases`, synchronous `aliases.get/resolve/all/subscribe`, and additive `resolveTarget(...).aliases`; `window.__refx.aliases` adds queued writes.
- `RefX: Provision Aliases property…` truthfully lists missing/incompatible collections and copies the external MCP setup command.
- 16 A1 tests; 462 tests total across the exact current suite.

### v3.87.0 (R10: resolved Markdown export)

- `RefX: Export as Markdown…` palette command — modal with scope/options/preview/Copy/Save-to-file.
- Bounded walk: 5 000-node / 512 KB budgets; explicit cycle markers (`<!-- cycle: name (guid) — not re-expanded -->`); explicit truncation markers.
- Segment fidelity: headings, tasks, lists, code blocks, external links, ref links (alias or resolved text, `thymer-ref://` when preserving), datetimes, properties.
- Expansion at depth 0–3 (default 1), GUID-keyed visited set across records and lines, byte-identical repeat runs.
- R4 selection surface gains an Export action (subtree scope).
- Saved-view scope reads via `referenceViews.get()`.
- 44 new tests in `test/r10-export.test.cjs`; 446 tests total across 10 suites.

### v3.86.0 / v3.86.1 (R7/R8: snapshot facets, FilterExpressionV1, claim rows, edit-live)

- **R7**: `_r7FacetSnapshot` — 6 facet dimensions (kind/authored/derived/task/date/sourceProperty) from `broker.inEdges()` at O(k); `_r7ApplyFacetFilter` client-side filter; `_renderR7FacetBar` chip bar with counts.
- **R7**: `_renderClaimRow` — typed claim edges with predicate, authored/derived badge, provenance, navigable via `_bridgeJump`.
- **R7**: FilterExpressionV1 — nested AND/OR over FilterV1 leaves; `filterExpr` param on `broker.edges()`/`broker.occurrences()`; `supportsFilterExpr: true` capability flag; `apiVersion` stays 1.
- **R8**: `_r8EditLive` — document-neutral peek + "Open to edit ↗" navigation (no `createEmbed`); one active editor per view; `_r8SettleRerender` rerenders from current data after close; `_r8AssertSingleEditor` structural assertion.
- Review fixes (v3.86.1): facet bar wired into live render path; claim rows wired; edit-live wired; remote-settle re-reads current line state.
- 52 tests in `test/r7-r8.test.cjs`.

### v3.85.0 / v3.85.1 (R6: synced saved Reference Views)

- `ReferenceViewV1` records persisted in a workspace collection (Workbench native-record pattern, `PluginCollectionAPI.createRecord` — no `data.createNewRecord()`).
- Append-only revision DAG with derived heads + explicit merge; per-view write serialization; no last-write-wins reads.
- Pin migration guard (idempotent, per-client localStorage flag).
- `window.__refx.referenceViews` API: list/get/save/heads/resolveConflict/subscribe/_dispose.
- 51 tests in `test/r6-reference-views.test.cjs`.

### v3.84.0 / v3.84.1 (R4: multi-line reference operations)

- Plugin-owned selection panel: checkbox/shift-range/subtree select, keyboard nav, contiguity detection.
- Capability registry: 6 ops mapped to executor requirements (none / OutlineO2-O5 / VersionLedgerV4); absent executors render disabled with reason.
- Enabled ops live: copy-as-refs (clipboard `thymer-ref://` URIs), transclude-subtree (via `_bridgeCreateEmbed`, contiguity-gated).
- Gated ops: extract/detach/move-copy-sort/undo-checkpoint — preview/plan-only, zero mutations verified.

### v4.15.1 (R4: provider lifecycle safety)

- Every authoritative Outline preview, including planned undo, is bound to the
  exact provider object and O5 generation that produced it.
- Capability detection safely validates `status()` and requires healthy phase
  O5 mutation state with exact mode `integrated-planned-undo`. A missing,
  unknown, degraded, disposed, mutation-disabled, or generation-inconsistent
  provider fails closed.
- Apply revalidates the bound provider before `getApplyRequest`, so hot
  replacement or unload cannot move a reviewed preview onto another runtime.
  Duplicate apply remains delegated with the same exact request for provider
  idempotency.
- 56 focused lifecycle, delegation, selection, preview, and operation tests live
  in `test/r4-operations.test.cjs`.

### v4.15.0 (R4: Outline O5 execution)

- R4 now resolves the authoritative `window.__thymerOutlineRefactorV1`
  capability at action time, so either plugin may load first.
- Extract, detach, move, copy, sibling sort, and safe move/sort undo build a
  real Outline preview and remain non-mutating until the separate
  `Apply reviewed plan` action.
- Apply uses only Outline's exact immutable current-generation request; RefX
  does not own structural SDK writes, compensation, or checkpoint receipts.
- The selection panel includes explicit destination, new-record collection,
  replacement, detach-depth, transclusion-host, and receipt-ID inputs.
- Copy-as-reference remains a clipboard operation; native transclusion remains
  the existing RefX primitive but now has separate preview and apply actions.
- `OutlinePlanV1` objects emitted for all op types; last-8 plans stashed in `_r4Plans`.
- 49 tests in `test/r4-operations.test.cjs`.

### v3.83.0 / v3.83.1 (R5: hierarchical and scoped reference picker)

- Tab/Enter drill into record/line children; Backspace/crumb back with query restore.
- Structured filters: `in:`/`is:task`/`status:`/`kind:`/`before:`/`after:`.
- Frecency rank with bounded boost (500-entry LRU); one cancelable session token.
- Strict-pattern exact-GUID lookup; zero body scans on filter paths.
- 51 tests in `test/r5-picker.test.cjs`.

### v3.82.0 / v3.82.1 (R2: complete paginated results)

- Cursor/page model for inline refs: display-side chunking of complete in-memory sets.
- Show-more with exact remaining; `_r2FillId` stale-continuation guard.
- Warm pass capped truthfully; `_cappedAt32`/top-8 affordances.
- 30 tests in `test/r2-pagination.test.cjs`.

### v3.81.0 / v3.81.1 (R1: shared Reference Surface v1 broker)

- `window.__thymerReferenceSurfaceV1` broker: all edge families (ref/property/annotation/claim), event-maintained incl. moved/remote, opaque cursors, zero-scan post-complete.
- 63 tests in `test/reference-surface-broker.test.cjs`.

### v3.80.0 and earlier

Base version at program start (2026-07-11 audit). Core features: `((` line refs, `[[` page refs, copy/paste ref, alias, inline transclusion, property cards, breadcrumbs, badge decorators, Reference Workbench, Attributes claim broker.
