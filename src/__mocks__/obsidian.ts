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
    constructor(message: string, duration?: number) {
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

    addText(callback: (text: any) => void): this {
        const mockText = {
            setValue: (value: string) => mockText,
            onChange: (callback: (value: string) => void) => mockText,
            setPlaceholder: (placeholder: string) => mockText,
        };
        callback(mockText);
        return this;
    }

    addDropdown(callback: (dropdown: any) => void): this {
        const mockDropdown = {
            addOption: (value: string, text: string) => mockDropdown,
            setValue: (value: string) => mockDropdown,
            onChange: (callback: (value: string) => void) => mockDropdown,
            selectEl: { empty: () => {} },
        };
        callback(mockDropdown);
        return this;
    }

    addToggle(callback: (toggle: any) => void): this {
        const mockToggle = {
            setValue: (value: boolean) => mockToggle,
            onChange: (callback: (value: boolean) => void) => mockToggle,
        };
        callback(mockToggle);
        return this;
    }

    addButton(callback: (button: any) => void): this {
        const mockButton = {
            setButtonText: (text: string) => mockButton,
            setTooltip: (tooltip: string) => mockButton,
            onClick: (callback: () => void) => mockButton,
            setDisabled: (disabled: boolean) => mockButton,
            setCta: () => mockButton,
            removeCta: () => mockButton,
        };
        callback(mockButton);
        return this;
    }
}

// Only add these extensions in test environment to avoid type conflicts
if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
    // Add createDiv method to HTMLElement prototype for testing
    if (typeof window !== 'undefined' && window.HTMLElement && !HTMLElement.prototype.createDiv) {
        (HTMLElement.prototype as any).createDiv = function(className?: string): HTMLDivElement {
            const div = document.createElement('div');
            if (className) {
                div.className = className;
            }
            this.appendChild(div);
            return div;
        };

        (HTMLElement.prototype as any).createEl = function(tagName: string, className?: string): HTMLElement {
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
