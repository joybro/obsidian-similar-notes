import { describe, expect, test } from "vitest";
import { needsReindexForUpgrade } from "../versionUpgrade";

// Characterizes the existing reindex-on-upgrade rule extracted from MainPlugin.
// Reindex is required only to migrate the on-disk index into IndexedDB, which
// applies to fresh installs and upgrades from <= 0.10.0 (0.10.0 itself shipped
// with migration issues).
describe("needsReindexForUpgrade (IndexedDB migration trigger)", () => {
    test("fresh install (no recorded version) triggers reindex", () => {
        expect(needsReindexForUpgrade(undefined, "1.6.0")).toBe(true);
    });

    test("upgrade from exactly 0.10.0 triggers reindex (0.10.0 migration issues)", () => {
        expect(needsReindexForUpgrade("0.10.0", "1.6.0")).toBe(true);
    });

    test("upgrade from any 0.x below 0.10 triggers reindex", () => {
        expect(needsReindexForUpgrade("0.9.5", "1.6.0")).toBe(true);
        expect(needsReindexForUpgrade("0.1.0", "1.6.0")).toBe(true);
    });

    test("upgrade from 0.10.x where x > 0 does NOT reindex", () => {
        expect(needsReindexForUpgrade("0.10.1", "1.6.0")).toBe(false);
        expect(needsReindexForUpgrade("0.10.5", "1.6.0")).toBe(false);
    });

    test("upgrade from 0.11+ does NOT reindex", () => {
        expect(needsReindexForUpgrade("0.11.0", "1.6.0")).toBe(false);
    });

    test("upgrade from a 1.x version does NOT reindex", () => {
        expect(needsReindexForUpgrade("1.5.0", "1.6.0")).toBe(false);
    });
});
