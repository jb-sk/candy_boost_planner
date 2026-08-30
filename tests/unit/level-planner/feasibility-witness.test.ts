import { describe, expect, it, vi } from 'vitest';
import {
  createIndependentBoundaryFeasibilitySession,
  createPrefixDecisionSession,
  refineFeasibilityWitness,
  solveFeasibilityDecisionForFixedRows,
  solveFeasibilityForFixedRows,
  validateFeasibilityWitness,
} from '../../../src/domain/level-planner/core/feasibilityWitness';
import { CANDY_VALUES, MAX_ACCEPTABLE_SURPLUS } from '../../../src/domain/level-planner/constants';
import { refineExactSupply } from '../../../src/domain/level-planner/core/exactSupplyRefine';
import { __levelPlannerTestHooks, solveLevelPlan } from '../../../src/domain/level-planner/core/solveLevelPlan';
import { simulateCandyBudget } from '../../../src/domain/pokesleep/simulateCandyBudget';
import type {
  CandyInventory,
  FeasibilityDemandRow,
  FeasibilityWitness,
  LevelPlannerInput,
  SolverItemCompareMode,
} from '../../../src/domain/level-planner/types';

const noBoost = {
  boostKind: 'none' as const,
  boostLimit: 0,
  dreamShards: Infinity,
};

function demandRow(
  pokemonId: string,
  pokedexId: number,
  type: string,
  totalCandy: number,
  overrides: Partial<FeasibilityDemandRow> = {},
): FeasibilityDemandRow {
  return {
    pokemonId,
    pokedexId,
    candyFamilyKey: String(pokedexId),
    type,
    totalCandy,
    boostCandy: 0,
    normalCandy: totalCandy,
    shards: 0,
    reachedLv: 20,
    expInLevel: 0,
    candyDemandMet: true,
    ...overrides,
  };
}

function emptyInventory(): CandyInventory {
  return {
    species: {},
    typeCandy: {},
    universal: { s: 0, m: 0, l: 0 },
  };
}

/**
 * §6 / §14.4.2 の反例で使う共有系統（イーブイ）。
 *
 * **`candyFamilyKey` の契約は「正の整数文字列」**（`candy-family.ts` の `isCandyFamilyKey()` が正本）。
 * `'shared-family'` のような任意の文字列を使うと `invalid_candy_family_key` で
 * **その prefix ごと infeasible になり、到達数が黙って落ちる。**
 */
const SHARED_EEVEE_FAMILY = '133';

/** 種族4・水タイプM1個（価値25）。§6 の反例そのもの。 */
function sharedFamilyInventory(): CandyInventory {
  return {
    species: { [SHARED_EEVEE_FAMILY]: 4 },
    typeCandy: { water: { s: 0, m: 1 } },
    universal: { s: 0, m: 0, l: 0 },
  };
}

function expectFeasible(
  result: ReturnType<typeof solveFeasibilityForFixedRows>,
): asserts result is Extract<ReturnType<typeof solveFeasibilityForFixedRows>, { status: 'feasible' }> {
  expect(result.status, JSON.stringify(result)).toBe('feasible');
}

describe('fbl01d feasibility witness', () => {
  it('目標到達行の余り合計上限を未達境界の余りと分けて検証する', () => {
    const inventory: CandyInventory = {
      species: {},
      typeCandy: {},
      universal: { s: 0, m: 3, l: 0 },
    };
    const twoReachedAndBoundary = [
      demandRow('upper-a', 1, 'normal', 19),
      demandRow('upper-b', 2, 'normal', 19),
      demandRow('boundary', 3, 'normal', 18, { candyDemandMet: false }),
    ];
    const valid = solveFeasibilityForFixedRows(twoReachedAndBoundary, inventory, {
      ...noBoost,
      itemCompareMode: 'surplusFirst',
      maxRowSurplus: 2,
      maxReachedSurplus: 2,
      maxTotalSurplus: 4,
    });
    expectFeasible(valid);
    expect(valid.witness.rows.map(row => row.supply.universalM)).toEqual([1, 1, 1]);

    const threeReached = solveFeasibilityForFixedRows(
      twoReachedAndBoundary.map(row => ({ ...row, candyDemandMet: true })),
      inventory,
      {
        ...noBoost,
        itemCompareMode: 'surplusFirst',
        maxRowSurplus: 2,
        maxReachedSurplus: 2,
        maxTotalSurplus: 4,
      },
    );
    expect(threeReached.status).toBe('infeasible');
  });

  it('prefix decision sessionは通常solverとprefixごとの可否が一致する', () => {
    const rows = [
      demandRow('p1', 1, 'alpha', 13),
      demandRow('p2', 2, 'alpha', 21),
      demandRow('p3', 3, 'beta', 19),
      demandRow('p4', 4, 'alpha', 34),
    ];
    const inventory: CandyInventory = {
      species: { '1': 4, '2': 5, '3': 0, '4': 8 },
      typeCandy: { alpha: { s: 12, m: 2 }, beta: { s: 1, m: 1 } },
      universal: { s: 16, m: 2, l: 0 },
    };
    const options = { ...noBoost, itemCompareMode: 'legacyImproved' as const };
    const session = createPrefixDecisionSession(rows, inventory, options);

    for (const length of [0, 1, 2, 3, 4]) {
      const expected = solveFeasibilityDecisionForFixedRows(rows.slice(0, length), inventory, options);
      const actual = session.canSolvePrefix(length);
      expect(actual.status).toBe(expected.status);
      if (actual.status !== 'feasible') {
        expect(expected.status).not.toBe('feasible');
        if (expected.status !== 'feasible') expect(actual.reason).toBe(expected.reason);
      }
    }
  });

  it('prefix独立探索の締切超過は例外ではなくinconclusiveとして返す', () => {
    const rows = [
      demandRow('p1', 1, 'alpha', 13),
      demandRow('p2', 2, 'beta', 21),
      demandRow('p3', 3, 'gamma', 19),
    ];
    const inventory: CandyInventory = {
      species: {},
      typeCandy: {},
      universal: { s: 32, m: 8, l: 2 },
    };
    const session = createPrefixDecisionSession(rows, inventory, {
      ...noBoost,
      deadlineMs: 0,
    });

    expect(session.canSolvePrefix(3)).toMatchObject({
      status: 'inconclusive',
      reason: 'deadline_exceeded',
    });
  });

  /**
   * `deadlineMs` は solver context ごとに開始時刻から測り直されるため、prefix 二分探索のように
   * context を何度も作る経路では **probe ごとに満額使えてしまう**。
   * 全 context が共有する絶対締切として `deadlineAt` を足してある。
   *
   * 検出力: `checkpoint()` の `deadlineAt` 判定を消すと、両方とも feasible になって落ちる。
   */
  it('deadlineAt は context をまたいで共有され、probe ごとにリセットされない', () => {
    const rows = [
      demandRow('p1', 1, 'alpha', 13),
      demandRow('p2', 2, 'beta', 21),
      demandRow('p3', 3, 'gamma', 19),
    ];
    const inventory: CandyInventory = { species: {}, typeCandy: {}, universal: { s: 32, m: 8, l: 2 } };
    // 締切は既に過ぎている。`deadlineMs` は与えないので、絶対締切だけが効く。
    const options = { ...noBoost, deadlineAt: performance.now() - 1 };

    // 単発の solve も、session 経由の probe も、同じ絶対締切で打ち切られる。
    expect(solveFeasibilityForFixedRows(rows, inventory, options)).toMatchObject({
      status: 'inconclusive',
      reason: 'deadline_exceeded',
    });
    const session = createPrefixDecisionSession(rows, inventory, options);
    for (const length of [1, 2, 3]) {
      expect(session.canSolvePrefix(length)).toMatchObject({
        status: 'inconclusive',
        reason: 'deadline_exceeded',
      });
    }
  });

  it('prefix decision sessionは共有種族を含むprefixでは安全に通常solverへ退避する', () => {
    const rows = [
      demandRow('p1', 1, 'alpha', 13),
      demandRow('p2', 11, 'alpha', 21, { candyFamilyKey: '1' }),
      demandRow('p3', 2, 'beta', 19),
    ];
    const inventory: CandyInventory = {
      species: { '1': 20, '2': 0 },
      typeCandy: { alpha: { s: 2, m: 1 }, beta: { s: 4, m: 0 } },
      universal: { s: 8, m: 1, l: 0 },
    };
    const session = createPrefixDecisionSession(rows, inventory, noBoost);

    for (const length of [1, 2, 3]) {
      const expected = solveFeasibilityDecisionForFixedRows(rows.slice(0, length), inventory, noBoost);
      expect(session.canSolvePrefix(length).status).toBe(expected.status);
    }
  });

  /**
   * §14.4.2 の前提（手法6）。**行余りゲートの下では prefix の可解性が単調にならない。**
   *
   * §6 の不変条件「系統の種族アメ使用合計 = min(系統在庫, 系統内の需要合計)」により、
   * **prefix が短いほど種族アメの受け取り先が減り、余りとして計上される。**
   * `surplusFirst` の行余りゲート（0〜2）はその余りを弾くので、短い prefix だけが落ちる。
   *
   * 同系統2行（需要25と4）・種族在庫4・タイプM1個（価値25）:
   *
   * - prefix1（A だけ）: 種族4は必ず使うので typeM も足して供給29 → **余り4 > ゲート2** → infeasible
   * - prefix2（A+B）  : B が種族4を引き受け、A は typeM 単独 → **両行とも余り0** → feasible
   *
   * この非単調性は**種族アメ固有**である。タイプアメ・万能アメには使用総量の不変条件が無い。
   */
  it('§14.4.2: 行余りゲート下では prefix の可解性が単調にならない', () => {
    const rows = [
      demandRow('A', 134, 'water', 25, { candyFamilyKey: SHARED_EEVEE_FAMILY }),
      demandRow('B', 136, 'water', 4, { candyFamilyKey: SHARED_EEVEE_FAMILY }),
    ];
    const session = createPrefixDecisionSession(rows, sharedFamilyInventory(), {
      ...noBoost,
      itemCompareMode: 'surplusFirst',
      maxRowSurplus: MAX_ACCEPTABLE_SURPLUS,
    });

    expect(session.canSolvePrefix(1).status).toBe('infeasible');
    expect(session.canSolvePrefix(2).status).toBe('feasible');
  });

  /**
   * §14.4.2 の本題。**ゲート内に到達2の解があるのに、二分探索が prefix2 を試さず取りこぼしていた。**
   *
   * `findPrefix` は prefix の可解性が単調だと仮定して二分探索する。上のテストのとおり
   * ゲート下では単調にならないので、`surplusFirst` だけが prefix1 の infeasible を見た時点で
   * 打ち切り、**優先度の高い A を未達のまま境界にしていた**（B だけが到達）。
   *
   * 対照（手法7）: `surplusGateFirst` / `legacyImproved` は元から到達2。
   * この2モードが通ったままであることが、修正が surplusFirst の取りこぼしだけを直した証拠になる。
   *
   * 検出力: `findPrefix` の上側スキャンを消すと `surplusFirst` だけが落ちる。
   */
  it.each(['surplusFirst', 'surplusGateFirst', 'legacyImproved'] as const)(
    '§14.4.2: ゲート内に解があれば到達数を取りこぼさない: %s',
    mode => {
      const row = (id: string, pokedexId: number, totalCandyUnits: number): LevelPlannerInput['pokemonList'][number] => ({
        pokemonId: id, pokedexId, candyFamilyKey: SHARED_EEVEE_FAMILY, name: id, type: 'water',
        currentLevel: 10, currentExpInLevel: 0, targetLevel: 70, expType: 600, nature: 'normal',
        requestedBoostCandy: 0, boostAllowed: true,
        candyTarget: { totalCandyUnits, boostedCandyUnits: 0 },
        priorityIndex: id === 'A' ? 0 : 1,
      });
      const result = solveLevelPlan({
        pokemonList: [row('A', 134, 25), row('B', 136, 4)],
        dreamShards: 999_999_999,
        boost: { kind: 'none', limit: 0 },
        candyInventory: sharedFamilyInventory(),
        options: { itemCompareMode: mode },
      });

      // 優先度順に2匹とも到達する。片方だけなら、上位の A が落ちている。
      expect(result.pokemonResults.map(pokemon => pokemon.reachableLine.candyDemandMet)).toEqual([true, true]);
      // しかもハード制約（各行余り0〜2）を満たしたまま到達している。
      // 供給値はテスト側で独立に計算する（実装の supplyValue を借りない）。
      for (const pokemon of result.pokemonResults) {
        const supply = pokemon.reachableLine.candySupply;
        const supplyValue = supply.species
          + supply.type.s * CANDY_VALUES.type.s + supply.type.m * CANDY_VALUES.type.m
          + supply.universal.s * CANDY_VALUES.universal.s
          + supply.universal.m * CANDY_VALUES.universal.m
          + supply.universal.l * CANDY_VALUES.universal.l;
        expect(supplyValue - pokemon.reachableLine.totalCandyUnitsUsed).toBe(0);
      }
    },
  );

  /**
   * §14.4.2 の上側スキャンに対するプロパティテスト（2026-08-01・外部レビュー指摘4で強化）。
   *
   * **`findPrefix` の二分探索＋上側スキャンが、全長を線形に走査した最大 feasible 長と一致する。**
   * 個別の反例（上の2本）は「その形だけ」を固定するもので、
   * **中間の prefix 長だけが feasible になる形や、可解性が複数回反転する形は覆えていなかった。**
   *
   * 期待値は `createPrefixDecisionSession` を長いほうから線形に走査して独立に求める
   * （実装の探索順序を一切使わない）。`inconclusive` が出たケースは判定できないので飛ばす。
   *
   * > **⚠ 実測値に最終到達数（`pokemonResults` から数えたもの）を使わないこと。**
   * > `findPrefix` の返り値と最終到達数のあいだには **2周目への fallback（§14.4.3）・refine・
   * > フェーズ3**が挟まる。とくにフェーズ3は余りゲートの対象外なので、`findPrefix` が0を返しても
   * > 最終到達数が2になりうる（掃引1200件のうち378件でズレた）。最終到達数と比べると
   * > **`>=`（下回らない）としか書けず、「解けない prefix を feasible と誤判定して長く返す」誤りが
   * > 1件も落ちない。** 実測値は `prefixSearchAttempts[0].maxFeasiblePrefix`（探索そのものの返り値）を使う。
   *
   * > **⚠ `prefixSearch`（attempt をまたいだ最後の値）を見ないこと。**
   * > 上側スキャンは余りゲートがあるときだけ走るので、ゲートを外す2周目の `upperScanProbes` は**常に0**。
   * > fallback が発火した入力（掃引の約48%）でそちらを読むと、上限アサートが無条件に通って
   * > **1周目の探索量を誰も見張らなくなる。**
   *
   * 検出力: `findPrefix` の上側スキャンを消すと落ちる（2026-08-01 に確認）。
   */
  it('§14.4.2: findPrefix は線形走査の最大 feasible 長と一致する', { timeout: 120_000 }, () => {
    const families = ['133', '25', '172'];
    const types = ['water', 'electric'];
    const rng = (seed: number) => {
      let state = (seed ^ 0x9e37_79b9) >>> 0;
      return () => {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        return (state >>> 0) / 0x1_0000_0000;
      };
    };
    let compared = 0;
    let nonMonotonic = 0;
    let maxUpperScan = 0;
    let solverGrewBeyondPrefix = 0;
    // 検証は速度より網羅を採る（1200件で実測1秒未満）。範囲を狭めると非単調な形の対照が痩せる。
    for (let seed = 1; seed <= 1200; seed++) {
      const next = rng(seed);
      const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
      const count = int(2, 4);
      const specs = Array.from({ length: count }, (_, index) => ({
        id: `p${index}`,
        pokedexId: 900 + seed * 10 + index,
        candyFamilyKey: families[int(0, families.length - 1)],
        type: types[int(0, types.length - 1)],
        totalCandy: int(1, 28),
      }));
      const inventory: CandyInventory = {
        species: Object.fromEntries(families.map(family => [family, int(0, 6)])),
        typeCandy: Object.fromEntries(types.map(type => [type, { s: int(0, 2), m: int(0, 1) }])),
        universal: { s: int(0, 2), m: int(0, 1), l: 0 },
      };
      // 種族アメの順位は入力配列順からソルバー内部で導出されるので、呼び出し側は指定しない。
      // オラクル側も同じ配列順を比較時に使うことで、同じ問題を独立に解く。
      const rows = specs.map(spec => demandRow(spec.id, spec.pokedexId, spec.type, spec.totalCandy, {
        candyFamilyKey: spec.candyFamilyKey,
      }));
      const session = createPrefixDecisionSession(rows, inventory, {
        ...noBoost,
        itemCompareMode: 'surplusFirst',
        maxRowSurplus: MAX_ACCEPTABLE_SURPLUS,
      });
      // 長いほうから線形に走査して最大 feasible 長を求める（実装の探索順序を借りない）。
      const statuses = Array.from({ length: rows.length }, (_, index) => session.canSolvePrefix(index + 1).status);
      if (statuses.includes('inconclusive')) continue;
      const expectedPrefix = statuses.lastIndexOf('feasible') + 1;
      // 短い prefix が infeasible なのに長いほうが feasible な形（＝二分探索が取りこぼす形）を数える。
      if (statuses.slice(0, expectedPrefix).includes('infeasible')) nonMonotonic++;

      const result = solveLevelPlan({
        pokemonList: specs.map((spec, index) => ({
          pokemonId: spec.id, pokedexId: spec.pokedexId, candyFamilyKey: spec.candyFamilyKey,
          name: spec.id, type: spec.type,
          currentLevel: 10, currentExpInLevel: 0, targetLevel: 70, expType: 600 as const, nature: 'normal' as const,
          requestedBoostCandy: 0, boostAllowed: true,
          candyTarget: { totalCandyUnits: spec.totalCandy, boostedCandyUnits: 0 },
          priorityIndex: index,
        })),
        dreamShards: 999_999_999,
        boost: { kind: 'none', limit: 0 },
        candyInventory: inventory,
        options: { itemCompareMode: 'surplusFirst' },
      });
      const met = result.pokemonResults.map(pokemon => pokemon.reachableLine.candyDemandMet);
      const reached = met.findIndex(value => !value) === -1 ? met.length : met.findIndex(value => !value);
      compared++;

      // 本題。1周目（余りゲート内）の探索が返した最大 feasible 長が、線形走査の正解と一致すること。
      const gatedSearch = result.performance?.prefixSearchAttempts?.[0];
      expect(gatedSearch, `seed=${seed}`).toBeDefined();
      expect(gatedSearch!.maxFeasiblePrefix, `seed=${seed} statuses=${statuses.join(',')}`)
        .toBe(expectedPrefix);

      // 探索量の上限（外部レビュー指摘4）。上側スキャンは N から low+1 まで降順に見て
      // 最初の feasible で打ち切るので、**行数を超えて走ってはいけない。**
      // 実時間ではなく probe 回数で固定する（負荷でぶれないため）。
      expect(gatedSearch!.upperScanProbes, `seed=${seed} probes=${JSON.stringify(gatedSearch)}`)
        .toBeLessThanOrEqual(specs.length);
      maxUpperScan = Math.max(maxUpperScan, gatedSearch!.upperScanProbes);

      // ソルバー全体としても取りこぼさない（こちらは別の主張。fallback とフェーズ3の上積みを許す）。
      expect(reached, `seed=${seed} statuses=${statuses.join(',')} met=${met.join(',')}`)
        .toBeGreaterThanOrEqual(expectedPrefix);
      if (reached > expectedPrefix) solverGrewBeyondPrefix++;
    }
    // 対照: 比較が成立したケースと、二分探索だけでは取りこぼす形が実際に含まれていること。
    expect(compared, '比較できたケースが少なすぎる').toBeGreaterThan(500);
    expect(nonMonotonic, '非単調な形が1件も生成されていない（掃引が弱い）').toBeGreaterThan(0);
    // 上側スキャンが1度も走っていなければ、上の上限アサートは何も見張っていない。
    expect(maxUpperScan, '上側スキャンが1件も走っていない（掃引が弱い）').toBeGreaterThan(0);
    // 対照: 最終到達数が prefix 探索の返り値より増えるケースが実在すること。
    // 0件なら「最終到達数で代用しても同じ」ことになり、上の一致アサートを分けた意味が無い。
    expect(solverGrewBeyondPrefix, '最終到達数が prefix 長を上回るケースが1件も無い（掃引が弱い）')
      .toBeGreaterThan(0);
  });

  /**
   * §14.4.3。**ゲート内で1匹も育たないなら、ハードゲートを外して探し直す。**
   *
   * `surplusFirst` は2段構えで「まず各行余り0〜2を守って探し、使い物になる witness が
   * 作れなければゲートを外して探し直す」設計だが、2周目へ進む条件が
   * `attemptMaxRowSurplus < MAX_ACCEPTABLE_SURPLUS`（＝ `2 < 2`）で**構造上決して真にならなかった**。
   * 実際に効いていたのは「witness が1つも作れなかったとき」だけで、
   * **境界行1つだけの witness（到達0匹）ができれば「使い物になる答え」として確定していた。**
   *
   * 入力: 需要1の行が2つ、在庫は水タイプM 1個（価値25）だけ。
   *
   * - ゲート内: A に渡すと**余り24**でゲート超過。1個のアメは分割できないので prefix1 も prefix2 も
   *   作れず、**到達0匹**で確定する
   * - ゲート無し: A へ渡して到達1匹（`level-planner-priority-guide.md` §72
   *   「余り0〜2にできないときも計算を不成立にせず、3以上を許して結果を返す」）
   *
   * **到達数だけでは差が出ない**（修正前も、境界より下がフェーズ3の残資源処理で B を育てるため1匹になる）。
   * 差が出るのは**どちらが育つか**で、仕様は上位優先なので A でなければならない。
   */
  it.each(['surplusFirst', 'surplusGateFirst', 'legacyImproved'] as const)(
    '§14.4.3: ゲート内で到達0匹ならゲートを外して上位から育てる: %s',
    mode => {
      const row = (id: string, pokedexId: number, priorityIndex: number): LevelPlannerInput['pokemonList'][number] => ({
        pokemonId: id, pokedexId, candyFamilyKey: String(pokedexId), name: id, type: 'water',
        currentLevel: 10, currentExpInLevel: 0, targetLevel: 70, expType: 600, nature: 'normal',
        requestedBoostCandy: 0, boostAllowed: true,
        candyTarget: { totalCandyUnits: 1, boostedCandyUnits: 0 },
        priorityIndex,
      });
      const result = solveLevelPlan({
        pokemonList: [row('A', 134, 0), row('B', 136, 1)],
        dreamShards: 999_999_999,
        boost: { kind: 'none', limit: 0 },
        // 水タイプM 1個だけ。需要1に対して価値25なので、どちらへ渡しても余り24になる。
        candyInventory: { species: {}, typeCandy: { water: { s: 0, m: 1 } }, universal: { s: 0, m: 0, l: 0 } },
        options: { itemCompareMode: mode },
      });

      expect(result.pokemonResults.map(pokemon => pokemon.reachableLine.candyDemandMet)).toEqual([true, false]);
    },
  );

  /**
   * §14.4.3。**床 witness を採らなくても、境界行の進捗を床以上に保つ。**
   *
   * 1周目のゲート内探索はアメを要する行を1匹も到達させられないので、2周目へ切り替わる。
   * 床相当の固定需要 witness と、最終プランナーのフェーズ3が同じ残資源を持つとき、
   * `compareCandidate` の第1軸（Lv/EXP 最大）により境界行が床を下回らないことを守る。
   * 頭打ち（Lv70）と個数指定でもこの単調性を暗黙の前提にしない。
   */
  it.each([
    {
      name: '通常（頭打ちなし）',
      targetLevel: 50,
      candyTarget: undefined,
      floorCandy: 4,
      inventory: { species: {}, typeCandy: { water: { s: 1, m: 1 } }, universal: { s: 0, m: 0, l: 0 } },
    },
    {
      name: 'Lv70硬上限・在庫過剰',
      targetLevel: 70,
      candyTarget: undefined,
      floorCandy: 4,
      inventory: { species: {}, typeCandy: { water: { s: 1, m: 1 } }, universal: { s: 0, m: 0, l: 2 } },
    },
    {
      // 個数指定17に対しタイプSは4・タイプMは25なので、供給を [17,19] に収める組み合わせが無く
      // ゲート内では到達0匹。ゲート内で作れる最大の境界進捗はタイプS1個の**4**（余り0）で、
      // 縮退後はタイプM1個を渡して**17個ぶん使い切る**（超過ぶんは余り8）。
      // **床を0にしないこと**——`floorCandy: 0` にすると assert が `>= 0` へ退化して空回りする。
      name: '個数指定',
      targetLevel: 70,
      candyTarget: { totalCandyUnits: 17, boostedCandyUnits: 0 },
      floorCandy: 4,
      inventory: { species: {}, typeCandy: { water: { s: 1, m: 1 } }, universal: { s: 0, m: 0, l: 0 } },
    },
  ])(
    '§14.4.3: 境界行の進捗はゲート内探索の床を下回らない: $name',
    ({ name, targetLevel, candyTarget, floorCandy, inventory }) => {
      const floorProgress = simulateCandyBudget(
        { currentLevel: 10, currentExpInLevel: 0, expType: 600, nature: 'normal' },
        0,
        floorCandy,
        Infinity,
        'none',
      );
      const floorRow = demandRow('A', 134, 'water', floorCandy, {
        candyDemandMet: false,
        reachedLv: floorProgress.level,
        expInLevel: floorProgress.expInLevel,
      });
      const floor = solveFeasibilityForFixedRows([floorRow], inventory, {
        ...noBoost,
        itemCompareMode: 'surplusFirst',
        maxRowSurplus: MAX_ACCEPTABLE_SURPLUS,
      });
      expectFeasible(floor);
      const floorBoundary = floor.witness.rows[0];

      const pokemon = (
        pokemonId: string,
        pokedexId: number,
        type: string,
        priorityIndex: number,
        rowCandyTarget?: { totalCandyUnits: number; boostedCandyUnits: number },
      ): LevelPlannerInput['pokemonList'][number] => ({
        pokemonId,
        pokedexId,
        candyFamilyKey: String(pokedexId),
        name: pokemonId,
        type,
        currentLevel: 10,
        currentExpInLevel: 0,
        targetLevel,
        expType: 600,
        nature: 'normal',
        requestedBoostCandy: 0,
        boostAllowed: true,
        ...(rowCandyTarget === undefined ? {} : { candyTarget: rowCandyTarget }),
        priorityIndex,
      });
      const result = solveLevelPlan({
        pokemonList: [pokemon('A', 134, 'water', 0, candyTarget), pokemon('B', 136, 'fire', 1)],
        dreamShards: 999_999_999,
        boost: { kind: 'none', limit: 0 },
        candyInventory: inventory,
        options: { itemCompareMode: 'surplusFirst' },
      });

      expect(result.performance?.prefixSearchAttempts, name).toHaveLength(2);
      expect(result.performance?.prefixSearchAttempts?.[0].maxFeasiblePrefix, name).toBe(0);
      const actualBoundary = result.pokemonResults[0].reachableLine;
      // 供給値はテスト側で独立に計算する（実装の supplyValue を借りない）。
      const floorSupplyValue = floorBoundary.supply.species
        + floorBoundary.supply.typeS * CANDY_VALUES.type.s
        + floorBoundary.supply.typeM * CANDY_VALUES.type.m
        + floorBoundary.supply.universalS * CANDY_VALUES.universal.s
        + floorBoundary.supply.universalM * CANDY_VALUES.universal.m
        + floorBoundary.supply.universalL * CANDY_VALUES.universal.l;
      // 対照: 床が空（アメ0個・Lv据え置き）だと下の2つが `>= 0` / `>= Lv10` へ退化して空回りする。
      // ケースを組み替えるときは、まずここが通ることを確かめること。
      expect(floorSupplyValue, `${name}: 床が空なので比較が空回りしている`).toBeGreaterThan(0);
      expect(
        floorBoundary.reachedLv > 10 || floorBoundary.expInLevel > 0,
        `${name}: 床が開始地点のままなので比較が空回りしている（Lv${floorBoundary.reachedLv}/EXP${floorBoundary.expInLevel}）`,
      ).toBe(true);

      expect(actualBoundary.totalCandyUnitsUsed).toBeGreaterThanOrEqual(floorSupplyValue);
      expect(actualBoundary.level > floorBoundary.reachedLv
        || (actualBoundary.level === floorBoundary.reachedLv && actualBoundary.expInLevel >= floorBoundary.expInLevel)).toBe(true);
    },
  );

  /**
   * 需要0行だけの prefix は、目的関数ではなく候補列挙の構造で資源を一切持たない。
   * 境界探索を行わない周でも、この witness が境界行を勝手に含めないことを守る。
   */
  it.each(['surplusFirst', 'surplusGateFirst', 'legacyImproved'] as const)(
    '需要0行だけの prefix witness は全成分0で境界行を含まない: %s',
    mode => {
      const rows = [
        demandRow('zero-a', 1, 'water', 0),
        demandRow('zero-b', 2, 'fire', 0),
        demandRow('needed', 3, 'electric', 3),
      ];
      const inventory: CandyInventory = {
        species: {},
        typeCandy: {},
        universal: { s: 1, m: 0, l: 0 },
      };
      const session = createPrefixDecisionSession(rows, inventory, { ...noBoost, itemCompareMode: mode });
      const zeroPrefix = session.canSolvePrefix(2);
      expect(zeroPrefix.status).toBe('feasible');
      if (zeroPrefix.status !== 'feasible') return;
      expect(zeroPrefix.toWitness).toBeDefined();
      const zeroWitnessResult = zeroPrefix.toWitness!();
      expect(zeroWitnessResult.status).toBe('feasible');
      if (zeroWitnessResult.status !== 'feasible') return;
      expect(zeroWitnessResult.witness.rows).toHaveLength(2);
      expect(zeroWitnessResult.witness.rows.map(row => row.supply)).toEqual([
        { species: 0, typeS: 0, typeM: 0, universalS: 0, universalM: 0, universalL: 0 },
        { species: 0, typeS: 0, typeM: 0, universalS: 0, universalM: 0, universalL: 0 },
      ]);

      const neededPrefix = session.canSolvePrefix(3);
      expect(neededPrefix.status).toBe('feasible');
      if (neededPrefix.status !== 'feasible') return;
      expect(neededPrefix.toWitness).toBeDefined();
      const neededWitnessResult = neededPrefix.toWitness!();
      expect(neededWitnessResult.status).toBe('feasible');
      if (neededWitnessResult.status !== 'feasible') return;
      expect(neededWitnessResult.witness.rows).toHaveLength(3);
      expect(neededWitnessResult.witness.rows[2].supply.universalS).toBe(1);
    },
  );

  /**
   * §14.4.3 の続き。**バランスへ切り替えたら、供給内訳と境界より下もバランスで決める**
   * （2026-08-01・外部レビュー指摘3）。
   *
   * 2周目は `mainSearchItemCompareMode = 'surplusGateFirst'` で探すが、**refine とフェーズ3へ
   * `input.options.itemCompareMode`（＝ユーザーが選んだ余り最小）を渡していた。** その結果、
   *
   * ```text
   * 到達prefix・境界 : バランス
   * 供給内訳・下位行 : 余り最小
   * ```
   *
   * という第3のモードになっており、UI の案内「到達できるポケモンが1匹もいない場合は
   * **バランスの配分に切り替えます**」と食い違っていた。
   *
   * 入力（レビューの具体例）: A=水/需要17・B=炎/需要48・C=炎/需要50。在庫は水タイプM 1個、
   * 炎タイプS 13個・M 2個、万能なし。A は水タイプM（価値25）でしか届かず**余り8**なので
   * ゲート内では到達0匹になり、fallback が発火する。
   *
   * B/C の内訳はモードで割れる:
   * - 余り最小 … B=タイプS12（余り0）/ C=タイプM2（余り0）
   * - バランス … B=タイプM2（余り2）/ C=タイプS13（余り2）。`legacyItemPriority` はタイプSを多く使う側を先に見る
   */
  it('§14.4.3: バランスへ切り替えたら供給内訳と下位行もバランスで決める', () => {
    const row = (
      id: string, pokedexId: number, type: string, totalCandyUnits: number, priorityIndex: number,
    ): LevelPlannerInput['pokemonList'][number] => ({
      pokemonId: id, pokedexId, candyFamilyKey: String(pokedexId), name: id, type,
      currentLevel: 10, currentExpInLevel: 0, targetLevel: 70, expType: 600, nature: 'normal',
      requestedBoostCandy: 0, boostAllowed: true,
      candyTarget: { totalCandyUnits, boostedCandyUnits: 0 },
      priorityIndex,
    });
    const solve = (
      pokemonList: LevelPlannerInput['pokemonList'],
      inventory: CandyInventory,
      itemCompareMode: SolverItemCompareMode,
    ) => solveLevelPlan({
      pokemonList,
      dreamShards: 999_999_999,
      boost: { kind: 'none', limit: 0 },
      candyInventory: structuredClone(inventory),
      options: { itemCompareMode },
    });
    const digest = (result: ReturnType<typeof solve>) => result.pokemonResults.map(pokemon => ({
      met: pokemon.reachableLine.candyDemandMet,
      supply: pokemon.reachableLine.candySupply,
      surplus: pokemon.reachableLine.surplusCandyValue,
    }));

    const fallbackList = [row('A', 134, 'water', 17, 0), row('B', 4, 'fire', 48, 1), row('C', 155, 'fire', 50, 2)];
    const fallbackInventory: CandyInventory = {
      species: {},
      typeCandy: { water: { s: 0, m: 1 }, fire: { s: 13, m: 2 } },
      universal: { s: 0, m: 0, l: 0 },
    };
    const surplusFirst = solve(fallbackList, fallbackInventory, 'surplusFirst');

    // 前提（手法6）: 2周目が実際に走り、1周目はアメを要する行を1つも到達させられていないこと。
    const attempts = surplusFirst.performance?.prefixSearchAttempts;
    expect(attempts, '2周目が走っていない（この入力では fallback を検証できない）').toHaveLength(2);
    expect(attempts![0].maxFeasiblePrefix, '1周目がゲート内で到達してしまっている').toBe(0);
    // ゲートを捨てた証拠。A はどう配ってもゲート（0〜2）に収まらない。
    expect(surplusFirst.pokemonResults[0].reachableLine.surplusCandyValue).toBeGreaterThan(MAX_ACCEPTABLE_SURPLUS);

    // 本題: 縮退先はバランスなので、直接バランスを選んだときと全行一致する。
    expect(digest(surplusFirst)).toEqual(digest(solve(fallbackList, fallbackInventory, 'surplusGateFirst')));

    // 対照（手法7）: fallback が発火しない入力では2モードは一致しない。
    // ここが一致してしまうと、上の assert は「そもそも2モードが同じ」を見ているだけになる。
    const gatedList = [row('D', 1020, 'electric', 8, 0), row('E', 1021, 'electric', 15, 1)];
    const gatedInventory: CandyInventory = {
      species: { '1020': 1, '1021': 2 },
      typeCandy: { electric: { s: 1, m: 1 } },
      universal: { s: 1, m: 0, l: 0 },
    };
    const gatedSurplusFirst = solve(gatedList, gatedInventory, 'surplusFirst');
    expect(gatedSurplusFirst.performance?.prefixSearchAttempts, '対照でも fallback が発火している').toHaveLength(1);
    expect(digest(gatedSurplusFirst)).not.toEqual(digest(solve(gatedList, gatedInventory, 'surplusGateFirst')));
  });

  it('speciesUsedは§15どおり上位lex目的にしない', () => {
    const compare = __levelPlannerTestHooks.compareSyntheticStatesForTest([
      { candyDemandMet: true, effectiveTargetReached: true, level: 20, expInLevel: 0, totalCandyUnitsUsed: 4, species: 4 },
    ], [
      { candyDemandMet: true, effectiveTargetReached: true, level: 20, expInLevel: 0, totalCandyUnitsUsed: 4, species: 0 },
    ], 'surplusFirst');
    expect(compare).toBe(0);
  });

  it('余り最小は上位余り合計と進捗が同じならLvMAX余り0達成数を優先する', () => {
    const compare = __levelPlannerTestHooks.compareSyntheticStatesForTest([
      { candyDemandMet: true, effectiveTargetReached: true, level: 70, expInLevel: 0, totalCandyUnitsUsed: 0, surplusCandyValue: 1 },
      { candyDemandMet: true, effectiveTargetReached: true, level: 60, expInLevel: 0, totalCandyUnitsUsed: 0, surplusCandyValue: 0 },
    ], [
      { candyDemandMet: true, effectiveTargetReached: true, level: 70, expInLevel: 0, totalCandyUnitsUsed: 0, surplusCandyValue: 0 },
      { candyDemandMet: true, effectiveTargetReached: true, level: 60, expInLevel: 0, totalCandyUnitsUsed: 0, surplusCandyValue: 1 },
    ], 'surplusFirst');

    expect(compare).toBeLessThan(0);
  });

  it('validatorは供給値・余り・共有在庫・remainingを独立に検証する', () => {
    const rows = [demandRow('p1', 1, 'alpha', 4)];
    const inventory: CandyInventory = {
      species: { '1': 4 },
      typeCandy: { alpha: { s: 1, m: 0 } },
      universal: { s: 0, m: 0, l: 1 },
    };
    const result = solveFeasibilityForFixedRows(rows, inventory, noBoost);
    expectFeasible(result);

    expect(validateFeasibilityWitness(result.witness, rows, inventory, noBoost)).toMatchObject({ valid: true });

    const invalidSupply = structuredClone(result.witness);
    invalidSupply.rows[0].supply.typeS = 1;
    expect(validateFeasibilityWitness(invalidSupply, rows, inventory, noBoost)).toMatchObject({ valid: false });

    const invalidRemaining = structuredClone(result.witness);
    invalidRemaining.remaining.species['1'] = 3;
    expect(validateFeasibilityWitness(invalidRemaining, rows, inventory, noBoost)).toMatchObject({ valid: false });
  });

  it('種族アメは非共有行で使用総量最大になり、余りを種族在庫へ戻さない', () => {
    const rows = [demandRow('p1', 1, 'alpha', 4)];
    const inventory: CandyInventory = {
      species: { '1': 4 },
      typeCandy: { alpha: { s: 1, m: 0 } },
      universal: { s: 0, m: 0, l: 1 },
    };
    const result = solveFeasibilityForFixedRows(rows, inventory, noBoost);
    expectFeasible(result);

    expect(result.witness.rows[0].supply).toMatchObject({ species: 4, typeS: 0, typeM: 0, universalL: 0 });
    expect(result.witness.remaining.species['1']).toBe(0);
    expect(result.witness.remaining.universal.l).toBe(1);
  });

  it('feasible witnessは余り最小では同じ固定需要を満たす代表の中で余りが小さい供給を選ぶ', () => {
    const rows = [demandRow('p1', 1, 'alpha', 98)];
    const inventory: CandyInventory = {
      species: {},
      typeCandy: {},
      universal: { s: 33, m: 5, l: 0 },
    };
    const result = solveFeasibilityForFixedRows(rows, inventory, { ...noBoost, itemCompareMode: 'surplusFirst' });
    expectFeasible(result);

    expect(result.witness.rows[0].supply).toMatchObject({ universalS: 26, universalM: 1 });
    expect(result.witness.rows[0].supply.universalS * 3 + result.witness.rows[0].supply.universalM * 20 - rows[0].totalCandy).toBe(0);
  });

  it('バッグ圧縮のfeasible witnessは余り0〜2ゲート候補をアイテム節約候補で落とさない', () => {
    const rows = [demandRow('swalot', 317, 'poison', 308)];
    const inventory: CandyInventory = {
      species: { '317': 272 },
      typeCandy: { poison: { s: 0, m: 2 } },
      universal: { s: 4, m: 0, l: 0 },
    };
    const result = solveFeasibilityForFixedRows(rows, inventory, { ...noBoost, itemCompareMode: 'legacyImproved' });
    expectFeasible(result);

    expect(result.witness.rows[0].supply).toMatchObject({ species: 272, typeM: 1, universalS: 4 });
    expect(result.witness.rows[0].supply.typeM * 25 + result.witness.rows[0].supply.universalS * 3 + result.witness.rows[0].supply.species - rows[0].totalCandy).toBe(1);
  });

  it('バッグ圧縮の余り0〜2ゲートは後続上位の到達に必要な万能Sを奪わない', () => {
    const rows = [
      demandRow('swalot', 317, 'poison', 308),
      demandRow('upper-fire', 244, 'fire', 12),
    ];
    const inventory: CandyInventory = {
      species: { '317': 272 },
      typeCandy: { poison: { s: 0, m: 2 }, fire: { s: 0, m: 0 } },
      universal: { s: 4, m: 0, l: 0 },
    };
    const result = solveFeasibilityForFixedRows(rows, inventory, { ...noBoost, itemCompareMode: 'legacyImproved' });
    expectFeasible(result);

    expect(result.witness.rows[0].supply).toMatchObject({ species: 272, typeM: 2, universalS: 0 });
    expect(result.witness.rows[1].supply).toMatchObject({ universalS: 4 });
    expect(result.witness.rows[0].supply.typeM * 25 + result.witness.rows[0].supply.species - rows[0].totalCandy).toBe(14);
  });

  it('共有種族は総量最大を守り、実行可能な分配の中でトップダウン正規形へ復元する', () => {
    const rows = [
      demandRow('upper', 1, 'alpha', 25),
      demandRow('lower', 1, 'alpha', 4),
    ];
    const inventory: CandyInventory = {
      species: { '1': 4 },
      typeCandy: { alpha: { s: 0, m: 1 } },
      universal: { s: 0, m: 0, l: 0 },
    };
    const result = solveFeasibilityForFixedRows(rows, inventory, noBoost);
    expectFeasible(result);

    expect(result.witness.rows.map(row => row.supply.species)).toEqual([0, 4]);
    expect(result.witness.rows.map(row => row.supply.typeM)).toEqual([1, 0]);
    expect(validateFeasibilityWitness(result.witness, rows, inventory, noBoost)).toMatchObject({ valid: true });
  });

  it('共有種族が別タイプの行へまたがっても、連結タイプブロック内で解く', () => {
    const rows = [
      demandRow('upper', 1, 'alpha', 25),
      demandRow('lower', 11, 'beta', 4, { candyFamilyKey: '1' }),
    ];
    const inventory: CandyInventory = {
      species: { '1': 4 },
      typeCandy: { alpha: { s: 0, m: 1 }, beta: { s: 0, m: 0 } },
      universal: { s: 0, m: 0, l: 0 },
    };
    const result = solveFeasibilityForFixedRows(rows, inventory, noBoost);
    expectFeasible(result);
    expect(result.witness.rows.map(row => row.supply.species)).toEqual([0, 4]);
    expect(result.witness.rows[0].supply.typeM).toBe(1);
    expect(validateFeasibilityWitness(result.witness, rows, inventory, noBoost)).toMatchObject({ valid: true });
  });

  it('多グループのトップダウン候補が余る場合は、完全探索で余り0の共有種族配分を選ぶ', () => {
    const rows = [
      demandRow('shared-upper', 1, 'alpha', 4),
      demandRow('shared-lower', 11, 'beta', 4, { candyFamilyKey: '1' }),
      demandRow('independent', 2, 'gamma', 3),
    ];
    const inventory: CandyInventory = {
      species: { '1': 4, '2': 0 },
      typeCandy: {
        alpha: { s: 1, m: 0 },
        beta: { s: 0, m: 0 },
        gamma: { s: 0, m: 0 },
      },
      universal: { s: 3, m: 0, l: 0 },
    };
    const result = solveFeasibilityForFixedRows(rows, inventory, {
      ...noBoost,
      itemCompareMode: 'surplusFirst',
    });
    expectFeasible(result);

    expect(result.witness.rows.map(row => row.supply.species)).toEqual([0, 4, 0]);
    expect(result.witness.rows[0].supply).toMatchObject({ typeS: 1 });
    expect(result.witness.rows[1].supply).toMatchObject({ species: 4 });
    expect(result.witness.rows[2].supply).toMatchObject({ universalS: 1 });
    expect(validateFeasibilityWitness(result.witness, rows, inventory, noBoost)).toMatchObject({ valid: true });
  });

  /**
   * 種族アメの総量と総余りが同じ候補では、アイテム優先順位より先に上位行への種族配分を確定する。
   * feasibility と、fixedSpecies を渡さない exact refine の双方でこの正規形を守る。
   */
  it('種族アメはアイテム優先順位より先に上位行へ寄せる', () => {
    const rows = [
      demandRow('upper', 134, 'water', 4, { candyFamilyKey: SHARED_EEVEE_FAMILY }),
      demandRow('lower', 136, 'water', 9, { candyFamilyKey: SHARED_EEVEE_FAMILY }),
    ];
    const inventory: CandyInventory = {
      species: { [SHARED_EEVEE_FAMILY]: 1 },
      typeCandy: { water: { s: 3, m: 0 } },
      universal: { s: 4, m: 0, l: 0 },
    };

    const feasibility = solveFeasibilityForFixedRows(rows, inventory, {
      ...noBoost,
      itemCompareMode: 'surplusFirst',
    });
    expectFeasible(feasibility);
    expect(feasibility.witness.rows.map(row => row.supply.species)).toEqual([1, 0]);

    const exactRows = [
      {
        id: 'upper',
        name: 'upper',
        pokedexId: 134,
        candyFamilyKey: SHARED_EEVEE_FAMILY,
        type: 'water',
        totalCandyCount: 4,
        candyDemandMet: true,
        selected: { species: 0, typeS: 1, typeM: 0, universalS: 0, universalM: 0, universalL: 0, supply: 4, surplus: 0 },
      },
      {
        id: 'lower',
        name: 'lower',
        pokedexId: 136,
        candyFamilyKey: SHARED_EEVEE_FAMILY,
        type: 'water',
        totalCandyCount: 9,
        candyDemandMet: true,
        selected: { species: 1, typeS: 2, typeM: 0, universalS: 0, universalM: 0, universalL: 0, supply: 9, surplus: 0 },
      },
    ];
    const exact = refineExactSupply(exactRows, inventory, 'surplusFirst');
    expect(exact.status).toBe('ok');
    if (exact.status !== 'ok') return;
    expect(exact.bestRows.map(row => row.species)).toEqual([1, 0]);
    expect(exact.bestObjective.speciesUsed).toBe(1);
    expect(exact.bestObjective.rawSurplus).toBe(0);
  });

  it('validatorは異なる図鑑番号によるfamily在庫の二重使用を拒否する', () => {
    const rows = [
      demandRow('pichu', 172, 'electric', 4, { candyFamilyKey: '25' }),
      demandRow('pikachu', 25, 'electric', 4, { candyFamilyKey: '25' }),
    ];
    const inventory: CandyInventory = {
      species: { '25': 4 },
      typeCandy: { electric: { s: 1, m: 0 } },
      universal: { s: 0, m: 0, l: 0 },
    };
    const result = solveFeasibilityForFixedRows(rows, inventory, noBoost);
    expectFeasible(result);

    const invalid = structuredClone(result.witness);
    invalid.rows[0].supply = { species: 4, typeS: 0, typeM: 0, universalS: 0, universalM: 0, universalL: 0 };
    invalid.rows[1].supply = { species: 4, typeS: 0, typeM: 0, universalS: 0, universalM: 0, universalL: 0 };
    invalid.remaining.species['25'] = 0;
    invalid.remaining.typeCandy.electric = { s: 1, m: 0 };

    expect(validateFeasibilityWitness(invalid, rows, inventory, noBoost)).toMatchObject({ valid: false });
  });

  it('同タイプ複数行ではタイプ在庫をタイプブロック内だけで共有する', () => {
    const rows = [
      demandRow('alpha-1', 1, 'alpha', 4),
      demandRow('alpha-2', 2, 'alpha', 25),
      demandRow('beta-1', 3, 'beta', 20),
    ];
    const inventory: CandyInventory = {
      species: {},
      typeCandy: { alpha: { s: 1, m: 1 }, beta: { s: 0, m: 0 } },
      universal: { s: 0, m: 1, l: 0 },
    };
    const result = solveFeasibilityForFixedRows(rows, inventory, noBoost);
    expectFeasible(result);

    expect(result.witness.rows[0].supply.typeS + result.witness.rows[1].supply.typeS).toBeLessThanOrEqual(1);
    expect(result.witness.rows[0].supply.typeM + result.witness.rows[1].supply.typeM).toBeLessThanOrEqual(1);
    expect(result.witness.rows[2].supply.universalM).toBe(1);
  });

  it.each([1, 2, 3, 19, 20, 24, 25, 99, 100])(
    '万能L/M/Sの大余りをfeasibleとして扱う: 需要%d',
    totalCandy => {
      const rows = [demandRow(`universal-${totalCandy}`, totalCandy, 'universal-only', totalCandy)];
      const inventory: CandyInventory = {
        species: {},
        typeCandy: { 'universal-only': { s: 0, m: 0 } },
        universal: { s: 0, m: 0, l: 1 },
      };
      const result = solveFeasibilityForFixedRows(rows, inventory, noBoost);
      expectFeasible(result);
      expect(result.witness.rows[0].supply.universalL).toBe(1);
      expect(result.witness.rows[0].supply.universalL * 100).toBeGreaterThanOrEqual(totalCandy);
    },
  );

  it('タイプ偏在と万能共有競合を全体DPで判定する', () => {
    const rows = [
      demandRow('alpha', 10, 'alpha', 4),
      demandRow('beta', 11, 'beta', 20),
    ];
    const feasibleInventory: CandyInventory = {
      species: {},
      typeCandy: { alpha: { s: 1, m: 0 }, beta: { s: 0, m: 0 } },
      universal: { s: 0, m: 1, l: 0 },
    };
    const feasible = solveFeasibilityForFixedRows(rows, feasibleInventory, noBoost);
    expectFeasible(feasible);

    const infeasibleInventory: CandyInventory = {
      ...feasibleInventory,
      universal: { s: 0, m: 0, l: 0 },
    };
    const infeasible = solveFeasibilityForFixedRows(rows, infeasibleInventory, noBoost);
    expect(infeasible.status).toBe('infeasible');
  });

  it('独立境界セッションのdecision envelopeはfull solveと同じ可否を返す', () => {
    const prefixRows = [demandRow('prefix', 10, 'alpha', 20)];
    const boundaryRow = demandRow('boundary', 11, 'beta', 20, { candyDemandMet: false, reachedLv: 54, expInLevel: 1004 });
    const blockedInventory: CandyInventory = {
      species: {},
      typeCandy: { alpha: { s: 0, m: 0 }, beta: { s: 0, m: 0 } },
      universal: { s: 0, m: 1, l: 0 },
    };
    const blockedSession = createIndependentBoundaryFeasibilitySession(prefixRows, blockedInventory, noBoost);
    expect(blockedSession?.canSolve(boundaryRow)?.status).toBe('infeasible');
    expect(solveFeasibilityForFixedRows([...prefixRows, boundaryRow], blockedInventory, noBoost).status).toBe('infeasible');

    const feasibleInventory: CandyInventory = {
      ...blockedInventory,
      universal: { s: 0, m: 2, l: 0 },
    };
    const feasibleSession = createIndependentBoundaryFeasibilitySession(prefixRows, feasibleInventory, noBoost);
    expect(feasibleSession?.canSolve(boundaryRow)?.status).toBe('feasible');
    expectFeasible(solveFeasibilityForFixedRows([...prefixRows, boundaryRow], feasibleInventory, noBoost));
  });

  it('独立境界セッションは再構築せず上位余り上限を適用してfull solveと一致する', () => {
    const prefixRows = [demandRow('reached-prefix', 20, 'alpha', 2, { candyDemandMet: true })];
    const boundaryRow = demandRow('unreached-boundary', 21, 'beta', 3, { candyDemandMet: false, reachedLv: 20, expInLevel: 1 });
    const inventory: CandyInventory = {
      species: {},
      typeCandy: { alpha: { s: 0, m: 0 }, beta: { s: 0, m: 0 } },
      universal: { s: 2, m: 0, l: 0 },
    };
    const options = { ...noBoost, itemCompareMode: 'surplusFirst' as const, maxRowSurplus: 2 };
    const session = createIndependentBoundaryFeasibilitySession(prefixRows, inventory, options);

    expect(session?.canSolve(boundaryRow, { maxReachedSurplus: 0 })?.status).toBe('infeasible');
    expect(solveFeasibilityForFixedRows([...prefixRows, boundaryRow], inventory, {
      ...options,
      maxReachedSurplus: 0,
    }).status).toBe('infeasible');

    const reused = session?.solve(boundaryRow, { maxReachedSurplus: 1 });
    expectFeasible(reused!);
    expectFeasible(solveFeasibilityForFixedRows([...prefixRows, boundaryRow], inventory, {
      ...options,
      maxReachedSurplus: 1,
    }));
  });

  it('緩和上界が不可行と判定したprefixをsolverがfeasibleにしない', () => {
    const result = solveFeasibilityForFixedRows([demandRow('relaxation-upper', 12, 'alpha', 4)], {
      species: {},
      typeCandy: { alpha: { s: 0, m: 0 } },
      universal: { s: 0, m: 0, l: 0 },
    }, noBoost);
    expect(result.status).toBe('infeasible');
    if (result.status !== 'infeasible') return;
    expect(result.reason).toBe('relaxation_insufficient_type_or_universal_value');
  });

  it('mini/full/none、かけら境界、個数指定の固定値を変更しない', () => {
    const rows = [
      demandRow('mini', 20, 'alpha', 4, { boostCandy: 2, normalCandy: 2, shards: 5, candyDemandMet: true }),
      demandRow('full', 21, 'beta', 20, { boostCandy: 10, normalCandy: 10, shards: 7, candyDemandMet: false, reachedLv: 31, expInLevel: 99 }),
      demandRow('count', 22, 'gamma', 25, { boostCandy: 0, normalCandy: 25, candyDemandMet: false, reachedLv: 31, expInLevel: 99 }),
    ];
    const inventory: CandyInventory = {
      species: {},
      typeCandy: { alpha: { s: 1, m: 0 }, beta: { s: 0, m: 0 }, gamma: { s: 0, m: 1 } },
      universal: { s: 0, m: 1, l: 0 },
    };
    const options = { boostKind: 'full' as const, boostLimit: 12, dreamShards: 12 };
    const result = solveFeasibilityForFixedRows(rows, inventory, options);
    expectFeasible(result);
    expect(result.witness.rows.map(row => ({
      totalCandy: row.totalCandy,
      boostCandy: row.boostCandy,
      normalCandy: row.normalCandy,
      shards: row.shards,
      reachedLv: row.reachedLv,
      expInLevel: row.expInLevel,
      candyDemandMet: row.candyDemandMet,
    }))).toEqual(rows.map(row => ({
      totalCandy: row.totalCandy,
      boostCandy: row.boostCandy,
      normalCandy: row.normalCandy,
      shards: row.shards,
      reachedLv: row.reachedLv,
      expInLevel: row.expInLevel,
      candyDemandMet: row.candyDemandMet,
    })));
    expect(result.witness.reachedCount).toBe(1);
    expect(result.witness.boundaryIndex).toBe(1);
    expect(result.witness.boundaryLevel).toBe(31);
    expect(result.witness.boundaryExpInLevel).toBe(99);

    const mini = solveFeasibilityForFixedRows(rows, inventory, { ...options, boostKind: 'mini' });
    expectFeasible(mini);
  });

  it('prefixを飛ばした入力を到達扱いにしない', () => {
    const rows = [
      demandRow('first', 1, 'alpha', 1, { candyDemandMet: true }),
      demandRow('skipped', 2, 'alpha', 1, { candyDemandMet: false }),
      demandRow('after', 3, 'alpha', 1, { candyDemandMet: true }),
    ];
    const result = solveFeasibilityForFixedRows(rows, {
      ...emptyInventory(),
      species: { '1': 1, '2': 1, '3': 1 },
    }, noBoost);
    expect(result.status).toBe('infeasible');
    if (result.status !== 'infeasible') return;
    expect(result.reason).toContain('prefix');
  });

  it('探索打ち切りはinfeasibleではなくinconclusiveで、渡された床witnessを保持する', () => {
    const rows = [demandRow('p1', 1, 'alpha', 25)];
    const inventory: CandyInventory = {
      species: {},
      typeCandy: { alpha: { s: 0, m: 1 } },
      universal: { s: 0, m: 0, l: 0 },
    };
    const baseline = solveFeasibilityForFixedRows(rows, inventory, noBoost);
    expectFeasible(baseline);

    const stopped = solveFeasibilityForFixedRows(rows, inventory, {
      ...noBoost,
      abortAfterTransitions: 0,
      fallbackWitness: baseline.witness,
    });
    expect(stopped.status).toBe('inconclusive');
    if (stopped.status !== 'inconclusive') return;
    expect(stopped.witness).toEqual(baseline.witness);
  });

  it('refine成功時は供給内訳だけを置換し、失敗時はfeasibility baselineを維持する', () => {
    const rows = [demandRow('refine-ok', 31, 'alpha', 4)];
    const inventory: CandyInventory = {
      species: {},
      typeCandy: { alpha: { s: 1, m: 0 } },
      universal: { s: 0, m: 0, l: 0 },
    };
    const solved = solveFeasibilityForFixedRows(rows, inventory, noBoost);
    expectFeasible(solved);
    const fixedBeforeRefine = solved.witness.rows.map(row => ({
      totalCandy: row.totalCandy,
      boostCandy: row.boostCandy,
      normalCandy: row.normalCandy,
      shards: row.shards,
      reachedLv: row.reachedLv,
      expInLevel: row.expInLevel,
      candyDemandMet: row.candyDemandMet,
      species: row.supply.species,
    }));

    const refined = refineFeasibilityWitness(solved.witness, inventory, 'surplusFirst', noBoost);
    expect(refined.status).toBe('refined');
    expect(refined.refineStatus).toBe('ok');
    expect(validateFeasibilityWitness(refined.witness, rows, inventory, noBoost)).toMatchObject({ valid: true });
    expect(refined.witness.rows.map(row => ({
      totalCandy: row.totalCandy,
      boostCandy: row.boostCandy,
      normalCandy: row.normalCandy,
      shards: row.shards,
      reachedLv: row.reachedLv,
      expInLevel: row.expInLevel,
      candyDemandMet: row.candyDemandMet,
      species: row.supply.species,
    }))).toEqual(fixedBeforeRefine);

    const failureRows = Array.from({ length: 6 }, (_, index) => demandRow(`refine-large-${index}`, 20_000 + index, 'shared', 100));
    const failureInventory: CandyInventory = {
      species: {},
      typeCandy: { shared: { s: 500, m: 120 } },
      universal: { s: 500, m: 120, l: 0 },
    };
    const failureWitness: FeasibilityWitness = {
      reachedCount: failureRows.length,
      boundaryIndex: null,
      boundaryLevel: 0,
      boundaryExpInLevel: 0,
      rows: failureRows.map(row => ({
        ...row,
        supply: { species: 0, typeS: 0, typeM: 0, universalS: 0, universalM: 5, universalL: 0 },
      })),
      remaining: {
        species: Object.fromEntries(failureRows.map(row => [row.candyFamilyKey, 0])),
        typeCandy: { shared: { s: 500, m: 120 } },
        universal: { s: 500, m: 90, l: 0 },
        boostCandy: 0,
        dreamShards: Infinity,
      },
    };
    expect(validateFeasibilityWitness(failureWitness, failureRows, failureInventory, noBoost)).toMatchObject({ valid: true });
    const failed = refineFeasibilityWitness(failureWitness, failureInventory, 'legacyImproved', noBoost);
    expect(failed.status).toBe('baseline');
    expect(failed.refineStatus).toBe('inconclusive');
    expect(failed.witness).toBe(failureWitness);
  });

  it('性能ログは指定されたfrontier/遷移/witness復元統計を出す', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const result = solveFeasibilityForFixedRows([demandRow('perf', 1, 'alpha', 4)], {
        species: {},
        typeCandy: { alpha: { s: 1, m: 0 } },
        universal: { s: 0, m: 0, l: 0 },
      }, { ...noBoost, logPerformance: true });
      expectFeasible(result);
      expect(result.stats.durationMs).toBeGreaterThanOrEqual(0);
      const perfCall = info.mock.calls.find(call => call[0] === '[perf] levelPlanner.feasibilityWitness');
      expect(perfCall).toBeDefined();
      expect(perfCall?.[1]).toMatchObject({
        durationMs: expect.any(Number),
        rowFrontierCounts: expect.any(Array),
        typeBlockFrontierCounts: expect.any(Array),
        globalKeyCount: expect.any(Number),
        transitions: expect.any(Number),
        witnessRestoreMs: expect.any(Number),
      });
    } finally {
      info.mockRestore();
    }
  });

  it('frontier cacheは同じ固定需要の結果を変えず、再solveの遷移を減らす', () => {
    const rows = [
      demandRow('cache-a', 61001, 'alpha', 64),
      demandRow('cache-b', 61002, 'beta', 83),
    ];
    const inventory: CandyInventory = {
      species: {},
      typeCandy: { alpha: { s: 2, m: 3 }, beta: { s: 4, m: 2 } },
      universal: { s: 80, m: 20, l: 3 },
    };
    const frontierCache = new Map();
    const options = { ...noBoost, itemCompareMode: 'legacyImproved' as const, frontierCache };
    const first = solveFeasibilityForFixedRows(rows, inventory, options);
    const second = solveFeasibilityForFixedRows(rows, inventory, options);
    expectFeasible(first);
    expectFeasible(second);
    expect(second.witness.rows.map(row => row.supply)).toEqual(first.witness.rows.map(row => row.supply));
    expect(second.stats.transitions).toBeLessThan(first.stats.transitions);
  });

  it('単一タイプpruneは小規模全列挙oracleと同じqualityのwitnessを残す', () => {
    const cases: Array<{ rows: FeasibilityDemandRow[]; inventory: CandyInventory }> = [];
    for (const totals of [[5, 8], [6, 9], [5, 7, 10], [8, 11, 12]]) {
      for (const typeS of [1, 2, 3]) {
        for (const typeM of [0, 1]) {
          for (const universalS of [2, 4, 6]) {
            cases.push({
              rows: totals.map((total, index) => demandRow(`same-${totals.join('-')}-${index}`, 100 + index, 'alpha', total, { preferZeroSurplus: index % 2 === 0 })),
              inventory: { species: {}, typeCandy: { alpha: { s: typeS, m: typeM } }, universal: { s: universalS, m: 1, l: 0 } },
            });
          }
        }
      }
    }

    for (const mode of ['legacyImproved', 'surplusFirst'] as const) {
      for (const testCase of cases) {
        const expected = bruteForceBestQuality(testCase.rows, testCase.inventory, mode);
        const result = solveFeasibilityForFixedRows(testCase.rows, testCase.inventory, { ...noBoost, itemCompareMode: mode });
        if (!expected) {
          expect(result.status).toBe('infeasible');
          continue;
        }
        expectFeasible(result);
        expect(compareOracleQuality(qualityFromWitness(result.witness, testCase.rows), expected, mode)).toBe(0);
      }
    }
  });


  it('小規模全列挙oracleとfeasibility判定が一致する', () => {
    const cases: Array<{ rows: FeasibilityDemandRow[]; inventory: CandyInventory }> = [
      {
        rows: [demandRow('a', 1, 'alpha', 1), demandRow('b', 1, 'alpha', 2)],
        inventory: { species: { '1': 1 }, typeCandy: { alpha: { s: 1, m: 0 } }, universal: { s: 1, m: 0, l: 0 } },
      },
      {
        rows: [demandRow('a', 2, 'alpha', 4), demandRow('b', 3, 'alpha', 5)],
        inventory: { species: {}, typeCandy: { alpha: { s: 1, m: 0 } }, universal: { s: 2, m: 0, l: 0 } },
      },
      {
        rows: [demandRow('a', 4, 'alpha', 6), demandRow('b', 4, 'alpha', 3)],
        inventory: { species: { '4': 2 }, typeCandy: { alpha: { s: 1, m: 0 } }, universal: { s: 1, m: 0, l: 0 } },
      },
    ];

    for (const testCase of cases) {
      const expected = bruteForceFeasible(testCase.rows, testCase.inventory);
      const actual = solveFeasibilityForFixedRows(testCase.rows, testCase.inventory, noBoost).status === 'feasible';
      expect(actual, JSON.stringify(testCase)).toBe(expected);
    }
  });

  it('小在庫の決定的マトリクスで全列挙oracleとの差を出さない', () => {
    for (let seed = 0; seed < 18; seed++) {
      const shared = seed % 2 === 0;
      const rows = [
        demandRow(`oracle-a-${seed}`, shared ? 40 : 40 + seed, 'alpha', 1 + (seed % 8)),
        demandRow(`oracle-b-${seed}`, shared ? 40 : 41 + seed, 'alpha', 1 + ((seed * 3) % 8)),
      ];
      const inventory: CandyInventory = {
        species: shared ? { '40': seed % 4 } : {},
        typeCandy: { alpha: { s: seed % 3, m: seed % 2 } },
        universal: { s: (seed + 1) % 3, m: seed % 2, l: seed % 2 },
      };
      const expected = bruteForceFeasible(rows, inventory);
      const actual = solveFeasibilityForFixedRows(rows, inventory, noBoost).status === 'feasible';
      expect(actual, `seed=${seed}`).toBe(expected);
    }
  });

  it('小在庫の決定的ランダムoracle 120ケースでfeasible判定を一致させる', () => {
    for (let seed = 0; seed < 120; seed++) {
      const shared = seed % 3 === 0;
      const rows = [
        demandRow(`random-a-${seed}`, shared ? 900 : 900 + seed, 'alpha', 1 + (seed % 10)),
        demandRow(`random-b-${seed}`, shared ? 900 : 1000 + seed, seed % 4 === 0 ? 'beta' : 'alpha', 1 + ((seed * 7) % 10)),
        demandRow(`random-c-${seed}`, 1100 + seed, 'beta', 1 + ((seed * 5) % 7)),
      ];
      const inventory: CandyInventory = {
        species: shared ? { '900': seed % 4 } : { [String(900 + seed)]: seed % 3 },
        typeCandy: { alpha: { s: seed % 3, m: (seed + 1) % 2 }, beta: { s: (seed + 2) % 3, m: seed % 2 } },
        universal: { s: (seed + 1) % 3, m: seed % 2, l: seed % 2 },
      };
      const expected = bruteForceFeasible(rows, inventory);
      const actual = solveFeasibilityForFixedRows(rows, inventory, noBoost).status === 'feasible';
      expect(actual, `seed=${seed}`).toBe(expected);
    }
  });

  it('row/type-block/global frontierと遷移数・witness復元時間を記録する', () => {
    const rows = Array.from({ length: 10 }, (_, index) => demandRow(`p${index}`, 100 + index, 'alpha', 4 + (index % 3)));
    const result = solveFeasibilityForFixedRows(rows, {
      species: {},
      typeCandy: { alpha: { s: 20, m: 0 } },
      universal: { s: 20, m: 0, l: 0 },
    }, noBoost);
    expectFeasible(result);
    expect(result.stats.rowOptionCounts).toHaveLength(rows.length);
    expect(result.stats.rowFrontierCounts).toHaveLength(rows.length);
    expect(result.stats.typeBlockFrontierCounts).toEqual([expect.any(Number)]);
    expect(result.stats.globalKeyCount).toBeGreaterThan(0);
    expect(result.stats.transitions).toBeGreaterThan(0);
    expect(result.stats.witnessRestoreMs).toBeGreaterThanOrEqual(0);
  });

  it('§16の性能マトリクス各ケースでfrontier統計を記録する', () => {
    const cases: Array<{ name: string; rows: FeasibilityDemandRow[]; inventory: CandyInventory; options?: Parameters<typeof solveFeasibilityForFixedRows>[2] }> = [
      {
        name: 'same-type-10',
        rows: Array.from({ length: 10 }, (_, index) => demandRow(`same-type-${index}`, 2_000 + index, 'alpha', 4)),
        inventory: { species: {}, typeCandy: { alpha: { s: 10, m: 0 } }, universal: { s: 0, m: 0, l: 0 } },
      },
      {
        name: 'all-distinct-types',
        rows: Array.from({ length: 6 }, (_, index) => demandRow(`distinct-${index}`, 2_100 + index, `type-${index}`, 4)),
        inventory: { species: {}, typeCandy: Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`type-${index}`, { s: 1, m: 0 }])), universal: { s: 0, m: 0, l: 0 } },
      },
      {
        name: 'same-species',
        rows: Array.from({ length: 6 }, (_, index) => demandRow(`same-species-${index}`, 2_200, 'shared', 4)),
        inventory: { species: { '2200': 6 }, typeCandy: { shared: { s: 0, m: 0 } }, universal: { s: 6, m: 0, l: 0 } },
      },
      {
        name: 'universal-only',
        rows: [demandRow('universal-small', 2_300, 'universal', 1), demandRow('universal-large', 2_301, 'universal', 100)],
        inventory: { species: {}, typeCandy: { universal: { s: 0, m: 0 } }, universal: { s: 0, m: 0, l: 2 } },
      },
      {
        name: 'type-skew',
        rows: [demandRow('type-s', 2_400, 'alpha', 4), demandRow('type-m', 2_401, 'beta', 25)],
        inventory: { species: {}, typeCandy: { alpha: { s: 1, m: 0 }, beta: { s: 0, m: 1 } }, universal: { s: 0, m: 0, l: 0 } },
      },
      {
        name: 'surplus-and-shards',
        rows: [
          demandRow('surplus-1', 2_500, 'gamma', 1, { shards: 4, reachedLv: 29, expInLevel: 99 }),
          demandRow('surplus-99', 2_501, 'gamma', 99, { shards: 5, reachedLv: 30, expInLevel: 1, candyDemandMet: false }),
          demandRow('surplus-100', 2_502, 'gamma', 100, { shards: 6, reachedLv: 30, expInLevel: 2, candyDemandMet: false }),
        ],
        inventory: { species: {}, typeCandy: { gamma: { s: 0, m: 0 } }, universal: { s: 0, m: 0, l: 3 } },
        options: { boostKind: 'full', boostLimit: 0, dreamShards: 15 },
      },
    ];

    for (const testCase of cases) {
      const result = solveFeasibilityForFixedRows(testCase.rows, testCase.inventory, testCase.options ?? noBoost);
      expectFeasible(result);
      expect(result.stats.rowOptionCounts).toHaveLength(testCase.rows.length);
      expect(result.stats.rowFrontierCounts).toHaveLength(testCase.rows.length);
      expect(result.stats.typeBlockFrontierCounts.length).toBeGreaterThan(0);
      expect(result.stats.globalKeyCount).toBeGreaterThan(0);
      expect(result.stats.transitions, testCase.name).toBeGreaterThan(0);
      expect(result.stats.witnessRestoreMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('feasibility witnessの出力を固定需要行へ変換し、合同solverとrefineを検証できる', () => {
    const input: LevelPlannerInput = {
      pokemonList: [
        { pokemonId: 'upper', pokedexId: 501, candyFamilyKey: '501', name: '上位', type: 'alpha', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 4, boostedCandyUnits: 0 }, priorityIndex: 0 },
        { pokemonId: 'second', pokedexId: 502, candyFamilyKey: '502', name: '二体目', type: 'alpha', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 25, boostedCandyUnits: 0 }, priorityIndex: 1 },
        { pokemonId: 'boundary', pokedexId: 503, candyFamilyKey: '503', name: '境界', type: 'alpha', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 4, boostedCandyUnits: 0 }, priorityIndex: 2 },
      ],
      dreamShards: Infinity,
      boost: { kind: 'none', limit: 0 },
      candyInventory: {
        species: {},
        typeCandy: { alpha: { s: 1, m: 1 } },
        universal: { s: 0, m: 0, l: 0 },
      },
      options: { itemCompareMode: 'surplusFirst' },
    };
    const baseline = solveLevelPlan(input);
    const fixedRows = baseline.pokemonResults.map((pokemon, index): FeasibilityDemandRow => ({
      pokemonId: pokemon.pokemonId,
      pokedexId: pokemon.pokedexId,
      candyFamilyKey: input.pokemonList[index].candyFamilyKey,
      type: input.pokemonList[index].type,
      totalCandy: pokemon.reachableLine.totalCandyUnitsUsed,
      boostCandy: pokemon.reachableLine.boostedCandyUnits,
      normalCandy: pokemon.reachableLine.nonBoostCandyUnits,
      shards: pokemon.reachableLine.dreamShardsUsed,
      reachedLv: pokemon.reachableLine.level,
      expInLevel: pokemon.reachableLine.expInLevel,
      candyDemandMet: pokemon.reachableLine.candyDemandMet,
    }));
    const solved = solveFeasibilityForFixedRows(fixedRows, input.candyInventory, {
      boostKind: input.boost.kind,
      boostLimit: input.boost.limit,
      dreamShards: input.dreamShards,
      logPerformance: false,
    });
    expectFeasible(solved);
    expect(solved.witness.reachedCount).toBe(baseline.summary.fullyReachedCount);
    expect(solved.witness.boundaryIndex).toBe(fixedRows.findIndex(row => !row.candyDemandMet));

    const exactRows = solved.witness.rows.map((row, index) => {
      const supply = row.supply.species
        + row.supply.typeS * 4
        + row.supply.typeM * 25
        + row.supply.universalS * 3
        + row.supply.universalM * 20
        + row.supply.universalL * 100;
      return {
        id: row.pokemonId,
        name: input.pokemonList[index].name,
        pokedexId: row.pokedexId,
        candyFamilyKey: row.candyFamilyKey,
        type: row.type,
        totalCandyCount: row.totalCandy,
        candyDemandMet: row.candyDemandMet,
        fixedSpecies: row.supply.species,
        selected: {
          species: row.supply.species,
          typeS: row.supply.typeS,
          typeM: row.supply.typeM,
          universalS: row.supply.universalS,
          universalM: row.supply.universalM,
          universalL: row.supply.universalL,
          supply,
          surplus: supply - row.totalCandy,
        },
      };
    });
    const refined = refineExactSupply(exactRows, input.candyInventory, 'surplusFirst');
    expect(refined.status).toBe('ok');
    if (refined.status !== 'ok') return;
    refined.bestRows.forEach((row, index) => {
      expect(row.species).toBe(solved.witness.rows[index].supply.species);
      expect(row.supply).toBeGreaterThanOrEqual(solved.witness.rows[index].totalCandy);
    });

    expect(solved.witness.reachedCount).toBeGreaterThan(1);
  });

  it('実ケース: UIでbaselineへ落ちた6行miniケースを固定需要solverで安全に観測できる', () => {
    const rows: FeasibilityDemandRow[] = [
      demandRow('id_z4cy1n49yzj_mrg52n3n', 923, 'Electric', 316, {
        boostCandy: 316,
        normalCandy: 0,
        shards: 1_383_628,
        reachedLv: 70,
        expInLevel: 0,
      }),
      demandRow('id_5tlnyjy0ssi_mrg53aly', 845, 'Flying', 264, {
        boostCandy: 34,
        normalCandy: 230,
        shards: 444_663,
        reachedLv: 70,
        expInLevel: 0,
      }),
      demandRow('id_sds1zvu57t_mrg54714', 700, 'Fairy', 3_598, {
        boostCandy: 0,
        normalCandy: 3_598,
        shards: 1_995_315,
        reachedLv: 70,
        expInLevel: 0,
      }),
      demandRow('id_q0yknqotgp_mrg5jsml', 149, 'Dragon', 948, {
        boostCandy: 0,
        normalCandy: 948,
        shards: 1_038_059,
        reachedLv: 70,
        expInLevel: 0,
      }),
      demandRow('id_kwjj92i5lf_mrgdh5jn', 317, 'Poison', 308, {
        boostCandy: 0,
        normalCandy: 308,
        shards: 170_630,
        reachedLv: 60,
        expInLevel: 16,
      }),
      demandRow('id_kdcasn6c56_mrkrawto', 488, 'Psychic', 1_138, {
        boostCandy: 0,
        normalCandy: 1_138,
        shards: 1_246_158,
        reachedLv: 70,
        expInLevel: 0,
      }),
    ];
    const inventory: CandyInventory = {
      species: {
        '923': 181,
        '845': 0,
        '700': 2947,
        '149': 436,
        '317': 272,
        '488': 500,
      },
      typeCandy: {
        Electric: { s: 0, m: 0 },
        Flying: { s: 0, m: 0 },
        Fairy: { s: 0, m: 10 },
        Dragon: { s: 31, m: 10 },
        Poison: { s: 0, m: 1 },
        Psychic: { s: 18, m: 10 },
      },
      universal: { s: 432, m: 102, l: 9 },
    };

    const result = solveFeasibilityForFixedRows(rows, inventory, {
      boostKind: 'mini',
      boostLimit: 350,
      dreamShards: 10_000_000,
      deadlineMs: 250,
    });

    expect(result.status).not.toBe('infeasible');
    if (result.status !== 'feasible') {
      expect(result.reason).toBe('deadline_exceeded');
      return;
    }

    expect(validateFeasibilityWitness(result.witness, rows, inventory, {
      boostKind: 'mini',
      boostLimit: 350,
      dreamShards: 10_000_000,
    })).toMatchObject({ valid: true });
    expect(result.witness.reachedCount).toBe(6);
  });

  it('refine後も固定需要・かけら・Lv+EXP・種族アメを変更しない', () => {
    const rows = [
      demandRow('fixed-a', 601, 'alpha', 4, { boostCandy: 2, normalCandy: 2, shards: 7, reachedLv: 31, expInLevel: 17 }),
      demandRow('fixed-b', 602, 'alpha', 20, { boostCandy: 5, normalCandy: 15, shards: 11, reachedLv: 32, expInLevel: 3, candyDemandMet: false }),
    ];
    const inventory: CandyInventory = {
      species: { '601': 1, '602': 0 },
      typeCandy: { alpha: { s: 1, m: 1 } },
      universal: { s: 2, m: 1, l: 0 },
    };
    const solved = solveFeasibilityForFixedRows(rows, inventory, { boostKind: 'full', boostLimit: 7, dreamShards: 18 });
    expectFeasible(solved);
    const fixed = solved.witness.rows.map(row => ({
      totalCandy: row.totalCandy,
      boostCandy: row.boostCandy,
      normalCandy: row.normalCandy,
      shards: row.shards,
      reachedLv: row.reachedLv,
      expInLevel: row.expInLevel,
      candyDemandMet: row.candyDemandMet,
      species: row.supply.species,
    }));
    const exactRows = solved.witness.rows.map(row => {
      const supply = row.supply.species
        + row.supply.typeS * 4
        + row.supply.typeM * 25
        + row.supply.universalS * 3
        + row.supply.universalM * 20
        + row.supply.universalL * 100;
      return {
        id: row.pokemonId,
        name: row.pokemonId,
        pokedexId: row.pokedexId,
        candyFamilyKey: row.candyFamilyKey,
        type: row.type,
        totalCandyCount: row.totalCandy,
        candyDemandMet: row.candyDemandMet,
        fixedSpecies: row.supply.species,
        selected: { ...row.supply, supply, surplus: supply - row.totalCandy },
      };
    });
    const refined = refineExactSupply(exactRows, inventory, 'surplusFirst');
    expect(refined.status).toBe('ok');
    if (refined.status !== 'ok') return;
    const after = solved.witness.rows.map((row, index) => ({
      totalCandy: row.totalCandy,
      boostCandy: row.boostCandy,
      normalCandy: row.normalCandy,
      shards: row.shards,
      reachedLv: row.reachedLv,
      expInLevel: row.expInLevel,
      candyDemandMet: row.candyDemandMet,
      species: refined.bestRows[index].species,
    }));
    expect(after).toEqual(fixed);
  });
});

type OracleSupply = {
  species: number;
  typeS: number;
  typeM: number;
  universalS: number;
  universalM: number;
  universalL: number;
};

type OracleQuality = {
  zeroSurplusCount: number;
  normalizedSurplus: number;
  maxSurplus: number;
  rawSurplus: number;
  reachedSurplus: number;
  speciesLex: number;
  priority: [number, number, number, number, number];
  legacyPriority: [number, number, number, number];
};

function oracleValue(supply: OracleSupply): number {
  return supply.species
    + supply.typeS * 4
    + supply.typeM * 25
    + supply.universalS * 3
    + supply.universalM * 20
    + supply.universalL * 100;
}

function emptyOracleQuality(): OracleQuality {
  return {
    zeroSurplusCount: 0,
    normalizedSurplus: 0,
    maxSurplus: 0,
    rawSurplus: 0,
    reachedSurplus: 0,
    speciesLex: 0,
    priority: [0, 0, 0, 0, 0],
    legacyPriority: [0, 0, 0, 0],
  };
}

function oracleQualityForSupply(supply: OracleSupply, row: FeasibilityDemandRow, speciesLexOrder = 0): OracleQuality {
  const surplus = Math.max(0, oracleValue(supply) - row.totalCandy);
  return {
    zeroSurplusCount: row.preferZeroSurplus && surplus === 0 ? 1 : 0,
    normalizedSurplus: surplus <= 2 ? 0 : surplus,
    maxSurplus: surplus,
    rawSurplus: surplus,
    reachedSurplus: row.candyDemandMet === false ? 0 : surplus,
    speciesLex: supply.species * speciesLexOrder,
    priority: [supply.typeS, supply.typeM, supply.universalS, supply.universalM, supply.universalL],
    legacyPriority: [-supply.universalL, -supply.universalM, supply.typeS, supply.typeM],
  };
}

function addOracleQuality(a: OracleQuality, b: OracleQuality): OracleQuality {
  return {
    zeroSurplusCount: a.zeroSurplusCount + b.zeroSurplusCount,
    normalizedSurplus: a.normalizedSurplus + b.normalizedSurplus,
    maxSurplus: Math.max(a.maxSurplus, b.maxSurplus),
    rawSurplus: a.rawSurplus + b.rawSurplus,
    reachedSurplus: a.reachedSurplus + b.reachedSurplus,
    speciesLex: a.speciesLex + b.speciesLex,
    priority: a.priority.map((value, index) => value + b.priority[index]) as OracleQuality['priority'],
    legacyPriority: a.legacyPriority.map((value, index) => value + b.legacyPriority[index]) as OracleQuality['legacyPriority'],
  };
}

function compareOracleQuality(a: OracleQuality, b: OracleQuality, mode?: SolverItemCompareMode): number {
  if (mode === 'surplusFirst') {
    if (a.reachedSurplus !== b.reachedSurplus) return a.reachedSurplus < b.reachedSurplus ? 1 : -1;
    if (a.zeroSurplusCount !== b.zeroSurplusCount) return a.zeroSurplusCount > b.zeroSurplusCount ? 1 : -1;
    if (a.rawSurplus !== b.rawSurplus) return a.rawSurplus < b.rawSurplus ? 1 : -1;
    if (a.speciesLex !== b.speciesLex) return a.speciesLex > b.speciesLex ? 1 : -1;
    for (let index = 0; index < a.priority.length; index++) {
      if (a.priority[index] !== b.priority[index]) return a.priority[index] > b.priority[index] ? 1 : -1;
    }
    return 0;
  }
  if (mode === 'legacyImproved') {
    if (a.zeroSurplusCount !== b.zeroSurplusCount) return a.zeroSurplusCount > b.zeroSurplusCount ? 1 : -1;
    const acceptableA = a.normalizedSurplus === 0;
    const acceptableB = b.normalizedSurplus === 0;
    if (acceptableA !== acceptableB) return acceptableA ? 1 : -1;
    if (!acceptableA && a.normalizedSurplus !== b.normalizedSurplus) return a.normalizedSurplus < b.normalizedSurplus ? 1 : -1;
    if (a.speciesLex !== b.speciesLex) return a.speciesLex > b.speciesLex ? 1 : -1;
    for (let index = 0; index < a.legacyPriority.length; index++) {
      if (a.legacyPriority[index] !== b.legacyPriority[index]) return a.legacyPriority[index] > b.legacyPriority[index] ? 1 : -1;
    }
    if (a.rawSurplus !== b.rawSurplus) return a.rawSurplus < b.rawSurplus ? 1 : -1;
    return 0;
  }
  if (a.zeroSurplusCount !== b.zeroSurplusCount) return a.zeroSurplusCount > b.zeroSurplusCount ? 1 : -1;
  if (a.normalizedSurplus !== b.normalizedSurplus) return a.normalizedSurplus < b.normalizedSurplus ? 1 : -1;
  if (a.maxSurplus !== b.maxSurplus) return a.maxSurplus < b.maxSurplus ? 1 : -1;
  if (a.rawSurplus !== b.rawSurplus) return a.rawSurplus < b.rawSurplus ? 1 : -1;
  if (a.speciesLex !== b.speciesLex) return a.speciesLex > b.speciesLex ? 1 : -1;
  return 0;
}

function qualityFromWitness(witness: FeasibilityWitness, rows: FeasibilityDemandRow[]): OracleQuality {
  return witness.rows.reduce((quality, row, index) => addOracleQuality(quality, oracleQualityForSupply(row.supply, rows[index], -index)), emptyOracleQuality());
}

function bruteForceBestQuality(rows: FeasibilityDemandRow[], inventory: CandyInventory, mode?: SolverItemCompareMode): OracleQuality | null {
  const options = rows.map(row => {
    const typeStock = inventory.typeCandy[row.type] ?? { s: 0, m: 0 };
    const speciesStock = inventory.species[row.candyFamilyKey] ?? 0;
    const result: OracleSupply[] = [];
    for (let species = 0; species <= speciesStock; species++) {
      for (let typeS = 0; typeS <= typeStock.s; typeS++) {
        for (let typeM = 0; typeM <= typeStock.m; typeM++) {
          for (let universalS = 0; universalS <= inventory.universal.s; universalS++) {
            for (let universalM = 0; universalM <= inventory.universal.m; universalM++) {
              for (let universalL = 0; universalL <= inventory.universal.l; universalL++) {
                const supply = { species, typeS, typeM, universalS, universalM, universalL };
                if (oracleValue(supply) >= row.totalCandy) result.push(supply);
              }
            }
          }
        }
      }
    }
    return result;
  });

  let best: OracleQuality | null = null;
  const search = (
    index: number,
    typeSUsed: Record<string, number>,
    typeMUsed: Record<string, number>,
    universalS: number,
    universalM: number,
    universalL: number,
    quality: OracleQuality,
  ): void => {
    if (index === rows.length) {
      if (!best || compareOracleQuality(quality, best, mode) > 0) best = quality;
      return;
    }
    const row = rows[index];
    for (const option of options[index]) {
      const nextTypeS = (typeSUsed[row.type] ?? 0) + option.typeS;
      const nextTypeM = (typeMUsed[row.type] ?? 0) + option.typeM;
      if (nextTypeS > (inventory.typeCandy[row.type]?.s ?? 0) || nextTypeM > (inventory.typeCandy[row.type]?.m ?? 0)) continue;
      if (universalS + option.universalS > inventory.universal.s) continue;
      if (universalM + option.universalM > inventory.universal.m) continue;
      if (universalL + option.universalL > inventory.universal.l) continue;
      search(
        index + 1,
        { ...typeSUsed, [row.type]: nextTypeS },
        { ...typeMUsed, [row.type]: nextTypeM },
        universalS + option.universalS,
        universalM + option.universalM,
        universalL + option.universalL,
         addOracleQuality(quality, oracleQualityForSupply(option, row, -index)),
      );
    }
  };

  search(0, {}, {}, 0, 0, 0, emptyOracleQuality());
  return best;
}

function bruteForceFeasible(rows: FeasibilityDemandRow[], inventory: CandyInventory): boolean {
  const options = rows.map(row => {
    const typeStock = inventory.typeCandy[row.type] ?? { s: 0, m: 0 };
    const speciesStock = inventory.species[row.candyFamilyKey] ?? 0;
    const result: OracleSupply[] = [];
    for (let species = 0; species <= speciesStock; species++) {
      for (let typeS = 0; typeS <= typeStock.s; typeS++) {
        for (let typeM = 0; typeM <= typeStock.m; typeM++) {
          for (let universalS = 0; universalS <= inventory.universal.s; universalS++) {
            for (let universalM = 0; universalM <= inventory.universal.m; universalM++) {
              for (let universalL = 0; universalL <= inventory.universal.l; universalL++) {
                const supply = { species, typeS, typeM, universalS, universalM, universalL };
                if (oracleValue(supply) >= row.totalCandy) result.push(supply);
              }
            }
          }
        }
      }
    }
    return result;
  });

  const search = (index: number, selected: OracleSupply[]): boolean => {
    if (index === rows.length) {
      const speciesUsed = new Map<string, number>();
      const typeSUsed = new Map<string, number>();
      const typeMUsed = new Map<string, number>();
      let universalS = 0;
      let universalM = 0;
      let universalL = 0;
      rows.forEach((row, rowIndex) => {
        const supply = selected[rowIndex];
        const speciesKey = row.candyFamilyKey;
        speciesUsed.set(speciesKey, (speciesUsed.get(speciesKey) ?? 0) + supply.species);
        typeSUsed.set(row.type, (typeSUsed.get(row.type) ?? 0) + supply.typeS);
        typeMUsed.set(row.type, (typeMUsed.get(row.type) ?? 0) + supply.typeM);
        universalS += supply.universalS;
        universalM += supply.universalM;
        universalL += supply.universalL;
      });
      for (const [key, amount] of speciesUsed) {
        if (amount !== Math.min(inventory.species[key] ?? 0, rows.filter(row => row.candyFamilyKey === key).reduce((sum, row) => sum + row.totalCandy, 0))) return false;
      }
      for (const [type, amount] of typeSUsed) if (amount > (inventory.typeCandy[type]?.s ?? 0)) return false;
      for (const [type, amount] of typeMUsed) if (amount > (inventory.typeCandy[type]?.m ?? 0)) return false;
      return universalS <= inventory.universal.s
        && universalM <= inventory.universal.m
        && universalL <= inventory.universal.l;
    }
    return options[index].some(option => search(index + 1, [...selected, option]));
  };

  return search(0, []);
}
