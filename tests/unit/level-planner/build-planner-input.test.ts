import { describe, expect, it } from 'vitest';
import {
  buildPlannerInput,
  type PlannerInputRowDto,
  type PlannerInputSnapshotDto,
} from '../../../src/domain/level-planner/buildPlannerInput';
import { calcExp } from '../../../src/domain/pokesleep';
import { simulateCandyBudget } from '../../../src/domain/pokesleep/simulateCandyBudget';

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
  it('個数指定なしなら目標は dstLevel ちょうど（あとEXP 0）になる', () => {
    const row = baseRow({ candyTarget: undefined, boostCandyInput: 8 });
    const snapshot = baseSnapshot('none');
    const currentExpInLevel = Math.max(
      0,
      calcExp(row.srcLevel, row.srcLevel + 1, row.expType) - row.expRemaining,
    );

    const input = buildPlannerInput([row], snapshot);

    expect(input).not.toBeNull();
    expect(input?.pokemonList[0]).toMatchObject({
      candyFamilyKey: '25',
      currentExpInLevel,
      // ceil の余剰EXPを目標へ混ぜない（設計書§3.8-d, §4.5）
      targetLevel: row.dstLevel,
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

  it('個数指定ありなら (n, m) の到達点が目標になり、Lv内EXPも引き継ぐ', () => {
    const row = baseRow({
      expRemaining: 40,
      candyTarget: 19,
      boostCandyInput: 13,
    });
    const currentExpInLevel = Math.max(
      0,
      calcExp(row.srcLevel, row.srcLevel + 1, row.expType) - row.expRemaining,
    );
    // アメブ13個 + 通常6個 = 指定19個 を使い切った到達点
    const reached = simulateCandyBudget(
      { currentLevel: row.srcLevel, currentExpInLevel, expType: row.expType, nature: row.nature },
      13, 19, Infinity, 'mini',
    );

    const input = buildPlannerInput([row], baseSnapshot('mini'));

    expect(input?.pokemonList[0]).toMatchObject({
      currentExpInLevel,
      targetLevel: reached.level,
      targetExpInLevel: reached.expInLevel,
      candyTarget: { totalCandyUnits: 19 },
      requestedBoostCandy: 13,
    });
    // 個数指定ありでは Lv 内 EXP が付きうる（Lvちょうどに固定されない）
    expect(reached.expInLevel).toBeGreaterThan(0);
  });

  it('睡眠EXPはアメ到達点の後に加算される（アメが先、睡眠が後）', () => {
    const row = baseRow({ expRemaining: 40, candyTarget: 19, boostCandyInput: 13 });
    const withoutSleep = buildPlannerInput([row], baseSnapshot('mini'))!.pokemonList[0];
    const withSleep = buildPlannerInput([{ ...row, sleepExp: 20_000 }], baseSnapshot('mini'))!.pokemonList[0];

    const advanced = withSleep.targetLevel > withoutSleep.targetLevel
      || (withSleep.targetLevel === withoutSleep.targetLevel && (withSleep.targetExpInLevel ?? 0) > (withoutSleep.targetExpInLevel ?? 0));
    expect(advanced).toBe(true);
    // 睡眠で目標が伸びても、アメの予定数（個数指定）は変わらない
    expect(withSleep.candyTarget).toEqual(withoutSleep.candyTarget);
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

  it('異なる図鑑番号の同じ進化系を共有familyへ正規化する', () => {
    const snapshot = baseSnapshot('none');
    snapshot.candyInventory.species = { '25': 12, '26': 8, '172': 20 };
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
