import { computed, ref, toRaw, watch, type Ref } from "vue";
import type { Composer } from "vue-i18n";
import type { AppLocale } from "../i18n";
import type { BoostEvent, ExpGainNature, ExpType, SleepSettings } from "../domain/types";
import { calcExp, calcExpAndCandy, calcExpAndCandyMixed, calcLevelByCandy } from "../domain/pokesleep";
import { minBoostForTarget } from "../domain/pokesleep/minBoostForTarget";
import { calcCandyTargetFromSleepExp, markForSleep } from "../domain/pokesleep/sleep-growth";
import { deriveTarget } from "../domain/level-planner/deriveTarget";
import { boostRules, defaultBoostKind } from "../domain/pokesleep/boost-config";
import type { CalcRowV1, CalcSaveSlotV1 } from "../persistence/calc";
import { loadActiveSlot, loadCalcSlots, loadTotalShards, saveActiveSlot, saveCalcSlots, saveTotalShards, loadBoostCandyRemaining, saveBoostCandyRemaining, loadSleepSettings, saveSleepSettings } from "../persistence/calc";
import { deferPersistUntilReleased, schedulePersist } from "../persistence/deferredPersist";
import { cryptoRandomId } from "../persistence/box";
import { useCandyStore } from "./useCandyStore";
import { getPokemonType } from "../domain/pokesleep/pokemon-names";
import { getCandyFamilyKey } from "../domain/pokesleep/candy-family";
import { CANDY_VALUES } from "../domain/level-planner/constants";
import type { DebugExportContext } from "../domain/level-planner/debugExport";
import { buildPlannerInput as buildLevelPlannerInput } from "../domain/level-planner/buildPlannerInput";
import type { CalculationMode, CalculationPolicy, ItemCompareMode, LevelPlannerInput, LevelPlannerResult, MixedCalculationMeta, PokemonPlanLine, PokemonPlanResult, StructuralProbeStatus } from "../domain/level-planner/types";
import { buildPlannerInputSignature, buildPlannerProbeSignature, buildPlannerStructureSignature } from "../domain/level-planner/signature";
import type { DeadlineExceededMeta, PlannerTuning } from "../domain/level-planner/types";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";
import { isPerfEnabled } from "../utils/perf";
export type CalcRow = CalcRowV1;

const PLAN_RESULT_PERF_ENABLED = isPerfEnabled();
const PLAN_RESULT_EXACT_VERIFICATION_ENABLED = PLAN_RESULT_PERF_ENABLED;

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
  expRemaining: number;
  expLeftNext: number;
  ui: {
    boostReachLevel: number;
    boostCandyInput: number;
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

type CalcUndoState = {
  rows: CalcRow[];
  activeRowId: string | null;
  slots: Array<CalcSaveSlotV1 | null>;
  boostCandyRemaining: number | null;
  itemCompareMode: ItemCompareMode;
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
  openExport: () => void;
  closeExport: () => void;
  buildDebugExportTsv: () => Promise<string>;
  copyDebugExportTsv: () => Promise<DebugExportResult>;

  beginUndo: () => void;
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
  onRowNature: (id: string, v: string) => void;
  onRowCandyTarget: (id: string, v: string) => void;
  onRowBoostLevel: (id: string, v: string) => void;
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
  setRowSleepTargetHours: (rowId: string, hours: number | undefined) => void;
};

export function useCalcStore(opts: {
  locale: Ref<AppLocale>;
  t: Composer["t"];
  resolveTitleByBoxId?: (boxId: string) => string | null;
  resolvePokedexIdByBoxId?: (boxId: string) => number | undefined;
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
    itemCompareMode.value = mode;
  }

  const totalShards = ref<number>(loadTotalShards());
  const totalShardsText = ref<string>("");
  // アメブ残数（nullの場合はboostKindによる上限を使用）
  const initialBoostCandyRemaining =
    slot0?.boostCandyRemaining !== undefined ? slot0.boostCandyRemaining ?? null : loadBoostCandyRemaining();
  const boostCandyRemaining = ref<number | null>(initialBoostCandyRemaining);
  const boostCandyRemainingText = ref<string>("");

  // 睡眠育成設定
  const sleepSettings = ref<SleepSettings>(loadSleepSettings());

  function updateSleepSettings(patch: Partial<SleepSettings>) {
    sleepSettings.value = { ...sleepSettings.value, ...patch };
  }

  // sleepSettings の自動保存
  watch(sleepSettings, (v) => saveSleepSettings(v), { deep: true });

  const rows = ref<CalcRow[]>(slot0?.rows ? JSON.parse(JSON.stringify(slot0.rows)) : []);
  const activeRowId = ref<string | null>(slot0?.activeRowId ?? rows.value[0]?.id ?? null);

  function clampNonNegInt(n: unknown): number {
    return Math.max(0, Math.floor(Number(n) || 0));
  }

  function onTotalShardsInput(v: string) {
    const digits = String(v ?? "").replace(/[^\d]/g, "");
    const n = clampNonNegInt(digits);
    totalShards.value = n;
    totalShardsText.value = fmtNum(n);
  }

  function onBoostCandyRemainingInput(v: string) {
    const digits = String(v ?? "").replace(/[^\d]/g, "");
    if (digits === "") {
      boostCandyRemaining.value = null;
      boostCandyRemainingText.value = "";
    } else {
      const n = clampNonNegInt(digits);
      boostCandyRemaining.value = n;
      boostCandyRemainingText.value = fmtNum(n);
    }
    // アメブ上限変更時に全行のアメブ個数を再計算
    recalculateAllRows();
  }

  // 全行のアメブ個数を再計算（アメブ上限変更時用）
  function recalculateAllRows() {
    let remainingBoostCandy = autoBoostCandyCap();
    rows.value = rows.value.map((row) => {
      const patch = calcCandyPatch({
        srcLevel: row.srcLevel,
        dstLevel: row.dstLevel,
        expType: row.expType,
        nature: row.nature,
        expRemaining: row.expRemaining,
        excludeRowId: row.id,
        availableBoostCandy: remainingBoostCandy,
      });
      remainingBoostCandy = Math.max(0, remainingBoostCandy - rowBoostCandyForAutoAllocation({ ...row, ...patch }));
      return { ...row, ...patch };
    });
  }

  function resetBoostCandyRemaining() {
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

    // boostKind を変更
    const updatedSlot = { ...currentSlot, boostKind: newKind };
    slots.value = slots.value.map((x, idx) => (idx === i ? updatedSlot : x));

    // boostCandyRemaining をリセット
    boostCandyRemaining.value = null;
    boostCandyRemainingText.value = "";

    // 全行を上位から一括再計算し、UI入力値もグローバル上限内に収める
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
    return JSON.parse(JSON.stringify(raw)) as CalcRow[];
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
      rows.value = JSON.parse(JSON.stringify(slot.rows));
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
  }

  // スロットの位置を入れ替え（タブドラッグ用）
  function swapSlots(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex > 2 || toIndex < 0 || toIndex > 2) return;

    // 現在のスロットに保存
    saveToCurrentSlot();

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
    beginUndo();

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

  const UNDO_LIMIT = 3;
  const undoStack = ref<CalcUndoState[]>([]);
  const redoStack = ref<CalcUndoState[]>([]);
  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  function snapshotUndoState(): CalcUndoState {
    return {
      rows: cloneCalcRows(rows.value),
      activeRowId: activeRowId.value,
      slots: cloneCalcSlots(slots.value),
      boostCandyRemaining: boostCandyRemaining.value,
      itemCompareMode: itemCompareMode.value,
    };
  }

  function restoreUndoState(s: CalcUndoState) {
    rows.value = s.rows;
    activeRowId.value = s.activeRowId;
    slots.value = s.slots;
    boostCandyRemaining.value = s.boostCandyRemaining;
    itemCompareMode.value = s.itemCompareMode;
  }

  function beginUndo() {
    undoStack.value = [...undoStack.value, snapshotUndoState()].slice(-UNDO_LIMIT);
    redoStack.value = [];
  }
  function undo() {
    const s = undoStack.value.pop();
    if (!s) return;
    redoStack.value = [...redoStack.value, snapshotUndoState()].slice(-UNDO_LIMIT);
    restoreUndoState(s);
  }
  function redo() {
    const s = redoStack.value.pop();
    if (!s) return;
    undoStack.value = [...undoStack.value, snapshotUndoState()].slice(-UNDO_LIMIT);
    restoreUndoState(s);
  }

  function clear() {
    if (!rows.value.length) return;
    beginUndo();
    rows.value = [];
    activeRowId.value = null;
  }

  function removeRowById(id: string) {
    const exists = rows.value.some((x) => x.id === id);
    if (!exists) return;
    beginUndo();
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

  function clampInt(v: unknown, min: number, max: number, fallback: number): number {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(n)));
  }

  function autoBoostCandyCap(): number {
    if (boostKind.value === "none") return 0;
    return boostCandyRemaining.value ?? (boostKind.value === "mini" ? 350 : 3500);
  }

  function rowBoostCandyForAutoAllocation(row: CalcRow): number {
    if (boostKind.value === "none") return 0;
    return Math.max(0, Math.floor(row.boostOrExpAdjustment ?? 0));
  }

  function upperRowsBoostCandyForAutoAllocation(excludeRowId?: string): number {
    if (boostKind.value === "none") return 0;
    const targetIndex = excludeRowId === undefined ? rows.value.length : rows.value.findIndex((row) => row.id === excludeRowId);
    const end = targetIndex >= 0 ? targetIndex : rows.value.length;
    return rows.value.slice(0, end).reduce((sum, row) => sum + rowBoostCandyForAutoAllocation(row), 0);
  }

  function updateRow(id: string, patch: Partial<CalcRow>) {
    rows.value = rows.value.map((x) => (x.id === id ? { ...x, ...patch } : x));
  }

  // ─────────────────────────────────────────────────────────────
  // 個数指定と目標Lvの一本化（設計書 §4.3 / §5.3）
  //
  // 永続状態は dstLevel / candyTarget? / sleepTargetHours? の3値。
  // 不変条件: sleepTargetHours !== undefined ⇒ candyTarget !== undefined
  //
  // ここでの連動更新は calcCandyPatch を呼ばない（§4.4 ループ防止）。
  // ─────────────────────────────────────────────────────────────

  /** 現在Lv内で既に得ているEXP。 */
  function rowExpGot(r: Pick<CalcRow, 'srcLevel' | 'expType' | 'expRemaining'>): number {
    const toNext = Math.max(0, calcExp(r.srcLevel, r.srcLevel + 1, r.expType));
    return (r.expRemaining !== undefined && r.expRemaining > 0) ? Math.max(0, toNext - r.expRemaining) : 0;
  }

  /** 行のアメブ個数（UIの真実のソース）。 */
  /** 行のアメブ個数（UIの真実のソース）。 */
  function rowBoostCandy(r: CalcRow): number {
    if (boostKind.value === "none") return 0;
    return Math.max(0, Math.floor(r.boostOrExpAdjustment ?? 0));
  }

  /**
   * 「これから寝る時間」から睡眠EXPを求める。
   * 睡眠目標時間が未設定なら 0（不変条件により candyTarget も undefined になる）。
   */
  function rowSleepExp(r: CalcRow): number {
    if (r.sleepTargetHours === undefined) return 0;
    const remainingHours = Math.max(0, r.sleepTargetHours - (r.sleepHours ?? 0));
    if (remainingHours <= 0) return 0;
    const s = sleepSettings.value;
    return markForSleep({
      targetSleepHours: remainingHours,
      nature: r.nature,
      dailySleepHours: s.dailySleepHours,
      sleepExpBonus: 1.0 + 0.14 * s.sleepExpBonusCount,
      includeGSD: s.includeGSD,
    }).sleepExp;
  }

  /** 行の実効目標 T と「目標まで」行のアメ数（§4.5）。 */
  function rowDerivedTarget(r: CalcRow) {
    return deriveTarget({
      srcLevel: r.srcLevel,
      expGot: rowExpGot(r),
      dstLevel: r.dstLevel,
      candyTarget: r.candyTarget,
      boostCandy: rowBoostCandy(r),
      expType: r.expType,
      nature: r.nature,
      boostKind: boostKind.value,
      sleepExp: rowSleepExp(r),
    });
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
    const mixed = calcExpAndCandyMixed({
      srcLevel: r.srcLevel, dstLevel: cap.level, dstExpInLevel: cap.expInLevel,
      expType: r.expType, nature: r.nature, boost: boostKind.value,
      boostCandy: rowBoostCandy(r), expGot,
    });
    return mixed.boostCandy + mixed.normalCandy;
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
   * 目標 T を固定したまま、睡眠EXPで賄えない分のアメ数を求める（§5.3）。
   * 睡眠目標時間を設定・変更したときと、睡眠設定中に目標Lvを変えたときに使う。
   */
  function candyTargetForFixedTarget(r: CalcRow, targetLevel: number, targetExpInLevel: number): number {
    const expGot = rowExpGot(r);
    const sleepExp = rowSleepExp(r);
    return calcCandyTargetFromSleepExp({
      srcLevel: r.srcLevel,
      dstLevel: targetLevel,
      dstExpInLevel: targetExpInLevel,
      expType: r.expType,
      nature: r.nature,
      boostKind: boostKind.value,
      targetBoostCandy: rowBoostCandy(r),
      targetNormalCandy: Number.MAX_SAFE_INTEGER,
      sleepExp,
      expGot,
    });
  }

  /**
   * 個数指定・アメブ関連の操作後に、実効目標のLvへ dstLevel を同期する（§4.3）。
   * 保存値と表示値が乖離しないよう、dstLevel は常に実効目標のLv部分と一致させる。
   */
  function syncDstLevelToDerivedTarget(id: string, patch: Partial<CalcRow>): void {
    const current = rows.value.find((x) => x.id === id);
    if (!current) return;
    const next = { ...current, ...patch };
    const t = rowDerivedTarget(next);
    updateRow(id, { ...patch, dstLevel: clampInt(t.targetLevel, next.srcLevel, MAX_LEVEL, next.dstLevel) });
  }

  /**
   * レベル範囲に基づいてアメ計算パッチを生成するヘルパー関数
   * setDstLevel, setSrcLevel, setBoostLevel, upsertFromBox で共通使用
   *
   * expRemaining: 現在レベルの「あとEXP」。これを元に expGot を内部計算。
   *               未指定の場合は expGot = 0 として計算（= あとEXP が次Lvの全EXP）
   * excludeRowId: グローバル残数計算時に除外する行ID（自分自身を除外するため）
   */
  function calcCandyPatch(params: {
    srcLevel: number;
    dstLevel: number;
    expType: ExpType;
    nature: ExpGainNature;
    expRemaining?: number;
    excludeRowId?: string;
    availableBoostCandy?: number;
  }): Pick<CalcRow, 'boostOrExpAdjustment' | 'boostReachLevel'> {
    const { srcLevel, dstLevel, expType, nature, expRemaining, excludeRowId, availableBoostCandy } = params;

    if (srcLevel === dstLevel) {
      return { boostOrExpAdjustment: 0, boostReachLevel: dstLevel };
    }

    // expRemaining から expGot を計算
    // expRemaining が未指定（undefined）または 0 の場合は expGot = 0（あとEXP = 次Lvの全EXP として計算）
    const toNextLevel = calcExp(srcLevel, srcLevel + 1, expType);
    const expGot = (expRemaining !== undefined && expRemaining > 0) ? Math.max(0, toNextLevel - expRemaining) : 0;

    // 目標Lvモード: dstExpInLevel = 0（目標Lvにちょうど到達）
    const dstExpInLevel = 0;

    // 通常モードの場合はグローバル上限なし
    if (boostKind.value === "none") {
      const candy = calcExpAndCandyMixed({ srcLevel, dstLevel, dstExpInLevel, expType, nature, boost: "none", boostCandy: 0, expGot }).normalCandy;
      return { boostOrExpAdjustment: candy, boostReachLevel: dstLevel };
    }

    // アメブ/ミニブ: グローバル上限を考慮してリセット値を決定。
    // UI自動設定は planResult を待たず、現在の上位行UI値から top-down に残数を決める。
    const globalRemaining = availableBoostCandy !== undefined
      ? Math.max(0, Math.floor(availableBoostCandy))
      : Math.max(0, autoBoostCandyCap() - upperRowsBoostCandyForAutoAllocation(excludeRowId));

    // アメブ→通常アメ置換を含む最小アメブ数（minBoostForTarget に集約。設計書§3.8-e）
    const shared = { srcLevel, targetLevel: dstLevel, targetExpInLevel: dstExpInLevel, expType, nature, boostKind: boostKind.value, expGot };
    const unconstrained = minBoostForTarget({ ...shared, maxBoost: Number.MAX_SAFE_INTEGER });
    const optimizedValue = minBoostForTarget({ ...shared, maxBoost: globalRemaining });

    // アメブ目標Lvは「アメブでどこまで賄うか」という意図。
    // 置換で最後の1個を通常アメへ回しても意図は目標Lvのままなので、逆算せず dstLevel を持つ。
    // グローバル上限で足りない場合だけ、実際に届くLvへ落とす。
    const reachLevel = optimizedValue >= unconstrained
      ? dstLevel
      : Math.max(srcLevel, calcLevelByCandy({
        srcLevel, dstLevel, expType, nature, boost: boostKind.value, candy: optimizedValue, expGot,
      }).level);

    return { boostOrExpAdjustment: optimizedValue, boostReachLevel: reachLevel };
  }


  /**
   * 目標Lvピッカーの操作（§4.3 / §4.6）。
   * - 睡眠目標時間なし → candyTarget をクリアして「個数指定なし」へ
   * - 睡眠目標時間あり → 睡眠設定を維持し、新しい T から candyTarget を再計算
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

    // アメブ据え置き＋クランプ（§4.6 案1）。据え置くのは「アメブでどこまで賄うか」という意図で、
    // 個数はそこから計算し直す。目標Lvが下がったらアメブ目標Lvもそこまで下げる。
    //
    // 「アメブ1個 → 通常アメ1個」置換（§3.8-e）はアメブが目標全体を賄うときだけ成立するので、
    // 目標Lvが動くと当否が入れ替わる。毎回引き直さないと、
    // 上げたときは削った1個が戻らず（アメブ目標Lvへ届かない）、
    // 下げたときは戻した1個が余ったまま（かけらを無駄に使う）になる。
    const reach = Math.min(r.boostReachLevel ?? r.srcLevel, dst);
    patch.boostReachLevel = reach;
    patch.boostOrExpAdjustment = Math.min(boostCandyForReachLevel(r, reach, dst), maxBoostCandyFor(r));

    if (r.sleepTargetHours === undefined) {
      updateRow(id, { ...patch, candyTarget: undefined });
      return;
    }
    // 睡眠設定は維持し、新しい目標（Lv dst ちょうど）から個数指定を再計算する。
    const next = { ...r, ...patch };
    updateRow(id, { ...patch, candyTarget: candyTargetForFixedTarget(next, dst, 0) });
  }
  /** アメブ個数を現在の目標Lvのまま再計算（リセット） */
  function resetRowBoostCandy(id: string) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    updateRow(id, calcCandyPatch({ srcLevel: r.srcLevel, dstLevel: r.dstLevel, expType: r.expType, nature: r.nature, expRemaining: r.expRemaining, excludeRowId: id }));
  }
  function nudgeDstLevel(id: string, delta: number) {
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    setDstLevel(id, r.dstLevel + delta);
  }
  /**
   * 現在Lvの変更。
   * 元Lvが変わると同じ個数指定でも到達点が変わるため、ボックス同期（§6.3）と同じく
   * 個数指定・睡眠目標を解除する。dstLevel はクランプのみ。
   */
  function setSrcLevel(id: string, v: unknown) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    const src = clampInt(v, 1, r.dstLevel, r.srcLevel);
    const dst = r.dstLevel < src ? src : r.dstLevel;
    const toNext = Math.max(0, calcExp(src, src + 1, r.expType));
    updateRow(id, {
      srcLevel: src, dstLevel: dst, expRemaining: toNext,
      candyTarget: undefined, sleepTargetHours: undefined,
      ...calcCandyPatch({ srcLevel: src, dstLevel: dst, expType: r.expType, nature: r.nature, excludeRowId: id }),
    });
  }
  function nudgeSrcLevel(id: string, delta: number) {
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    setSrcLevel(id, r.srcLevel + delta);
  }
  /**
   * アメブ目標Lvの操作（§4.3）。
   * そのLvまでに必要なアメブ数を求め、以降はアメブ個数の変更と同じ扱いになる。
   * アメブ目標Lvは目標Lv T の内側でクランプされる。
   */
  function setBoostLevel(id: string, v: unknown) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    // 目標Lvを超えるアメブ目標Lvも指定できる。
    const mid = clampInt(v, r.srcLevel, MAX_LEVEL, r.srcLevel);

    // グローバル上限は掛けない（掛けると指定したLvまで上がりきらない）。
    // mid > dstLevel のときは目標Lvが mid まで上がるので、アメブが目標全体を賄う扱いになる。
    const nextDstLevel = Math.max(r.dstLevel, mid);
    const n = Math.min(boostCandyForReachLevel(r, mid, nextDstLevel), maxBoostCandyFor(r));

    if (mid > r.dstLevel) {
      // 目標Lvをそこまで引き上げ、アメ個数指定はリセットする（新しい目標でやり直す）。
      const patch: Partial<CalcRow> = {
        dstLevel: mid,
        boostReachLevel: mid,
        boostOrExpAdjustment: n,
        candyTarget: undefined,
        sleepTargetHours: undefined,
      };
      if (r.sleepTargetHours !== undefined) {
        // 睡眠設定は維持し、新しい目標から個数指定を組み直す（不変条件を保つ）。
        patch.sleepTargetHours = r.sleepTargetHours;
        patch.candyTarget = candyTargetForFixedTarget({ ...r, ...patch } as CalcRow, mid, 0);
      }
      updateRow(id, patch);
      return;
    }

    const patch: Partial<CalcRow> = { boostReachLevel: mid, boostOrExpAdjustment: n };
    applyExcessBoostAsCandyTarget(r, n, patch);
    syncDstLevelToDerivedTarget(id, patch);
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

    if (r.candyTarget !== undefined) {
      // 個数指定が anchor。アメブ自動最大化は行わず（§4.4）、実効目標へ dstLevel を同期する。
      syncDstLevelToDerivedTarget(id, { expRemaining: rem });
      return;
    }

    // candyPeak/boostOrExpAdjustment を再計算（expRemaining を渡して内部で expGot を計算）
    const candyPatch = calcCandyPatch({
      srcLevel: r.srcLevel,
      dstLevel: r.dstLevel,
      expType: r.expType,
      nature: r.nature,
      expRemaining: rem,
      excludeRowId: id,
    });

    updateRow(id, { expRemaining: rem, ...candyPatch });
  }
  function onRowNature(id: string, v: string) {
    activeRowId.value = id;
    const nat: ExpGainNature = v === "up" || v === "down" || v === "normal" ? v : "normal";
    updateRow(id, { nature: nat });
  }
  /**
   * アメ個数指定の確定（§4.3）。
   * - 空欄 → 「個数指定なし」へ遷移。dstLevel は据え置き（Lv内EXPだけ 0 になる）。sleepTargetHours も解除
   * - 値あり → candyTarget をセットし、n > m ならアメブをクランプ。dstLevel を実効目標のLvへ同期
   *
   * 入力途中の値では呼ばれない（UI側が Enter / フォーカスアウトで確定してから呼ぶ）。
   * 1文字ごとに呼ぶと "158" が 1 → 15 → 158 と流れ、最初の "1" でアメブ個数が
   * クランプされて復元できなくなる。
   */
  function onRowCandyTarget(id: string, v: string) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;

    if (v.trim() === "") {
      // 不変条件 sleepTargetHours ⇒ candyTarget を守るため、睡眠目標も同時に解除する。
      updateRow(id, { candyTarget: undefined, sleepTargetHours: undefined });
      return;
    }

    const raw = Math.max(0, Math.floor(Number(v) || 0));
    const m = Math.min(raw, maxCandyTargetFor(r));
    const patch: Partial<CalcRow> = { candyTarget: m };
    // アメブは総アメ数の内数。n > m ならクランプする。
    if (rowBoostCandy(r) > m) patch.boostOrExpAdjustment = m;
    syncDstLevelToDerivedTarget(id, patch);
  }

  /**
   * 睡眠目標時間の設定・解除（§5.3）。
   * 目標 T を固定したまま、睡眠EXPで賄えない分のアメ数を candyTarget へ保存する。
   * 不変条件（sleepTargetHours ⇒ candyTarget）をここで必ず満たす。
   */
  function setRowSleepTargetHours(id: string, hours: number | undefined) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;

    if (hours === undefined) {
      // 睡眠目標のみ解除。candyTarget は通常の個数指定として残す（§4.3 状態遷移表）。
      updateRow(id, { sleepTargetHours: undefined });
      return;
    }

    // 現在の実効目標 T を固定する（睡眠設定前の目標を維持）。
    const t = rowDerivedTarget(r);
    const next = { ...r, sleepTargetHours: hours };
    const m = candyTargetForFixedTarget(next, t.targetLevel, t.targetExpInLevel);
    updateRow(id, { sleepTargetHours: hours, candyTarget: m });
  }

  /**
   * 累計睡眠時間の変更。睡眠目標時間が設定済みなら「これから寝る時間」が変わるので
   * candyTarget を再計算する（§5.5「累計睡眠時間の変更が自動で反映される」）。
   */
  function setRowSleepHours(rowId: string, sleepHours: number | undefined) {
    const r = rows.value.find((x) => x.id === rowId);
    if (!r) return;
    if (r.sleepTargetHours === undefined) {
      updateRow(rowId, { sleepHours });
      return;
    }
    const t = rowDerivedTarget(r);
    const next = { ...r, sleepHours };
    const m = candyTargetForFixedTarget(next, t.targetLevel, t.targetExpInLevel);
    updateRow(rowId, { sleepHours, candyTarget: m });
  }
  function onRowBoostLevel(id: string, v: string) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    const mid = clampInt(v, r.srcLevel, MAX_LEVEL, r.srcLevel);
    updateRow(id, { boostReachLevel: mid });
  }
  /**
   * アメブ個数の入力（§4.3）。
   *
   * アメブが駆動側なので、増やして総アメ数を超えたら個数指定の方を引き上げる。
   * （逆に個数指定を減らしたときは、そちらが駆動側なのでアメブを内数へクランプする）
   */
  function onRowBoostCandy(id: string, v: string) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;

    const rawN = Math.max(0, Math.floor(Number(v) || 0));
    const n = Math.min(rawN, maxBoostCandyFor(r));

    const patch: Partial<CalcRow> = { boostOrExpAdjustment: n, boostReachLevel: boostReachLevelFor(r, n) };
    applyExcessBoostAsCandyTarget(r, n, patch);
    syncDstLevelToDerivedTarget(id, patch);
  }

  /**
   * アメブ個数が目標を追い越したら、その個数を個数指定として立てる／引き上げる。
   *
   * - 個数指定なし: 目標Lv到達に必要な最小数を超えたら個数指定へ遷移する。
   *   こうしないと「個数指定なしなのに目標がアメブ個数で決まる」中間状態ができ、
   *   個数指定の有無で anchor が決まるモデル（§4.3）が崩れる
   * - 個数指定あり: n > m なら m を n まで引き上げる（アメブは総アメ数の内数のまま）
   *
   * アメブが超過した分は通常アメを使わないので、総アメ数はアメブ個数そのものになる。
   */
  function applyExcessBoostAsCandyTarget(r: CalcRow, n: number, patch: Partial<CalcRow>): void {
    if (boostKind.value === "none") return;
    if (r.candyTarget !== undefined) {
      if (n > r.candyTarget) patch.candyTarget = n;
      return;
    }
    const minBoost = minBoostForTarget({
      srcLevel: r.srcLevel, targetLevel: r.dstLevel, targetExpInLevel: 0,
      expType: r.expType, nature: r.nature, boostKind: boostKind.value,
      maxBoost: Number.MAX_SAFE_INTEGER, expGot: rowExpGot(r),
    });
    if (n > minBoost) patch.candyTarget = n;
  }

  /**
   * アメブ個数の上限は MAX_LEVEL 到達に必要なアメ数。
   *
   * 個数指定 m ではクランプしない。アメブを増やす操作ではアメブが駆動側で、
   * m を超えた分は m の方を引き上げる（applyExcessBoostAsCandyTarget）。
   */
  function maxBoostCandyFor(r: CalcRow): number {
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
   * 「アメブ1個 → 通常アメ1個」置換（§3.8-e）は、アメブが目標全体を賄うときだけ当てる。
   * その場合は最後のはみ出しEXPが余剰なので、1個を通常アメへ回せばかけらを節約できる。
   * アメブ目標Lvが目標Lvより下（その先を通常アメで続ける）ときに1個削ると、
   * アメブ分が実際に reachLevel へ届かず、不足を通常アメで補うぶん総アメ数も増えて損になる。
   */
  function boostCandyForReachLevel(r: CalcRow, reachLevel: number, dstLevel: number): number {
    const shared = { srcLevel: r.srcLevel, expType: r.expType, nature: r.nature, expGot: rowExpGot(r) };
    return reachLevel >= dstLevel
      ? minBoostForTarget({
        ...shared, targetLevel: reachLevel, targetExpInLevel: 0,
        boostKind: boostKind.value, maxBoost: Number.MAX_SAFE_INTEGER,
      })
      : calcExpAndCandy({ ...shared, dstLevel: reachLevel, dstExpInLevel: 0, boost: boostKind.value }).candy;
  }

  /** アメブ個数 n から、アメブだけで到達できるLv（表示用）。 */
  function boostReachLevelFor(r: CalcRow, n: number): number {
    const sim = calcLevelByCandy({
      srcLevel: r.srcLevel, dstLevel: MAX_LEVEL, expType: r.expType, nature: r.nature,
      boost: boostKind.value, candy: n, expGot: rowExpGot(r),
    });
    return Math.max(r.srcLevel, sim.level);
  }

  function indexOfRow(id: string): number {
    return rows.value.findIndex((x) => x.id === id);
  }
  function moveRow(fromId: string, toIndex: number) {
    const from = indexOfRow(fromId);
    if (from < 0) return;
    const next = [...rows.value];
    const [item] = next.splice(from, 1);
    const idx = Math.max(0, Math.min(next.length, toIndex));
    next.splice(idx, 0, item);
    rows.value = next;
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

  function calcRowView(r: CalcRow) {
    const src = clampInt(r.srcLevel, 1, MAX_LEVEL, 1);
    const dstFromText =
      typeof r.dstLevelText === "string" && r.dstLevelText.trim() !== "" ? clampInt(r.dstLevelText, 1, MAX_LEVEL, r.dstLevel) : null;
    const dst = clampInt(dstFromText ?? r.dstLevel, src, MAX_LEVEL, src);
    const expT = r.expType;
    const nat = r.nature;
    const expInfo = calcRowExpGot({ ...r, srcLevel: src, dstLevel: dst, expType: expT, nature: nat });
    const expGot = expInfo.expGot;

    // ─────────────────────────────────────────────────────────────
    // boostCandyPeak を computed 化
    // 現在の boostKind と目標Lv から必要なアメ数を計算
    // ─────────────────────────────────────────────────────────────
    let computedPeak: number;
    if (src === dst) {
      computedPeak = 0;
    } else if (boostKind.value === "none") {
      // 通常モード: 通常アメの必要数
      const res = calcExpAndCandyMixed({
        srcLevel: src,
        dstLevel: dst,
        dstExpInLevel: 0,  // 目標Lvにちょうど到達
        expType: expT,
        nature: nat,
        boost: "none",
        boostCandy: 0,
        expGot,
      });
      computedPeak = res.normalCandy;
    } else {
      // イベント時（full/mini）: アメブの必要数
      const res = calcExpAndCandy({
        srcLevel: src,
        dstLevel: dst,
        dstExpInLevel: 0,  // 目標Lvにちょうど到達
        expType: expT,
        nature: nat,
        boost: boostKind.value,
        expGot,
      });
      computedPeak = res.candy;
    }

    // ─────────────────────────────────────────────────────────────
    // ui.boostCandyInput: boostOrExpAdjustment が真実のソース
    // ─────────────────────────────────────────────────────────────
    // 未設定なら「目標Lv到達に必要な数」をフォールバックとして表示する
    const effectivePeak = computedPeak;
    const uiCandy = r.boostOrExpAdjustment ?? effectivePeak;

    // ui.boostReachLevel: 「アメブでどこまで賄うか」という保存された意図をそのまま出す。
    //
    // アメブ個数から逆算してはいけない。「アメブ1個 → 通常アメ1個」置換（§3.8-e）は
    // 最後の1個を通常アメへ回すかけら節約なので、逆算すると必ず1段下がって見え、
    // スライダーで上げても表示が戻る（上げ操作を食う）。
    // 目標Lvを超えるアメブ設定も許容するため、上限は MAX_LEVEL でクランプする。
    const uiBoostReachLevel = r.boostReachLevel !== undefined
      ? clampInt(r.boostReachLevel, src, MAX_LEVEL, src)
      : clampInt(
        calcLevelByCandy({
          srcLevel: src, dstLevel: MAX_LEVEL, expType: expT, nature: nat,
          boost: boostKind.value, candy: uiCandy, expGot,
        }).level,
        src, MAX_LEVEL, src,
      );

    // expLeftNext: アメを使った後の次Lvまでの残EXP
    let totalCandyForSim: number;
    if (boostKind.value === "none") {
      // 通常モード: 入力値をそのまま使用
      totalCandyForSim = uiCandy;
    } else {
      // アメブ時: 目標到達に必要な数を使用
      totalCandyForSim = effectivePeak;
    }
    const simResult = calcLevelByCandy({
      srcLevel: src,
      dstLevel: MAX_LEVEL, // システム上限まで
      expType: expT,
      nature: nat,
      boost: boostKind.value,
      candy: totalCandyForSim,
      expGot,
    });
    const nextLevelReq = calcExp(simResult.level, simResult.level + 1, expT);
    const expLeftNext = Math.max(0, nextLevelReq - simResult.expGot);

    const resolvedTitle =
      r.boxId && resolveTitleByBoxId ? resolveTitleByBoxId(r.boxId) ?? (String(r.title ?? "").trim() || "(no name)") : String(r.title ?? "").trim() || "(no name)";

    return {
      title: resolvedTitle,
      normalized: { srcLevel: src, dstLevel: dst, expRemaining: expInfo.expRemaining },
      expLeftNext,
      ui: { boostCandyInput: uiCandy, boostReachLevel: uiBoostReachLevel },
    };
  }

  const rowsView = computed(() =>
    rows.value.map((r) => {
      const v = calcRowView(r);
      return {
        ...r,
        title: v.title,
        srcLevel: v.normalized.srcLevel,
        dstLevel: v.normalized.dstLevel,
        expRemaining: v.normalized.expRemaining,
        expLeftNext: v.expLeftNext,
        // boostCandyPeak は rows の値をそのまま使用（上書きしない）
        ui: v.ui,
      };
    })
  );

  const exportOpen = ref(false);
  function openExport() {
    if (!rowsView.value.length || planResultPending.value || !planResult.value) return;
    exportOpen.value = true;
  }
  function closeExport() {
    exportOpen.value = false;
  }

  function natureLabel(n: ExpGainNature): string {
    if (n === "up") return "▲";
    if (n === "down") return "▼";
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
          currentLevel: row.srcLevel,
          currentExpInLevel: Math.max(0, calcExp(row.srcLevel, row.srcLevel + 1, row.expType) - row.expRemaining),
          expRemaining: row.expRemaining,
          targetLevel: row.dstLevel,
          targetExpInLevel: plan?.targetExpInLevel,
          candyTarget: row.candyTarget,
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

  // --- アメ配分計算 ---
  const candyStore = useCandyStore();

  // 行から pokedexId を取得（保存済み or boxId から解決）
  function getRowPokedexId(r: CalcRowView): number | undefined {
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
      expRemaining: row.expRemaining,
      expType: row.expType,
      nature: row.nature,
      boostReachLevel: row.boostReachLevel,
      candyTarget: row.candyTarget,
      boostCandyInput: row.ui.boostCandyInput,
      sleepExp: rowSleepExp(row),
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
    [rows, boostKind, boostCandyRemaining, boostCandyDefaultCap, shardsCap, itemCompareMode, candyStore.inventorySnapshot, activeSlotTab],
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
      // §6.3: 元Lvが変わったときだけ個数指定・睡眠目標を解除し、アメブを再計算する。
      // dstLevel はクランプのみでボックス既定値へ戻さない。
      const srcLevelChanged = existing.srcLevel !== srcLevel;
      const keptDstLevel = Math.max(srcLevel, Math.min(MAX_LEVEL, existing.dstLevel));
      const base: Partial<CalcRow> = {
        title, boxId: p.boxId, srcLevel, dstLevel: keptDstLevel, expType: p.expType, nature: p.nature,
        expRemaining: remaining, pokedexId: p.pokedexId, pokemonType: p.pokemonType,
        sleepHours: p.sleepHours,
      };

      if (!srcLevelChanged) {
        updateRow(existing.id, base);
        activeRowId.value = existing.id;
        return;
      }

      updateRow(existing.id, {
        ...base,
        candyTarget: undefined,
        sleepTargetHours: undefined,
        ...calcCandyPatch({
          srcLevel, dstLevel: keptDstLevel, expType: p.expType, nature: p.nature,
          expRemaining: remaining, excludeRowId: existing.id,
        }),
      });
      activeRowId.value = existing.id;
    } else {
      const candyPatchResult = calcCandyPatch({ srcLevel, dstLevel, expType: p.expType, nature: p.nature, expRemaining: remaining });
      const row: CalcRow = {
        id: cryptoRandomId(), title, boxId: p.boxId, pokedexId: p.pokedexId, pokemonType: p.pokemonType,
        srcLevel, dstLevel, expRemaining: remaining, expType: p.expType, nature: p.nature,
        sleepHours: p.sleepHours,
        ...candyPatchResult,
      };
      rows.value = [...rows.value, row];
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
    boostCandyDefaultCap,
    slots,
    rows,
    activeRowId,
    activeSlotTab,
    getBackupSnapshot,

    sleepSettings,
    updateSleepSettings,

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
    onRowNature,
    onRowCandyTarget,
    onRowBoostLevel,
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
    setRowSleepTargetHours,
  };
}
