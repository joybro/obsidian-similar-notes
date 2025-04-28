import type { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FilepathChunkIndexStore } from "../FilepathChunkIndexStore";

// Mock adapter
const mockRead = vi.fn();
const mockWrite = vi.fn();
const mockAdapter = { read: mockRead, write: mockWrite };

// Mock vault
const mockVault = { adapter: mockAdapter };

// Use the local mock for the mockApp, but cast to the real App type for the constructor
// This is necessary because the implementation expects the real App type from 'obsidian',
// but our mock only implements the minimal interface needed for testing.
const mockApp = { vault: mockVault } as unknown as App;

describe("FilepathChunkIndexStore", () => {
    const storagePath = "test-index.json";
    let store: FilepathChunkIndexStore;

    beforeEach(() => {
        vi.clearAllMocks();
        store = new FilepathChunkIndexStore(mockApp, storagePath);
    });

    it("should add and retrieve chunk IDs for a filepath", () => {
        store.addMapping("file.md", "chunk1");
        store.addMapping("file.md", "chunk2");
        expect(store.getChunkIds("file.md")).toEqual(["chunk1", "chunk2"]);
    });

    it("should return an empty array for unknown filepaths", () => {
        expect(store.getChunkIds("unknown.md")).toEqual([]);
    });

    it("should remove a filepath and its chunk IDs", () => {
        store.addMapping("file.md", "chunk1");
        store.remove("file.md");
        expect(store.getChunkIds("file.md")).toEqual([]);
    });

    it("should load index from storage", async () => {
        // Prepare mock read to return a serialized map
        mockRead.mockResolvedValueOnce(
            JSON.stringify([["file.md", ["chunk1", "chunk2"]]])
        );
        await store.load();
        expect(store.getChunkIds("file.md")).toEqual(["chunk1", "chunk2"]);
        expect(mockRead).toHaveBeenCalledWith(storagePath);
    });

    it("should save index to storage", async () => {
        store.addMapping("file.md", "chunk1");
        await store.save();
        expect(mockWrite).toHaveBeenCalledWith(
            storagePath,
            JSON.stringify([["file.md", ["chunk1"]]])
        );
    });
});
