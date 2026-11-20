// Mock minimal Obsidian types and interfaces needed for testing.
// This file is what `import ... from "obsidian"` resolves to in tests
// (via the alias in vitest.config.ts) — the real obsidian package is
// types-only ("main": ""). Add missing exports HERE. Individual test
// files may still override with their own vi.mock("obsidian", factory).
export const Platform = {
    isMobileApp: false,
    isIosApp: false,
    isAndroidApp: false,
    isDesktopApp: true,
    isMacOS: false,
    isWin: false,
    isLinux: true,
};

export const apiVersion = "1.12.0";

// Tests flip this to exercise the Obsidian 1.13+ declarative path.
export const mockApiState = { version: "1.12.0" };

function compareVersions(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d !== 0) return d;
    }
    return 0;
}

export function requireApiVersion(version: string): boolean {
    return compareVersions(mockApiState.version, version) >= 0;
}

export class PluginSettingTab {
    app: unknown;
    containerEl: HTMLElement;
    updateCalls = 0;

    constructor(app: unknown, _plugin: unknown) {
        this.app = app;
        this.containerEl = document.createElement("div");
    }

    update(): void {
        this.updateCalls++;
    }

    refreshDomState(): void {
        // Mock implementation
    }

    display(): void {
        // Mock implementation
    }
    hide(): void {
        // Mock implementation
    }
}

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
        this.settingEl.className = "setting-item";
        this.infoEl = document.createElement("div");
        this.infoEl.className = "setting-item-info";
        this.nameEl = document.createElement("div");
        this.nameEl.className = "setting-item-name";
        this.descEl = document.createElement("div");
        this.descEl.className = "setting-item-description";
        this.controlEl = document.createElement("div");
        this.controlEl.className = "setting-item-control";
        this.infoEl.appendChild(this.nameEl);
        this.infoEl.appendChild(this.descEl);
        this.settingEl.appendChild(this.infoEl);
        this.settingEl.appendChild(this.controlEl);
        containerEl.appendChild(this.settingEl);
    }

    setClass(cls: string): this {
        this.settingEl.classList.add(cls);
        return this;
    }

    addTextArea(callback: (text: MockText) => void): this {
        callback(makeMockText(document.createElement("textarea")));
        return this;
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
        callback(makeMockText(document.createElement("input")));
        return this;
    }

    addDropdown(callback: (dropdown: MockDropdown) => void): this {
        const mockDropdown: MockDropdown = {
            addOption: (_value: string, _text: string) => mockDropdown,
            setValue: (_value: string) => mockDropdown,
            onChange: (_callback: (value: string) => void) => mockDropdown,
            selectEl: Object.assign(document.createElement("select"), { empty: () => { return; } }),
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
            buttonEl: document.createElement("button"),
        };
        callback(mockButton);
        return this;
    }
}

// Mock SettingGroup: a heading element followed by its settings, in the
// container, so tests can read "heading -> setting names" from the DOM.
export class SettingGroup {
    groupEl: HTMLElement;
    headingEl: HTMLElement;

    constructor(containerEl: HTMLElement) {
        this.groupEl = document.createElement("div");
        this.groupEl.className = "setting-group";
        this.headingEl = document.createElement("div");
        this.headingEl.className = "setting-group-heading";
        this.groupEl.appendChild(this.headingEl);
        containerEl.appendChild(this.groupEl);
    }

    setHeading(heading: string): this {
        this.headingEl.textContent = heading;
        return this;
    }

    addSetting(cb: (setting: Setting) => void): this {
        cb(new Setting(this.groupEl));
        return this;
    }
}

// Mock types for Setting methods
interface MockText {
    setValue: (value: string) => MockText;
    onChange: (callback: (value: string) => void) => MockText;
    setPlaceholder: (placeholder: string) => MockText;
    inputEl: HTMLInputElement | HTMLTextAreaElement;
}

function makeMockText(inputEl: HTMLInputElement | HTMLTextAreaElement): MockText {
    const mockText: MockText = {
        setValue: (_value: string) => mockText,
        onChange: (_callback: (value: string) => void) => mockText,
        setPlaceholder: (_placeholder: string) => mockText,
        inputEl,
    };
    return mockText;
}

interface MockDropdown {
    addOption: (value: string, text: string) => MockDropdown;
    setValue: (value: string) => MockDropdown;
    onChange: (callback: (value: string) => void) => MockDropdown;
    selectEl: HTMLSelectElement & { empty: () => void };
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
    buttonEl: HTMLButtonElement;
}

// Obsidian-style methods type for prototype extension
type ObsidianHTMLElementMethods = {
    createDiv(className?: string): HTMLDivElement;
    createEl(tagName: string, className?: string): HTMLElement;
};

// Only add these extensions in test environment to avoid type conflicts
if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
    // Add createDiv method to HTMLElement prototype for testing
    if (typeof window !== 'undefined' && window.HTMLElement && !(HTMLElement.prototype as unknown as ObsidianHTMLElementMethods).createDiv) {
        (HTMLElement.prototype as unknown as ObsidianHTMLElementMethods).createDiv = function(this: HTMLElement, className?: string): HTMLDivElement {
            const div = document.createElement('div');
            if (className) {
                div.className = className;
            }
            this.appendChild(div);
            return div;
        };

        (HTMLElement.prototype as unknown as ObsidianHTMLElementMethods).createEl = function(this: HTMLElement, tagName: string, className?: string): HTMLElement {
            const el = document.createElement(tagName);
            if (className) {
                el.className = className;
            }
            this.appendChild(el);
            return el;
        };
    }
}

// Further Obsidian DOM helpers the settings tab uses (addClass, setText, ...).
type ObsidianDomInfo = { cls?: string; text?: string };
type ObsidianHTMLElementExtras = {
    addClass(...cls: string[]): void;
    removeClass(...cls: string[]): void;
    setText(text: string): void;
    empty(): void;
    isShown(): boolean;
    createSpan(o?: ObsidianDomInfo | string): HTMLSpanElement;
};

if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test' && typeof window !== 'undefined') {
    const proto = HTMLElement.prototype as unknown as ObsidianHTMLElementExtras & ObsidianHTMLElementMethods;
    const applyInfo = <T extends HTMLElement>(el: T, o?: ObsidianDomInfo | string): T => {
        if (typeof o === "string") el.className = o;
        else if (o) {
            if (o.cls) el.className = o.cls;
            if (o.text) el.textContent = o.text;
        }
        return el;
    };
    if (!proto.addClass) {
        proto.addClass = function (this: HTMLElement, ...cls: string[]) { this.classList.add(...cls); };
        proto.removeClass = function (this: HTMLElement, ...cls: string[]) { this.classList.remove(...cls); };
        proto.setText = function (this: HTMLElement, text: string) { this.textContent = text; };
        proto.empty = function (this: HTMLElement) { this.replaceChildren(); };
        proto.isShown = function (this: HTMLElement) { return this.isConnected; };
        proto.createDiv = function (this: HTMLElement, o?: ObsidianDomInfo | string) {
            const div = applyInfo(document.createElement("div"), o);
            this.appendChild(div);
            return div;
        };
        proto.createSpan = function (this: HTMLElement, o?: ObsidianDomInfo | string) {
            const span = applyInfo(document.createElement("span"), o);
            this.appendChild(span);
            return span;
        };
        proto.createEl = function (this: HTMLElement, tag: string, o?: ObsidianDomInfo | string) {
            const el = applyInfo(document.createElement(tag), o);
            this.appendChild(el);
            return el;
        };
        (globalThis as unknown as { createDiv: (o?: ObsidianDomInfo | string) => HTMLDivElement }).createDiv =
            (o?: ObsidianDomInfo | string) => applyInfo(document.createElement("div"), o);
    }
}

// Add any other Obsidian types/interfaces as needed for tests
