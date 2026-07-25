import type { BoostEvent, ExpGainNature, ExpType } from '../types';
import { calcExp, calcExpAndCandy, calcExpAndCandyMixed } from '../pokesleep/exp';
import { maxLevel as MAX_LEVEL } from '../pokesleep/tables';
import { deriveCandyEndpoint } from './deriveCandyEndpoint';

export type DeriveTargetParams = {
  srcLevel: number;
  /** 現在Lv内で既に得ているEXP。 */
  expGot: number;
  /** 保存された正確な最終目標Lv。 */
  dstLevel: number;
  /** 保存された正確な最終目標Lv内EXP。 */
  dstExpInLevel?: number;
  /** アメ個数指定（総アメ数）。undefined = 目標から必要数を計算する。 */
  candyTarget?: number;
  /** アメブ個数。総アメ数または目標までの必要数の内数としてクランプする。 */
  boostCandy: number;
  expType: ExpType;
  nature: ExpGainNature;
  boostKind: BoostEvent;
  /** @deprecated 旧 store の個数到達点計算だけで使用する。planner は再加算しない。 */
  sleepExp?: number;
  /** 保存された正確な目標を使う。planner 呼び出しでは必ず true。 */
  fixedTarget?: boolean;
};

export type DerivedTarget = {
  /** 保存された正確な最終目標Lv。 */
  targetLevel: number;
  /** 保存された正確な最終目標Lv内EXP。 */
  targetExpInLevel: number;
  /** 「目標まで」行のアメ数。 */
  requiredCandy: number;
};

function normalizeTargetExp(dstLevel: number, dstExpInLevel: number | undefined, expType: ExpType): number {
  if (dstLevel >= MAX_LEVEL) return 0;
  const toNext = Math.max(0, calcExp(dstLevel, dstLevel + 1, expType));
  return Math.max(0, Math.min(Math.max(0, toNext - 1), Math.floor(dstExpInLevel ?? 0)));
}

/**
 * 保存された最終目標と、その目標行で必要なアメ数を導出する。
 *
 * 最終目標は常に dstLevel + dstExpInLevel が唯一の真実のソースである。
 * 睡眠目標では必要アメ数が整数へ丸められるため、アメ＋睡眠の順方向シミュレーションは
 * 保存目標をわずかに追い越し得る。その余剰を最終目標へ混ぜない。
 */
export function deriveTarget(params: DeriveTargetParams): DerivedTarget {
  const {
    srcLevel,
    expGot,
    dstLevel,
    candyTarget,
    expType,
    nature,
    boostKind,
  } = params;
  const targetExpInLevel = normalizeTargetExp(dstLevel, params.dstExpInLevel, expType);
  const boostCandy = Math.max(0, Math.floor(params.boostCandy));

  if (candyTarget !== undefined) {
    const requiredCandy = Math.max(0, Math.floor(candyTarget));
    // 未移行の base store はこの関数を「個数から到達点を求める」用途にも使っている。
    // fixedTarget または dstExpInLevel が明示された planner 経路では、保存目標を必ず優先する。
    if (!params.fixedTarget && params.dstExpInLevel === undefined) {
      const endpoint = deriveCandyEndpoint({
        srcLevel,
        expGot,
        candyTarget: requiredCandy,
        boostCandy,
        expType,
        nature,
        boostKind,
        sleepExp: params.sleepExp,
      });
      return {
        targetLevel: endpoint.level,
        targetExpInLevel: endpoint.expInLevel,
        requiredCandy,
      };
    }
    return {
      targetLevel: dstLevel,
      targetExpInLevel,
      requiredCandy,
    };
  }

  // アメブは総アメ数の内数。必要数を超える入力をそのまま mixed 計算へ渡すと、
  // 目標到達後の余剰アメまで消費して必要数が過大になる。
  const fullBoost = calcExpAndCandy({
    srcLevel,
    dstLevel,
    dstExpInLevel: targetExpInLevel,
    expType,
    nature,
    boost: boostKind,
    expGot,
  }).candy;
  const mixed = calcExpAndCandyMixed({
    srcLevel,
    dstLevel,
    dstExpInLevel: targetExpInLevel,
    expType,
    nature,
    boost: boostKind,
    boostCandy: Math.min(boostCandy, fullBoost),
    expGot,
  });

  return {
    targetLevel: dstLevel,
    targetExpInLevel,
    requiredCandy: mixed.boostCandy + mixed.normalCandy,
  };
}
