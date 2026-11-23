import { describe, expect, test } from "vitest";
import {
    extractUserFriendlyMessage,
    isNetworkError,
    TRANSFORMERS_ERROR_PATTERNS,
} from "../errorHandling";

describe("extractUserFriendlyMessage", () => {
    describe("#38: Custom transformers model without ONNX weights", () => {
        // The exact error format thrown by @huggingface/transformers when a 404
        // is returned for a model file fetch (see node_modules/.../utils/hub.js
        // ERROR_MAPPING[404]).
        const ONNX_404_ERROR =
            'Could not locate file: "https://huggingface.co/ibm-granite/granite-embedding-small-english-r2/resolve/main/onnx/model.onnx".';

        test("returns ONNX-specific guidance when the missing file is an ONNX weight", () => {
            const result = extractUserFriendlyMessage(
                ONNX_404_ERROR,
                TRANSFORMERS_ERROR_PATTERNS
            );

            expect(result.toLowerCase()).toContain("onnx");
            expect(result).not.toBe(
                "Network error - check your internet connection"
            );
        });

        test("also matches when the same failure surfaces as a wrapped 'Failed to fetch' with the ONNX URL", () => {
            // Some failure paths (browser-level fetch errors, comlink wrapping)
            // may surface the underlying 404 as a generic fetch failure that
            // still embeds the .onnx URL. We want both forms to map to the
            // same ONNX-specific message rather than the generic network one.
            const wrappedError =
                "TypeError: Failed to fetch https://huggingface.co/foo/bar/resolve/main/onnx/model_quantized.onnx";

            const result = extractUserFriendlyMessage(
                wrappedError,
                TRANSFORMERS_ERROR_PATTERNS
            );

            expect(result.toLowerCase()).toContain("onnx");
        });

        test("a genuine network failure with no ONNX URL still maps to the network message", () => {
            const result = extractUserFriendlyMessage(
                "NetworkError when attempting to fetch resource",
                TRANSFORMERS_ERROR_PATTERNS
            );

            expect(result).toBe(
                "Network error - check your internet connection"
            );
        });
    });
});

describe("isNetworkError", () => {
    test("a fetch that cannot reach the server is a network error", () => {
        expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
        expect(isNetworkError(new Error("net::ERR_INTERNET_DISCONNECTED network"))).toBe(true);
    });

    test("an HTTP error from the model host is not a network error", () => {
        // The texts @huggingface/transformers throws for a missing or private
        // model (utils/hub.js ERROR_MAPPING); the URL must not match either.
        expect(
            isNetworkError(
                new Error(
                    'Unauthorized access to file: "https://huggingface.co/no-such/model/resolve/main/config.json".'
                )
            )
        ).toBe(false);
        expect(
            isNetworkError(
                new Error(
                    'Could not locate file: "https://huggingface.co/a/b/resolve/main/onnx/model.onnx".'
                )
            )
        ).toBe(false);
    });
});
