import { NoteChunk } from "@/domain/model/NoteChunk";
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

        await this.worker.setLogLevel(log.getLevel());

        await this.worker.init(
            Comlink.proxy(this.vault.adapter),
            vectorSize,
            filepath,
            loadFromFile
        );
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
        await this.worker.put(noteChunk.toDTO());
    }

    async putMulti(chunks: NoteChunk[]): Promise<void> {
        if (!this.worker) {
            throw new Error("Worker not initialized");
        }
        await this.worker.putMulti(chunks.map((chunk) => chunk.toDTO()));
    }

    async removeByPath(path: string): Promise<boolean> {
        if (!this.worker) {
            throw new Error("Worker not initialized");
        }
        return await this.worker.removeByPath(path);
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
        return await this.worker
            .findSimilarChunks(queryEmbedding, limit, minScore, excludePaths)
            .then((chunks) =>
                chunks.map((chunk) => ({
                    ...chunk,
                    chunk: NoteChunk.fromDTO(chunk.chunk),
                }))
            );
    }

    async count(): Promise<number> {
        if (!this.worker) {
            throw new Error("Worker not initialized");
        }
        return await this.worker.count();
    }

    async countUniqueNotes(): Promise<number> {
        if (!this.worker) {
            throw new Error("Worker not initialized");
        }
        return await this.worker.countUniqueNotes();
    }

    public setLogLevel(level: log.LogLevelDesc): void {
        log.setLevel(level);
        log.info(
            `OramaNoteChunkRepository log level set to: ${log.getLevel()}`
        );

        if (this.worker) {
            this.worker
                .setLogLevel(level)
                .catch((err) =>
                    log.error("Failed to set log level on OramaWorker", err)
                );
        }
    }
}
