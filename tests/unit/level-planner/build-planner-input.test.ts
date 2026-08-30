import { describe, expect, it } from 'vitest';
import {
  buildPlannerInput,
  type PlannerInputRowDto,
  type PlannerInputSnapshotDto,
} from '../../../src/domain/level-planner/buildPlannerInput';
import { calcExp } from '../../../src/domain/pokesleep';
import { isCandyFamilyKey } from '../../../src/domain/pokesleep/candy-family';
import { calcCandyTargetFromSleepExp } from '../../../src/domain/pokesleep/sleep-growth';
import { simulateCandyBudget } from '../../../src/domain/pokesleep/simulateCandyBudget';
import { solveLevelPlanWithBudget } from '../../../src/domain/level-planner/core/solveLevelPlan';

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
  boostReachLevel: 30,
  candyTarget: undefined,
  boostCandyInput: 8,
  sleepExp: 0,
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
      dstLevel: 40,
      boostReachLevel: 25,
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

  it('個数指定ありなら保存された最終目標（Lv＋Lv内EXP）をそのまま渡す', () => {
    const row = baseRow({
      expRemaining: 40,
      dstLevel: 22,
      dstExpInLevel: 137,
      candyTarget: 19,
      boostCandyInput: 13,
    });
    const currentExpInLevel = Math.max(
      0,
      calcExp(row.srcLevel, row.srcLevel + 1, row.expType) - row.expRemaining,
    );

    const input = buildPlannerInput([row], baseSnapshot('mini'));

    expect(input?.pokemonList[0]).toMatchObject({
      currentExpInLevel,
      targetLevel: 22,
      targetExpInLevel: 137,
      candyTarget: { totalCandyUnits: 19, boostedCandyUnits: 13 },
      requestedBoostCandy: 13,
    });
  });

  it('睡眠EXPあり・個数指定なしなら、保存目標を維持して睡眠差引き後のアメ予算を渡す', () => {
    const row = baseRow({ dstLevel: 30, candyTarget: undefined, sleepExp: 10_000 });
    const snapshot = baseSnapshot('none');
    const currentExpInLevel = Math.max(
      0,
      calcExp(row.srcLevel, row.srcLevel + 1, row.expType) - row.expRemaining,
    );
    const amountWithoutSleep = calcCandyTargetFromSleepExp({
      srcLevel: row.srcLevel,
      dstLevel: row.dstLevel,
      dstExpInLevel: 0,
      expType: row.expType,
      nature: row.nature,
      boostKind: snapshot.boost.kind,
      targetBoostCandy: row.boostCandyInput,
      targetNormalCandy: Number.MAX_SAFE_INTEGER,
      sleepExp: 0,
      expGot: currentExpInLevel,
    });
    const withSleep = buildPlannerInput([row], snapshot)!.pokemonList[0];

    expect(withSleep).toMatchObject({
      targetLevel: 30,
      targetExpInLevel: 0,
    });
    expect(withSleep.candyTarget?.totalCandyUnits).toBeGreaterThanOrEqual(0);
    expect(withSleep.candyTarget!.totalCandyUnits).toBeLessThan(amountWithoutSleep);
    expect(withSleep.candyTarget?.boostedCandyUnits).toBe(row.boostCandyInput);
  });

  it('個数指定ありの目標はアメ個数から導出し直されない（睡眠後の最終目標が正本）', () => {
    const row = baseRow({ expRemaining: 40, dstLevel: 22, dstExpInLevel: 137, candyTarget: 19, boostCandyInput: 13 });
    // 予定アメを使い切った地点（睡眠前）は最終目標より手前でよい
    const candyEnd = simulateCandyBudget(
      { currentLevel: row.srcLevel, currentExpInLevel: Math.max(0, calcExp(row.srcLevel, row.srcLevel + 1, row.expType) - 40), expType: row.expType, nature: row.nature },
      13, 19, Infinity, 'mini',
    );
    const target = buildPlannerInput([row], baseSnapshot('mini'))!.pokemonList[0];
    const advanced = target.targetLevel > candyEnd.level
      || (target.targetLevel === candyEnd.level && (target.targetExpInLevel ?? 0) > candyEnd.expInLevel);
    expect(advanced).toBe(true);

    // アメ個数だけを増やしても、保存された最終目標は動かない
    const moreCandy = buildPlannerInput([{ ...row, candyTarget: 400, boostCandyInput: 400 }], baseSnapshot('mini'))!.pokemonList[0];
    expect(moreCandy.targetLevel).toBe(target.targetLevel);
    expect(moreCandy.targetExpInLevel).toBe(target.targetExpInLevel);
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
    expect(input?.pokemonList[0].candyTarget).toEqual({ totalCandyUnits: 0, boostedCandyUnits: 8 });
  });

  it('異なる図鑑番号の同じ進化系を共有familyへ正規化する', () => {
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

  it('§13-1B: すべて睡眠を planner 境界で仮想0個需要へ変換し、直接の0個需要と一致する', () => {
    const allSleepRow = baseRow({
      dstLevel: 40,
      candyTarget: undefined,
      boostCandyInput: 999,
      sleepExp: 12_345,
      sleepTargetMode: 'all',
    });
    const directZeroRow = {
      ...allSleepRow,
      sleepTargetMode: undefined,
      candyTarget: 0,
      boostCandyInput: 0,
      sleepExp: 0,
    };
    const snapshot = baseSnapshot('full');
    const fromMode = buildPlannerInput([allSleepRow], snapshot)!;
    const directZero = buildPlannerInput([directZeroRow], snapshot)!;

    expect(fromMode.pokemonList[0]).toMatchObject({
      targetLevel: 40,
      targetExpInLevel: 0,
      requestedBoostCandy: 0,
      candyTarget: { totalCandyUnits: 0, boostedCandyUnits: 0 },
    });
    expect(fromMode).toEqual(directZero);

    const modeResult = solveLevelPlanWithBudget(fromMode, { deadlineMs: 60_000 });
    const directResult = solveLevelPlanWithBudget(directZero, { deadlineMs: 60_000 });
    expect(modeResult.kind).toBe('result');
    expect(directResult.kind).toBe('result');
    if (modeResult.kind === 'result' && directResult.kind === 'result') {
      expect({ ...modeResult.result, performance: undefined })
        .toEqual({ ...directResult.result, performance: undefined });
    }
  });

  it('§13-1b: 全行がすべて睡眠なら境界なし・資源0・全行需要充足で、残EXPだけが正値になる', () => {
    const rows = [
      baseRow({ id: 'lower-than-target', pokedexId: 25, srcLevel: 10, dstLevel: 30, sleepTargetMode: 'all' }),
      baseRow({ id: 'already-target', pokedexId: 133, srcLevel: 30, dstLevel: 30, sleepTargetMode: 'all' }),
    ];
    const input = buildPlannerInput(rows, baseSnapshot('full'))!;
    const outcome = solveLevelPlanWithBudget(input, { deadlineMs: 60_000 });
    expect(outcome.kind).toBe('result');
    if (outcome.kind !== 'result') return;

    const { result } = outcome;
    expect(result.summary.boundaryPokemonId).toBeUndefined();
    expect(result.summary.fullyReachedCount).toBe(rows.length);
    expect(result.shortages.hasShortage).toBe(false);
    expect(result.shortages.totalExpToTargets).toBeGreaterThan(0);
    expect(result.summary.totalSupplied).toMatchObject({
      totalBoostedCandyUnits: 0,
      totalNonBoostCandyUnits: 0,
      totalDreamShards: 0,
    });
    expect(result.pokemonResults.map(row => [
      row.reachableLine.candyDemandMet,
      row.reachableLine.effectiveTargetReached,
    ])).toEqual([[true, true], [true, true]]);
    expect(result.pokemonResults[0]!.shortage.expToTarget).toBeGreaterThan(0);
  });

  it('§13-1C: ONでは対象行の使用資源だけを0にし、OFFでは通常どおり資源を使う', () => {
    const base = baseSnapshot('full');
    const snapshot: PlannerInputSnapshotDto = {
      ...base,
      candyInventory: {
        ...base.candyInventory,
        species: { '25': 10_000 },
      },
      dreamShards: 10_000_000,
    };
    const offInput = buildPlannerInput([
      baseRow({ srcLevel: 10, dstLevel: 40, boostCandyInput: 100 }),
    ], snapshot)!;
    const onInput = buildPlannerInput([
      baseRow({ srcLevel: 10, dstLevel: 40, boostCandyInput: 100, sleepTargetMode: 'all' }),
    ], snapshot)!;
    const off = solveLevelPlanWithBudget(offInput, { deadlineMs: 60_000 });
    const on = solveLevelPlanWithBudget(onInput, { deadlineMs: 60_000 });
    expect(off.kind).toBe('result');
    expect(on.kind).toBe('result');
    if (off.kind !== 'result' || on.kind !== 'result') return;

    expect(off.result.pokemonResults[0]!.reachableLine.totalCandyUnitsUsed).toBeGreaterThan(0);
    expect(on.result.pokemonResults[0]!.reachableLine).toMatchObject({
      boostedCandyUnits: 0,
      nonBoostCandyUnits: 0,
      totalCandyUnitsUsed: 0,
      dreamShardsUsed: 0,
      candyDemandMet: true,
      effectiveTargetReached: true,
    });
  });
});

// ------------------------------------------------------------------
// `candyFamilyKey` の契約を planner 境界で守る。
// ------------------------------------------------------------------

/**
 * **`candyFamilyKey` は型こそ `string` だが、契約は「正の整数文字列」である。**
 *
 * `getCandyFamilyKey` は図鑑番号として扱えない値に対して `String(pokedexId)` を返すので、
 * 負や非整数の `pokedexId` が来ると `'-1'` / `'1.5'` という契約外のキーになる。
 * それがソルバーへ届くと `validateDemandRows` が `invalid_candy_family_key` を返し、
 * **その行を含む prefix が丸ごと infeasible になって到達数が黙って落ちる。**
 *
 * 従来のガードは `if (!pokedexId) continue;` で、0 と undefined しか弾いていなかった。
 *
 * 検出力: ガードを `!pokedexId` へ戻すと、この describe の2本が落ちる。
 */
describe('buildPlannerInput: pokedexId の防御', () => {
  const brokenIds = [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1];

  it('図鑑番号として扱えない行は planner 入力へ入れない（未選択と同じ扱い）', () => {
    for (const pokedexId of brokenIds) {
      const input = buildPlannerInput(
        [baseRow({ id: 'broken', pokedexId }), baseRow({ id: 'valid', pokedexId: 25 })],
        baseSnapshot('none'),
      );
      expect(input?.pokemonList.map(pokemon => pokemon.pokemonId)).toEqual(['valid']);
    }
  });

  it('生成された全行の candyFamilyKey が契約を満たす', () => {
    const input = buildPlannerInput(
      [
        ...brokenIds.map((pokedexId, index) => baseRow({ id: `broken-${index}`, pokedexId })),
        baseRow({ id: 'valid', pokedexId: 133 }),
      ],
      baseSnapshot('none'),
    );
    expect(input?.pokemonList.length).toBeGreaterThan(0);
    for (const pokemon of input!.pokemonList) {
      expect(isCandyFamilyKey(pokemon.candyFamilyKey)).toBe(true);
    }
  });

  it('対照: 正しい図鑑番号の行は落とさない', () => {
    const input = buildPlannerInput(
      [baseRow({ id: 'a', pokedexId: 25 }), baseRow({ id: 'b', pokedexId: 143 })],
      baseSnapshot('none'),
    );
    expect(input?.pokemonList.map(pokemon => pokemon.pokemonId)).toEqual(['a', 'b']);
  });
});

describe('睡眠目標「アメ在庫＋睡眠」', () => {
  const stockSnapshot = (
    kind: PlannerInputSnapshotDto['boost']['kind'],
    species: Record<string, number>,
  ): PlannerInputSnapshotDto => ({
    ...baseSnapshot(kind),
    candyInventory: {
      species,
      // アイテムは潤沢に持たせる。使わないことが仕様なので、在庫が理由で使えないのでは意味がない。
      typeCandy: { Electric: { s: 50, m: 50 } },
      universal: { s: 50, m: 50, l: 50 },
    },
  });

  const stockRow = (patch: Partial<PlannerInputRowDto> = {}): PlannerInputRowDto =>
    baseRow({ sleepTargetMode: 'stock', boostCandyInput: 0, ...patch });

  it('渡された「使うアメ数」がそのまま需要になり、アメブはその内数へ収まる', () => {
    const input = buildPlannerInput(
      [stockRow({ stockCandyTarget: 12, boostCandyInput: 100 })],
      stockSnapshot('full', { '25': 12 }),
    )!;

    expect(input.pokemonList[0]).toMatchObject({
      itemsAllowed: false,
      requestedBoostCandy: 12,
      candyTarget: { totalCandyUnits: 12, boostedCandyUnits: 12 },
    });
  });

  it('タイプアメ・万能アメを1個も配らず、届かないぶんは残EXPとして残る', () => {
    const input = buildPlannerInput(
      [stockRow({ stockCandyTarget: 12 })],
      stockSnapshot('none', { '25': 12 }),
    )!;
    const outcome = solveLevelPlanWithBudget(input, { deadlineMs: 60_000 });
    expect(outcome.kind).toBe('result');
    if (outcome.kind !== 'result') return;

    const plan = outcome.result.pokemonResults[0]!;
    const speciesOnly = { species: 12, type: { s: 0, m: 0 }, universal: { s: 0, m: 0, l: 0 } };
    expect(plan.reachableLine.candySupply).toEqual(speciesOnly);
    // 「必要アイテム」側も万能Sで埋めない。
    expect(plan.targetLine.candySupply).toEqual(speciesOnly);
    // 在庫ぶんは配り切れているので不足扱いにはならない（「すべて睡眠」と同じ）。
    expect(plan.reachableLine.candyDemandMet).toBe(true);
    expect(outcome.result.shortages.hasShortage).toBe(false);
    expect(plan.shortage.expToTarget).toBeGreaterThan(0);
  });

  it('アメブは使う（同じ在庫でより遠くまで届き、睡眠が短くなる）', () => {
    const species = { '25': 40 };
    const plain = solveLevelPlanWithBudget(
      buildPlannerInput([stockRow({ stockCandyTarget: 40 })], stockSnapshot('none', species))!,
      { deadlineMs: 60_000 },
    );
    const boosted = solveLevelPlanWithBudget(
      buildPlannerInput([stockRow({ stockCandyTarget: 40, boostCandyInput: 40 })], stockSnapshot('full', species))!,
      { deadlineMs: 60_000 },
    );
    expect(plain.kind).toBe('result');
    expect(boosted.kind).toBe('result');
    if (plain.kind !== 'result' || boosted.kind !== 'result') return;

    const plainPlan = plain.result.pokemonResults[0]!;
    const boostedPlan = boosted.result.pokemonResults[0]!;
    expect(boostedPlan.reachableLine.boostedCandyUnits).toBeGreaterThan(0);
    expect(boostedPlan.reachableLine.dreamShardsUsed).toBeGreaterThan(0);
    expect(boostedPlan.shortage.expToTarget).toBeLessThan(plainPlan.shortage.expToTarget);
    expect(boostedPlan.reachableLine.candySupply.universal).toEqual({ s: 0, m: 0, l: 0 });
  });

  it('アメが回らない行は境界にならず、下の行をブロックしない', () => {
    const rows = [
      stockRow({ id: 'no-stock', pokedexId: 25, stockCandyTarget: 0 }),
      baseRow({ id: 'normal', pokedexId: 133, dstLevel: 12, boostCandyInput: 0 }),
    ];
    const input = buildPlannerInput(rows, stockSnapshot('none', { '25': 0, '133': 0 }))!;
    const outcome = solveLevelPlanWithBudget(input, { deadlineMs: 60_000 });
    expect(outcome.kind).toBe('result');
    if (outcome.kind !== 'result') return;

    const [stock, normal] = outcome.result.pokemonResults;
    expect(stock!.reachableLine.totalCandyUnitsUsed).toBe(0);
    expect(stock!.shortage.expToTarget).toBeGreaterThan(0);
    // 下の行は種族アメが無くても万能アメで目標へ届く（上の行が境界になっていない）。
    expect(normal!.reachableLine.effectiveTargetReached).toBe(true);
    expect(normal!.reachableLine.candySupply.species).toBe(0);
    expect(normal!.reachableLine.totalCandyUnitsUsed).toBeGreaterThan(0);
  });
});
