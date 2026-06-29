import type { SimilarNotesSettings } from "@/application/SettingsService";
import type { ButtonComponent, Setting } from "obsidian";
import type { SettingBuilder } from "./OpenAISettingsSection";

export interface BuiltinModelSettingsSectionProps {
    settings: SimilarNotesSettings;
    tempModelId: string | undefined;
    tempUseGPU: boolean | undefined;
    onModelIdChange: (value: string) => void;
    onUseGPUChange: (value: boolean) => void;
    onRender: () => void;
    updateApplyButtonState: () => void;
    // True on the Obsidian mobile app. Built-in models run fully on-device and
    // can exhaust a phone's memory budget, crashing the whole app, so we warn
    // (rather than block — a capable tablet should still be able to opt in).
    isMobile: boolean;
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
        isMobile,
    } = props;

    const recommendedModels = [
        "sentence-transformers/all-MiniLM-L6-v2",
        "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    ];

    return [
        // Mobile warning: built-in models run on-device and can crash low-memory
        // phones. Shown above the model options so it's seen before "Load & Apply".
        ...(isMobile
            ? [
                (setting: Setting) => {
                    setting
                        .setName("⚠️ Built-in models on mobile")
                        .setDesc(
                            "Built-in models run entirely on-device and need a lot of memory. On low-memory phones this can crash Obsidian. For mobile, a remote provider (Ollama, OpenAI, or Gemini) is recommended."
                        )
                        .setClass("similar-notes-mobile-warning");
                },
            ]
            : []),
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
                .setDesc(
                    "Enter a custom model ID from Hugging Face. The repo must include ONNX weights — most sentence-transformer repos only ship PyTorch / safetensors. Try the `onnx-community/...` mirror if a model fails to load."
                )
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
