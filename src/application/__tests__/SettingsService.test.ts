import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => ({
    Platform: { isMobileApp: false },
}));

import { SettingsService } from "../SettingsService";
import { shouldExcludeFile } from "@/utils/folderExclusion";

describe("SettingsService defaults (spec item 4)", () => {
    it("defaults semanticLinkTrigger to ';;' when there is no saved data", async () => {
        const plugin = {
            loadData: vi.fn().mockResolvedValue(undefined),
            saveData: vi.fn().mockResolvedValue(undefined),
        };
        const svc = new SettingsService(plugin as never);
        await svc.load();
        expect(svc.get().semanticLinkTrigger).toBe(";;");
    });

    // Excalidraw notes are ~all binary drawing data (base64 compressed JSON),
    // which can't be embedded and isn't meaningful to index. New installs
    // exclude the default Excalidraw/ folder out of the box (#46).
    it("excludes the Excalidraw/ folder by default", async () => {
        const plugin = {
            loadData: vi.fn().mockResolvedValue(undefined),
            saveData: vi.fn().mockResolvedValue(undefined),
        };
        const svc = new SettingsService(plugin as never);
        await svc.load();
        const patterns = svc.get().excludeFolderPatterns;
        expect(
            shouldExcludeFile("Excalidraw/Monzo Web Crawler.md", patterns)
        ).toBe(true);
        // A normal note is still indexed.
        expect(shouldExcludeFile("Notes/Daily.md", patterns)).toBe(false);
    });
});
