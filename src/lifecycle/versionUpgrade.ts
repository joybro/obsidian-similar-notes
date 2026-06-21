import log from "loglevel";

/**
 * Determine whether a plugin version change requires a full reindex to migrate
 * the on-disk index into IndexedDB.
 *
 * Returns true when:
 * - there is no recorded previous version (fresh install, or upgrade from
 *   pre-0.10.0 which never recorded one), or
 * - upgrading from exactly 0.10.0 (which shipped with migration issues), or
 * - upgrading from any 0.x below 0.10.
 */
export function needsReindexForUpgrade(
    lastVersion: string | undefined,
    currentVersion: string
): boolean {
    // No last version recorded - fresh install or upgrade from pre-0.10.0
    if (!lastVersion) {
        log.info(
            "No last version recorded - will trigger reindex for IndexedDB migration"
        );
        return true;
    }

    const parseVersion = (v: string): number[] =>
        v.split(".").map((n) => parseInt(n, 10) || 0);

    const last = parseVersion(lastVersion);

    // Exactly 0.10.0 had migration issues
    if (last[0] === 0 && last[1] === 10 && last[2] === 0) {
        log.info(
            `Upgrading from ${lastVersion} to ${currentVersion} - reindex needed due to 0.10.0 migration issues`
        );
        return true;
    }

    // Any 0.x below 0.10
    if (last[0] === 0 && last[1] < 10) {
        log.info(
            `Upgrading from ${lastVersion} to ${currentVersion} - reindex needed for IndexedDB migration`
        );
        return true;
    }

    return false;
}
