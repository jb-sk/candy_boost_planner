/**
 * LevelPlanner - 型定義
 *
 * レベルアップ計画に必要な全ての型を定義。
 * 入力（Request）、出力（Result）、内部状態（Working State）を明確に分離。
 */

import type { ExpType, ExpGainNature } from '../types';

// ============================================================
// 定数型
// ============================================================

/** アメブースト種類 */
export type BoostKind = 'none' | 'mini' | 'full';

/** ポケモンタイプ（英語） */
export type PokemonType = string;

/** 不足の種類 */
export type ShortageType = 'candy' | 'boost' | 'shards';

// ============================================================
// 在庫型
// ============================================================

/**
 * タイプアメ在庫
 */
export type TypeCandyStock = {
  s: number;
  m: number;
};

/**
 * 万能アメ在庫
 */
export type UniversalCandyStock = {
  s: number;
  m: number;
  l: number;
};

/**
 * アメ在庫
 */
export type CandyInventory = {
  /** 種族アメ（pokedexId → 個数） */
  species: Record<string, number>;

  /** タイプアメ（タイプ名 → 個数） */
  typeCandy: Record<string, TypeCandyStock>;

  /** 万能アメ */
  universal: UniversalCandyStock;
};

// ============================================================
// fbl01d feasibility witness
// ============================================================

/** 合同 feasibility に渡す、供給内訳をまだ持たない固定需要行。 */
export type FeasibilityDemandRow = {
  pokemonId: string;
  pokedexId: number;
  type: PokemonType;
  totalCandy: number;
  boostCandy: number;
  normalCandy: number;
  shards: number;
  reachedLv: number;
  expInLevel: number;
  targetReached: boolean;
  preferZeroSurplus?: boolean;
  speciesLexWeight?: number;
};

/** 合同 feasibility が復元する、行単位の実在供給 witness。 */
export type FeasiblePlanRow = FeasibilityDemandRow & {
  supply: {
    species: number;
    typeS: number;
    typeM: number;
    universalS: number;
    universalM: number;
    universalL: number;
  };
};

/** witness から再計算できる残資源。余りを種族在庫へ戻した値は持たない。 */
export type FeasibleResourceState = {
  species: Record<string, number>;
  typeCandy: Record<PokemonType, TypeCandyStock>;
  universal: UniversalCandyStock;
  boostCandy: number;
  dreamShards: number;
};

/** 固定需要 feasibility の実行条件。需要行のアメブ/かけらは変更しない。 */
export type FeasibilitySolverOptions = {
  boostKind?: BoostKind;
  boostLimit?: number;
  dreamShards?: number;
  itemCompareMode?: SolverItemCompareMode;
  /** 探索打ち切り時に品質床として保持する既存 witness。 */
  fallbackWitness?: FeasibilityWitness;
  /** テスト・制御経路用。状態を近似削減する cap ではなく、打ち切りを inconclusive にする境界。 */
  abortAfterTransitions?: number;
  deadlineMs?: number;
  logPerformance?: boolean;
  /** 検索用の安全なゲート。指定時は各行の供給余りがこの値を超える行候補を除外する。 */
  maxRowSurplus?: number;
  /** 検索用の安全なゲート。指定時は全行合計の供給余りがこの値を超える状態を除外する。 */
  maxTotalSurplus?: number;
};

export type FeasibilityWitness = {
  reachedCount: number;
  boundaryIndex: number | null;
  boundaryLevel: number;
  boundaryExpInLevel: number;
  rows: FeasiblePlanRow[];
  remaining: FeasibleResourceState;
};

export type FeasibilityStats = {
  rowOptionCounts: number[];
  rowFrontierCounts: number[];
  typeBlockFrontierCounts: number[];
  globalKeyCount: number;
  transitions: number;
  witnessRestoreMs: number;
  durationMs: number;
  elapsedMs: number;
};

export type FeasibilityValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

export type FeasibilityResult =
  | { status: 'feasible'; witness: FeasibilityWitness; stats: FeasibilityStats }
  | { status: 'infeasible'; reason: string; stats: FeasibilityStats }
  | { status: 'inconclusive'; reason: string; stats: FeasibilityStats; witness?: FeasibilityWitness };

export type FeasibilityRefineStatus = 'ok' | 'invalid_selected' | 'unsupported' | 'inconclusive' | 'no_feasible_combination';

export type FeasibilityRefineResult = {
  status: 'refined' | 'baseline';
  witness: FeasibilityWitness;
  refineStatus: FeasibilityRefineStatus;
  durationMs: number;
  reason?: string;
};

/**
 * 到達可能情報
 */
export type ReachableInfo = {
  /** 到達可能レベル */
  level: number;

  /** 到達レベル内で稼いだEXP */
  expInLevel: number;

  /** 到達に使用したアメ数（この制限での仮のcandyNeed） */
  candyUsed: number;
};

// ============================================================
// ヘルパー用の型
// ============================================================

/**
 * アイテム配分の探索結果
 */
export type ItemAllocationResult = {
  typeS: number;
  typeM: number;
  universalS: number;
  universalM: number;
  universalL: number;
  supplied: number;
};

/**
 * 万能アメのみの配分結果
 */
export type UniversalAllocationResult = {
  s: number;
  m: number;
  l: number;
  supplied: number;
};

// ============================================================
// 単一最適化パイプライン（fbl01）
// ============================================================

/** 個数指定行の入力。個数はすべて価値換算アメ個数。 */
export type CandyTargetInput = {
  totalCandyUnits: number;
  boostedCandyUnits?: number;
};

export type ItemCompareMode = 'surplusFirst' | 'surplusGateFirst' | 'legacyImproved';
export type SolverItemCompareMode = ItemCompareMode;

export type PlannerOptions = {
  itemCompareMode: SolverItemCompareMode;
};

export type PokemonPlanInput = {
  pokemonId: string;
  pokedexId: number;
  name: string;
  /** UIの入力モード。solver計算自体では使わないが、signatureの構造情報に含める。 */
  mode?: 'targetLevel' | 'peak';
  type: PokemonType;
  currentLevel: number;
  currentExpInLevel: number;
  targetLevel: number;
  targetExpInLevel?: number;
  candyTarget?: CandyTargetInput;
  expType: ExpType;
  nature: ExpGainNature;
  requestedBoostCandy: number;
  boostAllowed: boolean;
  preferZeroSurplus?: boolean;
  priorityIndex: number;
};

export type LevelPlannerInput = {
  pokemonList: PokemonPlanInput[];
  dreamShards: number;
  boost: { kind: BoostKind; limit: number };
  candyInventory: CandyInventory;
  options?: Partial<PlannerOptions>;
};

/**
 * レベルプランナーの自動再計算方針。表示中結果の計算モードとは別物。
 *
 * autoExact: 自動再計算でもまず exact を試す。
 * autoMixed: 互換名。現在は exact を試さず fbl01d feasibility witness 計算へ流す。
 */
export type CalculationPolicy = 'autoExact' | 'autoMixed';

export type StructuralProbeStatus =
  | 'idle'
  | 'running'
  | 'exactCompleted'
  | 'deadlineExceeded'
  | 'aborted';

/**
 * 実際に走らせる計算方式。
 *
 * prefixLocalMixed: 互換名。現在の通常経路では fbl01d feasibility witness 計算を表す。
 */
export type CalculationMode = 'exact' | 'prefixLocalMixed';
export type MixedCalculationSource = 'mixed' | 'feasibility';

export type MixedCalculationMeta = {
  source: MixedCalculationSource;
  exactPrefixCount: number;
  localSuffixCount: number;
};

export type DeadlineExceededMeta = {
  deadlineExceeded: true;
  elapsedMs: number;
  reachedIndex: number;
  expansions: number;
  maxNextStates: number;
  maxOutputStates: number;
  /** deadline超過時点で完全処理済みのprefix長。処理中indexは含まない。 */
  completedPrefixCount: number;
};

export type PlannerTuning = {
  maxSupplyCandidates: number;
  maxSharedSpeciesSupplyCandidates: number;
  maxStatesPerIndex: number;
  maxStatesBeforeFinalIndex: number;
  maxExpansions: number;
};

export type PlannerSolveOptions = {
  deadlineMs?: number;
  /** CIで安定して deadlineExceeded を再現する決定的budget。maxExpansionsとは別物。 */
  abortAfterExpansions?: number;
  /** prefixLocalMixedで再利用する完走済みprefix長。処理中indexは含めない。 */
  mixedPrefixCount?: number;
  tuning?: Partial<PlannerTuning>;
  calculationMode?: CalculationMode;
};

export type PlannerSolveOutcome =
  | { kind: 'result'; result: LevelPlannerResult; durationMs: number; mixedMeta?: MixedCalculationMeta }
  | { kind: 'deadlineExceeded'; meta: DeadlineExceededMeta; mixedResult: LevelPlannerResult; durationMs: number; mixedMeta: MixedCalculationMeta };

export type CandySupplyBreakdown = {
  species: number;
  type: { s: number; m: number };
  universal: { s: number; m: number; l: number };
};

export type PokemonPlanLine = {
  level: number;
  expInLevel: number;
  expToNextLevel: number;
  expToTarget: number;
  totalCandyUnitsUsed: number;
  boostedCandyUnits: number;
  nonBoostCandyUnits: number;
  candySupply: CandySupplyBreakdown;
  dreamShardsUsed: number;
  expGained: number;
  surplusExp: number;
  surplusCandyValue: number;
  targetReached: boolean;
};

export type PokemonShortage = {
  expToTarget: number;
  candyToTarget: number;
  dreamShardShortage: number;
  boostCandyUnavailable: number;
};

export type PokemonConstraintDiagnosis = {
  byCandyInventory: ReachableInfo;
  byBoostLimit: ReachableInfo;
  byDreamShards: ReachableInfo;
  limitingFactor: ShortageType | null;
  isInventoryShortage: boolean;
  isBoostShortage: boolean;
  isShardsShortage: boolean;
};

export type PokemonPlanResult = {
  pokemonId: string;
  pokedexId: number;
  name: string;
  currentLevel: number;
  currentExpInLevel: number;
  targetLevel: number;
  targetExpInLevel: number;
  targetLine: PokemonPlanLine;
  candyTargetLine?: PokemonPlanLine;
  reachableLine: PokemonPlanLine;
  targetReached: boolean;
  shortage: PokemonShortage;
  constraintDiagnosis: PokemonConstraintDiagnosis;
  role: 'upper' | 'boundary' | 'lower';
};

export type BoostUsageSummary = {
  kind: BoostKind;
  boostLimit: number;
  boostUsed: number;
  boostRemaining: number;
};

export type PlannerSummary = {
  totalDreamShardsUsed: number;
  dreamShardsRemaining: number;
  boost: BoostUsageSummary;
  speciesCandyUsed: Record<string, number>;
  typeCandyUsed: Record<PokemonType, TypeCandyStock>;
  universalCandyUsed: UniversalCandyStock;
  speciesCandyRemaining: Record<string, number>;
  typeCandyRemaining: Record<PokemonType, TypeCandyStock>;
  universalCandyRemaining: UniversalCandyStock;
  itemUsageRanking: Array<{ pokemonId: string; name: string; typeS: number; typeM: number; universalS: number; universalM: number; universalL: number; totalValue: number }>;
  totalNeed: { totalCandyUnits: number; totalDreamShards: number; totalBoostCandyRequested: number };
  totalSupplied: { totalCandyValue: number; totalBoostedCandyUnits: number; totalNonBoostCandyUnits: number; totalDreamShards: number };
  boundaryPokemonId?: string;
  fullyReachedCount: number;
};

export type PlannerShortageSummary = {
  hasShortage: boolean;
  totalExpToTargets: number;
  totalCandyShortage: number;
  totalDreamShardShortage: number;
  candyShortages: Array<{ pokemonId: string; name: string; amount: number }>;
  shardShortages: Array<{ pokemonId: string; name: string; amount: number }>;
};

export type PlannerLossLedger = {
  hasLoss: boolean;
  supplyCandidateCuts: Array<{
    pokemonId: string;
    name: string;
    pokedexId: number;
    totalCandyUnits: number;
    limit: number;
    kept: number;
    selectedBeforeTrim: number;
    stoppedAtSurplus: number;
    maxSurplus: number;
    sharedSpecies: boolean;
    itemCompareMode: ItemCompareMode;
  }>;
  frontierCuts: Array<{
    index: number;
    before: number;
    after: number;
    limit: number;
    signatureMergedStates: number;
  }>;
  stateCaps: Array<{
    index: number;
    cap: number;
    reason: 'beforeFinal';
  }>;
  expansionCapReductions: Array<{
    index: number;
    expansions: number;
    cap: number;
  }>;
};

export type LevelPlannerResult = {
  pokemonResults: PokemonPlanResult[];
  summary: PlannerSummary;
  shortages: PlannerShortageSummary;
  lossLedger: PlannerLossLedger;
  performance?: {
    feasibilityMs?: number;
    refineMs?: number;
    refineStatus?: string;
    refineReason?: string;
    boundarySearch?: {
      mode: ItemCompareMode;
      boundaryIndex: number;
      targetTotalCandy: number;
      maxFeasibleTotalCandy: number;
      maxFeasibleScope: 'unrestricted' | 'rowSurplusGate' | 'totalSurplusGate' | 'unknown';
      selectedTotalCandy: number;
      checkedLowerTotals: number;
      feasibleLowerTotals: number;
      rejectedLowerTotals: number;
      inconclusiveLowerTotals: number;
      rowSurplusGateSkippedTotals: number;
      decisionRejectedLowerTotals: number;
      firstZeroRawSurplusTotalCandy?: number;
      selectedRawSurplus: number;
      selectedNormalizedSurplus: number;
      selectedBoundaryLevel: number;
      selectedBoundaryExpInLevel: number;
      stoppedReason: 'exp_first' | 'first_zero_raw_surplus' | 'first_acceptable_surplus' | 'row_surplus_bound' | 'exhausted' | 'inconclusive';
      rawSurplusTrend: 'not_checked' | 'flat' | 'nonincreasing' | 'nondecreasing' | 'mixed';
      samplesTruncated: boolean;
      samples: Array<{
        totalCandy: number;
        status: 'max_feasible' | 'feasible' | 'infeasible' | 'inconclusive';
        rawSurplus?: number;
        normalizedSurplus?: number;
        boundaryLevel?: number;
        boundaryExpInLevel?: number;
      }>;
    };
  };
};
