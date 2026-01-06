import type { BoostEvent, ExpGainNature, ExpType } from "../types";
import { boostRules } from "./boost-config";
import { dreamShardsPerCandy, totalExpToTheLevel, totalExpToTheLevel900, totalExpToTheLevel1080, totalExpToTheLevel1320 } from "./tables";

/**
 * nitoyon/pokesleep-tool の Exp.ts を参照し、Planner用に依存を外して純関数化したもの。
 *
 * 参照（謝辞）:
 * - https://github.com/nitoyon/pokesleep-tool
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
  /** 目標Lvに到達した時点での、次レベルまでの残りEXP（あとEXP） */
  expLeftNext: number;
};

export function calcExp(level1: number, level2: number, expType: ExpType): number {
  if (level1 < 0 || level2 < 0) return 0;
  if (level1 >= totalExpToTheLevel.length) return 0;
  if (level2 >= totalExpToTheLevel.length) return 0;

  // ExpType 900, 1080, 1320は専用テーブルを使用（Lv50以降で丸め誤差があるため）
  if (expType === 900) {
    return totalExpToTheLevel900[level2] - totalExpToTheLevel900[level1];
  }
  if (expType === 1080) {
    return totalExpToTheLevel1080[level2] - totalExpToTheLevel1080[level1];
  }
  if (expType === 1320) {
    return totalExpToTheLevel1320[level2] - totalExpToTheLevel1320[level1];
  }

  // ExpType 600は基準テーブルをそのまま使用
  return totalExpToTheLevel[level2] - totalExpToTheLevel[level1];
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
 * 目標Lv到達後に残りアメを使用して、レベル内のEXP（expInLevel）とかけらを計算する
 *
 * @param level 現在の到達Lv
 * @param dstLevel 目標Lv
 * @param nature EXP性格補正
 * @param boost ブーストタイプ
 * @param candyLeft 残りアメ数
 * @param currentExpInLevel 現在のexpInLevel
 * @param currentShards 現在のかけら
 * @param shardsLimit かけら上限（undefined なら無制限）
 * @returns 更新された expInLevel, shards, 使用したアメ数
 */
function calcExpInLevel(params: {
  level: number;
  dstLevel: number;
  nature: ExpGainNature;
  boost: BoostEvent;
  candyLeft: number;
  currentExpInLevel: number;
  currentShards: number;
  shardsLimit?: number;
}): {
  expInLevel: number;
  shards: number;
  candyUsed: number;
} {
  const { level, dstLevel, nature, boost, candyLeft, currentExpInLevel, currentShards, shardsLimit } = params;

  // 目標Lv未達または余剰アメなし
  if (level < dstLevel || candyLeft <= 0) {
    return { expInLevel: currentExpInLevel, shards: currentShards, candyUsed: 0 };
  }

  const expPerCandy = calcExpPerCandy(dstLevel, nature, boost);
  const shardBase = dreamShardsPerCandy[dstLevel + 1] ?? 0;
  const shardRate = shardRateForBoost(boost);
  const shardsPerCandy = shardBase * shardRate;

  // かけら上限がある場合
  if (shardsLimit !== undefined && shardsPerCandy > 0) {
    const shardsAvailable = Math.max(0, shardsLimit - currentShards);
    const candyWithinLimit = Math.floor(shardsAvailable / shardsPerCandy);
    const actualCandyUsed = Math.min(candyWithinLimit, candyLeft);

    if (actualCandyUsed > 0) {
      return {
        expInLevel: currentExpInLevel + expPerCandy * actualCandyUsed,
        shards: currentShards + shardsPerCandy * actualCandyUsed,
        candyUsed: actualCandyUsed,
      };
    }
    return { expInLevel: currentExpInLevel, shards: currentShards, candyUsed: 0 };
  }

  // かけら無制限
  return {
    expInLevel: currentExpInLevel + expPerCandy * candyLeft,
    shards: currentShards + shardsPerCandy * candyLeft,
    candyUsed: candyLeft,
  };
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
      expLeftNext: srcLevel < dstLevel ? 0 : Math.max(0, calcExp(srcLevel, srcLevel + 1, expType) - expGot),
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

  // ループ終了後、まだブーストアメ指定数が余っていれば、dstLevelにおいてさらに投入する（レベルは上げないがEXP・かけらは加算）
  if (boostLeft > 0) {
    const expPerBoost = calcExpPerCandy(dstLevel, nature, boost);
    const useBoost = boostLeft;

    carry += expPerBoost * useBoost;

    const shardBase = dreamShardsPerCandy[dstLevel + 1] ?? 0;
    shardsBoost += shardBase * useBoost * boostShardRate;

    boostCandyUsed += useBoost;
    boostLeft = 0;
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
    expLeftNext: Math.max(0, calcExp(dstLevel, dstLevel + 1, expType) - carry),
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
      expLeftNext: srcLevel < dstLevel ? 0 : Math.max(0, calcExp(srcLevel, srcLevel + 1, expType) - expGot),
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
    expLeftNext: Math.max(0, calcExp(dstLevel, dstLevel + 1, expType) - carry),
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

  // 目標Lv到達後、余ったアメがあればdstLevelで使用してかけらを追加
  // （calcExpAndCandyMixedと同じ動作にする）
  const surplusResult = calcExpInLevel({
    level,
    dstLevel,
    nature,
    boost,
    candyLeft,
    currentExpInLevel: carry,
    currentShards: shards,
    shardsLimit: undefined,  // かけら無制限
  });
  shards = surplusResult.shards;
  carry = surplusResult.expInLevel;

  const candyUsed = Math.max(0, Math.floor(params.candy)) - (level >= dstLevel ? 0 : candyLeft);
  return { exp, expLeft, level, expGot: carry, shards, candyUsed, candyLeft: level >= dstLevel ? 0 : candyLeft };
}

/**
 * 手持ちアメ数とかけら上限の両方を考慮してどこまで上げられるか
 * アメが足りてもかけらが足りなければ、かけら上限で到達Lvが制限される
 * @param shardsLimit 使用可能なかけら上限（これを超えるとストップ）
 */
export function calcLevelByCandyAndShards(params: {
  srcLevel: number;
  dstLevel: number;
  expType: ExpType;
  nature: ExpGainNature;
  boost: BoostEvent;
  candy: number;
  shardsLimit: number;
  expGot?: number;
}): CalcLevelByCandyResult {
  const { srcLevel, dstLevel, expType, nature, boost, shardsLimit } = params;
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
    const shardsPerCandy = (dreamShardsPerCandy[level + 1] ?? 0) * shardRate;
    const shardsForThisLevel = shardsPerCandy * candyToUse;

    // かけら上限チェック
    if (shards + shardsForThisLevel > shardsLimit) {
      // このレベルに全部投入すると上限を超える → 上限内で使えるアメを計算
      const shardsAvailable = shardsLimit - shards;

      if (shardsPerCandy > 0 && shardsAvailable > 0) {
        // 上限内で使えるアメ数を計算
        const candyWithinLimit = Math.floor(shardsAvailable / shardsPerCandy);
        const actualCandyUsed = Math.min(candyWithinLimit, candyToUse);

        if (actualCandyUsed > 0) {
          const actualShards = shardsPerCandy * actualCandyUsed;
          shards += actualShards;
          candyLeft -= actualCandyUsed;
          expLeft -= expPerCandy * actualCandyUsed;
          carry += expPerCandy * actualCandyUsed;
        }
      }
      break;  // これ以上はかけら不足
    }

    shards += shardsForThisLevel;
    candyLeft -= candyToUse;
    expLeft -= expPerCandy * candyToUse;

    if (candyToUse < requiredCandy) {
      // アメ不足で途中終了
      carry += expPerCandy * candyToUse;
      break;
    }

    carry = expPerCandy * candyToUse - requiredExp;
  }

  // 目標Lv到達後、余ったアメがあればdstLevelで使用してかけらを追加
  // （calcLevelByCandyと同じ動作にする）
  const surplusResult = calcExpInLevel({
    level,
    dstLevel,
    nature,
    boost,
    candyLeft,
    currentExpInLevel: carry,
    currentShards: shards,
    shardsLimit,  // かけら制限あり
  });
  shards = surplusResult.shards;
  carry = surplusResult.expInLevel;
  candyLeft -= surplusResult.candyUsed;

  const candyUsed = Math.max(0, Math.floor(params.candy)) - candyLeft;
  return { exp, expLeft, level, expGot: carry, shards, candyUsed, candyLeft };
}

/**
 * Phase 5用: Lvまでのアメとかけらを計算（アメブ割合を考慮、余りアメは使わない）
 * calcExpAndCandyMixedと似ているが、「余ったアメをdstLevelで使用」しない
 *
 * @param boostCandyLimit アメブの上限（この範囲内で使用）
 * @returns Lvアップに必要なアメとかけらのみ
 */
export function calcCandyAndShardsForLevelMixed(params: {
  srcLevel: number;
  dstLevel: number;
  expType: ExpType;
  nature: ExpGainNature;
  boost: BoostEvent;
  boostCandyLimit: number;
  expGot?: number;
}): {
  shards: number;
  boostCandy: number;
  normalCandy: number;
  expGot: number;
} {
  const { srcLevel, dstLevel, expType, nature, boost } = params;
  const expGot = params.expGot ?? 0;
  const boostCandyBudget = Math.max(0, Math.floor(params.boostCandyLimit));

  if (srcLevel < 0 || dstLevel < 0 || srcLevel >= dstLevel) {
    return {
      shards: 0,
      boostCandy: 0,
      normalCandy: 0,
      expGot,
    };
  }

  let shardsNormal = 0;
  let shardsBoost = 0;
  let normalCandy = 0;
  let boostCandyUsed = 0;

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

    let useNormal = 0;
    if (requiredExp <= 0) {
      carry = -requiredExp;
    } else {
      useNormal = Math.ceil(requiredExp / expPerNormal);
      carry = expPerNormal * useNormal - requiredExp;
    }

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

  // 余ったアメは使わない（calcExpAndCandyMixedとの違い）

  return {
    shards: shardsNormal + shardsBoost,
    boostCandy: boostCandyUsed,
    normalCandy,
    expGot: carry,
  };
}
