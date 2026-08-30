import { describe, expect, it } from "vitest";

import { attributeSleepBonusExpForDays } from "../../../src/domain/pokesleep/sleep-growth";
import { createSleepSchedule, type SleepSchedule } from "../../../src/domain/pokesleep/sleep-schedule";

function schedule(source: "projected" | "flower" | "projectedFlower", multiplier: number) {
  return createSleepSchedule({
    startGameDate: "2026-01-01",
    timeZone: "UTC",
    includeGSD: false,
    growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
    growthIncenseNormalPerWeek: 0,
    eventSegments: [{ from: "2026-01-01", to: "2026-01-01", multiplier, source }],
  });
}

describe("attributeSleepBonusExpForDays event kinds", () => {
  it("merges each flower into the event row matching its origin", () => {
    expect(attributeSleepBonusExpForDays({
      days: 1,
      dailySleepMinutes: 510,
      sleepExpBonus: 1,
      nature: "normal",
      schedule: schedule("projected", 1.5),
    })).toContainEqual(expect.objectContaining({ kind: "projectedEvent", multiplier: 1.5, days: 1, exp: 50 }));

    expect(attributeSleepBonusExpForDays({
      days: 1,
      dailySleepMinutes: 510,
      sleepExpBonus: 1,
      nature: "normal",
      schedule: schedule("flower", 3),
    })).toContainEqual(expect.objectContaining({ kind: "event", multiplier: 3, days: 1, exp: 200 }));

    expect(attributeSleepBonusExpForDays({
      days: 1,
      dailySleepMinutes: 510,
      sleepExpBonus: 1,
      nature: "normal",
      schedule: schedule("projectedFlower", 3),
    })).toContainEqual(expect.objectContaining({ kind: "projectedEvent", multiplier: 3, days: 1, exp: 200 }));
  });

  it("attributes a flower overlapping a projected anniversary to the projected-event row", () => {
    const schedule = createSleepSchedule({
      startGameDate: "2026-01-01",
      timeZone: "UTC",
      includeGSD: false,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 0,
      eventSegments: [
        { from: "2026-01-01", to: "2026-01-01", multiplier: 1.5, source: "projected" },
        { from: "2026-01-01", to: "2026-01-01", multiplier: 3, source: "projectedFlower" },
      ],
    });

    const kinds = attributeSleepBonusExpForDays({
      days: 1,
      dailySleepMinutes: 510,
      sleepExpBonus: 1,
      nature: "normal",
      schedule,
    }).map(contribution => contribution.kind);
    expect(kinds).toEqual(["base", "projectedEvent"]);
  });

  it("attributes a projected event to GSD when GSD has the winning outer multiplier", () => {
    const gsdWins = {
      dayAt: () => ({
        index: 0,
        date: "2026-01-01",
        dayKind: "fullMoon",
        useIncense: false,
        incenseOutOfStock: false,
        gsdMultiplier: 3,
        eventMultiplier: 1.5,
        eventSource: "projected",
        eventBonus: 3,
        incenseMultiplier: 1,
      }),
    } as unknown as SleepSchedule;

    const contributions = attributeSleepBonusExpForDays({
      days: 1,
      dailySleepMinutes: 510,
      sleepExpBonus: 1,
      nature: "normal",
      schedule: gsdWins,
    });

    expect(contributions).toContainEqual(expect.objectContaining({
      kind: "gsd",
      multiplier: 3,
      days: 1,
    }));
    expect(contributions).not.toContainEqual(expect.objectContaining({ kind: "projectedEvent" }));
  });

  it("splits flowers between the event and projected-event rows while GSD wins its own day", () => {
    const allKinds = createSleepSchedule({
      startGameDate: "2026-01-01",
      timeZone: "UTC",
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 0,
      eventSegments: [
        { from: "2026-01-06", to: "2026-01-06", multiplier: 1.5, source: "real" },
        { from: "2026-01-04", to: "2026-01-04", multiplier: 3, source: "flower" },
        { from: "2026-01-05", to: "2026-01-05", multiplier: 1.5, source: "projected" },
        { from: "2026-01-07", to: "2026-01-07", multiplier: 3, source: "projectedFlower" },
      ],
      fullMoonDates: ["2026-01-02"],
    });

    expect(attributeSleepBonusExpForDays({
      days: 7,
      dailySleepMinutes: 510,
      sleepExpBonus: 1,
      nature: "normal",
      schedule: allKinds,
    }).map(contribution => contribution.kind)).toEqual([
      // 実の花は「イベント ×3」、仮の花は「仮イベント ×3」へ合流し、
      // それぞれ同じ種類の ×1.5 とは倍率が違うので別行に残る。
      "base", "gsd", "gsd", "event", "event", "projectedEvent", "projectedEvent",
    ]);
  });
});
