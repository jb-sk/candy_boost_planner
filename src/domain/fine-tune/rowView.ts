/**
 * かんたんの表示用データ。画面が上限・状態の計算をしなくて済むよう、
 * 行ごとの「基準 → 変更後」の値と、操作の可否をここで出す。ストア・Vue を値で import しない。
 * 範囲・可否の判定は `draft.ts` の関数を呼ぶだけで、ここでは計算し直さない。
 */
import type { CalcRow, EvaluatedRows, RowReachAfterRemaining } from "../../composables/useCalcStore";
import type { ExpGainNature } from "../types";
import type { LevelPlannerResult, PokemonPlanResult, ShortageType } from "../level-planner/types";
import { calcSleepLandingLevel } from "../level-planner/sleepReachLevel";
import { dreamShardsPerCandy, maxLevel as MAX_LEVEL } from "../pokesleep/tables";
import { sleepTargetTraits } from "../sleep-target";
import type { RowAdviceEntry } from "./advice";
import {
  boostSlotRemaining,
  canAdjustCandy,
  canAdjustLevel,
  candyValueOf,
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

export interface FineTuneRowView {
  id: string;
  title: string;
  nature: ExpGainNature;
  /** 下書きの順番（0 始まり） */
  index: number;
  /** 目標Lv・アメブを動かせない理由。動かせる行は null */
  exclusion: RowExclusion | null;
  /** 目標Lv・アメブを動かせる行 */
  levelAdjustable: boolean;
  /** アメの数を変えた行（変える前は個数指定でなかった行）。目標Lv・アメブは動かせない */
  candyEdited: boolean;
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
  /**
   * アメの数の欄（変えられる行だけ）。value は今の値（下書きで変えた行は下書きの値）、base は開いた時点の値、
   * changed は下書きで数を変えたか（表には下書きの値を出す）
   */
  candyEdit: { value: number; base: number; min: number; max: number; changed: boolean } | null;
  shards: Change<number | null>;
  /** 今のLvでアメ1個に要るかけら（アメブで与えると倍率がかかる）。Lv上限の行は null */
  shardsPerCandy: number | null;
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
  /** アメの数の範囲を出すストアの関数 */
  deps: Pick<FineTuneDeps, "maxCandyTargetFor" | "withExplicitBoost">;
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

/** 今のLvでアメ1個に要るかけら（ゲームの表示と同じ。次のLvへ向かうアメの値段）。Lv上限は null */
export function shardsPerCandyAt(level: number): number | null {
  if (level >= MAX_LEVEL) return null;
  return dreamShardsPerCandy[level + 1] ?? null;
}

function resultMap(result: LevelPlannerResult | undefined): Map<string, PokemonPlanResult> {
  const map = new Map<string, PokemonPlanResult>();
  for (const p of result?.pokemonResults ?? []) map.set(p.pokemonId, p);
  return map;
}

export function buildRowViews(input: RowViewInput): FineTuneRowView[] {
  const { base, state, evaluated, latest, advice, hasBoost, deps } = input;
  const baseState = { version: 0, rows: base.rows, candyRecords: {} };
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
      exclusion: rowExclusion(row, evaluated),
      levelAdjustable: canAdjustLevel(evaluated, row),
      candyEdited: state.candyRecords[id] !== undefined,
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
      candyEdit: canAdjustCandy(evaluated, row)
        ? {
          value: candyValueOf(state, evaluated, latest, row),
          base: candyValueOf(baseState, base.evaluated, { version: 0, result: base.result }, baseRow),
          ...opRange(base, state, evaluated, { kind: "candy", rowId: id }, deps),
          changed: state.candyRecords[id] !== undefined || row.candyTarget !== baseRow.candyTarget,
        }
        : null,
      shardsPerCandy: shardsPerCandyAt(row.srcLevel),
      advice: advice.get(id),
    };
  });
}

/** サマリー。残り枠は評価した行から出す（`summary.boost.boostRemaining` は使わない）。 */
export function buildSummary(input: Pick<RowViewInput, "base" | "evaluated" | "latest" | "hasBoost">): FineTuneSummary {
  const { base, evaluated, latest, hasBoost } = input;
  return {
    boostRemaining: hasBoost
      ? { base: boostSlotRemaining(base, base.evaluated), value: boostSlotRemaining(base, evaluated) }
      : null,
    shardsRemaining: {
      base: base.result.summary.dreamShardsRemaining,
      value: latest?.result.summary.dreamShardsRemaining ?? null,
    },
  };
}
