import type { BoostEvent, ExpGainNature, ExpType } from '../types';
import { addExpToLevel, calcExpAndCandy, calcExpAndCandyMixed } from '../pokesleep/exp';
import { simulateCandyBudget } from '../pokesleep/simulateCandyBudget';

export type DeriveTargetParams = {
  srcLevel: number;
  /** 現在Lv内で既に得ているEXP */
  expGot: number;
  /** 保存された目標Lv。個数指定なしのときはこれがそのまま目標になる。 */
  dstLevel: number;
  /** アメ個数指定（総アメ数）。undefined = 個数指定なし（目標Lvが anchor）。 */
  candyTarget?: number;
  /** アメブ個数。個数指定ありのときは candyTarget でクランプする。 */
  boostCandy: number;
  expType: ExpType;
  nature: ExpGainNature;
  boostKind: BoostEvent;
  /**
   * 睡眠EXP（アメ投入後の到達点に加算する。アメが先、睡眠が後）。
   * 個数指定なしのときは呼び出し側で 0 を渡すこと（不変条件 §4.3 により S=0 が保証される）。
   */
  sleepExp?: number;
};

export type DerivedTarget = {
  /** 睡眠後の最終目標Lv。 */
  targetLevel: number;
  /** 睡眠後の最終目標Lv内EXP。 */
  targetExpInLevel: number;
  /** 「目標まで」行のアメ数（個数指定があればその値、なければ dstLevel ちょうどへ届く最小アメ数）。 */
  requiredCandy: number;
};

/**
 * 個数指定・目標Lv・アメブ個数・睡眠EXPから、最終目標（T）と「目標まで」行のアメ数を導出する。
 * rowsView（表示）と buildPlannerInput（ソルバー入力）の両方がこれを使う（設計書§4.5）。
 *
 * - 個数指定あり: 「アメブ n 個＋通常 m-n 個」の混合シミュレーションでアメ到達点を求め、睡眠EXPを加算する。
 * - 個数指定なし: 目標は dstLevel ちょうど（targetExpInLevel=0）。ceil の余剰EXPを目標へ混ぜない（§3.8-d）。
 *
 * アメブが目標Lv到達に必要な最小数を超えた場合は、呼び出し側（ストア）が個数指定を立てて
 * 「個数指定あり」へ遷移させる。ここは常に2状態のまま保つ。
 */
export function deriveTarget(params: DeriveTargetParams): DerivedTarget {
  const { srcLevel, expGot, dstLevel, candyTarget, expType, nature, boostKind } = params;
  const boostCandy = Math.max(0, Math.floor(params.boostCandy));
  const sleepExp = Math.max(0, Math.floor(params.sleepExp ?? 0));

  if (candyTarget === undefined) {
    // アメブは総アメ数の内数。ここでクランプしないと、calcExpAndCandyMixed が余剰ブーストを
    // 目標Lv内へ投入して総数へ計上するため（exp.ts の boostLeft 消化）、必要アメ数が過大になる。
    const fullBoost = calcExpAndCandy({
      srcLevel, dstLevel, dstExpInLevel: 0, expType, nature, boost: boostKind, expGot,
    }).candy;
    const mixed = calcExpAndCandyMixed({
      srcLevel, dstLevel, dstExpInLevel: 0, expType, nature, boost: boostKind,
      boostCandy: Math.min(boostCandy, fullBoost), expGot,
    });
    return {
      targetLevel: dstLevel,
      targetExpInLevel: 0,
      requiredCandy: mixed.boostCandy + mixed.normalCandy,
    };
  }

  const m = Math.max(0, Math.floor(candyTarget));
  const n = Math.min(boostCandy, m);
  const reached = simulateCandyBudget(
    { currentLevel: srcLevel, currentExpInLevel: expGot, expType, nature },
    n, m, Infinity, boostKind,
  );
  const point = sleepExp > 0 ? addExpToLevel(reached.level, reached.expInLevel, sleepExp, expType) : reached;

  return { targetLevel: point.level, targetExpInLevel: point.expInLevel, requiredCandy: m };
}
