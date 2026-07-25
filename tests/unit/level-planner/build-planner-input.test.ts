import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildPlannerInput,
  type PlannerInputRowDto,
  type PlannerInputSnapshotDto,
} from '../../../src/domain/level-planner/buildPlannerInput';
import {
  clearExactLevelTargets,
  setExactLevelTarget,
} from '../../../src/domain/level-planner/exactTargetRegistry';
import { calcExp } from '../../../src/domain/pokesleep';

const baseSnapshot = (kind: PlannerInputSnapshotDto['boost']['kind']): PlannerInputSnapshotDto => ({
  candyInventory: {
    species: { '25': 12 },
    typeCandy: { Electric: { s: 3, m: 2 } },
    universal: { s: 4, m: 5, l: 6 },
  },
  dreamShards: 123_456,
  boost: { kind, limit: 350 },
  itemCompareMode: 'surplusGateFirst',
});

const baseRow = (patch: Partial<PlannerInputRowDto> = {}): PlannerInputRowDto => ({
  id: 'pikachu',
  pokedexId: 25,
  title: 'Pikachu',
  pokemonType: 'Electric',
  srcLevel: 10,
  dstLevel: 30,
  dstExpInLevel: 137,
  expRemaining: 100,
  expType: 600,
  nature: 'normal',
  boostReachLevel: 30,
  candyTarget: undefined,
  boostCandyInput: 8,
  ...patch,
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

describe('buildPlannerInput', () => {
  beforeEach(() => clearExactLevelTargets());

  it('明示された dstLevel + dstExpInLevel を唯一の最終目標として渡す', () => {
    const row = baseRow();
    const currentExpInLevel = Math.max(
      0,
      calcExp(row.srcLevel, row.srcLevel + 1, row.expType) - row.expRemaining,
    );
    const input = buildPlannerInput([row], baseSnapshot('none'));

    expect(input?.pokemonList[0]).toMatchObject({
      candyFamilyKey: '25',
      currentExpInLevel,
      targetLevel: 30,
      targetExpInLevel: 137,
      requestedBoostCandy: 8,
    });
  });

  it('既存 store DTO が dstExpInLevel を省略しても registry の正確な目標を使う', () => {
    setExactLevelTarget('pikachu', { level: 31, expInLevel: 246 });
    const row = baseRow({ dstLevel: 31, dstExpInLevel: undefined, candyTarget: 19 });
    const input = buildPlannerInput([row], baseSnapshot('mini'));

    expect(input?.pokemonList[0]).toMatchObject({
      targetLevel: 31,
      targetExpInLevel: 246,
      candyTarget: { totalCandyUnits: 19 },
    });
  });

  it('sleepExp は最終目標へ再加算しない', () => {
    const row = baseRow({ candyTarget: 19, sleepExp: 20_000 });
    const input = buildPlannerInput([row], baseSnapshot('mini'));
    expect(input?.pokemonList[0]).toMatchObject({
      targetLevel: row.dstLevel,
      targetExpInLevel: row.dstExpInLevel,
      candyTarget: { totalCandyUnits: 19 },
    });
  });

  it('空配列・有効な pokedexId がない行だけなら null を返し、無効行は優先順位から除外する', () => {
    const snapshot = baseSnapshot('full');
    const missingId = baseRow({ id: 'missing', pokedexId: undefined });
    const zeroId = baseRow({ id: 'zero', pokedexId: 0 });
    const valid = baseRow({ id: 'valid', pokedexId: 25, pokemonType: undefined });

    expect(buildPlannerInput([], snapshot)).toBeNull();
    expect(buildPlannerInput([missingId, zeroId], snapshot)).toBeNull();
    expect(buildPlannerInput([missingId, valid], snapshot)?.pokemonList).toEqual([
      expect.objectContaining({ pokemonId: 'valid', type: 'Electric', priorityIndex: 0 }),
    ]);
  });

  it('rows と snapshot を変更せず、返却する在庫・boost も snapshot と共有しない', () => {
    const rows = [baseRow({ candyTarget: 0 })];
    const snapshot = baseSnapshot('full');
    const rowsBefore = structuredClone(rows);
    const snapshotBefore = structuredClone(snapshot);
    deepFreeze(rows);
    deepFreeze(snapshot);

    const input = buildPlannerInput(rows, snapshot);

    expect(rows).toEqual(rowsBefore);
    expect(snapshot).toEqual(snapshotBefore);
    expect(input?.candyInventory).toEqual(snapshot.candyInventory);
    expect(input?.candyInventory).not.toBe(snapshot.candyInventory);
    expect(input?.candyInventory.species).not.toBe(snapshot.candyInventory.species);
    expect(input?.candyInventory.typeCandy.Electric).not.toBe(snapshot.candyInventory.typeCandy.Electric);
    expect(input?.candyInventory.universal).not.toBe(snapshot.candyInventory.universal);
    expect(input?.boost).not.toBe(snapshot.boost);
  });

  it('同じ進化系の在庫を共有 family へ正規化する', () => {
    const base = baseSnapshot('none');
    const snapshot: PlannerInputSnapshotDto = {
      ...base,
      candyInventory: {
        ...base.candyInventory,
        species: { '25': 12, '26': 8, '172': 20 },
      },
    };
    const rows = [
      baseRow({ id: 'pichu', pokedexId: 172 }),
      baseRow({ id: 'pikachu', pokedexId: 25 }),
      baseRow({ id: 'raichu', pokedexId: 26 }),
    ];
    const input = buildPlannerInput(rows, snapshot);
    expect(input?.pokemonList.map(row => row.candyFamilyKey)).toEqual(['25', '25', '25']);
    expect(input?.candyInventory.species).toEqual({ '25': 20 });
  });
});
