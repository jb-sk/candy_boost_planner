/**
 * LevelPlanner - Phase 3: 補填 + 結果構築
 *
 * 新フェーズ設計の Phase 3。
 * 理論値行（targetItems, candyTargetItems）に万能Sを補填し、
 * 最終的な LevelUpPlanResult を構築する。
 *
 * 【処理内容】
 * 1. 目標まで行（targetItems）の万能S補填
 * 2. 個数指定行（candyTargetItems）の万能S補填（ある場合のみ）
 * 3. PokemonLevelUpResult を構築
 * 4. サマリーを計算
 *
 * 【注意】
 * - 到達可能行（reachableItems）は補填しない（実使用のため）
 * - boostCount, normalCount, shardsCount は Phase 1 で計算済み（転記のみ）
 */

import type {
  PhaseState,
  PokemonLevelUpResult,
  LevelUpPlanResult,
  ItemUsage,
  ShortageInfo,
  ConstraintDiagnosis,
  ResourceSnapshot,
  UniversalCandyStock,
  TypeCandyStock,
  ReachableInfo,
  ItemUsageRankingEntry,
} from '../types';
import { CANDY_VALUES } from '../constants';

// ============================================================
// メインエントリポイント
// ============================================================

/**
 * Phase 3: 補填 + 結果構築
 *
 * 理論値行に万能Sを補填し、最終結果を構築する。
 */
export function applyPhase3Finalize(
  state: PhaseState
): LevelUpPlanResult {
  const results: PokemonLevelUpResult[] = [];

  for (const pokemon of state.pokemons) {
    // ─────────────────────────────────────────
    // 1. 目標まで行（targetItems）の補填
    // ─────────────────────────────────────────
    const targetItems = backfillWithUniversalS(
      pokemon.targetItems,
      pokemon.candyNeed,
      Infinity  // 万能S無限
    );
    // boostCount, normalCount, shardsCount, totalCandyCount は転記
    targetItems.boostCount = pokemon.targetBoost ?? 0;
    targetItems.normalCount = pokemon.targetNormal ?? 0;
    targetItems.totalCandyCount = targetItems.boostCount + targetItems.normalCount;
    targetItems.shardsCount = pokemon.targetShards ?? 0;

    // ─────────────────────────────────────────
    // 2. 個数指定行（candyTargetItems）の補填（ある場合のみ）
    // ─────────────────────────────────────────
    let candyTargetItems: ItemUsage | undefined;
    if (pokemon.candyTarget !== undefined && pokemon.candyTargetItems) {
      candyTargetItems = backfillWithUniversalS(
        pokemon.candyTargetItems,
        pokemon.candyTarget,
        Infinity  // 万能S無限
      );
      // boostCount, normalCount, shardsCount, totalCandyCount は転記
      candyTargetItems.boostCount = pokemon.candyTargetBoost ?? 0;
      candyTargetItems.normalCount = pokemon.candyTargetNormal ?? 0;
      candyTargetItems.totalCandyCount = candyTargetItems.boostCount + candyTargetItems.normalCount;
      candyTargetItems.shardsCount = pokemon.candyTargetShards ?? 0;
    }

    // ─────────────────────────────────────────
    // 3. PokemonLevelUpResult を構築
    // ─────────────────────────────────────────
    results.push({
      // 入力情報をコピー
      id: pokemon.id,
      pokedexId: pokemon.pokedexId,
      form: pokemon.form,
      pokemonName: pokemon.pokemonName,
      type: pokemon.type,
      srcLevel: pokemon.srcLevel,
      dstLevel: pokemon.dstLevel,
      dstExpInLevel: pokemon.dstExpInLevel,
      expType: pokemon.expType,
      nature: pokemon.nature,
      expGot: pokemon.expGot,
      candyNeed: pokemon.candyNeed,
      expNeed: pokemon.expNeed,
      boostOrExpAdjustment: pokemon.boostOrExpAdjustment,
      candyTarget: pokemon.candyTarget,

      // 到達情報（Phase 1 で計算済み）
      reachedLevel: pokemon.reachedLevel,
      expToNextLevel: pokemon.expToNextLevel ?? 0,
      expToTarget: pokemon.expToTarget ?? 0,

      // 到達可能行（Phase 1 で計算済み、補填なし）
      reachableItems: pokemon.reachableItems,

      // 不足・診断情報（Phase 1 で計算済み）
      shortage: pokemon.shortage ?? createEmptyShortage(),
      diagnosis: pokemon.diagnosis ?? createEmptyDiagnosis(),
      resourceSnapshot: pokemon.resourceSnapshot ?? createEmptySnapshot(),

      // 目標まで行（Phase 3 で補填）
      targetBoost: pokemon.targetBoost ?? 0,
      targetNormal: pokemon.targetNormal ?? 0,
      targetShards: pokemon.targetShards ?? 0,
      targetItems,
      targetExpToNextLevel: pokemon.targetExpToNextLevel ?? 0,

      // 個数指定行（Phase 3 で補填）
      candyTargetBoost: pokemon.candyTargetBoost,
      candyTargetNormal: pokemon.candyTargetNormal,
      candyTargetShards: pokemon.candyTargetShards,
      candyTargetItems,
    });
  }

  // ─────────────────────────────────────────
  // 4. サマリーを計算
  // ─────────────────────────────────────────
  const summary = buildSummary(results, state);

  return {
    pokemons: results,
    ...summary,
  };
}

// ============================================================
// 補填関数
// ============================================================

/**
 * 万能Sで補填する
 *
 * @param items 現在のアイテム使用量（Phase 1 or 2 の出力）
 * @param targetValue 目標価値（candyNeed または candyTarget）
 * @param universalSLimit 万能Sの上限（理論値行は Infinity）
 */
function backfillWithUniversalS(
  items: ItemUsage,
  targetValue: number,
  universalSLimit: number
): ItemUsage {
  const currentValue = items.totalSupply;
  const shortage = Math.max(0, targetValue - currentValue);

  if (shortage === 0) {
    return { ...items };
  }

  // 万能Sで補填（価値3）
  const sNeeded = Math.ceil(shortage / CANDY_VALUES.universal.s);
  const sToAdd = Math.min(sNeeded, universalSLimit);

  const newUniversalS = items.universalS + sToAdd;
  const addedValue = sToAdd * CANDY_VALUES.universal.s;
  const newTotalSupply = currentValue + addedValue;
  const newSurplus = Math.max(0, newTotalSupply - targetValue);

  return {
    ...items,
    universalS: newUniversalS,
    totalSupply: newTotalSupply,
    surplus: newSurplus,
  };
}

// ============================================================
// サマリー構築
// ============================================================

/**
 * 理論値行を取得（個数指定があれば candyTarget、なければ target）
 */
function getTheoreticalRow(p: PokemonLevelUpResult): ItemUsage {
  if (p.candyTarget !== undefined && p.candyTargetItems) {
    return p.candyTargetItems;
  }
  return p.targetItems;
}

/**
 * サマリーを構築する
 *
 * 理論値と実使用量の両方からサマリーを計算する。
 */
function buildSummary(
  pokemons: PokemonLevelUpResult[],
  state: PhaseState
): Omit<LevelUpPlanResult, 'pokemons'> {
  const inventory = state.inventory;

  // ─────────────────────────────────────────
  // 実使用サマリー（到達可能行）
  // ─────────────────────────────────────────
  const universalUsed: UniversalCandyStock = {
    s: pokemons.reduce((sum, p) => sum + p.reachableItems.universalS, 0),
    m: pokemons.reduce((sum, p) => sum + p.reachableItems.universalM, 0),
    l: pokemons.reduce((sum, p) => sum + p.reachableItems.universalL, 0),
  };

  // inventory は Phase 1 で既に消費済みの状態
  const universalRemaining: UniversalCandyStock = {
    s: inventory.universal.s,
    m: inventory.universal.m,
    l: inventory.universal.l,
  };

  const actualBoostTotal = pokemons.reduce((sum, p) => sum + p.reachableItems.boostCount, 0);
  const actualNormalTotal = pokemons.reduce((sum, p) => sum + p.reachableItems.normalCount, 0);
  const actualShardsTotal = pokemons.reduce((sum, p) => sum + p.reachableItems.shardsCount, 0);

  // ─────────────────────────────────────────
  // 理論値サマリー（目標まで行 or 個数指定行）
  // ─────────────────────────────────────────
  const theoreticalBoostTotal = pokemons.reduce((sum, p) => sum + getTheoreticalRow(p).boostCount, 0);
  const theoreticalNormalTotal = pokemons.reduce((sum, p) => sum + getTheoreticalRow(p).normalCount, 0);
  const theoreticalShardsTotal = pokemons.reduce((sum, p) => sum + getTheoreticalRow(p).shardsCount, 0);

  // ─────────────────────────────────────────
  // タイプアメ使用量（実使用）
  // ─────────────────────────────────────────
  const typeCandyUsed: Record<string, TypeCandyStock> = {};
  for (const p of pokemons) {
    if (p.reachableItems.typeS > 0 || p.reachableItems.typeM > 0) {
      if (!typeCandyUsed[p.type]) {
        typeCandyUsed[p.type] = { s: 0, m: 0 };
      }
      typeCandyUsed[p.type].s += p.reachableItems.typeS;
      typeCandyUsed[p.type].m += p.reachableItems.typeM;
    }
  }

  // ─────────────────────────────────────────
  // 種族アメ使用量（実使用）
  // ─────────────────────────────────────────
  const speciesCandyUsed: Record<string, number> = {};
  for (const p of pokemons) {
    if (p.reachableItems.speciesCandy > 0) {
      const key = String(p.pokedexId);
      speciesCandyUsed[key] = (speciesCandyUsed[key] ?? 0) + p.reachableItems.speciesCandy;
    }
  }

  // ─────────────────────────────────────────
  // 不足サマリー
  // ─────────────────────────────────────────
  const candyShortages = pokemons
    .filter(p => p.shortage.candy > 0)
    .map(p => ({ id: p.id, pokemonName: p.pokemonName, shortage: p.shortage.candy }));

  const shardsShortages = pokemons
    .filter(p => p.shortage.shards > 0)
    .map(p => ({ id: p.id, pokemonName: p.pokemonName, shortage: p.shortage.shards }));

  const totalCandyShortage = candyShortages.reduce((sum, s) => sum + s.shortage, 0);
  const totalShardsShortage = shardsShortages.reduce((sum, s) => sum + s.shortage, 0);

  // ─────────────────────────────────────────
  // 万能アメ消費ランキング（実使用、価値順）
  // ─────────────────────────────────────────
  const itemUsageRanking: ItemUsageRankingEntry[] = pokemons
    .map(p => ({
      id: p.id,
      pokemonName: p.pokemonName,
      typeS: p.reachableItems.typeS,
      typeM: p.reachableItems.typeM,
      universalS: p.reachableItems.universalS,
      universalM: p.reachableItems.universalM,
      universalL: p.reachableItems.universalL,
      totalValue: p.reachableItems.universalS * CANDY_VALUES.universal.s
        + p.reachableItems.universalM * CANDY_VALUES.universal.m
        + p.reachableItems.universalL * CANDY_VALUES.universal.l,
    }))
    .filter(e => e.totalValue > 0)
    .sort((a, b) => b.totalValue - a.totalValue);

  // ─────────────────────────────────────────
  // 合計
  // ─────────────────────────────────────────
  const totalNeed = pokemons.reduce((sum, p) => sum + p.candyNeed, 0);
  const totalSupplied = pokemons.reduce((sum, p) => sum + p.reachableItems.totalSupply, 0);

  return {
    // 在庫使用（実使用量）
    universalUsed,
    universalRemaining,
    typeCandyUsed,
    speciesCandyUsed,
    // 理論値サマリー
    theoreticalBoostTotal,
    theoreticalNormalTotal,
    theoreticalShardsTotal,
    // 実使用サマリー
    actualBoostTotal,
    actualNormalTotal,
    actualShardsTotal,
    // 不足サマリー
    candyShortages,
    shardsShortages,
    totalCandyShortage,
    totalShardsShortage,
    // ランキング
    itemUsageRanking,
    // 合計
    totalNeed,
    totalSupplied,
  };
}

// ============================================================
// ヘルパー関数
// ============================================================

/**
 * 空の不足情報を作成
 */
function createEmptyShortage(): ShortageInfo {
  return {
    candy: 0,
    boost: 0,
    normal: 0,
    shards: 0,
  };
}

/**
 * 空の診断情報を作成
 */
function createEmptyDiagnosis(): ConstraintDiagnosis {
  const emptyReachable: ReachableInfo = {
    level: 0,
    expInLevel: 0,
    candyUsed: 0,
  };
  return {
    byInventory: emptyReachable,
    byBoostLimit: emptyReachable,
    byShardsLimit: emptyReachable,
    limitingFactor: null,
    isInventoryShortage: false,
    isBoostShortage: false,
    isShardsShortage: false,
  };
}

/**
 * 空のリソーススナップショットを作成
 */
function createEmptySnapshot(): ResourceSnapshot {
  return {
    availableBoost: 0,
    availableShards: 0,
    availableInventoryValue: 0,
    availableUniversalS: 0,
  };
}
