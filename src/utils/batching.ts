/**
 * Split `items` into consecutive sub-batches of at most `maxBatchSize`, preserving
 * order. `splitIntoBatches(xs, n).flat()` always reconstructs `xs`.
 *
 * Why this exists: the built-in (Transformers.js / onnxruntime-web) embedder runs
 * one forward pass per call, and embedding a whole note's chunks in a single
 * `[N, seqLen]` pass costs roughly `N * heads * seqLen^2 * 4 bytes` for the
 * attention buffer. A large note (e.g. a long config/README) chunks into a big
 * array of near-max-length chunks, so one pass can overrun the wasm32 ~4GB
 * address space and abort the runtime, which surfaces as a bare-number throw (the
 * `8934496`-style error). The cap is independent of host RAM, so a powerful
 * machine fails just the same. Capping N per pass keeps peak memory bounded.
 * See docs/builtin-embedding-batch-cap-spec.md for the measured thresholds.
 */
export function splitIntoBatches<T>(items: T[], maxBatchSize: number): T[][] {
    if (!Number.isInteger(maxBatchSize) || maxBatchSize <= 0) {
        throw new Error(
            `maxBatchSize must be a positive integer, got ${maxBatchSize}`
        );
    }

    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += maxBatchSize) {
        batches.push(items.slice(i, i + maxBatchSize));
    }
    return batches;
}

/**
 * Embed `items` through `embedBatch` in `maxBatchSize`-bounded sub-batches, run
 * **sequentially** (so peak memory is one sub-batch, not the whole input), and
 * concatenate the per-sub-batch embeddings back in input order. A rejection from
 * `embedBatch` propagates unchanged so callers can normalize/handle it. This is
 * the orchestration behind `handleEmbedBatch`; see `splitIntoBatches` for why the
 * cap matters.
 */
export async function embedInBatches<T>(
    items: T[],
    maxBatchSize: number,
    embedBatch: (batch: T[]) => Promise<number[][]>
): Promise<number[][]> {
    const result: number[][] = [];
    for (const batch of splitIntoBatches(items, maxBatchSize)) {
        const embeddings = await embedBatch(batch);
        result.push(...embeddings);
    }
    return result;
}
