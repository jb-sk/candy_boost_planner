/**
 * LevelPlanner - Phase 1: 配分と制約適用
 *
 * 新フェーズ設計:
 * - 各ポケモンを上位から順番に処理し、1匹ずつ完結させる
 * - スナップショットから理論値（目標まで行、個数指定行）を計算
 * - 同時に制約を適用して実使用を決定
 * - 実使用分のみ在庫を消費
 *
 * Phase 1 の処理ステップ（ポケモンごと）:
 * ① スナップショット保存
 * ② 目標まで行を計算（スナップショットから）
 * ③ 個数指定行を計算（candyTarget がある場合のみ）
 * ④ 制約適用 → 到達Lv+EXP・実使用を決定
 * ⑤ 不足確定
 * ⑥ 実使用分の在庫を消費
 */

import type {
  PhaseState,
  PlanContext,
  PokemonWorkingState,
  ItemUsage,
  CandyInventory,
  BoostKind,
  ShortageType,
  ShortageInfo,
  ConstraintDiagnosis,
  ReachableInfo,
  ResourceSnapshot,
} from '../types';
import type { ExpType, ExpGainNature } from '../../types';
import { CANDY_VALUES, calcItemValue } from '../constants';
import {
  createEmptyItemUsage,
  cloneInventory,
  consumeSpeciesCandy,
  consumeTypeCandy,
  consumeUniversalCandy,
} from '../context';
import { findBestItemAllocation } from '../helpers/item-finder';
import {
  calcLevelByCandy,
  calcLevelByCandyAndShards,
  calcExpAndCandyMixed,
  calcExp,
} from '../../pokesleep/exp';

// ============================================================
// 定数
// ============================================================

/** レベル上限 */
const MAX_LEVEL = 65;

// ============================================================
// 型定義
// ============================================================

/**
 * 制約計算に必要な入力（ポケモン非依存）
 */
type ConstraintInput = {
  srcLevel: number;
  dstLevel: number;
  expType: ExpType;
  nature: ExpGainNature;
  expGot: number;
};

/**
 * 独立した制約計算結果
 */
type IndependentConstraintResult = {
  /** 到達Lv */
  level: number;
  /** 到達Lv内のEXP */
  expInLevel: number;
  /** この制約による独立した不足量 */
  shortage: number;
  /** 使用したアメ価値（合計） */
  candyUsed: number;
  /** 使用したかけら */
  shardsUsed: number;
  /** 使用したアメブ個数 */
  boostCandyUsed: number;
  /** 使用した通常アメ個数 */
  normalCandyUsed: number;
};

/**
 * 制約診断結果（拡張版）
 */
type ConstraintDiagnosisResult = {
  /** 在庫制限のみの結果 */
  byInventory: IndependentConstraintResult;
  /** アメブ制限のみの結果 */
  byBoostLimit: IndependentConstraintResult;
  /** かけら制限のみの結果 */
  byShardsLimit: IndependentConstraintResult;

  /** 最終到達Lv */
  finalLevel: number;
  /** 最終到達Lv内のEXP */
  finalExpInLevel: number;
  /** 主要な制限要因 */
  limitingFactor: ShortageType | null;

  /** 独立した不足フラグ */
  isInventoryShortage: boolean;
  isBoostShortage: boolean;
  isShardsShortage: boolean;
};
/**
 * 目標行の情報
 */
type TargetRowInfo = {
  /** 目標アメブ */
  boostValue: number;
  /** 目標通常アメ */
  normalValue: number;
  /** 期待到達Lv */
  expectedLevel: number;
  /** 期待到達Lv内のEXP */
  expectedExpInLevel: number;
  /** 目標かけら */
  shardsValue: number;
  /** アイテム詳細 */
  items: ItemUsage;
};

// ============================================================
// メインエントリポイント
// ============================================================

/**
 * Phase 1: 配分と制約適用
 *
 * @param state 現在のPhase状態
 * @param context 計画コンテキスト
 * @returns 更新されたPhase状態
 */
export function applyPhase1Allocate(
  state: PhaseState,
  context: PlanContext
): PhaseState {
  let boostRemaining = state.boostRemaining;
  let shardsRemaining = state.shardsRemaining;
  const boostKind = context.config.boostKind;

  // 在庫をクローン（各ポケモンの処理で消費される）
  const workingInventory = cloneInventory(state.inventory);

  const newPokemons: PokemonWorkingState[] = [];

  for (const pokemon of state.pokemons) {
    // ─────────────────────────────────────────
    // ① スナップショット保存
    // ─────────────────────────────────────────
    const resourceSnapshot = captureResourceSnapshot(
      pokemon,
      workingInventory,
      boostRemaining,
      shardsRemaining
    );

    // ─────────────────────────────────────────
    // ② 目標まで行を計算（スナップショットから）
    // ─────────────────────────────────────────
    const targetRowInfo = calcTargetRowInfo(
      pokemon,
      boostKind,
      workingInventory
    );

    // ─────────────────────────────────────────
    // ③ 個数指定行を計算（candyTarget がある場合のみ）
    // ─────────────────────────────────────────
    let candyTargetRowInfo: TargetRowInfo | undefined;
    if (pokemon.candyTarget !== undefined) {
      candyTargetRowInfo = calcCandyTargetRowInfo(
        pokemon,
        boostKind,
        workingInventory
      );
    }

    // 不足計算の基準となる目標行を決定
    const targetForConstraint = candyTargetRowInfo ?? targetRowInfo;

    // ─────────────────────────────────────────
    // ④ 制約適用 → 到達Lv+EXP・実使用を決定
    // ─────────────────────────────────────────
    const constraintInput: ConstraintInput = {
      srcLevel: pokemon.srcLevel,
      dstLevel: pokemon.dstLevel,
      expType: pokemon.expType,
      nature: pokemon.nature,
      expGot: pokemon.expGot,
    };

    const diagnosisResult = calcConstraintsAndSelectFinalLevelAndExp(
      constraintInput,
      targetForConstraint,
      resourceSnapshot,
      boostKind
    );

    // ─────────────────────────────────────────
    // ⑤ 不足確定
    // ─────────────────────────────────────────
    const shortage = buildShortageInfo(diagnosisResult);

    // 独立した不足フラグを計算
    const byInv = toReachableInfo(diagnosisResult.byInventory);
    const byBoost = toReachableInfo(diagnosisResult.byBoostLimit);
    const byShards = toReachableInfo(diagnosisResult.byShardsLimit);

    const isInventoryShortage = byInv.level < pokemon.dstLevel;
    const isBoostShortage = byBoost.level < byInv.level
      || (byBoost.level === byInv.level && byBoost.expInLevel < byInv.expInLevel);
    const isShardsShortage = byShards.level < byBoost.level
      || (byShards.level === byBoost.level && byShards.expInLevel < byBoost.expInLevel);

    const diagnosis: ConstraintDiagnosis = {
      byInventory: byInv,
      byBoostLimit: byBoost,
      byShardsLimit: byShards,
      limitingFactor: diagnosisResult.limitingFactor,
      isInventoryShortage,
      isBoostShortage,
      isShardsShortage,
    };

    // EXP計算
    const expToNextLevel = calcRemainingExpInLevel(
      diagnosisResult.finalLevel,
      diagnosisResult.finalExpInLevel,
      pokemon.expType
    );
    const expToTarget = calcRemainingExpToTarget(
      diagnosisResult.finalLevel,
      diagnosisResult.finalExpInLevel,
      pokemon.dstLevel,
      pokemon.expType
    );

    // ─────────────────────────────────────────
    // 到達可能行のアイテム配分を計算
    // ─────────────────────────────────────────
    const reachableItems = calcReachableItems(
      pokemon,
      diagnosisResult,
      boostKind,
      workingInventory,
      resourceSnapshot,
      targetForConstraint  // 目標行の情報を渡す
    );

    // ─────────────────────────────────────────
    // ⑥ 実使用分の在庫を消費
    // ─────────────────────────────────────────
    consumeItemsFromInventory(pokemon, reachableItems, workingInventory);
    boostRemaining -= reachableItems.boostCount;
    shardsRemaining -= reachableItems.shardsCount;

    // ─────────────────────────────────────────
    // ポケモン状態を更新
    // ─────────────────────────────────────────
    newPokemons.push({
      ...pokemon,
      reachedLevel: diagnosisResult.finalLevel,
      expToNextLevel,
      expToTarget,
      reachableItems,
      diagnosis,
      resourceSnapshot,
      shortage,
      // 目標まで行（理論値）
      targetItems: targetRowInfo.items,
      targetBoost: targetRowInfo.boostValue,
      targetNormal: targetRowInfo.normalValue,
      targetShards: targetRowInfo.shardsValue,
      // 個数指定行（理論値、candyTarget がある場合のみ）
      candyTargetItems: candyTargetRowInfo?.items,
      candyTargetBoost: candyTargetRowInfo?.boostValue,
      candyTargetNormal: candyTargetRowInfo?.normalValue,
      candyTargetShards: candyTargetRowInfo?.shardsValue,
    });
  }

  return {
    ...state,
    pokemons: newPokemons,
    inventory: workingInventory,
    boostRemaining,
    shardsRemaining,
  };
}

// ============================================================
// スナップショット
// ============================================================

/**
 * 配分時点のスナップショットを取得
 */
function captureResourceSnapshot(
  pokemon: PokemonWorkingState,
  inventory: CandyInventory,
  boostRemaining: number,
  shardsRemaining: number
): ResourceSnapshot {
  // このポケモンが使用可能な在庫価値を計算
  const speciesKey = String(pokemon.pokedexId);
  const speciesValue = (inventory.species[speciesKey] ?? 0) * CANDY_VALUES.species;

  const typeStock = inventory.typeCandy[pokemon.type] ?? { s: 0, m: 0 };
  const typeValue = typeStock.s * CANDY_VALUES.type.s + typeStock.m * CANDY_VALUES.type.m;

  const universalValue = calcItemValue({
    universalS: inventory.universal.s,
    universalM: inventory.universal.m,
    universalL: inventory.universal.l,
  });

  return {
    availableInventoryValue: speciesValue + typeValue + universalValue,
    availableBoost: boostRemaining,
    availableShards: shardsRemaining,
    availableUniversalS: inventory.universal.s,
  };
}

// ============================================================
// 目標行の計算
// ============================================================

/**
 * 目標まで行の情報を計算
 */
function calcTargetRowInfo(
  pokemon: PokemonWorkingState,
  boostKind: BoostKind,
  inventory: CandyInventory
): TargetRowInfo {
  // アメブ/通常アメの個数を決定
  // boostKind === 'none' の場合、boostOrExpAdjustment は EXP調整用の通常アメ個数
  let targetBoost: number;
  let targetNormal: number;

  if (boostKind === 'none') {
    targetBoost = 0;
    targetNormal = pokemon.boostOrExpAdjustment;  // EXP調整用の実質目標アメ数
  } else {
    targetBoost = pokemon.boostOrExpAdjustment;
    targetNormal = Math.max(0, pokemon.candyNeed - targetBoost);
  }
  const targetTotal = targetBoost + targetNormal;

  // Lv+EXP を計算（アメブ → 通常アメの順）
  const limitLevel = Math.min(pokemon.dstLevel + 1, MAX_LEVEL);

  const boostResult = (targetBoost > 0 && boostKind !== 'none')
    ? calcLevelByCandy({
      srcLevel: pokemon.srcLevel,
      dstLevel: limitLevel,
      expType: pokemon.expType,
      nature: pokemon.nature,
      boost: boostKind,
      candy: targetBoost,
      expGot: pokemon.expGot,
    })
    : { level: pokemon.srcLevel, expGot: pokemon.expGot };

  const normalResult = (targetNormal > 0)
    ? calcLevelByCandy({
      srcLevel: boostResult.level,
      dstLevel: limitLevel,
      expType: pokemon.expType,
      nature: pokemon.nature,
      boost: 'none',
      candy: targetNormal,
      expGot: boostResult.expGot,
    })
    : boostResult;

  const expectedLevel = normalResult.level;
  const expectedExpInLevel = normalResult.expGot;

  // かけらを計算
  const mixedResult = calcExpAndCandyMixed({
    srcLevel: pokemon.srcLevel,
    dstLevel: pokemon.dstLevel,
    expType: pokemon.expType,
    nature: pokemon.nature,
    boost: boostKind,
    boostCandy: targetBoost,
    expGot: pokemon.expGot,
  });
  const targetShards = mixedResult.shards;

  // アイテム配分を計算（実在庫から、補填前）
  const items = calcItemsFromInventory(pokemon, targetTotal, inventory);

  return {
    boostValue: targetBoost,
    normalValue: targetNormal,
    expectedLevel,
    expectedExpInLevel,
    shardsValue: targetShards,
    items,
  };
}

/**
 * 個数指定行の情報を計算
 */
function calcCandyTargetRowInfo(
  pokemon: PokemonWorkingState,
  boostKind: BoostKind,
  inventory: CandyInventory
): TargetRowInfo {
  const candyTarget = pokemon.candyTarget!;

  // 目標まで行の値を計算（boostKind === 'none' の場合に注意）
  let target1Boost: number;
  let target1Normal: number;

  if (boostKind === 'none') {
    target1Boost = 0;
    target1Normal = pokemon.boostOrExpAdjustment;  // EXP調整用の実質目標アメ数
  } else {
    target1Boost = pokemon.boostOrExpAdjustment;
    target1Normal = Math.max(0, pokemon.candyNeed - target1Boost);
  }
  const target1Total = target1Boost + target1Normal;

  // 個数指定のアメブ/通常アメを計算（SPEC準拠）
  let candyTargetBoost: number;
  let candyTargetNormal: number;

  if (candyTarget >= target1Total) {
    // 個数指定が第1目標以上 → 第1目標をそのまま使う（勝手に補填しない）
    candyTargetBoost = target1Boost;
    candyTargetNormal = target1Normal;
  } else {
    // 個数指定が第1目標より少ない → 通常アメから減らす
    candyTargetBoost = Math.min(candyTarget, target1Boost);
    candyTargetNormal = Math.max(0, candyTarget - candyTargetBoost);
  }

  // Lv+EXP を計算（アメブ → 通常アメの順）
  const limitLevel = Math.min(pokemon.dstLevel + 1, MAX_LEVEL);

  const boostResult = (candyTargetBoost > 0 && boostKind !== 'none')
    ? calcLevelByCandy({
      srcLevel: pokemon.srcLevel,
      dstLevel: limitLevel,
      expType: pokemon.expType,
      nature: pokemon.nature,
      boost: boostKind,
      candy: candyTargetBoost,
      expGot: pokemon.expGot,
    })
    : { level: pokemon.srcLevel, expGot: pokemon.expGot };

  const normalResult = (candyTargetNormal > 0)
    ? calcLevelByCandy({
      srcLevel: boostResult.level,
      dstLevel: limitLevel,
      expType: pokemon.expType,
      nature: pokemon.nature,
      boost: 'none',
      candy: candyTargetNormal,
      expGot: boostResult.expGot,
    })
    : boostResult;

  const expectedLevel = normalResult.level;
  const expectedExpInLevel = normalResult.expGot;

  // かけらを計算
  const mixedResult = calcExpAndCandyMixed({
    srcLevel: pokemon.srcLevel,
    dstLevel: pokemon.dstLevel,
    expType: pokemon.expType,
    nature: pokemon.nature,
    boost: boostKind,
    boostCandy: candyTargetBoost,
    expGot: pokemon.expGot,
  });

  // 通常アメが目標より少ない場合、かけらも比例して減る
  let candyTargetShards: number;
  if (candyTargetNormal < mixedResult.normalCandy) {
    const normalShardsPerCandy = mixedResult.normalCandy > 0
      ? mixedResult.shardsNormal / mixedResult.normalCandy
      : 0;
    const reducedNormalShards = normalShardsPerCandy * candyTargetNormal;
    candyTargetShards = Math.round(mixedResult.shardsBoost + reducedNormalShards);
  } else {
    candyTargetShards = mixedResult.shards;
  }

  // アイテム配分を計算（実在庫から、補填前）
  const candyTargetTotal = candyTargetBoost + candyTargetNormal;
  const items = calcItemsFromInventory(pokemon, candyTargetTotal, inventory);

  return {
    boostValue: candyTargetBoost,
    normalValue: candyTargetNormal,
    expectedLevel,
    expectedExpInLevel,
    shardsValue: candyTargetShards,
    items,
  };
}

/**
 * 在庫からアイテム配分を計算（補填前）
 *
 * Phase 1 では実在庫を使用。万能S 補填は Phase 3 で行う。
 */
function calcItemsFromInventory(
  pokemon: PokemonWorkingState,
  targetValue: number,
  inventory: CandyInventory
): ItemUsage {
  if (targetValue <= 0) {
    return createEmptyItemUsage();
  }

  // 種族アメ
  const speciesKey = String(pokemon.pokedexId);
  const speciesAvailable = inventory.species[speciesKey] ?? 0;
  const speciesUsed = Math.min(speciesAvailable, targetValue);
  let remaining = targetValue - speciesUsed * CANDY_VALUES.species;

  // タイプアメ + 万能アメ（実在庫から）
  const typeStock = inventory.typeCandy[pokemon.type] ?? { s: 0, m: 0 };
  const universalStock = {
    s: inventory.universal.s,  // 実在庫（補填は Phase 3）
    m: inventory.universal.m,
    l: inventory.universal.l,
  };

  const allocation = findBestItemAllocation(
    Math.max(0, remaining),
    typeStock,
    universalStock
  );

  const totalSupply = speciesUsed * CANDY_VALUES.species + allocation.supplied;
  const surplus = Math.max(0, totalSupply - targetValue);

  return {
    speciesCandy: speciesUsed,
    typeS: allocation.typeS,
    typeM: allocation.typeM,
    universalS: allocation.universalS,
    universalM: allocation.universalM,
    universalL: allocation.universalL,
    totalSupply,
    boostCount: 0,  // フェーズ3で設定
    normalCount: 0, // フェーズ3で設定
    totalCandyCount: 0,  // フェーズ3で設定
    shardsCount: 0,  // フェーズ3で設定
    surplus,
  };
}

// ============================================================
// 制約計算
// ============================================================

/**
 * 各制約の独立した到達Lv+EXPを計算し、最終結果を決定する
 */
function calcConstraintsAndSelectFinalLevelAndExp(
  input: ConstraintInput,
  target: TargetRowInfo,
  resourceSnapshot: ResourceSnapshot,
  boostKind: BoostKind
): ConstraintDiagnosisResult {
  const { boostValue: targetBoost, normalValue: targetNormal, shardsValue: targetShards } = target;
  const { expectedLevel, expectedExpInLevel } = target;
  const { availableInventoryValue: inventoryValue, availableBoost: boostRemaining, availableShards: shardsRemaining } = resourceSnapshot;
  const targetTotal = targetBoost + targetNormal;

  // ─────────────────────────────────────────
  // 1. かけら制限のみの到達Lv+EXP（アメブ・通常アメは理論値）
  // ─────────────────────────────────────────
  const byShardsLimit = calcReachableWithShardsOnly(
    input,
    targetBoost,
    targetNormal,
    shardsRemaining,
    boostKind
  );
  byShardsLimit.shortage = Math.max(0, targetShards - shardsRemaining);

  // ─────────────────────────────────────────
  // 2. アメブ制限のみの到達Lv+EXP（通常アメ・かけらは理論値）
  // ─────────────────────────────────────────
  let byBoostLimit: IndependentConstraintResult;

  if (boostKind === 'none') {
    // アメブなしの場合、この制約は適用外 → 期待Lv+EXPを使用
    byBoostLimit = {
      level: expectedLevel,
      expInLevel: expectedExpInLevel,
      shortage: 0,
      candyUsed: targetNormal,
      shardsUsed: targetShards,
      boostCandyUsed: 0,
      normalCandyUsed: targetNormal,
    };
  } else {
    const effectiveBoost = Math.min(targetBoost, boostRemaining);
    byBoostLimit = calcReachableWithBoostOnly(
      input,
      effectiveBoost,
      targetNormal,
      targetShards,
      boostKind
    );
    byBoostLimit.shortage = Math.max(0, targetBoost - boostRemaining);
  }

  // ─────────────────────────────────────────
  // 3. 在庫制限のみの到達Lv+EXP（かけらは理論値）
  // ─────────────────────────────────────────
  let effectiveBoostForInv = targetBoost;
  let effectiveNormalForInv = targetNormal;

  if (inventoryValue < targetTotal) {
    // 足りない時は通常アメから減らし、それでも足りなければアメブから減らす
    const shortage = targetTotal - inventoryValue;
    if (shortage <= targetNormal) {
      // 通常アメを減らすだけで足りる
      effectiveNormalForInv = targetNormal - shortage;
    } else {
      // 通常アメを0にしても足りない場合、アメブからも減らす
      effectiveNormalForInv = 0;
      effectiveBoostForInv = Math.max(0, targetBoost - (shortage - targetNormal));
    }
  }

  const byInventory = calcReachableWithInventoryOnly(
    input,
    effectiveBoostForInv,
    effectiveNormalForInv,
    targetShards,
    boostKind
  );
  byInventory.shortage = Math.max(0, targetTotal - inventoryValue);

  // ─────────────────────────────────────────
  // 4. 最終到達Lv+EXPを選択（最も厳しい制約）
  // ─────────────────────────────────────────
  const { finalLevel, finalExpInLevel, limitingFactor } = selectFinalLevelAndExp(
    expectedLevel,
    expectedExpInLevel,
    byInventory,
    byBoostLimit,
    byShardsLimit
  );

  // ─────────────────────────────────────────
  // 5. 独立した不足フラグ（Lv+EXPで比較）
  // ─────────────────────────────────────────
  const compareLvExp = (resultLevel: number, resultExp: number) =>
    resultLevel < expectedLevel ||
    (resultLevel === expectedLevel && resultExp < expectedExpInLevel);

  const isInventoryShortage = byInventory.shortage > 0 &&
    compareLvExp(byInventory.level, byInventory.expInLevel);
  const isBoostShortage = byBoostLimit.shortage > 0 && boostKind !== 'none' &&
    compareLvExp(byBoostLimit.level, byBoostLimit.expInLevel);
  const isShardsShortage = byShardsLimit.shortage > 0 &&
    compareLvExp(byShardsLimit.level, byShardsLimit.expInLevel);

  return {
    byInventory,
    byBoostLimit,
    byShardsLimit,
    finalLevel,
    finalExpInLevel,
    limitingFactor,
    isInventoryShortage,
    isBoostShortage,
    isShardsShortage,
  };
}

/**
 * かけら制限のみで到達Lv+EXPを計算
 */
function calcReachableWithShardsOnly(
  input: ConstraintInput,
  boostValue: number,
  normalValue: number,
  shardsLimit: number,
  boostKind: BoostKind
): IndependentConstraintResult {
  const { srcLevel, dstLevel, expType, nature, expGot } = input;

  if (srcLevel >= dstLevel) {
    return { level: srcLevel, expInLevel: expGot, shortage: 0, candyUsed: 0, shardsUsed: 0, boostCandyUsed: 0, normalCandyUsed: 0 };
  }

  // アメブ部分
  const boostResult = boostValue > 0 && boostKind !== 'none'
    ? calcLevelByCandyAndShards({
      srcLevel,
      dstLevel,
      expType,
      nature,
      boost: boostKind,
      candy: boostValue,
      shardsLimit,
      expGot,
    })
    : { level: srcLevel, expGot, shards: 0, candyUsed: 0 };

  // 通常アメ部分
  const shardsAfterBoost = shardsLimit - (boostResult.shards ?? 0);
  const normalResult = normalValue > 0 && shardsAfterBoost > 0
    ? calcLevelByCandyAndShards({
      srcLevel: boostResult.level,
      dstLevel,
      expType,
      nature,
      boost: 'none',
      candy: normalValue,
      shardsLimit: shardsAfterBoost,
      expGot: boostResult.expGot,
    })
    : { level: boostResult.level, expGot: boostResult.expGot, shards: 0, candyUsed: 0 };

  return {
    level: normalResult.level,
    expInLevel: normalResult.expGot,
    shortage: 0,  // 後で設定
    candyUsed: (boostResult.candyUsed ?? 0) + (normalResult.candyUsed ?? 0),
    shardsUsed: (boostResult.shards ?? 0) + (normalResult.shards ?? 0),
    boostCandyUsed: boostResult.candyUsed ?? 0,
    normalCandyUsed: normalResult.candyUsed ?? 0,
  };
}

/**
 * アメブ制限のみで到達Lv+EXPを計算（かけらは無制限）
 */
function calcReachableWithBoostOnly(
  input: ConstraintInput,
  effectiveBoost: number,
  normalValue: number,
  _shardsForLevel: number,
  boostKind: BoostKind
): IndependentConstraintResult {
  const { srcLevel, dstLevel, expType, nature, expGot } = input;

  if (srcLevel >= dstLevel) {
    return { level: srcLevel, expInLevel: expGot, shortage: 0, candyUsed: 0, shardsUsed: 0, boostCandyUsed: 0, normalCandyUsed: 0 };
  }

  // アメブ部分（かけら無制限）
  const boostResult = effectiveBoost > 0 && boostKind !== 'none'
    ? calcLevelByCandy({
      srcLevel,
      dstLevel,
      expType,
      nature,
      boost: boostKind,
      candy: effectiveBoost,
      expGot,
    })
    : { level: srcLevel, expGot, shards: 0, candyUsed: 0 };

  // 通常アメ部分（かけら無制限）
  const normalResult = normalValue > 0
    ? calcLevelByCandy({
      srcLevel: boostResult.level,
      dstLevel,
      expType,
      nature,
      boost: 'none',
      candy: normalValue,
      expGot: boostResult.expGot,
    })
    : { level: boostResult.level, expGot: boostResult.expGot, shards: 0, candyUsed: 0 };

  return {
    level: normalResult.level,
    expInLevel: normalResult.expGot,
    shortage: 0,  // 後で設定
    candyUsed: (boostResult.candyUsed ?? 0) + (normalResult.candyUsed ?? 0),
    shardsUsed: (boostResult.shards ?? 0) + (normalResult.shards ?? 0),
    boostCandyUsed: boostResult.candyUsed ?? 0,
    normalCandyUsed: normalResult.candyUsed ?? 0,
  };
}

/**
 * 在庫制限のみで到達Lv+EXPを計算（かけらは無制限）
 */
function calcReachableWithInventoryOnly(
  input: ConstraintInput,
  effectiveBoost: number,
  effectiveNormal: number,
  _shardsForLevel: number,
  boostKind: BoostKind
): IndependentConstraintResult {
  const { srcLevel, dstLevel, expType, nature, expGot } = input;

  if (srcLevel >= dstLevel) {
    return { level: srcLevel, expInLevel: expGot, shortage: 0, candyUsed: 0, shardsUsed: 0, boostCandyUsed: 0, normalCandyUsed: 0 };
  }

  // アメブ部分（かけら無制限）
  const boostResult = effectiveBoost > 0 && boostKind !== 'none'
    ? calcLevelByCandy({
      srcLevel,
      dstLevel,
      expType,
      nature,
      boost: boostKind,
      candy: effectiveBoost,
      expGot,
    })
    : { level: srcLevel, expGot, shards: 0, candyUsed: 0 };

  // 通常アメ部分（かけら無制限）
  const normalResult = effectiveNormal > 0
    ? calcLevelByCandy({
      srcLevel: boostResult.level,
      dstLevel,
      expType,
      nature,
      boost: 'none',
      candy: effectiveNormal,
      expGot: boostResult.expGot,
    })
    : { level: boostResult.level, expGot: boostResult.expGot, shards: 0, candyUsed: 0 };

  return {
    level: normalResult.level,
    expInLevel: normalResult.expGot,
    shortage: 0,  // 後で設定
    candyUsed: (boostResult.candyUsed ?? 0) + (normalResult.candyUsed ?? 0),
    shardsUsed: (boostResult.shards ?? 0) + (normalResult.shards ?? 0),
    boostCandyUsed: boostResult.candyUsed ?? 0,
    normalCandyUsed: normalResult.candyUsed ?? 0,
  };
}

/**
 * 最終到達Lv+EXPを選択（最も厳しい制約）
 */
function selectFinalLevelAndExp(
  expectedLevel: number,
  expectedExpInLevel: number,
  byInventory: IndependentConstraintResult,
  byBoostLimit: IndependentConstraintResult,
  byShardsLimit: IndependentConstraintResult
): { finalLevel: number; finalExpInLevel: number; limitingFactor: ShortageType | null } {
  // Lv+EXP で目標達成をチェック（レベルが上か、同レベルでEXPが同等以上）
  const reachesTarget = (r: IndependentConstraintResult) =>
    r.level > expectedLevel ||
    (r.level === expectedLevel && r.expInLevel >= expectedExpInLevel);

  if (reachesTarget(byInventory) && reachesTarget(byBoostLimit) && reachesTarget(byShardsLimit)) {
    return {
      finalLevel: expectedLevel,
      finalExpInLevel: expectedExpInLevel,
      limitingFactor: null,
    };
  }

  // 最小レベルを探す（レベルが同じ場合はexpInLevelで比較）
  const candidates = [
    { level: byInventory.level, exp: byInventory.expInLevel, factor: 'candy' as ShortageType },
    { level: byBoostLimit.level, exp: byBoostLimit.expInLevel, factor: 'boost' as ShortageType },
    { level: byShardsLimit.level, exp: byShardsLimit.expInLevel, factor: 'shards' as ShortageType },
  ];

  // レベルが低い順、同レベルならEXPが低い順にソート
  candidates.sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    return a.exp - b.exp;
  });

  const lowest = candidates[0];
  return {
    finalLevel: lowest.level,
    finalExpInLevel: lowest.exp,
    limitingFactor: lowest.factor,
  };
}

// ============================================================
// 不足情報
// ============================================================

/**
 * ShortageInfo を構築
 */
function buildShortageInfo(diagnosis: ConstraintDiagnosisResult): ShortageInfo {
  // 主要な制限要因の不足量を使用
  return {
    candy: diagnosis.limitingFactor === 'candy' ? diagnosis.byInventory.shortage : 0,
    boost: diagnosis.limitingFactor === 'boost' ? diagnosis.byBoostLimit.shortage : 0,
    shards: diagnosis.limitingFactor === 'shards' ? diagnosis.byShardsLimit.shortage : 0,
  };
}

/**
 * IndependentConstraintResult を ReachableInfo に変換
 */
function toReachableInfo(result: IndependentConstraintResult): ReachableInfo {
  return {
    level: result.level,
    expInLevel: result.expInLevel,
    candyUsed: result.candyUsed,
  };
}

// ============================================================
// 到達可能行のアイテム配分
// ============================================================

/**
 * 到達可能行のアイテム配分を計算
 *
 * @param pokemon ポケモン状態
 * @param diagnosis 制約診断結果
 * @param boostKind アメブ種類
 * @param inventory 在庫
 * @param snapshot 配分時点のスナップショット
 * @param targetForConstraint 目標行の情報
 */
function calcReachableItems(
  pokemon: PokemonWorkingState,
  diagnosis: ConstraintDiagnosisResult,
  boostKind: BoostKind,
  inventory: CandyInventory,
  resourceSnapshot: ResourceSnapshot,
  targetForConstraint: TargetRowInfo
): ItemUsage {
  const { finalLevel, finalExpInLevel, limitingFactor } = diagnosis;

  // レベルアップなしの場合は空を返す
  if (finalLevel <= pokemon.srcLevel && finalExpInLevel <= pokemon.expGot) {
    return createEmptyItemUsage();
  }

  // ─────────────────────────────────────────
  // 1. 到達Lv+EXPに必要なアメ価値を計算
  // ─────────────────────────────────────────
  let candyNeedForReachable: number;
  let boostCount: number;
  let normalCount: number;
  let shardsCount: number;

  if (limitingFactor === null) {
    // 目標達成 → targetForConstraint の値を使用
    candyNeedForReachable = targetForConstraint.boostValue + targetForConstraint.normalValue;
    boostCount = targetForConstraint.boostValue;
    normalCount = targetForConstraint.normalValue;
    shardsCount = targetForConstraint.shardsValue;
  } else if (limitingFactor === 'candy') {
    // 在庫制限が主要因 → 診断結果から取得
    candyNeedForReachable = diagnosis.byInventory.candyUsed;
    boostCount = diagnosis.byInventory.boostCandyUsed;
    normalCount = diagnosis.byInventory.normalCandyUsed;
    shardsCount = diagnosis.byInventory.shardsUsed;
  } else if (limitingFactor === 'boost') {
    // アメブ制限が主要因 → 診断結果から取得
    candyNeedForReachable = diagnosis.byBoostLimit.candyUsed;
    boostCount = diagnosis.byBoostLimit.boostCandyUsed;
    normalCount = diagnosis.byBoostLimit.normalCandyUsed;
    shardsCount = diagnosis.byBoostLimit.shardsUsed;
  } else {
    // かけら制限が主要因 → 診断結果から取得
    candyNeedForReachable = diagnosis.byShardsLimit.candyUsed;
    boostCount = diagnosis.byShardsLimit.boostCandyUsed;
    normalCount = diagnosis.byShardsLimit.normalCandyUsed;
    shardsCount = Math.min(diagnosis.byShardsLimit.shardsUsed, resourceSnapshot.availableShards);
  }

  if (candyNeedForReachable <= 0) {
    return createEmptyItemUsage();
  }

  // ─────────────────────────────────────────
  // 2. アイテム配分（実在庫から）
  // ─────────────────────────────────────────
  const speciesKey = String(pokemon.pokedexId);
  const speciesAvailable = inventory.species[speciesKey] ?? 0;
  const speciesUsed = Math.min(speciesAvailable, candyNeedForReachable);
  let remaining = candyNeedForReachable - speciesUsed * CANDY_VALUES.species;

  const typeStock = inventory.typeCandy[pokemon.type] ?? { s: 0, m: 0 };
  const universalStock = inventory.universal;

  const allocation = findBestItemAllocation(
    Math.max(0, remaining),
    typeStock,
    universalStock
  );

  const totalSupply = speciesUsed * CANDY_VALUES.species + allocation.supplied;
  const surplus = Math.max(0, totalSupply - candyNeedForReachable);

  return {
    speciesCandy: speciesUsed,
    typeS: allocation.typeS,
    typeM: allocation.typeM,
    universalS: allocation.universalS,
    universalM: allocation.universalM,
    universalL: allocation.universalL,
    totalSupply,
    boostCount,
    normalCount,
    totalCandyCount: boostCount + normalCount,
    shardsCount,
    surplus,
  };
}

// ============================================================
// 在庫消費
// ============================================================

/**
 * 実使用分をInventoryから消費
 */
function consumeItemsFromInventory(
  pokemon: PokemonWorkingState,
  items: ItemUsage,
  inventory: CandyInventory
): void {
  // 種族アメを消費
  if (items.speciesCandy > 0) {
    consumeSpeciesCandy(inventory, pokemon.pokedexId, items.speciesCandy);
  }

  // タイプアメを消費
  if (items.typeS > 0 || items.typeM > 0) {
    consumeTypeCandy(inventory, pokemon.type, items.typeS, items.typeM);
  }

  // 万能アメを消費
  if (items.universalS > 0 || items.universalM > 0 || items.universalL > 0) {
    consumeUniversalCandy(inventory, items.universalS, items.universalM, items.universalL);
  }
}

// ============================================================
// EXP計算ヘルパー
// ============================================================

/**
 * 到達レベルでの残りEXP（次Lvまで）を計算
 */
function calcRemainingExpInLevel(
  level: number,
  expInLevel: number,
  expType: ExpType
): number {
  if (level <= 0) return 0;
  const expToNextLevel = calcExp(level, level + 1, expType);
  return Math.max(0, expToNextLevel - expInLevel);
}

/**
 * 目標レベルまでの残りEXPを計算
 */
function calcRemainingExpToTarget(
  currentLevel: number,
  currentExpInLevel: number,
  dstLevel: number,
  expType: ExpType
): number {
  if (currentLevel >= dstLevel) return 0;
  const totalExpNeeded = calcExp(currentLevel, dstLevel, expType);
  return Math.max(0, totalExpNeeded - currentExpInLevel);
}
