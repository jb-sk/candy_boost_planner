import { computed, nextTick, ref, toRaw, watch, type Ref } from "vue";
import type { Composer } from "vue-i18n";
import type { AppLocale } from "../i18n";
import type { BoostEvent, ExpGainNature, ExpType, SleepSettings } from "../domain/types";
import { calcExp, calcExpAndCandy, calcExpAndCandyMixed, calcLevelByCandy } from "../domain/pokesleep";
import { boostRules, defaultBoostKind } from "../domain/pokesleep/boost-config";
import type { CalcRowV1, CalcSaveSlotV1 } from "../persistence/calc";
import { loadCalcSlots, loadLegacyTotalShards, saveCalcSlots, saveTotalShards, loadBoostCandyRemaining, saveBoostCandyRemaining, loadSleepSettings, saveSleepSettings } from "../persistence/calc";
import { cryptoRandomId } from "../persistence/box";
import { useCandyStore } from "./useCandyStore";
import { getPokemonType } from "../domain/pokesleep/pokemon-names";
import { CANDY_VALUES } from "../persistence/candy";
import { planLevelUp } from "../domain/level-planner/core/plan";
import type { LevelUpPlanResult, PokemonLevelUpResult, ItemUsage } from "../domain/level-planner/types";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";

export type CalcRow = CalcRowV1;

export type CalcRowView = CalcRow & {
  title: string;
  srcLevel: number;
  dstLevel: number;
  expRemaining: number;
  expLeftNext: number;
  ui: {
    boostReachLevel: number;
    boostRatioPct: number;
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

export type CalcBoxPlannerPatch = {
  boxId: string;
  level: number;
  expRemaining: number;
};

type CalcUndoState = {
  rows: CalcRow[];
  activeRowId: string | null;
  slots: Array<CalcSaveSlotV1 | null>;
};

export type CalcStore = {
  // core state
  boostKind: Readonly<Ref<BoostEvent>>;
  setSlotBoostKind: (kind: BoostEvent) => void;
  totalShards: Ref<number>;
  totalShardsText: Ref<string>;
  boostCandyRemaining: Ref<number | null>;
  boostCandyRemainingText: Ref<string>;
  boostCandyDefaultCap: Readonly<Ref<number>>;
  slots: Ref<Array<CalcSaveSlotV1 | null>>;
  rows: Ref<CalcRow[]>;
  activeRowId: Ref<string | null>;
  activeSlotTab: Ref<number>;

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
  exportScale: Readonly<Ref<number>>;

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
  planResult: Readonly<Ref<LevelUpPlanResult | null>>;
  getPokemonResult: (id: string) => PokemonLevelUpResult | null;
  getTheoreticalRow: (p: PokemonLevelUpResult) => ItemUsage;
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

  beginUndo: () => void;
  undo: () => void;
  redo: () => void;

  clear: () => void;
  removeRowById: (id: string) => void;

  switchToSlot: (slotIndex: number) => void;
  swapSlots: (fromIndex: number, toIndex: number) => void;

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
  onRowBoostRatio: (id: string, v: string) => void;
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
    title?: string;
    dstLevelDefault?: number;
    pokedexId?: number;
    pokemonType?: string;
    ev?: MouseEvent;
  }) => void;
  buildPlannerPatchFromRow: (rowId?: string) => CalcBoxPlannerPatch | null;
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


  const slots = ref<Array<CalcSaveSlotV1 | null>>(loadCalcSlots());

  // アクティブスロットをLocalStorageから読み込み
  const SLOT_TAB_KEY = "candy-boost-planner:calc:activeSlot";
  function loadActiveSlot(): number {
    try {
      const raw = localStorage.getItem(SLOT_TAB_KEY);
      if (!raw) return 0;
      const n = Number(raw);
      if (n === 0 || n === 1 || n === 2) return n;
      return 0;
    } catch { return 0; }
  }
  function saveActiveSlot(n: number) {
    try {
      localStorage.setItem(SLOT_TAB_KEY, String(n));
    } catch { /* ignore */ }
  }

  const activeSlotTab = ref(loadActiveSlot());

  // 現在のスロットからデータを読み込む（cloneCalcRowsがまだ定義されていないのでlegacyの方法で）
  const slot0 = slots.value[activeSlotTab.value];

  // boostKind: スロットから取得（読み取り専用computed）
  const boostKind = computed<BoostEvent>(() => {
    const slot = slots.value[activeSlotTab.value];
    return slot?.boostKind ?? defaultBoostKind;
  });

  const totalShards = ref<number>(loadLegacyTotalShards());
  const totalShardsText = ref<string>("");
  // アメブ残数（nullの場合はboostKindによる上限を使用）
  const boostCandyRemaining = ref<number | null>(loadBoostCandyRemaining());
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
    // リスト上位から順に再計算（上位が優先的にリソースを使用するため）
    for (const r of rows.value) {
      // 既存の目標Lvで再計算（calcCandyPatch が呼ばれる）
      nextTick(() => {
        const row = rows.value.find(x => x.id === r.id);
        if (row) {
          // setDstLevel を呼ぶことで calcCandyPatch が実行される
          setDstLevel(row.id, row.dstLevel);
        }
      });
    }
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
        savedAt: new Date().toISOString(),
        rows: [],
        activeRowId: null,
        boostKind: newKind,
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

    // 全行の boostOrExpAdjustment を0にリセット後、目標Lvを再設定
    for (const r of rows.value) {
      r.boostOrExpAdjustment = 0;
    }
    for (const r of rows.value) {
      setDstLevel(r.id, r.dstLevel);
    }
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
      savedAt: now,
      rows: cloneCalcRows(rows.value),
      activeRowId: activeRowId.value,
      boostKind: boostKind.value,  // 保存時の boostKind を記録
      boostCandyRemaining: boostCandyRemaining.value,  // スロットごとに保存
    };
    slots.value = slots.value.map((x, idx) => (idx === i ? slot : x));
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
    } else {
      rows.value = [];
      activeRowId.value = null;
      // 空スロットは null（デフォルト値を使用）
      boostCandyRemaining.value = null;
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


  // データ変更時に現在のスロットに自動保存
  watch([rows, activeRowId], () => saveToCurrentSlot(), { deep: true });
  watch(slots, (v) => saveCalcSlots(v), { deep: true });
  // 設定値の自動保存
  watch(totalShards, (v) => saveTotalShards(v));
  watch(boostCandyRemaining, (v) => saveBoostCandyRemaining(v));

  watch(
    rows,
    () => {
      const id = activeRowId.value;
      if (!id) {
        activeRowId.value = rows.value[0]?.id ?? null;
        return;
      }
      if (!rows.value.some((x) => x.id === id)) {
        activeRowId.value = rows.value[0]?.id ?? null;
      }
    },
    { deep: true }
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
    };
  }

  function restoreUndoState(s: CalcUndoState) {
    rows.value = s.rows;
    activeRowId.value = s.activeRowId;
    slots.value = s.slots;
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

  function updateRow(id: string, patch: Partial<CalcRow>) {
    rows.value = rows.value.map((x) => (x.id === id ? { ...x, ...patch } : x));
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
  }): Pick<CalcRow, 'boostOrExpAdjustment' | 'candyPeak' | 'boostRatioPct' | 'boostReachLevel' | 'mode'> {
    const { srcLevel, dstLevel, expType, nature, expRemaining, excludeRowId } = params;

    if (srcLevel === dstLevel) {
      return { boostOrExpAdjustment: 0, candyPeak: 0, boostRatioPct: 100, boostReachLevel: dstLevel, mode: "targetLevel" };
    }

    // expRemaining から expGot を計算
    // expRemaining が未指定（undefined）または 0 の場合は expGot = 0（あとEXP = 次Lvの全EXP として計算）
    const toNextLevel = calcExp(srcLevel, srcLevel + 1, expType);
    const expGot = (expRemaining !== undefined && expRemaining > 0) ? Math.max(0, toNextLevel - expRemaining) : 0;

    // 目標Lvモード: dstExpInLevel = 0（目標Lvにちょうど到達）
    const dstExpInLevel = 0;

    const candy = boostKind.value === "none"
      ? calcExpAndCandyMixed({ srcLevel, dstLevel, dstExpInLevel, expType, nature, boost: "none", boostCandy: 0, expGot }).normalCandy
      : calcExpAndCandy({ srcLevel, dstLevel, dstExpInLevel, expType, nature, boost: boostKind.value, expGot }).candy;

    // 通常モードの場合はグローバル上限なし
    if (boostKind.value === "none") {
      return { boostOrExpAdjustment: candy, candyPeak: candy, boostRatioPct: 100, boostReachLevel: dstLevel, mode: "targetLevel" };
    }

    // アメブ/ミニブ: グローバル上限を考慮してリセット値を決定
    // ユーザーが設定した上限があればそれを使用、なければデフォルト値（アメブ:3500、ミニブ:350）
    const defaultCap = boostKind.value === "mini" ? 350 : 3500;
    const globalCap = boostCandyRemaining.value ?? defaultCap;

    // 対象ポケモンより上位のポケモンの実使用量を合計
    // リスト上位から優先的にリソースを配分するため、上位が使った残りを下位に割り当てる
    const targetIndex = rows.value.findIndex((r) => r.id === excludeRowId);
    const upperPokemonsBoostUsed = planResult.value
      ? planResult.value.pokemons
        .slice(0, targetIndex >= 0 ? targetIndex : rows.value.length)
        .reduce((sum, p) => sum + p.reachableItems.boostCount, 0)
      : 0;

    // グローバル残数 = グローバル上限 - 上位ポケモンの実使用量
    const globalRemaining = Math.max(0, globalCap - upperPokemonsBoostUsed);

    // リセット値 = min(必要数, グローバル残数)
    const resetValue = Math.min(candy, globalRemaining);

    // 割合を計算
    const ratio = candy > 0 ? Math.round((resetValue / candy) * 100) : 100;

    // アメブ個数から到達可能レベルを計算
    const reachSim = calcLevelByCandy({
      srcLevel,
      dstLevel,
      expType,
      nature,
      boost: boostKind.value,
      candy: resetValue,
      expGot,
    });
    const reachLevel = Math.max(srcLevel, reachSim.level);

    return { boostOrExpAdjustment: resetValue, candyPeak: candy, boostRatioPct: ratio, boostReachLevel: reachLevel, mode: "targetLevel" };
  }


  function setDstLevel(id: string, v: unknown) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    const dst = clampInt(v, r.srcLevel, MAX_LEVEL, r.dstLevel);
    updateRow(id, { dstLevel: dst, ...calcCandyPatch({ srcLevel: r.srcLevel, dstLevel: dst, expType: r.expType, nature: r.nature, expRemaining: r.expRemaining, excludeRowId: id }) });
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
  function setSrcLevel(id: string, v: unknown) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    const src = clampInt(v, 1, r.dstLevel, r.srcLevel);
    const dst = r.dstLevel < src ? src : r.dstLevel;
    const toNext = Math.max(0, calcExp(src, src + 1, r.expType));
    updateRow(id, { srcLevel: src, dstLevel: dst, expRemaining: toNext, ...calcCandyPatch({ srcLevel: src, dstLevel: dst, expType: r.expType, nature: r.nature, excludeRowId: id }) });
  }
  function nudgeSrcLevel(id: string, delta: number) {
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    setSrcLevel(id, r.srcLevel + delta);
  }
  function setBoostLevel(id: string, v: unknown) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    const mid = clampInt(v, r.srcLevel, r.dstLevel, r.srcLevel);

    // expGot を計算（expRemaining が undefined または 0 なら expGot = 0）
    const toNextLevel = calcExp(r.srcLevel, r.srcLevel + 1, r.expType);
    const expGot = (r.expRemaining !== undefined && r.expRemaining > 0) ? Math.max(0, toNextLevel - r.expRemaining) : 0;

    // 目標Lvモード: dstExpInLevel = 0（目標Lvにちょうど到達）
    const dstExpInLevel = 0;

    // アメブ目標Lv (mid) までのアメブ個数（グローバル制限なし）
    const boostCandy = boostKind.value === "none"
      ? calcExpAndCandyMixed({ srcLevel: r.srcLevel, dstLevel: mid, dstExpInLevel, expType: r.expType, nature: r.nature, boost: "none", boostCandy: 0, expGot }).normalCandy
      : calcExpAndCandy({ srcLevel: r.srcLevel, dstLevel: mid, dstExpInLevel, expType: r.expType, nature: r.nature, boost: boostKind.value, expGot }).candy;

    // 100%時の総アメ数（dstLevel まで、グローバル制限なし）
    const fullCandy = boostKind.value === "none"
      ? calcExpAndCandyMixed({ srcLevel: r.srcLevel, dstLevel: r.dstLevel, dstExpInLevel, expType: r.expType, nature: r.nature, boost: "none", boostCandy: 0, expGot }).normalCandy
      : calcExpAndCandy({ srcLevel: r.srcLevel, dstLevel: r.dstLevel, dstExpInLevel, expType: r.expType, nature: r.nature, boost: boostKind.value, expGot }).candy;

    // 割合を計算
    const ratio = fullCandy > 0 ? Math.round((boostCandy / fullCandy) * 100) : 100;

    updateRow(id, {
      boostReachLevel: mid,
      boostOrExpAdjustment: boostCandy,
      candyPeak: fullCandy,
      boostRatioPct: ratio,
      mode: "targetLevel",
    });
  }
  function nudgeBoostLevel(id: string, delta: number) {
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    setBoostLevel(id, (r.boostReachLevel ?? 0) + delta);
  }

  function onRowExpRemaining(id: string, v: string) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    const toNext = Math.max(0, calcExp(r.srcLevel, r.srcLevel + 1, r.expType));
    // 空文字 or 0 → toNext（レベルアップ直後扱い）
    const parsed = v.trim() === "" ? toNext : clampInt(v, 1, toNext, toNext);
    const rem = parsed === 0 ? toNext : parsed;

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
  function onRowCandyTarget(id: string, v: string) {
    activeRowId.value = id;
    // 空欄 = undefined (制限なし)、0以上 = 有効な目標値
    const n = v.trim() === "" ? undefined : Math.max(0, Math.floor(Number(v) || 0));
    updateRow(id, { candyTarget: n });
  }
  function onRowBoostLevel(id: string, v: string) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    const mid = clampInt(v, r.srcLevel, r.dstLevel, r.srcLevel);
    updateRow(id, { boostReachLevel: mid, mode: "targetLevel" });
  }
  function onRowBoostRatio(id: string, v: string) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;

    const pct = clampInt(v, 0, 100, 0);

    // ピークを計算（expRemaining が undefined または 0 なら expGot = 0）
    const toNext = Math.max(0, calcExp(r.srcLevel, r.srcLevel + 1, r.expType));
    const expGot = (r.expRemaining !== undefined && r.expRemaining > 0) ? Math.max(0, toNext - r.expRemaining) : 0;

    let computedPeak: number;
    if (r.srcLevel === r.dstLevel) {
      computedPeak = 0;
    } else if (boostKind.value === "none") {
      const res = calcExpAndCandyMixed({
        srcLevel: r.srcLevel,
        dstLevel: r.dstLevel,
        expType: r.expType,
        nature: r.nature,
        boost: "none",
        boostCandy: 0,
        expGot,
      });
      computedPeak = res.normalCandy;
    } else {
      const res = calcExpAndCandy({
        srcLevel: r.srcLevel,
        dstLevel: r.dstLevel,
        expType: r.expType,
        nature: r.nature,
        boost: boostKind.value,
        expGot,
      });
      computedPeak = res.candy;
    }

    const storedPeak = r.candyPeak ?? 0;
    const effectivePeak = storedPeak > 0 ? storedPeak : computedPeak;

    // 割合からアメブ個数を計算
    const newCandy = Math.round(effectivePeak * pct / 100);

    // アメブ個数から到達可能レベルを計算
    const sim = calcLevelByCandy({
      srcLevel: r.srcLevel,
      dstLevel: r.dstLevel,
      expType: r.expType,
      nature: r.nature,
      boost: boostKind.value,
      candy: newCandy,
      expGot,
    });
    const newBoostReachLevel = Math.max(r.srcLevel, sim.level);

    updateRow(id, {
      boostOrExpAdjustment: newCandy,
      candyPeak: effectivePeak,  // ピークを維持
      boostRatioPct: pct,
      boostReachLevel: newBoostReachLevel,
      mode: "targetLevel"
    });
  }
  /**
   * アメブ個数（またはEXP調整）入力時のハンドラー
   *
   * ロジック:
   * - boostOrExpAdjustment = 入力されたアメブ個数（真実のソース）
   * - candyPeak = ピーク値（入力がピークを超えたら更新）
   * - boostRatioPct = 派生値（表示用）
   *
   * 入力がピーク超え → ピーク更新、割合100%
   * 入力がピーク以下 → ピーク維持、割合更新
   *
   * ※ MAX_LEVEL到達に必要なアメ数を上限としてクランプ
   */
  function onRowBoostCandy(id: string, v: string) {
    activeRowId.value = id;
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;

    const toNext = Math.max(0, calcExp(r.srcLevel, r.srcLevel + 1, r.expType));
    const expGot = (r.expRemaining !== undefined && r.expRemaining > 0) ? Math.max(0, toNext - r.expRemaining) : 0;

    // MAX_LEVEL到達に必要なアメ数を計算（クランプ用上限）
    let maxCandyForMaxLevel: number;
    if (r.srcLevel >= MAX_LEVEL) {
      maxCandyForMaxLevel = 0;
    } else if (boostKind.value === "none") {
      const res = calcExpAndCandyMixed({
        srcLevel: r.srcLevel,
        dstLevel: MAX_LEVEL,
        expType: r.expType,
        nature: r.nature,
        boost: "none",
        boostCandy: 0,
        expGot,
      });
      maxCandyForMaxLevel = res.normalCandy;
    } else {
      const res = calcExpAndCandy({
        srcLevel: r.srcLevel,
        dstLevel: MAX_LEVEL,
        expType: r.expType,
        nature: r.nature,
        boost: boostKind.value,
        expGot,
      });
      maxCandyForMaxLevel = res.candy;
    }

    // 入力値をクランプ（0 ≤ n ≤ maxCandyForMaxLevel）
    const rawN = Math.max(0, Math.floor(Number(v) || 0));
    const n = Math.min(rawN, maxCandyForMaxLevel);

    // computedPeak を計算（現在の目標到達に必要なアメ数）
    let computedPeak: number;
    if (r.srcLevel === r.dstLevel) {
      computedPeak = 0;
    } else if (boostKind.value === "none") {
      const res = calcExpAndCandyMixed({
        srcLevel: r.srcLevel,
        dstLevel: r.dstLevel,
        expType: r.expType,
        nature: r.nature,
        boost: "none",
        boostCandy: 0,
        expGot,
      });
      computedPeak = res.normalCandy;
    } else {
      const res = calcExpAndCandy({
        srcLevel: r.srcLevel,
        dstLevel: r.dstLevel,
        expType: r.expType,
        nature: r.nature,
        boost: boostKind.value,
        expGot,
      });
      computedPeak = res.candy;
    }

    // effectivePeak = 保存されたピークまたは computedPeak
    const storedPeak = r.candyPeak ?? 0;
    const effectivePeak = storedPeak > 0 ? storedPeak : computedPeak;



    if (boostKind.value === "none") {
      // 通常モード: 入力値と連動、割合は常に100%
      // 到達レベルを計算
      const sim = calcLevelByCandy({
        srcLevel: r.srcLevel,
        dstLevel: MAX_LEVEL,
        expType: r.expType,
        nature: r.nature,
        boost: "none",
        candy: n,
        expGot,
      });
      const reachableLevel = Math.max(r.srcLevel, sim.level);
      updateRow(id, {
        mode: "peak",
        dstLevel: reachableLevel,
        boostOrExpAdjustment: n,
        candyPeak: n,
        boostRatioPct: 100,
      });
      return;
    }

    // イベント時（full/mini）
    if (n > effectivePeak) {
      // ピーク超えの入力 → ピーク更新、dstLevel更新
      const sim = calcLevelByCandy({
        srcLevel: r.srcLevel,
        dstLevel: MAX_LEVEL,
        expType: r.expType,
        nature: r.nature,
        boost: boostKind.value,
        candy: n,
        expGot,
      });
      const reachableLevel = Math.max(r.srcLevel, sim.level);
      const newDst = Math.max(r.dstLevel, reachableLevel);
      const currentBoostReach = r.boostReachLevel ?? r.srcLevel;
      const isFullBoost = currentBoostReach >= r.dstLevel;
      const newBoostReach = isFullBoost ? newDst : currentBoostReach;

      updateRow(id, {
        mode: "peak",
        dstLevel: newDst,
        boostOrExpAdjustment: n,
        candyPeak: n,
        boostRatioPct: 100,
        boostReachLevel: newBoostReach,
      });
    } else {
      // ピーク以下の入力 → ピーク維持、割合更新
      // アメブ個数から到達可能レベルを計算
      const sim = calcLevelByCandy({
        srcLevel: r.srcLevel,
        dstLevel: r.dstLevel,
        expType: r.expType,
        nature: r.nature,
        boost: boostKind.value,
        candy: n,
        expGot,
      });
      const newBoostReachLevel = Math.max(r.srcLevel, sim.level);

      if (storedPeak > 0) {
        // ピークあり → candyPeak は変更しない
        const newRatio = storedPeak > 0 ? Math.floor((n / storedPeak) * 100) : 100;
        updateRow(id, {
          mode: "targetLevel",
          boostOrExpAdjustment: n,
          boostRatioPct: newRatio,
          boostReachLevel: newBoostReachLevel,
        });
      } else {
        // ピークなし → effectivePeak をピークとして確定
        const newRatio = effectivePeak > 0 ? Math.floor((n / effectivePeak) * 100) : 100;
        updateRow(id, {
          mode: "targetLevel",
          boostOrExpAdjustment: n,
          candyPeak: effectivePeak,
          boostRatioPct: newRatio,
          boostReachLevel: newBoostReachLevel,
        });
      }
    }
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
    // 保存された candyPeak を使用（なければ computedPeak をフォールバック）
    const storedPeak = r.candyPeak ?? 0;
    const effectivePeak = storedPeak > 0 ? storedPeak : computedPeak;
    // 保存された boostOrExpAdjustment を使用（なければ effectivePeak をフォールバック）
    const storedAdjustment = r.boostOrExpAdjustment ?? effectivePeak;

    // アメブ個数: 常に boostOrExpAdjustment を真実のソースとして使用
    const uiCandy = storedAdjustment;

    // ui.boostReachLevel: アメブで到達可能なレベル
    const boostOnly = calcLevelByCandy({
      srcLevel: src,
      dstLevel: dst,
      expType: expT,
      nature: nat,
      boost: boostKind.value,
      candy: uiCandy,
      expGot,
    });
    const uiBoostReachLevel =
      (r.mode === "targetLevel" && r.boostReachLevel !== undefined && r.boostReachLevel < dst) ? clampInt(r.boostReachLevel, src, dst, src) : clampInt(boostOnly.level, src, dst, src);

    // スライダー割合はピークに対するアメブ個数の割合（派生値）
    const uiRatioPct = effectivePeak > 0 ? Math.round((uiCandy / effectivePeak) * 100) : 100;

    // expLeftNext: アメを使った後の次Lvまでの残EXP
    // ピーク維持の場合、獲得EXP = ピーク（固定）なので、ピークをキャンディ数として使用
    let totalCandyForSim: number;
    if (boostKind.value === "none") {
      // 通常モード: 入力値をそのまま使用
      totalCandyForSim = uiCandy;
    } else {
      // アメブ時: ピークを使用
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
      ui: { boostCandyInput: uiCandy, boostRatioPct: uiRatioPct, boostReachLevel: uiBoostReachLevel },
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
    if (!rowsView.value.length) return;
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

      // 実使用（reachableItems）ベースの値を使用
      const boostCandy = p.reachableItems.boostCount;
      const normalCandy = p.reachableItems.normalCount;
      const shards = p.reachableItems.shardsCount;

      // アメ補填情報
      const parts: string[] = [];
      if (p.reachableItems.typeM > 0) parts.push(`${t("calc.candy.typeAbbr")}M${p.reachableItems.typeM}`);
      if (p.reachableItems.typeS > 0) parts.push(`${t("calc.candy.typeAbbr")}S${p.reachableItems.typeS}`);
      if (p.reachableItems.universalL > 0) parts.push(`${t("calc.candy.uniAbbr")}L${p.reachableItems.universalL}`);
      if (p.reachableItems.universalM > 0) parts.push(`${t("calc.candy.uniAbbr")}M${p.reachableItems.universalM}`);
      if (p.reachableItems.universalS > 0) parts.push(`${t("calc.candy.uniAbbr")}S${p.reachableItems.universalS}`);
      const candySupply = parts.join(" ");

      return {
        id: r.id,
        title: String(r.title ?? "").trim() || "(no name)",
        natureLabel: natureLabel(r.nature),
        srcLevel: r.srcLevel,
        dstLevel: p.reachedLevel,
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
    const boostCandy = planResult.value.actualBoostTotal;
    const normalCandy = planResult.value.actualNormalTotal;
    const shards = planResult.value.actualShardsTotal;
    return { boostCandy, normalCandy, totalCandy: boostCandy + normalCandy, shards };
  });

  const exportScale = computed(() => {
    const n = exportRows.value.length;
    if (n <= 6) return 1;
    if (n <= 9) return 0.94;
    if (n <= 12) return 0.88;
    if (n <= 16) return 0.82;
    return 0.76;
  });

  // 実使用ベースのかけら合計 (planResult から取得)
  const totalShardsUsed = computed(() => planResult.value?.actualShardsTotal ?? 0);
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
  const totalBoostCandyUsed = computed(() => planResult.value?.actualBoostTotal ?? 0);
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
    const p = planResult.value.pokemons.find(p => p.id === activeId);
    return p?.reachableItems.shardsCount ?? 0;
  });
  const activeRowBoostCandyUsed = computed(() => {
    const activeId = activeRowId.value;
    if (!activeId || !planResult.value) return 0;
    const p = planResult.value.pokemons.find(p => p.id === activeId);
    return p?.reachableItems.boostCount ?? 0;
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

  /**
   * レベルアップ計画結果
   */
  const planResult = computed<LevelUpPlanResult | null>(() => {
    const rv = rowsView.value;
    if (rv.length === 0) return null;

    const inventory = candyStore.getInventory();
    const requests = [];

    for (const r of rv) {
      const pokedexId = getRowPokedexId(r);
      if (!pokedexId) continue;

      const pokemonType = r.pokemonType || getPokemonType(pokedexId);
      const toNextLevel = calcExp(r.srcLevel, r.srcLevel + 1, r.expType);
      const expGot = (r.expRemaining > 0) ? Math.max(0, toNextLevel - r.expRemaining) : 0;

      // ピークと入力値からアメ数を計算
      const peak = r.candyPeak || r.ui.boostCandyInput;

      let candyNeed: number;
      let boostOrExpAdjustment: number;
      let dynamicDstLevel: number;
      let dynamicDstExpInLevel: number;

      if (boostKind.value === "none") {
        // 通常モード: ピークと入力が連動、アメブがないので入力値がそのまま必要アメ数
        candyNeed = r.ui.boostCandyInput;
        boostOrExpAdjustment = r.ui.boostCandyInput;

        // ピークで到達可能なLv+expGotを計算
        const peakResult = calcLevelByCandy({
          srcLevel: r.srcLevel,
          dstLevel: MAX_LEVEL, // システム上限まで
          expType: r.expType,
          nature: r.nature,
          boost: boostKind.value,
          candy: peak,
          expGot,
        });
        dynamicDstLevel = peakResult.level;
        // 目標Lvモード: dstExpInLevel = 0、ピークモード: peakResult.expGot
        dynamicDstExpInLevel = r.mode === 'peak' ? peakResult.expGot : 0;
      } else if (r.mode === "targetLevel" && r.boostReachLevel !== undefined && r.boostReachLevel < r.dstLevel) {
        // アメブ目標Lvモード: boostReachLevelまでアメブ、残りは通常アメ
        // calcExpAndCandyMixedでboostCandyを使った場合のnormalCandyを計算
        const boostCandy = r.ui.boostCandyInput;
        const mixedResult = calcExpAndCandyMixed({
          srcLevel: r.srcLevel,
          dstLevel: r.dstLevel,
          expType: r.expType,
          nature: r.nature,
          boost: boostKind.value,
          boostCandy,
          expGot,
        });
        candyNeed = boostCandy + mixedResult.normalCandy;
        boostOrExpAdjustment = boostCandy;

        // boostLevelモードでは目標Lvはユーザー設定のまま
        dynamicDstLevel = r.dstLevel;
        dynamicDstExpInLevel = 0;
      } else {
        // 割合/個数モード: ピークで到達可能なLv+expGotを計算
        const boostCandy = r.ui.boostCandyInput;

        // ピークで到達可能なLv+expGotを計算
        const peakResult = calcLevelByCandy({
          srcLevel: r.srcLevel,
          dstLevel: MAX_LEVEL, // システム上限まで
          expType: r.expType,
          nature: r.nature,
          boost: boostKind.value,
          candy: peak,
          expGot,
        });

        // 目標Lvモード: dstExpInLevel = 0（目標Lvにちょうど到達）
        // ピークモード: peakResult.expGot を使用
        const targetDstExpInLevel = r.mode === 'peak' ? peakResult.expGot : 0;

        // その到達点を目標として calcExpAndCandyMixed を呼ぶ
        const mixedResult = calcExpAndCandyMixed({
          srcLevel: r.srcLevel,
          dstLevel: peakResult.level,
          dstExpInLevel: targetDstExpInLevel,
          expType: r.expType,
          nature: r.nature,
          boost: boostKind.value,
          boostCandy,
          expGot,
        });
        candyNeed = boostCandy + mixedResult.normalCandy;
        boostOrExpAdjustment = boostCandy;
        dynamicDstLevel = peakResult.level;
        dynamicDstExpInLevel = targetDstExpInLevel;
      }

      // 必要EXPは動的な目標レベルまでのEXP
      const calcResult = calcExpAndCandy({
        srcLevel: r.srcLevel,
        dstLevel: dynamicDstLevel,
        dstExpInLevel: dynamicDstExpInLevel,
        expType: r.expType,
        nature: r.nature,
        boost: boostKind.value,
        expGot,
      });
      const expNeed = calcResult.exp;

      requests.push({
        id: r.id,
        pokedexId,
        form: 0,
        pokemonName: r.title,
        type: pokemonType,
        srcLevel: r.srcLevel,
        dstLevel: dynamicDstLevel,
        dstExpInLevel: dynamicDstExpInLevel,
        expType: r.expType,
        nature: r.nature,
        expGot,
        candyNeed,
        expNeed,
        boostOrExpAdjustment,
        candyTarget: r.candyTarget,
        mode: r.mode,
      });
    }

    if (requests.length === 0) return null;

    const config = {
      boostKind: boostKind.value,
      globalBoostLimit: boostCandyRemaining.value ?? boostCandyDefaultCap.value,
      globalShardsLimit: shardsCap.value,
    };

    return planLevelUp(requests, inventory, config);
  });

  /**
   * ポケモンの計画結果を取得
   */
  function getPokemonResult(id: string): PokemonLevelUpResult | null {
    return planResult.value?.pokemons.find(p => p.id === id) ?? null;
  }

  /**
   * 理論値行を取得（個数指定があれば candyTarget、なければ target）
   */
  function getTheoreticalRow(p: PokemonLevelUpResult): ItemUsage {
    if (p.candyTarget !== undefined && p.candyTargetItems) {
      return p.candyTargetItems;
    }
    return p.targetItems;
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

  // 万能アメ使用ランキング（planResult.itemUsageRanking を使用）
  const universalCandyRanking = computed(() => {
    if (!planResult.value) return [];

    const totalUniversalValue =
      planResult.value.universalUsed.s * CANDY_VALUES.universal.s +
      planResult.value.universalUsed.m * CANDY_VALUES.universal.m +
      planResult.value.universalUsed.l * CANDY_VALUES.universal.l;

    if (totalUniversalValue <= 0) return [];

    return planResult.value.pokemons
      .map((p: PokemonLevelUpResult) => {
        const uniValue =
          p.reachableItems.universalS * CANDY_VALUES.universal.s +
          p.reachableItems.universalM * CANDY_VALUES.universal.m +
          p.reachableItems.universalL * CANDY_VALUES.universal.l;
        const usagePct = totalUniversalValue > 0 ? (uniValue / totalUniversalValue) * 100 : 0;
        return {
          id: p.id,
          pokemonName: p.pokemonName,
          universalValue: uniValue,
          usagePct: Math.round(usagePct),
          uniSUsed: p.reachableItems.universalS,
          uniMUsed: p.reachableItems.universalM,
          uniLUsed: p.reachableItems.universalL,
          typeSUsed: p.reachableItems.typeS,
          typeMUsed: p.reachableItems.typeM,
        };
      })
      .filter((x: { universalValue: number }) => x.universalValue > 0)
      .sort((a: { usagePct: number }, b: { usagePct: number }) => b.usagePct - a.usagePct);
  });

  // 万能アメ合計使用数 (planResult から取得)
  const universalCandyUsedTotal = computed(() => {
    if (!planResult.value) return { s: 0, m: 0, l: 0 };
    return planResult.value.universalUsed;
  });

  // 万能アメの必要数（サマリー用、実使用ベース）
  const universalCandyNeeded = computed(() => {
    if (!planResult.value) return { s: 0, m: 0, l: 0, total: 0 };

    let totalS = 0;
    let totalM = 0;
    let totalL = 0;

    for (const p of planResult.value.pokemons) {
      // 実使用（reachableItems）を使用
      const items = p.reachableItems;
      totalS += items.universalS;
      totalM += items.universalM;
      totalL += items.universalL;
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
    title?: string;
    dstLevelDefault?: number;
    pokedexId?: number;
    pokemonType?: string;
    ev?: MouseEvent;
  }) {
    const anchorEl = (p.ev?.currentTarget as HTMLElement | null) ?? null;
    const prevTop = anchorEl ? anchorEl.getBoundingClientRect().top : null;

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
    const candyPatchResult = calcCandyPatch({ srcLevel, dstLevel, expType: p.expType, nature: p.nature, expRemaining: remaining, excludeRowId: existing?.id });

    const title =
      String(p.title ?? "").trim() ||
      (resolveTitleByBoxId ? resolveTitleByBoxId(p.boxId) ?? "" : "") ||
      "(no name)";


    if (existing) {
      updateRow(existing.id, {
        title, boxId: p.boxId, srcLevel, dstLevel, expType: p.expType, nature: p.nature,
        expRemaining: remaining, pokedexId: p.pokedexId, pokemonType: p.pokemonType,
        ...candyPatchResult,
      });
      activeRowId.value = existing.id;
    } else {
      const row: CalcRow = {
        id: cryptoRandomId(), title, boxId: p.boxId, pokedexId: p.pokedexId, pokemonType: p.pokemonType,
        srcLevel, dstLevel, expRemaining: remaining, expType: p.expType, nature: p.nature,
        ...candyPatchResult,
      };
      rows.value = [...rows.value, row];
      activeRowId.value = row.id;
    }

    nextTick(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!anchorEl || prevTop == null) return;
          if (!anchorEl.isConnected) return;
          const nextTop = anchorEl.getBoundingClientRect().top;
          const dy = nextTop - prevTop;
          if (Math.abs(dy) > 1) {
            const scrollEl = document.querySelector('.shell__scroll');
            if (scrollEl) {
              scrollEl.scrollBy(0, dy);
            } else {
              window.scrollBy(0, dy);
            }
          }
        });
      });
    });
  }

  function buildPlannerPatchFromRow(rowId?: string): CalcBoxPlannerPatch | null {
    const r = rowId ? (rows.value.find((x) => x.id === rowId) ?? null) : activeRow.value;
    if (!r || !r.boxId) return null;
    return {
      boxId: r.boxId,
      level: r.srcLevel,
      expRemaining: r.expRemaining,
    };
  }

  return {
    boostKind,
    setSlotBoostKind,
    totalShards,
    totalShardsText,
    boostCandyRemaining,
    boostCandyRemainingText,
    boostCandyDefaultCap,
    slots,
    rows,
    activeRowId,
    activeSlotTab,

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
    exportScale,

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
    getPokemonResult,
    getTheoreticalRow,
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
    onRowBoostRatio,
    onRowBoostCandy,
    resetRowBoostCandy,

    moveRow,
    moveRowUp,
    moveRowDown,
    canMoveRowUp,
    canMoveRowDown,

    upsertFromBox,
    buildPlannerPatchFromRow,
  };
}
