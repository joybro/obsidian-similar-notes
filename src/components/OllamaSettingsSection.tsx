import { OllamaClient, type OllamaModelWithEmbeddingInfo } from "@/adapter/ollama";
import type { SimilarNotesSettings } from "@/application/SettingsService";
import { Notice } from "obsidian";
import type { DropdownComponent } from "obsidian";
import type { SettingBuilder } from "./OpenAISettingsSection";

interface OllamaSettingsSectionProps {
    settings: SimilarNotesSettings;
    tempOllamaUrl: string | undefined;
    tempOllamaModel: string | undefined;
    onOllamaUrlChange: (value: string) => void;
    onOllamaModelChange: (value: string) => void;
    onRender: () => void;
    onDropdownCreated: (dropdown: DropdownComponent) => void;
}

export interface OllamaSettingsResult {
    builders: SettingBuilder[];
    fetchModels: () => Promise<void>;
}

export function getOllamaSettingBuilders(props: OllamaSettingsSectionProps): OllamaSettingsResult {
    const {
        settings,
        tempOllamaUrl,
        tempOllamaModel,
        onOllamaUrlChange,
        onOllamaModelChange,
        onRender,
        onDropdownCreated,
    } = props;

    const ollamaUrl =
        tempOllamaUrl || settings.ollamaUrl || "http://localhost:11434";
    const ollamaClient = new OllamaClient(ollamaUrl);

    // State for Ollama models
    let ollamaModels: OllamaModelWithEmbeddingInfo[] = [];
    let modelLoadError: string | null = null;
    let dropdownComponent: DropdownComponent | null = null;

    // Function to fetch Ollama models
    const fetchOllamaModels = async () => {
        modelLoadError = null;

        try {
            ollamaModels = await ollamaClient.getModelsWithEmbeddingInfo();
        } catch (error) {
            modelLoadError =
                error instanceof Error
                    ? error.message
                    : "Failed to fetch models";
            ollamaModels = [];
        }

        // Update dropdown if it exists
        if (dropdownComponent) {
            dropdownComponent.selectEl.empty();

            if (modelLoadError) {
                dropdownComponent.addOption("", `Error: ${modelLoadError}`);
            } else if (ollamaModels.length === 0) {
                dropdownComponent.addOption("", "No models found");
            } else {
                dropdownComponent.addOption("", "Select a model");
                ollamaModels.forEach((model) => {
                    const displayText = model.isEmbeddingModel
                        ? model.name
                        : `${model.name} (not embed)`;
                    dropdownComponent!.addOption(model.name, displayText);
                });

                // Disable non-embedding model options via DOM
                const options = dropdownComponent.selectEl.querySelectorAll("option");
                ollamaModels.forEach((model, index) => {
                    const optionEl = options[index + 1] as HTMLOptionElement; // +1: skip "Select a model"
                    if (optionEl && !model.isEmbeddingModel) {
                        optionEl.disabled = true;
                    }
                });

                // Set current value if it exists in the list
                const modelNames = ollamaModels.map(m => m.name);
                if (tempOllamaModel && modelNames.includes(tempOllamaModel)) {
                    dropdownComponent.setValue(tempOllamaModel);
                }
            }
        }
    };

    const builders: SettingBuilder[] = [
        // Server URL
        (setting) => {
            setting
                .setName("Server URL")
                .setDesc("URL of your Ollama server (default: http://localhost:11434)")
                .addText((text) => {
                    text.setPlaceholder("http://localhost:11434")
                        .setValue(ollamaUrl)
                        .onChange((value) => {
                            onOllamaUrlChange(value);
                            // Update client URL and refresh the page
                            ollamaClient.setBaseUrl(value);
                            onRender();
                        });
                });
        },
        // Model dropdown
        (setting) => {
            setting
                .setName("Model")
                .setDesc("Select an Ollama model for embeddings")
                .addDropdown((dropdown) => {
                    dropdownComponent = dropdown;
                    onDropdownCreated(dropdown);
                    dropdown.addOption("", "Loading models...");
                    dropdown.setValue(tempOllamaModel || "");
                    dropdown.onChange((value) => {
                        onOllamaModelChange(value);
                        onRender(); // Redraw to update Apply button state
                    });
                })
                .addButton((button) => {
                    button
                        .setButtonText("Refresh")
                        .setTooltip("Refresh model list")
                        .onClick(async () => {
                            await fetchOllamaModels();
                        });
                });
        },
        // Test connection
        (setting) => {
            setting
                .setName("Test connection")
                .setDesc("Test the connection to Ollama server and selected model")
                .addButton((button) => {
                    button.setButtonText("Test").onClick(async () => {
                        const model = tempOllamaModel;
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
                                new Notice(`Connection failed: Model test failed`);
                            }
                        } catch (error) {
                            new Notice(`Connection failed: ${error}`);
                        }
                    });
                });
        },
    ];

    return {
        builders,
        fetchModels: fetchOllamaModels,
    };
}
