import type { ExpGainNature, ExpType } from '../types';
import { calcExp } from '../pokesleep';
import { getPokemonType } from '../pokesleep/pokemon-names';
import { getCandyFamilyKey, isValidPokedexId, normalizeSpeciesCandyByFamily } from '../pokesleep/candy-family';
import { calcCandyTargetFromSleepExp } from '../pokesleep/sleep-growth';
import { deriveTarget } from './deriveTarget';
import type {
  BoostKind,
  CandyInventory,
  ItemCompareMode,
  LevelPlannerInput,
} from './types';

/** UI 行から planner 入力へ渡す値だけを平坦化した DTO。 */
export type PlannerInputRowDto = {
  readonly id: string;
  /** boxId 等の UI 情報は呼び出し側で解決してから渡す。 */
  readonly pokedexId?: number;
  readonly title: string;
  readonly pokemonType?: string;
  readonly srcLevel: number;
  readonly dstLevel: number;
  /** 最終目標のLv内EXP（睡眠後）。個数指定なしの行は 0（§10改訂A）。 */
  readonly dstExpInLevel?: number;
  readonly expRemaining: number;
  readonly expType: ExpType;
  readonly nature: ExpGainNature;
  readonly boostReachLevel?: number;
  readonly candyTarget?: number;
  readonly boostCandyInput: number;
  readonly sleepExp: number;
  readonly sleepTargetMode?: "all";
};

export type PlannerCandyInventorySnapshotDto = {
  readonly species: Readonly<Record<string, number>>;
  readonly typeCandy: Readonly<Record<string, Readonly<{ s: number; m: number }>>>;
  readonly universal: Readonly<{ s: number; m: number; l: number }>;
};

export type PlannerBoostSnapshotDto = Readonly<{
  kind: BoostKind;
  limit: number;
}>;

/** planner 入力作成時点の、store に依存しない値の snapshot。 */
export type PlannerInputSnapshotDto = {
  readonly candyInventory: PlannerCandyInventorySnapshotDto;
  readonly dreamShards: number;
  readonly boost: PlannerBoostSnapshotDto;
  readonly itemCompareMode: ItemCompareMode;
};

function cloneCandyInventory(inventory: PlannerCandyInventorySnapshotDto): CandyInventory {
  return {
    ...inventory,
    species: normalizeSpeciesCandyByFamily(inventory.species),
    typeCandy: Object.fromEntries(
      Object.entries(inventory.typeCandy).map(([type, stock]) => [type, { ...stock }]),
    ),
    universal: { ...inventory.universal },
  };
}

/**
 * UI から切り離した snapshot を LevelPlannerInput へ変換する。
 * 入力行と snapshot は変更しない。
 */
export function buildPlannerInput(
  rows: readonly PlannerInputRowDto[],
  snapshot: Readonly<PlannerInputSnapshotDto>,
): LevelPlannerInput | null {
  if (rows.length === 0) return null;

  const pokemonList: LevelPlannerInput['pokemonList'] = [];

  for (const row of rows) {
    const pokedexId = row.pokedexId;
    // 未選択（0 / undefined）だけでなく、負や非整数も弾く。`getCandyFamilyKey` は
    // これらに対して契約外のキー（`'-1'` / `'1.5'`）を返し、ソルバーが
    // `invalid_candy_family_key` でその行以降を丸ごと未達にしてしまう。
    if (pokedexId === undefined || !isValidPokedexId(pokedexId)) continue;

    const pokemonType = row.pokemonType || getPokemonType(pokedexId);
    const toNextLevel = calcExp(row.srcLevel, row.srcLevel + 1, row.expType);
    const currentExpInLevel = row.expRemaining > 0
      ? Math.max(0, toNextLevel - row.expRemaining)
      : 0;

    // 目標導出は deriveTarget に一本化する（§4.5）。
    // 最終目標（睡眠後）は保存値そのもの。個数指定なしの行は dstLevel ちょうど。
    const { targetLevel, targetExpInLevel } = deriveTarget({
      dstLevel: row.dstLevel,
      dstExpInLevel: row.dstExpInLevel,
      candyTarget: row.candyTarget,
      expType: row.expType,
    });
    const allSleep = row.sleepTargetMode === "all";
    const requestedBoostCandy = allSleep ? 0 : row.boostCandyInput;
    const sleepExp = allSleep ? 0 : row.sleepExp;
    const candyTarget = allSleep ? 0 : row.candyTarget ?? (sleepExp > 0
      ? calcCandyTargetFromSleepExp({
        srcLevel: row.srcLevel,
        dstLevel: targetLevel,
        dstExpInLevel: targetExpInLevel,
        expType: row.expType,
        nature: row.nature,
        boostKind: snapshot.boost.kind,
        targetBoostCandy: requestedBoostCandy,
        targetNormalCandy: Number.MAX_SAFE_INTEGER,
        sleepExp,
        expGot: currentExpInLevel,
      })
      : undefined);

    pokemonList.push({
      pokemonId: row.id,
      pokedexId,
      candyFamilyKey: getCandyFamilyKey(pokedexId),
      name: row.title,
      type: pokemonType,
      currentLevel: row.srcLevel,
      currentExpInLevel,
      targetLevel,
      targetExpInLevel,
      expType: row.expType,
      nature: row.nature,
      requestedBoostCandy,
      boostAllowed: true,
      candyTarget: candyTarget === undefined
        ? undefined
        : { totalCandyUnits: candyTarget, boostedCandyUnits: requestedBoostCandy },
      priorityIndex: pokemonList.length,
    });
  }

  if (pokemonList.length === 0) return null;

  return {
    pokemonList,
    dreamShards: snapshot.dreamShards,
    boost: { ...snapshot.boost },
    candyInventory: cloneCandyInventory(snapshot.candyInventory),
    options: { itemCompareMode: snapshot.itemCompareMode },
  };
}
