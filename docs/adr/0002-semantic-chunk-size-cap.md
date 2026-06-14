# 2. Cap chunk size at a semantic target, decoupled from the model context

Date: 2026-06-14

Status: Accepted

## Context

`LangchainNoteChunkingService.init` sized chunks at `chunkSize: getMaxTokens()` —
the model's maximum embedding input. `getMaxTokens()` exists to bound a single
embedding call (truncation, transport/context safety; see
`ollama-embedding-sizing-spec.md`); it has nothing to do with what makes a good
*semantic* unit. Reusing it as the chunk size coupled chunk granularity to the
model's context window.

A user reported a real miss: a long "catch-all" note that interleaves many topics
failed to surface a clearly-related note focused on just one of those topics, even
though the long note genuinely covers that topic. With a large-context model
(Ollama **bge-m3**, 8 K context), `getMaxTokens()` lands at 2048 — so the long
note became a handful of coarse ~4 KB chunks, each blending a dozen-plus unrelated
sections.

Measured on a representative pair of this shape (max-pool cosine, the way
`SimilarNoteFinder` ranks notes; faithfully reproduced in the live plugin, which
gave the identical 0.588):

| Chunk size | long ↔ focused | best-matching chunk pair |
| --- | --- | --- |
| 2048 (old) | 0.588 | a shared structural fragment (table header) — *not the shared topic* |
| 512 | 0.687 | the genuinely shared topic passage |
| 256 | 0.789 | the genuinely shared topic passage (tighter) |

At 2048 the "match" is carried by structural noise; unrelated notes in the test
vault clustered only ~0.04 below it, so at real vault scale the correct match is
buried. The bug is general (any large-context provider: OpenAI 8191, Gemini); it
escaped notice only because the original default model (`all-MiniLM`, 512) already
chunked finely, and moving to a large-context model for Ollama #46 headroom made
chunks coarser.

## Decision

Size chunks at `min(SEMANTIC_CHUNK_TOKENS, getMaxTokens())` with
**`SEMANTIC_CHUNK_TOKENS = 512`**, applied at the chunking layer
(`LangchainNoteChunkingService`) so it covers all providers. `getMaxTokens()`
remains the embedding-input ceiling everywhere else (truncation, batching,
transport) — its role is unchanged, the #46 overflow protection is intact, and
capping chunks *smaller* only reduces overflow risk. Small-context models keep
their existing size via `min` (`all-minilm` stays 256). Requires a full reindex
to take effect.

## Alternatives considered

- **`SEMANTIC_CHUNK_TOKENS = 256`.** Viable, and empirically the *best* topical
  isolation (0.789 vs 0.687). Rejected as the default: ~2.4× the vectors of 512
  for a quality gain past the point where the match already surfaces cleanly. 512
  is the conventional retrieval sweet spot and a one-constant change if we ever
  want to revisit.
- **Expose chunk size as a user setting.** Rejected: it is a knob users cannot
  reason about (its good value depends on the tokenizer's unit, which differs per
  provider), and the existing design philosophy keeps chunk sizing automatic. Fix
  the default well instead of adding surface.
- **Fix it only for Ollama (where it was reported).** Rejected: the coupling lives
  in the shared chunking layer and the dilution is identical for any large-context
  provider. A provider-specific patch would leave OpenAI/Gemini users with the
  same latent bug.
- **Express the target in real tokens per provider** (normalize the unit mismatch:
  Ollama's `countTokens` is bytes/2 ≈ ~250 real tokens at 512; real tokenizers are
  512 real tokens). Rejected: both ends land inside the 256–512 retrieval sweet
  spot, so per-provider normalization adds complexity for no measurable benefit.

## Consequences

- Large-context providers (bge-m3, OpenAI, Gemini) now chunk at 512 instead of
  thousands of tokens: finer, more focused vectors; better recommendations on
  long multi-topic notes; a genuinely-related focused note surfaces with the
  on-topic passage as its excerpt and a wider margin over structural noise.
- ~4–5× more vectors per note for those models vs. the old 2048 size → more
  storage and longer indexing. Accepted (fast models, quality-first).
- Existing indexes keep their old granularity until re-embedded; the improvement
  lands after a full reindex.
- `docs/ollama-embedding-sizing-spec.md` updated to clarify `maxTokens` is the
  embedding ceiling, not the chunk size. Rationale captured in
  `docs/semantic-chunk-size-spec.md`.
