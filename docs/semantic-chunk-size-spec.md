# Semantic Chunk Size: Decoupling Chunking from the Model Context

This documents *why* note chunks are sized at a fixed semantic target rather than
at the model's maximum embedding input. The two are different concerns that were
conflated, and the conflation silently degraded recommendation quality on
large-context models. Read this before changing chunk sizing.

It applies to **all** embedding providers (Transformers.js, Ollama, OpenAI,
Gemini). The Ollama-specific overflow/transport constraints are a separate,
complementary concern — see `ollama-embedding-sizing-spec.md`.

## The two roles of `getMaxTokens()`

`EmbeddingService.getMaxTokens()` reports the largest input the model can embed
in one call. It is used in two unrelated roles:

1. **Embedding-input ceiling** — truncating an over-long input so the model does
   not reject it (`EmbeddingService.truncate`, `TextSearchService.checkTokenLimit`,
   Ollama's transport/context guards). Here the *maximum* is exactly what we want.
2. **Chunk size** — how finely a note is split before embedding
   (`LangchainNoteChunkingService.init` used `chunkSize: getMaxTokens()`). Here
   the maximum is the *wrong* value: chunk size should be tuned for retrieval
   granularity, not for how much the model can physically swallow.

Reusing the ceiling as the chunk size means chunk granularity rides on the model's
context window, which has nothing to do with what makes a good semantic unit.

## The failure: signal dilution on large-context models

A larger embedding vector that averages many subtopics matches everything weakly
and nothing strongly. When a note spanning many topics is embedded as a few large
chunks, any single subtopic's signal is averaged away and never surfaces as a
chunk-level match.

Consider a long "catch-all" note that interleaves many unrelated topics (a running
log, a broad timeline, a reference dump) and a second note focused on just one of
those topics. The long note genuinely contains the focused topic, but only as a
small fraction of its content. Under a large-context model (e.g. Ollama **bge-m3**)
the chunk size landed at 2048 (`countTokens` units = ~4 KB), so the long note
became a handful of coarse chunks, each blending a dozen-plus unrelated sections.

Measured on a representative pair of this shape (note-to-note score = max-pool
cosine over chunk pairs, the way `SimilarNoteFinder` ranks notes), sweeping only
the chunk size:

| Chunk size (countTokens units) | long ↔ focused score | What the best-matching chunk pair actually is |
| --- | --- | --- |
| **2048 (old bge-m3 behavior)** | 0.588 | a shared **structural fragment** (a Markdown table-header row) — *not the shared topic* |
| 1024 | 0.594 | still structure vs. an off-topic section |
| 512 | 0.687 | **the genuinely shared topic** passage on both sides |
| 256 | 0.789 | the genuinely shared topic passage (tighter isolation) |

Two things degrade at the coarse size, not one:

- The **score is lower** (0.588 vs 0.687 at 512), and
- the match is carried by **structural noise** (a shared table header), not by the
  topical overlap. In a real vault, that 0.588 is indistinguishable from how any
  other note with similar structure scores — in the test vault, unrelated notes
  clustered only ~0.04 below the "correct" match. The genuinely-distinctive
  on-topic signal is invisible, so the right note drowns in structural near-ties.

Shrinking the chunk size isolates the on-topic chunks; the best pair becomes the
actual shared subject and the score rises. This is the textbook 256–512-token
retrieval sweet spot.

The bug is **general**, not Ollama-specific: any large-context provider hits it
(OpenAI `text-embedding-3` reports ~8191; Gemini similar). It only escaped notice
because the original default model (Transformers `all-MiniLM`, 512 context)
already chunked finely. A large-context model (recommended for Ollama #46
truncation headroom) made chunks *coarser*, so the fix for one problem worsened
another.

## The fix: a fixed semantic target, with the model max as a ceiling

`LangchainNoteChunkingService` sizes chunks at:

```
chunkSize = min( SEMANTIC_CHUNK_TOKENS,  getMaxTokens() )
                 └─ retrieval granularity  └─ model/transport ceiling (never exceed)
```

with **`SEMANTIC_CHUNK_TOKENS = 512`**.

- For large-context models (bge-m3, OpenAI, Gemini) the semantic target binds, so
  chunks are now ~512 units regardless of an 8 K context — finer, focused vectors.
- For small-context models (`all-minilm` at 256, `paraphrase-multilingual` at 512)
  the model ceiling still binds via `min`, so their behavior is unchanged.
- `getMaxTokens()` keeps its real meaning everywhere else (truncation, transport),
  so Ollama's #46 overflow protection (`truncate: true`, payload batching) is
  fully intact — capping chunks *smaller* only reduces overflow risk.

### Why 512, and the unit caveat

512 sits in the well-established 256–512-token retrieval sweet spot. The value is
expressed in each provider's own `countTokens` unit, which differs:

- Ollama's `countTokens` is a byte estimate (`ceil(utf8_bytes / 2)`), so 512 units
  ≈ 1 KB ≈ ~250 real tokens for English. Smaller than 512 *real* tokens, but
  comfortably inside the sweet spot and empirically the point where the on-topic
  signal surfaces (table above).
- Transformers/OpenAI/Gemini use a real tokenizer, so 512 units ≈ 512 real tokens.

A single constant in mixed units is a deliberate simplicity trade: both ends land
in the good retrieval range, so per-provider tuning is not worth the complexity.

### Cost

More chunks per note: vs. the old 2048 size, a long note goes from a handful of
coarse chunks to roughly 4–5× as many at 512. That is more storage and longer
indexing, accepted deliberately: these are fast local/remote embedding models, and
recommendation quality is the priority. The change requires a **full reindex** to
take effect (existing vectors keep their old granularity until re-embedded).

## Code map

| Concern | Location |
| --- | --- |
| Semantic target constant | `SEMANTIC_CHUNK_TOKENS` (`LangchainNoteChunkingService`) |
| Chunk size = `min(target, ceiling)` | `LangchainNoteChunkingService.init` |
| Model/transport ceiling (unchanged role) | `EmbeddingProvider.getMaxTokens` per provider |
| Ollama overflow/transport rationale | `docs/ollama-embedding-sizing-spec.md` |
| Decision record | `docs/adr/0002-semantic-chunk-size-cap.md` |
