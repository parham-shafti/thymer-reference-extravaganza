# Reference Aliases

Reference Aliases is a [Thymer](https://thymer.com) plugin that lets you set an **alias** on a page reference — change what the reference chip displays, without retyping or recreating the link.

Out of the box, a page reference always shows the page's real title, and there's no way to give it a different label. This plugin adds a command to set, change, or clear that label whenever you want.

> This release covers **page** references. Aliasing plain-text references is planned for a later version.

## How to use

1. Select the page reference you want to alias.
2. Open the Command Palette (`Cmd+P` / `Ctrl+P`) and run **Set alias for reference**.
3. A small box opens right under the reference, pre-filled with the page's title (or your current alias, if you've already set one).
   - **Keep part of the title:** trim the box down to just what you want — no retyping.
   - **Type a fresh alias:** click the **×** to clear the box, then type.
   - **Remove the alias:** clear the box and press **Enter** — the chip reverts to the page's real name.
   - Save with **Enter**, cancel with **Esc**.

The box opens under the reference, follows your theme — light or dark — and uses Thymer's accent for the Save button.

## Keyboard shortcut

The command is also bound to a keyboard shortcut — by default **Cmd+Shift+A** (macOS) / **Ctrl+Shift+A** (Windows/Linux).

To change it, run **Set alias keyboard shortcut** from the Command Palette, press the keys you want, and click Save — it applies immediately, no restart and no JSON. (You can also set `custom.shortcut` directly in the **Configuration** tab, e.g. `Mod+Shift+L`; `Mod` = Cmd on macOS, Ctrl elsewhere. At least one of Cmd/Ctrl/Alt is required, so the shortcut can't clash with plain typing.)

## Installation

1. In Thymer, open the Command Palette (`Cmd+P` / `Ctrl+P`), run **Plugins**, and click **Create Plugin** under Global Plugins.
2. In the plugin's dialog, go to the code editor (click **Edit as Code** if you see the settings view).
3. In the **Custom Code** tab, replace the contents with [`plugin.js`](plugin.js).
4. In the **Configuration** tab, replace the contents with [`plugin.json`](plugin.json).
5. Click **Save**.

Don't enable Hot Reload — it's a development feature and can leave the plugin in a state where saved data stops persisting.

## How it works

- An "alias" in Thymer is just the `title` field on a reference segment (`{type:"ref", text:{guid, title?}}`). The plugin reads and writes that field — set it to your alias, or clear it to fall back to the page's name. Nothing else on the line is touched, and the link target never changes.
- It finds the reference you're on from the editor's current selection when you run the command.
- **Negligible idle cost:** the only always-on code is a single keydown listener for the shortcut, and its first line is a modifier check that returns immediately for every non-matching keystroke — so normal typing pays a single comparison. No observers, no polling, no work on scroll or render.

## License

[MIT](LICENSE)
