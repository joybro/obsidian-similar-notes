import { Plugin } from "obsidian";
import SimilarNotesPlugin from "./SimilarNotesPlugin";

export default class MainPlugin extends Plugin {
    private similarNotesPlugin: SimilarNotesPlugin;

    async onload() {
        console.log("Loading Similar Notes plugin");

        // 플러그인 인스턴스 생성 및 초기화
        this.similarNotesPlugin = new SimilarNotesPlugin(this.app, this);
        await this.similarNotesPlugin.onload();
    }

    onunload() {
        console.log("Unloading Similar Notes plugin");

        // 플러그인 정리
        if (this.similarNotesPlugin) {
            this.similarNotesPlugin.onunload();
        }
    }
}
