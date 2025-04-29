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

    constructor(
        private readonly vault: Vault,
        private readonly vectorSize: number,
        private readonly filepath: string
    ) {
        this.hasChanges = false;
        this.db = null;
        this.schema = {
            path: "string",
            pathHash: "string",
            title: "string",
            embedding: `vector[${vectorSize}]`,
            lastUpdated: "number",
            content: "string",
            chunkIndex: "number",
            totalChunks: "number",
        } as const;
    }

    async flush(): Promise<void> {
        if (!this.filepath) {
            throw new Error("No filepath specified for saving");
        }
        if (!this.hasChanges || !this.db) {
            return;
        }
        const JSONIndex = await persist(this.db, "json");
        const adapter = this.vault.adapter;

        if (typeof JSONIndex === "string") {
            await adapter.write(this.filepath, JSONIndex);
        } else {
            await adapter.writeBinary(this.filepath, JSONIndex);
        }
        this.hasChanges = false;
    }

    async load(): Promise<void> {
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

    async save(noteChunk: NoteChunk): Promise<void> {
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

    async saveMulti(chunks: NoteChunk[]): Promise<void> {
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

    async deleteByPath(path: string): Promise<void> {
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
    ): Promise<[NoteChunk, number][]> {
        if (!this.db) {
            throw new Error("Database not loaded");
        }

        const batchSize = limit * 2;
        let offset = 0;
        let allResults: [NoteChunk, number][] = [];

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
                filteredHits
                    .map((hit) => ({
                        chunk: hit.document as unknown as NoteChunkInternal,
                        score: hit.score,
                    }))
                    .map(({ chunk, score }) => [
                        NoteChunk.fromDTO(chunk),
                        score,
                    ])
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
