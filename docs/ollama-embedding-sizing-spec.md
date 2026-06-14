# Ollama Embedding: Chunk Sizing & Batching

This documents *why* Ollama chunks are sized and batched the way they are. The
constraints are not obvious from the code alone, so read this first.

It concerns the Ollama provider only (`OllamaEmbeddingProvider`,
`OllamaClient`). Other providers (Transformers.js, OpenAI, Gemini) have their
own limits and are out of scope.

## The problem (#46)

Ollama rejects any embedding input longer than the model's **context window**.
On the legacy `/api/embeddings` endpoint this comes back as:

```
HTTP 500  {"error":"the input length exceeds the context length"}
```

A single over-long chunk makes the **whole note** fail to index (the error
propagates to `NoteIndexingService` and the note ends up *Errored*). So chunks
must be sized to stay within the model context — but the model context is
measured in **tokens**, and we cannot cheaply know a chunk's true token count
before sending it.

## Token counting is an estimate, and it under-counts

`OllamaEmbeddingProvider.countTokens` estimates tokens as
`ceil(utf8_bytes / 2)` (`BYTES_PER_TOKEN = 2`). Bytes/token is far more
script-stable than chars/token (see `#46-B`, which replaced the old
chars/3.5 estimate that under-counted CJK ~5×).

But **no fixed byte ratio is correct for all content.** Subword tokenizers
shred token-dense text — tables, numbers, dates, file paths, snake_case, URLs,
code — into many small tokens, sometimes **more tokens than bytes**. So the
byte estimate *under-counts* real tokens for exactly the kind of notes that
overflow the context. This is why these notes still failed after `#46-B`: the
estimate said they fit when they did not.

We deliberately keep the estimate conservative (it rounds chunks *smaller*),
but it cannot be made reliable. Two mechanisms below compensate.

## `maxTokens` = the smaller of two ceilings

> **`maxTokens` is the embedding-input ceiling, not the chunk size.** It bounds
> how much can be sent to the model in one call. The chunk size used for
> retrieval is `min(SEMANTIC_CHUNK_TOKENS, maxTokens)` — a finer semantic target
> that this doc's ceilings only *cap*. See `semantic-chunk-size-spec.md`. The
> ceilings below still matter: they are the upper bound, and they govern
> truncation and batching regardless of chunk size.

`OllamaEmbeddingProvider.loadModel` computes `maxTokens` as:

```
maxTokens = min( detected,  floor(contextLength × CONTEXT_SAFETY_FACTOR) )
                 └─ payload / transport ceiling   └─ context-window ceiling
```

### Payload ceiling — `detectMaxTokens`

`detectMaxTokens` probes the server with increasing input sizes and returns the
largest that works, but caps the probe payload at **8192 bytes**
(`maxPayloadSize`) to stay clear of the Ollama v0.12.5+ bug where large
requests crash. On a healthy server this effectively settles at **2048**
(the 4096-token probe would be a ~14 KB payload, over the 8 KB cap, so it is
never tried). This ceiling is about *transport safety*, not the model context.

### Context ceiling — `capMaxTokensToContext`

`OllamaClient.getModelInfo` reads the model's real `contextLength` from
`/api/show`. `capMaxTokensToContext` then caps the chunk size at
`floor(contextLength × CONTEXT_SAFETY_FACTOR)`, with
**`CONTEXT_SAFETY_FACTOR = 0.5`**. If the context length is unknown, the
detected value is used unchanged.

**Why 0.5** — it is calibrated to the estimate error, not a guess. Measured on
the #46 reporter's files:

| Chunk size vs real context | Chunks that overflow the context |
| --- | --- |
| full context (1.0×) | **10–44 %** (one file: 19 of 43 chunks) |
| **0.5×** | **~2 %** |

0.5× absorbs the ~2× under-count seen on dense content, dropping truncation
from *frequent* to *rare*. Smaller chunks are not a meaningful cost for
note-to-note similarity — over-large chunks dilute the embedding (one vector
averaging many subtopics matches everything weakly), so ~256–1024-token chunks
sit in a good retrieval range anyway. The trade is roughly 2× more vectors to
store/index, which is acceptable for these fast local models.

### Which ceiling binds

The context ceiling only matters when `contextLength × 0.5 < 2048`, i.e. for
models with a context **below ~4096 tokens**:

| Model | Real context | Payload ceiling | Context ceiling (×0.5) | `maxTokens` | Binds |
| --- | --- | --- | --- | --- | --- |
| all-minilm | 512 | 2048 | 256 | **256** | context |
| nomic-embed-text | 2048 | 2048 | 1024 | **1024** | context |
| bge-m3 | 8192 | 2048 | 4096 | **2048** | payload |

For large-context models the 8 KB payload ceiling is already the lower bound,
so the context cap has no effect — `bge-m3` would be 2048 with or without it.

These `maxTokens` values are the **embedding ceiling**. The **chunk size** is
then `min(SEMANTIC_CHUNK_TOKENS=512, maxTokens)`, so bge-m3 chunks at 512 (not
2048) and `all-minilm` stays at 256 — see `semantic-chunk-size-spec.md`.

## The hard backstop — `truncate: true`

`OllamaClient` embeds via the modern **`/api/embed`** endpoint with
**`truncate: true`**. When input still exceeds the context (the residual ~2 %,
or pathological chunks the estimate badly under-counts), Ollama **trims the
end to fit instead of erroring**. The legacy `/api/embeddings` endpoint cannot
do this — it has no `truncate` option and always errors on overflow.

This is a two-layer design:

- **Chunk-size cap** keeps truncation *rare* (so we rarely discard any content).
- **`truncate: true`** *guarantees* a note can never fail from context overflow.

Truncation loss is further softened by the chunker's `chunkOverlap` (100): a
trimmed tail is largely repeated at the head of the next chunk.

## Batching

`OllamaEmbeddingProvider.embedTexts` embeds a note's chunks in **payload-bounded
batches** rather than one request per chunk. `/api/embed` accepts an array
`input` and returns one embedding per input, in order.

- `batchTextsByPayload` groups consecutive chunks so each batch's combined
  UTF-8 size stays within **`BATCH_PAYLOAD_BUDGET_BYTES = 8192`** (the same
  transport-safe envelope as the single-request guard). An over-budget chunk
  goes in its own batch; `truncate` handles its size server-side.
- `OllamaClient.generateEmbeddings` sends the batch and **validates that the
  embedding count equals the input count** — `NoteIndexingService` maps
  embeddings back to chunks by array index, so a short response would silently
  misalign vectors with chunks.
- Order is preserved end-to-end, so the flattened result aligns 1:1 with the
  input chunks.

Batching helps most for small-context models, which produce many chunks per
note (e.g. all-minilm makes ~16 chunks fit in one 8 KB request).

## Choosing a model

Larger context = more headroom = less truncation. For token-dense notes:
`bge-m3` (8 K) and `nomic-embed-text` (2 K) have the most headroom;
`all-minilm` (512) is the most truncation-prone. The `truncate` backstop keeps
*any* model from erroring, so this only affects how much rare truncation occurs.

## Code map

| Concern | Location |
| --- | --- |
| Token estimate | `OllamaEmbeddingProvider.countTokens` |
| Payload/transport ceiling | `OllamaEmbeddingProvider.detectMaxTokens` |
| Context ceiling + factor | `capMaxTokensToContext`, `CONTEXT_SAFETY_FACTOR` |
| Wiring (min of ceilings) | `OllamaEmbeddingProvider.loadModel` |
| Real context length | `OllamaClient.getModelInfo` (`/api/show`) |
| Truncate backstop + endpoint | `OllamaClient.generateEmbedding(s)` (`/api/embed`) |
| Batching | `batchTextsByPayload`, `BATCH_PAYLOAD_BUDGET_BYTES`, `OllamaEmbeddingProvider.embedTexts` |
| Chunking (consumes `maxTokens`) | `LangchainNoteChunkingService` |
