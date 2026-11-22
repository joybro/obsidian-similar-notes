/**
 * Why the results list is empty, so the panel can say something true
 * (docs/panel-empty-states-spec.md). Undefined means "not computed" and
 * reads like "none".
 */
export type EmptyReason =
    | { kind: "loading" }
    | { kind: "downloading"; percent: number }
    | { kind: "no-note" }
    | { kind: "unwritten" }
    | { kind: "excluded-cloud"; provider: "OpenAI" | "Gemini" }
    | { kind: "embedding-failed" }
    | { kind: "below-threshold"; threshold: number }
    | { kind: "indexing"; remaining: number }
    | { kind: "none" };

export function emptyStateText(reason: EmptyReason | undefined): string {
    switch (reason?.kind) {
        case "loading":
            return "Looking for similar notes…";
        case "downloading":
            // Same rounding as the status bar, so the two numbers agree.
            return `Downloading the model: ${Math.floor(reason.percent)}%. Similar notes will appear when it's ready.`;
        case "no-note":
            return "Open a note and similar notes will appear here.";
        case "unwritten":
            return "Write a few lines and similar notes will appear here.";
        case "excluded-cloud":
            return `This note is excluded from the index, so it isn't sent to ${reason.provider}.`;
        case "embedding-failed":
            return "Couldn't analyze this note. Check the model in Settings, then reopen the note.";
        case "below-threshold":
            return `No notes above the minimum similarity (${reason.threshold.toFixed(2)}).`;
        case "indexing": {
            const n = reason.remaining.toLocaleString("en-US");
            const noun = reason.remaining === 1 ? "note" : "notes";
            return `Indexing your vault: ${n} ${noun} left. Results fill in as notes are indexed.`;
        }
        default:
            return "No similar notes found.";
    }
}
