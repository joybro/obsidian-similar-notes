# IndexedDB Migration - Implementation Plan

## Overview

Step-by-step implementation plan for migrating from JSON-based persistence to IndexedDB storage.

---

## Implementation Phases

### Phase 1: IndexedDB Storage Layer (Foundation)
**Estimated Time**: 2-3 hours

1. **Create IndexedDB storage class**
   - File: `src/infrastructure/IndexedDBChunkStorage.ts`
   - Implement database schema (chunks + metadata stores)
   - Implement init() with error handling

2. **Implement basic CRUD operations**
   - `put(chunk)` - single chunk insert
   - `putMulti(chunks)` - batch insert
   - `removeByPath(path)` - delete by path with index
   - `count()` - get total chunks
   - `clear()` - delete all chunks

3. **Implement metadata operations**
   - `getMigrationFlag()` - check if migrated
   - `setMigrationFlag(value)` - set migration status

4. **Add basic tests**
   - Test database initialization
   - Test CRUD operations
   - Test with fake-indexeddb

**Deliverables**:
- [ ] IndexedDBChunkStorage.ts created
- [ ] Basic CRUD operations working
- [ ] Unit tests passing

---

### Phase 2: Batch Loading Implementation
**Estimated Time**: 2-3 hours

1. **Implement cursor-based batch loading**
   - `loadInBatches(batchSize, onBatch, onProgress?)`
   - Use IDBCursor for memory-efficient iteration
   - Support progress reporting

2. **Test batch loading**
   - Test with various batch sizes (50, 100, 200)
   - Test with different dataset sizes (100, 500, 1000)
   - Test progress reporting callback

3. **Memory profiling**
   - Add memory usage tests
   - Verify memory stays constant per batch
   - Target: < 50MB for 1000 chunks

**Deliverables**:
- [ ] Batch loading implemented
- [ ] Tests for batch loading
- [ ] Memory profiling tests passing

---

### Phase 3: Orama Worker Integration
**Estimated Time**: 3-4 hours

1. **Modify orama.worker.ts**
   - Add IndexedDBChunkStorage instance
   - Update init() to use IndexedDB
   - Keep JSON params for migration compatibility

2. **Update put/putMulti operations**
   - Write to both Orama and IndexedDB
   - Handle errors with rollback consideration
   - Add logging

3. **Update removeByPath operation**
   - Remove from both Orama and IndexedDB
   - Maintain consistency

4. **Update persist() method**
   - Make it a no-op with log message
   - Add TODO comment for future removal

5. **Add tests**
   - Test dual storage writes
   - Test consistency between Orama and IndexedDB
   - Test error scenarios

**Deliverables**:
- [ ] Orama worker using IndexedDB
- [ ] Dual storage working correctly
- [ ] Worker tests updated and passing

---

### Phase 4: JSON Migration Logic
**Estimated Time**: 3-4 hours

1. **Implement migrateFromJSON() method**
   - Read existing JSON file
   - Parse Orama persistence format
   - Extract documents from oramaData.docs
   - Batch insert to IndexedDB (100 chunks per batch)
   - Rename JSON to .backup-{timestamp}
   - Set migration flag
   - Add comprehensive error handling

2. **Update init() for migration**
   - Check migration flag first
   - If not migrated and JSON exists, run migration
   - Load from IndexedDB after migration
   - Handle migration failures gracefully

3. **Add migration tests**
   - Test successful migration
   - Test migration flag prevents re-migration
   - Test migration failure rollback
   - Test backup file creation
   - Test large dataset migration (5000 chunks)

4. **Add migration logging**
   - Log migration start/progress/completion
   - Log batch progress
   - Log errors with stack traces

**Deliverables**:
- [ ] Migration logic implemented
- [ ] Migration tests passing
- [ ] Error handling robust
- [ ] Logging comprehensive

---

### Phase 5: Integration Testing
**Estimated Time**: 2-3 hours

1. **Create test vaults**
   - Small: 100 notes
   - Medium: 1000 notes
   - Large: 3000 notes

2. **Test desktop integration**
   - Test fresh install (no JSON)
   - Test migration from existing JSON
   - Test plugin reload persistence
   - Test search accuracy
   - Test new note indexing

3. **Performance benchmarking**
   - Measure load times for each vault size
   - Measure memory usage
   - Compare with JSON baseline
   - Document results

**Deliverables**:
- [ ] Test vaults created
- [ ] Desktop integration tests passing
- [ ] Performance benchmarks documented

---

### Phase 6: Mobile Testing & Optimization
**Estimated Time**: 4-6 hours

1. **Prepare mobile test environment**
   - Set up ADB
   - Configure remote debugging
   - Prepare test vault on device

2. **Test on Xiaomi 14T (primary)**
   - Fresh install test
   - Migration test
   - Large vault test (3000 notes)
   - Stress test (rapid operations)
   - Memory monitoring

3. **Test on Xiaomi Pad 6 (secondary)**
   - Same test cases as above

4. **Optimize if needed**
   - Adjust batch size if necessary
   - Add memory pressure handling
   - Optimize cursor iteration
   - Add timeout protection

5. **Document results**
   - Record memory usage
   - Record load times
   - Record any issues found
   - Create bug reports if needed

**Deliverables**:
- [ ] Mobile testing complete
- [ ] No crashes on target devices
- [ ] Memory usage < 100MB
- [ ] Performance acceptable

---

### Phase 7: Documentation & Cleanup
**Estimated Time**: 1-2 hours

1. **Update user documentation**
   - Add note about automatic migration
   - Explain .backup files
   - Update troubleshooting guide

2. **Add code comments**
   - Document IndexedDB schema
   - Document migration process
   - Document batch loading strategy

3. **Create follow-up tasks**
   - List persist() calls to remove
   - List settings to deprecate
   - List future optimizations

4. **Prepare release notes**
   - Highlight memory improvements
   - Explain migration process
   - Note mobile compatibility

**Deliverables**:
- [ ] Documentation updated
- [ ] Code well-commented
- [ ] Release notes drafted

---

## Development Guidelines

### Code Style

```typescript
// Use descriptive variable names
const BATCH_SIZE = 100;
const MIGRATION_BACKUP_PREFIX = '.backup-';

// Add JSDoc comments for public methods
/**
 * Loads chunks from IndexedDB in batches to avoid memory issues.
 * @param batchSize Number of chunks per batch (recommended: 100)
 * @param onBatch Callback for each batch
 * @param onProgress Optional progress callback
 */
async loadInBatches(...) { }

// Use try-catch with specific error messages
try {
    await this.storage.putMulti(chunks);
} catch (error) {
    log.error("Failed to save chunks to IndexedDB:", error);
    throw new Error("IndexedDB write failed. See console for details.");
}
```

### Logging Strategy

```typescript
// Use appropriate log levels
log.info("Starting IndexedDB migration");           // Important milestones
log.debug(`Processing batch ${i}/${total}`);        // Detailed progress
log.warn("IndexedDB not supported, falling back");  // Warnings
log.error("Migration failed:", error);              // Errors with context
```

### Testing Best Practices

```typescript
// Group related tests
describe('IndexedDBChunkStorage', () => {
    describe('CRUD Operations', () => { });
    describe('Batch Loading', () => { });
    describe('Error Handling', () => { });
});

// Use descriptive test names
it('should load 1000 chunks in batches without exceeding 50MB memory', async () => { });

// Clean up after tests
afterEach(async () => {
    await storage.close();
});
```

---

## Rollback Strategy

If critical issues are found during/after deployment:

### Quick Rollback (Emergency)

1. **Disable IndexedDB via feature flag** (if implemented)
   ```typescript
   const USE_INDEXEDDB = false; // Set to false
   ```

2. **Revert to previous version**
   - Users can downgrade plugin version
   - Old version will reindex from scratch (no data loss)

### Data Recovery

1. **Restore from .backup file**
   ```typescript
   // User can manually rename .backup file back to .json
   // Or provide a recovery command in settings
   ```

2. **Export from IndexedDB**
   ```typescript
   // Provide utility to export IndexedDB back to JSON if needed
   async exportToJSON(filepath: string) {
       const chunks: any[] = [];
       await this.storage.loadInBatches(100, async (batch) => {
           chunks.push(...batch);
       });
       const json = JSON.stringify({ docs: chunks });
       await this.adapter.write(filepath, json);
   }
   ```

---

## Risk Mitigation

### High Risk: Migration Failure

**Risk**: Migration from JSON to IndexedDB fails, data lost

**Mitigation**:
- Never delete original JSON, only rename to .backup
- Test migration extensively before release
- Add rollback logic in catch blocks
- Keep .backup files indefinitely (user can delete manually)

### Medium Risk: IndexedDB Not Available

**Risk**: Some browsers/environments don't support IndexedDB

**Mitigation**:
- Check for IndexedDB availability in init()
- Fallback to in-memory only mode (no persistence)
- Show user-friendly error message
- Log warning for debugging

```typescript
async init() {
    if (!window.indexedDB) {
        log.warn("IndexedDB not available, running in memory-only mode");
        // Initialize Orama without persistence
        return;
    }
    // ... normal init
}
```

### Medium Risk: Performance Regression

**Risk**: IndexedDB slower than JSON on desktop

**Mitigation**:
- Benchmark thoroughly on desktop
- Optimize batch size if needed
- Use transactions efficiently
- Consider caching frequently accessed data

### Low Risk: IndexedDB Quota Exceeded

**Risk**: Browser storage quota exceeded for very large vaults

**Mitigation**:
- Monitor storage usage
- Provide cleanup utility
- Warn user if approaching quota
- Consider compression for embeddings

---

## Quality Gates

Each phase must pass these criteria before moving to next:

1. **All tests passing**: Unit + integration tests green
2. **Code review**: Self-review checklist completed
3. **No console errors**: Clean console during manual testing
4. **Documentation**: Code comments and docs updated
5. **Performance**: Meets memory and time targets

---

## Timeline

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Storage Layer | 2-3 hours | None |
| Phase 2: Batch Loading | 2-3 hours | Phase 1 |
| Phase 3: Orama Integration | 3-4 hours | Phase 1, 2 |
| Phase 4: Migration Logic | 3-4 hours | Phase 3 |
| Phase 5: Integration Testing | 2-3 hours | Phase 4 |
| Phase 6: Mobile Testing | 4-6 hours | Phase 5 |
| Phase 7: Documentation | 1-2 hours | Phase 6 |

**Total Estimated Time**: 17-25 hours

---

## Success Metrics

The implementation is successful if:

- [ ] All unit tests pass (>80% coverage)
- [ ] All integration tests pass
- [ ] Memory usage < 100MB on Android for 3000 note vault
- [ ] Load time < 2 minutes on mobile for 3000 note vault
- [ ] Migration success rate 100% in testing
- [ ] No crashes during stress testing
- [ ] Code reviewed and approved
- [ ] Documentation complete

---

## Post-Implementation Tasks

After successful deployment:

1. **Monitor user feedback**
   - Watch GitHub issues for crash reports
   - Monitor mobile-specific issues
   - Collect performance feedback

2. **Gather metrics** (if telemetry available)
   - Migration success rate
   - Average load times
   - Memory usage statistics

3. **Plan follow-up improvements**
   - Remove deprecated persist() calls
   - Remove auto-save interval setting
   - Add IndexedDB export utility
   - Consider compression for embeddings

4. **Update documentation**
   - Update README with IndexedDB info
   - Add troubleshooting section
   - Document .backup file handling

---

## Resources Needed

- **Development Tools**:
  - Node.js with --expose-gc for memory testing
  - Chrome DevTools for profiling
  - Vitest for unit testing
  - fake-indexeddb for mocking

- **Testing Devices**:
  - Xiaomi 14T (HyperOS 2.0) - primary
  - Xiaomi Pad 6 (HyperOS 2.0) - secondary
  - Desktop (macOS/Linux/Windows) - baseline

- **Testing Data**:
  - Test vaults (100, 1000, 3000 notes)
  - Sample JSON database files
  - Stress test scripts

---

## Notes

- Prioritize mobile testing - this is where the bug was reported
- Keep backward compatibility - don't break existing setups
- Be conservative with batch sizes - better safe than sorry
- Document everything - future maintainers will thank you
- Test migration thoroughly - it only happens once per user

---

## Questions to Resolve During Implementation

- [ ] What is the exact structure of Orama's JSON persistence format?
- [ ] Is there a maximum IndexedDB storage quota we should check?
- [ ] Should we add a manual "Force Migration" button in settings?
- [ ] Should we add telemetry to track migration success rates?
- [ ] Should we compress embeddings before storing in IndexedDB?

---

## Contact

For questions or issues during implementation, refer to:
- Design document: `INDEXEDDB_MIGRATION_DESIGN.md`
- Test strategy: `TEST_STRATEGY.md`
- Original bug report: [Link to GitHub issue]
