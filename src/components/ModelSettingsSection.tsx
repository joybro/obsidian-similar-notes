import { HuggingFaceClient } from "@/adapter/huggingface";
import { OllamaClient } from "@/adapter/ollama";
import type { SettingsService } from "@/application/SettingsService";
import type { CachedModelInfo } from "@/application/SettingsService";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import { Notice, Setting } from "obsidian";
import type { App } from "obsidian";
import type MainPlugin from "../main";
import { LoadModelModal } from "./LoadModelModal";

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
    private tempModelProvider?: "builtin" | "ollama";
    private tempModelId?: string;
    private tempOllamaUrl?: string;
    private tempOllamaModel?: string;
    private tempUseGPU?: boolean;

    // Apply button reference for direct updates
    private applyButton?: any;

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

        new Setting(this.sectionContainer!).setName("Model").setHeading();

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

        new Setting(this.sectionContainer!)
            .setName("Current model")
            .setDesc(currentModelDesc);

        // Model Provider Selection
        new Setting(this.sectionContainer!)
            .setName("Model provider")
            .setDesc("Choose between built-in models or Ollama")
            .addDropdown((dropdown) => {
                dropdown
                    .addOption("builtin", "Built-in Models")
                    .addOption("ollama", "Ollama")
                    .setValue(this.tempModelProvider || "builtin")
                    .onChange((value: "builtin" | "ollama") => {
                        this.tempModelProvider = value;
                        // Redraw settings to show/hide provider-specific options
                        this.render();
                    });
            });

        // Provider-specific settings
        if (this.tempModelProvider === "builtin") {
            this.renderBuiltinModelSettings(settings);
        } else if (this.tempModelProvider === "ollama") {
            this.renderOllamaModelSettings(settings);
        }

        // Model Apply Button
        this.renderApplyButton(settings);
    }

    private renderBuiltinModelSettings(settings: any): void {
        const recommendedModels = [
            "sentence-transformers/all-MiniLM-L6-v2",
            "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        ];

        new Setting(this.sectionContainer!)
            .setName("Recommended models")
            .setDesc("Select from recommended embedding models")
            .addDropdown((dropdown) => {
                for (const model of recommendedModels) {
                    dropdown.addOption(model, model);
                }
                dropdown.setValue(this.tempModelId || settings.modelId);
                dropdown.onChange((value) => {
                    this.tempModelId = value;
                    this.render(); // Redraw to update Apply button state
                });
            });

        new Setting(this.sectionContainer!)
            .setName("Custom model")
            .setDesc("Enter a custom model ID from Hugging Face")
            .addText((text) => {
                text.setValue(this.tempModelId || "").onChange((value) => {
                    this.tempModelId = value;
                    // Don't redraw for text input to avoid losing focus
                    this.updateApplyButtonState(settings);
                });
            });

        new Setting(this.sectionContainer!)
            .setName("Use GPU acceleration")
            .setDesc(
                "If enabled, WebGPU will be used for model inference. Disable if you experience issues with GPU acceleration."
            )
            .addToggle((toggle) => {
                toggle
                    .setValue(this.tempUseGPU ?? settings.useGPU)
                    .onChange((value) => {
                        this.tempUseGPU = value;
                        // Delay redraw to allow toggle animation to complete
                        setTimeout(() => {
                            this.render(); // Redraw to update Apply button state
                        }, 150);
                    });
            });
    }

    private renderOllamaModelSettings(settings: any): void {
        const ollamaUrl =
            this.tempOllamaUrl ||
            settings.ollamaUrl ||
            "http://localhost:11434";
        const ollamaClient = new OllamaClient(ollamaUrl);

        // State for Ollama models
        let ollamaModels: string[] = [];
        let modelLoadError: string | null = null;

        // Function to fetch Ollama models
        const fetchOllamaModels = async () => {
            modelLoadError = null;

            try {
                ollamaModels = await ollamaClient.getModelNames();
            } catch (error) {
                modelLoadError =
                    error instanceof Error
                        ? error.message
                        : "Failed to fetch models";
                ollamaModels = [];
            }
        };

        new Setting(this.sectionContainer!)
            .setName("Ollama server URL")
            .setDesc(
                "URL of your Ollama server (default: http://localhost:11434)"
            )
            .addText((text) => {
                text.setPlaceholder("http://localhost:11434")
                    .setValue(ollamaUrl)
                    .onChange((value) => {
                        this.tempOllamaUrl = value;
                        // Update client URL and refresh the page
                        ollamaClient.setBaseUrl(value);
                        this.render();
                    });
            });

        // Create the model dropdown setting
        const modelSetting = new Setting(this.sectionContainer!)
            .setName("Ollama model")
            .setDesc("Select an Ollama model for embeddings");

        let dropdownComponent: any;
        modelSetting.addDropdown((dropdown) => {
            dropdownComponent = dropdown;
            dropdown.addOption("", "Loading models...");
            dropdown.setValue(this.tempOllamaModel || "");
            dropdown.onChange((value) => {
                this.tempOllamaModel = value;
                this.render(); // Redraw to update Apply button state
            });
        });

        // Add refresh button
        modelSetting.addButton((button) => {
            button
                .setButtonText("Refresh")
                .setTooltip("Refresh model list")
                .onClick(async () => {
                    await fetchOllamaModels();
                    this.render(); // Redraw to update dropdown
                });
        });

        // Fetch models on load
        fetchOllamaModels().then(() => {
            // Update dropdown with fetched models
            dropdownComponent.selectEl.empty();

            if (modelLoadError) {
                dropdownComponent.addOption("", `Error: ${modelLoadError}`);
            } else if (ollamaModels.length === 0) {
                dropdownComponent.addOption("", "No models found");
            } else {
                dropdownComponent.addOption("", "Select a model");
                ollamaModels.forEach((model) => {
                    dropdownComponent.addOption(model, model);
                });

                // Set current value if it exists in the list
                if (
                    this.tempOllamaModel &&
                    ollamaModels.includes(this.tempOllamaModel)
                ) {
                    dropdownComponent.setValue(this.tempOllamaModel);
                }
            }
        });

        // Test connection button
        new Setting(this.sectionContainer!)
            .setName("Test connection")
            .setDesc(
                "Test the connection to Ollama server and selected model"
            )
            .addButton((button) => {
                button.setButtonText("Test").onClick(async () => {
                    const model = this.tempOllamaModel;
                    if (!model) {
                        new Notice("Please select a model first");
                        return;
                    }

                    new Notice(
                        `Testing connection to ${ollamaUrl} with model ${model}...`
                    );

                    try {
                        const success = await ollamaClient.testModel(model);
                        if (success) {
                            new Notice(
                                "Connection successful! Model is ready for embeddings."
                            );
                        } else {
                            new Notice(
                                `Connection failed: Model test failed`
                            );
                        }
                    } catch (error) {
                        new Notice(`Connection failed: ${error}`);
                    }
                });
            });
    }

    private renderApplyButton(settings: any): void {
        const hasChanges = this.hasModelChanges(settings);
        const buttonText =
            this.tempModelProvider === "builtin"
                ? "Load & Apply"
                : "Apply Changes";
        const buttonDesc = hasChanges
            ? "Apply the selected model configuration. This will rebuild the similarity index."
            : "No changes to apply. Modify settings above to enable this button.";

        new Setting(this.sectionContainer!)
            .setName("Apply model changes")
            .setDesc(buttonDesc)
            .addButton((button) => {
                this.applyButton = button; // Store reference for updates
                button
                    .setButtonText(buttonText)
                    .setDisabled(!hasChanges)
                    .onClick(async () => {
                        if (hasChanges) {
                            await this.applyModelChanges(settings);
                        }
                    });

                if (hasChanges) {
                    button.setCta();
                }
            });
    }

    private hasModelChanges(settings: any): boolean {
        return (
            this.tempModelProvider !== settings.modelProvider ||
            (this.tempModelProvider === "builtin" &&
                this.tempModelId &&
                this.tempModelId !== settings.modelId) ||
            (this.tempModelProvider === "ollama" &&
                (this.tempOllamaUrl !== settings.ollamaUrl ||
                    this.tempOllamaModel !== settings.ollamaModel)) ||
            (this.tempModelProvider === "builtin" &&
                this.tempUseGPU !== settings.useGPU)
        );
    }

    private async applyModelChanges(settings: any): Promise<void> {
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
                () => {} // Cancel callback
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
                () => {} // Cancel callback
            ).open();
        }
    }

    private clearTempState(): void {
        this.tempModelProvider = undefined;
        this.tempModelId = undefined;
        this.tempOllamaUrl = undefined;
        this.tempOllamaModel = undefined;
        this.tempUseGPU = undefined;
    }

    private buildCurrentModelDescription(
        settings: any,
        cachedInfo?: CachedModelInfo
    ): string {
        const currentModelId =
            settings.modelProvider === "builtin"
                ? settings.modelId
                : settings.ollamaModel;

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

        return "Not configured";
    }

    private async fetchAndCacheModelInfo(
        provider: "builtin" | "ollama",
        modelId: string,
        ollamaUrl?: string
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
            const url = ollamaUrl || "http://localhost:11434";
            const client = new OllamaClient(url);
            const info = await client.getModelInfo(modelId);

            if (info) {
                return {
                    modelId,
                    parameterSize: info.parameterSize,
                    embeddingLength: info.embeddingLength,
                    quantizationLevel: info.quantizationLevel,
                };
            }
        }

        return undefined;
    }

    private updateApplyButtonState(settings: any): void {
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