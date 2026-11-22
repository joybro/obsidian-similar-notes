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
- Clicking the button makes the sidebar the active leaf, so "insert as link"
  (Alt+Enter) in that modal goes into the most recently used editor in the
  main area, at its cursor, just as when the modal is opened by the command
  from that editor. With no markdown editor there it shows the same notice.
- The same rule decides which note the sidebar follows while it has focus:
  results keep refreshing for the note in the most recently used main-area
  editor instead of being dropped until you click back into the note.
- "Most recently used" means the one tab used last in the main area, asked
  from Obsidian each time (`workspace.getMostRecentLeaf()`); the plugin keeps
  no memory of its own. So after you close that editor, the sidebar and the
  link insert move to whichever main-area tab Obsidian now reports as most
  recent.
- If that tab is not a markdown editor (a canvas, a PDF, an image), there is
  no target, even when an older markdown editor is still open in another
  split. This is deliberate: a link should never land in a note you were not
  just working in. Insert as link shows the notice; click into the note you
  mean and it becomes the target again.
- With no target the sidebar has no note to follow: it drops the previous
  note's results and shows one grey line, "Open a note and similar notes will
  appear here." (`no-note` in `docs/panel-empty-states-spec.md`); the
  expand/collapse button is hidden as in any empty state. It fills again when
  a note becomes the target.

### Expand mode

- One mode for all rows: collapsed (the default, as before) or expanded.
- The mode stays when you switch the active note, when results refresh after
  indexing, and when Obsidian restarts (see Saved state).
- A row's own chevron still works and overrides the mode for that row. The
  override is keyed by the result note's path, so when the same source note's
  results refresh and reorder, the note you opened stays open.
- Switching to another active note drops all row overrides; rows follow the
  mode again.
- Expand all / Collapse all drop all overrides and set the mode.

### Saved state

- The sidebar view adds one optional key to its Obsidian workspace view state:
  `sidebarExpandAll: boolean` (`true` = expanded mode). Obsidian keeps view
  state in the vault's workspace layout, so the mode survives a restart, like
  the collapse state of the host's own panels.
- Missing or non-boolean values mean collapsed, so layouts saved by older
  versions open as before. Older versions ignore the key.
- `getState()` keeps the host's state and adds the key. `setState()` reads only
  a boolean and re-renders with it.
- The layout is saved (`workspace.requestSaveLayout()`) only when you press
  Expand all / Collapse all and the mode changes; reading or restoring state
  never saves.
- Per-row overrides are not saved. Plugin settings, `data.json` and the index
  are unchanged.

## 지도 변경분

- sidebar: new states `ideal-expanded` (mode expanded) and `ideal-collapsed`
  (default); the expand button is absent in `empty`.
- sidebar: new state `empty-no-note` (no markdown editor is the target).
- sidebar → search-modal (modal): Semantic search button.
- search-modal → sidebar (back): Esc returns focus to the button.
