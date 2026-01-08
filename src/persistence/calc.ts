import type { BoostEvent, ExpGainNature, ExpType } from "../domain/types";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";

export type CalcMode = "boostLevel" | "ratio" | "candy";

export type CalcRowV1 = {
  id: string;
  /** 元のボックスID（ボックス由来の場合のみ） */
  boxId?: string;
  /** ポケモン図鑑ID（アメ管理用） */
  pokedexId?: number;
  /** ポケモンタイプ（タイプアメ用、英語名） */
  pokemonType?: string;
  /** 表示名 */
  title: string;
  srcLevel: number;
  dstLevel: number;
  /** 目標Lvの入力中テキスト（datalist表示用。確定はblurでdstLevelへ反映） */
  dstLevelText?: string;
  expRemaining: number; // ゲーム画面の「あとEXP（次Lvまで）」
  expType: ExpType;
  nature: ExpGainNature;
  boostReachLevel: number;
  boostRatioPct: number; // 0..100（派生値、表示用）
  /** 入力されたアメブ個数（またはEXP調整値）- 真実のソース */
  boostOrExpAdjustment?: number;
  /** ピーク値（100%時のアメブ個数）- 入力がピークを超えたら更新 */
  candyPeak?: number;
  /** アメ個数指定（未設定=無制限、1以上=目標個数） */
  candyTarget?: number;
  mode: CalcMode;
};

export type CalcAutosaveV1 = {
  schemaVersion: 1;
  totalShards: number;
  boostKind: BoostEvent;
  /** アメブ残数（未設定の場合はboostKindによる上限を使用） */
  boostCandyRemaining?: number;
  rows: CalcRowV1[];
  activeRowId: string | null;
};

export type CalcSaveSlotV1 = {
  savedAt: string;
  rows: CalcRowV1[];
  activeRowId: string | null;
  /** スロット保存時の boostKind（スロット切り替え時に再計算が必要かどうか判定用） */
  boostKind?: BoostEvent;
};


type CalcSlotsStoreV1 = {
  schemaVersion: 1;
  slots: Array<CalcSaveSlotV1 | null>;
};

const AUTOSAVE_KEY = "candy-boost-planner:calc:autosave:v1";
const SLOTS_KEY = "candy-boost-planner:calc:slots:v1";
const LEGACY_TOTAL_SHARDS_KEY = "candy-boost-planner:calc:totalShards";

export function loadCalcAutosave(): CalcAutosaveV1 | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const json = JSON.parse(raw);
    if (!json || typeof json !== "object") return null;
    return normalizeAutosave(json);
  } catch {
    return null;
  }
}

export function saveCalcAutosave(v: CalcAutosaveV1) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(v));
  } catch {
    // localStorage can throw (quota exceeded / blocked). Persistence must not break UI.
  }
}

export function loadCalcSlots(): Array<CalcSaveSlotV1 | null> {
  try {
    const raw = localStorage.getItem(SLOTS_KEY);
    if (!raw) return [null, null, null];
    const json = JSON.parse(raw);
    const arr = Array.isArray(json)
      ? json
      : json && typeof json === "object" && Array.isArray((json as any).slots)
        ? (json as any).slots
        : null;
    if (!arr) return [null, null, null];
    const out: Array<CalcSaveSlotV1 | null> = [];
    for (let i = 0; i < 3; i++) {
      out.push(normalizeSlot(arr[i] ?? null));
    }
    return out;
  } catch {
    return [null, null, null];
  }
}

export function saveCalcSlots(v: Array<CalcSaveSlotV1 | null>) {
  const a = Array.isArray(v) ? v.slice(0, 3) : [];
  while (a.length < 3) a.push(null);
  const store: CalcSlotsStoreV1 = { schemaVersion: 1, slots: a };
  try {
    localStorage.setItem(SLOTS_KEY, JSON.stringify(store));
  } catch {
    // localStorage can throw (quota exceeded / blocked). Persistence must not break UI.
  }
}

export function loadLegacyTotalShards(): number {
  try {
    const raw = localStorage.getItem(LEGACY_TOTAL_SHARDS_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  } catch {
    return 0;
  }
}

export function saveTotalShards(v: number): void {
  try {
    localStorage.setItem(LEGACY_TOTAL_SHARDS_KEY, String(Math.max(0, Math.floor(v))));
  } catch {
    // localStorage can throw (quota exceeded / blocked). Persistence must not break UI.
  }
}

const BOOST_CANDY_REMAINING_KEY = "candy-boost-planner:calc:boostCandyRemaining";

export function loadBoostCandyRemaining(): number | null {
  try {
    const raw = localStorage.getItem(BOOST_CANDY_REMAINING_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

export function saveBoostCandyRemaining(v: number | null): void {
  try {
    if (v == null) {
      localStorage.removeItem(BOOST_CANDY_REMAINING_KEY);
    } else {
      localStorage.setItem(BOOST_CANDY_REMAINING_KEY, String(Math.max(0, Math.floor(v))));
    }
  } catch {
    // localStorage can throw (quota exceeded / blocked). Persistence must not break UI.
  }
}

function normalizeAutosave(x: any): CalcAutosaveV1 {
  const totalShards = toInt(x.totalShards, 0);
  const boostKind: Exclude<BoostEvent, "none"> = x.boostKind === "mini" ? "mini" : "full";
  const boostCandyRemaining = typeof x.boostCandyRemaining === "number" && x.boostCandyRemaining >= 0
    ? Math.floor(x.boostCandyRemaining)
    : undefined;
  const rows = toRows(x.rows);
  const activeRowId = typeof x.activeRowId === "string" ? x.activeRowId : null;
  // legacy compatibility: previous versions used `version`
  return { schemaVersion: 1, totalShards, boostKind, boostCandyRemaining, rows, activeRowId };
}

function normalizeSlot(x: any): CalcSaveSlotV1 | null {
  if (!x || typeof x !== "object") return null;
  const savedAt = typeof x.savedAt === "string" ? x.savedAt : new Date().toISOString();
  const rows = toRows(x.rows);
  const activeRowId = typeof x.activeRowId === "string" ? x.activeRowId : null;
  // boostKind: スロット保存時の値（undefined = 旧データで未保存）
  const boostKind = x.boostKind === "full" || x.boostKind === "mini" || x.boostKind === "none"
    ? x.boostKind as BoostEvent
    : undefined;
  if (!rows.length) return null;
  return { savedAt, rows, activeRowId, boostKind };
}


function toRows(v: unknown): CalcRowV1[] {
  if (!Array.isArray(v)) return [];
  const out: CalcRowV1[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const o: any = x;
    const id = String(o.id ?? "").trim();
    if (!id) continue;
    const title = typeof o.title === "string" ? o.title : "";
    const expType = toExpType(o.expType, 600);
    const srcLevel = clampInt(o.srcLevel, 1, MAX_LEVEL, 1);
    const dstLevel = clampInt(o.dstLevel, srcLevel, MAX_LEVEL, srcLevel);
    const toNextFallback = 0; // App側で補正する
    const expRemaining = clampInt(o.expRemaining, 0, 999999, toNextFallback);
    const nature = toNature(o.nature, "normal");
    const boostReachLevel = clampInt(o.boostReachLevel, srcLevel, dstLevel, dstLevel);
    const boostRatioPct = clampInt(o.boostRatioPct, 0, 100, 100);
    const mode: CalcMode = o.mode === "boostLevel" || o.mode === "candy" || o.mode === "ratio" ? o.mode : "ratio";
    const boxId = typeof o.boxId === "string" && o.boxId.trim() ? o.boxId : undefined;
    const dstLevelText = typeof o.dstLevelText === "string" ? o.dstLevelText : undefined;
    const pokedexId = typeof o.pokedexId === "number" && o.pokedexId > 0 ? o.pokedexId : undefined;
    const pokemonType = typeof o.pokemonType === "string" && o.pokemonType.trim() ? o.pokemonType : undefined;
    // boostOrExpAdjustment: 入力されたアメブ個数（真実のソース）
    const boostOrExpAdjustment = typeof o.boostOrExpAdjustment === "number" ? Math.max(0, Math.floor(o.boostOrExpAdjustment)) : undefined;
    // candyPeak: ピーク値
    const candyPeak = typeof o.candyPeak === "number" ? Math.max(0, Math.floor(o.candyPeak)) : undefined;
    // candyTarget: undefined = 無制限、1以上 = 目標個数
    const candyTarget = typeof o.candyTarget === "number" && o.candyTarget >= 0 ? Math.floor(o.candyTarget) : undefined;
    out.push({
      id,
      boxId,
      pokedexId,
      pokemonType,
      title,
      srcLevel,
      dstLevel,
      dstLevelText,
      expRemaining,
      expType,
      nature,
      boostReachLevel,
      boostRatioPct,
      boostOrExpAdjustment,
      candyPeak,
      candyTarget,
      mode,
    });
  }
  return out.slice(0, 60);
}

function toInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = toInt(v, fallback);
  return Math.max(min, Math.min(max, n));
}

function toExpType(v: unknown, fallback: ExpType): ExpType {
  const n = toInt(v, fallback);
  if (n === 600 || n === 900 || n === 1080 || n === 1320) return n;
  return fallback;
}

function toNature(v: unknown, fallback: ExpGainNature): ExpGainNature {
  const s = typeof v === "string" ? v : String(v ?? "");
  if (s === "up" || s === "down" || s === "normal") return s;
  return fallback;
}
