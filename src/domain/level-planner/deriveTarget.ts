import type { BoostEvent, ExpGainNature, ExpType } from '../types';
import { maxLevel as MAX_LEVEL } from '../pokesleep/tables';
import { addExpToLevel, calcExp } from '../pokesleep/exp';
import { simulateCandyBudget } from '../pokesleep/simulateCandyBudget';

export type DeriveTargetParams = {
  /** 保存された最終目標Lv。 */
  dstLevel: number;
  /**
   * 保存された最終目標のLv内EXP。
   * 個数指定なしの行では常に 0（＝目標は Lv ちょうど。§4.5 / §3.8-d）。
   */
  dstExpInLevel?: number;
  /** アメ個数指定（総アメ数）。undefined = 個数指定なし＝目標は Lv ちょうど。 */
  candyTarget?: number;
  /** アメブ個数。undefined = アメブ目標Lvから導出。 */
  boostOrExpAdjustment?: number;
  expType: ExpType;
};

export type DerivedTarget = {
  /** 睡眠後の最終目標Lv。 */
  targetLevel: number;
  /** 睡眠後の最終目標Lv内EXP。 */
  targetExpInLevel: number;
};

/**
 * 目標Lv内EXPが取りうる最大値。MAX_LEVEL では 0。
 * ローカル保存の丸めもバックアップの検証もこの1つの境界を使う。
 */
export function maxTargetExpInLevel(dstLevel: number, expType: ExpType): number {
  if (dstLevel >= MAX_LEVEL) return 0;
  return Math.max(0, calcExp(dstLevel, dstLevel + 1, expType) - 1);
}

/** 目標Lv内EXPを [0, maxTargetExpInLevel] に収める。 */
export function normalizeTargetExpInLevel(
  dstLevel: number,
  dstExpInLevel: number | undefined,
  expType: ExpType,
): number {
  const raw = Number.isFinite(dstExpInLevel) ? Math.max(0, Math.floor(dstExpInLevel as number)) : 0;
  return Math.min(raw, maxTargetExpInLevel(dstLevel, expType));
}

/**
 * 最終目標 T を返す（設計書§4.5、§10 改訂A）。
 *
 * **最終目標は保存値（dstLevel + dstExpInLevel）そのものである。** アメ個数から毎回導出し直すと、
 * 整数アメの丸め（最後の1個の余剰EXP）のぶんだけ目標が動き、「睡眠変更時は T を固定」が成立しない。
 * T を動かす操作（個数指定・アメブの変更）では、ストア側が targetFromCandy で T を求めて保存する。
 *
 * 個数指定・アメブ個数がどちらも未入力の行だけ、目標を Lv ちょうどへ正規化する。
 * どちらかが明示入力なら、その個数が作った端数EXPも保存目標の一部である。
 */
export function deriveTarget(params: DeriveTargetParams): DerivedTarget {
  const { dstLevel, candyTarget, boostOrExpAdjustment, expType } = params;
  if (candyTarget === undefined && boostOrExpAdjustment === undefined) {
    return { targetLevel: dstLevel, targetExpInLevel: 0 };
  }
  return {
    targetLevel: dstLevel,
    targetExpInLevel: normalizeTargetExpInLevel(dstLevel, params.dstExpInLevel, expType),
  };
}

export type TargetFromCandyParams = {
  srcLevel: number;
  expGot: number;
  /** アメ個数指定（総アメ数）。 */
  candyTarget: number;
  /** アメブ個数。candyTarget の内数へクランプして使う。 */
  boostCandy: number;
  expType: ExpType;
  nature: ExpGainNature;
  boostKind: BoostEvent;
  /** 睡眠EXP。アメ投入後の到達点に加算する（アメが先、睡眠が後。§5.0）。 */
  sleepExp?: number;
};

/**
 * 個数指定 m・アメブ n・睡眠EXP S から最終目標 T を求める（§4.5）。
 *
 * m / n を操作したときだけ呼ぶ。ここで求めた T を dstLevel + dstExpInLevel として保存し、
 * 以降は保存値が唯一の目標地点になる。
 */
export function targetFromCandy(params: TargetFromCandyParams): { level: number; expInLevel: number } {
  const { srcLevel, expGot, expType, nature, boostKind } = params;
  const m = Math.max(0, Math.floor(params.candyTarget));
  const n = Math.min(Math.max(0, Math.floor(params.boostCandy)), m);
  const sleepExp = Math.max(0, Math.floor(params.sleepExp ?? 0));

  const reached = simulateCandyBudget(
    { currentLevel: srcLevel, currentExpInLevel: expGot, expType, nature },
    n, m, Infinity, boostKind,
  );
  return sleepExp > 0
    ? addExpToLevel(reached.level, reached.expInLevel, sleepExp, expType)
    : { level: reached.level, expInLevel: reached.level >= MAX_LEVEL ? 0 : reached.expInLevel };
}
