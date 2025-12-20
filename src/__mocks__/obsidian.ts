// Mock minimal Obsidian types and interfaces needed for testing
export class TFile {
    path: string;
    basename: string;
    extension: string;

    constructor(path: string) {
        this.path = path;
        const parts = path.split(".");
        this.extension = parts.pop() || "";
        this.basename = parts.join(".");
    }
}

export interface App {
    workspace: {
        getLeaf: () => {
            openFile: (file: TFile) => Promise<void>;
        };
    };
}

// Mock Modal class
export class Modal {
    app: App;
    containerEl: HTMLElement;

    constructor(app: App) {
        this.app = app;
        this.containerEl = document.createElement("div");
    }

    open(): void {
        // Mock implementation
    }

    close(): void {
        // Mock implementation
    }

    onOpen(): void {
        // Mock implementation
    }

    onClose(): void {
        // Mock implementation
    }
}

// Mock Notice class
export class Notice {
    constructor(_message: string, _duration?: number) {
        // Mock implementation
    }
}

// Mock Setting class
export class Setting {
    settingEl: HTMLElement;
    infoEl: HTMLElement;
    nameEl: HTMLElement;
    descEl: HTMLElement;
    controlEl: HTMLElement;

    constructor(containerEl: HTMLElement) {
        this.settingEl = document.createElement("div");
        this.infoEl = document.createElement("div");
        this.nameEl = document.createElement("div");
        this.descEl = document.createElement("div");
        this.controlEl = document.createElement("div");
        containerEl.appendChild(this.settingEl);
    }

    setName(name: string): this {
        this.nameEl.textContent = name;
        return this;
    }

    setDesc(desc: string): this {
        this.descEl.textContent = desc;
        return this;
    }

    setHeading(): this {
        return this;
    }

    addText(callback: (text: MockText) => void): this {
        const mockText: MockText = {
            setValue: (_value: string) => mockText,
            onChange: (_callback: (value: string) => void) => mockText,
            setPlaceholder: (_placeholder: string) => mockText,
        };
        callback(mockText);
        return this;
    }

    addDropdown(callback: (dropdown: MockDropdown) => void): this {
        const mockDropdown: MockDropdown = {
            addOption: (_value: string, _text: string) => mockDropdown,
            setValue: (_value: string) => mockDropdown,
            onChange: (_callback: (value: string) => void) => mockDropdown,
            selectEl: { empty: () => { return; } },
        };
        callback(mockDropdown);
        return this;
    }

    addToggle(callback: (toggle: MockToggle) => void): this {
        const mockToggle: MockToggle = {
            setValue: (_value: boolean) => mockToggle,
            onChange: (_callback: (value: boolean) => void) => mockToggle,
        };
        callback(mockToggle);
        return this;
    }

    addButton(callback: (button: MockButton) => void): this {
        const mockButton: MockButton = {
            setButtonText: (_text: string) => mockButton,
            setTooltip: (_tooltip: string) => mockButton,
            onClick: (_callback: () => void) => mockButton,
            setDisabled: (_disabled: boolean) => mockButton,
            setCta: () => mockButton,
            removeCta: () => mockButton,
        };
        callback(mockButton);
        return this;
    }
}

// Mock types for Setting methods
interface MockText {
    setValue: (value: string) => MockText;
    onChange: (callback: (value: string) => void) => MockText;
    setPlaceholder: (placeholder: string) => MockText;
}

interface MockDropdown {
    addOption: (value: string, text: string) => MockDropdown;
    setValue: (value: string) => MockDropdown;
    onChange: (callback: (value: string) => void) => MockDropdown;
    selectEl: { empty: () => void };
}

interface MockToggle {
    setValue: (value: boolean) => MockToggle;
    onChange: (callback: (value: boolean) => void) => MockToggle;
}

interface MockButton {
    setButtonText: (text: string) => MockButton;
    setTooltip: (tooltip: string) => MockButton;
    onClick: (callback: () => void) => MockButton;
    setDisabled: (disabled: boolean) => MockButton;
    setCta: () => MockButton;
    removeCta: () => MockButton;
}

// Extend HTMLElement interface for Obsidian-style methods
interface ObsidianHTMLElement extends HTMLElement {
    createDiv(className?: string): HTMLDivElement;
    createEl(tagName: string, className?: string): HTMLElement;
}

// Only add these extensions in test environment to avoid type conflicts
if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
    // Add createDiv method to HTMLElement prototype for testing
    if (typeof window !== 'undefined' && window.HTMLElement && !(HTMLElement.prototype as ObsidianHTMLElement).createDiv) {
        (HTMLElement.prototype as ObsidianHTMLElement).createDiv = function(className?: string): HTMLDivElement {
            const div = document.createElement('div');
            if (className) {
                div.className = className;
            }
            this.appendChild(div);
            return div;
        };

        (HTMLElement.prototype as ObsidianHTMLElement).createEl = function(tagName: string, className?: string): HTMLElement {
            const el = document.createElement(tagName);
            if (className) {
                el.className = className;
            }
            this.appendChild(el);
            return el;
        };
    }
}

// Add any other Obsidian types/interfaces as needed for tests
