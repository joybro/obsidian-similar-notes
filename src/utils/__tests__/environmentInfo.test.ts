import { describe, expect, test } from "vitest";
import type { SimilarNotesSettings } from "@/application/SettingsService";
import {
    collectEnvironmentInfo,
    formatEnvironmentInfoAsMarkdown,
    type EnvironmentInfo,
    type SystemInfo,
} from "../environmentInfo";

function makeInfo(system: SystemInfo): EnvironmentInfo {
    return {
        platform: "Desktop (Linux)",
        obsidianVersion: "1.12.7",
        pluginVersion: "1.6.0",
        modelProvider: "builtin",
        modelId: "Built-in (sentence-transformers/all-MiniLM-L6-v2)",
        serverUrl: null,
        webGPU: false,
        codeMode: {
            enabled: false,
            modelProvider: null,
            modelId: null,
            serverUrl: null,
            webGPU: null,
        },
        system,
        chunkSettings: {
            includeFrontmatter: false,
            excludeFolderPatterns: [],
            excludeRegexPatternsCount: 0,
        },
    };
}

function makeSettings(overrides: Partial<SimilarNotesSettings>): SimilarNotesSettings {
    return {
        modelProvider: "builtin",
        modelId: "sentence-transformers/all-MiniLM-L6-v2",
        useGPU: false,
        includeFrontmatter: false,
        excludeFolderPatterns: [],
        excludeRegexPatterns: [],
        ...overrides,
    } as SimilarNotesSettings;
}

describe("formatEnvironmentInfoAsMarkdown: system info in bug reports", () => {
    test("renders CPU (with arch) and Memory when available (desktop)", () => {
        const md = formatEnvironmentInfoAsMarkdown(
            makeInfo({ totalMemoryGB: 16, cpuCores: 8, arch: "x64" })
        );
        expect(md).toContain("- **CPU**: 8 cores (x64)");
        expect(md).toContain("- **Memory**: 16 GB");
    });

    test("omits CPU and Memory lines when unavailable (e.g. mobile)", () => {
        const md = formatEnvironmentInfoAsMarkdown(
            makeInfo({ totalMemoryGB: null, cpuCores: null, arch: null })
        );
        expect(md).not.toContain("**CPU**");
        expect(md).not.toContain("**Memory**");
        // Other fields still present.
        expect(md).toContain("- **Platform**: Desktop (Linux)");
        expect(md).toContain("- **Plugin**: v1.6.0");
    });

    test("renders CPU without arch suffix when arch is null", () => {
        const md = formatEnvironmentInfoAsMarkdown(
            makeInfo({ totalMemoryGB: 32, cpuCores: 4, arch: null })
        );
        expect(md).toContain("- **CPU**: 4 cores");
        expect(md).not.toContain("4 cores (");
    });
});

describe("collectEnvironmentInfo: model line reflects the active provider (bug: OpenAI/Gemini reported as Built-in)", () => {
    test("builtin provider reports Built-in with the builtin model ID", () => {
        const info = collectEnvironmentInfo("1.12.7", "1.6.0", makeSettings({}));
        expect(info.modelId).toBe("Built-in (sentence-transformers/all-MiniLM-L6-v2)");
        expect(info.serverUrl).toBeNull();
    });

    test("openai provider reports OpenAI model, not the stale builtin model", () => {
        const info = collectEnvironmentInfo(
            "1.12.7",
            "1.6.0",
            makeSettings({
                modelProvider: "openai",
                openaiModel: "perplexity/pplx-embed-v1-0.6b",
                openaiUrl: "https://openrouter.ai/api/v1",
            })
        );
        expect(info.modelId).toBe("OpenAI (perplexity/pplx-embed-v1-0.6b)");
        expect(info.serverUrl).toBe("https://openrouter.ai/api/v1");
    });

    test("ollama provider reports Ollama model and server URL", () => {
        const info = collectEnvironmentInfo(
            "1.12.7",
            "1.6.0",
            makeSettings({
                modelProvider: "ollama",
                ollamaModel: "nomic-embed-text",
                ollamaUrl: "http://192.168.1.10:11434",
            })
        );
        expect(info.modelId).toBe("Ollama (nomic-embed-text)");
        expect(info.serverUrl).toBe("http://192.168.1.10:11434");
    });

    test("gemini provider reports Gemini model without a server URL", () => {
        const info = collectEnvironmentInfo(
            "1.12.7",
            "1.6.0",
            makeSettings({ modelProvider: "gemini", geminiModel: "gemini-embedding-001" })
        );
        expect(info.modelId).toBe("Gemini (gemini-embedding-001)");
        expect(info.serverUrl).toBeNull();
    });

    test("non-builtin provider without a configured model reports 'not configured'", () => {
        const info = collectEnvironmentInfo(
            "1.12.7",
            "1.6.0",
            makeSettings({ modelProvider: "openai" })
        );
        expect(info.modelId).toBe("OpenAI (not configured)");
    });
});

describe("formatEnvironmentInfoAsMarkdown: server URL line", () => {
    test("renders Server URL when present", () => {
        const info = makeInfo({ totalMemoryGB: null, cpuCores: null, arch: null });
        info.modelId = "OpenAI (perplexity/pplx-embed-v1-0.6b)";
        info.serverUrl = "https://openrouter.ai/api/v1";
        const md = formatEnvironmentInfoAsMarkdown(info);
        expect(md).toContain("- **Server URL**: https://openrouter.ai/api/v1");
    });

    test("omits Server URL line when null (builtin/gemini)", () => {
        const md = formatEnvironmentInfoAsMarkdown(
            makeInfo({ totalMemoryGB: null, cpuCores: null, arch: null })
        );
        expect(md).not.toContain("**Server URL**");
    });
});

describe("Code Mode diagnostics", () => {
    test("reports the Code profile without exposing its API key", () => {
        const info = collectEnvironmentInfo(
            "1.12.7",
            "1.6.0",
            makeSettings({
                codeModeEnabled: true,
                codeModel: {
                    modelProvider: "openai",
                    modelId: "unused",
                    openaiUrl: "https://code.example/v1",
                    openaiApiKey: "must-not-leak",
                    openaiModel: "code-embed",
                    useGPU: false,
                },
            })
        );
        const markdown = formatEnvironmentInfoAsMarkdown(info);

        expect(markdown).toContain("- **Code Mode**: Enabled");
        expect(markdown).toContain("- **Code Model**: OpenAI (code-embed)");
        expect(markdown).toContain(
            "- **Code Server URL**: https://code.example/v1"
        );
        expect(markdown).not.toContain("must-not-leak");
    });
});
