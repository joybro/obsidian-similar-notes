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

export class OramaWorker {
    private db: Orama<Schema> | null = null;
    private schema: Schema;
    private vectorSize: number;
    private filepath: string;
    private adapter: DataAdapter;
    private storage: IndexedDBChunkStorage;

    setLogLevel(level: log.LogLevelDesc): void {
        log.setLevel(level);
        log.info(`Worker log level set to: ${log.getLevel()}`);
    }

    async init(
        adapter: DataAdapter,
        vectorSize: number,
        filepath: string,
        vaultId: string,
        loadExistingData: boolean
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
            // Initialize IndexedDB storage with vault-specific ID
            this.storage = new IndexedDBChunkStorage();
            await this.storage.init(vaultId);

            if (!loadExistingData) {
                // Reindex scenario: clear IndexedDB to start fresh
                await this.storage.clear();
                log.info("Cleared IndexedDB for reindexing");
            } else {
                // Normal load: check if migration is needed
                const alreadyMigrated = await this.storage.getMigrationFlag();
                const jsonExists = await this.adapter.exists(this.filepath);

                if (!alreadyMigrated && jsonExists) {
                    // Perform one-time migration from JSON to IndexedDB
                    await this.migrateFromJSON(this.filepath);
                }
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

    /**
     * Migrate existing JSON database to IndexedDB
     * This is a one-time operation performed on first load after upgrade
     */
    private async migrateFromJSON(filepath: string): Promise<void> {
        try {
            log.info("Starting migration from JSON to IndexedDB");

            // Read and parse JSON file
            const jsonData = await this.adapter.read(filepath);
            const oramaData = JSON.parse(jsonData);

            // Extract documents from Orama persistence format
            // Orama v2 stores docs in nested structure: { docs: { docs: { [id]: Document } } }
            let documents: any[] = [];

            // Navigate the nested structure to find the actual documents
            let docsObject = null;
            if (oramaData.docs?.docs && typeof oramaData.docs.docs === 'object') {
                // Nested: oramaData.docs.docs
                docsObject = oramaData.docs.docs;
                log.info('Found docs at oramaData.docs.docs');
            } else if (oramaData.docs && typeof oramaData.docs === 'object') {
                // Direct: oramaData.docs
                docsObject = oramaData.docs;
                log.info('Found docs at oramaData.docs');
            }

            if (docsObject && typeof docsObject === 'object' && !Array.isArray(docsObject)) {
                // Convert docs object to array
                documents = Object.values(docsObject);
                log.info(`Extracted ${documents.length} chunks from docs object`);
            } else if (Array.isArray(docsObject)) {
                // Fallback: if docs is already an array
                documents = docsObject;
                log.info(`Found ${documents.length} chunks as array`);
            } else {
                log.warn("Could not find documents in expected format");
            }

            log.info(`Total chunks to migrate: ${documents.length}`);

            if (documents.length === 0) {
                log.info("No chunks to migrate");
                await this.storage.setMigrationFlag(true);
                return;
            }

            // Filter out invalid chunks before migration
            const validDocuments = documents.filter((doc: any) => {
                const isValid = this.isValidChunk(doc);
                if (!isValid) {
                    log.warn(`Skipping invalid chunk during migration: ${doc.path} (chunk ${doc.chunkIndex})`);
                }
                return isValid;
            });

            log.info(`Valid chunks after filtering: ${validDocuments.length}/${documents.length}`);

            if (validDocuments.length === 0) {
                log.warn("No valid chunks to migrate after filtering");
                await this.storage.setMigrationFlag(true);
                return;
            }

            // Insert to IndexedDB in batches to avoid memory issues
            // Note: Remove 'id' field from Orama docs because IndexedDB will auto-generate it
            const BATCH_SIZE = 100;
            for (let i = 0; i < validDocuments.length; i += BATCH_SIZE) {
                const batch = validDocuments.slice(i, i + BATCH_SIZE).map((doc: any) => {
                    const { id, ...docWithoutId } = doc;
                    return docWithoutId;
                });
                await this.storage.putMulti(batch);

                const processed = Math.min(i + BATCH_SIZE, validDocuments.length);
                log.info(`Migrated ${processed}/${validDocuments.length} chunks`);
            }

            // Backup original JSON file
            const backupPath = `${filepath}.backup-${Date.now()}`;
            await this.adapter.rename(filepath, backupPath);
            log.info(`Migration complete. Backup saved to ${backupPath}`);

            // Set migration flag to prevent re-migration
            await this.storage.setMigrationFlag(true);
        } catch (error) {
            log.error("Migration failed:", error);

            // Rollback: Clear IndexedDB on failure
            await this.storage.clear();

            throw new Error(
                "Failed to migrate from JSON to IndexedDB. Please report this issue."
            );
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
