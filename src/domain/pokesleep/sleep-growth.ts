/**
 * 睡眠育成機能
 *
 * アチーブメント達成（睡眠1000h/2000h）とレベルアップを同時に狙えるよう、
 * 「N時間の睡眠EXPでちょうど目標Lvに到達」するためのアメ個数を逆算する
 *
 * @see .agent/DESIGN_SLEEP_GROWTH.md
 */

import type { BoostEvent, ExpGainNature, ExpType } from '../types';
import { calcExp, calcExpPerCandy } from './exp';

// ============================================================
// 定数
// ============================================================

/** 太陰月（日） */
const LUNAR_CYCLE = 29.53;

/** 1周期あたりのGSDボーナス（スコア相当） */
const GSD_BONUS_PER_CYCLE = 400;

// ============================================================
// 型定義
// ============================================================

/**
 * 睡眠育成の計算結果
 */
export type MarkForSleepResult = {
  /** 睡眠で獲得予定のEXP（= アメ投入後に残すべき残EXP） */
  sleepExp: number;

  /** 必要な日数（targetSleepHours / dailySleepHours） */
  requiredDays: number;
};

/**
 * 残EXPを睡眠でカバーするのに必要な時間
 */
export type SleepTimeResult = {
  /** 必要な睡眠時間（時間単位） */
  requiredHours: number;

  /** 必要な日数 */
  requiredDays: number;
};

// ============================================================
// 内部ヘルパー関数（export しない）
// ============================================================

/**
 * 性格倍率を取得
 */
function getNatureMultiplier(nature: ExpGainNature): number {
  return nature === 'up' ? 1.18 : nature === 'down' ? 0.82 : 1.0;
}

/**
 * 睡眠時間（分）→ スコア
 *
 * @see にとよんツール Score.ts
 */
function calcScoreFromMinutes(minutes: number): number {
  return Math.min(100, Math.max(0, Math.floor(minutes / 5.1 + 0.5)));
}

/**
 * 睡眠EXP計算
 *
 * 計算順序（検証済み）:
 * 1. スコア × 睡眠EXPボーナス → 四捨五入
 * 2. × イベントボーナス
 * 3. × 性格補正 → 切り捨て (floor)
 */
function calcSleepExp(params: {
  score: number;
  sleepExpBonus: number;
  nature: ExpGainNature;
  eventBonus?: number;
}): number {
  const { score, sleepExpBonus, nature, eventBonus = 1.0 } = params;
  const step1 = Math.round(score * sleepExpBonus);
  const step2 = step1 * eventBonus;
  const natureMultiplier = getNatureMultiplier(nature);
  return Math.floor(step2 * natureMultiplier);
}

/**
 * 1日の睡眠EXPを計算（共通ロジック）
 */
function calcDailySleepExp(params: {
  dailySleepHours: number;
  sleepExpBonus: number;
  nature: ExpGainNature;
}): number {
  const minutes = params.dailySleepHours * 60;
  const score = Math.min(100, calcScoreFromMinutes(minutes));
  return calcSleepExp({
    score,
    sleepExpBonus: params.sleepExpBonus,
    nature: params.nature,
  });
}

/**
 * GSDボーナスを計算
 *
 * 月齢周期を使用した簡易計算
 */
function calcGSDBonus(totalDays: number): number {
  const gsdCycles = Math.floor(totalDays / LUNAR_CYCLE);
  return gsdCycles * GSD_BONUS_PER_CYCLE;
}

// ============================================================
// 公開関数（export する）
// ============================================================

/**
 * 睡眠育成のマーク地点を計算
 *
 * 「N時間の睡眠EXPで目標到達」するための区切り点を算出
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

  // 1日の睡眠EXP
  const dailyExp = calcDailySleepExp({
    dailySleepHours,
    sleepExpBonus,
    nature,
  });

  // 必要日数（切り上げ）
  const requiredDays = Math.ceil(targetSleepHours / dailySleepHours);

  // 総睡眠EXP = 1日EXP × 日数 + GSDボーナス
  const baseExp = dailyExp * requiredDays;
  const gsdBonus = includeGSD ? calcGSDBonus(requiredDays) : 0;
  const sleepExp = baseExp + gsdBonus;

  return {
    sleepExp,
    requiredDays,
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

  if (expToTarget <= 0) {
    return { requiredHours: 0, requiredDays: 0 };
  }

  // 1日の睡眠EXP
  const dailyExp = calcDailySleepExp({
    dailySleepHours,
    sleepExpBonus,
    nature,
  });

  if (dailyExp <= 0) {
    // 睡眠EXPが0の場合は無限日必要（実質不可能）
    return { requiredHours: Infinity, requiredDays: Infinity };
  }

  // 二分探索でmarkForSleepと整合する日数を求める
  // 「何日あればexpToTarget以上のEXPを稼げるか」を計算
  let lo = 1;
  let hi = Math.ceil(expToTarget / dailyExp) + 1000; // 十分大きな上限

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const baseExp = dailyExp * mid;
    const gsdBonus = includeGSD ? calcGSDBonus(mid) : 0;
    const totalExp = baseExp + gsdBonus;

    if (totalExp >= expToTarget) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  const requiredDays = lo;
  const requiredHours = requiredDays * dailySleepHours;

  return {
    requiredHours,
    requiredDays,
  };
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
 * @param sleepExp markForSleepの出力（睡眠で得られるEXP）
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

  // 目標まで行の合計アメ数
  const maxCandy = targetBoostCandy + targetNormalCandy;

  // sleepExp >= expNeed なら candyTarget = 0（アメ不要）
  if (sleepExp >= expNeed) {
    return 0;
  }

  // 二分探索で「(expNeed - sleepExp)以上のEXPを稼げる最小のcandyTarget」を求める
  // candyTarget が小さいほど残EXPが大きい
  // candyTarget=0 → 残EXP=expNeed
  // candyTarget=maxCandy → 残EXP=0

  let lo = 0;
  let hi = maxCandy;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);

    // mid個のアメで得られるEXPを計算
    const expFromCandy = calcExpFromCandyTarget(
      srcLevel,
      dstLevel,
      expType,
      nature,
      boostKind,
      targetBoostCandy,
      targetNormalCandy,
      mid,
      expGot
    );

    // 残EXP = expNeed - expFromCandy
    const remainingExp = expNeed - expFromCandy;

    if (remainingExp <= sleepExp) {
      // mid個で足りる（sleepExpでカバー可能な残EXPになる）
      // より少ない個数でも可能か探る
      hi = mid;
    } else {
      // mid個では足りない
      lo = mid + 1;
    }
  }

  return lo;
}

/**
 * candyTarget個のアメで得られるEXPを計算
 *
 * アメブ → 通常アメの順で投入し、candyTarget個分のEXPを計算
 */
function calcExpFromCandyTarget(
  srcLevel: number,
  dstLevel: number,
  expType: ExpType,
  nature: ExpGainNature,
  boostKind: BoostEvent,
  targetBoostCandy: number,
  targetNormalCandy: number,
  candyTarget: number,
  expGot: number
): number {
  if (candyTarget <= 0) {
    return 0;
  }

  // candyTarget をアメブと通常アメに分配
  // アメブ優先で使用
  const boostToUse = Math.min(targetBoostCandy, candyTarget);
  const normalToUse = Math.min(targetNormalCandy, candyTarget - boostToUse);

  let totalExp = 0;
  let level = srcLevel;
  let carry = expGot;

  // アメブを投入
  if (boostToUse > 0 && boostKind !== 'none') {
    let remaining = boostToUse;
    while (remaining > 0 && level < dstLevel) {
      const expPerCandy = calcExpPerCandy(level, nature, boostKind);
      const requiredExp = calcExp(level, level + 1, expType) - carry;

      if (requiredExp <= 0) {
        carry = -requiredExp;
        level++;
        continue;
      }

      const requiredCandy = Math.ceil(requiredExp / expPerCandy);
      const toUse = Math.min(requiredCandy, remaining);

      totalExp += expPerCandy * toUse;
      remaining -= toUse;

      if (toUse >= requiredCandy) {
        carry = expPerCandy * toUse - requiredExp;
        level++;
      } else {
        carry += expPerCandy * toUse;
        break;
      }
    }

    // レベル上限到達後も残りがあれば加算
    if (remaining > 0 && level >= dstLevel) {
      const expPerCandy = calcExpPerCandy(dstLevel, nature, boostKind);
      totalExp += expPerCandy * remaining;
      carry += expPerCandy * remaining;
    }
  }

  // 通常アメを投入
  if (normalToUse > 0) {
    let remaining = normalToUse;
    while (remaining > 0 && level < dstLevel) {
      const expPerCandy = calcExpPerCandy(level, nature, 'none');
      const requiredExp = calcExp(level, level + 1, expType) - carry;

      if (requiredExp <= 0) {
        carry = -requiredExp;
        level++;
        continue;
      }

      const requiredCandy = Math.ceil(requiredExp / expPerCandy);
      const toUse = Math.min(requiredCandy, remaining);

      totalExp += expPerCandy * toUse;
      remaining -= toUse;

      if (toUse >= requiredCandy) {
        carry = expPerCandy * toUse - requiredExp;
        level++;
      } else {
        break;
      }
    }

    // レベル上限到達後も残りがあれば加算
    if (remaining > 0 && level >= dstLevel) {
      const expPerCandy = calcExpPerCandy(dstLevel, nature, 'none');
      totalExp += expPerCandy * remaining;
    }
  }

  return totalExp;
}
