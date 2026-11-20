# Settings Search Specification

## Status

Implemented, not released yet. Planned to ship after the 1.8.0 release so the
settings tab does not change while 1.8.0 is checked. No user-visible copy
changes.

## Problem

Obsidian 1.13 added a settings search that indexes setting tabs declared through
`PluginSettingTab.getSettingDefinitions()`. Our tab renders imperatively in
`display()`, so none of its rows (provider, API key, path patterns, minimum
similarity, ...) show up when a user types into Obsidian's settings search. The
community.obsidian.md scan reports this as
`obsidianmd/settings-tab/prefer-setting-definitions`; it is one of the two lint
warnings left on the 1.8.0 branch.

## API facts (obsidian.d.ts 1.14.4)

- `getSettingDefinitions(): SettingDefinitionItem[]` is "called on every
  display() and once when the tab is added to the setting modal for search
  indexing" (`SettingTab`, @since 1.13.0).
- `display()` is "not called when getSettingDefinitions returns a non-empty
  array"; it stays as "a fallback for plugins that need to support Obsidian
  versions older than 1.13.0" (deprecated since 1.13.0).
- A definition can be `control` (framework-owned input, stored through
  `getControlValue`/`setControlValue`), `action`, `render`, or empty.
  `render: (setting: Setting, group: SettingGroup) => void | (() => void)`
  renders a row imperatively; `name`, `desc` and `aliases` are what search
  indexes.
- Groups: `{ type: "group", heading, cls, items, visible }`.
- `visible: false` hides an item and also drops it from search for that render
  cycle. `update()` re-reads the definitions (structure changed);
  `refreshDomState()` re-evaluates `visible`/`disabled` without re-rendering.

## Decision

1. **Definitions become the single source of the tab's structure.** Every
   section already builds its rows as `SettingBuilder = (setting: Setting) =>
   void` and adds them to a `SettingGroup` with a heading. Each section instead
   returns `SettingDefinitionGroup`s whose items are
   `{ name, desc?, aliases?, render: builder }`. The builders do not change.
2. **Two renderers over the same definitions.** On 1.13+, Obsidian renders
   `getSettingDefinitions()`. On 1.11 and 1.12 (minAppVersion is 1.11.0 from
   1.8.0), `display()` walks the same definitions and does what it does today:
   `new SettingGroup(containerEl).setHeading(heading)` and `addSetting(render)`
   for each visible item. One structure, so the two paths cannot drift.
3. **Use `render` definitions, not `control`.** Our values live in
   `SettingsService` (an observable store with side effects on change: model
   reload, exclusion preview, re-index prompts), not in a plain key/value
   object. `control` definitions would route writes through
   `setControlValue` and skip that store. Migrating individual rows to
   `control` is a later, separate change if it ever pays.
4. **Re-render hooks.** Sections that call their own `render()` after a change
   (provider switch, apply model, usage reset) call `tab.update()` instead when
   running declaratively, and `display()` when not. The tab passes one
   `rerender()` callback down; sections do not check versions themselves.
   Live counters (index statistics, errored list) keep updating the elements
   they captured during render, as today.
5. **Provider-specific rows stay hidden when not selected** (`visible`), so a
   search for "API key" while the built-in provider is selected finds nothing
   in those rows. To keep such searches useful, the "Model provider" row gets
   aliases for every provider and its main fields: `OpenAI`, `OpenRouter`,
   `Gemini`, `Ollama`, `API key`, `Server URL`. The search then lands on the
   provider picker, which is the step the user needs first.
6. **Name ownership.** The definition's `name`/`desc` is the source for
   search. Builders keep their own `setName`/`setDesc` (same strings) so the
   fallback path renders unchanged; a unit test asserts each definition's
   `name` equals the name its builder sets, so they cannot drift.
7. **Users' words as aliases, distinct render keys.** Obsidian searches row
   names and aliases, not group headings (Obsidian 1.15.1: "exclude" and
   "Exclude files from index" found no Similar Notes row). The exclusion rows
   carry the words users wrote in their requests (#14 "Folder exclusion
   setting", #42 "yaml metadata based exclusions"): Path patterns ←
   `Exclude folders`, `Exclude files`; Frontmatter properties ←
   `Exclude by property`, `YAML`; Content patterns ← `Exclude content`. No
   aliases without a user's words behind them (no "threshold", "ignore").
   Provider rows that share a name ("Model", "API key", "Server URL",
   "Test connection") get `id: "<provider>:<name>"`: Obsidian 1.15.1 keys a
   render row by `id`, else `name`, and logs `duplicate setting key` for
   repeats in one list on every render. `id` is not in the public types
   (obsidian 1.14.4); an app that ignores it keys by name, as before.

## Map delta (docs/ux-map.md)

- screen `settings`: add an entry `→ settings (push): Obsidian settings search
  result` (Obsidian 1.13+). No new states, no copy change.

## Dependencies

- `obsidian` types: the lockfile pins 1.11.4, which lacks these types. Bump the
  devDependency to ≥ 1.13.1 (1.14.4 at writing). Type-only; the runtime API
  comes from the user's app.
- Lint: `obsidianmd/no-unsupported-api` may flag the 1.13 API under
  minAppVersion 1.11.0. Overriding `getSettingDefinitions` is safe on 1.11 and
  1.12 (the base class never calls it); if the rule still flags it, wrap the
  override body in `requireApiVersion("1.13.0")` returning `[]` below, which
  also sends 1.13+ to the declarative path and older apps to `display()`.

## Verification

- Unit: definitions cover every row the current `display()` renders (count and
  names per group, per provider); names match builders; `display()` over the
  definitions produces the same `.setting-item-name` texts as before
  (snapshot taken before the change).
- A disposable test vault (Obsidian 1.15.1): settings search for "Path patterns",
  "Minimum similarity" and "OpenAI" shows Similar Notes rows, and opening a
  result lands on the row. Provider switch still re-renders the model group;
  index statistics still update live.
- Lint: `prefer-setting-definitions` gone; `npm run lint` 0 errors.

## Implementation notes

- `src/components/settingDefinitions.ts`: `SettingRow` (= `SettingDefinitionRender`),
  `unnamedRow()` and `renderSettingGroups()` (the `display()` fallback).
  `getSettingDefinitions()` returns `[]` unless `requireApiVersion("1.13.0")`,
  so 1.11/1.12 always take `display()`.
- Definitions carry `name` (and `aliases` on Model provider) but no `desc`:
  several descriptions are dynamic (current model, Apply, token usage) and
  copying every static description into a second literal would double the
  copy to keep in sync. Search therefore matches names and aliases only.
  Adding static `desc` is a follow-up if search by description is wanted.
- Rows without a name (errored-files and excluded-files previews, the regex
  tester) are `name: ""`, `searchable: false`.
- Download progress and model errors update the "Current model" description
  in place (like index statistics) instead of re-rendering; the price field's
  blur refreshes the cost text in place instead of re-rendering (a full tab
  re-render there would take focus from the field the user moved to).
- `obsidianmd/no-unsupported-api` does not flag `getSettingDefinitions`,
  `update` or `SettingDefinition*` types; the remaining warnings are the 1.11
  `SettingGroup` calls, now only in `settingDefinitions.ts`.
- `obsidianmd/settings-tab/prefer-setting-definitions` did not fire in this
  repo's `npm run lint` before or after the change (eslint-plugin-obsidianmd
  0.6.0); the community scan is where it was reported.

## Open questions (answer while implementing, then fold into this spec)

Answered by testing a branch build with the aliases in Obsidian 1.15.1
(2026-11-19):

- Opening a result: clicking the "Path patterns" result opens the Similar
  Notes tab scrolled so the row is in view (scrollTop 1148 of 3471, row at
  y 234~497 of a 670px pane); no lasting highlight on the row.
- Scroll across a full re-render: `update()` with the pane scrolled to the
  bottom drops scrollTop 2801 → 2754 for a moment and Obsidian restores 2801
  within a second; the GPU toggle keeps 252 → 252. No scroll handling needed.
- Provider switch with ids: rows shown per provider unchanged (builtin,
  Ollama, OpenAI, Gemini), no `duplicate setting key` errors.
- Search follows the provider switch: after picking OpenAI (not yet
  applied), "API key" and "Server URL" return those rows next to Model
  provider; back on built-in, only Model provider. So `visible` is
  re-evaluated for search after `update()`.

Observed in Obsidian 1.15.1 (2026-11-19, branch build, through `app.setting.searchComponent` and `searchResultsEl`): the tab
is in `app.setting.searchIndex.tabs` with its 6 groups; "Path patterns",
"Minimum similarity" and "Report a bug" each return the Similar Notes row of
that name; "OpenAI" and "API key" (built-in provider selected) return
"Model provider" only, so hidden provider rows are not searched and the aliases
carry those queries.(Where a click lands: answered above.)


- Does the framework set the row's name from the definition before calling
  `render`, or does the builder's `setName` win? Either is fine under rule 6;
  record which. (Not answerable from obsidian.d.ts 1.14.4: `render` receives
  a `Setting` and the docs say `name` is "used for rendering and search".
  Since the builder calls `setName` after, the builder's value is what shows
  if the framework sets it first; the unit test keeps them equal.)
