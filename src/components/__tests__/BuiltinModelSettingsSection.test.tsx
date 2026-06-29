import { describe, it, expect, vi } from "vitest";
import type { SimilarNotesSettings } from "@/application/SettingsService";
import {
    getBuiltinModelSettingBuilders,
    type BuiltinModelSettingsSectionProps,
} from "../BuiltinModelSettingsSection";

// A fake Setting that captures the name/desc/class applied by each builder.
// (test-setup mocks "obsidian" down to TFile/PluginSettingTab, so we can't use
// the real Setting here — same pattern as OllamaSettingsSection.test.)
function makeFakeSetting() {
    const captured = { name: "", desc: "", classes: [] as string[] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setting: any = {
        setName: (v: string) => ((captured.name = v), setting),
        setDesc: (v: string) => ((captured.desc = v), setting),
        setClass: (c: string) => (captured.classes.push(c), setting),
        addDropdown: (cb: (d: unknown) => void) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const d: any = {
                addOption: () => d,
                setValue: () => d,
                onChange: () => d,
            };
            cb(d);
            return setting;
        },
        addText: (cb: (t: unknown) => void) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const t: any = {
                setValue: () => t,
                onChange: () => t,
                setPlaceholder: () => t,
            };
            cb(t);
            return setting;
        },
        addToggle: (cb: (t: unknown) => void) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const t: any = { setValue: () => t, onChange: () => t };
            cb(t);
            return setting;
        },
    };
    return { setting, captured };
}

function baseProps(
    isMobile: boolean
): BuiltinModelSettingsSectionProps {
    return {
        settings: {
            modelId: "sentence-transformers/all-MiniLM-L6-v2",
        } as SimilarNotesSettings,
        tempModelId: undefined,
        tempUseGPU: undefined,
        onModelIdChange: vi.fn(),
        onUseGPUChange: vi.fn(),
        onRender: vi.fn(),
        updateApplyButtonState: vi.fn(),
        isMobile,
    };
}

function capturedSettings(isMobile: boolean) {
    return getBuiltinModelSettingBuilders(baseProps(isMobile)).map((build) => {
        const { setting, captured } = makeFakeSetting();
        build(setting);
        return captured;
    });
}

function hasMobileBuiltinWarning(
    captured: Array<{ name: string; desc: string }>
): boolean {
    return captured.some(
        (c) => /mobile/i.test(c.name) && /(memory|crash|remote)/i.test(c.desc)
    );
}

describe("Built-in model settings — mobile crash guard (warn-only)", () => {
    it("shows a memory/crash warning steering to remote when on mobile", () => {
        expect(hasMobileBuiltinWarning(capturedSettings(true))).toBe(true);
    });

    it("does not show the warning on desktop", () => {
        expect(hasMobileBuiltinWarning(capturedSettings(false))).toBe(false);
    });
});
