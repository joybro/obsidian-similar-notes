import { Notice } from "obsidian";
import { Subject } from "rxjs";

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
        patterns: ["network", "fetch"],
        message: "Network error - check your internet connection"
    }
];

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
        ...OLLAMA_ERROR_PATTERNS
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
    new Notice(`Failed to load ${config.providerName} model: ${userFriendlyMessage}`, 8000);

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
        `${config.providerName} error: ${userFriendlyMessage}`,
        8000
    );

    // Emit error state
    config.errorSubject.next(userFriendlyMessage);
}