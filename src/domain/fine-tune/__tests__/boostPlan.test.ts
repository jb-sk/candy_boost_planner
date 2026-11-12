import { describe, expect, it } from "vitest";
import { perfBudgetMs } from "../../../../tests/unit/level-planner/perfBudget";
import { solveLevelPlan } from "../../level-planner/core/solveLevelPlan";
import type { BoostKind, LevelPlannerInput, LevelPlannerResult, PokemonPlanInput, PokemonPlanResult } from "../../level-planner/types";
import { getCandyFamilyKey } from "../../pokesleep/candy-family";
import { minBoostForTarget } from "../../pokesleep/minBoostForTarget";
import { pokemonMaster } from "../../pokesleep/pokemon-master";
import { simulateCandyRun } from "../../pokesleep/simulateCandyBudget";
import type { ExpGainNature } from "../../types";
import { __boostPlanTestHooks, createBoostPlanner, planBoosts, type BoostPlan, type RaiseSaving } from "../boostPlan";

/**
 * 全体のLvを伸ばすのアメブの配り方（モデル）を、本物のソルバーで確かめる。
 * テストデータは実在のポケモン（図鑑番号・タイプ・EXPタイプ・種族アメの系統は pokemon-master / candy-family から引く）:
 *   ピカチュウ 25（でんき・600）・ヒトカゲ 4（ほのお・600）・イーブイ 133（ノーマル・600）・フシギダネ 1（くさ・600）
 *   ゼニガメ 7（みず・600）・ミニリュウ 147（ドラゴン・900）・ラティアス 380（ドラゴン・1080）・ミュウ 151（エスパー・1320）
 */

function master(pokedexId: number) {
  const entry = pokemonMaster.find((m) => m.pokedexId === pokedexId && m.form === 0);
  if (entry === undefined) throw new Error(`pokemon-master に ${pokedexId} が無い`);
  return entry;
}

interface MonSpec {
  dex: number;
  /** 行の識別子（同じポケモンを2匹並べるときに分ける） */
  tag?: string;
  level?: number;
  expGot?: number;
  target: number;
  targetExp?: number;
  /** アメブ。数値か、全アメブ点（'full'。省略も同じ） */
  boost?: number | "full";
  candyTarget?: { total: number; boosted: number };
  nature?: ExpGainNature;
  itemsAllowed?: boolean;
}

function mon(spec: MonSpec, kind: BoostKind): PokemonPlanInput {
  const m = master(spec.dex);
  const level = spec.level ?? 10;
  const expGot = spec.expGot ?? 0;
  const nature = spec.nature ?? "normal";
  const full = minBoostForTarget({
    srcLevel: level, targetLevel: spec.target, targetExpInLevel: spec.targetExp ?? 0, expType: m.expType, nature,
    boostKind: kind, maxBoost: Number.MAX_SAFE_INTEGER, expGot,
  });
  const boost = spec.boost === undefined || spec.boost === "full" ? full : spec.boost;
  return {
    pokemonId: `${m.nameJa}${spec.tag ?? ""}`,
    pokedexId: spec.dex,
    candyFamilyKey: getCandyFamilyKey(spec.dex),
    name: m.nameJa,
    type: m.type,
    currentLevel: level,
    currentExpInLevel: expGot,
    targetLevel: spec.target,
    targetExpInLevel: spec.targetExp ?? 0,
    candyTarget: spec.candyTarget === undefined ? undefined : { totalCandyUnits: spec.candyTarget.total, boostedCandyUnits: spec.candyTarget.boosted },
    expType: m.expType,
    nature,
    requestedBoostCandy: boost,
    boostAllowed: true,
    itemsAllowed: spec.itemsAllowed,
    priorityIndex: 0,
  };
}

interface Stock {
  /** 種族アメ（図鑑番号 → 個数。系統キーへ直す） */
  species?: Record<number, number>;
  type?: Record<string, { s: number; m: number }>;
  universal?: { s: number; m: number; l: number };
}

interface Options {
  shards: number;
  boostLimit?: number;
  kind?: BoostKind;
  stock?: Stock;
}

function plannerInput(specs: MonSpec[], opts: Options): LevelPlannerInput {
  const kind = opts.kind ?? "full";
  const species: Record<string, number> = {};
  for (const [dex, count] of Object.entries(opts.stock?.species ?? {})) species[getCandyFamilyKey(Number(dex))] = count;
  return {
    pokemonList: specs.map((s, i) => ({ ...mon(s, kind), priorityIndex: i })),
    dreamShards: opts.shards,
    boost: { kind, limit: opts.boostLimit ?? 3000 },
    candyInventory: {
      species,
      typeCandy: opts.stock?.type ?? {},
      universal: opts.stock?.universal ?? { s: 0, m: 0, l: 0 },
    },
  };
}

const solve = (input: LevelPlannerInput): LevelPlannerResult => solveLevelPlan(input);

function withBoosts(input: LevelPlannerInput, boosts: ReadonlyMap<string, number>): LevelPlannerInput {
  return {
    ...input,
    pokemonList: input.pokemonList.map((p) => (boosts.has(p.pokemonId) ? { ...p, requestedBoostCandy: boosts.get(p.pokemonId)! } : p)),
  };
}

/** 1行の到達点を比べる（raise.ts の `compareLines` と同じ）。a が良ければ正 */
function compareLine(a: PokemonPlanResult["reachableLine"], b: PokemonPlanResult["reachableLine"]): number {
  if (a.candyDemandMet && b.candyDemandMet) return 0;
  if (a.candyDemandMet !== b.candyDemandMet) return a.candyDemandMet ? 1 : -1;
  if (a.level !== b.level) return a.level - b.level;
  return a.expInLevel - b.expInLevel;
}

function byId(result: LevelPlannerResult): Map<string, PokemonPlanResult> {
  return new Map(result.pokemonResults.map((r) => [r.pokemonId, r]));
}

/** 上の行から比べる（raise.ts の `compareResults` と同じ。最初に違う行で決める）。a が良ければ正 */
function compare(a: LevelPlannerResult, b: LevelPlannerResult, input: LevelPlannerInput): number {
  const am = byId(a);
  const bm = byId(b);
  for (const p of input.pokemonList) {
    const pa = am.get(p.pokemonId)?.reachableLine;
    const pb = bm.get(p.pokemonId)?.reachableLine;
    if (pa === undefined || pb === undefined) continue;
    const diff = compareLine(pa, pb);
    if (diff !== 0) return diff;
  }
  return 0;
}

function boostsOf(plan: BoostPlan): ReadonlyMap<string, number> {
  if (plan.kind !== "plan") throw new Error("plan が返らなかった");
  return plan.boosts;
}

const sum = (result: LevelPlannerResult, pick: (line: PokemonPlanResult["reachableLine"]) => number): number =>
  result.pokemonResults.reduce((total, r) => total + pick(r.reachableLine), 0);

interface Raised {
  input: LevelPlannerInput;
  current: LevelPlannerResult;
  plan: BoostPlan;
  next: LevelPlannerInput;
  after: LevelPlannerResult;
}

/** 今の結果を解き、配り方を求め、アメブを入れて解き直す */
function raise(specs: MonSpec[], opts: Options, saving: RaiseSaving, variable?: readonly string[], margins?: ReadonlyMap<string, number>): Raised {
  const input = plannerInput(specs, opts);
  const current = solve(input);
  const variableIds = new Set(variable ?? input.pokemonList.map((p) => p.pokemonId));
  const plan = planBoosts({ plannerInput: input, current, variableIds, margins }, saving);
  const next = plan.kind === "plan" ? withBoosts(input, plan.boosts) : input;
  return { input, current, plan, next, after: plan.kind === "plan" ? solve(next) : current };
}

function expectRaised(r: Raised): void {
  expect(r.plan.kind).toBe("plan");
  // 上の行から比べて、伸びている（上の行の到達点は下がらない）
  expect(compare(r.after, r.current, r.input)).toBeGreaterThan(0);
}

const requestedOf = (input: LevelPlannerInput, id: string): number => input.pokemonList.find((p) => p.pokemonId === id)!.requestedBoostCandy;

// 共通の場面 ---------------------------------------------------------------

/**
 * (a) e2e の GIVE_AND_RECEIVE に近い（tests/e2e/12-fine-tune.spec.ts 冒頭）。かけらが足りず、ヒトカゲが届かない。
 * フシギダネはアメの在庫が少なく届かない。アメの余っている上の行（ピカチュウ・イーブイ）のアメブを減らすと、浮いたかけらで届く
 */
const GIVE_AND_RECEIVE_SPECS: MonSpec[] = [
  { dex: 25, target: 40 }, { dex: 1, target: 50 }, { dex: 133, target: 40 }, { dex: 4, target: 60 },
];
const GIVE_AND_RECEIVE: Options = { shards: 1450000, stock: { species: { 25: 99999, 1: 100, 133: 99999, 4: 99999 } } };

describe("planBoosts: 到達を伸ばす", () => {
  it("(a) かけらで止まる下の行が、種族アメの余る上の行のアメブを減らして届く", () => {
    // ヒトカゲを動かさない（固定）。全アメブ点（926）で届くのに要るかけらから 6 万だけ少ないかけらにして、
    // 上のピカチュウ・イーブイが減らして浮いたかけらでヒトカゲが届くようにする
    const alone = solve(plannerInput([GIVE_AND_RECEIVE_SPECS[3]!], { shards: 1e9, stock: { species: { 4: 99999 } } })).pokemonResults[0]!.reachableLine;
    const upper = solve(plannerInput(GIVE_AND_RECEIVE_SPECS.slice(0, 3), GIVE_AND_RECEIVE)).pokemonResults.reduce((total, p) => total + p.reachableLine.dreamShardsUsed, 0);
    const opts: Options = { ...GIVE_AND_RECEIVE, shards: upper + alone.dreamShardsUsed - 60000 };
    const r = raise(GIVE_AND_RECEIVE_SPECS, opts, "candy", ["ピカチュウ", "フシギダネ", "イーブイ"]);
    expectRaised(r);
    const before = byId(r.current).get("ヒトカゲ")!.reachableLine;
    const after = byId(r.after).get("ヒトカゲ")!.reachableLine;
    expect(before.candyDemandMet).toBe(false);
    expect(after.candyDemandMet).toBe(true);
    const boosts = boostsOf(r.plan);
    const reduced = ["ピカチュウ", "イーブイ"].filter((id) => boosts.get(id)! < requestedOf(r.input, id));
    expect(reduced.length).toBeGreaterThan(0);
    // 上の行はどれも下がらない
    for (const p of r.input.pokemonList.slice(0, 3)) {
      expect(compareLine(byId(r.after).get(p.pokemonId)!.reachableLine, byId(r.current).get(p.pokemonId)!.reachableLine)).toBeGreaterThanOrEqual(0);
    }
  });

  it("(a2) 全員を動かせるときも、届かないヒトカゲが届く（自分のアメブも減らせる）", () => {
    const r = raise(GIVE_AND_RECEIVE_SPECS, GIVE_AND_RECEIVE, "candy");
    expectRaised(r);
    expect(byId(r.after).get("ヒトカゲ")!.reachableLine.candyDemandMet).toBe(true);
    expect(r.plan.kind === "plan" && r.plan.predictedMet.has("ヒトカゲ")).toBe(true);
  });

  it("(b) アメブ枠で止まる行が、上の行のアメブを減らして枠を空け、自分のアメブを増やして伸びる", () => {
    // ヒトカゲは種族アメ 600 個で全アメブ点（926）に届かない。枠 450 をピカチュウが使っていて、ヒトカゲには 152 しか回らない
    const specs: MonSpec[] = [{ dex: 25, target: 40 }, { dex: 4, target: 60 }];
    const opts: Options = { shards: 12000000, boostLimit: 450, stock: { species: { 25: 99999, 4: 600 } } };
    const r = raise(specs, opts, "candy");
    expectRaised(r);
    const boosts = boostsOf(r.plan);
    expect(boosts.get("ピカチュウ")!).toBeLessThan(298);
    expect(boosts.get("ヒトカゲ")!).toBeGreaterThan(152);
    const before = byId(r.current).get("ヒトカゲ")!.reachableLine;
    const after = byId(r.after).get("ヒトカゲ")!.reachableLine;
    expect(after.level).toBeGreaterThan(before.level);
    // 枠は超えない
    expect(sum(r.after, (l) => l.boostedCandyUnits)).toBeLessThanOrEqual(450);
    // 上のピカチュウは届いたまま
    expect(byId(r.after).get("ピカチュウ")!.reachableLine.candyDemandMet).toBe(true);
  });

  it("(c) 万能アメを共有していて、上の行のアメブを増やすと万能アメが浮いて下の行が届く", () => {
    // ピカチュウ（でんき）とヒトカゲ（ほのお）は種族もタイプも別で、取り合うのは万能アメ L 7 個（価値 700）だけ。
    // ピカチュウのアメブが 100 個だと通常アメが多く要り（498 個）、万能アメを使い切ってヒトカゲが届かない
    const specs: MonSpec[] = [{ dex: 25, target: 40, boost: 100 }, { dex: 4, target: 40 }];
    const opts: Options = { shards: 100000000, stock: { species: { 25: 50, 4: 30 }, universal: { s: 0, m: 0, l: 7 } } };
    const r = raise(specs, opts, "candy");
    expectRaised(r);
    expect(boostsOf(r.plan).get("ピカチュウ")!).toBeGreaterThan(100);
    expect(byId(r.current).get("ヒトカゲ")!.reachableLine.candyDemandMet).toBe(false);
    expect(byId(r.after).get("ヒトカゲ")!.reachableLine.candyDemandMet).toBe(true);
    expect(byId(r.after).get("ピカチュウ")!.reachableLine.candyDemandMet).toBe(true);
  });

  it("(d) 2行を同時に動かさないと伸びない場面", () => {
    // 作り方: ピカチュウ・イーブイ（どちらも Lv10→40・種族アメは全アメブ点の要る数 +3 個だけ）がかけらの大半を使い、
    // ヒトカゲ（動かさない。固定）が Lv56 で、次のアメブ1個ぶんのかけら（約 2,185）に届かずに止まっている。
    // ピカチュウ1行が減らせるアメブは3個ぶん（アメが3個増えるところまで）で、浮くかけらは約 1,656。
    // ヒトカゲの止まった余り 117 を足しても 1,773 で次の1個に足りない。イーブイ1行でも同じ。
    // 2行とも減らすと約 3,312 + 117 で次の1個（2,185）に届き、ヒトカゲが伸びる
    const specs: MonSpec[] = [{ dex: 25, target: 40 }, { dex: 133, target: 40 }, { dex: 4, target: 60 }];
    const opts: Options = { shards: 1259000, stock: { species: { 25: 302, 133: 302, 4: 99999 } } };
    const input = plannerInput(specs, opts);
    const current = solve(input);
    expect(current.summary.dreamShardsRemaining).toBe(117);
    expect(byId(current).get("ヒトカゲ")!.reachableLine.candyDemandMet).toBe(false);
    const plan = (ids: string[]) => planBoosts({ plannerInput: input, current, variableIds: new Set(ids) }, "candy");
    expect(plan(["ピカチュウ"]).kind).toBe("none");
    expect(plan(["イーブイ"]).kind).toBe("none");
    const both = plan(["ピカチュウ", "イーブイ"]);
    expect(both.kind).toBe("plan");
    // 解き直して伸びる
    const after = solve(withBoosts(input, boostsOf(both)));
    expect(compare(after, current, input)).toBeGreaterThan(0);
    const before = byId(current).get("ヒトカゲ")!.reachableLine;
    const now = byId(after).get("ヒトカゲ")!.reachableLine;
    expect(now.expInLevel).toBeGreaterThan(before.expInLevel);
  });

  it("(e) 動かさない行のアメブは変えない（boosts に入らない）", () => {
    const variable = ["ピカチュウ", "フシギダネ", "イーブイ"];
    const r = raise(GIVE_AND_RECEIVE_SPECS, GIVE_AND_RECEIVE, "shards", variable);
    const boosts = boostsOf(r.plan);
    expect([...boosts.keys()].sort()).toEqual([...variable].sort());
    expect(boosts.has("ヒトカゲ")).toBe(false);
    // 入れた入力でも、動かさない行の要求は元のまま
    expect(requestedOf(r.next, "ヒトカゲ")).toBe(requestedOf(r.input, "ヒトカゲ"));
  });

  it("(f) アメ節約とかけら節約で配り方が分かれる（アメ節約はアメブが多く使うアメが少ない、かけら節約はかけらが少ない）", () => {
    // e2e の SAVING_SPLIT に近い。ピカチュウは全アメブ点まで入れても種族アメが足りず、イーブイはアメブ 0 で種族アメが足りない。
    // イーブイが自分のアメブを増やすと届く。増やす量が多いほどアメが少なくかけらが多い
    const specs: MonSpec[] = [{ dex: 25, target: 25 }, { dex: 133, target: 20, boost: 0 }];
    const opts: Options = { shards: 100000000, stock: { species: { 25: 20, 133: 100 } } };
    const candy = raise(specs, opts, "candy");
    const shards = raise(specs, opts, "shards");
    expectRaised(candy);
    expectRaised(shards);
    const candyBoost = boostsOf(candy.plan).get("イーブイ")!;
    const shardsBoost = boostsOf(shards.plan).get("イーブイ")!;
    expect(candyBoost).toBeGreaterThan(shardsBoost);
    expect(byId(candy.after).get("イーブイ")!.reachableLine.candyDemandMet).toBe(true);
    expect(byId(shards.after).get("イーブイ")!.reachableLine.candyDemandMet).toBe(true);
    expect(sum(candy.after, (l) => l.totalCandyUnitsUsed)).toBeLessThan(sum(shards.after, (l) => l.totalCandyUnitsUsed));
    expect(sum(shards.after, (l) => l.dreamShardsUsed)).toBeLessThan(sum(candy.after, (l) => l.dreamShardsUsed));
  });

  it("(h) 個数の行（candyTarget）は動かさない。かけらを空ければ個数を配り終えて届く", () => {
    // ヒトカゲはアメ 300 個・アメブ 300 個の個数指定（Lv10 からアメブだけで Lv40+82）。かけらが 3,000 足りず、アメブを使い切れない。
    // 上のピカチュウのアメブを減らすと、浮いたかけらで個数を配り終える
    const specs: MonSpec[] = [{ dex: 25, target: 40 }, { dex: 4, target: 60, candyTarget: { total: 300, boosted: 300 } }];
    const alone = solve(plannerInput([specs[1]!], { shards: 1e9, stock: { species: { 4: 99999 } } })).pokemonResults[0]!.reachableLine;
    const opts: Options = { shards: 178289 + alone.dreamShardsUsed - 3000, stock: { species: { 25: 99999, 4: 99999 } } };
    const r = raise(specs, opts, "candy", ["ピカチュウ"]);
    expectRaised(r);
    expect(boostsOf(r.plan).has("ヒトカゲ")).toBe(false);
    expect(byId(r.current).get("ヒトカゲ")!.reachableLine.candyDemandMet).toBe(false);
    expect(byId(r.after).get("ヒトカゲ")!.reachableLine.candyDemandMet).toBe(true);
    expect(r.plan.kind === "plan" && r.plan.predictedMet.has("ヒトカゲ")).toBe(true);
    // 動かさない個数の行のアメブはそのまま（要求が同じ）
    expect(requestedOf(r.next, "ヒトカゲ")).toBe(requestedOf(r.input, "ヒトカゲ"));
  });

  it("(h2) 動かす行に個数の行（時間の睡眠目標）が入っていても、その行は到達点で表す（全員届いていれば伸びない）", () => {
    // 個数指定の行を動かす行に入れた場合、到達点（今のアメの数とアメブで届く点）を目標とみなす
    const specs: MonSpec[] = [{ dex: 25, target: 40 }, { dex: 4, target: 60, boost: 300, candyTarget: { total: 300, boosted: 300 } }];
    const input = plannerInput(specs, { shards: 1e9, stock: { species: { 25: 99999, 4: 99999 } } });
    const current = solve(input);
    expect(sum(current, (l) => (l.candyDemandMet ? 0 : 1))).toBe(0);
    const plan = planBoosts({ plannerInput: input, current, variableIds: new Set(["ピカチュウ", "ヒトカゲ"]) }, "candy");
    expect(plan.kind).toBe("none");
  });

  it("(i) 今のアメブを残す規則: 要るアメ・かけらが同じになる行は今のアメブのまま入れる", () => {
    // ピカチュウは全アメブ点を超える 5000 を要求していて、種族アメ 100 個で止まる（100 個ぜんぶアメブ）。決めたアメブ（約 100）でも
    // 今の 5000（全アメブ点で抑える）でも要るアメ・かけらは同じなので、5000 のまま。
    // 要求が始めの点の行（ヒトカゲは目標 = 現在 Lv）も今のまま。イーブイは自分のアメブを増やして届くので変わる
    const specs: MonSpec[] = [{ dex: 25, target: 40, boost: 5000 }, { dex: 133, target: 20, boost: 0 }, { dex: 4, target: 10 }];
    const r = raise(specs, { shards: 100000000, stock: { species: { 25: 100, 133: 100, 4: 100 } } }, "candy");
    expectRaised(r);
    const boosts = boostsOf(r.plan);
    expect(boosts.get("ピカチュウ")).toBe(5000);
    expect(boosts.get("ヒトカゲ")).toBe(0);
    expect(boosts.get("イーブイ")!).toBeGreaterThan(0);
  });

  it("(i2) 決めたアメブと今のアメブで要るアメ・かけらが違う行は、決めたアメブを入れる", () => {
    const r = raise(GIVE_AND_RECEIVE_SPECS, GIVE_AND_RECEIVE, "candy");
    expect(boostsOf(r.plan).get("ヒトカゲ")!).toBeLessThan(requestedOf(r.input, "ヒトカゲ"));
  });

  it("margins: 行の要るアメに足した個数だけ、その行が届きにくくなる（直し）", () => {
    const specs: MonSpec[] = [{ dex: 25, target: 40, boost: 100 }, { dex: 4, target: 40 }];
    const opts: Options = { shards: 100000000, stock: { species: { 25: 50, 4: 30 }, universal: { s: 0, m: 0, l: 7 } } };
    const plain = raise(specs, opts, "candy");
    expect(plain.plan.kind === "plan" && plain.plan.predictedMet.has("ヒトカゲ")).toBe(true);
    // ヒトカゲに 1000 個足すと、万能アメ L 7 個では配れない。届く行にならない
    const withMargin = raise(specs, opts, "candy", undefined, new Map([["ヒトカゲ", 1000]]));
    expect(withMargin.plan.kind === "plan" && withMargin.plan.predictedMet.has("ヒトカゲ")).toBe(false);
  });

  it("同じ入力なら同じ配り方（決定的）", () => {
    const input = plannerInput(GIVE_AND_RECEIVE_SPECS, GIVE_AND_RECEIVE);
    const current = solve(input);
    const variableIds = new Set(input.pokemonList.map((p) => p.pokemonId));
    const a = planBoosts({ plannerInput: input, current, variableIds }, "shards");
    const b = planBoosts({ plannerInput: input, current, variableIds }, "shards");
    expect(a).toEqual(b);
  });
});

describe("planBoosts: 伸びない", () => {
  it("(g) 1匹・種族アメだけ・すでに全アメブ点: none", () => {
    // ピカチュウ1匹。全アメブ点（298）を要求していて、種族アメ 100 個ぜんぶアメブで使っている。これ以上は伸ばせない
    const input = plannerInput([{ dex: 25, target: 40 }], { shards: 100000000, stock: { species: { 25: 100 } } });
    const current = solve(input);
    expect(byId(current).get("ピカチュウ")!.reachableLine.candyDemandMet).toBe(false);
    const ids = new Set(["ピカチュウ"]);
    expect(planBoosts({ plannerInput: input, current, variableIds: ids }, "candy")).toEqual({ kind: "none" });
    expect(planBoosts({ plannerInput: input, current, variableIds: ids }, "shards")).toEqual({ kind: "none" });
  });

  it("全員届いている: none", () => {
    const specs: MonSpec[] = [{ dex: 25, target: 40 }, { dex: 133, target: 40 }];
    const input = plannerInput(specs, { shards: 100000000, stock: { species: { 25: 99999, 133: 99999 } } });
    const current = solve(input);
    const ids = new Set(input.pokemonList.map((p) => p.pokemonId));
    expect(sum(current, (l) => (l.candyDemandMet ? 0 : 1))).toBe(0);
    expect(planBoosts({ plannerInput: input, current, variableIds: ids }, "candy")).toEqual({ kind: "none" });
  });

  it("アメブなしのスロット（boost.kind が none）・動かす行が空: none", () => {
    const none = plannerInput([{ dex: 25, target: 40 }], { shards: 1000000, kind: "none", stock: { species: { 25: 100 } } });
    const noneResult = solve(none);
    const ids = new Set(["ピカチュウ"]);
    expect(planBoosts({ plannerInput: none, current: noneResult, variableIds: ids }, "candy")).toEqual({ kind: "none" });

    const input = plannerInput(GIVE_AND_RECEIVE_SPECS, GIVE_AND_RECEIVE);
    const current = solve(input);
    expect(planBoosts({ plannerInput: input, current, variableIds: new Set() }, "candy")).toEqual({ kind: "none" });
  });
});

describe("モデルの要るアメ・かけらはソルバーの経路と一致する", () => {
  it("(j) calcExpAndCandyMixed を使う target 行の要るアメ・かけらが、simulateCandyRun（アメブ b・通常アメ無制限で到達点に止まる）と同じ", () => {
    const dexes = [25, 147, 380, 151]; // EXPタイプ 600・900・1080・1320
    const starts = [
      { level: 1, expGot: 0 }, { level: 10, expGot: 5 }, { level: 24, expGot: 13 }, { level: 29, expGot: 3 }, { level: 45, expGot: 100 },
    ];
    const points = [{ level: 30, exp: 0 }, { level: 40, exp: 17 }, { level: 60, exp: 0 }, { level: 70, exp: 0 }];
    let checked = 0;
    for (const dex of dexes) {
      const m = master(dex);
      for (const kind of ["full", "mini"] as const) {
        for (const nature of ["up", "normal", "down"] as const) {
          for (const start of starts) {
            for (const point of points) {
              if (point.level <= start.level) continue;
              const subject = { src: start.level, expGot: start.expGot, expType: m.expType, nature };
              const segments = __boostPlanTestHooks.boostSegments(subject, kind, point);
              const allBoost = segments[segments.length - 1] ?? 0;
              const full = minBoostForTarget({
                srcLevel: start.level, targetLevel: point.level, targetExpInLevel: point.exp, expType: m.expType, nature, boostKind: kind,
                maxBoost: Number.MAX_SAFE_INTEGER, expGot: start.expGot,
              });
              expect(full).toBeLessThanOrEqual(allBoost);
              const bs = new Set([0, 1, 2, Math.floor(full / 3), Math.floor(full / 2), Math.max(0, full - 1), full, allBoost, allBoost + 5]);
              for (const b of bs) {
                const run = simulateCandyRun(
                  { currentLevel: start.level, currentExpInLevel: start.expGot, expType: m.expType, nature },
                  {
                    boostBudget: b,
                    normalBudget: Infinity,
                    totalCap: Infinity,
                    shardLimit: Infinity,
                    kind,
                    shouldContinue: (level, exp) => level < point.level || (level === point.level && exp < point.exp),
                  },
                );
                const need = __boostPlanTestHooks.targetNeed(subject, kind, point, b);
                const label = `${m.nameJa} ${kind} ${nature} Lv${start.level}+${start.expGot} → Lv${point.level}+${point.exp} b=${b}`;
                expect({ label, n: need.n, h: need.h, boost: need.boost }).toEqual({ label, n: run.boostUsed + run.normalUsed, h: run.shards, boost: run.boostUsed });
                checked += 1;
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("全部アメブで上げるときの段（Lv ごとの個数の累計）は昇順で、最後が全アメブの総数", () => {
    const subject = { src: 10, expGot: 0, expType: master(4).expType, nature: "normal" as const };
    const cum = __boostPlanTestHooks.boostSegments(subject, "full", { level: 60, exp: 0 });
    expect(cum.length).toBeGreaterThan(20);
    for (let i = 1; i < cum.length; i++) expect(cum[i]!).toBeGreaterThan(cum[i - 1]!);
    const full = minBoostForTarget({
      srcLevel: 10, targetLevel: 60, expType: subject.expType, nature: subject.nature, boostKind: "full", maxBoost: Number.MAX_SAFE_INTEGER,
    });
    expect(cum[cum.length - 1]!).toBeGreaterThanOrEqual(full);
    expect(cum[cum.length - 1]! - full).toBeLessThanOrEqual(1);
  });

  it("動かす行のアメブの上限（boostCeiling）は、ソルバーの上限（minBoostForTarget）と同じ", () => {
    let checked = 0;
    for (const dex of [25, 147, 380, 151]) { // EXPタイプ 600・900・1080・1320
      const { expType } = master(dex);
      for (const kind of ["full", "mini"] as const) {
        for (const nature of ["up", "normal", "down"] as const) {
          for (const start of [{ level: 1, expGot: 0 }, { level: 10, expGot: 5 }, { level: 29, expGot: 17 }, { level: 45, expGot: 100 }]) {
            for (let level = start.level; level <= 70; level += 3) {
              for (const exp of [0, 1, 40, 133]) {
                const point = { level, exp: level >= 70 ? 0 : exp };
                const ceiling = __boostPlanTestHooks.boostCeiling({ src: start.level, expGot: start.expGot, expType, nature }, kind, point);
                const solver = minBoostForTarget({
                  srcLevel: start.level, targetLevel: point.level, targetExpInLevel: point.exp, expType, nature, boostKind: kind,
                  maxBoost: Number.MAX_SAFE_INTEGER, expGot: start.expGot,
                });
                expect({ dex, kind, nature, start, point, ceiling }).toEqual({ dex, kind, nature, start, point, ceiling: solver });
                checked += 1;
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });
});

describe("最大流", () => {
  const { Flow } = __boostPlanTestHooks;

  it("(k) 付け替え: A は種族アメか万能アメ、B は種族アメだけ。B を足すと A が万能アメへ移って両方配れる", () => {
    // 資源 0 = 種族アメ（A・B）、1 = 万能アメ（A だけ）。どちらも 10
    const flow = new Flow([10, 10], [[0, 1], [0]]);
    expect(flow.add(0, 10)).toBe(10); // A は先に見つかる種族アメへ
    expect(flow.add(1, 10)).toBe(10); // B は種族アメが埋まっているので、A が万能アメへ移る
    expect(flow.add(1, 1)).toBe(0); // B の種族アメはこれ以上無い
    expect(flow.add(0, 1)).toBe(0); // 万能アメも埋まった
    expect(flow.placed).toEqual([10, 10]);
  });

  it("付け替えは2回以上でも通る（C が A を動かし、A が B を動かす）", () => {
    // 資源 0（A・C）、1（A・B）、2（B）。A は 0、B は 1 に置いてから、C が 0 を取るために A→1、B→2 と移る
    const flow = new Flow([5, 5, 5], [[0, 1], [1, 2], [0]]);
    expect(flow.add(0, 5)).toBe(5);
    expect(flow.add(1, 5)).toBe(5);
    expect(flow.add(2, 5)).toBe(5);
    expect(flow.placed).toEqual([5, 5, 5]);
  });

  it("set: 配れないときは何も変えず false。減らす・戻すは常にできる", () => {
    const flow = new Flow([10], [[0], [0]]);
    expect(flow.set(0, 6)).toBe(true);
    expect(flow.set(1, 5)).toBe(false);
    expect(flow.placed).toEqual([6, 0]);
    expect(flow.set(0, 2)).toBe(true);
    expect(flow.set(1, 8)).toBe(true);
    expect(flow.set(0, 3)).toBe(false);
    expect(flow.placed).toEqual([2, 8]);
  });
});

describe("(l) 速さ（10匹）", () => {
  // 決定的な指標（satisfy の呼び出し回数など）で上限を置く。実時間は PERF_WALL_CLOCK=1 のときだけ見る
  const specs: MonSpec[] = [
    { dex: 25, target: 45 }, { dex: 4, level: 20, target: 55 }, { dex: 7, level: 15, target: 50 }, { dex: 133, target: 50 },
    { dex: 147, level: 12, target: 60 }, { dex: 58, target: 45 }, { dex: 79, level: 5, target: 40 }, { dex: 37, target: 50 },
    { dex: 1, target: 50 }, { dex: 380, level: 30, target: 60 },
  ];
  const stock: Stock = {
    species: { 25: 600, 4: 700, 7: 500, 133: 600, 147: 900, 58: 500, 79: 400, 37: 300, 1: 500, 380: 1000 },
    type: { Fire: { s: 40, m: 3 }, Water: { s: 20, m: 2 } },
    universal: { s: 30, m: 10, l: 3 },
  };
  const input = plannerInput(specs, { shards: 6000000, stock });
  const current = solve(input);
  const variableIds = new Set(input.pokemonList.map((p) => p.pokemonId));
  const wall = process.env.PERF_WALL_CLOCK === "1";

  it("planBoosts は satisfy を 60 回以内（行ごとの二分探索。伸びない行は今の進み+1 で打ち切る）、流れの増加路・要るアメの計算も上限内で、伸びる", () => {
    for (const saving of ["candy", "shards"] as const) {
      __boostPlanTestHooks.resetStats();
      const started = performance.now();
      const plan = planBoosts({ plannerInput: input, current, variableIds }, saving);
      const elapsed = performance.now() - started;
      expect(plan.kind).toBe("plan");
      expect(__boostPlanTestHooks.stats.satisfyCalls).toBeLessThanOrEqual(60);
      expect(__boostPlanTestHooks.stats.evalCalls).toBeLessThanOrEqual(1000);
      expect(__boostPlanTestHooks.stats.augments).toBeLessThanOrEqual(5000);
      if (wall) expect(elapsed).toBeLessThanOrEqual(perfBudgetMs(100));
      const after = solve(withBoosts(input, boostsOf(plan)));
      expect(compare(after, current, input)).toBeGreaterThan(0);
    }
  });

  it("createBoostPlanner: 結果は planBoosts と同じで、同じ直しの個数なら到達の決め方を使い回す（かけら節約は satisfy 1回）", () => {
    const planner = createBoostPlanner({ plannerInput: input, current, variableIds });
    const margins = new Map([[input.pokemonList[1]!.pokemonId, 30]]);
    expect(planner.plan("candy")).toEqual(planBoosts({ plannerInput: input, current, variableIds }, "candy"));
    expect(planner.plan("shards")).toEqual(planBoosts({ plannerInput: input, current, variableIds }, "shards"));
    // アメ節約を求めたあとのかけら節約は、配り方を求める1回だけ
    const shardsOnly = createBoostPlanner({ plannerInput: input, current, variableIds });
    shardsOnly.plan("candy");
    __boostPlanTestHooks.resetStats();
    shardsOnly.plan("shards");
    expect(__boostPlanTestHooks.stats.satisfyCalls).toBe(1);
    // 直しの個数を変えても、戻しても、1回ずつ求めたのと同じ
    expect(planner.plan("candy", margins)).toEqual(planBoosts({ plannerInput: input, current, variableIds, margins }, "candy"));
    expect(planner.plan("candy")).toEqual(planBoosts({ plannerInput: input, current, variableIds }, "candy"));
  });
});
