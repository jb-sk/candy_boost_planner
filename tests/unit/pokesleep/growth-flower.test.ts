import { describe, expect, it } from "vitest";

import { resolveBlueSeedSegments } from "../../../src/domain/pokesleep/growth-flower";
import { LunarCalendarUnavailableError } from "../../../src/domain/pokesleep/lunar-calendar";

const flowers = [{ match: "周年記念フェスティバル", days: 7 }];

describe("resolveBlueSeedSegments", () => {
  it.each([
    [1, "2027-07-19"],
    [2, "2027-07-20"],
    [3, "2027-07-21"],
    [4, "2027-07-22"],
    [5, "2027-07-23"],
  ] as const)("uses the configured weekday %s as the planting date", (weekday, expectedFrom) => {
    const result = resolveBlueSeedSegments({
      realSegments: [{ name: "周年記念フェスティバル", from: "2027-07-12", to: "2027-07-18" }],
      projectedOccurrences: [],
      flowers,
      weekday,
      includeGSD: false,
      dayKind: () => "normal",
      until: "2027-12-31",
    });

    expect(result.segments).toEqual([{ from: expectedFrom, to: "2027-07-25", multiplier: 3, source: "flower" }]);
  });

  it("starts the second-week interval at the first flower day even when week one is not seven days", () => {
    const result = resolveBlueSeedSegments({
      realSegments: [{ name: "周年記念フェスティバル", from: "2027-07-12", to: "2027-07-17" }],
      projectedOccurrences: [],
      flowers,
      weekday: 1,
      includeGSD: false,
      dayKind: () => "normal",
      until: "2027-12-31",
    });

    expect(result.segments).toEqual([{ from: "2027-07-18", to: "2027-07-24", multiplier: 3, source: "flower" }]);
  });

  it("does not consult the lunar calendar when GSD is disabled", () => {
    expect(() => resolveBlueSeedSegments({
      realSegments: [{ name: "周年記念フェスティバル", from: "2027-07-12", to: "2027-07-18" }],
      projectedOccurrences: [],
      flowers,
      weekday: 1,
      includeGSD: false,
      dayKind: () => { throw new Error("dayKind must not be called"); },
      until: "2027-12-31",
    })).not.toThrow();

    expect(resolveBlueSeedSegments({
      realSegments: [{ name: "周年記念フェスティバル", from: "2027-07-12", to: "2027-07-18" }],
      projectedOccurrences: [],
      flowers,
      weekday: 1,
      includeGSD: false,
      dayKind: () => "normal",
      until: "2027-12-31",
    })).toEqual({
      segments: [{ from: "2027-07-19", to: "2027-07-25", multiplier: 3, source: "flower" }],
      shifts: [],
    });
  });

  it("does not swallow a lunar-calendar error from dayKind", () => {
    const unavailable = new LunarCalendarUnavailableError("outside generated lunar range");

    expect(() => resolveBlueSeedSegments({
      realSegments: [{ name: "周年記念フェスティバル", from: "2047-07-15", to: "2047-07-21" }],
      projectedOccurrences: [],
      flowers,
      weekday: 1,
      includeGSD: true,
      dayKind: () => { throw unavailable; },
      until: "2047-12-31",
    })).toThrow(unavailable);
  });

  it("moves a weekday planting one day after a full moon and reports the 2027 shift", () => {
    const result = resolveBlueSeedSegments({
      realSegments: [{
        name: "周年記念フェスティバル",
        from: "2027-07-12",
        to: "2027-07-18",
      }],
      projectedOccurrences: [],
      flowers,
      weekday: 1,
      includeGSD: true,
      dayKind: date => date === "2027-07-19" ? "fullMoon" : "normal",
      until: "2027-12-31",
    });

    expect(result.segments).toEqual([{ from: "2027-07-20", to: "2027-07-25", multiplier: 3, source: "flower" }]);
    expect(result.shifts).toEqual([{ year: 2027, from: "2027-07-20", to: "2027-07-25" }]);
  });

  it("takes the source from the origin anniversary, while Friday never shifts", () => {
    const result = resolveBlueSeedSegments({
      realSegments: [{ name: "周年記念フェスティバル", from: "2027-07-12", to: "2027-07-18" }],
      projectedOccurrences: [{
        name: "周年記念フェスティバル",
        sourceFrom: "2027-07-12",
        from: "2028-07-17",
        to: "2028-07-23",
        multiplier: 1.5,
        month: 7,
        weekOfMonth: 2,
      }],
      flowers,
      weekday: 5,
      includeGSD: true,
      dayKind: () => "fullMoon",
      until: "2028-12-31",
    });

    expect(result.segments).toEqual([
      { from: "2027-07-23", to: "2027-07-25", multiplier: 3, source: "flower" },
      // 仮の周年から生えた花は仮のまま。内訳では「仮イベント」行へ入る。
      { from: "2028-07-28", to: "2028-07-30", multiplier: 3, source: "projectedFlower" },
    ]);
    expect(result.shifts).toEqual([]);
  });

  it("does not shift when the planting day is a flank day", () => {
    const result = resolveBlueSeedSegments({
      realSegments: [{ name: "周年記念フェスティバル", from: "2027-07-12", to: "2027-07-18" }],
      projectedOccurrences: [],
      flowers,
      weekday: 1,
      includeGSD: true,
      dayKind: date => date === "2027-07-19" ? "flank" : "normal",
      until: "2027-12-31",
    });

    expect(result.segments).toEqual([{ from: "2027-07-19", to: "2027-07-25", multiplier: 3, source: "flower" }]);
    expect(result.shifts).toEqual([]);
  });

  it("resolves each anniversary independently and shifts only the year that overlaps a full moon", () => {
    const result = resolveBlueSeedSegments({
      realSegments: [
        { name: "周年記念フェスティバル", from: "2027-07-12", to: "2027-07-18" },
        { name: "周年記念フェスティバル", from: "2028-07-17", to: "2028-07-23" },
      ],
      projectedOccurrences: [],
      flowers,
      weekday: 1,
      includeGSD: true,
      dayKind: date => date === "2027-07-19" ? "fullMoon" : "normal",
      until: "2028-12-31",
    });

    expect(result.segments).toEqual([
      { from: "2027-07-20", to: "2027-07-25", multiplier: 3, source: "flower" },
      { from: "2028-07-24", to: "2028-07-30", multiplier: 3, source: "flower" },
    ]);
    expect(result.shifts).toEqual([{ year: 2027, from: "2027-07-20", to: "2027-07-25" }]);
  });

  it("returns no flower segments or day-kind calls when no planting weekday is configured", () => {
    expect(resolveBlueSeedSegments({
      realSegments: [{ name: "周年記念フェスティバル", from: "2027-07-12", to: "2027-07-18" }],
      projectedOccurrences: [],
      flowers,
      weekday: null,
      includeGSD: true,
      dayKind: () => { throw new Error("dayKind must not be called"); },
      until: "2027-12-31",
    })).toEqual({ segments: [], shifts: [] });
  });

  it("does not mutate the configured planting weekday when a full moon shifts the computed date", () => {
    const weekday = 2 as const;
    const result = resolveBlueSeedSegments({
      realSegments: [{ name: "周年記念フェスティバル", from: "2027-07-12", to: "2027-07-18" }],
      projectedOccurrences: [],
      flowers,
      weekday,
      includeGSD: true,
      dayKind: date => date === "2027-07-20" ? "fullMoon" : "normal",
      until: "2027-12-31",
    });

    expect(weekday).toBe(2);
    expect(result.segments[0]?.from).toBe("2027-07-21");
  });
});
