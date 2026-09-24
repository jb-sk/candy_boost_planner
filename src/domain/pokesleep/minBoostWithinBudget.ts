import type { BoostEvent, ExpGainNature, ExpType } from "../types";
import { calcExpAndCandy } from "./exp";
import { minBoostForTarget } from "./minBoostForTarget";
import { minCandyForTarget } from "./minCandyForTarget";
import { maxLevel } from "./tables";

export type MinBoostWithinBudgetParams = {
  srcLevel: number;
  targetLevel: number;
  /** 目標Lv内の到達EXP。省略時はLvちょうど。 */
  targetExpInLevel?: number;
  expType: ExpType;
  nature: ExpGainNature;
  boostKind: Exclude<BoostEvent, "none">;
  /** 利用可能な総アメ数。 */
  budget: number;
  /** 現在Lv内ですでに得ているEXP。 */
  expGot?: number;
};

/**
 * 総アメ数の予算内で目標へ届く、最小のアメブ個数を返す。
 * 予算内で届かない場合は undefined。§7 の個数指定逆算でも使える純粋関数。
 */
export function minBoostWithinBudget(params: MinBoostWithinBudgetParams): number | undefined {
  const budget = Math.max(0, Math.floor(params.budget));
  const targetExpInLevel = params.targetLevel >= maxLevel ? 0 : Math.max(0, Math.floor(params.targetExpInLevel ?? 0));
  const shared = {
    srcLevel: params.srcLevel,
    dstLevel: params.targetLevel,
    dstExpInLevel: targetExpInLevel,
    expType: params.expType,
    nature: params.nature,
    boost: params.boostKind,
    expGot: params.expGot,
  };
  const maxBoost = calcExpAndCandy(shared).candy;
  const boostCandy = minBoostForTarget({
    srcLevel: params.srcLevel,
    targetLevel: params.targetLevel,
    targetExpInLevel,
    expType: params.expType,
    nature: params.nature,
    boostKind: params.boostKind,
    maxBoost,
    expGot: params.expGot,
    fixedTotalCandy: budget,
  });

  // minBoostForTarget は不可能な場合も上限を返すため、必要総数で明示的に判定する。
  const needed = minCandyForTarget({
    srcLevel: params.srcLevel,
    targetLevel: params.targetLevel,
    targetExpInLevel,
    expType: params.expType,
    nature: params.nature,
    boostKind: params.boostKind,
    boostCandy,
    expGot: params.expGot,
  });
  return needed <= budget ? boostCandy : undefined;
}
