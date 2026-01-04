import { Platform } from "obsidian";
import type { SimilarNotesSettings } from "@/application/SettingsService";

export interface EnvironmentInfo {
    platform: string;
    obsidianVersion: string;
    pluginVersion: string;
    modelProvider: string;
    modelId: string;
    webGPU: boolean;
    chunkSettings: {
        includeFrontmatter: boolean;
        excludeFolderPatterns: string[];
        excludeRegexPatternsCount: number;
    };
}

function getPlatformString(): string {
    if (Platform.isMobileApp) {
        if (Platform.isIosApp) {
            return "Mobile (iOS)";
        }
        if (Platform.isAndroidApp) {
            return "Mobile (Android)";
        }
        return "Mobile";
    }

    if (Platform.isDesktopApp) {
        if (Platform.isMacOS) {
            return "Desktop (macOS)";
        }
        if (Platform.isWin) {
            return "Desktop (Windows)";
        }
        if (Platform.isLinux) {
            return "Desktop (Linux)";
        }
        return "Desktop";
    }

    return "Unknown";
}

function getModelDisplayName(settings: SimilarNotesSettings): string {
    if (settings.modelProvider === "ollama") {
        return `Ollama (${settings.ollamaModel || "not configured"})`;
    }
    return `Built-in (${settings.modelId})`;
}

export function collectEnvironmentInfo(
    obsidianVersion: string,
    pluginVersion: string,
    settings: SimilarNotesSettings
): EnvironmentInfo {
    return {
        platform: getPlatformString(),
        obsidianVersion,
        pluginVersion,
        modelProvider: settings.modelProvider,
        modelId: getModelDisplayName(settings),
        webGPU: settings.useGPU,
        chunkSettings: {
            includeFrontmatter: settings.includeFrontmatter,
            excludeFolderPatterns: settings.excludeFolderPatterns,
            excludeRegexPatternsCount: settings.excludeRegexPatterns.length,
        },
    };
}

export function formatEnvironmentInfoAsMarkdown(info: EnvironmentInfo): string {
    const lines = [
        "### Environment",
        `- **Platform**: ${info.platform}`,
        `- **Obsidian**: v${info.obsidianVersion}`,
        `- **Plugin**: v${info.pluginVersion}`,
        "",
        "### Settings",
        `- **Model**: ${info.modelId}`,
        `- **WebGPU**: ${info.webGPU ? "Enabled" : "Disabled"}`,
        `- **Include Frontmatter**: ${info.chunkSettings.includeFrontmatter ? "Yes" : "No"}`,
    ];

    return lines.join("\n");
}
