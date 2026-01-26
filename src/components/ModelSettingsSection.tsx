import { HuggingFaceClient } from "@/adapter/huggingface";
import { OllamaClient } from "@/adapter/ollama";
import type { SettingsService } from "@/application/SettingsService";
import type {
    CachedModelInfo,
    SimilarNotesSettings,
} from "@/application/SettingsService";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import { Setting } from "obsidian";
import type { App, ButtonComponent } from "obsidian";
import type MainPlugin from "../main";
import {
    renderApplyButton,
    renderBuiltinModelSettings,
} from "./BuiltinModelSettingsSection";
import { LoadModelModal } from "./LoadModelModal";
import { renderOllamaSettings } from "./OllamaSettingsSection";
import { renderOpenAISettings } from "./OpenAISettingsSection";
import { OpenAIClient } from "@/adapter/openai";

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
    private tempOpenAIUrl?: string;
    private tempOpenAIModel?: string;
    private tempOpenAIApiKey?: string;
    private tempUseGPU?: boolean;

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
        this.tempOpenAIUrl = this.tempOpenAIUrl ?? settings.openaiUrl;
        this.tempOpenAIModel = this.tempOpenAIModel ?? settings.openaiModel;
        this.tempOpenAIApiKey = this.tempOpenAIApiKey ?? settings.openaiApiKey;
        this.tempUseGPU = this.tempUseGPU ?? settings.useGPU;

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
            .setDesc("Choose between built-in models or Ollama")
            .addDropdown((dropdown) => {
                dropdown
                    .addOption("builtin", "Built-in Models")
                    .addOption("ollama", "Ollama")
                    .addOption("openai", "OpenAI Compatible")
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
            tempOpenAIUrl: this.tempOpenAIUrl,
            tempOpenAIModel: this.tempOpenAIModel,
            tempOpenAIApiKey: this.tempOpenAIApiKey,
            onOpenAIUrlChange: (value) => {
                this.tempOpenAIUrl = value;
            },
            onOpenAIModelChange: (value) => {
                this.tempOpenAIModel = value;
            },
            onOpenAIApiKeyChange: (value) => {
                this.tempOpenAIApiKey = value;
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
            (this.tempModelProvider === "openai" &&
                (this.tempOpenAIUrl !== settings.openaiUrl ||
                    this.tempOpenAIModel !== settings.openaiModel || 
                    this.tempOpenAIApiKey !== settings.openaiApiKey)) ||
            (this.tempModelProvider === "builtin" &&
                this.tempUseGPU !== settings.useGPU)
        );
    }

    private async applyModelChanges(settings: SimilarNotesSettings): Promise<void> {
        const { plugin, settingsService, app } = this.props;

        if (this.tempModelProvider === "builtin") {
            // Built-in model - use LoadModelModal
            const modelId = this.tempModelId || settings.modelId;
            const builtinMessage =
                "The model will be downloaded from Hugging Face (this might take a while) and all your notes will be reindexed. Do you want to continue?";

            new LoadModelModal(
                app,
                builtinMessage,
                async () => {
                    // Fetch model info from Hugging Face API
                    const cachedModelInfo = await this.fetchAndCacheModelInfo(
                        "builtin",
                        modelId
                    );

                    await settingsService.update({
                        modelProvider: this.tempModelProvider,
                        modelId: modelId,
                        useGPU: this.tempUseGPU ?? settings.useGPU,
                        cachedModelInfo,
                    });
                    plugin.changeModel(modelId);
                    // Clear temporary state after successful apply
                    this.clearTempState();
                    this.render();
                },
                // Cancel callback - no action needed
                Function.prototype as () => void
            ).open();
        } else if (this.tempModelProvider === "ollama") {
            // Ollama model - show confirmation modal
            const ollamaMessage =
                "Your embedding model will be changed and all notes will be reindexed. Do you want to continue?";

            new LoadModelModal(
                app,
                ollamaMessage,
                async () => {
                    // Fetch model info from Ollama API
                    const cachedModelInfo = await this.fetchAndCacheModelInfo(
                        "ollama",
                        this.tempOllamaModel || "",
                        this.tempOllamaUrl
                    );

                    await settingsService.update({
                        modelProvider: this.tempModelProvider,
                        ollamaUrl: this.tempOllamaUrl,
                        ollamaModel: this.tempOllamaModel,
                        cachedModelInfo,
                    });
                    // Trigger model change with new settings
                    plugin.changeModel(this.tempOllamaModel || "");
                    // Clear temporary state after successful apply
                    this.clearTempState();
                    this.render();
                },
                Function.prototype as () => void
            ).open();
        } else if (this.tempModelProvider === "openai") {
             // OpenAI model - show confirmation modal
            const openaiMessage =
                "Your embedding model will be changed and all notes will be reindexed. Do you want to continue?";

            new LoadModelModal(
                app,
                openaiMessage,
                async () => {
                    // Fetch model info from OpenAI API
                    const cachedModelInfo = await this.fetchAndCacheModelInfo(
                        "openai",
                        this.tempOpenAIModel || "",
                        this.tempOpenAIUrl,
                        this.tempOpenAIApiKey
                    );

                    await settingsService.update({
                        modelProvider: this.tempModelProvider,
                        openaiUrl: this.tempOpenAIUrl,
                        openaiModel: this.tempOpenAIModel,
                        openaiApiKey: this.tempOpenAIApiKey,
                        cachedModelInfo,
                    });
                    // Trigger model change with new settings
                    plugin.changeModel(this.tempOpenAIModel || "");
                    // Clear temporary state after successful apply
                    this.clearTempState();
                    this.render();
                },
                // Cancel callback - no action needed
                Function.prototype as () => void
            ).open();
        }
    }

    private clearTempState(): void {
        this.tempModelProvider = undefined;
        this.tempModelId = undefined;
        this.tempOllamaUrl = undefined;
        this.tempOllamaModel = undefined;
        this.tempOpenAIUrl = undefined;
        this.tempOpenAIModel = undefined;
        this.tempOpenAIApiKey = undefined;
        this.tempUseGPU = undefined;
    }

    private buildCurrentModelDescription(
        settings: SimilarNotesSettings,
        cachedInfo?: CachedModelInfo
    ): string {
        const currentModelId =
            settings.modelProvider === "builtin"
                ? settings.modelId
                : settings.modelProvider === "ollama"
                ? settings.ollamaModel
                : settings.openaiModel;

        // Check if cached info matches current model
        const hasValidCache =
            cachedInfo && cachedInfo.modelId === currentModelId;

        if (settings.modelProvider === "builtin") {
            const parts: string[] = [];

            if (hasValidCache) {
                if (cachedInfo.parameterSize) {
                    parts.push(cachedInfo.parameterSize);
                }
                if (cachedInfo.embeddingLength) {
                    parts.push(`${cachedInfo.embeddingLength}-dim`);
                }
            }

            // Add GPU/CPU status
            parts.push(settings.useGPU ? "GPU" : "CPU");

            return `Built-in: ${settings.modelId} (${parts.join(", ")})`;
        }

        if (settings.modelProvider === "ollama") {
            if (!settings.ollamaModel) {
                return "Not configured";
            }

            const parts: string[] = [];

            if (hasValidCache) {
                if (cachedInfo.parameterSize) {
                    parts.push(cachedInfo.parameterSize);
                }
                if (cachedInfo.quantizationLevel) {
                    parts.push(cachedInfo.quantizationLevel);
                }
                if (cachedInfo.embeddingLength) {
                    parts.push(`${cachedInfo.embeddingLength}-dim`);
                }
            }

            if (parts.length > 0) {
                return `Ollama: ${settings.ollamaModel} (${parts.join(", ")})`;
            }
            return `Ollama: ${settings.ollamaModel}`;
        }

        if (settings.modelProvider === "openai") {
             if (!settings.openaiModel) {
                return "Not configured";
            }
             const parts: string[] = [];

            if (hasValidCache) {
                if (cachedInfo.parameterSize) {
                    parts.push(cachedInfo.parameterSize);
                }
                 if (cachedInfo.embeddingLength) {
                    parts.push(`${cachedInfo.embeddingLength}-dim`);
                }
            }
             if (parts.length > 0) {
                return `OpenAI: ${settings.openaiModel} (${parts.join(", ")})`;
            }
             return `OpenAI: ${settings.openaiModel}`;
        }

        return "Not configured";
    }

    private async fetchAndCacheModelInfo(
        provider: "builtin" | "ollama" | "openai",
        modelId: string,
        url?: string,
        apiKey?: string
    ): Promise<CachedModelInfo | undefined> {
        if (provider === "builtin") {
            const client = new HuggingFaceClient();
            const info = await client.getModelInfo(modelId);

            if (info) {
                return {
                    modelId,
                    parameterCount: info.parameterCount,
                    parameterSize: info.parameterSize,
                };
            }
        } else if (provider === "ollama") {
            const client = new OllamaClient(url || "http://localhost:11434");
            const info = await client.getModelInfo(modelId);

            if (info) {
                return {
                    modelId,
                    parameterSize: info.parameterSize,
                    embeddingLength: info.embeddingLength,
                    quantizationLevel: info.quantizationLevel,
                };
            }
        } else if (provider === "openai") {
             const client = new OpenAIClient(url || "http://localhost:1234/v1", apiKey);
             try {
                const embedding = await client.generateEmbedding(modelId, "test");
                return {
                     modelId,
                     embeddingLength: embedding.length
                };
             } catch (e) {
                 return { modelId };
             }
        }

        return undefined;
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
