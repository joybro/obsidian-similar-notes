import { describe, expect, test } from "vitest";
import { filterMarkdownFiles, shouldExcludeFile, isValidGlobPattern } from "../folderExclusion";
import type { TFile } from "obsidian";

// Helper to create mock TFile
const createMockFile = (path: string): TFile => ({
    path,
    name: path.split("/").pop() || "",
    extension: path.split(".").pop() || "",
    stat: { mtime: 0, ctime: 0, size: 0 },
    basename: "",
    parent: null,
    vault: null as unknown as TFile["vault"],
} as TFile);

describe("folderExclusion", () => {
    describe("shouldExcludeFile", () => {
        test("should exclude files matching simple folder pattern", () => {
            const patterns = ["Templates/"];
            
            expect(shouldExcludeFile("Templates/Daily.md", patterns)).toBe(true);
            expect(shouldExcludeFile("Templates/Weekly/Review.md", patterns)).toBe(true);
            expect(shouldExcludeFile("Notes/Daily.md", patterns)).toBe(false);
        });

        test("should exclude files matching wildcard patterns", () => {
            const patterns = ["*.tmp", "*.bak"];
            
            expect(shouldExcludeFile("file.tmp", patterns)).toBe(true);
            expect(shouldExcludeFile("backup.bak", patterns)).toBe(true);
            expect(shouldExcludeFile("note.md", patterns)).toBe(false);
        });

        test("should exclude files matching double wildcard patterns", () => {
            const patterns = ["**/drafts/*"];
            
            expect(shouldExcludeFile("drafts/note.md", patterns)).toBe(true);
            expect(shouldExcludeFile("Projects/drafts/idea.md", patterns)).toBe(true);
            expect(shouldExcludeFile("Projects/notes/idea.md", patterns)).toBe(false);
        });

        test("should handle multiple patterns", () => {
            const patterns = ["Templates/", "Archive/", "*.tmp"];
            
            expect(shouldExcludeFile("Templates/Daily.md", patterns)).toBe(true);
            expect(shouldExcludeFile("Archive/2023/note.md", patterns)).toBe(true);
            expect(shouldExcludeFile("temp.tmp", patterns)).toBe(true);
            expect(shouldExcludeFile("Notes/important.md", patterns)).toBe(false);
        });

        test("should handle empty patterns array", () => {
            expect(shouldExcludeFile("any/file.md", [])).toBe(false);
        });

        test("should handle question mark wildcard", () => {
            const patterns = ["note?.md"];
            
            expect(shouldExcludeFile("note1.md", patterns)).toBe(true);
            expect(shouldExcludeFile("noteA.md", patterns)).toBe(true);
            expect(shouldExcludeFile("note10.md", patterns)).toBe(false);
            expect(shouldExcludeFile("note.md", patterns)).toBe(false); // ? means exactly one char
            expect(shouldExcludeFile("notes.md", patterns)).toBe(true); // matches note + s
        });
    });

    describe("filterMarkdownFiles", () => {
        test("should filter files based on patterns", () => {
            const files = [
                createMockFile("Templates/Daily.md"),
                createMockFile("Archive/old.md"),
                createMockFile("Notes/important.md"),
                createMockFile("temp.tmp"),
            ];
            
            const patterns = ["Templates/", "Archive/", "*.tmp"];
            const filtered = filterMarkdownFiles(files, patterns);
            
            expect(filtered).toHaveLength(1);
            expect(filtered[0].path).toBe("Notes/important.md");
        });

        test("should return all files when no patterns", () => {
            const files = [
                createMockFile("file1.md"),
                createMockFile("file2.md"),
            ];
            
            const filtered = filterMarkdownFiles(files, []);
            expect(filtered).toHaveLength(2);
        });
    });

    describe("isValidGlobPattern", () => {
        test("should validate correct patterns", () => {
            expect(isValidGlobPattern("*.md")).toBe(true);
            expect(isValidGlobPattern("**/*.js")).toBe(true);
            expect(isValidGlobPattern("folder/")).toBe(true);
            expect(isValidGlobPattern("file?.txt")).toBe(true);
            expect(isValidGlobPattern("!important.md")).toBe(true);
        });

        test("should handle picomatch validation", () => {
            // picomatch is very permissive, most patterns are valid
            expect(isValidGlobPattern("*.md")).toBe(true);
            expect(isValidGlobPattern("[")).toBe(true); // Valid in picomatch
            expect(isValidGlobPattern("**a**")).toBe(true); // Valid in picomatch
            expect(isValidGlobPattern("[abc]")).toBe(true);
            expect(isValidGlobPattern("**/test/**")).toBe(true);
            
            // Testing if our validation function works correctly
            // (picomatch rarely throws errors, so it's hard to find invalid patterns)
        });
    });
});