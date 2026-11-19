# Panel empty states

Status: implemented 2026-11-19. Source: limehouse-cdo review
`reviews/2026-11-19-0605-similar-notes-panel-empty-states.md` EY1~EY4 (CDO
T1952; similar-notes-dev T14).

## Problem

The Similar notes panel (note footer and sidebar, both `SearchResultsContainer`)
showed "No similar notes found." whenever its list was empty. Five different
causes lead there, and for three of them (excluded note under a cloud provider,
failed embedding, vault still indexing) the line is not true. The indexing case
is the first-run impression: a new user sees "no similar notes" while the plugin
is still working.

## Behavior

Same place, same grey `search-empty-state` line; only the text changes. No new
controls.

| Reason | When | Text |
|---|---|---|
| unwritten | the note has no text after exclusion patterns (`SimilarNoteFinder` status `empty-content`) | Write a few lines and similar notes will appear here. |
| excluded-cloud | excluded note with OpenAI or Gemini, ad-hoc embedding skipped (`ad-hoc-disallowed`, frontmatter-exclusion spec §2.1) | This note is excluded from the index, so it isn't sent to OpenAI. (provider name from the setting: OpenAI or Gemini) |
| embedding-failed | the on-the-fly embedding threw (`embedding-failed`; a Notice is also shown) | Couldn't analyze this note. Check the model in Settings, then reopen the note. |
| below-threshold | the search returned results but none reach Minimum similarity | No notes above the minimum similarity (0.50). (setting value, two decimals) |
| indexing | the search ran, returned nothing, and notes are queued for indexing | Indexing your vault: 1,240 notes left. Results fill in as notes are indexed. (count = the status bar's "N to index" source, `NoteIndexingService.getNoteChangeCount$`; "1 note left" for one) |
| none | anything else | No similar notes found. |

Order: the first three are searches that never ran and win; `below-threshold`
only when results exist; `indexing` only when there are zero results (EY3: if
indexed notes already produce results during indexing, they are shown and no
indexing line appears).

While the indexing line shows, the count updates live, and the coordinator
searches again for the open note as the count drops, at most once every 10
seconds (`INDEXING_RESEARCH_INTERVAL_MS`; the clock restarts on any search of
the panel), so results fill in before the queue empties (QA sim7). The open
note is usually not indexed yet, so each of these searches embeds it on the
fly; 10 seconds keeps that to about six calls a minute on a long first index.
Once results show, the panel leaves the indexing state and these searches
stop. When the queue reaches zero it searches once more.

The pending count is published as soon as the startup queue is filled, before
the indexing loop starts (which waits for the model, possibly a first
download). If the panel already shows "No similar notes found." when notes
become queued (count 0 to positive), it switches to the indexing line and drops
that cached empty result, so the searches above run (QA sim8).

## Caching

`SimilarNoteCoordinator` does not cache a failed embedding (reopening retries,
as the text says), a skipped excluded-note search, or an empty search while
notes are queued.

## Not covered

- The semantic-search modal keeps its own "No similar notes found".
- The OpenAI provider pointed at an OpenAI-compatible server still says
  "OpenAI" (the URL is not inspected, same as frontmatter-exclusion spec §2.1).
- What the panel shows while the built-in model is still downloading was not
  observed in a running Obsidian (EY3 question); by code, an embedding call
  before the model is ready fails or waits, which maps to `embedding-failed`
  or a late result.
