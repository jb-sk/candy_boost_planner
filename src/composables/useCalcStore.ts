import { computed, nextTick, ref, toRaw, watch, type Ref } from "vue";
import type { Composer } from "vue-i18n";
import type { BoostEvent, ExpGainNature, ExpType } from "../domain/types";
import { calcExp, calcExpAndCandy, calcExpAndCandyByBoostExpRatio, calcExpAndCandyMixed, calcExpPerCandy, calcLevelByCandy, calcLevelByCandyAndShards } from "../domain/pokesleep";
import { boostRules, defaultBoostKind } from "../domain/pokesleep/boost-config";
import type { CalcRowV1, CalcSaveSlotV1 } from "../persistence/calc";
import { loadCalcSlots, loadLegacyTotalShards, saveCalcSlots, saveTotalShards, loadBoostCandyRemaining, saveBoostCandyRemaining } from "../persistence/calc";
import { cryptoRandomId } from "../persistence/box";
import { useCandyStore } from "./useCandyStore";
import { allocateCandy, allocateCandyUnlimited, allocateForTargetRow, type AllocationSummary, type PokemonCandyNeed, type PokemonAllocation } from "../domain/candy-allocator";
import { getPokemonType } from "../domain/pokesleep/pokemon-names";
import { CANDY_VALUES } from "../persistence/candy";

export type CalcRow = CalcRowV1;

export type CalcRowView = CalcRow & {
  title: string;
  srcLevel: number;
  dstLevel: number;
  expRemaining: number;
  result: {
    exp: number;
    expBoostApplied: number;
    boostCandy: number;
    normalCandy: number;
    shards: number;
    expLeftNext: number;
  };
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
  shortage: number;
};

export type CalcExportTotals = { boostCandy: number; normalCandy: number; totalCandy: number; shards: number; shortage: number };

export type CalcBoxPlannerPatch = {
  boxId: string;
  level: number;
  expRemaining: number;
  expType: ExpType;
  expGainNature: ExpGainNature;
};

type CalcUndoState = {
  rows: CalcRow[];
  activeRowId: string | null;
  slots: Array<CalcSaveSlotV1 | null>;
};

export type CalcStore = {
  // core state
  boostKind: Ref<BoostEvent>;
  totalShards: Ref<number>;
  totalShardsText: Ref<string>;
  boostCandyRemaining: Ref<number | null>;
  boostCandyRemainingText: Ref<string>;
  boostCandyDefaultCap: Readonly<Ref<number>>;
  slots: Ref<Array<CalcSaveSlotV1 | null>>;
  rows: Ref<CalcRow[]>;
  activeRowId: Ref<string | null>;
  activeSlotTab: Ref<number>;

  // UI state
  exportOpen: Ref<boolean>;
  openLevelPickRowId: Ref<string | null>;
  openLevelPickKind: Ref<"src" | "dst" | "boost">;
  dragRowId: Ref<string | null>;
  dragOverRowId: Ref<string | null>;

  // computed
  fullLabel: Readonly<Ref<string>>;
  miniLabel: Readonly<Ref<string>>;
  noneLabel: Readonly<Ref<string>>;
  activeRow: Readonly<Ref<CalcRow | null>>;
  rowsView: Readonly<Ref<CalcRowView[]>>;

  exportRows: Readonly<Ref<CalcExportRow[]>>;
  exportTotals: Readonly<Ref<CalcExportTotals>>;
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

  // candy allocation
  allocationResult: Readonly<Ref<AllocationSummary | null>>;
  /** 「目標まで」行用の計算結果（使用制限なし） */
  targetAllocationMap: Readonly<Ref<Record<string, PokemonAllocation>>>;
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

  // row UI: level picker / drag reorder
  openDstLevelPick: (id: string) => void;
  openSrcLevelPick: (id: string) => void;
  openBoostLevelPick: (id: string) => void;
  closeLevelPick: () => void;
  nudgeDstLevel: (id: string, delta: number) => void;
  nudgeSrcLevel: (id: string, delta: number) => void;
  nudgeBoostLevel: (id: string, delta: number) => void;
  setDstLevel: (id: string, v: unknown) => void;
  setSrcLevel: (id: string, v: unknown) => void;
  setBoostLevel: (id: string, v: unknown) => void;

  onRowExpRemaining: (id: string, v: string) => void;
  onRowNature: (id: string, v: string) => void;
  onRowCandyTarget: (id: string, v: string) => void;
  onRowReverseCalcMode: (id: string, checked: boolean) => void;
  onRowBoostLevel: (id: string, v: string) => void;
  onRowBoostRatio: (id: string, v: string) => void;
  onRowBoostCandy: (id: string, v: string) => void;

  moveRowUp: (id: string) => void;
  moveRowDown: (id: string) => void;
  canMoveRowUp: (id: string) => boolean;
  canMoveRowDown: (id: string) => boolean;
  onRowDragStart: (id: string, ev: DragEvent) => void;
  onRowDragEnd: () => void;
  onRowDragOver: (overId: string) => void;
  onRowDragLeave: (overId: string) => void;
  onRowDrop: (overId: string) => void;

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
  locale: Ref<string>;
  t: Composer["t"];
  resolveTitleByBoxId?: (boxId: string) => string | null;
  resolvePokedexIdByBoxId?: (boxId: string) => number | undefined;
}): CalcStore {
  const { locale, t, resolveTitleByBoxId, resolvePokedexIdByBoxId } = opts;

  function fmtNum(n: number): string {
    return new Intl.NumberFormat(locale.value as any).format(n);
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

  // 現在のスロットからデータを読み込み
  function getSlotData(slotIndex: number) {
    const slot = slots.value[slotIndex];
    if (slot) {
      return {
        rows: cloneCalcRows(slot.rows),
        activeRowId: slot.activeRowId ?? slot.rows[0]?.id ?? null,
      };
    }
    // 空のスロットは空の状態で開始
    return { rows: [], activeRowId: null };
  }

  // 初期データは現在のスロットから
  const initialData = getSlotData(activeSlotTab.value);
  // ただし、まだcloneCalcRowsが定義されていないのでlegacyの方法で
  const slot0 = slots.value[activeSlotTab.value];
  const boostKind = ref<BoostEvent>(defaultBoostKind);
  const totalShards = ref<number>(loadLegacyTotalShards());
  const totalShardsText = ref<string>("");
  // アメブ残数（nullの場合はboostKindによる上限を使用）
  const boostCandyRemaining = ref<number | null>(loadBoostCandyRemaining());
  const boostCandyRemainingText = ref<string>("");

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

  // boostKindが変わったらboostCandyRemainingをリセット
  watch(boostKind, () => {
    boostCandyRemaining.value = null;
    boostCandyRemainingText.value = "";
  });

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
    const raw = toRaw(entries) as any;
    return JSON.parse(JSON.stringify(raw));
  }
  function cloneCalcSlots(v: Array<CalcSaveSlotV1 | null>): Array<CalcSaveSlotV1 | null> {
    const raw = toRaw(v) as any;
    return JSON.parse(JSON.stringify(raw));
  }

  // 現在のスロットにデータを保存
  function saveToCurrentSlot() {
    const i = activeSlotTab.value;
    const now = new Date().toISOString();
    const slot: CalcSaveSlotV1 = { savedAt: now, rows: cloneCalcRows(rows.value), activeRowId: activeRowId.value };
    slots.value = slots.value.map((x, idx) => (idx === i ? slot : x));
  }

  // スロット切り替え時の処理（データを切り替え）
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
    } else {
      rows.value = [];
      activeRowId.value = null;
    }
    openLevelPickRowId.value = null;

    // undo/redoスタックをクリア
    undoStack.value = [];
    redoStack.value = [];
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
    openLevelPickRowId.value = null;
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
    openLevelPickRowId.value = null;
  }

  function removeRowById(id: string) {
    const exists = rows.value.some((x) => x.id === id);
    if (!exists) return;
    beginUndo();
    rows.value = rows.value.filter((x) => x.id !== id);
    if (activeRowId.value === id) activeRowId.value = rows.value[0]?.id ?? null;
    openLevelPickRowId.value = null;
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

  const openLevelPickRowId = ref<string | null>(null);
  const openLevelPickKind = ref<"src" | "dst" | "boost">("dst");
  const dragRowId = ref<string | null>(null);
  const dragOverRowId = ref<string | null>(null);

  function clampInt(v: unknown, min: number, max: number, fallback: number): number {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(n)));
  }

  function openDstLevelPick(id: string) {
    openLevelPickKind.value = "dst";
    openLevelPickRowId.value = openLevelPickRowId.value === id ? null : id;
  }
  function openSrcLevelPick(id: string) {
    openLevelPickKind.value = "src";
    openLevelPickRowId.value = openLevelPickRowId.value === id ? null : id;
  }
  function openBoostLevelPick(id: string) {
    openLevelPickKind.value = "boost";
    openLevelPickRowId.value = openLevelPickRowId.value === id ? null : id;
  }
  function closeLevelPick() {
    openLevelPickRowId.value = null;
  }

  function updateRow(id: string, patch: Partial<CalcRow>) {
    rows.value = rows.value.map((x) => (x.id === id ? { ...x, ...patch } : x));
  }

  function setDstLevel(id: string, v: unknown) {
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    const dst = clampInt(v, r.srcLevel, 65, r.dstLevel);

    const patch: Partial<CalcRow> = { dstLevel: dst };
    const toNext = Math.max(0, calcExp(r.srcLevel, r.srcLevel + 1, r.expType));
    const expGot = r.expRemaining !== undefined ? Math.max(0, toNext - r.expRemaining) : 0;

    if (boostKind.value === "none") {
      const res = calcExpAndCandyMixed({
        srcLevel: r.srcLevel,
        dstLevel: dst,
        expType: r.expType,
        nature: r.nature,
        boost: "none",
        boostCandy: 0,
        expGot,
      });
      patch.boostCandyInput = res.normalCandy;
      patch.mode = "candy";
    } else {
      // イベント時：dstLevelを手動変更したらピークをリセットし、必要アメブ数をセット
      const res = calcExpAndCandy({
        srcLevel: r.srcLevel,
        dstLevel: dst,
        expType: r.expType,
        nature: r.nature,
        boost: boostKind.value,
        expGot,
      });
      patch.boostCandyInput = res.candy;
      patch.boostCandyPeak = res.candy;
      patch.boostRatioPct = 100;  // 100%アメブで計算するので割合も100%
      patch.boostReachLevel = dst;  // アメブ目標Lvも目標Lvに合わせる
      patch.mode = "candy";
    }
    updateRow(id, patch);
  }
  function nudgeDstLevel(id: string, delta: number) {
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    setDstLevel(id, r.dstLevel + delta);
  }
  function setSrcLevel(id: string, v: unknown) {
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    const src = clampInt(v, 1, r.dstLevel, r.srcLevel);
    const dst = r.dstLevel < src ? src : r.dstLevel;
    const toNext = Math.max(0, calcExp(src, src + 1, r.expType));
    const nextBoostReach = clampInt(r.boostReachLevel, src, dst, src);
    // 現在Lv変更時はピークをリセット
    updateRow(id, { srcLevel: src, dstLevel: dst, expRemaining: toNext, boostReachLevel: nextBoostReach, boostCandyPeak: 0 });
  }
  function nudgeSrcLevel(id: string, delta: number) {
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    setSrcLevel(id, r.srcLevel + delta);
  }
  function setBoostLevel(id: string, v: unknown) {
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    const mid = clampInt(v, r.srcLevel, r.dstLevel, r.srcLevel);
    // アメブ目標Lv変更時はピークをリセット
    updateRow(id, { boostReachLevel: mid, mode: "boostLevel", boostCandyPeak: 0 });
  }
  function nudgeBoostLevel(id: string, delta: number) {
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    setBoostLevel(id, r.boostReachLevel + delta);
  }

  function onRowExpRemaining(id: string, v: string) {
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    const toNext = Math.max(0, calcExp(r.srcLevel, r.srcLevel + 1, r.expType));
    const rem = clampInt(v, 0, toNext, toNext);
    updateRow(id, { expRemaining: rem });
  }
  function onRowNature(id: string, v: string) {
    const nat: ExpGainNature = v === "up" || v === "down" || v === "normal" ? (v as any) : "normal";
    updateRow(id, { nature: nat });
  }
  function onRowCandyTarget(id: string, v: string) {
    // 空欄 = undefined (制限なし)、0以上 = 有効な目標値
    const n = v.trim() === "" ? undefined : Math.max(0, Math.floor(Number(v) || 0));
    // 制限を削除したら逆算モードもオフ
    if (n === undefined) {
      updateRow(id, { candyTarget: n, isReverseCalcMode: undefined });
    } else {
      updateRow(id, { candyTarget: n });
    }
  }
  function onRowReverseCalcMode(id: string, checked: boolean) {
    updateRow(id, { isReverseCalcMode: checked ? true : undefined });
  }
  function onRowBoostLevel(id: string, v: string) {
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;
    const mid = clampInt(v, r.srcLevel, r.dstLevel, r.srcLevel);
    updateRow(id, { boostReachLevel: mid, mode: "boostLevel" });
  }
  function onRowBoostRatio(id: string, v: string) {
    const pct = clampInt(v, 0, 100, 0);
    updateRow(id, { boostRatioPct: pct, mode: "ratio" });
  }
  function onRowBoostCandy(id: string, v: string) {
    let n = Math.max(0, Math.floor(Number(v) || 0));
    const r = rows.value.find((x) => x.id === id);
    if (!r) return;

    // アメ数から到達レベルを計算して dstLevel も更新する
    const toNext = Math.max(0, calcExp(r.srcLevel, r.srcLevel + 1, r.expType));
    const expGot = r.expRemaining !== undefined ? Math.max(0, toNext - r.expRemaining) : 0;

    // 仮の上限Lv65（設定上のMAX）まで計算
    const sim = calcLevelByCandy({
      srcLevel: r.srcLevel,
      dstLevel: 65,
      expType: r.expType,
      nature: r.nature,
      boost: boostKind.value,
      candy: n,
      expGot,
    });

    // Lv65に到達していて余りがある場合、実際に使用した量にクランプ
    if (sim.level >= 65 && sim.candyLeft > 0) {
      n = sim.candyUsed;
    }

    // アメブ個数を増やした結果、現在の目標Lvを超えるなら目標Lvを引き上げる
    // 減らした場合は目標Lvを維持（通常アメで補填する形になる）
    const reachableLevel = Math.max(r.srcLevel, sim.level);
    // アメブ個数を増やした結果、現在の目標Lvを超えるなら目標Lvを引き上げる
    // 通常モードの場合はアメ数に応じてLvを下げることも許可
    const newDst = boostKind.value === "none" ? reachableLevel : Math.max(r.dstLevel, reachableLevel);

    // イベント時、アメブ個数のピークを記録（減少時の補填計算用）
    const currentPeak = r.boostCandyPeak ?? 0;
    const newPeak = boostKind.value === "none" ? 0 : Math.max(currentPeak, n);

    // boostReachLevelも更新：目標Lvが引き上げられた場合、100%アメブを維持するため
    // 現在のboostReachLevelが現在のdstLevelと同じ（=100%アメブ）なら、新しいdstLevelに合わせる
    const currentBoostReach = r.boostReachLevel ?? r.srcLevel;
    const isFullBoost = currentBoostReach >= r.dstLevel;
    const newBoostReach = isFullBoost ? newDst : currentBoostReach;

    updateRow(id, { boostCandyInput: n, mode: "candy", dstLevel: newDst, boostCandyPeak: newPeak, boostReachLevel: newBoostReach });
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

  function onRowDragStart(id: string, ev: DragEvent) {
    dragRowId.value = id;
    dragOverRowId.value = null;
    try {
      ev.dataTransfer?.setData("text/plain", id);
      ev.dataTransfer?.setDragImage?.((ev.target as HTMLElement) ?? new Image(), 0, 0);
    } catch {
      // ignore
    }
  }
  function onRowDragEnd() {
    dragRowId.value = null;
    dragOverRowId.value = null;
  }
  function onRowDragOver(overId: string) {
    if (!dragRowId.value) return;
    if (overId === dragOverRowId.value) return;
    dragOverRowId.value = overId;
  }
  function onRowDragLeave(overId: string) {
    if (dragOverRowId.value === overId) dragOverRowId.value = null;
  }
  function onRowDrop(overId: string) {
    const fromId = dragRowId.value;
    if (!fromId) return;
    if (fromId === overId) return onRowDragEnd();
    const to = indexOfRow(overId);
    if (to < 0) return onRowDragEnd();
    moveRow(fromId, to);
    onRowDragEnd();
  }

  function calcRowExpGot(r: CalcRow): { toNext: number; expGot: number; expRemaining: number } {
    const toNext = Math.max(0, calcExp(r.srcLevel, r.srcLevel + 1, r.expType));
    const remaining = clampInt(r.expRemaining, 0, toNext, toNext);
    if (toNext <= 0) return { toNext: 0, expGot: 0, expRemaining: remaining };
    const got = toNext - remaining;
    return { toNext, expGot: Math.max(0, Math.min(got, toNext)), expRemaining: remaining };
  }

  function calcRowMixedByBoostLevel(r: CalcRow, expGot: number, boostCandyOverride?: number) {
    const src = r.srcLevel;
    const dst = r.dstLevel;
    const mid = clampInt(r.boostReachLevel, src, dst, src);
    if (mid <= src) {
      return calcExpAndCandyMixed({
        srcLevel: src,
        dstLevel: dst,
        expType: r.expType,
        nature: r.nature,
        boost: "none",
        boostCandy: 0,
        expGot,
      });
    }

    // 自動計算の場合: Lv mid まで必要なアメブ数を計算
    const boostOnlyNeed = calcExpAndCandy({
      srcLevel: src,
      dstLevel: mid,
      expType: r.expType,
      nature: r.nature,
      boost: boostKind.value,
      expGot,
    });

    // ユーザー指定がある場合はそちらを使用、なければ自動計算値
    const boostCandyToUse = boostCandyOverride !== undefined ? boostCandyOverride : boostOnlyNeed.candy;

    // アメブをsrc→midで使用した結果を計算
    const atMid = calcLevelByCandy({
      srcLevel: src,
      dstLevel: mid,
      expType: r.expType,
      nature: r.nature,
      boost: boostKind.value,
      candy: boostCandyToUse,
      expGot,
    });

    // アメブで mid に到達したか確認
    const reachedMid = atMid.level >= mid;

    // アメブ区間のかけら計算（実際に使用した分）
    const boostSeg = calcExpAndCandyMixed({
      srcLevel: src,
      dstLevel: reachedMid ? mid : atMid.level,
      expType: r.expType,
      nature: r.nature,
      boost: boostKind.value,
      boostCandy: reachedMid ? boostCandyToUse : atMid.candyUsed,
      expGot,
    });

    // 通常アメ区間: mid（またはアメブで到達したLv）→dst
    const normalStartLevel = reachedMid ? mid : atMid.level;
    const normalExpGot = atMid.expGot;

    const normalSeg = calcExpAndCandyMixed({
      srcLevel: normalStartLevel,
      dstLevel: dst,
      expType: r.expType,
      nature: r.nature,
      boost: "none",
      boostCandy: 0,
      expGot: normalExpGot,
    });

    return {
      exp: boostSeg.exp + normalSeg.exp,
      expNormalApplied: normalSeg.expNormalApplied,
      expBoostApplied: boostSeg.expBoostApplied,
      normalCandy: normalSeg.normalCandy,
      boostCandy: reachedMid ? boostCandyToUse : atMid.candyUsed,
      shards: boostSeg.shardsBoost + normalSeg.shardsNormal,
      shardsNormal: normalSeg.shardsNormal,
      shardsBoost: boostSeg.shardsBoost,
      boostCandyLeft: 0,
      expLeftNext: normalSeg.expLeftNext,
    };
  }

  function calcRowView(r: CalcRow) {
    const src = clampInt(r.srcLevel, 1, 65, 1);
    const dstFromText =
      typeof r.dstLevelText === "string" && r.dstLevelText.trim() !== "" ? clampInt(r.dstLevelText, 1, 65, r.dstLevel) : null;
    const dst = clampInt(dstFromText ?? r.dstLevel, src, 65, src);
    const expT = r.expType;
    const nat = r.nature;
    const expInfo = calcRowExpGot({ ...r, srcLevel: src, dstLevel: dst, expType: expT, nature: nat });
    const expGot = expInfo.expGot;

    const requiredExp = calcExpAndCandy({
      srcLevel: src,
      dstLevel: dst,
      expType: expT,
      nature: nat,
      boost: "none",
      expGot,
    });

    const byRatio = calcExpAndCandyByBoostExpRatio({
      srcLevel: src,
      dstLevel: dst,
      expType: expT,
      nature: nat,
      boost: boostKind.value as any /* cast to any to fix build error */,
      expGot,
      boostExpRatio: boostKind.value === "none" ? 0 : clampInt(r.boostRatioPct, 0, 100, 100) / 100,
    });



    let byCandy = calcExpAndCandyMixed({
      srcLevel: src,
      dstLevel: dst,
      expType: expT,
      nature: nat,
      boost: boostKind.value as any,
      boostCandy: Math.max(0, Math.floor(Number(r.boostCandyInput) || 0)),
      expGot,
    });

    // 通常モードかつアメ個数モード: ユーザー入力を正として計算結果を補正
    if (r.mode === "candy" && boostKind.value === "none") {
      const input = Math.max(0, Math.floor(Number(r.boostCandyInput) || 0));
      const sim = calcLevelByCandy({
        srcLevel: src,
        dstLevel: 100,
        expType: expT,
        nature: nat,
        boost: "none",
        candy: input,
        expGot,
      });
      const nextReq = calcExp(sim.level, sim.level + 1, expT);
      const left = nextReq - sim.expGot;
      byCandy = {
        ...byCandy,
        normalCandy: input,
        boostCandy: 0,
        expLeftNext: Math.max(0, left),
      };
    }

    // イベント時、ピーク計算を1回だけ行う
    const peak = r.boostCandyPeak ?? 0;
    const current = Math.max(0, Math.floor(Number(r.boostCandyInput) || 0));
    const hasPeak = boostKind.value !== "none" && peak > 0;
    const peakResult = hasPeak
      ? calcExpAndCandyMixed({
        srcLevel: src,
        dstLevel: dst,
        expType: expT,
        nature: nat,
        boost: boostKind.value as any,
        boostCandy: peak,
        expGot,
      })
      : null;

    // byBoostLevel: アメ目標Lvが設定されている場合、ユーザー入力のアメブ個数を使用
    const userBoostCandy = Math.max(0, Math.floor(Number(r.boostCandyInput) || 0));
    const mid = clampInt(r.boostReachLevel, src, dst, src);
    const hasBoostLevel = mid > src;
    const byBoostLevel = hasBoostLevel
      ? calcRowMixedByBoostLevel({ ...r, srcLevel: src, dstLevel: dst, expType: expT, nature: nat }, expGot, userBoostCandy > 0 ? userBoostCandy : undefined)
      : byCandy;

    // モードに応じて計算結果を選択
    // mode="candy"の場合は常にbyCandyを使用（リリースバージョンの動作）
    // mode="boostLevel"の場合のみbyBoostLevelを使用
    let mixed = r.mode === "boostLevel" ? byBoostLevel : r.mode === "ratio" ? byRatio : byCandy;

    // イベント時、割合モードでピークがある場合
    // 注意: ピーク基準ではなく、実際の必要EXP（目標Lvまで）を基準に計算する
    // calcExpAndCandyByBoostExpRatio を使うことで、正確なアメ個数を計算
    if (r.mode === "ratio" && peakResult && peak > 0) {
      const ratio = clampInt(r.boostRatioPct, 0, 100, 100) / 100;

      // 正しい計算: 目標Lvまでの必要EXPを基準に、割合で配分
      // byRatio は calcExpAndCandyByBoostExpRatio で正確に計算済み
      // ピークがある場合でも byRatio の結果を使用し、expLeftNext のみ peakResult から取得
      mixed = {
        ...byRatio,
        expLeftNext: ratio > 0 ? peakResult.expLeftNext : byRatio.expLeftNext,
      };
    }

    const uiCandy =
      r.mode === "ratio"
        ? (peakResult && peak > 0 ? mixed.boostCandy : byRatio.boostCandy)
        : r.mode === "boostLevel"
          ? byBoostLevel.boostCandy
          : Math.max(0, Math.floor(Number(r.boostCandyInput) || 0));

    const base = requiredExp.exp;
    const uiRatioPct =
      r.mode === "ratio"
        ? boostKind.value === "none" ? 0 : clampInt(r.boostRatioPct, 0, 100, 0)
        : clampInt(base > 0 ? Math.round((mixed.expBoostApplied / base) * 100) : 0, 0, 100, 0);

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
      r.mode === "boostLevel" ? clampInt(r.boostReachLevel, src, dst, src) : clampInt(boostOnly.level, src, dst, src);

    const resolvedTitle =
      r.boxId && resolveTitleByBoxId ? resolveTitleByBoxId(r.boxId) ?? (String(r.title ?? "").trim() || "(no name)") : String(r.title ?? "").trim() || "(no name)";

    return {
      title: resolvedTitle,
      normalized: { srcLevel: src, dstLevel: dst, expRemaining: expInfo.expRemaining },
      mixed,
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
        result: v.mixed,
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

  const exportRows = computed(() =>
    rowsView.value.map((r) => {
      let boostCandy = Math.max(0, Math.floor(r.result.boostCandy || 0));
      let normalCandy = Math.max(0, Math.floor(r.result.normalCandy || 0));
      let shards = Math.max(0, Math.floor(r.result.shards || 0));
      let displayDstLevel = r.dstLevel;

      // アメ補填情報を取得
      let candySupply = "";
      let shortage = 0;
      if (allocationResult.value) {
        const alloc = allocationResult.value.pokemons.find(p => p.id === r.id);
        if (alloc) {
          // アメ不足の判定（まとめ用）
          // 1. 個数指定あり: 個数指定まで使えていれば不足なし
          // 2. 個数指定なし: targetAllocationMap.originalRemaining（かけら制限なしでのアメ不足）を使用
          //    かけら不足のみの場合はアメ不足にならない
          if (r.candyTarget != null && r.candyTarget >= 0) {
            // 個数指定がある場合: 理論値を計算
            // 個数指定で到達可能なLvを計算
            const candyLimit = r.candyTarget;
            const expGot = r.result.expLeftNext > 0 ? 0 : 0;  // シンプルに0とする

            // 個数指定での到達Lvを計算（理論値）
            const levelResult = calcLevelByCandy({
              srcLevel: r.srcLevel,
              dstLevel: r.dstLevel,  // 目標Lvを上限として
              expType: r.expType,
              nature: r.nature,
              boost: boostKind.value,
              candy: candyLimit,
              expGot: expGot,
            });

            const theoreticalLevel = levelResult.level;
            displayDstLevel = theoreticalLevel;

            // 理論レベルまでの必要リソースを計算
            if (theoreticalLevel > r.srcLevel) {
              // 個数指定での到達Lvまでの必要リソースを計算
              // アメブ割合は目標までの設定を維持
              const totalCandyForTarget = r.result.boostCandy + r.result.normalCandy;
              const boostRatio = totalCandyForTarget > 0 ? r.result.boostCandy / totalCandyForTarget : 1;

              // 個数指定の値を割合に基づいて分配
              const theoreticalBoostCandy = Math.round(candyLimit * boostRatio);
              const theoreticalNormalCandy = candyLimit - theoreticalBoostCandy;

              // この到達Lvまでのかけらを計算
              const mixedResult = calcExpAndCandyMixed({
                srcLevel: r.srcLevel,
                dstLevel: theoreticalLevel,
                expType: r.expType,
                nature: r.nature,
                boost: boostKind.value,
                boostCandy: theoreticalBoostCandy,
                expGot: expGot,
              });

              boostCandy = theoreticalBoostCandy;
              normalCandy = theoreticalNormalCandy;
              shards = mixedResult.shards;
            } else {
              boostCandy = 0;
              normalCandy = 0;
              shards = 0;
            }

            // アメ不足: 指定量と実際使用量の差
            const actualUsed = alloc.boostCandyUsed + alloc.normalCandyUsed;
            shortage = actualUsed >= candyLimit ? 0 : Math.max(0, candyLimit - actualUsed);
          } else {
            // 個数指定なし: かけら制限なしでのアメ不足を使用
            const targetAlloc = targetAllocationMap.value[r.id];
            if (targetAlloc && alloc.remaining > 0) {
              // originalRemaining > 0 なら純粋なアメ在庫不足
              // originalRemaining = 0 ならかけら不足のみなのでアメ不足にはならない
              shortage = targetAlloc.originalRemaining ?? 0;
            } else {
              shortage = 0;
            }
          }

          const parts: string[] = [];
          if (alloc.typeSUsed > 0 || alloc.typeMUsed > 0) {
            const typeParts: string[] = [];
            if (alloc.typeMUsed > 0) typeParts.push(`M${alloc.typeMUsed}`);
            if (alloc.typeSUsed > 0) typeParts.push(`S${alloc.typeSUsed}`);
            parts.push(`${t("calc.candy.typeAbbr")}${typeParts.join(",")}`);
          }
          if (alloc.uniSUsed > 0 || alloc.uniMUsed > 0 || alloc.uniLUsed > 0) {
            const uniParts: string[] = [];
            if (alloc.uniLUsed > 0) uniParts.push(`L${alloc.uniLUsed}`);
            if (alloc.uniMUsed > 0) uniParts.push(`M${alloc.uniMUsed}`);
            if (alloc.uniSUsed > 0) uniParts.push(`S${alloc.uniSUsed}`);
            parts.push(`${t("calc.candy.uniAbbr")}${uniParts.join(",")}`);
          }
          if (shortage > 0) {
            parts.push(`${t("calc.candy.shortage")}${shortage}`);
          }
          candySupply = parts.join(" ");
        }
      }

      return {
        id: r.id,
        title: String(r.title ?? "").trim() || "(no name)",
        natureLabel: natureLabel(r.nature),
        srcLevel: r.srcLevel,
        dstLevel: displayDstLevel,
        boostCandy,
        normalCandy,
        totalCandy: boostCandy + normalCandy,
        shards,
        candySupply,
        shortage,
      };
    })
  );

  const exportTotals = computed(() => {
    let boostCandy = 0;
    let normalCandy = 0;
    let shards = 0;
    for (const r of exportRows.value) {
      boostCandy += r.boostCandy;
      normalCandy += r.normalCandy;
      shards += r.shards;
    }
    const shortage = exportRows.value.reduce((sum, r) => sum + r.shortage, 0);
    return { boostCandy, normalCandy, totalCandy: boostCandy + normalCandy, shards, shortage };
  });

  const exportScale = computed(() => {
    const n = exportRows.value.length;
    if (n <= 6) return 1;
    if (n <= 9) return 0.94;
    if (n <= 12) return 0.88;
    if (n <= 16) return 0.82;
    return 0.76;
  });

  // 理論値ベースのかけら合計
  // targetAllocationMapのlimitShardsUsedを合計
  const totalShardsUsed = computed(() => {
    const allocMap = targetAllocationMap.value;
    return Object.values(allocMap).reduce((total, alloc) => {
      return total + (alloc.limitShardsUsed ?? alloc.shardsUsed ?? 0);
    }, 0);
  });
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

  // 理論値ベースのアメブ合計
  // targetAllocationMapのlimitBoostCandyUsedを合計
  const totalBoostCandyUsed = computed(() => {
    const allocMap = targetAllocationMap.value;
    return Object.values(allocMap).reduce((total, alloc) => {
      return total + (alloc.limitBoostCandyUsed ?? alloc.boostCandyUsed ?? 0);
    }, 0);
  });
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
  const activeRowShardsUsed = computed(() => {
    const row = rowsView.value.find(r => r.id === activeRowId.value);
    return row?.result.shards ?? 0;
  });
  const activeRowBoostCandyUsed = computed(() => {
    const row = rowsView.value.find(r => r.id === activeRowId.value);
    return row?.result.boostCandy ?? 0;
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

  const allocationResult = computed<AllocationSummary | null>(() => {
    const rv = rowsView.value;
    const inventory = candyStore.getInventory();
    const globalBoostRemaining = boostCandyRemaining.value ?? boostCandyDefaultCap.value;

    // 逆算モードでないポケモン（やりくりモード）用のneeds
    const needs: PokemonCandyNeed[] = [];
    // 逆算モードのポケモン用
    const reverseModePokemons: Array<{ need: PokemonCandyNeed; row: CalcRowView }> = [];

    for (const r of rv) {
      const pokedexId = getRowPokedexId(r);
      if (!pokedexId) continue;

      const candyNeed = Math.max(0, r.result.boostCandy + r.result.normalCandy);
      if (candyNeed <= 0) continue;

      const pokemonType = r.pokemonType || getPokemonType(pokedexId);
      const expPerCandy = calcExpPerCandy(r.srcLevel, r.nature, boostKind.value);
      const expToNextLevel = calcExp(r.srcLevel, r.srcLevel + 1, r.expType);
      const expGot = Math.max(0, expToNextLevel - r.expRemaining);

      const need: PokemonCandyNeed = {
        id: r.id,
        pokedexId,
        pokemonName: r.title,
        type: pokemonType,
        candyNeed,
        expNeed: r.result.exp,
        expPerCandy,
        candyTarget: r.candyTarget,
        srcLevel: r.srcLevel,
        dstLevel: r.dstLevel,
        expType: r.expType,
        nature: r.nature,
        expGot,
        boostCandyLimit: r.result.boostCandy,
        isReverseCalcMode: r.isReverseCalcMode,
      };

      if (r.isReverseCalcMode) {
        reverseModePokemons.push({ need, row: r });
      } else {
        needs.push(need);
      }
    }

    // やりくりモードのポケモンを allocateCandy で計算
    let baseResult: AllocationSummary | null = null;
    if (needs.length > 0) {
      const shardsCap = Math.max(0, totalShards.value);
      baseResult = allocateCandy(needs, inventory, globalBoostRemaining, boostKind.value, shardsCap);
    }

    // 逆算モードのポケモンを allocateCandyUnlimited で個別計算
    const reverseModeResults: PokemonAllocation[] = [];
    for (const { need } of reverseModePokemons) {
      // 使用制限があればそれを使用、なければ必要量全部
      const usageLimit = need.candyTarget != null && need.candyTarget > 0
        ? need.candyTarget
        : undefined;
      const result = allocateCandyUnlimited(need, inventory, boostKind.value, usageLimit);
      reverseModeResults.push(result);
    }

    // 結果をマージ
    if (!baseResult && reverseModeResults.length === 0) {
      return null;
    }

    const allPokemons = [
      ...(baseResult?.pokemons ?? []),
      ...reverseModeResults,
    ];

    // サマリーを構築
    const universalUsed = baseResult?.universalUsed ?? { s: 0, m: 0, l: 0 };
    const universalRemaining = baseResult?.universalRemaining ?? {
      s: inventory.universal.s,
      m: inventory.universal.m,
      l: inventory.universal.l
    };
    const typeCandyUsed = baseResult?.typeCandyUsed ?? {};
    const speciesCandyUsed = baseResult?.speciesCandyUsed ?? {};

    // 逆算モードの使用量を加算（在庫は消費しない前提だが、表示用に加算）
    for (const p of reverseModeResults) {
      universalUsed.s += p.uniSUsed;
      universalUsed.m += p.uniMUsed;
      universalUsed.l += p.uniLUsed;
      if (!typeCandyUsed[p.type]) {
        typeCandyUsed[p.type] = { s: 0, m: 0 };
      }
      typeCandyUsed[p.type].s += p.typeSUsed;
      typeCandyUsed[p.type].m += p.typeMUsed;
      if (p.speciesCandyUsed > 0) {
        speciesCandyUsed[String(p.pokedexId)] =
          (speciesCandyUsed[String(p.pokedexId)] ?? 0) + p.speciesCandyUsed;
      }
    }

    const shortages = allPokemons
      .filter(p => p.remaining > 0)
      .map(p => ({ id: p.id, pokemonName: p.pokemonName, shortage: p.remaining }));

    const shardsShortages = allPokemons
      .filter(p => p.shardsShortage > 0)
      .map(p => ({ id: p.id, pokemonName: p.pokemonName, shortage: p.shardsShortage }));

    const totalNeed = allPokemons.reduce((sum, p) => sum + p.candyNeed, 0);
    const totalSupplied = allPokemons.reduce((sum, p) => sum + (p.candyNeed - p.remaining), 0);

    return {
      pokemons: allPokemons,
      universalUsed,
      universalRemaining,
      typeCandyUsed,
      speciesCandyUsed,
      shortages,
      shardsShortages,
      totalNeed,
      totalSupplied,
    };
  });

  /**
   * 「目標まで」行用の計算結果
   * アロケータの allocateForTargetRow を呼び出すだけ
   */
  const targetAllocationMap = computed<Record<string, PokemonAllocation>>(() => {
    const rv = rowsView.value;
    const inventory = candyStore.getInventory();

    // needs を作成
    const needs: PokemonCandyNeed[] = [];
    for (const r of rv) {
      const pokedexId = getRowPokedexId(r);
      if (!pokedexId) continue;

      const candyNeed = Math.max(0, r.result.boostCandy + r.result.normalCandy);
      if (candyNeed <= 0) continue;

      const pokemonType = r.pokemonType || getPokemonType(pokedexId);
      const expPerCandy = calcExpPerCandy(r.srcLevel, r.nature, boostKind.value);
      const expToNextLevel = calcExp(r.srcLevel, r.srcLevel + 1, r.expType);
      const expGot = Math.max(0, expToNextLevel - r.expRemaining);

      // 個数指定を保持（アロケータで limitXXX 計算に使用）
      const candyTarget = r.candyTarget !== undefined && r.candyTarget >= 0
        ? r.candyTarget
        : undefined;

      needs.push({
        id: r.id,
        pokedexId,
        pokemonName: r.title,
        type: pokemonType,
        candyNeed,
        expNeed: r.result.exp,
        expPerCandy,
        candyTarget,  // アロケータで一時保存して処理
        srcLevel: r.srcLevel,
        dstLevel: r.dstLevel,
        expType: r.expType,
        nature: r.nature,
        expGot,
        boostCandyLimit: r.result.boostCandy,
        isReverseCalcMode: false,
      });
    }

    if (needs.length === 0) return {};

    // グローバル制限を取得
    const globalBoost = boostCandyRemaining.value ?? boostCandyDefaultCap.value;
    const shardsLimit = shardsCap.value;

    // アロケータに委譲
    return allocateForTargetRow(needs, inventory, boostKind.value, globalBoost, shardsLimit);
  });

  const universalCandyUsagePct = computed(() => {
    const inv = candyStore.universalCandy.value;
    const needed = universalCandyNeeded.value;

    const totalValue = inv.s * CANDY_VALUES.universal.s + inv.m * CANDY_VALUES.universal.m + inv.l * CANDY_VALUES.universal.l;
    const neededValue = needed.s * CANDY_VALUES.universal.s + needed.m * CANDY_VALUES.universal.m + needed.l * CANDY_VALUES.universal.l;

    if (totalValue <= 0) return 0;
    return Math.round((neededValue / totalValue) * 100);
  });

  // 万能アメ使用ランキング（使用率が高い順）
  const universalCandyRanking = computed(() => {
    if (!allocationResult.value) return [];
    const totalUniversalValue =
      allocationResult.value.universalUsed.s * CANDY_VALUES.universal.s +
      allocationResult.value.universalUsed.m * CANDY_VALUES.universal.m +
      allocationResult.value.universalUsed.l * CANDY_VALUES.universal.l;

    if (totalUniversalValue <= 0) return [];

    return allocationResult.value.pokemons
      .map(p => {
        const uniValue =
          p.uniSUsed * CANDY_VALUES.universal.s +
          p.uniMUsed * CANDY_VALUES.universal.m +
          p.uniLUsed * CANDY_VALUES.universal.l;
        const usagePct = totalUniversalValue > 0 ? (uniValue / totalUniversalValue) * 100 : 0;
        return {
          id: p.id,
          pokemonName: p.pokemonName,
          universalValue: uniValue,
          usagePct: Math.round(usagePct),
          uniSUsed: p.uniSUsed,
          uniMUsed: p.uniMUsed,
          uniLUsed: p.uniLUsed,
          typeSUsed: p.typeSUsed,
          typeMUsed: p.typeMUsed,
        };
      })
      .filter(x => x.universalValue > 0)
      .sort((a, b) => b.usagePct - a.usagePct);
  });

  // 万能アメ合計使用数
  const universalCandyUsedTotal = computed(() => {
    if (!allocationResult.value) return { s: 0, m: 0, l: 0 };
    return allocationResult.value.universalUsed;
  });

  // 万能アメの必要数（サマリー用）
  // 個数指定なし: 目標までの必要量（targetAllocationMap）
  // 個数指定あり: 個数指定に対する使用量（allocationResult）
  const universalCandyNeeded = computed(() => {
    if (!allocationResult.value) return { s: 0, m: 0, l: 0, total: 0 };

    const rv = rowsView.value;
    let totalS = 0;
    let totalM = 0;
    let totalL = 0;

    for (const row of rv) {
      const hasLimit = row.candyTarget != null && row.candyTarget >= 0;

      if (hasLimit) {
        // 個数指定あり: 実際の使用量（allocationResult）を使用
        const actualAlloc = allocationResult.value.pokemons.find(p => p.id === row.id);
        if (actualAlloc) {
          totalS += actualAlloc.uniSUsed;
          totalM += actualAlloc.uniMUsed;
          totalL += actualAlloc.uniLUsed;
        }
      } else {
        // 個数指定なし: 目標までの必要量（targetAllocationMap）を使用
        const targetAlloc = targetAllocationMap.value[row.id];
        if (targetAlloc) {
          totalS += targetAlloc.uniSUsed;
          totalM += targetAlloc.uniMUsed;
          totalL += targetAlloc.uniLUsed;
        }
      }
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

    const srcLevel = clampInt(p.srcLevel, 1, 65, 10);
    const dstLevel = clampInt(p.dstLevelDefault ?? 50, srcLevel, 65, srcLevel);
    const toNext = Math.max(0, calcExp(srcLevel, srcLevel + 1, p.expType));
    const remaining =
      p.expRemaining !== undefined && Number.isFinite(p.expRemaining) ? clampInt(p.expRemaining, 0, toNext, toNext) : toNext;

    const title =
      String(p.title ?? "").trim() ||
      (resolveTitleByBoxId ? resolveTitleByBoxId(p.boxId) ?? "" : "") ||
      "(no name)";

    const existing = rows.value.find((x) => x.boxId === p.boxId) ?? null;
    const basePatch: Partial<CalcRow> = {
      title,
      boxId: p.boxId,
      srcLevel,
      expType: p.expType,
      nature: p.nature,
      expRemaining: remaining,
      pokedexId: p.pokedexId,
      pokemonType: p.pokemonType,
    };

    if (existing) {
      updateRow(existing.id, basePatch);
      activeRowId.value = existing.id;
    } else {
      const row: CalcRow = {
        id: cryptoRandomId(),
        title,
        boxId: p.boxId,
        pokedexId: p.pokedexId,
        pokemonType: p.pokemonType,
        srcLevel,
        dstLevel,
        expRemaining: remaining,
        expType: p.expType,
        nature: p.nature,
        boostReachLevel: dstLevel,
        boostRatioPct: boostKind.value === "none" ? 0 : 100,
        boostCandyInput: 0,
        boostCandyPeak: 0,
        mode: "ratio",
      };
      rows.value = [row, ...rows.value];
      activeRowId.value = row.id;
    }

    nextTick(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!anchorEl || prevTop == null) return;
          if (!anchorEl.isConnected) return;
          const nextTop = anchorEl.getBoundingClientRect().top;
          const dy = nextTop - prevTop;
          if (Math.abs(dy) > 1) window.scrollBy(0, dy);
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
      expType: r.expType,
      expGainNature: r.nature,
    };
  }

  return {
    boostKind,
    totalShards,
    totalShardsText,
    boostCandyRemaining,
    boostCandyRemainingText,
    boostCandyDefaultCap,
    slots,
    rows,
    activeRowId,
    activeSlotTab,

    exportOpen,
    openLevelPickRowId,
    openLevelPickKind,
    dragRowId,
    dragOverRowId,

    fullLabel,
    miniLabel,
    noneLabel,
    activeRow,
    rowsView,

    exportRows,
    exportTotals,
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

    allocationResult,
    targetAllocationMap,
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

    openDstLevelPick,
    openSrcLevelPick,
    openBoostLevelPick,
    closeLevelPick,
    nudgeDstLevel,
    nudgeSrcLevel,
    nudgeBoostLevel,
    setDstLevel,
    setSrcLevel,
    setBoostLevel,

    onRowExpRemaining,
    onRowNature,
    onRowCandyTarget,
    onRowReverseCalcMode,
    onRowBoostLevel,
    onRowBoostRatio,
    onRowBoostCandy,

    moveRowUp,
    moveRowDown,
    canMoveRowUp,
    canMoveRowDown,
    onRowDragStart,
    onRowDragEnd,
    onRowDragOver,
    onRowDragLeave,
    onRowDrop,

    upsertFromBox,
    buildPlannerPatchFromRow,
  };
}
