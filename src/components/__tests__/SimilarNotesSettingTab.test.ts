import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApiState, Setting, type SettingDefinitionGroup, type SettingDefinitionRender } from "obsidian";
import type { SettingsService, SimilarNotesSettings } from "@/application/SettingsService";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import type MainPlugin from "../../main";
import { SimilarNotesSettingTab } from "../SimilarNotesSettingTab";

type Provider = SimilarNotesSettings["modelProvider"];

function makeSettings(provider: Provider): SimilarNotesSettings {
    return {
        modelProvider: provider,
        modelId: "sentence-transformers/all-MiniLM-L6-v2",
        ollamaUrl: "http://localhost:11434",
        ollamaModel: "nomic-embed-text",
        openaiUrl: "https://api.openai.com/v1",
        openaiApiKey: "",
        openaiModel: "text-embedding-3-small",
        geminiApiKey: "",
        geminiModel: "gemini-embedding-001",
        includeFrontmatter: false,
        showSourceChunk: false,
        useGPU: true,
        excludeFolderPatterns: [],
        excludeRegexPatterns: [],
        excludeFrontmatterRules: [],
        regexpTestInputText: "",
        noteDisplayMode: "smart",
        showAtBottom: true,
        sidebarResultCount: 10,
        bottomResultCount: 5,
        minSimilarityThreshold: 0,
        indexingDelaySeconds: 1,
        semanticLinkTrigger: ";;",
    };
}

function makeTab(provider: Provider) {
    const settings = makeSettings(provider);
    const settingsService = {
        get: () => settings,
        update: vi.fn(async () => undefined),
        getNewSettingsObservable: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }),
    } as unknown as SettingsService;
    const app = {
        vault: { getMarkdownFiles: () => [], getFileByPath: () => null },
        metadataCache: { getFileCache: () => null },
    };
    const plugin = {
        app,
        manifest: { version: "0.0.0-test" },
        setLogLevel: vi.fn(),
        reindexNotes: vi.fn(),
        retryErroredNotes: vi.fn(),
    } as unknown as MainPlugin;
    const tab = new SimilarNotesSettingTab(plugin, settingsService);
    const usageTracking = provider === "openai" || provider === "gemini";
    const modelService = {
        getDownloadProgress$: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }),
        getModelError$: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }),
        supportsUsageTracking: () => usageTracking,
    } as unknown as EmbeddingService;
    tab.setModelService(modelService);
    document.body.appendChild(tab.containerEl);
    return tab;
}

/** Reads "heading -> setting names" from the rendered tab, in DOM order. */
function readGroups(containerEl: HTMLElement): [string, string[]][] {
    return Array.from(containerEl.querySelectorAll(".setting-group")).map((group) => [
        group.querySelector(".setting-group-heading")?.textContent ?? "",
        Array.from(group.querySelectorAll(".setting-item-name")).map((el) => el.textContent ?? ""),
    ]);
}

// Baseline captured from display() BEFORE the getSettingDefinitions change. The declarative refactor must render exactly these rows, in order.
const COMMON_TAIL: [string, string[]][] = [
    ["Index", ["Index statistics", "Indexing delay", "Include frontmatter in indexing and search", "Reindex notes", "", "Retry errored notes"]],
    ["Exclude files from index", ["Path patterns", "Frontmatter properties", "", "Apply exclusion rules"]],
    ["Exclude content from index", ["Content patterns", ""]],
    ["Display", ["Show similar notes at the bottom of notes", "Note display mode", "Semantic link trigger", "Show source chunk in results", "Show link button on results", "Number of results in sidebar", "Number of results at bottom", "Minimum similarity"]],
    ["Debug and support", ["Log level", "Copy environment info", "Report a bug"]],
];

const API_USAGE: [string, string[]] = ["API usage", ["Token usage", "Price per 1M tokens", "Reset statistics"]];

const BASELINE: Record<Provider, [string, string[]][]> = {
    builtin: [["Model", ["Current model", "Model provider", "Recommended models", "Custom model", "Use GPU acceleration", "Apply model changes"]]],
    ollama: [["Model", ["Current model", "Model provider", "Server URL", "Model", "Test connection", "Apply model changes"]]],
    openai: [["Model", ["Current model", "Model provider", "Server URL", "API key", "Model", "Test connection", "Apply model changes"]], API_USAGE],
    gemini: [["Model", ["Current model", "Model provider", "API key", "Model", "Test connection", "Apply model changes"]], API_USAGE],
};

describe("SimilarNotesSettingTab display()", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mockApiState.version = "1.12.0";
    });
    afterEach(() => {
        vi.useRealTimers();
        document.body.replaceChildren();
    });

    for (const provider of ["builtin", "ollama", "openai", "gemini"] as Provider[]) {
        it(`renders the same groups and rows as before for ${provider}`, () => {
            const tab = makeTab(provider);
            tab.display();
            expect(readGroups(tab.containerEl)).toEqual([...BASELINE[provider], ...COMMON_TAIL]);
        });
    }
});

function isVisible(v: boolean | (() => boolean) | undefined): boolean {
    return v === undefined ? true : typeof v === "function" ? v() : v;
}

describe("SimilarNotesSettingTab getSettingDefinitions() (Obsidian 1.13+)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mockApiState.version = "1.13.0";
    });
    afterEach(() => {
        vi.useRealTimers();
        mockApiState.version = "1.12.0";
        document.body.replaceChildren();
    });

    function definitions(provider: Provider) {
        return makeTab(provider).getSettingDefinitions() as (SettingDefinitionGroup & {
            items: SettingDefinitionRender[];
        })[];
    }

    it("returns nothing below 1.13 so older apps use display()", () => {
        mockApiState.version = "1.12.0";
        expect(makeTab("builtin").getSettingDefinitions()).toEqual([]);
    });

    for (const provider of ["builtin", "ollama", "openai", "gemini"] as Provider[]) {
        it(`covers every row display() renders, in order, for ${provider}`, () => {
            const visibleGroups = definitions(provider)
                .filter((g) => isVisible(g.visible))
                .map((g): [string, string[]] => [
                    g.heading ?? "",
                    g.items.filter((item) => isVisible(item.visible)).map((item) => item.name),
                ]);
            expect(visibleGroups).toEqual([...BASELINE[provider], ...COMMON_TAIL]);
        });

        it(`each definition's name is the name its builder sets (${provider})`, () => {
            const container = document.createElement("div");
            for (const group of definitions(provider)) {
                // Hidden provider rows too: they become visible on a switch.
                for (const item of group.items) {
                    const setting = new Setting(container);
                    item.render(setting, undefined as never);
                    expect(setting.nameEl.textContent ?? "").toBe(item.name);
                }
            }
        });
    }

    it("keeps provider-specific rows out of search unless their provider is selected", () => {
        const model = definitions("builtin")[0];
        const visibleNames = model.items.filter((i) => isVisible(i.visible)).map((i) => i.name);
        expect(visibleNames).not.toContain("API key");
        expect(visibleNames).not.toContain("Server URL");
        // ...but all providers' rows are defined, ready for a provider switch.
        expect(model.items.map((i) => i.name)).toEqual(
            expect.arrayContaining(["Server URL", "API key", "Test connection"])
        );
    });

    it("lets a search for a provider or its fields land on the Model provider row", () => {
        const provider = definitions("builtin")[0].items.find((i) => i.name === "Model provider");
        expect(provider?.aliases).toEqual(
            expect.arrayContaining(["OpenAI", "OpenRouter", "Gemini", "Ollama", "API key", "Server URL"])
        );
    });

    it("lets the words users wrote in exclusion requests (#14, #42) find the exclusion rows", () => {
        // Group headings are not searched by Obsidian (Obsidian 1.15.1: "exclude"
        // and "Exclude files from index" find no Similar Notes row), so the rows
        // carry the users' words as aliases.
        const rows = definitions("builtin").flatMap((g) => g.items);
        const aliasesOf = (name: string) => rows.find((i) => i.name === name)?.aliases;
        expect(aliasesOf("Path patterns")).toEqual(["Exclude folders", "Exclude files"]);
        expect(aliasesOf("Frontmatter properties")).toEqual(["Exclude by property", "YAML"]);
        expect(aliasesOf("Content patterns")).toEqual(["Exclude content"]);
    });

    it("gives every row in a group a distinct render key (spec rule 7)", () => {
        // Obsidian 1.15.1 keys a render row by id, else name, and logs
        // 'duplicate setting key' when two rows in one list share it.
        for (const group of definitions("builtin")) {
            const keys = group.items.filter((i) => i.name !== "").map((i) => i.id ?? i.name);
            expect(new Set(keys).size, group.heading).toBe(keys.length);
        }
    });

    it("re-renders through update() on 1.13+ and display() below (spec rule 4)", () => {
        const tab = makeTab("builtin");
        const rerender = () => (tab as unknown as { rerender: () => void }).rerender();
        const display = vi.spyOn(tab, "display");
        rerender();
        expect((tab as unknown as { updateCalls: number }).updateCalls).toBe(1);
        expect(display).not.toHaveBeenCalled();
        mockApiState.version = "1.12.0";
        rerender();
        expect(display).toHaveBeenCalledTimes(1);
    });

    it("unnamed rows (previews, regex tester) are not searchable", () => {
        const unnamed = definitions("builtin").flatMap((g) => g.items).filter((i) => i.name === "");
        expect(unnamed.length).toBe(3);
        for (const item of unnamed) expect(item.searchable).toBe(false);
    });
});
