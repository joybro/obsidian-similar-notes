# IndexedDB Migration Design Document

## Overview

Migration from Orama's JSON-based persistence to IndexedDB storage to resolve Android OutOfMemoryError issues.

**Problem**: Loading large JSON files (~70MB) causes memory exhaustion on Android devices.

**Solution**: Use IndexedDB for persistent storage with batch loading, keeping Orama as in-memory vector search engine.

---

## Architecture

```
┌─────────────────────────────────────┐
│       IndexedDB Storage             │
│  (Persistent storage - disk-based)  │
│  - Batch read/write                 │
│  - Memory efficient                 │
└─────────────────────────────────────┘
            ↕ Batch loading (100 chunks at a time)
┌─────────────────────────────────────┐
│         Orama Database              │
│  (In-memory vector search index)    │
│  - Fast similarity search           │
│  - No persistence layer used        │
└─────────────────────────────────────┘
```

---

## IndexedDB Schema

### Database Structure

```typescript
Database: "similar-notes-chunks"
Version: 1

ObjectStore: "chunks"
  - keyPath: "id" (auto-increment)
  - indexes:
    1. "path" (unique: false) - for removeByPath operations
    2. "pathHash" (unique: false) - for Orama compatibility

ObjectStore: "metadata"
  - keyPath: "key"
  - stores migration flags and version info
  - example: { key: "migrated", value: true, timestamp: 1234567890 }
```

### Data Structure

```typescript
interface StoredChunk {
    id?: number;              // IndexedDB auto-increment key
    path: string;             // Note file path
    pathHash: string;         // SHA-256 hash of path (for fast lookup)
    title: string;            // Note title
    content: string;          // Chunk content
    chunkIndex: number;       // Index of this chunk in the note
    totalChunks: number;      // Total chunks in the note
    embedding: number[];      // Vector embedding (384 or 768 dimensions)
    lastUpdated: number;      // Timestamp
}
```

---

## Storage Layer Implementation

### Class: IndexedDBChunkStorage

Located: `src/infrastructure/IndexedDBChunkStorage.ts`

```typescript
class IndexedDBChunkStorage {
    private dbName = "similar-notes-chunks";
    private storeName = "chunks";
    private metadataStoreName = "metadata";
    private version = 1;
    private db: IDBDatabase | null = null;

    // Initialization
    async init(): Promise<void>

    // CRUD Operations
    async put(chunk: NoteChunkInternal): Promise<void>
    async putMulti(chunks: NoteChunkInternal[]): Promise<void>
    async removeByPath(path: string): Promise<number>
    async count(): Promise<number>
    async clear(): Promise<void>

    // Batch Loading (memory efficient)
    async loadInBatches(
        batchSize: number,
        onBatch: (chunks: NoteChunkInternal[]) => Promise<void>,
        onProgress?: (processed: number, total: number) => void
    ): Promise<void>

    // Migration Support
    async getMigrationFlag(): Promise<boolean>
    async setMigrationFlag(value: boolean): Promise<void>

    // Cleanup
    async close(): Promise<void>
}
```

---

## Migration Strategy

### JSON to IndexedDB Migration Flow

```
┌──────────────────────────────────────────────────────────────┐
│ 1. Check if migration needed                                 │
│    - IndexedDB metadata: migrated = false                    │
│    - JSON file exists                                        │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ 2. Load JSON file                                            │
│    - Read entire JSON (unavoidable, but only once)           │
│    - Parse Orama persistence format                          │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ 3. Extract documents from Orama JSON                         │
│    - oramaData.docs contains all chunks                      │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ 4. Batch insert to IndexedDB                                 │
│    - Split into batches of 100 chunks (~300KB each)          │
│    - Insert batch by batch to avoid memory spike             │
│    - Log progress                                            │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ 5. Backup original JSON                                      │
│    - Rename to .json.backup-{timestamp}                      │
│    - Keep for safety, can be deleted manually later          │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ 6. Set migration flag                                        │
│    - metadata store: { key: "migrated", value: true }        │
│    - Subsequent loads skip migration                         │
└──────────────────────────────────────────────────────────────┘
```

### Migration Code Structure

```typescript
private async migrateFromJSON(adapter: DataAdapter, filepath: string): Promise<void> {
    try {
        log.info("Starting migration from JSON to IndexedDB");

        // 1. Read JSON file
        const jsonData = await adapter.read(filepath);
        const oramaData = JSON.parse(jsonData);

        // 2. Extract documents
        const documents = oramaData.docs || [];
        log.info(`Found ${documents.length} chunks to migrate`);

        // 3. Batch insert to IndexedDB
        const BATCH_SIZE = 100;
        for (let i = 0; i < documents.length; i += BATCH_SIZE) {
            const batch = documents.slice(i, i + BATCH_SIZE);
            await this.storage.putMulti(batch);

            const processed = Math.min(i + BATCH_SIZE, documents.length);
            log.info(`Migrated ${processed}/${documents.length} chunks`);
        }

        // 4. Backup original JSON
        const backupPath = `${filepath}.backup-${Date.now()}`;
        await adapter.rename(filepath, backupPath);
        log.info(`Migration complete. Backup: ${backupPath}`);

        // 5. Set migration flag
        await this.storage.setMigrationFlag(true);

    } catch (error) {
        log.error("Migration failed:", error);
        // On failure, keep JSON file intact for retry
        await this.storage.clear(); // Rollback IndexedDB
        throw error;
    }
}
```

### Migration Timing

- **When**: Automatic on first load after upgrade
- **Trigger**: `init()` method checks migration flag
- **Frequency**: Once per vault (flag stored in IndexedDB metadata)

```typescript
async init(adapter, vectorSize, filepath, loadExistingData) {
    // 1. Initialize IndexedDB
    await this.storage.init();

    // 2. Check migration or clear for reindex
    const alreadyMigrated = await this.storage.getMigrationFlag();
    const jsonExists = await adapter.exists(filepath);

    if (!loadExistingData) {
        // Reindex scenario: clear IndexedDB
        await this.storage.clear();
    } else if (!alreadyMigrated && jsonExists) {
        await this.migrateFromJSON(adapter, filepath);
    }

    // 3. Initialize Orama and load from IndexedDB
    this.db = await create({ schema: this.schema });
    await this.storage.loadInBatches(100, async (batch) => {
        await insertMultiple(this.db, batch);
    });
}
```

---

## Batch Loading Strategy

### Memory-Efficient Cursor Iteration

```typescript
async loadInBatches(
    batchSize: number,
    onBatch: (chunks: NoteChunkInternal[]) => Promise<void>,
    onProgress?: (processed: number, total: number) => void
): Promise<void> {
    const total = await this.count();
    let processed = 0;

    const transaction = this.db.transaction(this.storeName, "readonly");
    const store = transaction.objectStore(this.storeName);
    const request = store.openCursor();

    let batch: NoteChunkInternal[] = [];

    return new Promise((resolve, reject) => {
        request.onsuccess = async (event) => {
            const cursor = (event.target as IDBRequest).result;

            if (cursor) {
                batch.push(cursor.value);

                if (batch.length >= batchSize) {
                    await onBatch(batch);
                    processed += batch.length;

                    if (onProgress) {
                        onProgress(processed, total);
                    }

                    batch = [];
                }

                cursor.continue(); // Triggers onsuccess again with next record
            } else {
                // No more records - process final batch
                if (batch.length > 0) {
                    await onBatch(batch);
                    processed += batch.length;

                    if (onProgress) {
                        onProgress(processed, total);
                    }
                }
                resolve();
            }
        };

        request.onerror = () => reject(request.error);
    });
}
```

### Batch Size Considerations

- **100 chunks**: ~300KB per batch (safe for mobile)
- **Too small**: Increased I/O overhead
- **Too large**: Memory pressure

**Recommended**: 100 chunks (can be made configurable if needed)

---

## Storage Synchronization

### Write-Through Strategy (Recommended)

Every write operation updates both Orama (in-memory) and IndexedDB (persistent) immediately.

```typescript
async put(noteChunk: NoteChunkDTO): Promise<void> {
    const internal = await this.toInternalChunk(noteChunk);

    // 1. Insert to Orama (fast, in-memory)
    await insert(this.db, internal);

    // 2. Insert to IndexedDB (slower, persistent)
    await this.storage.put(internal);
}

async putMulti(chunks: NoteChunkDTO[]): Promise<void> {
    const internals = await Promise.all(
        chunks.map(c => this.toInternalChunk(c))
    );

    await insertMultiple(this.db, internals);
    await this.storage.putMulti(internals);
}

async removeByPath(path: string): Promise<boolean> {
    // Remove from Orama
    const pathHash = await this.calculatePathHash(path);
    const results = await search(this.db, {
        term: pathHash,
        properties: ["pathHash"],
        exact: true,
        limit: 100,
    });

    for (const hit of results.hits) {
        await remove(this.db, hit.id);
    }

    // Remove from IndexedDB
    const removedCount = await this.storage.removeByPath(path);

    return removedCount > 0;
}
```

**Advantages**:
- Data consistency guaranteed
- Simple implementation
- No risk of data loss on crash

**Performance**: IndexedDB transactions are fast enough for our use case.

---

## persist() Method Changes

### Current Behavior

- Called by auto-save interval (main.ts:441-448)
- Called on plugin unload (main.ts:429)
- Saves entire Orama DB to JSON file

### New Behavior

```typescript
async persist(): Promise<void> {
    // NOTE: With IndexedDB, data is persisted immediately on put/putMulti.
    // This method is kept for backward compatibility but does nothing.
    // TODO: Remove persist() calls from main.ts in a follow-up task

    log.info("persist() called - no-op with IndexedDB storage");
    return Promise.resolve();
}
```

### Follow-up Tasks

- Remove auto-save interval setup
- Remove persist() calls on unload
- Remove related settings (autoSaveInterval)

---

## Error Handling

### Migration Errors

```typescript
try {
    await this.migrateFromJSON(adapter, filepath);
} catch (error) {
    log.error("Migration failed:", error);

    // Rollback: Clear partial IndexedDB data
    await this.storage.clear();

    // Keep JSON file for retry
    // User can manually delete if needed

    throw new Error("Migration failed. Please report this issue.");
}
```

### IndexedDB Write Errors

```typescript
async putMulti(chunks: NoteChunkDTO[]): Promise<void> {
    const internals = await Promise.all(
        chunks.map(c => this.toInternalChunk(c))
    );

    try {
        await insertMultiple(this.db, internals);
        await this.storage.putMulti(internals);
    } catch (error) {
        log.error("Failed to save chunks:", error);

        // Note: Orama rollback is difficult
        // Mark as inconsistent state for monitoring
        this.hasChanges = true;

        throw error;
    }
}
```

### Initialization Timeout

```typescript
async init(...) {
    const timeout = setTimeout(() => {
        throw new Error("IndexedDB initialization timeout (30s)");
    }, 30000);

    try {
        await this.storage.init();
        // ... load data ...
    } finally {
        clearTimeout(timeout);
    }
}
```

---

## Memory Usage Analysis

### Before (JSON-based)

```
Vault: 3000 notes × 3 chunks = 9000 chunks
Vector size: 384 dimensions
Chunk size: ~3KB (vector + metadata)
Total: 9000 × 3KB = 27MB data

JSON serialization overhead: ~1.5x
JSON file size: ~40-50MB

Peak memory during load:
- JSON string in memory: 50MB
- JSON.parse() working memory: 50MB
- Parsed object: 50MB
Total peak: ~150MB (fails on Android)
```

### After (IndexedDB-based)

```
Same vault: 9000 chunks

Batch loading (100 chunks per batch):
- Batch size: 100 × 3KB = 300KB
- Peak memory per batch: ~1MB (parsing + Orama insertion)
- Total batches: 90

Peak memory during load:
- IndexedDB cursor: minimal
- One batch in memory: 1MB
- Orama incremental build: ~30MB (final size)
Total peak: ~35MB (safe for Android)
```

**Memory reduction**: 150MB → 35MB (77% reduction in peak memory)

---

## Performance Considerations

### Load Time Comparison

**JSON approach**:
- Read JSON: ~100ms
- Parse JSON: ~500ms (CPU-intensive)
- Restore Orama: ~200ms
- **Total**: ~800ms

**IndexedDB approach**:
- Open IndexedDB: ~50ms
- Batch load (90 batches): ~450ms
- Insert to Orama: ~300ms
- **Total**: ~800ms

**Conclusion**: Similar performance, but much better memory profile.

### Write Performance

- IndexedDB transactions are asynchronous and optimized
- Batch writes (putMulti) are efficient
- No noticeable performance impact

---

## Backward Compatibility

### Upgrade Path

1. User upgrades plugin to new version
2. On first load, plugin detects JSON file
3. Automatic migration to IndexedDB
4. JSON file renamed to .backup
5. Subsequent loads use IndexedDB

### Downgrade Path

If user downgrades to old version:
- Old version will not find JSON file (it's renamed)
- Old version will reindex from scratch
- No data corruption, just performance impact

**Recommendation**: Keep .backup files for a while for safety.

---

## File Structure Changes

### New Files

```
src/infrastructure/IndexedDBChunkStorage.ts
src/infrastructure/__tests__/IndexedDBChunkStorage.test.ts
```

### Modified Files

```
src/adapter/orama/orama.worker.ts
  - Add IndexedDBChunkStorage integration
  - Implement migration logic
  - Modify put/putMulti/removeByPath to use dual storage

src/adapter/orama/OramaNoteChunkRepository.ts
  - Minor changes for worker communication (if needed)

src/main.ts
  - persist() calls can remain (no-op)
  - Follow-up: Remove in future version
```

---

## Implementation Checklist

- [ ] Create IndexedDBChunkStorage class
- [ ] Implement init() with database schema
- [ ] Implement CRUD operations (put, putMulti, removeByPath, count, clear)
- [ ] Implement loadInBatches() with cursor iteration
- [ ] Implement metadata store for migration flag
- [ ] Modify orama.worker.ts init() for migration
- [ ] Implement migrateFromJSON() method
- [ ] Update put/putMulti/removeByPath to use dual storage
- [ ] Make persist() a no-op with logging
- [ ] Add progress reporting for batch loading
- [ ] Add error handling and rollback logic
- [ ] Add timeout protection
- [ ] Write unit tests (see TEST_STRATEGY.md)
- [ ] Write integration tests
- [ ] Test on actual Android device
- [ ] Update documentation

---

## Follow-up Tasks

### Immediate Next Version

- [ ] Monitor for any issues with IndexedDB migration
- [ ] Collect user feedback on mobile performance
- [ ] Consider adding retry mechanism for failed migrations

### Future Improvements

- [ ] Remove persist() calls from main.ts
- [ ] Remove autoSaveInterval setting
- [ ] Add setting to manually delete .backup files
- [ ] Add IndexedDB database size monitoring
- [ ] Optimize batch size based on device capabilities
- [ ] Consider compression for embeddings storage

---

## References

- IndexedDB API: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- Orama Documentation: https://docs.oramasearch.com/
- Android WebView Memory Limits: https://developer.android.com/reference/android/webkit/WebView
