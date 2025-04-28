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
import type { Vault } from "obsidian";
import type {
    EmbeddedChunk,
    EmbeddedChunkStore,
    SearchResult,
} from "./embeddedChunkStore";

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
export class OramaEmbeddedChunkStore implements EmbeddedChunkStore {
    private db!: Orama<Schema>;
    private vault: Vault;
    private filepath: string;
    private schema: Schema;
    private hasChanges = false;

    constructor(vault: Vault, filepath: string, vectorSize: number) {
        this.vault = vault;
        this.filepath = filepath;
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

    async init() {
        this.db = await create({
            schema: this.schema,
        });
        this.hasChanges = false;
    }

    async clear(): Promise<void> {
        await this.init();
        this.hasChanges = true;
    }

    async close(): Promise<void> {}

    async save(): Promise<void> {
        if (!this.filepath) {
            throw new Error("No filepath specified for saving");
        }
        if (!this.hasChanges) {
            return;
        }
        const JSONIndex = await persist(this.db, "json");
        const adapter = this.vault.adapter;

        if (typeof JSONIndex === "string") {
            const exists = await adapter.exists(this.filepath);
            if (exists) {
                await adapter.write(this.filepath, JSONIndex);
            } else {
                await adapter.write(this.filepath, JSONIndex);
            }
        } else {
            const exists = await adapter.exists(this.filepath);
            if (exists) {
                await adapter.writeBinary(this.filepath, JSONIndex);
            } else {
                await adapter.writeBinary(this.filepath, JSONIndex);
            }
        }
        this.hasChanges = false;
    }

    async load(): Promise<void> {
        try {
            const adapter = this.vault.adapter;
            const exists = await adapter.exists(this.filepath);
            if (!exists) {
                throw new Error("File not found");
            }
            const JSONIndex = await adapter.read(this.filepath);
            this.db = await restore("json", JSONIndex);
            this.hasChanges = false;
        } catch (error) {
            // If loading fails, initialize a new DB
            await this.init();
        }
    }

    async add(chunk: EmbeddedChunk): Promise<void> {
        const pathHash = await this.calculatePathHash(chunk.path);
        chunk.pathHash = pathHash;
        await insert(this.db, chunk as Doc);
        this.hasChanges = true;
    }

    async addMulti(chunks: EmbeddedChunk[]): Promise<void> {
        const pathHashes = await Promise.all(
            chunks.map((chunk) => this.calculatePathHash(chunk.path))
        );
        for (let i = 0; i < chunks.length; i++) {
            chunks[i].pathHash = pathHashes[i];
        }
        await insertMultiple(this.db, chunks as Doc[]);
        this.hasChanges = true;
    }

    async update(id: string, updates: Partial<EmbeddedChunk>): Promise<void> {
        // orama recommends not to use update.
        throw new Error("orama recommends not to use update.");
    }

    async getByPath(path: string): Promise<EmbeddedChunk[]> {
        const pathHash = await this.calculatePathHash(path);
        const results = await search(this.db, {
            term: pathHash,
            properties: ["pathHash"],
            exact: true,
        });
        return results.hits.map(
            (hit) => hit.document as unknown as EmbeddedChunk
        );
    }

    async removeByPath(path: string): Promise<void> {
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

    async searchSimilar(
        embedding: number[],
        limit: number,
        minScore?: number,
        excludePaths?: string[]
    ): Promise<SearchResult[]> {
        const batchSize = limit * 2;
        let offset = 0;
        let allResults: SearchResult[] = [];

        while (true) {
            const searchParams: SearchParams<Orama<Schema>> = {
                mode: "vector",
                vector: {
                    value: embedding,
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
                filteredHits.map((hit) => ({
                    chunk: hit.document as unknown as EmbeddedChunk,
                    score: hit.score,
                }))
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
        return count(this.db);
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
}
