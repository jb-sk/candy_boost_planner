import { describe, expect, it } from "vitest";
import { entriesToObject } from "../../../utils/entriesToObject";
import type { CalcRow, EvaluatedRows } from "../../../composables/useCalcStore";
import type {
  BoostKind,
  CandySupplyBreakdown,
  LevelPlannerResult,
  PokemonPlanInput,
  PokemonPlanResult,
  ShortageType,
} from "../../level-planner/types";
import {
  DIAGNOSIS_DIRECTION,
  adviseRow,
  createAdviceContext,
  diagnose,
  receiverNotices,
  type AdviceContext,
  type Diagnosis,
  type RankDirection,
} from "../advice";
import { initialFineTuneState, type FineTuneBase, type FineTuneState, type GiverRecord } from "../draft";

/** 作り物の結果と評価で、診断・効果・受け取る側の注意の判定だけを確かめる（planner と store は使わない）。 */

function makeRow(id: string, extra: Partial<CalcRow> = {}): CalcRow {
  return { id, title: id, pokedexId: 25, srcLevel: 10, dstLevel: 50, expRemaining: 0, expType: 600, nature: "normal", boostReachLevel: 50, ...extra };
}

const noSupply: CandySupplyBreakdown = { species: 0, type: { s: 0, m: 0 }, universal: { s: 0, m: 0, l: 0 } };
const supplyOf = (extra: { species?: number; type?: number; universal?: number }): CandySupplyBreakdown => ({
  species: extra.species ?? 0,
  type: { s: extra.type ?? 0, m: 0 },
  universal: { s: 0, m: 0, l: extra.universal ?? 0 },
});

interface Spec {
  /** 進化系（既定: id） */
  family?: string;
  type?: string;
  /** false は在庫のみの睡眠目標の行（種族アメだけ使える） */
  items?: boolean;
  reached?: boolean;
  /** 届かない行の律速。届かない行には必ず指定する（ソルバーは届かない行に必ず律速を付ける） */
  factor?: ShortageType;
  supply?: CandySupplyBreakdown;
  shardsUsed?: number;
  candyToTarget?: number;
  shardShortage?: number;
  boost?: number;
  full?: number;
  need?: number;
  stock?: number;
  row?: Partial<CalcRow>;
}

function resultOf(id: string, spec: Spec): PokemonPlanResult {
  const reached = spec.reached ?? true;
  return {
    pokemonId: id,
    reachableLine: { effectiveTargetReached: reached, candySupply: spec.supply ?? noSupply, dreamShardsUsed: spec.shardsUsed ?? 0 },
    shortage: { candyToTarget: spec.candyToTarget ?? 0, dreamShardShortage: spec.shardShortage ?? 0 },
    constraintDiagnosis: { limitingFactor: reached ? null : spec.factor },
    role: "upper",
  } as unknown as PokemonPlanResult;
}

function summaryOf(over: { shards?: number; boostRemaining?: number; speciesRemaining?: Record<string, number> } = {}): LevelPlannerResult["summary"] {
  return {
    dreamShardsRemaining: over.shards ?? 1000,
    boost: { kind: "full", boostLimit: 3500, boostUsed: 0, boostRemaining: over.boostRemaining ?? 0 },
    speciesCandyRemaining: over.speciesRemaining ?? {},
    fullyReachedCount: 0,
  } as unknown as LevelPlannerResult["summary"];
}

function build(specs: Record<string, Spec>, over: Parameters<typeof summaryOf>[0] = {}, boostLimit = 3500) {
  const rows = Object.entries(specs).map(([id, s]) => makeRow(id, s.row ?? {}));
  const pokemonList = Object.entries(specs).map(([id, s]) => ({
    pokemonId: id,
    pokedexId: 25,
    candyFamilyKey: s.family ?? id,
    type: s.type ?? "electric",
    itemsAllowed: s.items === false ? false : true,
    currentLevel: 10,
    currentExpInLevel: 0,
    expType: 600,
    nature: "normal",
    requestedBoostCandy: s.boost ?? 0,
  } as unknown as PokemonPlanInput));
  const byId = new Map<string, EvaluatedRows["byId"] extends Map<string, infer V> ? V : never>();
  for (const [id, s] of Object.entries(specs)) {
    byId.set(id, { effectiveBoost: s.boost ?? 0, fullBoost: s.full ?? 100, candyNeed: s.need ?? 100, stockCandyAvailable: s.stock });
  }
  const evaluated: EvaluatedRows = {
    byId,
    plannerInput: { pokemonList, dreamShards: 0, boost: { kind: "full", limit: boostLimit }, candyInventory: { species: {}, typeCandy: {}, universal: { s: 0, m: 0, l: 0 } } },
  };
  const result = {
    pokemonResults: Object.entries(specs).map(([id, s]) => resultOf(id, s)),
    summary: summaryOf(over),
  } as unknown as LevelPlannerResult;
  const base: FineTuneBase = { rows, evaluated, result, boostLimit };
  return { rows, evaluated, result, base, state: initialFineTuneState(base) };
}

function ctxOf(t: ReturnType<typeof build>): AdviceContext {
  return createAdviceContext({
    deps: { evaluateRows: () => t.evaluated, withExplicitBoost: (row) => row },
    base: t.base,
    state: t.state,
    evaluated: t.evaluated,
    result: t.result,
  });
}

const advise = (t: ReturnType<typeof build>, id: string, direction: RankDirection = "increase") => adviseRow(ctxOf(t), id, direction);

describe("diagnose（§5.1）", () => {
  const room = 100;
  const kindOf = (specs: Record<string, Spec>, boostKind: BoostKind = "full", remaining = room, over: Parameters<typeof summaryOf>[0] = {}): Diagnosis => {
    const t = build(specs, over);
    return diagnose(t.result, t.rows, boostKind, remaining);
  };

  it("表の9行の kind がそれぞれ出る", () => {
    expect(kindOf({ a: {} }).kind).toBe("allReachedRoom");
    expect(kindOf({ a: {} }, "full", 0).kind).toBe("allReachedNoRoom");
    expect(kindOf({ a: {} }, "full", room, { shards: 0 }).kind).toBe("allReachedNoRoom");
    expect(kindOf({ a: { reached: false, factor: "candy" } }).kind).toBe("candyShortRoom");
    expect(kindOf({ a: { reached: false, factor: "candy" } }, "full", 0).kind).toBe("candyShortNoSlot");
    expect(kindOf({ a: { reached: false, factor: "candy" } }, "full", room, { shards: 0 }).kind).toBe("candyShortNoShards");
    expect(kindOf({ a: { reached: false, factor: "shards" } }).kind).toBe("shardsShort");
    expect(kindOf({ a: { reached: false, factor: "boost" } }).kind).toBe("boostCapShort");
    expect(kindOf({ a: {} }, "none").kind).toBe("noBoostAllReached");
    expect(kindOf({ a: { reached: false, factor: "candy" } }, "none").kind).toBe("noBoostShort");
  });

  it("アメブ枠もかけらも無いときは、枠の判定が先（表の 4 が 5 より上）", () => {
    expect(kindOf({ a: { reached: false, factor: "candy" } }, "full", 0, { shards: 0 }).kind).toBe("candyShortNoSlot");
  });

  it("アメブなしのスロットでは 1〜7 が出ず、8・9 だけ", () => {
    for (const factor of ["candy", "shards", "boost"] as const) {
      expect(kindOf({ a: { reached: false, factor } }, "none").kind).toBe("noBoostShort");
    }
    expect(kindOf({ a: {}, b: {} }, "none").kind).toBe("noBoostAllReached");
  });

  it("先頭の未達行の律速で kind が決まり、違う不足の行は添え書きに出る（向きは変わらない）", () => {
    const d = kindOf({
      ok: {},
      first: { reached: false, factor: "candy" },
      other: { reached: false, factor: "shards" },
      same: { reached: false, factor: "candy" },
      boostRow: { reached: false, factor: "boost" },
    });
    expect(d).toEqual({
      kind: "candyShortRoom",
      firstShortId: "first",
      // 同じアメで止まっている same があるので「〇〇以下は」
      moreShort: true,
      alsoShort: [{ rowId: "other", factor: "shards" }, { rowId: "boostRow", factor: "boost" }],
    });
    // かけらで止まっている行が先頭なら、アメで止まっている行が添え書き
    expect(kindOf({ s: { reached: false, factor: "shards" }, c: { reached: false, factor: "candy" } })).toEqual({
      kind: "shardsShort",
      firstShortId: "s",
      moreShort: false,
      alsoShort: [{ rowId: "c", factor: "candy" }],
    });
  });

  it("先頭の未達行より上の行は添え書きに出ない。届く行は律速が null でも数えない", () => {
    const d = kindOf({ upper: { reached: true }, first: { reached: false, factor: "shards" }, lower: { reached: true } });
    expect(d).toEqual({ kind: "shardsShort", firstShortId: "first", moreShort: false, alsoShort: [] });
  });

  it("role と fullyReachedCount と boostRemaining は使わない。残り枠は引数で決まる", () => {
    const t = build({ a: { reached: false, factor: "candy" } }, { boostRemaining: 500 });
    // 結果の boostRemaining が 500 でも、渡した残り枠 0 が優先
    expect(diagnose(t.result, t.rows, "full", 0).kind).toBe("candyShortNoSlot");
    // role が boundary の行が下にあっても、先頭の未達行で決める
    const roles = build({ a: { reached: true }, b: { reached: false, factor: "shards" } });
    (roles.result.pokemonResults[0] as { role: string }).role = "boundary";
    expect(diagnose(roles.result, roles.rows, "full", room)).toMatchObject({ kind: "shardsShort", firstShortId: "b" });
  });

  it("下書きの行の順で数え、結果に無い行は飛ばす", () => {
    const t = build({ a: { reached: false, factor: "shards" }, b: { reached: false, factor: "candy" } });
    const reversed = [t.rows[1]!, t.rows[0]!, makeRow("not-in-result")];
    expect(diagnose(t.result, reversed, "full", room)).toMatchObject({ kind: "candyShortRoom", firstShortId: "b" });
  });

  it("向きの表: 増やすのは 1 と 3、減らすのは 6、ほかはおすすめ量を出さない", () => {
    expect(DIAGNOSIS_DIRECTION).toEqual({
      allReachedRoom: "increase",
      allReachedNoRoom: null,
      candyShortRoom: "increase",
      candyShortNoSlot: null,
      candyShortNoShards: null,
      shardsShort: "decrease",
      boostCapShort: null,
      noBoostAllReached: null,
      noBoostShort: null,
    });
  });
});

describe("adviseRow: 増やす向き（§5.2、§2.5）", () => {
  it("自分がアメで止まっている行は selfShort", () => {
    const t = build({ a: { reached: false, factor: "candy" } });
    expect(advise(t, "a")).toEqual({ kind: "selfShort" });
  });

  it("かけらで止まっている行・アメブ枠で止まっている行は selfShort にならず noEffect", () => {
    const t = build({ s: { reached: false, factor: "shards" }, b: { reached: false, factor: "boost" } });
    expect(advise(t, "s")).toEqual({ kind: "noEffect", reason: "shardsLimited" });
    expect(advise(t, "b")).toEqual({ kind: "noEffect", reason: "boostCapLimited" });
  });

  it("全アメブ点にいる行は atFullBoost（ほかの判定より先）", () => {
    const t = build({ a: { reached: false, factor: "candy", boost: 30, full: 30 } });
    expect(advise(t, "a")).toEqual({ kind: "noEffect", reason: "atFullBoost" });
  });

  it("上の行が使っているアメを使える下の届かない行があれば feedsBelow（上から順）", () => {
    const t = build({
      up: { supply: supplyOf({ universal: 1 }), family: "f1", type: "electric" },
      x: { reached: false, factor: "candy", family: "f2", type: "water" },
      y: { reached: false, factor: "candy", family: "f3", type: "fire" },
    });
    expect(advise(t, "up")).toEqual({ kind: "feedsBelow", beneficiaryIds: ["x", "y"] });
  });

  it("下の行が使えるのは、同じ進化系の種族アメ・同じタイプのタイプアメ・万能アメ", () => {
    const species = build({ up: { supply: supplyOf({ species: 5 }), family: "f1" }, x: { reached: false, factor: "candy", family: "f1" }, y: { reached: false, factor: "candy", family: "f9" } });
    expect(advise(species, "up")).toEqual({ kind: "feedsBelow", beneficiaryIds: ["x"] });
    const type = build({ up: { supply: supplyOf({ type: 5 }), type: "water" }, x: { reached: false, factor: "candy", type: "water" }, y: { reached: false, factor: "candy", type: "fire" } });
    expect(advise(type, "up")).toEqual({ kind: "feedsBelow", beneficiaryIds: ["x"] });
  });

  it("下の行が在庫のみ（itemsAllowed === false）なら、タイプアメ・万能アメは使えず種族アメだけ使える", () => {
    const items = build({
      up: { supply: supplyOf({ type: 3, universal: 3 }), family: "f1", type: "water" },
      x: { reached: false, factor: "candy", family: "f2", type: "water", items: false },
    });
    expect(advise(items, "up")).toEqual({ kind: "noEffect", reason: "speciesOnly" });
    const sameFamily = build({
      up: { supply: supplyOf({ species: 3 }), family: "f1" },
      x: { reached: false, factor: "candy", family: "f1", items: false },
    });
    expect(advise(sameFamily, "up")).toEqual({ kind: "feedsBelow", beneficiaryIds: ["x"] });
  });

  it("下の行がアメ以外で止まっていれば受け取り手に数えない（かけらで止まる行にアメは回らない）", () => {
    const t = build({
      up: { supply: supplyOf({ universal: 2 }) },
      x: { reached: false, factor: "shards" },
      y: { reached: false, factor: "boost" },
    });
    expect(advise(t, "up")).toEqual({ kind: "noEffect", reason: "belowShortRows" });
  });

  it("届かない行より下の行は belowShortRows、種族アメだけで下に回らない行は speciesOnly", () => {
    const below = build({
      x: { reached: false, factor: "candy", family: "f2" },
      low: { supply: supplyOf({ universal: 2 }) },
    });
    expect(advise(below, "low")).toEqual({ kind: "noEffect", reason: "belowShortRows" });
    const speciesOnly = build({
      up: { supply: supplyOf({ species: 40 }), family: "f1" },
      x: { reached: false, factor: "candy", family: "f2" },
    });
    expect(advise(speciesOnly, "up")).toEqual({ kind: "noEffect", reason: "speciesOnly" });
  });

  it("全員届いているときは saving（比較は最新の結果だけ）", () => {
    const t = build({ a: { supply: supplyOf({ universal: 1 }) }, b: {} });
    expect(advise(t, "a")).toEqual({ kind: "saving" });
    expect(advise(t, "b")).toEqual({ kind: "saving" });
  });

  it("在庫で決まる行（在庫のみで要る数 > 使える在庫）は sameStockMoreExp。下の行には回さない", () => {
    const stockRow = { sleepTargetMode: "stock" as const };
    const t = build({
      z: { row: stockRow, items: false, family: "f1", supply: supplyOf({ species: 50 }), need: 300, stock: 50 },
      x: { reached: false, factor: "candy", family: "f1" },
    });
    expect(advise(t, "z")).toEqual({ kind: "sameStockMoreExp" });
    // 在庫で足りる（要る数 <= 使える在庫）なら、睡眠目標なしと同じ判定
    const enough = build({
      z: { row: stockRow, items: false, family: "f1", supply: supplyOf({ species: 50 }), need: 40, stock: 50 },
      x: { reached: false, factor: "candy", family: "f1" },
    });
    expect(advise(enough, "z")).toEqual({ kind: "feedsBelow", beneficiaryIds: ["x"] });
    // 睡眠目標が在庫のみでない行は、要る数 > stock でも在庫で決まる行にしない
    const normal = build({ z: { need: 300, stock: 50 } });
    expect(advise(normal, "z")).toEqual({ kind: "saving" });
  });

  it("行・プランナー入力・結果が無ければ null", () => {
    const t = build({ a: {} });
    expect(advise(t, "missing")).toBeNull();
  });
});

describe("adviseRow: 減らす向き（§5.3）", () => {
  it("アメブ0の行は noBoost", () => {
    const t = build({ a: { reached: false, factor: "shards", boost: 0 } });
    expect(advise(t, "a", "decrease")).toEqual({ kind: "noEffect", reason: "noBoost" });
  });

  it("自分がかけらで止まっている行は selfShort", () => {
    const t = build({ a: { reached: false, factor: "shards", boost: 10 } });
    expect(advise(t, "a", "decrease")).toEqual({ kind: "selfShort" });
  });

  it("下にかけらで止まっている届かない行があれば feedsBelow。アメの種類は問わない", () => {
    const t = build({
      up: { boost: 10 },
      x: { reached: false, factor: "shards", boost: 5 },
      y: { reached: false, factor: "candy", boost: 5 },
      z: { reached: false, factor: "shards", boost: 5 },
    });
    expect(advise(t, "up", "decrease")).toEqual({ kind: "feedsBelow", beneficiaryIds: ["x", "z"] });
  });

  it("届かない行より下の行、またはかけらで止まる行が下に無い行は belowShortRows", () => {
    const t = build({
      x: { reached: false, factor: "shards", boost: 5 },
      low: { boost: 10 },
    });
    expect(advise(t, "low", "decrease")).toEqual({ kind: "noEffect", reason: "belowShortRows" });
    const candyOnly = build({ up: { boost: 10 }, x: { reached: false, factor: "candy", boost: 5 } });
    expect(advise(candyOnly, "up", "decrease")).toEqual({ kind: "noEffect", reason: "belowShortRows" });
  });
});

describe("receiverNotices（§6.1、§6.2、D43）", () => {
  function record(before: CalcRow, over: Partial<GiverRecord> = {}): GiverRecord {
    return { before, m0: 100, boost: 0, candy: 50, ...over };
  }
  function withReceiver(t: ReturnType<typeof build>, receiverId: string | null, givers: string[] = []): FineTuneState {
    return {
      ...t.state,
      receiverId,
      givers: entriesToObject(givers.map((id) => [id, record(t.rows.find((r) => r.id === id)!)])),
    };
  }
  const latestOf = (t: ReturnType<typeof build>) => ({ version: 0, result: t.result });

  it("受け取る側がいないときは何も出さない", () => {
    const t = build({ g: {}, b: { reached: false, factor: "candy" } });
    expect(receiverNotices(withReceiver(t, null, ["g"]), t.evaluated, latestOf(t))).toEqual([]);
  });

  it("受け取る側より上にゆずれるポケモンがいないとき noGivers", () => {
    const t = build({ b: { reached: false, factor: "candy" }, g: {} });
    expect(receiverNotices(withReceiver(t, "b"), t.evaluated, latestOf(t))).toEqual([{ kind: "noGivers", receiverId: "b" }]);
    // 上に使うアメが1個以上の行があれば出ない
    const withUpper = build({ g: {}, b: { reached: false, factor: "candy" } });
    expect(receiverNotices(withReceiver(withUpper, "b"), withUpper.evaluated, latestOf(withUpper))).toEqual([]);
    // 上の行の使うアメが0なら noGivers
    const zero = build({ g: { need: 0 }, b: { reached: false, factor: "candy" } });
    expect(receiverNotices(withReceiver(zero, "b"), zero.evaluated, latestOf(zero))).toEqual([{ kind: "noGivers", receiverId: "b" }]);
    // 記録のある行は上にいればゆずれる側に数える
    const recorded = build({ g: { need: 0 }, b: { reached: false, factor: "candy" } });
    expect(receiverNotices(withReceiver(recorded, "b", ["g"]), recorded.evaluated, latestOf(recorded)).some((n) => n.kind === "noGivers")).toBe(false);
  });

  it("記録のある行が受け取る側より下なら belowReceiver（受け取る側が届いていても出る）", () => {
    const t = build({ top: {}, b: { reached: true }, g: {} });
    expect(receiverNotices(withReceiver(t, "b", ["g"]), t.evaluated, latestOf(t))).toEqual([
      { kind: "belowReceiver", giverId: "g", receiverId: "b" },
    ]);
    // 結果が無くても出す
    expect(receiverNotices(withReceiver(t, "b", ["g"]), t.evaluated, null)).toEqual([
      { kind: "belowReceiver", giverId: "g", receiverId: "b" },
    ]);
  });

  it("間の届かない行が受け取れるものを使えるとき takenFirst。使えないときは出ない", () => {
    // 万能アメ: 間の行 x（アメで止まっている）が先に受け取る
    const universal = build({
      g: { supply: supplyOf({ universal: 2 }), family: "f1" },
      x: { reached: false, factor: "candy", family: "f2", type: "water" },
      b: { reached: false, factor: "candy", family: "f3", type: "fire" },
    });
    expect(receiverNotices(withReceiver(universal, "b", ["g"]), universal.evaluated, latestOf(universal))).toEqual([
      { kind: "takenFirst", takerId: "x", giverIds: ["g"], receiverId: "b" },
    ]);
    // 浮くのが g の種族アメだけで、間の行 x は別の進化系: 先に取られない（B も別の進化系なので受け取れるものも無い）
    const speciesOnly = build({
      g: { supply: supplyOf({ species: 40 }), family: "f1" },
      x: { reached: false, factor: "candy", family: "f2" },
      b: { reached: false, factor: "candy", family: "f1" },
    });
    expect(receiverNotices(withReceiver(speciesOnly, "b", ["g"]), speciesOnly.evaluated, latestOf(speciesOnly))).toEqual([]);
    // 間の行がアメ以外で止まっているときも先に取らない
    const shardsRow = build({
      g: { supply: supplyOf({ universal: 2 }) },
      x: { reached: false, factor: "shards" },
      b: { reached: false, factor: "candy" },
    });
    expect(receiverNotices(withReceiver(shardsRow, "b", ["g"]), shardsRow.evaluated, latestOf(shardsRow))).toEqual([]);
  });

  it("受け取る側が在庫のみの行なら、タイプアメ・万能アメを受け取れるものに数えない", () => {
    const itemsOnly = build({
      g: { supply: supplyOf({ type: 3, universal: 3 }), family: "f1", type: "water" },
      x: { reached: false, factor: "candy", family: "f2", type: "water" },
      b: { reached: false, factor: "candy", family: "f3", type: "water", items: false },
    });
    expect(receiverNotices(withReceiver(itemsOnly, "b", ["g"]), itemsOnly.evaluated, latestOf(itemsOnly))).toEqual([]);
    // 同じ進化系の種族アメなら受け取れる。間の行 x が同じ進化系なら先に取る
    const sameFamily = build({
      g: { supply: supplyOf({ species: 3, universal: 3 }), family: "f1" },
      x: { reached: false, factor: "candy", family: "f1" },
      b: { reached: false, factor: "candy", family: "f1", items: false },
    });
    expect(receiverNotices(withReceiver(sameFamily, "b", ["g"]), sameFamily.evaluated, latestOf(sameFamily))).toEqual([
      { kind: "takenFirst", takerId: "x", giverIds: ["g"], receiverId: "b" },
    ]);
    // 間の行は在庫のみでない別の進化系で、受け取れるのは種族アメだけ → 先に取られない
    const otherFamily = build({
      g: { supply: supplyOf({ species: 3, universal: 3 }), family: "f1" },
      x: { reached: false, factor: "candy", family: "f2" },
      b: { reached: false, factor: "candy", family: "f1", items: false },
    });
    expect(receiverNotices(withReceiver(otherFamily, "b", ["g"]), otherFamily.evaluated, latestOf(otherFamily))).toEqual([]);
  });

  it("受け取る側がかけらで止まっているとき、かけらで止まる間の行が先に取る", () => {
    const t = build({
      g: { shardsUsed: 500 },
      x: { reached: false, factor: "shards" },
      b: { reached: false, factor: "shards" },
    });
    expect(receiverNotices(withReceiver(t, "b", ["g"]), t.evaluated, latestOf(t))).toEqual([
      { kind: "takenFirst", takerId: "x", giverIds: ["g"], receiverId: "b" },
    ]);
  });

  it("注意は記録のある行についてだけ。記録の無い行・受け取る側が届いているときは takenFirst を出さない", () => {
    const universal = {
      g: { supply: supplyOf({ universal: 2 }) },
      x: { reached: false, factor: "candy" as const },
      b: { reached: false, factor: "candy" as const },
    };
    const t = build(universal);
    expect(receiverNotices(withReceiver(t, "b", []), t.evaluated, latestOf(t))).toEqual([]);
    const reachedReceiver = build({ ...universal, b: { reached: true } });
    expect(receiverNotices(withReceiver(reachedReceiver, "b", ["g"]), reachedReceiver.evaluated, latestOf(reachedReceiver))).toEqual([]);
    // 結果が無いとき（latest が null）は takenFirst を出さない
    expect(receiverNotices(withReceiver(t, "b", ["g"]), t.evaluated, null)).toEqual([]);
  });

  it("ゆずる側が複数でも、同じ行が先に取るなら1つにまとめる", () => {
    const t = build({
      g1: { supply: supplyOf({ universal: 2 }) },
      g2: { supply: supplyOf({ universal: 2 }) },
      x: { reached: false, factor: "candy" },
      b: { reached: false, factor: "candy" },
    });
    expect(receiverNotices(withReceiver(t, "b", ["g1", "g2"]), t.evaluated, latestOf(t))).toEqual([
      { kind: "takenFirst", takerId: "x", giverIds: ["g1", "g2"], receiverId: "b" },
    ]);
  });
});
