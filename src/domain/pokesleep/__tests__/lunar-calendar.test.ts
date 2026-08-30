import { SearchMoonPhase } from "astronomy-engine";
import { describe, expect, it } from "vitest";
import { FULL_MOON_DATES, FULL_MOON_FROM, FULL_MOON_THROUGH } from "../_generated/full-moon-dates";
import { calendarDateInTimeZone, type GameDate } from "../game-date";
import {
  createLunarCalendar,
  GSD_REFERENCE_TIME_ZONE,
  LunarCalendarUnavailableError,
} from "../lunar-calendar";

const DAY_MS = 86_400_000;

function astronomyFullMoonDates(): GameDate[] {
  // 生成処理をimportせず、別のタイムゾーン変換実装で生成物を独立照合する。
  const dates: GameDate[] = [];
  let searchStart = new Date("2022-12-01T00:00:00.000Z");
  while (true) {
    const event = SearchMoonPhase(180, searchStart, 40);
    if (!event) throw new Error("Astronomy Engine did not find a full moon");
    const date = calendarDateInTimeZone(event.date, GSD_REFERENCE_TIME_ZONE);
    if (date > FULL_MOON_THROUGH) break;
    if (date >= FULL_MOON_FROM) dates.push(date);
    searchStart = new Date(event.date.getTime() + DAY_MS);
  }
  return dates;
}

describe("lunar-calendar", () => {
  const calendar = createLunarCalendar();

  it("生成物の全件がAstronomy EngineのJST満月日と一致する", () => {
    const expected = astronomyFullMoonDates();
    expect(FULL_MOON_DATES).toHaveLength(297);
    expect(FULL_MOON_DATES).toEqual(expected);
  });

  it("ゲーム内実測の2026-08-28とその前後日を再現する", () => {
    expect(calendar.dayKind("2026-08-27")).toBe("flank");
    expect(calendar.dayKind("2026-08-28")).toBe("fullMoon");
    expect(calendar.dayKind("2026-08-29")).toBe("flank");
  });

  it("JST基準と指定日までの満月一覧を同期的に返す", () => {
    expect(calendar.referenceTimeZone).toBe("Asia/Tokyo");
    expect(calendar.fullMoonDatesThrough("2026-08-28").at(-1)).toBe("2026-08-28");
  });

  it("dayKindは前後日を保証できるFROM+1日からTHROUGH-1日だけを受け付ける", () => {
    expect(() => calendar.dayKind("2023-01-01")).toThrow(LunarCalendarUnavailableError);
    expect(() => calendar.dayKind("2023-01-02")).not.toThrow();
    expect(() => calendar.dayKind("2046-12-30")).not.toThrow();
    expect(() => calendar.dayKind("2046-12-31")).toThrow(LunarCalendarUnavailableError);
  });

  it("fullMoonDatesThroughは生成テーブルの両端だけを有効範囲にする", () => {
    expect(() => calendar.fullMoonDatesThrough("2022-12-31")).toThrow(LunarCalendarUnavailableError);
    expect(() => calendar.fullMoonDatesThrough("2023-01-01")).not.toThrow();
    expect(() => calendar.fullMoonDatesThrough("2046-12-31")).not.toThrow();
    expect(() => calendar.fullMoonDatesThrough("2047-01-01")).toThrow(LunarCalendarUnavailableError);
  });
});
