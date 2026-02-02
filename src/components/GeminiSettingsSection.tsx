import { GeminiClient } from "@/adapter/gemini";
import type { SimilarNotesSettings } from "@/application/SettingsService";
import { Notice } from "obsidian";
import type { Setting } from "obsidian";

export type SettingBuilder = (setting: Setting) => void;

interface GeminiSettingsSectionProps {
    settings: SimilarNotesSettings;
    tempGeminiApiKey: string | undefined;
    tempGeminiModel: string | undefined;
    onGeminiApiKeyChange: (value: string) => void;
    onGeminiModelChange: (value: string) => void;
    onRender: () => void;
    // Getter functions to get latest temp values (to avoid closure issues)
    getTempValues?: () => { apiKey?: string; model?: string };
}

// Predefined Gemini embedding models
const GEMINI_MODELS = [
    { id: "gemini-embedding-001", name: "gemini-embedding-001 (Recommended)" },
];

export function getGeminiSettingBuilders(props: GeminiSettingsSectionProps): SettingBuilder[] {
    const {
        settings,
        tempGeminiApiKey,
        tempGeminiModel,
        onGeminiApiKeyChange,
        onGeminiModelChange,
        onRender,
        getTempValues,
    } = props;

    const geminiApiKey = tempGeminiApiKey ?? settings.geminiApiKey ?? "";
    const geminiModel = tempGeminiModel ?? settings.geminiModel ?? "gemini-embedding-001";
    const isCustomModel = !GEMINI_MODELS.some((m) => m.id === geminiModel);

    const builders: SettingBuilder[] = [
        // API Key
        (setting) => {
            setting
                .setName("API Key")
                .setDesc("Your Google AI Studio API key (get it from aistudio.google.com)")
                .addText((text) => {
                    text.setPlaceholder("AIza...")
                        .setValue(geminiApiKey)
                        .onChange((value) => {
                            onGeminiApiKeyChange(value);
                        });
                    // Make it a password field
                    text.inputEl.type = "password";
                });
        },
        // Model dropdown
        (setting) => {
            setting
                .setName("Model")
                .setDesc("Select an embedding model")
                .addDropdown((dropdown) => {
                    // Add predefined models
                    GEMINI_MODELS.forEach((model) => {
                        dropdown.addOption(model.id, model.name);
                    });
                    // Add custom option
                    dropdown.addOption("custom", "Custom model...");

                    // Set current value
                    dropdown.setValue(isCustomModel ? "custom" : geminiModel);

                    dropdown.onChange((value) => {
                        if (value === "custom") {
                            // Set to "custom" to trigger custom input display
                            onGeminiModelChange("custom");
                        } else {
                            onGeminiModelChange(value);
                        }
                        onRender();
                    });
                });
        },
    ];

    // Show custom model input if custom is selected
    if (isCustomModel) {
        builders.push((setting) => {
            setting
                .setName("Custom model ID")
                .setDesc("Enter the Gemini model ID")
                .addText((text) => {
                    text.setPlaceholder("model-name")
                        .setValue(geminiModel)
                        .onChange((value) => {
                            onGeminiModelChange(value);
                        });
                });
        });
    }

    // Test connection
    builders.push((setting) => {
        setting
            .setName("Test connection")
            .setDesc("Test the connection to the Gemini API")
            .addButton((button) => {
                button.setButtonText("Test").onClick(async () => {
                    // Use getter function to get latest temp values (avoids closure issues)
                    const tempValues = getTempValues?.() ?? {};
                    const apiKey = tempValues.apiKey ?? settings.geminiApiKey;
                    const model = tempValues.model ?? settings.geminiModel ?? "gemini-embedding-001";

                    if (!apiKey) {
                        new Notice("Please enter an API key first");
                        return;
                    }

                    if (!model) {
                        new Notice("Please select or enter a model first");
                        return;
                    }

                    new Notice(`Testing connection with model ${model}...`);

                    try {
                        const client = new GeminiClient(apiKey);
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
    });

    return builders;
}
