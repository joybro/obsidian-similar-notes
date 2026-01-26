import { OpenAIClient } from "@/adapter/openai";
import type { SimilarNotesSettings } from "@/application/SettingsService";
import { Notice, Setting } from "obsidian";
import type { DropdownComponent } from "obsidian";

interface OpenAISettingsSectionProps {
    sectionContainer: HTMLElement;
    settings: SimilarNotesSettings;
    tempOpenAIUrl: string | undefined;
    tempOpenAIModel: string | undefined;
    tempOpenAIApiKey: string | undefined;
    onOpenAIUrlChange: (value: string) => void;
    onOpenAIModelChange: (value: string) => void;
    onOpenAIApiKeyChange: (value: string) => void;
    onRender: () => void;
}

export function renderOpenAISettings(props: OpenAISettingsSectionProps): void {
    const {
        sectionContainer,
        settings,
        tempOpenAIUrl,
        tempOpenAIModel,
        tempOpenAIApiKey,
        onOpenAIUrlChange,
        onOpenAIModelChange,
        onOpenAIApiKeyChange,
        onRender,
    } = props;

    const openaiUrl =
        tempOpenAIUrl || settings.openaiUrl || "http://localhost:1234/v1";
    const openaiApiKey = 
        tempOpenAIApiKey !== undefined ? tempOpenAIApiKey : (settings.openaiApiKey || "");
    
    // Create client for testing/fetching
    const openaiClient = new OpenAIClient(openaiUrl, openaiApiKey);

    // State for OpenAI models
    let openaiModels: string[] = [];
    let modelLoadError: string | null = null;
    let areModelsLoading = false;

    // Function to fetch OpenAI models
    const fetchOpenAIModels = async () => {
        modelLoadError = null;
        areModelsLoading = true;
        // Re-create client with current values just in case
        openaiClient.setBaseUrl(openaiUrl);
        openaiClient.setApiKey(openaiApiKey);

        try {
            openaiModels = await openaiClient.getModelNames();
        } catch (error) {
            modelLoadError =
                error instanceof Error
                    ? error.message
                    : "Failed to fetch models";
            openaiModels = [];
        } finally {
            areModelsLoading = false;
        }
    };

    new Setting(sectionContainer)
        .setName("Server URL")
        .setDesc("URL of your OpenAI-compatible server (e.g., http://localhost:1234/v1)")
        .addText((text) => {
            text.setPlaceholder("http://localhost:1234/v1")
                .setValue(openaiUrl)
                .onChange((value) => {
                    onOpenAIUrlChange(value);
                    openaiClient.setBaseUrl(value);
                    // Don't auto-refresh models as they might type slowly
                });
        });
        
    new Setting(sectionContainer)
        .setName("API Key")
        .setDesc("API Key (optional, depending on your server)")
        .addText((text) => {
            text.setPlaceholder("sk-...")
                .setValue(openaiApiKey)
                .onChange((value) => {
                    onOpenAIApiKeyChange(value);
                    openaiClient.setApiKey(value);
                });
            text.inputEl.type = "password";
        });

    // Create the model dropdown setting
    const modelSetting = new Setting(sectionContainer)
        .setName("Model")
        .setDesc("Select or enter a model name");

   

    const tempModel = tempOpenAIModel || settings.openaiModel || "";

    modelSetting.addText((text) => {
        text.setPlaceholder("text-embedding-3-small")
            .setValue(tempModel)
            .onChange((value) => {
                onOpenAIModelChange(value);
            });
    });

    // Add fetch button
    modelSetting.addButton((button) => {
        button
            .setButtonText("Fetch Models")
            .setTooltip("Fetch available models from server")
            .onClick(async () => {
                const notice = new Notice("Fetching models...");
                await fetchOpenAIModels();
                notice.hide();
                
                onRender(); 
            });
    });

    

    let dropdownComponent: DropdownComponent;
    
    
    
    const dropdownContainer = sectionContainer.createDiv();
    
    fetchOpenAIModels().then(() => {
        if (openaiModels.length > 0) {
            dropdownContainer.empty();
            new Setting(dropdownContainer)
                .setName("Select from detected models")
                .addDropdown((dropdown) => {
                    dropdown.addOption("", "Choose a model...");
                    openaiModels.forEach(m => dropdown.addOption(m, m));
                    dropdown.onChange((value) => {
                        if (value) {
                             onOpenAIModelChange(value);
                             onRender(); // Update the text input above
                        }
                    });
                });
        } else if (modelLoadError) {
             // dropdownContainer.createEl("small", { text: `Could not list models: ${modelLoadError}`, cls: "setting-item-description" });
        }
    });

    // Test connection button
    new Setting(sectionContainer)
        .setName("Test connection")
        .setDesc("Test the connection to server and selected model")
        .addButton((button) => {
            button.setButtonText("Test").onClick(async () => {
                const model = tempOpenAIModel || settings.openaiModel;
                if (!model) {
                    new Notice("Please enter a model name first");
                    return;
                }

                new Notice(
                    `Testing connection to ${openaiUrl} with model ${model}...`
                );

                try {
                     // Update client with current UI values
                    openaiClient.setBaseUrl(openaiUrl);
                    openaiClient.setApiKey(openaiApiKey);
                    
                    const success = await openaiClient.testModel(model);
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
