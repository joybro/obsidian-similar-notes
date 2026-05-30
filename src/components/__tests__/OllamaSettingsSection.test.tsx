import { describe, it, expect, vi } from "vitest";
import { getOllamaSettingBuilders } from "../OllamaSettingsSection";
import type { SimilarNotesSettings } from "@/application/SettingsService";

// A fake Setting that captures the onChange handler registered on its text input.
function makeFakeSetting() {
    let textOnChange: ((value: string) => void) | undefined;

    const setting = {
        setName: () => setting,
        setDesc: () => setting,
        addText: (cb: (text: unknown) => void) => {
            const text = {
                setPlaceholder: () => text,
                setValue: () => text,
                onChange: (fn: (value: string) => void) => {
                    textOnChange = fn;
                    return text;
                },
            };
            cb(text);
            return setting;
        },
    };

    return { setting, getTextOnChange: () => textOnChange };
}

function buildUrlOnChange(overrides: {
    onOllamaUrlChange?: ReturnType<typeof vi.fn>;
    updateApplyButtonState?: ReturnType<typeof vi.fn>;
    onRender?: ReturnType<typeof vi.fn>;
}) {
    const props = {
        settings: { ollamaUrl: "http://localhost:11434" } as SimilarNotesSettings,
        tempOllamaUrl: undefined,
        tempOllamaModel: undefined,
        onOllamaUrlChange: overrides.onOllamaUrlChange ?? vi.fn(),
        onOllamaModelChange: vi.fn(),
        updateApplyButtonState: overrides.updateApplyButtonState ?? vi.fn(),
        onDropdownCreated: vi.fn(),
        // onRender is passed only so the test can assert it is NOT invoked on a
        // keystroke. It is no longer part of the props contract after the fix.
        onRender: overrides.onRender ?? vi.fn(),
    };

    const result = getOllamaSettingBuilders(
        props as unknown as Parameters<typeof getOllamaSettingBuilders>[0]
    );
    const { setting, getTextOnChange } = makeFakeSetting();
    // builders[0] is the "Server URL" setting.
    result.builders[0](setting as never);

    const onChange = getTextOnChange();
    expect(onChange).toBeDefined();
    return onChange as (value: string) => void;
}

describe("Ollama URL input (issue #43 — can only edit URL one character at a time)", () => {
    it("does NOT trigger a full section re-render while typing", () => {
        const onRender = vi.fn();
        const onChange = buildUrlOnChange({ onRender });

        onChange("h");

        // Re-rendering the whole section is what rebuilt the input element and
        // stole focus after each keystroke. It must not happen on typing.
        expect(onRender).not.toHaveBeenCalled();
    });

    it("updates temp URL state and refreshes the apply button on each keystroke", () => {
        const onOllamaUrlChange = vi.fn();
        const updateApplyButtonState = vi.fn();
        const onChange = buildUrlOnChange({ onOllamaUrlChange, updateApplyButtonState });

        onChange("http://localhost:1143");

        expect(onOllamaUrlChange).toHaveBeenCalledWith("http://localhost:1143");
        expect(updateApplyButtonState).toHaveBeenCalled();
    });
});
