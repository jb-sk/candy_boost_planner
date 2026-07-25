import type { LevelPlannerInput } from './types';

/**
 * JSONのキー順に依存しない canonical JSON。
 * 配列の順序は solver の優先順位を表すため維持する。
 */
export function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (typeof item === 'number') {
      if (Number.isNaN(item)) return 'NaN';
      if (item === Number.POSITIVE_INFINITY) return 'Infinity';
      if (item === Number.NEGATIVE_INFINITY) return '-Infinity';
      if (Object.is(item, -0)) return 0;
      return item;
    }
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      const object = item as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(object).sort().map(key => [key, normalize(object[key])]),
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

export function buildPlannerInputSignature(input: LevelPlannerInput): string {
  return canonicalJson(input);
}

/** 構造変更判定専用。数値入力・在庫・boostは含めない。 */
export function buildPlannerStructureSignature(input: LevelPlannerInput): string {
  return canonicalJson({
    rowCount: input.pokemonList.length,
    rows: input.pokemonList.map(pokemon => ({
      pokemonId: pokemon.pokemonId,
      pokedexId: pokemon.pokedexId,
      candyFamilyKey: pokemon.candyFamilyKey,
      type: pokemon.type,
      nature: pokemon.nature,
      hasCandyTarget: pokemon.candyTarget !== undefined,
    })),
  });
}

/** 構造未変更でも2秒判定をやり直す変更の署名。 */
export function buildPlannerProbeSignature(input: LevelPlannerInput): string {
  return canonicalJson({
    boost: input.boost,
    dreamShards: input.dreamShards,
    candyInventory: input.candyInventory,
    options: input.options,
    rows: input.pokemonList.map(pokemon => ({
      pokemonId: pokemon.pokemonId,
      candyTarget: pokemon.candyTarget ?? null,
      // アメブ自動最大化による必要アメ再計算も再probe対象にする。
      requestedBoostCandy: pokemon.requestedBoostCandy,
    })),
  });
}
