import "@testing-library/jest-dom";
import { TextEncoder } from "node:util";

// The "obsidian" module itself is mocked via the resolve alias in
// vitest.config.ts pointing at src/__mocks__/obsidian.ts — see that file.

// Add TextEncoder to the global scope
// node:util's TextEncoder returns Uint8Array<ArrayBufferLike>; TS 5.7+ DOM lib expects ArrayBuffer
global.TextEncoder = TextEncoder as unknown as typeof global.TextEncoder;
