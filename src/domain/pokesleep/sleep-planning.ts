import type { ManualEventBonus, SleepSettings } from "../types";
import { sleepExpEventAnchors, sleepExpEventSegments, wikiKnownThrough } from "./_generated/sleep-exp-events";
import { compareGameDates, normalizeGameDate, type GameDate } from "./game-date";
import type { BlueSeedShift } from "./growth-flower";
import {
  projectPastYearEvents,
  toEventOccurrence,
  type EventOccurrence,
  type ProjectedEventOccurrence,
} from "./projected-events";
import type { EventMultiplierSegment } from "./sleep-schedule";

function toEventMultiplierSegment(segment: {
  readonly from: string;
  readonly to: string;
  readonly multiplier: number;
}): EventMultiplierSegment {
  const from = normalizeGameDate(segment.from);
  const to = normalizeGameDate(segment.to);
  if (!from || !to) throw new RangeError("イベント倍率区間の日付が不正です");
  return { from, to, multiplier: segment.multiplier };
}

/** 自動取得と手入力の区間を同じゲーム日区間として結合する。優先度は付けず、日別解決時に最大値を採る。 */
export function buildPlannerEventSegments(
  manualEventBonuses: readonly ManualEventBonus[],
  projectedOccurrences: readonly ProjectedEventOccurrence[] = [],
  blueSeedSegments: readonly EventMultiplierSegment[] = [],
): EventMultiplierSegment[] {
  return [
    ...sleepExpEventSegments.map(toEventMultiplierSegment),
    ...manualEventBonuses.map(segment => ({ ...toEventMultiplierSegment(segment), source: "real" as const })),
    ...projectedOccurrences.map(segment => ({
      ...toEventMultiplierSegment(segment),
      source: "projected" as const,
    })),
    ...blueSeedSegments,
  ];
}

/** 生成済み開催回と手入力区間を使い、重複除外済みの仮イベントを作る。 */
export function buildGeneratedProjectedSleepExpEvents(
  currentGameDate: GameDate,
  until: GameDate,
  manualEventBonuses: readonly ManualEventBonus[] = [],
): readonly ProjectedEventOccurrence[] {
  const knownThrough = normalizeGameDate(wikiKnownThrough);
  if (!knownThrough) throw new RangeError("生成物の wikiKnownThrough が不正です");
  return projectPastYearEvents({
    segments: sleepExpEventSegments,
    currentGameDate,
    knownThrough,
    realEvents: sleepExpEventSegments,
    realSleepExpSegments: [...sleepExpEventSegments, ...manualEventBonuses],
    anchors: sleepExpEventAnchors,
    until,
  });
}

/** 生成物に依存しない睡眠イベント入力をストア契約テストへ注入する境界。 */
export type SleepEventFixture = {
  readonly projectedOccurrences: readonly ProjectedEventOccurrence[];
  readonly blueSeedSegments: readonly EventMultiplierSegment[];
  readonly blueSeedShifts: readonly BlueSeedShift[];
};

/** 睡眠スケジュールの全入力を署名化する。設定や自動区間を変えたら必ず再生成する。 */
export function buildSleepScheduleCacheKey(params: {
  currentGameDate: GameDate;
  timeZone: string;
  includeGSD: boolean;
  growthIncenseGsdDays: SleepSettings["growthIncenseGsdDays"];
  growthIncenseNormalPerWeek: SleepSettings["growthIncenseNormalPerWeek"];
  growthIncenseStock: SleepSettings["growthIncenseStock"];
  manualEventBonuses: readonly ManualEventBonus[];
  useProjectedEvents: boolean;
  blueSeedPlantWeekday: SleepSettings["blueSeedPlantWeekday"];
  blueSeedIncenseDays: SleepSettings["blueSeedIncenseDays"];
  projectedOccurrences: readonly ProjectedEventOccurrence[];
  blueSeedSegments: readonly EventMultiplierSegment[];
}): string {
  const days = params.growthIncenseGsdDays;
  return [
    params.currentGameDate,
    params.timeZone,
    params.includeGSD,
    Number(days.beforeFullMoon),
    Number(days.fullMoon),
    Number(days.afterFullMoon),
    params.growthIncenseNormalPerWeek,
    params.growthIncenseStock ?? "unlimited",
    JSON.stringify(params.manualEventBonuses),
    Number(params.useProjectedEvents),
    String(params.blueSeedPlantWeekday),
    String(params.blueSeedIncenseDays),
    JSON.stringify(params.projectedOccurrences),
    JSON.stringify(params.blueSeedSegments),
  ].join("|");
}

/** 計算へ渡す区間と同じ出どころから、一覧用の実イベントを開始日順に作る。 */
export function buildRealEventOccurrences(
  manualEventBonuses: readonly ManualEventBonus[],
): readonly EventOccurrence[] {
  return [...sleepExpEventSegments, ...manualEventBonuses]
    .map(segment => toEventOccurrence(segment))
    .filter((occurrence): occurrence is EventOccurrence => occurrence !== null)
    .sort((a, b) => compareGameDates(a.from, b.from));
}
