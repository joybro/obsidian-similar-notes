import { type App, Modal, Setting } from "obsidian";

export class LoadModelModal extends Modal {
    constructor(app: App, onSubmit: () => void, onCancel: () => void) {
        super(app);
        this.setContent(
            "Heads up! The model will be downloaded from Hugging Face (this might take a while) and all your notes will be reindexed. Check the status bar to see the progress."
        );

        new Setting(this.contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Continue")
                    .setCta()
                    .onClick(() => {
                        this.close();
                        onSubmit();
                    })
            )
            .addButton((btn) =>
                btn.setButtonText("Cancel").onClick(() => {
                    this.close();
                    onCancel();
                })
            );
    }
}
