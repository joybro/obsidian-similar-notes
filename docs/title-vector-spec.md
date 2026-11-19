# Title Vector Specification

## Status

Accepted by the maintainer 2026-11-19 (similar-notes-dev desk `decisions.md`
"의미 검색에 제목 벡터 추가"), implemented in this change. Issue
[#26](https://github.com/joybro/obsidian-similar-notes/issues/26).

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
| `path`, `title` | the note's (title = file basename, derived from the path) |
| `content` | the title text |
| `chunkIndex` | `-1` (reserved: title chunk) |
| `totalChunks` | the note's body chunk count, unchanged |
| `embedding` | `embedText(title)` |

Body chunks keep `chunkIndex >= 0` and keep the title prefix on chunk 0, so
existing body vectors stay valid and need no re-embedding.

What changes for stored data: each note gains one row, and vaults indexed
before this version have no title rows until they are backfilled (below).

Helpers: `TITLE_CHUNK_INDEX`, `isTitleChunk`, `titleFromPath` and
`NoteChunk.titleChunk` in `src/domain/model/NoteChunk.ts`.

## Query paths

- `TextSearchService.findSimilarNotesFromText` (search modal, `;;` link
  suggest): unchanged code path. Title rows are ordinary hits, and
  `groupByNotePath` already keeps the best hit per note, which is
  max(body, title). A title hit's preview is the title; the result shows the
  note's first body chunk as preview instead (title-only previews say nothing),
  read with `getByPath` for that hit only.
- `SimilarNoteFinder.findSimilarNotes` (panel, and the agent export command
  through `SimilarNoteCoordinator`): the query side uses only
  `chunkIndex >= 0` rows of the open note, and title rows are dropped from the
  candidates inside the search (`findSimilarChunks(..., { bodyChunksOnly:
  true })`), so each query chunk still gets its full 15 body candidates and
  panel results are the same as today. Dropping them after the search instead
  would let title rows crowd body chunks out of the top 15.
- Chunk counts ignore `chunkIndex < 0`: `NoteChunkRepository.count()` (the
  status bar's "N chunks") returns body chunks only. Index status counts notes
  from the mtime store, which title rows do not touch.

## Indexing

- New or changed note: the title is appended as the last text of the same
  `embedTexts` batch as the body chunks, and the title row is written in the
  same `putMulti`. Cost: one extra short text per indexed note, no extra
  request (the provider's own batching applies).
- Rename: body rows are carried to the new path as today (no re-embedding),
  but the title row is re-embedded because the title changed with the path.
  The carried body rows' `title` field is rewritten to the new title in the
  same write (their embeddings are kept). A rename with an unchanged basename
  (folder move) carries the title row too and writes nothing more.
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

The list comes from the Orama worker, which records while loading chunks from
IndexedDB which paths have body rows and which have a title row
(`getPathsWithoutTitleChunk`, a snapshot of load time). Processing a
`title-backfill` change reads the note's rows again and does nothing when the
body rows are gone (deleted since); it does not touch the note's mtime or
indexable-text hash. A frontmatter-excluded note is removed by the usual
processing-time check instead.

## Not changed

- Panel results and their scores.
- Settings, defaults, and the data.json format.

## Tests

In `src/application/__tests__/titleVector.test.ts` (stateful in-memory
repository) and `src/adapter/orama/__tests__/OramaDatabase.titleRows.test.ts`
(real Orama + fake IndexedDB: body-only search, count, load-time backfill
list):

- A title-fragment query ranks the note first when its body never mentions the
  title words (TextSearchService with a fake repository holding a title row).
- The panel's results for a note are identical with and without title rows.
- Rename re-embeds only the title row; folder move re-embeds nothing.
- Backfill queues only notes lacking a title row and embeds only titles.
