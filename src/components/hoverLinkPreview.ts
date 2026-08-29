import type { HoverParent, Workspace } from "obsidian";

/**
 * Source id under which this plugin emits `hover-link` events. main.ts
 * registers it with the Page Preview core plugin (registerHoverLinkSource),
 * which also adds a per-source "require Mod key" toggle to Page Preview's
 * settings (we default to requiring it, matching editor links).
 */
export const HOVER_LINK_SOURCE_ID = "similar-notes";

/**
 * Ask the Page Preview core plugin to show a note preview popover for a
 * hovered element. Page Preview owns the modifier-key semantics — including
 * the "hover first, press Mod afterwards" flow — so this should be called on
 * every mouseover, unconditionally.
 */
export function triggerHoverLink(
    workspace: Workspace,
    event: MouseEvent,
    hoverParent: HoverParent,
    targetEl: HTMLElement,
    linktext: string,
    sourcePath = ""
): void {
    workspace.trigger("hover-link", {
        event,
        source: HOVER_LINK_SOURCE_ID,
        hoverParent,
        targetEl,
        linktext,
        sourcePath,
    });
}
