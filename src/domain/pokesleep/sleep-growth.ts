/**
 * 睡眠育成機能
 *
 * アチーブメント達成（睡眠1000h/2000h）とレベルアップを同時に狙えるよう、
 * 「N時間を設定睡眠時間単位で切り上げた日数以内に目標Lvへ到達」するための
 * アメ個数を逆算する
 *
 * @see .agent/sessions/残EXP睡眠時間の端数表示設計.md
 */

import type { BoostEvent, ExpGainNature, ExpType } from '../types';
import { calcExp, calcExpAndCandy, calcLevelByCandy } from './exp';

// ============================================================
// 定数
// ============================================================

/** 太陰月（日） */
const LUNAR_CYCLE = 29.53;

/** 設定可能な1日の睡眠時間上限（13時間） */
const MAX_DAILY_SLEEP_MINUTES = 13 * 60;

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

  /** 途中の値（検算用）。`sleepExp = dailyExp × requiredDays + gsdExtra` */
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
  /** GSDの概算追加EXP（29.53日周期）。includeGSD=false なら 0 */
  gsdExtra: number;
  /** 睡眠EXPボーナス倍率 */
  sleepExpBonus: number;
  /** 性格倍率（百分率。up=118 / normal=100 / down=82） */
  naturePercent: number;
};

/**
 * 次の通常睡眠1回で到達可能な場合の時間幅
 */
export type WithinOneSleepResult = {
  kind: 'within-one-sleep';
  requiredScore: number;
  minutesMin: number;
  minutesMax: number;
};

/**
 * 1回の通常睡眠では到達不能な場合の日単位概算
 */
export type LongTermEstimateResult = {
  kind: 'long-term-estimate';
  requiredDays: number;
  totalMinutes: number;
};

export type SleepTimeResult =
  | WithinOneSleepResult
  | LongTermEstimateResult
  | { kind: 'none' }
  | { kind: 'unavailable' };

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
 * 1. スコア × 睡眠EXPボーナス → 四捨五入
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
}): number {
  const { sleepMinutes, sleepExpBonus, nature, eventBonus = 1.0 } = params;
  if (
    !Number.isFinite(sleepMinutes)
    || !Number.isFinite(sleepExpBonus)
    || !Number.isFinite(eventBonus)
    || sleepMinutes <= 0
    || sleepExpBonus <= 0
    || eventBonus <= 0
  ) {
    return 0;
  }
  const score = calcScoreFromMinutes(sleepMinutes);
  const step1 = Math.round(score * sleepExpBonus);
  const step2 = step1 * eventBonus;
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
}): number {
  return calcSleepExp({
    sleepMinutes: params.dailySleepMinutes,
    sleepExpBonus: params.sleepExpBonus,
    nature: params.nature,
    eventBonus: params.eventBonus,
  });
}

/**
 * GSD 1周期の追加EXPを計算する。
 * 前後日（×2）2日と満月日（×3）1日から通常3日分を差し引く。
 */
export function calcGsdExtraPerCycle(params: {
  dailySleepMinutes: number;
  sleepExpBonus: number;
  nature: ExpGainNature;
}): number {
  const normalExp = calcDailySleepExp({ ...params, eventBonus: 1 });
  const sideExp = calcDailySleepExp({ ...params, eventBonus: 2 });
  const fullMoonExp = calcDailySleepExp({ ...params, eventBonus: 3 });
  return sideExp * 2 + fullMoonExp - normalExp * 3;
}

/**
 * 29.53日周期によるGSDの概算追加EXP
 */
export function calcApproximateGsdExtra(params: {
  sessionDays: number;
  dailySleepMinutes: number;
  sleepExpBonus: number;
  nature: ExpGainNature;
}): number {
  if (!Number.isFinite(params.sessionDays) || params.sessionDays <= 0) return 0;
  const gsdCycles = Math.floor(params.sessionDays / LUNAR_CYCLE);
  return gsdCycles * calcGsdExtraPerCycle(params);
}

/**
 * 設定した1日分の睡眠を整数日数行った場合の累積EXP
 */
export function calcSleepExpForDays(params: {
  days: number;
  dailySleepMinutes: number;
  sleepExpBonus: number;
  nature: ExpGainNature;
  includeGSD: boolean;
}): number {
  const days = Math.max(0, Math.floor(params.days));
  const dailyExp = calcDailySleepExp(params);
  const gsdExtra = params.includeGSD
    ? calcApproximateGsdExtra({ ...params, sessionDays: days })
    : 0;
  return dailyExp * days + gsdExtra;
}

function normalizeDailySleepMinutes(dailySleepHours: number): number | null {
  if (!Number.isFinite(dailySleepHours)) return null;
  const minutes = Math.round(dailySleepHours * 60);
  return minutes >= 1 && minutes <= MAX_DAILY_SLEEP_MINUTES ? minutes : null;
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

  /** GSD考慮するか（デフォルト: true） */
  includeGSD?: boolean;
}): MarkForSleepResult {
  const {
    targetSleepHours,
    nature,
    dailySleepHours = 8.5,
    sleepExpBonus = 1.0,
    includeGSD = true,
  } = params;

  const dailySleepMinutes = normalizeDailySleepMinutes(dailySleepHours);
  if (dailySleepMinutes === null || !Number.isFinite(targetSleepHours) || targetSleepHours <= 0) {
    return {
      sleepExp: 0,
      requiredDays: 0,
      breakdown: {
        dailySleepMinutes: dailySleepMinutes ?? 0,
        dailyScore: 0,
        dailyExp: 0,
        gsdExtra: 0,
        sleepExpBonus,
        naturePercent: getNaturePercent(nature),
      },
    };
  }

  const targetSleepMinutes = Math.max(0, Math.round(targetSleepHours * 60));
  const requiredDays = Math.ceil(targetSleepMinutes / dailySleepMinutes);
  const dailyExp = calcDailySleepExp({ dailySleepMinutes, sleepExpBonus, nature });
  const gsdExtra = includeGSD
    ? calcApproximateGsdExtra({ sessionDays: requiredDays, dailySleepMinutes, sleepExpBonus, nature })
    : 0;

  return {
    // calcSleepExpForDays と同じ式。内訳を出すために求めた値からそのまま組み立てる
    //（同値であることは「整数日境界では日単位概算と一致する」テストで固定）
    sleepExp: dailyExp * requiredDays + gsdExtra,
    requiredDays,
    breakdown: {
      dailySleepMinutes,
      dailyScore: calcScoreFromMinutes(dailySleepMinutes),
      dailyExp,
      gsdExtra,
      sleepExpBonus,
      naturePercent: getNaturePercent(nature),
    },
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

  /** GSD考慮するか（デフォルト: true） */
  includeGSD?: boolean;
}): SleepTimeResult {
  const {
    expToTarget,
    nature,
    dailySleepHours = 8.5,
    sleepExpBonus = 1.0,
    includeGSD = true,
  } = params;

  if (!Number.isFinite(expToTarget)) return { kind: 'unavailable' };
  if (expToTarget <= 0) return { kind: 'none' };

  const dailySleepMinutes = normalizeDailySleepMinutes(dailySleepHours);
  if (
    dailySleepMinutes === null
    || !Number.isFinite(sleepExpBonus)
    || sleepExpBonus <= 0
  ) {
    return { kind: 'unavailable' };
  }

  const dailyExp = calcDailySleepExp({ dailySleepMinutes, sleepExpBonus, nature });
  if (dailyExp <= 0) return { kind: 'unavailable' };

  if (expToTarget <= dailyExp) {
    let minutesMin = 0;
    while (
      minutesMin <= dailySleepMinutes
      && calcSleepExp({ sleepMinutes: minutesMin, sleepExpBonus, nature }) < expToTarget
    ) {
      minutesMin++;
    }
    if (minutesMin > dailySleepMinutes) return { kind: 'unavailable' };

    const requiredScore = calcScoreFromMinutes(minutesMin);
    let minutesMax = minutesMin;
    while (
      minutesMax < dailySleepMinutes
      && calcScoreFromMinutes(minutesMax + 1) === requiredScore
    ) {
      minutesMax++;
    }
    return {
      kind: 'within-one-sleep',
      requiredScore,
      minutesMin,
      minutesMax,
    };
  }

  // GSDを無視した日数は必ず到達可能な上限になる。
  let lo = 1;
  let hi = Math.ceil(expToTarget / dailyExp);
  if (!Number.isFinite(hi) || !Number.isSafeInteger(hi)) return { kind: 'unavailable' };

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const totalExp = calcSleepExpForDays({
      days: mid,
      dailySleepMinutes,
      sleepExpBonus,
      nature,
      includeGSD,
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
  return { kind: 'long-term-estimate', requiredDays, totalMinutes };
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
