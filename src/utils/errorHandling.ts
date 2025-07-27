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