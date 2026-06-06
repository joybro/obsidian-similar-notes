import type { SettingsService } from "@/application/SettingsService";
import type { Setting } from "obsidian";

/**
 * Self-contained "test your exclude RegExp against sample text" widget for the
 * Index settings. Extracted from IndexSettingsSection to keep that file focused
 * (and within the line cap). It owns its textarea refs: render() builds the UI,
 * run() re-applies the current excludeRegexPatterns to the input, and reset()
 * drops the refs when the settings section is torn down.
 */
export class RegexpExclusionTester {
    private inputTextArea?: HTMLTextAreaElement;
    private outputTextArea?: HTMLTextAreaElement;

    constructor(private settingsService: SettingsService) {}

    render(setting: Setting): void {
        const settings = this.settingsService.get();

        setting.settingEl.addClass("similar-notes-regexp-tester");
        setting.setDesc("Test your regular expressions against sample text");

        const content = setting.controlEl;
        content.addClass("similar-notes-regexp-tester-content");

        const inputContainer = content.createDiv(
            "similar-notes-test-input-container"
        );
        const outputContainer = content.createDiv(
            "similar-notes-test-output-container"
        );

        inputContainer
            .createDiv("similar-notes-test-label")
            .setText("Input text:");
        outputContainer
            .createDiv("similar-notes-test-label")
            .setText("Result (content that will be indexed):");

        const input = inputContainer.createEl("textarea");
        input.rows = 8;
        input.cols = 30;
        input.placeholder =
            "Enter text to test against your regular expressions";
        input.value = settings.regexpTestInputText || "";
        this.inputTextArea = input;

        const output = outputContainer.createEl("textarea");
        output.rows = 8;
        output.cols = 30;
        output.readOnly = true;
        output.placeholder = "Filtered content will appear here";
        this.outputTextArea = output;

        input.addEventListener("input", () => {
            this.settingsService.update({ regexpTestInputText: input.value });
            this.run();
        });
    }

    run(): void {
        const input = this.inputTextArea;
        const output = this.outputTextArea;
        if (!input || !output) return;

        let outputText = input.value || "";
        try {
            for (const pattern of this.settingsService.get()
                .excludeRegexPatterns) {
                outputText = outputText.replace(new RegExp(pattern, "gm"), "");
            }
            output.value = outputText;
        } catch (e) {
            output.value = `Error processing RegExp: ${(e as Error).message}`;
        }
    }

    reset(): void {
        this.inputTextArea = undefined;
        this.outputTextArea = undefined;
    }
}
