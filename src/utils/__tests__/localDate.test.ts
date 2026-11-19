import { afterEach, describe, expect, test } from "vitest";
import { localDateKey } from "@/utils/localDate";

const originalTz = process.env.TZ;

afterEach(() => {
    process.env.TZ = originalTz;
});

describe("localDateKey", () => {
    test("uses the local date, not the UTC date", () => {
        process.env.TZ = "Asia/Seoul";
        // 16:00 UTC on Nov 19 is 01:00 on Nov 20 in Seoul.
        expect(localDateKey(new Date("2026-11-19T16:00:00Z"))).toBe(
            "2026-11-20"
        );
    });

    test("west of UTC, late evening stays on the same local day", () => {
        process.env.TZ = "America/Los_Angeles";
        // 03:00 UTC on Nov 20 is 19:00 on Nov 19 in Los Angeles.
        expect(localDateKey(new Date("2026-11-20T03:00:00Z"))).toBe(
            "2026-11-19"
        );
    });
});
