/**
 * Whether the browser cache already holds a built-in model's ONNX weights.
 *
 * transformers.js reports the same download progress events when it reads a
 * cached model as when it downloads one, so a slow disk read would be shown
 * as a download (panel-empty-states spec, `downloading`). The worker asks this
 * before loading and passes on no progress for a model read from the cache.
 */
// transformers.js's default `env.cacheKey`; the plugin does not change it.
const TRANSFORMERS_CACHE = "transformers-cache";
// The weights file for dtype "fp32", which transformers.worker.ts requests.
const WORKER_WEIGHTS_FILE = "/onnx/model.onnx";

export async function isModelCached(
    modelId: string,
    cacheStorage: CacheStorage | undefined = globalThis.caches
): Promise<boolean> {
    if (!cacheStorage) {
        return false;
    }
    try {
        const cache = await cacheStorage.open(TRANSFORMERS_CACHE);
        // Keys are the remote URLs: https://huggingface.co/<model id>/resolve/<revision>/onnx/model.onnx
        const marker = `/${modelId}/resolve/`;
        // Only the file the worker loads (dtype fp32). The cache is shared by
        // every plugin in the app, and another one may hold only
        // model_quantized.onnx of the same model.
        return (await cache.keys()).some(
            (request) =>
                request.url.includes(marker) &&
                request.url.endsWith(WORKER_WEIGHTS_FILE)
        );
    } catch {
        // No readable cache: treat the load as a possible download.
        return false;
    }
}
