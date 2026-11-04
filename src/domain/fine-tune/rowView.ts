/**
 * シンプルの表示用データ。画面が上限・状態の計算をしなくて済むよう、
 * 行ごとの「基準 → 変更後」の値と、操作の可否をここで出す。ストア・Vue を値で import しない。
 * 範囲・可否の判定は `draft.ts` の関数を呼ぶだけで、ここでは計算し直さない。
 */
import type { CalcRow, EvaluatedRows, RowReachAfterRemaining } from "../../composables/useCalcStore";
import type { ExpGainNature } from "../types";
import type { LevelPlannerResult, PokemonPlanLine, PokemonPlanResult, ShortageType } from "../level-planner/types";
import { calcSleepLandingLevel } from "../level-planner/sleepReachLevel";
import { dreamShardsPerCandy, maxLevel as MAX_LEVEL } from "../pokesleep/tables";
import { expToNextLevel } from "../individual";
import { sleepTargetChoiceOf, sleepTargetTraits, type SleepTargetChoice } from "../sleep-target";
import type { RowAdviceEntry } from "./advice";
import {
  boostSlotRemaining,
  canAdjustCandy,
  canAdjustLevel,
  canAdjustTarget,
  candyValueOf,
  opRange,
  rowExclusion,
  speciesCandyValueOf,
  type FineTuneBase,
  type FineTuneDeps,
  type FineTuneLatest,
  type FineTuneState,
  type OpRange,
  type RowExclusion,
} from "./draft";

/** 画面に出すあとEXP（0・次Lv以上は「次Lvまで全部」として次Lvまでの EXP。計算機の欄と同じ） */
export function displayExpRemaining(row: Pick<CalcRow, "srcLevel" | "expType" | "expRemaining">): number {
  const toNext = expToNextLevel(row.srcLevel, row.expType);
  return row.expRemaining <= 0 || row.expRemaining >= toNext ? toNext : row.expRemaining;
}

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
  /** アメブを動かせない理由。動かせる行は null */
  exclusion: RowExclusion | null;
  /** アメブを動かせる行（目標Lvも動かせる） */
  levelAdjustable: boolean;
  /** 目標Lvを動かせる行（LvMax のほか。個数指定の行は目標Lvが個数指定を上書きする） */
  targetAdjustable: boolean;
  /** アメの数を変えた行（変える前は個数指定でなかった行）。アメブは動かせない（目標Lvを選ぶと個数指定が外れる） */
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
  /** 睡眠目標（画面の選び方）と、開いた時点から変えたか */
  sleepTarget: { choice: SleepTargetChoice; base: SleepTargetChoice; changed: boolean };
  /** 睡眠（・おひるね島）のあとの着地点。睡眠EXPが無い行・結果が無いときは null */
  sleepReach: SleepReach | null;
  /** 睡眠のあとの着地点が開いた時点から変わったか */
  sleepReachChanged: boolean;
  /**
   * アメブなしのスロットでは null。minimized は最小アメブが効いている（スイッチが入っていて、個数を手で入れていない）、
   * canMinimize は最小アメブにできる、shortCandy はアメが足りず最小アメブにしても目標に届かない、
   * manual は個数を手で入れている（リセットできる）
   */
  boost: (Change<number> & {
    range: OpRange;
    cappedTo: number | null;
    minimized: boolean;
    canMinimize: boolean;
    shortCandy: boolean;
    /** shortCandy の行が目標へ届くのに要るアメの数（全部アメブで上げたとき）。分からなければ null */
    neededCandy: number | null;
    manual: boolean;
    /**
     * アメブ目標Lv（計算機の欄と同じ値）。range は現在Lv〜上限、disabled は睡眠EXPだけで目標に届き、アメブを使えない行
     */
    level: Change<number> & { range: OpRange; disabled: boolean };
  }) | null;
  /** 使えたアメ（最新の結果） */
  candy: Change<number | null>;
  /**
   * アメの数の欄（変えられる行だけ）。value は今の値（下書きで変えた行は下書きの値）、base は開いた時点の値、
   * changed は下書きで数を変えたか（表には下書きの値を出す）
   */
  candyEdit: { value: number; base: number; min: number; max: number; changed: boolean } | null;
  shards: Change<number | null>;
  /**
   * 到達Lvでアメ1個に要るかけら（最後に与えるアメの値段。アメブで与えると倍率がかかる）。
   * 高いLvほど多いので、アメブ・アメを減らすかの目安になる。結果が無いときは null
   */
  shardsPerCandy: Change<number | null>;
  advice: RowAdviceEntry | undefined;
  /**
   * 行の詳細で動かす個体。srcLevel は 1〜目標Lv、expRemaining は次Lvまでの残り（未設定は次Lvまで全部 = expMax）。
   * リンク切れの行は editable: false（計算機でも欄を無効にしている）
   */
  individual: {
    srcLevel: Change<number> & { min: number; max: number };
    expRemaining: Change<number> & { max: number };
    editable: boolean;
  };
  /** その行の進化系の種族アメの在庫（下書きの値）。種族不明の行は null */
  stock: Change<number> | null;
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
  /** 残EXPを埋めたあとの着地点の値（計算機の `reachAfterRemainingForRow`。渡した行の睡眠目標で、島は渡した残EXPで出す） */
  reachAfterRemaining: (row: CalcRow, expToTarget: number) => RowReachAfterRemaining | null;
  /** アメの数の範囲・個体と在庫の可否を出すストアの関数 */
  deps: Pick<
    FineTuneDeps,
    "maxCandyTargetFor" | "withExplicitBoost" | "canMinimizeBoostFor" | "canEditIndividual" | "speciesCandyFamilyOf" | "speciesCandyStockOf"
  >;
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

/**
 * 到達Lvでアメ1個に要るかけら（ゲームの表と同じ値段。アメが止まった点で与えるアメの値段）。
 * Lv ちょうどで止まったときはそのLvへ上がるアメ（表の [level]）、Lv の途中で止まったときは次のLvへ向かうアメ（[level + 1]）。
 * アメを1個も使わない行は、次に与えるアメの値段。結果が無いときは null。
 */
export function shardsPerCandyAtReach(line: PokemonPlanLine | undefined): number | null {
  if (line === undefined) return null;
  const atLevelEdge = line.expInLevel === 0 && line.totalCandyUnitsUsed > 0;
  const index = atLevelEdge || line.level >= MAX_LEVEL ? line.level : line.level + 1;
  return dreamShardsPerCandy[Math.min(index, MAX_LEVEL)] ?? null;
}

function resultMap(result: LevelPlannerResult | undefined): Map<string, PokemonPlanResult> {
  const map = new Map<string, PokemonPlanResult>();
  for (const p of result?.pokemonResults ?? []) map.set(p.pokemonId, p);
  return map;
}

export function buildRowViews(input: RowViewInput): FineTuneRowView[] {
  const { base, state, evaluated, latest, advice, hasBoost, deps } = input;
  const baseState = { version: 0, rows: base.rows, candyRecords: {}, speciesCandy: {}, settings: {} };
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
    // 睡眠目標は下書きで変えられるので、下書きの行（基準は開いた時点の行）で求める
    const sleepReach = res === undefined ? null : sleepReachOf(res, row.expType, input.reachAfterRemaining(row, res.shortage.expToTarget));
    const baseSleepReach = baseRes === undefined
      ? null
      : sleepReachOf(baseRes, baseRow.expType, input.reachAfterRemaining(baseRow, baseRes.shortage.expToTarget));

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
      targetAdjustable: canAdjustTarget(row),
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
      sleepTarget: {
        choice: sleepTargetChoiceOf(row),
        base: sleepTargetChoiceOf(baseRow),
        changed: row.sleepTargetMode !== baseRow.sleepTargetMode || row.sleepTargetHours !== baseRow.sleepTargetHours,
      },
      sleepReach,
      sleepReachChanged: baseSleepReach !== null && sleepReach !== null
        && (baseSleepReach.level !== sleepReach.level || baseSleepReach.tenths !== sleepReach.tenths),
      boost: range !== null && item !== undefined && baseItem !== undefined
        ? {
          base: baseItem.effectiveBoost,
          value: item.effectiveBoost,
          range,
          cappedTo,
          minimized: row.boostMinimizeRow === true && row.boostOrExpAdjustment === undefined,
          canMinimize: deps.canMinimizeBoostFor(row),
          shortCandy: item.minimizeShortCandy,
          neededCandy: item.minimizeNeededCandy ?? null,
          manual: row.boostOrExpAdjustment !== undefined,
          level: {
            base: baseItem.boostReachLevel,
            value: item.boostReachLevel,
            range: opRange(base, state, evaluated, { kind: "boostLevel", rowId: id }),
            disabled: item.boostInputDisabled,
          },
        }
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
      shardsPerCandy: {
        base: shardsPerCandyAtReach(baseRes?.reachableLine),
        value: shardsPerCandyAtReach(res?.reachableLine),
      },
      advice: advice.get(id),
      individual: {
        srcLevel: { base: baseRow.srcLevel, value: row.srcLevel, min: 1, max: row.dstLevel },
        expRemaining: {
          base: displayExpRemaining(baseRow),
          value: displayExpRemaining(row),
          max: expToNextLevel(row.srcLevel, row.expType),
        },
        editable: deps.canEditIndividual(row),
      },
      stock: stockOf(row),
    };
  });

  function stockOf(row: CalcRow): Change<number> | null {
    const familyKey = deps.speciesCandyFamilyOf(row);
    if (familyKey === undefined) return null;
    return { base: deps.speciesCandyStockOf(familyKey), value: speciesCandyValueOf(state, familyKey, deps) };
  }
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
