import { FULL_MOON_DATES, FULL_MOON_FROM, FULL_MOON_THROUGH } from "./_generated/full-moon-dates";
import { addGameDays, compareGameDates, type GameDate } from "./game-date";

export type GsdDayKind = "normal" | "flank" | "fullMoon";

export type LunarCalendar = {
  readonly referenceTimeZone: string;
  dayKind(date: GameDate): GsdDayKind;
  fullMoonDatesThrough(endDateInclusive: GameDate): GameDate[];
};

/** 生成済み月齢カレンダーの収録範囲外を照会した場合。 */
export class LunarCalendarUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LunarCalendarUnavailableError";
  }
}

/** 公式日本語版・英語版で共通の日付になる、GSD告知の基準ゾーン。 */
export const GSD_REFERENCE_TIME_ZONE = "Asia/Tokyo";

const DAY_KIND_FROM = addGameDays(FULL_MOON_FROM, 1);
const DAY_KIND_THROUGH = addGameDays(FULL_MOON_THROUGH, -1);

function assertWithin(date: GameDate, from: GameDate, through: GameDate): void {
  if (compareGameDates(date, from) < 0 || compareGameDates(date, through) > 0) {
    throw new LunarCalendarUnavailableError(
      `Lunar calendar is unavailable for ${date}; supported range is ${from} through ${through}`,
    );
  }
}

/**
 * 生成済みのJST満月日を参照する同期カレンダー。
 * `fullMoonDates` は生成物に依存しない日程テストだけが使う注入口。
 */
export function createLunarCalendar(params: {
  fullMoonDates?: readonly GameDate[];
} = {}): LunarCalendar {
  const fullMoonDates = new Set<GameDate>(params.fullMoonDates ?? FULL_MOON_DATES);

  function dayKind(date: GameDate): GsdDayKind {
    // 前後1日を参照するため、テーブル端そのものでは正しい flank 判定を保証できない。
    assertWithin(date, DAY_KIND_FROM, DAY_KIND_THROUGH);
    if (fullMoonDates.has(date)) return "fullMoon";
    if (fullMoonDates.has(addGameDays(date, -1)) || fullMoonDates.has(addGameDays(date, 1))) {
      return "flank";
    }
    return "normal";
  }

  function fullMoonDatesThrough(endDateInclusive: GameDate): GameDate[] {
    assertWithin(endDateInclusive, FULL_MOON_FROM, FULL_MOON_THROUGH);
    return [...fullMoonDates]
      .filter(date => compareGameDates(date, endDateInclusive) <= 0)
      .sort(compareGameDates);
  }

  return {
    referenceTimeZone: GSD_REFERENCE_TIME_ZONE,
    dayKind,
    fullMoonDatesThrough,
  };
}
