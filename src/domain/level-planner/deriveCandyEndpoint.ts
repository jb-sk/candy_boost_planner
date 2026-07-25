import type { BoostEvent, ExpGainNature, ExpType } from '../types';
import { addExpToLevel } from '../pokesleep/exp';
import { simulateCandyBudget } from '../pokesleep/simulateCandyBudget';

export type DeriveCandyEndpointParams = {
  srcLevel: number;
  /** 現在Lv内で既に得ているEXP。 */
  expGot: number;
  /** 総アメ数。 */
  candyTarget: number;
  /** 総アメ数の内数として先に使うアメブ個数。 */
  boostCandy: number;
  expType: ExpType;
  nature: ExpGainNature;
  boostKind: BoostEvent;
  /** アメ投入後に加算する睡眠EXP。 */
  sleepExp?: number;
};

/**
 * アメ個数が駆動側になった操作で、アメ投入後（必要なら睡眠後）の正確な到達点を求める。
 * 保存する最終目標とは別概念であり、固定目標からアメ数を逆算する処理には使わない。
 */
export function deriveCandyEndpoint(params: DeriveCandyEndpointParams): { level: number; expInLevel: number } {
  const totalCandy = Math.max(0, Math.floor(params.candyTarget));
  const boostCandy = Math.min(Math.max(0, Math.floor(params.boostCandy)), totalCandy);
  const reached = simulateCandyBudget(
    {
      currentLevel: params.srcLevel,
      currentExpInLevel: Math.max(0, Math.floor(params.expGot)),
      expType: params.expType,
      nature: params.nature,
    },
    boostCandy,
    totalCandy,
    Infinity,
    params.boostKind,
  );
  const sleepExp = Math.max(0, Math.floor(params.sleepExp ?? 0));
  return sleepExp > 0
    ? addExpToLevel(reached.level, reached.expInLevel, sleepExp, params.expType)
    : { level: reached.level, expInLevel: reached.expInLevel };
}
