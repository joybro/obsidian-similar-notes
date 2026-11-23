# Title Vector Specification

## Status

Implemented. Issue
[#26](https://github.com/joybro/obsidian-similar-notes/issues/26).

## Problem

A note's title is embedded only as the first line of its first chunk
(`${title}\n\n${content}`), so in a long note the title is a small part of one
vector. Searching by part of a note's title (semantic search modal, `;;` link
suggestion) often misses the note. Measured in a local benchmark on two samples, mean reciprocal rank for
title-fragment queries: English 0.64, Korean 0.17.

## Decision

Each indexed note gets one extra vector for its title alone. Text queries score
a note by the higher of its best body-chunk similarity and its title
similarity. The Similar notes panel (note to note) does not use title vectors.

Measured effect of this rule in the same local benchmark: title-fragment MRR English 0.64
→ 0.97, Korean 0.17 → 0.73; body-sentence queries change by -0.025 (English)
and -0.014 (Korean).

## Storage

The title vector is stored as one more chunk row of the note, so the Orama
schema and the IndexedDB object stores do not change:

| field | value |
|---|---|
| `path`, `title` | the note's path; `title` = the title text below |
| `content` | the title text: the file basename (derived from the path) with surrounding whitespace trimmed (`titleTextFromPath`, the one helper indexing, rename and backfill share). A whitespace-only name gets no title row. Body rows keep the untrimmed basename in `title`, like `Note.title`. |
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
- Title overlap bonus (text queries only): before grouping, a title row's
  ranking key is its similarity plus `0.1 × overlap`, where `overlap` is the
  share of the query's character bigrams (taken inside each word, after
  lowercasing and turning punctuation into spaces; words of one character
  are skipped) that also occur in the title. Body rows keep their plain
  similarity. Results are grouped and sorted by this key, but the score shown
  to the user stays the plain similarity of the winning row. The bonus only
  reorders the candidates the vector search already returned (`limit * 3`
  chunks); it never adds notes. Why: short Korean title fragments lose to
  other notes' titles on meaning alone (fixed Korean benchmark: title-fragment
  MRR 0.69 without the bonus, 0.77 to 0.78 with it; English 0.97 to 0.98;
  body-sentence queries change by at most 0.003). Character bigrams rather
  than whole words, so a fragment with a particle attached or a word still
  being typed keeps its overlap. Helper: `titleOverlap` in
  `src/domain/service/titleOverlap.ts`.
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
- Queued rename sequences keep the original indexed source until processing.
  If `A` becomes `B` and then `C` before processing, carry `A` directly to `C`.
  Replacing a pending rename with an edit, deletion or move to an excluded
  path must still remove its original source rows and metadata. An edit after
  a queued rename embeds the final content at the destination. Rename and
  delete events cancel older pending edit timers, so a delayed edit cannot
  erase a newer rename's source-path information. These rules concern work
  still in the queue, not changes already doing I/O.
  A queued retry may already have moved rows to its intermediate destination
  before title embedding failed. Coalescing a subsequent rename therefore
  also schedules removal of that intermediate path. If the original source
  no longer has rows, normal fresh indexing at the final path is the fallback.
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

제목 백필은 상태줄의 대기 수에는 포함하지만, 100개 단위 진행 팝업의
계산에서는 제외한다. 백필과 일반 변경이 섞이면 팝업은 백필을 제외한
대기 수만 사용한다. 일반 색인의 기존 임계값과 오류 알림은 유지한다.
백필 수천 건이 빨리 끝날 때 진행 팝업이 연달아 쌓이는 것을 막기 위한
규칙이며, 별도 설정이나 저장 형식 변경은 없다.

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
- With two title rows of near-equal similarity, the one sharing the query's
  characters ranks first, and the shown score is the unboosted similarity
  (`src/domain/service/__tests__/titleOverlap.test.ts`).
- The panel's results for a note are identical with and without title rows.
- Rename re-embeds only the title row; folder move re-embeds nothing.
- Backfill queues only notes lacking a title row and embeds only titles.
