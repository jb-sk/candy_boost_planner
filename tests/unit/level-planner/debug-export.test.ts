import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebugExportContext } from '../../../src/domain/level-planner/debugExport';
import type { LevelPlannerResult, PokemonPlanLine, PokemonPlanResult } from '../../../src/domain/level-planner/types';
import { createSleepSchedule } from '../../../src/domain/pokesleep/sleep-schedule';

const heavySolverSpies = vi.hoisted(() => ({
  refineExactSupply: vi.fn(() => { throw new Error('debug export must not run refineExactSupply'); }),
  solveLevelPlanWithBudget: vi.fn(() => { throw new Error('debug export must not run solveLevelPlanWithBudget'); }),
}));

vi.mock('../../../src/domain/level-planner/core/exactSupplyRefine', () => ({
  refineExactSupply: heavySolverSpies.refineExactSupply,
}));
vi.mock('../../../src/domain/level-planner/core/solveLevelPlan', () => ({
  solveLevelPlanWithBudget: heavySolverSpies.solveLevelPlanWithBudget,
}));

import { buildDebugExportTsv } from '../../../src/domain/level-planner/debugExport';

function planLine(): PokemonPlanLine {
  return {
    level: 20,
    expInLevel: 0,
    expToNextLevel: 100,
    expToTarget: 0,
    totalCandyUnitsUsed: 5,
    boostedCandyUnits: 0,
    nonBoostCandyUnits: 5,
    candySupply: {
      species: 3,
      type: { s: 0, m: 0 },
      universal: { s: 1, m: 0, l: 0 },
    },
    dreamShardsUsed: 1,
    expGained: 125,
    surplusExp: 0,
    surplusCandyValue: 1,
    candyDemandMet: true,
    effectiveTargetReached: true,
  };
}

function pokemonPlan(): PokemonPlanResult {
  const line = planLine();
  return {
    pokemonId: 'row\t1',
    pokedexId: 25,
    name: 'Pika\tChu\nLine',
    currentLevel: 10,
    currentExpInLevel: 5,
    targetLevel: 20,
    targetExpInLevel: 0,
    targetLine: line,
    reachableLine: line,
    candyDemandMet: true,
    shortage: { expToTarget: 0, candyToTarget: 0, dreamShardShortage: 0, boostCandyUnavailable: 0 },
    constraintDiagnosis: {
      byCandyInventory: { level: 20, expInLevel: 0, candyUsed: 5 },
      byBoostLimit: { level: 20, expInLevel: 0, candyUsed: 5 },
      byDreamShards: { level: 20, expInLevel: 0, candyUsed: 5 },
      limitingFactor: null,
      isInventoryShortage: false,
      isBoostShortage: false,
      isShardsShortage: false,
    },
    role: 'upper',
  };
}

function result(): LevelPlannerResult {
  const plan = pokemonPlan();
  return {
    pokemonResults: [plan],
    summary: {
      totalDreamShardsUsed: 1,
      dreamShardsRemaining: 999,
      boost: { kind: 'none', boostLimit: 0, boostUsed: 0, boostRemaining: 0 },
      speciesCandyUsed: { '25': 3 },
      typeCandyUsed: { electric: { s: 0, m: 0 } },
      universalCandyUsed: { s: 1, m: 0, l: 0 },
      speciesCandyRemaining: { '25': 0 },
      typeCandyRemaining: { electric: { s: 2, m: 0 } },
      universalCandyRemaining: { s: 0, m: 1, l: 1 },
      itemUsageRanking: [],
      totalNeed: { totalCandyUnits: 5, totalDreamShards: 1, totalBoostCandyRequested: 0 },
      totalSupplied: { totalCandyValue: 6, totalBoostedCandyUnits: 0, totalNonBoostCandyUnits: 5, totalDreamShards: 1 },
      fullyReachedCount: 1,
    },
    shortages: {
      hasShortage: false,
      totalExpToTargets: 0,
      totalCandyShortage: 0,
      totalDreamShardShortage: 0,
      candyShortages: [],
      shardShortages: [],
    },
    lossLedger: { hasLoss: false, supplyCandidateCuts: [], frontierCuts: [], stateCaps: [], expansionCapReductions: [] },
    performance: { feasibilityMs: 12.5, refineMs: 2.5, refineStatus: 'ok' },
  };
}

function context(): DebugExportContext {
  const plannerResult = result();
  return {
    result: plannerResult,
    rows: [{
      id: 'row\t1',
      name: 'Pika\tChu\nLine',
      pokedexId: 25,
      candyFamilyKey: '25',
      type: 'electric',
      nature: 'normal',
      expType: 600,
      currentLevel: 10,
      currentExpInLevel: 5,
      expRemaining: 95,
      targetLevel: 20,
      targetExpInLevel: 0,
      candyTarget: 5,
      sleep: {
        sleepTargetHours: 1000,
        sleepHours: 500,
        remainingHours: 500,
        requiredDays: 39,
        sleepExp: 4300,
        breakdown: {
          dailySleepMinutes: 780,
          dailyScore: 100,
          dailyExp: 100,
          baseExp: 3900,
          outerBonusExtra: 400,
          incenseExtra: 0,
          sleepExpBonus: 1,
          naturePercent: 100,
          normalDays: 36,
          flankDays: 2,
          fullMoonDays: 1,
          normalIncenseDays: 0,
          flankIncenseDays: 0,
          fullMoonIncenseDays: 0,
        },
        needed: { kind: 'long-term-estimate', requiredDays: 32, totalMinutes: 24_960, growthIncenseCount: 0, skipsLastDayIncense: false },
      },
      plan: plannerResult.pokemonResults[0],
    }],
    itemCompareMode: 'surplusGateFirst',
    inventorySnapshot: {
      species: { '25': 3 },
      typeCandy: { electric: { s: 2, m: 0 } },
      universal: { s: 1, m: 1, l: 1 },
    },
    boost: { kind: 'none', limit: 0 },
    dreamShards: 1_000,
    sleepSettings: {
      dailySleepHours: 13,
      sleepExpBonusCount: 0,
      includeGSD: false,
      timeZone: 'UTC',
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 0,
      growthIncenseStock: null,
      manualEventBonuses: [{ from: '2026-01-02', to: '2026-01-03', multiplier: 1.5 }],
      useProjectedEvents: false,
      blueSeedPlantWeekday: 1,
      blueSeedIncenseDays: "auto",
    },
    sleepSchedule: createSleepSchedule({
      startGameDate: '2026-01-01',
      timeZone: 'UTC',
      includeGSD: false,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 0,
    }),
    projectedEventCount: 3,
    currentGameDate: '2026-01-01',
    debugNow: '',
    sleepCalculationError: null,
    displayed: {
      result: plannerResult,
      calculationMode: 'prefixLocalMixed',
      loss: false,
      durationMs: 15,
      mixedPrefixCount: 0,
      mixedSource: 'feasibility',
    },
    performanceProfile: {
      policy: 'autoMixed',
      structuralProbeStatus: 'exactCompleted',
      lastDeadlineMs: 2_000,
      mixedPrefixCount: 0,
    },
    verificationMode: 'normalPathSnapshot',
  };
}

const mainColumns = [
  'index', 'id', 'name', 'pokedexId', 'candyFamilyKey', 'type', 'nature',
  'currentLv', 'currentExpInLevel', 'expRemaining', 'targetLv', 'targetExpInLevel', 'candyTarget', 'sleepTargetMode',
  'boostKind', 'itemCompareMode', 'calculationScope', 'reachedLv', 'candyDemandMet', 'role', 'expToNext', 'expToTarget',
  'shortageCandy', 'shortageBoost', 'shortageShards', 'limitingFactor', 'initialSpeciesStock',
  'reachableBoost', 'reachableNormal', 'reachableTotalCandy', 'reachableShards',
  'reachableSpecies', 'reachableTypeS', 'reachableTypeM', 'reachableUniversalS', 'reachableUniversalM', 'reachableUniversalL',
  'reachableTotalSupply', 'reachableItemValue', 'reachableNonSpeciesItemValue', 'reachableSurplus',
  'targetBoost', 'targetNormal', 'targetTotalCandy', 'targetShards',
  'targetSpecies', 'targetTypeS', 'targetTypeM', 'targetUniversalS', 'targetUniversalM', 'targetUniversalL',
  'targetTotalSupply', 'targetItemValue', 'targetNonSpeciesItemValue', 'targetSurplus',
  // targetLv/targetExpInLevel は睡眠後の最終目標。アメを使い終えた地点は別列（設計書§6.4）。
  'plannedCandyEndLevel', 'plannedCandyEndExpInLevel',
  'reachableCandyEndLevel', 'reachableCandyEndExpInLevel',
];

describe('level planner debug TSV golden contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fixes section order, columns, escaping, and normal-path-only verification', () => {
    const input = context();
    const first = buildDebugExportTsv(input);
    const second = buildDebugExportTsv(input);
    const sections = first.split('\n\n');

    expect(first).toBe(second);
    expect(sections.map(section => section.split('\n')[0])).toEqual([
      mainColumns.join('\t'),
      'SLEEP_EXP',
      'CALCULATION_POLICY',
      'BOUNDARY_SEARCH',
      'LOSS_LEDGER',
      'EXACT_VERIFICATION',
      'FBL01D_FEASIBILITY',
    ]);
    expect(sections[0].split('\n')[0].split('\t')).toEqual(mainColumns);
    expect(sections[2].split('\n')[1]).toBe('mode\tpolicy\tstructuralProbeStatus\tdeadlineMs\tactualDurationMs\tfeasibilityMs\trefineMs\trefineStatus\trefineReason\tloss\tsource\texactPrefixCount\tlocalStartIndex\tlocalSuffixCount');
    expect(sections[5].split('\n')[1]).toBe('status\tselectedIsExactBest\tmode\trows\tlocalCandidateCounts\tdpFinalStates\tscope\texactPrefixCount\tlocalSuffixCount\tnote');
    expect(sections[6].split('\n')[1]).toBe('status\tselectedValid\tsolverStatus\trefineStatus\trows\treachedCount\tboundaryIndex\tboundaryLv\tboundaryExp\tdurationMs\tglobalKeyCount\ttransitions\twitnessRestoreMs\treason');

    // 睡眠EXPの中間値: 入力（設定・時間）から合計までを1行に並べ、どこで食い違うか切り分けられるようにする
    const sleepLines = sections[1].split('\n');
    expect(sleepLines[1]).toBe('settings\tcurrentGameDate\tdebugNow\ttimeZone\tdailySleepHours\tsleepExpBonusCount\tsleepExpBonus\tincludeGSD\tuseProjectedEvents\tprojectedEventCount\tblueSeedPlantWeekday\tblueSeedIncenseDays\twikiKnownThrough\tgrowthIncenseGsdDays\tgrowthIncenseNormalPerWeek\tgrowthIncenseStock\tmanualEventBonuses\tcalculationError');
    expect(sleepLines[2]).toBe('settings\t2026-01-01\t\tUTC\t13\t0\t1\tfalse\toff\t3\t1\tauto\t\t0/0/0\t0\tunlimited\t[{"from":"2026-01-02","to":"2026-01-03","multiplier":1.5}]\t');

    // 数値指定もそのまま出す。`auto` だけを固定していると「常に auto を書く」退行が通る。
    const numeric = context();
    numeric.sleepSettings = { ...numeric.sleepSettings, blueSeedIncenseDays: 5 };
    expect(buildDebugExportTsv(numeric).split('\n\n')[1]!.split('\n')[2]!.split('\t')[11]).toBe('5');
    expect(sleepLines[3]).toBe([
      'row', 'index', 'id', 'name', 'nature', 'naturePercent',
      'sleepTargetMode', 'sleepSource',
      'sleepTargetHours', 'sleepHours', 'remainingHours',
      'dailySleepMinutes', 'dailyScore', 'sleepExpBonus', 'dailyExp', 'baseExp', 'requiredDays',
      'normalDays', 'flankDays', 'fullMoonDays',
      'normalIncenseDays', 'flankIncenseDays', 'fullMoonIncenseDays',
      'growthIncenseCount', 'skipsLastDayIncense',
      'outerBonusExtra', 'incenseExtra', 'sleepExp', 'fullMoonDates', 'schedulePreview',
      'candyTarget', 'targetLv', 'targetExpInLevel', 'expToTarget',
      'sleepReachStatus', 'sleepReachReason', 'sleepReachLevel', 'sleepReachTenths', 'sleepReachDisplay', 'sleepReachRatio',
      'neededKind', 'neededDays', 'neededMinutes', 'neededScore', 'neededMinutesMin', 'neededMinutesMax',
    ].join('\t'));
    expect(sleepLines[4].split('\t').slice(0, 28)).toEqual([
      'row', '1', 'row 1', 'Pika Chu Line', 'normal', '100',
      '', 'sleepTargetHours',
      '1000', '500', '500',
      '780', '100', '1', '100', '3900', '39',
      '36', '2', '1', '0', '0', '0', '', '', '400', '0', '4300',
    ]);
    // タブ・改行のエスケープは name（'Pika\tChu\nLine'）で検証する
    expect(first).toContain('Pika Chu Line');
    expect(first).not.toContain('Pika\tChu');
    expect(first).not.toContain('Pika\nChu');
    expect(first).toContain('normal-path fixed-demand refine snapshot; export solver disabled');
    expect(first).toContain('heavy_solver_disabled_in_tsv_export');
    expect(heavySolverSpies.refineExactSupply).not.toHaveBeenCalled();
    expect(heavySolverSpies.solveLevelPlanWithBudget).not.toHaveBeenCalled();
  });

  it('睡眠到達Lvの表示値・生比・非表示理由・Lv70の非該当値をSLEEP_EXPへ出す', () => {
    const input = context();
    const row = input.rows[0]!;
    const plan = row.plan!;
    const reachableLine = { ...plan.reachableLine, level: 60, expInLevel: 0 };
    row.targetLevel = 60;
    row.sleep!.sleepExp = 2751;
    row.plan = {
      ...plan,
      targetLevel: 60,
      targetExpInLevel: 0,
      reachableLine,
    };

    const sleepRow = () => {
      const lines = buildDebugExportTsv(input).split('\n\n')[1]!.split('\n');
      const headers = lines[3]!.split('\t');
      const values = lines[4]!.split('\t');
      return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    };

    expect(sleepRow()).toMatchObject({
      sleepReachStatus: 'shown',
      sleepReachReason: '',
      sleepReachLevel: '60',
      sleepReachTenths: '9',
      sleepReachDisplay: '60.9',
      sleepReachRatio: String(2751 / 2865),
    });

    row.sleep!.sleepExp = 100;
    expect(sleepRow()).toMatchObject({
      sleepReachStatus: 'hidden',
      sleepReachReason: 'displayEqualsTargetLevel',
    });

    row.sleep!.sleepExp = 0;
    expect(sleepRow()).toMatchObject({
      sleepReachStatus: 'hidden',
      sleepReachReason: 'noSleepExp',
    });

    row.sleep!.sleepExp = 500;
    row.plan = {
      ...row.plan,
      targetLevel: 62,
      reachableLine: { ...reachableLine, level: 58 },
    };
    expect(sleepRow()).toMatchObject({
      sleepReachStatus: 'hidden',
      sleepReachReason: 'notExceedingTarget',
    });

    row.sleep!.sleepExp = 3255;
    row.plan = {
      ...row.plan,
      targetLevel: 65,
      reachableLine: { ...reachableLine, level: 69 },
    };
    expect(sleepRow()).toMatchObject({
      sleepReachStatus: 'shown',
      sleepReachLevel: '70',
      sleepReachTenths: 'notApplicable',
      sleepReachDisplay: '70',
      sleepReachRatio: 'notApplicable',
    });
  });

  /** SLEEP_EXP 節の1行目から schedulePreview 列を取り出す（列位置に依存させない）。 */
  function schedulePreviewOf(tsv: string): string {
    const lines = tsv.split('\n\n').find(section => section.startsWith('SLEEP_EXP'))!.split('\n');
    const headers = lines[3]!.split('\t');
    return lines[4]!.split('\t')[headers.indexOf('schedulePreview')]!;
  }

  it('schedulePreview tells the four event sources apart while leaving real events unmarked', () => {
    const input = context();
    input.sleepSchedule = createSleepSchedule({
      startGameDate: '2026-01-01',
      timeZone: 'UTC',
      includeGSD: false,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 0,
      eventSegments: [
        { from: '2026-01-01', to: '2026-01-01', multiplier: 1.5, source: 'projected' },
        { from: '2026-01-02', to: '2026-01-02', multiplier: 3, source: 'flower' },
        { from: '2026-01-03', to: '2026-01-03', multiplier: 1.25, source: 'real' },
        { from: '2026-01-04', to: '2026-01-04', multiplier: 3, source: 'projectedFlower' },
      ],
    });
    const cells = schedulePreviewOf(buildDebugExportTsv(input)).split(',');

    expect(cells[0]).toContain(':ev1.5p:');
    expect(cells[1]).toContain(':ev3f:');
    expect(cells[2]).toContain(':ev1.25:');
    // 画面の内訳は仮の花を「仮イベント」へ畳むので、実の花と見分けられるのはここだけ。
    expect(cells[3]).toContain(':ev3pf:');
  });

  /**
   * 長期の行は最終日が何の日かで残EXPの端数が決まる。先頭だけの抜粋では最後まで追えないので、
   * 末尾3日も出す（間を飛ばしたことは `...` で分かるようにする）。
   */
  /**
   * ゲーム内日は AM4:00 で切り替わるので、`00:00`〜`03:59` を上書きすると
   * `currentGameDate` は前日になる。TSVだけ見てその差が読めるよう、生の入力も残す。
   */
  it('デバッグ用の現在日時を settings 行へ出す', () => {
    const withDebugNow = { ...context(), debugNow: '2026-01-02T02:30', currentGameDate: '2026-01-01' as const };
    const sleepLines = buildDebugExportTsv(withDebugNow).split('\n\n')[1]!.split('\n');
    const cells = sleepLines[2]!.split('\t');

    expect(cells[1]).toBe('2026-01-01'); // currentGameDate（AM4:00前なので前日）
    expect(cells[2]).toBe('2026-01-02T02:30'); // debugNow（入力そのまま）
  });

  it('日別スケジュールの抜粋へ末尾3日を含め、飛ばした区間を明示する', () => {
    const input = context();
    const cells = schedulePreviewOf(buildDebugExportTsv(input)).split(',');

    // requiredDays 39 → 先頭14日 + '...' + 末尾3日（index 36〜38）
    expect(cells).toHaveLength(14 + 1 + 3);
    expect(cells[0]!.startsWith('2026-01-01:')).toBe(true);
    expect(cells[13]!.startsWith('2026-01-14:')).toBe(true);
    expect(cells[14]).toBe('...');
    expect(cells[15]!.startsWith('2026-02-06:')).toBe(true);
    expect(cells[17]!.startsWith('2026-02-08:')).toBe(true);
  });

  /**
   * 最終日のお香は「無くても届くなら使わない」。スケジュール上はお香日でも実際には使わないので、
   * そのまま `incense` と出すと画面のお香個数と合わない。
   */
  it('最終日のお香を外した行は抜粋の最終日を skipped と書き分ける', () => {
    const input = context();
    input.sleepSchedule = createSleepSchedule({
      startGameDate: '2026-01-01',
      timeZone: 'UTC',
      includeGSD: false,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 7,
    });
    const sleep = input.rows[0]!.sleep!;
    input.rows[0] = {
      ...input.rows[0]!,
      sleep: {
        ...sleep,
        skipsLastDayIncense: true,
        // 残EXPへ届く日と目標時間を寝きる日が同じ行（モード行はいつもこの形）。
        needed: { ...sleep.needed!, kind: 'long-term-estimate', requiredDays: sleep.requiredDays, totalMinutes: 0, growthIncenseCount: 0, skipsLastDayIncense: true },
      },
    };
    const cells = schedulePreviewOf(buildDebugExportTsv(input)).split(',');

    expect(cells[0]).toContain(':incense:');
    expect(cells.at(-2)).toContain(':incense:');
    expect(cells.at(-1)).toContain(':skipped:');
  });

  /**
   * `skipsLastDayIncense` が指すのは `needed`（残EXPへ届くまで）の最終日で、
   * `requiredDays`（睡眠目標時間を寝きる日数）の最終日ではない。
   * 抜粋の末尾へ機械的に付けると、外していない日を「外した」と出してしまう。
   */
  it('skipped は needed の最終日に付ける（requiredDays の最終日ではない）', () => {
    const input = context();
    input.sleepSchedule = createSleepSchedule({
      startGameDate: '2026-01-01',
      timeZone: 'UTC',
      includeGSD: false,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 7,
    });
    // requiredDays 39（目標時間ぶん）に対し、残EXPへ届くのは 32 日目。
    input.rows[0] = {
      ...input.rows[0]!,
      sleep: { ...input.rows[0]!.sleep!, skipsLastDayIncense: true },
    };
    const cells = schedulePreviewOf(buildDebugExportTsv(input)).split(',');

    // 32日目 = index 31 は先頭14日にも末尾3日にも入らないので、抜粋には出ない。
    expect(cells.filter(cell => cell.includes(':skipped:'))).toHaveLength(0);
    // 39日目（index 38）は外していないので incense のまま。
    expect(cells.at(-1)).toContain('2026-02-08:');
    expect(cells.at(-1)).toContain(':incense:');
  });

  /**
   * 「すべて睡眠 / アメ在庫＋睡眠」も同じ SLEEP_EXP 節へ出す。導出の向きが逆（残EXP→日数）なので、
   * `sleepSource` で区別できることと、計画睡眠EXPを持たない扱い（`noSleepExp`）が崩れないことを見る。
   */
  it('すべて睡眠も同じSLEEP_EXP節へ出し、導出経路と計画睡眠EXP無しを判別できる', () => {
    const input = context();
    const base = input.rows[0]!;
    input.rows[0] = {
      ...base,
      candyTarget: undefined,
      sleepTargetMode: 'all',
      sleep: {
        ...base.sleep!,
        sleepTargetHours: undefined,
        sleepHours: undefined,
        remainingHours: undefined,
        growthIncenseCount: 3,
        skipsLastDayIncense: true,
      },
      plan: {
        ...base.plan!,
        shortage: {
          ...base.plan!.shortage,
          expToTarget: 10_000,
        },
      },
    };
    const sections = buildDebugExportTsv(input).split('\n\n');
    expect(sections[0]!.split('\n')[1]!.split('\t')[13]).toBe('all');
    // ALL_SLEEP 節は廃止。睡眠計画のある行は SLEEP_EXP 節ひとつに集約する。
    expect(sections.map(section => section.split('\n')[0])).not.toContain('ALL_SLEEP');

    const sleepLines = sections[1]!.split('\n');
    const headers = sleepLines[3]!.split('\t');
    const values = sleepLines[4]!.split('\t');
    const cells = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    expect(cells).toMatchObject({
      sleepTargetMode: 'all',
      sleepSource: 'expToTarget',
      // 睡眠目標時間を持たない経路なので空。0 と混ぜない。
      sleepTargetHours: '',
      sleepHours: '',
      remainingHours: '',
      growthIncenseCount: '3',
      skipsLastDayIncense: 'true',
      neededKind: 'long-term-estimate',
      neededDays: '32',
      // 計画睡眠EXPは無い（§2.3）。空欄だと「計算していない」と区別できないので理由を出す。
      sleepReachStatus: 'hidden',
      sleepReachReason: 'noSleepExp',
      sleepReachLevel: '',
    });
  });
});
