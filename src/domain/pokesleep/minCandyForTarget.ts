import type { BoostEvent, ExpGainNature, ExpType } from "../types";
import { calcExpAndCandy, calcExpAndCandyMixed } from "./exp";

export type MinCandyForTargetParams = {
  srcLevel: number;
  targetLevel: number;
  /** 目標Lv内EXP。0 なら目標Lvちょうど。 */
  targetExpInLevel?: number;
  expType: ExpType;
  nature: ExpGainNature;
  boostKind: BoostEvent;
  /** アメブ個数。目標到達に必要な全アメブ数でクランプして使う。 */
  boostCandy: number;
  expGot?: number;
};

/**
 * 現在のアメブ設定 `boostCandy` のもとで、目標へ届く最小の総アメ数を返す。
 *
 * `calcExpAndCandyMixed` は必要数を超える `boostCandy` を渡すと余剰ブーストを目標Lv内へ投入して
 * 総数へ計上する（設計書§10.8）。そのため、渡す前に「全アメブなら何個で届くか」でクランプする。
 * このクランプを忘れると、余分なアメブを持つ行の必要アメ数・個数指定の上限が実際より大きくなる。
 */
export function minCandyForTarget(params: MinCandyForTargetParams): number {
  const { srcLevel, targetLevel, expType, nature, boostKind } = params;
  const targetExpInLevel = Math.max(0, Math.floor(params.targetExpInLevel ?? 0));
  const expGot = params.expGot ?? 0;
  const shared = {
    srcLevel, dstLevel: targetLevel, dstExpInLevel: targetExpInLevel,
    expType, nature, boost: boostKind, expGot,
  };

  const fullBoost = calcExpAndCandy(shared).candy;
  const mixed = calcExpAndCandyMixed({
    ...shared,
    boostCandy: Math.min(Math.max(0, Math.floor(params.boostCandy)), fullBoost),
  });
  return mixed.boostCandy + mixed.normalCandy;
}
