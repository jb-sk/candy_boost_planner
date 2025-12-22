import { computed, nextTick, ref, toRaw, watch, type Ref } from "vue";
import type { Composer } from "vue-i18n";
import type { BoostEvent, ExpGainNature, ExpType } from "../domain/types";
import { calcExp, calcExpAndCandy, calcExpAndCandyByBoostExpRatio, calcExpAndCandyMixed, calcLevelByCandy } from "../domain/pokesleep";
import { boostRules } from "../domain/pokesleep/boost-config";
import type { CalcRowV1, CalcSaveSlotV1 } from "../persistence/calc";
import { loadCalcAutosave, loadCalcSlots, loadLegacyTotalShards, saveCalcAutosave, saveCalcSlots } from "../persistence/calc";
import { cryptoRandomId } from "../persistence/box";

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
};

export type CalcExportTotals = { boostCandy: number; normalCandy: number; totalCandy: number; shards: number };

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
  boostKind: Ref<Exclude<BoostEvent, "none">>;
  totalShards: Ref<number>;
  totalShardsText: Ref<string>;
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

  canUndo: Readonly<Ref<boolean>>;
  canRedo: Readonly<Ref<boolean>>;

  // helpers / formatting
  fmtNum: (n: number) => string;
  formatSlotSavedAt: (iso: string | undefined | null) => string;

  // actions
  onTotalShardsInput: (v: string) => void;
  openExport: () => void;
  closeExport: () => void;

  beginUndo: () => void;
  undo: () => void;
  redo: () => void;

  clear: () => void;
  removeRowById: (id: string) => void;

  onSlotSave: (slotIndex: number) => void;
  onSlotLoad: (slotIndex: number) => void;
  onSlotDelete: (slotIndex: number) => void;

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
}): CalcStore {
  const { locale, t, resolveTitleByBoxId } = opts;

  function fmtNum(n: number): string {
    return new Intl.NumberFormat(locale.value as any).format(n);
  }

  const calcAutosave0 = loadCalcAutosave();
  const slots = ref<Array<CalcSaveSlotV1 | null>>(loadCalcSlots());

  const boostKind = ref<Exclude<BoostEvent, "none">>(calcAutosave0?.boostKind ?? "full");
  const totalShards = ref<number>(calcAutosave0?.totalShards ?? loadLegacyTotalShards());
  const totalShardsText = ref<string>("");

  const rows = ref<CalcRow[]>(calcAutosave0?.rows ?? []);
  const activeRowId = ref<string | null>(calcAutosave0?.activeRowId ?? rows.value[0]?.id ?? null);
  const activeSlotTab = ref(0);

  function clampNonNegInt(n: unknown): number {
    return Math.max(0, Math.floor(Number(n) || 0));
  }

  function onTotalShardsInput(v: string) {
    const digits = String(v ?? "").replace(/[^\d]/g, "");
    const n = clampNonNegInt(digits);
    totalShards.value = n;
    totalShardsText.value = fmtNum(n);
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

  function cloneCalcRows(entries: CalcRow[]): CalcRow[] {
    const raw = toRaw(entries) as any;
    return JSON.parse(JSON.stringify(raw));
  }
  function cloneCalcSlots(v: Array<CalcSaveSlotV1 | null>): Array<CalcSaveSlotV1 | null> {
    const raw = toRaw(v) as any;
    return JSON.parse(JSON.stringify(raw));
  }

  function saveCalcAutosaveNow() {
    saveCalcAutosave({
      schemaVersion: 1,
      totalShards: clampNonNegInt(totalShards.value),
      boostKind: boostKind.value,
      rows: cloneCalcRows(rows.value),
      activeRowId: activeRowId.value,
    });
  }

  watch([rows, activeRowId, boostKind, totalShards], () => saveCalcAutosaveNow(), { deep: true });
  watch(slots, (v) => saveCalcSlots(v), { deep: true });

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

  const undoState = ref<CalcUndoState | null>(null);
  const redoState = ref<CalcUndoState | null>(null);
  const canUndo = computed(() => !!undoState.value);
  const canRedo = computed(() => !!redoState.value);

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
    undoState.value = snapshotUndoState();
    redoState.value = null;
  }
  function undo() {
    const s = undoState.value;
    if (!s) return;
    redoState.value = snapshotUndoState();
    restoreUndoState(s);
    undoState.value = null;
  }
  function redo() {
    const s = redoState.value;
    if (!s) return;
    undoState.value = snapshotUndoState();
    restoreUndoState(s);
    redoState.value = null;
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

  function onSlotSave(slotIndex: number) {
    if (!rows.value.length) return;
    const i = Math.max(0, Math.min(2, Math.floor(Number(slotIndex) || 0)));
    beginUndo();
    const now = new Date().toISOString();
    const slot: CalcSaveSlotV1 = { savedAt: now, rows: cloneCalcRows(rows.value), activeRowId: activeRowId.value };
    slots.value = slots.value.map((x, idx) => (idx === i ? slot : x));
  }
  function onSlotLoad(slotIndex: number) {
    const i = Math.max(0, Math.min(2, Math.floor(Number(slotIndex) || 0)));
    const slot = slots.value[i];
    if (!slot) return;
    beginUndo();
    rows.value = cloneCalcRows(slot.rows);
    activeRowId.value = slot.activeRowId ?? rows.value[0]?.id ?? null;
    openLevelPickRowId.value = null;
  }
  function onSlotDelete(slotIndex: number) {
    const i = Math.max(0, Math.min(2, Math.floor(Number(slotIndex) || 0)));
    if (!slots.value[i]) return;
    beginUndo();
    slots.value = slots.value.map((x, idx) => (idx === i ? null : x));
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
    updateRow(id, { dstLevel: dst });
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
    updateRow(id, { srcLevel: src, dstLevel: dst, expRemaining: toNext, boostReachLevel: nextBoostReach });
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
    updateRow(id, { boostReachLevel: mid, mode: "boostLevel" });
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
    const n = Math.max(0, Math.floor(Number(v) || 0));
    updateRow(id, { boostCandyInput: n, mode: "candy" });
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

  function calcRowMixedByBoostLevel(r: CalcRow, expGot: number) {
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

    const boostOnlyNeed = calcExpAndCandy({
      srcLevel: src,
      dstLevel: mid,
      expType: r.expType,
      nature: r.nature,
      boost: boostKind.value,
      expGot,
    });

    const boostSeg = calcExpAndCandyMixed({
      srcLevel: src,
      dstLevel: mid,
      expType: r.expType,
      nature: r.nature,
      boost: boostKind.value,
      boostCandy: boostOnlyNeed.candy,
      expGot,
    });

    const atMid = calcLevelByCandy({
      srcLevel: src,
      dstLevel: mid,
      expType: r.expType,
      nature: r.nature,
      boost: boostKind.value,
      candy: boostOnlyNeed.candy,
      expGot,
    });

    const normalSeg = calcExpAndCandyMixed({
      srcLevel: mid,
      dstLevel: dst,
      expType: r.expType,
      nature: r.nature,
      boost: "none",
      boostCandy: 0,
      expGot: atMid.expGot,
    });

    return {
      exp: boostSeg.exp + normalSeg.exp,
      expNormalApplied: normalSeg.expNormalApplied,
      expBoostApplied: boostSeg.expBoostApplied,
      normalCandy: normalSeg.normalCandy,
      boostCandy: boostSeg.boostCandy,
      shards: boostSeg.shardsBoost + normalSeg.shardsNormal,
      shardsNormal: normalSeg.shardsNormal,
      shardsBoost: boostSeg.shardsBoost,
      boostCandyLeft: 0,
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
      boost: boostKind.value,
      expGot,
      boostExpRatio: clampInt(r.boostRatioPct, 0, 100, 100) / 100,
    });

    const byCandy = calcExpAndCandyMixed({
      srcLevel: src,
      dstLevel: dst,
      expType: expT,
      nature: nat,
      boost: boostKind.value,
      boostCandy: Math.max(0, Math.floor(Number(r.boostCandyInput) || 0)),
      expGot,
    });

    const byBoostLevel = calcRowMixedByBoostLevel({ ...r, srcLevel: src, dstLevel: dst, expType: expT, nature: nat }, expGot);

    const mixed = r.mode === "boostLevel" ? byBoostLevel : r.mode === "ratio" ? byRatio : byCandy;

    const uiCandy =
      r.mode === "ratio"
        ? byRatio.boostCandy
        : r.mode === "boostLevel"
          ? byBoostLevel.boostCandy
          : Math.max(0, Math.floor(Number(r.boostCandyInput) || 0));

    const base = requiredExp.exp;
    const uiRatioPct =
      r.mode === "ratio"
        ? clampInt(r.boostRatioPct, 0, 100, 0)
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
      const boostCandy = Math.max(0, Math.floor(r.result.boostCandy || 0));
      const normalCandy = Math.max(0, Math.floor(r.result.normalCandy || 0));
      const shards = Math.max(0, Math.floor(r.result.shards || 0));
      return {
        id: r.id,
        title: String(r.title ?? "").trim() || "(no name)",
        natureLabel: natureLabel(r.nature),
        srcLevel: r.srcLevel,
        dstLevel: r.dstLevel,
        boostCandy,
        normalCandy,
        totalCandy: boostCandy + normalCandy,
        shards,
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

  const totalShardsUsed = computed(() => rowsView.value.reduce((a, r) => a + (r.result.shards || 0), 0));
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

  const totalBoostCandyUsed = computed(() => rowsView.value.reduce((a, r) => a + (r.result.boostCandy || 0), 0));
  const boostCandyCap = computed(() => (boostKind.value === "mini" ? 350 : 3500));
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
        boostRatioPct: 100,
        boostCandyInput: 0,
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

    canUndo,
    canRedo,

    fmtNum,
    formatSlotSavedAt,

    onTotalShardsInput,
    openExport,
    closeExport,

    beginUndo,
    undo,
    redo,

    clear,
    removeRowById,

    onSlotSave,
    onSlotLoad,
    onSlotDelete,

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
