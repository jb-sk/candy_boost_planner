import type { BoostEvent, ExpGainNature, ExpType } from "../types";
import { boostRules } from "./boost-config";
import { dreamShardsPerCandy, totalExpToTheLevel } from "./tables";

/**
 * nitoyon/pokesleep-tool の Exp.ts を参照し、Planner用に依存を外して純関数化したもの。
 * （Kerusu-1984版より新しい仕様を採用：ExpType 1320対応、Candy EXPがレベル帯で変化）
 *
 * 参照（謝辞）:
 * - https://github.com/nitoyon/pokesleep-tool
 * - https://github.com/Kerusu-1984/pokemon-sleep-calc-required-candy
 */

const expTypeRate: Record<ExpType, number> = {
  600: 1,
  900: 1.5,
  1080: 1.8,
  1320: 2.2,
};

export type CalcExpAndCandyResult = {
  exp: number;
  candy: number;
  shards: number;
};

export type CalcLevelByCandyResult = {
  exp: number;
  expLeft: number;
  level: number;
  expGot: number;
  shards: number;
  candyUsed: number;
  candyLeft: number;
};

export type CalcExpAndCandyMixedResult = {
  /** src→dstの必要EXP（expGot換算後） */
  exp: number;
  /** 通常アメで入れた経験値（実際にアメで入ったぶん。端数繰り上げ分も含む） */
  expNormalApplied: number;
  /** ブーストアメで入れた経験値（実際にアメで入ったぶん。端数繰り上げ分も含む） */
  expBoostApplied: number;
  /** 通常アメの使用数 */
  normalCandy: number;
  /** ブーストアメの使用数（ミニブ/アメブ） */
  boostCandy: number;
  /** かけら（通常アメ分 + ブースト分） */
  shards: number;
  /** 内訳：通常アメ分かけら */
  shardsNormal: number;
  /** 内訳：ブースト分かけら */
  shardsBoost: number;
  /** 入力したブーストアメの残り（余った場合） */
  boostCandyLeft: number;
};

export function calcExp(level1: number, level2: number, expType: ExpType): number {
  const ratio = expTypeRate[expType];
  if (level1 < 0 || level2 < 0) return 0;
  if (level1 >= totalExpToTheLevel.length) return 0;
  if (level2 >= totalExpToTheLevel.length) return 0;
  return (
    Math.round(totalExpToTheLevel[level2] * ratio) -
    Math.round(totalExpToTheLevel[level1] * ratio)
  );
}

export function calcExpPerCandy(level: number, nature: ExpGainNature, boost: BoostEvent): number {
  const boostFactor = boostRules[boost].expMultiplier;

  // レベル帯で基礎値が変化（<25:35, <30:30, それ以外:25）
  const base =
    level < 25 ? (nature === "up" ? 41 : nature === "down" ? 29 : 35) :
      level < 30 ? (nature === "up" ? 35 : nature === "down" ? 25 : 30) :
        (nature === "up" ? 30 : nature === "down" ? 21 : 25);

  return base * boostFactor;
}

function shardRateForBoost(boost: BoostEvent): number {
  return boostRules[boost].shardMultiplier;
}

/**
 * 現在Lv→目標Lvまでに必要なEXP/アメ/かけらを計算
 * @param expGot 現在レベル内で既に得ているEXP（未入力なら0）
 */
export function calcExpAndCandy(params: {
  srcLevel: number;
  dstLevel: number;
  expType: ExpType;
  nature: ExpGainNature;
  boost: BoostEvent;
  expGot?: number;
}): CalcExpAndCandyResult {
  const { srcLevel, dstLevel, expType, nature, boost } = params;
  const expGot = params.expGot ?? 0;

  if (srcLevel < 0 || dstLevel < 0 || srcLevel >= dstLevel) {
    return { exp: 0, candy: 0, shards: 0 };
  }

  const exp = calcExp(srcLevel, dstLevel, expType) - expGot;
  const shardRate = shardRateForBoost(boost);

  let shards = 0;
  let candy = 0;
  let carry = expGot;

  for (let level = srcLevel; level < dstLevel; level++) {
    const requiredExp = calcExp(level, level + 1, expType) - carry;
    const expPerCandy = calcExpPerCandy(level, nature, boost);
    const requiredCandy = Math.ceil(requiredExp / expPerCandy);

    // dreamShardsPerCandy[level+1]
    shards += (dreamShardsPerCandy[level + 1] ?? 0) * requiredCandy * shardRate;
    candy += requiredCandy;

    carry = expPerCandy * requiredCandy - requiredExp;
  }

  return { exp, candy, shards };
}

/**
 * 通常アメ＋（ミニブ/アメブ）の混在で、目標Lvまでに必要な通常アメ数・かけらを計算
 *
 * 前提（MVP）:
 * - ブーストアメは「低レベル側から優先して」使う（かけら効率とEXP効率の両面で自然な戦略）
 * - 余ったブーストアメは未使用として返す
 *
 * @param boostCandy ブーストアメの投入予定数（0以上）。boost="none" の場合は無視される
 * @param expGot 現在レベル内で既に得ているEXP（未入力なら0）
 */
export function calcExpAndCandyMixed(params: {
  srcLevel: number;
  dstLevel: number;
  expType: ExpType;
  nature: ExpGainNature;
  boost: BoostEvent;
  boostCandy: number;
  expGot?: number;
}): CalcExpAndCandyMixedResult {
  const { srcLevel, dstLevel, expType, nature, boost } = params;
  const expGot = params.expGot ?? 0;
  const boostCandyBudget = Math.max(0, Math.floor(params.boostCandy));

  if (srcLevel < 0 || dstLevel < 0 || srcLevel >= dstLevel) {
    return {
      exp: 0,
      expNormalApplied: 0,
      expBoostApplied: 0,
      normalCandy: 0,
      boostCandy: 0,
      shards: 0,
      shardsNormal: 0,
      shardsBoost: 0,
      boostCandyLeft: boostCandyBudget,
    };
  }

  const exp = calcExp(srcLevel, dstLevel, expType) - expGot;

  let shardsNormal = 0;
  let shardsBoost = 0;
  let normalCandy = 0;
  let boostCandyUsed = 0;
  let expNormalApplied = 0;
  let expBoostApplied = 0;

  let carry = expGot;
  let boostLeft = boost === "none" ? 0 : boostCandyBudget;
  const boostShardRate = shardRateForBoost(boost);

  for (let level = srcLevel; level < dstLevel; level++) {
    let requiredExp = calcExp(level, level + 1, expType) - carry;
    if (requiredExp <= 0) {
      carry = -requiredExp;
      continue;
    }

    const expPerNormal = calcExpPerCandy(level, nature, "none");
    const expPerBoost = calcExpPerCandy(level, nature, boost);

    let useBoost = 0;
    if (boostLeft > 0) {
      useBoost = Math.min(boostLeft, Math.ceil(requiredExp / expPerBoost));
    }

    requiredExp -= expPerBoost * useBoost;
    expBoostApplied += expPerBoost * useBoost;

    let useNormal = 0;
    if (requiredExp <= 0) {
      carry = -requiredExp;
    } else {
      useNormal = Math.ceil(requiredExp / expPerNormal);
      carry = expPerNormal * useNormal - requiredExp;
    }
    expNormalApplied += expPerNormal * useNormal;

    const shardBase = dreamShardsPerCandy[level + 1] ?? 0;
    if (useNormal > 0) {
      shardsNormal += shardBase * useNormal;
      normalCandy += useNormal;
    }
    if (useBoost > 0) {
      shardsBoost += shardBase * useBoost * boostShardRate;
      boostCandyUsed += useBoost;
      boostLeft -= useBoost;
    }
  }

  const shards = shardsNormal + shardsBoost;
  return {
    exp,
    expNormalApplied,
    expBoostApplied,
    normalCandy,
    boostCandy: boostCandyUsed,
    shards,
    shardsNormal,
    shardsBoost,
    boostCandyLeft: boostLeft,
  };
}

export type CalcExpAndCandyByBoostExpRatioResult = CalcExpAndCandyMixedResult & {
  /** 入力した割合（0..1） */
  boostExpRatioTarget: number;
  /** 実際にアメブで入った経験値 / 必要EXP（0..1）。端数繰り上げ等でズレることがある */
  boostExpRatioActual: number;
};

/**
 * 「必要EXPに対するアメブ割合（0..1）」を指定して、必要通常アメ/アメブ個数/かけらを計算
 *
 * - アメブ（ミニブ/アメブ）は各レベルで「必要分を上限に」使う（レベルが上がれば次のアメは次Lvの係数になるため）
 * - 端数繰り上げの都合で、実際の割合はぴったりにはならない
 */
export function calcExpAndCandyByBoostExpRatio(params: {
  srcLevel: number;
  dstLevel: number;
  expType: ExpType;
  nature: ExpGainNature;
  boost: Exclude<BoostEvent, "none">;
  boostExpRatio: number; // 0..1
  expGot?: number;
}): CalcExpAndCandyByBoostExpRatioResult {
  const { srcLevel, dstLevel, expType, nature, boost } = params;
  const expGot = params.expGot ?? 0;

  const baseExp = calcExp(srcLevel, dstLevel, expType) - expGot;
  const ratio = Math.max(0, Math.min(1, Number.isFinite(params.boostExpRatio) ? params.boostExpRatio : 0));
  const targetBoostExp = baseExp * ratio;

  if (srcLevel < 0 || dstLevel < 0 || srcLevel >= dstLevel) {
    return {
      exp: 0,
      expNormalApplied: 0,
      expBoostApplied: 0,
      normalCandy: 0,
      boostCandy: 0,
      shards: 0,
      shardsNormal: 0,
      shardsBoost: 0,
      boostCandyLeft: 0,
      boostExpRatioTarget: ratio,
      boostExpRatioActual: 0,
    };
  }

  let shardsNormal = 0;
  let shardsBoost = 0;
  let normalCandy = 0;
  let boostCandyUsed = 0;
  let expNormalApplied = 0;
  let expBoostApplied = 0;

  let carry = expGot;
  const boostShardRate = shardRateForBoost(boost);

  for (let level = srcLevel; level < dstLevel; level++) {
    let requiredExp = calcExp(level, level + 1, expType) - carry;
    if (requiredExp <= 0) {
      carry = -requiredExp;
      continue;
    }

    const expPerNormal = calcExpPerCandy(level, nature, "none");
    const expPerBoost = calcExpPerCandy(level, nature, boost);

    // このレベルで最大何個までブーストアメを使えるか（=ブーストだけで次Lvへ行くのに必要な個数）
    const maxBoostCandyThisLevel = Math.ceil(requiredExp / expPerBoost);
    const boostExpLeft = Math.max(0, targetBoostExp - expBoostApplied);
    const wantBoostCandy = boostExpLeft <= 0 ? 0 : Math.ceil(boostExpLeft / expPerBoost);
    const useBoost = Math.max(0, Math.min(maxBoostCandyThisLevel, wantBoostCandy));

    requiredExp -= expPerBoost * useBoost;
    expBoostApplied += expPerBoost * useBoost;

    let useNormal = 0;
    if (requiredExp <= 0) {
      carry = -requiredExp;
    } else {
      useNormal = Math.ceil(requiredExp / expPerNormal);
      carry = expPerNormal * useNormal - requiredExp;
    }
    expNormalApplied += expPerNormal * useNormal;

    const shardBase = dreamShardsPerCandy[level + 1] ?? 0;
    if (useNormal > 0) {
      shardsNormal += shardBase * useNormal;
      normalCandy += useNormal;
    }
    if (useBoost > 0) {
      shardsBoost += shardBase * useBoost * boostShardRate;
      boostCandyUsed += useBoost;
    }
  }

  const shards = shardsNormal + shardsBoost;
  const boostExpRatioActual = baseExp > 0 ? Math.max(0, Math.min(1, expBoostApplied / baseExp)) : 0;

  return {
    exp: baseExp,
    expNormalApplied,
    expBoostApplied,
    normalCandy,
    boostCandy: boostCandyUsed,
    shards,
    shardsNormal,
    shardsBoost,
    boostCandyLeft: 0,
    boostExpRatioTarget: ratio,
    boostExpRatioActual,
  };
}

/**
 * 手持ちアメ数でどこまで上げられるか
 * @param expGot 現在レベル内で既に得ているEXP（未入力なら0）
 */
export function calcLevelByCandy(params: {
  srcLevel: number;
  dstLevel: number;
  expType: ExpType;
  nature: ExpGainNature;
  boost: BoostEvent;
  candy: number;
  expGot?: number;
}): CalcLevelByCandyResult {
  const { srcLevel, dstLevel, expType, nature, boost } = params;
  const expGot = params.expGot ?? 0;

  const exp = calcExp(srcLevel, dstLevel, expType) - expGot;
  let expLeft = exp;

  const shardRate = shardRateForBoost(boost);
  let shards = 0;
  let carry = expGot;
  let candyLeft = Math.max(0, Math.floor(params.candy));
  let level = srcLevel;

  for (level = srcLevel; level < dstLevel; level++) {
    const requiredExp = calcExp(level, level + 1, expType) - carry;
    const expPerCandy = calcExpPerCandy(level, nature, boost);
    const requiredCandy = Math.ceil(requiredExp / expPerCandy);

    const candyToUse = Math.min(requiredCandy, candyLeft);
    shards += (dreamShardsPerCandy[level + 1] ?? 0) * candyToUse * shardRate;

    candyLeft -= candyToUse;
    expLeft -= expPerCandy * candyToUse;

    if (candyToUse < requiredCandy) {
      carry += expPerCandy * candyToUse;
      break;
    }

    carry = expPerCandy * candyToUse - requiredExp;
  }

  const candyUsed = Math.max(0, Math.floor(params.candy)) - candyLeft;
  return { exp, expLeft, level, expGot: carry, shards, candyUsed, candyLeft };
}
