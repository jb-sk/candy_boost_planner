import type { BoostEvent, ExpGainNature, ExpType, SleepSettings } from "../domain/types";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";
import { defaultBoostKind } from "../domain/pokesleep/boost-config";
import type { ItemCompareMode } from "../domain/level-planner/types";
import { toExpGainNature, toExpType, toInt } from "./shared";
import { perfSpan } from "../utils/perf";

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
  /** 入力されたアメブ個数 - 真実のソース */
  boostOrExpAdjustment?: number;
  /**
   * アメ個数指定（総アメ数）。
   * undefined = 個数指定なし（目標Lvが anchor）、値あり = 個数指定が anchor（設計書§4.3）。
   */
  candyTarget?: number;
  /** 累計睡眠時間（時間単位、ポケモンごと） */
  sleepHours?: number;
  /** 睡眠目標時間（時間単位）。未設定=睡眠を考慮しない。SLEEP_TARGET_HOURS_OPTIONS のいずれかのみ許可。 */
  sleepTargetHours?: number;
};

/** 睡眠目標時間ドロップダウンの選択肢（アチーブメント区切りに対応。任意値は設けない）。 */
export const SLEEP_TARGET_HOURS_OPTIONS = [200, 500, 1000, 2000] as const;

export type CalcSaveSlotV1 = {
  /** スロット位置とは独立したセッション/保存データ上の安定ID。 */
  slotId?: string;
  savedAt: string;
  rows: CalcRowV1[];
  activeRowId: string | null;
  /** スロットのアメブ種別 */
  boostKind: BoostEvent;
  /** スロットのアメブ上限（ユーザー入力値、未設定=デフォルト値を使用） */
  boostCandyRemaining?: number | null;
  /** 既定は surplusFirst（余り最小）。 */
  itemCompareMode?: ItemCompareMode;
};


type CalcSlotsStoreV1 = {
  schemaVersion: 1;
  slots: Array<CalcSaveSlotV1 | null>;
};

export const CALC_SLOTS_STORAGE_KEY = "candy-boost-planner:calc:slots:v1";
export const TOTAL_SHARDS_KEY = "candy-boost-planner:calc:totalShards";
export const ACTIVE_SLOT_STORAGE_KEY = "candy-boost-planner:calc:activeSlot";
export const BOOST_CANDY_REMAINING_KEY = "candy-boost-planner:calc:boostCandyRemaining";
export const SLEEP_SETTINGS_KEY = "candy-boost-planner:calc:sleepSettings";

export function loadCalcSlots(): Array<CalcSaveSlotV1 | null> {
  try {
    const raw = localStorage.getItem(CALC_SLOTS_STORAGE_KEY);
    if (!raw) return [null, null, null];
    const json = JSON.parse(raw);
    const arr: unknown[] | null = Array.isArray(json)
      ? json
      : json && typeof json === "object" && Array.isArray((json as Record<string, unknown>).slots)
        ? (json as Record<string, unknown>).slots as unknown[]
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
  try {
    const serialized = perfSpan("persist.calc.serialize", () => serializeCalcSlots(v));
    perfSpan("persist.calc.write", () => localStorage.setItem(CALC_SLOTS_STORAGE_KEY, serialized));
  } catch {
    // localStorage can throw (quota exceeded / blocked). Persistence must not break UI.
  }
}

export function serializeCalcSlots(v: Array<CalcSaveSlotV1 | null>): string {
  const a = Array.isArray(v) ? v.slice(0, 3) : [];
  while (a.length < 3) a.push(null);
  const store: CalcSlotsStoreV1 = { schemaVersion: 1, slots: a };
  return JSON.stringify(store);
}

export function loadActiveSlot(): 0 | 1 | 2 {
  try {
    const value = Number(localStorage.getItem(ACTIVE_SLOT_STORAGE_KEY));
    return value === 1 || value === 2 ? value : 0;
  } catch {
    return 0;
  }
}

export function saveActiveSlot(value: number): void {
  try {
    localStorage.setItem(ACTIVE_SLOT_STORAGE_KEY, String(value === 1 || value === 2 ? value : 0));
  } catch {
    // localStorage can throw (quota exceeded / blocked). Persistence must not break UI.
  }
}

export function loadTotalShards(): number {
  try {
    const raw = localStorage.getItem(TOTAL_SHARDS_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  } catch {
    return 0;
  }
}

export function saveTotalShards(v: number): void {
  try {
    localStorage.setItem(TOTAL_SHARDS_KEY, String(Math.max(0, Math.floor(v))));
  } catch {
    // localStorage can throw (quota exceeded / blocked). Persistence must not break UI.
  }
}

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

/** デフォルトの睡眠設定 */
export const DEFAULT_SLEEP_SETTINGS: SleepSettings = {
  dailySleepHours: 8.5,
  sleepExpBonusCount: 0,
  includeGSD: true,
};

export function loadSleepSettings(): SleepSettings {
  try {
    const raw = localStorage.getItem(SLEEP_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SLEEP_SETTINGS };
    const json = JSON.parse(raw);
    const normalized = normalizeSleepSettings(json);
    return normalized ?? { ...DEFAULT_SLEEP_SETTINGS };
  } catch {
    return { ...DEFAULT_SLEEP_SETTINGS };
  }
}

export function saveSleepSettings(v: SleepSettings | undefined): void {
  try {
    if (v == null) {
      localStorage.removeItem(SLEEP_SETTINGS_KEY);
    } else {
      localStorage.setItem(SLEEP_SETTINGS_KEY, JSON.stringify(v));
    }
  } catch {
    // localStorage can throw (quota exceeded / blocked). Persistence must not break UI.
  }
}


function normalizeSlot(x: unknown): CalcSaveSlotV1 | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  const savedAt = typeof r.savedAt === "string" ? r.savedAt : new Date().toISOString();
  const slotId = typeof r.slotId === "string" && r.slotId.trim() ? r.slotId : undefined;
  const rows = toRows(r.rows);
  const activeRowId = typeof r.activeRowId === "string" && rows.some((row) => row.id === r.activeRowId)
    ? r.activeRowId
    : null;
  // boostKind: 旧データは defaultBoostKind を適用
  const boostKind: BoostEvent = r.boostKind === "full" || r.boostKind === "mini" || r.boostKind === "none"
    ? r.boostKind
    : defaultBoostKind;
  // boostCandyRemaining: 未設定の場合は undefined（UI側でデフォルト値を適用）
  const boostCandyRemaining = typeof r.boostCandyRemaining === "number" && r.boostCandyRemaining >= 0
    ? Math.floor(r.boostCandyRemaining)
    : undefined;
  const itemCompareMode = normalizeItemCompareMode(r.itemCompareMode);
  const hasSlotSettings =
    slotId !== undefined
    || r.boostKind === "full"
    || r.boostKind === "mini"
    || r.boostKind === "none"
    || boostCandyRemaining !== undefined
    || r.itemCompareMode !== undefined;
  if (!rows.length && !hasSlotSettings) return null;
  return { slotId, savedAt, rows, activeRowId, boostKind, boostCandyRemaining, itemCompareMode };
}

function normalizeItemCompareMode(value: unknown): ItemCompareMode {
  if (value === "legacyImproved") return "legacyImproved";
  if (value === "surplusGateFirst") return "surplusGateFirst";
  if (value === "surplusFirst") return "surplusFirst";
  // 未設定や不明値は現行デフォルトへ倒す。
  return "surplusFirst";
}


function toRows(v: unknown): CalcRowV1[] {
  if (!Array.isArray(v)) return [];
  const out: CalcRowV1[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    if (!id) continue;
    const title = typeof o.title === "string" ? o.title : "";
    const expType = toExpType(o.expType, 600);
    const srcLevel = clampInt(o.srcLevel, 1, MAX_LEVEL, 1);
    const dstLevel = clampInt(o.dstLevel, srcLevel, MAX_LEVEL, srcLevel);
    // expRemaining: 0 は論理矛盾（次Lvまで0 = 既にレベルアップ済み）なので
    // 0 は保存データ上もそのまま読み込み、calcRowExpGot 側で toNext に補正する。
    // ただし undefined / null / NaN は安全なフォールバックとして 0 を設定（calcRowExpGot が toNext に補正）。
    const expRemaining = clampInt(o.expRemaining, 0, 999999, 0);
    const nature = toExpGainNature(o.nature, "normal");
    const boostReachLevel = clampInt(o.boostReachLevel, srcLevel, dstLevel, dstLevel);
    const boxId = typeof o.boxId === "string" && o.boxId.trim() ? o.boxId : undefined;
    const dstLevelText = typeof o.dstLevelText === "string" ? o.dstLevelText : undefined;
    const pokedexId = typeof o.pokedexId === "number" && o.pokedexId > 0 ? o.pokedexId : undefined;
    const pokemonType = typeof o.pokemonType === "string" && o.pokemonType.trim() ? o.pokemonType : undefined;
    // boostOrExpAdjustment: 入力されたアメブ個数（真実のソース）
    const boostOrExpAdjustment = typeof o.boostOrExpAdjustment === "number" ? Math.max(0, Math.floor(o.boostOrExpAdjustment)) : undefined;
    // candyTarget: undefined = 個数指定なし（目標Lvが anchor）、0以上 = 個数指定あり
    const storedCandyTarget = typeof o.candyTarget === "number" && o.candyTarget >= 0 ? Math.floor(o.candyTarget) : undefined;
    const candyTarget = storedCandyTarget ?? migrateLegacyPeakCandyTarget(o);
    // sleepHours: 累計睡眠時間（後方互換: 未設定 = undefined = 0h扱い）
    const sleepHours =
      typeof o.sleepHours === "number" && Number.isFinite(o.sleepHours)
        ? Math.max(0, Math.floor(o.sleepHours))
        : undefined;
    // sleepTargetHours: 睡眠目標時間。ドロップダウンの選択肢のみ許可（任意値は保存データが壊れていても無視する）
    const sleepTargetHours =
      typeof o.sleepTargetHours === "number" && (SLEEP_TARGET_HOURS_OPTIONS as readonly number[]).includes(o.sleepTargetHours)
        ? o.sleepTargetHours
        : undefined;
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
      boostOrExpAdjustment,
      candyTarget,
      sleepHours,
      sleepTargetHours,
    });
  }
  return out.slice(0, 60);
}

/**
 * 旧 mode:"peak" 行の移行（設計書§6.1）。
 *
 * peak はアメ個数側が目標を規定していた状態なので、入力された総アメ数を candyTarget として引き継ぐ。
 * undefined にすると、ユーザーが入力した総アメ数と目標Lv内EXPを失う。
 * 旧フィールド（mode / candyPeak / boostRatioPct）はここでの移行にだけ使い、保存形式からは落とす。
 */
export function migrateLegacyPeakCandyTarget(o: Record<string, unknown>): number | undefined {
  if (o.mode !== "peak") return undefined;
  const adjustment = typeof o.boostOrExpAdjustment === "number" ? Math.max(0, Math.floor(o.boostOrExpAdjustment)) : undefined;
  if (adjustment !== undefined) return adjustment;
  return typeof o.candyPeak === "number" ? Math.max(0, Math.floor(o.candyPeak)) : undefined;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = toInt(v, fallback);
  return Math.max(min, Math.min(max, n));
}

/**
 * SleepSettings のノーマライズ
 * 未設定の場合は undefined を返す（デフォルト値はUI側で適用）
 */
function normalizeSleepSettings(x: unknown): SleepSettings | undefined {
  if (!x || typeof x !== "object") return undefined;
  const o = x as Record<string, unknown>;

  // 必須フィールドがすべて有効な場合のみ返す
  const dailySleepHours = typeof o.dailySleepHours === "number" && o.dailySleepHours >= 1 && o.dailySleepHours <= 13
    ? o.dailySleepHours
    : undefined;
  const sleepExpBonusCount = typeof o.sleepExpBonusCount === "number" && o.sleepExpBonusCount >= 0 && o.sleepExpBonusCount <= 5
    ? Math.floor(o.sleepExpBonusCount)
    : undefined;
  const includeGSD = typeof o.includeGSD === "boolean"
    ? o.includeGSD
    : undefined;

  // すべて undefined なら設定なしとして undefined を返す
  if (dailySleepHours === undefined && sleepExpBonusCount === undefined && includeGSD === undefined) {
    return undefined;
  }

  // 部分的に設定されている場合はデフォルト値で補完
  return {
    dailySleepHours: dailySleepHours ?? 8.5,
    sleepExpBonusCount: sleepExpBonusCount ?? 0,
    includeGSD: includeGSD ?? true,
  };
}
