/**
 * 睡眠育成機能
 *
 * アチーブメント達成（睡眠1000h/2000h）とレベルアップを同時に狙えるよう、
 * 「N時間を設定睡眠時間単位で切り上げた日数以内に目標Lvへ到達」するための
 * アメ個数を逆算する
 *
 * @see .agent/sessions/残EXP睡眠時間の端数表示設計.md
 */

import {
  MAX_SLEEP_PLANNING_DAYS,
  MIN_DAILY_SLEEP_MINUTES,
  SLEEP_TARGET_HOURS_OPTIONS,
  type BoostEvent,
  type ExpGainNature,
  type ExpType,
} from '../types';
import { calcExp, calcExpAndCandy, calcLevelByCandy } from './exp';
import type { SleepSchedule, SleepScheduleDay } from './sleep-schedule';
import { maxLevel } from './tables';

// ============================================================
// 定数
// ============================================================

/** 設定可能な1日の睡眠時間上限（13時間） */
const MAX_DAILY_SLEEP_MINUTES = 13 * 60;
/** 今夜から明後日まで。これより先は予定変動が大きいため日単位の概算にする。 */
export const MAX_EXACT_SLEEP_NIGHTS = 3;
/** UI・保存形式が受理する最長の睡眠アチーブメント。 */
const MAX_SUPPORTED_SLEEP_TARGET_HOURS = SLEEP_TARGET_HOURS_OPTIONS[SLEEP_TARGET_HOURS_OPTIONS.length - 1];
/** アプリ内で発生し得る最大の残EXP（Lv1→70、EXPタイプ1320）。 */
const MAX_SLEEP_EXP_TO_TARGET = calcExp(1, maxLevel, 1320);
const MIN_SLEEP_EXP_BONUS = 1;
// 同じ式で作ることで、0.14の二進浮動小数誤差（1.7000000000000002）も受理する。
const MAX_SLEEP_EXP_BONUS = 1 + 0.14 * 5;

// ============================================================
// 型定義
// ============================================================

/**
 * 睡眠育成の計算結果
 */
export type MarkForSleepResult = {
  /** 睡眠で獲得予定のEXP（= アメ投入後に残すべき残EXP） */
  sleepExp: number;

  /** 目標時間を設定睡眠時間単位で切り上げた日数 */
  requiredDays: number;

  /** 途中の値（検算用）。`sleepExp = baseExp + outerBonusExtra + incenseExtra` */
  breakdown: SleepExpBreakdown;
};

/**
 * 睡眠EXPの内訳（検算用）。
 *
 * 睡眠EXPは1つの数字にまとまってしまい、画面からは下流の結果（個数指定・必要日数）しか見えない。
 * どの段階で食い違っているかを切り分けられるよう、markForSleep が途中の値も返す。
 * `?perf=1` のコンソールログと検算TSVへ出す（設計書§6.4）。
 */
export type SleepExpBreakdown = {
  /** 1日の睡眠時間（分）。設定が範囲外なら 0 */
  dailySleepMinutes: number;
  /** 1日の睡眠スコア（上限100） */
  dailyScore: number;
  /** 1日の睡眠EXP（= スコア × ボーナス × 性格補正） */
  dailyExp: number;
  /** 全日を平常日・お香なしとして計算したEXP */
  baseExp: number;
  /**
   * 外側の倍率による追加EXP。GSDなし・イベントなしなら 0。
   *
   * 外側の倍率は `SleepScheduleDay.eventBonus`（= max(GSD倍率, イベント倍率)）なので、
   * **GSDだけでなくイベント倍率ぶんもここに入る。** GSD単独の寄与ではない。
   */
  outerBonusExtra: number;
  /** 成長のお香による追加EXP。お香なしなら 0 */
  incenseExtra: number;
  /** 睡眠EXPボーナス倍率 */
  sleepExpBonus: number;
  /** 性格倍率（百分率。up=118 / normal=100 / down=82） */
  naturePercent: number;
  normalDays: number;
  flankDays: number;
  fullMoonDays: number;
  normalIncenseDays: number;
  flankIncenseDays: number;
  fullMoonIncenseDays: number;
};

/**
 * 睡眠計画で使う成長のお香。1回で届く行も長期の行も同じ意味で持つ。
 *
 * **画面に出すお香の個数は、睡眠目標のどの状態でもこの経路から取る**（操作仕様§8.6）。
 * 数値目標の呼び出し側は、EXPを予定した残り睡眠で得られる範囲へ制限する。
 * `markForSleep` の内訳は「睡眠目標時間を寝きるとどれだけEXPを得るか」で目標Lvで止まらず、
 * 睡眠EXPが目標を大きく超える行（Lv70 の硬上限など）で日数を数えすぎる。
 */
export type GrowthIncensePlan = {
  /** 計画中に使う成長のお香の個数（＝お香を使う睡眠日数）。 */
  growthIncenseCount: number;
  /**
   * 最終日はお香を使わない計画か。
   * scheduleが最終日をお香日にしていても、**お香なしで目標へ届くなら使わない**。
   * 内訳（`attributeSleepBonusExpForDays`）へ同じ判断を渡すために公開する。
   *
   * **もともとお香の日でなければ `false`。** 「お香が無い日」と「外した日」は別物で、
   * 混ぜると検算で最終日の扱いを読み違える。
   */
  skipsLastDayIncense: boolean;
};

/**
 * 3晩以内で到達可能な場合の正確な計画。
 * 先行する晩は設定時間どおり寝て、最後の晩だけ時間幅を求める。
 * お香なしで届くならお香は使わない（`minutesMin` もお香なしの時間で出す）。
 */
export type ExactNightsResult = GrowthIncensePlan & {
  kind: 'exact-nights';
  /** 到達までに寝る晩数。先頭 requiredDays - 1 晩は設定睡眠時間どおり寝る。 */
  requiredDays: number;
  requiredScore: number;
  /** 最終晩に必要な睡眠時間幅。 */
  minutesMin: number;
  minutesMax: number;
  /** 先行する満額睡眠と最終晩の下限を足した正確な合計分数。 */
  totalMinutes: number;
};

/**
 * 4晩以上必要な場合の日単位概算。
 * 日数を数え直さず、`calcSleepExpBreakdownForDays` の内訳をそのまま合計する。
 */
export type LongTermEstimateResult = GrowthIncensePlan & {
  kind: 'long-term-estimate';
  requiredDays: number;
  totalMinutes: number;
};

/** 睡眠計画が立った結果。お香の使い方は kind によらず同じフィールドで読める。 */
export type SleepPlanResult = ExactNightsResult | LongTermEstimateResult;

export type SleepTimeResult =
  | SleepPlanResult
  | { kind: 'none' }
  | { kind: 'unavailable' };

/** 睡眠計画が立ったか（日数・お香・所要時間が読めるか）。 */
export function isSleepPlan(result: SleepTimeResult): result is SleepPlanResult {
  return result.kind === 'exact-nights' || result.kind === 'long-term-estimate';
}

// ============================================================
// 内部ヘルパー関数（export しない）
// ============================================================

/**
 * 性格倍率を百分率の整数で取得
 *
 * 0.82を直接乗算すると300 × 0.82が245.999...になるため、
 * 意図しない切り捨てを避けて82 / 100として計算する。
 */
function getNaturePercent(nature: ExpGainNature): number {
  return nature === 'up' ? 118 : nature === 'down' ? 82 : 100;
}

/**
 * 外側の倍率（イベント / リサーチ / GSD前後日）を百分率の整数へ。
 *
 * 性格倍率と同じ理由（浮動小数の誤差で切り捨てが1ずれる）で、
 * 1.25 のような非整数倍率も 125 / 100 として扱う。
 */
function toPercent(multiplier: number): number {
  return Math.round(multiplier * 100);
}

/**
 * 睡眠EXPボーナス持ちの個体数（0〜5）→ 倍率。
 * 呼び出し側が 0.14 という定数を知らずに済むよう、ここに集約する。
 */
export function sleepExpBonusMultiplier(bonusCount: number): number {
  return 1.0 + 0.14 * Math.max(0, bonusCount);
}

/**
 * 睡眠時間（分）→ スコア。`round(分 ÷ 510 × 100)`、上限100。
 *
 * にとよんツール `AmountOfSleep.score`（`src/util/TimeUtil.ts`）と一致することを確認済み。
 * @see .agent/sessions/残EXP睡眠時間の端数表示設計.md §2, §3.1
 */
export function calcScoreFromMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0;
  return Math.min(100, Math.max(0, Math.floor(minutes / 5.1 + 0.5)));
}

/**
 * 睡眠EXP計算
 *
 * 計算順序:
 * 1. スコア × 睡眠EXPボーナス × 成長のお香 → 四捨五入
 * 2. × イベントボーナス
 * 3. × 性格補正 → 切り捨て (floor)
 *
 * にとよんツール `src/util/Exp.ts` の丸めと突き合わせて確認した順序。
 * @see .agent/sessions/残EXP睡眠時間の端数表示設計.md §3.1
 */
export function calcSleepExp(params: {
  sleepMinutes: number;
  sleepExpBonus: number;
  nature: ExpGainNature;
  eventBonus?: number;
  incenseMultiplier?: number;
}): number {
  const { sleepMinutes, sleepExpBonus, nature, eventBonus = 1.0, incenseMultiplier = 1.0 } = params;
  if (
    !Number.isFinite(sleepMinutes)
    || !Number.isFinite(sleepExpBonus)
    || !Number.isFinite(eventBonus)
    || !Number.isFinite(incenseMultiplier)
    || sleepMinutes <= 0
    || sleepExpBonus <= 0
    || eventBonus <= 0
    || incenseMultiplier <= 0
  ) {
    return 0;
  }
  const score = calcScoreFromMinutes(sleepMinutes);
  const step1 = Math.round(score * sleepExpBonus * incenseMultiplier);
  // 外側の倍率は掛けたあと切り捨てる。2026-08-21 のゲーム内実測で確定した
  // （スコア92・おこう2・イベント1.25倍 → 210 × 1.25 = 262.5 → 262。四捨五入なら263）。
  // 整数倍率のときは端数が出ないので、既存の実測（651 / 201 / 434）とも矛盾しない。
  const step2 = Math.floor(step1 * toPercent(eventBonus) / 100);
  return Math.floor(step2 * getNaturePercent(nature) / 100);
}

/**
 * 1日の睡眠EXPを計算（共通ロジック）
 */
function calcDailySleepExp(params: {
  dailySleepMinutes: number;
  sleepExpBonus: number;
  nature: ExpGainNature;
  eventBonus?: number;
  incenseMultiplier?: number;
}): number {
  return calcSleepExp({
    sleepMinutes: params.dailySleepMinutes,
    sleepExpBonus: params.sleepExpBonus,
    nature: params.nature,
    eventBonus: params.eventBonus,
    incenseMultiplier: params.incenseMultiplier,
  });
}

export { MAX_SLEEP_PLANNING_DAYS } from '../types';

function isValidSleepExpBonus(value: number): boolean {
  return Number.isFinite(value)
    && value >= MIN_SLEEP_EXP_BONUS
    && value <= MAX_SLEEP_EXP_BONUS;
}

type SleepExpPrefix = {
  total: number[];
  base: number[];
  outerBonus: number[];
  incense: number[];
  normalDays: number[];
  flankDays: number[];
  fullMoonDays: number[];
  normalIncenseDays: number[];
  flankIncenseDays: number[];
  fullMoonIncenseDays: number[];
};

const sleepExpPrefixCache = new WeakMap<SleepSchedule, Map<string, SleepExpPrefix>>();

function emptyPrefix(): SleepExpPrefix {
  return {
    total: [0], base: [0], outerBonus: [0], incense: [0],
    normalDays: [0], flankDays: [0], fullMoonDays: [0],
    normalIncenseDays: [0], flankIncenseDays: [0], fullMoonIncenseDays: [0],
  };
}

function append(prefix: number[], value: number): void {
  prefix.push(prefix[prefix.length - 1]! + value);
}

function dayExpParts(params: {
  day: SleepScheduleDay;
  dailySleepMinutes: number;
  sleepExpBonus: number;
  nature: ExpGainNature;
}): { total: number; base: number; outerBonus: number; incense: number } {
  const base = calcDailySleepExp({
    dailySleepMinutes: params.dailySleepMinutes,
    sleepExpBonus: params.sleepExpBonus,
    nature: params.nature,
    eventBonus: 1,
    incenseMultiplier: 1,
  });
  const withoutIncense = calcDailySleepExp({
    dailySleepMinutes: params.dailySleepMinutes,
    sleepExpBonus: params.sleepExpBonus,
    nature: params.nature,
    eventBonus: params.day.eventBonus,
    incenseMultiplier: 1,
  });
  const total = calcDailySleepExp({
    dailySleepMinutes: params.dailySleepMinutes,
    sleepExpBonus: params.sleepExpBonus,
    nature: params.nature,
    eventBonus: params.day.eventBonus,
    incenseMultiplier: params.day.incenseMultiplier,
  });
  return { total, base, outerBonus: withoutIncense - base, incense: total - withoutIncense };
}

function prefixFor(params: {
  days: number;
  dailySleepMinutes: number;
  sleepExpBonus: number;
  nature: ExpGainNature;
  schedule: SleepSchedule;
}): SleepExpPrefix {
  let profiles = sleepExpPrefixCache.get(params.schedule);
  if (!profiles) {
    profiles = new Map<string, SleepExpPrefix>();
    sleepExpPrefixCache.set(params.schedule, profiles);
  }
  const key = `${params.dailySleepMinutes}|${params.sleepExpBonus}|${params.nature}`;
  let prefix = profiles.get(key);
  if (!prefix) {
    prefix = emptyPrefix();
    profiles.set(key, prefix);
  }

  while (prefix.total.length <= params.days) {
    const day = params.schedule.dayAt(prefix.total.length - 1);
    const exp = dayExpParts({ ...params, day });
    append(prefix.total, exp.total);
    append(prefix.base, exp.base);
    append(prefix.outerBonus, exp.outerBonus);
    append(prefix.incense, exp.incense);
    append(prefix.normalDays, day.dayKind === 'normal' ? 1 : 0);
    append(prefix.flankDays, day.dayKind === 'flank' ? 1 : 0);
    append(prefix.fullMoonDays, day.dayKind === 'fullMoon' ? 1 : 0);
    append(prefix.normalIncenseDays, day.dayKind === 'normal' && day.useIncense ? 1 : 0);
    append(prefix.flankIncenseDays, day.dayKind === 'flank' && day.useIncense ? 1 : 0);
    append(prefix.fullMoonIncenseDays, day.dayKind === 'fullMoon' && day.useIncense ? 1 : 0);
  }
  return prefix;
}

/** 設定した1日分の睡眠を整数日数行った場合の累積EXPと検算内訳。 */
export function calcSleepExpBreakdownForDays(params: {
  days: number;
  dailySleepMinutes: number;
  sleepExpBonus: number;
  nature: ExpGainNature;
  schedule: SleepSchedule;
}): SleepExpBreakdown & { sleepExp: number } {
  const days = Math.max(0, Math.floor(params.days));
  if (!Number.isSafeInteger(days) || days > MAX_SLEEP_PLANNING_DAYS) {
    throw new RangeError('Invalid sleep day count');
  }
  const prefix = prefixFor({ ...params, days });
  const baseExp = prefix.base[days]!;
  const outerBonusExtra = prefix.outerBonus[days]!;
  const incenseExtra = prefix.incense[days]!;
  return {
    sleepExp: prefix.total[days]!,
    dailySleepMinutes: params.dailySleepMinutes,
    dailyScore: calcScoreFromMinutes(params.dailySleepMinutes),
    dailyExp: calcDailySleepExp(params),
    baseExp,
    outerBonusExtra,
    incenseExtra,
    sleepExpBonus: params.sleepExpBonus,
    naturePercent: getNaturePercent(params.nature),
    normalDays: prefix.normalDays[days]!,
    flankDays: prefix.flankDays[days]!,
    fullMoonDays: prefix.fullMoonDays[days]!,
    normalIncenseDays: prefix.normalIncenseDays[days]!,
    flankIncenseDays: prefix.flankIncenseDays[days]!,
    fullMoonIncenseDays: prefix.fullMoonIncenseDays[days]!,
  };
}

export function calcSleepExpForDays(params: {
  days: number;
  dailySleepMinutes: number;
  sleepExpBonus: number;
  nature: ExpGainNature;
  schedule: SleepSchedule;
}): number {
  return calcSleepExpBreakdownForDays(params).sleepExp;
}

/**
 * 睡眠EXPのボーナス内訳（結果行の「内訳」表示用）。
 *
 * 計画期間（先頭から `days` 日）の各睡眠日を、その日に効いたボーナスの種類でまとめる。
 * 日付は持たない。長期の計画ではGSDが何周期も入り、日付を出すと読めなくなるため
 * **「種類 × 倍率 × お香の有無」で畳んで日数とEXPだけを見せる。**
 *
 * 先頭は `kind: 'base'` の1行（画面の「素EXP」）。これだけは追加分ではなく
 * **素のEXPそのもの**で、全睡眠日が対象（下のGSD・イベントの日も含む）。`multiplier` には睡眠EXPボーナス（スキル）の倍率が入る。
 * 性格補正と1日の睡眠時間もこの数字へ畳み込まれる（どちらも全日一律なので行にはしない）。
 *
 * 帰属の規則:
 * - 外側の倍率は `max(GSD倍率, イベント倍率)`。**勝った方だけ**に外側ぶんを帰属させる
 *   （同値なら GSD 側。二重計上しない）
 * - 成長のお香は内側の倍率なので、外側が乗った状態での増分として数える。
 *   外側のボーナスと同じ日に使ったお香は**その日の行へまとめる**（例: GSD＋お香）
 * - 外側のボーナスが無い日のお香は `kind: 'incense'` の行になる
 *
 * `base` を除く各行の合計は `calcSleepExpBreakdownForDays` の `outerBonusExtra + incenseExtra`、
 * `base` は `baseExp` と一致する（最終日を丸ごと寝る場合）。全行の合計＝睡眠EXP。
 *
 * **最終日は `lastDaySleepMinutes` で短くできる。** 1回の睡眠で届く行（画面にも `6時間41分 ～ 45分`
 * と実時間が出る）は、1日分のボーナスを出すと過大になるので実分数を渡す。
 * 長期の行は画面が日数を切り上げて出しているので、渡さずに丸ごと1日として数える。
 *
 * **合計は残EXPをわずかに上回る。** 睡眠スコアは 5.1分刻みなので最終日は残EXPちょうどで
 * 止まれず、目標を数EXP（最悪ケースで11程度）超えて到達する。**これは実態どおりなので
 * 揃えにいかない。** 行の値をいじると最終日の行がゲームの実値でなくなり、検算に使えなくなる。
 */
/**
 * **おいわいフラワーは独立した種類にしない。** 花は周年フェスの一部なので、
 * 元の周年が実イベントなら `event`、仮イベントなら `projectedEvent` へ合流させる
 * （`SOURCE_TO_KIND`）。専用の行にすると、確定した予定と過去実績からの予測という
 * 内訳のいちばん大事な区別に、第3の軸が並んで読めなくなる。
 * ×3 が花由来であることはイベント一覧の「2週目：あおいタネ ×3」が示す。
 */
export type SleepBonusKind = 'base' | 'gsd' | 'event' | 'projectedEvent' | 'incense';

export type SleepBonusContribution = {
  kind: SleepBonusKind;
  /**
   * 行に添える倍率。
   * - `base`: 睡眠EXPボーナス（スキル）の倍率。持っていなければ 1
   * - `gsd` / `event`: その日の外側の倍率
   * - `incense`: null（お香の倍率は行名が示すので出さない）
   */
  multiplier: number | null;
  /** 同じ日に成長のお香を併用したか（`kind: 'incense'` は常に true） */
  withIncense: boolean;
  /** この行が対象とする睡眠日数。`base` は全睡眠日 */
  days: number;
  /** この行が対象とする各晩の睡眠スコア合計。表示には使わない（内訳表は日数とEXPだけ）。 */
  score: number;
  /** `base` は素のEXP。それ以外は素の状態と比べた**追加**EXP */
  exp: number;
};

/** 3晩以内の正確計画を、晩ごとに示す内訳。3晩以内ではこれがそのまま画面の内訳表になる。 */
export type SleepNightContribution = {
  date: import('./game-date').GameDate;
  /** その晩に効いた外側のボーナス。倍率もお香も無ければ null。 */
  kind: Exclude<SleepBonusKind, 'base'> | null;
  /** 外側の実効倍率。お香だけ、またはボーナス無しなら null。 */
  multiplier: number | null;
  withIncense: boolean;
  /** その晩に現在割り当てられている睡眠時間（分）。設定の睡眠時間そのままで、100点で頭打ちにしない。 */
  minutes: number;
  /** その晩に現在割り当てられている睡眠スコア。 */
  score: number;
  /** その晩の睡眠EXP総額（素＋外側倍率＋お香）。 */
  exp: number;
  /** その晩の素EXP（外側倍率もお香も無いとき の額）。`exp - baseExp` が上乗せぶん。 */
  baseExp: number;
};

const SLEEP_BONUS_KIND_ORDER: Record<SleepBonusKind, number> = {
  base: 0,
  gsd: 1,
  event: 2,
  projectedEvent: 3,
  incense: 4,
};
const SOURCE_TO_KIND = {
  real: 'event',
  flower: 'event',
  projected: 'projectedEvent',
  projectedFlower: 'projectedEvent',
} as const;

export function attributeSleepBonusExpForDays(params: {
  days: number;
  dailySleepMinutes: number;
  sleepExpBonus: number;
  nature: ExpGainNature;
  schedule: SleepSchedule;
  /** 最終日だけ実際に寝る分数（省略時は1日分）。0 なら最終日は数えない。 */
  lastDaySleepMinutes?: number;
  /** 最終日のお香を使わない計画か（`calcSleepTimeForExp` の判断をそのまま渡す）。 */
  skipLastDayIncense?: boolean;
}): SleepBonusContribution[] {
  const days = Math.max(0, Math.floor(params.days));
  if (
    days === 0
    || !Number.isSafeInteger(days)
    || days > MAX_SLEEP_PLANNING_DAYS
    || params.dailySleepMinutes <= 0
    || !isValidSleepExpBonus(params.sleepExpBonus)
  ) return [];

  const lastDayMinutes = params.lastDaySleepMinutes === undefined
    ? params.dailySleepMinutes
    : Math.min(params.dailySleepMinutes, Math.max(0, Math.round(params.lastDaySleepMinutes)));

  const byKey = new Map<string, SleepBonusContribution>();

  function add(row: Omit<SleepBonusContribution, 'days'>) {
    if (row.exp <= 0) return;
    const key = `${row.kind}|${row.multiplier ?? ''}|${row.withIncense}`;
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.days += 1;
      bucket.score += row.score;
      bucket.exp += row.exp;
    } else {
      byKey.set(key, { ...row, days: 1 });
    }
  }

  // 表示用に丸める。1 + 0.14 * 5 は 1.7000000000000002 になるため、そのまま出すと桁が溢れる。
  const skillMultiplier = Math.round(params.sleepExpBonus * 100) / 100;

  for (let i = 0; i < days; i++) {
    const isLastDay = i === days - 1;
    const sleepMinutes = isLastDay ? lastDayMinutes : params.dailySleepMinutes;
    if (sleepMinutes <= 0) continue;
    const scheduled = params.schedule.dayAt(i);
    // 最終日のお香を外す計画なら、その日はお香なしとして数える。
    const day = isLastDay && params.skipLastDayIncense
      ? { ...scheduled, useIncense: false, incenseMultiplier: 1 }
      : scheduled;

    const shared = {
      dailySleepMinutes: sleepMinutes,
      sleepExpBonus: params.sleepExpBonus,
      nature: params.nature,
    };
    const base = calcDailySleepExp({ ...shared, eventBonus: 1, incenseMultiplier: 1 });
    const withOuter = calcDailySleepExp({ ...shared, eventBonus: day.eventBonus, incenseMultiplier: 1 });
    const total = calcDailySleepExp({
      ...shared,
      eventBonus: day.eventBonus,
      incenseMultiplier: day.incenseMultiplier,
    });
    const outerExtra = withOuter - base;
    const incenseExtra = total - withOuter;
    const withIncense = day.incenseMultiplier > 1;
    const score = calcScoreFromMinutes(sleepMinutes);

    // 素EXPは倍率の有無にかかわらず全日ぶんを1行へ。日数＝計画で寝る日数になる。
    add({ kind: 'base', multiplier: skillMultiplier, withIncense: false, score, exp: base });

    if (outerExtra > 0) {
      // イベントがGSDを上回った日だけイベント扱い。同値ならGSD（ゲーム内は max なので実効値は同じ）。
      const kind: SleepBonusKind = day.eventBonus > day.gsdMultiplier
        ? SOURCE_TO_KIND[day.eventSource ?? 'real']
        : 'gsd';
      add({ kind, multiplier: day.eventBonus, withIncense, score, exp: outerExtra + incenseExtra });
    } else {
      add({ kind: 'incense', multiplier: null, withIncense: true, score, exp: incenseExtra });
    }
  }

  /*
   * 並び順は「種類 → 倍率の降順 → お香あり → お香なし」。
   *
   * **お香ありを先に置くこと。** 同じ倍率なら、お香を使った日のほうが必ず稼ぎが大きい。
   * 逆にすると「GSD ×2 +400EXP」が「GSD ×2 ＋お香 +900EXP」の上へ来て、
   * 強い行が弱い行の下にぶら下がって見える。
   *
   * EXPの降順そのものでは並べない。倍率は計画によらない固定値なので、
   * 倍率で並べておけば同じ行が常に同じ位置に来る（EXP順だと日数で位置が動く）。
   * また「×3 なのにお香なし」の行は最終日にお香を外した1日ぶんであることが多く、
   * その日を同倍率の塊の末尾へ落とすのはこの並びで意図どおりになる。
   */
  return [...byKey.values()].sort((a, b) => (
    SLEEP_BONUS_KIND_ORDER[a.kind] - SLEEP_BONUS_KIND_ORDER[b.kind]
    || (b.multiplier ?? 0) - (a.multiplier ?? 0)
    || Number(b.withIncense) - Number(a.withIncense)
  ));
}

/**
 * 3晩以内の正確計画を日付順の日別内訳へする（1晩の計画にも使う）。
 *
 * 表示軸だけを変える関数で、日別EXPの丸め・イベント帰属・最終晩のお香規則は
 * 種類別内訳と同じ計算経路を使う。返す点数は自由配分後の最小値ではなく、
 * `calcSleepTimeForExp` が求めた**現在の配分**である。
 */
export function attributeSleepBonusExpByNight(params: {
  days: number;
  dailySleepMinutes: number;
  sleepExpBonus: number;
  nature: ExpGainNature;
  schedule: SleepSchedule;
  lastDaySleepMinutes?: number;
  skipLastDayIncense?: boolean;
}): SleepNightContribution[] {
  const days = Math.floor(params.days);
  if (
    !Number.isSafeInteger(days)
    || days < 1
    || days > MAX_EXACT_SLEEP_NIGHTS
    || params.dailySleepMinutes <= 0
    || !isValidSleepExpBonus(params.sleepExpBonus)
  ) return [];

  const lastDayMinutes = params.lastDaySleepMinutes === undefined
    ? params.dailySleepMinutes
    : Math.min(params.dailySleepMinutes, Math.max(0, Math.round(params.lastDaySleepMinutes)));
  const rows: SleepNightContribution[] = [];

  for (let i = 0; i < days; i++) {
    const isLastDay = i === days - 1;
    const sleepMinutes = isLastDay ? lastDayMinutes : params.dailySleepMinutes;
    if (sleepMinutes <= 0) continue;
    const scheduled = params.schedule.dayAt(i);
    const day = isLastDay && params.skipLastDayIncense
      ? { ...scheduled, useIncense: false, incenseMultiplier: 1 as const }
      : scheduled;
    const withIncense = day.incenseMultiplier > 1;

    let kind: SleepNightContribution['kind'] = null;
    let multiplier: number | null = null;
    if (day.eventBonus > 1) {
      kind = day.eventBonus > day.gsdMultiplier
        ? SOURCE_TO_KIND[day.eventSource ?? 'real']
        : 'gsd';
      multiplier = day.eventBonus;
    } else if (withIncense) {
      kind = 'incense';
    }

    rows.push({
      date: day.date,
      kind,
      multiplier,
      withIncense,
      minutes: sleepMinutes,
      score: calcScoreFromMinutes(sleepMinutes),
      exp: calcDailySleepExp({
        dailySleepMinutes: sleepMinutes,
        sleepExpBonus: params.sleepExpBonus,
        nature: params.nature,
        eventBonus: day.eventBonus,
        incenseMultiplier: day.incenseMultiplier,
      }),
      // 上乗せぶんを画面で分けて出すための素EXP。倍率・お香を外した同じ睡眠時間の額。
      baseExp: calcDailySleepExp({
        dailySleepMinutes: sleepMinutes,
        sleepExpBonus: params.sleepExpBonus,
        nature: params.nature,
      }),
    });
  }

  return rows;
}

function normalizeDailySleepMinutes(dailySleepHours: number): number | null {
  if (!Number.isFinite(dailySleepHours)) return null;
  const minutes = Math.round(dailySleepHours * 60);
  return minutes >= MIN_DAILY_SLEEP_MINUTES && minutes <= MAX_DAILY_SLEEP_MINUTES ? minutes : null;
}

/**
 * ある晩に必要な残EXPを満たす最小分数と、同じ睡眠スコアになる上限を求める。
 * お香なしで届く場合は、計画上のお香日でも使わない。
 */
function resolveExactLastNight(params: {
  expToTarget: number;
  day: SleepScheduleDay;
  dailySleepMinutes: number;
  sleepExpBonus: number;
  nature: ExpGainNature;
}): {
  requiredScore: number;
  minutesMin: number;
  minutesMax: number;
  skipsIncense: boolean;
} | null {
  const { expToTarget, day, dailySleepMinutes, sleepExpBonus, nature } = params;
  const dailyExpWithoutIncense = calcDailySleepExp({
    dailySleepMinutes,
    sleepExpBonus,
    nature,
    eventBonus: day.eventBonus,
    incenseMultiplier: 1,
  });
  const usesIncense = day.useIncense && expToTarget > dailyExpWithoutIncense;
  const incenseMultiplier = usesIncense ? day.incenseMultiplier : 1;

  let minutesMin = 0;
  while (
    minutesMin <= dailySleepMinutes
    && calcSleepExp({
      sleepMinutes: minutesMin,
      sleepExpBonus,
      nature,
      eventBonus: day.eventBonus,
      incenseMultiplier,
    }) < expToTarget
  ) {
    minutesMin++;
  }
  if (minutesMin > dailySleepMinutes) return null;

  const requiredScore = calcScoreFromMinutes(minutesMin);
  let minutesMax = minutesMin;
  while (
    minutesMax < dailySleepMinutes
    && calcScoreFromMinutes(minutesMax + 1) === requiredScore
  ) {
    minutesMax++;
  }
  return {
    requiredScore,
    minutesMin,
    minutesMax,
    skipsIncense: day.useIncense && !usesIncense,
  };
}

/**
 * 現在地点から指定EXPだけ進んだ仮想目標を求める。
 * 睡眠で賄うEXPを目標から差し引き、既存のアメ計算APIへ渡すために使う。
 */
function locateExpTarget(params: {
  srcLevel: number;
  dstLevel: number;
  expType: ExpType;
  expGot: number;
  expToGain: number;
}): { level: number; expInLevel: number } {
  const { dstLevel, expType } = params;
  let level = params.srcLevel;
  let expInLevel = params.expGot + Math.max(0, params.expToGain);

  while (level < dstLevel) {
    const expToNextLevel = calcExp(level, level + 1, expType);
    if (expInLevel < expToNextLevel) break;
    expInLevel -= expToNextLevel;
    level++;
  }

  return { level, expInLevel };
}

// ============================================================
// 公開関数（export する）
// ============================================================

/**
 * 睡眠育成のマーク地点を計算
 *
 * 目標時間を設定睡眠時間単位で切り上げ、その整数日数ぶんの睡眠EXPを算出する
 */
export function markForSleep(params: {
  /** 目標睡眠時間（1000, 2000, etc. 単位：時間） */
  targetSleepHours: number;

  /** 性格補正（up/normal/down） */
  nature: ExpGainNature;

  /** 1日の睡眠時間（設定項目、デフォルト: 8.5） */
  dailySleepHours?: number;

  /** 睡眠EXPボーナス倍率（1.0 - 1.7） */
  sleepExpBonus?: number;
  /** 基準日・GSD・成長のお香を解決済みの日別schedule。 */
  schedule: SleepSchedule;
}): MarkForSleepResult {
  const {
    targetSleepHours,
    nature,
    dailySleepHours = 8.5,
    sleepExpBonus = 1.0,
    schedule,
  } = params;

  const dailySleepMinutes = normalizeDailySleepMinutes(dailySleepHours);
  if (
    dailySleepMinutes === null
    || !Number.isFinite(targetSleepHours)
    || targetSleepHours <= 0
    || targetSleepHours > MAX_SUPPORTED_SLEEP_TARGET_HOURS
    || !isValidSleepExpBonus(sleepExpBonus)
  ) {
    return {
      sleepExp: 0,
      requiredDays: 0,
      breakdown: {
        dailySleepMinutes: dailySleepMinutes ?? 0,
        dailyScore: 0,
        dailyExp: 0,
        baseExp: 0,
        outerBonusExtra: 0,
        incenseExtra: 0,
        sleepExpBonus,
        naturePercent: getNaturePercent(nature),
        normalDays: 0,
        flankDays: 0,
        fullMoonDays: 0,
        normalIncenseDays: 0,
        flankIncenseDays: 0,
        fullMoonIncenseDays: 0,
      },
    };
  }

  const targetSleepMinutes = Math.max(0, Math.round(targetSleepHours * 60));
  const requiredDays = Math.ceil(targetSleepMinutes / dailySleepMinutes);
  const breakdown = calcSleepExpBreakdownForDays({
    days: requiredDays,
    dailySleepMinutes,
    sleepExpBonus,
    nature,
    schedule,
  });

  return {
    sleepExp: breakdown.sleepExp,
    requiredDays,
    breakdown,
  };
}

/**
 * 残EXPを睡眠でカバーするのに必要な時間を計算
 *
 * 到達可能行に残EXPがある場合（目標未達）に表示する用途
 */
export function calcSleepTimeForExp(params: {
  /** カバーしたい残EXP */
  expToTarget: number;

  /** 性格補正（up/normal/down） */
  nature: ExpGainNature;

  /** 1日の睡眠時間（デフォルト: 8.5） */
  dailySleepHours?: number;

  /** 睡眠EXPボーナス倍率（1.0 - 1.7） */
  sleepExpBonus?: number;
  /** 基準日・GSD・成長のお香を解決済みの日別schedule。 */
  schedule: SleepSchedule;
}): SleepTimeResult {
  const {
    expToTarget,
    nature,
    dailySleepHours = 8.5,
    sleepExpBonus = 1.0,
    schedule,
  } = params;

  if (!Number.isFinite(expToTarget) || expToTarget > MAX_SLEEP_EXP_TO_TARGET) {
    return { kind: 'unavailable' };
  }
  if (expToTarget <= 0) return { kind: 'none' };

  const dailySleepMinutes = normalizeDailySleepMinutes(dailySleepHours);
  if (
    dailySleepMinutes === null
    || !isValidSleepExpBonus(sleepExpBonus)
  ) {
    return { kind: 'unavailable' };
  }

  const firstDay = schedule.dayAt(0);
  const dailyExp = calcDailySleepExp({
    dailySleepMinutes,
    sleepExpBonus,
    nature,
    eventBonus: firstDay.eventBonus,
    incenseMultiplier: firstDay.incenseMultiplier,
  });
  if (dailyExp <= 0) return { kind: 'unavailable' };

  let hi = 1;
  while (calcSleepExpForDays({
    days: hi,
    dailySleepMinutes,
    sleepExpBonus,
    nature,
    schedule,
  }) < expToTarget) {
    if (hi >= MAX_SLEEP_PLANNING_DAYS) return { kind: 'unavailable' };
    hi = Math.min(hi * 2, MAX_SLEEP_PLANNING_DAYS);
  }
  let lo = Math.floor(hi / 2) + 1;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const totalExp = calcSleepExpForDays({
      days: mid,
      dailySleepMinutes,
      sleepExpBonus,
      nature,
      schedule,
    });

    if (totalExp >= expToTarget) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  const requiredDays = lo;
  const totalMinutes = requiredDays * dailySleepMinutes;
  if (!Number.isFinite(totalMinutes)) return { kind: 'unavailable' };
  const breakdown = calcSleepExpBreakdownForDays({
    days: requiredDays,
    dailySleepMinutes,
    sleepExpBonus,
    nature,
    schedule,
  });
  const incenseDays =
    breakdown.normalIncenseDays + breakdown.flankIncenseDays + breakdown.fullMoonIncenseDays;

  if (requiredDays <= MAX_EXACT_SLEEP_NIGHTS) {
    const expBeforeLastNight = calcSleepExpForDays({
      days: requiredDays - 1,
      dailySleepMinutes,
      sleepExpBonus,
      nature,
      schedule,
    });
    const exact = resolveExactLastNight({
      expToTarget: expToTarget - expBeforeLastNight,
      day: schedule.dayAt(requiredDays - 1),
      dailySleepMinutes,
      sleepExpBonus,
      nature,
    });
    if (!exact) return { kind: 'unavailable' };
    return {
      kind: 'exact-nights',
      requiredDays,
      totalMinutes: (requiredDays - 1) * dailySleepMinutes + exact.minutesMin,
      requiredScore: exact.requiredScore,
      minutesMin: exact.minutesMin,
      minutesMax: exact.minutesMax,
      growthIncenseCount: incenseDays - (exact.skipsIncense ? 1 : 0),
      skipsLastDayIncense: exact.skipsIncense,
    };
  }

  // 最終日のお香は、使わなくても目標へ届くなら使わない。
  // （アメブのラスイチを通常アメへ替えても目標Lvへ届くなら替える、と同じ考え方）
  // 外せるのは高々1個。余りは必ず最終日1日ぶんより小さく、お香1日の寄与は素EXP以上あるため。
  //
  // 外した1個は**手持ちの在庫へ戻さない**。在庫は行ではなく共有カレンダーの夜を消費する
  // ものなので、行ごとに戻すと同じ夜を行の数だけ数え直すことになる。運用上も、ラスイチだけ
  // 別の通常日に寝かせて済ませられるため、ここは「使わないまま」で正しい。
  const lastDay = schedule.dayAt(requiredDays - 1);
  const skipsLastDayIncense = lastDay.useIncense
    && breakdown.sleepExp - lastDayIncenseExtra({
      day: lastDay,
      dailySleepMinutes,
      sleepExpBonus,
      nature,
    }) >= expToTarget;

  return {
    kind: 'long-term-estimate',
    requiredDays,
    totalMinutes,
    growthIncenseCount: incenseDays - (skipsLastDayIncense ? 1 : 0),
    skipsLastDayIncense,
  };
}

/** その日の成長のお香が生む追加EXP（外側の倍率が乗った状態での増分）。 */
function lastDayIncenseExtra(params: {
  day: SleepScheduleDay;
  dailySleepMinutes: number;
  sleepExpBonus: number;
  nature: ExpGainNature;
}): number {
  const shared = {
    dailySleepMinutes: params.dailySleepMinutes,
    sleepExpBonus: params.sleepExpBonus,
    nature: params.nature,
    eventBonus: params.day.eventBonus,
  };
  return calcDailySleepExp({ ...shared, incenseMultiplier: params.day.incenseMultiplier })
    - calcDailySleepExp({ ...shared, incenseMultiplier: 1 });
}

/**
 * 睡眠EXPでカバーできる残EXPになるcandyTargetを計算
 *
 * sleepExpと目標EXPを比較し、sleepExpでカバーできる残EXP以下になるよう
 * 投入すべきアメ数（candyTarget）を計算する
 *
 * @param srcLevel 現在レベル
 * @param dstLevel 目標レベル
 * @param expType EXPタイプ（600, 900, 1080, 1320）
 * @param nature 性格補正
 * @param boostKind アメブ種別（none, mini, full）
 * @param targetBoostCandy 目標まで行のアメブ数
 * @param targetNormalCandy 目標まで行の通常アメ数
 * @param sleepExp 目標時間を整数日へ切り上げた日数ぶんの睡眠EXP
 * @param expGot 現在の獲得済みEXP（デフォルト: 0）
 * @param dstExpInLevel 目標Lv内のEXP（デフォルト: 0）
 * @returns candyTarget（個数指定に設定すべき値）
 */
export function calcCandyTargetFromSleepExp(params: {
  srcLevel: number;
  dstLevel: number;
  expType: ExpType;
  nature: ExpGainNature;
  boostKind: BoostEvent;
  targetBoostCandy: number;
  targetNormalCandy: number;
  sleepExp: number;
  expGot?: number;
  dstExpInLevel?: number;
}): number {
  const {
    srcLevel,
    dstLevel,
    expType,
    nature,
    boostKind,
    targetBoostCandy,
    targetNormalCandy,
    sleepExp,
    expGot = 0,
    dstExpInLevel = 0,
  } = params;

  // 目標までの必要EXP（目標Lv内のEXPも含む）
  const expNeed = calcExp(srcLevel, dstLevel, expType) + dstExpInLevel - expGot;

  const targetSleepExp = Math.max(0, Math.floor(sleepExp));
  const expToGainWithCandy = Math.max(0, expNeed - targetSleepExp);
  if (expToGainWithCandy === 0) return 0;

  const candyExpTarget = locateExpTarget({
    srcLevel,
    dstLevel,
    expType,
    expGot,
    expToGain: expToGainWithCandy,
  });
  const boostLimit = boostKind === 'none'
    ? 0
    : Math.max(0, Math.floor(targetBoostCandy));
  const maxCandy = boostLimit + Math.max(0, Math.floor(targetNormalCandy));

  // 仮想目標までアメブだけで届くなら、その最小個数が個数指定になる。
  const boostOnly = calcExpAndCandy({
    srcLevel,
    dstLevel: candyExpTarget.level,
    dstExpInLevel: candyExpTarget.expInLevel,
    expType,
    nature,
    boost: boostKind,
    expGot,
  }).candy;
  if (boostOnly <= boostLimit) return boostOnly;

  // アメブ上限を使い切った地点から、残りを通常アメで埋める。
  const afterBoost = calcLevelByCandy({
    srcLevel,
    dstLevel: candyExpTarget.level,
    dstExpInLevel: candyExpTarget.expInLevel,
    expType,
    nature,
    boost: boostKind,
    candy: boostLimit,
    expGot,
  });
  const normalCandy = calcExpAndCandy({
    srcLevel: afterBoost.level,
    dstLevel: candyExpTarget.level,
    dstExpInLevel: candyExpTarget.expInLevel,
    expType,
    nature,
    boost: 'none',
    expGot: afterBoost.expGot,
  }).candy;

  return Math.min(maxCandy, boostLimit + normalCandy);
}
