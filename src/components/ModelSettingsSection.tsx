import type { SettingsService } from "@/application/SettingsService";
import type { SimilarNotesSettings } from "@/application/SettingsService";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import { Platform } from "obsidian";
import type { App, ButtonComponent } from "obsidian";
import type MainPlugin from "../main";
import {
    getApplyButtonBuilder,
    getBuiltinModelSettingBuilders,
} from "./BuiltinModelSettingsSection";
import { getGeminiSettingBuilders } from "./GeminiSettingsSection";
import { applyModelChanges } from "./modelChangesApplier";
import { buildCurrentModelDescription } from "./modelDescriptionBuilder";
import { getOllamaSettingBuilders } from "./OllamaSettingsSection";
import { getOpenAISettingBuilders } from "./OpenAISettingsSection";
import type { SettingRow, SettingRowGroup } from "./settingDefinitions";
import { UsageStatsSection } from "./UsageStatsSection";

interface ModelSettingsSectionProps {
    plugin: MainPlugin;
    settingsService: SettingsService;
    /** Read on each render: the service can be set after the tab is created. */
    readonly modelService?: EmbeddingService;
    app: App;
    /** Re-renders the whole settings tab (update() on 1.13+, display() before). */
    rerender: () => void;
}

export class ModelSettingsSection {
    private downloadProgressSubscription?: { unsubscribe: () => void };
    private modelErrorSubscription?: { unsubscribe: () => void };
    private settingsSubscription?: { unsubscribe: () => void };
    private currentDownloadProgress = 100;
    private currentModelError: string | null = null;
    private currentModelDescEl?: HTMLElement;
    private usageStatsSection: UsageStatsSection;

    // Temporary state for model changes (not saved until Apply is clicked)
    private tempModelProvider?: "builtin" | "ollama" | "openai" | "gemini";
    private tempModelId?: string;
    private tempOllamaUrl?: string;
    private tempOllamaModel?: string;
    private tempUseGPU?: boolean;
    private tempOpenaiUrl?: string;
    private tempOpenaiApiKey?: string;
    private tempOpenaiModel?: string;
    private tempOpenaiMaxTokens?: number;
    private tempGeminiApiKey?: string;
    private tempGeminiModel?: string;

    // Apply button reference for direct updates
    private applyButton?: ButtonComponent;

    constructor(private props: ModelSettingsSectionProps) {
        this.usageStatsSection = new UsageStatsSection({
            settingsService: props.settingsService,
            onRender: () => props.rerender(),
        });
        if (props.modelService) {
            this.setupModelService(props.modelService);
        }
        this.setupSettingsSubscription();
    }

    /**
     * Subscribe to settings changes to update usage stats in real-time
     */
    private setupSettingsSubscription(): void {
        const { settingsService } = this.props;

        this.settingsSubscription = settingsService
            .getNewSettingsObservable()
            .subscribe((changedSettings: Partial<SimilarNotesSettings>) => {
                // Only re-render usage stats section when usageStats changes
                if ("usageStats" in changedSettings) {
                    this.rerenderUsageStatsSection();
                }
            });
    }

    /**
     * Update only the usage stats without re-rendering the entire section
     */
    private rerenderUsageStatsSection(): void {
        const settings = this.props.settingsService.get();
        // Check if current provider supports usage tracking
        if (!this.props.modelService?.supportsUsageTracking()) return;

        const stats = settings.usageStats;
        if (stats) {
            this.usageStatsSection.updateStats(stats, settings.openaiPricePerMillionTokens);
        }
    }

    /**
     * Set the EmbeddingService and update subscriptions.
     */
    setupModelService(modelService: EmbeddingService): void {
        // Clean up existing subscriptions if any
        if (this.downloadProgressSubscription) {
            this.downloadProgressSubscription.unsubscribe();
        }
        if (this.modelErrorSubscription) {
            this.modelErrorSubscription.unsubscribe();
        }

        // Subscribe to download progress changes
        this.downloadProgressSubscription = modelService
            .getDownloadProgress$()
            .subscribe((progress) => {
                const previousProgress = this.currentDownloadProgress;
                this.currentDownloadProgress = progress;
                // Update the "Current model" text if progress changed
                if (previousProgress !== progress) {
                    this.refreshCurrentModel();
                }
            });

        // Subscribe to model error changes
        this.modelErrorSubscription = modelService
            .getModelError$()
            .subscribe((error) => {
                const previousError = this.currentModelError;
                this.currentModelError = error;
                // Update the "Current model" text if error changed
                if (previousError !== error) {
                    this.refreshCurrentModel();
                }
            });
    }

    /**
     * Clean up subscriptions
     */
    destroy(): void {
        if (this.downloadProgressSubscription) {
            this.downloadProgressSubscription.unsubscribe();
            this.downloadProgressSubscription = undefined;
        }
        if (this.modelErrorSubscription) {
            this.modelErrorSubscription.unsubscribe();
            this.modelErrorSubscription = undefined;
        }
        if (this.settingsSubscription) {
            this.settingsSubscription.unsubscribe();
            this.settingsSubscription = undefined;
        }
    }

    /**
     * The "Model" group (and the "API usage" group for providers that track
     * usage) as setting definitions (settings-search spec). Rebuilt on every
     * tab render; provider-specific rows stay in the list with `visible`, so
     * switching provider is a re-render, not a structure change of its own.
     */
    getDefinitionGroups(): SettingRowGroup[] {
        const { settingsService } = this.props;
        const settings = settingsService.get();

        // Initialize temporary state from current settings
        this.tempModelProvider = this.tempModelProvider ?? settings.modelProvider;
        this.tempModelId = this.tempModelId ?? settings.modelId;
        this.tempOllamaUrl = this.tempOllamaUrl ?? settings.ollamaUrl;
        this.tempOllamaModel = this.tempOllamaModel ?? settings.ollamaModel;
        this.tempUseGPU = this.tempUseGPU ?? settings.useGPU;
        this.tempOpenaiUrl = this.tempOpenaiUrl ?? settings.openaiUrl;
        this.tempOpenaiApiKey = this.tempOpenaiApiKey ?? settings.openaiApiKey;
        this.tempOpenaiModel = this.tempOpenaiModel ?? settings.openaiModel;
        this.tempOpenaiMaxTokens = this.tempOpenaiMaxTokens ?? settings.openaiMaxTokens;
        this.tempGeminiApiKey = this.tempGeminiApiKey ?? settings.geminiApiKey;
        this.tempGeminiModel = this.tempGeminiModel ?? settings.geminiModel;

        const modelItems: SettingRow[] = [
            {
                name: "Current model",
                render: (setting) => {
                    setting.setName("Current model").setDesc(this.currentModelDescription());
                    this.currentModelDescEl = setting.descEl;
                },
            },
            {
                name: "Model provider",
                // Provider rows are hidden unless their provider is selected,
                // so searching for them lands on this picker instead (spec rule 5).
                aliases: ["OpenAI", "OpenRouter", "Gemini", "Ollama", "API key", "Server URL"],
                render: (setting) => {
                    setting
                        .setName("Model provider")
                        .setDesc("Choose between built-in models, Ollama, OpenAI API, or Google Gemini")
                        .addDropdown((dropdown) => {
                            dropdown
                                .addOption("builtin", "Built-in Models")
                                .addOption("ollama", "Ollama")
                                .addOption("openai", "OpenAI / Compatible")
                                .addOption("gemini", "Google Gemini")
                                .setValue(this.tempModelProvider || "builtin")
                                .onChange((value: "builtin" | "ollama" | "openai" | "gemini") => {
                                    this.tempModelProvider = value;
                                    // Redraw settings to show/hide provider-specific options
                                    this.props.rerender();
                                });
                        });
                },
            },
            ...this.getProviderSettingRows(settings),
            this.getApplyButtonBuilder(settings),
        ];

        const groups: SettingRowGroup[] = [
            { type: "group", heading: "Model", items: modelItems },
        ];

        // Usage stats (only for providers that support usage tracking)
        if (this.props.modelService?.supportsUsageTracking()) {
            groups.push(this.usageStatsSection.getDefinitionGroup());
        }
        return groups;
    }

    /** "Current model" text: model info plus download progress or error. */
    private currentModelDescription(): string {
        const settings = this.props.settingsService.get();
        let currentModelDesc = buildCurrentModelDescription(settings, settings.cachedModelInfo);

        // Add download progress if downloading
        if (
            this.currentDownloadProgress < 100 &&
            settings.modelProvider === "builtin"
        ) {
            currentModelDesc += ` - Downloading: ${Math.floor(
                this.currentDownloadProgress
            )}%`;
        }

        // Add error status if there's an error
        if (this.currentModelError) {
            currentModelDesc += ` - Error: ${this.currentModelError}`;
        }
        return currentModelDesc;
    }

    /**
     * Download progress and model errors change only the "Current model" text:
     * update it in place, like the index statistics, instead of re-rendering.
     */
    private refreshCurrentModel(): void {
        this.currentModelDescEl?.setText(this.currentModelDescription());
    }

    private getProviderSettingRows(settings: SimilarNotesSettings): SettingRow[] {
        const onRender = () => this.props.rerender();
        const shownFor = (provider: NonNullable<typeof this.tempModelProvider>) =>
            (row: SettingRow): SettingRow => ({
                ...row,
                id: `${provider}:${row.name}`,
                visible: () => this.tempModelProvider === provider,
            });

        const builtin = getBuiltinModelSettingBuilders({
            settings,
            tempModelId: this.tempModelId,
            tempUseGPU: this.tempUseGPU,
            onModelIdChange: (value: string) => {
                this.tempModelId = value;
            },
            onUseGPUChange: (value: boolean) => {
                this.tempUseGPU = value;
            },
            onRender,
            updateApplyButtonState: () => this.updateApplyButtonState(settings),
            isMobile: Platform.isMobileApp,
        }).map(shownFor("builtin"));

        const ollama = this.getOllamaRows(settings).map(shownFor("ollama"));
        const openai = this.getOpenAIRows(settings, onRender).map(shownFor("openai"));

        const gemini = getGeminiSettingBuilders({
            settings,
            tempGeminiApiKey: this.tempGeminiApiKey,
            tempGeminiModel: this.tempGeminiModel,
            onGeminiApiKeyChange: (value: string) => {
                this.tempGeminiApiKey = value;
            },
            onGeminiModelChange: (value: string) => {
                this.tempGeminiModel = value;
            },
            onRender,
            getTempValues: () => ({
                apiKey: this.tempGeminiApiKey,
                model: this.tempGeminiModel,
            }),
        }).map(shownFor("gemini"));

        return [...builtin, ...ollama, ...openai, ...gemini];
    }

    /** Ollama rows; the first row fetches the model list once it renders. */
    private getOllamaRows(settings: SimilarNotesSettings): SettingRow[] {
        const ollamaResult = getOllamaSettingBuilders({
            settings,
            tempOllamaUrl: this.tempOllamaUrl,
            tempOllamaModel: this.tempOllamaModel,
            onOllamaUrlChange: (value: string) => {
                this.tempOllamaUrl = value;
            },
            onOllamaModelChange: (value: string) => {
                this.tempOllamaModel = value;
            },
            updateApplyButtonState: () => this.updateApplyButtonState(settings),
            onDropdownCreated: () => {
                // Dropdown reference handled internally
            },
        });
        const ollama = [...ollamaResult.builders];
        // Fetch models after the Ollama rows render (only when they are shown,
        // not when definitions are built for search indexing).
        if (ollama.length > 0) {
            const first = ollama[0];
            ollama[0] = {
                ...first,
                render: (setting, group) => {
                    first.render(setting, group);
                    window.setTimeout(() => void ollamaResult.fetchModels(), 0);
                },
            };
        }
        return ollama;
    }

    private getOpenAIRows(
        settings: SimilarNotesSettings,
        onRender: () => void
    ): SettingRow[] {
        return getOpenAISettingBuilders({
            settings,
            tempOpenaiUrl: this.tempOpenaiUrl,
            tempOpenaiApiKey: this.tempOpenaiApiKey,
            tempOpenaiModel: this.tempOpenaiModel,
            tempOpenaiMaxTokens: this.tempOpenaiMaxTokens,
            onOpenaiUrlChange: (value: string) => {
                this.tempOpenaiUrl = value;
            },
            onOpenaiApiKeyChange: (value: string) => {
                this.tempOpenaiApiKey = value;
            },
            onOpenaiModelChange: (value: string) => {
                this.tempOpenaiModel = value;
            },
            onOpenaiMaxTokensChange: (value: number | undefined) => {
                this.tempOpenaiMaxTokens = value;
            },
            onRender,
            getTempValues: () => ({
                url: this.tempOpenaiUrl,
                apiKey: this.tempOpenaiApiKey,
                model: this.tempOpenaiModel,
                maxTokens: this.tempOpenaiMaxTokens,
            }),
        });
    }

    private getApplyButtonBuilder(settings: SimilarNotesSettings): SettingRow {
        const hasChanges = this.hasModelChanges(settings);

        return getApplyButtonBuilder({
            hasChanges,
            tempModelProvider: this.tempModelProvider,
            onApply: async () => {
                await applyModelChanges({
                    plugin: this.props.plugin,
                    settingsService: this.props.settingsService,
                    app: this.props.app,
                    settings,
                    tempModelProvider: this.tempModelProvider,
                    tempModelId: this.tempModelId,
                    tempOllamaUrl: this.tempOllamaUrl,
                    tempOllamaModel: this.tempOllamaModel,
                    tempUseGPU: this.tempUseGPU,
                    tempOpenaiUrl: this.tempOpenaiUrl,
                    tempOpenaiApiKey: this.tempOpenaiApiKey,
                    tempOpenaiModel: this.tempOpenaiModel,
                    tempOpenaiMaxTokens: this.tempOpenaiMaxTokens,
                    tempGeminiApiKey: this.tempGeminiApiKey,
                    tempGeminiModel: this.tempGeminiModel,
                    onComplete: () => {
                        this.clearTempState();
                        this.props.rerender();
                    },
                });
            },
            onButtonCreated: (button: ButtonComponent) => {
                this.applyButton = button;
            },
        });
    }


    private hasModelChanges(settings: SimilarNotesSettings): boolean {
        return (
            this.tempModelProvider !== settings.modelProvider ||
            (this.tempModelProvider === "builtin" &&
                this.tempModelId !== undefined &&
                this.tempModelId !== settings.modelId) ||
            (this.tempModelProvider === "ollama" &&
                (this.tempOllamaUrl !== settings.ollamaUrl ||
                    this.tempOllamaModel !== settings.ollamaModel)) ||
            (this.tempModelProvider === "builtin" &&
                this.tempUseGPU !== settings.useGPU) ||
            (this.tempModelProvider === "openai" &&
                (this.tempOpenaiUrl !== settings.openaiUrl ||
                    this.tempOpenaiApiKey !== settings.openaiApiKey ||
                    this.tempOpenaiModel !== settings.openaiModel ||
                    this.tempOpenaiMaxTokens !== settings.openaiMaxTokens)) ||
            (this.tempModelProvider === "gemini" &&
                (this.tempGeminiApiKey !== settings.geminiApiKey ||
                    this.tempGeminiModel !== settings.geminiModel))
        );
    }


    private clearTempState(): void {
        this.tempModelProvider = undefined;
        this.tempModelId = undefined;
        this.tempOllamaUrl = undefined;
        this.tempOllamaModel = undefined;
        this.tempUseGPU = undefined;
        this.tempOpenaiUrl = undefined;
        this.tempOpenaiApiKey = undefined;
        this.tempOpenaiModel = undefined;
        this.tempOpenaiMaxTokens = undefined;
        this.tempGeminiApiKey = undefined;
        this.tempGeminiModel = undefined;
    }


    private updateApplyButtonState(settings: SimilarNotesSettings): void {
        if (!this.applyButton) return;

        const hasChanges = this.hasModelChanges(settings);
        const buttonText =
            this.tempModelProvider === "builtin"
                ? "Load & Apply"
                : "Apply Changes";

        this.applyButton.setButtonText(buttonText).setDisabled(!hasChanges);

        // Update CTA styling
        if (hasChanges) {
            this.applyButton.setCta();
        } else {
            this.applyButton.removeCta();
        }
    }
}
