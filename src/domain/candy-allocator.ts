/**
 * アメ配分アルゴリズム
 *
 * 【アメ価値】
 * - ポケモンのアメ: 1
 * - タイプアメS: 4
 * - タイプアメM: 25
 * - 万能アメS: 3
 * - 万能アメM: 20
 * - 万能アメL: 100
 *
 * 【使用優先度】
 * ポケモンのアメ > タイプS > タイプM > 万能S > 万能M > 万能L
 *
 * 【目標】
 * - バッグ圧縮: Sを優先的に使用
 * - 余りの最小化: 各ポケモンの余り?2
 * - リスト順の尊重: 上位のポケモンを優先
 *
 * 【アルゴリズム】
 * 1. 各ポケモンの端数調整用に万能Sを事前確保
 * 2. 残りのSで上位ポケモンから配分
 * 3. 不足分をM/Lで補填
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
  /** アメ余り（供給量 - 必要量）、0以上の場合のみ表示 */
  surplus: number;
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
    surplus: 0,
  }));

  // ========================================
  // Phase 1: ポケモンのアメを適用
  // ========================================
  for (const p of pokemons) {
    const available = inv.species[String(p.pokedexId)] ?? 0;
    const used = Math.min(p.remaining, available);
    p.speciesCandyUsed = used;
    p.remaining -= used;
    inv.species[String(p.pokedexId)] = available - used;
  }

  // ========================================
  // Phase 2: タイプアメを適用
  // ========================================
  // 2a. タイプアメS（分割OK、4単位）
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

  // 2b. タイプアメM（25単位、端数が出るので慎重に）
  for (const p of pokemons) {
    if (p.remaining <= 0) continue;
    const typeInv = inv.typeCandy[p.type];
    if (!typeInv || typeInv.m <= 0) continue;

    const mNeeded = Math.floor(p.remaining / CANDY_VALUES.type.m);
    const mUsed = Math.min(mNeeded, typeInv.m);
    p.typeMUsed = mUsed;
    p.remaining -= mUsed * CANDY_VALUES.type.m;
    typeInv.m -= mUsed;
  }

  // ========================================
  // Phase 3: 万能アメの配分（3ケースアプローチ）
  // ========================================
  //
  // ケース1: Sのみで十分 → Sのみ使用（余り≤2保証、バッグ圧縮最大）
  // ケース2: S+Mで十分 → 最小限のM + 残りをS（L温存）
  // ケース3: S+M+Lが必要 → 最小限のL + 最小限のM + 残りをS
  //
  // 各ポケモンで「最小限のL → 最小限のM → 残りをS」の順で探索
  // これにより余り≤2を保証しつつ、L/Mを温存

  // まず全体でどのケースかを判定
  const totalSOnlyNeeded = pokemons
    .filter(p => p.remaining > 0)
    .reduce((sum, p) => sum + Math.ceil(p.remaining / CANDY_VALUES.universal.s), 0);

  if (totalSOnlyNeeded <= inv.universal.s) {
    // ケース1: Sのみで十分
    for (const p of pokemons) {
      if (p.remaining <= 0) continue;
      const sNeeded = Math.ceil(p.remaining / CANDY_VALUES.universal.s);
      p.uniSUsed = sNeeded;
      p.remaining = 0;
      inv.universal.s -= sNeeded;
    }
  } else {
    // ケース2または3: S+M または S+M+L が必要
    // 各ポケモンに対して、最小限のL/Mを使い、残りをSで調整する組み合わせを探す

    for (const p of pokemons) {
      if (p.remaining <= 0) continue;

      const need = p.remaining;
      let found = false;

      // 優先順位: L=0 → L=1 → L=2 → ...（Lを温存）
      // 各Lに対して: M=0 → M=1 → M=2 → ...（Mを温存）
      // 各(L,M)に対して: Sで調整可能か、または(L,M)だけで余り≤2か

      for (let l = 0; l <= inv.universal.l && !found; l++) {
        const afterL = need - l * CANDY_VALUES.universal.l;

        // Lだけで足りる場合（余り≤2）
        if (afterL <= 0 && -afterL <= 2) {
          p.uniLUsed = l;
          inv.universal.l -= l;
          p.remaining = 0;
          found = true;
          break;
        }
        if (afterL <= 0) continue; // 余り>2なのでスキップ

        for (let m = 0; m <= inv.universal.m && !found; m++) {
          const afterM = afterL - m * CANDY_VALUES.universal.m;

          // L+Mだけで足りる場合（余り≤2）
          if (afterM <= 0 && -afterM <= 2) {
            p.uniLUsed = l;
            p.uniMUsed = m;
            inv.universal.l -= l;
            inv.universal.m -= m;
            p.remaining = 0;
            found = true;
            break;
          }
          if (afterM <= 0) continue; // 余り>2なのでスキップ

          // Sで調整（余り≤2を保証）
          const sNeeded = Math.ceil(afterM / CANDY_VALUES.universal.s);
          if (sNeeded <= inv.universal.s) {
            p.uniLUsed = l;
            p.uniMUsed = m;
            p.uniSUsed = sNeeded;
            inv.universal.l -= l;
            inv.universal.m -= m;
            inv.universal.s -= sNeeded;
            p.remaining = 0;
            found = true;
            break;
          }
        }
      }

      // 解が見つからない場合（在庫不足）、貪欲に配分
      if (!found) {
        let remaining = need;

        // まずSを使い切る
        if (inv.universal.s > 0) {
          const sUsed = inv.universal.s;
          p.uniSUsed = sUsed;
          remaining -= sUsed * CANDY_VALUES.universal.s;
          inv.universal.s = 0;
        }

        // 次にMで補填
        if (remaining > 0 && inv.universal.m > 0) {
          const mUsed = Math.min(Math.ceil(remaining / CANDY_VALUES.universal.m), inv.universal.m);
          p.uniMUsed = mUsed;
          remaining -= mUsed * CANDY_VALUES.universal.m;
          inv.universal.m -= mUsed;
        }

        // 最後にLで補填
        if (remaining > 0 && inv.universal.l > 0) {
          const lUsed = Math.min(Math.ceil(remaining / CANDY_VALUES.universal.l), inv.universal.l);
          p.uniLUsed = lUsed;
          remaining -= lUsed * CANDY_VALUES.universal.l;
          inv.universal.l -= lUsed;
        }

        p.remaining = Math.max(0, remaining);
      }
    }
  }

  // ========================================
  // 余りと統計を計算
  // ========================================
  for (const p of pokemons) {
    const totalSupplied =
      p.speciesCandyUsed +
      p.typeSUsed * CANDY_VALUES.type.s +
      p.typeMUsed * CANDY_VALUES.type.m +
      p.uniSUsed * CANDY_VALUES.universal.s +
      p.uniMUsed * CANDY_VALUES.universal.m +
      p.uniLUsed * CANDY_VALUES.universal.l;
    p.surplus = Math.max(0, totalSupplied - p.candyNeed);
    p.remaining = Math.max(0, p.candyNeed - totalSupplied);
  }

  // サマリー作成
  const shortages = pokemons
    .filter(p => p.remaining > 0)
    .map(p => ({ id: p.id, pokemonName: p.pokemonName, shortage: p.remaining }));

  const totalSUsed = pokemons.reduce((sum, p) => sum + p.uniSUsed, 0);

  const universalUsed: UniversalCandyInventory = {
    s: totalSUsed,
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
    universalRemaining: {
      s: inventory.universal.s - totalSUsed,
      m: inv.universal.m,
      l: inv.universal.l,
    },
    typeCandyUsed,
    speciesCandyUsed,
    shortages,
    totalNeed,
    totalSupplied,
  };
}
