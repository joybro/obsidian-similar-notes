import { App, Modal, Notice, Setting } from "obsidian";

export class GPUSettingModal extends Modal {
    constructor(
        app: App,
        private onConfirm: () => Promise<void>,
        private onCancel?: () => void
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h2", { text: "GPU Acceleration Disabled" });
        
        contentEl.createEl("p", { 
            text: "Model loaded successfully with CPU mode. GPU acceleration failed and has been automatically disabled for this session." 
        });
        
        contentEl.createEl("p", { 
            text: "Would you like to permanently disable GPU acceleration in settings to avoid this error in the future?" 
        });

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Yes, Disable GPU")
                    .setCta()
                    .onClick(async () => {
                        try {
                            await this.onConfirm();
                            new Notice("GPU acceleration disabled in settings");
                            this.close();
                        } catch (error) {
                            new Notice("Failed to update settings");
                            console.error("Failed to update GPU setting:", error);
                        }
                    })
            )
            .addButton((btn) =>
                btn
                    .setButtonText("No, Keep GPU Enabled")
                    .onClick(() => {
                        if (this.onCancel) {
                            this.onCancel();
                        }
                        this.close();
                    })
            );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}