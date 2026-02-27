import type { BoostEvent, ExpGainNature, ExpType } from "../types";
import { boostRules } from "./boost-config";
import { dreamShardsPerCandy, totalExpToTheLevel, totalExpToTheLevel900, totalExpToTheLevel1080, totalExpToTheLevel1320, maxLevel } from "./tables";

/**
 * nitoyon/pokesleep-tool の Exp.ts を参照し、Planner用に依存を外して純関数化したもの。
 *
 * 参照（謝辞）:
 * - https://github.com/nitoyon/pokesleep-tool
 */

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
  /** 目標Lv内で獲得したEXP（carry） */
  expInLevel: number;
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
 * 早期リターン用のゼロ結果オブジェクトを生成
 * （目標到達済み or 無効入力時に使用）
 */
function zeroMixedResult(
  srcLevel: number,
  expType: ExpType,
  expGot: number,
  boostCandyLeft: number
): CalcExpAndCandyMixedResult {
  return {
    exp: 0,
    expNormalApplied: 0,
    expBoostApplied: 0,
    normalCandy: 0,
    boostCandy: 0,
    shards: 0,
    shardsNormal: 0,
    shardsBoost: 0,
    boostCandyLeft,
    expLeftNext: Math.max(0, calcExp(srcLevel, srcLevel + 1, expType) - expGot),
    expInLevel: expGot,
  };
}

/** レベルが無効（負の値）かどうか */
function isInvalidLevel(srcLevel: number, dstLevel: number): boolean {
  return srcLevel < 0 || dstLevel < 0;
}

/** 目標（Lv+EXP）に到達済みかどうか */
function isTargetReached(
  srcLevel: number,
  dstLevel: number,
  expGot: number,
  dstExpInLevel: number
): boolean {
  return srcLevel > dstLevel || (srcLevel === dstLevel && expGot >= dstExpInLevel);
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
 * 現在Lv→目標Lv+EXPまでに必要なEXP/アメ/かけらを計算
 * @param expGot 現在レベル内で既に得ているEXP（未入力なら0）
 * @param dstExpInLevel 目標Lv内のEXP（未入力なら0: ちょうどdstLevelに到達）
 */
export function calcExpAndCandy(params: {
  srcLevel: number;
  dstLevel: number;
  dstExpInLevel?: number;
  expType: ExpType;
  nature: ExpGainNature;
  boost: BoostEvent;
  expGot?: number;
}): CalcExpAndCandyResult {
  const { srcLevel, dstLevel, expType, nature, boost } = params;
  const expGot = params.expGot ?? 0;
  // Lv65（最大レベル）ではこれ以上EXPを稼げないため、dstExpInLevelを0に制限
  const dstExpInLevel = dstLevel >= maxLevel ? 0 : (params.dstExpInLevel ?? 0);

  // Lv+EXP で比較（目標到達済みなら何もしない）
  if (isInvalidLevel(srcLevel, dstLevel) || isTargetReached(srcLevel, dstLevel, expGot, dstExpInLevel)) {
    return { exp: 0, candy: 0, shards: 0 };
  }

  // 必要EXP = (srcLevel→dstLevel のEXP) + dstExpInLevel - expGot
  const exp = calcExp(srcLevel, dstLevel, expType) + dstExpInLevel - expGot;
  const shardRate = shardRateForBoost(boost);

  let shards = 0;
  let candy = 0;
  let carry = expGot;

  // srcLevel → dstLevel までのレベルアップ
  for (let level = srcLevel; level < dstLevel; level++) {
    const requiredExp = calcExp(level, level + 1, expType) - carry;
    const expPerCandy = calcExpPerCandy(level, nature, boost);
    const requiredCandy = Math.ceil(requiredExp / expPerCandy);

    shards += (dreamShardsPerCandy[level + 1] ?? 0) * requiredCandy * shardRate;
    candy += requiredCandy;

    carry = expPerCandy * requiredCandy - requiredExp;
  }

  // dstLevel 内で dstExpInLevel まで追加EXPが必要な場合
  if (dstExpInLevel > 0 && carry < dstExpInLevel) {
    const expPerCandy = calcExpPerCandy(dstLevel, nature, boost);
    const additionalExp = dstExpInLevel - carry;
    const additionalCandy = Math.ceil(additionalExp / expPerCandy);

    shards += (dreamShardsPerCandy[dstLevel + 1] ?? 0) * additionalCandy * shardRate;
    candy += additionalCandy;
  }

  return { exp, candy, shards };
}

/**
 * 通常アメ＋（ミニブ/アメブ）の混在で、目標Lv+EXPまでに必要な通常アメ数・かけらを計算
 *
 * 前提（MVP）:
 * - ブーストアメは「低レベル側から優先して」使う（かけら効率とEXP効率の両面で自然な戦略）
 * - 余ったブーストアメは未使用として返す
 *
 * @param boostCandy ブーストアメの投入予定数（0以上）。boost="none" の場合は無視される
 * @param expGot 現在レベル内で既に得ているEXP（未入力なら0）
 * @param dstExpInLevel 目標Lv内のEXP（未入力なら0: ちょうどdstLevelに到達）
 */
export function calcExpAndCandyMixed(params: {
  srcLevel: number;
  dstLevel: number;
  dstExpInLevel?: number;
  expType: ExpType;
  nature: ExpGainNature;
  boost: BoostEvent;
  boostCandy: number;
  expGot?: number;
}): CalcExpAndCandyMixedResult {
  const { srcLevel, dstLevel, expType, nature, boost } = params;
  const expGot = params.expGot ?? 0;
  // Lv65（最大レベル）ではこれ以上EXPを稼げないため、dstExpInLevelを0に制限
  const dstExpInLevel = dstLevel >= maxLevel ? 0 : (params.dstExpInLevel ?? 0);
  const boostCandyBudget = Math.max(0, Math.floor(params.boostCandy));

  // Lv+EXP で比較（目標到達済みなら何もしない）
  if (isInvalidLevel(srcLevel, dstLevel) || isTargetReached(srcLevel, dstLevel, expGot, dstExpInLevel)) {
    return zeroMixedResult(srcLevel, expType, expGot, boostCandyBudget);
  }

  // 必要EXP = (srcLevel→dstLevel のEXP) + dstExpInLevel - expGot
  const exp = calcExp(srcLevel, dstLevel, expType) + dstExpInLevel - expGot;

  let shardsNormal = 0;
  let shardsBoost = 0;
  let normalCandy = 0;
  let boostCandyUsed = 0;
  let expNormalApplied = 0;
  let expBoostApplied = 0;

  let carry = expGot;
  let boostLeft = boost === "none" ? 0 : boostCandyBudget;
  const boostShardRate = shardRateForBoost(boost);

  // srcLevel → dstLevel までのレベルアップ
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

  // dstLevel 内で dstExpInLevel まで追加EXPが必要な場合
  if (dstExpInLevel > 0 && carry < dstExpInLevel) {
    const additionalExp = dstExpInLevel - carry;
    const shardBase = dreamShardsPerCandy[dstLevel + 1] ?? 0;

    // まずブーストアメで埋める
    if (boostLeft > 0 && boost !== "none") {
      const expPerBoost = calcExpPerCandy(dstLevel, nature, boost);
      const useBoost = Math.min(boostLeft, Math.ceil(additionalExp / expPerBoost));
      const boostExp = expPerBoost * useBoost;

      expBoostApplied += boostExp;
      shardsBoost += shardBase * useBoost * boostShardRate;
      boostCandyUsed += useBoost;
      boostLeft -= useBoost;
      carry += boostExp;
    }

    // まだ足りなければ通常アメで埋める
    if (carry < dstExpInLevel) {
      const expPerNormal = calcExpPerCandy(dstLevel, nature, "none");
      const remainingExp = dstExpInLevel - carry;
      const useNormal = Math.ceil(remainingExp / expPerNormal);

      expNormalApplied += expPerNormal * useNormal;
      shardsNormal += shardBase * useNormal;
      normalCandy += useNormal;
      carry += expPerNormal * useNormal;
    }
  }

  // ループ終了後、まだブーストアメ指定数が余っていれば、dstLevelにおいてさらに投入する
  // （レベルは上げないがEXP・かけらは加算）
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
    expInLevel: carry,
  };
}

/**
 * 手持ちアメ数でどこまで上げられるか
 * @param expGot 現在レベル内で既に得ているEXP（未入力なら0）
 * @param dstExpInLevel 目標Lv内のEXP上限（未入力なら0: dstLevelに到達したら終了）
 */
export function calcLevelByCandy(params: {
  srcLevel: number;
  dstLevel: number;
  dstExpInLevel?: number;
  expType: ExpType;
  nature: ExpGainNature;
  boost: BoostEvent;
  candy: number;
  expGot?: number;
}): CalcLevelByCandyResult {
  const { srcLevel, dstLevel, expType, nature, boost } = params;
  const expGot = params.expGot ?? 0;
  const dstExpInLevel = params.dstExpInLevel ?? 0;

  // 必要EXP = (srcLevel→dstLevel のEXP) + dstExpInLevel - expGot
  const exp = calcExp(srcLevel, dstLevel, expType) + dstExpInLevel - expGot;
  let expLeft = exp;

  const shardRate = shardRateForBoost(boost);
  let shards = 0;
  let carry = expGot;
  let candyLeft = Math.max(0, Math.floor(params.candy));
  let level: number;

  // srcLevel → dstLevel までのレベルアップ
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

  // dstLevel に到達した場合、余ったアメを dstExpInLevel まで使用
  if (level >= dstLevel && candyLeft > 0) {
    const expPerCandy = calcExpPerCandy(dstLevel, nature, boost);
    const shardBase = dreamShardsPerCandy[dstLevel + 1] ?? 0;

    if (dstExpInLevel > 0 && carry < dstExpInLevel) {
      // dstExpInLevel まで追加EXPが必要
      const additionalExp = dstExpInLevel - carry;
      const requiredCandy = Math.ceil(additionalExp / expPerCandy);
      const candyToUse = Math.min(requiredCandy, candyLeft);

      shards += shardBase * candyToUse * shardRate;
      carry += expPerCandy * candyToUse;
      candyLeft -= candyToUse;
      expLeft -= expPerCandy * candyToUse;
    } else if (dstExpInLevel === 0) {
      // dstExpInLevel が 0 の場合は従来通り余ったアメを全部使用
      const surplusResult = calcExpInLevel({
        level,
        dstLevel,
        nature,
        boost,
        candyLeft,
        currentExpInLevel: carry,
        currentShards: shards,
        shardsLimit: undefined,
      });
      shards = surplusResult.shards;
      carry = surplusResult.expInLevel;
      candyLeft -= surplusResult.candyUsed;
    }
  }

  const candyUsed = Math.max(0, Math.floor(params.candy)) - candyLeft;
  // Lv65（最大レベル）到達後はこれ以上EXPを稼げないため、expGotを0に制限
  const finalExpGot = level >= maxLevel ? 0 : carry;
  return { exp, expLeft, level, expGot: finalExpGot, shards, candyUsed, candyLeft };
}

/**
 * 手持ちアメ数とかけら上限の両方を考慮してどこまで上げられるか
 * アメが足りてもかけらが足りなければ、かけら上限で到達Lvが制限される
 * @param shardsLimit 使用可能なかけら上限（これを超えるとストップ）
 * @param dstExpInLevel 目標Lv内のEXP上限（未入力なら0: dstLevelに到達したら終了）
 */
export function calcLevelByCandyAndShards(params: {
  srcLevel: number;
  dstLevel: number;
  dstExpInLevel?: number;
  expType: ExpType;
  nature: ExpGainNature;
  boost: BoostEvent;
  candy: number;
  shardsLimit: number;
  expGot?: number;
}): CalcLevelByCandyResult {
  const { srcLevel, dstLevel, expType, nature, boost, shardsLimit } = params;
  const expGot = params.expGot ?? 0;
  const dstExpInLevel = params.dstExpInLevel ?? 0;

  // 必要EXP = (srcLevel→dstLevel のEXP) + dstExpInLevel - expGot
  const exp = calcExp(srcLevel, dstLevel, expType) + dstExpInLevel - expGot;
  let expLeft = exp;

  const shardRate = shardRateForBoost(boost);
  let shards = 0;
  let carry = expGot;
  let candyLeft = Math.max(0, Math.floor(params.candy));
  let level: number;

  // srcLevel → dstLevel までのレベルアップ
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

  // dstLevel に到達した場合、余ったアメを dstExpInLevel まで使用（かけら上限も考慮）
  if (level >= dstLevel && candyLeft > 0 && shards < shardsLimit) {
    const expPerCandy = calcExpPerCandy(dstLevel, nature, boost);
    const shardBase = dreamShardsPerCandy[dstLevel + 1] ?? 0;
    const shardsPerCandy = shardBase * shardRate;

    if (dstExpInLevel > 0 && carry < dstExpInLevel) {
      // dstExpInLevel まで追加EXPが必要
      const additionalExp = dstExpInLevel - carry;
      const requiredCandy = Math.ceil(additionalExp / expPerCandy);

      // かけら上限も考慮
      const shardsAvailable = shardsLimit - shards;
      const candyWithinShardsLimit = shardsPerCandy > 0
        ? Math.floor(shardsAvailable / shardsPerCandy)
        : candyLeft;

      const candyToUse = Math.min(requiredCandy, candyLeft, candyWithinShardsLimit);

      if (candyToUse > 0) {
        shards += shardsPerCandy * candyToUse;
        carry += expPerCandy * candyToUse;
        candyLeft -= candyToUse;
        expLeft -= expPerCandy * candyToUse;
      }
    } else if (dstExpInLevel === 0) {
      // dstExpInLevel が 0 の場合は従来通り余ったアメをかけら上限まで使用
      const surplusResult = calcExpInLevel({
        level,
        dstLevel,
        nature,
        boost,
        candyLeft,
        currentExpInLevel: carry,
        currentShards: shards,
        shardsLimit,
      });
      shards = surplusResult.shards;
      carry = surplusResult.expInLevel;
      candyLeft -= surplusResult.candyUsed;
    }
  }

  const candyUsed = Math.max(0, Math.floor(params.candy)) - candyLeft;
  // Lv65（最大レベル）到達後はこれ以上EXPを稼げないため、expGotを0に制限
  const finalExpGot = level >= maxLevel ? 0 : carry;
  return { exp, expLeft, level, expGot: finalExpGot, shards, candyUsed, candyLeft };
}

/**
 * Phase 5用: Lv+EXPまでのアメとかけらを計算（アメブ割合を考慮、余りアメは使わない）
 * calcExpAndCandyMixedと似ているが、「余ったアメをdstLevelで使用」しない
 *
 * @param boostCandyLimit アメブの上限（この範囲内で使用）
 * @param dstExpInLevel 目標Lv内のEXP（未入力なら0: ちょうどdstLevelに到達）
 * @returns Lvアップに必要なアメとかけらのみ
 */
export function calcCandyAndShardsForLevelMixed(params: {
  srcLevel: number;
  dstLevel: number;
  dstExpInLevel?: number;
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
  // Lv65（最大レベル）ではこれ以上EXPを稼げないため、dstExpInLevelを0に制限
  const dstExpInLevel = dstLevel >= maxLevel ? 0 : (params.dstExpInLevel ?? 0);
  const boostCandyBudget = Math.max(0, Math.floor(params.boostCandyLimit));

  // Lv+EXP で比較（目標到達済みなら何もしない）
  if (srcLevel < 0 || dstLevel < 0) {
    return {
      shards: 0,
      boostCandy: 0,
      normalCandy: 0,
      expGot,
    };
  }
  if (srcLevel > dstLevel || (srcLevel === dstLevel && expGot >= dstExpInLevel)) {
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

  // srcLevel → dstLevel までのレベルアップ
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

  // dstLevel 内で dstExpInLevel まで追加EXPが必要な場合
  if (dstExpInLevel > 0 && carry < dstExpInLevel) {
    const additionalExp = dstExpInLevel - carry;
    const shardBase = dreamShardsPerCandy[dstLevel + 1] ?? 0;

    // まずブーストアメで埋める
    if (boostLeft > 0 && boost !== "none") {
      const expPerBoost = calcExpPerCandy(dstLevel, nature, boost);
      const useBoost = Math.min(boostLeft, Math.ceil(additionalExp / expPerBoost));
      const boostExp = expPerBoost * useBoost;

      shardsBoost += shardBase * useBoost * boostShardRate;
      boostCandyUsed += useBoost;
      carry += boostExp;
    }

    // まだ足りなければ通常アメで埋める
    if (carry < dstExpInLevel) {
      const expPerNormal = calcExpPerCandy(dstLevel, nature, "none");
      const remainingExp = dstExpInLevel - carry;
      const useNormal = Math.ceil(remainingExp / expPerNormal);

      shardsNormal += shardBase * useNormal;
      normalCandy += useNormal;
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
