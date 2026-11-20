import { OllamaClient, type OllamaModelWithEmbeddingInfo } from "@/adapter/ollama";
import type { SimilarNotesSettings } from "@/application/SettingsService";
import { Notice } from "obsidian";
import type { DropdownComponent } from "obsidian";
import type { SettingRow } from "./settingDefinitions";

interface OllamaSettingsSectionProps {
    settings: SimilarNotesSettings;
    tempOllamaUrl: string | undefined;
    tempOllamaModel: string | undefined;
    onOllamaUrlChange: (value: string) => void;
    onOllamaModelChange: (value: string) => void;
    updateApplyButtonState: () => void;
    onDropdownCreated: (dropdown: DropdownComponent) => void;
}

export interface OllamaSettingsResult {
    builders: SettingRow[];
    fetchModels: () => Promise<void>;
}

export function getOllamaSettingBuilders(props: OllamaSettingsSectionProps): OllamaSettingsResult {
    const {
        settings,
        tempOllamaUrl,
        tempOllamaModel,
        onOllamaUrlChange,
        onOllamaModelChange,
        updateApplyButtonState,
        onDropdownCreated,
    } = props;

    const resolveUrl = (value: string | undefined) =>
        value || settings.ollamaUrl || "http://localhost:11434";
    const ollamaUrl = resolveUrl(tempOllamaUrl);
    const ollamaClient = new OllamaClient(ollamaUrl);

    // The URL and model inputs do not re-render the section on change (see
    // their onChange handlers), so the render-time props go stale. Track the
    // values currently in the form for Refresh and Test.
    let currentUrl = ollamaUrl;
    let currentModel = tempOllamaModel;

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
            const dropdown = dropdownComponent;
            dropdown.selectEl.empty();

            if (modelLoadError) {
                dropdown.addOption("", `Error: ${modelLoadError}`);
            } else if (ollamaModels.length === 0) {
                dropdown.addOption("", "No models found");
            } else {
                dropdown.addOption("", "Select a model");
                ollamaModels.forEach((model) => {
                    const displayText = model.isEmbeddingModel
                        ? model.name
                        : `${model.name} (not embed)`;
                    dropdown.addOption(model.name, displayText);
                });

                // Disable non-embedding model options via DOM
                const options = dropdown.selectEl.querySelectorAll("option");
                ollamaModels.forEach((model, index) => {
                    const optionEl = options[index + 1]; // +1: skip "Select a model"
                    if (optionEl && !model.isEmbeddingModel) {
                        optionEl.disabled = true;
                    }
                });

                // Set current value if it exists in the list
                const modelNames = ollamaModels.map(m => m.name);
                if (currentModel && modelNames.includes(currentModel)) {
                    dropdown.setValue(currentModel);
                }
            }
        }
    };

    const builders: SettingRow[] = [
        // Server URL
        { name: "Server URL", render: (setting) => {
            setting
                .setName("Server URL")
                .setDesc("URL of your Ollama server (default: http://localhost:11434)")
                .addText((text) => {
                    text.setPlaceholder("http://localhost:11434")
                        .setValue(ollamaUrl)
                        .onChange((value) => {
                            onOllamaUrlChange(value);
                            // Update the client URL for later "Refresh"/"Test"
                            // actions. Do NOT re-render the section here: doing so
                            // rebuilds this very input element and steals focus
                            // after every keystroke (issue #43). Only the apply
                            // button state needs to react to the change.
                            currentUrl = resolveUrl(value);
                            ollamaClient.setBaseUrl(currentUrl);
                            updateApplyButtonState();
                        });
                });
        } },
        // Model dropdown
        { name: "Model", render: (setting) => {
            setting
                .setName("Model")
                .setDesc("Select an Ollama model for embeddings")
                .addDropdown((dropdown) => {
                    dropdownComponent = dropdown;
                    onDropdownCreated(dropdown);
                    dropdown.addOption("", "Loading models...");
                    dropdown.setValue(tempOllamaModel || "");
                    dropdown.onChange((value) => {
                        currentModel = value;
                        onOllamaModelChange(value);
                        // Update only the apply button; a full re-render would
                        // re-fetch the model list and reset the dropdown.
                        updateApplyButtonState();
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
        } },
        // Test connection
        { name: "Test connection", render: (setting) => {
            setting
                .setName("Test connection")
                .setDesc("Test the connection to Ollama server and selected model")
                .addButton((button) => {
                    button.setButtonText("Test").onClick(async () => {
                        const model = currentModel;
                        if (!model) {
                            new Notice("Please select a model first");
                            return;
                        }

                        new Notice(
                            `Testing connection to ${currentUrl} with model ${model}...`
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
        } },
    ];

    return {
        builders,
        fetchModels: fetchOllamaModels,
    };
}
