import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, toRaw, watch, type ComputedRef, type Ref } from "vue";
import type { Composer } from "vue-i18n";
import type { AppLocale } from "../i18n";
import { isSleepTargetMode, sleepTargetChoiceOf, sleepTargetTraits, type RestFiller, type SleepTargetMode } from "../domain/sleep-target";
import { formatNapIslandDuration, formatSleepTimeResult } from "../domain/pokesleep/sleep-growth-format";
import { calcSleepLandingLevel } from "../domain/level-planner/sleepReachLevel";
import type { ExportTableRow } from "../export/exportTable";
import { lineSurplus } from "../utils/resultRowDisplay";
import { flatMapOf } from "../utils/flatMapOf";
import { copyText } from "../utils/copyText";
import { sleepTargetNameParts, sleepTimeFormatTokens } from "../utils/sleepTimeText";
import { NAP_ISLAND_FULL_MINUTES, calcNapIslandTime, type NapIslandResult } from "../domain/pokesleep/nap-island";
import { MAX_NAP_ISLAND_SIZE, MAX_SLEEP_TEAM_SIZE, type BoostEvent, type ExpGainNature, type SleepSettings } from "../domain/types";
import { calcExp, calcExpAndCandy, calcExpAndCandyMixed, calcLevelByCandy } from "../domain/pokesleep";
import { minBoostForTarget } from "../domain/pokesleep/minBoostForTarget";
import { minCandyForTarget } from "../domain/pokesleep/minCandyForTarget";
import { minBoostWithinBudget } from "../domain/pokesleep/minBoostWithinBudget";
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
import { MAX_CALC_ROWS_PER_SLOT, defaultSleepSettings, loadActiveSlot, loadCalcSlots, loadTotalShards, saveActiveSlot, saveCalcSlots, saveTotalShards, loadBoostCandyRemaining, saveBoostCandyRemaining, loadSleepSettings, saveSleepSettings, loadDefaultBoostReachLevel, saveDefaultBoostReachLevel, loadMinimizeBoost, saveMinimizeBoost } from "../persistence/calc";
import { deferPersistUntilReleased, schedulePersist } from "../persistence/deferredPersist";
import { cryptoRandomId } from "../persistence/box";
import { useCandyStore } from "./useCandyStore";
import { showToast } from "./useToast";
import { useSleepSchedulePlanning } from "./useSleepSchedulePlanning";
import { type CandyInventoryV2, type TypeCandyInventory, type UniversalCandyInventory } from "../persistence/candy";
import type { Individual, IndividualPatch } from "../domain/individual";
import type { PokemonType } from "../domain/pokesleep/pokemon-names";
import { getCandyFamilyKey, isCandyFamilyKey, isValidPokedexId, normalizeSpeciesCandyByFamily } from "../domain/pokesleep/candy-family";
import { CANDY_VALUES } from "../domain/level-planner/constants";
import type { DebugExportContext, DebugExportNapRow, DebugExportSleepRow } from "../domain/level-planner/debugExport";
import { buildPlannerInput as buildLevelPlannerInput, type PlannerInputRowDto } from "../domain/level-planner/buildPlannerInput";
import type { ItemCompareMode, LevelPlannerInput, LevelPlannerResult, PokemonPlanLine, PokemonPlanResult } from "../domain/level-planner/types";
import { buildPlannerInputSignature } from "../domain/level-planner/signature";
import type { PlannerWorkerRequest, PlannerWorkerResponse } from "../workers/levelPlanner.worker";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";
import { isPerfEnabled } from "../utils/perf";
import { stepHistoryWithToast, useHistory, type CalcHistoryScope, type History } from "./useHistory";
export type CalcRow = CalcRowV1;
/** unreachable の neededCandy は、指定Lvへ届く最小の総アメ数（全部アメブで上げたとき）。 */
export type ApplyMinBoostForCandyTargetResult =
  | { kind: "applied" }
  | { kind: "disabled" }
  | { kind: "unreachable"; neededCandy: number };

/** 定員のある資源（`rest` から「なし」を除いたもの） */
export type RestResource = Exclude<RestFiller, "none">;
/** 資源ごとの同時に使える行数 */
const REST_CAPACITY = { sleep: MAX_SLEEP_TEAM_SIZE, napIsland: MAX_NAP_ISLAND_SIZE } as const satisfies Record<RestResource, number>;

/** 睡眠目標の確定をまとめて undo するための指定（`beginUndo` と同じ意味） */
export type SleepTargetCommitOptions = { coalesceKey?: string; coalesceWindowMs?: number };
export type NoCandyHintKey = "calc.row.sleepTargetAllHint" | "calc.row.sleepTargetNapHint";
/** アメを配らない行の無効理由。`rest`（残EXPを埋める手段）で文言が決まる */
const NO_CANDY_HINT_KEY = {
  sleep: "calc.row.sleepTargetAllHint",
  napIsland: "calc.row.sleepTargetNapHint",
} as const satisfies Record<RestResource, NoCandyHintKey>;

/** 残EXPを埋める時間。どちらの時間を出すかはストアが決め、ビューは `kind` で書式を選ぶだけ */
export type RowRemainingTime =
  | { kind: "sleep"; result: SleepTimeResult }
  | {
    kind: "napIsland";
    result: NapIslandResult;
    /** チケットを使う答えが7日未満（半減した状態でチケットを使う）。「チケットの効果も半分」の注記を出す条件 */
    ticketHalf: boolean;
  };

/** 残EXPを埋めたあとの着地点（睡眠到達Lv・島到達Lv）を出すための値 */
export type RowReachAfterRemaining =
  | { kind: "sleep"; sleepExp: number; hours: number }
  | { kind: "napIsland"; napGainedExp: number };

/** 目標計算へ触れず、睡眠目標の排他だけを回復する。 */
export function normalizeCalcRowStructure(row: CalcRow): CalcRow {
  if (row.sleepTargetMode === undefined || row.sleepTargetHours === undefined) return row;
  return { ...row, sleepTargetHours: undefined };
}

const PLAN_RESULT_PERF_ENABLED = isPerfEnabled();

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
  /** 個体（ボックス）とのリンクが切れている行。`boxId` が無い、または参照先の個体が見つからない。保存しない。 */
  linkBroken: boolean;
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
    /**
     * 最小化（設定またはこの行だけ）が効く行なのに、この行に回るアメ在庫では目標に届かず
     * 既定アメブ目標Lvへフォールバックしている状態。設定だけで最小化している行は、
     * 種族の登録在庫が0なら立てない（在庫未入力で全行が警告になるため）。
     */
    boostMinimizeFallback: boolean;
    /**
     * `boostMinimizeFallback` のとき、目標（睡眠目標があれば `T'`）へ届く最小の総アメ数（全部アメブで上げたとき）。
     * それ以外は undefined。逆算ツールの「{n}個以上のアメが必要です」と同じ数え方。
     */
    boostMinimizeFallbackNeededCandy?: number;
    /** 最小化フォールバック行より上に、同じ種族アメを使う行がある状態。 */
    boostMinimizeFallbackSharedStock: boolean;
    boostReachLevelMax: number;
    boostCandyInputMax: number;
    /**
     * 睡眠EXPによる上限が効いている（案内文を用意する条件）。
     * 上限ちょうどの行でも「これ以上上げられない」理由は要るので、押し下げの有無は問わない。
     * アメ在庫＋睡眠の在庫による上限は含めない（isBoostCapActive）。
     */
    boostCapActive: boolean;
    /**
     * 睡眠EXPでアメブの担当範囲が押し下げられている状態（破線を出す条件）。
     * 動かせないのは押し下げられた範囲だけで、`boostReachLevelMax` 以下は操作できる。
     */
    boostSleepCapped: boolean;
    /** 睡眠EXPだけで目標に届き、アメブを1個も使えない状態。2欄とも入力欄を無効化する。 */
    boostInputDisabled: boolean;
    /**
     * アメブ目標Lvの上限より上へ上げようとしたとき、アメブ個数を入れられる状態（`fillBoostCandyToCap`）。
     * 上限のLvは端数を切り捨てた値なので、上限を選んでも `T'` の端数までアメブにならない行がある。
     */
    boostFillToCapAvailable: boolean;
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
    /** アメを1個も配らない行（すべて睡眠）。無効にする理由の文言キーも一緒に持つ。配る行は null。 */
    noCandyHintKey: NoCandyHintKey | null;
  };
};

export type CalcExportRow = {
  id: string;
  title: string;
  natureLabel: string;
  srcLevel: number;
  dstLevel: number;
  /** 実際にアメを使い終えた時点の到達Lv。 */
  candyReachLevel: number;
  /**
   * 睡眠（・おひるね島）のあとの実際の着地点の Lv（整数部）。睡眠・島のEXPが無い行は未指定。
   * 目標Lvではない（不足で目標に届かない行に目標Lvを出すと、寝れば届くと読めてしまう。2026-10-13 ユーザー指摘）。
   */
  sleepTargetLevel?: number;
  boostCandy: number;
  normalCandy: number;
  totalCandy: number;
  shards: number;
};

export type CalcExportTotals = { boostCandy: number; normalCandy: number; totalCandy: number; shards: number };

const PLAN_RESULT_DEBOUNCE_MS = 150;

export type DisplayedPlanResult = {
  result: LevelPlannerResult;
  slotId: string;
  inputSignature: string;
  loss: boolean;
  durationMs: number;
};

/** スロットごとの計算の記録（メモリ上だけ。保存しない）。 */
type CalculationPerformanceProfile = {
  /** スロット切替で、入力が変わっていなければ前の結果を使い回す判定に使う。 */
  lastInputSignature?: string;
};

type DebugExportResult = "copied" | "downloaded" | "failed";

/**
 * 計算機が個体（ボックスの正本）に触れる口。計算機は `PokemonBoxEntryV1` を知らない。
 * `individualById` の `label` は言語別の表示名で、行の `title` になる。
 * `updateIndividual` は存在しない `boxId` で例外を投げる。
 */
export type IndividualsPort = {
  individualById: Readonly<Ref<ReadonlyMap<string, Individual>>>;
  updateIndividual: (
    boxId: string,
    patch: IndividualPatch,
    opts: { label: string; coalesceKey?: string },
  ) => void;
};

/** 個体の名前が空のときに行へ置く表示名。 */
const NO_NAME_TITLE = "(no name)";

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

type UndoScope = readonly CalcHistoryScope[];

type CalcUndoState = {
  rows?: CalcRow[];
  slots?: Array<CalcSaveSlotV1 | null>;
  activeSlotTab?: number;
  totalShards?: number;
  boostCandyRemaining?: number | null;
  itemCompareMode?: ItemCompareMode;
  sleepSettings?: SleepSettings;
  defaultBoostReachLevel?: number | null;
  minimizeBoost?: boolean;
  candyInventory?: CandyInventoryV2;
};

/** 共通履歴に載せる計算機の1件ぶん。スロット固有の scope を含むときは記録時の表示中スロットも持つ。 */
type CalcHistorySnapshot = {
  scopes: UndoScope;
  state: CalcUndoState;
  slotIndex?: number;
};

/**
 * 表示中スロットの値を戻す scope。これらを含む履歴は、戻すときに記録時のスロットへ切り替える
 * （アメブ残数や配分設定も表示中スロットの値なので、`rows` に限らない）。
 */
const SLOT_LOCAL_SCOPES: readonly CalcHistoryScope[] = [
  "rows",
  "slots",
  "activeSlotTab",
  "boostCandyRemaining",
  "itemCompareMode",
];

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
  /** 在庫の範囲で目標に届く最小アメブを導出する設定。 */
  minimizeBoost: Ref<boolean>;
  setMinimizeBoost: (enabled: boolean) => void;
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
  /** 育成プランの表出力（CSV / TSV）の行。値は計算画面の結果行と同じ経路で求める */
  exportTableRows: Readonly<Ref<ExportTableRow[]>>;
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
  countRowsByBoxIds: (boxIds: Iterable<string>) => number;
  removeRowsByBoxIds: (boxIds: Iterable<string>) => number;

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
  fillBoostCandyToCap: (id: string) => void;

  onRowExpRemaining: (id: string, v: string) => void;
  setNature: (id: string, nature: ExpGainNature) => void;
  onRowCandyTarget: (id: string, v: string) => void;
  onRowBoostCandy: (id: string, v: string, options?: { standaloneUndo?: boolean }) => void;
  applyMinBoostForCandyTarget: (id: string, level: number) => ApplyMinBoostForCandyTargetResult;
  canSetRowMinimizeBoost: (id: string) => boolean;
  setRowMinimizeBoost: (id: string, on: boolean) => "applied" | "disabled";
  resetRowBoostCandy: (id: string) => void;
  boostCandyAfterReset: (id: string) => number | undefined;

  moveRow: (fromId: string, toIndex: number) => void;
  moveRowUp: (id: string) => void;
  moveRowDown: (id: string) => void;
  canMoveRowUp: (id: string) => boolean;
  canMoveRowDown: (id: string) => boolean;
  /** 個体を表示中スロットの末尾へ追加する。同じスロットに同じ `boxId` の行があれば何もしない。 */
  addRow: (boxId: string, opts?: { dstLevelDefault?: number }) => void;
  /** 表示中スロットに無い個体だけを末尾へ追加する（既存行は触らない）。Undo は1回分。追加した数を返す。 */
  addRows: (boxIds: readonly string[]) => number;
  /** 行の基準値（`prev`）から個体の値（`next`）への変化を、Lv → 性格 → そのほかの順に計画へ反映した行一覧。履歴にも `rows` にも触らない。 */
  rowsAfterIndividualChange: (rows: readonly CalcRow[], rowId: string, prev: Individual, next: Individual) => CalcRow[];
  setRowSleepHours: (rowId: string, sleepHours: number | undefined) => void;
  /** 睡眠目標の確定。`options` は1回の操作（ドロップダウンを開いて閉じるまで）を undo 1回にまとめるとき渡す。 */
  setRowSleepTarget: (rowId: string, target: number | SleepTargetMode | undefined, options?: SleepTargetCommitOptions) => void;
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
  /** 行の資源（睡眠チーム 1晩5匹）の定員を超えるか。超えるならその資源（6匹目以降の睡眠計画で `"sleep"`）、超えなければ null。 */
  rowRestCapacityOverflow: (rowId: string) => RestResource | null;
  /** 残EXPを埋める時間（睡眠かおひるね島）。残EXPが無ければ null。 */
  rowRemainingTimeFor: (rowId: string, expToTarget: number) => RowRemainingTime | null;
  /** 残EXPを埋めたあとの着地点を出すための値。計画が無ければ null。 */
  rowReachAfterRemainingFor: (rowId: string) => RowReachAfterRemaining | null;
};

export function useCalcStore(opts: {
  locale: Ref<AppLocale>;
  t: Composer["t"];
  /** 個体（ボックスの正本）への口。編集は `updateIndividual` に書くだけで、行へは同期で返ってくる。 */
  individuals: IndividualsPort;
  /** アプリ全体で共有する Undo / Redo 履歴。未指定なら、このストアだけの履歴を持つ（単体テスト用）。 */
  history?: History;
  /** テストで生成物に依存しない睡眠イベント入力を流し込む。通常は未指定。 */
  sleepEventFixture?: SleepEventFixture;
  /** テストで睡眠計画の開始日を固定する。通常は未指定。 */
  currentGameDate?: GameDate;
}): CalcStore {
  const { locale, t, individuals } = opts;
  const history = opts.history ?? useHistory();

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
  const minimizeBoost = ref(loadMinimizeBoost());

  // 睡眠育成設定
  const sleepSettings = ref<SleepSettings>(loadSleepSettings());
  function settingsResetValues(): { sleepSettings: SleepSettings; minimizeBoost: boolean } {
    return {
      sleepSettings: { ...defaultSleepSettings(), timeZone: detectTimeZone() },
      minimizeBoost: false,
    };
  }
  function settingsMatchResetValues(next: ReturnType<typeof settingsResetValues>): boolean {
    return JSON.stringify(sleepSettings.value) === JSON.stringify(next.sleepSettings)
      && defaultBoostReachLevel.value === null
      && minimizeBoost.value === next.minimizeBoost
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
   * 目標Lvを超えても意味がない。元Lvを下回る既定値はアメブ0本を意味する。
   *
   * **睡眠EXPの頭打ち（T'）・アメ在庫＋睡眠の在庫で届くLvでは切り下げない**
   * （2026-09-26 ユーザー規則「勝手に通常アメを増やさない」）。Lv ちょうどへ切り下げて保存すると、
   * その Lv から先（T' の端数・在庫の端数）が通常アメになり、睡眠目標を外したときも通常アメが残る。
   * 上限を超える分は表示・計算で抑える（resolveEffectiveBoostCandy。在庫は使うアメ数で抑える）。
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
      : r.dstLevel;
    const preferred = defaultBoostReachLevel.value ?? cap;
    return clampInt(Math.min(preferred, cap), r.srcLevel, MAX_LEVEL, r.srcLevel);
  }

  /**
   * 最小化の静的条件（個数指定・睡眠モードなし、アメブ種別あり、種族アメのファミリー解決可能）を満たすとき、
   * 使用できるアメブ種別を返す。ON設定、明示個数、自動目標Lv、在庫予算は呼び出し側で判定する。
   */
  function canMinimizeBoostRow(
    row: CalcRow,
    kind: BoostEvent = boostKind.value,
  ): Exclude<BoostEvent, "none"> | undefined {
    if (
      row.candyTarget !== undefined
      || row.sleepTargetMode !== undefined
      || kind === "none"
      || getRowCandyFamilyKey(row) === undefined
    ) return undefined;
    return kind;
  }

  /** アメ在庫で最小アメブを探す。対象外と在庫不足を区別する。 */
  function minimizeBoostForStockBudget(
    row: CalcRow,
    budget: number,
  ):
    | { status: "minimized"; boostCandy: number; target: { level: number; expInLevel: number } }
    | { status: "unreachable"; neededCandy: number }
    | undefined {
    const kind = canMinimizeBoostRow(row);
    if (
      !(minimizeBoost.value || row.boostMinimizeRow === true)
      || row.boostOrExpAdjustment !== undefined
      || row.boostReachAuto === false
      || kind === undefined
    ) return undefined;

    const target = row.sleepTargetHours !== undefined
      ? rowCandyTargetBeforeSleep(row)
      : (() => {
        const derived = deriveTarget(row);
        return { level: derived.targetLevel, expInLevel: derived.targetExpInLevel };
      })();
    const result = minBoostWithinCandyBudget(row, target, kind, budget);
    return result.kind === "unreachable"
      ? { status: "unreachable", neededCandy: result.neededCandy }
      : { status: "minimized", boostCandy: result.boostCandy, target };
  }

  /**
   * アメが担当する目標。時間の睡眠目標の行は、睡眠が担当する分を戻した目標（最小化の行と同じ）。
   * 戻さずに最終目標で数えると、睡眠が担当する分までアメが要ると数え、同じ進化系で下にいる行の在庫の取り分が減る。
   */
  function candyNeedTargetOf(row: CalcRow): { targetLevel: number; targetExpInLevel: number } {
    if (row.sleepTargetHours === undefined) return deriveTarget(row);
    const end = rowCandyTargetBeforeSleep(row);
    return { targetLevel: end.level, targetExpInLevel: end.expInLevel };
  }

  function candyNeedForRow(
    row: CalcRow,
    boostCandy: number,
    target = candyNeedTargetOf(row),
  ): number {
    if (sleepTargetTraits(row).candy === "none") return 0;
    if (row.candyTarget !== undefined) return effectiveCandyTargetOf(row)!;
    return minCandyForTarget({
      srcLevel: row.srcLevel,
      targetLevel: target.targetLevel,
      targetExpInLevel: target.targetExpInLevel,
      expType: row.expType,
      nature: row.nature,
      boostKind: boostKind.value,
      boostCandy,
      expGot: rowExpGot(row),
    });
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
   * `applyBoostCandyQuota` / `rowsAfterPatchWithQuota` の仕事。undo を積むかも呼び出し側が決める。
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
    // 在庫の需要を数えるためのアメブ枠の残り。ソルバーと同じく系統のある行だけが使う（`walkStockCandyAllocation` と同じ）
    let solverBoostLeft = autoBoostCandyCap();
    const stockLeft = normalizeSpeciesCandyByFamily(candyStore.inventorySnapshot.value.species);
    return source.map((row) => {
      const isReset = rowId === undefined || row.id === rowId;
      // 行単位の最小化（boostMinimizeRow）はリセットでも残す。ユーザーがチェックで選んだ設定で、
      // リセットは入力値を自動へ戻す操作なので、戻った自動の値が最小化になる（2026-09-26 ユーザー決定）。
      // 枠が足りず個数が確定した行は、明示個数の行として normalizeRowState が外す。
      // 個数指定の無い行は、アメブ個数で押し上げた目標の端数も個数と一緒に消す（2026-10-24 ユーザー決定。仕様書 §10）。
      // 残すと、枠が足りず個数が確定する行だけ端数が残り、満額もらえる行は消えるので、枠の残りで結果が割れる。
      const reset: CalcRow = isReset
        ? {
          ...row,
          boostOrExpAdjustment: undefined,
          dstExpInLevel: row.candyTarget === undefined ? 0 : row.dstExpInLevel,
          boostReachLevel: resetReachLevel ? initialBoostReachLevelFor(row) : row.boostReachLevel,
          boostReachAuto: resetReachLevel ? true : row.boostReachAuto,
        }
        : row;
      const family = getRowCandyFamilyKey(reset);
      const stockAvailable = family === undefined ? undefined : Math.max(0, stockLeft[family] ?? 0);
      const minimized = stockAvailable === undefined
        ? undefined
        : minimizeBoostForStockBudget(reset, stockAvailable);
      // 対象外の行は現在の実効値（最小化・在庫クランプ込み）をそのまま数える。
      // 配り直す行は仮想行なので computed は読まず、ここで歩いている在庫で求める。
      // computed の在庫は確定前の上の行（最小化前など）を見ているので、stock 行の内数クランプも
      // ここの `stockAvailable` で掛け直す（`stockCandyAllocationByRowId` と同じ式）。
      const unclampedNeed = minimized?.status === "minimized"
        ? minimized.boostCandy
        : resolveEffectiveBoostCandy(reset, true, true);
      const currentNeed = !isReset
        ? resolveEffectiveBoostCandy(row)
        : sleepTargetTraits(reset).candy === "stockOnly" && stockAvailable !== undefined
          ? Math.min(unclampedNeed, stockAvailable, Math.max(0, candyNeedForRow(reset, unclampedNeed)))
          : unclampedNeed;
      // 「すべて睡眠」の行とアメブなしの種別は、枠の付与も消費も 0。
      // 個数は導出（＝0）のままにして明示的な 0 を焼き付けないが、
      // **アメブ目標Lvはこちらでも既定値へ戻す**（仕様書 §4.9。ここだけ外れていた）
      // 種族不明の行は全体計画に入れないので、枠の付与も消費もしない（導出のまま。`isSpeciesUnknownRow`）
      const usesQuota = sleepTargetTraits(row).candy !== "none" && boostKind.value !== "none" && family !== undefined;
      let allocated = reset;
      if (isReset && usesQuota) {
        const granted = Math.min(currentNeed, remaining);
        remaining = Math.max(0, remaining - granted);
        if (granted < currentNeed) {
          allocated = {
            ...reset,
            boostOrExpAdjustment: granted,
            boostReachLevel: boostReachLevelForCandy(reset, granted),
          };
        }
      } else if (!isReset && usesQuota) {
        remaining = Math.max(0, remaining - currentNeed);
      }

      if (family !== undefined && stockAvailable !== undefined) {
        const allocatedBoost = resolveEffectiveBoostCandy(allocated, true, true);
        const allocatedMinimized = allocated === reset && minimized?.status === "minimized"
          ? minimized
          : undefined;
        const boost = solverBoostForStockDemand(
          allocated,
          allocatedMinimized ? allocatedMinimized.boostCandy : allocatedBoost,
          solverBoostLeft,
        );
        const demand = allocatedMinimized
          ? candyNeedForRow(allocated, boost.demandBoost, {
            targetLevel: allocatedMinimized.target.level,
            targetExpInLevel: allocatedMinimized.target.expInLevel,
          })
          : candyNeedForRow(allocated, boost.demandBoost);
        const claim = Math.min(stockAvailable, Math.max(0, demand));
        stockLeft[family] = Math.max(0, stockAvailable - claim);
        solverBoostLeft -= sleepTargetTraits(allocated).candy === "stockOnly" ? Math.min(boost.used, claim) : boost.used;
      }
      // 対象外の行は数えるだけで書き換えない（正規化し直すと §9.2 で固定した目標が動きうる）
      return isReset ? normalizeRowState(allocated) : row;
    });
  }

  /** 割り当て結果を行へ反映する唯一の入口。 */
  function applyBoostCandyQuota(options: { rowId?: string; resetReachLevel?: boolean } = {}): void {
    rows.value = allocateBoostCandyFromQuota(rows.value, options);
  }

  /**
   * 行へパッチを当ててから、その行のアメブを残枠から配り直した行一覧を返す。**`rows` にも履歴にも触らない。**
   *
   * `rowsAfterPatch` → `allocateBoostCandyFromQuota` と2段で書くと、パッチ済みだがアメブが未調整の
   * 中間状態が一度 `rows` に載る。永続化・planner・同期購読者がそれを観測しうるので、
   * 確定する側（`syncRowsWithIndividuals`）が代入するのは配り直した後の1回だけにする。
   */
  function rowsAfterPatchWithQuota(
    source: readonly CalcRow[],
    id: string,
    patch: Partial<CalcRow>,
    options: { resetReachLevel?: boolean } = {},
  ): CalcRow[] {
    if (!source.some((x) => x.id === id)) return [...source];
    const patched = source.map((x) => (x.id === id ? normalizeRowState({ ...x, ...patch }) : x));
    return allocateBoostCandyFromQuota(patched, { rowId: id, ...options });
  }

  /** 行へパッチを当てて不変条件を回復した行一覧を返す。`rows` にも履歴にも触らない。 */
  function rowsAfterPatch(
    source: readonly CalcRow[],
    id: string,
    patch: Partial<CalcRow>,
    options: { preserveTargetForExplicitBoost?: boolean } = {},
  ): CalcRow[] {
    return source.map((x) => (x.id === id ? normalizeRowState({ ...x, ...patch }, options) : x));
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
      "minimizeBoost",
      "itemCompareMode",
      "rows",
    ]);
    sleepSettings.value = nextSettings.sleepSettings;
    defaultBoostReachLevel.value = null;
    minimizeBoost.value = nextSettings.minimizeBoost;
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

  function setMinimizeBoost(enabled: boolean) {
    const next = Boolean(enabled);
    if (minimizeBoost.value === next) return;
    beginUndo(t("settings.minimizeBoostLabel"), ["minimizeBoost"]);
    minimizeBoost.value = next;
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
      beginUndo(t("calc.boostKindLabel"), ["slots", "boostCandyRemaining", "rows"]);
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

  // 表示中スロットの内容（行・アメブ残数・配分設定）を `slots` から読み直す
  function loadLiveStateFromSlot() {
    const slot = slots.value[activeSlotTab.value];
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
    // 有効にしたスロットを正本へ揃える（裏にいた間の個体の変化はここで追いつく。履歴には記録しない）
    syncRowsWithIndividuals();
  }

  // スロット切り替え時の処理（データを切り替え）
  // 各スロットは独自の boostKind を持つため、再計算は不要。履歴は消さない
  function switchToSlot(newSlotIndex: number) {
    if (newSlotIndex === activeSlotTab.value) return;

    // 現在のスロットに保存
    saveToCurrentSlot();

    // 新しいスロットに切り替え
    activeSlotTab.value = newSlotIndex;
    saveActiveSlot(newSlotIndex);
    loadLiveStateFromSlot();

    // 別スロットの編集を、直前のスロットの記録へまとめない
    history.breakCoalesce();
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
    syncRowsWithIndividuals();
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
    syncRowsWithIndividuals();
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
  watch(minimizeBoost, (v) => saveMinimizeBoost(v));
  watch(itemCompareMode, () => saveToCurrentSlot());
  // 上限はスロットごとの値で、起動時は全体キーよりスロットの値を優先する。全体キーだけ保存すると、
  // 行を編集して上限がスロットに入ったあとで上限だけを変えたとき、読み込み直しで古い値に戻る。
  watch(boostCandyRemaining, () => saveToCurrentSlot());

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

  // Undo / Redo は共通履歴（上限30）。スナップショットは行と3スロットのディープコピーなので、
  // 30本でも数百KB程度に収まる。
  const canUndo = history.canUndo;
  const canRedo = history.canRedo;

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
    if (scope.includes("minimizeBoost")) state.minimizeBoost = minimizeBoost.value;
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
    if (s.minimizeBoost !== undefined) minimizeBoost.value = s.minimizeBoost;
    if (s.candyInventory !== undefined) candyStore.restoreInventory(s.candyInventory);
  }

  history.registerProvider<CalcHistorySnapshot>("calc", {
    // 何が戻ったかが画面で見えるよう、記録時のスロットへ切り替える。
    // 切り替えは履歴に記録しない。
    prepare(snapshot) {
      if (!snapshot.scopes.some((scope) => SLOT_LOCAL_SCOPES.includes(scope))) return;
      // タブの入れ替えは、表示するスロットそのものを復元で戻す。切り替えると反対側に記録する
      // `activeSlotTab` が変わるので、今のライブ状態を `slots` へ保存するだけにする。
      if (snapshot.scopes.includes("activeSlotTab")) {
        saveToCurrentSlot();
        return;
      }
      if (snapshot.slotIndex !== undefined) switchToSlot(snapshot.slotIndex);
    },
    capture(scopes) {
      const calcScopes = scopes as UndoScope;
      return {
        scopes: calcScopes,
        state: snapshotUndoState(calcScopes),
        slotIndex: calcScopes.some((scope) => SLOT_LOCAL_SCOPES.includes(scope)) ? activeSlotTab.value : undefined,
      };
    },
    restore(snapshot) {
      restoreUndoState(snapshot.state);
      // `rows` を戻さずに `slots` / `activeSlotTab` を戻した履歴（タブの入れ替え）は、
      // 表示中の行・残数・配分設定を戻した `slots` から読み直す。
      const { state } = snapshot;
      if (state.rows === undefined && (state.slots !== undefined || state.activeSlotTab !== undefined)) {
        loadLiveStateFromSlot();
      }
    },
  });

  /**
   * 変更の直前に呼んで、戻す範囲を共通履歴へ記録する。
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
    history.record(label, scope, options);
  }
  function undo() {
    stepHistoryWithToast(history, "undo", t);
  }
  function redo() {
    stepHistoryWithToast(history, "redo", t);
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

  /** 現在表示中の行を正本として、全スロットにある対象行数を返す。 */
  function countRowsByBoxIds(boxIds: Iterable<string>): number {
    const ids = new Set(boxIds);
    if (!ids.size) return 0;
    const count = (slotRows: readonly CalcRow[]) =>
      slotRows.reduce((total, row) => total + (row.boxId && ids.has(row.boxId) ? 1 : 0), 0);
    return slots.value.reduce((total, slot, index) => {
      const slotRows = index === activeSlotTab.value ? rows.value : slot?.rows ?? [];
      return total + count(slotRows);
    }, 0);
  }

  /**
   * ボックス側で削除された個体に紐づく行を全スロットから削除する。
   * ここでは履歴に記録しない。呼び出し側は先に個体の削除（`INDIVIDUAL_EDIT_SCOPES` で行・スロットごと記録）を行い、
   * 続けてこれを呼ぶ。これで個体の削除と連動行の削除が1件の履歴になる。
   */
  function removeRowsByBoxIds(boxIds: Iterable<string>): number {
    const ids = new Set(boxIds);
    if (!ids.size) return 0;
    const removedCount = countRowsByBoxIds(ids);
    if (!removedCount) return 0;

    const filterRows = (slotRows: readonly CalcRow[]) =>
      slotRows.filter((row) => !row.boxId || !ids.has(row.boxId));
    const nextRows = filterRows(rows.value);
    const nextActiveRowId = activeRowId.value && nextRows.some((row) => row.id === activeRowId.value)
      ? activeRowId.value
      : nextRows[0]?.id ?? null;

    slots.value = slots.value.map((slot, index) => {
      if (!slot) return null;
      const nextSlotRows = index === activeSlotTab.value ? nextRows : filterRows(slot.rows);
      const nextSlotActiveRowId = slot.activeRowId && nextSlotRows.some((row) => row.id === slot.activeRowId)
        ? slot.activeRowId
        : nextSlotRows[0]?.id ?? null;
      return { ...slot, rows: nextSlotRows, activeRowId: nextSlotActiveRowId, savedAt: new Date().toISOString() };
    });
    rows.value = nextRows;
    activeRowId.value = nextActiveRowId;
    return removedCount;
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
   * 現在のナビゲーションUIは指を離した時に1回だけ `moveRow` を呼ぶ。通し番号も維持し、
   * 同じドラッグ中に確定処理が増えても履歴が分裂しないようにする。ボタン操作（↑↓）は
   * ドラッグ中ではないため、1クリックずつ独立した履歴になる。
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
    return sleepTargetTraits(row).rest === "sleep";
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

  /** 島の所要時間。チケットの有無は性質表の `napTicket` をそのまま渡す */
  function calcNapIslandTimeFor(row: CalcRow, expToTarget: number): NapIslandResult {
    return calcNapIslandTime({ expToTarget, nature: row.nature, ticket: sleepTargetTraits(row).napTicket });
  }

  function rowRemainingTimeFor(rowId: string, expToTarget: number): RowRemainingTime | null {
    const row = rows.value.find((candidate) => candidate.id === rowId);
    if (!row || !(expToTarget > 0)) return null;
    if (sleepTargetTraits(row).rest === "napIsland") {
      const result = calcNapIslandTimeFor(row, expToTarget);
      return {
        kind: "napIsland",
        result,
        ticketHalf: sleepTargetTraits(row).napTicket && result.minutes < NAP_ISLAND_FULL_MINUTES,
      };
    }
    return { kind: "sleep", result: calcSleepTimeFor(row, expToTarget) };
  }

  function rowReachAfterRemainingFor(rowId: string): RowReachAfterRemaining | null {
    const row = rows.value.find((candidate) => candidate.id === rowId);
    if (!row) return null;
    if (sleepTargetTraits(row).rest === "napIsland") {
      const plan = getPokemonResult(rowId);
      if (!plan) return null;
      return { kind: "napIsland", napGainedExp: calcNapIslandTimeFor(row, plan.shortage.expToTarget).napGainedExp };
    }
    return { kind: "sleep", sleepExp: rowSleepExp(row), hours: rowSleepRemainingHoursFor(rowId) };
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
   * 行の資源（睡眠チーム）の定員を超えるか。超えるならその資源、超えなければ null。
   *
   * 睡眠EXPは1晩に5匹までしか得られないので、睡眠目標を付けた6行目以降は
   * **同時には実行できない計画**になる。行順に、同じ資源（`rest`）を使う行だけを数え、
   * 定員を超えた行でその資源を返す。
   * アメ不足で「残EXP 約N日」が出ているだけの行は睡眠計画ではないので数えない
   * （`rest` が `none`）。
   *
   * **実際には寝ない・預けない行も数えない**（2026-10-24）。累計睡眠時間が睡眠目標に届いた行（睡眠EXP 0）や、
   * アメで目標まで届いて島の時間が無い行は、睡眠チームにも島にも入らない。数えると、寝きった行を並べたまま
   * 新しい行に睡眠目標を付けただけで、実際に寝るのは1匹なのに警告が出る。
   * 警告は計画のある行にしか出さないので、判定は計画の残EXPで行う。
   */
  const restCapacityOverflowByRowId = computed(() => {
    const overflow = new Map<string, RestResource>();
    const planned: Record<RestResource, number> = { sleep: 0, napIsland: 0 };
    for (const row of rows.value) {
      const resource = sleepTargetTraits(row).rest;
      // 種族不明の行は全体計画に入れないので、定員にも数えない
      if (resource === "none" || isSpeciesUnknownRow(row) || !rowUsesRestResource(row)) continue;
      planned[resource]++;
      if (planned[resource] > REST_CAPACITY[resource]) overflow.set(row.id, resource);
    }
    return overflow;
  });

  /**
   * 行が睡眠・島の時間を実際に使うか。数える量は睡眠の所要時間（`resolveRowSleepPlan`）・島の所要時間と同じ。
   * 計画がまだ無い間は分からないので数える。
   */
  function rowUsesRestResource(row: CalcRow): boolean {
    const plan = getPokemonResult(row.id);
    if (!plan) return true;
    const plannedSleepExp = row.sleepTargetHours === undefined ? Number.POSITIVE_INFINITY : rowSleepExp(row);
    return Math.min(plan.shortage.expToTarget, plannedSleepExp) > 0;
  }

  function rowRestCapacityOverflow(rowId: string): RestResource | null {
    return restCapacityOverflowByRowId.value.get(rowId) ?? null;
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
      // 個数指定にすると最小化の対象外になるので、最小化の値ではなく保存後の実効アメブ（導出値）で上限を出す。
      // **入力前の個数指定でアメブを抑えない。** 古い個数（例: 5）で抑えると、少ないアメブで Lv70 へ届く数
      // （通常アメが多い）が上限になり、1回目だけ本当の上限より大きい値が入る（2回目で下がる）。
      // 個数指定のある行として数えるので、確定後の実効アメブと同じ値になる。
      boostCandy: resolveEffectiveBoostCandy({ ...r, candyTarget: Number.POSITIVE_INFINITY }, false, true), expGot,
    });
  }

  /**
   * 個数指定の実効値。**保存値を、いまの条件で Lv70（睡眠目標があれば `T'max`）へ届く数で抑える**
   * （D-1。2026-10-24 ユーザー決定）。表示・在庫の割り当て・ソルバーへ渡す総アメ数は、すべてこちらを読む。
   *
   * アメブを増やすなどして、少ないアメで Lv70 へ届くようになったときに効く。保存値で数えると、
   * 届いたあとの余りまで種族アメ在庫から引き、同じ進化系の下の行が使えるアメが増えない
   * （ソルバーは Lv70 で止めて余りを使わない）。
   * **保存値は意図として残す**（アメブ目標Lv・アメ在庫の半ロックと同じ）。アメブを戻すと元の数に戻る。
   */
  function effectiveCandyTargetOf(r: CalcRow): number | undefined {
    if (r.candyTarget === undefined) return undefined;
    return Math.min(r.candyTarget, maxCandyTargetFor(r));
  }

  /** 現在地点（srcLevel + expGot）から exp だけ進んだ地点。 */
  function pointAfterExp(
    r: Pick<CalcRow, 'srcLevel' | 'expType'>,
    expGot: number,
    exp: number,
  ): { level: number; expInLevel: number } {
    let level = r.srcLevel;
    let expInLevel = expGot + exp;
    while (level < MAX_LEVEL) {
      const needed = calcExp(level, level + 1, r.expType);
      if (expInLevel < needed) break;
      expInLevel -= needed;
      level++;
    }
    return { level, expInLevel: level >= MAX_LEVEL ? 0 : expInLevel };
  }

  /** Lv70 から睡眠EXP分を戻した地点。睡眠EXPだけで Lv70 に届くなら null。 */
  function locateExpTargetFromSrc(
    r: Pick<CalcRow, 'srcLevel' | 'expType'>,
    expGot: number,
    sleepExp: number,
  ): { level: number; expInLevel: number } | null {
    const expForCandy = Math.max(0, calcExp(r.srcLevel, MAX_LEVEL, r.expType) - expGot) - sleepExp;
    return expForCandy > 0 ? pointAfterExp(r, expGot, expForCandy) : null;
  }

  /**
   * 保存された最終目標 T から睡眠EXP Sを戻し、アメが担当する終端 T' を返す。
   * 睡眠だけで目標へ届く場合は、現在地点（srcLevel + expGot）を返す。
   */
  function rowCandyTargetBeforeSleep(r: CalcRow): { level: number; expInLevel: number } {
    const target = deriveTarget(r);
    return candyEndBeforeSleep(r, target.targetLevel, target.targetExpInLevel);
  }

  /**
   * 睡眠込みの到達点（targetLevel ＋ targetExpInLevel）から睡眠EXP Sを戻し、アメが担当する終端を返す。
   * 睡眠だけで届く場合は、現在地点（srcLevel + expGot）を返す。
   */
  function candyEndBeforeSleep(r: CalcRow, targetLevel: number, targetExpInLevel: number): { level: number; expInLevel: number } {
    const expGot = rowExpGot(r);
    const expToTarget = Math.max(
      0,
      calcExp(r.srcLevel, targetLevel, r.expType) + targetExpInLevel - expGot,
    );
    return pointAfterExp(r, expGot, Math.max(0, expToTarget - rowSleepExp(r)));
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
  type StockCandyAllocation = {
    target: Record<string, number>;
    available: Record<string, number>;
    minimizedBoost: Record<string, number>;
    minimizeFallback: Record<string, true>;
    /** `minimizeFallback` の行が目標へ届くのに要る最小の総アメ数。 */
    minimizeFallbackNeededCandy: Record<string, number>;
    minimizeFallbackSharedStock: Record<string, true>;
  };
  const stockCandyAllocationByRowId = computed<StockCandyAllocation>(() => walkStockCandyAllocation(rows.value));

  /**
   * `stockCandyAllocationByRowId` の本体。保存前の仮の行一覧（リセット後の見込みなど）にも使えるよう、
   * 行一覧を引数で受ける。
   */
  function walkStockCandyAllocation(source: readonly CalcRow[]): StockCandyAllocation {
    const registeredStock = normalizeSpeciesCandyByFamily(candyStore.inventorySnapshot.value.species);
    const left: Record<string, number> = { ...registeredStock };
    const resolved: Record<string, number> = {};
    const available: Record<string, number> = {};
    const minimizedBoost: Record<string, number> = {};
    const minimizeFallback: Record<string, true> = {};
    const minimizeFallbackNeededCandy: Record<string, number> = {};
    const minimizeFallbackSharedStock: Record<string, true> = {};
    const seenFamilyKeys = new Set<string>();
    // アメブ枠の残り（`solverBoostForStockDemand`）。系統の無い行はソルバーへ渡らないので枠も使わない。
    let boostLeft = autoBoostCandyCap();
    for (const row of source) {
      const key = getRowCandyFamilyKey(row);
      if (key === undefined) {
        // 種族不明の行は在庫を取り合わない。その行だけの計算では種族アメが無限なので、目標まで届く数を使う
        if (sleepTargetTraits(row).candy === "stockOnly") {
          resolved[row.id] = Math.max(0, candyNeedForRow(row, resolveEffectiveBoostCandy(row, true, true)));
        }
        continue;
      }
      const rowAvailable = Math.max(0, left[key] ?? 0);
      available[row.id] = rowAvailable;
      // 在庫歩きの中では直前に求めた値を使い、computed 自身へ戻らない。
      const minimized = minimizeBoostForStockBudget(row, rowAvailable);
      if (minimized?.status === "minimized") minimizedBoost[row.id] = minimized.boostCandy;
      if (minimized?.status === "unreachable"
        && (row.boostMinimizeRow === true || (registeredStock[key] ?? 0) > 0)) {
        minimizeFallback[row.id] = true;
        minimizeFallbackNeededCandy[row.id] = minimized.neededCandy;
      }
      const boost = solverBoostForStockDemand(
        row,
        minimized?.status === "minimized"
          ? minimized.boostCandy
          : resolveEffectiveBoostCandy(row, true, true),
        boostLeft,
      );
      const target = minimized?.status === "minimized"
        ? { targetLevel: minimized.target.level, targetExpInLevel: minimized.target.expInLevel }
        : candyNeedTargetOf(row);
      const need = candyNeedForRow(row, boost.demandBoost, target);
      if (minimizeFallback[row.id] && seenFamilyKeys.has(key)) minimizeFallbackSharedStock[row.id] = true;
      const claim = Math.min(rowAvailable, Math.max(0, need));
      // アメ在庫＋睡眠の行のアメブは使うアメ数の内数（実効アメブの在庫クランプと同じ）
      if (sleepTargetTraits(row).candy === "stockOnly") {
        resolved[row.id] = claim;
        boostLeft -= Math.min(boost.used, claim);
      } else {
        boostLeft -= boost.used;
      }
      left[key] = Math.max(0, rowAvailable - claim);
      seenFamilyKeys.add(key);
    }
    return { target: resolved, available, minimizedBoost, minimizeFallback, minimizeFallbackNeededCandy, minimizeFallbackSharedStock };
  }

  /**
   * 種族アメの需要を数えるときのアメブ（D-3）。**ソルバーが行に配るアメブと同じにする。**
   *
   * ソルバーはアメブ枠を上の行から順に、各行の実効アメブを枠の残りまで配る（`targetDemandRowsForInput`）。
   * 枠を超えた赤枠の行は、枠までのアメブと残りの通常アメで目標へ向かうので、使うアメ数が増える。
   * 枠で抑える前のアメブで数えると、その行が使うアメを少なく見積もり、下の行へ在庫を多く見せる。
   *
   * ただし時間の睡眠目標の行は、ソルバーへ渡す総アメ数を枠で抑える前のアメブから決める
   * （`buildPlannerInput` の `calcCandyTargetFromSleepExp`）ので、需要も抑える前のアメブで数える。
   * 個数指定の行は需要が個数指定なので、どちらで数えても同じ。
   *
   * @returns `demandBoost` 需要を数えるアメブ、`used` 枠から引くアメブ
   */
  function solverBoostForStockDemand(row: CalcRow, boost: number, boostLeft: number): { demandBoost: number; used: number } {
    const used = Math.max(0, Math.min(boost, boostLeft));
    const totalFixedBeforeQuota = row.candyTarget === undefined
      && sleepTargetTraits(row).candy === "normal"
      && rowSleepExp(row) > 0;
    return { demandBoost: totalFixedBeforeQuota ? boost : used, used };
  }

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
    /** 使うアメ数を数えている最中だけ true。`stockCandyAllocationByRowId` の説明を参照。 */
    ignoreStockBudget = false,
    /** 在庫歩き・仮想行の計算中は computed への循環参照を避ける。 */
    ignoreMinimizedBoost = false,
    /** 保存前の仮の行一覧で求めるときの在庫の割り当て（`boostCandyAfterReset`）。省略時は現在の行一覧。 */
    stockAllocation?: StockCandyAllocation,
  ): number {
    if (sleepTargetTraits(r).candy === "none" || boostKind.value === "none" || r.srcLevel >= MAX_LEVEL) return 0;

    if (!ignoreMinimizedBoost && r.boostOrExpAdjustment === undefined) {
      const minimized = (stockAllocation ?? stockCandyAllocationByRowId.value).minimizedBoost[r.id];
      if (minimized !== undefined) return minimized;
    }

    const candyTarget = rowCandyTargetBeforeSleep(r);
    // **`T` を導出している最中は `dstLevel` も `T'` もその計算の出力**なので、入力として参照できない
    // （§10.18 の例外）。参照すると `T → n → T'` の循環になり、§11.4 / §15.7 が再発する。
    // その間は保存された `boostReachLevel`（ユーザーの意図）だけを使い、個数指定と理論上限で抑える。
    // **同じことが「個数指定 `m` のある行」全体に言える**（§15.11）。`T` は `(m, n)` の**出力**で、
    // `m` を入れると `T` が決まり、`n` が増えれば `T` が伸びる。`T` を `n` の入力に混ぜると、
    // 導出経路（`T` を作る側）と表示・ソルバー経路とで `n` が食い違い、保存した `T` に `m` 個で
    // 届かなくなる。**`T` が出力になる行では、両経路とも入力（`boostReachLevel` と `m`）だけで
    // `n` を決める。** 個数 anchor の無い行だけ `T` が入力なので、担当終端 `T'` と目標Lvで抑える。
    //
    // **アメブの担当範囲はユーザーの意図（アメブ目標Lv）で決め、勝手に通常アメを増やさない**
    // （2026-09-26 ユーザー規則）。意図のLvちょうどの点が頭打ちの点（`T'`、`T` が出力の行は `T'max`）以上なら、
    // 頭打ちの点の端数までアメブで賄う（「目標までアメブ」が睡眠で「`T'` までアメブ」になるだけ）。
    // 意図が頭打ちより下なら、そのLvちょうどまでアメブで、その先が通常アメ（ユーザーが選んだ内訳）。
    // どちらも入力（保存された `boostReachLevel` と、`T` に依らない `T'max` / 入力の `T` から作る `T'`）
    // だけで決まるので、`T → n → T` の循環は起きない。
    //
    // 睡眠の頭打ちだけは `T` が出力の行でも要る（保存された `boostReachLevel` は入力時にしか
    // cap されないので、睡眠時間を後から変えると `T'` を超えたままになる）。そこでは `T` から
    // 引いた `T'` ではなく、**`Lv70` から睡眠EXPを戻した `T'max`** を使う。こちらは `T` に依らない。
    const derivingTarget = r.candyTarget !== undefined;
    const sleepCap = derivingTarget
      ? locateExpTargetFromSrc(r, rowExpGot(r), rowSleepExp(r))
      : null;
    // 頭打ちの点。睡眠だけで Lv70 に届く行（sleepCap が null）はアメの担当が無い。
    const capPoint = derivingTarget
      ? sleepCap ?? { level: r.srcLevel, expInLevel: 0 }
      : candyTarget;
    const intentLevel = derivingTarget
      ? r.boostReachLevel ?? r.dstLevel
      : Math.min(r.boostReachLevel ?? r.dstLevel, r.dstLevel);
    // 意図が頭打ちの点以上なら、頭打ちの点（端数込み）まで＝アメ担当の範囲の全体（アメブ100%）。
    // 下なら意図のLvちょうどまでで、その先は通常アメ。「以上」の比べ方は下の `reachesCap`。
    // 意図が現在Lvならアメブ0本（既定アメブ目標Lvを現在Lvへ収めた行も同じ）。頭打ちの点が現在Lvの中にあると
    // 「以上」に当たるが、アメブ100%にしない（全部通常アメの行が、睡眠目標を入れただけでアメブを使い出す）。
    //
    // **睡眠の頭打ち（`T'` / `T'max`）とは、Lvちょうどの点で比べる**（2026-10-24 ユーザー規則）。
    // 意図が `T'.level` ちょうどなら、アメブはそのLvちょうどまでで、`T'` の端数は通常アメ。
    // 端数までのアメブは、ピッカーで上限より上へ上げたときに入れる（`fillBoostCandyToCap`）。
    // Lvの数字で比べると、ピッカーで `T'.level` を選んだだけで端数まで一度に全部アメブになり、
    // 睡眠が1時間増えて `T'` が `T'.level` の中へ下がっただけでも、そのLvが丸ごとアメブになる。
    // 睡眠目標のない行の頭打ちはユーザーの目標（端数込み）なので、今までどおりLvで比べる。
    const sleepCapsCandy = derivingTarget || r.sleepTargetHours !== undefined;
    const reachesCap = sleepCapsCandy
      ? compareLevelExp(intentLevel, 0, capPoint.level, capPoint.expInLevel) >= 0
      : intentLevel > r.srcLevel && intentLevel >= capPoint.level;
    const end = reachesCap
      ? capPoint
      : { level: clampInt(intentLevel, r.srcLevel, MAX_LEVEL, r.srcLevel), expInLevel: 0 };
    // 「アメブ1個 → 通常アメ1個」置換はアメブ100%で目標へ届くときだけ（ユーザー規則）。
    // 個数指定のある行はアメ数が目標を動かすので、成立するのは頭打ちの点が Lv70 のとき（睡眠なし）だけ。
    const derived = boostCandyForEnd(r, end, reachesCap);
    const requested = Math.max(0, Math.floor(r.boostOrExpAdjustment ?? derived));
    // アメブは総アメ数の内数（不変条件 `n ≤ m`）。「アメ在庫＋睡眠」では在庫が `m` を決めるので、
    // 個数指定とまったく同じ枠で抑える。抑えないと、12個しか使えない行がアメブ枠を
    // 数百個ぶん予約して下の行を飢えさせる。**保存値は抑えない**（意図として残す）。
    // 個数指定は実効値で抑える。上限の計算（`maxCandyTargetFor`）は個数指定を無限大にした行で
    // ここを呼ぶので、無限大のときは保存値のまま使う（実効値を求めると循環する）。
    const candyBudget = (r.candyTarget !== undefined && Number.isFinite(r.candyTarget) ? effectiveCandyTargetOf(r) : r.candyTarget)
      ?? (sleepTargetTraits(r).candy === "stockOnly" && !ignoreStockBudget
        ? (stockAllocation ? stockAllocation.target[r.id] : rowStockCandyTargetFor(r.id))
        : undefined)
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
  function normalizeRowState(
    r: CalcRow,
    options: { preserveTargetForExplicitBoost?: boolean } = {},
  ): CalcRow {
    const next: CalcRow = normalizeCalcRowStructure({ ...r });
    next.dstLevel = clampInt(next.dstLevel, next.srcLevel, MAX_LEVEL, next.srcLevel);
    next.boostReachLevel = clampInt(next.boostReachLevel, next.srcLevel, MAX_LEVEL, next.dstLevel);
    if (next.boostOrExpAdjustment !== undefined) {
      next.boostOrExpAdjustment = Math.max(0, Math.floor(next.boostOrExpAdjustment));
      // 明示個数を選んだ行では行単位の最小化を解除する。
      next.boostMinimizeRow = undefined;
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
      // 条件変更で保った明示個数は、上限へ収めても保存済みの目標を押し上げない。
      if (options.preserveTargetForExplicitBoost && next.boostOrExpAdjustment !== undefined) return next;
      // 睡眠EXPが残る行では押し上げない。入力は `T'` へ届く数で抑えるので正しい入力では押し上がらず、
      // 押し上がるのは睡眠目標を入れる前の保存値だけ（睡眠目標で Lv内EXP を 0 にした目標を戻してしまう。spec §4.7）。
      // 目標を上げたいときは個数指定を入れ直す（`(m, n)` の到達点 ＋ `S`。spec §4.6）。
      if (rowSleepExp(next) > 0) return next;
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
      // 個数指定の行は最小化の対象外（canMinimizeBoostRow）。保存前の行一覧で出した最小化の値を読むと、
      // 保存後にプランナーへ渡る実効アメブと食い違う。
      boostCandy: resolveEffectiveBoostCandy(next, false, true),
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
    options: { coalesceKey?: string; coalesceWindowMs?: number; preserveTargetForExplicitBoost?: boolean } = {},
  ): void {
    const current = rows.value.find((x) => x.id === id);
    if (!current) return;
    const normalized = normalizeRowState({ ...current, ...patch }, options);
    if (JSON.stringify(normalized) === JSON.stringify(current)) return;
    beginUndo(label, ["rows"], options);
    updateRow(id, normalized);
  }

  /** 導出値を保存せず、現在の行と残枠から純粋に計算する。 */


  /**
   * 目標Lvピッカーの操作（§4.3 / §4.6）。
   * candyTarget をクリアして「個数指定なし」へ戻す。
   *
   * アメブ目標Lvは据え置き、明示個数は新しい目標の上限までクランプする（§9.2）。
   * calcCandyPatch による自動最大化は行わない（ユーザーのアメブ目標Lv指定を破棄しない）。
   */
  function setDstLevel(id: string, v: unknown) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    const dst = clampInt(v, r.srcLevel, MAX_LEVEL, r.dstLevel);

    const patch: Partial<CalcRow> = { dstLevel: dst };

    if (sleepTargetTraits(r).candy !== "none") {
      patch.boostReachLevel = clampInt(
        Math.min(r.boostReachLevel ?? r.dstLevel, dst),
        r.srcLevel,
        MAX_LEVEL,
        r.srcLevel,
      );
    }
    if (sleepTargetTraits(r).candy !== "none" && r.boostOrExpAdjustment !== undefined) {
      patch.boostOrExpAdjustment = keptBoostCandyAfterChange(r, {
        ...patch,
        dstExpInLevel: 0,
        candyTarget: undefined,
      });
    }

    // ピッカーで選んだ目標は「Lv dst ちょうど」。Lv内EXPは 0 に戻す。
    patch.dstExpInLevel = 0;
    patch.candyTarget = undefined;
    commitRow(id, patch, rowFieldUndoLabel(r, t("calc.row.dstLevel")), {
      preserveTargetForExplicitBoost: true,
    });
  }
  /** アメブ個数を現在の目標Lvのまま再計算（リセット） */
  /**
   * 行のアメブリセット。**「残数から最大投入する」ボタン。**
   *
   * アメブ目標Lvを既定値（設定）へ戻し、その行に回る残枠で個数を確定させる。
   * 残枠の計算がユーザーには面倒なので、このボタンが肩代わりする。
   */
  /**
   * 行のリセット（＝アメブ個数の空白確定）をしたら入る実効アメブ個数。保存はしない。
   * アメブ個数を消している間の入力欄・テンキーに薄く出す値で、確定後の表示と一致させる。
   * 明示個数のある行ではプレースホルダ（`ui.boostCandyInput`）がその個数なので、こちらで求める。
   */
  function boostCandyAfterReset(id: string): number | undefined {
    const next = allocateBoostCandyFromQuota(rows.value, { rowId: id });
    const row = next.find((x) => x.id === id);
    if (!row) return undefined;
    return resolveEffectiveBoostCandy(row, false, false, walkStockCandyAllocation(next));
  }
  function resetRowBoostCandy(id: string) {
    activeRowId.value = id;
    const row = rows.value.find((x) => x.id === id);
    if (!row || sleepTargetTraits(row).candy === "none") return;
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
   * 現在Lvの変更。入力を検証して、個体（正本）の Lv と あとEXP（次Lvまで全部）を書くだけ。
   * 計画への影響は同期（`syncRowsWithIndividuals` → `rowsAfterLevelChange`）が引き受け、
   * ボックスで Lv を変えた場合と同じ経路になる。
   *
   * 元Lvが変わると同じ個数指定でも到達点が変わる（アメのEXP効率がLv依存）ため、
   * 個数指定は解除する。明示アメブ個数は保ち、新しい条件で入力上限を超える分だけ引く（§9.2）。
   * dstLevel はクランプのみ。
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
    // あとEXPは「次Lvまで全部」（未設定）へ戻す
    individuals.updateIndividual(
      individualBoxIdOf(r),
      { level: src, expRemaining: undefined },
      { label: rowFieldUndoLabel(r, t("calc.row.srcLevel")) },
    );
  }

  /**
   * 個体属性の編集の書き込み先。リンク切れの行は入力欄を無効にしてあるので、
   * `boxId` の無い行がここへ来たら呼び出し側の不具合として例外にする。
   */
  function individualBoxIdOf(r: CalcRow): string {
    if (!r.boxId) throw new Error(`calc row ${r.id} has no boxId`);
    return r.boxId;
  }

  /**
   * 条件変更（現在Lv・目標Lv）のあとに残す明示アメブ個数。**個数は保ち、上限を超えた分だけ引く**（§9.2）。
   * 上限は入力欄と同じ計算で、睡眠なしでも終点を保存目標に置く（目標を押し上げないため）。
   * 上限0の行へは明示0を焼き付けず（§11.11）、未入力へ戻す。
   */
  function keptBoostCandyAfterChange(r: CalcRow, patch: Partial<CalcRow>): number | undefined {
    if (r.boostOrExpAdjustment === undefined) return undefined;
    const candidate: CalcRow = { ...r, ...patch, boostOrExpAdjustment: undefined };
    const max = maxBoostCandyInputFor(candidate, true);
    if (max === 0 && !canSaveExplicitZeroBoost(candidate)) return undefined;
    return Math.min(r.boostOrExpAdjustment, max);
  }

  /**
   * 現在Lvが動いたときの計画の変化。確定はしない。
   * 明示個数が残る行は、個数が増えないので枠を配り直さない（§9.2 / §4.11）。
   * 導出モードの行だけ残数から配り直す（アメブ目標Lvは既定値へ戻さない）。
   */
  function rowsAfterLevelChange(source: readonly CalcRow[], r: CalcRow, patch: Partial<CalcRow>): CalcRow[] {
    const kept = keptBoostCandyAfterChange(r, patch);
    if (kept !== undefined) {
      return rowsAfterPatch(source, r.id, { ...patch, boostOrExpAdjustment: kept }, { preserveTargetForExplicitBoost: true });
    }
    return rowsAfterPatchWithQuota(source, r.id, { ...patch, boostOrExpAdjustment: undefined }, { resetReachLevel: false });
  }

  /**
   * 上限0の行でも明示0を保存してよいか。stock は睡眠の押し下げと同じ半ロックで、
   * 下方向へ0まで操作できるのが仕様。アメブなし・Lv70は stock でも入力欄として意味がない。
   */
  function canSaveExplicitZeroBoost(r: CalcRow): boolean {
    return sleepTargetTraits(r).candy === "stockOnly" && boostKind.value !== "none" && r.srcLevel < MAX_LEVEL;
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
    if (!r || sleepTargetTraits(r).candy === "none") return;
    if (isBoostInputDisabledBySleep(r)) return;
    const mid = clampInt(v, r.srcLevel, MAX_LEVEL, r.srcLevel);
    if (mid > boostReachLevelCapFor(r)) return;

    if (mid > r.dstLevel) {
      commitRow(id, {
        dstLevel: mid,
        dstExpInLevel: 0,
        boostReachLevel: mid,
        boostOrExpAdjustment: undefined,
        boostReachAuto: false,
        boostMinimizeRow: undefined,
        candyTarget: undefined,
      }, rowFieldUndoLabel(r, t("calc.row.boostReachLevel")));
      return;
    }

    commitRow(
      id,
      { boostReachLevel: mid, boostOrExpAdjustment: undefined, boostReachAuto: false, boostMinimizeRow: undefined },
      rowFieldUndoLabel(r, t("calc.row.boostReachLevel")),
    );
  }

  /**
   * アメブ目標Lvの上限より上へ上げようとしたとき、アメブ個数を `T'` までの最大にする（2026-10-24 ユーザー規則）。
   *
   * ピッカーはLvの整数しか選べず、上限は `T'` の端数を切り捨てたLvなので、`T'` が現在Lvの途中にあると
   * ピッカーでは端数までアメブにできない（現在Lvはアメブ0本の意味）。アメブ個数欄へ上限を手で打つのと同じ値を一発で入れる。
   * **アメブ目標Lvは保存しない**（`T'` 超はクランプしない。§6）。
   */
  function fillBoostCandyToCap(id: string) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r || !canFillBoostCandyToCap(r)) return;
    onRowBoostCandy(id, String(boostCandyFillTargetFor(r)), { standaloneUndo: true });
  }

  /**
   * `fillBoostCandyToCap` が入れる個数。アメブ個数欄の上限を、実効値と同じ枠で抑える。
   * 個数指定の行は個数指定の内側まで（個数欄へ上限を手で打つと個数指定が引き上がるが、ここでは動かさない）。
   * アメ在庫＋睡眠の行は使うアメ数まで。
   */
  function boostCandyFillTargetFor(r: CalcRow): number {
    const budget = effectiveCandyTargetOf(r)
      ?? (sleepTargetTraits(r).candy === "stockOnly" ? rowStockCandyTargetFor(r.id) : undefined)
      ?? Number.POSITIVE_INFINITY;
    return Math.min(maxBoostCandyInputFor(r), budget);
  }

  /** 上限が Lv70 未満で、いまのアメブ個数が `boostCandyFillTargetFor` に届いていない行。 */
  function canFillBoostCandyToCap(r: CalcRow): boolean {
    if (sleepTargetTraits(r).candy === "none" || isBoostInputDisabledBySleep(r)) return false;
    if (boostReachLevelCapFor(r) >= MAX_LEVEL) return false;
    return resolveEffectiveBoostCandy(r) < boostCandyFillTargetFor(r);
  }

  function nudgeBoostLevel(id: string, delta: number) {
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    setBoostLevel(id, (r.boostReachLevel ?? 0) + delta);
  }

  /**
   * あとEXPの変更。入力を検証して個体（正本）へ書くだけ。
   * 元Lvは変わらないので個数指定・睡眠目標は維持する（§6.3 と同じ規則）。
   * ただし出発点が動く以上、個数指定ありの行では実効目標も動くため dstLevel を同期する
   * （同期の `normalizeRowState` が保存目標を追従させる）。
   */
  function onRowExpRemaining(id: string, v: string) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    const toNext = Math.max(0, calcExp(r.srcLevel, r.srcLevel + 1, r.expType));
    // 空文字 or 0 → 未設定（次Lvまで全部＝レベルアップ直後扱い）
    // 0 も未設定として渡し、共通の正規化（§5-7）に任せる
    const parsed = v.trim() === "" ? 0 : clampInt(v, 0, toNext, toNext);
    const rem = parsed === 0 ? undefined : parsed;
    individuals.updateIndividual(
      individualBoxIdOf(r),
      { expRemaining: rem },
      { label: rowFieldUndoLabel(r, t("calc.row.expRemaining")) },
    );
  }
  /**
   * EXP性格補正の変更（操作仕様 §4.13）。入力を検証して個体（正本）へ書くだけ。
   * 計画への影響は同期（`rowsAfterNatureChange`）が引き受ける。
   */
  function setNature(id: string, nature: ExpGainNature) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    if (r.nature === nature) return;
    individuals.updateIndividual(
      individualBoxIdOf(r),
      { nature },
      { label: rowFieldUndoLabel(r, t("calc.row.nature")) },
    );
  }

  /**
   * EXP性格補正が変わったときの計画の変化。確定はしない。
   *
   * **この関数はアメブが anchor の行を想定している。** アメブ個数だけが anchor で、
   * 変更前の性格においてアメブが目標全体を賄う行では、変更後の到達点を
   * `dstLevel` / `dstExpInLevel` の patch として渡す。派生目標を patch に含めるのは、
   * `normalizeRowState` のアメブ anchor 分岐が目標を上方向にだけ動かすラチェットだからである。
   *
   * 導出モードの行だけアメブ枠を配り直す。明示アメブ個数はユーザーの意図なので残す。
   */
  function rowsAfterNatureChange(source: readonly CalcRow[], r: CalcRow, nature: ExpGainNature): CalcRow[] {
    const patch: Partial<CalcRow> = { nature };
    // 睡眠EXPが残る行は引き直さない。アメだけの到達点で目標を作ると、睡眠目標で 0 にした Lv内EXP を戻してしまう
    // （`normalizeRowState` の押し上げと同じ理由。spec §4.7）。
    // アメを配らない行（すべて睡眠）も引き直さない。保存アメブは凍結中の休眠値で、目標を決めない（spec §7）。
    if (
      r.candyTarget === undefined
      && r.boostOrExpAdjustment !== undefined
      && rowSleepExp(r) === 0
      && sleepTargetTraits(r).candy !== "none"
    ) {
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

    if (r.boostOrExpAdjustment === undefined) {
      return rowsAfterPatchWithQuota(source, r.id, patch, { resetReachLevel: false });
    }
    return rowsAfterPatch(source, r.id, patch);
  }
  /**
   * アメ個数指定の確定（§4.3）。
   * - 空欄 → 「個数指定なし」へ遷移。dstLevel は据え置き、Lv内EXPを0に戻す（明示アメブの到達点が先ならラチェット）
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
      commitRow(
        id,
        { candyTarget: undefined, dstExpInLevel: 0 },
        rowFieldUndoLabel(r, t("calc.row.candyTarget")),
      );
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
  function setRowSleepTarget(id: string, target: number | SleepTargetMode | undefined, options: SleepTargetCommitOptions = {}) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;

    const label = rowFieldUndoLabel(r, t("calc.row.sleepTarget"));
    const patch: Partial<CalcRow> = {
      sleepTargetMode: isSleepTargetMode(target) ? target : undefined,
      sleepTargetHours: typeof target === "number" ? target : undefined,
    };
    if (target !== undefined) {
      patch.candyTarget = undefined;
      patch.dstExpInLevel = 0;
    }

    // アメを配らないモード中に保留した目標Lv変更の規則を、OFF と同じ1回の履歴へまとめて適用する。
    // 「アメ在庫＋睡眠」へ移るときもアメブが使えるようになるので、同じ復帰処理を通す。
    // アメを配らないモード同士の切り替えでは、保存値を凍結したままにする。
    if (sleepTargetTraits(r).candy === "none" && sleepTargetTraits(patch).candy !== "none") {
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
        // **Lvだけで比べる**（2026-10-24）。モードに入るとき目標のLv内EXPを 0 にしているので、EXPまで比べると、
        // 個数で目標を押し上げていた行（Lv17＋330EXP）が、入れて外しただけで「超えた」になり個数が消える。
        // 消すのは、モードの間に目標Lvを個数の届くLvより下げたときだけ。残した個数は目標を届く点まで押し上げ直す。
        // 消すときのアメブ目標Lvは目標Lv。個数のある行の保存値は個数を入れる前の古い値なので、
        // それとの min を取ると、アメブで届いていた範囲が個数を入れる前まで縮む。
        if (reached.level > r.dstLevel) {
          patch.boostOrExpAdjustment = undefined;
          patch.boostReachLevel = r.dstLevel;
        }
      }
    }
    commitRow(id, patch, label, options);
  }

  /** 数値の睡眠目標を使う既存呼び出し向け。 */
  function setRowSleepTargetHours(id: string, hours: number | undefined) {
    setRowSleepTarget(id, hours);
  }

  /**
   * 累計睡眠時間の変更。個数指定があるときは新しい睡眠EXPで最終目標を引き直す（同期の `normalizeRowState`）。
   * 個体（正本）へ書くだけ。未指定は 0h。
   */
  function setRowSleepHours(rowId: string, sleepHours: number | undefined) {
    const row = rows.value.find((x) => x.id === rowId);
    if (!row) return;
    individuals.updateIndividual(
      individualBoxIdOf(row),
      { sleepHours: sleepHours ?? 0 },
      { label: rowFieldUndoLabel(row, t("calc.undoLabel.sleepHours")) },
    );
  }
  /**
   * アメブ個数の入力（§4.3）。
   *
   * アメブが駆動側なので、増やして総アメ数を超えたら個数指定の方を引き上げる。
   * （逆に個数指定を減らしたときは、そちらが駆動側なのでアメブを内数へクランプする）
   * 空白確定は行のリセットボタンと同じ（アメブ枠から配り直す。§9.3 を 2026-09-26 に改訂）。
   * 空欄は自動計算の値を薄く出しているので、消したら自動計算へ戻る方が見た目と一致する。0 は 0 と打つ。
   *
   * **上限を超える入力は上限へクランプする（2026-08-25 ユーザー規則）。**
   *
   * 以前は睡眠ありの行だけ「受け取らずに戻す」形にしていた。上限0の行でクランプすると
   * 「明示的に0個」が確定してしまうためだが、拒否された入力は導出モードの値（多くは0）で
   * 再描画されるので、ユーザーには**大きい数を入れたら0になった**としか見えなかった。
   *
   * 睡眠ありでは上限0の欄を `isBoostInputDisabledBySleep` が無効化する。
   * それ以外の経路も、確定値を保存する前に上限0を弾いて「明示的に0個」を焼き付けない。
   * ただし stock は半ロックなので、在庫0へ下げる操作だけは明示0として受け取る。
   */
  function onRowBoostCandy(
    id: string,
    v: string,
    options: { standaloneUndo?: boolean } = {},
  ) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r || sleepTargetTraits(r).candy === "none") return;
    if (isBoostInputDisabledBySleep(r)) return;

    const inputMax = maxBoostCandyInputFor(r);
    const undoOptions = options.standaloneUndo ? {} : { coalesceKey: `rowBoostCandy:${id}` };
    // 上限0の行は原則として「明示的に0個」を焼き付けない（§11.11）。空白確定も受け取らない。
    if (inputMax === 0 && !canSaveExplicitZeroBoost(r)) return;

    if (v.trim() === "") {
      resetRowBoostCandy(id);
      return;
    }

    const rawN = Math.max(0, Math.floor(Number(v) || 0));
    const n = Math.min(rawN, inputMax);
    const patch: Partial<CalcRow> = {
      boostOrExpAdjustment: n,
    };
    if (r.candyTarget !== undefined && n > r.candyTarget) patch.candyTarget = n;
    commitRow(
      id,
      patch,
      rowFieldUndoLabel(r, t("calc.row.boostCandyCount")),
      undoOptions,
    );
  }

  /** 行単位の最小化スイッチを操作できる条件を返す。 */
  function canSetRowMinimizeBoost(id: string): boolean {
    const row = rows.value.find((candidate) => candidate.id === id);
    return !minimizeBoost.value
      && row !== undefined
      && canMinimizeBoostRow(row) !== undefined
      && !isBoostInputDisabledBySleep(row);
  }

  /** 行単位のアメブ最小化を切り替える。 */
  function setRowMinimizeBoost(id: string, on: boolean): "applied" | "disabled" {
    const row = rows.value.find((candidate) => candidate.id === id);
    if (!row) return "disabled";
    const undoLabel = rowFieldUndoLabel(row, t("calc.row.boostCandyCount"));
    if (!on) {
      if (row.boostMinimizeRow !== true) return "disabled";
      commitRow(id, { boostMinimizeRow: undefined }, undoLabel);
      return "applied";
    }
    if (!canSetRowMinimizeBoost(id)) return "disabled";
    commitRow(id, {
      boostOrExpAdjustment: undefined,
      boostReachAuto: true,
      boostMinimizeRow: true,
    }, undoLabel);
    return "applied";
  }

  /**
   * 個数指定を保ったまま、指定Lvへ届く最小アメブを個数欄と同じ経路で適用する（§7）。
   * 指定Lvは睡眠込みの最終Lv。睡眠目標があれば睡眠EXPを戻した点（T' の側）へアメで届けばよい。
   */
  function applyMinBoostForCandyTarget(id: string, level: number): ApplyMinBoostForCandyTargetResult {
    const row = rows.value.find((candidate) => candidate.id === id);
    const kind = boostKind.value;
    // 画面に出ている個数指定（実効値）で解く
    const budget = row && effectiveCandyTargetOf(row);
    if (
      !row
      || budget === undefined
      || budget <= 0
      || sleepTargetTraits(row).candy !== "normal"
      || kind === "none"
      // アメブ個数欄が入力を受け取らない行では、適用しても何も書かれない
      || (maxBoostCandyInputFor(row) === 0 && !canSaveExplicitZeroBoost(row))
    ) return { kind: "disabled" };

    const targetLevel = clampInt(level, row.srcLevel, MAX_LEVEL, row.srcLevel);
    // 睡眠目標が無ければ S = 0 で、指定Lvちょうどがそのままアメの終端になる
    const candyEnd = candyEndBeforeSleep(row, targetLevel, 0);
    const result = minBoostWithinCandyBudget(row, candyEnd, kind, budget);
    if (result.kind === "unreachable") return result;

    onRowBoostCandy(id, String(result.boostCandy), { standaloneUndo: true });
    return { kind: "applied" };
  }

  /**
   * 総アメ数 `budget` 以内でアメの終端 `end` へ届く最小のアメブ個数。届かなければ届くのに要る最小の総アメ数。
   * 逆算ツール（個数指定）とアメブ最小化（在庫）の共通部分。「{n}個以上のアメが必要です」の n はここで決まる。
   */
  function minBoostWithinCandyBudget(
    row: CalcRow,
    end: { level: number; expInLevel: number },
    kind: Exclude<BoostEvent, "none">,
    budget: number,
  ): { kind: "within"; boostCandy: number } | { kind: "unreachable"; neededCandy: number } {
    const shared = { srcLevel: row.srcLevel, expType: row.expType, nature: row.nature, expGot: rowExpGot(row) };
    const boostCandy = minBoostWithinBudget({
      ...shared,
      targetLevel: end.level,
      targetExpInLevel: end.expInLevel,
      boostKind: kind,
      budget,
    });
    // minCandyForTarget の必要総数には使うアメブが含まれるため、予算内の解では n <= budget。
    // 念のため、将来ヘルパーの仕様が変わっても予算を超えないようにする。
    if (boostCandy !== undefined && boostCandy <= budget) return { kind: "within", boostCandy };
    // アメブはふつうのアメより多くEXPが入るので、全部アメブで上げるときが最も少ない個数で届く。
    const neededCandy = calcExpAndCandy({
      ...shared,
      dstLevel: end.level,
      dstExpInLevel: end.expInLevel,
      boost: kind,
    }).candy;
    return { kind: "unreachable", neededCandy };
  }

  /**
   * アメブが担当できる終端。睡眠なしなら MAX_LEVEL、睡眠ありは T'（§10.18）、
   * stock は上位行の取り分を除いた利用可能在庫をアメブへ使ったときの到達Lv。
   * **ここを超える入力は受け取らない**（クランプしない）。クランプすると、ユーザーが
   * 選んでいない値が「意図」として保存され、睡眠目標を解除しても戻らなくなる（§11.12）。
   */
  function boostReachLevelCapFor(r: CalcRow): number {
    const candy = sleepTargetTraits(r).candy;
    if (candy === "none") return MAX_LEVEL;
    if (candy === "stockOnly") {
      const stockCandyAvailable = rowStockCandyAvailableFor(r.id);
      // 種族を解決できない行では在庫上限自体が不明。0個と混同せず制限を掛けない。
      return stockCandyAvailable === undefined
        ? MAX_LEVEL
        : boostReachLevelForCandy(r, stockCandyAvailable);
    }
    return r.sleepTargetHours === undefined ? MAX_LEVEL : rowCandyTargetBeforeSleep(r).level;
  }

  /**
   * 睡眠EXPによる上限が効いている行。**案内文を用意する条件。**
   *
   * **アメ在庫＋睡眠の在庫による上限は含めない**（2026-09-26 ユーザー決定）。アメを在庫の分だけ使い、
   * 残りを睡眠で上げるモードなので、在庫で頭打ちになるのは意図どおり（アメ不足ではない）。何も出さない。
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
    if (r.sleepTargetMode !== undefined || r.sleepTargetHours === undefined || boostKind.value === "none") return false;
    if (reachLevelMax >= MAX_LEVEL) return false;
    return reachLevel >= reachLevelMax;
  }

  /**
   * 睡眠EXPがアメブの担当範囲を押し下げている状態（§10.18）。破線を出す条件。
   * アメ在庫＋睡眠の在庫上限は含めない。在庫をアメブにするか通常アメにするかはユーザーが決められるので、
   * アメブ2欄は操作できる欄のまま（2026-09-26 ユーザー決定）。
   *
   * **これは「入力できない」ではない。** T' 以下の範囲は今までどおり上げ下げできる。
   * 動かせないのは押し下げられた範囲（T' 超）だけ。そこの扱いは欄で違う——
   * **アメブ目標Lv（`setBoostLevel`）は受け取らずに戻し、アメブ個数（`onRowBoostCandy`）は
   * 上限へクランプする**（2026-08-25 改訂。設計書 §18.2）。
   */
  function isBoostSleepCapped(r: CalcRow): boolean {
    if (sleepTargetTraits(r).candy === "none" || boostKind.value === "none" || r.sleepTargetHours === undefined) return false;
    if (r.srcLevel >= MAX_LEVEL) return false;
    return (r.boostReachLevel ?? r.dstLevel) > boostReachLevelCapFor(r)
      || maxBoostCandyInputFor(r) === 0;
  }

  /**
   * 睡眠EXPが目標まで賄ってしまい、アメブを1個も使えない状態。
   * アメブ区間が丸ごと消えるので、2欄とも入力欄そのものを無効化する。
   */
  function isBoostInputDisabledBySleep(r: CalcRow): boolean {
    const candy = sleepTargetTraits(r).candy;
    if (candy === "none") return true;
    // stock は在庫0でも半ロックとして下方向へ0まで操作できるため無効化しない。
    if (candy === "stockOnly" || boostKind.value === "none" || r.sleepTargetHours === undefined) return false;
    return maxBoostCandyInputFor(r) === 0;
  }

  /**
   * アメブ個数欄の上限。睡眠ありではアメ担当終端 T'、通常入力では MAX_LEVEL。
   * 条件変更時は `endAtTargetWithoutSleep` を指定し、睡眠なしでも保存目標を終点にする。
   *
   * **「アメ在庫＋睡眠」では利用可能在庫でも止める（2026-08-25 ユーザー指摘）。** 個数指定 `m` は
   * 実際に使うアメ数から決まる一方、入力上限は上位行の取り分を除いた在庫を見る。以前は在庫を見ずに
   * MAX_LEVEL 基準の上限だけを見ていたので、在庫256の行に400と入力でき、欄は400のまま結果だけ
   * 256になった（`resolveEffectiveBoostCandy` の `candyBudget` が実効値だけを絞るため）。
   * 入力の上限と実際に使える量は同じ値であるべきなので、ここでも在庫を掛ける。
   */
  function maxBoostCandyInputFor(r: CalcRow, endAtTargetWithoutSleep = false): number {
    const candy = sleepTargetTraits(r).candy;
    if (candy === "none" || boostKind.value === "none" || r.srcLevel >= MAX_LEVEL) return 0;
    const base = (() => {
      if (r.sleepTargetHours === undefined) {
        if (!endAtTargetWithoutSleep) return boostCandyToMaxLevel(r);
        return calcExpAndCandy({
          srcLevel: r.srcLevel,
          dstLevel: r.dstLevel,
          dstExpInLevel: normalizeTargetExpInLevel(r.dstLevel, r.dstExpInLevel, r.expType),
          expType: r.expType,
          nature: r.nature,
          boost: boostKind.value,
          expGot: rowExpGot(r),
        }).candy;
      }
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
    if (candy === "stockOnly") {
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
   * 終点 `end` まで賄うアメブ個数。終点は呼び出し側（resolveEffectiveBoostCandy）がアメブ目標Lvの意図で決める
   * （2026-09-26 ユーザー規則「勝手に通常アメを増やさない」）。
   *
   * `coversWholeRange`: アメブ100%で目標へ届くか。このときだけ「アメブ1個 → 通常アメ1個」置換（§3.8-e）を当てる。
   * 置換は、最後の1個のアメブを通常アメに替えても目標に届くとき（最後のはみ出しEXPが捨てられるとき）だけ成り立つ。
   *
   * 1. アメブ目標Lvが担当範囲より下（その先を通常アメで続ける）ときは、はみ出しEXPが先で使われるので成り立たない。
   *    個数指定のある行はアメ数で目標が動くので、成り立つのは Lv70 に届くときだけ
   * 2. **睡眠EXPが乗る行では成り立たない**（2026-07-30 ユーザー規則・§15.8）。担当終端 `T'` を超えたEXPが
   *    捨てられず最終目標へ効く
   */
  function boostCandyForEnd(
    r: CalcRow,
    end: { level: number; expInLevel: number },
    coversWholeRange: boolean,
  ): number {
    const shared = { srcLevel: r.srcLevel, expType: r.expType, nature: r.nature, expGot: rowExpGot(r) };
    return coversWholeRange
      ? minBoostForTarget({
        ...shared,
        targetLevel: end.level,
        targetExpInLevel: end.expInLevel,
        boostKind: boostKind.value, maxBoost: Number.MAX_SAFE_INTEGER,
        allowNormalSwap: rowSleepExp(r) === 0,
      })
      : calcExpAndCandy({ ...shared, dstLevel: end.level, dstExpInLevel: end.expInLevel, boost: boostKind.value }).candy;
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
    // 最終目標のLv内EXP。個数指定・アメブ個数のどちらも未入力の行は 0（目標は Lv ちょうど。§4.5）。
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
    const isMinimizedBoost = r.boostOrExpAdjustment === undefined
      && stockCandyAllocationByRowId.value.minimizedBoost[r.id] !== undefined;
    // アメを配らないモードでは使うアメブが 0 なので、保存した個数が届くLvを出す（2026-10-24 ユーザー指摘）。
    // 使う数で引くと現在Lvまで下がって見える。モードの間に目標Lvを下げた行は、外すとき個数が消えて
    // アメブ目標Lvが目標Lvまでになる（`setRowSleepTarget`）ので、今から目標Lvで収める。
    const candyDormant = sleepTargetTraits(r).candy === "none";
    const uiBoostReachLevel = r.boostOrExpAdjustment !== undefined || isMinimizedBoost
      ? clampInt(
        calcLevelByCandy({
          srcLevel: src, dstLevel: MAX_LEVEL, expType: expT, nature: nat,
          boost: boostKind.value, candy: candyDormant ? r.boostOrExpAdjustment ?? 0 : uiCandy, expGot,
        }).level,
        src, candyDormant ? Math.min(dst, boostReachLevelMax) : boostReachLevelMax, src,
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
    const boostSleepCapped = isBoostSleepCapped(normalizedRow);
    const boostInputDisabled = isBoostInputDisabledBySleep(normalizedRow);

    const resolvedTitle = String(r.title ?? "").trim() || NO_NAME_TITLE;

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
        boostMinimizeFallback: stockCandyAllocationByRowId.value.minimizeFallback[r.id] === true,
        boostMinimizeFallbackNeededCandy: stockCandyAllocationByRowId.value.minimizeFallbackNeededCandy[r.id],
        boostMinimizeFallbackSharedStock: stockCandyAllocationByRowId.value.minimizeFallbackSharedStock[r.id] === true,
        boostReachLevel: uiBoostReachLevel,
        boostReachLevelMax,
        boostCandyInputMax: maxBoostCandyInputFor(r),
        boostCapActive,
        boostSleepCapped,
        boostInputDisabled,
        boostFillToCapAvailable: canFillBoostCandyToCap(normalizedRow),
        boostQuotaViolation,
        noCandyHintKey: noCandyHintKeyFor(r),
      },
    };
  }

  /** アメを1個も配らない行の無効理由の文言キー。配る行は null。決めるのはここだけ */
  function noCandyHintKeyFor(row: CalcRow): NoCandyHintKey | null {
    const traits = sleepTargetTraits(row);
    if (traits.candy !== "none" || traits.rest === "none") return null;
    return NO_CANDY_HINT_KEY[traits.rest];
  }

  const rowsView = computed(() => {
    let remainingBoostCandy = autoBoostCandyCap();
    return rows.value.map((r) => {
      // 種族不明の行は枠を使わず、枠も無限として見る（赤枠を出さない）
      const speciesUnknown = isSpeciesUnknownRow(r);
      const v = calcRowView(r, speciesUnknown ? Number.POSITIVE_INFINITY : remainingBoostCandy);
      if (!speciesUnknown) remainingBoostCandy = Math.max(0, remainingBoostCandy - v.ui.boostCandyInput);
      return {
        ...r,
        title: v.title,
        linkBroken: !r.boxId || !individuals.individualById.value.has(r.boxId),
        srcLevel: v.normalized.srcLevel,
        dstLevel: v.normalized.dstLevel,
        dstExpInLevel: v.normalized.dstExpInLevel,
        expRemaining: v.normalized.expRemaining,
        // 個数指定は実効値（Lv70 へ届く数で抑えた値）を見せ、ソルバーへもこの数を渡す
        candyTarget: effectiveCandyTargetOf(r),
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

  /**
   * 睡眠（・おひるね島）のあとの実際の着地点。目標Lvに届くかどうかに関係なく返す（`calcSleepLandingLevel`）。
   * 寝る（預ける）予定が無い行は null。育成プランの画像（zzZ）と CSV / TSV で共通（2026-10-13 ユーザー指摘）。
   *
   * これから得るEXP:
   * - 数値の睡眠目標: 睡眠目標の時間ぶん（`rowSleepExp`）
   * - 睡眠・アメ在庫＋睡眠: 目標Lvに届くまで寝るので残EXPそのもの（睡眠時間を求められない行は 0）
   * - おひるね島: 島で得るEXP
   */
  function rowSleepLandingFor(r: CalcRow, p: PokemonPlanResult): { level: number; tenths: number | null } | null {
    const expToTarget = p.shortage.expToTarget;
    const rest = sleepTargetTraits(r).rest;
    const gainedExp = rest === "napIsland" ? calcNapIslandTimeFor(r, expToTarget).napGainedExp
      : rest !== "sleep" ? 0
      : r.sleepTargetHours !== undefined ? rowSleepExp(r)
      : isSleepPlan(calcSleepTimeFor(r, expToTarget)) ? expToTarget : 0;
    const landing = calcSleepLandingLevel({
      reachedLevel: p.reachableLine.level,
      reachedExpInLevel: p.reachableLine.expInLevel,
      sleepExp: gainedExp,
      expType: r.expType,
    });
    return landing.shown ? { level: landing.level, tenths: landing.tenths } : null;
  }

  const exportRows = computed(() => {
    if (!planResult.value) return [];
    return rowsView.value.map((r) => {
      // 種族不明の行は全体計画に入れないので、育成プランにも出さない（結果は行にだけ出す）
      if (isSpeciesUnknownRow(r)) return null;
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
        // CSV の目標Lvは従来どおり最終目標を維持する。
        dstLevel: p.targetLevel,
        // 画面・画像では、アメ終了地点と睡眠後の目標を分けて見せる。
        candyReachLevel: p.reachableLine.level,
        sleepTargetLevel: rowSleepLandingFor(r, p)?.level,
        boostCandy,
        normalCandy,
        totalCandy: boostCandy + normalCandy,
        shards,
        candySupply,
      };
    }).filter((x): x is NonNullable<typeof x> => x !== null);
  });

  /**
   * 育成プランの表出力（CSV / TSV）の行。計算画面の結果行（`CalcPanel` の到達可能行）と同じ値を出す。
   * 不足は律速の資源の1つとアメブ枠（`CalcPanel` の `buildRowShortage` と同じ規則）。
   */
  const exportTableRows = computed((): ExportTableRow[] => {
    if (!planResult.value) return [];
    const tokens = sleepTimeFormatTokens(t);
    // 画面の不足チップと同じく、有限の正の値だけを出す
    const shownAmount = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
    return flatMapOf(rowsView.value, (r): ExportTableRow[] => {
      if (isSpeciesUnknownRow(r)) return [];
      const p = getPokemonResult(r.id);
      if (!p) return [];
      const line = p.reachableLine;
      const supply = line.candySupply;
      const remainingExp = p.shortage.expToTarget;
      const rest = sleepTargetTraits(r).rest;

      // 残EXPを睡眠で埋めた場合の時間（画面の「残EXP 約N日」）。睡眠目標に関係なく出す（島の行も睡眠に換算）
      const remainingSleepTime = remainingExp > 0 ? formatSleepTimeResult(calcSleepTimeFor(r, remainingExp), tokens) ?? "" : "";
      const nap = rest === "napIsland" && remainingExp > 0 ? calcNapIslandTimeFor(r, remainingExp) : null;
      // 実際に寝る（預ける）時間。睡眠目標が無い行は空。数値の睡眠目標は睡眠目標までの残り時間
      // （目標Lvまでの日数を出すと、あと少しで睡眠目標に届く行に「約170日」と出る）。
      // 睡眠・おひるね島は目標Lvに届いた時点で終えるので、目標Lvまでの時間
      const sleepTargetHoursLeft = r.sleepTargetHours !== undefined ? rowSleepRemainingHoursFor(r.id) : 0;
      const restTime = rest === "none" ? ""
        : r.sleepTargetHours !== undefined ? (sleepTargetHoursLeft > 0 ? `${sleepTargetHoursLeft}${tokens.hourUnit}` : "")
        : nap ? formatNapIslandDuration(nap.minutes, tokens, "full")
        : rest === "sleep" ? remainingSleepTime : "";

      // Lv だけ（「約」も寝る時間も付けない。時間は隣の列にある）。小数は画面と同じ切り捨て、Lv70 は小数なし
      const reach = rowSleepLandingFor(r, p);
      const restReachLevel = !reach ? "" : reach.tenths === null ? `${reach.level}` : `${reach.level}.${reach.tenths}`;

      const limiting = p.constraintDiagnosis.limitingFactor;
      const sleepTarget = sleepTargetNameParts(t, sleepTargetChoiceOf(r));
      const boostCandy = line.boostedCandyUnits;
      const normalCandy = line.nonBoostCandyUnits;
      return [{
        title: String(r.title ?? "").trim() || "(no name)",
        natureLabel: natureLabel(r.nature) || t("calc.row.natureNormal"),
        srcLevel: r.srcLevel,
        expRemaining: r.expRemaining,
        candyReachLevel: line.level,
        candyReachExpToNext: line.expToNextLevel,
        targetLevel: p.targetLevel,
        sleepTarget: `${sleepTarget.name}${sleepTarget.options}`,
        remainingExp,
        remainingSleepTime,
        restTime,
        restReachLevel,
        boostReachLevel: r.ui.boostReachLevel,
        boostCandy,
        normalCandy,
        totalCandy: boostCandy + normalCandy,
        shards: line.dreamShardsUsed,
        species: supply.species,
        typeS: supply.type.s,
        typeM: supply.type.m,
        universalS: supply.universal.s,
        universalM: supply.universal.m,
        universalL: supply.universal.l,
        growthIncense: rowGrowthIncenseCountFor(r.id),
        napTickets: nap?.ticketCount ?? 0,
        surplus: lineSurplus(line),
        candyShortage: limiting === "candy" ? shownAmount(p.shortage.candyToTarget) : 0,
        shardsShortage: limiting === "shards" ? shownAmount(p.shortage.dreamShardShortage) : 0,
        boostShortage: shownAmount(p.shortage.boostCandyUnavailable),
      }];
    });
  });

  const exportActualTotals = computed(() => {
    if (!planResult.value) return { boostCandy: 0, normalCandy: 0, totalCandy: 0, shards: 0 };
    const boostCandy = planResult.value.summary.totalSupplied.totalBoostedCandyUnits;
    const normalCandy = planResult.value.summary.totalSupplied.totalNonBoostCandyUnits;
    const shards = planResult.value.summary.totalSupplied.totalDreamShards;
    return { boostCandy, normalCandy, totalCandy: boostCandy + normalCandy, shards };
  });

  const debugExportEnabled = PLAN_RESULT_PERF_ENABLED;

  /**
   * 検算TSV用の睡眠EXP中間値（?perf=1）。
   * 「計画した日数」と「残EXPから逆算した必要日数」を並べ、どこで食い違うか切り分けられるようにする。
   */
  function buildDebugSleepRow(row: CalcRow, plan: PokemonPlanResult | null): DebugExportSleepRow | undefined {
    // 島の行は睡眠しない（睡眠の節に出さない）。島の節は buildDebugNapRow が担当する。
    if (!rowHasSleepPlan(row)) return undefined;
    // 残EXPから逆算した所要睡眠（needed* 列）。数値の睡眠目標では、睡眠目標の時間を超えて目標Lvまで寝た場合の値。
    const needed = plan === null ? undefined : calcSleepTimeFor(row, plan.shortage.expToTarget);
    // お香の個数と最終日の扱いは、実際に寝る期間で数える（画面の必要アイテムと同じ `resolveRowSleepPlan`）。
    // 数値の睡眠目標では睡眠目標の時間で打ち切る。needed から取ると、睡眠目標を超えた期間のお香まで数えてしまう
    const screenPlan = resolveRowSleepPlan(row.id)?.needed;
    const incense = screenPlan
      ? { growthIncenseCount: screenPlan.growthIncenseCount, skipsLastDayIncense: screenPlan.skipsLastDayIncense }
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

  /** 検算TSV（?perf=1）の島の節。島の行だけ。値は画面と同じ `calcNapIslandTimeFor` から取る（計算し直さない） */
  function buildDebugNapRow(row: CalcRow, plan: PokemonPlanResult | null): DebugExportNapRow | undefined {
    const traits = sleepTargetTraits(row);
    if (traits.rest !== "napIsland") return undefined;
    return {
      ticket: traits.napTicket,
      expToTarget: plan?.shortage.expToTarget ?? 0,
      result: calcNapIslandTimeFor(row, plan?.shortage.expToTarget ?? 0),
    };
  }

  function buildDebugExportContext(): DebugExportContext {
    const displayed = displayedPlanResult.value;
    return {
      result: planResult.value,
      rows: rowsView.value.map(row => {
        const plan = getPokemonResult(row.id);
        const pokedexId = plan?.pokedexId ?? row.pokedexId;
        return {
          id: row.id,
          name: row.title,
          pokedexId,
          // 種族不明の行は系統キーが無い。検算TSVはこれで全体計画の行を見分ける（`isGlobalPlanRow`）
          candyFamilyKey: getRowCandyFamilyKey(row),
          type: row.pokemonType ?? "",
          nature: row.nature,
          expType: row.expType,
          currentLevel: row.srcLevel,
          currentExpInLevel: Math.max(0, calcExp(row.srcLevel, row.srcLevel + 1, row.expType) - row.expRemaining),
          expRemaining: row.expRemaining,
          targetLevel: row.dstLevel,
          targetExpInLevel: plan?.targetExpInLevel,
          candyTarget: row.candyTarget,
          sleepTargetMode: row.sleepTargetMode,
          boostCandyInput: row.boostOrExpAdjustment,
          boostCandyEffective: row.ui.boostCandyInput,
          sleep: buildDebugSleepRow(row, plan),
          nap: buildDebugNapRow(row, plan),
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
        loss: displayed.loss,
        durationMs: displayed.durationMs,
      } : null,
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
    if (await copyText(text)) return "copied";
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

  /**
   * 種族不明の行（図鑑番号が無い。手入力で図鑑の名前と一致しないニックネームだけを入れた個体・取り込みで読めなかった個体）。
   * **スロットの全体計画に入れない**（2026-10-24 ユーザー決定）。アメブ枠・種族アメ在庫・睡眠チームの定員を使わず、
   * 全体の集計・育成プランにも出さない。結果だけをその行で計算する（`speciesUnknownResultByRowId`）。
   */
  function isSpeciesUnknownRow(r: Pick<CalcRow, "pokedexId">): boolean {
    return getRowCandyFamilyKey(r) === undefined;
  }

  function getRowCandyFamilyKey(r: Pick<CalcRow, "pokedexId">): string | undefined {
    const pokedexId = r.pokedexId;
    if (pokedexId === undefined || !isValidPokedexId(pokedexId)) return undefined;
    const family = getCandyFamilyKey(pokedexId);
    return isCandyFamilyKey(family) ? family : undefined;
  }

  // ─────────────────────────────────────────────────────────────
  // planResult (新フェーズベースのレベルアップ計画)
  // ─────────────────────────────────────────────────────────────

  function plannerRowDtoOf(row: CalcRowView): PlannerInputRowDto {
    return {
      id: row.id,
      pokedexId: row.pokedexId,
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
      boostOrExpAdjustment: row.boostOrExpAdjustment,
      boostCandyInput: row.ui.boostCandyInput,
      sleepExp: rowSleepExp(row),
      candyPolicy: sleepTargetTraits(row).candy,
      stockCandyTarget: rowStockCandyTargetFor(row.id),
    };
  }

  /** スロットの全体計画の入力。種族不明の行はここで落ちる（`buildLevelPlannerInput` が図鑑番号の無い行を外す）。 */
  function buildPlannerInput(): LevelPlannerInput | null {
    return buildLevelPlannerInput(rowsView.value.map(plannerRowDtoOf), {
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
   * 種族不明の行の結果（2026-10-24 ユーザー決定）。**スロットの全体計画には入れず、その行だけを1匹で解く。**
   *
   * 種族不明の行はどの種族アメを使うか分からないので、全体計画（`planResult`）から外す。
   * ほかの行と取り合わないので、種族アメ・アメブ枠・ゆめのかけらは無限として解き、万能アメ・タイプアメは使わない。
   * 結果は行の表示（`pokemonResultByRowId`）にだけ混ぜる。全体の集計・育成プランは `planResult` と
   * `isSpeciesUnknownRow` で外しているので、ここの結果は入らない。
   *
   * ソルバーは図鑑番号の無い行を受け取らないので、仮の番号で解いて結果の番号を行の値へ戻す。
   * 1匹だけの入力なので、仮の番号がほかの行のアメと混ざることはない。
   * ソルバーはメインのバンドルへ入れない（全体計画は Worker で解く）ので、フォールバックと同じく遅延読み込みする。
   */
  const SPECIES_UNKNOWN_PLACEHOLDER_POKEDEX_ID = 1;
  /** 無限の代わり。ソルバーは有限の整数しか受け取らない（`validateDemandRows`）。 */
  const SPECIES_UNKNOWN_UNLIMITED = 1_000_000_000_000;
  const speciesUnknownPlannerInputs = computed(() => flatMapOf(rowsView.value, (row) => {
    if (!isSpeciesUnknownRow(row)) return [];
    const input = buildLevelPlannerInput([{ ...plannerRowDtoOf(row), pokedexId: SPECIES_UNKNOWN_PLACEHOLDER_POKEDEX_ID }], {
      candyInventory: {
        species: { [getCandyFamilyKey(SPECIES_UNKNOWN_PLACEHOLDER_POKEDEX_ID)]: SPECIES_UNKNOWN_UNLIMITED },
        typeCandy: {},
        universal: { s: 0, m: 0, l: 0 },
      },
      dreamShards: SPECIES_UNKNOWN_UNLIMITED,
      boost: { kind: boostKind.value, limit: SPECIES_UNKNOWN_UNLIMITED },
      itemCompareMode: itemCompareMode.value,
    });
    return input ? [{ rowId: row.id, pokedexId: row.pokedexId ?? 0, input, key: `${row.id}\u0000${buildPlannerInputSignature(input)}` }] : [];
  }));
  const speciesUnknownResultByRowId = shallowRef<ReadonlyMap<string, PokemonPlanResult>>(new Map());
  /** 入力が変わらない行は解き直さない（行を1つ編集するたびに全部の種族不明の行を解かない）。 */
  let speciesUnknownResultCache = new Map<string, PokemonPlanResult>();
  watch(speciesUnknownPlannerInputs, (entries) => {
    if (!entries.length) {
      speciesUnknownResultCache = new Map();
      if (speciesUnknownResultByRowId.value.size) speciesUnknownResultByRowId.value = new Map();
      return;
    }
    void loadPlannerFallbackModule()
      .then(({ solveLevelPlan }) => {
        // 読み込みを待つ間に入力が変わったら、新しい入力の側に任せる
        if (speciesUnknownPlannerInputs.value !== entries) return;
        const nextCache = new Map<string, PokemonPlanResult>();
        const next = new Map<string, PokemonPlanResult>();
        for (const entry of entries) {
          const cached = speciesUnknownResultCache.get(entry.key);
          const solved = cached ?? solveLevelPlan(entry.input).pokemonResults[0];
          if (!solved) continue;
          const result = cached ?? { ...solved, pokedexId: entry.pokedexId };
          nextCache.set(entry.key, result);
          next.set(entry.rowId, result);
        }
        speciesUnknownResultCache = nextCache;
        // 中身が同じなら置き換えない。置き換えると行の結果の一覧（`pokemonResultByRowId`）が作り直され、
        // 結果の到着で動く表示位置の補正（`useSummaryFlip`）が、ほかの行の入力のたびに空振りする
        const current = speciesUnknownResultByRowId.value;
        const unchanged = current.size === next.size && Array.from(next).every(([rowId, result]) => current.get(rowId) === result);
        if (!unchanged) speciesUnknownResultByRowId.value = next;
      })
      .catch((error: unknown) => {
        console.error('[level-planner] species-unknown row solve failed:', error);
      });
  }, { immediate: true });
  /**
   * レベルアップ計画結果
   *
   * solveLevelPlan は重いため computed 内で同期実行しない。
   * 連続した入力変更は debounce して、最後の入力だけを計算する。
   */
  const planResult = ref<LevelPlannerResult | null>(null);
  const planResultPending = ref(false);
  const displayedPlanResult = ref<DisplayedPlanResult | null>(null);
  const defaultCalculationPerformanceProfile = (): CalculationPerformanceProfile => ({});
  const calculationPerformanceProfile = ref<CalculationPerformanceProfile>(defaultCalculationPerformanceProfile());
  const slotProfiles = new Map<string, CalculationPerformanceProfile>();
  const slotDisplayedResults = new Map<string, DisplayedPlanResult>();
  let planResultTimer: ReturnType<typeof setTimeout> | null = null;
  let planResultWorker: Worker | null = null;
  let planResultWorkerBusy = false;
  let releasePlanResultPersistDeferral: (() => void) | null = null;
  let planResultRequestId = 0;
  let planResultHasDispatched = false;
  let displayGeneration = 0;
  let previousInputSignature: string | null = null;
  let previousSlotId: string | null = null;
  let activeAutoContext: { slotId: string; inputSignature: string; input: LevelPlannerInput; generation: number } | null = null;

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

  function applyDisplayedResult(result: LevelPlannerResult, context: { slotId: string; inputSignature: string; durationMs: number }): void {
    const displayed: DisplayedPlanResult = { result, slotId: context.slotId, inputSignature: context.inputSignature, loss: result.lossLedger.hasLoss, durationMs: context.durationMs };
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

  function handleAutoResponse(response: PlannerWorkerResponse, context: { slotId: string; inputSignature: string; input: LevelPlannerInput; generation: number }): void {
    if (response.requestId !== planResultRequestId) return;
    planResultWorkerBusy = false;
    releasePlanResultPersistDeferral?.();
    releasePlanResultPersistDeferral = null;
    planResultPending.value = false;
    if (response.kind === 'error') {
      console.error('[level-planner] worker failed:', response.error);
      return;
    }
    if (!exactResultGate({ slotId: response.slotId, inputSignature: response.inputSignature, generation: context.generation })) return;
    updateProfile({ lastInputSignature: context.inputSignature }, context.slotId);
    applyDisplayedResult(response.result, { slotId: context.slotId, inputSignature: context.inputSignature, durationMs: response.durationMs });
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
      disposePlanResultWorker();
    };
    return worker;
  }

  function runPlanResult(input: LevelPlannerInput, context: { slotId: string; inputSignature: string; input: LevelPlannerInput; generation: number }): void {
    activeAutoContext = context;
    if (typeof Worker === 'undefined') {
      // Worker が使えない環境の代わりの経路。メインスレッドで同じ exact の計算を呼ぶ。
      const requestId = planResultRequestId;
      void loadPlannerFallbackModule()
        .then(({ solveLevelPlan }) => {
          const started = performance.now();
          const result = solveLevelPlan(input);
          handleAutoResponse({ kind: 'result', slotId: context.slotId, requestId, inputSignature: context.inputSignature, result, durationMs: Math.max(0, performance.now() - started) }, context);
        })
        .catch((error: unknown) => {
          if (requestId !== planResultRequestId) return;
          planResultPending.value = false;
          console.error('[level-planner] fallback load failed:', error);
        });
      return;
    }
    const worker = ensurePlanResultWorker();
    planResultWorkerBusy = true;
    releasePlanResultPersistDeferral?.();
    releasePlanResultPersistDeferral = deferPersistUntilReleased();
    worker.postMessage({ slotId: context.slotId, requestId: planResultRequestId, inputSignature: context.inputSignature, input, perfEnabled: PLAN_RESULT_PERF_ENABLED } satisfies PlannerWorkerRequest);
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
      if (rows.value.length === 0) {
        planResult.value = null;
        displayedPlanResult.value = null;
        planResultPending.value = false;
        previousInputSignature = null;
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
          previousSlotId = slotId;
          planResultPending.value = false;
          planResultTimer = null;
          return;
        }
        updateProfile({ lastInputSignature: inputSignature }, slotId);
        previousInputSignature = inputSignature;
        previousSlotId = slotId;
        planResultHasDispatched = true;
        runPlanResult(input, { slotId, inputSignature, input, generation });
        if (PLAN_RESULT_PERF_ENABLED) console.info('[perf] levelPlanner.schedule', { delayMs, waitedMs: Math.round((performance.now() - scheduledAt) * 100) / 100 });
        planResultTimer = null;
      }, delayMs);
    },
    { deep: true, immediate: true }
  );

  /** 同一 planResult に対する find をテンプレート内で繰り返さないよう Map 化 */
  const pokemonResultByRowId = computed(() => {
    const pr = planResult.value;
    const byRowId = new Map<string, PokemonPlanResult>(pr ? pr.pokemonResults.map((p) => [p.pokemonId, p] as const) : []);
    // 種族不明の行の結果は、その行だけで解いたもの（全体計画には入っていない）
    for (const [rowId, result] of speciesUnknownResultByRowId.value) byRowId.set(rowId, result);
    return byRowId;
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

  /** 個体の値のうち、行が基準値として持つ項目。 */
  function rowFieldsOfIndividual(individual: Individual) {
    return {
      title: individual.label.trim() || NO_NAME_TITLE,
      srcLevel: individual.level,
      expRemaining: individual.expRemaining,
      expType: individual.expType,
      nature: individual.nature,
      sleepHours: individual.sleepHours,
      pokedexId: individual.pokedexId,
      pokemonType: individual.pokemonType,
    } satisfies Partial<CalcRow>;
  }

  /** 行の基準値（この計画を最後に正本へ揃えたときの個体の値）。 */
  function individualOfRow(r: CalcRow): Individual {
    return {
      level: r.srcLevel,
      expRemaining: r.expRemaining,
      sleepHours: r.sleepHours ?? 0,
      expType: r.expType,
      nature: r.nature,
      label: r.title,
      pokedexId: r.pokedexId,
      pokemonType: r.pokemonType as PokemonType | undefined,
    };
  }

  /** 行の基準値と個体の値が違うか。 */
  function rowDiffersFromIndividual(r: CalcRow, individual: Individual): boolean {
    const next = rowFieldsOfIndividual(individual);
    return r.title !== next.title
      || r.srcLevel !== next.srcLevel
      || r.expRemaining !== next.expRemaining
      || r.expType !== next.expType
      || r.nature !== next.nature
      || (r.sleepHours ?? 0) !== next.sleepHours
      || r.pokedexId !== next.pokedexId
      || r.pokemonType !== next.pokemonType;
  }

  /**
   * 1行ぶんの「個体の変化 → 計画の変化」。**履歴にも `rows` にも触らない**（確定は呼び出し側）。
   * 複数の項目が同時に変わったとき（再リンク・移行）は、Lv → 性格 → そのほかの順に今と同じ規則を当てる。
   *
   * | 変わった項目 | 規則 |
   * |---|---|
   * | Lv | 個数指定を解除し、`dstExpInLevel=0`、明示アメブ個数をクランプし、導出モードは枠を配り直す |
   * | 性格 | 明示アメブ個数だけで目標を賄う行は到達点を引き直し、導出モードは枠を配り直す |
   * | そのほか | `normalizeRowState` を通す |
   *
   * 最後に、行の基準値は新しい個体の値で上書きされる。
   */
  function rowsAfterIndividualChange(
    source: readonly CalcRow[],
    rowId: string,
    prev: Individual,
    next: Individual,
  ): CalcRow[] {
    const fields = rowFieldsOfIndividual(next);
    // 表示名は計画に影響しない。名前だけの変更は正規化を通さず、基準値の title だけ更新する
    const prevFields = rowFieldsOfIndividual(prev);
    if (fields.title !== prevFields.title && JSON.stringify({ ...fields, title: "" }) === JSON.stringify({ ...prevFields, title: "" })) {
      return source.map((x) => (x.id === rowId ? { ...x, title: fields.title } : x));
    }
    let current = [...source];
    const rowOf = () => current.find((x) => x.id === rowId);

    if (next.level !== prev.level) {
      const r = rowOf();
      if (!r) return current;
      // あとEXPとEXPタイプは Lv と組で意味を持つので、Lv の規則と一緒に入れる
      current = rowsAfterLevelChange(current, r, {
        srcLevel: fields.srcLevel,
        expType: fields.expType,
        expRemaining: fields.expRemaining,
        dstExpInLevel: 0,
        candyTarget: undefined,
      });
    }
    if (next.nature !== prev.nature) {
      const r = rowOf();
      if (!r) return current;
      current = rowsAfterNatureChange(current, r, next.nature);
    }
    const r = rowOf();
    if (r && rowDiffersFromIndividual(r, next)) {
      // Lv の規則で維持した目標を、基準値の反映で押し上げ直さない（名前など他の項目が同時に変わったとき）。
      // 累計睡眠時間の変更でも押し上げない（2026-10-24 ユーザー決定）。累計は毎日増やす値で、目標は固定して
      // 必要睡眠時間の側が減る。押し上げると、累計が睡眠目標に届いて睡眠EXPが0になった瞬間にアメブ個数の
      // 到達点まで目標が伸び、累計を戻しても下がらない。
      current = rowsAfterPatch(current, rowId, fields, {
        preserveTargetForExplicitBoost: next.level !== prev.level || next.sleepHours !== prev.sleepHours,
      });
    }
    return current;
  }

  /**
   * 表示中スロットの行を、個体（正本）の値へ揃える。**履歴には記録しない。**
   * 基準値と個体の値が違う行だけを、**1行ずつ** `rows` へ確定する。アメブ枠の配分と在庫による最小化は
   * 今の `rows` から作られる computed を読むので、まとめて計算すると2行目以降が更新前の配分になる。
   * リンク切れの行は比べる相手が無いので対象外。裏のスロットは書き換えない（開いたときに揃える）。
   */
  function syncRowsWithIndividuals(): void {
    const byId = individuals.individualById.value;
    const staleIds = rows.value
      .filter((row) => {
        const individual = row.boxId ? byId.get(row.boxId) : undefined;
        return individual !== undefined && rowDiffersFromIndividual(row, individual);
      })
      .map((row) => row.id);
    for (const id of staleIds) {
      const row = rows.value.find((x) => x.id === id);
      const individual = row?.boxId ? byId.get(row.boxId) : undefined;
      if (!row || !individual) continue;
      rows.value = rowsAfterIndividualChange(rows.value, id, individualOfRow(row), individual);
    }
  }

  // ボックスでの編集・再リンク・計算機での編集・Undo / Redo による正本の復元は、すべてこの1つの経路で行へ届く
  watch(individuals.individualById, syncRowsWithIndividuals, { flush: "sync" });
  // 起動時に読み込んだ表示中スロットを揃える
  syncRowsWithIndividuals();

  /** 個体から新しい行を作る（アメブはまだ割り当てない）。 */
  function newRowFromIndividual(boxId: string, dstLevelDefault?: number): CalcRow {
    const individual = individuals.individualById.value.get(boxId);
    if (!individual) throw new Error(`calc addRow: unknown boxId ${boxId}`);
    const fields = rowFieldsOfIndividual(individual);
    // デフォルト目標Lv: 現在Lv < 60 なら 60、現在Lv >= 60 ならシステム上限
    const defaultDstLevel = fields.srcLevel < 60 ? 60 : MAX_LEVEL;
    const dstLevel = clampInt(dstLevelDefault ?? defaultDstLevel, fields.srcLevel, MAX_LEVEL, fields.srcLevel);
    return {
      id: cryptoRandomId(), boxId, ...fields,
      dstLevel,
      boostReachLevel: dstLevel,
      boostOrExpAdjustment: undefined,
    };
  }

  function addRow(boxId: string, opts: { dstLevelDefault?: number } = {}): void {
    if (rows.value.some((row) => row.boxId === boxId)) return;
    if (rows.value.length >= MAX_CALC_ROWS_PER_SLOT) {
      showToast(t("status.calcRowsFull", { max: MAX_CALC_ROWS_PER_SLOT }));
      return;
    }
    const row = newRowFromIndividual(boxId, opts.dstLevelDefault);
    // 追加した行にだけ残数から割り当てる（既存行は触らない）。
    // 残枠が無ければアメブ0が確定し、「この子にはアメブが回らない」が一目で分かる。
    // 追加と割り当てで `rows` を2回書かない（アメブ未調整の中間状態を載せない）。
    commitRows(
      allocateBoostCandyFromQuota([...rows.value, row], { rowId: row.id }),
      t("calc.undoLabel.rowAdd", { name: row.title }),
    );
    activeRowId.value = row.id;

    // スクロール位置の補正はブラウザの CSS Scroll Anchoring に委ねる。
    // 以前は nextTick + rAF x 2 で手動 scrollBy していたが、
    // iOS 17+ Safari でブラウザ補正と二重になりボックスが上に飛ぶ問題があったため削除。
  }

  function addRows(boxIds: readonly string[]): number {
    const seen = new Set(rows.value.map((row) => row.boxId).filter((id): id is string => !!id));
    const targets = boxIds.filter((boxId) => {
      if (seen.has(boxId)) return false;
      seen.add(boxId);
      return true;
    });
    if (!targets.length) return 0;

    // 入る分だけ追加し、残りは断って知らせる（ボックスの一括追加と同じ流儀）
    const room = Math.max(0, MAX_CALC_ROWS_PER_SLOT - rows.value.length);
    if (targets.length > room) {
      showToast(t("status.calcRowsFull", { max: MAX_CALC_ROWS_PER_SLOT }));
      targets.length = room;
      if (!targets.length) return 0;
    }

    // 1匹ずつ `rows` へ確定させる。割り当ては既存行の最小化結果を computed（現在の `rows`）から読むので、
    // 未確定の行をまとめて配ると addRow を順に呼んだときと結果がずれる。
    // Undo は呼び出しごとの合体キーで1回分にまとめる。
    const label = t("calc.undoLabel.rowAddMany", { count: targets.length });
    const coalesceKey = `rowAddMany:${cryptoRandomId()}`;
    for (const boxId of targets) {
      const row = newRowFromIndividual(boxId);
      commitRows(allocateBoostCandyFromQuota([...rows.value, row], { rowId: row.id }), label, { coalesceKey });
      activeRowId.value = row.id;
    }
    return targets.length;
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
    minimizeBoost,
    setMinimizeBoost,
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
    exportTableRows,
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
    countRowsByBoxIds,
    removeRowsByBoxIds,

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
    fillBoostCandyToCap,

    onRowExpRemaining,
    setNature,
    onRowCandyTarget,
    onRowBoostCandy,
    canSetRowMinimizeBoost,
    setRowMinimizeBoost,
    applyMinBoostForCandyTarget,
    resetRowBoostCandy,
    boostCandyAfterReset,

    moveRow,
    moveRowUp,
    moveRowDown,
    canMoveRowUp,
    canMoveRowDown,

    addRow,
    addRows,
    rowsAfterIndividualChange,
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
    rowRestCapacityOverflow,
    rowRemainingTimeFor,
    rowReachAfterRemainingFor,
  };
}
