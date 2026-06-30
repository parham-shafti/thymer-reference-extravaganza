# Reference Extravaganza

Reference Extravaganza is a [Thymer](https://thymer.com) plugin for references. It does three things:

- **Reference a line of text inline:** type `[[`, search, and link any line in your workspace.
- **Alias a reference:** change what any reference chip displays (a page reference or an inline `[[` text reference), without retyping or recreating the link.
- **Expand a reference in place:** select a reference and press a key to reveal the referenced content inline, right under it, then collapse it again.

## Reference a line of text with `[[`

Thymer references a whole page out of the box; this adds references to an individual line.

1. Type `[[` anywhere in a line. A search box opens right at your cursor.
2. Keep typing to search. Results show a snippet centred on the match (matched words highlighted) with the source page beneath.
   - **Phrase search:** results match the phrase you type.
   - **Multi-term search:** use `+` to require several terms in the same line, in any order (for example `bestäm + leda`).
3. Pick a line with **↑/↓ then Enter**, or click it. A reference to that line is inserted, displaying the line's text.
4. **Esc** cancels and removes the `[[` you typed.

The box opens at the caret and the editor keeps focus, so it works mid-sentence and with several references in one paragraph.

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

### Changing the keyboard shortcut

The default is **Cmd+Shift+A** (macOS) / **Ctrl+Shift+A** (Windows/Linux). To rebind it, run **Set alias keyboard shortcut** from the Command Palette, press the keys you want, and click Save. It applies immediately, with no restart and no JSON. (You can also set `custom.shortcut` directly in the **Configuration** tab, e.g. `Mod+Shift+L`; `Mod` = Cmd on macOS, Ctrl elsewhere. At least one of Cmd/Ctrl/Alt is required, so the shortcut can't clash with plain typing.)

## Expand a reference in place

See what a reference points to without leaving the page you're on.

1. Select the reference (a page reference or a `[[` line reference).
2. Press **Cmd+Down** (macOS) / **Ctrl+Down** (Windows/Linux) to expand it. The referenced content appears inline, nested right under the reference: a line reference shows that line and its children; a page reference shows the page's content. It's the real thing, so you can edit it in place and your changes save to the source.
3. Press **Cmd+Up** / **Ctrl+Up** to collapse it again.

Under the hood this is a native Thymer transclusion, added while expanded and removed when you collapse. (A page's properties aren't part of a transclusion, so an expanded page shows its body content rather than its fields.)

## Installation

1. In Thymer, open the Command Palette (`Cmd+P` / `Ctrl+P`), run **Plugins**, and click **Create Plugin** under Global Plugins.
2. In the plugin's dialog, go to the code editor (click **Edit as Code** if you see the settings view).
3. In the **Custom Code** tab, replace the contents with [`plugin.js`](plugin.js).
4. In the **Configuration** tab, replace the contents with [`plugin.json`](plugin.json).
5. Click **Save**.

Don't enable Hot Reload — it's a development feature and can leave the plugin in a state where saved data stops persisting.

## How it works

- An "alias" in Thymer is just the `title` field on a reference segment (`{type:"ref", text:{guid, title?}}`). The plugin reads and writes that field — set it to your alias, or clear it to fall back to the target's name (the page's title for a page reference, the line's current text for a line reference). Nothing else on the line is touched, and the link target never changes.
- A `[[` line reference targets a line item rather than a page; the plugin inserts it as the same `ref` segment, with the line's text as the initial title.
- It finds the reference you're on from the editor's current selection when you run the command.
- **Expanding a reference** inserts a native transclusion of the target as a child of the reference's block; collapsing removes it. The expanded content is the real editor, so edits save to the source.
- **Negligible idle cost:** the only always-on code is a few keydown listeners (the shortcut, the `[[` trigger, the expand chord), each of which rejects non-matching keystrokes on its first line, so normal typing pays a couple of cheap comparisons. No observers, no polling, no work on scroll or render.

## License

[MIT](LICENSE)
