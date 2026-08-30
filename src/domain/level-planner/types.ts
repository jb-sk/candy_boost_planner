/**
 * LevelPlanner - 型定義
 *
 * レベルアップ計画に必要な全ての型を定義。
 * 入力（Request）、出力（Result）、内部状態（Working State）を明確に分離。
 */

import type { ExpType, ExpGainNature } from '../types';
import type { CandyFamilyKey } from '../pokesleep/candy-family';

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
  /** 種族アメ（CandyFamilyKey → 個数） */
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
  candyFamilyKey: CandyFamilyKey;
  type: PokemonType;
  totalCandy: number;
  boostCandy: number;
  normalCandy: number;
  shards: number;
  reachedLv: number;
  expInLevel: number;
  candyDemandMet: boolean;
  preferZeroSurplus?: boolean;
  /**
   * タイプアメ・万能アメを配ってよいか（既定 true）。
   * `false` の行は種族アメだけで需要を満たす（睡眠目標「アメ在庫＋睡眠」）。
   */
  itemsAllowed?: boolean;
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
  /**
   * 1つの solver context に許す相対時間。**context ごとに開始時刻から測り直される。**
   * prefix 二分探索のように context を何度も作る経路では、probe ごとに満額使えてしまうため、
   * 全体の上限を守りたいときは `deadlineAt` を併用すること。
   */
  deadlineMs?: number;
  /**
   * 全 context が共有する絶対締切（`performance.now()` 基準）。
   * probe をいくつ作っても、合計でこの時刻を超えて探索しない。
   */
  deadlineAt?: number;
  logPerformance?: boolean;
  /** 検索用の安全なゲート。指定時は各行の供給余りがこの値を超える行候補を除外する。 */
  maxRowSurplus?: number;
  /** 検索用の安全なゲート。指定時は全行合計の供給余りがこの値を超える状態を除外する。 */
  maxTotalSurplus?: number;
  /** 検索用の安全なゲート。指定時は目標到達行の余り合計がこの値を超える状態を除外する。 */
  maxReachedSurplus?: number;
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

// ============================================================
// 単一最適化パイプライン（fbl01）
// ============================================================

/**
 * 個数指定（行が使うアメ数の上限＝目標）の入力。個数はすべて価値換算アメ個数。
 *
 * **`boostedCandyUnits` は必須。** 省略可能にしていた頃は、未設定の入力だけが
 * 「かけら不足ならアメブを通常アメへ振り替える」経路へ落ちていた（実UIの `buildPlannerInput` は
 * 常に設定するので、テストだけがその経路を通っていた）。アメブ／通常アメの内訳を
 * 黙って変えないという規則を、型で守る。
 */
export type CandyTargetInput = {
  totalCandyUnits: number;
  boostedCandyUnits: number;
};

export type ItemCompareMode = 'surplusFirst' | 'surplusGateFirst' | 'legacyImproved';
export type SolverItemCompareMode = ItemCompareMode;

export type PlannerOptions = {
  itemCompareMode: SolverItemCompareMode;
};

export type PokemonPlanInput = {
  pokemonId: string;
  pokedexId: number;
  /** 種族アメの共有資源キー。pokedexIdを資源キーへ流用しない。 */
  candyFamilyKey: CandyFamilyKey;
  name: string;
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
  /**
   * タイプアメ・万能アメを配ってよいか（既定 true）。
   * `false` の行は種族アメだけで需要を満たす（睡眠目標「アメ在庫＋睡眠」）。
   * `boostAllowed` と同じく、行ごとに使える資源を絞るためのフラグ。
   */
  itemsAllowed?: boolean;
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
  /**
   * **需要充足**（その行が要求したアメ個数を配り終えたか）。個数指定があるときは `used >= totalCandyUnits`、
   * 無いときは目標到達と一致する。Lv70 の硬上限に当たった行も「もう配りようがない」ため true。
   *
   * 在庫配分・境界判定（`boundaryIndexForChoices` / feasibility の prefix）はこちらを使う。
   * **不足診断に使ってはいけない**（§11.3）。アメブ枠不足で通常アメへ置換された行は
   * 予定アメを配り切っても目標Lvへ届かないので、こちらは true のまま未達になる。
   */
  candyDemandMet: boolean;
  /**
   * **アメ到達**（アメが担当する到達点 `effectiveLevel + effectiveExp` へ届いたか）。
   *
   * `calcDiagnosis` の門番はこちら。睡眠EXPは含まない（睡眠は目標を手前へずらすだけで、
   * アメの担当区間が `effective*` として渡ってくる）。
   */
  effectiveTargetReached: boolean;
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
  /** 睡眠後の最終目標（§4.5.1）。line.level（アメを使い終えた地点）とは別物。 */
  targetLevel: number;
  targetExpInLevel: number;
  /** 予定アメ（個数指定、なければ目標到達に必要な最小数）を使い終えた地点。 */
  targetLine: PokemonPlanLine;
  reachableLine: PokemonPlanLine;
  /**
   * **需要充足**（`reachableLine.candyDemandMet`）。`role` の算出根拠と同じ意味で、境界判定と揃えてある。
   * 「目標Lvへ届いたか」は `reachableLine.effectiveTargetReached` を見ること（§11.3）。
   */
  candyDemandMet: boolean;
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

/**
 * 到達 prefix 探索1周ぶんの内訳。**探索量と探索結果を決定的に見張るための診断値。**
 *
 * 余りゲートの下では prefix の可解性が単調にならないため、二分探索のあとに
 * 上側を降順で確かめ直す（`fbl01d…設計書` §14.4.2）。このスキャンは最悪で `O(行数)` 回の
 * prefix 判定を追加するので、**実時間ではなくこの回数で上限を固定する。**
 */
export type PrefixSearchSummary = {
  solved: number;
  rejected: number;
  inconclusive: number;
  /** 上側スキャン（降順の確かめ直し）だけで走らせた probe 数。 */
  upperScanProbes: number;
  /**
   * その周の探索が返した**最大 feasible prefix 長**（`findPrefix` の返り値そのもの）。
   *
   * 最終到達数（`pokemonResults` から数えたもの）とは**別物**である。あいだに
   * 2周目への fallback（§14.4.3）・refine・フェーズ3（境界より下を残資源で育てる）が挟まり、
   * とくにフェーズ3は余りゲートの対象外なので**最終到達数のほうが大きくなりうる。**
   * 探索そのものの正しさを検証するテストは、最終到達数ではなくこの値と突き合わせる。
   */
  maxFeasiblePrefix: number;
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
    /**
     * 到達 prefix 探索の内訳。**最後に走った attempt の値**（fallback が発火すると2周目の値になる）。
     *
     * **1周目の探索を検証したいなら `prefixSearchAttempts[0]` を見ること。**
     * 上側スキャンは余りゲートがあるときだけ走るので、ゲートを外す2周目の `upperScanProbes` は
     * 常に 0 になる。ここだけを見ると、fallback が発火した入力については**上限を何も見張れない。**
     */
    prefixSearch?: PrefixSearchSummary;
    /**
     * attempt ごとの `prefixSearch`。**`[0]` が1周目（余りゲート内）、`[1]` があれば2周目（バランス）。**
     *
     * `surplusFirst` は2周構えなので（`fbl01d…設計書` §14.4.3）、周ごとに探索条件が違う。
     * `prefixSearch` は上書きされて最後の周しか残らないため、**周を特定して検証するテストはこちらを見る。**
     */
    prefixSearchAttempts?: PrefixSearchSummary[];
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
