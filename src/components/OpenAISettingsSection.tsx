import { OpenAIClient } from "@/adapter/openai";
import type { SimilarNotesSettings } from "@/application/SettingsService";
import { Notice, Setting } from "obsidian";

interface OpenAISettingsSectionProps {
    sectionContainer: HTMLElement;
    settings: SimilarNotesSettings;
    tempOpenaiUrl: string | undefined;
    tempOpenaiApiKey: string | undefined;
    tempOpenaiModel: string | undefined;
    onOpenaiUrlChange: (value: string) => void;
    onOpenaiApiKeyChange: (value: string) => void;
    onOpenaiModelChange: (value: string) => void;
    onRender: () => void;
}

// Predefined OpenAI embedding models
const OPENAI_MODELS = [
    { id: "text-embedding-3-small", name: "text-embedding-3-small (Recommended)" },
    { id: "text-embedding-3-large", name: "text-embedding-3-large" },
    { id: "text-embedding-ada-002", name: "text-embedding-ada-002 (Legacy)" },
];

const DEFAULT_OPENAI_URL = "https://api.openai.com/v1";

export function renderOpenAISettings(props: OpenAISettingsSectionProps): void {
    const {
        sectionContainer,
        settings,
        tempOpenaiUrl,
        tempOpenaiApiKey,
        tempOpenaiModel,
        onOpenaiUrlChange,
        onOpenaiApiKeyChange,
        onOpenaiModelChange,
        onRender,
    } = props;

    const openaiUrl = tempOpenaiUrl ?? settings.openaiUrl ?? DEFAULT_OPENAI_URL;
    const openaiApiKey = tempOpenaiApiKey ?? settings.openaiApiKey ?? "";
    const openaiModel = tempOpenaiModel ?? settings.openaiModel ?? "text-embedding-3-small";

    // Server URL setting
    new Setting(sectionContainer)
        .setName("Server URL")
        .setDesc("URL of your OpenAI-compatible server (default: https://api.openai.com/v1)")
        .addText((text) => {
            text.setPlaceholder(DEFAULT_OPENAI_URL)
                .setValue(openaiUrl)
                .onChange((value) => {
                    onOpenaiUrlChange(value);
                });
        });

    // API Key setting
    new Setting(sectionContainer)
        .setName("API Key")
        .setDesc("Your OpenAI API key (required for OpenAI, optional for local servers)")
        .addText((text) => {
            text.setPlaceholder("sk-...")
                .setValue(openaiApiKey)
                .onChange((value) => {
                    onOpenaiApiKeyChange(value);
                });
            // Make it a password field
            text.inputEl.type = "password";
        });

    // Model selection
    const modelSetting = new Setting(sectionContainer)
        .setName("OpenAI model")
        .setDesc("Select an embedding model");

    modelSetting.addDropdown((dropdown) => {
        // Add predefined models
        OPENAI_MODELS.forEach((model) => {
            dropdown.addOption(model.id, model.name);
        });
        // Add custom option
        dropdown.addOption("custom", "Custom model...");

        // Set current value
        const isCustom = !OPENAI_MODELS.some((m) => m.id === openaiModel);
        dropdown.setValue(isCustom ? "custom" : openaiModel);

        dropdown.onChange((value) => {
            if (value === "custom") {
                // Will show custom input
                onRender();
            } else {
                onOpenaiModelChange(value);
                onRender();
            }
        });
    });

    // Show custom model input if custom is selected
    const isCustomModel = !OPENAI_MODELS.some((m) => m.id === openaiModel);
    if (isCustomModel) {
        new Setting(sectionContainer)
            .setName("Custom model ID")
            .setDesc("Enter the model ID for your OpenAI-compatible server")
            .addText((text) => {
                text.setPlaceholder("model-name")
                    .setValue(openaiModel)
                    .onChange((value) => {
                        onOpenaiModelChange(value);
                    });
            });
    }

    // Test connection button
    new Setting(sectionContainer)
        .setName("Test connection")
        .setDesc("Test the connection to the server and model")
        .addButton((button) => {
            button.setButtonText("Test").onClick(async () => {
                const model = openaiModel;
                if (!model) {
                    new Notice("Please select or enter a model first");
                    return;
                }

                new Notice(`Testing connection to ${openaiUrl} with model ${model}...`);

                try {
                    const client = new OpenAIClient(openaiUrl, openaiApiKey || undefined);
                    const success = await client.testConnection(model);

                    if (success) {
                        new Notice("Connection successful! Model is ready for embeddings.");
                    } else {
                        new Notice("Connection failed: Could not generate test embedding");
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    new Notice(`Connection failed: ${errorMessage}`);
                }
            });
        });
}
