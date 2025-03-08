import {
    type Orama,
    type SearchParams,
    type TypedDocument,
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
} from "./embedded-chunk-store";

type Schema = {
    id: "string";
    path: "string";
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

    constructor(vault: Vault, filepath: string, vectorSize: number) {
        this.vault = vault;
        this.filepath = filepath;
        this.schema = {
            id: "string",
            path: "string",
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
    }

    async clear(): Promise<void> {
        await this.init();
    }

    async close(): Promise<void> {}

    async save(): Promise<void> {
        if (!this.filepath) {
            throw new Error("No filepath specified for saving");
        }
        const JSONIndex = await persist(this.db, "json");
        if (typeof JSONIndex === "string") {
            this.vault.create(this.filepath, JSONIndex);
        } else {
            this.vault.createBinary(this.filepath, JSONIndex);
        }
    }

    async load(): Promise<void> {
        try {
            const file = this.vault.getFileByPath(this.filepath);
            if (!file) {
                throw new Error("File not found");
            }
            const JSONIndex = await this.vault.read(file);
            this.db = await restore("json", JSONIndex);
        } catch (error) {
            // If loading fails, initialize a new DB
            await this.init();
        }
    }

    async add(chunk: EmbeddedChunk): Promise<void> {
        await insert(this.db, chunk as Doc);
    }

    async addMulti(chunks: EmbeddedChunk[]): Promise<void> {
        await insertMultiple(this.db, chunks as Doc[]);
    }

    async update(id: string, updates: Partial<EmbeddedChunk>): Promise<void> {
        // orama recommends not to use update.
        throw new Error("orama recommends not to use update.");
    }

    async getByPath(path: string): Promise<EmbeddedChunk[]> {
        const results = await search(this.db, {
            term: path,
            properties: ["path"],
            exact: true,
        });
        return (
            results.hits
                // orama 3.1.1 has a bug on exact match
                // https://github.com/oramasearch/orama/issues/866
                .filter((hit) => hit.document.path === path)
                .map((hit) => hit.document as unknown as EmbeddedChunk)
        );
    }

    async removeByPath(path: string): Promise<void> {
        const results = await search(this.db, {
            term: path,
            properties: ["path"],
            exact: true,
        });

        // orama 3.1.1 has a bug on exact match
        // https://github.com/oramasearch/orama/issues/866
        const filtered = results.hits.filter(
            (hit) => hit.document.path === path
        );

        for (const hit of filtered) {
            await remove(this.db, hit.id);
        }
    }

    async removeById(id: string): Promise<void> {
        const results = await search(this.db, {
            term: id,
            properties: ["id"],
            exact: true,
        });
        if (results.hits.length > 0) {
            await remove(this.db, results.hits[0].id);
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
}
