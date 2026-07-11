# Obsidian Plugin Development Patterns

This document captures useful patterns and APIs discovered during development.

## Status Bar

### Adding a Tooltip with Position

Use `setTooltip` function with `placement` option:

```typescript
import { setTooltip } from "obsidian";

setTooltip(statusBarItem, "Tooltip text", { placement: "top" });
```

**TooltipOptions:**

-   `placement`: `'top' | 'bottom' | 'left' | 'right'`
-   `delay`: number (ms)
-   `classes`: string[]
-   `gap`: number

Note: `aria-label` attribute does not control tooltip position. Use `setTooltip` function instead.

### Status Bar Icon Sizing

To prevent status bar height from increasing when adding icons:

```css
.my-status-bar .status-bar-item-icon {
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
    line-height: 1;
}

.my-status-bar .status-bar-item-icon svg {
    width: 14px;
    height: 14px;
}
```

## EditorSuggest

### The built-in `[[` link suggester always wins on `[[`

Obsidian shows only **one** `EditorSuggest` popup at a time; the **first**
suggester in `app.workspace.editorSuggest.suggests` whose `onTrigger` returns
non-null wins. The built-in `[[` link suggester is hard-wired as **index 0**
of that array, so any `[[`-prefixed input (e.g. a custom trigger like `[[?`)
matches the built-in first and a plugin suggester registered later **never
runs**.

The only way to win on `[[` is to remove the built-in from the array
(`suggests.slice(1)`), which globally kills normal `[[` autocomplete —
unacceptable for a plugin that isn't meant to replace it.

**Consequence:** if you want a custom in-editor suggester (e.g. semantic
search triggered while typing), pick a standalone trigger the built-in
suggester does not respond to (e.g. `;;`, as used by this plugin's semantic
link suggester, `src/components/SemanticLinkSuggest.ts`) instead of trying to
intercept `[[`. This leaves the built-in `[[` flow completely untouched and
uses only public, documented `EditorSuggest` APIs.

Sources: [Disable Default Link Suggester Modal (forum)](https://forum.obsidian.md/t/disable-default-link-suggester-modal/113219),
[EditorSuggest API](https://docs.obsidian.md/Reference/TypeScript+API/EditorSuggest),
[obsidian-tasks #2780](https://github.com/obsidian-tasks-group/obsidian-tasks/issues/2780).

## Undocumented APIs

### Opening Plugin Settings Programmatically

```typescript
// @ts-expect-error - Obsidian's setting API
this.app.setting.open();
// @ts-expect-error - Obsidian's setting API
this.app.setting.openTabById("plugin-id");
```

### Executing Commands Programmatically

```typescript
// @ts-expect-error - Obsidian's commands API
this.app.commands.executeCommandById("plugin-id:command-name");
```
