# Indexing Queue Wakeup Specification

## 1. Ready work

`NoteChangeQueue` publishes `getReadyChanges$(): Observable<void>` after work
is appended through its existing `enqueue(changes: NoteChange[])` method.
All append paths use that method: create, debounced modify, delete, rename,
retry, title backfill, exclusion changes, initialization and full reindex.
An empty append publishes nothing. The event announces ready work, not a
file edit still waiting for `indexingDelaySeconds` to expire.

## 2. Scheduling

When the indexing loop is idle with a scheduled poll, ready work cancels
that poll and schedules a zero-delay pass. Scheduling rather than calling
the pass synchronously lets the producer finish its queue mutations first.
The one-second idle/error poll remains a fallback. While a pass is active,
notifications do not start another pass: the existing drain loop picks up
the work after the pass completes. Provider concurrency remains one for
local inference and five for providers supporting parallel processing.

## 3. Lifecycle

Starting an already-started loop does nothing. Stopping unsubscribes the
ready-work listener and cancels the scheduled timer. A pass already doing
I/O may finish, but its old loop cannot schedule or drain more work after
stop, including after a subsequent restart. A restarted loop waits for the
previous pass before polling, preserving the provider concurrency limit.

## 4. User contract

The configured delay and its default, persisted settings, embedding inputs,
retry limits, panel filtering and existing visible results are unchanged.
The change removes only the extra wait between queue readiness and polling.
Editor autosave and embedding computation still contribute to total delay.
No new control or message is introduced.

## 5. Verification

Integration tests run the real queue and indexing loop with fake time and
filesystem/model boundaries: edits are not processed before their debounce;
ready work starts without the old poll remainder; busy passes stay serial;
stop and restart cannot leave an old drain loop alive. Runtime measurement
uses editor saves in a disposable test vault with a warm local model and records both
queue timing and DOM continuity, separately from human-perceived smoothness.
