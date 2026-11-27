import { describe, expect, test } from "vitest";
import {
    describeSearchFailure,
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

    test("a fetch that cannot reach the server on iOS/iPadOS (WebKit) is a network error", () => {
        // WebKit rejects a failed fetch with TypeError "Load failed", which
        // contains neither "network" nor "fetch".
        expect(isNetworkError(new TypeError("Load failed"))).toBe(true);
        // The worker's error crosses into the plugin as a plain Error that
        // keeps the message and name.
        expect(
            isNetworkError(Object.assign(new Error("Load failed"), { name: "TypeError" }))
        ).toBe(true);
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

describe("describeSearchFailure", () => {
    // The exact messages our adapters throw: OpenAI and Gemini put the status
    // right after the colon, Ollama writes "HTTP <status>".
    const KEY = "the API key was rejected. Check it in settings.";
    const AUTH = "the provider couldn't authenticate the request. Check your API key in settings.";
    const ACCESS = "the provider refused access. Check your account's access settings with the provider.";
    const USAGE = "the provider's usage limit was reached. Check your plan and usage limits with the provider.";
    const RATE = "the provider's rate limit was reached. Wait a moment and try again.";
    const MODEL = "the model wasn't found. Check the model name in settings.";
    const MODEL_OR_URL = "the model or API address wasn't found. Check the model name and server URL in settings.";

    test.each([
        // Explicit invalid-key answers keep the key sentence.
        ["Failed to generate embedding: 401. {\"error\":{\"message\":\"Incorrect API key provided: sk-abc\",\"code\":\"invalid_api_key\"}}", KEY],
        ["Failed to generate embedding: 400. {\"error\":{\"message\":\"API key not valid. Please pass a valid API key.\",\"status\":\"INVALID_ARGUMENT\",\"details\":[{\"reason\":\"API_KEY_INVALID\"}]}}", KEY],
        // A bare 401 is an authentication failure, not necessarily the key.
        ["Failed to generate embedding: 401. {\"error\":{\"message\":\"Your IP is not authorized to make requests for this organization.\"}}", AUTH],
        // 403 is refused access (region, permission), never "key rejected".
        ["Failed to generate embedding: 403. {\"error\":{\"code\":\"unsupported_country_region_territory\",\"message\":\"Country, region, or territory not supported\"}}", ACCESS],
        ["Failed to generate embedding: 403. PERMISSION_DENIED", ACCESS],
        // 429 without a rate-limit code may be a quota: no "wait and retry".
        ["Failed to generate embedding: 429. {\"error\":{\"code\":\"insufficient_quota\",\"message\":\"You exceeded your current quota, please check your plan and billing details.\"}}", USAGE],
        ["Failed to generate embedding: 429. {\"error\":{\"status\":\"RESOURCE_EXHAUSTED\"}}", USAGE],
        ["Failed to generate embedding: 429. {\"error\":{\"code\":\"rate_limit_exceeded\",\"message\":\"Rate limit reached for requests\"}}", RATE],
        // 404 names the model only when the body says the model is missing.
        ["Failed to generate embedding: HTTP 404. {\"error\":\"model \\\"nomic-embed-text\\\" not found, try pulling it first\"}", MODEL],
        ["Failed to generate embeddings: 404. {\"error\":{\"code\":\"model_not_found\",\"message\":\"The model `text-embedding-4` does not exist\"}}", MODEL],
        ["Failed to generate embedding: 404. {\"error\":{\"code\":404,\"message\":\"models/embedding-002 is not found for API version v1beta\",\"status\":\"NOT_FOUND\"}}", MODEL],
        ["Failed to generate embedding: 404. 404 page not found", MODEL_OR_URL],
        ["net::ERR_CONNECTION_REFUSED", "couldn't reach the model server. If you use Ollama, check that it's running."],
    ])("%s", (message, expected) => {
        expect(describeSearchFailure(new Error(message))).toBe(expected);
    });

    test.each([
        "Failed to generate embedding: 500. internal error",
        "Failed to generate embedding: 400. {\"error\":{\"message\":\"Request payload size exceeds the limit\"}}",
        "Invalid embedding response from OpenAI: missing data array",
        "something unexpected",
        // A status-like number elsewhere in the text is not a status.
        "Invalid embedding response: expected 401 values",
    ])("unknown cause stays unnamed: %s", (message) => {
        expect(describeSearchFailure(new Error(message))).toBeNull();
    });

    test("a non-Error value is unknown", () => {
        expect(describeSearchFailure("Failed to generate embedding: 401.")).toBeNull();
        expect(describeSearchFailure(undefined)).toBeNull();
    });
});
