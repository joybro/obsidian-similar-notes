# IndexedDB Migration - Test Strategy

## Overview

Comprehensive testing strategy for the IndexedDB migration to ensure memory efficiency and reliability on both desktop and mobile platforms.

---

## Test Pyramid

```
                    ┌─────────────────┐
                    │  Manual Mobile  │
                    │     Testing     │  (Critical path)
                    └─────────────────┘
                  ┌───────────────────────┐
                  │  Integration Tests    │
                  │  (Real Obsidian env)  │
                  └───────────────────────┘
              ┌─────────────────────────────────┐
              │      Unit Tests (Vitest)         │
              │   - IndexedDB operations         │
              │   - Migration logic              │
              │   - Memory profiling             │
              └─────────────────────────────────┘
```

---

## Unit Tests

### 1. IndexedDBChunkStorage Tests

**File**: `src/infrastructure/__tests__/IndexedDBChunkStorage.test.ts`

**Test Library**: Vitest + fake-indexeddb

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto'; // Mock IndexedDB in Node environment
import { IndexedDBChunkStorage } from '../IndexedDBChunkStorage';

describe('IndexedDBChunkStorage', () => {
    let storage: IndexedDBChunkStorage;

    beforeEach(async () => {
        storage = new IndexedDBChunkStorage();
        await storage.init();
    });

    afterEach(async () => {
        await storage.close();
    });

    describe('Basic CRUD Operations', () => {
        it('should initialize database successfully', async () => {
            expect(storage).toBeDefined();
            const count = await storage.count();
            expect(count).toBe(0);
        });

        it('should store and retrieve a single chunk', async () => {
            const chunk = createMockChunk({
                path: 'test.md',
                content: 'Test content',
                embedding: new Array(384).fill(0.1),
            });

            await storage.put(chunk);

            const count = await storage.count();
            expect(count).toBe(1);
        });

        it('should store multiple chunks in batch', async () => {
            const chunks = Array.from({ length: 100 }, (_, i) =>
                createMockChunk({ path: `test-${i}.md` })
            );

            await storage.putMulti(chunks);

            const count = await storage.count();
            expect(count).toBe(100);
        });

        it('should remove chunks by path', async () => {
            const chunks = [
                createMockChunk({ path: 'test.md', chunkIndex: 0 }),
                createMockChunk({ path: 'test.md', chunkIndex: 1 }),
                createMockChunk({ path: 'other.md', chunkIndex: 0 }),
            ];

            await storage.putMulti(chunks);
            const removed = await storage.removeByPath('test.md');

            expect(removed).toBe(2);
            expect(await storage.count()).toBe(1);
        });

        it('should clear all chunks', async () => {
            const chunks = Array.from({ length: 50 }, (_, i) =>
                createMockChunk({ path: `test-${i}.md` })
            );

            await storage.putMulti(chunks);
            await storage.clear();

            expect(await storage.count()).toBe(0);
        });
    });

    describe('Batch Loading', () => {
        it('should load chunks in batches', async () => {
            const totalChunks = 250;
            const chunks = Array.from({ length: totalChunks }, (_, i) =>
                createMockChunk({ path: `test-${i}.md` })
            );

            await storage.putMulti(chunks);

            const loadedBatches: any[][] = [];
            await storage.loadInBatches(100, async (batch) => {
                loadedBatches.push(batch);
            });

            expect(loadedBatches.length).toBe(3); // 100, 100, 50
            expect(loadedBatches[0].length).toBe(100);
            expect(loadedBatches[1].length).toBe(100);
            expect(loadedBatches[2].length).toBe(50);

            const totalLoaded = loadedBatches.flat().length;
            expect(totalLoaded).toBe(totalChunks);
        });

        it('should report progress during batch loading', async () => {
            const chunks = Array.from({ length: 300 }, (_, i) =>
                createMockChunk({ path: `test-${i}.md` })
            );

            await storage.putMulti(chunks);

            const progressReports: Array<{ processed: number; total: number }> = [];

            await storage.loadInBatches(
                100,
                async (batch) => {
                    // Process batch
                },
                (processed, total) => {
                    progressReports.push({ processed, total });
                }
            );

            expect(progressReports.length).toBe(3);
            expect(progressReports[0]).toEqual({ processed: 100, total: 300 });
            expect(progressReports[1]).toEqual({ processed: 200, total: 300 });
            expect(progressReports[2]).toEqual({ processed: 300, total: 300 });
        });
    });

    describe('Metadata Store', () => {
        it('should store and retrieve migration flag', async () => {
            expect(await storage.getMigrationFlag()).toBe(false);

            await storage.setMigrationFlag(true);

            expect(await storage.getMigrationFlag()).toBe(true);
        });
    });

    describe('Large Dataset Handling', () => {
        it('should handle 1000 chunks without issues', async () => {
            const chunks = Array.from({ length: 1000 }, (_, i) =>
                createMockChunk({ path: `test-${i}.md` })
            );

            await storage.putMulti(chunks);

            expect(await storage.count()).toBe(1000);

            const loaded: any[] = [];
            await storage.loadInBatches(100, async (batch) => {
                loaded.push(...batch);
            });

            expect(loaded.length).toBe(1000);
        });

        it('should handle large embedding vectors (768 dimensions)', async () => {
            const chunk = createMockChunk({
                path: 'test.md',
                embedding: new Array(768).fill(0.5),
            });

            await storage.put(chunk);

            const loaded: any[] = [];
            await storage.loadInBatches(1, async (batch) => {
                loaded.push(...batch);
            });

            expect(loaded[0].embedding.length).toBe(768);
        });
    });

    describe('Error Handling', () => {
        it('should handle database close gracefully', async () => {
            await storage.close();

            // Operations after close should fail gracefully
            await expect(storage.count()).rejects.toThrow();
        });

        it('should handle concurrent writes', async () => {
            const chunks1 = Array.from({ length: 50 }, (_, i) =>
                createMockChunk({ path: `test-a-${i}.md` })
            );
            const chunks2 = Array.from({ length: 50 }, (_, i) =>
                createMockChunk({ path: `test-b-${i}.md` })
            );

            await Promise.all([
                storage.putMulti(chunks1),
                storage.putMulti(chunks2),
            ]);

            expect(await storage.count()).toBe(100);
        });
    });
});

// Helper function to create mock chunks
function createMockChunk(overrides?: Partial<NoteChunkInternal>): NoteChunkInternal {
    return {
        path: 'default.md',
        pathHash: 'hash123',
        title: 'Default Note',
        content: 'Default content',
        chunkIndex: 0,
        totalChunks: 1,
        embedding: new Array(384).fill(0),
        lastUpdated: Date.now(),
        ...overrides,
    };
}
```

### 2. Migration Tests

**File**: `src/adapter/orama/__tests__/orama.worker.migration.test.ts`

```typescript
describe('JSON to IndexedDB Migration', () => {
    it('should migrate existing JSON database', async () => {
        const mockOramaJSON = {
            docs: Array.from({ length: 100 }, (_, i) => ({
                path: `test-${i}.md`,
                pathHash: `hash-${i}`,
                title: `Note ${i}`,
                content: `Content ${i}`,
                chunkIndex: 0,
                totalChunks: 1,
                embedding: new Array(384).fill(0.1),
                lastUpdated: Date.now(),
            })),
            // ... other Orama metadata
        };

        const mockAdapter = {
            exists: vi.fn().mockResolvedValue(true),
            read: vi.fn().mockResolvedValue(JSON.stringify(mockOramaJSON)),
            rename: vi.fn().mockResolvedValue(undefined),
        };

        const worker = new OramaWorker();
        await worker.init(mockAdapter, 384, 'test.json', true);

        const count = await worker.count();
        expect(count).toBe(100);

        // Verify migration flag was set
        expect(await worker.storage.getMigrationFlag()).toBe(true);

        // Verify JSON was backed up
        expect(mockAdapter.rename).toHaveBeenCalledWith(
            'test.json',
            expect.stringContaining('.backup-')
        );
    });

    it('should not re-migrate on subsequent loads', async () => {
        const mockAdapter = {
            exists: vi.fn().mockResolvedValue(true),
            read: vi.fn(),
            rename: vi.fn(),
        };

        const worker = new OramaWorker();

        // First load - migration should happen
        await worker.init(mockAdapter, 384, 'test.json', true);
        expect(mockAdapter.read).toHaveBeenCalledTimes(1);

        // Second load - migration should be skipped
        const worker2 = new OramaWorker();
        await worker2.init(mockAdapter, 384, 'test.json', true);
        expect(mockAdapter.read).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should handle migration failure gracefully', async () => {
        const mockAdapter = {
            exists: vi.fn().mockResolvedValue(true),
            read: vi.fn().mockRejectedValue(new Error('Read failed')),
            rename: vi.fn(),
        };

        const worker = new OramaWorker();

        await expect(
            worker.init(mockAdapter, 384, 'test.json', true)
        ).rejects.toThrow('Migration failed');

        // Verify IndexedDB was cleared on failure
        expect(await worker.storage.count()).toBe(0);

        // Verify migration flag was not set
        expect(await worker.storage.getMigrationFlag()).toBe(false);
    });

    it('should handle large JSON migration in batches', async () => {
        const largeDataset = {
            docs: Array.from({ length: 5000 }, (_, i) =>
                createMockChunk({ path: `test-${i}.md` })
            ),
        };

        const mockAdapter = {
            exists: vi.fn().mockResolvedValue(true),
            read: vi.fn().mockResolvedValue(JSON.stringify(largeDataset)),
            rename: vi.fn().mockResolvedValue(undefined),
        };

        const worker = new OramaWorker();
        await worker.init(mockAdapter, 384, 'test.json', true);

        expect(await worker.count()).toBe(5000);
    });
});
```

### 3. Memory Profiling Tests

**File**: `src/infrastructure/__tests__/IndexedDBChunkStorage.memory.test.ts`

```typescript
describe('Memory Usage', () => {
    // Helper to measure memory
    function measureMemoryUsage(fn: () => Promise<void>): Promise<number> {
        return new Promise(async (resolve) => {
            if (global.gc) {
                global.gc(); // Force garbage collection
            }

            const before = process.memoryUsage().heapUsed;
            await fn();

            if (global.gc) {
                global.gc();
            }

            const after = process.memoryUsage().heapUsed;
            const usedMB = (after - before) / 1024 / 1024;
            resolve(usedMB);
        });
    }

    it('should use less than 50MB memory when loading 1000 chunks', async () => {
        const storage = new IndexedDBChunkStorage();
        await storage.init();

        // Prepare data
        const chunks = Array.from({ length: 1000 }, (_, i) =>
            createMockChunk({ path: `test-${i}.md` })
        );
        await storage.putMulti(chunks);

        // Measure memory during batch loading
        const memoryUsed = await measureMemoryUsage(async () => {
            const db = await create({ schema: testSchema });
            await storage.loadInBatches(100, async (batch) => {
                await insertMultiple(db, batch);
            });
        });

        console.log(`Memory used: ${memoryUsed.toFixed(2)} MB`);
        expect(memoryUsed).toBeLessThan(50);
    });

    it('should have constant memory usage per batch', async () => {
        const storage = new IndexedDBChunkStorage();
        await storage.init();

        const chunks = Array.from({ length: 1000 }, (_, i) =>
            createMockChunk({ path: `test-${i}.md` })
        );
        await storage.putMulti(chunks);

        const memoryPerBatch: number[] = [];

        await storage.loadInBatches(100, async (batch) => {
            const memory = process.memoryUsage().heapUsed / 1024 / 1024;
            memoryPerBatch.push(memory);
        });

        // Memory usage should not grow significantly across batches
        const maxMemory = Math.max(...memoryPerBatch);
        const minMemory = Math.min(...memoryPerBatch);
        const variance = maxMemory - minMemory;

        console.log(`Memory variance: ${variance.toFixed(2)} MB`);
        expect(variance).toBeLessThan(10); // Less than 10MB variance
    });
});
```

**Running memory tests**:
```bash
# Run with garbage collection enabled
node --expose-gc node_modules/.bin/vitest run IndexedDBChunkStorage.memory.test.ts
```

---

## Integration Tests

### Test Vault Creation

Create test vaults of varying sizes to simulate real-world scenarios.

**Script**: `scripts/create-test-vault.js`

```javascript
const fs = require('fs');
const path = require('path');

function createTestVault(config) {
    const { vaultPath, noteCount, chunksPerNote, vectorSize } = config;

    // Create vault directory
    fs.mkdirSync(vaultPath, { recursive: true });

    for (let i = 0; i < noteCount; i++) {
        const noteContent = generateNoteContent(chunksPerNote);
        const notePath = path.join(vaultPath, `note-${i}.md`);
        fs.writeFileSync(notePath, noteContent);
    }

    console.log(`Created test vault with ${noteCount} notes at ${vaultPath}`);
}

function generateNoteContent(chunkCount) {
    const paragraphsPerChunk = 5;
    const totalParagraphs = chunkCount * paragraphsPerChunk;

    let content = '# Test Note\n\n';

    for (let i = 0; i < totalParagraphs; i++) {
        content += `This is paragraph ${i + 1}. It contains some test content that will be chunked and embedded. Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\n`;
    }

    return content;
}

// Create test vaults
createTestVault({
    vaultPath: './test-vaults/small',
    noteCount: 100,
    chunksPerNote: 3,
    vectorSize: 384,
});

createTestVault({
    vaultPath: './test-vaults/medium',
    noteCount: 1000,
    chunksPerNote: 3,
    vectorSize: 384,
});

createTestVault({
    vaultPath: './test-vaults/large',
    noteCount: 3000,
    chunksPerNote: 3,
    vectorSize: 384,
});
```

### Integration Test Cases

1. **Small Vault (100 notes)**
   - Load time < 5 seconds
   - Memory usage < 20MB
   - All chunks indexed correctly

2. **Medium Vault (1000 notes)**
   - Load time < 30 seconds
   - Memory usage < 40MB
   - Search results accurate

3. **Large Vault (3000 notes)**
   - Load time < 90 seconds
   - Memory usage < 60MB
   - No crashes or hangs

### Manual Integration Testing

1. Copy test vault to Obsidian vault folder
2. Enable Similar Notes plugin
3. Monitor:
   - Chrome DevTools > Memory > Take heap snapshot
   - Loading time in console logs
   - UI responsiveness
4. Perform operations:
   - Open notes
   - View similar notes
   - Index new notes
   - Delete notes
5. Verify IndexedDB contents:
   - Chrome DevTools > Application > IndexedDB > similar-notes-chunks

---

## Mobile Testing

### Android Testing Setup

**Devices** (prioritize based on user report):
1. Xiaomi 14T (HyperOS 2.0) - Primary test device
2. Xiaomi Pad 6 (HyperOS 2.0) - Secondary
3. Generic Android emulator

**Obsidian Versions**:
- v1.9.x
- v1.10.x

### Test Procedure

#### 1. ADB Setup

```bash
# Connect device
adb devices

# Monitor logs
adb logcat | grep -i "obsidian\|chromium\|similar"

# Clear logs
adb logcat -c
```

#### 2. Remote Debugging

```bash
# Enable USB debugging on device
# Chrome > chrome://inspect
# Select Obsidian WebView

# Monitor:
# - Console logs
# - Memory profiler
# - Network (if using Ollama)
```

#### 3. Test Scenarios

**Scenario A: Fresh Install**
```
1. Install Similar Notes plugin
2. Configure with default settings
3. Let it index vault (monitor memory)
4. Expected: No crashes, memory < 100MB
```

**Scenario B: Migration from JSON**
```
1. Have existing JSON database (~50MB)
2. Update to new version
3. Monitor migration process
4. Expected: Successful migration, no crash
5. Verify: .backup file created
```

**Scenario C: Large Vault**
```
1. Sync 3000+ note vault
2. Enable plugin
3. Monitor indexing progress
4. Expected: Gradual indexing, no crash
```

**Scenario D: Stress Test**
```
1. Rapidly open/close notes
2. Edit multiple notes quickly
3. Force app to background/foreground
4. Expected: No memory leaks, stable operation
```

### Memory Monitoring

```bash
# Monitor app memory usage
adb shell dumpsys meminfo com.obsidian.mobile

# Watch for OOM kills
adb logcat | grep -i "oom\|memory"

# Heap dump (if needed)
adb shell am dumpheap com.obsidian.mobile /data/local/tmp/heap.hprof
adb pull /data/local/tmp/heap.hprof
```

### Metrics to Collect

- Peak memory usage during:
  - Initial load
  - Migration
  - Indexing
  - Search operations
- Load time for different vault sizes
- IndexedDB operation times
- Crash reports (if any)

---

## Performance Benchmarks

### Desktop Baseline

Test on macOS/Linux/Windows with medium vault (1000 notes):

```
Initial load time: ____ms
Migration time: ____ms
Search time (10 results): ____ms
Index new note: ____ms
Peak memory: ____MB
```

### Mobile Baseline

Test on Xiaomi 14T with medium vault (1000 notes):

```
Initial load time: ____ms
Migration time: ____ms
Search time (10 results): ____ms
Index new note: ____ms
Peak memory: ____MB
```

### Comparison Targets

- Load time: Mobile should be < 2x desktop
- Memory usage: Mobile should be < 100MB peak
- No crashes on vault sizes up to 5000 notes

---

## Test Checklist

### Unit Tests

- [ ] IndexedDB initialization
- [ ] Single chunk insert/retrieve
- [ ] Batch insert (100, 500, 1000 chunks)
- [ ] Remove by path
- [ ] Clear database
- [ ] Batch loading with cursor
- [ ] Progress reporting during batch load
- [ ] Migration flag get/set
- [ ] Large dataset handling (1000+ chunks)
- [ ] Large vectors (768 dimensions)
- [ ] Memory usage < 50MB for 1000 chunks
- [ ] Concurrent write operations
- [ ] Error handling

### Migration Tests

- [ ] Successful migration from JSON
- [ ] Migration flag prevents re-migration
- [ ] Migration failure rollback
- [ ] Large JSON migration (5000+ chunks)
- [ ] Backup file creation
- [ ] Migration progress logging

### Integration Tests

- [ ] Small vault (100 notes) - desktop
- [ ] Medium vault (1000 notes) - desktop
- [ ] Large vault (3000 notes) - desktop
- [ ] IndexedDB persistence across plugin reload
- [ ] Search accuracy after migration
- [ ] New note indexing after migration

### Mobile Tests

- [ ] Fresh install on Xiaomi 14T
- [ ] Fresh install on Xiaomi Pad 6
- [ ] Migration on Xiaomi 14T
- [ ] Migration on Xiaomi Pad 6
- [ ] Large vault (3000 notes) on mobile
- [ ] Stress test (rapid operations)
- [ ] Background/foreground transitions
- [ ] Memory monitoring during all operations
- [ ] No OOM errors in logcat

### Manual Tests

- [ ] Chrome DevTools memory profiling
- [ ] IndexedDB contents verification
- [ ] Backup file verification
- [ ] Search results accuracy
- [ ] UI responsiveness during indexing
- [ ] Error messages user-friendly

---

## Test Data

### Mock Chunks Generator

```typescript
export function generateMockChunks(count: number, overrides?: Partial<NoteChunkInternal>): NoteChunkInternal[] {
    return Array.from({ length: count }, (_, i) => ({
        path: `test-${i}.md`,
        pathHash: `hash-${i}`,
        title: `Test Note ${i}`,
        content: `This is test content for chunk ${i}. It contains enough text to simulate a real note chunk.`,
        chunkIndex: 0,
        totalChunks: 1,
        embedding: generateRandomVector(384),
        lastUpdated: Date.now(),
        ...overrides,
    }));
}

export function generateRandomVector(size: number): number[] {
    return Array.from({ length: size }, () => Math.random());
}

export function generateLargeChunk(vectorSize: number = 768): NoteChunkInternal {
    return {
        path: 'large-test.md',
        pathHash: 'large-hash',
        title: 'Large Test Note',
        content: 'A'.repeat(10000), // 10KB content
        chunkIndex: 0,
        totalChunks: 1,
        embedding: generateRandomVector(vectorSize),
        lastUpdated: Date.now(),
    };
}
```

---

## Continuous Testing

### Pre-commit Checks

```bash
npm run test              # Run all unit tests
npm run test:coverage     # Check coverage > 80%
npm run lint              # No linting errors
```

### CI/CD Pipeline

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run test -- --coverage
      - uses: codecov/codecov-action@v3
```

---

## Bug Reporting Template

If issues are found during testing, use this template:

```markdown
## Bug Report: IndexedDB Migration

**Environment**:
- Device: [Xiaomi 14T / Desktop / etc.]
- OS: [HyperOS 2.0 / macOS / etc.]
- Obsidian Version: [1.10.0]
- Plugin Version: [x.x.x]

**Vault Size**:
- Notes: [3000]
- Estimated chunks: [9000]

**Issue**:
[Describe the problem]

**Steps to Reproduce**:
1.
2.
3.

**Expected Behavior**:
[What should happen]

**Actual Behavior**:
[What actually happened]

**Logs**:
```
[Paste relevant logs]
```

**Memory Usage** (if applicable):
- Before: [MB]
- Peak: [MB]
- After: [MB]

**Screenshots**:
[Attach if relevant]
```

---

## Success Criteria

The migration is considered successful if:

1. **Unit Tests**: All tests pass with > 80% coverage
2. **Memory**: Peak memory < 100MB on Android for 3000 note vault
3. **Performance**: Load time < 2 minutes for 3000 note vault on mobile
4. **Reliability**: No crashes during 100 continuous operations
5. **Migration**: 100% success rate for vaults up to 5000 notes
6. **User Feedback**: No new crash reports related to memory

---

## Notes

- Run memory profiling tests with `--expose-gc` flag
- Use `fake-indexeddb` for unit tests, real IndexedDB for integration tests
- Mobile testing is critical - prioritize Xiaomi devices from bug report
- Keep .backup files for at least one version cycle
- Monitor GitHub issues for user-reported problems

---

## Resources

- Vitest: https://vitest.dev/
- fake-indexeddb: https://github.com/dumbmatter/fakeIndexedDB
- Chrome DevTools: https://developer.chrome.com/docs/devtools/
- ADB: https://developer.android.com/tools/adb
- Remote Debugging: https://developer.chrome.com/docs/devtools/remote-debugging/
