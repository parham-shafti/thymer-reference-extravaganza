# Reference Aliases

Reference Aliases is a [Thymer](https://thymer.com) plugin that lets you set an **alias** on a page reference — change what the reference chip displays, without retyping or recreating the link.

Out of the box, a page reference always shows the page's real title, and there's no way to give it a different label. This plugin adds a command to set, change, or clear that label whenever you want.

> This release covers **page** references. Aliasing plain-text references is planned for a later version.

## How to use

1. Put your cursor on a page reference (anywhere on its line).
2. Open the Command Palette (`Cmd+P` / `Ctrl+P`) and run **Set alias for reference**.
3. A small box appears at the reference. Type an alias and press **Enter**.
   - **Change** it later: run the command again — the box is pre-filled with the current alias.
   - **Clear** it: empty the box and press **Enter** — the chip reverts to the page's real name.
   - **Esc** cancels without changing anything.

The popup follows your theme — light or dark — and the input's focus colour matches Thymer's accent.

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
- **Zero idle cost:** the plugin only does work when you invoke its command — no background observers, polling, or global listeners — so it never affects Thymer's typing or scrolling performance.

## License

[MIT](LICENSE)
