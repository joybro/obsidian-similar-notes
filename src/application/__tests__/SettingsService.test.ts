import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => ({
    Platform: { isMobileApp: false },
}));

import { SettingsService } from "../SettingsService";

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
});
