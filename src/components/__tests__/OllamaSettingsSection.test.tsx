import { describe, it, expect, vi } from "vitest";
import { getOllamaSettingBuilders } from "../OllamaSettingsSection";
import type { SimilarNotesSettings } from "@/application/SettingsService";
import { OllamaClient } from "@/adapter/ollama";

const notices = vi.hoisted(() => [] as string[]);
vi.mock("obsidian", async (importOriginal) => {
    const actual = await importOriginal<typeof import("obsidian")>();
    class Notice {
        constructor(message: string) {
            notices.push(message);
        }
    }
    return { ...actual, Notice };
});

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
        props
    );
    const { setting, getTextOnChange } = makeFakeSetting();
    // builders[0] is the "Server URL" setting.
    result.builders[0].render(setting as never, undefined as never);

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

// A fake Setting that captures every handler the three Ollama rows register.
function makeFullFakeSetting() {
    const handlers: {
        text?: (value: string) => void;
        dropdown?: (value: string) => void;
        clicks: Array<() => Promise<void> | void>;
    } = { clicks: [] };
    const setting = {
        setName: () => setting,
        setDesc: () => setting,
        addText: (cb: (text: unknown) => void) => {
            const text = {
                setPlaceholder: () => text,
                setValue: () => text,
                onChange: (fn: (value: string) => void) => {
                    handlers.text = fn;
                    return text;
                },
            };
            cb(text);
            return setting;
        },
        addDropdown: (cb: (dropdown: unknown) => void) => {
            const dropdown = {
                addOption: () => dropdown,
                setValue: () => dropdown,
                onChange: (fn: (value: string) => void) => {
                    handlers.dropdown = fn;
                    return dropdown;
                },
            };
            cb(dropdown);
            return setting;
        },
        addButton: (cb: (button: unknown) => void) => {
            const button = {
                setButtonText: () => button,
                setTooltip: () => button,
                onClick: (fn: () => Promise<void> | void) => {
                    handlers.clicks.push(fn);
                    return button;
                },
            };
            cb(button);
            return setting;
        },
    };
    return { setting, handlers };
}

describe("Ollama Test connection uses the values currently in the form", () => {
    function build(tempOllamaModel: string | undefined) {
        const result = getOllamaSettingBuilders({
            settings: { ollamaUrl: "http://localhost:11434" } as SimilarNotesSettings,
            tempOllamaUrl: undefined,
            tempOllamaModel,
            onOllamaUrlChange: vi.fn(),
            onOllamaModelChange: vi.fn(),
            updateApplyButtonState: vi.fn(),
            onDropdownCreated: vi.fn(),
        });
        const { setting, handlers } = makeFullFakeSetting();
        result.builders.forEach((row) => row.render(setting as never, undefined as never));
        // Clicks: [Refresh, Test]
        return handlers;
    }

    it("tests the model picked in the dropdown after the section was rendered", async () => {
        notices.length = 0;
        const testModel = vi
            .spyOn(OllamaClient.prototype, "testModel")
            .mockResolvedValue(true);
        const handlers = build(undefined);

        handlers.dropdown?.("nomic-embed-text");
        await handlers.clicks[1]();

        expect(notices).not.toContain("Please select a model first");
        expect(testModel).toHaveBeenCalledWith("nomic-embed-text");
        testModel.mockRestore();
    });

    it("tests the newly picked model, not the one shown at render", async () => {
        notices.length = 0;
        const testModel = vi
            .spyOn(OllamaClient.prototype, "testModel")
            .mockResolvedValue(true);
        const handlers = build("old-model");

        handlers.dropdown?.("new-model");
        await handlers.clicks[1]();

        expect(testModel).toHaveBeenCalledWith("new-model");
        testModel.mockRestore();
    });

    it("names the URL typed after the section was rendered", async () => {
        notices.length = 0;
        const testModel = vi
            .spyOn(OllamaClient.prototype, "testModel")
            .mockResolvedValue(true);
        const handlers = build("nomic-embed-text");

        handlers.text?.("http://192.168.0.5:11434");
        await handlers.clicks[1]();

        expect(notices[0]).toContain("http://192.168.0.5:11434");
        testModel.mockRestore();
    });
});
