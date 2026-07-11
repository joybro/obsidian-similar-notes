# Honest Indexing Status & Error Visibility

**Issue**: #45 (CPU indexing silently crashes but reports the vault as fully indexed)
**Auto-resolves**: #46 part A (the "Excluded" miscount) and part B's error-surfacing
(Ollama "too big" failures shown honestly instead of mislabeled "Excluded")
**Date**: 2026-06-06
**Status**: Implemented

Section numbers below (§1–§9) are cited directly from code and tests
(`IndexSettingsSection.tsx`, `NoteIndexingService.ts`, `indexStatus.ts`, and
their `__tests__`) — keep the numbering stable when editing this doc.

## 1. Problem

Two reported symptoms share one root cause: **the plugin had no honest model of
per-note indexing status, and silently swallowed errors.**

- **#45:** On the CPU backend, indexing fails partway through. The work loop
  keeps draining the queue (failed notes were dropped, never re-queued
  in-session), the queue reaches 0, and the UI presents a stable "done-looking"
  state — while most notes were never indexed.
- **#46-A:** The settings "Excluded" stat was computed as `total − indexed`.
  This lumped **glob-excluded + pending + errored + empty** files into one
  misleading "Excluded" number. Errored notes need to be counted separately
  from not-yet-processed ones.
- **#46-B:** Users saw "file too big" errors and assumed large files aren't
  split. They *are* split (`LangchainNoteChunkingService`, `chunkSize =
  maxTokens`). The real cause is per-chunk embedding failures (e.g. the Ollama
  v0.12.5+ payload bug) that fail the whole note — which then surfaced as a
  bogus "Excluded" count with no visible reason.

### Key mechanics discovered while scoping

1. **The change queue is in-memory only** (`NoteChangeQueue.queue`). The only
   persistent state was `IndexedNoteMTimeStore` (IndexedDB, keyed by vaultId).
   A failed note never got an mtime written, so on every restart
   `analyzeSyncNeeds` re-added it to the queue → it failed again. This was
   #45's "reload doesn't help, dies at the same point."
2. **There was no in-session retry.** `pollFileChanges` removes items from the
   queue; on failure the catch block in `NoteIndexingService` logged but did
   **not** re-enqueue. The only "retry" was the per-restart re-queue from (1).
3. **The false "done"** was the queue draining to 0 while failed notes
   silently left the indexed set, mislabeled "Excluded".

## 2. Goals / Non-goals

**Goals**
- Introduce a persistent, terminal **Errored** state distinct from Indexed /
  Pending / Excluded.
- Stop reporting a false "fully indexed" / "Excluded" picture; counts must be
  honest and reflect reality across restarts.
- Make errored notes visible (which files, why) and recoverable (retry
  without a full reindex).
- Stop the re-crash-every-launch loop: a terminally-errored note must not be
  blindly re-queued on restart.

**Non-goals (this version)**
- Root-causing the CPU worker crash itself (#45 layer 1).
- A persistent on-disk log file (#46-C).
- Recommending an Ollama model (#46-D) — handled by an issue comment.

## 3. State model

Four user-facing states. **Counts are assigned by precedence**, because the
underlying stores can transiently overlap (an already-indexed file that was
just edited still has its old mtime *and* sits in the queue):

```
Assign each markdown file to the FIRST matching bucket:
1. Excluded  — matches an excludeFolderPatterns glob (never enters the queue)
2. Errored   — present in the ErroredNoteStore
3. Pending   — present in the change queue (new files + "edited but not yet reprocessed" indexed files)
4. Indexed   — present in the mtime store and not queued (final, up-to-date state)
```

So "Indexed: N" means *N notes are in their final, up-to-date indexed state.*
Editing an indexed note briefly moves it Indexed → Pending → Indexed; that
count dip is honest.

> **Implementation note:** the shipped `computeIndexStatus` (§4.5) derives
> Pending as the *remainder* (`total − excluded − errored − indexed`) rather
> than from live queue membership, so the helper needs no queue dependency.
> Consequence: an already-indexed note that was just edited counts as Indexed
> (its prior embedding is still valid) until reprocessed, instead of
> momentarily Pending. Real-time pending is surfaced separately by the status
> bar's existing live "N to index" queue indicator. The precedence order
> itself (Excluded > Errored > Indexed) is unchanged.

### Invariant

A file is conceptually in exactly one state *for counting*. Physical store
membership is reconciled by the precedence above and by these transition
rules:

- **Process failure:** `change.attempts = (change.attempts ?? 0) + 1`.
  - `attempts < MAX_ATTEMPTS (3)` → re-enqueue the change (in-session retry).
    State: Pending.
  - `attempts >= 3` → write `{ error, attempts, mtime }` to ErroredNoteStore,
    drop from queue. State: Errored.
- **Process success:** write mtime (Indexed); remove from ErroredNoteStore if
  present.
- **Enqueue (live edit, startup re-queue, or Retry button):** remove from
  ErroredNoteStore immediately → Pending. (Guarantees no file is both Errored
  and Pending.)
- **Reindex all:** clear ErroredNoteStore alongside the mtime store.

### Retry triggers (does it only retry on the button?)

| Situation | What happens | Automatic? |
|---|---|---|
| File edited while plugin running | `vault.on("modify")` → fresh NoteChange (attempts=0) enqueued + cleared from ErroredNoteStore | ✅ |
| File edited while plugin off | On restart, `analyzeSyncNeeds` sees vault mtime ≠ ErroredNoteStore's recorded mtime → clears errored + re-queues | ✅ |
| File unchanged, external cause fixed (model swap, Ollama restored, settings) | No file signal to detect | ❌ → **"Retry errored" button** (or reindex all) |

Rationale: *content changed → auto-retry* (trimming a too-big note is the main
self-heal path for #45/#46-B); *content unchanged, environment changed →
manual button.* The ErroredNoteStore therefore **records the mtime at error
time**, so an offline edit is detectable on restart.

### Stale-embedding decision

When a **previously-indexed** file fails reprocessing and goes
terminal-errored, it still has its old chunks in Orama and its old mtime.
**Decision: keep the stale embedding** (search keeps working on slightly-old
content rather than dropping the note), and rely on precedence
(Errored > Indexed) so it is counted once, as Errored, and listed in the
errored list. **Removing stale chunks was rejected**: losing search results on
a transient reprocess failure is worse than slightly-stale results.

## 4. Components & changes

### 4.1 `ErroredNoteStore` — `src/infrastructure/ErroredNoteStore.ts`

Mirrors `IndexedNoteMTimeStore`: an IndexedDB-backed, vaultId-keyed store with
an in-memory cache and a `BehaviorSubject<number>` count.

```
type ErroredNote = { error: string; attempts: number; mtime?: number; lastTriedAt: number };

init(vaultId): Promise<void>
get(path): ErroredNote | undefined
set(path, entry): Promise<void>
delete(path): Promise<void>
clear(): Promise<void>
getAllPaths(): string[]
getAll(): Record<string, ErroredNote>
getErroredCount$(): Observable<number>
```

Generalizes the existing `IndexedDBMTimeStorage` pattern (a parallel
`IndexedDBErroredStorage`). `lastTriedAt` is set from a timestamp passed in by
the caller (scripts/services have clock access; the store itself stays pure).

### 4.2 `NoteChange.attempts` + in-session retry — `noteChangeQueue.ts`, `NoteIndexingService.ts`

- `NoteChange` gains an optional `attempts?: number`.
- `NoteChangeQueue.requeue(change)` re-adds a failed change with an
  incremented count.
- In `NoteIndexingService`'s failure handling: re-enqueue vs. write-to-errored
  at `MAX_ATTEMPTS = 3` (see §8).
- On the success path: after marking the change processed, clear any existing
  ErroredNoteStore entry (no-op if absent).

### 4.3 `analyzeSyncNeeds` skip + offline-edit detection — `noteChangeQueue.ts`

In `analyzeSyncNeeds`, before adding a non-indexed file to `toAdd`:
- If it's in the ErroredNoteStore **and** its current vault mtime equals the
  stored error-time mtime → **skip** (don't re-queue; it stays Errored). This
  is what breaks the "re-crash every launch" loop (#45).
- If it's in the ErroredNoteStore but the vault mtime differs → it was edited
  offline → **clear from ErroredNoteStore** and add to `toAdd`.

`NoteChangeQueue` gains an `ErroredNoteStore` dependency (constructor), same
as it already takes `IndexedNoteMTimeStore`.

### 4.4 Enqueue-clears-errored — `noteChangeQueue.ts`

The `create`/`modify` event handlers and `enqueueAllNotes` paths clear the
ErroredNoteStore entry for any path they enqueue, preserving the "not both
Errored and Pending" invariant. (The live `modify` handler is the §3
"edited while running" path.)

### 4.5 Status computation helper — `src/application/indexStatus.ts`

A single pure function computing the four precedence-based counts from:
`vault.getMarkdownFiles()`, `excludeFolderPatterns`, mtime store paths, queue
paths, errored store paths. This is the one source of truth for both the
settings section and the status bar, replacing the ad-hoc `total − indexed`
in `IndexSettingsSection.tsx`.

```
computeIndexStatus(...) => { total, excluded, errored, pending, indexed }   // sums to total
```

(See the §3 implementation note above for the shipped Pending-as-remainder
refinement, and `visibleErroredEntries` — a companion filter added during
implementation so the errored list/count agree with the "Errored: N" stat
after a folder is newly excluded or a file is deleted.)

### 4.6 UI — `IndexSettingsSection.tsx`

- Replaced the single "Excluded" stat with the honest set: **Indexed /
  Errored / Excluded**.
- Added an **errored files list** (collapsible, mirroring the existing
  excluded-files preview): each row shows the file path + its `error` reason.
  The list is capped (first 100), noting the cap if exceeded.
- Added a **"Retry errored"** button: clears the ErroredNoteStore entries and
  re-enqueues those paths (fresh attempts=0). Disabled when errored count is
  0.

### 4.7 UI — `StatusBarView.ts`

- The tooltip/menu "Indexed: X/total notes" gains an errored indicator when
  errored > 0 (e.g. `Indexed: 690/700 (10 errored)`), and the icon reflects a
  non-clean state so "done" is never implied while notes are errored.
- "Retry errored" is reachable from the status-bar menu too (parity with the
  existing "Reindex all").

### 4.8 Embedding hang→error safeguard

If the CPU crash manifests as a **hung** worker (embedding promise never
resolves), the "3 strikes → Errored" transition never fires and the note
stays perpetually Pending. A timeout around the embedding call would convert
hangs into catchable errors.

**Risk:** a fixed timeout can false-error a *slow-but-working* machine (a low-
power CPU may legitimately take long on a many-chunk note batched in one
call). The observed symptom ("queue drains to done") suggests failures
currently surface as **rejections** (catch fires), implying a timeout may be
unnecessary for the primary case.

This item was deferred rather than implemented — see "Known follow-up" below.

## 5. Data flow (failure path)

```
note change → pollFileChanges (removed from queue)
  → processUpdatedNote → embedTexts
      success → putMulti + markNoteChangeProcessed(mtime) + erroredStore.delete  → Indexed
      failure → attempts++
                 < 3 → requeue(change with attempts)                              → Pending
                 = 3 → erroredStore.set(path,{error,attempts,mtime,lastTriedAt})  → Errored
```

## 6. Error handling

- All embedding/processing exceptions are caught and routed through the
  attempts machinery; the existing first-failure Notice (`showNoteErrorNotice`)
  stays, but no longer implies the note will silently retry forever. The
  failure routing (`processChange`'s catch, §5) must own **all** processing
  exceptions — nothing downstream may swallow them, or a note can get stuck
  without ever reaching the attempts machinery.
- ErroredNoteStore writes are awaited; a failure to persist an errored entry
  logs but does not crash the loop.

## 7. Testing (spec-item-traceable)

Hermetic Vitest, fake stores/in-memory IndexedDB mock, Obsidian mocked.

- **State transitions (§3):**
  - `failure < 3 times → note is Pending (re-enqueued), not Errored`
  - `failure reaching 3 → note moves to Errored, removed from queue, recorded with error+mtime`
  - `success after prior failures → Indexed, removed from ErroredNoteStore`
  - `enqueue clears an existing Errored entry (never both Pending and Errored)`
- **Restart behavior (§4.3):**
  - `errored note with unchanged mtime is NOT re-queued on analyzeSyncNeeds`
  - `errored note whose mtime changed offline IS cleared and re-queued`
- **Count honesty (§3 precedence):**
  - `Excluded counts only glob-excluded files (not errored/pending)` — regression test for #46-A
  - `edited-but-not-reprocessed indexed file counts as Pending, not Indexed`
  - `previously-indexed file that errors counts once, as Errored (stale embedding kept)`
  - `the four counts sum to total markdown file count`
- **Retry button (§4.6):**
  - `Retry errored clears the store and re-enqueues exactly the errored paths with fresh attempts`
- **Reindex all:** `clears ErroredNoteStore alongside the mtime store`

## 8. Design decisions

Resolved at plan time (originally scoped as open questions):

1. **Embedding timeout (§4.8):** deferred, not implemented this version — see
   "Known follow-up" below.
2. **Pending in the static settings display:** Errored + Excluded are the
   honest fix and are shown as their own stats; Pending is not a separate
   static stat (it's implied / surfaced live by the status bar's queue
   indicator).
3. **`MAX_ATTEMPTS` value: 3, as a plain module constant, not a user-facing
   setting.** Deliberate YAGNI — no reported need to tune retry count per
   vault/provider, and a setting would add UI surface and a persistence
   concern for a value with no evidence it needs to vary.

## 9. Follow-ups (separate issues / next version)

- #45 layer 1: reproduce & root-cause the CPU worker crash (likely OOM from
  batching all chunks of a note in one `embedTexts` call; candidate fix =
  chunk-batch splitting — see `docs/builtin-embedding-batch-cap-spec.md` for
  where that landed). The visibility layer here makes it diagnosable.
- #46-C: persistent diagnostic log file / export.
- #46-D: Ollama model recommendation (issue comment, e.g. `nomic-embed-text` /
  `mxbai-embed-large`).

## Known follow-up (not yet implemented)

**Embedding hang→error timeout (§4.8).** If the embedding call hangs instead
of rejecting, the "3 strikes → Errored" transition never fires and the note
stays stuck Pending forever — the honest-status model built here degrades to
the old silent-stall failure mode for that one case. A timeout around the
embedding call would convert a hang into a catchable, retryable failure, but a
naive fixed timeout risks false-erroring a genuinely slow-but-working machine
on a large note, so it needs to be generous and ideally scaled to chunk count.
Deferred to the **#45 crash root-cause follow-up** rather than done here,
since a timeout value can't be tuned sensibly until the crash mechanism itself
is understood. Never implemented — no timeout exists around the embedding call
today.
