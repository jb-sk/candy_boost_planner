import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createSleepSchedule,
  type EventMultiplierSegment,
  type SleepScheduleDay,
} from "../../../src/domain/pokesleep/sleep-schedule";

const START = "2026-07-20" as const;
const DAYS = 90;
const GOLDEN_DIR = fileURLToPath(new URL("../goldens/sleep-schedule", import.meta.url));

const overlappingEvents: readonly EventMultiplierSegment[] = [
  { from: "2026-08-24", to: "2026-08-30", multiplier: 1.5, source: "real" },
  { from: "2026-09-25", to: "2026-09-27", multiplier: 2.5, source: "projected" },
  { from: "2026-10-19", to: "2026-10-25", multiplier: 2, source: "flower" },
];

function incenseState(
  day: SleepScheduleDay,
  skippedIncenseDate?: string,
): "incense" | "skipped" | "nostock" | "none" {
  // A partial final night is a consumer decision, not SleepScheduleDay state. Accept
  // that date explicitly so this daily text uses the same four-value contract as TSV.
  if (day.date === skippedIncenseDate && day.useIncense) return "skipped";
  if (day.useIncense) return "incense";
  if (day.incenseOutOfStock) return "nostock";
  return "none";
}

function compactDays(days: readonly SleepScheduleDay[], skippedIncenseDate?: string): string {
  return days.map((day) => [
    day.date,
    day.dayKind,
    `gsd=${day.gsdMultiplier}`,
    `event=${day.eventMultiplier}:${day.eventSource ?? "real"}`,
    `outer=${day.eventBonus}`,
    incenseState(day, skippedIncenseDate),
  ].join("\t")).join("\n");
}

describe("createSleepSchedule daily golden contract", () => {
  it("keeps GSD-first incense placement and max(GSD, event) across three lunar cycles", async () => {
    const schedule = createSleepSchedule({
      startGameDate: START,
      timeZone: "Asia/Tokyo",
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: true, fullMoon: true, afterFullMoon: true },
      growthIncenseNormalPerWeek: 2,
      growthIncenseStock: null,
      eventSegments: overlappingEvents,
    });

    await expect(compactDays(schedule.days(DAYS), "2026-07-20")).toMatchFileSnapshot(
      `${GOLDEN_DIR}/gsd-events-unlimited.txt`,
    );
  });

  it("keeps chronological stock consumption and marks every later planned use as out of stock", async () => {
    const schedule = createSleepSchedule({
      startGameDate: START,
      timeZone: "Asia/Tokyo",
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: true, afterFullMoon: false },
      growthIncenseNormalPerWeek: 3,
      growthIncenseStock: 8,
      eventSegments: overlappingEvents,
    });

    await expect(compactDays(schedule.days(DAYS))).toMatchFileSnapshot(
      `${GOLDEN_DIR}/finite-stock-exhaustion.txt`,
    );
  });

  it("keeps explicit zero stock distinct from unlimited stock", async () => {
    const schedule = createSleepSchedule({
      startGameDate: START,
      timeZone: "Asia/Tokyo",
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 1,
      growthIncenseStock: 0,
      eventSegments: overlappingEvents,
    });

    await expect(compactDays(schedule.days(DAYS))).toMatchFileSnapshot(
      `${GOLDEN_DIR}/zero-stock.txt`,
    );
  });

  it("keeps event bonuses while GSD and all incense placement are disabled", async () => {
    const schedule = createSleepSchedule({
      startGameDate: START,
      timeZone: "America/Los_Angeles",
      includeGSD: false,
      growthIncenseGsdDays: { beforeFullMoon: true, fullMoon: true, afterFullMoon: true },
      growthIncenseNormalPerWeek: 0,
      growthIncenseStock: null,
      eventSegments: overlappingEvents,
    });

    await expect(compactDays(schedule.days(DAYS))).toMatchFileSnapshot(
      `${GOLDEN_DIR}/events-only-no-gsd.txt`,
    );
  });
});
