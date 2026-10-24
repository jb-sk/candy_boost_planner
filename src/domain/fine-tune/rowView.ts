/**
 * やりくりモーダルの表示用データ（設計書 §4.3、§4.4）。画面が上限・状態の計算をしなくて済むよう、
 * 行ごとの「基準 → 変更後」の値と、操作の可否をここで出す。ストア・Vue を値で import しない。
 * 範囲・可否の判定は `draft.ts` の関数を呼ぶだけで、ここでは計算し直さない。
 */
import type { CalcRow, EvaluatedRows, RowReachAfterRemaining } from "../../composables/useCalcStore";
import type { ExpGainNature } from "../types";
import type { LevelPlannerResult, PokemonPlanLine, PokemonPlanResult } from "../level-planner/types";
import { calcExp } from "../pokesleep/exp";
import { simulateCandyBudget } from "../pokesleep/simulateCandyBudget";
import { calcSleepLandingLevel } from "../level-planner/sleepReachLevel";
import { maxLevel as MAX_LEVEL } from "../pokesleep/tables";
import { sleepTargetTraits } from "../sleep-target";
import type { RowAdviceEntry } from "./advice";
import {
  boostSlotRemaining,
  canAdjustInMode1,
  canReceive,
  isGiverControlShown,
  opRange,
  rowExclusion,
  type FineTuneBase,
  type FineTuneDeps,
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

/**
 * EXP の棒（D45）。ゲームの表示と同じく、到達Lvの次のLvまでのEXPを 100% として到達Lv内EXPを塗る
 * （Lv ちょうどで届いた行は 0%）。両方のモードで同じ物差し。
 */
export interface FineTuneBars {
  progress: Change<number | null>;
  /** モード2: ゆずる側の下がった目標の位置（%）。ゆずる側でない、または目標が到達Lvの中に無ければ null。 */
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
  targetLevel: Change<number>;
  /** 目標Lvの ▼ ▲ が使えるか（現在Lv〜MAX_LEVEL の端、D37） */
  targetRange: { canDown: boolean; canUp: boolean };
  /** アメが担当する到達点へ届いたか（`effectiveTargetReached`） */
  reached: Change<boolean | null>;
  /** 到達Lv */
  reachLevel: Change<number | null>;
  /** 到達Lvから次のLvまでのEXP（あとEXP）。Lv70 のときは 0 */
  expToNext: Change<number | null>;
  /** 睡眠（・おひるね島）のあとの着地点。睡眠EXPが無い行・結果が無いときは null（D46） */
  sleepReach: SleepReach | null;
  bars: FineTuneBars;
  /** アメブなしのスロットでは null */
  boost: (Change<number> & { range: OpRange; cappedTo: number | null }) | null;
  candy: Change<number | null>;
  shards: Change<number | null>;
  /** ゆずる側のスライダー（giverControl の行） */
  giver: { value: number; m0: number; usable: number | null } | null;
  advice: RowAdviceEntry | undefined;
}

/**
 * 睡眠到達Lv・島到達Lv（計算機と同じ `calcSleepLandingLevel`）。最新の結果のアメの到達点に、睡眠（島）のEXPを足した点。
 * 届くかどうかは行の `reached`（アメが睡眠の手前の点まで届けば、睡眠のあと最終目標に届く）で見る。
 */
export interface SleepReach {
  kind: RowReachAfterRemaining["kind"];
  level: number;
  /** 小数第1位。Lv70 では null */
  tenths: number | null;
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
  hasBoost: boolean;
  /** 残EXPを埋めたあとの着地点の値（計算機の `rowReachAfterRemainingFor`。島は渡した残EXPで出す） */
  reachAfterRemaining: (rowId: string, expToTarget: number) => RowReachAfterRemaining | null;
}

function sleepReachOf(
  res: PokemonPlanResult | undefined,
  expType: CalcRow["expType"],
  after: RowReachAfterRemaining | null,
): SleepReach | null {
  if (res === undefined || after === null) return null;
  const line = res.reachableLine;
  const landing = calcSleepLandingLevel({
    reachedLevel: line.level,
    reachedExpInLevel: line.expInLevel,
    sleepExp: after.kind === "napIsland" ? after.napGainedExp : after.sleepExp,
    expType,
  });
  if (!landing.shown) return null;
  return { kind: after.kind, level: landing.level, tenths: landing.tenths };
}

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

function resultMap(result: LevelPlannerResult | undefined): Map<string, PokemonPlanResult> {
  const map = new Map<string, PokemonPlanResult>();
  for (const p of result?.pokemonResults ?? []) map.set(p.pokemonId, p);
  return map;
}

/** 棒: 到達Lvの次のLvまでのEXPを 100% として、到達Lv内EXPを塗る（D45）。LvMax は次が無いので空（ゲームと同じ）。 */
function progressPercent(line: PokemonPlanLine | undefined): number | null {
  if (line === undefined) return null;
  if (line.level >= MAX_LEVEL) return 0;
  const total = line.expInLevel + line.expToNextLevel;
  return total <= 0 ? 0 : clampPercent((line.expInLevel / total) * 100);
}

/** (level, expInLevel) の点の、level の中での位置（%）。LvMax は空。 */
function pointPercent(level: number, expInLevel: number, expType: CalcRow["expType"]): number {
  if (level >= MAX_LEVEL) return 0;
  const total = calcExp(level, level + 1, expType);
  return total <= 0 ? 0 : clampPercent((expInLevel / total) * 100);
}

/** ゆずる側の下がった目標の印（%）。目標が到達Lvの中にあるときだけ（棒は到達Lvの中しか描かない）。 */
function targetMarkPercent(
  reachLevel: number | null,
  row: Pick<CalcRow, "dstLevel" | "dstExpInLevel" | "expType">,
): number | null {
  if (reachLevel === null || reachLevel >= MAX_LEVEL || row.dstLevel !== reachLevel) return null;
  return pointPercent(row.dstLevel, row.dstExpInLevel ?? 0, row.expType);
}

/** スライダーを動かしている間の A の棒（設計書 §6.2、§13 Q12）。 */
export interface GiverPreview {
  rowId: string;
  /** 塗り（%）。結果が無いときは null */
  fill: number | null;
  /** 到達Lv と、次のLvまでのEXP（棒の横の「Lv66 あと1,234」）。結果が無いときは null */
  level: number | null;
  expToNext: number | null;
  /** 下がった目標の印（%）。m が m0 のとき（記録が消える）、目標が到達Lvの中に無いときなどは null */
  target: number | null;
}

export interface GiverPreviewInput {
  base: FineTuneBase;
  state: FineTuneState;
  /** `deps.evaluateRows(state.rows)` */
  evaluated: EvaluatedRows;
  deps: Pick<FineTuneDeps, "withExplicitBoost" | "withCandyTarget">;
  /** その行の今の表示データ（`giver` を持つ行） */
  view: FineTuneRowView;
  /** 動かしている間の使うアメの数 */
  m: number;
}

/**
 * 動かしている間の値 m から、ゆずる側 A の棒を求める。ソルバーは呼ばない。
 * - 印: 離したときに reducer が作る行（`withCandyTarget`）の目標。reducer と同じ関数を同じ引数で呼ぶので、離したあとと一致する。
 * - 塗り・到達Lv: m が「今使えているアメの数」（最新の結果）より小さいとき、A はその m 個で足りるので、
 *   ソルバーと共通の `simulateCandyBudget` で m 個（アメブは記録の実効アメブ、m を超えない）の到達点を出す。
 *   m が使えている数以上のときは、何個まで届くかはソルバーでないと分からない（§6.2「今使えている数」）ので、最新の結果のまま動かさない。
 */
export function previewGiver(input: GiverPreviewInput): GiverPreview | null {
  const { base, state, evaluated, deps, view } = input;
  if (view.giver === null) return null;
  const rowId = view.id;
  const row = state.rows.find((r) => r.id === rowId);
  const baseRow = base.rows.find((r) => r.id === rowId);
  if (row === undefined || baseRow === undefined) return null;
  const record = state.givers[rowId];
  const before = record?.before ?? row;
  const boost = record?.boost ?? evaluated.byId.get(rowId)?.effectiveBoost ?? 0;
  const m0 = view.giver.m0;
  const m = Math.min(m0, Math.max(0, Math.floor(input.m)));

  const baseRes = base.result.pokemonResults.find((p) => p.pokemonId === rowId);

  const given = m < m0
    ? deps.withCandyTarget(deps.withExplicitBoost(before, boost, { preserveTargetForExplicitBoost: true }), m)
    : null;

  const usable = view.giver.usable;
  if (usable === null || m >= usable) {
    const level = view.reachLevel.value;
    return {
      rowId,
      fill: view.bars.progress.value,
      level,
      expToNext: view.expToNext.value,
      target: given === null ? null : targetMarkPercent(level, given),
    };
  }
  const kind = evaluated.plannerInput?.boost.kind ?? "none";
  const reached = simulateCandyBudget(
    { currentLevel: before.srcLevel, currentExpInLevel: baseRes?.currentExpInLevel ?? 0, expType: before.expType, nature: before.nature },
    Math.min(boost, m), m, Infinity, kind,
  );
  const expToNext = reached.level >= MAX_LEVEL
    ? 0
    : Math.max(0, calcExp(reached.level, reached.level + 1, before.expType) - reached.expInLevel);
  return {
    rowId,
    fill: pointPercent(reached.level, reached.expInLevel, before.expType),
    level: reached.level,
    expToNext,
    target: given === null ? null : targetMarkPercent(reached.level, given),
  };
}

export function buildRowViews(input: RowViewInput): FineTuneRowView[] {
  const { base, state, evaluated, latest, advice, hasBoost } = input;
  const baseIndexById = new Map<string, number>();
  const baseRowById = new Map<string, CalcRow>();
  base.rows.forEach((row, i) => {
    baseIndexById.set(row.id, i);
    baseRowById.set(row.id, row);
  });
  const baseResults = resultMap(base.result);
  const results = resultMap(latest?.result);

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

    const yieldTarget = record === undefined ? null : targetMarkPercent(res?.reachableLine.level ?? null, row);

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
      targetLevel: { base: baseRow.dstLevel, value: row.dstLevel },
      targetRange: { canDown: row.dstLevel > row.srcLevel, canUp: row.dstLevel < MAX_LEVEL },
      reached: {
        base: baseRes?.reachableLine.effectiveTargetReached ?? null,
        value: res?.reachableLine.effectiveTargetReached ?? null,
      },
      reachLevel: { base: baseRes?.reachableLine.level ?? null, value: res?.reachableLine.level ?? null },
      expToNext: { base: baseRes?.reachableLine.expToNextLevel ?? null, value: res?.reachableLine.expToNextLevel ?? null },
      sleepReach: res === undefined ? null : sleepReachOf(res, row.expType, input.reachAfterRemaining(id, res.shortage.expToTarget)),
      bars: {
        progress: { base: progressPercent(baseRes?.reachableLine), value: progressPercent(res?.reachableLine) },
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
