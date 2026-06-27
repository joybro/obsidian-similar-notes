# Built-in embedding: per-pass batch cap

Why the built-in (Transformers.js / onnxruntime-web) embedder caps how many chunks
go into a single forward pass, and why the obvious "threading" explanation is wrong.

## Symptom

With the built-in on-device model and GPU acceleration **off**, indexing failed with
a **bare number** (e.g. `8934496`) in the Errored files list. A user reported ~19
notes indexed then the rest (900+) errored, and once it started failing it kept
failing. Counterintuitively a powerful desktop failed where a much slower mini PC
(same OS/software) did not.

## Mechanism (the real one)

We embed a note by chunking it (≤512 tokens/chunk) and sending **all of a note's
chunks as one array** to a single forward pass (`NoteIndexingService` →
`EmbeddingService.embedTexts` → `handleEmbedBatch` → `extractor(texts)`).

One `[N, seqLen]` forward pass allocates an attention buffer on the order of
`N × heads × seqLen² × 4 bytes`. A large note (e.g. a long Marlin/3D-printer config
or README) chunks into a big array of near-max-length chunks, so a single pass can
overrun the **wasm32 ~4GB linear-memory address space**. onnxruntime's allocation
failure surfaces through Emscripten as a thrown **bare number** (a C++ exception
pointer), which `normalizeWasmError` already turns into a readable Error.

Key consequences:

- **The cap is the wasm32 address space, not host RAM.** It is identical on every
  machine, so a powerful desktop is affected exactly like a small one. (The slower
  mini PC almost certainly just had different vault content, i.e. no note large
  enough to trip the cap, not a hardware advantage. This is the one part not proven
  by repro.)
- **One abort degrades the instance.** After the OOM abort, batches that succeeded
  *before* the abort start failing too (the allocator/address space is left in a
  degraded state), so a single oversized note tends to cascade into the rest of the
  run failing with a (tightly clustered, near-identical) bare number.

## Why it is NOT threading (beta.4 misdiagnosis — do not re-pursue)

1.6.0-beta.4 pinned `env.backends.onnx.wasm.numThreads = 1`, on the theory that
ort-web's multi-threaded WASM path needed SharedArrayBuffer (cross-origin isolation)
that Obsidian lacks. That fix was a **no-op**:

- Obsidian's worker is **not** cross-origin isolated (`crossOriginIsolated === false`),
  and ort-web's own auto-detect already selects `numThreads = 1` in that case. Our
  pin set a value it was going to become anyway.
- Only the *threaded* wasm binary ships (it declares `shared` memory); Electron
  grants SharedArrayBuffer even with isolation off, so the model loads and a console
  "SharedArrayBuffer is restricted" line is a non-fatal warning, not the killer.
- The crash **reproduces single-threaded**, so threading was never the cause.

The `numThreads = 1` pin is kept for deterministic single-threaded memory behavior,
but it is explicitly *not* the fix.

## Repro evidence

A Node repro against the exact stack (`@huggingface/transformers` 3.6.0,
`onnxruntime-web` 1.22.0-dev, `all-MiniLM-L6-v2`, fp32, wasm, mean/normalize),
forced single-threaded:

- **Load:** single-threaded load succeeds; `numThreads === 1`.
- **Batch sweep (full 512-token chunks):** N=1..128 OK (N=128 peaked ~4.6GB RSS),
  **N=256 throws a bare integer** — exactly the user's symptom. Threshold is between
  128 and 256 for full-length chunks.
- **Leak:** none. 1000 sequential single embeds (disposing each tensor) plateau at
  +~94MB and stay flat; not a slow accumulation.
- **Cascade:** after one OOM abort, small embeds still succeed but previously-OK
  N=64/128 batches now also throw; pointers cluster tightly (hence "same number").

Caveats: thresholds were measured via the `ort.node` glue in Node; the app runs the
`ort.bundle` glue in Electron (identical wasm binary, so OOM behavior should match,
but the exact N may shift with environment overhead). The multi-thread path was not
tested (out of scope: not cross-origin isolated).

## Fix

Cap chunks per forward pass at `MAX_EMBED_BATCH_SIZE = 32`
(`transformers.worker.ts`), embedding sub-batches **sequentially** and concatenating
in order (`splitIntoBatches` / `embedInBatches` in `src/utils/batching.ts`). 32
full-length (512-token) chunks peak ~1.2GB, a comfortable margin below the ~4GB
cliff. Sequential (not concurrent) sub-batches keep peak memory at one sub-batch.

**Rejected alternative — token-aware budget.** A budget on `N × maxSeqInBatch²`
would let many *short* chunks pack into larger batches (better throughput on
many-short-chunk notes). Deferred as YAGNI: the notes that actually trip the cap are
large notes made of near-max-length chunks, where a count cap is equivalent; the
count cap is simpler and has no token-estimation risk. Revisit if indexing
throughput on many-small-chunk notes becomes a concern.

## Verified in real Obsidian

Confirmed in-app (not just Node), on the **heavier** model `paraphrase-multilingual-MiniLM-L12-v2` (~118M params, ~5× the L6 the cap was first measured against): a ~400-chunk note that reproducibly crashed the pre-fix build with a bare number (`951320544`) indexed cleanly with the cap in place (`Saved 400 chunks`, no abort), splitting into ~13 sequential sub-batches. So `MAX_EMBED_BATCH_SIZE = 32` holds with margin even on the heaviest built-in model. Side note surfaced during this test: the status-bar "indexing" indicator keys off queue length (`noteChangeCount > 10`), not actual model-busy state, so a single long-running large-note embed shows no activity — a separate UX gap, not part of this fix.

## Known follow-up (not yet implemented)

**Reload-on-abort recovery.** The sub-batch cap should prevent the abort entirely,
but if any abort ever slips past it, the degraded-instance cascade still poisons the
rest of the run. A defense-in-depth measure is to detect the bare-number abort (the
`normalizeWasmError` path) and reload the worker/pipeline before continuing. This is
**unverified in Electron** (the repro did not confirm a fresh instance fully
recovers), so it needs an in-app check before relying on it.
