import { describe, expect, test } from "vitest";
import { normalizeWasmError } from "../wasmError";

describe("normalizeWasmError: bare-number WASM aborts become readable Errors", () => {
    test("a thrown number (onnxruntime-web abort pointer) becomes an Error", () => {
        const result = normalizeWasmError(8934496);
        expect(result).toBeInstanceOf(Error);
        // The raw pointer is preserved for correlation...
        expect(result.message).toContain("8934496");
        // ...alongside an actionable hint, not just the number.
        expect(result.message.toLowerCase()).toContain("wasm");
        expect(result.message).toMatch(/GPU|Ollama/);
    });

    test("an existing Error is passed through unchanged", () => {
        const original = new Error("Model not loaded");
        expect(normalizeWasmError(original)).toBe(original);
    });

    test("a non-number, non-Error value is stringified into an Error", () => {
        const result = normalizeWasmError("boom");
        expect(result).toBeInstanceOf(Error);
        expect(result.message).toBe("boom");
    });
});
