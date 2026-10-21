/**
 * やりくりモーダルの表示用データ（設計書 §4.3、§4.4）。画面が上限・状態の計算をしなくて済むよう、
 * 行ごとの「基準 → 変更後」の値と、操作の可否をここで出す。ストア・Vue を値で import しない。
 * 範囲・可否の判定は `draft.ts` の関数を呼ぶだけで、ここでは計算し直さない。
 */
import type { CalcRow, EvaluatedRows } from "../../composables/useCalcStore";
import type { ExpGainNature } from "../types";
import type { LevelPlannerResult, PokemonPlanLine, PokemonPlanResult } from "../level-planner/types";
import { calcExp } from "../pokesleep/exp";
import { maxLevel as MAX_LEVEL } from "../pokesleep/tables";
import { sleepTargetTraits } from "../sleep-target";
import type { Diagnosis, RowAdviceEntry } from "./advice";
import {
  boostSlotRemaining,
  canAdjustInMode1,
  canReceive,
  isGiverControlShown,
  opRange,
  rowExclusion,
  type FineTuneBase,
  type FineTuneLatest,
  type FineTuneState,
  type OpRange,
  type RowExclusion,
} from "./draft";

/** 基準 → 変更後の組。結果がまだ無いときは null。 */
export interface Change<T> {
  base: T;
  value: T;
}

export interface FineTuneBars {
  /** モード1: 到達Lvの次のLvまでのEXPを 100% にした、到達Lv内EXP（%）。 */
  raise: Change<number | null>;
  /** モード2: 現在Lv→基準の目標Lvを 100% にした、到達EXP（%）。 */
  yield: Change<number | null>;
  /** モード2: ゆずる側の下がった目標の位置（%）。ゆずる側でなければ null。 */
  yieldTarget: number | null;
}

export interface FineTuneRowView {
  id: string;
  title: string;
  nature: ExpGainNature;
  /** 下書きの順番（0 始まり） */
  index: number;
  /** 基準の順番（0 始まり）。基準に無い行は -1 */
  baseIndex: number;
  /** モード1の操作ができない理由（§7）。操作できる行とゆずる側の行は null */
  exclusion: RowExclusion | null;
  /** 記録のある行（ゆずる側）。モード1の操作を出さない（D23） */
  giverLocked: boolean;
  /** モード1（アメブ・目標Lv）の操作ができる行 */
  mode1: boolean;
  /** モード2でスライダーと ▲▼ を出す行（D42） */
  giverControl: boolean;
  /** `[受け取る]` を出せる行（受け取る側がいないときだけ） */
  receivable: boolean;
  isReceiver: boolean;
  /** 診断の先頭の未達行 */
  isFirstShort: boolean;
  targetLevel: Change<number>;
  /** 目標Lvの ▼ ▲ が使えるか（現在Lv〜MAX_LEVEL の端、D37） */
  targetRange: { canDown: boolean; canUp: boolean };
  /** アメが担当する到達点へ届いたか（`effectiveTargetReached`） */
  reached: Change<boolean | null>;
  /** 到達Lv */
  reachLevel: Change<number | null>;
  /** 到達Lvの見出しを「アメ到達Lv」にするか（`reachedLevelLabelKey` と同じ規則） */
  candyReachLabel: boolean;
  bars: FineTuneBars;
  /** アメブなしのスロットでは null */
  boost: (Change<number> & { range: OpRange; cappedTo: number | null }) | null;
  candy: Change<number | null>;
  shards: Change<number | null>;
  /** ゆずる側のスライダー（giverControl の行） */
  giver: { value: number; m0: number; usable: number | null } | null;
  advice: RowAdviceEntry | undefined;
}

export interface FineTuneSummary {
  reached: Change<number | null>;
  total: number;
  /** アメブなしのスロットでは null */
  boostRemaining: Change<number> | null;
  shardsRemaining: Change<number | null>;
  candyShortage: Change<number | null>;
}

export interface RowViewInput {
  base: FineTuneBase;
  state: FineTuneState;
  /** `deps.evaluateRows(state.rows)` */
  evaluated: EvaluatedRows;
  /** 最新の結果（計算中の間は古い版でもよい。表示を薄くするのは呼び出し側） */
  latest: FineTuneLatest | null;
  advice: ReadonlyMap<string, RowAdviceEntry>;
  diagnosis: Diagnosis | null;
  hasBoost: boolean;
  /** 行IDを受け、睡眠EXPのある行か（計算機の `rowSleepExpFor`）。睡眠の設定は開いている間変わらない。 */
  hasSleepExp: (rowId: string) => boolean;
}

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

function resultMap(result: LevelPlannerResult | undefined): Map<string, PokemonPlanResult> {
  const map = new Map<string, PokemonPlanResult>();
  for (const p of result?.pokemonResults ?? []) map.set(p.pokemonId, p);
  return map;
}

/** モード1の棒: 到達Lvの次のLvまでのEXPを 100% として、到達Lv内EXPを塗る（D30）。 */
function raisePercent(line: PokemonPlanLine | undefined): number | null {
  if (line === undefined) return null;
  if (line.level >= MAX_LEVEL) return 100;
  const total = line.expInLevel + line.expToNextLevel;
  return total <= 0 ? 0 : clampPercent((line.expInLevel / total) * 100);
}

/** 現在の (Lv, Lv内EXP) から (lv, expInLevel) までのEXP。 */
function expBetween(
  from: { level: number; expInLevel: number },
  to: { level: number; expInLevel: number },
  expType: CalcRow["expType"],
): number {
  return calcExp(from.level, to.level, expType) + to.expInLevel - from.expInLevel;
}

export function buildRowViews(input: RowViewInput): FineTuneRowView[] {
  const { base, state, evaluated, latest, advice, diagnosis, hasBoost } = input;
  const baseIndexById = new Map<string, number>();
  const baseRowById = new Map<string, CalcRow>();
  base.rows.forEach((row, i) => {
    baseIndexById.set(row.id, i);
    baseRowById.set(row.id, row);
  });
  const baseResults = resultMap(base.result);
  const results = resultMap(latest?.result);
  const firstShortId = diagnosis !== null && "firstShortId" in diagnosis ? diagnosis.firstShortId : null;

  return state.rows.map((row, index): FineTuneRowView => {
    const id = row.id;
    const item = evaluated.byId.get(id);
    const baseItem = base.evaluated.byId.get(id);
    const baseRow = baseRowById.get(id) ?? row;
    const res = results.get(id);
    const baseRes = baseResults.get(id);
    const record = state.givers[id];
    const mode1 = canAdjustInMode1(state, evaluated, row);
    const giverControl = isGiverControlShown(state, evaluated, row);
    const exclusion = record === undefined ? rowExclusion(row, evaluated) : null;

    // モード2の棒: 現在Lvから基準の目標までを 100% にする（0 以下のときは 100%）
    const current = { level: baseRow.srcLevel, expInLevel: baseRes?.currentExpInLevel ?? 0 };
    const baseTarget = { level: baseRow.dstLevel, expInLevel: baseRow.dstExpInLevel ?? 0 };
    const need = expBetween(current, baseTarget, baseRow.expType);
    const yieldPercent = (line: PokemonPlanLine | undefined): number | null => {
      if (line === undefined) return null;
      if (need <= 0) return 100;
      return clampPercent((expBetween(current, { level: line.level, expInLevel: line.expInLevel }, baseRow.expType) / need) * 100);
    };
    const yieldTarget = record === undefined || need <= 0
      ? null
      : clampPercent((expBetween(current, { level: row.dstLevel, expInLevel: row.dstExpInLevel ?? 0 }, baseRow.expType) / need) * 100);

    const range = (hasBoost && item !== undefined)
      ? opRange(base, state, evaluated, { kind: "boost", rowId: id })
      : null;
    // 在庫のみの行で、保存値が今の上限（在庫の取り分）を超えているとき、実効アメブは在庫で抑えられる（D37）
    const saved = row.boostOrExpAdjustment;
    const cappedTo = item !== undefined && saved !== undefined && sleepTargetTraits(row).candy === "stockOnly"
      && saved > item.effectiveBoost
      ? item.effectiveBoost
      : null;

    const giverRange = giverControl ? opRange(base, state, evaluated, { kind: "giver", rowId: id }) : null;

    return {
      id,
      title: row.title,
      nature: row.nature,
      index,
      baseIndex: baseIndexById.get(id) ?? -1,
      exclusion,
      giverLocked: record !== undefined,
      mode1,
      giverControl,
      receivable: canReceive(state, evaluated, row),
      isReceiver: state.receiverId === id,
      isFirstShort: firstShortId === id,
      targetLevel: { base: baseRow.dstLevel, value: row.dstLevel },
      targetRange: { canDown: row.dstLevel > row.srcLevel, canUp: row.dstLevel < MAX_LEVEL },
      reached: {
        base: baseRes?.reachableLine.effectiveTargetReached ?? null,
        value: res?.reachableLine.effectiveTargetReached ?? null,
      },
      reachLevel: { base: baseRes?.reachableLine.level ?? null, value: res?.reachableLine.level ?? null },
      candyReachLabel: input.hasSleepExp(id)
        || (row.sleepTargetMode !== undefined && (res?.shortage.expToTarget ?? 0) > 0),
      bars: {
        raise: { base: raisePercent(baseRes?.reachableLine), value: raisePercent(res?.reachableLine) },
        yield: { base: yieldPercent(baseRes?.reachableLine), value: yieldPercent(res?.reachableLine) },
        yieldTarget,
      },
      boost: range !== null && item !== undefined && baseItem !== undefined
        ? { base: baseItem.effectiveBoost, value: item.effectiveBoost, range, cappedTo }
        : null,
      candy: {
        base: baseRes?.reachableLine.totalCandyUnitsUsed ?? null,
        value: res?.reachableLine.totalCandyUnitsUsed ?? null,
      },
      shards: {
        base: baseRes?.reachableLine.dreamShardsUsed ?? null,
        value: res?.reachableLine.dreamShardsUsed ?? null,
      },
      giver: giverRange === null
        ? null
        : { value: record?.candy ?? giverRange.max, m0: giverRange.max, usable: res?.reachableLine.totalCandyUnitsUsed ?? null },
      advice: advice.get(id),
    };
  });
}

function reachedCount(result: LevelPlannerResult | undefined): number | null {
  if (result === undefined) return null;
  return result.pokemonResults.filter((p) => p.reachableLine.effectiveTargetReached).length;
}

/** サマリー（§4.3）。残り枠は評価した行から出す（D26。`summary.boost.boostRemaining` は使わない）。 */
export function buildSummary(input: Pick<RowViewInput, "base" | "evaluated" | "latest" | "hasBoost">): FineTuneSummary {
  const { base, evaluated, latest, hasBoost } = input;
  return {
    reached: { base: reachedCount(base.result), value: reachedCount(latest?.result) },
    total: base.result.pokemonResults.length,
    boostRemaining: hasBoost
      ? { base: boostSlotRemaining(base, base.evaluated), value: boostSlotRemaining(base, evaluated) }
      : null,
    shardsRemaining: {
      base: base.result.summary.dreamShardsRemaining,
      value: latest?.result.summary.dreamShardsRemaining ?? null,
    },
    candyShortage: {
      base: base.result.shortages.totalCandyShortage,
      value: latest?.result.shortages.totalCandyShortage ?? null,
    },
  };
}
