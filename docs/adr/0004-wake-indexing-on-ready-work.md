# 0004: Wake indexing when queued work is ready

Status: Accepted

## Context

After Obsidian saves an edit, the queue waits the user's indexing delay.
The idle indexer then waits until its next one-second poll. A local test-vault measurement found the latter adding up to about one
more second, even with a warm local model.

## Decision

Publish ready-work notifications through the existing queue enqueue path.
The scheduler replaces an idle timer with a zero-delay pass. Busy passes
continue draining serially; stop/restart uses generation checks and waits
for prior I/O. Keep the one-second idle/error poll as fallback.

## Alternatives considered

- Shorter periodic polling: simpler but wakes an idle vault more often and
  still introduces an arbitrary remainder.
- Reduce the user's delay or bypass editor autosave: changes the deliberate
  batching policy and may increase provider calls. This change addresses
  only accidental scheduler delay.

## Consequences

Settings and embedding batches stay the same. Queue append sites must all
use enqueue so they publish readiness. Scheduling is kept in its own
module, separate from indexing/retry policy and below the service's size
limit. Editor autosave and embedding latency remain visible to the user.
