import { describe, expect, it } from 'vitest';
import {
  buildPlannerInput,
  type PlannerInputRowDto,
  type PlannerInputSnapshotDto,
} from '../../../src/domain/level-planner/buildPlannerInput';
import { calcExp, calcLevelByCandy } from '../../../src/domain/pokesleep';
import { maxLevel as MAX_LEVEL } from '../../../src/domain/pokesleep/tables';

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
  expRemaining: 100,
  expType: 600,
  nature: 'normal',
  mode: 'targetLevel',
  boostReachLevel: 30,
  candyPeak: 20,
  candyTarget: undefined,
  boostCandyInput: 8,
  ...patch,
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

describe('buildPlannerInput', () => {
  it('none は入力アメ数を requested に保ち、ピークから目標 Lv を計算する', () => {
    const row = baseRow({ candyPeak: 20, boostCandyInput: 8 });
    const snapshot = baseSnapshot('none');
    const currentExpInLevel = Math.max(
      0,
      calcExp(row.srcLevel, row.srcLevel + 1, row.expType) - row.expRemaining,
    );
    const peakResult = calcLevelByCandy({
      srcLevel: row.srcLevel,
      dstLevel: MAX_LEVEL,
      expType: row.expType,
      nature: row.nature,
      boost: 'none',
      candy: 20,
      expGot: currentExpInLevel,
    });

    const input = buildPlannerInput([row], snapshot);

    expect(input).not.toBeNull();
    expect(input?.pokemonList[0]).toMatchObject({
      currentExpInLevel,
      targetLevel: peakResult.level,
      targetExpInLevel: 0,
      requestedBoostCandy: 8,
    });
    expect(input).toMatchObject({
      dreamShards: 123_456,
      boost: { kind: 'none', limit: 350 },
      options: { itemCompareMode: 'surplusGateFirst' },
    });
  });

  it('targetLevel かつ boostReachLevel が目標未満なら、ユーザー目標 Lv を維持する', () => {
    const row = baseRow({
      mode: 'targetLevel',
      dstLevel: 40,
      boostReachLevel: 25,
      candyPeak: 1,
      boostCandyInput: 7,
      expRemaining: 0,
    });

    const input = buildPlannerInput([row], baseSnapshot('full'));

    expect(input?.pokemonList[0]).toMatchObject({
      targetLevel: 40,
      targetExpInLevel: 0,
      currentExpInLevel: 0,
      requestedBoostCandy: 7,
    });
  });

  it('peak はピークから Lv+EXP を計算し、candyTarget と現在 EXP を引き継ぐ', () => {
    const row = baseRow({
      mode: 'peak',
      expRemaining: 40,
      candyPeak: 31,
      candyTarget: 19,
      boostCandyInput: 13,
    });
    const currentExpInLevel = Math.max(
      0,
      calcExp(row.srcLevel, row.srcLevel + 1, row.expType) - row.expRemaining,
    );
    const peakResult = calcLevelByCandy({
      srcLevel: row.srcLevel,
      dstLevel: MAX_LEVEL,
      expType: row.expType,
      nature: row.nature,
      boost: 'mini',
      candy: 31,
      expGot: currentExpInLevel,
    });

    const input = buildPlannerInput([row], baseSnapshot('mini'));

    expect(input?.pokemonList[0]).toMatchObject({
      mode: 'peak',
      currentExpInLevel,
      targetLevel: peakResult.level,
      targetExpInLevel: peakResult.expGot,
      candyTarget: { totalCandyUnits: 19 },
      requestedBoostCandy: 13,
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
      expect.objectContaining({
        pokemonId: 'valid',
        type: 'Electric',
        priorityIndex: 0,
      }),
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
    expect(input?.pokemonList[0].candyTarget).toEqual({ totalCandyUnits: 0 });
  });
});
