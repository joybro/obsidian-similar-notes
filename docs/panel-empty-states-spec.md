# Panel empty states

Status: implemented.

## Problem

The Similar notes panel (note footer and sidebar, both `SearchResultsContainer`)
showed "No similar notes found." whenever its list was empty. Five different
causes lead there, and for three of them (excluded note under a cloud provider,
failed embedding, vault still indexing) the line is not true. The indexing case
is the first-run impression: a new user sees "no similar notes" while the plugin
is still working.

## Behavior

Same place, same `search-empty-state` line; only the text changes. No new
controls. The line is grey except `embedding-failed`, which adds `is-error`
(`var(--text-error)`): a confirmed failure that won't clear by itself reads red,
while fixed guidance and self-resolving states stay grey.

| Reason | When | Text |
|---|---|---|
| no-note | there is no note to show results for: no markdown editor is open, or the tab used last in the main area is not a note (canvas, PDF, image). No search runs. In practice only the sidebar shows this, since the footer panel lives under a note | Open a note and similar notes will appear here. |
| unwritten | the note has no text after exclusion patterns (`SimilarNoteFinder` status `empty-content`) | Write a few lines and similar notes will appear here. |
| excluded-cloud | excluded note with OpenAI or Gemini, ad-hoc embedding skipped (`ad-hoc-disallowed`, frontmatter-exclusion spec §2.1) | This note is excluded from the index, so it isn't sent to OpenAI. (provider name from the setting: OpenAI or Gemini) |
| embedding-failed | the on-the-fly embedding threw (`embedding-failed`; a Notice is also shown) | Couldn't analyze this note. Check the model in Settings, then reopen the note. |
| below-threshold | the search returned results but none reach Minimum similarity | No notes above the minimum similarity (0.50). (setting value, two decimals) |
| indexing | the search ran, returned nothing, and notes other than the open one are queued for indexing | Indexing your vault: 1,240 notes left. Results fill in as notes are indexed. (count = the status bar's "N to index" source, `NoteIndexingService.getNoteChangeCount$`; "1 note left" for one) |
| none | anything else | No similar notes found. |

Order: `no-note` is decided before any note is looked at. Of the rest, the
next three are searches that never ran and win; `excluded-cloud`
beats `unwritten`, so an empty excluded note under a cloud provider already
says it is excluded (writing in it would not bring results); `below-threshold`
only when results exist; `indexing` only when there are zero results (if
indexed notes already produce results during indexing, they are shown and no
indexing line appears).

While the indexing line shows, the count updates live, and the coordinator
searches again for the open note as the count drops, at most once every 10
seconds (`INDEXING_RESEARCH_INTERVAL_MS`; the clock restarts on any search of
the panel), so results fill in before the queue empties. The open
note is usually not indexed yet, so each of these searches embeds it on the
fly; 10 seconds keeps that to about six calls a minute on a long first index.
Once results show, the panel leaves the indexing state and these searches
stop. When the queue reaches zero it searches once more.

The pending count is published as soon as the startup queue is filled, before
the indexing loop starts (which waits for the model, possibly a first
download). If the panel already shows "No similar notes found." when notes
become queued (count 0 to positive), it switches to the indexing line and drops
that cached empty result, so the searches above run.

Only notes other than the open one count toward this line. The open
note's own queued edit (typing in a note with no results, then pausing) never
fills its own panel, since a note is not in its own results, so the panel keeps
"No similar notes found." instead of promising results and flickering at every
pause. The count shown is still the status bar's total. When only the open
note is left queued while the indexing line shows, the coordinator searches
once more and falls back to the plain line.

## Caching

`SimilarNoteCoordinator` does not cache a failed embedding (reopening retries,
as the text says), a skipped excluded-note search, or an empty search while
notes are queued.

## Not covered

- The semantic-search modal keeps its own "No similar notes found".
- The OpenAI provider pointed at an OpenAI-compatible server still says
  "OpenAI" (the URL is not inspected, same as frontmatter-exclusion spec §2.1).
- What the panel shows while the built-in model is still downloading was not
  observed in a running Obsidian; by code, an embedding call
  before the model is ready fails or waits, which maps to `embedding-failed`
  or a late result.
