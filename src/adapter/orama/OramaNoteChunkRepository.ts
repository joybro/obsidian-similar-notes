import type { NoteChunk } from "@/domain/model/NoteChunk";
import type { NoteChunkRepository } from "@/domain/repository/NoteChunkRepository";
import * as Comlink from "comlink";
import log from "loglevel";
import type { Vault } from "obsidian";
import type { OramaWorker } from "./orama.worker";
// @ts-ignore
import InlineWorker from "./orama.worker";

export class OramaNoteChunkRepository implements NoteChunkRepository {
    private worker: Comlink.Remote<OramaWorker> | null = null;

    constructor(private readonly vault: Vault) {}

    async init(
        vectorSize: number,
        filepath: string,
        loadFromFile: boolean
    ): Promise<void> {
        const WorkerWrapper = Comlink.wrap(new InlineWorker());
        // @ts-ignore
        this.worker = await new WorkerWrapper();
        log.info("Worker initialized", this.worker);
        if (!this.worker) {
            throw new Error("Worker not initialized");
        }

        await this.worker.init(vectorSize, filepath, loadFromFile);
    }

    async persist(): Promise<void> {
        if (!this.worker) {
            throw new Error("Worker not initialized");
        }
        await this.worker.persist();
    }

    async put(noteChunk: NoteChunk): Promise<void> {
        if (!this.worker) {
            throw new Error("Worker not initialized");
        }
        await this.worker.put(noteChunk);
    }

    async putMulti(chunks: NoteChunk[]): Promise<void> {
        if (!this.worker) {
            throw new Error("Worker not initialized");
        }
        await this.worker.putMulti(chunks);
    }

    async removeByPath(path: string): Promise<void> {
        if (!this.worker) {
            throw new Error("Worker not initialized");
        }
        await this.worker.removeByPath(path);
    }

    async findSimilarChunks(
        queryEmbedding: number[],
        limit: number,
        minScore?: number,
        excludePaths?: string[]
    ): Promise<{ chunk: NoteChunk; score: number }[]> {
        if (!this.worker) {
            throw new Error("Worker not initialized");
        }
        return await this.worker.findSimilarChunks(
            queryEmbedding,
            limit,
            minScore,
            excludePaths
        );
    }

    count(): number {
        if (!this.worker) {
            throw new Error("Worker not initialized");
        }
        return this.worker.count();
    }
}
