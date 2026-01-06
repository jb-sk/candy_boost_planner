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
import { calcLevelByCandy, calcLevelByCandyAndShards, calcExp, calcExpAndCandy, calcExpAndCandyMixed, calcCandyAndShardsForLevelMixed, calcExpPerCandy } from "./pokesleep/exp";
import type { ExpType, ExpGainNature } from "./types";

export type PokemonCandyNeed = {
  id: string;
  pokedexId: number;
  pokemonName: string;
  type: string;  // タイプ名（英語）
  candyNeed: number;  // 必要アメ数
  /** 必要EXP（ピークベース） */
  expNeed: number;
  /** アメ1個あたりのEXP（性格・ブースト込み） */
  expPerCandy: number;
  /** アメ上限（アメ価値、未設定は制限なし）@deprecated candyTarget を使用 */
  uniCandyLimit?: number;
  /** アメ個数指定（新UI用、uniCandyLimitのエイリアス） */
  candyTarget?: number;
  /** 現在Lv */
  srcLevel: number;
  /** 目標Lv */
  dstLevel: number;
  /** EXPタイプ */
  expType: ExpType;
  /** 性格（EXP補正） */
  nature: ExpGainNature;
  /** 現在Lv内の獲得済みEXP（次Lvまでの残りEXPから逆算） */
  expGot: number;
  /** このポケモンのアメブ上限（必要アメ × 割合 or 指定個数） */
  boostCandyLimit: number;
  /** 逆算モード: 在庫を無視してアメ使用制限から直接計算 */
  isReverseCalcMode?: boolean;
};

export type PokemonAllocation = PokemonCandyNeed & {
  remaining: number;
  /** 補填前のアメ不足（targetAllocationMap用、通常は0） */
  originalRemaining?: number;
  /** 不足分のEXP換算値 */
  remainingExp: number;
  /** アメ配分後の到達Lv */
  reachedLevel: number;
  /** 到達Lvでの次レベルまでのあとEXP */
  reachedLevelExpLeft: number;
  speciesCandyUsed: number;
  typeSUsed: number;
  typeMUsed: number;
  uniSUsed: number;
  uniMUsed: number;
  uniLUsed: number;
  /** アメ余り（供給量 - 必要量）、0以上の場合のみ表示 */
  surplus: number;
  /** 使用アメの合計（価値換算） */
  totalUsed: number;
  /** 使用アメのうちアメブ分 */
  boostCandyUsed: number;
  /** 使用アメのうち通常分 */
  normalCandyUsed: number;
  /** 使用かけら */
  shardsUsed: number;
  /** かけら不足量（目標Lvのかけら - 配分されたかけら） */
  shardsShortage: number;
  /** アメブ不足量（個数指定に対するアメブ理論値 - 実際のアメブ使用量） */
  boostShortage: number;
  /** 主要な制限要因（到達できなかった主な理由） */
  primaryShortageType: "boost" | "candy" | "shards" | null;
  /** グローバルアメブが足りていたか（Phase 5で計算） */
  globalBoostSufficient?: boolean;
  /** 各制限ごとの到達Lv（Phase 6で比較用） */
  reachableLevelByCandy?: number;   // アメ在庫のみで到達可能なLv
  reachableLevelByBoost?: number;   // アメブ制限を加えて到達可能なLv
  reachableLevelByShards?: number;  // かけら制限を加えて到達可能なLv
  /** 各制限ごとの到達Lv内で稼いだEXP（Lvが同じ場合の比較用） */
  reachableExpByCandy?: number;     // アメ在庫のみで到達Lv内で稼いだEXP
  reachableExpByBoost?: number;     // アメブ制限適用後のEXP
  reachableExpByShards?: number;    // かけら制限適用後のEXP
  /** Phase 5で最後にLvを下げた制限（主要な制限要因） */
  limitingFactor?: "boost" | "candy" | "shards" | null;
  /** 配分時点のリソース残数（不足計算用） */
  availableBoostAtAllocation?: number;  // 配分時点のグローバルアメブ残数
  availableShardsAtAllocation?: number; // 配分時点のグローバルかけら残数
  availableCandyAtAllocation?: number;  // 配分時点のアメ在庫価値
  availableUniSAtAllocation?: number;   // 配分時点の万能S残数
  /** 理論値（不足計算用） */
  theoreticalBoost?: number;  // アメブ理論値
  theoreticalShards?: number; // かけら理論値
  /** 補填前のアイテム使用量（個数指定行用、uniCandyLimitベース） */
  limitTypeSUsed?: number;
  limitTypeMUsed?: number;
  limitUniSUsed?: number;
  limitUniMUsed?: number;
  limitUniLUsed?: number;
  limitSurplus?: number;
  limitTotalUsed?: number;
  limitBoostCandyUsed?: number;
  limitShardsUsed?: number;
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

  /** アメ不足しているポケモン */
  shortages: Array<{ id: string; pokemonName: string; shortage: number }>;

  /** かけら不足しているポケモン */
  shardsShortages: Array<{ id: string; pokemonName: string; shortage: number }>;

  /** 総必要アメ数 */
  totalNeed: number;
  /** 総供給アメ数（使用した分） */
  totalSupplied: number;
};
/**
 * 解の比較関数（タイプアメ＋万能アメ）
 *
 * 比較順序（辞書順）:
 * 1. 余り ≤ 2 か？（満たす方が優先）
 * 2. タイプアメS使用数が多い
 * 3. タイプアメM使用数が多い
 * 4. 万能アメS使用数が多い
 * 5. 万能アメM使用数が多い
 * 6. 万能アメL使用数が少ない
 * 7. 余りが小さい
 *
 * @returns aがbより良い場合true
 */
function isBetterAllocation(
  a: { typeS: number; typeM: number; uniS: number; uniM: number; uniL: number; supplied: number },
  b: { typeS: number; typeM: number; uniS: number; uniM: number; uniL: number; supplied: number },
  targetValue: number
): boolean {
  const surplusA = a.supplied - targetValue;
  const surplusB = b.supplied - targetValue;
  const within2A = surplusA <= 2;
  const within2B = surplusB <= 2;

  // 1. 余り≤2を満たす解は、満たさない解より常に優先
  if (within2A && !within2B) return true;
  if (!within2A && within2B) return false;

  if (within2A && within2B) {
    // 両方余り≤2: 優先順位で比較（多いほど良い、Lは少ないほど良い）
    if (a.typeS !== b.typeS) return a.typeS > b.typeS;
    if (a.typeM !== b.typeM) return a.typeM > b.typeM;
    if (a.uniS !== b.uniS) return a.uniS > b.uniS;
    if (a.uniM !== b.uniM) return a.uniM > b.uniM;
    if (a.uniL !== b.uniL) return a.uniL < b.uniL;
    // 全て同じなら余りが小さい方
    return surplusA < surplusB;
  } else {
    // 両方余り>2: まず余りが小さい方、同じなら優先順位
    if (surplusA !== surplusB) return surplusA < surplusB;
    if (a.typeS !== b.typeS) return a.typeS > b.typeS;
    if (a.typeM !== b.typeM) return a.typeM > b.typeM;
    if (a.uniS !== b.uniS) return a.uniS > b.uniS;
    if (a.uniM !== b.uniM) return a.uniM > b.uniM;
    if (a.uniL !== b.uniL) return a.uniL < b.uniL;
    return false; // 完全に同じ
  }
}

/**
 * 使用制限がある場合の最適なアイテム配分を探す
 * タイプS, タイプM, 万能S, 万能M, 万能L の組み合わせで探索
 *
 * これは「優先順位付き配分問題」であり、最適化問題ではない。
 * 唯一の最適化基準は「使用優先順位」である。
 *
 * @param targetValue 必要な価値（この値以上を供給する配分を探す）
 * @param typeInv タイプアメ在庫
 * @param uniInv 万能アメ在庫
 * @returns 最適な配分と供給価値
 *
 * 使用優先順位（絶対）:
 * タイプS > タイプM > 万能S > 万能M > 万能L
 *
 * 余りルール:
 * 1. 可能な限り余り≤2にする
 * 2. 余り≤2が不可能な場合、余りが最小になる組み合わせを選ぶ
 */
function findBestAllocationWithLimit(
  targetValue: number,
  typeInv: { s: number; m: number },
  uniInv: { s: number; m: number; l: number }
): {
  typeS: number; typeM: number;
  uniS: number; uniM: number; uniL: number;
  supplied: number;
} {
  if (targetValue <= 0) {
    return { typeS: 0, typeM: 0, uniS: 0, uniM: 0, uniL: 0, supplied: 0 };
  }

  type Result = {
    typeS: number; typeM: number;
    uniS: number; uniM: number; uniL: number;
    supplied: number;
  };

  let best: Result | null = null;

  // 完全探索：全ての有効な候補を評価し、比較関数で最良解を決定
  // ⚠️ 探索順で優先度を表現しない。必ず全候補を評価する。
  for (let typeS = 0; typeS <= typeInv.s; typeS++) {
    for (let typeM = 0; typeM <= typeInv.m; typeM++) {
      for (let uniS = 0; uniS <= uniInv.s; uniS++) {
        for (let uniM = 0; uniM <= uniInv.m; uniM++) {
          for (let uniL = 0; uniL <= uniInv.l; uniL++) {
            const supplied =
              typeS * CANDY_VALUES.type.s +
              typeM * CANDY_VALUES.type.m +
              uniS * CANDY_VALUES.universal.s +
              uniM * CANDY_VALUES.universal.m +
              uniL * CANDY_VALUES.universal.l;

            // 必要量を満たさない解は除外
            if (supplied < targetValue) continue;

            const candidate: Result = { typeS, typeM, uniS, uniM, uniL, supplied };

            // 比較関数で最良解を更新
            if (!best || isBetterAllocation(candidate, best, targetValue)) {
              best = candidate;
            }
          }
        }
      }
    }
  }

  if (!best) {
    // 在庫全部使っても足りない場合
    const totalSupply =
      typeInv.s * CANDY_VALUES.type.s +
      typeInv.m * CANDY_VALUES.type.m +
      uniInv.s * CANDY_VALUES.universal.s +
      uniInv.m * CANDY_VALUES.universal.m +
      uniInv.l * CANDY_VALUES.universal.l;
    return {
      typeS: typeInv.s,
      typeM: typeInv.m,
      uniS: uniInv.s,
      uniM: uniInv.m,
      uniL: uniInv.l,
      supplied: totalSupply
    };
  }

  return best;
}

/**
 * 解の比較関数（万能アメのみ）
 *
 * 比較順序（辞書順）:
 * 1. 余り ≤ 2 か？（満たす方が優先）
 * 2. 万能アメS使用数が多い
 * 3. 万能アメM使用数が多い
 * 4. 万能アメL使用数が少ない
 * 5. 余りが小さい
 *
 * @returns aがbより良い場合true
 */
function isBetterUniversalAllocation(
  a: { s: number; m: number; l: number; supplied: number },
  b: { s: number; m: number; l: number; supplied: number },
  targetValue: number
): boolean {
  const surplusA = a.supplied - targetValue;
  const surplusB = b.supplied - targetValue;
  const within2A = surplusA <= 2;
  const within2B = surplusB <= 2;

  // 1. 余り≤2を満たす解は、満たさない解より常に優先
  if (within2A && !within2B) return true;
  if (!within2A && within2B) return false;

  if (within2A && within2B) {
    // 両方余り≤2: 優先順位で比較（S/Mは多いほど良い、Lは少ないほど良い）
    if (a.s !== b.s) return a.s > b.s;
    if (a.m !== b.m) return a.m > b.m;
    if (a.l !== b.l) return a.l < b.l;
    // 全て同じなら余りが小さい方
    return surplusA < surplusB;
  } else {
    // 両方余り>2: まず余りが小さい方、同じなら優先順位
    if (surplusA !== surplusB) return surplusA < surplusB;
    if (a.s !== b.s) return a.s > b.s;
    if (a.m !== b.m) return a.m > b.m;
    if (a.l !== b.l) return a.l < b.l;
    return false; // 完全に同じ
  }
}

/**
 * 万能アメのみで最適な組み合わせを探す
 *
 * これは「優先順位付き配分問題」であり、最適化問題ではない。
 * 唯一の最適化基準は「使用優先順位」である。
 *
 * @param targetValue 必要な価値（この値以上を供給する配分を探す）
 * @param inv 万能アメ在庫
 * @returns 最適な組み合わせと供給価値
 *
 * 使用優先順位（絶対）:
 * 万能S > 万能M > 万能L
 *
 * 余りルール:
 * 1. 可能な限り余り≤2にする（端数調整は万能Sのみで行う）
 * 2. 余り≤2が不可能な場合、余りが最小になる組み合わせを選ぶ
 */
function findBestCombinationWithinLimit(
  targetValue: number,
  inv: { s: number; m: number; l: number }
): { s: number; m: number; l: number; supplied: number } {
  if (targetValue <= 0) {
    return { s: 0, m: 0, l: 0, supplied: 0 };
  }

  const S_VAL = CANDY_VALUES.universal.s;
  const M_VAL = CANDY_VALUES.universal.m;
  const L_VAL = CANDY_VALUES.universal.l;

  type Result = { s: number; m: number; l: number; supplied: number };

  let best: Result | null = null;

  // 完全探索：全ての有効な候補を評価し、比較関数で最良解を決定
  // ⚠️ 探索順で優先度を表現しない。必ず全候補を評価する。
  // ⚠️ break / continue で評価を省略しない。
  for (let l = 0; l <= inv.l; l++) {
    for (let m = 0; m <= inv.m; m++) {
      for (let s = 0; s <= inv.s; s++) {
        const supplied = s * S_VAL + m * M_VAL + l * L_VAL;

        // 必要量を満たさない解は除外
        if (supplied < targetValue) continue;

        const candidate: Result = { s, m, l, supplied };

        // 比較関数で最良解を更新
        if (!best || isBetterUniversalAllocation(candidate, best, targetValue)) {
          best = candidate;
        }
      }
    }
  }

  if (!best) {
    // 在庫全部使っても足りない場合
    const totalSupply = inv.s * S_VAL + inv.m * M_VAL + inv.l * L_VAL;
    return { s: inv.s, m: inv.m, l: inv.l, supplied: totalSupply };
  }

  return best;
}

/**
 * 最も制限的な要因を判定する
 * 各制限（アメ在庫、アメブ、かけら）で到達可能なLv+EXPを比較し、
 * 最も低いLv（または同Lvで最小EXP）を引き起こす制限を返す
 *
 * @param candyLv アメ在庫制限での到達Lv
 * @param candyExp アメ在庫制限での到達EXP
 * @param boostLv アメブ制限での到達Lv
 * @param boostExp アメブ制限での到達EXP
 * @param shardsLv かけら制限での到達Lv
 * @param shardsExp かけら制限での到達EXP
 * @returns 最も制限的な要因
 */
function determineLimitingFactor(
  candyLv: number,
  candyExp: number,
  boostLv: number,
  boostExp: number,
  shardsLv: number,
  shardsExp: number
): "boost" | "candy" | "shards" {
  // 3つの制限を(Lv, EXP)のタプルとして比較
  // Lvが低い方が優先、同Lvの場合はEXPが低い方が優先
  // 同値の場合の優先順位: candy > boost > shards（UIで最初に表示される不足を優先）
  type Factor = "boost" | "candy" | "shards";
  const factors: { factor: Factor; lv: number; exp: number }[] = [
    { factor: "candy", lv: candyLv, exp: candyExp },
    { factor: "boost", lv: boostLv, exp: boostExp },
    { factor: "shards", lv: shardsLv, exp: shardsExp },
  ];

  // Lvが低い順、同LvならEXPが低い順にソート
  // 同値の場合は配列順（candy > boost > shards）が維持される
  factors.sort((a, b) => {
    if (a.lv !== b.lv) return a.lv - b.lv;
    return a.exp - b.exp;
  });

  return factors[0].factor;
}

/**
 * Phase 5後の正規化: 到達Lvが決まった後、全派生値を再構築する
 *
 * Phase 1-3で目標Lvを前提に配分されたアイテムを、
 * 到達Lvに必要な量に再調整する。
 *
 * @param p ポケモンの配分状態
 * @param inv 在庫（返却されたアイテムを戻す）
 * @param boostKind ブースト種別
 */
function normalizeAfterPhase5(
  p: PokemonAllocation,
  inv: CandyInventoryV1,
  boostKind: "none" | "mini" | "full"
): void {
  // Phase 1-3で配分されたアイテムの合計価値
  const allocatedValue =
    p.speciesCandyUsed +
    p.typeSUsed * CANDY_VALUES.type.s +
    p.typeMUsed * CANDY_VALUES.type.m +
    p.uniSUsed * CANDY_VALUES.universal.s +
    p.uniMUsed * CANDY_VALUES.universal.m +
    p.uniLUsed * CANDY_VALUES.universal.l;

  // 到達Lvに必要なアメ量（Phase 5で設定されたboostCandyUsed + normalCandyUsedを使用）
  // p.totalUsedはPhase 4で設定された値のままの可能性があるため、
  // より正確なboostCandyUsed + normalCandyUsedを使用
  const neededForReachedLevel = p.boostCandyUsed + p.normalCandyUsed;

  // デバッグログ（スイクンのケース）
  if (p.pokedexId === 245 && p.uniCandyLimit === 1000) {
    console.log(`  [DEBUG normalizeAfterPhase5] neededForReachedLevel=${neededForReachedLevel}, boostCandyUsed=${p.boostCandyUsed}, normalCandyUsed=${p.normalCandyUsed}`);
    console.log(`  [DEBUG normalizeAfterPhase5] pool.uniS=${p.uniSUsed}, allocatedValue=${allocatedValue}`);
  }


  // neededForReachedLevel = 0 の場合、アイテムを全て在庫に戻す
  if (neededForReachedLevel === 0) {
    // 全アイテムを在庫に返却
    if (p.speciesCandyUsed > 0) {
      inv.species[String(p.pokedexId)] = (inv.species[String(p.pokedexId)] ?? 0) + p.speciesCandyUsed;
      p.speciesCandyUsed = 0;
    }
    if (p.typeSUsed > 0 || p.typeMUsed > 0) {
      if (!inv.typeCandy[p.type]) inv.typeCandy[p.type] = { s: 0, m: 0 };
      inv.typeCandy[p.type].s += p.typeSUsed;
      inv.typeCandy[p.type].m += p.typeMUsed;
      p.typeSUsed = 0;
      p.typeMUsed = 0;
    }
    inv.universal.s += p.uniSUsed;
    inv.universal.m += p.uniMUsed;
    inv.universal.l += p.uniLUsed;
    p.uniSUsed = 0;
    p.uniMUsed = 0;
    p.uniLUsed = 0;
    p.totalUsed = 0;
    p.surplus = 0;
    p.remaining = p.candyNeed;
    return;
  }

  // 配分されたアイテムが到達Lvに必要な量と同じか少なければ、調整不要
  if (allocatedValue <= neededForReachedLevel) {
    // 目標Lvに到達した場合は remaining = 0
    // 到達していない場合は candyNeed - allocatedValue
    if (p.reachedLevel >= p.dstLevel) {
      p.remaining = 0;
    } else {
      p.remaining = Math.max(0, p.candyNeed - allocatedValue);
    }
    p.surplus = 0;
    return;
  }

  // === 配分されたアイテムが多すぎる → 余分を在庫に返却 ===

  // 1. 現在配分されているアイテムをプールとして取得
  const pool = {
    species: p.speciesCandyUsed,
    typeS: p.typeSUsed,
    typeM: p.typeMUsed,
    uniS: p.uniSUsed,
    uniM: p.uniMUsed,
    uniL: p.uniLUsed,
  };

  // 2. アイテム使用量をリセット
  p.speciesCandyUsed = 0;
  p.typeSUsed = 0;
  p.typeMUsed = 0;
  p.uniSUsed = 0;
  p.uniMUsed = 0;
  p.uniLUsed = 0;

  // 3. 優先順位で再配分（到達Lvに必要な量まで）
  let remainingNeed = neededForReachedLevel;

  // 種族アメ（価値1、優先度最高）
  if (remainingNeed > 0 && pool.species > 0) {
    const used = Math.min(remainingNeed, pool.species);
    p.speciesCandyUsed = used;
    remainingNeed -= used;
    // 余分を在庫に返却
    const returned = pool.species - used;
    if (returned > 0) {
      inv.species[String(p.pokedexId)] = (inv.species[String(p.pokedexId)] ?? 0) + returned;
    }
  }

  // タイプS（価値4）
  if (remainingNeed > 0 && pool.typeS > 0) {
    const maxUsable = Math.floor(remainingNeed / CANDY_VALUES.type.s);
    const used = Math.min(maxUsable, pool.typeS);
    p.typeSUsed = used;
    remainingNeed -= used * CANDY_VALUES.type.s;
    // 余分を在庫に返却
    const returned = pool.typeS - used;
    if (returned > 0) {
      if (!inv.typeCandy[p.type]) inv.typeCandy[p.type] = { s: 0, m: 0 };
      inv.typeCandy[p.type].s += returned;
    }
  }

  // タイプM（価値25）
  if (remainingNeed > 0 && pool.typeM > 0) {
    const maxUsable = Math.floor(remainingNeed / CANDY_VALUES.type.m);
    const used = Math.min(maxUsable, pool.typeM);
    p.typeMUsed = used;
    remainingNeed -= used * CANDY_VALUES.type.m;
    // 余分を在庫に返却
    const returned = pool.typeM - used;
    if (returned > 0) {
      if (!inv.typeCandy[p.type]) inv.typeCandy[p.type] = { s: 0, m: 0 };
      inv.typeCandy[p.type].m += returned;
    }
  }

  // 万能S（価値3）
  if (remainingNeed > 0 && pool.uniS > 0) {
    const maxUsable = Math.floor(remainingNeed / CANDY_VALUES.universal.s);
    const used = Math.min(maxUsable, pool.uniS);
    p.uniSUsed = used;
    remainingNeed -= used * CANDY_VALUES.universal.s;
    // 余分を在庫に返却
    const returned = pool.uniS - used;
    if (returned > 0) {
      inv.universal.s += returned;
    }
  }

  // 万能M（価値20）
  if (remainingNeed > 0 && pool.uniM > 0) {
    const maxUsable = Math.floor(remainingNeed / CANDY_VALUES.universal.m);
    const used = Math.min(maxUsable, pool.uniM);
    p.uniMUsed = used;
    remainingNeed -= used * CANDY_VALUES.universal.m;
    // 余分を在庫に返却
    const returned = pool.uniM - used;
    if (returned > 0) {
      inv.universal.m += returned;
    }
  }

  // 万能L（価値100）
  if (remainingNeed > 0 && pool.uniL > 0) {
    const maxUsable = Math.floor(remainingNeed / CANDY_VALUES.universal.l);
    const used = Math.min(maxUsable, pool.uniL);
    p.uniLUsed = used;
    remainingNeed -= used * CANDY_VALUES.universal.l;
    // 余分を在庫に返却
    const returned = pool.uniL - used;
    if (returned > 0) {
      inv.universal.l += returned;
    }
  }

  // 端数調整: remainingNeed > 0 の場合、追加で万能Sを使って余り0-2にする
  // （poolにまだ万能Sが残っている場合）
  if (p.pokedexId === 245 && p.uniCandyLimit === 1000) {
    console.log(`  [DEBUG normalizeAfterPhase5 端数調整前] remainingNeed=${remainingNeed}, pool.uniS=${pool.uniS}, p.uniSUsed=${p.uniSUsed}`);
  }
  if (remainingNeed > 0) {
    // 在庫から追加で万能Sを1つ取得できるか確認
    const unusedUniS = pool.uniS - p.uniSUsed;
    if (unusedUniS > 0) {
      p.uniSUsed += 1;
      remainingNeed -= CANDY_VALUES.universal.s;
      // 在庫への返却数を1つ減らす
      inv.universal.s -= 1;
    }
  }
  if (p.pokedexId === 245 && p.uniCandyLimit === 1000) {
    console.log(`  [DEBUG normalizeAfterPhase5 端数調整後] remainingNeed=${remainingNeed}, p.uniSUsed=${p.uniSUsed}`);
  }

  // 4. surplus を再計算（実際に配分されたアイテム価値 - 到達Lvに必要な量）
  const newAllocatedValue =
    p.speciesCandyUsed +
    p.typeSUsed * CANDY_VALUES.type.s +
    p.typeMUsed * CANDY_VALUES.type.m +
    p.uniSUsed * CANDY_VALUES.universal.s +
    p.uniMUsed * CANDY_VALUES.universal.m +
    p.uniLUsed * CANDY_VALUES.universal.l;

  p.surplus = Math.max(0, newAllocatedValue - neededForReachedLevel);

  // 5. totalUsed を実際に配分されたアイテム価値に更新
  // （neededForReachedLevel より少なくなる可能性がある）
  p.totalUsed = Math.min(newAllocatedValue, neededForReachedLevel);

  // 6. remaining を再計算
  // 目標Lvに到達した場合は remaining = 0（candyNeed の計算方法に関係なく）
  // 到達していない場合は candyNeed - totalUsed
  if (p.reachedLevel >= p.dstLevel) {
    p.remaining = 0;
  } else {
    p.remaining = Math.max(0, p.candyNeed - p.totalUsed);
  }
}


/**
 * アメを配分する
 * @param needs 各ポケモンの必要アメ数
 * @param inventory 在庫（コピーして使用、元は変更しない）
 * @param globalBoostRemaining グローバルなアメブ残数
 * @param boostKind ブースト種別（none/mini/full）
 * @param shardsCap かけらの上限（ポケモン全体で使用可能な最大かけら数）
 */
export function allocateCandy(
  needs: PokemonCandyNeed[],
  inventory: CandyInventoryV1,
  globalBoostRemaining: number,
  boostKind: "none" | "mini" | "full",
  shardsCap: number
): AllocationSummary {
  // 在庫をコピー（元を変更しない）
  const inv: CandyInventoryV1 = JSON.parse(JSON.stringify(inventory));

  // candyTarget → uniCandyLimit への互換変換
  // 新UI層は candyTarget を使用、旧アロケータ内部は uniCandyLimit で処理
  for (const n of needs) {
    if (n.candyTarget !== undefined && n.uniCandyLimit === undefined) {
      n.uniCandyLimit = n.candyTarget;
    }
  }

  // 配分結果を初期化
  const pokemons: PokemonAllocation[] = needs.map(n => ({
    ...n,
    remaining: n.candyNeed,
    remainingExp: 0,
    reachedLevel: n.srcLevel,  // 初期値は現在Lv
    reachedLevelExpLeft: 0,
    speciesCandyUsed: 0,
    typeSUsed: 0,
    typeMUsed: 0,
    uniSUsed: 0,
    uniMUsed: 0,
    uniLUsed: 0,
    surplus: 0,
    totalUsed: 0,
    boostCandyUsed: 0,
    normalCandyUsed: 0,
    shardsUsed: 0,
    shardsShortage: 0,
    boostShortage: 0,
    primaryShortageType: null,
  }));

  // ========================================
  // 注意: isReverseCalcMode のポケモンは allocateCandyUnlimited で
  // 別途計算すること。この関数はやりくりモード専用。
  // ========================================

  // ========================================
  // Phase 1: ポケモンのアメを適用（逆算モード以外）
  // ========================================
  for (const p of pokemons) {
    if (p.isReverseCalcMode) continue;  // 逆算モードはスキップ
    const available = inv.species[String(p.pokedexId)] ?? 0;
    const used = Math.min(p.remaining, available);
    p.speciesCandyUsed = used;
    p.remaining -= used;
    inv.species[String(p.pokedexId)] = available - used;
  }

  // ========================================
  // Phase 2: タイプアメと万能アメの配分
  // ========================================
  // 使用制限がある場合: 全アイテムを同時探索して最適配分
  // 使用制限がない場合: タイプS→タイプM→万能の順で配分

  for (const p of pokemons) {
    if (p.isReverseCalcMode) continue;
    if (p.remaining <= 0) continue;

    const typeInv = inv.typeCandy[p.type] ?? { s: 0, m: 0 };
    const usageLimit = p.uniCandyLimit != null ? p.uniCandyLimit : Infinity;
    const alreadyUsed = p.speciesCandyUsed;

    if (usageLimit < Infinity) {
      // 使用制限がある場合: 全アイテムを同時探索
      const targetValue = Math.max(0, usageLimit - alreadyUsed);
      const best = findBestAllocationWithLimit(targetValue, typeInv, inv.universal);

      if (best.supplied > 0) {
        p.typeSUsed = best.typeS;
        p.typeMUsed = best.typeM;
        p.uniSUsed = best.uniS;
        p.uniMUsed = best.uniM;
        p.uniLUsed = best.uniL;
        typeInv.s -= best.typeS;
        typeInv.m -= best.typeM;
        inv.universal.s -= best.uniS;
        inv.universal.m -= best.uniM;
        inv.universal.l -= best.uniL;
        p.remaining -= Math.min(p.remaining, best.supplied);
      }
    } else {
      // 使用制限がない場合: タイプアメ→万能アメの順で配分
      // タイプS
      if (typeInv.s > 0) {
        const sNeeded = Math.floor(p.remaining / CANDY_VALUES.type.s);
        const sUsed = Math.min(sNeeded, typeInv.s);
        p.typeSUsed = sUsed;
        p.remaining -= sUsed * CANDY_VALUES.type.s;
        typeInv.s -= sUsed;
      }
      // タイプM
      if (p.remaining > 0 && typeInv.m > 0) {
        const mNeeded = Math.floor(p.remaining / CANDY_VALUES.type.m);
        const mUsed = Math.min(mNeeded, typeInv.m);
        p.typeMUsed = mUsed;
        p.remaining -= mUsed * CANDY_VALUES.type.m;
        typeInv.m -= mUsed;
      }
      // 万能アメ（リスト順で配分するためここで処理）
      if (p.remaining > 0) {
        const best = findBestCombinationWithinLimit(p.remaining, inv.universal);
        if (best.supplied > 0) {
          p.uniSUsed = best.s;
          p.uniMUsed = best.m;
          p.uniLUsed = best.l;
          inv.universal.s -= best.s;
          inv.universal.m -= best.m;
          inv.universal.l -= best.l;
          p.remaining -= Math.min(p.remaining, best.supplied);
        }
      }
    }
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
  //
  // uniCandyLimit（アメ使用制限）が設定されている場合:
  // - 種族アメ・タイプアメ使用後の残り枠内で万能アメを配分
  // - 上限をぎりぎり超える量を配分し、使用量は後でキャップ

  // まず全体でどのケースかを判定（制限なしで計算）
  const totalSOnlyNeeded = pokemons
    .filter(p => p.remaining > 0 && !p.isReverseCalcMode)  // 逆算モードを除外
    .reduce((sum, p) => {
      return sum + Math.ceil(p.remaining / CANDY_VALUES.universal.s);
    }, 0);

  if (totalSOnlyNeeded <= inv.universal.s) {
    // ケース1: Sのみで十分
    for (const p of pokemons) {
      if (p.isReverseCalcMode) continue;
      if (p.remaining <= 0) continue;
      // 使用制限がある場合は既にPhase 2で処理済み
      if (p.uniCandyLimit != null) continue;

      // 制限がない場合: 必要量をカバー（在庫チェック付き）
      const sNeeded = Math.ceil(p.remaining / CANDY_VALUES.universal.s);
      if (sNeeded <= inv.universal.s) {
        const supplied = sNeeded * CANDY_VALUES.universal.s;
        p.uniSUsed = sNeeded;
        p.remaining -= Math.min(p.remaining, supplied);
        inv.universal.s -= sNeeded;
      } else {
        // 在庫が足りない場合: 可能な限り配分
        const best = findBestCombinationWithinLimit(p.remaining, inv.universal);
        if (best.supplied > 0) {
          p.uniSUsed = best.s;
          p.uniMUsed = best.m;
          p.uniLUsed = best.l;
          inv.universal.s -= best.s;
          inv.universal.m -= best.m;
          inv.universal.l -= best.l;
          p.remaining -= Math.min(p.remaining, best.supplied);
        }
      }
    }
  } else {
    // ケース2または3: S+M または S+M+L が必要
    // 各ポケモンに対して、最小限のL/Mを使い、残りをSで調整する組み合わせを探す

    for (const p of pokemons) {
      if (p.isReverseCalcMode) continue;
      if (p.remaining <= 0) continue;
      // 使用制限がある場合は既にPhase 2で処理済み
      if (p.uniCandyLimit != null) continue;

      // 制限がない場合: 必要量をカバーする配分
      const best = findBestCombinationWithinLimit(p.remaining, inv.universal);
      if (best.supplied > 0) {
        p.uniSUsed = best.s;
        p.uniMUsed = best.m;
        p.uniLUsed = best.l;
        inv.universal.s -= best.s;
        inv.universal.m -= best.m;
        inv.universal.l -= best.l;
        p.remaining -= Math.min(p.remaining, best.supplied);
      }
    }
  }

  // ========================================
  // Phase 4: M/L→Sスワップ（余り≥3のポケモンを調整）
  // ========================================
  // 下位ポケモンのMを上位に渡し、代わりにSを受け取る
  // 上位は余分なSを減らして余り≤2を維持

  for (let i = pokemons.length - 1; i >= 0; i--) {
    const p = pokemons[i];
    if (p.isReverseCalcMode || p.uniCandyLimit != null) continue;

    // 現在の余りを計算
    const currentSupply =
      p.speciesCandyUsed +
      p.typeSUsed * CANDY_VALUES.type.s +
      p.typeMUsed * CANDY_VALUES.type.m +
      p.uniSUsed * CANDY_VALUES.universal.s +
      p.uniMUsed * CANDY_VALUES.universal.m +
      p.uniLUsed * CANDY_VALUES.universal.l;
    const currentSurplus = Math.max(0, currentSupply - p.candyNeed);

    if (currentSurplus <= 2) continue; // 余り≤2なら調整不要

    // 万能アメで埋める必要量
    const originalNeed = p.candyNeed - p.speciesCandyUsed -
      p.typeSUsed * CANDY_VALUES.type.s - p.typeMUsed * CANDY_VALUES.type.m;
    if (originalNeed <= 0) continue;

    // M/Lを減らしてSで補填するパターンを探す（最小S数を探索）
    let bestMToRemove = 0;
    let bestLToRemove = 0;
    let bestSToAdd = Infinity;
    let bestNewSurplus = currentSurplus;

    const currentMSupply = p.uniMUsed * CANDY_VALUES.universal.m;
    const currentLSupply = p.uniLUsed * CANDY_VALUES.universal.l;
    const currentSSupply = p.uniSUsed * CANDY_VALUES.universal.s;

    // Mを減らすパターン
    for (let mRemove = 1; mRemove <= p.uniMUsed; mRemove++) {
      const newMSupply = (p.uniMUsed - mRemove) * CANDY_VALUES.universal.m;
      const newTotalWithoutExtraS = currentSSupply + newMSupply + currentLSupply;
      const shortage = originalNeed - newTotalWithoutExtraS;

      if (shortage <= 0) continue; // 不足なしならスキップ

      // 不足分をSで補填
      const sToAdd = Math.ceil(shortage / CANDY_VALUES.universal.s);
      const sSupply = sToAdd * CANDY_VALUES.universal.s;
      const newTotal = newTotalWithoutExtraS + sSupply;
      const newSurplus = newTotal - originalNeed;

      if (newSurplus <= 2 && sToAdd < bestSToAdd) {
        bestMToRemove = mRemove;
        bestLToRemove = 0;
        bestSToAdd = sToAdd;
        bestNewSurplus = newSurplus;
      }
    }

    // Lを減らすパターン
    for (let lRemove = 1; lRemove <= p.uniLUsed; lRemove++) {
      const newLSupply = (p.uniLUsed - lRemove) * CANDY_VALUES.universal.l;
      const newTotalWithoutExtraS = currentSSupply + currentMSupply + newLSupply;
      const shortage = originalNeed - newTotalWithoutExtraS;

      if (shortage <= 0) continue;

      const sToAdd = Math.ceil(shortage / CANDY_VALUES.universal.s);
      const sSupply = sToAdd * CANDY_VALUES.universal.s;
      const newTotal = newTotalWithoutExtraS + sSupply;
      const newSurplus = newTotal - originalNeed;

      if (newSurplus <= 2 && sToAdd < bestSToAdd) {
        bestMToRemove = 0;
        bestLToRemove = lRemove;
        bestSToAdd = sToAdd;
        bestNewSurplus = newSurplus;
      }
    }

    if (bestSToAdd === Infinity) continue;

    // 上位ポケモンからSを取得
    let sObtained = 0;
    for (let j = 0; j < i && sObtained < bestSToAdd; j++) {
      const upper = pokemons[j];
      if (upper.isReverseCalcMode || upper.uniCandyLimit != null) continue;
      if (upper.uniSUsed <= 0) continue;

      const upperOriginalNeed = upper.candyNeed - upper.speciesCandyUsed -
        upper.typeSUsed * CANDY_VALUES.type.s - upper.typeMUsed * CANDY_VALUES.type.m;
      if (upperOriginalNeed <= 0) continue;

      const sToTry = Math.min(bestSToAdd - sObtained, upper.uniSUsed);

      for (let tryGive = sToTry; tryGive >= 1; tryGive--) {
        const upperRemainingS = upper.uniSUsed - tryGive;
        const upperCurrentSupply = upperRemainingS * CANDY_VALUES.universal.s +
          upper.uniMUsed * CANDY_VALUES.universal.m +
          upper.uniLUsed * CANDY_VALUES.universal.l;

        // 下位から返却されるMを上位に渡す
        const mToGive = bestMToRemove;
        const lToGive = bestLToRemove;

        // 上位がM/Lを受け取った後の供給量
        const upperNewSupply = upperCurrentSupply +
          mToGive * CANDY_VALUES.universal.m +
          lToGive * CANDY_VALUES.universal.l;
        const upperNewSurplus = upperNewSupply - upperOriginalNeed;

        // 余り>=0なら調整可能
        if (upperNewSurplus >= 0) {
          // 余分なSを減らす
          const excessS = Math.floor(upperNewSurplus / CANDY_VALUES.universal.s);
          const finalS = upperRemainingS - excessS;
          if (finalS < 0) continue;

          const finalSupply = finalS * CANDY_VALUES.universal.s +
            (upper.uniMUsed + mToGive) * CANDY_VALUES.universal.m +
            (upper.uniLUsed + lToGive) * CANDY_VALUES.universal.l;
          const finalSurplus = finalSupply - upperOriginalNeed;

          if (finalSurplus >= 0 && finalSurplus <= 2) {
            // スワップ成功
            upper.uniSUsed = finalS;
            upper.uniMUsed += mToGive;
            upper.uniLUsed += lToGive;

            // 下位に渡すS = bestSToAddまで（余分はインベントリに戻す）
            const sToGiveToLower = Math.min(bestSToAdd - sObtained, tryGive + excessS);
            sObtained += sToGiveToLower;

            // 余分なSはインベントリに戻す
            const excessToInventory = (tryGive + excessS) - sToGiveToLower;
            inv.universal.s += excessToInventory;

            // M/Lは下位から返却されたものを使用
            bestMToRemove = 0;
            bestLToRemove = 0;
            break;
          }
        }
      }
    }

    // 完全なスワップができる場合のみ実行（部分的なスワップは行わない）
    if (sObtained === bestSToAdd) {
      // スワップ実行: M/Lを1個減らしてSを受け取る
      const mToRemoveFromLower = p.uniMUsed > 0 ? 1 : 0;
      const lToRemoveFromLower = p.uniLUsed > 0 && mToRemoveFromLower === 0 ? 1 : 0;

      p.uniMUsed -= mToRemoveFromLower;
      p.uniLUsed -= lToRemoveFromLower;
      p.uniSUsed += sObtained;

      // 余りを再計算
      const newSupply =
        p.uniSUsed * CANDY_VALUES.universal.s +
        p.uniMUsed * CANDY_VALUES.universal.m +
        p.uniLUsed * CANDY_VALUES.universal.l;
      p.surplus = Math.max(0, newSupply - originalNeed);
      p.remaining = Math.max(0, originalNeed - newSupply);
    }
  }

  // ========================================
  // 余りと統計を計算 + アメ使用制限の適用（逆算モード以外）
  // ========================================
  for (const p of pokemons) {
    if (p.isReverseCalcMode) continue;  // 逆算モードはスキップ（既に処理済み）
    // 配分された全アイテムの合計価値
    const totalSupplied =
      p.speciesCandyUsed +
      p.typeSUsed * CANDY_VALUES.type.s +
      p.typeMUsed * CANDY_VALUES.type.m +
      p.uniSUsed * CANDY_VALUES.universal.s +
      p.uniMUsed * CANDY_VALUES.universal.m +
      p.uniLUsed * CANDY_VALUES.universal.l;

    // アメ使用制限を適用（アイテムは変更せず、使用量のみキャップ）
    // 個数指定がある場合でも、candyNeed（目標Lvまでに必要なアメ）を超えない
    const usageLimit = p.uniCandyLimit != null ? Math.min(p.uniCandyLimit, p.candyNeed) : Infinity;
    p.totalUsed = Math.min(totalSupplied, usageLimit, p.candyNeed);

    // 余り = 供給量 - 実際に使用した量
    // 制限がある場合：供給量が制限を超えた分が余り
    // 制限がない場合：供給量が必要量を超えた分が余り
    if (p.uniCandyLimit != null) {
      // 個数指定あり：供給量 - 実際に使用した量 = 余り
      p.surplus = Math.max(0, totalSupplied - p.totalUsed);
    } else {
      // 制限なし：供給量 - 必要量 = 余り
      p.surplus = Math.max(0, totalSupplied - p.candyNeed);
    }

    // 不足 = 必要量 - 使用量
    p.remaining = Math.max(0, p.candyNeed - p.totalUsed);

    // 到達Lvを計算（使用制限後のアメ量で計算）
    if (p.totalUsed > 0 && p.srcLevel < p.dstLevel) {
      const result = calcLevelByCandy({
        srcLevel: p.srcLevel,
        dstLevel: p.dstLevel,
        expType: p.expType,
        nature: p.nature,
        boost: boostKind,  // ブースト状態を反映
        candy: p.totalUsed,
        expGot: p.expGot,
      });
      p.reachedLevel = result.level;

      // 到達Lvでの次レベルまでのあとEXP
      // result.expGot は到達Lv内で獲得したEXP
      // 次Lvまでの合計EXP - 獲得EXP = あとEXP
      if (result.level < p.dstLevel) {
        const expToNextLevel = calcExp(result.level, result.level + 1, p.expType);
        p.reachedLevelExpLeft = Math.max(0, expToNextLevel - result.expGot);

        // 残EXP = 到達Lvから目標Lvまでの必要EXP - 到達Lv内で獲得したEXP
        const expFromReachedToDst = calcExp(result.level, p.dstLevel, p.expType);
        p.remainingExp = Math.max(0, expFromReachedToDst - result.expGot);
      } else {
        // 目標Lvに到達した場合
        p.reachedLevelExpLeft = 0;
        p.remainingExp = 0;
      }

      // calcLevelByCandyで計算されたかけらを使用
      p.shardsUsed = result.shards;
    } else {
      p.reachedLevel = p.srcLevel;
      p.reachedLevelExpLeft = 0;
      p.remainingExp = 0;
      p.shardsUsed = 0;
    }
  }

  // ========================================
  // アメブ/通常の振り分けとかけら計算
  // ========================================
  let boostRemaining = globalBoostRemaining;
  const shardRate = boostKind === "none" ? 1 : boostKind === "mini" ? 4 : 5;

  for (const p of pokemons) {
    if (p.isReverseCalcMode) continue;  // 逆算モードはスキップ（既に処理済み）
    if (p.totalUsed <= 0) {
      p.boostCandyUsed = 0;
      p.normalCandyUsed = 0;
      p.shardsUsed = 0;
      continue;
    }

    // このポケモンのアメブ上限（ポケモン設定とグローバル残数の小さい方）
    const pokemonBoostLimit = Math.min(p.boostCandyLimit, boostRemaining);

    // 実際に必要な量（余りを除外）: 供給量と必要量の小さい方
    // 個数指定（uniCandyLimit）がある場合はそれでも制限
    let effectiveUsed = Math.min(p.totalUsed, p.candyNeed);
    if (p.uniCandyLimit !== undefined) {
      effectiveUsed = Math.min(effectiveUsed, p.uniCandyLimit);
    }

    // 使用アメをアメブと通常に振り分け
    if (boostKind === "none") {
      // アメブなしの場合は全て通常
      p.boostCandyUsed = 0;
      p.normalCandyUsed = effectiveUsed;
    } else {
      // 個数指定がある場合の特別処理
      if (p.uniCandyLimit !== undefined) {
        // 個数指定に対する理論的なアメブ・通常アメの配分を計算
        // アメブ: 個数指定とポケモン設定のアメブ上限の小さい方
        // 通常アメ: 残り（個数指定 - アメブ理論値）
        const theoreticalBoost = Math.min(p.uniCandyLimit, p.boostCandyLimit);
        const theoreticalNormal = Math.max(0, p.uniCandyLimit - theoreticalBoost);

        // 実際のアメブ: 理論値とグローバル制限の小さい方
        p.boostCandyUsed = Math.min(theoreticalBoost, pokemonBoostLimit);
        // 通常アメ: 理論値で固定（アメブ不足分を補填しない）
        p.normalCandyUsed = theoreticalNormal;
        // アメブ不足: 理論値 - 実際の使用量
        p.boostShortage = Math.max(0, theoreticalBoost - p.boostCandyUsed);
        // グローバル残数を減らす
        boostRemaining -= p.boostCandyUsed;
      } else {
        // 個数指定なし: 従来通り
        // アメブ分（上限まで）- アメブを優先
        p.boostCandyUsed = Math.min(effectiveUsed, pokemonBoostLimit);
        // 残りは通常（effectiveUsedからアメブ分を引いた量）
        p.normalCandyUsed = effectiveUsed - p.boostCandyUsed;
        // グローバル残数を減らす
        boostRemaining -= p.boostCandyUsed;
      }
    }

    // reachedLevel、shardsUsed、remainingExpを正しく再計算（アメブと通常アメで分けて計算）
    if (p.totalUsed > 0 && p.srcLevel < p.dstLevel) {
      // アメブ分
      const boostResult = p.boostCandyUsed > 0 ? calcLevelByCandy({
        srcLevel: p.srcLevel,
        dstLevel: p.dstLevel,
        expType: p.expType,
        nature: p.nature,
        boost: boostKind,
        candy: p.boostCandyUsed,
        expGot: p.expGot,
      }) : { level: p.srcLevel, expGot: p.expGot, shards: 0 };

      // 通常アメ分（アメブで到達したLvから開始）
      const normalResult = p.normalCandyUsed > 0 ? calcLevelByCandy({
        srcLevel: boostResult.level,
        dstLevel: p.dstLevel,
        expType: p.expType,
        nature: p.nature,
        boost: "none",  // 通常アメなのでブーストなし
        candy: p.normalCandyUsed,
        expGot: boostResult.expGot,
      }) : { level: boostResult.level, expGot: boostResult.expGot, shards: 0 };

      // 最終的な到達Lv
      const finalLevel = normalResult.level;
      const finalExpGot = normalResult.expGot;



      p.reachedLevel = finalLevel;
      p.shardsUsed = boostResult.shards + normalResult.shards;

      // 到達Lvでの次レベルまでのあとEXP と 残EXP
      if (finalLevel < p.dstLevel) {
        const expToNextLevel = calcExp(finalLevel, finalLevel + 1, p.expType);
        p.reachedLevelExpLeft = Math.max(0, expToNextLevel - finalExpGot);

        // 残EXP = 到達Lvから目標Lvまでの必要EXP - 到達Lv内で獲得したEXP
        const expFromReachedToDst = calcExp(finalLevel, p.dstLevel, p.expType);
        p.remainingExp = Math.max(0, expFromReachedToDst - finalExpGot);
      } else {
        // 目標Lvに到達した場合
        p.reachedLevelExpLeft = 0;
        p.remainingExp = 0;
        p.remaining = 0;  // アメ不足も0にリセット
      }
    }
  }

  // ========================================
  // Phase 5: かけらとアメブの最終分配
  // ========================================
  // グローバルアメブ残数、かけら残数、在庫残数を追跡しながら、
  // 各ポケモンの最終的な到達Lv、アメブ/通常アメ、かけら使用量を計算
  let shardsRemaining = Math.max(0, shardsCap);
  let boostRemainingPhase5 = globalBoostRemaining;  // グローバルアメブ残数を追跡

  // 在庫残数を追跡（Phase 1-3で使用された分を差し引いた状態から開始）
  // inv は既に Phase 1-3 で使用された分が差し引かれている

  for (const p of pokemons) {
    if (p.isReverseCalcMode) continue;  // 逆算モードはスキップ

    // 配分時点のリソース残数を記録（不足計算用）
    p.availableBoostAtAllocation = boostRemainingPhase5;
    p.availableShardsAtAllocation = shardsRemaining;
    p.availableUniSAtAllocation = inv.universal.s;

    // このポケモンで使えるアメブ上限（ポケモン設定とグローバル残数の小さい方）
    const effectiveBoostLimit = boostKind === "none" ? 0 : Math.min(p.boostCandyLimit, boostRemainingPhase5);

    // このポケモン用に使用可能な在庫の合計価値を計算
    // = 既に配分された量（p.totalUsed）+ 残りの在庫から追加できる量
    const remainingSpecies = inv.species[String(p.pokedexId)] ?? 0;
    const remainingType = inv.typeCandy[p.type] ?? { s: 0, m: 0 };
    const remainingTypeValue = remainingType.s * CANDY_VALUES.type.s + remainingType.m * CANDY_VALUES.type.m;
    const remainingUniValue = inv.universal.s * CANDY_VALUES.universal.s +
      inv.universal.m * CANDY_VALUES.universal.m +
      inv.universal.l * CANDY_VALUES.universal.l;
    // 既に配分された量 + 残りの在庫 = このポケモンが使える最大量
    // ただし、ユーザー指定のアメ上限（uniCandyLimit）がある場合はそれで制限
    const inventoryMax = p.totalUsed + remainingSpecies + remainingTypeValue + remainingUniValue;
    const maxAvailableCandy = p.uniCandyLimit !== undefined
      ? Math.min(inventoryMax, p.uniCandyLimit)
      : inventoryMax;

    // 配分時点のアメ在庫価値を記録
    p.availableCandyAtAllocation = inventoryMax;

    // 目標Lvに必要なかけらを計算（有効なアメブ上限を考慮）
    // calcExpAndCandyMixedを使用：UIの「目標まで」行と同じ計算方法
    // expGot=0で計算：UIの「目標まで」行は目標Lvまでの純粋なコストを表示するため
    // （expGotはアメブ個数増加による余りEXPだが、目標かけらは初期状態で計算）
    const targetResult = calcExpAndCandyMixed({
      srcLevel: p.srcLevel,
      dstLevel: p.dstLevel,
      expType: p.expType,
      nature: p.nature,
      boost: boostKind,
      boostCandy: effectiveBoostLimit,
      expGot: 0,
    });
    const shardsNeededForTarget = targetResult.shards;


    // アメ制限を考慮して到達Lvを再計算（effectiveBoostLimitを使用）
    // p.totalUsed = Phase 1-3で配分されたアメ量
    let candyLimitedLevel = p.srcLevel;
    let candyLimitedBoostUsed = 0;
    let candyLimitedNormalUsed = 0;
    let candyLimitedExpGot = p.expGot;
    let candyLimitedShards = 0;
    let theoreticalBoostForShortage = 0;  // アメブ不足計算用
    let shardsLimitedExpGot = p.expGot;  // かけら制限適用後のexpGot（forループ内で更新）

    // アメ在庫のみで到達可能なLv（アメブ制限・かけら制限なし）を計算
    // この値はPhase 6で「到達Lvを決定した要因」を判定するために使用
    // Phase 1-3で配分されたアイテムの実際の価値を計算
    const actualItemValue =
      p.speciesCandyUsed +
      p.typeSUsed * CANDY_VALUES.type.s +
      p.typeMUsed * CANDY_VALUES.type.m +
      p.uniSUsed * CANDY_VALUES.universal.s +
      p.uniMUsed * CANDY_VALUES.universal.m +
      p.uniLUsed * CANDY_VALUES.universal.l;

    if (actualItemValue > 0 && p.srcLevel < p.dstLevel && boostKind !== "none") {
      const candyOnlyResult = calcLevelByCandy({
        srcLevel: p.srcLevel,
        dstLevel: p.dstLevel,
        expType: p.expType,
        nature: p.nature,
        boost: boostKind,
        candy: actualItemValue,  // 実際のアイテム価値を使用
        expGot: p.expGot,
      });
      p.reachableLevelByCandy = candyOnlyResult.level;
      p.reachableExpByCandy = candyOnlyResult.expGot;
    } else {
      p.reachableLevelByCandy = p.srcLevel;
      p.reachableExpByCandy = p.expGot;
    }

    if (p.totalUsed > 0 && p.srcLevel < p.dstLevel && boostKind !== "none") {
      // ユーザー設定のアメブ割合を尊重
      // p.boostCandyLimit = ユーザーが「アメブとして使いたい量」（目標Lvまで）
      // p.candyNeed = 目標Lvまでに必要なアメ
      // アメブ割合 = p.boostCandyLimit / p.candyNeed

      // 個数指定がある場合、アメブ+通常アメの合計を制限
      // アメブを優先して配分
      const candyTotalLimit = p.uniCandyLimit !== undefined
        ? Math.min(p.totalUsed, p.uniCandyLimit)
        : p.totalUsed;

      // 実際に使えるアメブ量（ユーザー設定とグローバル残数と個数制限の小さい方）
      const effectiveBoostUsed = Math.min(
        p.boostCandyLimit,           // ユーザー設定のアメブ上限
        effectiveBoostLimit,          // グローバルアメブ残数
        candyTotalLimit               // 配分されたアメ（個数制限考慮）
      );

      // 通常アメ量
      let effectiveNormalUsed: number;
      if (p.uniCandyLimit !== undefined) {
        // 個数指定がある場合、通常アメは「個数指定 - ポケモン設定のアメブ上限」で固定
        // ただし、アメ合計（totalUsed）を超えて通常アメを追加しない
        // アメブが制限されても通常アメは増やさない
        const theoreticalBoost = Math.min(p.uniCandyLimit, p.boostCandyLimit);
        theoreticalBoostForShortage = theoreticalBoost;
        // アメ合計＜個数指定の場合、アメ合計までしか使わない
        const effectiveTotalLimit = Math.min(p.totalUsed, p.uniCandyLimit);
        effectiveNormalUsed = Math.max(0, effectiveTotalLimit - theoreticalBoost);

        // 理論値を記録（不足計算用）
        p.theoreticalBoost = theoreticalBoost;

        // かけら理論値を計算（個数指定分のアメで到達できるLvまでのかけら）
        // アメブと通常アメを分けて計算（calcExpAndCandyMixedを使用）
        const theoreticalResult = calcExpAndCandyMixed({
          srcLevel: p.srcLevel,
          dstLevel: p.dstLevel,
          expType: p.expType,
          nature: p.nature,
          boost: boostKind,
          boostCandy: theoreticalBoost,
          expGot: p.expGot,
        });
        // 個数指定で到達できるLvまでのかけらを計算
        // calcLevelByCandyAndShardsで到達Lvを取得し、そのLvまでのかけらを使用
        // ただし、candyNeed（目標Lvまでに必要なアメ）を超えない
        const effectiveCandyLimit = Math.min(p.uniCandyLimit, p.candyNeed);
        const reachResult = calcLevelByCandyAndShards({
          srcLevel: p.srcLevel,
          dstLevel: p.dstLevel,
          expType: p.expType,
          nature: p.nature,
          boost: boostKind,
          candy: effectiveCandyLimit,
          shardsLimit: Infinity,
          expGot: p.expGot,
        });
        // 到達LvまでのかけらをtheoreticalShardsとして使用
        // ただし、reachResult.shardsは全てブーストアメとして計算されるため、
        // アメブ部分と通常アメ部分を正しく計算する必要がある
        // → allocateCandyUnlimitedと同じロジックを使用
        const theoreticalNeed: PokemonCandyNeed = {
          ...p,
          candyNeed: effectiveCandyLimit,
          boostCandyLimit: Math.min(theoreticalBoost, effectiveCandyLimit),
        };
        const unlimitedResult = allocateCandyUnlimited(theoreticalNeed, inv, boostKind, effectiveCandyLimit);
        p.theoreticalShards = unlimitedResult.shardsUsed;

        // グローバルアメブが足りているかを記録
        // Phase 6でアメブ不足の原因を正確に判定するために使用
        p.globalBoostSufficient = boostRemainingPhase5 >= theoreticalBoost;
      } else {
        // 個数指定なし: ユーザー設定の割合に基づく
        const userNormalRatio = p.candyNeed > 0 ? Math.max(0, p.candyNeed - p.boostCandyLimit) / p.candyNeed : 0;
        effectiveNormalUsed = Math.floor(p.totalUsed * userNormalRatio);
      }

      const boostResult = effectiveBoostUsed > 0 ? calcLevelByCandy({
        srcLevel: p.srcLevel,
        dstLevel: p.dstLevel,
        expType: p.expType,
        nature: p.nature,
        boost: boostKind,
        candy: effectiveBoostUsed,
        expGot: p.expGot,
      }) : { level: p.srcLevel, expGot: p.expGot, shards: 0 };

      const normalResult = effectiveNormalUsed > 0 ? calcLevelByCandy({
        srcLevel: boostResult.level,
        dstLevel: p.dstLevel,
        expType: p.expType,
        nature: p.nature,
        boost: "none",
        candy: effectiveNormalUsed,
        expGot: boostResult.expGot,
      }) : { level: boostResult.level, expGot: boostResult.expGot, shards: 0 };

      candyLimitedLevel = normalResult.level;
      candyLimitedBoostUsed = effectiveBoostUsed;
      candyLimitedNormalUsed = effectiveNormalUsed;
      candyLimitedExpGot = normalResult.expGot;
      candyLimitedShards = boostResult.shards + normalResult.shards;
    } else if (p.totalUsed > 0 && p.srcLevel < p.dstLevel) {
      // 通常モードの場合
      const normalResult = calcLevelByCandy({
        srcLevel: p.srcLevel,
        dstLevel: p.dstLevel,
        expType: p.expType,
        nature: p.nature,
        boost: "none",
        candy: p.totalUsed,
        expGot: p.expGot,
      });
      candyLimitedLevel = normalResult.level;
      candyLimitedNormalUsed = p.totalUsed;
      candyLimitedExpGot = normalResult.expGot;
      candyLimitedShards = normalResult.shards;
    }

    if (shardsNeededForTarget <= shardsRemaining) {
      // 十分なかけらがある場合
      p.shardsShortage = 0;
      p.reachedLevel = candyLimitedLevel;
      p.boostCandyUsed = candyLimitedBoostUsed;
      p.normalCandyUsed = candyLimitedNormalUsed;
      p.shardsUsed = candyLimitedShards;
      // totalUsedも更新（Phase 5.5でアイテム再配分に使用）
      p.totalUsed = candyLimitedBoostUsed + candyLimitedNormalUsed;
      // アメ不足を再計算（目標Lvまでの必要量 - 到達Lv分の使用量）
      p.remaining = Math.max(0, p.candyNeed - p.totalUsed);
      // アメブ不足を計算（個数指定がある場合のみ）
      if (p.uniCandyLimit !== undefined && theoreticalBoostForShortage > 0) {
        p.boostShortage = Math.max(0, theoreticalBoostForShortage - candyLimitedBoostUsed);
      }
      // 到達Lvでの残りEXPを再計算
      if (candyLimitedLevel < p.dstLevel) {
        const expToNextLevel = calcExp(candyLimitedLevel, candyLimitedLevel + 1, p.expType);
        p.reachedLevelExpLeft = Math.max(0, expToNextLevel - candyLimitedExpGot);
        const expFromReachedToDst = calcExp(candyLimitedLevel, p.dstLevel, p.expType);
        p.remainingExp = Math.max(0, expFromReachedToDst - candyLimitedExpGot);
      } else {
        p.reachedLevelExpLeft = 0;
        p.remainingExp = 0;
        p.remaining = 0;  // 目標Lvに到達したのでアメ不足なし
      }

      // グローバルアメブ残数を減らす
      boostRemainingPhase5 -= candyLimitedBoostUsed;
      shardsRemaining -= candyLimitedShards;
      shardsLimitedExpGot = candyLimitedExpGot;  // かけら制限がないのでアメブ制限後と同じ
    } else {
      // かけら不足 → 残りかけら内で到達可能なLvを再計算
      // 二分探索で到達可能なLvを見つける（shardsRemaining=0でもbestLevel=srcLevelになるだけ）
      let lo = p.srcLevel;
      let hi = p.dstLevel;
      let bestLevel = p.srcLevel;
      let bestShards = 0;
      let bestBoostCandy = 0;
      let bestNormalCandy = 0;
      let bestExpGot = p.expGot;

      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);

        // 該当Lvまでのアメとかけらを計算（有効なアメブ上限を使用）
        const mixedResult = calcCandyAndShardsForLevelMixed({
          srcLevel: p.srcLevel,
          dstLevel: mid,
          expType: p.expType,
          nature: p.nature,
          boost: boostKind,
          boostCandyLimit: effectiveBoostLimit,
          expGot: p.expGot,
        });

        // 必要なアメ量
        const totalCandyNeeded = mixedResult.boostCandy + mixedResult.normalCandy;

        // かけら制限と在庫制限の両方をチェック
        // maxAvailableCandy = 既に配分された量 + 残りの在庫
        if (mixedResult.shards <= shardsRemaining && totalCandyNeeded <= maxAvailableCandy) {
          // このLvに到達可能
          bestLevel = mid;
          bestShards = mixedResult.shards;
          bestBoostCandy = mixedResult.boostCandy;
          bestNormalCandy = mixedResult.normalCandy;
          bestExpGot = mixedResult.expGot;
          lo = mid + 1;
        } else {
          // かけら不足または在庫不足
          hi = mid - 1;
        }
      }


      // 残りかけらで1レベルも上げられない場合でも、かけら上限内でアメを使用可能
      // かけら上限とアメブ上限の両方を考慮する
      if (bestLevel <= p.srcLevel) {
        // リセット前のアイテム使用量を在庫に戻す
        inv.universal.s += p.uniSUsed;
        inv.universal.m += p.uniMUsed;
        inv.universal.l += p.uniLUsed;
        if (inv.typeCandy[p.type]) {
          inv.typeCandy[p.type].s += p.typeSUsed;
          inv.typeCandy[p.type].m += p.typeMUsed;
        }
        inv.species[String(p.pokedexId)] = (inv.species[String(p.pokedexId)] ?? 0) + p.speciesCandyUsed;

        // かけら上限とアメブ上限内で使えるアメを計算
        const maxCandyForLevel = Math.min(effectiveBoostLimit, maxAvailableCandy);
        const resultWithShards = calcLevelByCandyAndShards({
          srcLevel: p.srcLevel,
          dstLevel: p.dstLevel,  // 目標Lvまで探索（途中で止まる）
          expType: p.expType,
          nature: p.nature,
          boost: boostKind,
          candy: maxCandyForLevel,
          shardsLimit: shardsRemaining,
          expGot: p.expGot,
        });

        const candyUsed = resultWithShards.candyUsed;
        const shardsUsed = resultWithShards.shards;


        if (candyUsed > 0) {
          // アメを使用できる場合
          p.shardsUsed = shardsUsed;
          p.reachedLevel = resultWithShards.level;
          p.boostCandyUsed = candyUsed;
          p.normalCandyUsed = 0;
          p.totalUsed = candyUsed;


          p.reachedLevelExpLeft = Math.max(0, calcExp(p.reachedLevel, p.reachedLevel + 1, p.expType) - resultWithShards.expGot);
          p.remainingExp = calcExp(p.srcLevel, p.dstLevel, p.expType) - (p.expGot + (candyUsed * calcExpPerCandy(p.srcLevel, p.nature, boostKind)));

          // かけら残数とアメブ残数を減らす
          shardsRemaining -= shardsUsed;
          boostRemainingPhase5 -= candyUsed;

          // アイテムを配分（使用可能な在庫から）
          const availableType = inv.typeCandy[p.type] ?? { s: 0, m: 0 };
          const alloc = findBestAllocationWithLimit(
            candyUsed,
            availableType,
            inv.universal
          );

          // 在庫から差し引く
          if (inv.typeCandy[p.type]) {
            inv.typeCandy[p.type].s -= alloc.typeS;
            inv.typeCandy[p.type].m -= alloc.typeM;
          }
          inv.universal.s -= alloc.uniS;
          inv.universal.m -= alloc.uniM;
          inv.universal.l -= alloc.uniL;

          // アイテム使用量を設定
          p.speciesCandyUsed = 0;  // 種族アメは使用しない（ブーストアメなので）
          p.typeSUsed = alloc.typeS;
          p.typeMUsed = alloc.typeM;
          p.uniSUsed = alloc.uniS;
          p.uniMUsed = alloc.uniM;
          p.uniLUsed = alloc.uniL;
          p.surplus = Math.max(0, alloc.supplied - candyUsed);
          p.remaining = Math.max(0, p.candyNeed - candyUsed);
          p.shardsShortage = Math.max(0, shardsNeededForTarget - shardsUsed);
          shardsLimitedExpGot = resultWithShards.expGot;
        } else {
          // アメを使用できない場合（完全にリセット）
          p.shardsShortage = shardsNeededForTarget;
          p.shardsUsed = 0;
          p.reachedLevel = p.srcLevel;
          p.totalUsed = 0;
          p.boostCandyUsed = 0;
          p.normalCandyUsed = 0;
          p.speciesCandyUsed = 0;
          p.typeSUsed = 0;
          p.typeMUsed = 0;
          p.uniSUsed = 0;
          p.uniMUsed = 0;
          p.uniLUsed = 0;
          p.surplus = 0;
          p.remaining = p.candyNeed;
          p.reachedLevelExpLeft = 0;
          p.remainingExp = calcExp(p.srcLevel, p.dstLevel, p.expType) - p.expGot;
          shardsLimitedExpGot = p.expGot;  // アメを使用できないので初期値のまま
        }
      } else {
        // かけら制限で到達Lvが制限される場合
        // 残りのかけらを使って bestLevel 内でさらにEXPを稼ぐ

        // calcLevelByCandyAndShards を使って、残りのかけら上限まで使い切る
        // これにより、Lvちょうどではなく、そのLv内で可能な限りEXPを稼ぐ
        // ただし、アメブ制限とアメ在庫制限の両方を考慮する
        const maxCandyForLevel = Math.min(effectiveBoostLimit, maxAvailableCandy);
        const resultWithShards = calcLevelByCandyAndShards({
          srcLevel: p.srcLevel,
          dstLevel: bestLevel + 1,  // bestLevel + 1 まで試す（途中で止まる）
          expType: p.expType,
          nature: p.nature,
          boost: boostKind,
          candy: maxCandyForLevel,
          shardsLimit: shardsRemaining,
          expGot: p.expGot,
        });

        // 結果を使用
        const finalLevel = resultWithShards.level;
        const finalShards = resultWithShards.shards;
        const finalBoostCandy = resultWithShards.candyUsed;
        const finalExpGot = resultWithShards.expGot;

        // アメの使用量を更新
        // 個数指定がある場合は理論値の通常アメを使用
        // ただし、かけら上限を超えないように調整
        let finalNormalCandy = 0;
        let normalCandyShards = 0;
        let adjustedBoostCandy = finalBoostCandy;
        let adjustedBoostShards = finalShards;

        if (p.uniCandyLimit !== undefined) {
          const theoreticalBoost = Math.min(p.uniCandyLimit, p.boostCandyLimit);
          // グローバルアメブ残数も考慮した実効アメブ量
          const effectiveTheoreticalBoost = Math.min(theoreticalBoost, effectiveBoostLimit);
          // 通常アメは「個数指定 - 理論アメブ」だが、アメ合計を超えない
          const effectiveTotalLimit = Math.min(p.totalUsed, p.uniCandyLimit);
          const theoreticalNormal = Math.max(0, effectiveTotalLimit - theoreticalBoost);

          // かけら制限まで、まずアメブを最大限使う
          // 通常アメは残りのかけら予算で使う

          // アメブを先にかけら上限まで使う（グローバルアメブ残数を考慮）
          const boostOnlyResult = calcLevelByCandyAndShards({
            srcLevel: p.srcLevel,
            dstLevel: p.dstLevel,
            expType: p.expType,
            nature: p.nature,
            boost: boostKind,
            candy: effectiveTheoreticalBoost,  // グローバルアメブ残数を考慮
            shardsLimit: shardsRemaining,
            expGot: p.expGot,
          });
          adjustedBoostCandy = boostOnlyResult.candyUsed;
          adjustedBoostShards = boostOnlyResult.shards;
          const boostLevel = boostOnlyResult.level;
          const boostExpGot = boostOnlyResult.expGot;

          // 残りかけら予算で通常アメを使う
          const remainingShardsForNormal = shardsRemaining - adjustedBoostShards;
          if (theoreticalNormal > 0 && remainingShardsForNormal > 0 && boostLevel < p.dstLevel) {
            const normalResult = calcLevelByCandyAndShards({
              srcLevel: boostLevel,
              dstLevel: p.dstLevel,
              expType: p.expType,
              nature: p.nature,
              boost: "none",
              candy: theoreticalNormal,
              shardsLimit: remainingShardsForNormal,
              expGot: boostExpGot,
            });
            finalNormalCandy = normalResult.candyUsed;
            normalCandyShards = normalResult.shards;
          }

          // アメブ不足を計算（グローバルアメブ制限が原因の場合のみ）
          // かけら制限でアメブが減った場合は、boostShortage = 0
          // グローバルアメブ残量がアメブ理論値より少ない場合のみboostShortage > 0
          if (boostRemainingPhase5 + adjustedBoostCandy < theoreticalBoost) {
            // グローバルアメブ制限によるアメブ不足
            p.boostShortage = Math.max(0, theoreticalBoost - adjustedBoostCandy);
          } else {
            // かけら制限によるアメブ減少 → アメブ不足ではない
            p.boostShortage = 0;
          }
        }

        p.boostCandyUsed = adjustedBoostCandy;
        p.normalCandyUsed = finalNormalCandy;
        p.totalUsed = adjustedBoostCandy + finalNormalCandy;
        p.reachedLevel = finalLevel;
        // かけらはアメブ分 + 通常アメ分
        p.shardsUsed = adjustedBoostShards + normalCandyShards;
        // かけら不足を計算
        // 個数指定がある場合、個数指定を満たすかけらが足りているかを判定
        // shardsUsedが個数指定理論値に必要なかけらを満たしていれば不足なし
        if (p.uniCandyLimit !== undefined) {
          // 個数指定理論値のかけらを計算（アメブ + 通常アメ）
          const theoreticalBoostForShards = Math.min(p.uniCandyLimit, p.boostCandyLimit);
          const theoreticalNormalForShards = Math.max(0, p.uniCandyLimit - theoreticalBoostForShards);
          // アメブ部分のかけら
          const theoreticalBoostShards = calcLevelByCandy({
            srcLevel: p.srcLevel,
            dstLevel: p.dstLevel,
            expType: p.expType,
            nature: p.nature,
            boost: boostKind,
            candy: theoreticalBoostForShards,
            expGot: p.expGot,
          }).shards;
          // 通常アメ部分のかけら（アメブで到達したLvから）
          const boostReachedLevel = calcLevelByCandy({
            srcLevel: p.srcLevel,
            dstLevel: p.dstLevel,
            expType: p.expType,
            nature: p.nature,
            boost: boostKind,
            candy: theoreticalBoostForShards,
            expGot: p.expGot,
          }).level;
          const theoreticalNormalShards = theoreticalNormalForShards > 0 ? calcLevelByCandy({
            srcLevel: boostReachedLevel,
            dstLevel: p.dstLevel,
            expType: p.expType,
            nature: p.nature,
            boost: "none",
            candy: theoreticalNormalForShards,
            expGot: 0,
          }).shards : 0;
          const theoreticalTotalShards = theoreticalBoostShards + theoreticalNormalShards;
          // 個数指定理論値のかけらを満たしていれば不足なし
          p.shardsShortage = p.shardsUsed >= theoreticalTotalShards ? 0 : Math.max(0, theoreticalTotalShards - p.shardsUsed);
        } else {
          // 個数指定なし：目標Lvのかけらとの差
          p.shardsShortage = Math.max(0, shardsNeededForTarget - p.shardsUsed);
        }
        p.remaining = Math.max(0, p.candyNeed - p.totalUsed);

        // 到達Lvでの残りEXPを再計算
        if (finalLevel < p.dstLevel) {
          const expToNextLevel = calcExp(finalLevel, finalLevel + 1, p.expType);
          p.reachedLevelExpLeft = Math.max(0, expToNextLevel - finalExpGot);
          const expFromReachedToDst = calcExp(finalLevel, p.dstLevel, p.expType);
          p.remainingExp = Math.max(0, expFromReachedToDst - finalExpGot);
        }

        shardsRemaining -= p.shardsUsed;
        boostRemainingPhase5 -= finalBoostCandy;
        shardsLimitedExpGot = finalExpGot;
      }
    }

    // ========================================
    // reachableLevelByBoost/reachableLevelByShards を設定（forループ最後で統一）
    // ========================================
    // reachableLevelByBoost = アメブ制限適用後（かけら制限前）の到達Lv
    // reachableLevelByShards = 最終的な到達Lv（かけら制限適用後）
    p.reachableLevelByBoost = candyLimitedLevel;
    p.reachableExpByBoost = candyLimitedExpGot;
    p.reachableLevelByShards = p.reachedLevel;
    p.reachableExpByShards = shardsLimitedExpGot;

    // ========================================
    // limitingFactorを設定（forループ最後で統一）
    // ========================================
    // 3つの制限（アメ在庫、アメブ、かけら）で到達可能なLvを比較し、
    // 最も制限的な要因を判定
    if (p.reachedLevel >= p.dstLevel) {
      p.limitingFactor = null;  // 目標Lvに到達した場合は不足なし
    } else {
      const lvByCandy = p.reachableLevelByCandy ?? p.dstLevel;
      const expByCandy = p.reachableExpByCandy ?? 0;
      const lvByBoost = p.reachableLevelByBoost ?? p.dstLevel;
      const expByBoost = p.reachableExpByBoost ?? 0;
      const lvByShards = p.reachableLevelByShards ?? p.dstLevel;
      const expByShards = p.reachableExpByShards ?? 0;
      p.limitingFactor = determineLimitingFactor(
        lvByCandy, expByCandy,
        lvByBoost, expByBoost,
        lvByShards, expByShards
      );
    }
  }

  // ========================================
  // Phase 5 正規化: 全派生値を再構築
  // ========================================
  // Phase 5で到達Lvが決まった後、アイテム配分を再調整し、
  // 余分なアイテムは在庫に返却する（下位ポケモンが使用できるように）
  for (const p of pokemons) {
    if (p.isReverseCalcMode) continue;
    normalizeAfterPhase5(p, inv, boostKind);
  }

  // ========================================
  // Phase 5.5: アイテム再配分（totalUsedに合わせて調整）
  // ========================================
  // かけら制限でtotalUsedが制限された場合、配分されたアイテム価値が
  // totalUsedを超えている可能性がある。その場合は優先順位で再配分。
  for (const p of pokemons) {
    if (p.isReverseCalcMode) continue;

    // 配分されたアイテムの合計価値
    const allocatedValue =
      p.speciesCandyUsed +
      p.typeSUsed * CANDY_VALUES.type.s +
      p.typeMUsed * CANDY_VALUES.type.m +
      p.uniSUsed * CANDY_VALUES.universal.s +
      p.uniMUsed * CANDY_VALUES.universal.m +
      p.uniLUsed * CANDY_VALUES.universal.l;

    // 配分価値がtotalUsed+2以下の場合はスキップ（normalizeAfterPhase5で処理済み）
    if (p.pokedexId === 245 && p.uniCandyLimit === 1000) {
      console.log(`  [DEBUG Phase5.5] allocatedValue=${allocatedValue}, totalUsed=${p.totalUsed}, uniSUsed=${p.uniSUsed}`);
      console.log(`  [DEBUG Phase5.5] skip? ${allocatedValue <= p.totalUsed + 2}`);
    }
    if (allocatedValue <= p.totalUsed + 2) continue;

    // 使用可能なプール（現在配分されているアイテム）
    const pool = {
      species: p.speciesCandyUsed,
      typeS: p.typeSUsed,
      typeM: p.typeMUsed,
      uniS: p.uniSUsed,
      uniM: p.uniMUsed,
      uniL: p.uniLUsed,
    };

    // 一旦リセット
    p.speciesCandyUsed = 0;
    p.typeSUsed = 0;
    p.typeMUsed = 0;
    p.uniSUsed = 0;
    p.uniMUsed = 0;
    p.uniLUsed = 0;

    let remaining = p.totalUsed;

    // 優先順位で再配分: 種族アメ → タイプS → タイプM → 万能S → 万能M → 万能L

    // 1. 種族アメ（価値1）
    if (remaining > 0 && pool.species > 0) {
      const used = Math.min(remaining, pool.species);
      p.speciesCandyUsed = used;
      remaining -= used;
    }

    // 2. タイプS（価値4）
    if (remaining > 0 && pool.typeS > 0) {
      const maxUsable = Math.floor(remaining / CANDY_VALUES.type.s);
      const used = Math.min(maxUsable, pool.typeS);
      p.typeSUsed = used;
      remaining -= used * CANDY_VALUES.type.s;
    }

    // 3. タイプM（価値25）
    if (remaining > 0 && pool.typeM > 0) {
      const maxUsable = Math.floor(remaining / CANDY_VALUES.type.m);
      const used = Math.min(maxUsable, pool.typeM);
      p.typeMUsed = used;
      remaining -= used * CANDY_VALUES.type.m;
    }

    // 4. 万能S（価値3）
    if (remaining > 0 && pool.uniS > 0) {
      const maxUsable = Math.floor(remaining / CANDY_VALUES.universal.s);
      const used = Math.min(maxUsable, pool.uniS);
      p.uniSUsed = used;
      remaining -= used * CANDY_VALUES.universal.s;
    }

    // 5. 万能M（価値20）
    if (remaining > 0 && pool.uniM > 0) {
      const maxUsable = Math.floor(remaining / CANDY_VALUES.universal.m);
      const used = Math.min(maxUsable, pool.uniM);
      p.uniMUsed = used;
      remaining -= used * CANDY_VALUES.universal.m;
    }

    // 6. 万能L（価値100）
    if (remaining > 0 && pool.uniL > 0) {
      const maxUsable = Math.floor(remaining / CANDY_VALUES.universal.l);
      const used = Math.min(maxUsable, pool.uniL);
      p.uniLUsed = used;
      remaining -= used * CANDY_VALUES.universal.l;
    }

    // 端数調整: remainingが残っている場合、追加で万能Sを使って余り0-2にする
    // （poolにまだ万能Sが残っている場合）
    if (remaining > 0 && pool.uniS > p.uniSUsed) {
      // もう1つ万能Sを追加すれば余りが2以下になる
      p.uniSUsed += 1;
      remaining -= CANDY_VALUES.universal.s;
    }

    // 余りを再計算
    const newAllocatedValue =
      p.speciesCandyUsed +
      p.typeSUsed * CANDY_VALUES.type.s +
      p.typeMUsed * CANDY_VALUES.type.m +
      p.uniSUsed * CANDY_VALUES.universal.s +
      p.uniMUsed * CANDY_VALUES.universal.m +
      p.uniLUsed * CANDY_VALUES.universal.l;
    p.surplus = Math.max(0, newAllocatedValue - p.totalUsed);

    // 使わなかった分を在庫に戻す（下位ポケモンが使えるように）
    const unusedSpecies = pool.species - p.speciesCandyUsed;
    const unusedTypeS = pool.typeS - p.typeSUsed;
    const unusedTypeM = pool.typeM - p.typeMUsed;
    const unusedUniS = pool.uniS - p.uniSUsed;
    const unusedUniM = pool.uniM - p.uniMUsed;
    const unusedUniL = pool.uniL - p.uniLUsed;

    if (unusedSpecies > 0) {
      inv.species[String(p.pokedexId)] = (inv.species[String(p.pokedexId)] ?? 0) + unusedSpecies;
    }
    if (unusedTypeS > 0 || unusedTypeM > 0) {
      if (!inv.typeCandy[p.type]) inv.typeCandy[p.type] = { s: 0, m: 0 };
      inv.typeCandy[p.type].s += unusedTypeS;
      inv.typeCandy[p.type].m += unusedTypeM;
    }
    inv.universal.s += unusedUniS;
    inv.universal.m += unusedUniM;
    inv.universal.l += unusedUniL;
  }

  // ========================================
  // Phase 5.5.5: uniCandyLimit 強制（個数指定を超えたアイテムを返却）
  // ========================================
  for (const p of pokemons) {
    if (p.isReverseCalcMode) continue;
    if (p.uniCandyLimit === undefined) continue;

    const allocatedValue =
      p.speciesCandyUsed +
      p.typeSUsed * CANDY_VALUES.type.s +
      p.typeMUsed * CANDY_VALUES.type.m +
      p.uniSUsed * CANDY_VALUES.universal.s +
      p.uniMUsed * CANDY_VALUES.universal.m +
      p.uniLUsed * CANDY_VALUES.universal.l;

    if (allocatedValue <= p.uniCandyLimit) continue;

    // 個数指定を超えている → 再配分
    const pool = {
      species: p.speciesCandyUsed,
      typeS: p.typeSUsed,
      typeM: p.typeMUsed,
      uniS: p.uniSUsed,
      uniM: p.uniMUsed,
      uniL: p.uniLUsed,
    };

    // リセット
    p.speciesCandyUsed = 0;
    p.typeSUsed = 0;
    p.typeMUsed = 0;
    p.uniSUsed = 0;
    p.uniMUsed = 0;
    p.uniLUsed = 0;

    let remaining = p.uniCandyLimit;

    // 優先順位で再配分（uniCandyLimitまで）
    if (remaining > 0 && pool.species > 0) {
      const used = Math.min(remaining, pool.species);
      p.speciesCandyUsed = used;
      remaining -= used;
    }
    if (remaining > 0 && pool.typeS > 0) {
      const maxUsable = Math.floor(remaining / CANDY_VALUES.type.s);
      const used = Math.min(maxUsable, pool.typeS);
      p.typeSUsed = used;
      remaining -= used * CANDY_VALUES.type.s;
    }
    if (remaining > 0 && pool.typeM > 0) {
      const maxUsable = Math.floor(remaining / CANDY_VALUES.type.m);
      const used = Math.min(maxUsable, pool.typeM);
      p.typeMUsed = used;
      remaining -= used * CANDY_VALUES.type.m;
    }
    if (remaining > 0 && pool.uniS > 0) {
      const maxUsable = Math.floor(remaining / CANDY_VALUES.universal.s);
      const used = Math.min(maxUsable, pool.uniS);
      p.uniSUsed = used;
      remaining -= used * CANDY_VALUES.universal.s;
    }
    if (remaining > 0 && pool.uniM > 0) {
      const maxUsable = Math.floor(remaining / CANDY_VALUES.universal.m);
      const used = Math.min(maxUsable, pool.uniM);
      p.uniMUsed = used;
      remaining -= used * CANDY_VALUES.universal.m;
    }
    if (remaining > 0 && pool.uniL > 0) {
      const maxUsable = Math.floor(remaining / CANDY_VALUES.universal.l);
      const used = Math.min(maxUsable, pool.uniL);
      p.uniLUsed = used;
      remaining -= used * CANDY_VALUES.universal.l;
    }

    // 端数調整: remaining が残っている場合、追加で万能Sを使って使用上限に達するようにする
    // （poolに未使用の万能Sがあり、余り≤2を許容して使用量を増やせる場合）
    if (remaining > 0 && pool.uniS > p.uniSUsed) {
      p.uniSUsed += 1;
      remaining -= CANDY_VALUES.universal.s;
    }

    // totalUsedを更新
    const newAllocatedValue =
      p.speciesCandyUsed +
      p.typeSUsed * CANDY_VALUES.type.s +
      p.typeMUsed * CANDY_VALUES.type.m +
      p.uniSUsed * CANDY_VALUES.universal.s +
      p.uniMUsed * CANDY_VALUES.universal.m +
      p.uniLUsed * CANDY_VALUES.universal.l;
    // totalUsedはuniCandyLimitを超えない
    p.totalUsed = Math.min(newAllocatedValue, p.uniCandyLimit!);
    // surplusはuniCandyLimitを超えた分
    p.surplus = Math.max(0, newAllocatedValue - p.uniCandyLimit!);

    // 余った分を在庫に返却
    const unusedSpecies = pool.species - p.speciesCandyUsed;
    const unusedTypeS = pool.typeS - p.typeSUsed;
    const unusedTypeM = pool.typeM - p.typeMUsed;
    const unusedUniS = pool.uniS - p.uniSUsed;
    const unusedUniM = pool.uniM - p.uniMUsed;
    const unusedUniL = pool.uniL - p.uniLUsed;

    if (unusedSpecies > 0) {
      inv.species[String(p.pokedexId)] = (inv.species[String(p.pokedexId)] ?? 0) + unusedSpecies;
    }
    if (unusedTypeS > 0 || unusedTypeM > 0) {
      if (!inv.typeCandy[p.type]) inv.typeCandy[p.type] = { s: 0, m: 0 };
      inv.typeCandy[p.type].s += unusedTypeS;
      inv.typeCandy[p.type].m += unusedTypeM;
    }
    inv.universal.s += unusedUniS;
    inv.universal.m += unusedUniM;
    inv.universal.l += unusedUniL;
  }

  // Phase 6用のグローバルアメブ残量を計算
  const totalBoostUsed = pokemons.reduce((sum, p) => sum + p.boostCandyUsed, 0);
  const boostRemainingPhase6 = Math.max(0, globalBoostRemaining - totalBoostUsed);

  // Phase 5.5で返却されたアイテムを、不足している下位ポケモンに再配分
  for (const p of pokemons) {
    if (p.isReverseCalcMode) continue;
    if (p.remaining <= 0) continue;  // 不足がなければスキップ

    // かけら不足またはアメブ不足が原因で到達Lv未満の場合はスキップ
    // （追加アイテムを配分しても到達Lvは変わらない）
    if (p.shardsShortage > 0 || p.boostShortage > 0) {
      continue;
    }

    // 個数指定がある場合は Phase 5.5.5 で処理済みなのでスキップ
    if (p.uniCandyLimit !== undefined) {
      continue;
    }

    // 100%アメブ設定の場合、グローバルアメブ残量をチェック
    // グローバル残量がなければ追加配分しても意味がない
    if (p.normalCandyUsed === 0 && p.boostCandyLimit === p.candyNeed) {
      if (boostRemainingPhase6 <= 0) {
        // グローバルアメブ枯渇、100%アメブ設定なので追加配分不可
        continue;
      }
      // グローバルアメブ制限が原因で一部しか配分されていない場合のみスキップ
      // （在庫不足やかけら制限が原因の場合は追加配分を許可）
      // boostCandyUsed がちょうど boostRemainingPhase6 + 使用前残量 に近い場合、
      // グローバル制限が原因で制限されている
      // ただし、追加の在庫があれば、到達可能範囲内で使えるのでスキップしない
    }

    // 在庫から追加配分可能な量を計算
    const availableSpecies = inv.species[String(p.pokedexId)] ?? 0;
    const availableType = inv.typeCandy[p.type] ?? { s: 0, m: 0 };
    const availableTypeValue = availableType.s * CANDY_VALUES.type.s + availableType.m * CANDY_VALUES.type.m;
    const availableUniValue = inv.universal.s * CANDY_VALUES.universal.s +
      inv.universal.m * CANDY_VALUES.universal.m +
      inv.universal.l * CANDY_VALUES.universal.l;
    const totalAvailable = availableSpecies + availableTypeValue + availableUniValue;

    if (totalAvailable <= 0) continue;  // 追加配分できるアイテムがない

    // 補填する量（不足分と使用可能量の小さい方）
    // 個数指定がある場合はそれも考慮
    let fillAmount = Math.min(p.remaining, totalAvailable);
    if (p.uniCandyLimit !== undefined) {
      const maxAdditional = p.uniCandyLimit - p.totalUsed;
      fillAmount = Math.min(fillAmount, Math.max(0, maxAdditional));
    }

    if (fillAmount <= 0) continue;  // 追加配分する必要がない

    // アイテムを割り当て
    const alloc = findBestAllocationWithLimit(
      fillAmount,
      availableType,
      inv.universal
    );

    // 在庫から差し引く
    if (inv.typeCandy[p.type]) {
      inv.typeCandy[p.type].s -= alloc.typeS;
      inv.typeCandy[p.type].m -= alloc.typeM;
    }
    inv.universal.s -= alloc.uniS;
    inv.universal.m -= alloc.uniM;
    inv.universal.l -= alloc.uniL;

    // ポケモンの使用量に追加
    p.typeSUsed += alloc.typeS;
    p.typeMUsed += alloc.typeM;
    p.uniSUsed += alloc.uniS;
    p.uniMUsed += alloc.uniM;
    p.uniLUsed += alloc.uniL;

    // 合計使用量と不足を更新
    const addedValue = alloc.supplied;
    p.totalUsed += addedValue;
    p.remaining = Math.max(0, p.remaining - addedValue);
    p.surplus = Math.max(0, alloc.supplied - fillAmount);
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

  // かけら不足サマリー
  const shardsShortages = pokemons
    .filter(p => p.shardsShortage > 0)
    .map(p => ({ id: p.id, pokemonName: p.pokemonName, shortage: p.shardsShortage }));

  // ========================================
  // Phase 6: 主要な制限要因と各不足フィールドを計算
  // ========================================
  // 個数指定がある場合: 各リソースは「そのリソース自体が不足」の場合のみ不足 > 0 にする
  // 個数指定がない場合: 従来通りの計算

  // まず、boostCandyUsedとtotalUsedをアイテム価値で制限
  // 実際のアイテム価値より大きい値を使用すると、UI表示が不正確になる
  // ただし、かけら不足 or 個数指定ありの場合のみ（それ以外はPhase 5.5で正しく調整済み）
  for (const p of pokemons) {
    if (p.isReverseCalcMode) continue;

    // かけら不足または個数指定ありの場合のみ適用
    const hasShardsShortage = p.shardsShortage > 0;
    const hasUniCandyLimit = p.uniCandyLimit !== undefined;
    if (!hasShardsShortage && !hasUniCandyLimit) continue;

    const actualItemValue =
      p.speciesCandyUsed +
      p.typeSUsed * CANDY_VALUES.type.s +
      p.typeMUsed * CANDY_VALUES.type.m +
      p.uniSUsed * CANDY_VALUES.universal.s +
      p.uniMUsed * CANDY_VALUES.universal.m +
      p.uniLUsed * CANDY_VALUES.universal.l;

    // アイテム価値がtotalUsedより少ない場合、totalUsedを制限
    if (actualItemValue < p.totalUsed) {
      // アメブも同様に制限（アメブの割合を維持）
      if (p.totalUsed > 0) {
        const ratio = actualItemValue / p.totalUsed;
        p.boostCandyUsed = Math.floor(p.boostCandyUsed * ratio);
        p.normalCandyUsed = actualItemValue - p.boostCandyUsed;
      }
      p.totalUsed = actualItemValue;
    }
  }
  for (const p of pokemons) {
    if (p.isReverseCalcMode) continue;

    // 目標Lvに到達している場合は不足なし
    if (p.reachedLevel >= p.dstLevel) {
      p.primaryShortageType = null;
      continue;
    }

    // ========================================
    // 各不足フィールドを計算
    // ========================================
    if (p.uniCandyLimit !== undefined) {
      // 個数指定がある場合
      const effectiveLimit = Math.min(p.uniCandyLimit, p.candyNeed);
      const theoreticalBoost = Math.min(effectiveLimit, p.boostCandyLimit);

      // 実際のアイテム価値を計算
      const actualItemValue =
        p.speciesCandyUsed +
        p.typeSUsed * CANDY_VALUES.type.s +
        p.typeMUsed * CANDY_VALUES.type.m +
        p.uniSUsed * CANDY_VALUES.universal.s +
        p.uniMUsed * CANDY_VALUES.universal.m +
        p.uniLUsed * CANDY_VALUES.universal.l;

      // アメ不足: 実効上限に達していなければ不足
      const reachedLimit = actualItemValue >= effectiveLimit;
      p.remaining = reachedLimit ? 0 : Math.max(0, effectiveLimit - actualItemValue);

      // アメブ不足: 配分時点のグローバルアメブ残数 < 理論値
      const availableBoost = p.availableBoostAtAllocation ?? Infinity;
      p.boostShortage = Math.max(0, theoreticalBoost - availableBoost);

      // かけら不足: 配分時点のグローバルかけら残数 < 理論値かけら
      const availableShards = p.availableShardsAtAllocation ?? Infinity;
      const theoreticalShards = p.theoreticalShards ?? 0;
      p.shardsShortage = Math.max(0, theoreticalShards - availableShards);
    } else {
      // 個数指定なし
      // アメ不足: 配分時点のアメ在庫 < 必要アメ
      const availableCandy = p.availableCandyAtAllocation ?? Infinity;
      p.remaining = Math.max(0, p.candyNeed - availableCandy);

      // アメブ不足: 配分時点のグローバルアメブ残数 < アメブ上限
      const availableBoost = p.availableBoostAtAllocation ?? Infinity;
      p.boostShortage = Math.max(0, p.boostCandyLimit - availableBoost);

      // かけら不足: Phase 5で既に計算済み（そのまま維持）
    }

    // ========================================
    // primaryShortageTypeを設定
    // ========================================
    // Phase 5で設定されたlimitingFactorを使用
    const hasAnyShortage = p.remaining > 0 || p.boostShortage > 0 || p.shardsShortage > 0;
    if (!hasAnyShortage) {
      p.primaryShortageType = null;
    } else if (p.limitingFactor) {
      p.primaryShortageType = p.limitingFactor;
    } else {
      // limitingFactorがない場合はフォールバック（通常は発生しない）
      if (p.boostShortage > 0) {
        p.primaryShortageType = "boost";
      } else if (p.remaining > 0) {
        p.primaryShortageType = "candy";
      } else if (p.shardsShortage > 0) {
        p.primaryShortageType = "shards";
      } else {
        p.primaryShortageType = null;
      }
    }
  }

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
    shardsShortages,
    totalNeed,
    totalSupplied,
  };
}

/**
 * 在庫無限モード用のアメ配分
 *
 * 「目標まで」行用：使用制限なしで必要量をすべて計上
 * 「お手軽モード」用：使用制限ありで計算
 *
 * @param need 1匹のポケモンの必要情報
 * @param inventory 在庫（参照用、消費しない）
 * @param boostKind ブースト種別
 * @param usageLimit 使用制限（undefinedなら制限なし）
 */
export function allocateCandyUnlimited(
  need: PokemonCandyNeed,
  inventory: CandyInventoryV1,
  boostKind: "none" | "mini" | "full",
  usageLimit?: number
): PokemonAllocation {
  // candyTarget → uniCandyLimit への互換変換
  if (need.candyTarget !== undefined && need.uniCandyLimit === undefined) {
    need.uniCandyLimit = need.candyTarget;
  }

  const result: PokemonAllocation = {
    ...need,
    remaining: 0,
    remainingExp: 0,
    reachedLevel: need.srcLevel,
    reachedLevelExpLeft: 0,
    speciesCandyUsed: 0,
    typeSUsed: 0,
    typeMUsed: 0,
    uniSUsed: 0,
    uniMUsed: 0,
    uniLUsed: 0,
    surplus: 0,
    totalUsed: 0,
    boostCandyUsed: 0,
    normalCandyUsed: 0,
    shardsUsed: 0,
    shardsShortage: 0,
    boostShortage: 0,
    primaryShortageType: null,
  };

  // 使用制限がある場合はその値を、ない場合は必要量を目標とする
  const targetValue = usageLimit != null ? Math.min(usageLimit, need.candyNeed) : need.candyNeed;
  if (targetValue <= 0) {
    result.remaining = need.candyNeed;
    return result;
  }

  let remaining = targetValue;
  let totalSupplied = 0;

  // --- 在庫からアイテムを使用 ---

  // 1. 種族アメ（在庫から）
  const speciesAvailable = inventory.species[String(need.pokedexId)] ?? 0;
  const speciesUsed = Math.min(remaining, speciesAvailable);
  result.speciesCandyUsed = speciesUsed;
  remaining -= speciesUsed;
  totalSupplied += speciesUsed;

  // 使用制限がある場合: findBestAllocationWithLimit で最適配分
  if (usageLimit != null && remaining > 0) {
    const typeInv = inventory.typeCandy[need.type] ?? { s: 0, m: 0 };
    const best = findBestAllocationWithLimit(remaining, typeInv, inventory.universal);
    if (best.supplied > 0) {
      result.typeSUsed = best.typeS;
      result.typeMUsed = best.typeM;
      result.uniSUsed = best.uniS;
      result.uniMUsed = best.uniM;
      result.uniLUsed = best.uniL;
      totalSupplied += best.supplied;
      remaining = Math.max(0, remaining - best.supplied);
    }
  } else if (remaining > 0) {
    // 使用制限がない場合: 従来通り貪欲に配分

    // 2. タイプアメS（在庫から）
    const typeInv = inventory.typeCandy[need.type];
    if (typeInv) {
      const typeSNeeded = Math.floor(remaining / CANDY_VALUES.type.s);
      const typeSUsed = Math.min(typeSNeeded, typeInv.s);
      result.typeSUsed = typeSUsed;
      const typeSValue = typeSUsed * CANDY_VALUES.type.s;
      remaining -= typeSValue;
      totalSupplied += typeSValue;

      // 3. タイプアメM（在庫から）
      if (remaining > 0) {
        const typeMNeeded = Math.floor(remaining / CANDY_VALUES.type.m);
        const typeMUsed = Math.min(typeMNeeded, typeInv.m);
        result.typeMUsed = typeMUsed;
        const typeMValue = typeMUsed * CANDY_VALUES.type.m;
        remaining -= typeMValue;
        totalSupplied += typeMValue;
      }
    }

    // 4. 万能アメS（在庫から、足りる分だけ）
    if (remaining > 0 && inventory.universal.s > 0) {
      const uniSNeeded = Math.ceil(remaining / CANDY_VALUES.universal.s);
      const uniSUsed = Math.min(uniSNeeded, inventory.universal.s);
      result.uniSUsed = uniSUsed;
      const uniSValue = uniSUsed * CANDY_VALUES.universal.s;
      remaining -= uniSValue;
      totalSupplied += uniSValue;
    }

    // 5. 万能アメM（在庫から、足りる分だけ）
    if (remaining > 0 && inventory.universal.m > 0) {
      const uniMNeeded = Math.ceil(remaining / CANDY_VALUES.universal.m);
      const uniMUsed = Math.min(uniMNeeded, inventory.universal.m);
      result.uniMUsed = uniMUsed;
      const uniMValue = uniMUsed * CANDY_VALUES.universal.m;
      remaining -= uniMValue;
      totalSupplied += uniMValue;
    }

    // 6. 万能アメL（在庫から、足りる分だけ）
    if (remaining > 0 && inventory.universal.l > 0) {
      const uniLNeeded = Math.ceil(remaining / CANDY_VALUES.universal.l);
      const uniLUsed = Math.min(uniLNeeded, inventory.universal.l);
      result.uniLUsed = uniLUsed;
      const uniLValue = uniLUsed * CANDY_VALUES.universal.l;
      remaining -= uniLValue;
      totalSupplied += uniLValue;
    }
  }

  // 7. 在庫不足分を補填（在庫無限モードなので無限に使える）
  // まず万能M/Lで補填を試み、それでも足りない分を万能Sで補填
  if (remaining > 0) {
    // 7a. 万能Mで補填（在庫の残りを使用）
    const uniMRemaining = inventory.universal.m - result.uniMUsed;
    if (uniMRemaining > 0) {
      const uniMNeeded = Math.floor(remaining / CANDY_VALUES.universal.m);
      const uniMUsed = Math.min(uniMNeeded, uniMRemaining);
      if (uniMUsed > 0) {
        result.uniMUsed += uniMUsed;
        const uniMValue = uniMUsed * CANDY_VALUES.universal.m;
        remaining -= uniMValue;
        totalSupplied += uniMValue;
      }
    }

    // 7b. 万能Lで補填（在庫の残りを使用）
    if (remaining > 0) {
      const uniLRemaining = inventory.universal.l - result.uniLUsed;
      if (uniLRemaining > 0) {
        const uniLNeeded = Math.floor(remaining / CANDY_VALUES.universal.l);
        const uniLUsed = Math.min(uniLNeeded, uniLRemaining);
        if (uniLUsed > 0) {
          result.uniLUsed += uniLUsed;
          const uniLValue = uniLUsed * CANDY_VALUES.universal.l;
          remaining -= uniLValue;
          totalSupplied += uniLValue;
        }
      }
    }

    // 7c. それでも足りない分を万能Sで補填（無限に使える）
    if (remaining > 0) {
      const extraSNeeded = Math.ceil(remaining / CANDY_VALUES.universal.s);
      result.uniSUsed += extraSNeeded;
      const extraSValue = extraSNeeded * CANDY_VALUES.universal.s;
      totalSupplied += extraSValue;
      remaining = 0;
    }
  }


  // 使用量と余り
  result.totalUsed = targetValue;
  result.surplus = Math.max(0, totalSupplied - targetValue);
  result.remaining = Math.max(0, need.candyNeed - targetValue);

  // 残EXP計算
  if (need.expNeed > 0 && need.expPerCandy > 0) {
    const usedExp = result.totalUsed * need.expPerCandy;
    result.remainingExp = Math.max(0, need.expNeed - usedExp);
  }

  // アメブ/通常の振り分け
  if (boostKind === "none") {
    result.boostCandyUsed = 0;
    result.normalCandyUsed = result.totalUsed;
  } else {
    result.boostCandyUsed = Math.min(result.totalUsed, need.boostCandyLimit);
    result.normalCandyUsed = result.totalUsed - result.boostCandyUsed;
  }

  // 到達Lv計算
  if (need.srcLevel < need.dstLevel && result.totalUsed > 0) {
    const boostResult = result.boostCandyUsed > 0 ? calcLevelByCandy({
      srcLevel: need.srcLevel,
      dstLevel: need.dstLevel,
      expType: need.expType,
      nature: need.nature,
      boost: boostKind,
      candy: result.boostCandyUsed,
      expGot: need.expGot,
    }) : { level: need.srcLevel, expGot: need.expGot, shards: 0 };

    const normalResult = result.normalCandyUsed > 0 ? calcLevelByCandy({
      srcLevel: boostResult.level,
      dstLevel: need.dstLevel,
      expType: need.expType,
      nature: need.nature,
      boost: "none",
      candy: result.normalCandyUsed,
      expGot: boostResult.expGot,
    }) : null;

    const finalResult = normalResult ?? boostResult;
    result.reachedLevel = finalResult.level;
    result.shardsUsed = boostResult.shards + (normalResult?.shards ?? 0);

    if (finalResult.level < need.dstLevel) {
      const expToNextLevel = calcExp(finalResult.level, finalResult.level + 1, need.expType);
      result.reachedLevelExpLeft = Math.max(0, expToNextLevel - finalResult.expGot);
    }
  }

  return result;
}

/**
 * 「目標まで」行用のアメ配分
 *
 * 在庫無限モードで必要量をすべて計上し、万能Sで補填。
 * 個数指定がある場合は limitXXX フィールドで理論値を計算。
 * グローバル制限（アメブ上限・かけら上限）を考慮して不足フィールドを設定。
 *
 * @param needs 各ポケモンの必要情報（順序が保持される）
 * @param inventory 在庫（参照用、実際の消費は allocateCandy で行う）
 * @param boostKind ブースト種別
 * @param globalBoostRemaining グローバルなアメブ残数
 * @param shardsCap かけら上限
 */
export function allocateForTargetRow(
  needs: PokemonCandyNeed[],
  inventory: CandyInventoryV1,
  boostKind: "none" | "mini" | "full",
  globalBoostRemaining: number,
  shardsCap: number
): Record<string, PokemonAllocation> {
  const result: Record<string, PokemonAllocation> = {};

  if (needs.length === 0) return result;

  // candyTarget → uniCandyLimit への互換変換
  for (const n of needs) {
    if (n.candyTarget !== undefined && n.uniCandyLimit === undefined) {
      n.uniCandyLimit = n.candyTarget;
    }
  }

  // 個数指定を一時保存（後でlimitXXX計算に使用）
  const originalLimits: Record<string, number | undefined> = {};
  for (const n of needs) {
    originalLimits[n.id] = n.uniCandyLimit;
  }

  // 在庫を使用して配分（グローバル制限なし）
  // 個数指定がある場合はその値で在庫消費を制限（Phase 5.5.5で返却される）
  const baseResult = allocateCandy(needs, inventory, Infinity, boostKind, Infinity);

  // 各ポケモンに対して補填処理
  for (const p of baseResult.pokemons) {
    const copy: PokemonAllocation = { ...p };

    // 補填前の remaining を保持（アメ不足判定用）
    copy.originalRemaining = p.remaining;

    // 個数指定がある場合、allocateCandyUnlimited で理論値を計算
    const originalLimit = originalLimits[p.id];
    const originalNeed = needs.find(n => n.id === p.id);

    if (originalLimit != null && originalLimit >= 0 && originalNeed) {
      // uniCandyLimit ベースで在庫無限計算
      // ただし、candyNeed（目標Lvまでに必要なアメ）を超えない
      const effectiveLimit = Math.min(originalLimit, originalNeed.candyNeed);
      const limitResult = allocateCandyUnlimited(
        { ...originalNeed, candyNeed: effectiveLimit },
        inventory,
        boostKind,
        effectiveLimit
      );
      copy.limitTypeSUsed = limitResult.typeSUsed;
      copy.limitTypeMUsed = limitResult.typeMUsed;
      copy.limitUniSUsed = limitResult.uniSUsed;
      copy.limitUniMUsed = limitResult.uniMUsed;
      copy.limitUniLUsed = limitResult.uniLUsed;
      copy.limitSurplus = limitResult.surplus;
      copy.limitTotalUsed = limitResult.totalUsed;
      copy.limitBoostCandyUsed = limitResult.boostCandyUsed;
      copy.limitShardsUsed = limitResult.shardsUsed;
      // 個数指定もコピーに保持
      copy.uniCandyLimit = originalLimit;
    } else {
      // 個数指定がない場合、補填前の値をそのまま使用
      copy.limitTypeSUsed = p.typeSUsed;
      copy.limitTypeMUsed = p.typeMUsed;
      copy.limitUniSUsed = p.uniSUsed;
      copy.limitUniMUsed = p.uniMUsed;
      copy.limitUniLUsed = p.uniLUsed;
      copy.limitSurplus = p.surplus;
      copy.limitTotalUsed = p.totalUsed;
      copy.limitBoostCandyUsed = p.boostCandyUsed;
      copy.limitShardsUsed = p.shardsUsed;
    }

    // 不足分を万能Sで補填（在庫無限モード）
    if (copy.remaining > 0) {
      const extraSNeeded = Math.ceil(copy.remaining / CANDY_VALUES.universal.s);
      copy.uniSUsed += extraSNeeded;

      // 余り = 供給量 - 必要量
      const totalSupplied =
        copy.speciesCandyUsed +
        copy.typeSUsed * CANDY_VALUES.type.s +
        copy.typeMUsed * CANDY_VALUES.type.m +
        copy.uniSUsed * CANDY_VALUES.universal.s +
        copy.uniMUsed * CANDY_VALUES.universal.m +
        copy.uniLUsed * CANDY_VALUES.universal.l;
      copy.surplus = Math.max(0, totalSupplied - copy.candyNeed);
      copy.remaining = 0;
      copy.totalUsed = copy.candyNeed;
    }

    result[p.id] = copy;
  }

  // グローバル制限を考慮して不足フィールドを再計算
  let boostUsed = 0;
  let shardsUsed = 0;

  // 順序を保持するため needs の順序で処理
  for (const n of needs) {
    const copy = result[n.id];
    if (!copy) continue;

    // アメブ不足: このポケモンの必要アメブ - 配分時点のグローバルアメブ残数
    const availableBoost = globalBoostRemaining - boostUsed;
    copy.boostShortage = Math.max(0, copy.boostCandyLimit - availableBoost);
    copy.availableBoostAtAllocation = availableBoost;
    boostUsed += Math.min(copy.boostCandyLimit, availableBoost);

    // かけら不足: このポケモンの必要かけら - 配分時点のグローバルかけら残数
    const availableShards = shardsCap - shardsUsed;
    copy.shardsShortage = Math.max(0, copy.shardsUsed - availableShards);
    copy.availableShardsAtAllocation = availableShards;
    shardsUsed += Math.min(copy.shardsUsed, availableShards);

    // primaryShortageType を判定
    if (copy.boostShortage > 0) {
      copy.primaryShortageType = "boost";
    } else if (copy.remaining > 0) {
      copy.primaryShortageType = "candy";
    } else if (copy.shardsShortage > 0) {
      copy.primaryShortageType = "shards";
    } else {
      copy.primaryShortageType = null;
    }
  }

  return result;
}
