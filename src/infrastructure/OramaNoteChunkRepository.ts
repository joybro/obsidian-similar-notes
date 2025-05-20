import { NoteChunk } from "@/domain/model/NoteChunk";
import type { NoteChunkDTO } from "@/domain/model/NoteChunkDTO";
import type { NoteChunkRepository } from "@/domain/repository/NoteChunkRepository";
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
import log from "loglevel";
import type { Vault } from "obsidian";

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

export class OramaNoteChunkRepository implements NoteChunkRepository {
    private hasChanges = false;
    private db: Orama<Schema> | null = null;
    private schema: Schema;
    private vectorSize: number;
    private filepath: string;

    constructor(private readonly vault: Vault) {}

    async init(vectorSize: number, filepath: string): Promise<void> {
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

        this.hasChanges = false;
    }

    async reset(): Promise<void> {
        this.db = await create({
            schema: this.schema,
        });
    }

    async persist(): Promise<void> {
        if (!this.filepath) {
            throw new Error("No filepath specified for saving");
        }
        if (!this.hasChanges || !this.db) {
            return;
        }
        const JSONIndex = await persist(this.db, "json");
        const adapter = this.vault.adapter;
        if (JSONIndex === undefined) {
            throw new Error("Failed to persist OramaNoteChunkRepository");
        }

        if (typeof JSONIndex === "string") {
            await adapter.write(this.filepath, JSONIndex);
        } else {
            await adapter.writeBinary(this.filepath, JSONIndex);
        }
        this.hasChanges = false;
    }

    async restore(): Promise<void> {
        try {
            const adapter = this.vault.adapter;
            const exists = await adapter.exists(this.filepath);
            if (!exists) {
                this.db = await create({
                    schema: this.schema,
                });
            } else {
                const JSONIndex = await adapter.read(this.filepath);
                this.db = (await restore("json", JSONIndex)) as Orama<Schema>;
            }
            this.hasChanges = false;
        } catch (error) {
            log.error("Failed to load OramaNoteChunkRepository", error);
        }
    }

    async put(noteChunk: NoteChunk): Promise<void> {
        if (!this.db) {
            throw new Error("Database not loaded");
        }
        const pathHash = await this.calculatePathHash(noteChunk.path);
        const internalNoteChunk: NoteChunkInternal = {
            ...noteChunk.toDTO(),
            pathHash,
        };
        await insert(this.db, internalNoteChunk as Doc);
        this.hasChanges = true;
    }

    async putMulti(chunks: NoteChunk[]): Promise<void> {
        if (!this.db) {
            throw new Error("Database not loaded");
        }
        const internalChunks = await Promise.all(
            chunks.map(async (chunk) => ({
                ...chunk.toDTO(),
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
    ): Promise<{ chunk: NoteChunk; score: number }[]> {
        if (!this.db) {
            throw new Error("Database not loaded");
        }

        const batchSize = limit * 2;
        let offset = 0;
        let allResults: { chunk: NoteChunk; score: number }[] = [];

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
                        chunk: NoteChunk.fromDTO(dto),
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
