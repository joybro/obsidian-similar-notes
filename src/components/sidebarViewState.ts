/**
 * The sidebar view's own key in Obsidian's workspace view state
 * (docs/sidebar-toolbar-spec.md, "Saved state").
 */
export const SIDEBAR_EXPAND_ALL_KEY = "sidebarExpandAll";

/** The expand-all mode stored in a view state, or `undefined` if absent or not a boolean. */
export function readExpandAll(state: unknown): boolean | undefined {
    if (state === null || typeof state !== "object") return undefined;
    const value = (state as Record<string, unknown>)[SIDEBAR_EXPAND_ALL_KEY];
    return typeof value === "boolean" ? value : undefined;
}

/** The host's view state plus the expand-all mode. */
export function withExpandAll(
    hostState: Record<string, unknown>,
    expandAll: boolean
): Record<string, unknown> {
    return { ...hostState, [SIDEBAR_EXPAND_ALL_KEY]: expandAll };
}
