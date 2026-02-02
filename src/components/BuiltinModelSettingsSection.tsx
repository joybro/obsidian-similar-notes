import type { SimilarNotesSettings } from "@/application/SettingsService";
import type { ButtonComponent } from "obsidian";
import type { SettingBuilder } from "./OpenAISettingsSection";

interface BuiltinModelSettingsSectionProps {
    settings: SimilarNotesSettings;
    tempModelId: string | undefined;
    tempUseGPU: boolean | undefined;
    onModelIdChange: (value: string) => void;
    onUseGPUChange: (value: boolean) => void;
    onRender: () => void;
    updateApplyButtonState: () => void;
}

export function getBuiltinModelSettingBuilders(
    props: BuiltinModelSettingsSectionProps
): SettingBuilder[] {
    const {
        settings,
        tempModelId,
        tempUseGPU,
        onModelIdChange,
        onUseGPUChange,
        onRender,
        updateApplyButtonState,
    } = props;

    const recommendedModels = [
        "sentence-transformers/all-MiniLM-L6-v2",
        "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    ];

    return [
        // Recommended models dropdown
        (setting) => {
            setting
                .setName("Recommended models")
                .setDesc("Select from recommended embedding models")
                .addDropdown((dropdown) => {
                    for (const model of recommendedModels) {
                        dropdown.addOption(model, model);
                    }
                    dropdown.setValue(tempModelId || settings.modelId);
                    dropdown.onChange((value) => {
                        onModelIdChange(value);
                        onRender(); // Redraw to update Apply button state
                    });
                });
        },
        // Custom model input
        (setting) => {
            setting
                .setName("Custom model")
                .setDesc("Enter a custom model ID from Hugging Face")
                .addText((text) => {
                    text.setValue(tempModelId || "").onChange((value) => {
                        onModelIdChange(value);
                        // Don't redraw for text input to avoid losing focus
                        updateApplyButtonState();
                    });
                });
        },
        // GPU acceleration toggle
        (setting) => {
            setting
                .setName("Use GPU acceleration")
                .setDesc(
                    "If enabled, WebGPU will be used for model inference. Disable if you experience issues with GPU acceleration."
                )
                .addToggle((toggle) => {
                    toggle
                        .setValue(tempUseGPU ?? settings.useGPU)
                        .onChange((value) => {
                            onUseGPUChange(value);
                            // Delay redraw to allow toggle animation to complete
                            setTimeout(() => {
                                onRender(); // Redraw to update Apply button state
                            }, 150);
                        });
                });
        },
    ];
}

interface ApplyButtonProps {
    hasChanges: boolean;
    tempModelProvider: "builtin" | "ollama" | "openai" | "gemini" | undefined;
    onApply: () => Promise<void>;
    onButtonCreated: (button: ButtonComponent) => void;
}

export function getApplyButtonBuilder(props: ApplyButtonProps): SettingBuilder {
    const {
        hasChanges,
        tempModelProvider,
        onApply,
        onButtonCreated,
    } = props;

    const buttonText =
        tempModelProvider === "builtin" ? "Load & Apply" : "Apply Changes";
    const buttonDesc = hasChanges
        ? "Apply the selected model configuration. This will rebuild the similarity index."
        : "No changes to apply. Modify settings above to enable this button.";

    return (setting) => {
        setting
            .setName("Apply model changes")
            .setDesc(buttonDesc)
            .addButton((button) => {
                onButtonCreated(button); // Store reference for updates
                button
                    .setButtonText(buttonText)
                    .setDisabled(!hasChanges)
                    .onClick(async () => {
                        if (hasChanges) {
                            await onApply();
                        }
                    });

                if (hasChanges) {
                    button.setCta();
                }
            });
    };
}
