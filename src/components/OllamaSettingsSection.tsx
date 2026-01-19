import { OllamaClient, type OllamaModelWithEmbeddingInfo } from "@/adapter/ollama";
import type { SimilarNotesSettings } from "@/application/SettingsService";
import { Notice, Setting } from "obsidian";
import type { DropdownComponent } from "obsidian";

interface OllamaSettingsSectionProps {
    sectionContainer: HTMLElement;
    settings: SimilarNotesSettings;
    tempOllamaUrl: string | undefined;
    tempOllamaModel: string | undefined;
    onOllamaUrlChange: (value: string) => void;
    onOllamaModelChange: (value: string) => void;
    onRender: () => void;
}

export function renderOllamaSettings(props: OllamaSettingsSectionProps): void {
    const {
        sectionContainer,
        settings,
        tempOllamaUrl,
        tempOllamaModel,
        onOllamaUrlChange,
        onOllamaModelChange,
        onRender,
    } = props;

    const ollamaUrl =
        tempOllamaUrl || settings.ollamaUrl || "http://localhost:11434";
    const ollamaClient = new OllamaClient(ollamaUrl);

    // State for Ollama models
    let ollamaModels: OllamaModelWithEmbeddingInfo[] = [];
    let modelLoadError: string | null = null;

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
    };

    new Setting(sectionContainer)
        .setName("Ollama server URL")
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

    // Create the model dropdown setting
    const modelSetting = new Setting(sectionContainer)
        .setName("Ollama model")
        .setDesc("Select an Ollama model for embeddings");

    let dropdownComponent: DropdownComponent;
    modelSetting.addDropdown((dropdown) => {
        dropdownComponent = dropdown;
        dropdown.addOption("", "Loading models...");
        dropdown.setValue(tempOllamaModel || "");
        dropdown.onChange((value) => {
            onOllamaModelChange(value);
            onRender(); // Redraw to update Apply button state
        });
    });

    // Add refresh button
    modelSetting.addButton((button) => {
        button
            .setButtonText("Refresh")
            .setTooltip("Refresh model list")
            .onClick(async () => {
                await fetchOllamaModels();
                onRender(); // Redraw to update dropdown
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
                const displayText = model.isEmbeddingModel
                    ? model.name
                    : `${model.name} (not embed)`;
                dropdownComponent.addOption(model.name, displayText);
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
    });

    // Test connection button
    new Setting(sectionContainer)
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
}
