import { computed, getCurrentScope, onScopeDispose, ref, toRaw, watch, type ComputedRef, type Ref } from "vue";
import type { Composer } from "vue-i18n";
import type { AppLocale } from "../i18n";
import { MAX_SLEEP_TEAM_SIZE, type BoostEvent, type ExpGainNature, type ExpType, type SleepSettings } from "../domain/types";
import { calcExp, calcExpAndCandy, calcExpAndCandyMixed, calcLevelByCandy } from "../domain/pokesleep";
import { minBoostForTarget } from "../domain/pokesleep/minBoostForTarget";
import { minCandyForTarget } from "../domain/pokesleep/minCandyForTarget";
import { attributeSleepBonusExpByNight, attributeSleepBonusExpForDays, calcSleepExpBreakdownForDays, calcSleepTimeForExp, isSleepPlan, markForSleep, sleepExpBonusMultiplier, type MarkForSleepResult, type SleepBonusContribution, type SleepNightContribution, type SleepPlanResult, type SleepTimeResult } from "../domain/pokesleep/sleep-growth";
import { detectTimeZone, findNextGameDateChange, gameDateFromWallClock, normalizeGameDate, normalizeTimeZone, resolveGameDate, type GameDate } from "../domain/pokesleep/game-date";
import type { EventMultiplierSegment } from "../domain/pokesleep/sleep-schedule";
import { wikiKnownThrough } from "../domain/pokesleep/_generated/sleep-exp-events";
import type { EventOccurrence, ProjectedEventOccurrence } from "../domain/pokesleep/projected-events";
import type { BlueSeedShift } from "../domain/pokesleep/growth-flower";
import type { SleepEventFixture } from "../domain/pokesleep/sleep-planning";
import { deriveTarget, normalizeTargetExpInLevel, targetFromCandy } from "../domain/level-planner/deriveTarget";
import { boostRules, defaultBoostKind, normalizeDefaultBoostReachLevel } from "../domain/pokesleep/boost-config";
import type { CalcRowV1, CalcSaveSlotV1 } from "../persistence/calc";
import { defaultSleepSettings, loadActiveSlot, loadCalcSlots, loadTotalShards, saveActiveSlot, saveCalcSlots, saveTotalShards, loadBoostCandyRemaining, saveBoostCandyRemaining, loadSleepSettings, saveSleepSettings, loadDefaultBoostReachLevel, saveDefaultBoostReachLevel } from "../persistence/calc";
import { deferPersistUntilReleased, schedulePersist } from "../persistence/deferredPersist";
import { cryptoRandomId } from "../persistence/box";
import { useCandyStore } from "./useCandyStore";
import { showToast } from "./useToast";
import { useSleepSchedulePlanning } from "./useSleepSchedulePlanning";
import { type CandyInventoryV2, type TypeCandyInventory, type UniversalCandyInventory } from "../persistence/candy";
import { getPokemonType } from "../domain/pokesleep/pokemon-names";
import { getCandyFamilyKey, normalizeSpeciesCandyByFamily } from "../domain/pokesleep/candy-family";
import { CANDY_VALUES } from "../domain/level-planner/constants";
import type { DebugExportContext, DebugExportSleepRow } from "../domain/level-planner/debugExport";
import { buildPlannerInput as buildLevelPlannerInput } from "../domain/level-planner/buildPlannerInput";
import type { CalculationMode, CalculationPolicy, ItemCompareMode, LevelPlannerInput, LevelPlannerResult, MixedCalculationMeta, PokemonPlanLine, PokemonPlanResult, StructuralProbeStatus } from "../domain/level-planner/types";
import { buildPlannerInputSignature, buildPlannerProbeSignature, buildPlannerStructureSignature } from "../domain/level-planner/signature";
import type { DeadlineExceededMeta, PlannerTuning } from "../domain/level-planner/types";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";
import { isPerfEnabled } from "../utils/perf";
export type CalcRow = CalcRowV1;

/** 目標計算へ触れず、睡眠目標の排他だけを回復する。 */
export function normalizeCalcRowStructure(row: CalcRow): CalcRow {
  if (row.sleepTargetMode === undefined || row.sleepTargetHours === undefined) return row;
  return { ...row, sleepTargetHours: undefined };
}

const PLAN_RESULT_PERF_ENABLED = isPerfEnabled();
const PLAN_RESULT_EXACT_VERIFICATION_ENABLED = PLAN_RESULT_PERF_ENABLED;

function debugGameDateOverride(): GameDate | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  return normalizeGameDate(new URLSearchParams(window.location.search).get("gameDate"));
}

/**
 * デバッグ用「現在日時」の置き場所はURL（`?perf=1&now=2026-08-28T13:19`）。
 *
 * リロードで消えると使いづらい一方、localStorage だと上書きしたまま忘れる事故が起きる。
 * URLなら `?perf=1` と同じ流儀で、上書き中であることがアドレスバーに出たままになる。
 */
const DEBUG_NOW_QUERY_KEY = "now";

/**
 * 手書きされうるので、ゲーム内日へ落とせない値は無かったことにする。
 * URLは「上書き中」の表示も兼ねているので、無効値はアドレスバーからも消す。
 */
function debugNowFromQuery(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  const raw = params.get(DEBUG_NOW_QUERY_KEY) ?? "";
  if (gameDateFromWallClock(raw)) return raw;
  // `?now=`（空値）も消す対象なので、値ではなくキーの有無で判定する。
  if (params.has(DEBUG_NOW_QUERY_KEY)) syncDebugNowQuery("");
  return "";
}

function syncDebugNowQuery(text: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (text) url.searchParams.set(DEBUG_NOW_QUERY_KEY, text);
  else url.searchParams.delete(DEBUG_NOW_QUERY_KEY);
  window.history.replaceState(null, "", url);
}

let plannerFallbackModulePromise: Promise<typeof import("../domain/level-planner/core/solveLevelPlan")> | null = null;
let debugExportModulePromise: Promise<typeof import("../domain/level-planner/debugExport")> | null = null;

function loadPlannerFallbackModule() {
  plannerFallbackModulePromise ??= import("../domain/level-planner/core/solveLevelPlan");
  return plannerFallbackModulePromise;
}

function loadDebugExportModule() {
  debugExportModulePromise ??= import("../domain/level-planner/debugExport");
  return debugExportModulePromise;
}

export type CalcRowView = CalcRow & {
  title: string;
  srcLevel: number;
  dstLevel: number;
  dstExpInLevel: number;
  expRemaining: number;
  /**
   * 目標Lvラベル横に出す「あとEXP」。
   * 個数指定も睡眠目標もない行は最小アメ投入時の実到達点（ceil の余剰EXP込み）から、
   * それ以外は保存された最終目標から算出する。planner の結果には依存しない。
   */
  targetExpToNextLevel: number;
  ui: {
    boostReachLevel: number;
    boostCandyInput: number;
    boostReachLevelMax: number;
    boostCandyInputMax: number;
    /**
     * 睡眠EXPまたは stock 在庫による上限が効いている（案内文を用意する条件）。
     * 上限ちょうどの行でも「これ以上上げられない」理由は要るので、押し下げの有無は問わない。
     */
    boostCapActive: boolean;
    /** 案内文を切り替えるための上限の由来。上限が効いていなければ null。 */
    boostCapKind: 'sleep' | 'stock' | null;
    /**
     * 睡眠EXPでアメブの担当範囲が押し下げられている状態（破線を出す条件）。
     * 動かせないのは押し下げられた範囲だけで、`boostReachLevelMax` 以下は操作できる。
     */
    boostSleepCapped: boolean;
    /** 睡眠EXPだけで目標に届き、アメブを1個も使えない状態。2欄とも入力欄を無効化する。 */
    boostInputDisabled: boolean;
    /**
     * 実効アメブ個数がグローバル枠を超えている行で、**その超過を直せる欄**。超過していなければ null。
     *
     * 個数が確定していればその値が原因なので `count`。未入力（導出モード）なら個数は
     * アメブ目標Lvから導かれた結果でしかないので `reach`。両方を赤くすると、
     * どちらを動かせば直るのか分からなくなる。
     *
     * **ソルバーの `shortage.boostCandyUnavailable` を待たず、ここで同期に判定する。**
     * planner は debounce されるため、打鍵に対して赤枠が1テンポ遅れる。
     */
    boostQuotaViolation: 'count' | 'reach' | null;
  };
};

export type CalcExportRow = {
  id: string;
  title: string;
  natureLabel: string;
  srcLevel: number;
  dstLevel: number;
  boostCandy: number;
  normalCandy: number;
  totalCandy: number;
  shards: number;
};

export type CalcExportTotals = { boostCandy: number; normalCandy: number; totalCandy: number; shards: number };

const PLAN_RESULT_DEBOUNCE_MS = 150;
const STRUCTURAL_PROBE_DEADLINE_MS = 2_000;
const AUTO_EXACT_SOFT_LIMIT_MS = 1_500;

type PlannerWorkerRequest = {
  slotId: string;
  requestId: number;
  lane: 'auto' | 'manualExact';
  inputSignature: string;
  input: LevelPlannerInput;
  calculationMode: CalculationMode;
  tuning?: Partial<PlannerTuning>;
  deadlineMs?: number;
  abortAfterExpansions?: number;
  mixedPrefixCount?: number;
  perfEnabled: boolean;
};

type PlannerWorkerResponse =
  | { kind: 'result'; slotId: string; requestId: number; lane: 'auto' | 'manualExact'; inputSignature: string; calculationMode: CalculationMode; result: LevelPlannerResult; durationMs: number; mixedMeta?: MixedCalculationMeta }
  | { kind: 'deadlineExceeded'; slotId: string; requestId: number; lane: 'auto' | 'manualExact'; inputSignature: string; calculationMode: 'exact'; meta: DeadlineExceededMeta; mixedResult: LevelPlannerResult; durationMs: number; mixedMeta: MixedCalculationMeta }
  | { kind: 'error'; slotId: string; requestId: number; lane: 'auto' | 'manualExact'; inputSignature: string; error: string };

export type DisplayedPlanResult = {
  result: LevelPlannerResult;
  slotId: string;
  inputSignature: string;
  calculationMode: CalculationMode;
  loss: boolean;
  durationMs: number;
  mixedPrefixCount?: number;
  mixedSource?: MixedCalculationMeta['source'];
};

export type CalculationPerformanceProfile = {
  policy: CalculationPolicy;
  structuralProbeStatus: StructuralProbeStatus;
  lastCalculationMode?: CalculationMode;
  lastExactDurationMs?: number;
  lastFastDurationMs?: number;
  lastStructuralProbeDurationMs?: number;
  lastDeadlineMs?: number;
  mixedPrefixCount?: number;
  lastInputSignature?: string;
  exactResultStale: boolean;
};

type DebugExportResult = "copied" | "downloaded" | "failed";

export type CalcBoxPlannerPatch = {
  boxId: string;
  level: number;
  expRemaining: number;
  sleepHours?: number;
};

/** 行の睡眠EXPボーナス内訳と、その内訳が何を数えたか。 */
export type RowSleepBonusBreakdown = {
  /** 種類別の内訳。**4晩以上だけ**。3晩以内は日別が内訳そのものになるので空。 */
  contributions: SleepBonusContribution[];
  /** 日付順の日別内訳。**3晩以内だけ**。4晩以上は日付列が長大になるので空。 */
  nights: SleepNightContribution[];
  /** `needed` の初日と最終日。仮イベント/花の表示を同じ期間へ揃える。 */
  neededFrom?: GameDate;
  neededTo?: GameDate;
};

type UndoField =
  | "rows"
  | "slots"
  | "activeSlotTab"
  | "totalShards"
  | "boostCandyRemaining"
  | "itemCompareMode"
  | "sleepSettings"
  | "defaultBoostReachLevel"
  | "candyInventory";
type UndoScope = readonly UndoField[];

type CalcUndoState = {
  rows?: CalcRow[];
  slots?: Array<CalcSaveSlotV1 | null>;
  activeSlotTab?: number;
  totalShards?: number;
  boostCandyRemaining?: number | null;
  itemCompareMode?: ItemCompareMode;
  sleepSettings?: SleepSettings;
  defaultBoostReachLevel?: number | null;
  candyInventory?: CandyInventoryV2;
};

type CalcUndoEntry = {
  scope: UndoScope;
  state: CalcUndoState;
  label: string;
  coalesceKey?: string;
  recordedAt: number;
  coalesceRevision: number;
};

export type CalcStore = {
  // core state
  boostKind: Readonly<Ref<BoostEvent>>;
  setSlotBoostKind: (kind: BoostEvent) => void;
  itemCompareMode: Ref<ItemCompareMode>;
  setItemCompareMode: (mode: ItemCompareMode) => void;
  totalShards: Ref<number>;
  totalShardsText: Ref<string>;
  boostCandyRemaining: Ref<number | null>;
  boostCandyRemainingText: Ref<string>;
  /** 既定のアメブ目標Lv（設定）。null は「目標Lvと同じ」。 */
  defaultBoostReachLevel: Ref<number | null>;
  /** 既定のアメブ目標Lvを設定する。**生入力を受け取る**（空欄・不正値は未設定へ倒す）。 */
  setDefaultBoostReachLevel: (v: unknown) => void;
  /** 全行のアメブ個数を破棄し、残数から配り直す（全体リセット）。 */
  resetAllBoostCandy: () => void;
  /** 睡眠・既定目標Lv・配分方針を既定値へ戻す。在庫・行・スロットは保持する。 */
  resetSettings: () => void;
  /** リセット対象の設定がすべて既定値なら true。 */
  isSettingsDefault: Readonly<Ref<boolean>>;
  boostCandyDefaultCap: Readonly<Ref<number>>;
  slots: Ref<Array<CalcSaveSlotV1 | null>>;
  rows: Ref<CalcRow[]>;
  activeRowId: Ref<string | null>;
  activeSlotTab: Ref<number>;
  getBackupSnapshot: () => {
    activeSlotIndex: 0 | 1 | 2;
    slots: [CalcSaveSlotV1 | null, CalcSaveSlotV1 | null, CalcSaveSlotV1 | null];
  };

  // 睡眠育成設定
  sleepSettings: Ref<SleepSettings>;
  updateSleepSettings: (patch: Partial<SleepSettings>) => void;
  currentGameDate: Readonly<Ref<GameDate>>;
  /** `?perf=1` のときだけ真。デバッグ用「現在日時」入力の表示ゲート。 */
  debugNowEnabled: boolean;
  /** デバッグ用「現在日時」の入力値（`datetime-local` の文字列。空＝実時刻）。 */
  debugNowText: Ref<string>;
  sleepCalculationError: Readonly<Ref<string | null>>;
  lunarCalendarStatus: Readonly<Ref<"idle" | "ready" | "error">>;

  // UI state
  exportOpen: Ref<boolean>;
  dragRowId: Ref<string | null>;
  dragOverRowId: Ref<string | null>;

  // computed
  fullLabel: Readonly<Ref<string>>;
  miniLabel: Readonly<Ref<string>>;
  noneLabel: Readonly<Ref<string>>;
  activeRow: Readonly<Ref<CalcRow | null>>;
  rowsView: Readonly<Ref<CalcRowView[]>>;

  exportRows: Readonly<Ref<CalcExportRow[]>>;
  exportActualTotals: Readonly<Ref<CalcExportTotals>>;
  debugExportEnabled: boolean;

  totalShardsUsed: Readonly<Ref<number>>;
  shardsCap: Readonly<Ref<number>>;
  shardsOver: Readonly<Ref<number>>;
  shardsUsagePctRounded: Readonly<Ref<number>>;
  shardsFillPctForBar: Readonly<Ref<number>>;
  shardsOverPctForBar: Readonly<Ref<number>>;
  showShardsFire: Readonly<Ref<boolean>>;

  totalBoostCandyUsed: Readonly<Ref<number>>;
  boostCandyCap: Readonly<Ref<number>>;
  boostCandyOver: Readonly<Ref<number>>;
  boostCandyUnused: Readonly<Ref<number>>;
  boostCandyShortageTotal: Readonly<Ref<number>>;
  boostCandyUsagePctRounded: Readonly<Ref<number>>;
  boostCandyFillPctForBar: Readonly<Ref<number>>;
  boostCandyOverPctForBar: Readonly<Ref<number>>;
  showBoostCandyFire: Readonly<Ref<boolean>>;

  // 選択中ポケモンの使用量（バー表示用）
  activeRowShardsUsed: Readonly<Ref<number>>;
  activeRowBoostCandyUsed: Readonly<Ref<number>>;
  activeRowShardsFillPct: Readonly<Ref<number>>;
  otherRowsShardsFillPct: Readonly<Ref<number>>;
  activeRowBoostCandyFillPct: Readonly<Ref<number>>;
  otherRowsBoostCandyFillPct: Readonly<Ref<number>>;
  activeRowShardsUsagePct: Readonly<Ref<number>>;
  activeRowBoostCandyUsagePct: Readonly<Ref<number>>;

  // candy allocation (new phase-based)
  planResult: Readonly<Ref<LevelPlannerResult | null>>;
  planResultPending: Readonly<Ref<boolean>>;
  displayedPlanResult: Readonly<Ref<DisplayedPlanResult | null>>;
  calculationPerformanceProfile: Readonly<Ref<CalculationPerformanceProfile>>;
  calculationPolicy: Readonly<Ref<CalculationPolicy>>;
  structuralProbeStatus: Readonly<Ref<StructuralProbeStatus>>;
  showFastCalculation: Readonly<Ref<boolean>>;
  showExactImprovementHint: Readonly<Ref<boolean>>;
  showManualExactVerification: Readonly<Ref<boolean>>;
  runManualExactVerification: () => void;
  /** rowId → 計画結果（テンプレートや一覧での O(1) 参照用） */
  pokemonResultByRowId: Readonly<Ref<Map<string, PokemonPlanResult>>>;
  getPokemonResult: (id: string) => PokemonPlanResult | null;
  getTheoreticalRow: (p: PokemonPlanResult) => PokemonPlanLine;
  universalCandyUsagePct: Readonly<Ref<number>>;
  universalCandyNeeded: Readonly<Ref<{ s: number; m: number; l: number; total: number }>>;
  universalCandyRanking: Readonly<Ref<Array<{
    id: string;
    pokemonName: string;
    universalValue: number;
    usagePct: number;
    uniSUsed: number;
    uniMUsed: number;
    uniLUsed: number;
    typeSUsed: number;
    typeMUsed: number;
  }>>>;
  universalCandyUsedTotal: Readonly<Ref<{ s: number; m: number; l: number }>>;

  canUndo: Readonly<Ref<boolean>>;
  canRedo: Readonly<Ref<boolean>>;

  // helpers / formatting
  fmtNum: (n: number) => string;
  formatSlotSavedAt: (iso: string | undefined | null) => string;

  // actions
  onTotalShardsInput: (v: string) => void;
  onBoostCandyRemainingInput: (v: string) => void;
  resetBoostCandyRemaining: () => void;
  updateUniversalCandy: (candy: Partial<UniversalCandyInventory>) => void;
  updateTypeCandy: (typeName: string, candy: Partial<TypeCandyInventory>) => void;
  updateSpeciesCandy: (pokedexId: number, count: number) => void;
  openExport: () => void;
  closeExport: () => void;
  buildDebugExportTsv: () => Promise<string>;
  copyDebugExportTsv: () => Promise<DebugExportResult>;

  beginUndo: (label: string) => void;
  undo: () => void;
  redo: () => void;

  clear: () => void;
  removeRowById: (id: string) => void;

  switchToSlot: (slotIndex: number) => void;
  swapSlots: (fromIndex: number, toIndex: number) => void;

  // slot clipboard (copy/paste)
  canCopySlot: Readonly<Ref<boolean>>;
  canPasteSlot: Readonly<Ref<boolean>>;
  copySlot: () => void;
  pasteSlot: () => void;

  // row UI: level / drag reorder
  nudgeDstLevel: (id: string, delta: number) => void;
  nudgeSrcLevel: (id: string, delta: number) => void;
  nudgeBoostLevel: (id: string, delta: number) => void;
  setDstLevel: (id: string, v: unknown) => void;
  setSrcLevel: (id: string, v: unknown) => void;
  setBoostLevel: (id: string, v: unknown) => void;

  onRowExpRemaining: (id: string, v: string) => void;
  setNature: (id: string, nature: ExpGainNature) => void;
  onRowCandyTarget: (id: string, v: string) => void;
  onRowBoostCandy: (id: string, v: string) => void;
  resetRowBoostCandy: (id: string) => void;

  moveRow: (fromId: string, toIndex: number) => void;
  moveRowUp: (id: string) => void;
  moveRowDown: (id: string) => void;
  canMoveRowUp: (id: string) => boolean;
  canMoveRowDown: (id: string) => boolean;
  // box bridge helpers (pure-ish)
  upsertFromBox: (opts: {
    boxId: string;
    srcLevel: number;
    expType: ExpType;
    nature: ExpGainNature;
    expRemaining?: number;
    sleepHours?: number;
    title?: string;
    dstLevelDefault?: number;
    pokedexId?: number;
    pokemonType?: string;
  }) => void;
  buildPlannerPatchFromRow: (rowId?: string) => CalcBoxPlannerPatch | null;
  setRowSleepHours: (rowId: string, sleepHours: number | undefined) => void;
  setRowSleepTarget: (rowId: string, target: number | "all" | "stock" | undefined) => void;
  /** 「アメ在庫＋睡眠」の行が使うアメ数。それ以外の行では undefined。 */
  rowStockCandyTargetFor: (rowId: string) => number | undefined;
  /** 上位行の取り分を除いた、この stock 行が使える種族アメ在庫。 */
  rowStockCandyAvailableFor: (rowId: string) => number | undefined;
  setRowSleepTargetHours: (rowId: string, hours: number | undefined) => void;
  rowSleepExpFor: (rowId: string) => number;
  rowSleepRemainingHoursFor: (rowId: string) => number;
  /** 行の計画で使う成長のお香の個数（＝お香を使う睡眠日数）。睡眠目標が無い行は 0。 */
  rowGrowthIncenseCountFor: (rowId: string) => number;
  /** 行の計画期間に効いた睡眠EXPボーナスの内訳。睡眠計画の無い行は空。 */
  rowSleepBonusBreakdownFor: (rowId: string) => RowSleepBonusBreakdown;
  /**
   * 全行共有のイベント区間（一覧表示用）。**行の計画期間での絞り込みはUI側**
   * （`buildEventChipList`）で行う。内訳と同じ `needed` 期間を1か所から渡すため。
   */
  realOccurrences: ComputedRef<readonly EventOccurrence[]>;
  projectedOccurrences: ComputedRef<readonly ProjectedEventOccurrence[]>;
  /** 全行共有のあおいタネ区間。UIは再計算せずこの値を使う。 */
  blueSeedSegments: ComputedRef<readonly EventMultiplierSegment[]>;
  /** 全行共有のあおいタネずらし情報。行期間による絞り込みはUI側で行う。 */
  blueSeedShifts: ComputedRef<readonly BlueSeedShift[]>;
  /** 睡眠チーム（1晩5匹）に収まらない行か。6匹目以降の睡眠計画で true。 */
  rowExceedsSleepTeamLimit: (rowId: string) => boolean;
  calcSleepTimeForRow: (rowId: string, expToTarget: number) => SleepTimeResult;
};

export function useCalcStore(opts: {
  locale: Ref<AppLocale>;
  t: Composer["t"];
  resolveTitleByBoxId?: (boxId: string) => string | null;
  resolvePokedexIdByBoxId?: (boxId: string) => number | undefined;
  /** テストで生成物に依存しない睡眠イベント入力を流し込む。通常は未指定。 */
  sleepEventFixture?: SleepEventFixture;
  /** テストで睡眠計画の開始日を固定する。通常は未指定。 */
  currentGameDate?: GameDate;
}): CalcStore {
  const { locale, t, resolveTitleByBoxId, resolvePokedexIdByBoxId } = opts;

  function fmtNum(n: number): string {
    return new Intl.NumberFormat(locale.value).format(n);
  }


  const slots = ref<Array<CalcSaveSlotV1 | null>>(loadCalcSlots().map(slot => slot ? { ...slot, slotId: slot.slotId ?? cryptoRandomId() } : null));

  const activeSlotTab = ref<number>(loadActiveSlot());

  // 現在のスロットからデータを読み込む（cloneCalcRowsがまだ定義されていないのでlegacyの方法で）
  const slot0 = slots.value[activeSlotTab.value];

  // boostKind: スロットから取得（読み取り専用computed）
  const boostKind = computed<BoostEvent>(() => {
    const slot = slots.value[activeSlotTab.value];
    return slot?.boostKind ?? defaultBoostKind;
  });
  const itemCompareMode = ref<ItemCompareMode>(slot0?.itemCompareMode ?? "surplusFirst");
  function setItemCompareMode(mode: ItemCompareMode) {
    if (itemCompareMode.value === mode) return;
    beginUndo(t("settings.itemCompareModeLabel"), ["itemCompareMode"]);
    itemCompareMode.value = mode;
  }

  const totalShards = ref<number>(loadTotalShards());
  const totalShardsText = ref<string>("");
  // アメブ残数（nullの場合はboostKindによる上限を使用）
  const initialBoostCandyRemaining =
    slot0?.boostCandyRemaining !== undefined ? slot0.boostCandyRemaining ?? null : loadBoostCandyRemaining();
  const boostCandyRemaining = ref<number | null>(initialBoostCandyRemaining);
  const boostCandyRemainingText = ref<string>("");

  /**
   * 既定のアメブ目標Lv（設定モーダル）。`null` は「目標Lvと同じ」。
   *
   * ポケモン追加・行リセット・全体リセットで、各行の `boostReachLevel` の初期値になる。
   * 既存行は書き換えない（リセット操作を通したときだけ効く）。
   */
  const defaultBoostReachLevel = ref<number | null>(loadDefaultBoostReachLevel());

  // 睡眠育成設定
  const sleepSettings = ref<SleepSettings>(loadSleepSettings());
  function settingsResetValues(): SleepSettings {
    return { ...defaultSleepSettings(), timeZone: detectTimeZone() };
  }
  function settingsMatchResetValues(nextSettings: SleepSettings): boolean {
    return JSON.stringify(sleepSettings.value) === JSON.stringify(nextSettings)
      && defaultBoostReachLevel.value === null
      && itemCompareMode.value === "surplusFirst";
  }
  const isSettingsDefault = computed(() => settingsMatchResetValues(settingsResetValues()));
  const fixedGameDate = debugGameDateOverride();
  /**
   * `?perf=1` のときだけ出すデバッグ用「現在日時」（`datetime-local` の文字列。空＝実時刻）。
   *
   * 睡眠EXPのボーナスは日によって変わるので、満月日やイベント期間へ時計を進めて内訳を
   * 確かめるためのスイッチ。値は瞬間ではなく**ゲーム内タイムゾーンの壁時計**として読む
   * （端末ゾーンと設定ゾーンの差で日付がずれない）。AM4:00 の日境界はそのまま効く。
   */
  const debugNowEnabled = PLAN_RESULT_PERF_ENABLED;
  const debugNowText = ref<string>(debugNowEnabled ? debugNowFromQuery() : "");
  const debugGameDate = computed<GameDate | null>(() => gameDateFromWallClock(debugNowText.value));
  function effectiveTimeZone(): string {
    return normalizeTimeZone(sleepSettings.value.timeZone) ?? detectTimeZone();
  }
  /** 現在のゲーム内日。デバッグ日時 ＞ `?gameDate=` の固定日 ＞ 実時刻。 */
  function resolveCurrentGameDate(): GameDate {
    return debugGameDate.value ?? fixedGameDate ?? opts.currentGameDate ?? resolveGameDate(new Date(), effectiveTimeZone());
  }
  const currentGameDate = ref<GameDate>(resolveCurrentGameDate());
  /** グローバル睡眠設定の変更。個数指定があるときは最終目標を新しい睡眠EXPで引き直す。 */
  function updateSleepSettings(patch: Partial<SleepSettings>) {
    const patchTimeZone = patch.timeZone === undefined ? undefined : normalizeTimeZone(patch.timeZone);
    const { timeZone: _ignoredTimeZone, ...patchWithoutTimeZone } = patch;
    const merged = {
      ...sleepSettings.value,
      ...patchWithoutTimeZone,
      ...(patchTimeZone ? { timeZone: patchTimeZone } : {}),
    };
    const normalizedTimeZone = normalizeTimeZone(merged.timeZone);
    // ユーザーが今入力した不正値は保存しない。既存保存値だけが壊れている場合は、
    // 無関係な設定変更まで捨てず、実行環境の有効な IANA ゾーンへ自己修復する。
    const timeZone = normalizedTimeZone ?? detectTimeZone();
    const nextSettings: SleepSettings = { ...merged, timeZone };
    if (JSON.stringify(nextSettings) === JSON.stringify(sleepSettings.value)) return;
    beginUndo(t("settings.sleepTitle"), ["sleepSettings", "rows"]);
    sleepSettings.value = nextSettings;
    applySleepSettingsEffects();
  }

  function applySleepSettingsEffects() {
    currentGameDate.value = resolveCurrentGameDate();
    clearSleepCalculationErrors();
    rows.value = rows.value.map(row =>
      row.candyTarget === undefined ? row : normalizeRowState(row)
    );
  }

  // sleepSettings の自動保存
  watch(sleepSettings, (v) => saveSleepSettings(v), { deep: true });

  // アメ在庫。実効アメブ個数の解決（`resolveEffectiveBoostCandy`）が種族アメを読むので、
  // 行より先に用意しておく。
  const candyStore = useCandyStore();

  const rows = ref<CalcRow[]>(
    slot0?.rows
      ? (JSON.parse(JSON.stringify(slot0.rows)) as CalcRow[]).map(normalizeCalcRowStructure)
      : [],
  );

  const {
    sleepSchedule,
    realOccurrences,
    projectedOccurrences,
    blueSeedSegments,
    blueSeedShifts,
    sleepCalculationError,
    lunarCalendarStatus,
    recordSleepCalculationError,
    clearSleepCalculationErrors,
  } = useSleepSchedulePlanning({
    sleepSettings,
    currentGameDate,
    effectiveTimeZone,
    hasRows: () => rows.value.length > 0,
    sleepEventFixture: opts.sleepEventFixture,
  });

  const activeRowId = ref<string | null>(slot0?.activeRowId ?? rows.value[0]?.id ?? null);

  let gameDateTimer: ReturnType<typeof setTimeout> | null = null;
  const lifecycleScope = getCurrentScope();

  function refreshGameDate(): void {
    const next = resolveCurrentGameDate();
    if (next === currentGameDate.value) return;
    currentGameDate.value = next;
    clearSleepCalculationErrors();
    // 個数指定行の T = 個数到達点 + S を保つ。時計更新なのでundoには積まない。
    rows.value = rows.value.map(row =>
      row.candyTarget === undefined ? row : normalizeRowState(row)
    );
  }

  function armGameDateTimer(): void {
    if (gameDateTimer) clearTimeout(gameDateTimer);
    gameDateTimer = null;
    if (
      !lifecycleScope
      || fixedGameDate
      || debugGameDate.value
      || import.meta.env.MODE === "test"
      || typeof window === "undefined"
    ) return;
    const now = new Date();
    let next: Date;
    try {
      next = findNextGameDateChange(now, effectiveTimeZone());
    } catch {
      // 可視化復帰または次の有効な設定変更で再試行する。
      return;
    }
    const delay = Math.max(1, next.getTime() - now.getTime() + 50);
    gameDateTimer = setTimeout(() => {
      try {
        refreshGameDate();
      } finally {
        // 早発・遅発やDSTの一時的な逆行を含め、発火後は必ず次を予約する。
        armGameDateTimer();
      }
    }, delay);
  }

  // 上書き中はタイマーを止め、解除したら実時刻の日付変更を拾い直す。時計操作なのでundoには積まない。
  watch(debugNowText, text => {
    syncDebugNowQuery(text);
    refreshGameDate();
    armGameDateTimer();
  });

  function onVisibilityChange(): void {
    if (typeof document === "undefined" || document.visibilityState !== "visible") return;
    refreshGameDate();
    armGameDateTimer();
  }

  watch(() => sleepSettings.value.timeZone, () => {
    const timeZone = effectiveTimeZone();
    if (sleepSettings.value.timeZone !== timeZone) {
      sleepSettings.value = { ...sleepSettings.value, timeZone };
    }
    refreshGameDate();
    armGameDateTimer();
  });
  if (lifecycleScope) {
    if (typeof document !== "undefined" && import.meta.env.MODE !== "test") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    armGameDateTimer();
    onScopeDispose(() => {
      if (gameDateTimer) clearTimeout(gameDateTimer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibilityChange);
    });
  }

  function clampNonNegInt(n: unknown): number {
    return Math.max(0, Math.floor(Number(n) || 0));
  }

  function onTotalShardsInput(v: string) {
    const digits = String(v ?? "").replace(/[^\d]/g, "");
    const n = clampNonNegInt(digits);
    if (totalShards.value === n) return;
    beginUndo(t("calc.maxShardsLabel"), ["totalShards"], { coalesceKey: "totalShards" });
    totalShards.value = n;
    totalShardsText.value = fmtNum(n);
  }

  function onBoostCandyRemainingInput(v: string) {
    const digits = String(v ?? "").replace(/[^\d]/g, "");
    const next = digits === "" ? null : clampNonNegInt(digits);
    if (boostCandyRemaining.value === next) return;
    beginUndo(t("calc.boostRemainingLabel"), ["boostCandyRemaining"], {
      coalesceKey: "boostCandyRemaining",
    });
    if (digits === "") {
      boostCandyRemaining.value = null;
      boostCandyRemainingText.value = "";
    } else {
      const n = clampNonNegInt(digits);
      boostCandyRemaining.value = n;
      boostCandyRemainingText.value = fmtNum(n);
    }
  }

  /**
   * 行の初期アメブ目標Lv。既定値（設定）を、その行で意味を持つ範囲へ収める。
   *
   * 目標Lvを超えても意味がなく、睡眠EXPが賄う範囲（T'）も超えられない。
   * 元Lvを下回る既定値はアメブ0本を意味する。
   *
   * **⚠ 個数指定があるときは収めない**（§15.9）。目標Lvも `T'` も `(m, n)` の出力で、
   * アメブ種別を変えると動く（`none` では全部通常アメ、`mini` では枠不足で確定した個数）。
   * 収める先に使うと、種別を戻したときに低いアメブ目標Lvが焼き付く
   * （実測: `full→none→full` でアメブ目標Lv 70 → 59 / 実効アメブ 1351 → 673）。
   * 実効アメブは `resolveEffectiveBoostCandy` が個数指定でクランプし、画面には
   * `min(保存値, 目標Lv, T')` を出す（§10.18）ので、ここで収めなくても過大にならない。
   */
  function initialBoostReachLevelFor(r: CalcRow): number {
    const cap = r.candyTarget !== undefined
      ? MAX_LEVEL
      : Math.min(r.dstLevel, boostReachLevelCapFor(r));
    const preferred = defaultBoostReachLevel.value ?? cap;
    return clampInt(Math.min(preferred, cap), r.srcLevel, MAX_LEVEL, r.srcLevel);
  }

  /**
   * グローバル残数を上から順に割り当て、足りない行だけアメブ個数を確定させる。
   *
   * | その行に回る残枠 | 保存する `boostOrExpAdjustment` |
   * |---|---|
   * | 必要数以上 | `undefined`（アメブ目標Lvからの導出のまま） |
   * | 1〜必要数未満 | 残枠（＝**アメブ境界**の行）。**アメブ目標Lvもその到達点へ下げる** |
   * | 0 | 0。同上（アメブ目標Lv＝元Lv） |
   *
   * **導出のままにするのは満額もらえる行だけ。** 足りない行まで導出のままにすると、
   * アメブ目標Lvの表示（例: Lv60）と実際の投入数（残枠ぶん）が食い違い、
   * ユーザーには目標Lvの表示が壊れているように見える。旧仕様も個数を入れていた。
   *
   * **個数を確定させた行はアメブ目標Lvも一緒に保存する。** 表示だけ逆算して保存値を
   * 残すと、あとで個数が捨てられたとき（元Lv変更など）に古い目標Lvから導出し直して
   * 枠を大きく超える値が復活する（実測: 確定350 → 睡眠目標を設定した瞬間 807）。
   *
   * ここで確定した値は**ユーザーの意図として保存される**ので、以後は上位行を削っても
   * 自動では増えない。増やしたいときはリセットボタンでもう一度割り当て直す。
   *
   * **この関数は `rows` を書き換えない。** 割り当て後の行を返すだけで、代入するのは
   * `applyBoostCandyQuota` / `commitRowWithQuota` の仕事。undo を積むかも呼び出し側が決める。
   *
   * ただし**純粋関数ではない**。上限・アメブ種別・睡眠設定はストアの現在値を読む。
   * 入力は `source` だけではないので、テストではストアごと組み立てること。
   *
   * @param rowId 指定するとその行だけ割り当て直す。他の行は現在の使用量のまま数える
   * @param resetReachLevel アメブ目標Lvを既定値へ戻してから配るか。リセット操作では true、
   *   「条件が変わったので個数だけ引き直す」場面（元Lv変更）では false
   */
  function allocateBoostCandyFromQuota(
    source: readonly CalcRow[],
    { rowId, resetReachLevel = true }: { rowId?: string; resetReachLevel?: boolean } = {},
  ): CalcRow[] {
    let remaining = autoBoostCandyCap();
    return source.map((row) => {
      if (rowId !== undefined && row.id !== rowId) {
        remaining = Math.max(0, remaining - resolveEffectiveBoostCandy(row));
        return row;
      }
      const reset: CalcRow = {
        ...row,
        boostOrExpAdjustment: undefined,
        boostReachLevel: resetReachLevel ? initialBoostReachLevelFor(row) : row.boostReachLevel,
      };
      // 「すべて睡眠」の行とアメブなしの種別は、枠の付与も消費も 0。
      // 個数は導出（＝0）のままにして明示的な 0 を焼き付けないが、
      // **アメブ目標Lvはこちらでも既定値へ戻す**（仕様書 §4.9。ここだけ外れていた）
      if (row.sleepTargetMode === "all" || boostKind.value === "none") return normalizeRowState(reset);
      const need = resolveEffectiveBoostCandy(reset);
      const granted = Math.min(need, remaining);
      remaining = Math.max(0, remaining - granted);
      if (granted >= need) return normalizeRowState(reset);
      return normalizeRowState({
        ...reset,
        boostOrExpAdjustment: granted,
        boostReachLevel: boostReachLevelForCandy(reset, granted),
      });
    });
  }

  /** 割り当て結果を行へ反映する唯一の入口。 */
  function applyBoostCandyQuota(options: { rowId?: string; resetReachLevel?: boolean } = {}): void {
    rows.value = allocateBoostCandyFromQuota(rows.value, options);
  }

  /**
   * 行へパッチを当ててから、その行のアメブを残枠から配り直す。**`rows` への代入は1回だけ。**
   *
   * `commitRow` → `applyBoostCandyQuota` と2段で書くと、パッチ済みだがアメブが未調整の
   * 中間状態が一度 `rows` に載る。永続化・planner・今後の同期購読者がそれを観測しうるうえ、
   * 呼び出し側が「2段目を呼ぶ」ことを毎回覚えておく必要がある。
   */
  function commitRowWithQuota(
    id: string,
    patch: Partial<CalcRow>,
    label: string,
    options: { resetReachLevel?: boolean } = {},
  ): void {
    if (!rows.value.some((x) => x.id === id)) return;
    const patched = rows.value.map((x) => (x.id === id ? normalizeRowState({ ...x, ...patch }) : x));
    commitRows(
      allocateBoostCandyFromQuota(patched, { rowId: id, ...options }),
      label,
    );
  }

  /** アメブ n 個を投入し終えたときの到達Lv。確定した個数に目標Lvを合わせるために使う。 */
  function boostReachLevelForCandy(r: CalcRow, candy: number): number {
    if (candy <= 0) return r.srcLevel;
    const reached = calcLevelByCandy({
      srcLevel: r.srcLevel, dstLevel: MAX_LEVEL, expType: r.expType, nature: r.nature,
      boost: boostKind.value, candy, expGot: rowExpGot(r),
    }).level;
    return clampInt(reached, r.srcLevel, MAX_LEVEL, r.srcLevel);
  }

  /**
   * アメブ種別変更時の割り当て直し。
   * 種別で1個あたりのEXPが変わるため明示値も導出値も持ち越さず、残数から配り直す。
   * **アメブ目標Lvも既定値へ戻す**（仕様書 §4.9）。持ち越すのは個数指定だけで、
   * そこから新しい種別で引き直すので、`none` 経由でも `mini` 経由でも同じ地点へ収束する（§15.9）。
   */
  function recalculateAllRows() {
    applyBoostCandyQuota();
  }

  /**
   * 全体リセット。並べ替え・上位削除のあと「最初から考え直す」ための入口。
   * 各行に保存されたアメブ個数の意図を破棄し、残数から配り直す。
   *
   * **全行の手入力を捨てるので undo を積む。** 種別変更経由の `recalculateAllRows` とは
   * ここが違う（あちらは `setSlotBoostKind` が入口で、種別そのものが戻せないと意味がない）。
   */
  function resetAllBoostCandy() {
    if (!rows.value.length) return;
    const next = allocateBoostCandyFromQuota(rows.value);
    commitRows(next, t("calc.reassignBoost"));
  }

  function resetSettings() {
    const nextSettings = settingsResetValues();
    if (settingsMatchResetValues(nextSettings)) return;
    beginUndo(t("settings.resetUndoLabel"), [
      "sleepSettings",
      "defaultBoostReachLevel",
      "itemCompareMode",
      "rows",
    ]);
    sleepSettings.value = nextSettings;
    defaultBoostReachLevel.value = null;
    itemCompareMode.value = "surplusFirst";
    applySleepSettingsEffects();
  }

  /** 既定のアメブ目標Lv（設定）。`null` は「目標Lvと同じ」。既存行は書き換えない。 */
  function setDefaultBoostReachLevel(v: unknown) {
    // **生入力を受け取る境界はここ。** 呼び出し側で正規化してから渡さない（二重適用になる）。
    // Lv として意味を持たない入力（空欄・0・負数・数値でない）は「未設定＝目標Lvと同じ」へ倒す。
    const next = normalizeDefaultBoostReachLevel(v);
    if (defaultBoostReachLevel.value === next) return;
    beginUndo(t("settings.defaultBoostReachLevelLabel"), ["defaultBoostReachLevel"]);
    defaultBoostReachLevel.value = next;
  }

  function resetBoostCandyRemaining() {
    if (boostCandyRemaining.value === null) return;
    beginUndo(t("calc.boostRemainingLabel"), ["boostCandyRemaining"]);
    boostCandyRemaining.value = null;
    boostCandyRemainingText.value = "";
  }

  watch(
    totalShards,
    (n) => {
      const nn = clampNonNegInt(n);
      const s = fmtNum(nn);
      if (totalShardsText.value !== s) totalShardsText.value = s;
    },
    { immediate: true }
  );

  // boostCandyRemainingのテキスト更新
  watch(
    boostCandyRemaining,
    (n) => {
      if (n === null) {
        boostCandyRemainingText.value = "";
      } else {
        const s = fmtNum(n);
        if (boostCandyRemainingText.value !== s) boostCandyRemainingText.value = s;
      }
    },
    { immediate: true }
  );

  // setSlotBoostKind: 現在のスロットのアメブ種別を変更
  // watch(boostKind) の代わりに明示的に呼び出す
  function setSlotBoostKind(newKind: BoostEvent) {
    const i = activeSlotTab.value;
    const currentSlot = slots.value[i];
    if (!currentSlot) {
      beginUndo(t("calc.boostKindLabel"), ["slots"]);
      // 空のスロットの場合は新規作成
      const newSlot: CalcSaveSlotV1 = {
        slotId: cryptoRandomId(),
        savedAt: new Date().toISOString(),
        rows: [],
        activeRowId: null,
        boostKind: newKind,
        itemCompareMode: itemCompareMode.value,
      };
      slots.value = slots.value.map((x, idx) => (idx === i ? newSlot : x));
      return;
    }

    if (currentSlot.boostKind === newKind) return;
    beginUndo(t("calc.boostKindLabel"), ["slots", "boostCandyRemaining", "rows"]);

    // boostKind を変更
    const updatedSlot = { ...currentSlot, boostKind: newKind };
    slots.value = slots.value.map((x, idx) => (idx === i ? updatedSlot : x));

    // boostCandyRemaining をリセット
    boostCandyRemaining.value = null;
    boostCandyRemainingText.value = "";

    recalculateAllRows();
  }

  const fullLabel = computed(() =>
    t("calc.boostKindFull", {
      shards: boostRules.full.shardMultiplier,
      exp: boostRules.full.expMultiplier,
    })
  );
  const miniLabel = computed(() =>
    t("calc.boostKindMini", {
      shards: boostRules.mini.shardMultiplier,
      exp: boostRules.mini.expMultiplier,
    })
  );
  const noneLabel = computed(() =>
    t("calc.boostKindNone", {
      shards: boostRules.none.shardMultiplier,
      exp: boostRules.none.expMultiplier,
    })
  );

  function cloneCalcRows(entries: CalcRow[]): CalcRow[] {
    const raw = toRaw(entries);
    return (JSON.parse(JSON.stringify(raw)) as CalcRow[]).map(normalizeCalcRowStructure);
  }
  function cloneCalcSlots(v: Array<CalcSaveSlotV1 | null>): Array<CalcSaveSlotV1 | null> {
    const raw = toRaw(v);
    return JSON.parse(JSON.stringify(raw)) as Array<CalcSaveSlotV1 | null>;
  }

  // 現在のスロットにデータを保存
  function saveToCurrentSlot() {
    const i = activeSlotTab.value;
    const now = new Date().toISOString();
    const slot: CalcSaveSlotV1 = {
      slotId: slots.value[i]?.slotId ?? cryptoRandomId(),
      savedAt: now,
      rows: cloneCalcRows(rows.value),
      activeRowId: activeRowId.value,
      boostKind: boostKind.value,  // 保存時の boostKind を記録
      boostCandyRemaining: boostCandyRemaining.value,  // スロットごとに保存
      itemCompareMode: itemCompareMode.value,
    };
    slots.value = slots.value.map((x, idx) => (idx === i ? slot : x));
  }

  function getBackupSnapshot() {
    const snapshot = cloneCalcSlots(slots.value);
    const index = activeSlotTab.value === 1 || activeSlotTab.value === 2 ? activeSlotTab.value : 0;
    const current = snapshot[index];
    const isEmptyDefault = !current
      && rows.value.length === 0
      && boostCandyRemaining.value === null
      && itemCompareMode.value === "surplusFirst"
      && boostKind.value === defaultBoostKind;
    snapshot[index] = isEmptyDefault
      ? null
      : {
          slotId: current?.slotId ?? cryptoRandomId(),
          savedAt: current?.savedAt ?? new Date().toISOString(),
          rows: cloneCalcRows(rows.value),
          activeRowId: activeRowId.value,
          boostKind: boostKind.value,
          boostCandyRemaining: boostCandyRemaining.value,
          itemCompareMode: itemCompareMode.value,
        };
    while (snapshot.length < 3) snapshot.push(null);
    return {
      activeSlotIndex: index as 0 | 1 | 2,
      slots: snapshot.slice(0, 3) as [CalcSaveSlotV1 | null, CalcSaveSlotV1 | null, CalcSaveSlotV1 | null],
    };
  }

  // スロット切り替え時の処理（データを切り替え）
  // 各スロットは独自の boostKind を持つため、再計算は不要
  function switchToSlot(newSlotIndex: number) {
    if (newSlotIndex === activeSlotTab.value) return;

    // 現在のスロットに保存
    saveToCurrentSlot();

    // 新しいスロットに切り替え
    activeSlotTab.value = newSlotIndex;
    saveActiveSlot(newSlotIndex);

    // 新しいスロットからデータを読み込み
    const slot = slots.value[newSlotIndex];
    if (slot) {
      rows.value = (JSON.parse(JSON.stringify(slot.rows)) as CalcRow[]).map(normalizeCalcRowStructure);
      activeRowId.value = slot.activeRowId ?? rows.value[0]?.id ?? null;
      // スロットから boostCandyRemaining を復元（未設定の場合は null = デフォルト値使用）
      boostCandyRemaining.value = slot.boostCandyRemaining ?? null;
      itemCompareMode.value = slot.itemCompareMode ?? "surplusFirst";
    } else {
      rows.value = [];
      activeRowId.value = null;
      // 空スロットは null（デフォルト値を使用）
      boostCandyRemaining.value = null;
      itemCompareMode.value = "surplusFirst";
    }

    // undo/redoスタックをクリア
    undoStack.value = [];
    redoStack.value = [];
    undoCoalesceRevision += 1;
  }

  // スロットの位置を入れ替え（タブドラッグ用）
  function swapSlots(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex > 2 || toIndex < 0 || toIndex > 2) return;

    // 現在のスロットに保存
    saveToCurrentSlot();
    beginUndo(t("calc.undoLabel.slotOrder"), ["slots", "activeSlotTab"]);

    // slots配列を入れ替え
    const newSlots = [...slots.value];
    const tmp = newSlots[fromIndex];
    newSlots[fromIndex] = newSlots[toIndex];
    newSlots[toIndex] = tmp;
    slots.value = newSlots;

    // activeSlotTab を追従（アクティブなスロットが移動した場合）
    if (activeSlotTab.value === fromIndex) {
      activeSlotTab.value = toIndex;
      saveActiveSlot(toIndex);
    } else if (activeSlotTab.value === toIndex) {
      activeSlotTab.value = fromIndex;
      saveActiveSlot(fromIndex);
    }
  }

  // ===== スロットのコピー / ペースト =====
  // クリップボードはメモリ内のみ（リロードで消える）
  const slotClipboard = ref<CalcSaveSlotV1 | null>(null);
  const canCopySlot = computed(() => rows.value.length > 0);
  const canPasteSlot = computed(() => slotClipboard.value !== null);

  // 現在アクティブなスロットの内容をクリップボードへコピー（状態は変更しないのでundo対象外）
  function copySlot() {
    if (rows.value.length === 0) return;
    slotClipboard.value = {
      slotId: cryptoRandomId(),
      savedAt: new Date().toISOString(),
      rows: cloneCalcRows(rows.value),
      activeRowId: activeRowId.value,
      boostKind: boostKind.value,
      boostCandyRemaining: boostCandyRemaining.value,
      itemCompareMode: itemCompareMode.value,
    };
  }

  // クリップボードの内容を現在アクティブなスロットへ貼り付け（丸ごと上書き・undo対象）
  function pasteSlot() {
    const clip = slotClipboard.value;
    if (!clip) return;
    beginUndo(t("calc.pasteSlot"), ["rows", "slots", "boostCandyRemaining", "itemCompareMode"]);

    const i = activeSlotTab.value;
    const pastedRows = cloneCalcRows(clip.rows);
    const newActiveRowId =
      clip.activeRowId && pastedRows.some((r) => r.id === clip.activeRowId)
        ? clip.activeRowId
        : pastedRows[0]?.id ?? null;
    const pastedBoostCandyRemaining = clip.boostCandyRemaining ?? null;
    const pastedItemCompareMode = clip.itemCompareMode ?? "surplusFirst";

    // スロット（boostKind の真実のソース）を更新
    const newSlot: CalcSaveSlotV1 = {
      slotId: slots.value[i]?.slotId ?? cryptoRandomId(),
      savedAt: new Date().toISOString(),
      rows: pastedRows,
      activeRowId: newActiveRowId,
      boostKind: clip.boostKind,
      boostCandyRemaining: pastedBoostCandyRemaining,
      itemCompareMode: pastedItemCompareMode,
    };
    slots.value = slots.value.map((x, idx) => (idx === i ? newSlot : x));

    // ライブ状態へ反映（boostKind は slots から算出される computed のため設定不要）
    rows.value = cloneCalcRows(pastedRows);
    activeRowId.value = newActiveRowId;
    boostCandyRemaining.value = pastedBoostCandyRemaining;
    itemCompareMode.value = pastedItemCompareMode;
  }


  // データ変更時に現在のスロットに自動保存
  watch([rows, activeRowId], () => saveToCurrentSlot(), { deep: true });
  // slots の全更新経路は新しい配列を代入する。行変更のたびに複製済みの
  // 全スロットを再度 deep traversal せず、配列置換だけで永続化を予約する。
  watch(slots, () => schedulePersist("calcSlots", () => saveCalcSlots(slots.value)));
  // 設定値の自動保存
  watch(totalShards, (v) => saveTotalShards(v));
  watch(boostCandyRemaining, (v) => saveBoostCandyRemaining(v));
  watch(defaultBoostReachLevel, (v) => saveDefaultBoostReachLevel(v));
  watch(itemCompareMode, () => saveToCurrentSlot());

  watch(
    () => rows.value.map((row) => row.id).join("\u0000"),
    () => {
      const id = activeRowId.value;
      if (!id) {
        activeRowId.value = rows.value[0]?.id ?? null;
        return;
      }
      if (!rows.value.some((x) => x.id === id)) {
        activeRowId.value = rows.value[0]?.id ?? null;
      }
    }
  );

  const activeRow = computed(() => rows.value.find((x) => x.id === activeRowId.value) ?? null);

  // 行の値やグローバル在庫まで undo 対象を広げていく前提の本数。
  // スナップショットは行と3スロットのディープコピーなので、30本でも数百KB程度に収まる。
  const UNDO_LIMIT = 30;
  const undoStack = ref<CalcUndoEntry[]>([]);
  const redoStack = ref<CalcUndoEntry[]>([]);
  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);
  const UNDO_COALESCE_MS = 1000;
  let undoCoalesceRevision = 0;

  /**
   * 巻き戻す範囲。**その操作が実際に変えたものだけを持つ。**
   *
   * 全部を戻すと、記録した後にユーザーが変えた別の値（アメブ上限・配分方針など）まで
   * 一緒に戻る。それらは undo 対象の操作ではないので、消えると事故になる。
   */
  function snapshotUndoState(scope: UndoScope): CalcUndoState {
    const state: CalcUndoState = {};
    if (scope.includes("rows")) state.rows = cloneCalcRows(rows.value);
    if (scope.includes("slots")) state.slots = cloneCalcSlots(slots.value);
    if (scope.includes("activeSlotTab")) state.activeSlotTab = activeSlotTab.value;
    if (scope.includes("totalShards")) state.totalShards = totalShards.value;
    if (scope.includes("boostCandyRemaining")) state.boostCandyRemaining = boostCandyRemaining.value;
    if (scope.includes("itemCompareMode")) state.itemCompareMode = itemCompareMode.value;
    if (scope.includes("sleepSettings")) state.sleepSettings = { ...sleepSettings.value };
    if (scope.includes("defaultBoostReachLevel")) state.defaultBoostReachLevel = defaultBoostReachLevel.value;
    if (scope.includes("candyInventory")) state.candyInventory = candyStore.getInventory();
    return state;
  }

  function restoreUndoState(s: CalcUndoState) {
    if (s.rows !== undefined) rows.value = s.rows.map(normalizeCalcRowStructure);
    if (s.slots !== undefined) slots.value = s.slots;
    if (s.activeSlotTab !== undefined) {
      activeSlotTab.value = s.activeSlotTab;
      saveActiveSlot(s.activeSlotTab);
    }
    if (s.totalShards !== undefined) totalShards.value = s.totalShards;
    if (s.boostCandyRemaining !== undefined) boostCandyRemaining.value = s.boostCandyRemaining;
    if (s.itemCompareMode !== undefined) itemCompareMode.value = s.itemCompareMode;
    if (s.sleepSettings !== undefined) sleepSettings.value = { ...s.sleepSettings };
    if (s.defaultBoostReachLevel !== undefined) defaultBoostReachLevel.value = s.defaultBoostReachLevel;
    if (s.candyInventory !== undefined) candyStore.restoreInventory(s.candyInventory);
  }

  /**
   * @param options.coalesceKey 同じキーの連続更新を1本の履歴へまとめる。
   * @param options.coalesceWindowMs まとめてよい間隔の上限。**キー自体が1回の操作を表すとき**
   *   （並べ替えドラッグのセッションIDなど）は `Infinity` を渡す。時間で切ると、ゆっくりした
   *   ドラッグが途中で別の履歴へ割れる
   */
  function beginUndo(
    label: string,
    scope: UndoScope = ["rows"],
    options: { coalesceKey?: string; coalesceWindowMs?: number } = {},
  ) {
    const now = Date.now();
    const last = undoStack.value.at(-1);
    if (
      options.coalesceKey !== undefined
      && last?.coalesceKey === options.coalesceKey
      && last.coalesceRevision === undoCoalesceRevision
      && now - last.recordedAt <= (options.coalesceWindowMs ?? UNDO_COALESCE_MS)
      && last.scope.join("\u0000") === scope.join("\u0000")
    ) {
      last.recordedAt = now;
      redoStack.value = [];
      return;
    }
    undoStack.value = [...undoStack.value, {
      scope,
      state: snapshotUndoState(scope),
      label,
      coalesceKey: options.coalesceKey,
      recordedAt: now,
      coalesceRevision: undoCoalesceRevision,
    }].slice(-UNDO_LIMIT);
    redoStack.value = [];
  }
  /**
   * undo / redo で反対側のスタックへ積み直すエントリ。**呼び出し前に
   * `undoCoalesceRevision` を進めておくこと**（現在値をそのまま刻む）。
   *
   * `coalesceKey` を捨てるのがここの肝。残すと、undo/redo の直後に同じ欄を触った編集が
   * このエントリへ吸われ、**新しいスナップショットが積まれないまま undo 1回で
   * その操作まで巻き戻る**（記録していない編集を黙って戻す＝R2 と同じ型）。
   */
  function reEntry(e: CalcUndoEntry): CalcUndoEntry {
    return {
      ...e,
      coalesceKey: undefined,
      state: snapshotUndoState(e.scope),
      recordedAt: Date.now(),
      coalesceRevision: undoCoalesceRevision,
    };
  }
  function undo() {
    const e = undoStack.value.pop();
    if (!e) return;
    undoCoalesceRevision += 1;
    redoStack.value = [...redoStack.value, reEntry(e)].slice(-UNDO_LIMIT);
    restoreUndoState(e.state);
    showToast(t("status.undoWithLabel", { label: e.label }));
  }
  function redo() {
    const e = redoStack.value.pop();
    if (!e) return;
    undoCoalesceRevision += 1;
    undoStack.value = [...undoStack.value, reEntry(e)].slice(-UNDO_LIMIT);
    restoreUndoState(e.state);
    showToast(t("status.redoWithLabel", { label: e.label }));
  }

  function clear() {
    if (!rows.value.length) return;
    beginUndo(t("calc.clearPokemons"));
    rows.value = [];
    activeRowId.value = null;
  }

  function removeRowById(id: string) {
    const row = rows.value.find((x) => x.id === id);
    if (!row) return;
    beginUndo(t("calc.undoLabel.rowDelete", { name: row.title }));
    rows.value = rows.value.filter((x) => x.id !== id);
    if (activeRowId.value === id) activeRowId.value = rows.value[0]?.id ?? null;
  }



  function formatSlotSavedAt(iso: string | undefined | null): string {
    const s = String(iso ?? "").trim();
    if (!s) return "";
    const d = new Date(s);
    if (!Number.isFinite(d.getTime())) return "";
    return d.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const dragRowId = ref<string | null>(null);
  const dragOverRowId = ref<string | null>(null);

  /**
   * 並べ替えドラッグの通し番号。**1回のドラッグ＝1本の履歴**にするために使う。
   *
   * PC では 25px 動かすたびに `moveRow` が走る（`CalcPanel.onRowDocPointerMove`）ので、
   * まとめないと1回のドラッグで履歴が何本も積まれる。区切りは時間ではなくドラッグの
   * 開始・終了に置く。ゆっくり動かしても割れず、逆にボタン操作（↑↓）は
   * ドラッグ中ではないので1クリックずつ独立した履歴になる。
   */
  // `flush: "sync"` は必須。既定の遅延フラッシュだと、同じ tick で
  // 「ドラッグ開始 → 1回目の入れ替え」が起きたときに通し番号が古いままになる。
  let rowDragSession = 0;
  watch(dragRowId, (id, prev) => {
    if (id !== null && prev === null) rowDragSession += 1;
  }, { flush: "sync" });

  function clampInt(v: unknown, min: number, max: number, fallback: number): number {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(n)));
  }

  function autoBoostCandyCap(): number {
    if (boostKind.value === "none") return 0;
    return boostCandyRemaining.value ?? (boostKind.value === "mini" ? 350 : 3500);
  }

  function updateRow(id: string, patch: Partial<CalcRow>) {
    rows.value = rows.value.map((x) => (x.id === id ? { ...x, ...patch } : x));
  }

  function rowFieldUndoLabel(row: CalcRow, field: string): string {
    return t("calc.undoLabel.rowField", { name: row.title, field });
  }

  function commitRows(
    next: CalcRow[],
    label: string,
    options: { coalesceKey?: string; coalesceWindowMs?: number } = {},
  ): boolean {
    if (JSON.stringify(next) === JSON.stringify(rows.value)) return false;
    beginUndo(label, ["rows"], options);
    rows.value = next;
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // 個数指定と目標Lvの一本化（設計書 §10.10）
  //
  // 個数指定と睡眠目標は独立し、個数指定の有無がユーザーの目的を表す。
  //
  // ここでの連動更新は calcCandyPatch を呼ばない（§4.4 ループ防止）。
  // ─────────────────────────────────────────────────────────────

  /** 現在Lv内で既に得ているEXP。 */
  function rowExpGot(r: Pick<CalcRow, 'srcLevel' | 'expType' | 'expRemaining'>): number {
    const toNext = Math.max(0, calcExp(r.srcLevel, r.srcLevel + 1, r.expType));
    return (r.expRemaining !== undefined && r.expRemaining > 0) ? Math.max(0, toNext - r.expRemaining) : 0;
  }

  /** 行の実効アメブ個数。未入力なら保存されたアメブ目標Lvから導出する。 */
  function rowBoostCandy(r: CalcRow): number {
    return resolveEffectiveBoostCandy(r);
  }

  /**
   * 「これから寝る時間」から睡眠EXPを求める。
   * 睡眠目標時間が未設定なら 0。
   */
  function rowSleepExp(r: CalcRow): number {
    return rowMarkForSleep(r)?.mark.sleepExp ?? 0;
  }

  /** 表示側の睡眠EXP判定用。計算は内部の正本 `rowSleepExp` にだけ委ねる。 */
  function rowSleepExpFor(rowId: string): number {
    const row = rows.value.find((candidate) => candidate.id === rowId);
    return row ? rowSleepExp(row) : 0;
  }

  function rowHasSleepPlan(row: CalcRow): boolean {
    return row.sleepTargetMode !== undefined || row.sleepTargetHours !== undefined;
  }

  /** お香個数とボーナス内訳が必ず同じ到達日数を使うための単一解決経路。 */
  function resolveRowSleepPlan(rowId: string): { row: CalcRow; needed: SleepPlanResult } | null {
    const row = rows.value.find((candidate) => candidate.id === rowId);
    if (!row || !rowHasSleepPlan(row)) return null;
    const plan = getPokemonResult(rowId);
    if (!plan) return null;
    const plannedSleepExp = row.sleepTargetHours === undefined
      ? Number.POSITIVE_INFINITY
      : rowSleepExp(row);
    const expCoveredByPlannedSleep = Math.min(plan.shortage.expToTarget, plannedSleepExp);
    if (!(expCoveredByPlannedSleep > 0)) return null;
    const needed = calcSleepTimeFor(row, expCoveredByPlannedSleep);
    return isSleepPlan(needed) ? { row, needed } : null;
  }

  /**
   * 行の計画で使う成長のお香の個数。1回の睡眠につき1個なので、使用日数がそのまま個数になる。
   * 到達までの日数を数え、数値の睡眠目標では予定睡眠EXPを超えない期間に制限する。
   */
  function rowGrowthIncenseCountFor(rowId: string): number {
    return resolveRowSleepPlan(rowId)?.needed.growthIncenseCount ?? 0;
  }

  /**
   * 「これから寝る時間」を表示側へ公開する（睡眠到達Lvの横に添える時間）。
   * 累計との差と 0 クランプは `rowMarkForSleep` が正本。ここで引き算を書き直さない。
   */
  function rowSleepRemainingHoursFor(rowId: string): number {
    const row = rows.value.find((candidate) => candidate.id === rowId);
    return row ? (rowMarkForSleep(row)?.remainingHours ?? 0) : 0;
  }

  /**
   * 行の睡眠EXPを求める。睡眠目標が未設定なら null。
   * 実際に使う睡眠EXPと、?perf=1 で出す中間値は同じ呼び出しから取る。
   */
  function rowMarkForSleep(r: CalcRow): { remainingHours: number; mark: MarkForSleepResult } | null {
    if (r.sleepTargetHours === undefined) return null;
    const remainingHours = Math.max(0, r.sleepTargetHours - (r.sleepHours ?? 0));
    const s = sleepSettings.value;
    try {
      const mark = markForSleep({
        targetSleepHours: remainingHours,
        nature: r.nature,
        dailySleepHours: s.dailySleepHours,
        sleepExpBonus: sleepExpBonusMultiplier(s.sleepExpBonusCount),
        schedule: sleepSchedule.value,
      });
      return {
        remainingHours,
        mark,
      };
    } catch (error) {
      recordSleepCalculationError(error);
      return null;
    }
  }

  function calcSleepTimeForRow(rowId: string, expToTarget: number): SleepTimeResult {
    const row = rows.value.find((candidate) => candidate.id === rowId);
    if (!row) return { kind: "unavailable" };
    return calcSleepTimeFor(row, expToTarget);
  }

  function calcSleepTimeFor(row: CalcRow, expToTarget: number): SleepTimeResult {
    const s = sleepSettings.value;
    try {
      const result = calcSleepTimeForExp({
        expToTarget,
        nature: row.nature,
        dailySleepHours: s.dailySleepHours,
        sleepExpBonus: sleepExpBonusMultiplier(s.sleepExpBonusCount),
        schedule: sleepSchedule.value,
      });
      return result;
    } catch (error) {
      recordSleepCalculationError(error);
      return { kind: "unavailable" };
    }
  }

  /**
   * 睡眠チーム（1晩5匹）からあふれる行か。
   *
   * 睡眠EXPは1晩に5匹までしか得られないので、睡眠目標を付けた6行目以降は
   * **同時には実行できない計画**になる。行順で数え、6匹目以降を true にする。
   * アメ不足で「残EXP 約N日」が出ているだけの行は睡眠計画ではないので数えない
   * （正本は `rowHasSleepPlan`）。
   */
  function rowExceedsSleepTeamLimit(rowId: string): boolean {
    let planned = 0;
    for (const row of rows.value) {
      if (!rowHasSleepPlan(row)) continue;
      planned++;
      if (row.id === rowId) return planned > MAX_SLEEP_TEAM_SIZE;
    }
    return false;
  }

  /**
   * 行の睡眠計画に効いたボーナスの内訳（結果行の「内訳」表示用）。
   *
   * 数える日数は `resolveRowSleepPlan` の正本（目標へ届くまでに寝る日数）から取り、
   * お香の個数と同じ期間で「どのボーナスが何日効いて、いくら増えたか」を見せる。
   *
   * **最終日の扱いは画面の睡眠時間表示に合わせる。**
   * - 1回で届く行（`6時間41分 ～ 45分`）… その実分数で計算する
   * - 長期の行（`約269日`）… 日数を切り上げて出しているので、最終日も丸ごと1日として数える
   *
   * 混ぜると「日数とお香個数は269日ぶん、EXPだけ268日＋端数」というちぐはぐな表になる。
   */
  function rowSleepBonusBreakdownFor(rowId: string): RowSleepBonusBreakdown {
    const empty: RowSleepBonusBreakdown = {
      contributions: [],
      nights: [],
    };
    const resolved = resolveRowSleepPlan(rowId);
    if (!resolved) return empty;
    const { row, needed } = resolved;
    const days = needed.requiredDays;
    const s = sleepSettings.value;
    const dailySleepMinutes = Math.round(s.dailySleepHours * 60);
    const sleepExpBonus = sleepExpBonusMultiplier(s.sleepExpBonusCount);
    // 3晩以内は最後の晩だけ実際に寝る分数で数える。長期は丸ごと1日（undefined＝1日分）。
    const lastDaySleepMinutes = needed.kind === "exact-nights" ? needed.minutesMin : undefined;
    try {
      const schedule = sleepSchedule.value;
      const shared = {
        days,
        dailySleepMinutes,
        sleepExpBonus,
        nature: row.nature,
        schedule,
        lastDaySleepMinutes,
        // お香を外す判断は calcSleepTimeForExp が正本。個数表示と食い違わせない。
        skipLastDayIncense: needed.skipsLastDayIncense,
      };
      // 3晩以内は日別、4晩以上は種類別。**どちらか一方だけ**を渡す（§10.5）。
      const showsNights = needed.kind === "exact-nights";
      return {
        contributions: showsNights ? [] : attributeSleepBonusExpForDays(shared),
        nights: showsNights ? attributeSleepBonusExpByNight(shared) : [],
        neededFrom: schedule.dayAt(0).date,
        neededTo: schedule.dayAt(days - 1).date,
      };
    } catch (error) {
      recordSleepCalculationError(error);
      return empty;
    }
  }

  /** 保存された最終目標のLv内EXP（導出規則は deriveTarget が正本）。 */
  function rowTargetExpInLevel(r: CalcRow): number {
    return deriveTarget(r).targetExpInLevel;
  }

  /**
   * 個数指定の上限。MAX_LEVEL 到達に必要なアメ数から、睡眠EXPで賄える分を引いた値（§4.3）。
   * 睡眠EXPだけで Lv70 に届くなら 0 になる。
   */
  function maxCandyTargetFor(r: CalcRow): number {
    const expGot = rowExpGot(r);
    const sleepExp = rowSleepExp(r);
    // Lv70 から睡眠EXP分を戻した点 T'max がアメの担当範囲。
    const cap = locateExpTargetFromSrc(r, expGot, sleepExp);
    if (cap === null) return 0;
    // 余剰アメブは minCandyForTarget が cap 地点の必要数でクランプする。
    // クランプしないと、余分なアメブを持つ行で上限が実際より大きくなる。
    return minCandyForTarget({
      srcLevel: r.srcLevel, targetLevel: cap.level, targetExpInLevel: cap.expInLevel,
      expType: r.expType, nature: r.nature, boostKind: boostKind.value,
      boostCandy: rowBoostCandy(r), expGot,
    });
  }

  /** Lv70 から睡眠EXP分を戻した地点。睡眠EXPだけで Lv70 に届くなら null。 */
  function locateExpTargetFromSrc(
    r: Pick<CalcRow, 'srcLevel' | 'expType'>,
    expGot: number,
    sleepExp: number,
  ): { level: number; expInLevel: number } | null {
    const expToMax = Math.max(0, calcExp(r.srcLevel, MAX_LEVEL, r.expType) - expGot);
    const expForCandy = expToMax - sleepExp;
    if (expForCandy <= 0) return null;
    let level = r.srcLevel;
    let expInLevel = expGot + expForCandy;
    while (level < MAX_LEVEL) {
      const needed = calcExp(level, level + 1, r.expType);
      if (expInLevel < needed) break;
      expInLevel -= needed;
      level++;
    }
    return { level, expInLevel: level >= MAX_LEVEL ? 0 : expInLevel };
  }

  /**
   * 保存された最終目標 T から睡眠EXP Sを戻し、アメが担当する終端 T' を返す。
   * 睡眠だけで目標へ届く場合は、現在地点（srcLevel + expGot）を返す。
   */
  function rowCandyTargetBeforeSleep(r: CalcRow): { level: number; expInLevel: number } {
    const target = deriveTarget(r);
    const expGot = rowExpGot(r);
    const expToTarget = Math.max(
      0,
      calcExp(r.srcLevel, target.targetLevel, r.expType) + target.targetExpInLevel - expGot,
    );
    const expForCandy = Math.max(0, expToTarget - rowSleepExp(r));
    let level = r.srcLevel;
    let expInLevel = expGot + expForCandy;
    while (level < MAX_LEVEL) {
      const needed = calcExp(level, level + 1, r.expType);
      if (expInLevel < needed) break;
      expInLevel -= needed;
      level++;
    }
    return { level, expInLevel: level >= MAX_LEVEL ? 0 : expInLevel };
  }

  /**
   * 「アメ在庫＋睡眠」の行が使うアメ数と、その行へ回る利用可能在庫。**この1箇所が正本。**
   *
   * 実効アメブ個数の内数クランプ・入力欄のプレースホルダ・ソルバーへ渡す需要が、
   * すべてここを読む。`buildPlannerInput` にも同じ歩き方を書くと、画面とソルバーで
   * 使うアメ数がずれる（操作仕様§9「同じ判定を2箇所に書かない」）。
   *
   * 上の行から順に「その行が使いうる最大」を種族アメから引く（ソルバーの top-down 配分と
   * 同じ順序）。引く量は必ずその行の必要アメ数以下なので、**下の行へ回る量を過大に見積もらない**
   * ＝ここで決めた数は在庫の範囲に必ず収まる。収まらない数を渡すと、その行は供給候補が空になり
   * 境界として下の行を丸ごとブロックする。
   *
   * 歩くときの需要は**在庫で抑える前の**実効アメブ個数から引く（`ignoreStockBudget`）。
   * 抑えた値を使うと `使うアメ数 → 実効アメブ → 使うアメ数` の循環になる。
   * 切っても値は変わらない: 在庫が需要に届く行では抑制が働かず、届かない行では
   * アメブが減っても必要アメ数は増えるだけで、`min(残り在庫, 需要)` は残り在庫のまま。
   */
  const stockCandyAllocationByRowId = computed<{
    target: Record<string, number>;
    available: Record<string, number>;
  }>(() => {
    if (!rows.value.some(row => row.sleepTargetMode === "stock")) {
      return { target: {}, available: {} };
    }
    const left: Record<string, number> = {
      ...normalizeSpeciesCandyByFamily(candyStore.inventorySnapshot.value.species),
    };
    const resolved: Record<string, number> = {};
    const available: Record<string, number> = {};
    for (const row of rows.value) {
      const pokedexId = getRowPokedexId(row);
      if (pokedexId === undefined || pokedexId <= 0) continue;
      const key = getCandyFamilyKey(pokedexId);
      const target = deriveTarget(row);
      const need = row.candyTarget ?? minCandyForTarget({
        srcLevel: row.srcLevel,
        targetLevel: target.targetLevel,
        targetExpInLevel: target.targetExpInLevel,
        expType: row.expType,
        nature: row.nature,
        boostKind: boostKind.value,
        boostCandy: resolveEffectiveBoostCandy(row, false, true),
        expGot: rowExpGot(row),
      });
      const rowAvailable = Math.max(0, left[key] ?? 0);
      const claim = Math.min(rowAvailable, Math.max(0, need));
      if (row.sleepTargetMode === "stock") {
        resolved[row.id] = claim;
        available[row.id] = rowAvailable;
      }
      left[key] = Math.max(0, rowAvailable - claim);
    }
    return { target: resolved, available };
  });

  /** 「アメ在庫＋睡眠」の行が使うアメ数。それ以外の行では undefined。 */
  function rowStockCandyTargetFor(rowId: string): number | undefined {
    return stockCandyAllocationByRowId.value.target[rowId];
  }

  /** 上位行の取り分を除いた、この stock 行が使える種族アメ在庫。 */
  function rowStockCandyAvailableFor(rowId: string): number | undefined {
    return stockCandyAllocationByRowId.value.available[rowId];
  }

  /**
   * 実効アメブ個数の唯一の読み口（操作仕様 §6）。
   *
   * - 明示値があればその値を使う
   * - 未入力ならアメブ目標Lvから導出する
   * - 個数指定、アメ担当終端 T'、理論上限でクランプする
   *
   * **グローバル残枠ではクランプしない。** かつては未入力の行だけを黙って残枠へ切り詰めており、
   * 合計が上限を超えていても `boostCandyUnavailable` が 0 のまま赤枠も出なかった（§11.8-b）。
   * 超過はそのままソルバーへ渡し、赤枠でユーザーに解決してもらう。残枠へ収めるのは
   * リセット操作（`allocateBoostCandyFromQuota`）だけで、そこでは個数として保存する。
   */
  function resolveEffectiveBoostCandy(
    r: CalcRow,
    forCandyTargetNormalization = false,
    /** 使うアメ数を数えている最中だけ true。`stockCandyAllocationByRowId` の説明を参照。 */
    ignoreStockBudget = false,
  ): number {
    if (r.sleepTargetMode === "all" || boostKind.value === "none" || r.srcLevel >= MAX_LEVEL) return 0;

    const candyTarget = rowCandyTargetBeforeSleep(r);
    // **`T` を導出している最中は `dstLevel` も `T'` もその計算の出力**なので、入力として参照できない
    // （§10.18 の例外）。参照すると `T → n → T'` の循環になり、§11.4 / §15.7 が再発する。
    // その間は保存された `boostReachLevel`（ユーザーの意図）だけを使い、個数指定と理論上限で抑える。
    // **同じことが「個数指定 `m` のある行」全体に言える**（§15.11）。`T` は `(m, n)` の**出力**で、
    // `m` を入れると `T` が決まり、`n` が増えれば `T` が伸びる。`T` を `n` の入力に混ぜると、
    // 導出経路（`T` を作る側）と表示・ソルバー経路とで `n` が食い違い、保存した `T` に `m` 個で
    // 届かなくなる。**`T` が出力になる行では、両経路とも入力（`boostReachLevel` と `m`）だけで
    // `n` を決める。** 個数 anchor の無い行だけ `T` が入力なので、担当終端 `T'` と目標Lvで抑える。
    // **どちらの経路でもアメブは Lv ちょうどまでしか賄わない**（端数賄いは廃止。§15.7 撤回）。
    //
    // 睡眠の頭打ちだけは `T` が出力の行でも要る（保存された `boostReachLevel` は入力時にしか
    // cap されないので、睡眠時間を後から変えると `T'` を超えたままになる）。そこでは `T` から
    // 引いた `T'` ではなく、**`Lv70` から睡眠EXPを戻した `T'max`** を使う。こちらは `T` に依らない。
    const derivingTarget = forCandyTargetNormalization || r.candyTarget !== undefined;
    const sleepCap = derivingTarget
      ? locateExpTargetFromSrc(r, rowExpGot(r), rowSleepExp(r))
      : null;
    const reachLevel = clampInt(
      derivingTarget
        ? Math.min(r.boostReachLevel ?? r.dstLevel, sleepCap?.level ?? r.srcLevel)
        : Math.min(r.boostReachLevel ?? r.dstLevel, r.dstLevel, candyTarget.level),
      r.srcLevel,
      MAX_LEVEL,
      r.srcLevel,
    );
    // アメブが賄うのはどちらの経路でも「アメブ目標Lv ちょうどまで」。
    // `T` が出力になる行では担当範囲の全体を賄う形になるので、導出モードの置換（§10.5）もここで効く。
    const derived = boostCandyForReachLevel(
      r,
      reachLevel,
      derivingTarget ? reachLevel : candyTarget.level,
      derivingTarget ? 0 : candyTarget.expInLevel,
    );
    const requested = Math.max(0, Math.floor(r.boostOrExpAdjustment ?? derived));
    // アメブは総アメ数の内数（不変条件 `n ≤ m`）。「アメ在庫＋睡眠」では在庫が `m` を決めるので、
    // 個数指定とまったく同じ枠で抑える。抑えないと、12個しか使えない行がアメブ枠を
    // 数百個ぶん予約して下の行を飢えさせる。**保存値は抑えない**（意図として残す）。
    const candyBudget = r.candyTarget
      ?? (r.sleepTargetMode === "stock" && !ignoreStockBudget ? rowStockCandyTargetFor(r.id) : undefined)
      ?? Number.POSITIVE_INFINITY;
    if (derivingTarget) {
      return Math.min(requested, candyBudget, boostCandyToMaxLevel(r));
    }
    const targetCandyCap = minCandyForTarget({
      srcLevel: r.srcLevel,
      targetLevel: candyTarget.level,
      targetExpInLevel: candyTarget.expInLevel,
      expType: r.expType,
      nature: r.nature,
      boostKind: boostKind.value,
      boostCandy: requested,
      expGot: rowExpGot(r),
    });
    const effective = Math.min(requested, candyBudget, targetCandyCap, boostCandyToMaxLevel(r));
    return Math.max(0, Math.floor(effective));
  }

  /**
   * 行の不変条件をここ1箇所で回復する（設計書§10.10）。
   *
   * - `n ≤ m`（アメブは総アメ数の内数）
   * - 睡眠目標モード、または両方の個数anchorが無い場合だけ dstExpInLevel を落とす
   * - 個数指定ありでは T を (m, effectiveN, S) から再保存する
   * - アメブ個数だけがanchorなら、Tを上方向にだけ押し上げる
   */
  function normalizeRowState(r: CalcRow): CalcRow {
    const next: CalcRow = normalizeCalcRowStructure({ ...r });
    next.dstLevel = clampInt(next.dstLevel, next.srcLevel, MAX_LEVEL, next.srcLevel);
    next.boostReachLevel = clampInt(next.boostReachLevel, next.srcLevel, MAX_LEVEL, next.dstLevel);
    if (next.boostOrExpAdjustment !== undefined) {
      next.boostOrExpAdjustment = Math.max(0, Math.floor(next.boostOrExpAdjustment));
    }
    if (next.sleepTargetMode !== undefined) {
      next.candyTarget = undefined;
      next.dstExpInLevel = undefined;
      return next;
    }

    if (next.candyTarget === undefined && next.boostOrExpAdjustment === undefined) {
      next.dstExpInLevel = undefined;
      return next;
    }

    if (next.candyTarget === undefined) {
      const n = next.boostOrExpAdjustment ?? 0;
      const candidate = targetFromCandy({
        srcLevel: next.srcLevel,
        expGot: rowExpGot(next),
        candyTarget: n,
        boostCandy: n,
        expType: next.expType,
        nature: next.nature,
        boostKind: boostKind.value,
      });
      const currentExp = normalizeTargetExpInLevel(next.dstLevel, next.dstExpInLevel, next.expType);
      if (compareLevelExp(candidate.level, candidate.expInLevel, next.dstLevel, currentExp) > 0) {
        next.dstLevel = clampInt(candidate.level, next.srcLevel, MAX_LEVEL, next.dstLevel);
        next.dstExpInLevel = normalizeTargetExpInLevel(next.dstLevel, candidate.expInLevel, next.expType);
      }
      return next;
    }

    const m = Math.max(0, Math.floor(next.candyTarget));
    next.candyTarget = m;

    if (next.boostOrExpAdjustment !== undefined && next.boostOrExpAdjustment > m) {
      next.boostOrExpAdjustment = m;
    }

    const t = targetFromCandy({
      srcLevel: next.srcLevel,
      expGot: rowExpGot(next),
      candyTarget: m,
      boostCandy: resolveEffectiveBoostCandy(next, true),
      expType: next.expType,
      nature: next.nature,
      boostKind: boostKind.value,
      sleepExp: rowSleepExp(next),
    });
    next.dstLevel = clampInt(t.level, next.srcLevel, MAX_LEVEL, next.dstLevel);
    next.dstExpInLevel = normalizeTargetExpInLevel(next.dstLevel, t.expInLevel, next.expType);

    return next;
  }

  function compareLevelExp(
    leftLevel: number,
    leftExpInLevel: number,
    rightLevel: number,
    rightExpInLevel: number,
  ): number {
    return leftLevel === rightLevel ? leftExpInLevel - rightExpInLevel : leftLevel - rightLevel;
  }

  /** patch を適用したうえで不変条件を回復し、行を確定する。 */
  function commitRow(
    id: string,
    patch: Partial<CalcRow>,
    label: string,
    options: { coalesceKey?: string } = {},
  ): void {
    const current = rows.value.find((x) => x.id === id);
    if (!current) return;
    const normalized = normalizeRowState({ ...current, ...patch });
    if (JSON.stringify(normalized) === JSON.stringify(current)) return;
    beginUndo(label, ["rows"], options);
    updateRow(id, normalized);
  }

  /** 導出値を保存せず、現在の行と残枠から純粋に計算する。 */


  /**
   * 目標Lvピッカーの操作（§4.3 / §4.6）。
   * candyTarget をクリアして「個数指定なし」へ戻す。
   *
   * アメブは据え置き、目標Lvを下回る場合だけクランプする（§4.6 案1）。
   * calcCandyPatch による自動最大化は行わない（ユーザーのアメブ目標Lv指定を破棄しない）。
   */
  function setDstLevel(id: string, v: unknown) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    const dst = clampInt(v, r.srcLevel, MAX_LEVEL, r.dstLevel);

    const patch: Partial<CalcRow> = { dstLevel: dst };

    if (r.sleepTargetMode !== "all") {
      patch.boostReachLevel = clampInt(
        Math.min(r.boostReachLevel ?? r.dstLevel, dst),
        r.srcLevel,
        MAX_LEVEL,
        r.srcLevel,
      );
    }
    if (r.sleepTargetMode !== "all" && r.boostOrExpAdjustment !== undefined) {
      const reached = targetFromCandy({
        srcLevel: r.srcLevel,
        expGot: rowExpGot(r),
        candyTarget: r.boostOrExpAdjustment,
        boostCandy: r.boostOrExpAdjustment,
        expType: r.expType,
        nature: r.nature,
        boostKind: boostKind.value,
      });
      if (compareLevelExp(reached.level, reached.expInLevel, dst, 0) > 0) {
        patch.boostOrExpAdjustment = undefined;
      }
    }

    // ピッカーで選んだ目標は「Lv dst ちょうど」。Lv内EXPは 0 に戻す。
    patch.dstExpInLevel = 0;
    patch.candyTarget = undefined;
    commitRow(id, patch, rowFieldUndoLabel(r, t("calc.row.dstLevel")));
  }
  /** アメブ個数を現在の目標Lvのまま再計算（リセット） */
  /**
   * 行のアメブリセット。**「残数から最大投入する」ボタン。**
   *
   * アメブ目標Lvを既定値（設定）へ戻し、その行に回る残枠で個数を確定させる。
   * 残枠の計算がユーザーには面倒なので、このボタンが肩代わりする。
   */
  function resetRowBoostCandy(id: string) {
    activeRowId.value = id;
    const row = rows.value.find((x) => x.id === id);
    if (!row || row.sleepTargetMode === "all") return;
    commitRows(
      allocateBoostCandyFromQuota(rows.value, { rowId: id }),
      rowFieldUndoLabel(row, t("calc.row.boostCandyCount")),
    );
  }
  function nudgeDstLevel(id: string, delta: number) {
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    setDstLevel(id, r.dstLevel + delta);
  }
  /**
   * 現在Lvの変更。
   * 元Lvが変わると同じ個数指定でも到達点が変わる（アメのEXP効率がLv依存）ため、
   * ボックス同期（§6.3）と同じく個数指定を解除する。dstLevel はクランプのみ。
   *
   * **睡眠目標は解除しない（§10.11）。** 睡眠EXPはスコア・倍率・性格だけで決まり元Lvに依存せず、
   * 「累計◯時間寝かせる」という宣言は元Lvが変わっても意味が変わらない。
   * 遷移後は「個数指定なし＋睡眠目標あり」という正規の状態になる。
   */
  function setSrcLevel(id: string, v: unknown) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    const src = clampInt(v, 1, r.dstLevel, r.srcLevel);
    const toNext = Math.max(0, calcExp(src, src + 1, r.expType));
    // 元Lvが変わればアメブの必要数も変わる。捨てた個数を残数から配り直す
    // （アメブ目標Lvはユーザーの意図なので既定値へは戻さない）。
    commitRowWithQuota(id, {
      srcLevel: src, dstExpInLevel: 0, expRemaining: toNext,
      candyTarget: undefined,
      boostOrExpAdjustment: undefined,
    }, rowFieldUndoLabel(r, t("calc.row.srcLevel")), { resetReachLevel: false });
  }
  function nudgeSrcLevel(id: string, delta: number) {
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    setSrcLevel(id, r.srcLevel + delta);
  }
  /**
   * アメブ目標Lvの操作（§4.3）。
   * 操作したLvを意図として保存し、アメブ個数は未入力（導出モード）へ戻す。
   *
   * **睡眠EXPが賄う範囲（T' 超）は受け取らずに戻す。** T' でクランプして保存すると、
   * ユーザーが選んでいないLvが意図として残り、睡眠目標を解除しても戻らない（§10.18 / §11.12）。
   * T' 以下は睡眠なしと同じく自由に上げ下げできる。
   */
  function setBoostLevel(id: string, v: unknown) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r || r.sleepTargetMode === "all") return;
    if (isBoostInputDisabledBySleep(r)) return;
    const mid = clampInt(v, r.srcLevel, MAX_LEVEL, r.srcLevel);
    if (mid > boostReachLevelCapFor(r)) return;

    if (mid > r.dstLevel) {
      commitRow(id, {
        dstLevel: mid,
        dstExpInLevel: 0,
        boostReachLevel: mid,
        boostOrExpAdjustment: undefined,
        candyTarget: undefined,
      }, rowFieldUndoLabel(r, t("calc.row.boostReachLevel")));
      return;
    }

    commitRow(
      id,
      { boostReachLevel: mid, boostOrExpAdjustment: undefined },
      rowFieldUndoLabel(r, t("calc.row.boostReachLevel")),
    );
  }

  function nudgeBoostLevel(id: string, delta: number) {
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    setBoostLevel(id, (r.boostReachLevel ?? 0) + delta);
  }

  /**
   * あとEXPの変更。元Lvは変わらないので個数指定・睡眠目標は維持する（§6.3 と同じ規則）。
   * ただし出発点が動く以上、個数指定ありの行では実効目標も動くため dstLevel を同期する。
   */
  function onRowExpRemaining(id: string, v: string) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    const toNext = Math.max(0, calcExp(r.srcLevel, r.srcLevel + 1, r.expType));
    // 空文字 or 0 → toNext（レベルアップ直後扱い）
    const parsed = v.trim() === "" ? toNext : clampInt(v, 1, toNext, toNext);
    const rem = parsed === 0 ? toNext : parsed;

    // 個数指定が anchor の場合も normalizeRowState が保存目標を追従させる。
    commitRow(id, { expRemaining: rem }, rowFieldUndoLabel(r, t("calc.row.expRemaining")));
  }
  /**
   * EXP性格補正の変更（操作仕様 §4.13）。
   *
   * **この関数はアメブが anchor の行を想定している。** アメブ個数だけが anchor で、
   * 変更前の性格においてアメブが目標全体を賄う行では、変更後の到達点を
   * `dstLevel` / `dstExpInLevel` の patch として渡す。派生目標を patch に含めるのは、
   * `normalizeRowState` のアメブ anchor 分岐が目標を上方向にだけ動かすラチェットだからである。
   *
   * 導出モードの行だけアメブ枠を配り直す。明示アメブ個数はユーザーの意図なので残す。
   */
  function setNature(id: string, nature: ExpGainNature) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    if (r.nature === nature) return;

    const patch: Partial<CalcRow> = { nature };
    if (r.candyTarget === undefined && r.boostOrExpAdjustment !== undefined) {
      // 「賄っているか」は必ず変更前の性格・変更前の目標で判定する。
      // 変更後で判定すると up → down の復路で目標が高いまま固まる。
      const reachedBefore = targetFromCandy({
        srcLevel: r.srcLevel,
        expGot: rowExpGot(r),
        candyTarget: r.boostOrExpAdjustment,
        boostCandy: r.boostOrExpAdjustment,
        expType: r.expType,
        nature: r.nature,
        boostKind: boostKind.value,
      });
      const currentTargetExp = normalizeTargetExpInLevel(r.dstLevel, r.dstExpInLevel, r.expType);
      const coversWholeTarget = compareLevelExp(
        reachedBefore.level,
        reachedBefore.expInLevel,
        r.dstLevel,
        currentTargetExp,
      ) >= 0;

      if (coversWholeTarget) {
        const reachedAfter = targetFromCandy({
          srcLevel: r.srcLevel,
          expGot: rowExpGot(r),
          candyTarget: r.boostOrExpAdjustment,
          boostCandy: r.boostOrExpAdjustment,
          expType: r.expType,
          nature,
          boostKind: boostKind.value,
        });
        patch.dstLevel = reachedAfter.level;
        patch.dstExpInLevel = reachedAfter.expInLevel;
      }
    }

    const label = rowFieldUndoLabel(r, t("calc.row.nature"));
    if (r.boostOrExpAdjustment === undefined) {
      commitRowWithQuota(id, patch, label, { resetReachLevel: false });
      return;
    }
    commitRow(id, patch, label);
  }
  /**
   * アメ個数指定の確定（§4.3）。
   * - 空欄 → 「個数指定なし」へ遷移。dstLevel と sleepTargetHours は据え置き（Lv内EXPだけ 0 になる）
   * - 値あり → candyTarget をセットし、n > m ならアメブをクランプ。dstLevel を実効目標のLvへ同期
   *
   * 入力途中の値では呼ばれない（UI側が Enter / フォーカスアウトで確定してから呼ぶ）。
   * 1文字ごとに呼ぶと "158" が 1 → 15 → 158 と流れ、最初の "1" でアメブ個数が
   * クランプされて復元できなくなる。
   */
  function onRowCandyTarget(id: string, v: string) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    // 「すべて睡眠」はアメを配らず、「アメ在庫＋睡眠」は在庫が個数を決めるので、どちらも入力させない。
    if (!r || r.sleepTargetMode !== undefined) return;

    if (v.trim() === "") {
      commitRow(id, { candyTarget: undefined }, rowFieldUndoLabel(r, t("calc.row.candyTarget")));
      return;
    }

    const raw = Math.max(0, Math.floor(Number(v) || 0));
    // アメブの内数クランプ・アメブ目標Lvの引き直し・T の同期は normalizeRowState がまとめて行う。
    commitRow(
      id,
      { candyTarget: Math.min(raw, maxCandyTargetFor(r)) },
      rowFieldUndoLabel(r, t("calc.row.candyTarget")),
    );
  }

  /**
   * 4状態の睡眠目標を排他的に切り替える（未設定 / 数値 / すべて睡眠 / アメ在庫＋睡眠）。
   *
   * 「アメ在庫＋睡眠」は睡眠目標時間を持たない（`S = 0`）ので、**睡眠EXP由来の上限（`T'`）は
   * 「未設定」とまったく同じ**に振る舞う。違うのは個数指定を在庫から決めること、
   * および**アメブ個数の入力上限も在庫で止まること**（2026-08-25 追加。`maxBoostCandyInputFor`）。
   */
  function setRowSleepTarget(id: string, target: number | "all" | "stock" | undefined) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;

    const label = rowFieldUndoLabel(r, t("calc.row.sleepTarget"));
    if (target === "all") {
      commitRow(id, {
        sleepTargetMode: "all",
        sleepTargetHours: undefined,
        candyTarget: undefined,
        dstExpInLevel: 0,
      }, label);
      return;
    }

    const patch: Partial<CalcRow> = {
      sleepTargetMode: target === "stock" ? "stock" : undefined,
      sleepTargetHours: typeof target === "number" ? target : undefined,
    };
    if (target !== undefined) {
      patch.candyTarget = undefined;
      patch.dstExpInLevel = 0;
    }

    // モード中に保留した目標Lv変更の規則を、OFF と同じ1回の履歴へまとめて適用する。
    // 「アメ在庫＋睡眠」へ移るときもアメブが使えるようになるので、同じ復帰処理を通す。
    if (r.sleepTargetMode === "all") {
      patch.boostReachLevel = Math.min(r.boostReachLevel, r.dstLevel);
      if (r.boostOrExpAdjustment !== undefined) {
        const reached = targetFromCandy({
          srcLevel: r.srcLevel,
          expGot: rowExpGot(r),
          candyTarget: r.boostOrExpAdjustment,
          boostCandy: r.boostOrExpAdjustment,
          expType: r.expType,
          nature: r.nature,
          boostKind: boostKind.value,
        });
        if (compareLevelExp(reached.level, reached.expInLevel, r.dstLevel, 0) > 0) {
          patch.boostOrExpAdjustment = undefined;
        }
      }
    }
    commitRow(id, patch, label);
  }

  /** 数値の睡眠目標を使う既存呼び出し向け。 */
  function setRowSleepTargetHours(id: string, hours: number | undefined) {
    setRowSleepTarget(id, hours);
  }

  /** 累計睡眠時間の変更。個数指定があるときは新しい睡眠EXPで最終目標を引き直す。 */
  function setRowSleepHours(rowId: string, sleepHours: number | undefined) {
    const row = rows.value.find((x) => x.id === rowId);
    if (!row) return;
    commitRow(
      rowId,
      { sleepHours },
      rowFieldUndoLabel(row, t("calc.undoLabel.sleepHours")),
    );
  }
  /**
   * アメブ個数の入力（§4.3）。
   *
   * アメブが駆動側なので、増やして総アメ数を超えたら個数指定の方を引き上げる。
   * （逆に個数指定を減らしたときは、そちらが駆動側なのでアメブを内数へクランプする）
   *
   * **上限を超える入力は上限へクランプする（2026-08-25 ユーザー規則）。**
   *
   * 以前は睡眠ありの行だけ「受け取らずに戻す」形にしていた。上限0の行でクランプすると
   * 「明示的に0個」が確定してしまうためだが、拒否された入力は導出モードの値（多くは0）で
   * 再描画されるので、ユーザーには**大きい数を入れたら0になった**としか見えなかった。
   *
   * 睡眠ありでは上限0の欄を `isBoostInputDisabledBySleep` が無効化する。
   * それ以外の経路も、保存直前に上限0を弾いて「明示的に0個」を焼き付けない。
   * ただし stock は半ロックなので、在庫0へ下げる操作だけは明示0として受け取る。
   */
  function onRowBoostCandy(id: string, v: string) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r || r.sleepTargetMode === "all") return;
    if (isBoostInputDisabledBySleep(r)) return;

    if (v.trim() === "") {
      commitRow(
        id,
        { boostOrExpAdjustment: undefined },
        rowFieldUndoLabel(r, t("calc.row.boostCandyCount")),
        { coalesceKey: `rowBoostCandy:${id}` },
      );
      return;
    }

    const rawN = Math.max(0, Math.floor(Number(v) || 0));
    const inputMax = maxBoostCandyInputFor(r);
    // 上限0の行は原則として「明示的に0個」を焼き付けない（§11.11）。ただし stock は
    // 睡眠の押し下げと同じ半ロックで、下方向へ0まで操作できるのが仕様。アメブなし・Lv70は
    // stock でも入力欄として意味がないので従来どおり弾く。
    const stockCanSaveExplicitZero = r.sleepTargetMode === "stock"
      && boostKind.value !== "none"
      && r.srcLevel < MAX_LEVEL;
    if (inputMax === 0 && !stockCanSaveExplicitZero) return;
    const n = Math.min(rawN, inputMax);
    const patch: Partial<CalcRow> = { boostOrExpAdjustment: n };
    if (r.candyTarget !== undefined && n > r.candyTarget) patch.candyTarget = n;
    commitRow(
      id,
      patch,
      rowFieldUndoLabel(r, t("calc.row.boostCandyCount")),
      { coalesceKey: `rowBoostCandy:${id}` },
    );
  }

  /**
   * アメブが担当できる終端。睡眠なしなら MAX_LEVEL、睡眠ありは T'（§10.18）、
   * stock は上位行の取り分を除いた利用可能在庫をアメブへ使ったときの到達Lv。
   * **ここを超える入力は受け取らない**（クランプしない）。クランプすると、ユーザーが
   * 選んでいない値が「意図」として保存され、睡眠目標を解除しても戻らなくなる（§11.12）。
   */
  function boostReachLevelCapFor(r: CalcRow): number {
    if (r.sleepTargetMode === "all") return MAX_LEVEL;
    if (r.sleepTargetMode === "stock") {
      const stockCandyAvailable = rowStockCandyAvailableFor(r.id);
      // 種族を解決できない行では在庫上限自体が不明。0個と混同せず制限を掛けない。
      return stockCandyAvailable === undefined
        ? MAX_LEVEL
        : boostReachLevelForCandy(r, stockCandyAvailable);
    }
    return r.sleepTargetHours === undefined ? MAX_LEVEL : rowCandyTargetBeforeSleep(r).level;
  }

  /**
   * 睡眠EXPまたは stock 在庫による上限が効いている行。**案内文を用意する条件。**
   *
   * **判定はアメブ目標Lv1本。** 表示中のアメブ目標Lvが上限に達している
   * （＝それ以上上げられない）ときだけ true。アメブ個数欄の案内もこれに連動させる。
   * 個数の上限（`maxBoostCandyInputFor`）を混ぜてはいけない——単位が違うので、
   * どちらの上限の話をしているのか読み手にも実装にも分からなくなる。
   *
   * 押し下げられている行（保存意図 > 上限）は表示値が上限へクランプされるので、この条件に含まれる。
   *
   * > **上限に余裕がある行では出さない（2026-07-29、ユーザー指摘）。**
   * > 以前は「上限が MAX_LEVEL 未満か」だけを見ていた。睡眠目標がある行の上限は必ず目標Lv以下なので、
   * > **睡眠目標がある行のほぼ全部**で警告が出ていた。文面は「アメブを操作するには目標Lvを上げるか
   * > 睡眠目標を解除してください」という打ち手なので、まだ自由に操作できる行に出すと誤情報になる。
   * > アメブ種別を full → mini へ変えてアメブ目標Lvが元Lvまで下がった行で表面化した。
   */
  function isBoostCapActive(r: CalcRow, reachLevel: number, reachLevelMax: number): boolean {
    if (r.sleepTargetMode === "all" || boostKind.value === "none") return false;
    if (r.sleepTargetMode !== "stock" && r.sleepTargetHours === undefined) return false;
    if (r.sleepTargetMode === "stock" && rowStockCandyAvailableFor(r.id) === undefined) return false;
    if (reachLevelMax >= MAX_LEVEL) return false;
    return reachLevel >= reachLevelMax;
  }

  /** 上限案内の文言を切り替えるための由来。 */
  function boostCapKindFor(r: CalcRow, active: boolean): 'sleep' | 'stock' | null {
    if (!active) return null;
    return r.sleepTargetMode === "stock" ? 'stock' : 'sleep';
  }

  /**
   * 睡眠EXPがアメブの担当範囲を押し下げている状態（§10.18）。破線を出す条件。
   * stock の在庫上限は操作可能な半ロックなので、ここには含めない。
   *
   * **これは「入力できない」ではない。** T' 以下の範囲は今までどおり上げ下げできる。
   * 動かせないのは押し下げられた範囲（T' 超）だけ。そこの扱いは欄で違う——
   * **アメブ目標Lv（`setBoostLevel`）は受け取らずに戻し、アメブ個数（`onRowBoostCandy`）は
   * 上限へクランプする**（2026-08-25 改訂。設計書 §18.2）。
   */
  function isBoostSleepCapped(r: CalcRow): boolean {
    if (r.sleepTargetMode === "all" || boostKind.value === "none" || r.sleepTargetHours === undefined) return false;
    if (r.srcLevel >= MAX_LEVEL) return false;
    return (r.boostReachLevel ?? r.dstLevel) > boostReachLevelCapFor(r)
      || maxBoostCandyInputFor(r) === 0;
  }

  /**
   * 睡眠EXPが目標まで賄ってしまい、アメブを1個も使えない状態。
   * アメブ区間が丸ごと消えるので、2欄とも入力欄そのものを無効化する。
   */
  function isBoostInputDisabledBySleep(r: CalcRow): boolean {
    if (r.sleepTargetMode === "all") return true;
    // stock は在庫0でも半ロックとして下方向へ0まで操作できるため無効化しない。
    if (r.sleepTargetMode === "stock" || boostKind.value === "none" || r.sleepTargetHours === undefined) return false;
    return maxBoostCandyInputFor(r) === 0;
  }

  /**
   * アメブ個数欄の上限。睡眠ありではアメ担当終端 T'、なしでは MAX_LEVEL。
   *
   * **「アメ在庫＋睡眠」では利用可能在庫でも止める（2026-08-25 ユーザー指摘）。** 個数指定 `m` は
   * 実際に使うアメ数から決まる一方、入力上限は上位行の取り分を除いた在庫を見る。以前は在庫を見ずに
   * MAX_LEVEL 基準の上限だけを見ていたので、在庫256の行に400と入力でき、欄は400のまま結果だけ
   * 256になった（`resolveEffectiveBoostCandy` の `candyBudget` が実効値だけを絞るため）。
   * 入力の上限と実際に使える量は同じ値であるべきなので、ここでも在庫を掛ける。
   */
  function maxBoostCandyInputFor(r: CalcRow): number {
    if (r.sleepTargetMode === "all" || boostKind.value === "none" || r.srcLevel >= MAX_LEVEL) return 0;
    const base = (() => {
      if (r.sleepTargetHours === undefined) return boostCandyToMaxLevel(r);
      // 個数指定ありでは最終目標 T は (m, n) の出力。T から戻した T' を n の上限へ
      // 再利用すると、入力のたびに 25→38→44…と上限が動く循環になる。
      // Lv70 から睡眠EXPを戻した T'max は T に依存しないため、直接入力の上限に使える。
      const target = r.candyTarget !== undefined
        ? locateExpTargetFromSrc(r, rowExpGot(r), rowSleepExp(r))
        : rowCandyTargetBeforeSleep(r);
      if (target === null) return 0;
      return calcExpAndCandy({
        srcLevel: r.srcLevel,
        dstLevel: target.level,
        dstExpInLevel: target.expInLevel,
        expType: r.expType,
        nature: r.nature,
        boost: boostKind.value,
        expGot: rowExpGot(r),
      }).candy;
    })();
    // 循環しない: stock の配分計算は `resolveEffectiveBoostCandy(…, ignoreStockBudget)` だけを
    // 呼び、そちらはこの関数を参照しない。
    if (r.sleepTargetMode === "stock") {
      const stockCandyAvailable = rowStockCandyAvailableFor(r.id);
      // 在庫上限を求められない行は0個扱いにしない。
      return stockCandyAvailable === undefined ? base : Math.min(base, stockCandyAvailable);
    }
    return base;
  }

  /**
   * その行を MAX_LEVEL まで全部アメブで育てるのに必要な個数。
   *
   * アメブ個数入力の上限として使う。これを超えて入れても育成に使いようがない、という
   * 意味だけの上限であり、**アメブ在庫（グローバル上限）も他行の使用量も見ていない**。
   * 在庫を超える指定は許す（§10.2）。「目標まで」行を理論値として使えることが目的で、
   * 設定を変えずに「ミニブ2回分＝700個」のような試算ができる。
   * 実配分で枠が足りない分は通常アメへ置き換わり、`shortage.boostCandyUnavailable` として
   * 赤字表示される（アメブ個数欄の枠線と結果行の両方）。
   *
   * 個数指定 m でもクランプしない。アメブを増やす操作ではアメブが駆動側で、
   * m を超えた分は m の方を引き上げる（onRowBoostCandy）。
   */
  function boostCandyToMaxLevel(r: CalcRow): number {
    if (boostKind.value === "none") return 0;
    if (r.srcLevel >= MAX_LEVEL) return 0;
    return calcExpAndCandy({
      srcLevel: r.srcLevel, dstLevel: MAX_LEVEL, dstExpInLevel: 0,
      expType: r.expType, nature: r.nature, boost: boostKind.value, expGot: rowExpGot(r),
    }).candy;
  }

  /**
   * 「アメブ目標Lv = reachLevel」を賄うアメブ個数。
   *
   * **アメブが賄うのは Lv ちょうどまでで、目標の Lv 内EXP（端数）は常に通常アメの担当。**
   * 端数までアメブに賄わせる分岐（旧 `coverTargetExp`）は廃止した
   * （2026-08-15 ユーザー規則。§15.7 / §15.8 の端数賄いを撤回）。
   * あれは同じ `reachLevel` を「アメブ担当なし」とも「端数まで全部アメブ」とも解釈できてしまい、
   * `T` を導出する経路（`derivingTarget`）と表示・ソルバーの経路とで導出値が食い違っていた。
   * 個数指定 m だけを入れた行（アメブ未入力・アメブ目標Lv = 現在Lv）で、m から作った目標の端数を
   * 賄うアメブが勝手に湧き、m 個の到達点が目標を超える不整合になっていた。
   * 端数までアメブで賄いたい場合はユーザーがアメブ個数を明示入力する（入力上限
   * `maxBoostCandyInputFor` は端数込みのままなので、今までどおり入力できる）。
   *
   * 「アメブ1個 → 通常アメ1個」置換（§3.8-e）は残す。当てる条件は2つある。
   *
   * 1. アメブが担当範囲全体を賄う。最後のはみ出しEXPが余剰になるので、1個を通常アメへ回せば
   *    かけらを節約できる。アメブ目標Lvが担当範囲より下（その先を通常アメで続ける）ときに1個削ると、
   *    アメブ分が実際に reachLevel へ届かず、不足を通常アメで補うぶん総アメ数も増えて損になる
   * 2. **睡眠EXPが乗らない行である**（2026-07-30 ユーザー規則・§15.8）。睡眠がある行では
   *    担当終端 `T'` を超えたEXPが捨てられず最終目標へ効くため、置換の前提が成立しない
   */
  function boostCandyForReachLevel(
    r: CalcRow,
    reachLevel: number,
    dstLevel: number,
    dstExpInLevel: number,
  ): number {
    const shared = { srcLevel: r.srcLevel, expType: r.expType, nature: r.nature, expGot: rowExpGot(r) };
    // 目標がLvの途中（あとEXP付き）なら、同じLvへ届いてもアメブは目標全体を賄えない。
    // 端数は通常アメの担当なので、置換の前提（最後のはみ出しEXPが捨てられる）も成立しない。
    // `reachLevel` は呼び出し側で目標Lv以下へクランプ済みなので、ここで `>` は起こらない。
    const coversWholeTarget = reachLevel === dstLevel && dstExpInLevel === 0;
    return coversWholeTarget
      ? minBoostForTarget({
        ...shared,
        targetLevel: reachLevel,
        targetExpInLevel: 0,
        boostKind: boostKind.value, maxBoost: Number.MAX_SAFE_INTEGER,
        allowNormalSwap: rowSleepExp(r) === 0,
      })
      : calcExpAndCandy({ ...shared, dstLevel: reachLevel, dstExpInLevel: 0, boost: boostKind.value }).candy;
  }

  function indexOfRow(id: string): number {
    return rows.value.findIndex((x) => x.id === id);
  }
  function moveRow(fromId: string, toIndex: number) {
    const from = indexOfRow(fromId);
    if (from < 0) return;
    const row = rows.value[from]!;
    const next = [...rows.value];
    const [item] = next.splice(from, 1);
    const idx = Math.max(0, Math.min(next.length, toIndex));
    next.splice(idx, 0, item);
    // ドラッグ中だけまとめる。ボタン（↑↓）の連打は別々の操作なので1クリックずつ積む。
    commitRows(next, t("calc.undoLabel.rowOrder", { name: row.title }), dragRowId.value === null
      ? {}
      : { coalesceKey: `rowDrag:${rowDragSession}`, coalesceWindowMs: Number.POSITIVE_INFINITY });
  }
  function canMoveRowUp(id: string): boolean {
    const i = indexOfRow(id);
    return i > 0;
  }
  function canMoveRowDown(id: string): boolean {
    const i = indexOfRow(id);
    return i >= 0 && i < rows.value.length - 1;
  }
  function moveRowUp(id: string) {
    const i = indexOfRow(id);
    if (i <= 0) return;
    moveRow(id, i - 1);
  }
  function moveRowDown(id: string) {
    const i = indexOfRow(id);
    if (i < 0 || i >= rows.value.length - 1) return;
    moveRow(id, i + 1);
  }

  function calcRowExpGot(r: CalcRow): { toNext: number; expGot: number; expRemaining: number } {
    const toNext = Math.max(0, calcExp(r.srcLevel, r.srcLevel + 1, r.expType));
    // expRemaining === 0 は「次Lvまで残り0 = 既にレベルアップ済み」で論理矛盾。
    // 0 および undefined は toNext（そのLvの最大値 = レベルアップ直後）として扱う。
    const raw = r.expRemaining;
    const remaining = (raw === undefined || raw === 0) ? toNext : clampInt(raw, 1, toNext, toNext);
    if (toNext <= 0) return { toNext: 0, expGot: 0, expRemaining: remaining };
    const got = toNext - remaining;
    return { toNext, expGot: Math.max(0, Math.min(got, toNext)), expRemaining: remaining };
  }

  function calcRowView(r: CalcRow, availableBoostCandy: number) {
    const src = clampInt(r.srcLevel, 1, MAX_LEVEL, 1);
    const dstFromText =
      typeof r.dstLevelText === "string" && r.dstLevelText.trim() !== "" ? clampInt(r.dstLevelText, 1, MAX_LEVEL, r.dstLevel) : null;
    const dst = clampInt(dstFromText ?? r.dstLevel, src, MAX_LEVEL, src);
    const expT = r.expType;
    const nat = r.nature;
    const expInfo = calcRowExpGot({ ...r, srcLevel: src, dstLevel: dst, expType: expT, nature: nat });
    const expGot = expInfo.expGot;
    // 最終目標のLv内EXP。個数指定なしの行は常に 0（目標は Lv ちょうど。§4.5）。
    const dstExpInLevel = rowTargetExpInLevel({ ...r, dstLevel: dst });

    // ─────────────────────────────────────────────────────────────
    // boostCandyPeak を computed 化
    // 現在の boostKind と目標Lv から必要なアメ数を計算
    // ─────────────────────────────────────────────────────────────
    let computedPeak: number;
    // 通常モードの混合計算は「あとEXP」でも同じ引数で必要になるので、結果を使い回す
    let noneModeMixed: ReturnType<typeof calcExpAndCandyMixed> | null = null;
    if (src === dst && dstExpInLevel === 0) {
      computedPeak = 0;
    } else if (boostKind.value === "none") {
      // 通常モード: 通常アメの必要数
      noneModeMixed = calcExpAndCandyMixed({
        srcLevel: src,
        dstLevel: dst,
        dstExpInLevel,
        expType: expT,
        nature: nat,
        boost: "none",
        boostCandy: 0,
        expGot,
      });
      computedPeak = noneModeMixed.normalCandy;
    } else {
      // イベント時（full/mini）: アメブの必要数
      const res = calcExpAndCandy({
        srcLevel: src,
        dstLevel: dst,
        dstExpInLevel,
        expType: expT,
        nature: nat,
        boost: boostKind.value,
        expGot,
      });
      computedPeak = res.candy;
    }

    // ─────────────────────────────────────────────────────────────
    // ui.boostCandyInput: 明示値または保存された到達意図から導出
    // ─────────────────────────────────────────────────────────────
    // 未入力は正規状態。保存値・planner・UIの読み口を resolveEffectiveBoostCandy に統一する。
    const uiCandy = resolveEffectiveBoostCandy(r);
    // グローバル残枠を超えているか。**ソルバーの shortage を待たずここで同期に出す**
    // （planner は debounce されるため、打鍵に対して赤枠が遅れる）。
    const boostQuotaViolation: 'count' | 'reach' | null =
      boostKind.value !== "none" && uiCandy > Math.max(0, availableBoostCandy)
        ? (r.boostOrExpAdjustment === undefined ? 'reach' : 'count')
        : null;

    // ui.boostReachLevel: 「アメブでどこまで賄うか」という保存された意図をそのまま出す。
    //
    // アメブ個数から逆算してはいけない。「アメブ1個 → 通常アメ1個」置換（§3.8-e）は
    // 最後の1個を通常アメへ回すかけら節約なので、逆算すると必ず1段下がって見え、
    // スライダーで上げても表示が戻る（上げ操作を食う）。
    // 目標Lvを超えるアメブ設定も許容するため、上限は MAX_LEVEL でクランプする。
    const normalizedRow = { ...r, srcLevel: src, dstLevel: dst };
    const boostReachLevelMax = boostReachLevelCapFor(normalizedRow);
    const uiBoostReachLevel = r.boostOrExpAdjustment !== undefined
      ? clampInt(
        calcLevelByCandy({
          srcLevel: src, dstLevel: MAX_LEVEL, expType: expT, nature: nat,
          boost: boostKind.value, candy: uiCandy, expGot,
        }).level,
        src, boostReachLevelMax, src,
      )
      : clampInt(
        // **目標Lvでも収める**（§10.18「保存値は意図として残し、表示と計算では
        // `min(boostReachLevel, dstLevel)` を使う」）。保存値は端数を賄うために目標Lvより
        // 1 大きいことがあるので、ここで収めないと「目標Lv40 の行にアメブ目標Lv41」が出る。
        Math.min(r.boostReachLevel ?? dst, dst, boostReachLevelMax),
        src, boostReachLevelMax, src,
      );
    // 頭打ちの判定は入力を受け付けるかどうかと同じ上限を使う。
    // 表示だけ別条件にすると、案内が出ていないのに入力が無視される行ができる。
    // 案内（capActive）は**この画面に出ている値と上限**で判定する。ストア側で上限を計算し直すと、
    // 表示は上限未満なのに案内だけ出る、という食い違いが生まれる。
    const boostCapActive = isBoostCapActive(normalizedRow, uiBoostReachLevel, boostReachLevelMax);
    const boostCapKind = boostCapKindFor(normalizedRow, boostCapActive);
    const boostSleepCapped = isBoostSleepCapped(normalizedRow);
    const boostInputDisabled = isBoostInputDisabledBySleep(normalizedRow);

    const resolvedTitle =
      r.boxId && resolveTitleByBoxId ? resolveTitleByBoxId(r.boxId) ?? (String(r.title ?? "").trim() || "(no name)") : String(r.title ?? "").trim() || "(no name)";

    // 目標Lvラベル横の「あとEXP」。
    //
    // 2つの個数指定も睡眠目標もない行は、最小アメを入れたときの実到達点から出す。
    // 目標は Lv ちょうどでも ceil の余剰EXPで少し行き過ぎるので、その地点の方が有用
    //（§4.5「Lvちょうど ≠ あとEXP 0」）。planner の「目標まで」行と同じ地点だが、
    // あちらは debounce されるため、再計算のあいだ古い値が一瞬出る。ここで同期計算して段差をなくす。
    //
    // それ以外は保存された最終目標から出す。「目標まで」行はアメを使い終えた地点で睡眠EXPを含まないため、
    // 睡眠がある行でそれを使うと Lv と あとEXP が別地点を指す（§4.5.1）。
    const targetExpToNextLevel = (
      r.candyTarget === undefined
      && r.boostOrExpAdjustment === undefined
      && r.sleepTargetMode === undefined
      && r.sleepTargetHours === undefined
    )
      ? (noneModeMixed ?? calcExpAndCandyMixed({
        srcLevel: src, dstLevel: dst, dstExpInLevel: 0, expType: expT, nature: nat,
        boost: boostKind.value,
        // アメブは総アメ数の内数。目標到達に必要な全アメブ数（computedPeak）でクランプする
        boostCandy: boostKind.value === "none" ? 0 : Math.min(uiCandy, computedPeak),
        expGot,
      })).expLeftNext
      : Math.max(0, calcExp(dst, dst + 1, expT) - dstExpInLevel);

    return {
      title: resolvedTitle,
      normalized: { srcLevel: src, dstLevel: dst, dstExpInLevel, expRemaining: expInfo.expRemaining },
      targetExpToNextLevel,
      ui: {
        boostCandyInput: uiCandy,
        boostReachLevel: uiBoostReachLevel,
        boostReachLevelMax,
        boostCandyInputMax: maxBoostCandyInputFor(r),
        boostCapActive,
        boostCapKind,
        boostSleepCapped,
        boostInputDisabled,
        boostQuotaViolation,
      },
    };
  }

  const rowsView = computed(() => {
    let remainingBoostCandy = autoBoostCandyCap();
    return rows.value.map((r) => {
      const v = calcRowView(r, remainingBoostCandy);
      remainingBoostCandy = Math.max(0, remainingBoostCandy - v.ui.boostCandyInput);
      return {
        ...r,
        title: v.title,
        srcLevel: v.normalized.srcLevel,
        dstLevel: v.normalized.dstLevel,
        dstExpInLevel: v.normalized.dstExpInLevel,
        expRemaining: v.normalized.expRemaining,
        targetExpToNextLevel: v.targetExpToNextLevel,
        // boostCandyPeak は rows の値をそのまま使用（上書きしない）
        ui: v.ui,
      };
    });
  });

  const exportOpen = ref(false);
  function openExport() {
    if (!rowsView.value.length || planResultPending.value || !planResult.value) return;
    exportOpen.value = true;
  }
  function closeExport() {
    exportOpen.value = false;
  }

  function natureLabel(n: ExpGainNature): string {
    if (n === "up") return "▲▲";
    if (n === "down") return "▼▼";
    return "";
  }

  const exportRows = computed(() => {
    if (!planResult.value) return [];
    return rowsView.value.map((r) => {
      const p = getPokemonResult(r.id);
      if (!p) return null;

      // 実使用（reachableLine）ベースの値を使用
      const boostCandy = p.reachableLine.boostedCandyUnits;
      const normalCandy = p.reachableLine.nonBoostCandyUnits;
      const shards = p.reachableLine.dreamShardsUsed;
      const supply = p.reachableLine.candySupply;

      // アメ補填情報
      const parts: string[] = [];
      if (supply.type.m > 0) parts.push(`${t("calc.candy.typeAbbr")}M${supply.type.m}`);
      if (supply.type.s > 0) parts.push(`${t("calc.candy.typeAbbr")}S${supply.type.s}`);
      if (supply.universal.l > 0) parts.push(`${t("calc.candy.uniAbbr")}L${supply.universal.l}`);
      if (supply.universal.m > 0) parts.push(`${t("calc.candy.uniAbbr")}M${supply.universal.m}`);
      if (supply.universal.s > 0) parts.push(`${t("calc.candy.uniAbbr")}S${supply.universal.s}`);
      const candySupply = parts.join(" ");

      return {
        id: r.id,
        title: String(r.title ?? "").trim() || "(no name)",
        natureLabel: natureLabel(r.nature),
        srcLevel: r.srcLevel,
        // 出力先Lvは睡眠後の最終目標を出す（アメ終了地点ではない。設計書§6.4）
        dstLevel: p.targetLevel,
        boostCandy,
        normalCandy,
        totalCandy: boostCandy + normalCandy,
        shards,
        candySupply,
      };
    }).filter((x): x is NonNullable<typeof x> => x !== null);
  });

  const exportActualTotals = computed(() => {
    if (!planResult.value) return { boostCandy: 0, normalCandy: 0, totalCandy: 0, shards: 0 };
    const boostCandy = planResult.value.summary.totalSupplied.totalBoostedCandyUnits;
    const normalCandy = planResult.value.summary.totalSupplied.totalNonBoostCandyUnits;
    const shards = planResult.value.summary.totalSupplied.totalDreamShards;
    return { boostCandy, normalCandy, totalCandy: boostCandy + normalCandy, shards };
  });

  const debugExportEnabled = PLAN_RESULT_EXACT_VERIFICATION_ENABLED;

  /**
   * 検算TSV用の睡眠EXP中間値（?perf=1）。
   * 「計画した日数」と「残EXPから逆算した必要日数」を並べ、どこで食い違うか切り分けられるようにする。
   */
  function buildDebugSleepRow(row: CalcRow, plan: PokemonPlanResult | null): DebugExportSleepRow | undefined {
    // 残EXPから逆算した所要睡眠。お香の個数と最終日の扱いもこれが正本（画面の必要アイテムと同じ経路）。
    const needed = plan === null ? undefined : calcSleepTimeForRow(row.id, plan.shortage.expToTarget);
    const incense = needed !== undefined && isSleepPlan(needed)
      ? { growthIncenseCount: needed.growthIncenseCount, skipsLastDayIncense: needed.skipsLastDayIncense }
      : {};

    if (row.sleepTargetHours !== undefined) {
      const sleep = rowMarkForSleep(row);
      if (!sleep) return undefined;
      return {
        sleepTargetHours: row.sleepTargetHours,
        sleepHours: row.sleepHours ?? 0,
        remainingHours: sleep.remainingHours,
        requiredDays: sleep.mark.requiredDays,
        sleepExp: sleep.mark.sleepExp,
        breakdown: sleep.mark.breakdown,
        ...incense,
        needed,
      };
    }

    // 「すべて睡眠 / アメ在庫＋睡眠」は残EXPから必要日数を逆算する行。計画睡眠EXPは持たない（§2.3）が、
    // その日数を寝きるとどの日にいくら入るかは検算に要るので、日数から内訳を引き直す。
    if (row.sleepTargetMode === undefined) return undefined;
    const days = needed && isSleepPlan(needed) ? needed.requiredDays : 0;
    const s = sleepSettings.value;
    try {
      const breakdown = calcSleepExpBreakdownForDays({
        days,
        dailySleepMinutes: Math.round(s.dailySleepHours * 60),
        sleepExpBonus: sleepExpBonusMultiplier(s.sleepExpBonusCount),
        nature: row.nature,
        schedule: sleepSchedule.value,
      });
      return {
        requiredDays: days,
        sleepExp: breakdown.sleepExp,
        breakdown,
        ...incense,
        needed,
      };
    } catch (error) {
      recordSleepCalculationError(error);
      return undefined;
    }
  }

  function buildDebugExportContext(): DebugExportContext {
    const displayed = displayedPlanResult.value;
    const profile = calculationPerformanceProfile.value;
    return {
      result: planResult.value,
      rows: rowsView.value.map(row => {
        const plan = getPokemonResult(row.id);
        const pokedexId = plan?.pokedexId ?? getRowPokedexId(row);
        return {
          id: row.id,
          name: row.title,
          pokedexId,
          candyFamilyKey: pokedexId ? getCandyFamilyKey(pokedexId) : undefined,
          type: row.pokemonType || (pokedexId ? getPokemonType(pokedexId) : ""),
          nature: row.nature,
          expType: row.expType,
          currentLevel: row.srcLevel,
          currentExpInLevel: Math.max(0, calcExp(row.srcLevel, row.srcLevel + 1, row.expType) - row.expRemaining),
          expRemaining: row.expRemaining,
          targetLevel: row.dstLevel,
          targetExpInLevel: plan?.targetExpInLevel,
          candyTarget: row.candyTarget,
          sleepTargetMode: row.sleepTargetMode,
          sleep: buildDebugSleepRow(row, plan),
          plan,
        };
      }),
      itemCompareMode: itemCompareMode.value,
      // inventorySnapshot.value is a Vue reactive proxy and cannot be passed
      // directly to structuredClone in browsers. getInventory() returns a
      // detached plain object suitable for the debug export DTO.
      inventorySnapshot: candyStore.getInventory(),
      boost: {
        kind: boostKind.value,
        limit: boostCandyRemaining.value ?? boostCandyDefaultCap.value,
      },
      dreamShards: shardsCap.value,
      sleepSettings: { ...sleepSettings.value },
      sleepSchedule: sleepSchedule.value,
      wikiKnownThrough,
      projectedEventCount: projectedOccurrences.value.length,
      currentGameDate: currentGameDate.value,
      debugNow: debugNowText.value,
      sleepCalculationError: sleepCalculationError.value,
      displayed: displayed ? {
        result: displayed.result,
        calculationMode: displayed.calculationMode,
        loss: displayed.loss,
        durationMs: displayed.durationMs,
        mixedPrefixCount: displayed.mixedPrefixCount,
        mixedSource: displayed.mixedSource,
      } : null,
      performanceProfile: {
        policy: profile.policy,
        structuralProbeStatus: profile.structuralProbeStatus,
        lastDeadlineMs: profile.lastDeadlineMs,
        mixedPrefixCount: profile.mixedPrefixCount,
      },
      verificationMode: "normalPathSnapshot",
    };
  }

  async function buildDebugExportTsv(): Promise<string> {
    const context = buildDebugExportContext();
    const { buildDebugExportTsv: formatDebugExportTsv } = await loadDebugExportModule();
    return formatDebugExportTsv(context);
  }

  function downloadDebugExportTsv(text: string): boolean {
    try {
      const blob = new Blob([text], { type: "text/tab-separated-values;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      anchor.href = url;
      anchor.download = `level-planner-debug-${timestamp}.tsv`;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch {
      return false;
    }
  }

  async function copyDebugExportTsv(): Promise<DebugExportResult> {
    if (!debugExportEnabled) return "failed";
    const text = await buildDebugExportTsv();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return "copied";
      }
    } catch {
      // fall through to textarea and file fallback
    }
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (ok) return "copied";
    } catch {
      // fall through to file fallback
    }
    return downloadDebugExportTsv(text) ? "downloaded" : "failed";
  }

  // 実使用ベースのかけら合計 (planResult から取得)
  const totalShardsUsed = computed(() => planResult.value?.summary.totalSupplied.totalDreamShards ?? 0);
  const shardsCap = computed(() => Math.max(0, Math.floor(Number(totalShards.value) || 0)));
  const shardsOver = computed(() => totalShardsUsed.value - shardsCap.value);
  const shardsUsedPct = computed(() => (shardsCap.value > 0 ? (totalShardsUsed.value / shardsCap.value) * 100 : 0));
  const shardsUsagePctRounded = computed(() => (shardsCap.value > 0 ? Math.round(shardsUsedPct.value) : 0));
  const showShardsFire = computed(() => shardsCap.value > 0 && totalShardsUsed.value > shardsCap.value);
  const shardsFillPctForBar = computed(() => {
    const cap = shardsCap.value;
    const used = Math.max(0, totalShardsUsed.value);
    if (cap <= 0) return 0;
    if (used <= cap) return Math.min(100, Math.max(0, (used / cap) * 100));
    return Math.min(100, Math.max(0, (cap / Math.max(1, used)) * 100));
  });
  const shardsOverPctForBar = computed(() => {
    const cap = shardsCap.value;
    const used = Math.max(0, totalShardsUsed.value);
    if (cap <= 0 || used <= cap) return 0;
    return Math.min(100, Math.max(0, 100 - shardsFillPctForBar.value));
  });

  // 実使用ベースのアメブ合計 (planResult から取得)
  const totalBoostCandyUsed = computed(() => planResult.value?.summary.totalSupplied.totalBoostedCandyUnits ?? 0);
  // アメブ種別による上限（デフォルト値）
  const boostCandyDefaultCap = computed(() => {
    if (boostKind.value === "mini") return 350;
    if (boostKind.value === "none") return 0;
    return 3500;
  });
  // 実際に使う上限（手入力の残数があればそれを使う）
  const boostCandyCap = computed(() => boostCandyRemaining.value ?? boostCandyDefaultCap.value);
  const boostCandyOver = computed(() => totalBoostCandyUsed.value - boostCandyCap.value);
  const boostCandyUnused = computed(() => Math.max(0, boostCandyCap.value - totalBoostCandyUsed.value));
  /**
   * 指定したのに枠が回らなかったアメブの合計。
   *
   * `boostCandyOver` は「実使用 − 上限」だが、ソルバーは必ず上限内へ収めるので**常に0以下**であり、
   * 「全体で枠が足りない」状態を表現できない。行ごとの `shortage.boostCandyUnavailable`
   * （＝要求量 − その行に回ってきた残枠）を合計すると、指定合計が上限を超えた量と一致する。
   * 例: 上限350 で A=200 / B=200 / C=200 → 超過250 ＝ B不足50 ＋ C不足200。
   */
  const boostCandyShortageTotal = computed(() =>
    (planResult.value?.pokemonResults ?? []).reduce(
      (sum, p) => sum + Math.max(0, p.shortage.boostCandyUnavailable),
      0,
    ),
  );
  const boostCandyUsedPct = computed(() => (boostCandyCap.value > 0 ? (totalBoostCandyUsed.value / boostCandyCap.value) * 100 : 0));
  const boostCandyUsagePctRounded = computed(() => (boostCandyCap.value > 0 ? Math.round(boostCandyUsedPct.value) : 0));
  const showBoostCandyFire = computed(() => boostCandyCap.value > 0 && totalBoostCandyUsed.value > boostCandyCap.value);
  const boostCandyFillPctForBar = computed(() => {
    const cap = boostCandyCap.value;
    const used = Math.max(0, totalBoostCandyUsed.value);
    if (cap <= 0) return 0;
    if (used <= cap) return Math.min(100, Math.max(0, (used / cap) * 100));
    return Math.min(100, Math.max(0, (cap / Math.max(1, used)) * 100));
  });
  const boostCandyOverPctForBar = computed(() => {
    const cap = boostCandyCap.value;
    const used = Math.max(0, totalBoostCandyUsed.value);
    if (cap <= 0 || used <= cap) return 0;
    return Math.min(100, Math.max(0, 100 - boostCandyFillPctForBar.value));
  });

  // --- 選択中ポケモンの使用量（バー表示用） ---
  // planResult から取得
  const activeRowShardsUsed = computed(() => {
    const activeId = activeRowId.value;
    if (!activeId || !planResult.value) return 0;
    const p = planResult.value.pokemonResults.find(p => p.pokemonId === activeId);
    return p?.reachableLine.dreamShardsUsed ?? 0;
  });
  const activeRowBoostCandyUsed = computed(() => {
    const activeId = activeRowId.value;
    if (!activeId || !planResult.value) return 0;
    const p = planResult.value.pokemonResults.find(p => p.pokemonId === activeId);
    return p?.reachableLine.boostedCandyUnits ?? 0;
  });

  // バー用: 選択中ポケモン分のかけら%（超過がない場合のみ正しく表示）
  const activeRowShardsFillPct = computed(() => {
    const cap = shardsCap.value;
    if (cap <= 0) return 0;
    const total = totalShardsUsed.value;
    const active = activeRowShardsUsed.value;
    // 超過がある場合はバー全体に対する比率を計算
    if (total > cap) {
      return (active / total) * (shardsFillPctForBar.value + shardsOverPctForBar.value);
    }
    return Math.min(100, (active / cap) * 100);
  });

  // バー用: 他ポケモン分のかけら%
  const otherRowsShardsFillPct = computed(() => {
    const cap = shardsCap.value;
    if (cap <= 0) return 0;
    const total = totalShardsUsed.value;
    const other = total - activeRowShardsUsed.value;
    // 超過がある場合はバー全体に対する比率を計算
    if (total > cap) {
      return (other / total) * (shardsFillPctForBar.value + shardsOverPctForBar.value);
    }
    return Math.min(100, (other / cap) * 100);
  });

  // バー用: 選択中ポケモン分のブーストアメ%
  const activeRowBoostCandyFillPct = computed(() => {
    const cap = boostCandyCap.value;
    if (cap <= 0) return 0;
    const total = totalBoostCandyUsed.value;
    const active = activeRowBoostCandyUsed.value;
    if (total > cap) {
      return (active / total) * (boostCandyFillPctForBar.value + boostCandyOverPctForBar.value);
    }
    return Math.min(100, (active / cap) * 100);
  });

  // バー用: 他ポケモン分のブーストアメ%
  const otherRowsBoostCandyFillPct = computed(() => {
    const cap = boostCandyCap.value;
    if (cap <= 0) return 0;
    const total = totalBoostCandyUsed.value;
    const other = total - activeRowBoostCandyUsed.value;
    if (total > cap) {
      return (other / total) * (boostCandyFillPctForBar.value + boostCandyOverPctForBar.value);
    }
    return Math.min(100, (other / cap) * 100);
  });

  // 選択中ポケモンの使用率（%表示用、超過時は100%を超える）
  const activeRowShardsUsagePct = computed(() => {
    const cap = shardsCap.value;
    if (cap <= 0) return 0;
    return Math.round((activeRowShardsUsed.value / cap) * 100);
  });
  const activeRowBoostCandyUsagePct = computed(() => {
    const cap = boostCandyCap.value;
    if (cap <= 0) return 0;
    return Math.round((activeRowBoostCandyUsed.value / cap) * 100);
  });

  // --- アメ配分計算 ---（在庫の入り口は `candyStore`。宣言は行より前にある）

  function updateUniversalCandy(candy: Partial<UniversalCandyInventory>) {
    const current = candyStore.universalCandy.value;
    const changed = (candy.s !== undefined && candy.s !== current.s)
      || (candy.m !== undefined && candy.m !== current.m)
      || (candy.l !== undefined && candy.l !== current.l);
    if (!changed) return;
    beginUndo(t("calc.undoLabel.candyInventory"), ["candyInventory"]);
    candyStore.updateUniversalCandy(candy);
  }

  function updateTypeCandy(typeName: string, candy: Partial<TypeCandyInventory>) {
    const current = candyStore.getTypeCandyFor(typeName);
    const changed = (candy.s !== undefined && candy.s !== current.s)
      || (candy.m !== undefined && candy.m !== current.m);
    if (!changed) return;
    beginUndo(t("calc.undoLabel.candyInventory"), ["candyInventory"]);
    candyStore.updateTypeCandy(typeName, candy);
  }

  function updateSpeciesCandy(pokedexId: number, count: number) {
    if (candyStore.getSpeciesCandyFor(pokedexId) === count) return;
    beginUndo(t("calc.undoLabel.candyInventory"), ["candyInventory"]);
    candyStore.updateSpeciesCandy(pokedexId, count);
  }

  // 行から pokedexId を取得（保存済み or boxId から解決）
  function getRowPokedexId(r: Pick<CalcRow, "pokedexId" | "boxId">): number | undefined {
    if (r.pokedexId) return r.pokedexId;
    if (r.boxId && resolvePokedexIdByBoxId) {
      return resolvePokedexIdByBoxId(r.boxId);
    }
    return undefined;
  }

  // ─────────────────────────────────────────────────────────────
  // planResult (新フェーズベースのレベルアップ計画)
  // ─────────────────────────────────────────────────────────────

  function buildPlannerInput(): LevelPlannerInput | null {
    return buildLevelPlannerInput(rowsView.value.map(row => ({
      id: row.id,
      pokedexId: getRowPokedexId(row),
      title: row.title,
      pokemonType: row.pokemonType,
      srcLevel: row.srcLevel,
      dstLevel: row.dstLevel,
      dstExpInLevel: row.dstExpInLevel,
      expRemaining: row.expRemaining,
      expType: row.expType,
      nature: row.nature,
      boostReachLevel: row.boostReachLevel,
      candyTarget: row.candyTarget,
      boostCandyInput: row.ui.boostCandyInput,
      sleepExp: rowSleepExp(row),
      sleepTargetMode: row.sleepTargetMode,
      stockCandyTarget: rowStockCandyTargetFor(row.id),
    })), {
      candyInventory: candyStore.getInventory(),
      dreamShards: shardsCap.value,
      boost: {
        kind: boostKind.value,
        limit: boostCandyRemaining.value ?? boostCandyDefaultCap.value,
      },
      itemCompareMode: itemCompareMode.value,
    });
  }
  /**
   * レベルアップ計画結果
   *
   * solveLevelPlan は重いため computed 内で同期実行しない。
   * 連続した入力変更は debounce して、最後の入力だけを計算する。
   */
  const planResult = ref<LevelPlannerResult | null>(null);
  const planResultPending = ref(false);
  const displayedPlanResult = ref<DisplayedPlanResult | null>(null);
  const defaultCalculationPerformanceProfile = (): CalculationPerformanceProfile => ({ policy: 'autoExact', structuralProbeStatus: 'idle', exactResultStale: false });
  const calculationPerformanceProfile = ref<CalculationPerformanceProfile>(defaultCalculationPerformanceProfile());
  const calculationPolicy = computed(() => calculationPerformanceProfile.value.policy);
  const structuralProbeStatus = computed(() => calculationPerformanceProfile.value.structuralProbeStatus);
  const showFastCalculation = computed(() => displayedPlanResult.value?.calculationMode === 'prefixLocalMixed');
  const showExactImprovementHint = computed(() => PLAN_RESULT_EXACT_VERIFICATION_ENABLED && showFastCalculation.value && Boolean(displayedPlanResult.value?.loss));
  const showManualExactVerification = computed(() => PLAN_RESULT_EXACT_VERIFICATION_ENABLED && typeof Worker !== 'undefined' && showFastCalculation.value);
  const slotProfiles = new Map<string, CalculationPerformanceProfile>();
  const slotDisplayedResults = new Map<string, DisplayedPlanResult>();
  let planResultTimer: ReturnType<typeof setTimeout> | null = null;
  let planResultWorker: Worker | null = null;
  let manualExactWorker: Worker | null = null;
  let manualExactSlotId: string | null = null;
  let planResultWorkerBusy = false;
  let releasePlanResultPersistDeferral: (() => void) | null = null;
  let releaseManualExactPersistDeferral: (() => void) | null = null;
  let planResultRequestId = 0;
  let manualExactRequestId = 0;
  let planResultHasDispatched = false;
  let displayGeneration = 0;
  let previousInputSignature: string | null = null;
  let previousStructureSignature: string | null = null;
  let previousProbeSignature: string | null = null;
  let previousSlotId: string | null = null;
  let activeAutoContext: { slotId: string; inputSignature: string; input: LevelPlannerInput; generation: number; probe: boolean; calculationMode: CalculationMode } | null = null;

  function currentSlotId(): string {
    return slots.value[activeSlotTab.value]?.slotId ?? `empty-slot-${activeSlotTab.value}`;
  }

  function disposePlanResultWorker(): void {
    planResultWorker?.terminate();
    planResultWorker = null;
    planResultWorkerBusy = false;
    releasePlanResultPersistDeferral?.();
    releasePlanResultPersistDeferral = null;
  }

  function updateProfile(patch: Partial<CalculationPerformanceProfile>, slotId = currentSlotId()): void {
    const base = slotProfiles.get(slotId)
      ?? (slotId === currentSlotId() ? calculationPerformanceProfile.value : defaultCalculationPerformanceProfile());
    const next = { ...base, ...patch };
    if (slotId === currentSlotId()) calculationPerformanceProfile.value = next;
    slotProfiles.set(slotId, next);
  }

  function applyDisplayedResult(result: LevelPlannerResult, context: { slotId: string; inputSignature: string; calculationMode: CalculationMode; durationMs: number; mixedPrefixCount?: number; mixedSource?: MixedCalculationMeta['source'] }): void {
    const displayed: DisplayedPlanResult = { result, slotId: context.slotId, inputSignature: context.inputSignature, calculationMode: context.calculationMode, loss: result.lossLedger.hasLoss, durationMs: context.durationMs, mixedPrefixCount: context.mixedPrefixCount, mixedSource: context.mixedSource };
    planResult.value = result;
    displayedPlanResult.value = displayed;
    slotDisplayedResults.set(context.slotId, displayed);
    logSleepExpBreakdown();
  }

  /**
   * 睡眠EXPの中間値をコンソールへ出す（?perf=1 のときだけ）。
   *
   * 画面には個数指定と必要日数という下流の結果しか出ないため、どの段階で食い違うか切り分けられない。
   * `dailyExp` はゲームで一晩寝れば確かめられるので、そこを起点に検算できる。
   * 検算TSVの SLEEP_EXP セクションと同じ値を、コピペせずに読めるようにしたもの。
   */
  function logSleepExpBreakdown(): void {
    if (!PLAN_RESULT_PERF_ENABLED) return;
    const sleepRows = rowsView.value.filter(rowHasSleepPlan);
    if (!sleepRows.length) return;

    const s = sleepSettings.value;
    console.info('[perf] sleep.settings', {
      currentGameDate: currentGameDate.value,
      debugNow: debugNowText.value,
      timeZone: s.timeZone,
      dailySleepHours: s.dailySleepHours,
      sleepExpBonusCount: s.sleepExpBonusCount,
      sleepExpBonus: sleepExpBonusMultiplier(s.sleepExpBonusCount),
      includeGSD: s.includeGSD,
      growthIncenseGsdDays: s.growthIncenseGsdDays,
      growthIncenseNormalPerWeek: s.growthIncenseNormalPerWeek,
      growthIncenseStock: s.growthIncenseStock,
    });
    console.table(sleepRows.map((r) => {
      const plan = getPokemonResult(r.id);
      const sleep = buildDebugSleepRow(r, plan);
      const b = sleep?.breakdown;
      return {
        name: r.title,
        nature: r.nature,
        naturePercent: b?.naturePercent,
        sleepTargetHours: sleep?.sleepTargetHours,
        sleepHours: sleep?.sleepHours,
        remainingHours: sleep?.remainingHours,
        dailyScore: b?.dailyScore,
        dailyExp: b?.dailyExp,
        baseExp: b?.baseExp,
        requiredDays: sleep?.requiredDays,
        outerBonusExtra: b?.outerBonusExtra,
        incenseExtra: b?.incenseExtra,
        normalIncenseDays: b?.normalIncenseDays,
        flankIncenseDays: b?.flankIncenseDays,
        fullMoonIncenseDays: b?.fullMoonIncenseDays,
        sleepExp: sleep?.sleepExp,
        candyTarget: r.candyTarget,
        targetLv: r.dstLevel,
        targetExpInLevel: r.dstExpInLevel ?? 0,
        expToTarget: plan?.shortage.expToTarget,
        neededDays: sleep?.needed?.kind === 'long-term-estimate' ? sleep.needed.requiredDays : undefined,
      };
    }));
  }

  function exactResultGate(response: { slotId: string; inputSignature: string; generation: number }): boolean {
    return response.slotId === currentSlotId()
      && response.inputSignature === previousInputSignature
      && response.generation === displayGeneration;
  }

  function logMixedDiff(mixed: LevelPlannerResult, exact: LevelPlannerResult): void {
    if (!PLAN_RESULT_PERF_ENABLED) return;
    const mixedRows = mixed.pokemonResults;
    const exactRows = exact.pokemonResults;
    const boundaryMixed = mixed.summary.boundaryPokemonId;
    const boundaryExact = exact.summary.boundaryPokemonId;
    const boundaryMixedRow = mixedRows.find(row => row.pokemonId === boundaryMixed);
    const boundaryExactRow = exactRows.find(row => row.pokemonId === boundaryExact);
    console.info('[perf] levelPlanner.mixedDiff', {
      mixedRemainder: mixed.summary.totalSupplied.totalCandyValue - mixed.summary.totalNeed.totalCandyUnits,
      exactRemainder: exact.summary.totalSupplied.totalCandyValue - exact.summary.totalNeed.totalCandyUnits,
      mixedUniversal: mixed.summary.universalCandyUsed,
      exactUniversal: exact.summary.universalCandyUsed,
      mixedType: mixed.summary.typeCandyUsed,
      exactType: exact.summary.typeCandyUsed,
      reachedLevelChanged: mixedRows.filter((row, index) => row.reachableLine.level !== exactRows[index]?.reachableLine.level).length,
      boundaryChanged: boundaryMixed !== boundaryExact,
      boundaryLevelDelta: (boundaryExactRow?.reachableLine.level ?? 0) - (boundaryMixedRow?.reachableLine.level ?? 0),
      boundaryExpDelta: (boundaryExactRow?.reachableLine.expGained ?? 0) - (boundaryMixedRow?.reachableLine.expGained ?? 0),
    });
  }

  function startManualExactVerification(input: LevelPlannerInput, inputSignature: string, slotId: string, generation: number): void {
    if (!PLAN_RESULT_EXACT_VERIFICATION_ENABLED || typeof Worker === 'undefined' || displayedPlanResult.value?.calculationMode === 'exact') return;
    if (manualExactSlotId) updateProfile({ exactResultStale: true }, manualExactSlotId);
    manualExactWorker?.terminate();
    releaseManualExactPersistDeferral?.();
    releaseManualExactPersistDeferral = null;
    updateProfile({ exactResultStale: false }, slotId);
    const worker = new Worker(new URL('../workers/levelPlanner.worker.ts', import.meta.url), { type: 'module' });
    manualExactWorker = worker;
    manualExactSlotId = slotId;
    const requestId = ++manualExactRequestId;
    worker.onmessage = (event: MessageEvent<PlannerWorkerResponse>) => {
      const response = event.data;
      if (response.kind !== 'result' || response.requestId !== requestId || response.lane !== 'manualExact') return;
      if (!exactResultGate({ slotId: response.slotId, inputSignature: response.inputSignature, generation })) {
        updateProfile({ exactResultStale: true }, slotId);
        worker.terminate();
        if (manualExactWorker === worker) {
          manualExactWorker = null;
          manualExactSlotId = null;
          releaseManualExactPersistDeferral?.();
          releaseManualExactPersistDeferral = null;
        }
        return;
      }
      const mixed = displayedPlanResult.value?.result;
      applyDisplayedResult(response.result, { slotId, inputSignature, calculationMode: 'exact', durationMs: response.durationMs });
      updateProfile({ lastCalculationMode: 'exact', lastExactDurationMs: response.durationMs, exactResultStale: false }, slotId);
      if (mixed) logMixedDiff(mixed, response.result);
      worker.terminate();
      if (manualExactWorker === worker) {
        manualExactWorker = null;
        manualExactSlotId = null;
        releaseManualExactPersistDeferral?.();
        releaseManualExactPersistDeferral = null;
      }
    };
    worker.onerror = () => {
      updateProfile({ exactResultStale: true }, slotId);
      worker.terminate();
      if (manualExactWorker === worker) {
        manualExactWorker = null;
        manualExactSlotId = null;
        releaseManualExactPersistDeferral?.();
        releaseManualExactPersistDeferral = null;
      }
    };
    releaseManualExactPersistDeferral = deferPersistUntilReleased();
    worker.postMessage({ slotId, requestId, lane: 'manualExact', inputSignature, input, calculationMode: 'exact', perfEnabled: PLAN_RESULT_PERF_ENABLED } satisfies PlannerWorkerRequest);
  }

  function runManualExactVerification(): void {
    if (!PLAN_RESULT_EXACT_VERIFICATION_ENABLED || typeof Worker === 'undefined') return;
    const input = buildPlannerInput();
    if (!input) return;
    startManualExactVerification(input, buildPlannerInputSignature(input), currentSlotId(), displayGeneration);
  }

  function handleAutoResponse(response: PlannerWorkerResponse, context: { slotId: string; inputSignature: string; input: LevelPlannerInput; generation: number; probe: boolean; calculationMode: CalculationMode }): void {
    if (response.requestId !== planResultRequestId || response.lane !== 'auto') return;
    planResultWorkerBusy = false;
    releasePlanResultPersistDeferral?.();
    releasePlanResultPersistDeferral = null;
    planResultPending.value = false;
    if (response.kind === 'error') {
      updateProfile({ structuralProbeStatus: 'aborted', exactResultStale: true }, context.slotId);
      console.error('[level-planner] worker failed:', response.error);
      return;
    }
    if (!exactResultGate({ slotId: response.slotId, inputSignature: response.inputSignature, generation: context.generation })) {
      updateProfile({ exactResultStale: true }, context.slotId);
      return;
    }
    if (response.kind === 'deadlineExceeded') {
      updateProfile({
        policy: 'autoMixed',
        ...(context.probe ? { structuralProbeStatus: 'deadlineExceeded' as const, lastStructuralProbeDurationMs: response.meta.elapsedMs } : {}),
        lastCalculationMode: 'prefixLocalMixed',
        lastFastDurationMs: response.durationMs,
        mixedPrefixCount: response.mixedMeta.exactPrefixCount,
        lastInputSignature: context.inputSignature,
        exactResultStale: false,
      }, context.slotId);
      applyDisplayedResult(response.mixedResult, { slotId: context.slotId, inputSignature: context.inputSignature, calculationMode: 'prefixLocalMixed', durationMs: response.durationMs, mixedPrefixCount: response.mixedMeta.exactPrefixCount, mixedSource: response.mixedMeta.source });
      return;
    }
    const mode = response.calculationMode;
    const nextPolicy: CalculationPolicy = mode === 'prefixLocalMixed' ? 'autoMixed' : 'autoExact';
    updateProfile({ policy: nextPolicy, structuralProbeStatus: context.probe ? (mode === 'exact' ? 'exactCompleted' : 'aborted') : calculationPerformanceProfile.value.structuralProbeStatus, lastCalculationMode: mode, lastExactDurationMs: mode === 'exact' ? response.durationMs : calculationPerformanceProfile.value.lastExactDurationMs, lastFastDurationMs: mode === 'exact' ? calculationPerformanceProfile.value.lastFastDurationMs : response.durationMs, lastStructuralProbeDurationMs: context.probe ? response.durationMs : calculationPerformanceProfile.value.lastStructuralProbeDurationMs, lastInputSignature: context.inputSignature, exactResultStale: false, ...(response.mixedMeta ? { mixedPrefixCount: response.mixedMeta.exactPrefixCount } : {}) }, context.slotId);
    applyDisplayedResult(response.result, { slotId: context.slotId, inputSignature: context.inputSignature, calculationMode: mode, durationMs: response.durationMs, mixedPrefixCount: response.mixedMeta?.exactPrefixCount, mixedSource: response.mixedMeta?.source });
  }

  function ensurePlanResultWorker(): Worker {
    if (planResultWorker) return planResultWorker;
    const worker = new Worker(new URL('../workers/levelPlanner.worker.ts', import.meta.url), { type: 'module' });
    planResultWorker = worker;
    worker.onmessage = (event: MessageEvent<PlannerWorkerResponse>) => {
      if (!activeAutoContext) return;
      handleAutoResponse(event.data, activeAutoContext);
    };
    worker.onerror = (event) => {
      console.error('[level-planner] worker error:', event.message);
      planResultPending.value = false;
      updateProfile({ structuralProbeStatus: 'aborted', exactResultStale: true });
      disposePlanResultWorker();
    };
    return worker;
  }

  function runPlanResult(input: LevelPlannerInput, context: { slotId: string; inputSignature: string; input: LevelPlannerInput; generation: number; probe: boolean; calculationMode: CalculationMode }): void {
    activeAutoContext = context;
    if (typeof Worker === 'undefined') {
      const requestId = planResultRequestId;
      const mixedPrefixCount = slotProfiles.get(context.slotId)?.mixedPrefixCount;
      void loadPlannerFallbackModule()
        .then(({ solveLevelPlanWithBudget }) => {
          const outcome = solveLevelPlanWithBudget(input, { calculationMode: 'prefixLocalMixed', mixedPrefixCount });
          if (outcome.kind === 'result') {
            handleAutoResponse({ kind: 'result', slotId: context.slotId, requestId, lane: 'auto', inputSignature: context.inputSignature, calculationMode: 'prefixLocalMixed', result: outcome.result, durationMs: outcome.durationMs, mixedMeta: outcome.mixedMeta }, context);
          }
        })
        .catch((error: unknown) => {
          if (requestId !== planResultRequestId) return;
          planResultPending.value = false;
          updateProfile({ structuralProbeStatus: 'aborted', exactResultStale: true }, context.slotId);
          console.error('[level-planner] fallback load failed:', error);
        });
      return;
    }
    const worker = ensurePlanResultWorker();
    planResultWorkerBusy = true;
    releasePlanResultPersistDeferral?.();
    releasePlanResultPersistDeferral = deferPersistUntilReleased();
    const deadlineMs = context.calculationMode === 'exact' ? (context.probe ? STRUCTURAL_PROBE_DEADLINE_MS : AUTO_EXACT_SOFT_LIMIT_MS) : undefined;
    const mixedPrefixCount = context.calculationMode === 'prefixLocalMixed'
      ? slotProfiles.get(context.slotId)?.mixedPrefixCount
      : undefined;
    worker.postMessage({ slotId: context.slotId, requestId: planResultRequestId, lane: 'auto', inputSignature: context.inputSignature, input, calculationMode: context.calculationMode, deadlineMs, mixedPrefixCount, perfEnabled: PLAN_RESULT_PERF_ENABLED } satisfies PlannerWorkerRequest);
  }

  watch(
    // currentGameDate は睡眠EXP経由で必要アメ数を動かすため、日付跨ぎで結果を更新する。
    [rows, boostKind, boostCandyRemaining, boostCandyDefaultCap, shardsCap, itemCompareMode, candyStore.inventorySnapshot, activeSlotTab, sleepSettings, currentGameDate],
    () => {
      if (planResultTimer) {
        clearTimeout(planResultTimer);
        planResultTimer = null;
      }
      displayGeneration++;
      planResultRequestId++;
      if (planResultWorkerBusy) disposePlanResultWorker();
      if (manualExactWorker && manualExactSlotId) updateProfile({ exactResultStale: true }, manualExactSlotId);
      if (rows.value.length === 0) {
        planResult.value = null;
        displayedPlanResult.value = null;
        planResultPending.value = false;
        updateProfile({ structuralProbeStatus: 'idle', exactResultStale: false });
        previousInputSignature = null;
        previousStructureSignature = null;
        previousProbeSignature = null;
        previousSlotId = currentSlotId();
        return;
      }
      planResultPending.value = true;
      const delayMs = planResultHasDispatched ? PLAN_RESULT_DEBOUNCE_MS : 0;
      const generation = displayGeneration;
      const scheduledAt = PLAN_RESULT_PERF_ENABLED ? performance.now() : 0;
      planResultTimer = setTimeout(() => {
        const input = buildPlannerInput();
        if (!input) {
          planResult.value = null;
          displayedPlanResult.value = null;
          planResultPending.value = false;
          return;
        }
        const inputSignature = buildPlannerInputSignature(input);
        const structureSignature = buildPlannerStructureSignature(input);
        const probeSignature = buildPlannerProbeSignature(input);
        const slotId = currentSlotId();
        const switching = previousSlotId !== null && previousSlotId !== slotId;
        const slotProfile = slotProfiles.get(slotId)
          ?? (switching ? defaultCalculationPerformanceProfile() : calculationPerformanceProfile.value);
        calculationPerformanceProfile.value = slotProfile;
        slotProfiles.set(slotId, slotProfile);
        const cached = switching && slotProfiles.get(slotId)?.lastInputSignature === inputSignature ? slotDisplayedResults.get(slotId) : undefined;
        if (cached) {
          planResult.value = cached.result;
          displayedPlanResult.value = cached;
          calculationPerformanceProfile.value = slotProfiles.get(slotId) ?? calculationPerformanceProfile.value;
          previousInputSignature = inputSignature;
          previousStructureSignature = structureSignature;
          previousProbeSignature = probeSignature;
          previousSlotId = slotId;
          planResultPending.value = false;
          planResultTimer = null;
          return;
        }
        const probe = previousInputSignature === null || previousStructureSignature !== structureSignature || previousProbeSignature !== probeSignature;
        const calculationMode: CalculationMode = 'exact';
        updateProfile({ structuralProbeStatus: probe ? 'running' : calculationPerformanceProfile.value.structuralProbeStatus, lastInputSignature: inputSignature, lastDeadlineMs: calculationMode === 'exact' ? (probe ? STRUCTURAL_PROBE_DEADLINE_MS : AUTO_EXACT_SOFT_LIMIT_MS) : undefined, exactResultStale: false }, slotId);
        previousInputSignature = inputSignature;
        previousStructureSignature = structureSignature;
        previousProbeSignature = probeSignature;
        previousSlotId = slotId;
        planResultHasDispatched = true;
        runPlanResult(input, { slotId, inputSignature, input, generation, probe, calculationMode });
        if (PLAN_RESULT_PERF_ENABLED) console.info('[perf] levelPlanner.schedule', { delayMs, waitedMs: Math.round((performance.now() - scheduledAt) * 100) / 100, calculationMode, probe });
        planResultTimer = null;
      }, delayMs);
    },
    { deep: true, immediate: true }
  );

  /** 同一 planResult に対する find をテンプレート内で繰り返さないよう Map 化 */
  const pokemonResultByRowId = computed(() => {
    const pr = planResult.value;
    if (!pr) return new Map<string, PokemonPlanResult>();
    return new Map(pr.pokemonResults.map((p) => [p.pokemonId, p] as const));
  });

  /**
   * ポケモンの計画結果を取得
   */
  function getPokemonResult(id: string): PokemonPlanResult | null {
    return pokemonResultByRowId.value.get(id) ?? null;
  }

  /**
   * 理論値行を取得。
   * 個数指定＝目標になったため targetLine に一本化した（設計書§4.2, §4.5.1）。
   */
  function getTheoreticalRow(p: PokemonPlanResult): PokemonPlanLine {
    return p.targetLine;
  }

  // ─────────────────────────────────────────────────────────────
  // 万能アメ関連 (planResult ベース)
  // ─────────────────────────────────────────────────────────────

  const universalCandyUsagePct = computed(() => {
    const inv = candyStore.universalCandy.value;
    const needed = universalCandyNeeded.value;

    const totalValue = inv.s * CANDY_VALUES.universal.s + inv.m * CANDY_VALUES.universal.m + inv.l * CANDY_VALUES.universal.l;
    const neededValue = needed.s * CANDY_VALUES.universal.s + needed.m * CANDY_VALUES.universal.m + needed.l * CANDY_VALUES.universal.l;

    if (totalValue <= 0) return 0;
    return Math.round((neededValue / totalValue) * 100);
  });

  // 万能アメ使用ランキング（planResult.summary.itemUsageRanking を使用）
  const universalCandyRanking = computed(() => {
    if (!planResult.value) return [];

    const totalUniversalValue =
      planResult.value.summary.universalCandyUsed.s * CANDY_VALUES.universal.s +
      planResult.value.summary.universalCandyUsed.m * CANDY_VALUES.universal.m +
      planResult.value.summary.universalCandyUsed.l * CANDY_VALUES.universal.l;

    if (totalUniversalValue <= 0) return [];

    return planResult.value.summary.itemUsageRanking
      .map((p) => {
        const uniValue =
          p.universalS * CANDY_VALUES.universal.s +
          p.universalM * CANDY_VALUES.universal.m +
          p.universalL * CANDY_VALUES.universal.l;
        const usagePct = totalUniversalValue > 0 ? (uniValue / totalUniversalValue) * 100 : 0;
        return {
          id: p.pokemonId,
          pokemonName: p.name,
          universalValue: uniValue,
          usagePct: Math.round(usagePct),
          uniSUsed: p.universalS,
          uniMUsed: p.universalM,
          uniLUsed: p.universalL,
          typeSUsed: p.typeS,
          typeMUsed: p.typeM,
        };
      })
      .filter((x: { universalValue: number }) => x.universalValue > 0)
      .sort((a: { usagePct: number }, b: { usagePct: number }) => b.usagePct - a.usagePct);
  });

  // 万能アメ合計使用数 (planResult から取得)
  const universalCandyUsedTotal = computed(() => {
    if (!planResult.value) return { s: 0, m: 0, l: 0 };
    return planResult.value.summary.universalCandyUsed;
  });

  // 万能アメの必要数（サマリー用、実使用ベース）
  const universalCandyNeeded = computed(() => {
    if (!planResult.value) return { s: 0, m: 0, l: 0, total: 0 };

    let totalS = 0;
    let totalM = 0;
    let totalL = 0;

    for (const p of planResult.value.pokemonResults) {
      // 実使用（reachableLine）を使用
      totalS += p.reachableLine.candySupply.universal.s;
      totalM += p.reachableLine.candySupply.universal.m;
      totalL += p.reachableLine.candySupply.universal.l;
    }

    return {
      s: totalS,
      m: totalM,
      l: totalL,
      total: totalS + totalM + totalL,
    };
  });

  function upsertFromBox(p: {
    boxId: string;
    srcLevel: number;
    expType: ExpType;
    nature: ExpGainNature;
    expRemaining?: number;
    sleepHours?: number;
    title?: string;
    dstLevelDefault?: number;
    pokedexId?: number;
    pokemonType?: string;
  }) {
    const srcLevel = clampInt(p.srcLevel, 1, MAX_LEVEL, 10);
    // デフォルト目標Lv: 現在Lv < 60 なら 60、現在Lv >= 60 ならシステム上限
    const defaultDstLevel = srcLevel < 60 ? 60 : MAX_LEVEL;
    const dstLevel = clampInt(p.dstLevelDefault ?? defaultDstLevel, srcLevel, MAX_LEVEL, srcLevel);
    const toNext = Math.max(0, calcExp(srcLevel, srcLevel + 1, p.expType));
    const remaining =
      p.expRemaining !== undefined && Number.isFinite(p.expRemaining) ? clampInt(p.expRemaining, 0, toNext, toNext) : toNext;

    // 共通ヘルパーでアメ計算パッチを生成（expRemaining を渡して内部で expGot を計算）
    // 既存行がある場合は excludeRowId で自分を除外、新規行の場合は除外不要（まだ rows に存在しない）
    const existing = rows.value.find((x) => x.boxId === p.boxId) ?? null;

    const title =
      String(p.title ?? "").trim() ||
      (resolveTitleByBoxId ? resolveTitleByBoxId(p.boxId) ?? "" : "") ||
      "(no name)";


    if (existing) {
      // §6.3: 元Lvが変わったときだけ個数指定を解除し、アメブを再計算する。
      // dstLevel はクランプのみでボックス既定値へ戻さない。
      // 睡眠目標は解除しない（§10.11）。ゲーム内でLvが上がった同期であって、
      // ユーザーの「累計◯時間寝かせる」という宣言を破棄する理由にならない。
      const srcLevelChanged = existing.srcLevel !== srcLevel;
      const keptDstLevel = Math.max(srcLevel, Math.min(MAX_LEVEL, existing.dstLevel));
      const base: Partial<CalcRow> = {
        title, boxId: p.boxId, srcLevel, dstLevel: keptDstLevel, expType: p.expType, nature: p.nature,
        expRemaining: remaining, pokedexId: p.pokedexId, pokemonType: p.pokemonType,
        sleepHours: p.sleepHours,
      };

      if (!srcLevelChanged) {
        // 個数指定ありなら、更新後の条件で到達点を同期する。
        commitRow(existing.id, base, t("calc.undoLabel.rowSync", { name: title }));
        activeRowId.value = existing.id;
        return;
      }

      // 元Lvが変わったので、捨てた個数を残数から配り直す（setSrcLevel と同じ扱い）
      commitRowWithQuota(existing.id, {
        ...base,
        dstExpInLevel: 0,
        candyTarget: undefined,
        boostOrExpAdjustment: undefined,
      }, t("calc.undoLabel.rowSync", { name: title }), { resetReachLevel: false });
      activeRowId.value = existing.id;
    } else {
      const row: CalcRow = {
        id: cryptoRandomId(), title, boxId: p.boxId, pokedexId: p.pokedexId, pokemonType: p.pokemonType,
        srcLevel, dstLevel, expRemaining: remaining, expType: p.expType, nature: p.nature,
        sleepHours: p.sleepHours,
        boostReachLevel: dstLevel,
        boostOrExpAdjustment: undefined,
      };
      // 追加した行にだけ残数から割り当てる（既存行は触らない）。
      // 残枠が無ければアメブ0が確定し、「この子にはアメブが回らない」が一目で分かる。
      // 追加と割り当てで `rows` を2回書かない（アメブ未調整の中間状態を載せない）。
      commitRows(
        allocateBoostCandyFromQuota([...rows.value, row], { rowId: row.id }),
        t("calc.undoLabel.rowAdd", { name: title }),
      );
      activeRowId.value = row.id;
    }

    // スクロール位置の補正はブラウザの CSS Scroll Anchoring に委ねる。
    // 以前は nextTick + rAF x 2 で手動 scrollBy していたが、
    // iOS 17+ Safari でブラウザ補正と二重になりボックスが上に飛ぶ問題があったため削除。
  }

  function buildPlannerPatchFromRow(rowId?: string): CalcBoxPlannerPatch | null {
    const r = rowId ? (rows.value.find((x) => x.id === rowId) ?? null) : activeRow.value;
    if (!r || !r.boxId) return null;
    return {
      boxId: r.boxId,
      level: r.srcLevel,
      expRemaining: r.expRemaining,
      sleepHours: r.sleepHours,
    };
  }

  return {
    boostKind,
    setSlotBoostKind,
    itemCompareMode,
    setItemCompareMode,
    totalShards,
    totalShardsText,
    boostCandyRemaining,
    boostCandyRemainingText,
    defaultBoostReachLevel,
    setDefaultBoostReachLevel,
    resetAllBoostCandy,
    resetSettings,
    isSettingsDefault,
    boostCandyDefaultCap,
    slots,
    rows,
    activeRowId,
    activeSlotTab,
    getBackupSnapshot,

    sleepSettings,
    updateSleepSettings,
    currentGameDate,
    debugNowEnabled,
    debugNowText,
    sleepCalculationError,
    lunarCalendarStatus,

    exportOpen,
    dragRowId,
    dragOverRowId,

    fullLabel,
    miniLabel,
    noneLabel,
    activeRow,
    rowsView,

    exportRows,
    exportActualTotals,
    debugExportEnabled,

    totalShardsUsed,
    shardsCap,
    shardsOver,
    shardsUsagePctRounded,
    shardsFillPctForBar,
    shardsOverPctForBar,
    showShardsFire,

    totalBoostCandyUsed,
    boostCandyCap,
    boostCandyOver,
    boostCandyUnused,
    boostCandyShortageTotal,
    boostCandyUsagePctRounded,
    boostCandyFillPctForBar,
    boostCandyOverPctForBar,
    showBoostCandyFire,

    activeRowShardsUsed,
    activeRowBoostCandyUsed,
    activeRowShardsFillPct,
    otherRowsShardsFillPct,
    activeRowBoostCandyFillPct,
    otherRowsBoostCandyFillPct,
    activeRowShardsUsagePct,
    activeRowBoostCandyUsagePct,

    planResult,
    planResultPending,
    displayedPlanResult,
    calculationPerformanceProfile,
    calculationPolicy,
    structuralProbeStatus,
    showFastCalculation,
    showExactImprovementHint,
    showManualExactVerification,
    runManualExactVerification,
    pokemonResultByRowId,
    getPokemonResult,
    getTheoreticalRow,
    buildDebugExportTsv,
    copyDebugExportTsv,
    universalCandyUsagePct,
    universalCandyNeeded,
    universalCandyRanking,
    universalCandyUsedTotal,

    canUndo,
    canRedo,

    fmtNum,
    formatSlotSavedAt,

    onTotalShardsInput,
    onBoostCandyRemainingInput,
    resetBoostCandyRemaining,
    updateUniversalCandy,
    updateTypeCandy,
    updateSpeciesCandy,
    openExport,
    closeExport,

    beginUndo,
    undo,
    redo,

    clear,
    removeRowById,

    switchToSlot,
    swapSlots,

    canCopySlot,
    canPasteSlot,
    copySlot,
    pasteSlot,

    nudgeDstLevel,
    nudgeSrcLevel,
    nudgeBoostLevel,
    setDstLevel,
    setSrcLevel,
    setBoostLevel,

    onRowExpRemaining,
    setNature,
    onRowCandyTarget,
    onRowBoostCandy,
    resetRowBoostCandy,

    moveRow,
    moveRowUp,
    moveRowDown,
    canMoveRowUp,
    canMoveRowDown,

    upsertFromBox,
    buildPlannerPatchFromRow,
    setRowSleepHours,
    setRowSleepTarget,
    rowStockCandyTargetFor,
    rowStockCandyAvailableFor,
    setRowSleepTargetHours,
    rowSleepExpFor,
    rowSleepRemainingHoursFor,
    rowGrowthIncenseCountFor,
    rowSleepBonusBreakdownFor,
    projectedOccurrences,
    blueSeedSegments,
    blueSeedShifts,
    realOccurrences,
    rowExceedsSleepTeamLimit,
    calcSleepTimeForRow,
  };
}
