# Sidebar toolbar

Status: implemented.

## Problem

The Similar notes sidebar lists results with their previews folded. Reading
several previews meant opening each row's chevron, again after every note
switch. Semantic search was only reachable through the command palette or its
hotkey, although the sidebar is where people look for related notes.

## Behavior

A toolbar row under the sidebar's header, in Obsidian's own markup
(`nav-header` > `nav-buttons-container` > `clickable-icon nav-action-button`,
as in the file explorer). Two buttons, nothing else. The in-document panel
under a note gets no toolbar.

| Button | Icon | Label / tooltip | Action |
|---|---|---|---|
| Expand / collapse all | `chevrons-up-down` when every row is collapsed, `chevrons-down-up` when at least one row is open | "Expand all" / "Collapse all" | sets the mode for all rows |
| Semantic search | `text-search` | "Semantic search…" | opens the existing semantic search modal (same as the command) |

- The expand/collapse button is hidden when there are no results (and while
  the list itself is folded by its "Similar notes" heading). It has no
  `is-active` highlight; the icon and label say what the next click does.
- Both buttons work with a mouse click, Enter and Space. On mobile
  (`body.is-mobile`) each has at least a 44px tap target.
- Closing the search modal without opening a note (Esc, click outside) returns
  focus to the search button. Opening or creating a note leaves focus there.

### Expand mode

- One mode for all rows: collapsed (the default, as before) or expanded.
- The mode lasts for the rest of the session in that sidebar: switching the
  active note and results refreshing after indexing keep it.
- A row's own chevron still works and overrides the mode for that row. The
  override is keyed by the result note's path, so when the same source note's
  results refresh and reorder, the note you opened stays open.
- Switching to another active note drops all row overrides; rows follow the
  mode again.
- Expand all / Collapse all drop all overrides and set the mode.

### Not in this change

The mode is not saved across restarts: no workspace state, settings or
`data.json` keys are written.

## 지도 변경분

- sidebar: new states `ideal-expanded` (mode expanded) and `ideal-collapsed`
  (default); the expand button is absent in `empty`.
- sidebar → search-modal (modal): Semantic search button.
- search-modal → sidebar (back): Esc returns focus to the button.
