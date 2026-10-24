import type { ExpGainNature, ExpType, PokemonBoxEntryV1 } from "../domain/types";
import { expToNextLevel, resolveIndividual } from "../domain/individual";
import { BOX_STORAGE_KEY, loadBoxData, MAX_BOX_ENTRIES, normalizeEntry, saveBox } from "./box";
import { CALC_SLOTS_STORAGE_KEY, loadActiveSlot, loadCalcSlots, saveCalcSlots, toRows, type CalcRowV1 } from "./calc";

/** 旧データの移行でボックスの個体へ書く値（`planner` の項目）。 */
export type IndividualMigrationPatch = {
  level: number;
  /** `undefined` は「次Lvまで全部」 */
  expRemaining: number | undefined;
  sleepHours: number;
  expType: ExpType;
  expGainNature: ExpGainNature;
};

type MigrationValues = {
  level: number;
  expRemaining: number;
  sleepHours: number;
  expType: ExpType;
  nature: ExpGainNature;
};

/** 値の持ち主。`time` は生データに時刻があったときだけ入る（欠けた時刻を現在時刻で埋めない）。 */
type Candidate = {
  /** 同時刻のときの優先順位。小さいほど優先（表示中スロット → ボックス → ほかのスロット） */
  rank: number;
  time: number | undefined;
  values: MigrationValues;
};

/** 保存形式が「配列そのもの」か「`key` に配列を持つオブジェクト」のどちらでも配列を取り出す。 */
function arrayOf(raw: unknown, key: string): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const value = (raw as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function rawTime(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function valuesOfRow(row: CalcRowV1): MigrationValues {
  const toNext = expToNextLevel(row.srcLevel, row.expType);
  return {
    level: row.srcLevel,
    // 0 は「次Lvまで全部」（`resolveIndividual` と同じ解釈）
    expRemaining: row.expRemaining > 0 ? Math.min(row.expRemaining, toNext) : toNext,
    sleepHours: row.sleepHours ?? 0,
    expType: row.expType,
    nature: row.nature,
  };
}

function sameValues(a: MigrationValues, b: MigrationValues): boolean {
  return a.level === b.level
    && a.expRemaining === b.expRemaining
    && a.sleepHours === b.sleepHours
    && a.expType === b.expType
    && a.nature === b.nature;
}

/**
 * 旧データ（スロットが schema 2 以下、V1〜V3 のバックアップ）の個体属性を、ボックスの個体へ移す patch を作る。
 *
 * 個体ごとに、ボックスの `updatedAt` と、その個体の行を持つ各スロットの `savedAt` を比べ、
 * 最も新しいものの値を採る（同時刻は 表示中スロット → ボックス → ほかのスロット）。
 * **時刻は正規化前の生データで判定する。** 読み込み処理は欠けた時刻を現在時刻で埋めるので、
 * 埋めた値を本物として比べると誤った側が勝つ。比べる相手のどれか1つでも時刻が無ければ時刻では比べず、
 * 表示中スロットの行の値を採り、表示中スロットに無ければボックスの値を採る。
 * `savedAt` はスロット単位（そのスロットのどの行を変えても更新される）なので、近似の判定になる。
 *
 * 対象はつながっている行（`boxId` が、存在する個体を指す行）だけ。リンク切れの行は扱わない。
 * 行は書き換えない。移行の後は通常の同期が行を揃える。
 *
 * @param rawBox ボックスの保存形式（配列、または `entries` を持つオブジェクト）
 * @param rawSlots スロットの保存形式（配列、または `slots` を持つオブジェクト）
 * @returns 値を書き換える個体の `boxId` → patch（ボックスの値が勝った個体、同じ値の個体は含めない）
 */
export function migrateLegacyIndividuals(
  rawBox: unknown,
  rawSlots: unknown,
  activeSlot: number,
): Map<string, IndividualMigrationPatch> {
  const patches = new Map<string, IndividualMigrationPatch>();

  const boxes = new Map<string, { time: number | undefined; values: MigrationValues }>();
  for (const raw of arrayOf(rawBox, "entries").slice(0, MAX_BOX_ENTRIES)) {
    if (raw == null || typeof raw !== "object") continue;
    const entry = normalizeEntry(raw as Record<string, unknown>);
    const individual = resolveIndividual(entry);
    boxes.set(entry.id, {
      time: rawTime((raw as Record<string, unknown>).updatedAt),
      values: {
        level: individual.level,
        expRemaining: individual.expRemaining,
        sleepHours: individual.sleepHours,
        expType: individual.expType,
        nature: individual.nature,
      },
    });
  }

  const slotCandidates = new Map<string, Candidate[]>();
  arrayOf(rawSlots, "slots").slice(0, 3).forEach((raw, slotIndex) => {
    if (raw == null || typeof raw !== "object") return;
    const slot = raw as Record<string, unknown>;
    const time = rawTime(slot.savedAt);
    const seen = new Set<string>();
    for (const row of toRows(slot.rows, 2)) {
      // リンク切れの行と、同じスロットの2行目以降の重複は扱わない
      if (!row.boxId || !boxes.has(row.boxId) || seen.has(row.boxId)) continue;
      seen.add(row.boxId);
      const list = slotCandidates.get(row.boxId) ?? [];
      list.push({ rank: slotIndex === activeSlot ? 0 : 2 + slotIndex, time, values: valuesOfRow(row) });
      slotCandidates.set(row.boxId, list);
    }
  });

  for (const [boxId, slotsOfBox] of slotCandidates) {
    const box = boxes.get(boxId)!;
    const candidates: Candidate[] = [...slotsOfBox, { rank: 1, time: box.time, values: box.values }];
    candidates.sort((a, b) => a.rank - b.rank);
    let winner: Candidate;
    if (candidates.every((c) => c.time !== undefined)) {
      // 並べ替えは安定なので、同時刻なら rank が小さい方が先に残る
      winner = candidates.reduce((best, c) => (c.time! > best.time! ? c : best));
    } else {
      winner = candidates[0].rank === 0 ? candidates[0] : candidates.find((c) => c.rank === 1)!;
    }
    if (winner.rank === 1 || sameValues(winner.values, box.values)) continue;
    const v = winner.values;
    patches.set(boxId, {
      level: v.level,
      expRemaining: v.expRemaining >= expToNextLevel(v.level, v.expType) ? undefined : v.expRemaining,
      sleepHours: v.sleepHours,
      expType: v.expType,
      expGainNature: v.nature,
    });
  }
  return patches;
}

/** patch をボックスの個体の `planner` へ書き、書いた個体の `updatedAt` を `now` にする。ほかの個体は同じ参照で返す。 */
export function applyIndividualMigration<T extends { id: string; planner?: PokemonBoxEntryV1["planner"]; updatedAt: string }>(
  entries: readonly T[],
  patches: ReadonlyMap<string, IndividualMigrationPatch>,
  now: Date,
): T[] {
  return entries.map((entry) => {
    const patch = patches.get(entry.id);
    if (!patch) return entry;
    return { ...entry, planner: { ...entry.planner, ...patch }, updatedAt: now.toISOString() };
  });
}

function readJson(key: string): unknown {
  const text = localStorage.getItem(key);
  if (text == null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // 壊れた保存データは、読み込み処理が空として扱い、次の保存で上書きされる
    return undefined;
  }
}

/**
 * 起動時の移行。スロットの保存データが schema 2 以下のときだけ、ボックスの個体へ値を移し、スロットを schema 3 で保存し直す。
 * ストアが保存データを読むより前に呼ぶ（行の同期より前にボックスへ適用しないと、旧データの行がボックスの値で上書きされる）。
 * 履歴には積まない。schema 3 になるので、2回目以降は何もしない。
 */
export function migrateStoredIndividuals(now = new Date()): void {
  const rawSlots = readJson(CALC_SLOTS_STORAGE_KEY);
  if (rawSlots === undefined) return;
  const schemaVersion = rawSlots && typeof rawSlots === "object" && !Array.isArray(rawSlots)
    ? (rawSlots as Record<string, unknown>).schemaVersion
    : undefined;
  if (typeof schemaVersion === "number" && schemaVersion >= 3) return;

  const patches = migrateLegacyIndividuals(readJson(BOX_STORAGE_KEY), rawSlots, loadActiveSlot());
  if (patches.size > 0) {
    const box = loadBoxData();
    saveBox(applyIndividualMigration(box.entries, patches, now), box.tags);
  }
  // 版を上げて、移行を一度きりにする（上げないと、裏スロットの古い値が何度でもボックスを上書きする）
  saveCalcSlots(loadCalcSlots());
}
