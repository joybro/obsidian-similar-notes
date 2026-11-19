import { type App, Modal, Setting } from "obsidian";
import { logRejection } from "@/utils/logRejection";

export class LoadModelModal extends Modal {
    constructor(
        app: App,
        message: string,
        onSubmit: () => void | Promise<void>,
        onCancel: () => void
    ) {
        super(app);
        this.setContent(message);

        new Setting(this.contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Continue")
                    .setCta()
                    .onClick(() => {
                        this.close();
                        const result = onSubmit();
                        if (result) logRejection(result, "confirmed action");
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
