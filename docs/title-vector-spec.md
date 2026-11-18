# Title Vector Specification

## Status

Draft, waiting for the maintainer's decision (similar-notes-dev desk
`decisions.md` 2026-11-19 "의미 검색에 제목 벡터 추가"). Issue
[#26](https://github.com/joybro/obsidian-similar-notes/issues/26). No code yet.

## Problem

A note's title is embedded only as the first line of its first chunk
(`${title}\n\n${content}`), so in a long note the title is a small part of one
vector. Searching by part of a note's title (semantic search modal, `;;` link
suggestion) often misses the note. Measured on two samples (similar-notes-dev
desk `research/2026-11-19-title-weighting.md`), mean reciprocal rank for
title-fragment queries: English 0.64, Korean 0.17.

## Decision

Each indexed note gets one extra vector for its title alone. Text queries score
a note by the higher of its best body-chunk similarity and its title
similarity. The Similar notes panel (note to note) does not use title vectors.

Measured effect of this rule (same research): title-fragment MRR English 0.64
→ 0.97, Korean 0.17 → 0.73; body-sentence queries change by -0.025 (English)
and -0.014 (Korean).

## Storage

The title vector is stored as one more chunk row of the note, so the Orama
schema and the IndexedDB object stores do not change:

| field | value |
|---|---|
| `path`, `title` | the note's |
| `content` | the title text |
| `chunkIndex` | `-1` (reserved: title chunk) |
| `totalChunks` | the note's body chunk count, unchanged |
| `embedding` | `embedText(title)` |

Body chunks keep `chunkIndex >= 0` and keep the title prefix on chunk 0, so
existing body vectors stay valid and need no re-embedding.

What changes for stored data: each note gains one row, and vaults indexed
before this version have no title rows until they are backfilled (below).

## Query paths

- `TextSearchService.findSimilarNotesFromText` (search modal, `;;` link
  suggest): unchanged code path. Title rows are ordinary hits, and
  `groupByNotePath` already keeps the best hit per note, which is
  max(body, title). A title hit's preview is the title; the result shows the
  note's first body chunk as preview instead (title-only previews say nothing).
- `SimilarNoteFinder.findSimilarNotes` (panel, and the agent export command
  through `SimilarNoteCoordinator`): the query side uses only
  `chunkIndex >= 0` rows of the open note, and title rows are dropped from the
  candidates before grouping, so panel results are the same as today.
- `NoteChunkRepository.getByPath` callers that count or display chunks
  (index status) ignore `chunkIndex < 0`.

## Indexing

- New or changed note: after body chunks are embedded, embed the title and
  write the title row in the same `putMulti`. Cost: one extra embedding call
  per indexed note (for cloud providers, one more short request).
- Rename: body rows are carried to the new path as today (no re-embedding),
  but the title row is re-embedded because the title changed with the path.
  A rename with an unchanged basename (folder move) carries the title row too.
- Indexable-text hash skip (indexable-text-hash spec): when the hash says the
  body is unchanged, the title row is left as is; the title cannot change
  without a rename.
- Excluded notes: no title row, same as body rows.

## Backfill

Existing vaults get title rows without a full reindex: on load, notes that
have body rows but no title row are queued in batches through the normal
change queue with reason `title-backfill`, which embeds only the title. The
status bar counts them like other queued notes. Full reindex also produces
them.

## Not changed

- Panel results and their scores.
- Settings, defaults, and the data.json format.

## Tests (to write before code)

- A title-fragment query ranks the note first when its body never mentions the
  title words (TextSearchService with a fake repository holding a title row).
- The panel's results for a note are identical with and without title rows.
- Rename re-embeds only the title row; folder move re-embeds nothing.
- Backfill queues only notes lacking a title row and embeds only titles.
