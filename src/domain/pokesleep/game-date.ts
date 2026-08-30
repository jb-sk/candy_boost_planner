/**
 * Pokémon Sleep の日付境界と、タイムゾーン非依存の暦日演算。
 *
 * ゲーム内日は設定タイムゾーンの 04:00 に切り替わる。一方、満月の瞬間を
 * GSD の公式基準日へ写す処理はJSTの通常暦日を使うため、両者を別APIにする。
 */

export type GameDate = `${number}-${number}-${number}`;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const OFFSET_TIME_ZONE_PATTERN = /^(?:UTC|GMT)?[+-]\d{2}(?::?\d{2})?$/i;
const timeZoneCache = new Map<string, string | null>();
const formatterCache = new Map<string, Intl.DateTimeFormat>();

type CalendarParts = {
  year: number;
  month: number;
  day: number;
};

function dateFromParts(parts: CalendarParts): GameDate {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}` as GameDate;
}

function utcDateFromGameDate(value: GameDate): Date {
  const parsed = parseGameDate(value);
  if (!parsed) throw new RangeError(`Invalid game date: ${value}`);
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
}

function zonedParts(now: Date, timeZone: string, includeHour: false): CalendarParts;
function zonedParts(now: Date, timeZone: string, includeHour: true): CalendarParts & { hour: number };
function zonedParts(now: Date, timeZone: string, includeHour: boolean): CalendarParts & { hour?: number } {
  const formatterKey = `${timeZone}|${includeHour ? "hour" : "date"}`;
  const options: Intl.DateTimeFormatOptions = {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(includeHour ? { hour: "2-digit", hourCycle: "h23" as const } : {}),
  };
  let formatter = formatterCache.get(formatterKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", options);
    formatterCache.set(formatterKey, formatter);
  }
  const parts = formatter.formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type)?.value;
    const parsed = Number(part);
    if (!Number.isInteger(parsed)) throw new RangeError(`Could not resolve ${type} in ${timeZone}`);
    return parsed;
  };
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    ...(includeHour ? { hour: value("hour") % 24 } : {}),
  };
}

export function parseGameDate(value: unknown): CalendarParts | null {
  if (typeof value !== "string") return null;
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function normalizeGameDate(value: unknown): GameDate | null {
  const parsed = parseGameDate(value);
  return parsed ? dateFromParts(parsed) : null;
}

export function addGameDays(value: GameDate, days: number): GameDate {
  const date = utcDateFromGameDate(value);
  date.setUTCDate(date.getUTCDate() + Math.trunc(days));
  return dateFromParts({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

export function compareGameDates(left: GameDate, right: GameDate): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function gameDateDayOfWeek(value: GameDate): number {
  return utcDateFromGameDate(value).getUTCDay();
}

/** ISO週（月曜開始）を一意に表すキー。 */
export function isoWeekKey(value: GameDate): string {
  const date = utcDateFromGameDate(value);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/**
 * Intl が受理した名前を、当該エンジンの正規化名へ揃える。
 * `UTC+09:00` のような固定オフセット表記は DST を表せないため明示的に拒否する。
 */
export function normalizeTimeZone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!input || OFFSET_TIME_ZONE_PATTERN.test(input)) return null;
  if (timeZoneCache.has(input)) return timeZoneCache.get(input) ?? null;
  try {
    const canonical = new Intl.DateTimeFormat("en-US", { timeZone: input }).resolvedOptions().timeZone;
    const normalized = canonical && !OFFSET_TIME_ZONE_PATTERN.test(canonical) ? canonical : null;
    timeZoneCache.set(input, normalized);
    return normalized;
  } catch {
    timeZoneCache.set(input, null);
    return null;
  }
}

export function detectTimeZone(): string {
  try {
    return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC";
  } catch {
    return "UTC";
  }
}

/** UTCの瞬間が設定ゾーンで属する通常の暦日。AM4補正はしない。 */
export function calendarDateInTimeZone(now: Date, timeZone: string): GameDate {
  const normalized = normalizeTimeZone(timeZone);
  if (!normalized || !Number.isFinite(now.getTime())) throw new RangeError("Invalid date or time zone");
  return dateFromParts(zonedParts(now, normalized, false));
}

/** UTCの瞬間が属する、AM4:00基準のゲーム内日。 */
export function resolveGameDate(now: Date, timeZone: string): GameDate {
  const normalized = normalizeTimeZone(timeZone);
  if (!normalized || !Number.isFinite(now.getTime())) throw new RangeError("Invalid date or time zone");
  const parts = zonedParts(now, normalized, true);
  const calendarDate = dateFromParts(parts);
  return parts.hour < 4 ? addGameDays(calendarDate, -1) : calendarDate;
}

const WALL_CLOCK_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/**
 * `2026-08-28T04:30` のような壁時計表記（`datetime-local` の値）が属するゲーム内日。
 *
 * 瞬間ではなく壁時計をそのまま読むので、端末ゾーンと設定ゾーンの差で日付がずれない。
 * AM4:00より前を前日とする規則は `resolveGameDate` と同じ。
 * 形式違い・実在しない日付（`2026-02-29`）・範囲外の時刻は null。
 */
export function gameDateFromWallClock(value: string): GameDate | null {
  const match = WALL_CLOCK_PATTERN.exec(value);
  if (!match) return null;
  const date = normalizeGameDate(match[1]);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (!date || hour > 23 || minute > 59) return null;
  return hour < 4 ? addGameDays(date, -1) : date;
}

/**
 * ゲーム内日が次に変化する実時刻を探す。
 *
 * DST巻き戻しで値が一時的に前日へ戻るケースを見落とさないよう、端点だけを
 * 比較する指数探索ではなく15分ごとに最初の変化を bracket する。
 */
export function findNextGameDateChange(now: Date, timeZone: string): Date {
  const startMs = now.getTime();
  if (!Number.isFinite(startMs)) throw new RangeError("Invalid date");
  const initial = resolveGameDate(now, timeZone);
  const scanStepMs = 15 * 60_000;
  const maxSteps = 72 * 4;
  let lowerMs = startMs;
  let upperMs: number | null = null;

  for (let step = 1; step <= maxSteps; step++) {
    const candidateMs = startMs + step * scanStepMs;
    if (resolveGameDate(new Date(candidateMs), timeZone) !== initial) {
      upperMs = candidateMs;
      break;
    }
    lowerMs = candidateMs;
  }
  if (upperMs === null) throw new RangeError("Could not find the next game-date boundary");
  let upper = upperMs;

  while (upper - lowerMs > 1) {
    const middleMs: number = lowerMs + Math.floor((upper - lowerMs) / 2);
    if (resolveGameDate(new Date(middleMs), timeZone) === initial) lowerMs = middleMs;
    else upper = middleMs;
  }
  return new Date(upper);
}

export function formatGameDateForDisplay(value: GameDate): string {
  return value.replaceAll("-", "/");
}

/** 最大3晩の内訳で使う短い月日表記。「2026-09-29」→「9/29」。 */
export function formatGameMonthDay(value: GameDate): string {
  const parsed = parseGameDate(value);
  return parsed ? `${parsed.month}/${parsed.day}` : value;
}
