import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDay } from "@/lib/date";

// The design system's Writing rule for dates: the day with no leading zero,
// the month's first three letters ("Sep", not "Sept") and a four-digit year.
describe("formatDay", () => {
  it("writes a date as Writing.md does, in UTC", () => {
    const CASES: [string, string][] = [
      ["2026-10-08T12:00:00Z", "8 Oct 2026"],
      ["2026-10-29T05:35:00Z", "29 Oct 2026"],
      ["2026-09-01T00:00:00Z", "1 Sep 2026"],
      ["2026-06-30T23:59:59Z", "30 Jun 2026"],
      ["2026-10-08T23:30:00-05:00", "9 Oct 2026"]
    ];
    for (const [iso, want] of CASES)
      assert.equal(formatDay(new Date(iso)), want, iso);
  });
});
