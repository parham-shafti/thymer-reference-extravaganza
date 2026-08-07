# Changelog

## v3.3.0 — 2026-07-18

**New**
- **Add indented lines under a standalone line embed.** When you expand a `[[` line reference whose target has no children of its own, the embed now shows a writing strip at the bottom. Click it to add an indented child line under the referenced line, with no layout jump (the same affordance live-search embeds already had).

**Fixes**
- **Property cards no longer show archived fields.** A retired collection field (one that's still in the schema but switched off, so it doesn't appear in the native property pane) was being listed on the embedded card, sometimes twice. Cards now mirror native and show only active fields.
- **Relation picker search now ranks by relevance, like native.** Searching a record field (Habitat and the like) puts exact and prefix matches first instead of leaving the list alphabetical, so typing "psychology" surfaces "Psychology" at the top rather than burying it.

## v3.2.1 — 2026-07-16

- **Fixed: dates went missing from a line's text.** In `[[` search results, the hover preview, and the alias box, a date on the line (like "Thu Jul 16") rendered blank, so it dropped out of the displayed text. Dates (and times, and granular labels like "Week 28") now show with their native-looking label.

## v3.2.0 — 2026-07-16

A polish round on the `[[` picker and property editing, with a new hover preview.

**New**
- **Line preview on hover in the `[[` picker.** Hovering a result shows the full line text in a floating preview just below the row, with the matched words bolded. Handy for long lines and paragraphs where the row only shows a windowed snippet.

**Improvements**
- The `[[` line-reference picker now uses Thymer's native command-palette look: mono type, the accent selection bar, and bold match highlighting, matching the `@` menu.
- Text properties edit in a wrapping, auto-growing area, so long or multi-line values (Synopsis and the like) are fully visible and editable instead of clipped to a single line.
- The plugin description is now a short one-liner instead of a full manual.

**Fixes**
- You can switch straight from editing one property to another now. The open editor commits first instead of leaving the card stuck.
- Editing a property can no longer wedge the card so that inline transclusions stop expanding or collapsing. A stuck editing state now self-heals on the next keypress or click.
- Cmd/Ctrl+Down on a collapsed line that holds a reference now unfolds the block first (like a normal outline), then expands the transclusion on the next press. It no longer does nothing on chevron-folded lines.
- Relation picker option icons are round again. A collection's built-in dot icon was being stretched into an oval.

## v3.1.0 — 2026-07-04

A big round of polish on the property cards and inline embeds, plus a new way to expand live-search results.

**Live-search embeds (new)**
- Expand a live-search / query result in place with Cmd/Ctrl+Down: the result LINE opens as an inline embed right under it (its indented content included), and any page references it carries can be expanded nested inside. Cmd/Ctrl+Up collapses it.
- Empty or childless results open too, with a writing strip at the bottom. Click it to add an indented child line under the result, with no layout jump (the strip reserves exactly the space the new line fills, then collapses as the line appears).
- A result that is itself a page gets the editable property card like any page embed.

**Editable image / file properties**
- Image properties (Poster and the like) now show the actual image in the card instead of "[object Object]". Data-URL, URL, and stored-blob images all render; a non-image file shows a paperclip and its filename.
- Click the image (or the pencil) to replace or add one through a file picker. Right-click for Open image (a full-size viewer), Download, and Delete.

**URL properties**
- A URL value is clickable now: clicking the link text opens it in the browser, like native. (The oversized ↗ badge is gone.)

**Property-card polish**
- Each row shows the field's own native type icon (a person for people fields, and so on) in the native colour, instead of one generic icon.
- Long text values (Synopsis and the like) wrap over several lines like the native pane instead of being clipped to one.
- Choice values render in their real palette colour instead of always grey.
- The card's colours and corner radius now follow theme switches live (light and dark), instead of freezing at whatever they were when the card was first drawn.

**Inline embeds**
- An empty embed is a stable, comfortable click-to-type area: clicking no longer makes the caret jump, and the redundant "+ Add content" button (which itself caused a jump) is gone.
- Cmd/Ctrl+Up only collapses from the reference's own line or the embed line, so it no longer hijacks the native fold-indent shortcut while your caret is inside an embed's content. Collapsing also no longer leaves "…" fold dots on the line.
- On a line with several page references, Cmd/Ctrl+Down expands the one nearest your caret; a second press opens the next reference on the line (before, it did nothing once one was open).

**References**
- Inserting an inline [[ reference verifies the write landed and retries if the editor's own flush clobbered it, so it can no longer say "Referenced …" while leaving nothing behind.
- Relation picker: the card stays visible while you pick, removing then re-adding the same value works, current values carry a native remove ×, and you can create a new record inline from the picker.

## v3.0.0 — 2026-07-02

The property-card release: community PR #1 by **@Svyk** (persistent multi-embeds + editable property cards, v2.3.0–v2.10.3 below) merged, plus a native-look pass and the pending features on top:

**Native-look property cards**
- The card now renders through Thymer's own property-pane classes: native row layout with type icons, value pills with enum colors and each record's own icon (falling back to its collection's icon), a clickable ↗ on record pills that opens the record, dates/text in native plain style, and empty values blank with a hover pencil — pixel-matched against the real pane (chip height, fonts, radii) and theme-tracking by construction.
- The card's background/border are copied from the transclusion body at render, so card + body read as one box in any theme.
- **Properties view chooser** on the card ("Properties · All ⌄"), like the native pane: **All** (always everything), **Filled in** (non-empty), and **Custom** (your own checklist — toggling a field switches to Custom seeded from the current view). Checkmarks always reflect what the card is showing.
- **Native-anatomy relation picker:** current values listed first with green check badges (click to remove), suggestions with their icons below — the field's target collection when declared, otherwise recently edited records workspace-wide. Multi-value fields (schema `many`) toggle without closing; single-value picks replace and close; "(None)" only where it applies. Read-only fields refuse politely.
- System fields (Title, Collection, Banner, …) and deleted fields are excluded, exactly like the native pane.

**Fixes**
- **View changes no longer jump the page.** Root causes: saving view prefs through the plugin config made Thymer reload the whole plugin (cards torn down and rebuilt = the jump) — prefs now live in localStorage; and manual scroll "restoring" fought the browser's scroll anchoring — removed in favor of it.
- **Keyboard focus returns to the editor** after closing any picker/popup or committing an inline edit (and after the alias box) — previously the next keystroke could scroll the page instead of typing.

**Pending features folded in**
- **Convert reference ↔ embedded line** (Cmd+Ctrl+R + command): swap a compact reference chip and a whole-line embed in place, both directions, position preserved (including nested lines).
- **Set Reference Extravaganza shortcuts**: one dialog rebinding both the alias and convert shortcuts.
- Alias focus fix: pressing Space right after setting an alias types a space instead of scrolling.

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
