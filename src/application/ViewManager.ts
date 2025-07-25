import type { Component } from "obsidian";
import type { MarkdownView, WorkspaceLeaf } from "obsidian";

/**
 * Generic interface for managing view instances across workspace leaves
 */
export interface ViewManager<TView extends Component> {
    /**
     * Called when a workspace leaf becomes active
     */
    onActiveLeafChange(leaf: WorkspaceLeaf | null): Promise<void>;

    /**
     * Called when the workspace layout changes
     */
    onLayoutChange(): Promise<void>;

    /**
     * Clean up all managed views
     */
    onUnload(): Promise<void>;

    /**
     * Get all currently managed views
     */
    getManagedViews(): Map<MarkdownView, TView>;

    /**
     * Check if a view is managed for the given MarkdownView
     */
    hasView(markdownView: MarkdownView): boolean;

    /**
     * Get the managed view for a MarkdownView, if it exists
     */
    getView(markdownView: MarkdownView): TView | undefined;
}

/**
 * Configuration for view creation
 */
export interface ViewCreationConfig<TView extends Component> {
    /**
     * Determines if a view should be created for the given MarkdownView
     */
    shouldCreateView(markdownView: MarkdownView): boolean;

    /**
     * Creates and attaches a view to the given MarkdownView
     */
    createView(markdownView: MarkdownView): Promise<TView | null>;

    /**
     * Called when settings change that might affect view creation
     */
    onSettingsChange?(changes: Record<string, any>): void;
}