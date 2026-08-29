# Indexable Text Hash Specification

## Status

Accepted for [issue #51](https://github.com/joybro/obsidian-similar-notes/issues/51).

## Problem

File modification time is a cheap way to find notes that may need indexing, but
it does not prove that their embedding input changed. For example, another
plugin can update only frontmatter while **Include frontmatter** is disabled, or
it can update text removed by a configured content-exclusion pattern. Repeating
chunking and embedding for those writes wastes local CPU or paid API calls.

## Decision

Indexing uses two checks:

1. Modification time selects candidate notes for the existing change queue.
2. A versioned hash of effective indexable text decides whether a queued note
   needs new chunks and embeddings.

The plugin never hashes every note during startup. Only a note already selected
by the mtime/event queue pays the hashing cost.

## Canonical Hash Input

The input is the exact content string produced by the existing indexing
preprocessing pipeline:

1. Read the note with or without frontmatter according to the current setting.
2. Apply configured exclusion regexes in order with their existing `gm` flags.
3. Hash the resulting string before chunking.

No trimming, whitespace folding, Unicode normalization, or newline conversion
is added. Those transformations could hide changes that affect chunk boundaries
or embedding input. Path, title, and mtime are excluded: title follows path, and
the existing pure-rename contract deliberately carries embeddings without
regenerating them.

Hash format is `v1:<sha256-hex>`, calculated with Web Crypto. The prefix lets a
future preprocessing-contract change invalidate old hashes without changing the
IndexedDB schema.

## Processing Rules

- Stored hash exists, matches, and change is not forced: skip splitting,
  embedding, chunk replacement, and semantic-result recomputation. Persist the
  newer mtime with the unchanged hash. If the note is active, refresh cached
  link/display metadata without repeating vector search.
- Stored hash is missing or different: run the existing split/embed/replace
  flow. Persist the new mtime and hash only after chunk persistence succeeds.
- Effective content is empty, or splitting produces no chunks: remove any stale
  chunks, perform no embedding, and persist the empty-content hash.
- Explicit full reindex and errored-note retry are forced changes. They do not
  short-circuit on a matching hash.
- The note no longer exists when its change is processed: write no metadata at
  all. Advancing mtime with an absent hash would erase a stored hash and keep a
  ghost "indexed" entry; the corresponding delete change owns the cleanup.

## Persistence and Compatibility

The existing per-note mtime IndexedDB record gains an optional
`indexableTextHash` field. IndexedDB object records are schemaless, so the
current database version and `path` key remain unchanged.

Legacy `{ path, mtime }` records load with an unknown hash. They are not scanned
or migrated in bulk; the next queued modification embeds once and backfills the
hash. Full reindex and model-change flows already clear the metadata store, so
they also clear hashes. Pure renames move the hash with the mtime and preserved
chunks. Deletes remove both.

## Failure and Concurrency Rules

Hashing, embedding, or chunk-repository failures must not advance processed
metadata. Existing retry and terminal-error handling remains responsible for
those failures. A metadata-write failure happens after chunk persistence and is
retried without claiming durable completion.

Before the chunk index is mutated (chunk removal or replacement), the stored
hash for the note is dropped while keeping its mtime. Otherwise a failed chunk
write would leave a hash that still matches previously-indexed content while
the chunks are gone: reverting the note to that content would then hash-match,
skip re-embedding, and leave the note permanently absent from search while
reported as indexed. A skip decision itself never clears the hash.

The per-note similarity cache is stamped with the mtime of the change whose
content was hash-verified, never the live file stat. A real edit landing
between the hash check and the metadata refresh would otherwise mark pre-edit
results fresh under the newer stat and serve them indefinitely.

Existing cross-note parallelism remains unchanged. Queue debouncing normally
prevents same-path overlap; adding a per-path lock is outside this change.
