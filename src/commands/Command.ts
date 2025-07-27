import type { Plugin } from "obsidian";

export interface Command {
    id: string;
    name: string;
    register(plugin: Plugin): void;
}