import type { SettingsService } from "@/application/SettingsService";
import type { CachedModelInfo, SimilarNotesSettings } from "@/application/SettingsService";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import { Setting } from "obsidian";
import type { App, ButtonComponent } from "obsidian";
import type MainPlugin from "../main";
import {
    renderApplyButton,
    renderBuiltinModelSettings,
} from "./BuiltinModelSettingsSection";
import { LoadModelModal } from "./LoadModelModal";
import { fetchAndCacheModelInfo } from "./modelInfoCache";
import { renderOllamaSettings } from "./OllamaSettingsSection";
import { renderOpenAISettings } from "./OpenAISettingsSection";

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
    private currentDownloadProgress = 100;
    private currentModelError: string | null = null;
    private sectionContainer?: HTMLElement;

    // Temporary state for model changes (not saved until Apply is clicked)
    private tempModelProvider?: "builtin" | "ollama" | "openai";
    private tempModelId?: string;
    private tempOllamaUrl?: string;
    private tempOllamaModel?: string;
    private tempUseGPU?: boolean;
    private tempOpenaiUrl?: string;
    private tempOpenaiApiKey?: string;
    private tempOpenaiModel?: string;

    // Apply button reference for direct updates
    private applyButton?: ButtonComponent;

    constructor(private props: ModelSettingsSectionProps) {
        if (props.modelService) {
            this.setupModelService(props.modelService);
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

        const sectionContainer = this.sectionContainer;
        new Setting(sectionContainer).setName("Model").setHeading();

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

        new Setting(sectionContainer)
            .setName("Current model")
            .setDesc(currentModelDesc);

        // Model Provider Selection
        new Setting(sectionContainer)
            .setName("Model provider")
            .setDesc("Choose between built-in models, Ollama, or OpenAI API")
            .addDropdown((dropdown) => {
                dropdown
                    .addOption("builtin", "Built-in Models")
                    .addOption("ollama", "Ollama")
                    .addOption("openai", "OpenAI")
                    .setValue(this.tempModelProvider || "builtin")
                    .onChange((value: "builtin" | "ollama" | "openai") => {
                        this.tempModelProvider = value;
                        // Redraw settings to show/hide provider-specific options
                        this.render();
                    });
            });

        // Provider-specific settings
        if (this.tempModelProvider === "builtin") {
            this.renderBuiltinModelSettings(settings, sectionContainer);
        } else if (this.tempModelProvider === "ollama") {
            this.renderOllamaModelSettings(settings, sectionContainer);
        } else if (this.tempModelProvider === "openai") {
            this.renderOpenAIModelSettings(settings, sectionContainer);
        }

        // Model Apply Button
        this.renderApplyButton(settings, sectionContainer);
    }

    private renderBuiltinModelSettings(
        settings: SimilarNotesSettings,
        sectionContainer: HTMLElement
    ): void {
        renderBuiltinModelSettings({
            sectionContainer,
            settings,
            tempModelId: this.tempModelId,
            tempUseGPU: this.tempUseGPU,
            onModelIdChange: (value) => {
                this.tempModelId = value;
            },
            onUseGPUChange: (value) => {
                this.tempUseGPU = value;
            },
            onRender: () => this.render(),
            updateApplyButtonState: () => this.updateApplyButtonState(settings),
        });
    }

    private renderOllamaModelSettings(
        settings: SimilarNotesSettings,
        sectionContainer: HTMLElement
    ): void {
        renderOllamaSettings({
            sectionContainer,
            settings,
            tempOllamaUrl: this.tempOllamaUrl,
            tempOllamaModel: this.tempOllamaModel,
            onOllamaUrlChange: (value) => {
                this.tempOllamaUrl = value;
            },
            onOllamaModelChange: (value) => {
                this.tempOllamaModel = value;
            },
            onRender: () => this.render(),
        });
    }

    private renderOpenAIModelSettings(
        settings: SimilarNotesSettings,
        sectionContainer: HTMLElement
    ): void {
        renderOpenAISettings({
            sectionContainer,
            settings,
            tempOpenaiUrl: this.tempOpenaiUrl,
            tempOpenaiApiKey: this.tempOpenaiApiKey,
            tempOpenaiModel: this.tempOpenaiModel,
            onOpenaiUrlChange: (value) => {
                this.tempOpenaiUrl = value;
            },
            onOpenaiApiKeyChange: (value) => {
                this.tempOpenaiApiKey = value;
            },
            onOpenaiModelChange: (value) => {
                this.tempOpenaiModel = value;
            },
            onRender: () => this.render(),
        });
    }

    private renderApplyButton(
        settings: SimilarNotesSettings,
        sectionContainer: HTMLElement
    ): void {
        const hasChanges = this.hasModelChanges(settings);

        renderApplyButton({
            sectionContainer,
            hasChanges,
            tempModelProvider: this.tempModelProvider,
            onApply: () => this.applyModelChanges(settings),
            onButtonCreated: (button) => {
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
                    this.tempOpenaiModel !== settings.openaiModel))
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
                    updateData.openaiUrl = this.tempOpenaiUrl;
                    updateData.openaiApiKey = this.tempOpenaiApiKey;
                    updateData.openaiModel = this.tempOpenaiModel;
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
