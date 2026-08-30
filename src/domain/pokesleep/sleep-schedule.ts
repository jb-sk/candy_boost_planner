import {
  MAX_SLEEP_PLANNING_DAYS,
  type BlueSeedIncenseDays,
  type GrowthIncenseGsdDays,
  type GrowthIncenseNormalPerWeek,
  type GrowthIncenseStock,
} from "../types";
import {
  addGameDays,
  compareGameDates,
  gameDateDayOfWeek,
  isoWeekKey,
  parseGameDate,
  type GameDate,
} from "./game-date";
import { createLunarCalendar, type GsdDayKind, type LunarCalendar } from "./lunar-calendar";
import { normalizeGrowthIncenseStock } from "./growth-incense";

export type SleepScheduleDay = {
  index: number;
  date: GameDate;
  dayKind: GsdDayKind;
  useIncense: boolean;
  /** 設定どおりなら使う日だったが、手持ちが尽きて使えなかった日。 */
  incenseOutOfStock: boolean;
  /** GSD由来の倍率（満月3 / 前後日2 / 平常1） */
  gsdMultiplier: 1 | 2 | 3;
  /** イベント由来の倍率（非整数あり。該当なしは1） */
  eventMultiplier: number;
  /** イベント枠で採用した区間の出どころ。該当なし・旧テスト用scheduleは real */
  eventSource?: EventSource;
  /** 実際に外側へ掛ける倍率 = max(gsdMultiplier, eventMultiplier) */
  eventBonus: number;
  incenseMultiplier: 1 | 2;
};

export type EventMultiplierSegment = {
  /** 開始ゲーム日 (YYYY-MM-DD, 両端含む) */
  readonly from: GameDate;
  /** 終了ゲーム日 (YYYY-MM-DD, 両端含む) */
  readonly to: GameDate;
  readonly multiplier: number;
  /** 区間の出どころ。省略時は実イベント。 */
  readonly source?: EventSource;
};

/**
 * イベント枠の倍率の出どころ。
 *
 * **花を実／仮で分けること。** おいわいフラワーは周年フェスの2週目に生えるので、
 * 元の周年が実イベントなら花も実、仮イベントなら花も仮になる。内訳の行名は
 * この出自から決まる（`flower` は「イベント」、`projectedFlower` は「仮イベント」）ため、
 * 1つにまとめると仮の花まで実イベントとして出てしまう。
 */
export type EventSource = "real" | "projected" | "flower" | "projectedFlower";

export type SleepSchedule = {
  readonly startGameDate: GameDate;
  readonly timeZone: string;
  readonly includeGSD: boolean;
  readonly growthIncenseGsdDays: GrowthIncenseGsdDays;
  readonly growthIncenseNormalPerWeek: GrowthIncenseNormalPerWeek;
  readonly growthIncenseStock: GrowthIncenseStock;
  dayAt(index: number): SleepScheduleDay;
  days(count: number): SleepScheduleDay[];
  intersectingFullMoonDates(count: number): GameDate[];
};

function gsdMultiplierFor(kind: GsdDayKind): 1 | 2 | 3 {
  return kind === "fullMoon" ? 3 : kind === "flank" ? 2 : 1;
}

function validateEventSegments(segments: readonly EventMultiplierSegment[]): void {
  for (const segment of segments) {
    if (!parseGameDate(segment.from) || !parseGameDate(segment.to)) {
      throw new RangeError("Invalid event multiplier segment date");
    }
    if (compareGameDates(segment.from, segment.to) > 0) {
      throw new RangeError("Invalid event multiplier segment range");
    }
    if (!Number.isFinite(segment.multiplier) || segment.multiplier <= 0) {
      throw new RangeError("Invalid event multiplier");
    }
  }
}

/** ゲーム日を含むイベント区間から、出自を捨てて最大倍率だけを返す。 */
export function resolveEventMultiplier(
  date: GameDate,
  segments: readonly EventMultiplierSegment[],
): number {
  return resolveEventBonus(date, segments).multiplier;
}

const EVENT_SOURCE_PRIORITY: Record<EventSource, number> = {
  projected: 0,
  projectedFlower: 1,
  flower: 2,
  real: 3,
};

/**
 * イベント枠で勝った倍率と、その区間の出どころを返す。
 * 同値のタイブレークは `real > flower > projectedFlower > projected`
 * ── 倍率が同じなら、確度の高い出自のほうを内訳の行名に採る。
 *
 * 実際のゲームは睡眠計測の開始時刻でイベント適用を判定するが、生成物はゲーム日の
 * 閉区間であるため、ここでは計上先のゲーム日で判定する。イベント最終日の夜に開始し、
 * 翌朝に計上される睡眠には既知のずれがあるため、日付を補正してはならない。
 */
export function resolveEventBonus(
  date: GameDate,
  segments: readonly EventMultiplierSegment[],
): { multiplier: number; source: EventSource } {
  let winner: { multiplier: number; source: EventSource } = { multiplier: 1, source: "real" };
  for (const segment of segments) {
    if (
      compareGameDates(segment.from, date) > 0
      || compareGameDates(date, segment.to) > 0
    ) continue;
    const source = segment.source ?? "real";
    if (
      segment.multiplier > winner.multiplier
      || (segment.multiplier === winner.multiplier
        && EVENT_SOURCE_PRIORITY[source] > EVENT_SOURCE_PRIORITY[winner.source])
    ) {
      winner = { multiplier: segment.multiplier, source };
    }
  }
  return winner;
}

function useIncenseOnGsdDay(params: {
  date: GameDate;
  dayKind: GsdDayKind;
  days: GrowthIncenseGsdDays;
  lunar: LunarCalendar;
}): boolean {
  if (params.dayKind === "normal") return false;
  if (params.dayKind === "fullMoon") return params.days.fullMoon;
  const isLaterFlank = params.lunar.dayKind(addGameDays(params.date, -1)) === "fullMoon";
  return isLaterFlank ? params.days.afterFullMoon : params.days.beforeFullMoon;
}

/**
 * 全行で共有する日別スケジュール。日付順に必要なところまでだけ生成する。
 */
export function createSleepSchedule(params: {
  startGameDate: GameDate;
  timeZone: string;
  includeGSD: boolean;
  growthIncenseGsdDays: GrowthIncenseGsdDays;
  growthIncenseNormalPerWeek: GrowthIncenseNormalPerWeek;
  /** あおいタネ区間のお香日数。省略時は従来どおり週の割当に任せる。 */
  blueSeedIncenseDays?: BlueSeedIncenseDays;
  /** 手持ちの個数。省略/`null` は無制限、`0` は1個も使わない。 */
  growthIncenseStock?: GrowthIncenseStock;
  eventSegments?: readonly EventMultiplierSegment[];
  /** 生成物に依存しない日程テスト用。通常は未指定。 */
  fullMoonDates?: readonly GameDate[];
}): SleepSchedule {
  const eventSegments = params.eventSegments ?? [];
  const blueSeedIncenseDays = params.blueSeedIncenseDays ?? "auto";
  validateEventSegments(eventSegments);
  // あおいタネ区間は「花」の区間そのもの（`growth-flower.ts`。曜日が「使わない」なら1本も無い）。
  const blueSeedSegments = blueSeedIncenseDays === "auto" ? [] : eventSegments.filter(segment => (
    segment.source === "flower" || segment.source === "projectedFlower"
  ));

  /**
   * 数値指定中のあおいタネ区間での扱い。
   *
   * 区間の中は**この設定だけで決まる**（GSDのチェックも週の自動配分も入らない）ので、
   * 「使う日」と「使わない日」の2値で区間の内側を丸ごと引き受ける。
   * `"auto"` と区間の外は `undefined` ＝ 従来どおりの規則へ委ねる。
   *
   * 先頭から N 日。`N` が区間長を超えても `to` で頭打ちになるので、
   * **保存値をクランプする必要はない**（区間長は年と植える曜日で変わる）。
   */
  function blueSeedIncenseRule(day: GameDate): "use" | "skip" | undefined {
    if (blueSeedIncenseDays === "auto") return undefined;
    // **重なった区間は最初の1本で決めないこと。** 実の周年と仮の周年は同じ回で
    // 両方生えることがあり（`flower` と `projectedFlower`）、開始日が1日ずれる。
    // 「先頭からN日」はそれぞれの区間について数えるので、**1本でも先頭N日なら使う**。
    let inSegment = false;
    for (const segment of blueSeedSegments) {
      if (compareGameDates(segment.from, day) > 0 || compareGameDates(day, segment.to) > 0) continue;
      inSegment = true;
      if (compareGameDates(day, addGameDays(segment.from, blueSeedIncenseDays - 1)) <= 0) return "use";
    }
    return inSegment ? "skip" : undefined;
  }
  // 受け付ける値は保存・設定画面と同じ規則（`normalizeGrowthIncenseStock`）に合わせる。
  const growthIncenseStock = normalizeGrowthIncenseStock(params.growthIncenseStock ?? null);
  if (growthIncenseStock === undefined) throw new RangeError("Invalid growth incense stock");
  const lunar = createLunarCalendar({
    fullMoonDates: params.fullMoonDates,
  });
  const cache: SleepScheduleDay[] = [];
  const incenseDaysByWeek = new Map<string, ReadonlySet<string>>();
  /**
   * 残りの手持ち個数。`null` は無制限。
   *
   * 日は必ず `index` 昇順（= 日付順）に生成されるので、先頭の夜から順に消費するだけで
   * 「在庫が尽きた日以降は使えない」を再現できる。週の割当（`incenseDaysInWeek`）は
   * 計画開始前の曜日も含めて決まるが、消費するのは**計画に入った夜だけ**。
   */
  let incenseRemaining = growthIncenseStock;

  /**
   * その週（月曜始まり）でお香を使う日。**週ごとに月曜から決める**ので、
   * 計画が週の途中から始まっても割当は変わらない（日曜開始の週に1個目が落ちない）。
   *
   * 規則:
   * 1. あおいタネ区間の中は `blueSeedIncenseRule` がすべて決める（数値指定のときだけ）。
   *    区間の先頭から N 日を必ず使い、残りは規則2・3へ落とさない
   * 2. 「GSDの成長のお香」でチェックした日は**個数設定に関係なく必ず使う**。
   *    `auto` のあおいタネ区間も従来どおりこの規則と次の自動配分に任せる。
   * 3. 残り枠（週の個数 − 規則1・2で使った数）を、**その日の外側の倍率が高い順**に配る。
   *    同率なら月曜に近い日から。倍率は `max(GSD倍率, イベント倍率)` なので、
   *    満月(×3) → 前後日(×2)・イベント(×2) → イベント(×1.5) → 平常日(×1) の並びになる
   *
   * 例）週0個・GSD3日チェック → 3個 ／ 週4個・GSDチェック無し → GSD3日＋平常1日
   *     週1個・GSDチェック無し → 満月日の1個だけ
   *     週1個・GSD無しでイベント×1.5が3日ある週 → そのイベント初日に1個
   *
   * GSDが週をまたぐ場合も、週ごとに独立して枠を計算する。
   */
  function incenseDaysInWeek(date: GameDate): ReadonlySet<string> {
    const weekKey = isoWeekKey(date);
    const cached = incenseDaysByWeek.get(weekKey);
    if (cached) return cached;

    // 月曜へ戻してから7日ぶん見る。
    const mondayOffset = -((gameDateDayOfWeek(date) || 7) - 1);
    const week = Array.from({ length: 7 }, (_, i) => addGameDays(date, mondayOffset + i));
    const kinds = week.map(day => (params.includeGSD ? lunar.dayKind(day) : "normal"));
    const chosen = new Set<string>();
    week.forEach((day, i) => {
      // 区間の中は規則1がすべて決める（規則2・3へは落とさない）。
      const blueSeed = blueSeedIncenseRule(day);
      if (blueSeed) {
        if (blueSeed === "use") chosen.add(day);
        return;
      }
      const dayKind = kinds[i]!;
      if (dayKind === "normal") return;
      if (useIncenseOnGsdDay({ date: day, dayKind, days: params.growthIncenseGsdDays, lunar })) {
        chosen.add(day);
      }
    });

    let remaining = Math.max(0, params.growthIncenseNormalPerWeek - chosen.size);
    if (remaining > 0) {
      // 効きの大きい日から使う。お香は内側の倍率なので、外側（GSD/イベント）が
      // 大きい日に重ねるほど1個あたりの追加EXPが大きい。
      const candidates = week
        .map((day, i) => ({
          day,
          bonus: Math.max(gsdMultiplierFor(kinds[i]!), resolveEventMultiplier(day, eventSegments)),
          index: i,
        }))
        .filter(candidate => !chosen.has(candidate.day) && !blueSeedIncenseRule(candidate.day))
        .sort((a, b) => b.bonus - a.bonus || a.index - b.index);
      for (const candidate of candidates) {
        if (remaining <= 0) break;
        chosen.add(candidate.day);
        remaining--;
      }
    }

    incenseDaysByWeek.set(weekKey, chosen);
    return chosen;
  }

  function generateNextDay(): SleepScheduleDay {
    const index = cache.length;
    const date = addGameDays(params.startGameDate, index);
    const dayKind = params.includeGSD ? lunar.dayKind(date) : "normal";
    const gsdMultiplier = gsdMultiplierFor(dayKind);
    const eventBonus = resolveEventBonus(date, eventSegments);
    const eventMultiplier = eventBonus.multiplier;
    // お香を使う日は週単位で決まる（規則は incenseDaysInWeek のコメント）。
    const plansIncense = incenseDaysInWeek(date).has(date);
    // 手持ちが尽きたらそれ以降の夜は使えない（無制限は null なので 0 に一致しない）。
    const outOfStock = plansIncense && incenseRemaining === 0;
    const useIncense = plansIncense && !outOfStock;
    if (useIncense && incenseRemaining !== null) incenseRemaining--;

    const day: SleepScheduleDay = {
      index,
      date,
      dayKind,
      useIncense,
      incenseOutOfStock: outOfStock,
      gsdMultiplier,
      eventMultiplier,
      eventSource: eventBonus.source,
      eventBonus: Math.max(gsdMultiplier, eventMultiplier),
      incenseMultiplier: useIncense ? 2 : 1,
    };
    cache.push(day);
    return day;
  }

  function dayAt(index: number): SleepScheduleDay {
    const normalized = Math.floor(index);
    if (
      !Number.isSafeInteger(normalized)
      || normalized < 0
      || normalized >= MAX_SLEEP_PLANNING_DAYS
    ) throw new RangeError("Invalid schedule day index");
    while (cache.length <= normalized) generateNextDay();
    return cache[normalized]!;
  }

  function days(count: number): SleepScheduleDay[] {
    const normalized = Math.max(0, Math.floor(count));
    if (!Number.isSafeInteger(normalized) || normalized > MAX_SLEEP_PLANNING_DAYS) {
      throw new RangeError("Invalid schedule day count");
    }
    if (normalized > 0) dayAt(normalized - 1);
    return cache.slice(0, normalized);
  }

  function intersectingFullMoonDates(count: number): GameDate[] {
    const normalized = Math.max(0, Math.floor(count));
    if (!Number.isSafeInteger(normalized) || normalized > MAX_SLEEP_PLANNING_DAYS) {
      throw new RangeError("Invalid schedule day count");
    }
    if (!params.includeGSD || normalized === 0) return [];
    const intervalEnd = addGameDays(params.startGameDate, normalized - 1);
    return lunar.fullMoonDatesThrough(addGameDays(intervalEnd, 1))
      .filter((date) => (
        compareGameDates(addGameDays(date, 1), params.startGameDate) >= 0
        && compareGameDates(addGameDays(date, -1), intervalEnd) <= 0
      ));
  }

  return {
    startGameDate: params.startGameDate,
    timeZone: params.timeZone,
    includeGSD: params.includeGSD,
    growthIncenseGsdDays: params.growthIncenseGsdDays,
    growthIncenseNormalPerWeek: params.growthIncenseNormalPerWeek,
    growthIncenseStock,
    dayAt,
    days,
    intersectingFullMoonDates,
  };
}
