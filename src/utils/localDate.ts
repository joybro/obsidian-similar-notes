/**
 * Date key (YYYY-MM-DD) of the given moment in the user's local time zone.
 * Daily usage is bucketed by this key so "Today" starts at local midnight,
 * not at UTC midnight.
 */
export function localDateKey(date: Date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}
