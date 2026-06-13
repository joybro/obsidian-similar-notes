# 1. Show already-linked notes in recommendations (marked), instead of hiding them

Date: 2026-06-14

Status: Accepted

## Context

`SimilarNoteFinder.findSimilarNotes` excluded the active note **and every note it
links to** from the similar-notes search (`[note.path, ...note.links]`, where
`note.links` comes from `metadataCache.resolvedLinks`). This was a deliberate choice
(commit `aaccc1a`, May 2025, "Don't include the notes in the similar notes if they are
linked") whose intent was to surface only *un-linked* notes — pure discovery.

A user reported that our recommendations looked worse than Smart
Connections. Root cause traced with high confidence: the notes Smart Connections ranked
#1 and #2 for his test note (a technical troubleshooting note: a closely-related sister
note and a shared reference) were **both notes he had linked**, so our filter hid exactly
the most obvious, highest-similarity matches. The un-linked results scored near-identically
across both plugins, confirming the embedding quality was fine; we were simply hiding the
best matches. The same mechanism appeared to explain a second reported case (a note that
already links several of its closest related notes).

The cost of the original design: in any head-to-head or first impression the plugin
appears to miss the most obvious matches (reads as "low quality"), and we lose the trust
signal of seeing the tool correctly surface notes the user already judged related.

## Decision

Stop hiding already-linked notes. Exclude only the active note itself
(`[note.path]`). Show linked notes **interleaved by score** so the obvious top match
appears where the user expects it, and **mark** them with a small muted link icon
(tooltip "Already linked") so a discovery-minded user can still tell them apart. The
agent export gains a matching `linked: true/false` field per result.

## Alternatives considered

- **Keep hiding linked notes (status quo).** Rejected: it is the direct cause of the
  report and makes the plugin look strictly worse than Smart Connections (and Obsidian's
  own backlinks/graph, which never hide linked notes). The discovery benefit is invisible;
  the "missing the obvious match" cost is highly visible.
- **Show linked notes unmarked (full Smart Connections parity).** Viable; one-line change.
  Rejected as the default because the marker is cheap (the finder already knows
  `note.links`) and preserves the original discovery intent — a user scanning for *new*
  connections can skip the marked rows at a glance.
- **Add a setting toggle ("Hide already-linked notes"), default off.** Rejected for now:
  adds settings surface most users never touch, and the default is what actually matters.
  Can revisit if a user asks for the old behavior back.
- **Group linked vs unlinked into sections.** Rejected: breaks score ordering, which is
  the whole point (the strongest match must appear at the top regardless of link status).

## Consequences

- Linked notes now appear in the sidebar, the bottom panel, and the agent export. The
  in-document `;;` link suggester and the semantic-search modal are unaffected — they use
  a separate query-based path (`TextSearchService`) where re-suggesting an existing link
  would be genuinely redundant.
- The export JSON contract gains `linked` per result. Kept at `version: 1` (additive
  field; v1 had not been formally released).
- `SimilarNote` carries an optional `isLinked` flag (defaults `false`), threaded through
  `SimilarNoteEntry` to the renderer and the export command.
- Reverses commit `aaccc1a`. If the discovery-only behavior is ever wanted again, prefer
  the setting-toggle alternative above over re-adding a hard filter.
