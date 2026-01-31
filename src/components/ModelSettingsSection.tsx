import type { SettingsService } from "@/application/SettingsService";
import type { CachedModelInfo, SimilarNotesSettings } from "@/application/SettingsService";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import { SettingGroup } from "obsidian";
import type { App, ButtonComponent } from "obsidian";
import type MainPlugin from "../main";
import {
    getApplyButtonBuilder,
    getBuiltinModelSettingBuilders,
} from "./BuiltinModelSettingsSection";
import { LoadModelModal } from "./LoadModelModal";
import { fetchAndCacheModelInfo } from "./modelInfoCache";
import { getOllamaSettingBuilders } from "./OllamaSettingsSection";
import { getOpenAISettingBuilders, type SettingBuilder } from "./OpenAISettingsSection";
import { renderUsageStatsSection } from "./UsageStatsSection";

interface ModelSettingsSectionProps {
    containerEl: HTMLElement;
    plugin: MainPlugin;
    settingsService: SettingsService;
    modelService?: EmbeddingService;
    app: App;
}

export class ModelSettingsSection {
    private downloadProgressSubscription?: { unsubscribe: () => void };
    private modelErrorSubscription?: { unsubscribe: () => void };
    private settingsSubscription?: { unsubscribe: () => void };
    private currentDownloadProgress = 100;
    private currentModelError: string | null = null;
    private sectionContainer?: HTMLElement;
    private usageStatsSectionContainer?: HTMLElement;

    // Temporary state for model changes (not saved until Apply is clicked)
    private tempModelProvider?: "builtin" | "ollama" | "openai";
    private tempModelId?: string;
    private tempOllamaUrl?: string;
    private tempOllamaModel?: string;
    private tempUseGPU?: boolean;
    private tempOpenaiUrl?: string;
    private tempOpenaiApiKey?: string;
    private tempOpenaiModel?: string;
    private tempOpenaiMaxTokens?: number;

    // Apply button reference for direct updates
    private applyButton?: ButtonComponent;

    constructor(private props: ModelSettingsSectionProps) {
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
                if ("usageStats" in changedSettings && this.usageStatsSectionContainer) {
                    this.rerenderUsageStatsSection();
                }
            });
    }

    /**
     * Re-render only the usage stats section without affecting other parts
     */
    private rerenderUsageStatsSection(): void {
        if (!this.usageStatsSectionContainer) return;

        const settings = this.props.settingsService.get();
        if (settings.modelProvider !== "openai") return;

        this.usageStatsSectionContainer.empty();
        renderUsageStatsSection({
            sectionContainer: this.usageStatsSectionContainer,
            settings,
            settingsService: this.props.settingsService,
            onRender: () => this.render(),
        });
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
                // Redraw the settings if progress changed
                if (previousProgress !== progress) {
                    this.render();
                }
            });

        // Subscribe to model error changes
        this.modelErrorSubscription = modelService
            .getModelError$()
            .subscribe((error) => {
                const previousError = this.currentModelError;
                this.currentModelError = error;
                // Redraw the settings if error changed
                if (previousError !== error) {
                    this.render();
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
     * Render the model settings section
     */
    render(): void {
        const { containerEl, settingsService } = this.props;
        const settings = settingsService.get();

        // Create or clear the section container
        // Check if sectionContainer exists and is still connected to the DOM
        if (!this.sectionContainer || !this.sectionContainer.parentElement) {
            this.sectionContainer = containerEl.createDiv("model-settings-section");
        } else {
            this.sectionContainer.empty();
        }

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

        const sectionContainer = this.sectionContainer;

        // Current model display - use cached model info from settings
        const cachedInfo = settings.cachedModelInfo;
        let currentModelDesc = this.buildCurrentModelDescription(settings, cachedInfo);

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

        // Build the unified settings group
        const settingGroup = new SettingGroup(sectionContainer)
            .setHeading("Model")
            .addSetting((setting) => {
                setting.setName("Current model").setDesc(currentModelDesc);
            })
            .addSetting((setting) => {
                setting
                    .setName("Model provider")
                    .setDesc("Choose between built-in models, Ollama, or OpenAI API")
                    .addDropdown((dropdown) => {
                        dropdown
                            .addOption("builtin", "Built-in Models")
                            .addOption("ollama", "Ollama")
                            .addOption("openai", "OpenAI / Compatible")
                            .setValue(this.tempModelProvider || "builtin")
                            .onChange((value: "builtin" | "ollama" | "openai") => {
                                this.tempModelProvider = value;
                                // Redraw settings to show/hide provider-specific options
                                this.render();
                            });
                    });
            });

        // Get provider-specific setting builders
        const providerBuilders = this.getProviderSettingBuilders(settings);
        providerBuilders.forEach(builder => settingGroup.addSetting(builder));

        // Get apply button builder
        const applyButtonBuilder = this.getApplyButtonBuilder(settings);
        settingGroup.addSetting(applyButtonBuilder);

        // Usage stats section (only for OpenAI provider when currently active)
        // First, remove existing usage stats container if it exists
        if (this.usageStatsSectionContainer) {
            this.usageStatsSectionContainer.remove();
            this.usageStatsSectionContainer = undefined;
        }

        if (settings.modelProvider === "openai") {
            // Create and insert usage stats container right after model section
            // Using insertAdjacentElement to ensure proper positioning
            this.usageStatsSectionContainer = document.createElement("div");
            this.usageStatsSectionContainer.addClass("usage-stats-section");
            sectionContainer.insertAdjacentElement("afterend", this.usageStatsSectionContainer);
            this.renderUsageStatsSection(settings, this.usageStatsSectionContainer);
        }
    }

    private getProviderSettingBuilders(settings: SimilarNotesSettings): SettingBuilder[] {
        if (this.tempModelProvider === "builtin") {
            return getBuiltinModelSettingBuilders({
                settings,
                tempModelId: this.tempModelId,
                tempUseGPU: this.tempUseGPU,
                onModelIdChange: (value: string) => {
                    this.tempModelId = value;
                },
                onUseGPUChange: (value: boolean) => {
                    this.tempUseGPU = value;
                },
                onRender: () => this.render(),
                updateApplyButtonState: () => this.updateApplyButtonState(settings),
            });
        } else if (this.tempModelProvider === "ollama") {
            const result = getOllamaSettingBuilders({
                settings,
                tempOllamaUrl: this.tempOllamaUrl,
                tempOllamaModel: this.tempOllamaModel,
                onOllamaUrlChange: (value: string) => {
                    this.tempOllamaUrl = value;
                },
                onOllamaModelChange: (value: string) => {
                    this.tempOllamaModel = value;
                },
                onRender: () => this.render(),
                onDropdownCreated: () => {
                    // Dropdown reference handled internally
                },
            });
            // Fetch models after render
            setTimeout(() => result.fetchModels(), 0);
            return result.builders;
        } else if (this.tempModelProvider === "openai") {
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
                onRender: () => this.render(),
                getTempValues: () => ({
                    url: this.tempOpenaiUrl,
                    apiKey: this.tempOpenaiApiKey,
                    model: this.tempOpenaiModel,
                    maxTokens: this.tempOpenaiMaxTokens,
                }),
            });
        }
        return [];
    }

    private getApplyButtonBuilder(settings: SimilarNotesSettings): SettingBuilder {
        const hasChanges = this.hasModelChanges(settings);

        return getApplyButtonBuilder({
            hasChanges,
            tempModelProvider: this.tempModelProvider,
            onApply: () => this.applyModelChanges(settings),
            onButtonCreated: (button: ButtonComponent) => {
                this.applyButton = button;
            },
        });
    }

    private renderUsageStatsSection(
        settings: SimilarNotesSettings,
        container: HTMLElement
    ): void {
        renderUsageStatsSection({
            sectionContainer: container,
            settings,
            settingsService: this.props.settingsService,
            onRender: () => this.render(),
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
                    this.tempOpenaiMaxTokens !== settings.openaiMaxTokens))
        );
    }

    private async applyModelChanges(settings: SimilarNotesSettings): Promise<void> {
        const { plugin, settingsService, app } = this.props;
        const provider = this.tempModelProvider;

        if (!provider) return;

        // Determine message and model ID based on provider
        const isBuiltin = provider === "builtin";
        const message = isBuiltin
            ? "The model will be downloaded from Hugging Face (this might take a while) and all your notes will be reindexed. Do you want to continue?"
            : "Your embedding model will be changed and all notes will be reindexed. Do you want to continue?";

        const getModelId = () => {
            if (provider === "builtin") return this.tempModelId || settings.modelId;
            if (provider === "ollama") return this.tempOllamaModel || "";
            return this.tempOpenaiModel || "text-embedding-3-small";
        };

        new LoadModelModal(
            app,
            message,
            async () => {
                const modelId = getModelId();
                const cachedModelInfo = await fetchAndCacheModelInfo(
                    provider,
                    modelId,
                    provider === "ollama" ? this.tempOllamaUrl : undefined
                );

                const updateData: Partial<SimilarNotesSettings> = {
                    modelProvider: provider,
                    cachedModelInfo,
                };

                if (provider === "builtin") {
                    updateData.modelId = modelId;
                    updateData.useGPU = this.tempUseGPU ?? settings.useGPU;
                } else if (provider === "ollama") {
                    updateData.ollamaUrl = this.tempOllamaUrl;
                    updateData.ollamaModel = this.tempOllamaModel;
                } else if (provider === "openai") {
                    updateData.openaiUrl = this.tempOpenaiUrl ?? settings.openaiUrl;
                    updateData.openaiApiKey = this.tempOpenaiApiKey ?? settings.openaiApiKey;
                    updateData.openaiModel = this.tempOpenaiModel ?? "text-embedding-3-small";
                    updateData.openaiMaxTokens = this.tempOpenaiMaxTokens ?? settings.openaiMaxTokens;
                }

                await settingsService.update(updateData);
                plugin.changeModel(modelId);
                this.clearTempState();
                this.render();
            },
            Function.prototype as () => void
        ).open();
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
    }

    private buildCurrentModelDescription(
        settings: SimilarNotesSettings,
        cachedInfo?: CachedModelInfo
    ): string {
        const { modelProvider } = settings;
        const modelId =
            modelProvider === "builtin" ? settings.modelId
                : modelProvider === "ollama" ? settings.ollamaModel
                    : settings.openaiModel;

        if (!modelId && modelProvider !== "builtin") {
            return modelProvider === "openai" ? "OpenAI: Not configured" : "Not configured";
        }

        const hasValidCache = cachedInfo && cachedInfo.modelId === modelId;
        const parts: string[] = [];

        if (hasValidCache) {
            if (cachedInfo.parameterSize) parts.push(cachedInfo.parameterSize);
            if (cachedInfo.quantizationLevel) parts.push(cachedInfo.quantizationLevel);
            if (cachedInfo.embeddingLength) parts.push(`${cachedInfo.embeddingLength}-dim`);
        }

        if (modelProvider === "builtin") {
            parts.push(settings.useGPU ? "GPU" : "CPU");
            return `Built-in: ${modelId} (${parts.join(", ")})`;
        }

        const prefix = modelProvider === "ollama" ? "Ollama" : "OpenAI";
        return parts.length > 0 ? `${prefix}: ${modelId} (${parts.join(", ")})` : `${prefix}: ${modelId}`;
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
