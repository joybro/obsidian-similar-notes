# Frontmatter-based file exclusion (#42)

Exclude whole notes from the similarity index based on their frontmatter, so a
note can opt out of indexing from inside the note itself (tag, category link,
or boolean property) instead of requiring a path pattern in settings.

## §1 Rule syntax

Setting `excludeFrontmatterRules: string[]` — one rule per line in the
settings UI. Two forms:

- `key` — exclude when the property exists and its value is not `false` and
  not `null`. Covers marker properties (`noindex: true`, `noindex:` with any
  truthy value).
- `key: value` — exclude when the property equals the value, or (for list
  properties) the list contains it. Covers `tags: noindex`,
  `categories: [[Private]]`, `embed: false`.

Matching details:

- Values are compared as strings: rule value `false` matches boolean `false`,
  `123` matches number `123`. Comparison is against Obsidian's **parsed**
  frontmatter (`metadataCache.getFileCache(file).frontmatter`), never the raw
  YAML text — so YAML formatting variants (inline list vs block list, quoted
  vs unquoted) all match the same way.
- `[[Private]]` is a plain string in parsed frontmatter (Obsidian does not
  resolve links in frontmatter values), matched literally. Renaming the
  `Private` note does not update the rule.
- For keys `tag` / `tags`, both sides are normalized: leading `#` stripped,
  case-insensitive — mirroring Obsidian's tag semantics.
- Rule values may be wrapped in single or double quotes (stripped), because
  vault frontmatter often quotes link values (`- "[[Private]]"`) and users
  will copy that form into the rule.
- The value part splits on the **first** `:` only, so values containing `:`
  work.

## §2 Where the decision is enforced

The authoritative check runs at **processing time** in
`NoteIndexingService.processChange`, not at event/queue time.

Rationale: `metadataCache` is populated asynchronously after vault events. On
`create` (and sometimes early `modify`) the cache for the file may not exist
yet, so an event-time check would silently mis-classify an excluded note as
includable. At processing time (after the indexing-delay debounce and queue
latency) the cache is warm.

Behavior at processing time, for any non-`deleted` change whose file is
frontmatter-excluded: remove the note's chunks from the index and delete its
mtime/hash metadata (for `renamed`, both old and new path), then stop —
exactly the end-state a path-excluded file has. This single check also
converts "user adds the marker to an indexed note" into removal, with no
special queue handling.

`NoteChangeQueue.analyzeSyncNeeds` (startup sync, Apply button, preview) also
applies the check when computing `shouldBeIndexed`: without it, an excluded
note (absent from the mtime store by design) would be re-queued as `toAdd`
on every startup, processed into a removal, and re-queued again next session.
If the cache is still cold during startup sync, the note passes the queue
check and is caught at processing time — self-healing, at the cost of one
wasted queue entry.

Event handlers (`create` / `modify` / `rename`) do **not** check frontmatter
rules; they only keep the existing path-pattern filter. An excluded note's
modify event flows through the queue and resolves to a removal no-op at
processing time.

## §2.1 Exclusion is one-directional (intentional)

Exclusion removes a note as a recommendation *target*: it never appears in
other notes' similar-notes results, because it has no indexed chunks. Opening
an excluded note still shows its own similar-notes panel — the finder
generates an ad-hoc query embedding when no indexed chunks exist. This is
deliberate for local providers and matches how path-excluded notes behave.
Cloud providers skip the ad-hoc embedding as described below.

The exclusion behavior also has these consequences:

- The ad-hoc query embedding applies `excludeRegexPatterns` to the note text
  first (`SimilarNoteCoordinator.getSimilarNotes`), so regex-excluded content
  is never embedded on either side. Before 2026-11-19 the query side embedded
  the raw text.
- With a cloud provider (`openai`, `gemini`) the ad-hoc embedding is skipped
  for excluded notes: `SimilarNoteCoordinator` passes
  `allowAdHocEmbedding: false` to `SimilarNoteFinder`, which returns no results
  instead of embedding. The excluded note's own panel is empty once the
  exclusion is applied (Apply rules, Reindex, or the startup sync); until then
  the note keeps its stored chunks and still shows results, since the skip
  only applies to a note without indexed chunks. Its text never leaves the
  device. Local providers (`builtin`, `ollama`) keep the panel as
  before. An `openai` provider pointed at a local OpenAI-compatible server is
  still treated as cloud (the URL is not inspected). The "Path patterns"
  setting description states this, including "after you apply the rules".
- The results cache (`SimilarNoteCoordinator`, keyed on the source note's
  mtime) does not decide exclusion. Every read and every refresh drops targets
  that are excluded *now* (path patterns or frontmatter rules), and an
  excluded source under a cloud provider bypasses the cache, so an exclusion
  applied after results were cached takes effect on the next open without
  editing the source.

## §3 Status accounting

`computeIndexStatus` and `visibleErroredEntries` take an
`isExcluded(path)` predicate (path patterns OR frontmatter rules) instead of
raw glob patterns, so the Excluded bucket and the excluded-files preview
include frontmatter-excluded notes. The preview badges each entry with its
source (`path` / `frontmatter`); a file matching both shows `path` (checked
first, cheaper).

## §4 UI

In the settings tab's exclusion group (renamed "Exclude files from index"):

- **Path patterns** — the existing glob textarea, renamed from "Folder
  patterns" (globs match file paths, not just folders). Internal settings key
  `excludeFolderPatterns` is unchanged (no migration).
- **Frontmatter properties** — new textarea, one rule per line, syntax above.
- Excluded-files preview shows both sources with a badge per row.
- "Apply folder patterns" button renamed "Apply exclusion rules"; it syncs
  the index against both path patterns and frontmatter rules (both flow
  through `analyzeSyncNeeds`).
