# Code Mode Specification

## Status

Accepted for issue #52.

## User workflow

Code Mode is opt-in. When disabled, Similar Notes keeps its existing behavior and
indexes the complete Markdown body, including fenced code blocks.

When enabled, Similar Notes partitions each indexable note into two independent
corpora:

- **Notes** contains prose with fenced code blocks removed.
- **Code** contains fenced code blocks and their language metadata.

Semantic Search and the similar-notes views expose an explicit Notes/Code mode.
Results from the two modes are not mixed because independent embedding models do
not produce calibrated, directly comparable similarity scores.

## Markdown partitioning

Partitioning runs after frontmatter handling and configured regular-expression
exclusions. The extractor recognizes CommonMark-style backtick and tilde fences,
including variable fence lengths, up to three leading spaces, info strings,
empty blocks, and an unterminated final block.

Inline code spans are not code blocks. Removing a fenced block from prose keeps
surrounding line boundaries stable so unrelated paragraphs are not joined.

Each code block retains:

- language from the first info-string token, if present;
- zero-based block position within the note;
- source content without opening and closing fences.

Code chunks preserve line boundaries. The embedding input includes the note
title and language context, while stored previews contain the original code.

## Model ownership

The Notes and Code profiles can use different providers and models. A Code
profile is initially copied from the active Notes profile; no code model is
silently selected for the user.

If both profiles resolve to the same effective configuration, they share the
loaded embedding service. Distinct configurations use isolated services so one
profile cannot dispose or switch the other profile while indexing is active.
Code resources load only while Code Mode is enabled.

## Persistence

The existing Notes index keeps its current IndexedDB name:
`<vaultId>-similar-notes`.

The Code index uses `<vaultId>-similar-notes-code`. Separate databases are
required because an Orama vector field has one fixed dimension and the two
models may return different dimensions.

Index progress and terminal errors are also namespaced. A successful Notes
write does not mark the Code target current, and a Code failure does not suppress
future Notes processing.

## Invalidation

| Setting change | Required work |
| --- | --- |
| Enable Code Mode | Rebuild Notes and build Code |
| Disable Code Mode | Rebuild Notes and remove Code runtime data |
| Code provider, model, URL, or maximum tokens | Rebuild Code only |
| Code API key or GPU execution mode | Reload Code provider only |
| Notes model | Rebuild Notes only |
| Folder or content exclusions | Reconcile both enabled indexes |

File creation, modification, deletion, and rename are processed independently by
the two index queues. Rename reuses stored vectors when the indexed mtime still
matches. A target's mtime advances only after its repository operation succeeds.

## Query behavior

Notes mode uses the existing note chunks and model. Code mode extracts code from
the source note, queries only the Code index, excludes the source file, keeps the
best matching chunk per destination note, and shows code previews. A source note
without fenced code returns an empty Code result with a mode-specific message.

Coordinator caches include file mtime, search mode, and the relevant model
profile. Changing mode or profile cannot reuse results from another index.

## Resource and privacy constraints

Two enabled indexes increase IndexedDB and Orama memory usage. Two distinct
built-in models can exceed a mobile device's memory budget, so the UI warns
before that configuration and recommends a remote provider on mobile.

Code sent to a remote Code provider follows that provider's privacy policy. API
keys remain excluded from environment diagnostics.

## Verification

Automated coverage must include extraction edge cases, independent persistence
namespaces and dimensions, dual queue invalidation, settings migration, model
isolation, mode-specific querying, cache invalidation, and disabled-mode
compatibility. Manual verification uses `npm run install-local` and the
`Test_local` vault described in `CLAUDE.md`.
