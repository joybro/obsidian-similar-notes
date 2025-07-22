import { NoteChunk } from "@/domain/model/NoteChunk";
import type { NoteChunkRepository } from "@/domain/repository/NoteChunkRepository";
import { WorkerManager } from "@/infrastructure/WorkerManager";
import * as Comlink from "comlink";
import log from "loglevel";
import type { Vault } from "obsidian";
import type { OramaWorker } from "./orama.worker";
// @ts-ignore
import InlineWorker from "./orama.worker";

export class OramaNoteChunkRepository implements NoteChunkRepository {
    private workerManager: WorkerManager<OramaWorker>;

    constructor(private readonly vault: Vault) {
        this.workerManager = new WorkerManager<OramaWorker>("OramaWorker");
    }

    async init(
        vectorSize: number,
        filepath: string,
        loadFromFile: boolean
    ): Promise<void> {
        const worker = await this.workerManager.initialize(InlineWorker);

        await worker.init(
            Comlink.proxy(this.vault.adapter),
            vectorSize,
            filepath,
            loadFromFile
        );
    }

    async persist(): Promise<void> {
        this.workerManager.ensureInitialized();
        const worker = this.workerManager.getWorker();
        await worker.persist();
    }

    async put(noteChunk: NoteChunk): Promise<void> {
        this.workerManager.ensureInitialized();
        const worker = this.workerManager.getWorker();
        await worker.put(noteChunk.toDTO());
    }

    async putMulti(chunks: NoteChunk[]): Promise<void> {
        this.workerManager.ensureInitialized();
        const worker = this.workerManager.getWorker();
        await worker.putMulti(chunks.map((chunk) => chunk.toDTO()));
    }

    async removeByPath(path: string): Promise<boolean> {
        this.workerManager.ensureInitialized();
        const worker = this.workerManager.getWorker();
        return await worker.removeByPath(path);
    }

    async findSimilarChunks(
        queryEmbedding: number[],
        limit: number,
        minScore?: number,
        excludePaths?: string[]
    ): Promise<{ chunk: NoteChunk; score: number }[]> {
        this.workerManager.ensureInitialized();
        const worker = this.workerManager.getWorker();
        return await worker
            .findSimilarChunks(queryEmbedding, limit, minScore, excludePaths)
            .then((chunks) =>
                chunks.map((chunk) => ({
                    ...chunk,
                    chunk: NoteChunk.fromDTO(chunk.chunk),
                }))
            );
    }

    async count(): Promise<number> {
        this.workerManager.ensureInitialized();
        const worker = this.workerManager.getWorker();
        return await worker.count();
    }

    public setLogLevel(level: log.LogLevelDesc): void {
        log.setLevel(level);
        log.info(
            `OramaNoteChunkRepository log level set to: ${log.getLevel()}`
        );

        this.workerManager.updateLogLevel(level);
    }

    /**
     * Dispose the repository and clean up resources
     * Should be called when the plugin is unloaded
     */
    public async dispose(): Promise<void> {
        try {
            await this.workerManager.dispose();
        } catch (error) {
            log.error("Error during OramaNoteChunkRepository disposal:", error);
        }
    }
}
