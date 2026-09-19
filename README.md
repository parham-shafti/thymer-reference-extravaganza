# Reference Extravaganza

Reference Extravaganza is a [Thymer](https://thymer.com) plugin for references. It does three things:

- **Reference a line of text inline:** type `[[`, search, and link any line in your workspace.
- **Alias a reference:** change what any reference chip displays (a page reference or an inline `[[` text reference), without retyping or recreating the link.
- **Inline Transclusion:** expand a selected reference in place to reveal what it points to inline, right under it — many at once, persisting across reload, and for a page reference with an editable card of its properties.

## Reference a line of text with `[[`

Thymer references a whole page out of the box; this adds references to an individual line.

1. Type `[[` anywhere in a line. A search box opens right at your cursor.
2. Keep typing to search. Results show a snippet centred on the match (matched words highlighted) with the source page alongside, styled like Thymer's own `@` menu.
   - **Phrase search:** results match the phrase you type.
   - **Multi-term search:** use `+` to require several terms in the same line, in any order (for example `bestäm + leda`).
   - **Hover a result** to see the whole line in a preview just below the row, matches bolded. Handy for long lines and paragraphs where the row only shows a snippet.
3. Pick a line with **↑/↓ then Enter**, or click it. A reference to that line is inserted, displaying the line's text.
4. **Esc** cancels and removes the `[[` you typed.

The box opens at the caret and the editor keeps focus, so it works mid-sentence and with several references in one paragraph.

*Under the hood:* a `[[` line reference targets a line item rather than a page, inserted as the same `ref` segment Thymer uses for page references, with the line's text as the initial title.

## Alias a reference

Works on both page references and the line references you create with `[[`.

1. Select the reference you want to alias.
2. Run **Set alias for reference**, either from the Command Palette (`Cmd+P` / `Ctrl+P`) or with its keyboard shortcut, **Cmd+Shift+A** (macOS) / **Ctrl+Shift+A** (Windows/Linux).
3. A small box opens right under the reference, pre-filled with its current text (or your current alias, if you've already set one).
   - **Keep part of the text:** trim the box down to just what you want, no retyping.
   - **Type a fresh alias:** click the **×** to clear the box, then type.
   - **Clear the alias:** clear the box and press **Enter**. A page reference reverts to the page's real name; a line reference re-syncs to the target line's current text.
   - Save with **Enter**, cancel with **Esc**.

The box opens under the reference, follows your theme (light or dark), and uses Thymer's accent for the Save button.

*Under the hood:* an "alias" in Thymer is just the `title` field on a reference segment (`{type:"ref", text:{guid, title?}}`). The plugin finds the reference from the editor's current selection and writes only that field — nothing else on the line is touched, and the link target never changes.

### Changing the keyboard shortcuts

Run **Set Reference Extravaganza shortcuts** from the Command Palette to rebind both the alias shortcut (default **Cmd/Ctrl+Shift+A**) and the convert shortcut (default **Cmd+Ctrl+R**): click a row, press the keys you want, Save. It applies immediately, with no restart and no JSON. (You can also set `custom.shortcut` / `custom.convertShortcut` directly in the **Configuration** tab, e.g. `Mod+Shift+L`; `Mod` = Cmd on macOS, Ctrl elsewhere. At least one of Cmd/Ctrl/Alt is required, so a shortcut can't clash with plain typing.)

## Convert a reference ↔ embedded line

Thymer has two ways to point at another line: a compact reference chip, and an embedded line (a one-line transclusion that mirrors the whole target — checkbox, dates and all). This command swaps between them, keeping the position:

- Cursor on an **embedded line** → converts it to a reference chip.
- A **standalone reference** selected (a line that is just one reference) → converts it to an embedded line.

Run **Convert reference ↔ embedded line** from the Command Palette, or press **Cmd+Ctrl+R**.

## Inline Transclusion

See what a reference points to without leaving the page you're on — and open as many as you like.

1. Select the reference (a page reference or a `[[` line reference).
2. Press **Cmd+Down** (macOS) / **Ctrl+Down** (Windows/Linux) to expand it. The referenced content appears inline, nested right under the reference: a line reference shows that line and its children; a page reference shows the page's content. It's the real thing, so you can edit it in place and your changes save to the source. If a line reference points to a line with no children of its own, a writing strip at the bottom lets you add an indented child under it (with no layout jump).
3. Press **Cmd+Up** / **Ctrl+Up** to collapse the embed for the reference under the caret (or the one the caret is inside). To clear them all, run **Collapse all embeds (this page)** from the Command Palette.

**Many at once, and they persist.** Expanding a second reference no longer collapses the first — every embed stays open. Because each embed is a real line in your document, it survives a reload; it stays until you collapse it.

**In live searches too.** Press **Cmd/Ctrl+Down** on a result line in a live search / query block to expand it in place, right under the result (a page result gets its property card, and any references it holds can be expanded nested inside). A writing strip at the bottom of the embed lets you add indented content under the result. **Cmd/Ctrl+Up** collapses it.

**Property card on record embeds.** When you expand a *page* reference, its properties appear as a card above the body — rendered with Thymer's own property-pane styling (row layout, per-field type icons, value pills with each record's icon and colour, native-format dates), so it looks and themes exactly like the real page header. Click any value to edit it inline:

- **Text** (wraps and grows for long or multi-line values), **number**, and a **date picker** replicating the native one.
- A **choice picker**, and a **record picker** that lists your current values with checkmarks (click the × to remove), suggests records with their icons, and lets you **create a new record** inline. Multi-value fields toggle without closing.
- **Image / file** values show the image (or a paperclip and filename); click the image or the pencil to replace or add one via a file picker, and right-click for Open image, Download, or Delete.
- **URL** values open in the browser when you click the link text.

Changes save straight to the record. A **Properties · All ⌄** chooser on the card switches between **All**, **Filled in**, and a **Custom** selection of properties to show. Its colours and corner radius follow theme switches live. (Line references have no properties, so they just show the line and its children.)

**Keyboard navigation of the card.** With the cursor on the record reference, press **↓** to step into the card (just like arrowing from a record's title into its properties in Thymer). **↑/↓** move a highlight through the values; **Enter** edits the highlighted value (an inline field for text/number/date, or the choice/relation picker), and the highlight returns to it once you save. **↑** from the first value, or **Esc**, returns the cursor to the reference line; **↓** past the last value drops into the embed's body. An empty embed is a stable click-to-type area: click into it (or arrow down past the properties) and start typing the first line. (A Command-Palette path, **Edit embedded record (properties)**, still opens a normal Tab-through dialog if you prefer it.)

*Under the hood:* expanding inserts a native Thymer transclusion as a child of the reference's block, tagged so the plugin only ever finds and collapses its own embeds — never Thymer's native ones. Collapsing is stateless (it locates the matching embed line in the document and deletes it), so it works even after a reload when no in-memory state survives. Native transclusions are body-only, so the property card is drawn by the plugin above the body, kept in sync by a lightweight observer that exists only while at least one embed is open.

## Line descriptions

Give any line a small muted subtitle, rendered just under it.

1. Put the caret on a line and run **Set Description for Line** from the Command Palette.
2. Type the description and press **Enter**. **Esc** cancels.
3. To change or remove it later, **double-click the description** (saving an empty value removes it), or run the command again.

A description is **not a child line**: your outline structure is untouched, the caret can never land in it, and it can't be deleted by accident while editing around it. It's stored as the line's own metadata, so it syncs across devices and undoes like any other change, and it renders wherever the line renders, inline transclusions included. Selecting the line highlights only the line itself, never the description, and things other plugins draw under a line (a task-progress bar, say) stay visible below it.

The Description row is also part of the shared ⋯ line menu in [View Options](https://github.com/parham-shafti/thymer-view-options), a companion plugin providing a common line menu that any plugin can contribute rows to. With View Options installed, a line with a description gets the ⋯ chip and a **Description** row there; without it, everything above still works in full.

*Under the hood:* the description is a meta property on the line, drawn entirely from a generated per-line stylesheet — no node is ever inserted into the line, which is what keeps the caret and editing unaffected. The plugin measures the rendered result (chevron, indent line, selection overlay) and emits tiny per-line corrections, so the geometry follows your theme and type scale.

## Notes & limitations

- **Descriptions are sized for one line of text.** A description long enough to wrap can render with slightly off spacing below it.
- **Property cards show the record's user-defined fields** (system/internal and deleted fields are hidden, exactly like the native pane). Use the card's **Properties** chooser to switch All / Filled in / Custom. The view choice is per device (it isn't synced content).
- **Cards are drawn per client**, not synced content: on a device that didn't open the embed, the card appears after discovery (typically well under a second after a change, or on focus/navigation) rather than instantly.
- **Schema changes made mid-session** (a brand-new property or collection) may take one interaction to be picked up — the plugin refreshes its schema map in the background and self-corrects.
- **Relations in the "Edit embedded record" dialog are read-only** — edit them by clicking/Enter-ing the value on the card, which opens the record picker.
- **Collapse refuses if you've nested your own lines under an embed** (move them out first) — this protects them from being deleted with the embed.
- After updating the plugin, a page reload is still the cleanest way to ensure a single fresh instance.

## Installation

1. In Thymer, open the Command Palette (`Cmd+P` / `Ctrl+P`), run **Plugins**, and click **Create Plugin** under Global Plugins.
2. In the plugin's dialog, go to the code editor (click **Edit as Code** if you see the settings view).
3. In the **Custom Code** tab, replace the contents with [`plugin.js`](plugin.js).
4. In the **Configuration** tab, replace the contents with [`plugin.json`](plugin.json).
5. Click **Save**.

Don't enable Hot Reload — it's a development feature and can leave the plugin in a state where saved data stops persisting.

## Performance

Low idle cost by design: with no embeds open there is no observer running — the only always-on code is a few keydown listeners (the shortcuts, the `[[` trigger, the expand chord), each rejecting non-matching keystrokes on its first line, so normal typing pays a couple of cheap comparisons. No polling, no work on scroll or render.

## License

[MIT](LICENSE)
