import {
  addGameDays,
  compareGameDates,
  gameDateDayOfWeek,
  normalizeGameDate,
  parseGameDate,
  type GameDate,
} from "./game-date";

/**
 * 一覧へ並べる1件。**実イベントも仮イベントも同じ形**にして、出自の違いは表示側だけで扱う
 * （一覧に実と仮を混ぜて出すため。§6.2）。
 */
export type EventOccurrence = {
  readonly name: string;
  readonly from: GameDate;
  readonly to: GameDate;
  readonly multiplier: number;
  readonly month: number;
  readonly weekOfMonth: number;
};

/** 仮イベントの1件。写し元の開催回を表示時に特定できる日付を持つ。 */
export type ProjectedEventOccurrence = EventOccurrence & {
  /** 写し元イベントの開始ゲーム日。英語名を開催回ごとに引くために持つ。 */
  readonly sourceFrom: GameDate;
};

export type EventAnchor = {
  readonly match: string;
  readonly month: number;
  readonly day: number;
};

type EventSegmentInput = {
  readonly name: string;
  readonly from: string;
  readonly to: string;
  readonly multiplier: number;
};

type NamedEventInput = {
  readonly name: string;
  readonly from: string;
  readonly to: string;
};

type DateIntervalInput = {
  readonly from: string;
  readonly to: string;
};

type SourceOccurrence = {
  readonly segment: EventSegmentInput & { from: GameDate; to: GameDate };
  readonly anchor?: EventAnchor;
  readonly sourceYear: number;
  readonly offsetWeeks?: number;
  readonly weekOfMonth?: number;
};

function dayDifference(from: GameDate, to: GameDate): number {
  const fromParts = parseGameDate(from);
  const toParts = parseGameDate(to);
  if (!fromParts || !toParts) throw new RangeError("Invalid game date");
  return Math.round((
    Date.UTC(toParts.year, toParts.month - 1, toParts.day)
    - Date.UTC(fromParts.year, fromParts.month - 1, fromParts.day)
  ) / 86_400_000);
}

function anchorDate(anchor: EventAnchor, year: number): GameDate | null {
  const candidate = `${String(year).padStart(4, "0")}-${String(anchor.month).padStart(2, "0")}-${String(anchor.day).padStart(2, "0")}`;
  return normalizeGameDate(candidate);
}

function mondayContaining(date: GameDate): GameDate {
  const offset = -((gameDateDayOfWeek(date) || 7) - 1);
  return addGameDays(date, offset);
}

function sourceAnchorYear(segment: { from: GameDate; to: GameDate }, anchor: EventAnchor): number | null {
  const fromYear = parseGameDate(segment.from)!.year;
  for (const year of [fromYear - 1, fromYear, fromYear + 1]) {
    const date = anchorDate(anchor, year);
    if (!date) continue;
    const offsetDays = dayDifference(mondayContaining(date), segment.from);
    if (offsetDays % 7 === 0 && Math.abs(offsetDays / 7) <= 2) return year;
  }
  return null;
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): GameDate | null {
  const first = normalizeGameDate(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`);
  if (!first) return null;
  const firstOffset = (weekday - gameDateDayOfWeek(first) + 7) % 7;
  const candidate = addGameDays(first, firstOffset + (nth - 1) * 7);
  const parts = parseGameDate(candidate)!;
  if (parts.month === month) return candidate;

  // 第5週が無い年は、同じ月の最後のその曜日へ寄せる。
  const nextMonth = month === 12
    ? normalizeGameDate(`${String(year + 1).padStart(4, "0")}-01-01`)
    : normalizeGameDate(`${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-01`);
  if (!nextMonth) return null;
  const lastDay = addGameDays(nextMonth, -1);
  return addGameDays(lastDay, -((gameDateDayOfWeek(lastDay) - weekday + 7) % 7));
}

function projectedStart(source: SourceOccurrence, year: number): GameDate | null {
  if (source.anchor && source.offsetWeeks !== undefined) {
    const date = anchorDate(source.anchor, year);
    if (!date) return null;
    return addGameDays(mondayContaining(date), source.offsetWeeks * 7);
  }
  if (source.weekOfMonth === undefined) return null;
  const fromParts = parseGameDate(source.segment.from)!;
  return nthWeekdayOfMonth(year, fromParts.month, gameDateDayOfWeek(source.segment.from), source.weekOfMonth);
}

function occurrenceFrom(source: SourceOccurrence, from: GameDate): ProjectedEventOccurrence {
  const sourceDays = dayDifference(source.segment.from, source.segment.to);
  const to = addGameDays(from, sourceDays);
  const parts = parseGameDate(from)!;
  return {
    name: source.segment.name,
    sourceFrom: source.segment.from,
    from,
    to,
    multiplier: source.segment.multiplier,
    month: parts.month,
    weekOfMonth: Math.floor((parts.day - 1) / 7) + 1,
  };
}

function overlaps(
  left: { from: GameDate; to: GameDate },
  right: { from: GameDate; to: GameDate },
): boolean {
  return compareGameDates(left.from, right.to) <= 0 && compareGameDates(right.from, left.to) <= 0;
}

/** 同系統判定のため、末尾の `vol.N` とその前後の空白だけを落とす。Wiki の表記ゆれに備えて大文字小文字は区別しない。 */
function normalizeSeriesName(name: string): string {
  return name.replace(/\s*vol\.\d+\s*$/i, "");
}

function yearMonthKey(date: GameDate): string {
  const parts = parseGameDate(date)!;
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}`;
}

/** 月跨ぎ・年跨ぎを落とさないよう、開始日と終了日の年つき月を集合にする。 */
function intervalYearMonths(interval: { from: GameDate; to: GameDate }): ReadonlySet<string> {
  return new Set([yearMonthKey(interval.from), yearMonthKey(interval.to)]);
}

function intersects<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  return [...left].some(value => right.has(value));
}

/**
 * 実イベントの区間を一覧用の1件へ落とす。日付が読めない区間は `null`（黙って捨てず呼び出し側で除く）。
 * 週ラベルの数え方は仮イベントと同じ（開始日がその月で何回目のその曜日か）。
 */
export function toEventOccurrence(segment: {
  readonly name?: string;
  readonly from: string;
  readonly to: string;
  readonly multiplier: number;
}): EventOccurrence | null {
  const from = normalizeGameDate(segment.from);
  const to = normalizeGameDate(segment.to);
  if (!from || !to || compareGameDates(from, to) > 0) return null;
  const parts = parseGameDate(from)!;
  return {
    name: segment.name ?? "",
    from,
    to,
    multiplier: segment.multiplier,
    month: parts.month,
    weekOfMonth: Math.floor((parts.day - 1) / 7) + 1,
  };
}

/**
 * 現在ゲーム日から過去365日間の睡眠EXPイベントを、曜日を保つ形で計画期間へ写す。
 * 告知済み未開催の回も写し元にするため、抽出窓の右端だけは Wiki の既知末尾まで伸ばす。
 * 今週以前、実イベントと同じ開催回、または同系統・同じ年つき月に当たる仮イベントは区間ごと返さない。
 */
export function projectPastYearEvents(params: {
  segments: readonly EventSegmentInput[];
  currentGameDate: GameDate;
  knownThrough: GameDate;
  /** アンカー年と、同系統・同じ年つき月を判定する実開催回。呼び出し側は計算正本の睡眠EXP区間を渡す。 */
  realEvents: readonly NamedEventInput[];
  /** 期間重複を判定する実睡眠EXP区間。生成物由来と手入力の両方を渡す。 */
  realSleepExpSegments: readonly DateIntervalInput[];
  anchors?: readonly EventAnchor[];
  until: GameDate;
}): ProjectedEventOccurrence[] {
  // 先行告知で既知末尾が飛んでも、写し元窓の左端まで一緒に動かしてはいけない。
  const windowFrom = addGameDays(params.currentGameDate, -365);
  const projectedAfter = mondayContaining(params.currentGameDate);
  const anchors = params.anchors ?? [];
  const inWindow = params.segments
    .map(segment => {
      const from = normalizeGameDate(segment.from);
      const to = normalizeGameDate(segment.to);
      return from && to && compareGameDates(from, to) <= 0
        ? { ...segment, from, to }
        : null;
    })
    .filter((segment): segment is EventSegmentInput & { from: GameDate; to: GameDate } => (
      segment !== null
      && compareGameDates(segment.from, windowFrom) >= 0
      && compareGameDates(segment.from, params.knownThrough) <= 0
    ));

  const sources: SourceOccurrence[] = [];
  const latestByAnchor = new Map<string, EventSegmentInput & { from: GameDate; to: GameDate }>();
  const latestByName = new Map<string, EventSegmentInput & { from: GameDate; to: GameDate }>();
  for (const segment of inWindow) {
    const anchor = anchors.find(candidate => segment.name.includes(candidate.match));
    if (anchor) {
      const previous = latestByAnchor.get(anchor.match);
      if (!previous || compareGameDates(segment.from, previous.from) > 0) latestByAnchor.set(anchor.match, segment);
      continue;
    }
    const normalizedName = normalizeSeriesName(segment.name);
    const previous = latestByName.get(normalizedName);
    if (!previous || compareGameDates(segment.from, previous.from) > 0) latestByName.set(normalizedName, segment);
  }

  // 窓の右端だけが未来へ伸びるため、アンカーの無い同系統も vol.N を除いた名前ごとに最新の開催回1本へ畳む。
  for (const segment of latestByName.values()) {
    const fromParts = parseGameDate(segment.from)!;
    sources.push({
      segment,
      sourceYear: fromParts.year,
      weekOfMonth: Math.floor((fromParts.day - 1) / 7) + 1,
    });
  }

  for (const [match, segment] of latestByAnchor) {
    const anchor = anchors.find(candidate => candidate.match === match)!;
    const sourceYear = sourceAnchorYear(segment, anchor);
    const anchorInSourceYear = sourceYear === null ? null : anchorDate(anchor, sourceYear);
    const offsetWeeks = anchorInSourceYear === null
      ? undefined
      : dayDifference(mondayContaining(anchorInSourceYear), segment.from) / 7;
    sources.push({
      segment,
      anchor: offsetWeeks === undefined ? undefined : anchor,
      sourceYear: sourceYear ?? parseGameDate(segment.from)!.year,
      offsetWeeks,
      weekOfMonth: offsetWeeks === undefined
        ? Math.floor((parseGameDate(segment.from)!.day - 1) / 7) + 1
        : undefined,
    });
  }

  const realAnchorYears = new Map<string, Set<number>>();
  const realSeriesOccurrences: Array<{
    readonly normalizedName: string;
    readonly anchorMatch?: string;
    readonly yearMonths: ReadonlySet<string>;
  }> = [];
  for (const event of params.realEvents) {
    const from = normalizeGameDate(event.from);
    const to = normalizeGameDate(event.to);
    if (!from || !to || compareGameDates(from, to) > 0) continue;
    const anchor = anchors.find(candidate => event.name.includes(candidate.match));
    realSeriesOccurrences.push({
      normalizedName: normalizeSeriesName(event.name),
      anchorMatch: anchor?.match,
      yearMonths: intervalYearMonths({ from, to }),
    });
    if (!anchor) continue;
    const year = sourceAnchorYear({ from, to }, anchor);
    if (year === null) continue;
    const years = realAnchorYears.get(anchor.match) ?? new Set<number>();
    years.add(year);
    realAnchorYears.set(anchor.match, years);
  }
  const realSleepExpSegments = params.realSleepExpSegments
    .map(segment => {
      const from = normalizeGameDate(segment.from);
      const to = normalizeGameDate(segment.to);
      return from && to && compareGameDates(from, to) <= 0 ? { from, to } : null;
    })
    .filter((segment): segment is { from: GameDate; to: GameDate } => segment !== null);

  const projected = new Map<string, ProjectedEventOccurrence>();
  const untilYear = parseGameDate(params.until)!.year;
  for (const source of sources) {
    const sourceAnchorMatch = anchors.find(anchor => source.segment.name.includes(anchor.match))?.match;
    const normalizedName = normalizeSeriesName(source.segment.name);
    for (let year = source.sourceYear; year <= untilYear + 1; year++) {
      const from = projectedStart(source, year);
      // 非月曜開始の写しもあるため、開始日そのものではなく開始日が属する週で今週以前を落とす。
      if (!from || compareGameDates(mondayContaining(from), projectedAfter) <= 0 || compareGameDates(from, params.until) > 0) continue;
      const occurrence = occurrenceFrom(source, from);
      // 近い週かどうかでは同一性を決めない。実開催が±2週ずれてもアンカー年で同じ回と判定する。
      if (source.anchor && realAnchorYears.get(source.anchor.match)?.has(year)) continue;
      // 手入力を含む実睡眠EXP区間との重なりも、花を生やす前の仮イベント段階で除く。
      if (realSleepExpSegments.some(real => overlaps(occurrence, real))) continue;
      const occurrenceYearMonths = intervalYearMonths(occurrence);
      // 同系統は同じ年つき月に2回開催しない。開始月だけで比べると月跨ぎの回を取りこぼす。
      if (realSeriesOccurrences.some(real => (
        (sourceAnchorMatch !== undefined && sourceAnchorMatch === real.anchorMatch)
        || normalizedName === real.normalizedName
      ) && intersects(occurrenceYearMonths, real.yearMonths))) continue;
      const key = source.anchor
        ? `${source.anchor.match}|${year}`
        : `${normalizedName}|${year}`;
      if (!projected.has(key)) projected.set(key, occurrence);
    }
  }

  return [...projected.values()].sort((a, b) => compareGameDates(a.from, b.from));
}
