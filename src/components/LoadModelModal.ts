import { type App, Modal, Setting } from "obsidian";

export class LoadModelModal extends Modal {
    constructor(app: App, message: string, onSubmit: () => void, onCancel: () => void) {
        super(app);
        this.setContent(message);

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
