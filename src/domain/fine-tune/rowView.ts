/**
 * かんたんモードの表示用データ。画面が上限・状態の計算をしなくて済むよう、
 * 行ごとの「基準 → 変更後」の値と、操作の可否をここで出す。ストア・Vue を値で import しない。
 * 範囲・可否の判定は `draft.ts` の関数を呼ぶだけで、ここでは計算し直さない。
 */
import type { CalcRow, EvaluatedRows, RowReachAfterRemaining } from "../../composables/useCalcStore";
import type { ExpGainNature } from "../types";
import type { LevelPlannerResult, PokemonPlanResult, ShortageType } from "../level-planner/types";
import { calcSleepLandingLevel } from "../level-planner/sleepReachLevel";
import { sleepTargetTraits } from "../sleep-target";
import type { RowAdviceEntry } from "./advice";
import {
  boostSlotRemaining,
  canAdjustCandy,
  canAdjustLevel,
  canReceive,
  giverValueOf,
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

export interface FineTuneRowView {
  id: string;
  title: string;
  nature: ExpGainNature;
  /** 下書きの順番（0 始まり） */
  index: number;
  /** 目標Lv・アメブを動かせない理由。動かせる行とゆずる側の行は null */
  exclusion: RowExclusion | null;
  /** 記録のある行（ゆずる側）。目標Lv・アメブは動かせない */
  giverLocked: boolean;
  /** 目標Lv・アメブを動かせる行 */
  levelAdjustable: boolean;
  /** 使うアメを動かせる行（ゆずる側になれる行と記録のある行） */
  candyAdjustable: boolean;
  /** 受け取る側に選べる行（受け取る側がいないときだけ） */
  receivable: boolean;
  isReceiver: boolean;
  targetLevel: Change<number> & { range: OpRange };
  /** アメが担当する到達点へ届いたか（`effectiveTargetReached`） */
  reached: Change<boolean | null>;
  /** 届かないとき、止めているもの */
  limitingFactor: ShortageType | null;
  /** アメで届く到達Lv */
  reachLevel: Change<number | null>;
  /** 到達Lvから次のLvまでのEXP（あとEXP）。Lv70 のときは 0 */
  expToNext: Change<number | null>;
  /** 睡眠（・おひるね島）のあとの着地点。睡眠EXPが無い行・結果が無いときは null */
  sleepReach: SleepReach | null;
  /** アメブなしのスロットでは null */
  boost: (Change<number> & { range: OpRange; cappedTo: number | null }) | null;
  /** 使えたアメ（最新の結果） */
  candy: Change<number | null>;
  shards: Change<number | null>;
  /** 使うアメの欄（candyAdjustable の行）。value は今の値、m0 はゆずる前の数 */
  giver: { value: number; m0: number } | null;
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

function resultMap(result: LevelPlannerResult | undefined): Map<string, PokemonPlanResult> {
  const map = new Map<string, PokemonPlanResult>();
  for (const p of result?.pokemonResults ?? []) map.set(p.pokemonId, p);
  return map;
}

export function buildRowViews(input: RowViewInput): FineTuneRowView[] {
  const { base, state, evaluated, latest, advice, hasBoost } = input;
  const baseRowById = new Map<string, CalcRow>();
  for (const row of base.rows) baseRowById.set(row.id, row);
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
    const candyAdjustable = canAdjustCandy(state, evaluated, row);
    const reached = res?.reachableLine.effectiveTargetReached ?? null;

    const range = (hasBoost && item !== undefined)
      ? opRange(base, state, evaluated, { kind: "boost", rowId: id })
      : null;
    // 在庫のみの行で、保存値が今の上限（在庫の取り分）を超えているとき、実効アメブは在庫で抑えられる
    const saved = row.boostOrExpAdjustment;
    const cappedTo = item !== undefined && saved !== undefined && sleepTargetTraits(row).candy === "stockOnly"
      && saved > item.effectiveBoost
      ? item.effectiveBoost
      : null;

    return {
      id,
      title: row.title,
      nature: row.nature,
      index,
      exclusion: record === undefined ? rowExclusion(row, evaluated) : null,
      giverLocked: record !== undefined,
      levelAdjustable: canAdjustLevel(state, evaluated, row),
      candyAdjustable,
      receivable: canReceive(state, evaluated, row),
      isReceiver: state.receiverId === id,
      targetLevel: {
        base: baseRow.dstLevel,
        value: row.dstLevel,
        range: opRange(base, state, evaluated, { kind: "target", rowId: id }),
      },
      reached: { base: baseRes?.reachableLine.effectiveTargetReached ?? null, value: reached },
      limitingFactor: reached === false ? res?.constraintDiagnosis.limitingFactor ?? null : null,
      reachLevel: { base: baseRes?.reachableLine.level ?? null, value: res?.reachableLine.level ?? null },
      expToNext: { base: baseRes?.reachableLine.expToNextLevel ?? null, value: res?.reachableLine.expToNextLevel ?? null },
      sleepReach: res === undefined ? null : sleepReachOf(res, row.expType, input.reachAfterRemaining(id, res.shortage.expToTarget)),
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
      giver: candyAdjustable
        ? {
          value: giverValueOf(state, evaluated, latest, row),
          m0: opRange(base, state, evaluated, { kind: "giver", rowId: id }).max,
        }
        : null,
      advice: advice.get(id),
    };
  });
}

function reachedCount(result: LevelPlannerResult | undefined): number | null {
  if (result === undefined) return null;
  return result.pokemonResults.filter((p) => p.reachableLine.effectiveTargetReached).length;
}

/** サマリー。残り枠は評価した行から出す（`summary.boost.boostRemaining` は使わない）。 */
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
  };
}
