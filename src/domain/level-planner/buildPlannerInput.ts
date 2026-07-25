import type { ExpGainNature, ExpType } from '../types';
import { calcExp } from '../pokesleep';
import { getPokemonType } from '../pokesleep/pokemon-names';
import { getCandyFamilyKey, normalizeSpeciesCandyByFamily } from '../pokesleep/candy-family';
import { deriveTarget } from './deriveTarget';
import { getExactLevelTarget } from './exactTargetRegistry';
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
  /** 正確な最終目標Lv内EXP。旧呼び出し元は registry から補完する。 */
  readonly dstExpInLevel?: number;
  readonly expRemaining: number;
  readonly expType: ExpType;
  readonly nature: ExpGainNature;
  readonly boostReachLevel?: number;
  readonly candyTarget?: number;
  readonly boostCandyInput: number;
  /** @deprecated 最終目標は dstLevel + dstExpInLevel で固定し、睡眠EXPを再加算しない。 */
  readonly sleepExp?: number;
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
    if (!pokedexId) continue;

    const pokemonType = row.pokemonType || getPokemonType(pokedexId);
    const toNextLevel = calcExp(row.srcLevel, row.srcLevel + 1, row.expType);
    const currentExpInLevel = row.expRemaining > 0
      ? Math.max(0, toNextLevel - row.expRemaining)
      : 0;

    // useCalcStore の既存 DTO 組み立ては dstExpInLevel を含まないため、ラッパーが同期する
    // registry を後方互換の橋渡しとして使う。明示された DTO 値を常に優先する。
    const registeredTarget = row.dstExpInLevel === undefined
      ? getExactLevelTarget(row.id)
      : undefined;
    const exactTargetLevel = registeredTarget?.level ?? row.dstLevel;
    const exactTargetExpInLevel = row.dstExpInLevel ?? registeredTarget?.expInLevel ?? 0;

    const { targetLevel, targetExpInLevel } = deriveTarget({
      srcLevel: row.srcLevel,
      expGot: currentExpInLevel,
      dstLevel: exactTargetLevel,
      dstExpInLevel: exactTargetExpInLevel,
      candyTarget: row.candyTarget,
      boostCandy: row.boostCandyInput,
      expType: row.expType,
      nature: row.nature,
      boostKind: snapshot.boost.kind,
      fixedTarget: true,
    });

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
      requestedBoostCandy: row.boostCandyInput,
      boostAllowed: true,
      candyTarget: row.candyTarget === undefined
        ? undefined
        : { totalCandyUnits: row.candyTarget },
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
