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
