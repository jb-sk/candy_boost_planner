import type { ExpGainNature, ExpType } from '../types';
import { calcExp, calcLevelByCandy } from '../pokesleep';
import { getPokemonType } from '../pokesleep/pokemon-names';
import { getCandyFamilyKey, normalizeSpeciesCandyByFamily } from '../pokesleep/candy-family';
import { maxLevel as MAX_LEVEL } from '../pokesleep/tables';
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
  readonly expRemaining: number;
  readonly expType: ExpType;
  readonly nature: ExpGainNature;
  readonly mode: 'targetLevel' | 'peak';
  readonly boostReachLevel?: number;
  readonly candyPeak?: number;
  readonly candyTarget?: number;
  readonly boostCandyInput: number;
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

    const peak = row.candyPeak || row.boostCandyInput;
    let targetLevel: number;
    let targetExpInLevel: number;

    if (snapshot.boost.kind === 'none') {
      const peakResult = calcLevelByCandy({
        srcLevel: row.srcLevel,
        dstLevel: MAX_LEVEL,
        expType: row.expType,
        nature: row.nature,
        boost: snapshot.boost.kind,
        candy: peak,
        expGot: currentExpInLevel,
      });
      targetLevel = peakResult.level;
      targetExpInLevel = row.mode === 'peak' ? peakResult.expGot : 0;
    } else if (
      row.mode === 'targetLevel'
      && row.boostReachLevel !== undefined
      && row.boostReachLevel < row.dstLevel
    ) {
      targetLevel = row.dstLevel;
      targetExpInLevel = 0;
    } else {
      const peakResult = calcLevelByCandy({
        srcLevel: row.srcLevel,
        dstLevel: MAX_LEVEL,
        expType: row.expType,
        nature: row.nature,
        boost: snapshot.boost.kind,
        candy: peak,
        expGot: currentExpInLevel,
      });
      targetLevel = peakResult.level;
      targetExpInLevel = row.mode === 'peak' ? peakResult.expGot : 0;
    }

    pokemonList.push({
      pokemonId: row.id,
      pokedexId,
      candyFamilyKey: getCandyFamilyKey(pokedexId),
      name: row.title,
      mode: row.mode,
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
