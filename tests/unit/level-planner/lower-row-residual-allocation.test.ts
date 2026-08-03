import { describe, expect, it } from 'vitest';

import {
  buildPlannerInput,
  type PlannerInputRowDto,
  type PlannerInputSnapshotDto,
} from '../../../src/domain/level-planner/buildPlannerInput';
import { solveLevelPlan } from '../../../src/domain/level-planner/core/solveLevelPlan';
import type { ItemCompareMode, LevelPlannerInput, LevelPlannerResult } from '../../../src/domain/level-planner/types';

type PokemonInput = LevelPlannerInput['pokemonList'][number];

/**
 * フェーズ3（下位行を残資源で処理する）の回帰。
 *
 * **正本**: `level-planner-allocation-policy-spec.md` §4-5
 * 「下位は残資源のみ: 上位＋境界の確定後、残ったかけら・アメブ枠・アメ在庫で優先順位順に個別処理する」
 * / `fbl01d_feasibility_witness境界EXP改善_設計書.md` §14.4「フェーズ3: 下位行」。
 *
 * **⚠ ここは不変条件だけを置く。ゴールデン値（実測の固定値）を混ぜないこと。**
 * 「上位の在庫量を変えても下位の配分が変わらない」「残資源を超えて使わない」など、
 * 値ではなく関係だけを見る。b4 と同じ事故（ゴールデン値の更新で不変条件まで書き換える）を避ける。
 *
 * 検出力: `solveLevelPlan.ts` の witness 長を超える行を `zeroLine` へ倒す実装へ戻すと、
 * 「上位の在庫に依存しない」「残資源を使い切る」系のアサーションが落ちる。
 */

function targetLevelRow(params: {
  id: string;
  pokedexId: number;
  type: string;
  targetLevel: number;
  priorityIndex: number;
  requestedBoostCandy?: number;
  /** 同じアメを共有する系統を作るとき（イーブイ系統など）だけ明示する。 */
  candyFamilyKey?: string;
  /** 個数指定。需要をアメ個数で直接与えたいときだけ使う。 */
  totalCandyUnits?: number;
}): PokemonInput {
  return {
    pokemonId: params.id,
    pokedexId: params.pokedexId,
    candyFamilyKey: params.candyFamilyKey ?? String(params.pokedexId),
    name: params.id,
    type: params.type,
    currentLevel: 10,
    currentExpInLevel: 0,
    targetLevel: params.targetLevel,
    targetExpInLevel: 0,
    expType: 600,
    nature: 'normal',
    requestedBoostCandy: params.requestedBoostCandy ?? 0,
    boostAllowed: true,
    priorityIndex: params.priorityIndex,
    ...(params.totalCandyUnits === undefined
      ? {}
      : { candyTarget: { totalCandyUnits: params.totalCandyUnits, boostedCandyUnits: 0 } }),
  };
}

function rowsOf(result: LevelPlannerResult) {
  return result.pokemonResults.map(row => ({
    id: row.pokemonId,
    role: row.role,
    boost: row.reachableLine.boostedCandyUnits,
    normal: row.reachableLine.nonBoostCandyUnits,
    total: row.reachableLine.totalCandyUnitsUsed,
    level: row.reachableLine.level,
    expInLevel: row.reachableLine.expInLevel,
    shards: row.reachableLine.dreamShardsUsed,
    supply: row.reachableLine.candySupply,
    candyDemandMet: row.reachableLine.candyDemandMet,
  }));
}

/**
 * 上位（ピカチュウ系）は自分の種族アメ在庫だけで律速され、境界になる。
 * 下位（カビゴン系）は別系統の在庫を持ち、上位の在庫量に一切依存しない。
 */
function separateFamilies(upperStock: number, dreamShards = 999_999_999): LevelPlannerInput {
  return {
    pokemonList: [
      targetLevelRow({ id: 'upper', pokedexId: 25, type: 'electric', targetLevel: 40, priorityIndex: 0 }),
      targetLevelRow({ id: 'lower', pokedexId: 143, type: 'normal', targetLevel: 20, priorityIndex: 1 }),
    ],
    dreamShards,
    boost: { kind: 'none', limit: 0 },
    candyInventory: {
      species: { '25': upperStock, '143': 5_000 },
      typeCandy: {},
      universal: { s: 0, m: 0, l: 0 },
    },
    options: { itemCompareMode: 'surplusGateFirst' },
  };
}

describe('フェーズ3: 境界より下の行は残資源で処理する', () => {
  it('上位が在庫律速で境界になっても、下位は自分の在庫で到達する', () => {
    const plenty = solveLevelPlan(separateFamilies(5_000));
    const scarce = solveLevelPlan(separateFamilies(50));

    // 手法6: 前提の成立。潤沢版は境界なし、乏しい版は上位が境界。
    expect(plenty.summary.boundaryPokemonId).toBeUndefined();
    expect(scarce.summary.boundaryPokemonId).toBe('upper');
    expect(rowsOf(scarce)[0]).toMatchObject({ role: 'boundary', candyDemandMet: false });

    // 手法6: 下位が使える資源が本当に残っている。
    expect(scarce.summary.speciesCandyRemaining['143']).toBeGreaterThan(0);
    expect(scarce.summary.dreamShardsRemaining).toBeGreaterThan(0);

    // 本題: 下位は 0 ではなく、自分の在庫で目標に到達する。
    const scarceLower = rowsOf(scarce)[1]!;
    expect(scarceLower.total).toBeGreaterThan(0);
    expect(scarceLower.level).toBe(20);
    expect(scarceLower.candyDemandMet).toBe(true);
  });

  it('手法1: 上位の在庫量を変えても、系統が別な下位の配分は変わらない', () => {
    // `role` は境界位置から決まるラベルなので、変わるのが正しい。配分だけを比べる。
    const allocationOf = (upperStock: number) => {
      const { role: _role, ...allocation } = rowsOf(solveLevelPlan(separateFamilies(upperStock)))[1]!;
      return allocation;
    };

    expect(allocationOf(50)).toEqual(allocationOf(5_000));
    expect(allocationOf(0)).toEqual(allocationOf(5_000));
  });

  it('境界の位置と到達数は、下位処理で動かない', () => {
    const scarce = solveLevelPlan(separateFamilies(50));

    // 下位が到達しても、境界は「最初の未達行」のまま。
    expect(scarce.summary.boundaryPokemonId).toBe('upper');
    expect(scarce.summary.fullyReachedCount).toBe(0);
    expect(rowsOf(scarce).map(row => row.role)).toEqual(['boundary', 'lower']);
  });

  it('下位は残資源を超えて使わない（在庫・かけらの両方）', () => {
    // 下位の在庫を目標に届かない量へ絞る。
    const input: LevelPlannerInput = {
      ...separateFamilies(50),
      candyInventory: {
        species: { '25': 50, '143': 40 },
        typeCandy: {},
        universal: { s: 0, m: 0, l: 0 },
      },
    };
    const result = solveLevelPlan(input);
    const lower = rowsOf(result)[1]!;

    expect(lower.supply.species).toBeLessThanOrEqual(40);
    expect(lower.total).toBeGreaterThan(0);
    expect(lower.level).toBeLessThan(20);
    expect(result.summary.speciesCandyRemaining['143']).toBeGreaterThanOrEqual(0);
    expect(result.summary.dreamShardsRemaining).toBeGreaterThanOrEqual(0);
  });

  it('対照: かけらが尽きていれば下位は 0 のままでよい（過剰修正の検出）', () => {
    // 上位が 50 個ぶんのかけらを使い切る額だけ渡す。
    const upperOnly = solveLevelPlan(separateFamilies(50));
    const usedByUpper = rowsOf(upperOnly)[0]!.shards;
    const result = solveLevelPlan(separateFamilies(50, usedByUpper));
    const lower = rowsOf(result)[1]!;

    expect(rowsOf(result)[0]!.shards).toBe(usedByUpper);
    expect(lower.total).toBe(0);
    expect(lower.level).toBe(10);
  });

  it('3行: 境界より下が2行あっても、優先順位順に残資源が回る', () => {
    const build = (midStock: number): LevelPlannerInput => ({
      pokemonList: [
        targetLevelRow({ id: 'r0', pokedexId: 1, type: 'grass', targetLevel: 20, priorityIndex: 0 }),
        targetLevelRow({ id: 'r1', pokedexId: 25, type: 'electric', targetLevel: 40, priorityIndex: 1 }),
        targetLevelRow({ id: 'r2', pokedexId: 143, type: 'normal', targetLevel: 20, priorityIndex: 2 }),
      ],
      dreamShards: 999_999_999,
      boost: { kind: 'none', limit: 0 },
      candyInventory: {
        species: { '1': 5_000, '25': midStock, '143': 5_000 },
        typeCandy: {},
        universal: { s: 0, m: 0, l: 0 },
      },
      options: { itemCompareMode: 'surplusGateFirst' },
    });

    const plenty = rowsOf(solveLevelPlan(build(5_000)));
    const scarce = rowsOf(solveLevelPlan(build(50)));

    expect(scarce[1]).toMatchObject({ role: 'boundary', candyDemandMet: false });
    expect(scarce[2]).toMatchObject({ role: 'lower', level: 20, candyDemandMet: true });
    // 上位・下位とも系統が別なので、中段の在庫量に依存しない（`role` ラベルだけは動く）。
    const withoutRole = ({ role: _role, ...rest }: (typeof plenty)[number]) => rest;
    expect(withoutRole(scarce[0]!)).toEqual(withoutRole(plenty[0]!));
    expect(withoutRole(scarce[2]!)).toEqual(withoutRole(plenty[2]!));
  });
});

// ------------------------------------------------------------------
// 睡眠まわり。フェーズ3 は planner 境界を通った DTO をそのまま扱うので、
// 「すべて睡眠」の仮想0個需要と、睡眠EXPを差し引いたアメ担当終端の両方を経由する。
// ------------------------------------------------------------------

const sleepSnapshot = (): PlannerInputSnapshotDto => ({
  candyInventory: {
    species: { '25': 50, '143': 5_000, '133': 5_000 },
    typeCandy: {},
    universal: { s: 0, m: 0, l: 0 },
  },
  dreamShards: 999_999_999,
  boost: { kind: 'full', limit: 3_500 },
  itemCompareMode: 'surplusGateFirst',
});

const sleepRow = (patch: Partial<PlannerInputRowDto>): PlannerInputRowDto => ({
  id: 'r',
  pokedexId: 25,
  title: 'r',
  pokemonType: 'electric',
  srcLevel: 10,
  dstLevel: 40,
  expRemaining: 0,
  expType: 600,
  nature: 'normal',
  mode: 'targetLevel',
  boostReachLevel: 40,
  candyPeak: 20,
  candyTarget: undefined,
  boostCandyInput: 0,
  sleepExp: 0,
  ...patch,
});

describe('フェーズ3 × 睡眠', () => {
  it('睡眠目標がある行が境界より下でも、アメ担当終端まで残資源で賄う', () => {
    const input = buildPlannerInput([
      sleepRow({ id: 'upper', pokedexId: 25, pokemonType: 'electric' }),
      sleepRow({ id: 'lower-sleep', pokedexId: 143, pokemonType: 'normal', dstLevel: 30, sleepExp: 5_000 }),
    ], sleepSnapshot())!;

    // 手法6: 前提。睡眠EXPを差し引いた必要アメ数が DTO に載っている。
    const demand = input.pokemonList[1]!.candyTarget?.totalCandyUnits;
    expect(demand).toBeGreaterThan(0);

    const rows = rowsOf(solveLevelPlan(input));
    expect(rows[0]).toMatchObject({ role: 'boundary', candyDemandMet: false });
    // 下位でも、アメが担当する区間ぶんはきちんと配られる（0 に落ちない）。
    expect(rows[1]).toMatchObject({ role: 'lower', total: demand, candyDemandMet: true });
    expect(rows[1]!.level).toBeGreaterThan(10);
  });

  it('§2.7: 「すべて睡眠」が境界より下でも、休眠アメブ値は下位の枠を奪わない', () => {
    const build = (dormantBoost: number) => buildPlannerInput([
      sleepRow({ id: 'upper', pokedexId: 25, pokemonType: 'electric', boostCandyInput: 400 }),
      sleepRow({
        id: 'lower-all', pokedexId: 143, pokemonType: 'normal',
        sleepTargetMode: 'all', boostCandyInput: dormantBoost, sleepExp: 99_999,
      }),
      sleepRow({ id: 'lower-plain', pokedexId: 133, pokemonType: 'psychic', dstLevel: 45, boostCandyInput: 3_000 }),
    ], sleepSnapshot())!;

    // 休眠アメブ値を振っても、モード行は0のまま・下位の非モード行への付与も変わらない。
    const observed = [0, 900, 9_999].map(dormant => rowsOf(solveLevelPlan(build(dormant))));
    for (const rows of observed) {
      expect(rows[0]).toMatchObject({ role: 'boundary', candyDemandMet: false });
      expect(rows[1]).toMatchObject({ role: 'lower', boost: 0, normal: 0, total: 0, candyDemandMet: true });
      expect(rows[2]!.boost).toBeGreaterThan(0);
      expect(rows).toEqual(observed[0]);
    }
  });
});

// ------------------------------------------------------------------
// 共有種族が境界より下に2行以上あるとき。
// `fbl01d_feasibility_witness境界EXP改善_設計書.md` §6 の反例と同じ形が、
// フェーズ3 の逐次貪欲でだけ起きていた。
// ------------------------------------------------------------------

/**
 * イーブイ系統のように、タイプが違っても同じアメを共有する系統（代表IDはイーブイ）。
 *
 * **`candyFamilyKey` は型こそ `string` だが、実装の契約は「正の整数文字列」**
 * （`feasibilityWitness.ts` の `validateDemandRows` と `candy-family.ts` の両方が `/^[1-9]\d*$/` で検査する）。
 * 破ると `invalid_candy_family_key` でその prefix ごと infeasible になり、**到達数が黙って落ちる。**
 */
const SHARED_FAMILY = '133';

type SharedFamilyCase = {
  demandA: number;
  demandB: number;
  /** B のタイプ。A（水）と同じなら B もタイプアメを使える。 */
  typeB: string;
  species: number;
  typeM: number;
};

/**
 * 同じ2行・同じ在庫を「境界より上」と「境界より下」の両方へ置いて比べる（手法1）。
 *
 * 先頭のブロッカーは自分の種族アメだけで律速する別系統・別タイプの行で、
 * 万能アメを 0 にしてあるので**下位の資源を1つも奪わない**。つまり2つの入力の違いは
 * 「対象の2行が witness に入るか、フェーズ3 へ落ちるか」だけになる。
 */
function sharedFamilyPair(testCase: SharedFamilyCase, withBlocker: boolean): LevelPlannerInput {
  const pair = [
    targetLevelRow({
      id: 'A', pokedexId: 134, type: 'water', targetLevel: 70, priorityIndex: 0,
      candyFamilyKey: SHARED_FAMILY, totalCandyUnits: testCase.demandA,
    }),
    targetLevelRow({
      id: 'B', pokedexId: 136, type: testCase.typeB, targetLevel: 70, priorityIndex: 1,
      candyFamilyKey: SHARED_FAMILY, totalCandyUnits: testCase.demandB,
    }),
  ];
  return {
    pokemonList: withBlocker
      ? [
          targetLevelRow({ id: 'blocker', pokedexId: 25, type: 'electric', targetLevel: 40, priorityIndex: 0 }),
          ...pair.map((row, index) => ({ ...row, priorityIndex: index + 1 })),
        ]
      : pair,
    dreamShards: 999_999_999,
    boost: { kind: 'none', limit: 0 },
    candyInventory: {
      species: { '25': 10, [SHARED_FAMILY]: testCase.species },
      typeCandy: { water: { s: 0, m: testCase.typeM } },
      universal: { s: 0, m: 0, l: 0 },
    },
    options: { itemCompareMode: 'surplusGateFirst' },
  };
}

/** §6 の反例そのもの。A は種族なし（タイプM単独）でも到達でき、B は種族でしか到達できない。 */
const SAME_TYPE_CASE: SharedFamilyCase = { demandA: 25, demandB: 4, typeB: 'water', species: 4, typeM: 1 };
/** 掃引が出した最小例。A が「余り0の種族1個」を取ると B が死ぬ。 */
const CROSS_TYPE_CASE: SharedFamilyCase = { demandA: 1, demandB: 1, typeB: 'fire', species: 1, typeM: 1 };

const pairRowsOf = (input: LevelPlannerInput) => {
  const rows = rowsOf(solveLevelPlan(input));
  return rows.slice(rows.length - 2);
};
const reachedCountOf = (input: LevelPlannerInput) => pairRowsOf(input).filter(row => row.candyDemandMet).length;

describe('フェーズ3 × 共有種族（§6 の反例）', () => {
  const MODES: ItemCompareMode[] = ['surplusGateFirst', 'surplusFirst', 'legacyImproved'];

  const withMode = (input: LevelPlannerInput, mode: ItemCompareMode): LevelPlannerInput =>
    ({ ...input, options: { itemCompareMode: mode } });

  it.each(
    MODES.flatMap(mode => [
      [`同タイプ/${mode}`, SAME_TYPE_CASE, mode] as const,
      [`別タイプ/${mode}`, CROSS_TYPE_CASE, mode] as const,
    ]),
  )('%s: 境界より下でも、共有系統は2匹とも到達する', (_label, testCase, mode) => {
    const below = withMode(sharedFamilyPair(testCase, true), mode);

    // 手法6: 前提の成立。ブロッカーが境界で、対象の2行はフェーズ3 の担当（`lower`）に落ちている。
    const rows = rowsOf(solveLevelPlan(below));
    expect(rows[0]).toMatchObject({ id: 'blocker', role: 'boundary', candyDemandMet: false });
    expect(rows.slice(1).map(row => row.role)).toEqual(['lower', 'lower']);

    expect(reachedCountOf(below)).toBe(2);
  });

  /**
   * 手法1。上に無関係な未達行が1つあるかどうかで、下の2匹の到達数が変わってはいけない。
   *
   * **⚠ `surplusFirst` は §14.4.2 を直すまで比較対象から外してあった。**
   * 上位（主探索）側が §6 の反例を解けず、同じ2行・同じ在庫でも
   * 上位に置くと到達0・下位に置くと到達2という逆転が起きていた。
   * 原因は「余りゲートの下では prefix の可解性が単調にならない」ことで、
   * 単調性を前提にした二分探索が prefix2 を一度も試していなかった（正本は同 §14.4.2）。
   *
   * **同タイプだけ3モードで比べる。** 別タイプは `surplusFirst` に限り上下差が仕様どおり出るので、
   * 下の専用テストで別に固定してある（余り24 はハード制約を満たせない）。
   */
  it.each(MODES)(
    '手法1: 同タイプは、境界より上でも下でも到達数が同じになる: %s',
    mode => {
      // 同タイプは**余りゲートを守ったまま**両行とも余り0で到達できるので、3モードとも一致する。
      expect(reachedCountOf(withMode(sharedFamilyPair(SAME_TYPE_CASE, true), mode)))
        .toBe(reachedCountOf(withMode(sharedFamilyPair(SAME_TYPE_CASE, false), mode)));
    },
  );

  it.each(['surplusGateFirst', 'legacyImproved'] as const)(
    '手法1: 別タイプも、境界より上でも下でも到達数が同じになる: %s',
    mode => {
      expect(reachedCountOf(withMode(sharedFamilyPair(CROSS_TYPE_CASE, true), mode)))
        .toBe(reachedCountOf(withMode(sharedFamilyPair(CROSS_TYPE_CASE, false), mode)));
    },
  );

  /**
   * **⚠ 別タイプ × `surplusFirst` の上下差は仕様どおりで、§14.4.2 の取りこぼしではない。**
   *
   * 別タイプで到達2にする唯一の解は A（需要1）へ水タイプM（**価値25**）を渡す形で、**余り24**になる。
   * `surplusFirst` は各行余り0〜2をハード制約にするので**上位では採れない**（到達1が正しい）。
   * 境界より下はハード制約の対象外（`level-planner-priority-guide.md` §56
   * 「境界より下のポケモンはハード制約の対象外。残り資源による個別処理なので3以上になることがある」）
   * なので到達2になる。
   *
   * **この非対称を「上下一致」へ寄せてはいけない。** 寄せると、上位でゲートを捨てるか、
   * 下位でゲートを課すかのどちらかになり、仕様のどちらかを壊す。
   */
  it('surplusFirst: 余りゲートを守れない別タイプでは、上位の到達数が下位より少なくてよい', () => {
    expect(reachedCountOf(withMode(sharedFamilyPair(CROSS_TYPE_CASE, false), 'surplusFirst'))).toBe(1);
    expect(reachedCountOf(withMode(sharedFamilyPair(CROSS_TYPE_CASE, true), 'surplusFirst'))).toBe(2);
  });

  it('§6 の不変条件: 系統の種族アメ使用合計 === min(系統在庫, 系統内の需要合計)', () => {
    for (const testCase of [SAME_TYPE_CASE, CROSS_TYPE_CASE]) {
      const rows = pairRowsOf(sharedFamilyPair(testCase, true));
      const species = rows.reduce((sum, row) => sum + row.supply.species, 0);
      const typeM = rows.reduce((sum, row) => sum + row.supply.type.m, 0);
      // 「在庫以下」では、種族アメを一部しか使わなくなっても通ってしまう。
      // §6 は使用総量の最大化を不変条件としているので、一致で固定する。
      expect(species).toBe(Math.min(testCase.species, testCase.demandA + testCase.demandB));
      expect(typeM).toBeLessThanOrEqual(testCase.typeM);
    }
  });

  it('上位（境界）の配分は、下位の共有系統をどう解いても動かない', () => {
    // §3-2「上位の到達は絶対保護」。下位の需要を振ってもブロッカーの行は不変。
    const blockerOf = (testCase: SharedFamilyCase) => rowsOf(solveLevelPlan(sharedFamilyPair(testCase, true)))[0]!;
    expect(blockerOf(CROSS_TYPE_CASE)).toEqual(blockerOf(SAME_TYPE_CASE));
  });

  /**
   * **共有種族が無くても、per-row 最適が全体で負ける**（外部レビューの指摘で判明）。
   *
   * 当初は「万能アメは境界までで使い切られるので、共有種族が無ければ逐次処理は負けない」と
   * 結論づけていたが、**掃引の範囲が狭すぎただけだった**（万能アメを0固定・タイプ在庫と需要が小さい）。
   * 取り合う資源が種族アメかタイプアメか万能アメかは、負ける条件と無関係である。
   */
  it.each(MODES)('共有種族が無くても、同タイプのタイプアメ競合で到達数を落とさない: %s', mode => {
    // A(需要50) は typeM×2(50/余り0) と typeS×13(52/余り2) の2択。
    // typeS を取ると、残る typeM×2（価値50）では B(需要51) が届かない。
    const input: LevelPlannerInput = {
      pokemonList: [
        targetLevelRow({ id: 'blocker', pokedexId: 25, type: 'electric', targetLevel: 70, priorityIndex: 0, totalCandyUnits: 1 }),
        targetLevelRow({ id: 'A', pokedexId: 7, type: 'water', targetLevel: 70, priorityIndex: 1, totalCandyUnits: 50 }),
        targetLevelRow({ id: 'B', pokedexId: 8, type: 'water', targetLevel: 70, priorityIndex: 2, totalCandyUnits: 51 }),
      ],
      dreamShards: 999_999_999,
      boost: { kind: 'none', limit: 0 },
      candyInventory: {
        species: {},
        typeCandy: { water: { s: 13, m: 2 } },
        universal: { s: 0, m: 0, l: 0 },
      },
      options: { itemCompareMode: mode },
    };
    const rows = rowsOf(solveLevelPlan(input));
    expect(rows[0]).toMatchObject({ role: 'boundary', candyDemandMet: false });
    expect(rows.slice(1).filter(row => row.candyDemandMet)).toHaveLength(2);
  });

  /**
   * **⚠ 2026-08-01 に前提を更新した（§14.4.3 の対応）。**
   *
   * `blocker` は電気タイプで在庫が万能M（価値20）しかなく、需要1に対して余り19になる。
   * 以前は `surplusFirst` のゲート（余り0〜2）に阻まれて **`blocker` が0個で境界**になり、
   * その裏で下位2匹が資源を取り合う形をテストしていた。
   *
   * §14.4.3 を直した結果、**ゲート内で1匹も到達できないのでバランスへ切り替わり**、
   * 優先度1位の `blocker` が到達する。到達数2は変わらない（このテストの主旨は保たれている）。
   */
  it('共有種族が無くても、タイプアメと万能アメの競合で到達数を落とさない', () => {
    // A(水/需要17) は universalM(20/余り3) と water typeM(25/余り8) の2択。
    // 万能M を取ると、B(炎/需要20) は水アメを使えないので 0 個になる。
    const input: LevelPlannerInput = {
      pokemonList: [
        targetLevelRow({ id: 'blocker', pokedexId: 25, type: 'electric', targetLevel: 70, priorityIndex: 0, totalCandyUnits: 1 }),
        targetLevelRow({ id: 'A', pokedexId: 7, type: 'water', targetLevel: 70, priorityIndex: 1, totalCandyUnits: 17 }),
        targetLevelRow({ id: 'B', pokedexId: 4, type: 'fire', targetLevel: 70, priorityIndex: 2, totalCandyUnits: 20 }),
      ],
      dreamShards: 999_999_999,
      boost: { kind: 'none', limit: 0 },
      candyInventory: {
        species: {},
        typeCandy: { water: { s: 0, m: 1 } },
        universal: { s: 0, m: 1, l: 0 },
      },
      // 他モードでは境界行が万能Mを取って構造が変わるため、この入力は surplusFirst で見る。
      options: { itemCompareMode: 'surplusFirst' },
    };
    const rows = rowsOf(solveLevelPlan(input));
    // 到達数2が主旨。優先度1位の blocker がバランスへの切り替えで到達し、B が境界になる。
    expect(rows.filter(row => row.candyDemandMet)).toHaveLength(2);
    expect(rows.map(row => row.candyDemandMet)).toEqual([true, true, false]);
  });

  it('到達しえない下位行が1つあっても、その後ろの行は合同探索の対象から外れない', () => {
    // 先頭の下位行が到達しえないと、prefix が 0 で止まって後続が全部逐次へ落ちていた。
    const input: LevelPlannerInput = {
      pokemonList: [
        targetLevelRow({ id: 'blocker', pokedexId: 25, type: 'electric', targetLevel: 70, priorityIndex: 0, totalCandyUnits: 1 }),
        targetLevelRow({ id: 'dead', pokedexId: 133, type: 'psychic', targetLevel: 70, priorityIndex: 1, totalCandyUnits: 9_999 }),
        targetLevelRow({ id: 'A', pokedexId: 7, type: 'water', targetLevel: 70, priorityIndex: 2, totalCandyUnits: 50 }),
        targetLevelRow({ id: 'B', pokedexId: 8, type: 'water', targetLevel: 70, priorityIndex: 3, totalCandyUnits: 51 }),
      ],
      dreamShards: 999_999_999,
      boost: { kind: 'none', limit: 0 },
      candyInventory: {
        species: {},
        typeCandy: { water: { s: 13, m: 2 } },
        universal: { s: 0, m: 0, l: 0 },
      },
      options: { itemCompareMode: 'surplusGateFirst' },
    };
    const rows = rowsOf(solveLevelPlan(input));
    expect(rows[1]).toMatchObject({ id: 'dead', candyDemandMet: false });
    expect(rows.slice(2).filter(row => row.candyDemandMet)).toHaveLength(2);
  });

  it('対照: 種族アメが1個も無ければ、共有系統でも配り方は変わらない（過剰修正の検出）', () => {
    // 種族在庫 0。A がタイプM を取り、B は資源が無いので 0 のまま。これは資源不足であって
    // 配り方の問題ではない（§14.4 の ⚠「下位の余りが 0 にならないのは正常」と同じ筋）。
    const rows = pairRowsOf(sharedFamilyPair({ ...SAME_TYPE_CASE, species: 0 }, true));
    expect(rows[0]).toMatchObject({ candyDemandMet: true, total: 25 });
    expect(rows[1]).toMatchObject({ candyDemandMet: false, total: 0 });
  });
});
