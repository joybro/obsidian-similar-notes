import type { NoteChunkDTO } from "@/domain/model/NoteChunkDTO";
import {
    type Orama,
    type SearchParams,
    type TypedDocument,
    count,
    create,
    insert,
    insertMultiple,
    remove,
    search,
} from "@orama/orama";
import { persist, restore } from "@orama/plugin-data-persistence";
import * as comlink from "comlink";
import log from "loglevel";
import type { DataAdapter } from "obsidian";

type Schema = {
    path: "string";
    pathHash: "string";
    title: "string";
    embedding: `vector[${number}]`;
    lastUpdated: "number";
    content: "string";
    chunkIndex: "number";
    totalChunks: "number";
};
type Doc = TypedDocument<Orama<Schema>>;

type NoteChunkInternal = NoteChunkDTO & {
    pathHash: string;
};

class OramaWorker {
    private hasChanges = false;
    private db: Orama<Schema> | null = null;
    private schema: Schema;
    private vectorSize: number;
    private filepath: string;
    private adapter: DataAdapter;

    async init(
        adapter: DataAdapter,
        vectorSize: number,
        filepath: string,
        loadFromFile: boolean
    ): Promise<void> {
        this.adapter = adapter;
        this.vectorSize = vectorSize;
        this.filepath = filepath;
        this.db = null;
        this.schema = {
            path: "string",
            pathHash: "string",
            title: "string",
            embedding: `vector[${this.vectorSize}]`,
            lastUpdated: "number",
            content: "string",
            chunkIndex: "number",
            totalChunks: "number",
        } as const;

        try {
            const exists = await this.adapter.exists(this.filepath);
            if (exists && loadFromFile) {
                const JSONIndex = await this.adapter.read(this.filepath);
                this.db = (await restore("json", JSONIndex)) as Orama<Schema>;
            } else {
                this.db = await create({
                    schema: this.schema,
                });
            }
            this.hasChanges = false;
        } catch (error) {
            log.error("Failed to load database", error);
        }
    }

    async persist(): Promise<void> {
        const startTime = performance.now();
        log.info("Starting persist() operation");

        if (!this.filepath) {
            throw new Error("No filepath specified for saving");
        }
        if (!this.hasChanges || !this.db) {
            return;
        }
        const JSONIndex = await persist(this.db, "json");
        if (JSONIndex === undefined) {
            throw new Error("Failed to persist database");
        }

        if (typeof JSONIndex === "string") {
            await this.adapter.write(this.filepath, JSONIndex);
        } else {
            await this.adapter.writeBinary(this.filepath, JSONIndex);
        }
        this.hasChanges = false;

        const endTime = performance.now();
        const elapsedTime = endTime - startTime;
        log.info(
            `Completed persist() operation in ${elapsedTime.toFixed(2)}ms`
        );
    }

    async put(noteChunk: NoteChunkDTO): Promise<void> {
        if (!this.db) {
            throw new Error("Database not loaded");
        }
        const pathHash = await this.calculatePathHash(noteChunk.path);
        const internalNoteChunk: NoteChunkInternal = {
            ...noteChunk,
            pathHash,
        };
        await insert(this.db, internalNoteChunk as Doc);
        this.hasChanges = true;
    }

    async putMulti(chunks: NoteChunkDTO[]): Promise<void> {
        if (!this.db) {
            throw new Error("Database not loaded");
        }
        const internalChunks = await Promise.all(
            chunks.map(async (chunk) => ({
                ...chunk,
                pathHash: await this.calculatePathHash(chunk.path),
            }))
        );
        await insertMultiple(this.db, internalChunks as Doc[]);
        this.hasChanges = true;
    }

    /**
     * Helper function to calculate a SHA-256 hash for a filepath
     */
    private async calculatePathHash(path: string): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(path);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
    }

    async removeByPath(path: string): Promise<void> {
        if (!this.db) {
            throw new Error("Database not loaded");
        }
        const pathHash = await this.calculatePathHash(path);
        const results = await search(this.db, {
            term: pathHash,
            properties: ["pathHash"],
            exact: true,
            limit: 100,
        });

        if (results.hits.length > 0) {
            for (const hit of results.hits) {
                await remove(this.db, hit.id);
            }
            this.hasChanges = true;
        }
    }

    async findSimilarChunks(
        queryEmbedding: number[],
        limit: number,
        minScore?: number,
        excludePaths?: string[]
    ): Promise<{ chunk: NoteChunkDTO; score: number }[]> {
        if (!this.db) {
            throw new Error("Database not loaded");
        }

        const batchSize = limit * 2;
        let offset = 0;
        let allResults: { chunk: NoteChunkDTO; score: number }[] = [];

        while (true) {
            const searchParams: SearchParams<Orama<Schema>> = {
                mode: "vector",
                vector: {
                    value: queryEmbedding,
                    property: "embedding",
                },
                similarity: minScore ?? 0,
                limit: batchSize,
                offset: offset,
            };

            const results = await search(this.db, searchParams);

            // If no more results found, break the loop
            if (results.hits.length === 0) {
                break;
            }

            // Filter results based on excludePaths
            const filteredHits = results.hits.filter((hit) => {
                if (excludePaths) {
                    return !excludePaths.includes(hit.document.path);
                }
                return true;
            });

            // Add filtered results to our collection
            allResults = allResults.concat(
                filteredHits.map((hit) => {
                    const doc = hit.document as unknown as Doc;
                    const dto: NoteChunkDTO = {
                        path: doc.path,
                        title: doc.title,
                        content: doc.content,
                        chunkIndex: doc.chunkIndex,
                        totalChunks: doc.totalChunks,
                        embedding: doc.embedding as unknown as number[],
                    };
                    return {
                        chunk: dto,
                        score: hit.score,
                    };
                })
            );

            // If we have enough results, break the loop
            if (allResults.length >= limit) {
                allResults = allResults.slice(0, limit);
                break;
            }

            // Increment offset for next batch
            offset += batchSize;
        }

        return allResults;
    }

    count(): number {
        if (!this.db) {
            throw new Error("Database not loaded");
        }
        return count(this.db);
    }
}

export type { OramaWorker };

comlink.expose(OramaWorker);
