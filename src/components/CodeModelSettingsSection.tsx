import {
    normalizeEmbeddingModelSettings,
    snapshotNoteModelSettings,
    type EmbeddingModelSettings,
    type SettingsService,
    type SimilarNotesSettings,
} from "@/application/SettingsService";
import {
    embeddingProfilesEqual,
    getEffectiveModelId,
    getEmbeddingIndexFingerprint,
} from "@/domain/service/embeddingProfile";
import type MainPlugin from "@/main";
import {
    Notice,
    Platform,
    SettingGroup,
    type App,
    type ButtonComponent,
} from "obsidian";
import { getBuiltinModelSettingBuilders } from "./BuiltinModelSettingsSection";
import { getGeminiSettingBuilders } from "./GeminiSettingsSection";
import { getOllamaSettingBuilders } from "./OllamaSettingsSection";
import {
    getOpenAISettingBuilders,
    type SettingBuilder,
} from "./OpenAISettingsSection";

interface CodeModelSettingsSectionProps {
    containerEl: HTMLElement;
    plugin: MainPlugin;
    settingsService: SettingsService;
    app: App;
}

export class CodeModelSettingsSection {
    private sectionContainer?: HTMLElement;
    private tempEnabled?: boolean;
    private tempModel?: EmbeddingModelSettings;
    private tempModelEdited = false;
    private applyButton?: ButtonComponent;
    private statusRefreshTimer?: ReturnType<typeof setInterval>;

    constructor(private readonly props: CodeModelSettingsSectionProps) {}

    render(): void {
        this.stopStatusRefresh();
        const settings = this.props.settingsService.get();
        const model = this.getTempModel(settings);
        this.tempEnabled ??= settings.codeModeEnabled;

        if (!this.sectionContainer || !this.sectionContainer.parentElement) {
            this.sectionContainer = this.props.containerEl.createDiv(
                "code-model-settings-section"
            );
        } else {
            this.sectionContainer.empty();
        }

        new SettingGroup(this.sectionContainer)
            .setHeading("Code mode")
            .addSetting((setting) => {
                setting
                    .setName("Index fenced code blocks separately")
                    .setDesc(
                        "Build a separate Code index. When enabled, fenced blocks are removed from the Notes index."
                    )
                    .addToggle((toggle) => {
                        toggle
                            .setValue(this.tempEnabled ?? false)
                            .onChange((value) => {
                                this.tempEnabled = value;
                                setTimeout(() => this.render(), 150);
                            });
                    });
            })
            .addSetting((setting) => {
                setting.setName("Code index status").setDesc(
                    settings.codeModeEnabled
                        ? "Loading Code index status…"
                        : "Disabled"
                );
                if (settings.codeModeEnabled) {
                    const refreshStatus = async () => {
                        try {
                            const status =
                                await this.props.plugin.getCodeModeStatus();
                            setting.setDesc(
                                `${status.indexedNotes} notes, ${status.chunks} chunks, ${status.erroredNotes} errored`
                            );
                        } catch {
                            setting.setDesc("Code index status unavailable");
                        }
                    };
                    void refreshStatus();
                    this.statusRefreshTimer = setInterval(
                        () => void refreshStatus(),
                        1500
                    );
                }
            });

        const modelGroup = new SettingGroup(this.sectionContainer)
            .setHeading("Code model")
            .addSetting((setting) => {
                setting
                    .setName("Configured model")
                    .setDesc(
                        `${model.modelProvider}: ${getEffectiveModelId(model)}`
                    );
            })
            .addSetting((setting) => {
                setting
                    .setName("Model provider")
                    .setDesc(
                        "Choose the provider used only for fenced code blocks."
                    )
                    .addDropdown((dropdown) => {
                        dropdown
                            .addOption("builtin", "Built-in Models")
                            .addOption("ollama", "Ollama")
                            .addOption("openai", "OpenAI / Compatible")
                            .addOption("gemini", "Google Gemini")
                            .setValue(model.modelProvider)
                            .onChange((value) => {
                                this.updateModel({
                                    modelProvider:
                                        value as EmbeddingModelSettings["modelProvider"],
                                });
                                this.render();
                            });
                    });
            });

        this.getProviderBuilders(model).forEach((builder) =>
            modelGroup.addSetting(builder)
        );
        modelGroup.addSetting((setting) => {
            const hasChanges = this.hasChanges(settings);
            const action = this.getActionLabel(settings);
            setting
                .setName(action)
                .setDesc(
                    hasChanges
                        ? "Apply this Code Mode configuration. Required indexes will rebuild automatically."
                        : "No Code Mode changes to apply."
                )
                .addButton((button) => {
                    this.applyButton = button;
                    button
                        .setButtonText(action)
                        .setDisabled(!hasChanges)
                        .onClick(async () => {
                            if (!this.hasChanges(this.props.settingsService.get())) {
                                return;
                            }
                            button.setDisabled(true);
                            try {
                                await this.props.plugin.applyCodeModeChanges(
                                    this.tempEnabled ?? false,
                                    this.getTempModel(
                                        this.props.settingsService.get()
                                    )
                                );
                                new Notice("Code Mode settings applied");
                                this.clearTempState();
                                this.render();
                            } catch (error) {
                                console.error(
                                    "Failed to apply Code Mode settings",
                                    error
                                );
                                new Notice(
                                    `Failed to apply Code Mode: ${
                                        error instanceof Error
                                            ? error.message
                                            : String(error)
                                    }`
                                );
                                this.updateApplyButton();
                            }
                        });
                    if (hasChanges) button.setCta();
                });
        });
    }

    private getProviderBuilders(
        model: EmbeddingModelSettings
    ): SettingBuilder[] {
        if (model.modelProvider === "builtin") {
            return getBuiltinModelSettingBuilders({
                settings: model,
                tempModelId: model.modelId,
                tempUseGPU: model.useGPU,
                onModelIdChange: (modelId) => this.updateModel({ modelId }),
                onUseGPUChange: (useGPU) => this.updateModel({ useGPU }),
                onRender: () => this.render(),
                updateApplyButtonState: () => this.updateApplyButton(),
                isMobile: Platform.isMobileApp,
            });
        }
        if (model.modelProvider === "ollama") {
            const result = getOllamaSettingBuilders({
                settings: model,
                tempOllamaUrl: model.ollamaUrl,
                tempOllamaModel: model.ollamaModel,
                onOllamaUrlChange: (ollamaUrl) =>
                    this.updateModel({ ollamaUrl }),
                onOllamaModelChange: (ollamaModel) =>
                    this.updateModel({ ollamaModel }),
                updateApplyButtonState: () => this.updateApplyButton(),
                onDropdownCreated: () => undefined,
            });
            setTimeout(() => {
                void result.fetchModels();
            }, 0);
            return result.builders;
        }
        if (model.modelProvider === "openai") {
            return getOpenAISettingBuilders({
                settings: model,
                tempOpenaiUrl: model.openaiUrl,
                tempOpenaiApiKey: model.openaiApiKey,
                tempOpenaiModel: model.openaiModel,
                tempOpenaiMaxTokens: model.openaiMaxTokens,
                onOpenaiUrlChange: (openaiUrl) =>
                    this.updateModel({ openaiUrl }),
                onOpenaiApiKeyChange: (openaiApiKey) =>
                    this.updateModel({ openaiApiKey }),
                onOpenaiModelChange: (openaiModel) =>
                    this.updateModel({ openaiModel }),
                onOpenaiMaxTokensChange: (openaiMaxTokens) =>
                    this.updateModel({ openaiMaxTokens }),
                onRender: () => this.render(),
                getTempValues: () => ({
                    url: this.tempModel?.openaiUrl,
                    apiKey: this.tempModel?.openaiApiKey,
                    model: this.tempModel?.openaiModel,
                    maxTokens: this.tempModel?.openaiMaxTokens,
                }),
            });
        }
        return getGeminiSettingBuilders({
            settings: model,
            tempGeminiApiKey: model.geminiApiKey,
            tempGeminiModel: model.geminiModel,
            onGeminiApiKeyChange: (geminiApiKey) =>
                this.updateModel({ geminiApiKey }),
            onGeminiModelChange: (geminiModel) =>
                this.updateModel({ geminiModel }),
            onRender: () => this.render(),
            getTempValues: () => ({
                apiKey: this.tempModel?.geminiApiKey,
                model: this.tempModel?.geminiModel,
            }),
        });
    }

    private getTempModel(
        settings: SimilarNotesSettings
    ): EmbeddingModelSettings {
        if (
            !this.tempModel ||
            (!settings.codeModel && !this.tempModelEdited)
        ) {
            this.tempModel = settings.codeModel
                ? normalizeEmbeddingModelSettings(
                    settings.codeModel,
                    snapshotNoteModelSettings(settings)
                )
                : snapshotNoteModelSettings(settings);
        }
        return this.tempModel;
    }

    private updateModel(
        changes: Partial<EmbeddingModelSettings>
    ): void {
        const current = this.getTempModel(this.props.settingsService.get());
        this.tempModel = { ...current, ...changes };
        this.tempModelEdited = true;
        this.updateApplyButton();
    }

    private hasChanges(settings: SimilarNotesSettings): boolean {
        const currentModel = settings.codeModel
            ? normalizeEmbeddingModelSettings(
                settings.codeModel,
                snapshotNoteModelSettings(settings)
            )
            : snapshotNoteModelSettings(settings);
        return (
            (this.tempEnabled ?? settings.codeModeEnabled) !==
                settings.codeModeEnabled ||
            !embeddingProfilesEqual(this.getTempModel(settings), currentModel)
        );
    }

    private getActionLabel(settings: SimilarNotesSettings): string {
        const enabled = this.tempEnabled ?? settings.codeModeEnabled;
        if (enabled && !settings.codeModeEnabled) {
            return "Enable & build code index";
        }
        if (!enabled && settings.codeModeEnabled) {
            return "Disable & remove code index";
        }
        if (!enabled) return "Save code model";

        const currentModel = settings.codeModel
            ? normalizeEmbeddingModelSettings(
                settings.codeModel,
                snapshotNoteModelSettings(settings)
            )
            : snapshotNoteModelSettings(settings);
        return getEmbeddingIndexFingerprint(this.getTempModel(settings)) ===
            getEmbeddingIndexFingerprint(currentModel)
            ? "Apply code model settings"
            : "Apply & rebuild code index";
    }

    private updateApplyButton(): void {
        if (!this.applyButton) return;
        const settings = this.props.settingsService.get();
        const hasChanges = this.hasChanges(settings);
        this.applyButton
            .setButtonText(this.getActionLabel(settings))
            .setDisabled(!hasChanges);
        if (hasChanges) {
            this.applyButton.setCta();
        } else {
            this.applyButton.removeCta();
        }
    }

    private clearTempState(): void {
        this.tempEnabled = undefined;
        this.tempModel = undefined;
        this.tempModelEdited = false;
        this.applyButton = undefined;
    }

    resetDraft(): void {
        this.stopStatusRefresh();
        this.clearTempState();
    }

    private stopStatusRefresh(): void {
        if (this.statusRefreshTimer) {
            clearInterval(this.statusRefreshTimer);
            this.statusRefreshTimer = undefined;
        }
    }
}
