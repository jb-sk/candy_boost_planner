import { describe, expect, it } from "vitest";

import {
  createSleepSchedule,
  resolveEventBonus,
  resolveEventMultiplier,
} from "../../../src/domain/pokesleep/sleep-schedule";
import { normalizeBlueSeedIncenseDays } from "../../../src/domain/types";

const day = "2026-01-02" as const;

describe("event source resolution", () => {
  it("uses max multiplier and breaks equal values real > flower > projectedFlower > projected", () => {
    const segments = [
      { from: day, to: day, multiplier: 1.5, source: "projected" as const },
      { from: day, to: day, multiplier: 1.5, source: "projectedFlower" as const },
      { from: day, to: day, multiplier: 1.5, source: "flower" as const },
      { from: day, to: day, multiplier: 1.5, source: "real" as const },
    ];
    expect(resolveEventMultiplier(day, segments)).toBe(1.5);
    expect(resolveEventBonus(day, segments)).toEqual({ multiplier: 1.5, source: "real" });
    expect(resolveEventBonus(day, segments.slice(0, 3))).toEqual({ multiplier: 1.5, source: "flower" });
    expect(resolveEventBonus(day, segments.slice(0, 2))).toEqual({ multiplier: 1.5, source: "projectedFlower" });
    expect(resolveEventBonus(day, [{ ...segments[0], multiplier: 2 }])).toEqual({ multiplier: 2, source: "projected" });
    expect(resolveEventBonus(day, [
      { from: day, to: day, multiplier: 1.25, source: "projected" },
      { from: day, to: day, multiplier: 1.5, source: "projected" },
    ])).toEqual({ multiplier: 1.5, source: "projected" });
  });

  it("retains the event winner source even when the event is the only outer bonus", () => {
    const schedule = createSleepSchedule({
      startGameDate: "2026-01-01",
      timeZone: "UTC",
      includeGSD: false,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 0,
      eventSegments: [{ from: day, to: day, multiplier: 1.5, source: "projected" }],
    });
    expect(schedule.dayAt(1)).toMatchObject({
      date: day,
      eventMultiplier: 1.5,
      eventSource: "projected",
      eventBonus: 1.5,
    });
  });

  it("retains the event winner source when GSD has the larger outer multiplier", () => {
    const schedule = createSleepSchedule({
      startGameDate: "2026-01-01",
      timeZone: "UTC",
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 0,
      eventSegments: [{ from: day, to: day, multiplier: 1.5, source: "projected" }],
      fullMoonDates: [day],
    });

    expect(schedule.dayAt(1)).toMatchObject({
      date: day,
      gsdMultiplier: 3,
      eventMultiplier: 1.5,
      eventSource: "projected",
      eventBonus: 3,
    });
  });

  it("uses real as the source on a day with no event segments", () => {
    const schedule = createSleepSchedule({
      startGameDate: "2026-01-01",
      timeZone: "UTC",
      includeGSD: false,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 0,
      eventSegments: [],
    });

    expect(schedule.dayAt(0)).toMatchObject({
      date: "2026-01-01",
      eventMultiplier: 1,
      eventSource: "real",
      eventBonus: 1,
    });
  });

  it("does not double-count a manual x3 event and a flower on the same day", () => {
    const schedule = createSleepSchedule({
      startGameDate: "2026-01-01",
      timeZone: "UTC",
      includeGSD: false,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 0,
      eventSegments: [
        { from: day, to: day, multiplier: 3, source: "real" },
        { from: day, to: day, multiplier: 3, source: "flower" },
      ],
    });

    expect(schedule.dayAt(1)).toMatchObject({ eventMultiplier: 3, eventBonus: 3, eventSource: "real" });
  });

  it("merges a flower into the event slot and keeps a full-moon day at x3", () => {
    const schedule = createSleepSchedule({
      startGameDate: "2026-01-01",
      timeZone: "UTC",
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 0,
      eventSegments: [{ from: "2026-01-02", to: "2026-01-02", multiplier: 3, source: "flower" }],
      fullMoonDates: [day],
    });

    expect(schedule.dayAt(1)).toMatchObject({
      date: "2026-01-02",
      dayKind: "fullMoon",
      eventMultiplier: 3,
      eventSource: "flower",
      eventBonus: 3,
    });
  });
});

describe("Blue Seed Growth Incense allocation", () => {
  const flower = [{ from: "2026-01-06", to: "2026-01-11", multiplier: 3, source: "flower" }] as const;
  const base = {
    startGameDate: "2026-01-05" as const,
    timeZone: "UTC",
    includeGSD: false,
    growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
    growthIncenseNormalPerWeek: 3 as const,
    eventSegments: flower,
  };

  it("auto preserves the existing weekly allocation exactly", () => {
    const legacy = createSleepSchedule(base).days(7);
    const automatic = createSleepSchedule({ ...base, blueSeedIncenseDays: "auto" }).days(7);
    expect(automatic).toEqual(legacy);
  });

  it("accepts only auto or integer day counts from 0 through 7", () => {
    expect(["auto", 0, 3, 7].map(normalizeBlueSeedIncenseDays)).toEqual(["auto", 0, 3, 7]);
    expect([-1, 8, 1.5, "3", null].map(normalizeBlueSeedIncenseDays))
      .toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("zero excludes the whole Blue Seed period from weekly and GSD allocation", () => {
    const schedule = createSleepSchedule({
      ...base,
      growthIncenseNormalPerWeek: 7,
      blueSeedIncenseDays: 0,
    });
    expect(schedule.days(7).map(day => day.useIncense))
      .toEqual([true, false, false, false, false, false, false]);
  });

  it("a number forces only the first N days inside the Blue Seed period", () => {
    const schedule = createSleepSchedule({
      ...base,
      growthIncenseNormalPerWeek: 7,
      blueSeedIncenseDays: 2,
    });
    expect(schedule.days(7).map(day => day.useIncense))
      .toEqual([true, true, true, false, false, false, false]);
  });

  it("clamps N to the segment length", () => {
    const schedule = createSleepSchedule({
      ...base,
      startGameDate: "2026-01-09",
      growthIncenseNormalPerWeek: 0,
      blueSeedIncenseDays: 7,
      eventSegments: [{ from: "2026-01-09", to: "2026-01-11", multiplier: 3, source: "projectedFlower" }],
    });
    expect(schedule.days(3).map(day => day.useIncense)).toEqual([true, true, true]);
  });

  it("keeps chronological stock consumption and marks forced days after stock runs out", () => {
    const schedule = createSleepSchedule({
      ...base,
      startGameDate: "2026-01-06",
      growthIncenseNormalPerWeek: 0,
      growthIncenseStock: 1,
      blueSeedIncenseDays: 3,
    });
    expect(schedule.days(4).map(day => [day.useIncense, day.incenseOutOfStock]))
      .toEqual([[true, false], [false, true], [false, true], [false, false]]);
  });

  it("uses the whole segment when N equals its length, and stops there", () => {
    // 区間 01-06〜01-11 は6日。N=6 は「ちょうど区間ぶん」。
    // **区間の前（01-05）と後ろ（01-12）の両方**まで見て、外へ波及しないことを固定する。
    const schedule = createSleepSchedule({
      ...base,
      growthIncenseNormalPerWeek: 0,
      blueSeedIncenseDays: 6,
    });
    expect(schedule.days(8).map(day => day.useIncense))
      // 月 | 火 水 木 金 土 日 | 月
      .toEqual([false, true, true, true, true, true, true, false]);
  });

  it("counts the N days from the start of each segment separately", () => {
    // 区間が2本ある年でも、日数は**それぞれの先頭から**数え直す。
    const schedule = createSleepSchedule({
      ...base,
      startGameDate: "2026-01-06",
      growthIncenseNormalPerWeek: 0,
      blueSeedIncenseDays: 2,
      eventSegments: [
        { from: "2026-01-06", to: "2026-01-08", multiplier: 3, source: "flower" },
        { from: "2026-01-09", to: "2026-01-11", multiplier: 3, source: "projectedFlower" },
      ],
    });
    expect(schedule.days(6).map(day => day.useIncense))
      .toEqual([true, true, false, true, true, false]);
  });

  it("counts from the start of every overlapping segment, not just the first match", () => {
    // 同じ回に実の花と仮の花が両方生えて1日ずれることがある。N=1 のとき 01-02 は
    // 前者では2日目（skip）だが後者では先頭日なので、**使う**が正しい。
    const schedule = createSleepSchedule({
      ...base,
      startGameDate: "2026-01-01",
      growthIncenseNormalPerWeek: 0,
      blueSeedIncenseDays: 1,
      eventSegments: [
        { from: "2026-01-01", to: "2026-01-03", multiplier: 3, source: "flower" },
        { from: "2026-01-02", to: "2026-01-04", multiplier: 3, source: "projectedFlower" },
      ],
    });
    expect(schedule.days(5).map(day => day.useIncense))
      .toEqual([true, true, false, false, false]);
  });

  it("keeps counting across an ISO week boundary and leaves each week's outside days alone", () => {
    // 週をまたぐ区間（木 01-08 〜 水 01-14）。先頭2日＝木・金だけが使い、
    // 週が変わっても数え直さない（翌週へ入った 01-12〜01-14 も区間内なので落ちる）。
    // 翌週の区間外（01-15 以降）には、その週の枠が従来どおり配られる。
    const schedule = createSleepSchedule({
      ...base,
      startGameDate: "2026-01-08",
      growthIncenseNormalPerWeek: 1,
      blueSeedIncenseDays: 2,
      eventSegments: [{ from: "2026-01-08", to: "2026-01-14", multiplier: 3, source: "flower" }],
    });
    expect(schedule.days(10).map(day => day.useIncense))
      // 木 金 土 日 | 月 火 水 木 金 土
      .toEqual([true, true, false, false, false, false, false, true, false, false]);
  });

  it("changes nothing when there is no Blue Seed period at all", () => {
    // 曜日が「使わない」なら花区間が1本も生えない（`growth-flower.ts`）。設定は素通りする。
    const withoutFlower = { ...base, eventSegments: [], growthIncenseNormalPerWeek: 2 as const };
    expect(createSleepSchedule({ ...withoutFlower, blueSeedIncenseDays: 0 }).days(7))
      .toEqual(createSleepSchedule(withoutFlower).days(7));
  });

  it("leaves weeks without a Blue Seed period on the normal weekly allocation", () => {
    // 区間の無い週まで塞いでしまう退行を落とす（規則1は区間の中だけの話）。
    const schedule = createSleepSchedule({
      ...base,
      startGameDate: "2026-01-12",
      growthIncenseNormalPerWeek: 2,
      blueSeedIncenseDays: 0,
    });
    expect(schedule.days(7).map(day => day.useIncense))
      .toEqual([true, true, false, false, false, false, false]);
  });

  it("lets the numeric Blue Seed setting override a later checked GSD day inside the segment", () => {
    const schedule = createSleepSchedule({
      ...base,
      startGameDate: "2026-01-06",
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: true, fullMoon: true, afterFullMoon: true },
      growthIncenseNormalPerWeek: 7,
      blueSeedIncenseDays: 2,
      fullMoonDates: ["2026-01-09"],
    });
    expect(schedule.days(6).map(day => day.useIncense))
      .toEqual([true, true, false, false, false, false]);
  });

  it("still honours checked GSD days that fall outside the segment when GSD spans two weeks", () => {
    // 満月 01-12（月）＝ GSD3日は 01-11(日) / 01-12(月) / 01-13(火) で週をまたぐ。
    // 区間（01-06〜01-11）の中に入る 01-11 だけが落ち、週の外の2日は従来どおり必須。
    const schedule = createSleepSchedule({
      ...base,
      startGameDate: "2026-01-06",
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: true, fullMoon: true, afterFullMoon: true },
      growthIncenseNormalPerWeek: 0,
      blueSeedIncenseDays: 2,
      fullMoonDates: ["2026-01-12"],
    });
    expect(schedule.days(8).map(day => day.useIncense))
      // 火 水 木 金 土 日 | 月 火
      .toEqual([true, true, false, false, false, false, true, true]);
  });
});
