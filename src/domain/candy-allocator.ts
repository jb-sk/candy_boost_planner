/**
 * アメ配分アルゴリズム
 *
 * 優先順位:
 * 1. ポケモンのアメ（種族固有、1:1）
 * 2. タイプアメS（分割OK、1個=4アメ）→ タイプアメM（分割不可、1個=25アメ）
 * 3. 万能アメS（分割OK、1個=3アメ）→ 万能アメM（分割不可、1個=20アメ）→ 万能アメL（分割不可、1個=100アメ）
 */

import type { CandyInventoryV1, TypeCandyInventory, UniversalCandyInventory } from "../persistence/candy";
import { CANDY_VALUES } from "../persistence/candy";

export type PokemonCandyNeed = {
  id: string;
  pokedexId: number;
  pokemonName: string;
  type: string;  // タイプ名（英語）
  candyNeed: number;  // 必要アメ数
};

export type PokemonAllocation = PokemonCandyNeed & {
  remaining: number;
  speciesCandyUsed: number;
  typeSUsed: number;
  typeMUsed: number;
  uniSUsed: number;
  uniMUsed: number;
  uniLUsed: number;
};

export type AllocationSummary = {
  /** 各ポケモンの配分結果 */
  pokemons: PokemonAllocation[];

  /** 万能アメ使用量 */
  universalUsed: UniversalCandyInventory;
  universalRemaining: UniversalCandyInventory;

  /** タイプアメ使用量（タイプごと） */
  typeCandyUsed: Record<string, TypeCandyInventory>;

  /** 種族アメ使用量（pokedexIdごと） */
  speciesCandyUsed: Record<string, number>;

  /** 不足しているポケモン */
  shortages: Array<{ id: string; pokemonName: string; shortage: number }>;

  /** 総必要アメ数 */
  totalNeed: number;
  /** 総供給アメ数（使用した分） */
  totalSupplied: number;
};

/**
 * アメを配分する
 * @param needs 各ポケモンの必要アメ数
 * @param inventory 在庫（コピーして使用、元は変更しない）
 */
export function allocateCandy(
  needs: PokemonCandyNeed[],
  inventory: CandyInventoryV1
): AllocationSummary {
  // 在庫をコピー（元を変更しない）
  const inv: CandyInventoryV1 = JSON.parse(JSON.stringify(inventory));

  // 配分結果を初期化
  const pokemons: PokemonAllocation[] = needs.map(n => ({
    ...n,
    remaining: n.candyNeed,
    speciesCandyUsed: 0,
    typeSUsed: 0,
    typeMUsed: 0,
    uniSUsed: 0,
    uniMUsed: 0,
    uniLUsed: 0,
  }));

  // Phase 1: ポケモンのアメを適用
  for (const p of pokemons) {
    const available = inv.species[String(p.pokedexId)] ?? 0;
    const used = Math.min(p.remaining, available);
    p.speciesCandyUsed = used;
    p.remaining -= used;
    inv.species[String(p.pokedexId)] = available - used;
  }

  // Phase 2: タイプアメを適用
  // 2a. タイプアメS（分割OK）
  for (const p of pokemons) {
    if (p.remaining <= 0) continue;
    const typeInv = inv.typeCandy[p.type];
    if (!typeInv || typeInv.s <= 0) continue;

    const sNeeded = Math.floor(p.remaining / CANDY_VALUES.type.s);
    const sUsed = Math.min(sNeeded, typeInv.s);
    p.typeSUsed = sUsed;
    p.remaining -= sUsed * CANDY_VALUES.type.s;
    typeInv.s -= sUsed;
  }

  // 2b. タイプアメM（分割不可、必要量降順で割当）
  const byType = groupBy(pokemons, p => p.type);
  for (const [type, group] of Object.entries(byType)) {
    const typeInv = inv.typeCandy[type];
    if (!typeInv || typeInv.m <= 0) continue;

    // 残り必要量が多い順にソート
    group.sort((a, b) => b.remaining - a.remaining);

    for (const p of group) {
      while (p.remaining > 0 && typeInv.m > 0) {
        typeInv.m--;
        p.typeMUsed++;
        p.remaining = Math.max(0, p.remaining - CANDY_VALUES.type.m);
      }
    }
  }

  // Phase 3: 万能アメを適用
  // 3a. 万能アメS（分割OK）
  for (const p of pokemons) {
    if (p.remaining <= 0) continue;
    if (inv.universal.s <= 0) continue;

    const sNeeded = Math.floor(p.remaining / CANDY_VALUES.universal.s);
    const sUsed = Math.min(sNeeded, inv.universal.s);
    p.uniSUsed = sUsed;
    p.remaining -= sUsed * CANDY_VALUES.universal.s;
    inv.universal.s -= sUsed;
  }

  // 3b. 万能アメM（分割不可、必要量降順で割当）
  pokemons.sort((a, b) => b.remaining - a.remaining);
  for (const p of pokemons) {
    while (p.remaining > 0 && inv.universal.m > 0) {
      inv.universal.m--;
      p.uniMUsed++;
      p.remaining = Math.max(0, p.remaining - CANDY_VALUES.universal.m);
    }
  }

  // 3c. 万能アメL（分割不可、必要量降順で割当）
  for (const p of pokemons) {
    while (p.remaining > 0 && inv.universal.l > 0) {
      inv.universal.l--;
      p.uniLUsed++;
      p.remaining = Math.max(0, p.remaining - CANDY_VALUES.universal.l);
    }
  }

  // サマリー作成
  const shortages = pokemons
    .filter(p => p.remaining > 0)
    .map(p => ({ id: p.id, pokemonName: p.pokemonName, shortage: p.remaining }));

  const universalUsed: UniversalCandyInventory = {
    s: inventory.universal.s - inv.universal.s,
    m: inventory.universal.m - inv.universal.m,
    l: inventory.universal.l - inv.universal.l,
  };

  const typeCandyUsed: Record<string, TypeCandyInventory> = {};
  for (const [type, origInv] of Object.entries(inventory.typeCandy)) {
    const nowInv = inv.typeCandy[type] ?? { s: 0, m: 0 };
    typeCandyUsed[type] = {
      s: origInv.s - nowInv.s,
      m: origInv.m - nowInv.m,
    };
  }

  const speciesCandyUsed: Record<string, number> = {};
  for (const p of pokemons) {
    if (p.speciesCandyUsed > 0) {
      speciesCandyUsed[String(p.pokedexId)] =
        (speciesCandyUsed[String(p.pokedexId)] ?? 0) + p.speciesCandyUsed;
    }
  }

  const totalNeed = needs.reduce((sum, n) => sum + n.candyNeed, 0);
  const totalSupplied = pokemons.reduce((sum, p) => sum + (p.candyNeed - p.remaining), 0);

  return {
    pokemons,
    universalUsed,
    universalRemaining: inv.universal,
    typeCandyUsed,
    speciesCandyUsed,
    shortages,
    totalNeed,
    totalSupplied,
  };
}

// ユーティリティ
function groupBy<T>(arr: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of arr) {
    const key = keyFn(item);
    if (!out[key]) out[key] = [];
    out[key].push(item);
  }
  return out;
}
