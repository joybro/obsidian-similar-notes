import type { NoteChunkDTO } from "@/domain/model/NoteChunkDTO";
import {
    IndexedDBChunkStorage,
    type NoteChunkInternal,
} from "@/infrastructure/IndexedDBChunkStorage";
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
import log from "loglevel";

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

export class OramaWorker {
    private db: Orama<Schema> | null = null;
    private schema: Schema;
    private vectorSize: number;
    private storage: IndexedDBChunkStorage;

    setLogLevel(level: log.LogLevelDesc): void {
        log.setLevel(level);
        log.info(`Worker log level set to: ${log.getLevel()}`);
    }

    async init(
        vectorSize: number,
        vaultId: string,
        loadExistingData: boolean
    ): Promise<void> {
        this.vectorSize = vectorSize;
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
            // Initialize IndexedDB storage with vault-specific ID
            this.storage = new IndexedDBChunkStorage();
            await this.storage.init(vaultId);

            if (!loadExistingData) {
                // Reindex scenario: clear IndexedDB to start fresh
                await this.storage.clear();
                log.info("Cleared IndexedDB for reindexing");
            }

            // Create empty Orama database
            this.db = await create({
                schema: this.schema,
            });

            if (loadExistingData) {
                // Load data from IndexedDB in batches
                log.info("Loading chunks from IndexedDB...");
                let loadedCount = 0;
                await this.storage.loadInBatches(
                    100,
                    async (batch) => {
                        await insertMultiple(this.db!, batch as Doc[]);
                    },
                    (processed, total) => {
                        loadedCount = processed;
                        if (processed % 500 === 0 || processed === total) {
                            log.info(
                                `Loaded ${processed}/${total} chunks from IndexedDB`
                            );
                        }
                    }
                );

                log.info(
                    `Successfully loaded ${loadedCount} chunks from IndexedDB`
                );
            } else {
                log.info("Starting with empty database for reindexing");
            }
        } catch (error) {
            log.error("Failed to initialize database", error);
            throw error;
        }
    }


    async put(noteChunk: NoteChunkDTO): Promise<void> {
        if (!this.db) {
            throw new Error("Database not loaded");
        }

        // Validate chunk before inserting
        if (!this.isValidChunk(noteChunk)) {
            log.error(`Skipping invalid chunk: ${noteChunk.path} (chunk ${noteChunk.chunkIndex})`);
            return;
        }

        const pathHash = await this.calculatePathHash(noteChunk.path);
        const internalNoteChunk: NoteChunkInternal = {
            ...noteChunk,
            pathHash,
            lastUpdated: Date.now(),
        };

        // Insert to both Orama (in-memory) and IndexedDB (persistent)
        await insert(this.db, internalNoteChunk as Doc);
        await this.storage.put(internalNoteChunk);
    }

    async putMulti(chunks: NoteChunkDTO[]): Promise<void> {
        if (!this.db) {
            throw new Error("Database not loaded");
        }

        // Filter out invalid chunks
        const validChunks = chunks.filter(chunk => {
            const isValid = this.isValidChunk(chunk);
            if (!isValid) {
                log.error(`Skipping invalid chunk: ${chunk.path} (chunk ${chunk.chunkIndex})`);
            }
            return isValid;
        });

        if (validChunks.length === 0) {
            log.warn("No valid chunks to insert");
            return;
        }

        const internalChunks: NoteChunkInternal[] = await Promise.all(
            validChunks.map(async (chunk) => ({
                ...chunk,
                pathHash: await this.calculatePathHash(chunk.path),
                lastUpdated: Date.now(),
            }))
        );

        // Insert to both Orama (in-memory) and IndexedDB (persistent)
        await insertMultiple(this.db, internalChunks as Doc[]);
        await this.storage.putMulti(internalChunks);
    }

    /**
     * Validate chunk data before inserting into database
     * Ensures embedding is a non-empty array to prevent schema validation errors
     */
    private isValidChunk(chunk: NoteChunkDTO | NoteChunkInternal): boolean {
        if (!chunk.embedding) {
            log.warn(`Chunk has no embedding: ${chunk.path} (chunk ${chunk.chunkIndex})`);
            return false;
        }
        if (!Array.isArray(chunk.embedding)) {
            log.warn(`Chunk embedding is not an array: ${chunk.path} (chunk ${chunk.chunkIndex})`);
            return false;
        }
        if (chunk.embedding.length === 0) {
            log.warn(`Chunk embedding is empty array: ${chunk.path} (chunk ${chunk.chunkIndex})`);
            return false;
        }
        if (chunk.embedding.length !== this.vectorSize) {
            log.warn(`Chunk embedding size mismatch: expected ${this.vectorSize}, got ${chunk.embedding.length} for ${chunk.path} (chunk ${chunk.chunkIndex})`);
            return false;
        }
        return true;
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

    async removeByPath(path: string): Promise<boolean> {
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

        // Remove from Orama
        if (results.hits.length > 0) {
            for (const hit of results.hits) {
                await remove(this.db, hit.id);
            }
        }

        // Remove from IndexedDB
        const removedCount = await this.storage.removeByPath(path);

        return removedCount > 0;
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
