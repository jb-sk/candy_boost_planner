import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ref } from "vue";
import type { Composer } from "vue-i18n";
import type { CalcRow, CalcStore } from "../../../composables/useCalcStore";
import { useCandyStore } from "../../../composables/useCandyStore";
import { cancelPersist } from "../../../persistence/deferredPersist";
import { addBoxRow, createCalcStore } from "../../../../tests/helpers/fakeIndividuals";
import type { LevelPlannerResult } from "../../level-planner/types";
import {
  canAdjustTarget,
  candyUnitsOf,
  initialFineTuneState,
  boostRange,
  boostSlotRemaining,
  reduceFineTune,
  rowExclusion,
  type FineTuneBase,
  type FineTuneDeps,
  type FineTuneOp,
  type FineTuneState,
} from "../draft";

/** 設計書 §12.1: 本物のストアを deps に渡して確かめる分（時間の睡眠目標の m0、アメブ最小化の行の固定など）。 */

const t = ((key: string) => key) as unknown as Composer["t"];

function installLocalStorageMock() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    },
    configurable: true,
    writable: true,
  });
}

function depsOf(store: CalcStore): FineTuneDeps {
  return {
    evaluateRows: (rowList, speciesCandy) => store.evaluateRows(rowList, { speciesCandy }),
    withRowIndividual: store.withRowIndividual,
    canEditIndividual: store.canEditIndividual,
    speciesCandyFamilyOf: store.speciesCandyFamilyOf,
    speciesCandyStockOf: store.speciesCandyStockOf,
    nicknameOf: store.nicknameOfRow,
    titleForNickname: store.titleForNickname,
    withExplicitBoost: store.withExplicitBoost,
    withBoostReachLevel: store.withBoostReachLevel,
    withTargetLevel: store.withTargetLevel,
    withCandyTarget: store.withCandyTarget,
    maxCandyTargetFor: store.maxCandyTargetFor,
    withSleepTarget: store.withSleepTarget,
    withMinimizeBoost: store.withMinimizeBoost,
    canMinimizeBoostFor: store.canMinimizeBoostFor,
    withBoostCandyReset: store.withBoostCandyReset,
    withDefaultBoostReachLevelRows: store.withDefaultBoostReachLevelRows,
  };
}

function session(store: CalcStore, boostLimit = 5000) {
  const deps = depsOf(store);
  const rows = store.rows.value;
  const base: FineTuneBase = {
    rows,
    evaluated: deps.evaluateRows(rows),
    result: { pokemonResults: [] } as unknown as LevelPlannerResult,
    boostLimit,
    settings: store.settingsSnapshot(),
  };
  const ok = (state: FineTuneState, op: FineTuneOp): FineTuneState => {
    const out = reduceFineTune(base, state, op, deps, deps.evaluateRows(state.rows));
    if ("rejected" in out) throw new Error(`rejected: ${out.rejected}`);
    return out.state;
  };
  return { deps, base, ok, initial: initialFineTuneState(base) };
}

const rowOf = (rows: readonly CalcRow[], id: string) => rows.find((r) => r.id === id)!;

describe("reduceFineTune: 本物のストアを deps に渡す", () => {
  const candyStore = useCandyStore();
  let originalInventory: ReturnType<typeof candyStore.getInventory>;

  beforeEach(() => {
    cancelPersist();
    installLocalStorageMock();
    originalInventory = candyStore.getInventory();
    candyStore.resetInventory();
  });

  afterEach(() => {
    candyStore.restoreInventory(originalInventory);
    cancelPersist();
  });

  function newStore(speciesCandy: number) {
    const store = createCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind("full");
    store.onBoostCandyRemainingInput("5000");
    store.updateSpeciesCandy(25, speciesCandy);
    return store;
  }
  const add = (store: CalcStore, boxId: string, pokedexId: number, srcLevel: number, dst: number, extra: { expRemaining?: number } = {}) => {
    addBoxRow(store, { boxId, pokedexId, srcLevel, dstLevelDefault: dst, expType: 600, nature: "normal", ...extra });
    return store.rows.value[store.rows.value.length - 1]!.id;
  };

  it("アメブを動かしても目標Lvが変わらない（繰り越しで届く点が目標を超える入力でも）", () => {
    const store = newStore(0);
    // EXPタイプ600・現在Lv1で次まで1EXP・目標Lv2・full で全アメブ点は1個
    const a = add(store, "a", 133, 1, 2, { expRemaining: 1 });
    const s = session(store);
    expect(s.base.evaluated.byId.get(a)!.fullBoost).toBe(1);
    const next = s.ok(s.initial, { kind: "set", rowId: a, boost: 1 });
    expect(next.rows[0]!.boostOrExpAdjustment).toBe(1);
    expect(next.rows[0]!.dstLevel).toBe(2);
    expect(next.rows[0]!.dstExpInLevel ?? 0).toBe(0);
    // 全アメブ点を超える入力は全アメブ点で止まる
    expect(s.ok(s.initial, { kind: "set", rowId: a, boost: 50 }).rows[0]!.boostOrExpAdjustment).toBe(1);
  });

  it("目標Lvの ▼ は計算機の setDstLevel と同じ値に切り詰められ、▲ で戻しても切り詰めたアメブは戻らない", () => {
    const store = newStore(100_000);
    const a = add(store, "a", 133, 10, 60);
    store.onRowBoostCandy(a, "150");
    const s = session(store);
    const down = s.ok(s.initial, { kind: "targetStep", rowId: a, by: -1 });
    store.setDstLevel(a, 59);
    expect(down.rows[0]).toEqual(rowOf(store.rows.value, a));

    const low = s.ok(s.initial, { kind: "set", rowId: a, boost: 150 });
    let lowered = low;
    for (let i = 0; i < 48; i += 1) lowered = s.ok(lowered, { kind: "targetStep", rowId: a, by: -1 });
    const keptBoost = lowered.rows[0]!.boostOrExpAdjustment!;
    expect(keptBoost).toBeLessThan(150);
    const raised = s.ok(lowered, { kind: "targetStep", rowId: a, by: 1 });
    expect(raised.rows[0]!.boostOrExpAdjustment).toBe(keptBoost);
    // アメブを先に触っていてもいなくても、同じ目標なら同じ結果
    let plain = s.initial;
    for (let i = 0; i < 48; i += 1) plain = s.ok(plain, { kind: "targetStep", rowId: a, by: -1 });
    expect(plain.rows[0]!.dstLevel).toBe(lowered.rows[0]!.dstLevel);
  });

  it("時間の睡眠目標の行は、睡眠だけで届くLvまで目標Lvを下げても目標Lvを動かせ（さらに下げられ）、上げ直すとアメブも動かせる", () => {
    const store = newStore(100_000);
    const d = add(store, "d", 25, 10, 60);
    store.setRowSleepTarget(d, 2000);
    const s = session(store);
    expect(rowExclusion(rowOf(s.base.rows, d), s.base.evaluated)).toBeNull();

    const low = s.ok(s.initial, { kind: "targetSet", rowId: d, level: 12 });
    expect(rowExclusion(rowOf(low.rows, d), s.deps.evaluateRows(low.rows))).toBe("sleepOnly");
    expect(canAdjustTarget(rowOf(low.rows, d))).toBe(true);
    expect(rowOf(s.ok(low, { kind: "targetStep", rowId: d, by: -1 }).rows, d).dstLevel).toBe(11);
    // アメブは睡眠だけで届く間は動かせない
    const boost = reduceFineTune(s.base, low, { kind: "step", rowId: d, by: 1 }, s.deps, s.deps.evaluateRows(low.rows));
    expect(boost).toEqual({ rejected: "excluded" });

    const back = s.ok(low, { kind: "targetSet", rowId: d, level: 60 });
    expect(rowOf(back.rows, d).dstLevel).toBe(60);
    expect(rowExclusion(rowOf(back.rows, d), s.deps.evaluateRows(back.rows))).toBeNull();
  });

  it("設定欄: 下書きの設定で評価すると、かけら・万能アメはプランナー入力に入り、最小限のアメブは実効アメブに効く。計算機の表示は変えない", () => {
    const store = newStore(100_000);
    const a = add(store, "a", 25, 10, 50);
    candyStore.updateUniversalCandy({ s: 1, m: 2, l: 3 });
    const before = store.evaluateRows(store.rows.value);
    const viewBoost = () => store.rowsView.value.find((r) => r.id === a)!.ui.boostCandyInput;
    const shownBefore = viewBoost();
    expect(before.byId.get(a)!.effectiveBoost).toBeGreaterThan(0);

    const drafted = store.evaluateRows(store.rows.value, {
      settings: { totalShards: 1234, universalCandy: { s: 10, m: 20, l: 30 }, minimizeBoost: true },
    });
    expect(drafted.plannerInput!.dreamShards).toBe(1234);
    expect(drafted.plannerInput!.candyInventory.universal).toEqual({ s: 10, m: 20, l: 30 });
    // 種族アメが潤沢なので、最小限のアメブにするとアメブは減る
    expect(drafted.byId.get(a)!.effectiveBoost).toBeLessThan(before.byId.get(a)!.effectiveBoost);
    // 計算機の値・表示は変わらない
    expect(store.minimizeBoost.value).toBe(false);
    expect(viewBoost()).toBe(shownBefore);
    expect(store.evaluateRows(store.rows.value).byId.get(a)!.effectiveBoost).toBe(before.byId.get(a)!.effectiveBoost);
    expect(store.evaluateRows(store.rows.value).plannerInput!.candyInventory.universal).toEqual({ s: 1, m: 2, l: 3 });
  });

  it("設定欄: 下書きの差し替えの中で評価すると、外側の下書きの設定もプランナー入力に入り、内側で渡した設定が勝つ", () => {
    const store = newStore(100_000);
    add(store, "a", 25, 10, 50);
    store.onTotalShardsInput("1000");
    const rows = store.rows.value;
    expect(store.evaluateRows(rows).plannerInput!.dreamShards).toBe(1000);
    // 外側の下書きの設定（かけら）は、内側で評価したプランナー入力にも入る（最小限のアメブと同じく、下書きの設定で読む）
    expect(store.withDraftOverride({ settings: { totalShards: 0 } }, () => store.evaluateRows(rows)).plannerInput!.dreamShards).toBe(0);
    // 内側で渡した設定が勝つ
    expect(store.withDraftOverride({ settings: { totalShards: 0 } }, () => store.evaluateRows(rows, { settings: { totalShards: 77 } })).plannerInput!.dreamShards).toBe(77);
    // 差し替えの外では計算機の値に戻る
    expect(store.evaluateRows(rows).plannerInput!.dreamShards).toBe(1000);
  });

  it("設定欄: 既定のアメブ目標Lvを変えると、自動の行だけを「再計算」と同じ手順で配り直す（手で入れた行・アメブ目標Lvを選んだ行は同じ参照）", () => {
    const store = newStore(100_000);
    const auto = add(store, "auto", 25, 10, 60);
    const manual = add(store, "manual", 25, 10, 60);
    const picked = add(store, "picked", 25, 10, 60);
    store.onRowBoostCandy(manual, "50");
    store.setBoostLevel(picked, 45);
    const rows = store.rows.value;
    const next = store.withDefaultBoostReachLevelRows(rows, 30);
    expect(rowOf(next, auto).boostReachLevel).toBe(30);
    expect(rowOf(next, manual)).toBe(rowOf(rows, manual));
    expect(rowOf(next, picked)).toBe(rowOf(rows, picked));
    // 新しい既定で評価したアメブは、目標Lvまでより少ない
    const evaluatedBefore = store.evaluateRows(rows).byId.get(auto)!.effectiveBoost;
    expect(store.evaluateRows(next).byId.get(auto)!.effectiveBoost).toBeLessThan(evaluatedBefore);
    // 計算機の設定は変えない
    expect(store.defaultBoostReachLevel.value).toBeNull();
    // 既定を変えなければ、どの行も同じ参照
    expect(store.withDefaultBoostReachLevelRows(rows, null)).toEqual(rows);
  });

  it("設定欄: 適用すると、最小限のアメブ・既定のアメブ目標Lv・かけら・万能アメを書き、元に戻す1回で全部戻る", () => {
    const store = newStore(100_000);
    add(store, "a", 25, 10, 50);
    candyStore.updateUniversalCandy({ s: 1, m: 2, l: 3 });
    const shardsBefore = store.totalShards.value;
    const rows = store.rows.value;
    const ok = store.applyFineTuneDraft({
      rows,
      speciesCandy: {},
      settings: { minimizeBoost: true, defaultBoostReachLevel: 40, totalShards: 777, universalCandy: { s: 4, m: 5, l: 6 } },
      label: "fine-tune",
      expectedBase: rows,
    });
    expect(ok).toBe(true);
    expect(store.minimizeBoost.value).toBe(true);
    expect(store.defaultBoostReachLevel.value).toBe(40);
    expect(store.totalShards.value).toBe(777);
    expect(candyStore.universalCandy.value).toEqual({ s: 4, m: 5, l: 6 });
    store.undo();
    expect(store.minimizeBoost.value).toBe(false);
    expect(store.defaultBoostReachLevel.value).toBeNull();
    expect(store.totalShards.value).toBe(shardsBefore);
    expect(candyStore.universalCandy.value).toEqual({ s: 1, m: 2, l: 3 });
  });

  it("時間の睡眠目標の行の使うアメの数は、プランナーへ渡す総アメ数（睡眠EXPを引いた数）と同じ", () => {
    const store = newStore(100_000);
    const d = add(store, "d", 25, 10, 50);
    store.setRowSleepTarget(d, 1000);
    add(store, "b", 133, 10, 50);
    const s = session(store);
    const row = rowOf(s.base.rows, d);
    const planned = s.base.evaluated.plannerInput!.pokemonList.find((p) => p.pokemonId === d)!;
    const m0 = candyUnitsOf(row, s.base.evaluated);
    expect(m0).toBe(planned.candyTarget!.totalCandyUnits);
    // 睡眠EXPを引いた数なので、睡眠目標を外した同じ行の総アメ数より小さい
    const noSleep = s.base.rows.map((r) => (r.id === d ? { ...r, sleepTargetHours: undefined } : r));
    expect(m0).toBeGreaterThan(0);
    expect(m0).toBeLessThan(s.deps.evaluateRows(noSleep).byId.get(d)!.candyNeed);
  });

  it("アメの数: 実効アメブで固定してから計算機と同じ個数指定の行になり、上限は計算機の個数指定と同じ。要る数に戻すと元の行に戻る", () => {
    const store = newStore(100_000);
    const c = add(store, "c", 25, 10, 30);
    add(store, "b", 133, 10, 50);
    const s = session(store);
    const row = rowOf(s.base.rows, c);
    const boost = s.base.evaluated.byId.get(c)!.effectiveBoost;
    const m0 = candyUnitsOf(row, s.base.evaluated);
    const given = s.ok(s.initial, { kind: "candySet", rowId: c, candy: m0 - 10 });
    const edited = rowOf(given.rows, c);
    expect(edited.candyTarget).toBe(m0 - 10);
    // アメブはアメの数の内数なので、数が実効アメブより少なければその数で抑えられる（計算機の個数指定と同じ）
    expect(edited.boostOrExpAdjustment).toBe(Math.min(boost, m0 - 10));
    expect(given.candyRecords[c]).toMatchObject({ m0, boost, candy: m0 - 10 });
    // 上限は計算機の個数指定の上限（Lv70 に届く数）と同じ
    const max = store.maxCandyTargetFor(store.withExplicitBoost(row, boost, { preserveTargetForExplicitBoost: true }));
    expect(max).toBeGreaterThan(m0);
    const top = s.ok(given, { kind: "candySet", rowId: c, candy: 1_000_000 });
    expect(rowOf(top.rows, c).candyTarget).toBe(max);
    expect(rowOf(s.ok(top, { kind: "candySet", rowId: c, candy: m0 }).rows, c)).toBe(row);
  });

  it("睡眠目標・最小アメブ・リセットは、計算機で同じ操作をしたときと同じ行になる", () => {
    const store = newStore(100_000);
    const a = add(store, "a", 25, 10, 40);
    add(store, "b", 133, 10, 50);
    const s = session(store);
    // 睡眠目標（時間とおひるね島＋アメ在庫＋チケット）
    for (const target of [1000, "napStockTicket", "all"] as const) {
      const draft = s.ok(s.initial, { kind: "sleepSet", rowId: a, target });
      store.setRowSleepTarget(a, target);
      expect(rowOf(draft.rows, a)).toEqual(rowOf(store.rows.value, a));
      store.setRowSleepTarget(a, undefined);
    }
    // 手で入れたアメブ → 最小アメブ（手で入れた個数は残す。在庫で届かないときに使う）→ リセット
    store.onRowBoostCandy(a, "50");
    const manual = session(store);
    const minimized = manual.ok(manual.initial, { kind: "boostMinimize", rowId: a, on: true });
    expect(rowOf(minimized.rows, a)).toMatchObject({ boostOrExpAdjustment: 50, boostMinimizeRow: true });
    store.setRowMinimizeBoost(a, true);
    expect(rowOf(minimized.rows, a)).toEqual(rowOf(store.rows.value, a));
    store.setRowMinimizeBoost(a, false);
    store.onRowBoostCandy(a, "50");
    const again = session(store);
    const reset = again.ok(again.initial, { kind: "boostReset", rowId: a });
    store.resetRowBoostCandy(a);
    expect(rowOf(reset.rows, a)).toEqual(rowOf(store.rows.value, a));
    expect(rowOf(reset.rows, a).boostOrExpAdjustment).toBeUndefined();
  });

  it("アメブ目標Lvは計算機の setBoostLevel と同じ行になり、評価したアメブ目標Lvも計算機の欄と同じ", () => {
    const store = newStore(100_000);
    const a = add(store, "a", 25, 10, 50);
    store.onRowBoostCandy(a, "40");
    const s = session(store);
    for (const level of [30, 55]) {
      const draft = s.ok(s.initial, { kind: "boostLevelSet", rowId: a, level });
      const before = rowOf(store.rows.value, a);
      store.setBoostLevel(a, level);
      expect(rowOf(draft.rows, a)).toEqual(rowOf(store.rows.value, a));
      const evaluated = s.deps.evaluateRows(draft.rows).byId.get(a)!;
      const view = store.rowsView.value.find((r) => r.id === a)!;
      expect(evaluated.boostReachLevel).toBe(view.ui.boostReachLevel);
      expect(evaluated.boostReachLevel).toBe(level);
      expect(evaluated.effectiveBoost).toBe(view.ui.boostCandyInput);
      // 次の Lv の確かめのため、計算機を元の行へ戻す
      store.applyFineTuneDraft({ rows: store.rows.value.map((r) => (r.id === a ? before : r)), speciesCandy: {}, label: "test", expectedBase: store.rows.value });
    }
  });

  it("move は在庫のみの行の保存値が上限を超えても拒否されず、実効アメブが在庫で抑えられる。上の行が在庫を先に取ると全アメブ点が下がる", () => {
    const store = newStore(100);
    const stock = add(store, "stock", 26, 10, 60);
    const upper = add(store, "upper", 25, 10, 40);
    store.setRowSleepTarget(stock, "stock");
    store.onRowBoostCandy(stock, "80");
    const s = session(store);
    expect(s.base.evaluated.byId.get(stock)!.effectiveBoost).toBe(80);
    const before = s.base.evaluated.byId.get(stock)!;

    const moved = s.ok(s.initial, { kind: "move", rowId: upper, toIndex: 0 });
    const after = s.deps.evaluateRows(moved.rows).byId.get(stock)!;
    expect(after.fullBoost).toBeLessThan(before.fullBoost);
    expect(after.effectiveBoost).toBeLessThan(80);
    expect(rowOf(moved.rows, stock).boostOrExpAdjustment).toBe(80);
    // 増やせず、0 まで減らせる
    const movedEvaluated = s.deps.evaluateRows(moved.rows);
    expect(boostRange(movedEvaluated, moved.rows.find((r) => r.id === stock)!, boostSlotRemaining(s.base, movedEvaluated)).max).toBe(after.effectiveBoost);
  });
});
