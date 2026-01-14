/**
 * LevelPlanner テスト共通ユーティリティ
 */

import type {
  PokemonLevelUpRequest,
  CandyInventory,
  PlanConfig,
  BoostKind,
} from '../types';
import type { ExpType, ExpGainNature } from '../../types';

// ============================================================
// デフォルト値
// ============================================================

export const DEFAULT_POKEMON = {
  pokedexId: 491,
  pokemonName: 'ダークライ',
  type: 'dark',
  expType: 1320 as ExpType,
  nature: 'normal' as ExpGainNature,
  expGot: 0,
} as const;

export const DEFAULT_INVENTORY: CandyInventory = {
  species: {},
  typeCandy: {},
  universal: { s: 1000, m: 100, l: 10 },
};

export const DEFAULT_CONFIG: PlanConfig = {
  boostKind: 'full',
  globalBoostLimit: Infinity,
  globalShardsLimit: Infinity,
};

// リクエスト作成
// ============================================================

import { calcExpAndCandy } from '../../pokesleep/exp';

export type PokemonInputSimple = {
  id: string;
  pokedexId?: number;
  pokemonName?: string;
  type?: string;
  srcLevel: number;
  dstLevel: number;
  dstExpInLevel?: number;
  expType?: ExpType;
  nature?: ExpGainNature;
  expGot?: number;
  candyNeed: number;
  boostOrExpAdjustment: number;
  candyTarget?: number;
};

/**
 * ポケモンリクエストを作成（簡易版）
 */
export function pokemon(input: PokemonInputSimple): PokemonLevelUpRequest {
  return {
    id: input.id,
    pokedexId: input.pokedexId ?? DEFAULT_POKEMON.pokedexId,
    pokemonName: input.pokemonName ?? DEFAULT_POKEMON.pokemonName,
    type: input.type ?? DEFAULT_POKEMON.type,
    srcLevel: input.srcLevel,
    dstLevel: input.dstLevel,
    dstExpInLevel: input.dstExpInLevel,
    expType: input.expType ?? DEFAULT_POKEMON.expType,
    nature: input.nature ?? DEFAULT_POKEMON.nature,
    expGot: input.expGot ?? DEFAULT_POKEMON.expGot,
    candyNeed: input.candyNeed,
    expNeed: 0, // 計算で埋める
    boostOrExpAdjustment: input.boostOrExpAdjustment,
    candyTarget: input.candyTarget
  };
}

export type PokemonInputAuto = {
  id: string;
  pokedexId?: number;
  pokemonName?: string;
  type?: string;
  srcLevel: number;
  dstLevel: number;
  expType?: ExpType;
  nature?: ExpGainNature;
  expGot?: number;
  boostKind?: BoostKind;
  /** 通常アメの割合（0-1, デフォルト=0 → 全てアメブ） */
  normalRatio?: number;
  candyTarget?: number;
};

/**
 * ポケモンリクエストを作成（candyNeed自動計算）
 */
export function pokemonAuto(input: PokemonInputAuto): PokemonLevelUpRequest {
  const expType = input.expType ?? DEFAULT_POKEMON.expType;
  const nature = input.nature ?? DEFAULT_POKEMON.nature;
  const expGot = input.expGot ?? 0;
  const boostKind = input.boostKind ?? 'full';

  const { candy, exp, shards } = calcExpAndCandy({
    srcLevel: input.srcLevel,
    dstLevel: input.dstLevel,
    expType,
    nature,
    boost: boostKind,
    expGot,
  });

  const normalRatio = input.normalRatio ?? 0;
  const normalCandy = Math.floor(candy * normalRatio);
  const boostCandy = candy - normalCandy;

  return {
    id: input.id,
    pokedexId: input.pokedexId ?? DEFAULT_POKEMON.pokedexId,
    pokemonName: input.pokemonName ?? DEFAULT_POKEMON.pokemonName,
    type: input.type ?? DEFAULT_POKEMON.type,
    srcLevel: input.srcLevel,
    dstLevel: input.dstLevel,
    expType,
    nature,
    expGot,
    candyNeed: candy,
    expNeed: exp,
    boostOrExpAdjustment: boostCandy,
    candyTarget: input.candyTarget
  };
}

// ============================================================
// 在庫作成
// ============================================================

export type InventoryInput = {
  species?: Record<string, number>;
  typeCandy?: Record<string, { s: number; m: number }>;
  universal?: { s: number; m: number; l: number };
};

/**
 * 在庫を作成（簡易版）
 */
export function inventory(input?: InventoryInput): CandyInventory {
  return {
    species: input?.species ?? {},
    typeCandy: input?.typeCandy ?? {},
    universal: input?.universal ?? DEFAULT_INVENTORY.universal,
  };
}

// ============================================================
// 設定作成
// ============================================================

export type ConfigInput = {
  boostKind?: BoostKind;
  globalBoostLimit?: number;
  globalShardsLimit?: number;
};

/**
 * 設定を作成（簡易版）
 */
export function config(input?: ConfigInput): PlanConfig {
  return {
    boostKind: input?.boostKind ?? 'full',
    globalBoostLimit: input?.globalBoostLimit ?? Infinity,
    globalShardsLimit: input?.globalShardsLimit ?? Infinity,
  };
}

// ============================================================
// アサーションヘルパー
// ============================================================

import { expect } from 'vitest';
import type { LevelUpPlanResult } from '../types';

/**
 * ポケモン結果を取得
 */
export function getPokemon(result: LevelUpPlanResult, id: string) {
  const p = result.pokemons.find(p => p.id === id);
  if (!p) throw new Error(`Pokemon ${id} not found`);
  return p;
}

/**
 * 到達レベルを検証
 */
export function expectReachedLevel(result: LevelUpPlanResult, id: string, level: number) {
  expect(getPokemon(result, id).reachedLevel).toBe(level);
}

/**
 * 合計価値を検証（±2の許容）
 */
export function expectTotalUsed(result: LevelUpPlanResult, id: string, value: number, tolerance = 2) {
  const actual = getPokemon(result, id).reachableItems.totalSupply;
  expect(actual).toBeGreaterThanOrEqual(value - tolerance);
  expect(actual).toBeLessThanOrEqual(value + tolerance);
}

/**
 * アメブ使用量を検証
 */
export function expectBoostUsed(result: LevelUpPlanResult, id: string, value: number) {
  expect(getPokemon(result, id).reachableItems.boostCount).toBe(value);
}

/**
 * 通常アメ使用量を検証
 */
export function expectNormalUsed(result: LevelUpPlanResult, id: string, value: number) {
  expect(getPokemon(result, id).reachableItems.normalCount).toBe(value);
}

/**
 * 合計アメブ使用量がグローバル上限以下か検証
 */
export function expectTotalBoostWithinLimit(result: LevelUpPlanResult, limit: number) {
  const total = result.pokemons.reduce((sum, p) => sum + p.reachableItems.boostCount, 0);
  expect(total).toBeLessThanOrEqual(limit);
}

/**
 * 合計かけら使用量がグローバル上限以下か検証
 */
export function expectTotalShardsWithinLimit(result: LevelUpPlanResult, limit: number) {
  const total = result.pokemons.reduce((sum, p) => sum + p.reachableItems.shardsCount, 0);
  expect(total).toBeLessThanOrEqual(limit);
}

// ============================================================
// Invariants検証（包括的）
// ============================================================

import type { PokemonLevelUpResult } from '../types';

export type InvariantContext = {
  globalBoostLimit: number;
  globalShardsLimit: number;
  boostKind: 'none' | 'mini' | 'full';
};

/**
 * 単一ポケモンのInvariants検証（旧テストから移植）
 */
export function validatePokemonInvariants(
  p: PokemonLevelUpResult,
  ctx: InvariantContext,
  label: string
): void {
  const prefix = `[${label}]`;

  // === 非負数チェック ===
  expect(p.shortage.boost).toBeGreaterThanOrEqual(0);
  expect(p.shortage.normal).toBeGreaterThanOrEqual(0);
  expect(p.shortage.candy).toBeGreaterThanOrEqual(0);
  expect(p.shortage.shards).toBeGreaterThanOrEqual(0);
  expect(p.reachableItems.shardsCount).toBeGreaterThanOrEqual(0);
  expect(p.reachableItems.boostCount).toBeGreaterThanOrEqual(0);
  expect(p.reachableItems.normalCount).toBeGreaterThanOrEqual(0);
  expect(p.reachableItems.totalSupply).toBeGreaterThanOrEqual(0);
  expect(p.reachableItems.speciesCandy).toBeGreaterThanOrEqual(0);
  expect(p.reachableItems.typeS).toBeGreaterThanOrEqual(0);
  expect(p.reachableItems.typeM).toBeGreaterThanOrEqual(0);
  expect(p.reachableItems.universalS).toBeGreaterThanOrEqual(0);
  expect(p.reachableItems.universalM).toBeGreaterThanOrEqual(0);
  expect(p.reachableItems.universalL).toBeGreaterThanOrEqual(0);
  expect(p.reachableItems.surplus).toBeGreaterThanOrEqual(0);

  // === レベル整合性 ===
  expect(p.reachedLevel).toBeGreaterThanOrEqual(p.srcLevel);
  expect(p.reachedLevel).toBeLessThanOrEqual(p.dstLevel);

  // === 制限整合性 ===
  expect(p.reachableItems.boostCount).toBeLessThanOrEqual(p.boostOrExpAdjustment + 2);
  expect(p.reachableItems.totalSupply).toBeLessThanOrEqual(p.candyNeed + 2);

  // 個数指定がある場合（アメ合計 = totalCandyCount）
  if (p.candyTarget !== undefined) {
    expect(p.reachableItems.totalCandyCount).toBeLessThanOrEqual(p.candyTarget + 2);
  }

  // boostKind = none の場合
  if (ctx.boostKind === 'none') {
    expect(p.reachableItems.boostCount).toBe(0);
  }

  // === diagnosis.limitingFactor整合性 ===
  if (p.reachedLevel >= p.dstLevel) {
    // 目標到達時は不足なし
    expect(p.diagnosis.limitingFactor).toBeNull();
  }

  // === limitingFactor 整合性 ===
  // limitingFactor が示す項目の shortage > 0 のみ検証
  // 他の shortage が 0 かどうかは状況依存（複数リソースの不足がありえる）

  if (p.diagnosis.limitingFactor === 'shards') {
    expect(p.shortage.shards).toBeGreaterThan(0);
  }

  if (p.diagnosis.limitingFactor === 'boost') {
    expect(p.shortage.boost).toBeGreaterThan(0);
  }

  if (p.diagnosis.limitingFactor === 'candy') {
    expect(p.shortage.candy).toBeGreaterThan(0);
  }

  // === アイテム価値整合性 ===
  // 目標到達時のみ検証
  if (p.reachedLevel >= p.dstLevel) {
    const itemValue =
      p.reachableItems.speciesCandy +
      p.reachableItems.typeS * 4 +
      p.reachableItems.typeM * 25 +
      p.reachableItems.universalS * 3 +
      p.reachableItems.universalM * 20 +
      p.reachableItems.universalL * 100;

    // totalSupply + surplus ≈ itemValue
    expect(Math.abs(itemValue - (p.reachableItems.totalSupply + p.reachableItems.surplus))).toBeLessThanOrEqual(2);
  }
}

/**
 * 複数ポケモン配分のInvariants検証
 */
export function validateAllocationInvariants(
  result: LevelUpPlanResult,
  ctx: InvariantContext,
  inventory: CandyInventory,
  label: string
): void {
  // 各ポケモンの検証
  for (const p of result.pokemons) {
    validatePokemonInvariants(p, ctx, label);
  }

  // === グローバルアメブ整合性 ===
  const totalBoostUsed = result.pokemons.reduce((sum, p) => sum + p.reachableItems.boostCount, 0);
  expect(totalBoostUsed).toBeLessThanOrEqual(ctx.globalBoostLimit);

  // === グローバルかけら整合性 ===
  if (ctx.globalShardsLimit !== Infinity) {
    const totalShardsUsed = result.pokemons.reduce((sum, p) => sum + p.reachableItems.shardsCount, 0);
    expect(totalShardsUsed).toBeLessThanOrEqual(ctx.globalShardsLimit);
  }

  // === 在庫整合性 ===
  expect(result.universalUsed.s).toBeLessThanOrEqual(inventory.universal.s);
  expect(result.universalUsed.m).toBeLessThanOrEqual(inventory.universal.m);
  expect(result.universalUsed.l).toBeLessThanOrEqual(inventory.universal.l);
}
