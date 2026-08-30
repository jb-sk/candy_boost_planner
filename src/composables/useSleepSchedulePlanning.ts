import { computed, ref, type ComputedRef, type Ref } from "vue";
import { MAX_SLEEP_PLANNING_DAYS, type SleepSettings } from "../domain/types";
import { sleepExpEventFlowers, sleepExpEventSegments } from "../domain/pokesleep/_generated/sleep-exp-events";
import { addGameDays, type GameDate } from "../domain/pokesleep/game-date";
import { resolveBlueSeedSegments, type BlueSeedShift } from "../domain/pokesleep/growth-flower";
import { createLunarCalendar, LunarCalendarUnavailableError } from "../domain/pokesleep/lunar-calendar";
import {
  buildGeneratedProjectedSleepExpEvents,
  buildPlannerEventSegments,
  buildRealEventOccurrences,
  buildSleepScheduleCacheKey,
  type SleepEventFixture,
} from "../domain/pokesleep/sleep-planning";
import type { EventOccurrence, ProjectedEventOccurrence } from "../domain/pokesleep/projected-events";
import { createSleepSchedule, type EventMultiplierSegment, type SleepSchedule } from "../domain/pokesleep/sleep-schedule";

export type SleepSchedulePlanning = {
  readonly sleepSchedule: ComputedRef<SleepSchedule>;
  readonly realOccurrences: ComputedRef<readonly EventOccurrence[]>;
  readonly projectedOccurrences: ComputedRef<readonly ProjectedEventOccurrence[]>;
  readonly blueSeedSegments: ComputedRef<readonly EventMultiplierSegment[]>;
  readonly blueSeedShifts: ComputedRef<readonly BlueSeedShift[]>;
  readonly sleepCalculationError: ComputedRef<string | null>;
  readonly lunarCalendarStatus: ComputedRef<"idle" | "ready" | "error">;
  readonly recordSleepCalculationError: (error: unknown) => void;
  readonly clearSleepCalculationErrors: () => void;
};

/** 月齢・イベント・花を1本の日別スケジュールへ統合する、睡眠計画の共有状態。 */
export function useSleepSchedulePlanning(params: {
  sleepSettings: Ref<SleepSettings>;
  currentGameDate: Ref<GameDate>;
  effectiveTimeZone: () => string;
  hasRows: () => boolean;
  sleepEventFixture?: SleepEventFixture;
}): SleepSchedulePlanning {
  const sleepCalculationRuntimeError = ref<string | null>(null);
  const lunarCalendarRuntimeError = ref<string | null>(null);
  const sleepPlanningUntil = computed<GameDate>(() => (
    addGameDays(params.currentGameDate.value, MAX_SLEEP_PLANNING_DAYS - 1)
  ));
  const projectedOccurrences = computed<readonly ProjectedEventOccurrence[]>(() => {
    if (!params.sleepSettings.value.useProjectedEvents) return [];
    if (params.sleepEventFixture) return params.sleepEventFixture.projectedOccurrences;
    return buildGeneratedProjectedSleepExpEvents(
      params.currentGameDate.value,
      sleepPlanningUntil.value,
      params.sleepSettings.value.manualEventBonuses,
    );
  });
  /** 計算へ渡す区間と同じ出どころなので、仮イベント設定では消えない。 */
  const realOccurrences = computed<readonly EventOccurrence[]>(() => (
    buildRealEventOccurrences(params.sleepSettings.value.manualEventBonuses)
  ));

  function recordSleepCalculationError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    // schedule 構築に失敗して同一性比較できない場合も、エラーを生んだ入力状態を識別する。
    const failedContext = `${params.currentGameDate.value}|${JSON.stringify(params.sleepSettings.value)}`;
    queueMicrotask(() => {
      // 設定や日付が変わった後へ、古い schedule のエラーを持ち越さない。
      const currentContext = `${params.currentGameDate.value}|${JSON.stringify(params.sleepSettings.value)}`;
      if (currentContext !== failedContext) return;
      if (error instanceof LunarCalendarUnavailableError) lunarCalendarRuntimeError.value = message;
      else sleepCalculationRuntimeError.value = message;
    });
  }

  function clearSleepCalculationErrors(): void {
    sleepCalculationRuntimeError.value = null;
    lunarCalendarRuntimeError.value = null;
  }

  const blueSeedResolution = computed(() => {
    const settings = params.sleepSettings.value;
    if (params.sleepEventFixture) {
      return {
        segments: params.sleepEventFixture.blueSeedSegments,
        shifts: params.sleepEventFixture.blueSeedShifts,
      };
    }
    if (settings.blueSeedPlantWeekday === null) {
      return { segments: [], shifts: [] as readonly BlueSeedShift[] };
    }
    // flower の入力なので schedule の dayKind を再利用せず、同じ満月カレンダーを直接渡す。
    const lunar = createLunarCalendar();
    try {
      return resolveBlueSeedSegments({
        realSegments: sleepExpEventSegments,
        projectedOccurrences: projectedOccurrences.value,
        flowers: sleepExpEventFlowers,
        weekday: settings.blueSeedPlantWeekday,
        includeGSD: settings.includeGSD,
        dayKind: date => lunar.dayKind(date),
        until: sleepPlanningUntil.value,
      });
    } catch (error) {
      // 花の月齢エラーも共有経路へ合流させ、範囲外を通常日扱いにはしない。
      // 予期しない例外は握りつぶさず呼び出し側へ返す。
      if (!(error instanceof LunarCalendarUnavailableError)) throw error;
      recordSleepCalculationError(error);
      return { segments: [], shifts: [] as readonly BlueSeedShift[] };
    }
  });
  const blueSeedSegments = computed(() => blueSeedResolution.value.segments);
  const blueSeedShifts = computed(() => blueSeedResolution.value.shifts);

  let cachedSleepScheduleKey = "";
  let cachedSleepSchedule: SleepSchedule | null = null;
  const sleepSchedule = computed<SleepSchedule>(() => {
    const settings = params.sleepSettings.value;
    const timeZone = params.effectiveTimeZone();
    const eventSegments = buildPlannerEventSegments(
      settings.manualEventBonuses,
      projectedOccurrences.value,
      blueSeedSegments.value,
    );
    const key = buildSleepScheduleCacheKey({
      currentGameDate: params.currentGameDate.value,
      timeZone,
      includeGSD: settings.includeGSD,
      growthIncenseGsdDays: settings.growthIncenseGsdDays,
      growthIncenseNormalPerWeek: settings.growthIncenseNormalPerWeek,
      growthIncenseStock: settings.growthIncenseStock,
      manualEventBonuses: settings.manualEventBonuses,
      useProjectedEvents: settings.useProjectedEvents,
      blueSeedPlantWeekday: settings.blueSeedPlantWeekday,
      blueSeedIncenseDays: settings.blueSeedIncenseDays,
      projectedOccurrences: projectedOccurrences.value,
      blueSeedSegments: blueSeedSegments.value,
    });
    if (cachedSleepSchedule && cachedSleepScheduleKey === key) return cachedSleepSchedule;
    cachedSleepScheduleKey = key;
    cachedSleepSchedule = createSleepSchedule({
      startGameDate: params.currentGameDate.value,
      timeZone,
      includeGSD: settings.includeGSD,
      growthIncenseGsdDays: settings.growthIncenseGsdDays,
      growthIncenseNormalPerWeek: settings.growthIncenseNormalPerWeek,
      growthIncenseStock: settings.growthIncenseStock,
      blueSeedIncenseDays: settings.blueSeedIncenseDays,
      eventSegments,
    });
    return cachedSleepSchedule;
  });

  // 表示計算中の同期書き換えを避け、複数行の成功・失敗順で警告が揺れないようにする。
  const sleepCalculationError = computed<string | null>(() => (
    params.hasRows() ? sleepCalculationRuntimeError.value : null
  ));
  const lunarCalendarStatus = computed<"idle" | "ready" | "error">(() => {
    if (!params.sleepSettings.value.includeGSD || !params.hasRows()) return "idle";
    return lunarCalendarRuntimeError.value ? "error" : "ready";
  });

  return {
    sleepSchedule,
    realOccurrences,
    projectedOccurrences,
    blueSeedSegments,
    blueSeedShifts,
    sleepCalculationError,
    lunarCalendarStatus,
    recordSleepCalculationError,
    clearSleepCalculationErrors,
  };
}
