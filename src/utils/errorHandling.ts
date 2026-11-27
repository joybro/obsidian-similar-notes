import { Notice } from "obsidian";
import { Subject } from "rxjs";

const PLUGIN_NAME = "Similar Notes";

export interface ErrorHandlerConfig {
    providerName: string;
    errorSubject: Subject<string | null>;
    customPatterns?: ErrorPattern[];
}

export interface ErrorPattern {
    patterns: string[];
    message: string;
}

/**
 * Default error patterns for different provider types
 */
export const GPU_ERROR_PATTERNS: ErrorPattern[] = [
    {
        patterns: ["webgpu", "WebGPU"],
        message: "GPU acceleration failed - try disabling GPU in settings"
    },
    {
        patterns: ["Failed to get GPU adapter"],
        message: "GPU not available - disable GPU acceleration in settings"
    }
];

export const NETWORK_ERROR_PATTERNS: ErrorPattern[] = [
    {
        // "Failed to fetch" is how Chromium (desktop, Android) rejects a fetch
        // that cannot reach the server; WebKit (iOS, iPadOS) says "Load failed".
        patterns: ["network", "fetch", "Load failed"],
        message: "Network error - check your internet connection"
    }
];

/** Whether an error reads as a network failure (NETWORK_ERROR_PATTERNS). */
export function isNetworkError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return NETWORK_ERROR_PATTERNS.some((pattern) =>
        pattern.patterns.some((text) => message.includes(text))
    );
}

export const OLLAMA_ERROR_PATTERNS: ErrorPattern[] = [
    {
        patterns: ["Cannot connect"],
        message: "Cannot connect to Ollama server - check if Ollama is running"
    },
    {
        patterns: ["not available"],
        message: "Model not found - check if model is installed in Ollama"
    }
];

export const TRANSFORMERS_ERROR_PATTERNS: ErrorPattern[] = [
    {
        // transformers.js loads model files at paths like `onnx/model.onnx`.
        // If the repo has no ONNX weights (e.g. safetensors-only), the
        // underlying fetch 404s and the error message embeds that URL.
        // Match the `onnx/` path prefix so we catch both the canonical
        // "Could not locate file: ..." and wrapped "Failed to fetch ..." forms.
        patterns: ["onnx/"],
        message:
            "No ONNX weights found for this model. Try the `onnx-community/...` version on Hugging Face, or switch to a different provider in settings.",
    },
];

export const GEMINI_ERROR_PATTERNS: ErrorPattern[] = [
    {
        patterns: ["API key not valid", "INVALID_API_KEY", "API_KEY_INVALID"],
        message: "Invalid API key - check your Google AI Studio API key"
    },
    {
        patterns: ["quota exceeded", "RESOURCE_EXHAUSTED"],
        message: "API quota exceeded - check your Google AI Studio usage limits"
    },
    {
        patterns: ["model not found", "MODEL_NOT_FOUND", "models/"],
        message: "Model not found - check if the model ID is correct"
    },
    {
        patterns: ["PERMISSION_DENIED"],
        message: "Permission denied - check your API key permissions"
    }
];

/**
 * Name the cause of a failed search when it is one we know for sure, else null.
 *
 * Unlike extractUserFriendlyMessage, this never falls back to the raw error
 * text: an unknown failure keeps the generic "check your model settings"
 * notice. Statuses are read only from the messages our embedding adapters
 * throw ("Failed to generate embedding(s): <status>." for OpenAI and Gemini,
 * "...: HTTP <status>." for Ollama), so a number elsewhere is not a status.
 * Obsidian's requestUrl rejects with Chromium's net error name when nothing
 * listens on the server's port (Ollama not running).
 *
 * A status alone says less than it seems, so its sentence stays as wide as
 * the status: 401 is an authentication failure (a bad key, but also e.g. an
 * IP allowlist), 403 is any refused access (a region or project permission,
 * not only a key), 404 may be a wrong server URL as well as a missing model,
 * and 429 covers both a short rate limit and an exhausted quota or spending
 * cap, where waiting does not help. Only an explicit code or message in the
 * response body narrows it (API_KEY_INVALID, model_not_found,
 * rate_limit_exceeded, ...).
 */
export function describeSearchFailure(error: unknown): string | null {
    if (!(error instanceof Error)) return null;
    const message = error.message;

    const status = /^Failed to generate embeddings?: (?:HTTP )?(\d{3})\b/.exec(message)?.[1];
    if (status) {
        // Explicit invalid-key answers: Gemini's 400 API_KEY_INVALID, OpenAI's
        // invalid_api_key / "Incorrect API key provided".
        if (/API_KEY_INVALID|API key not valid|invalid_api_key|Incorrect API key/.test(message)) {
            return "the API key was rejected. Check it in settings.";
        }
        switch (status) {
            case "401":
                return "the provider couldn't authenticate the request. Check your API key in settings.";
            case "403":
                return "the provider refused access. Check your account's access settings with the provider.";
            case "404":
                // Ollama: model \"x\" not found (JSON-escaped); OpenAI: model_not_found;
                // Gemini: models/x is not found.
                if (/model_not_found|\bmodels?\b.*\bnot found|\bmodel\b.*\bdoes not exist/i.test(message)) {
                    return "the model wasn't found. Check the model name in settings.";
                }
                return "the model or API address wasn't found. Check the model name and server URL in settings.";
            case "429":
                // Short-lived limits: OpenAI's "Rate limit reached for
                // requests" and slow_down (its error-codes guide), and the
                // rate_limit_exceeded code its responses carry. Spend, credit
                // and usage limits, insufficient_quota and Gemini's
                // RESOURCE_EXHAUSTED may not clear by waiting.
                if (/rate_limit_exceeded|"slow_down"|Rate limit reached for requests/.test(message)) {
                    return "the provider's rate limit was reached. Wait a moment and try again.";
                }
                return "the provider's usage limit was reached. Check your plan and usage limits with the provider.";
        }
    }

    if (message.includes("ERR_CONNECTION_REFUSED")) {
        return "couldn't reach the model server. If you use Ollama, check that it's running.";
    }
    return null;
}

/**
 * Extract a user-friendly error message from the original error
 */
export function extractUserFriendlyMessage(
    errorMessage: string, 
    customPatterns: ErrorPattern[] = []
): string {
    const allPatterns = [
        ...customPatterns,
        ...GPU_ERROR_PATTERNS,
        ...NETWORK_ERROR_PATTERNS,
        ...OLLAMA_ERROR_PATTERNS,
        ...GEMINI_ERROR_PATTERNS
    ];

    // Check against known patterns
    for (const pattern of allPatterns) {
        for (const patternText of pattern.patterns) {
            if (errorMessage.includes(patternText)) {
                return pattern.message;
            }
        }
    }

    // Truncate very long error messages
    if (errorMessage.length > 100) {
        return errorMessage.substring(0, 100) + "...";
    }

    return errorMessage;
}

/**
 * Check if an error is GPU-related and can be retried with CPU
 */
export function isGPUError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    
    const errorMessage = error.message.toLowerCase();
    return GPU_ERROR_PATTERNS.some(pattern => 
        pattern.patterns.some(p => errorMessage.includes(p.toLowerCase()))
    );
}

/**
 * Handle embedding provider loading errors in a consistent way
 */
export function handleEmbeddingLoadError(
    error: unknown,
    config: ErrorHandlerConfig
): never {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";

    const userFriendlyMessage = extractUserFriendlyMessage(
        errorMessage,
        config.customPatterns
    );

    // Show notice to user
    new Notice(`${PLUGIN_NAME}: Failed to load ${config.providerName} model: ${userFriendlyMessage}`, 8000);

    // Emit error state
    config.errorSubject.next(userFriendlyMessage);

    throw error;
}

/**
 * Throttled notice manager for runtime errors
 */
class ThrottledNoticeManager {
    private lastNoticeTime = new Map<string, number>();
    private readonly DEFAULT_COOLDOWN = 60000; // 1 minute

    /**
     * Show a notice with throttling based on error key
     */
    showThrottled(
        errorKey: string,
        message: string,
        duration = 8000,
        cooldown = this.DEFAULT_COOLDOWN
    ): void {
        const now = Date.now();
        const lastTime = this.lastNoticeTime.get(errorKey) || 0;

        if (now - lastTime > cooldown) {
            new Notice(message, duration);
            this.lastNoticeTime.set(errorKey, now);
        }
    }

    /**
     * Reset throttle state for a specific error key or all
     */
    reset(errorKey?: string): void {
        if (errorKey) {
            this.lastNoticeTime.delete(errorKey);
        } else {
            this.lastNoticeTime.clear();
        }
    }
}

// Singleton instance
export const throttledNoticeManager = new ThrottledNoticeManager();

/**
 * Handle embedding runtime errors (during embedText/embedTexts calls)
 */
export function handleEmbeddingRuntimeError(
    error: unknown,
    config: ErrorHandlerConfig
): void {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";

    const userFriendlyMessage = extractUserFriendlyMessage(
        errorMessage,
        config.customPatterns
    );

    // Show throttled notice to user
    const errorKey = `${config.providerName}-runtime`;
    throttledNoticeManager.showThrottled(
        errorKey,
        `${PLUGIN_NAME}: ${config.providerName} error: ${userFriendlyMessage}`,
        8000
    );

    // Emit error state
    config.errorSubject.next(userFriendlyMessage);
}

/**
 * Extract note name from path
 */
function extractNoteName(notePath: string): string {
    const parts = notePath.split("/");
    return parts[parts.length - 1];
}

/**
 * Show a throttled error notice for note processing failures
 * Includes the note name for easy identification
 */
export function showNoteErrorNotice(notePath: string, error: unknown): void {
    const noteName = extractNoteName(notePath);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const userFriendlyMessage = extractUserFriendlyMessage(errorMessage);

    // Use note path as throttle key to avoid spam for same note
    throttledNoticeManager.showThrottled(
        `note-error:${notePath}`,
        `${PLUGIN_NAME}: Failed to process '${noteName}': ${userFriendlyMessage}`,
        8000
    );
}