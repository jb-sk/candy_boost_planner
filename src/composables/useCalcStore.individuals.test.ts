import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextTick, ref } from "vue";
import type { Composer } from "vue-i18n";
import type { CalcRow, CalcStore } from "./useCalcStore";
import { useCandyStore } from "./useCandyStore";
import { expToNextLevel, type Individual } from "../domain/individual";
import { calcExpAndCandy } from "../domain/pokesleep/exp";
import { cancelPersist } from "../persistence/deferredPersist";
import { MAX_CALC_ROWS_PER_SLOT } from "../persistence/calc";
import { addBoxRow, createCalcStore, fakeIndividualsOf, setBoxIndividual } from "../../tests/helpers/fakeIndividuals";

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

function makeStore(): CalcStore {
  const store = createCalcStore({ locale: ref("ja"), t });
  store.setSlotBoostKind("full");
  store.onBoostCandyRemainingInput("5000");
  return store;
}

const strip = (rows: readonly CalcRow[]) => JSON.parse(JSON.stringify(rows.map(({ id: _id, ...rest }) => rest)));

function individualOf(store: CalcStore, boxId: string): Individual {
  return fakeIndividualsOf(store).individualById.value.get(boxId)!;
}

/** 個数指定（総アメ数）のある行 */
function addCandyTargetRow(store: CalcStore, boxId = "a", nature: "normal" | "up" | "down" = "normal") {
  addBoxRow(store, { boxId, pokedexId: 25, srcLevel: 10, dstLevelDefault: 40, expType: 600, nature });
  const row = store.rows.value.find((x) => x.boxId === boxId)!;
  store.onRowCandyTarget(row.id, "150");
  return store.rows.value.find((x) => x.boxId === boxId)!;
}

/** 明示アメブ個数だけで目標を賄っている行 */
function addExplicitBoostRow(store: CalcStore, boxId = "a") {
  addBoxRow(store, { boxId, pokedexId: 25, srcLevel: 10, dstLevelDefault: 40, expType: 600, nature: "normal" });
  const row = store.rows.value.find((x) => x.boxId === boxId)!;
  // 目標全体をちょうどアメブだけで賄う個数
  const needed = calcExpAndCandy({ srcLevel: 10, dstLevel: 40, expType: 600, nature: "normal", boost: "full" }).candy;
  store.onRowBoostCandy(row.id, String(needed));
  return store.rows.value.find((x) => x.boxId === boxId)!;
}

describe("rowsAfterIndividualChange（Lv → 性格 → そのほか）", () => {
  beforeEach(() => {
    cancelPersist();
    installLocalStorageMock();
  });
  afterEach(() => {
    cancelPersist();
  });

  it("Lv: 個数指定を解除し dstExpInLevel=0 にする。計算機で変えた結果と同じ", () => {
    const store = makeStore();
    const row = addCandyTargetRow(store);
    expect(row.candyTarget).toBe(150);
    const prev = individualOf(store, "a");
    const next: Individual = { ...prev, level: 12, expRemaining: expToNextLevel(12, 600) };

    const [direct] = store.rowsAfterIndividualChange(store.rows.value, row.id, prev, next);
    // 確定はしない
    expect(store.rows.value[0]!.srcLevel).toBe(10);
    // dstExpInLevel=0 にしたあと、個数指定も睡眠目標も無い行は normalizeRowState が undefined へ落とす
    expect(direct).toMatchObject({ srcLevel: 12, dstExpInLevel: undefined, candyTarget: undefined, expRemaining: next.expRemaining });

    store.setSrcLevel(row.id, 12);
    expect(store.rows.value[0]).toEqual(direct);
  });

  it("Lv: 睡眠目標は維持し、明示アメブ個数は上限までクランプする。計算機で変えた結果と同じ", () => {
    const store = makeStore();
    const row = addExplicitBoostRow(store);
    store.setRowSleepTargetHours(row.id, 1000);
    const before = store.rows.value[0]!;
    expect(before.sleepTargetHours).toBe(1000);
    const prev = individualOf(store, "a");
    const next: Individual = { ...prev, level: 30, expRemaining: expToNextLevel(30, 600) };

    const [direct] = store.rowsAfterIndividualChange(store.rows.value, row.id, prev, next);
    expect(direct).toMatchObject({ srcLevel: 30, sleepTargetHours: 1000 });

    store.setSrcLevel(row.id, 30);
    expect(store.rows.value[0]).toEqual(direct);
  });

  it("性格: 明示アメブ個数で目標を賄う行は到達点を引き直す。計算機で変えた結果と同じ", () => {
    const store = makeStore();
    const row = addExplicitBoostRow(store);
    const prev = individualOf(store, "a");

    const [up] = store.rowsAfterIndividualChange(store.rows.value, row.id, prev, { ...prev, nature: "up" });
    expect(up!.nature).toBe("up");
    expect(up!.dstLevel).not.toBe(row.dstLevel);

    store.setNature(row.id, "up");
    expect(store.rows.value[0]).toEqual(up);
    // 戻す方向も引き直す
    store.setNature(row.id, "normal");
    expect(store.rows.value[0]!.dstLevel).toBe(row.dstLevel);
  });

  it("性格: 導出モードの行は枠を配り直す。計算機で変えた結果と同じ", () => {
    const store = makeStore();
    addBoxRow(store, { boxId: "a", pokedexId: 25, srcLevel: 10, dstLevelDefault: 40, expType: 600, nature: "normal" });
    const row = store.rows.value[0]!;
    const prev = individualOf(store, "a");

    const [direct] = store.rowsAfterIndividualChange(store.rows.value, row.id, prev, { ...prev, nature: "down" });
    store.setNature(row.id, "down");
    expect(store.rows.value[0]).toEqual(direct);
  });

  it("そのほか: あとEXP・累計睡眠時間は normalizeRowState を通す。計算機で変えた結果と同じ", () => {
    const store = makeStore();
    const row = addCandyTargetRow(store);
    const prev = individualOf(store, "a");

    const [withSleep] = store.rowsAfterIndividualChange(store.rows.value, row.id, prev, { ...prev, sleepHours: 50 });
    store.setRowSleepHours(row.id, 50);
    expect(store.rows.value[0]).toEqual(withSleep);

    const prev2 = individualOf(store, "a");
    const [withExp] = store.rowsAfterIndividualChange(store.rows.value, row.id, prev2, { ...prev2, expRemaining: 100 });
    store.onRowExpRemaining(row.id, "100");
    expect(store.rows.value[0]).toEqual(withExp);
    expect(store.rows.value[0]!.expRemaining).toBe(100);
  });

  it("Lv と名前が同時に変わっても、Lv の規則で維持した目標を押し上げ直さない", () => {
    const store = makeStore();
    const row = addExplicitBoostRow(store);
    const prev = individualOf(store, "a");
    const next: Individual = { ...prev, level: 11, expRemaining: expToNextLevel(11, 600), label: "別名" };

    const [levelOnly] = store.rowsAfterIndividualChange(store.rows.value, row.id, prev, { ...prev, level: 11, expRemaining: expToNextLevel(11, 600) });
    const [both] = store.rowsAfterIndividualChange(store.rows.value, row.id, prev, next);
    expect(both!.dstLevel).toBe(levelOnly!.dstLevel);
    expect(both!.dstExpInLevel).toBe(levelOnly!.dstExpInLevel);
    expect(both!.dstExpInLevel ?? 0).toBe(0);
  });

  it("名前だけの変更では計画を正規化せず、基準値の title だけ更新する", () => {
    const store = makeStore();
    addExplicitBoostRow(store);
    // 目標を Lv40 ちょうどにする（明示アメブ個数は目標を超えるぶんがあるので、正規化を通すと +EXP に押し上げられる）
    store.setDstLevel(store.rows.value[0]!.id, 40);
    const row = store.rows.value[0]!;
    const expBefore = row.dstExpInLevel;
    const prev = individualOf(store, "a");

    const [renamed] = store.rowsAfterIndividualChange(store.rows.value, row.id, prev, { ...prev, label: "別名" });
    expect(renamed).toEqual({ ...row, title: "別名" });

    // ボックスでの名前変更も同じ経路で、目標はそのまま
    fakeIndividualsOf(store).set("a", { label: "ボックスで改名" });
    expect(store.rows.value[0]).toMatchObject({ title: "ボックスで改名", dstLevel: 40, dstExpInLevel: expBefore });
  });

  it("あとEXPに 0 を入力すると未設定扱い（次Lvまで全部）になり、正本と行が一致する", () => {
    const store = makeStore();
    const row = addCandyTargetRow(store);
    store.onRowExpRemaining(row.id, "0");
    const toNext = expToNextLevel(10, 600);
    expect(individualOf(store, "a").expRemaining).toBe(toNext);
    expect(store.rows.value.find((x) => x.id === row.id)!.expRemaining ?? toNext).toBe(toNext);
  });

  it("複数の項目が同時に変わったときは、Lv → 性格 → そのほかの順に1項目ずつ編集したのと同じ", () => {
    const combined = makeStore();
    const sequential = makeStore();
    const row = addCandyTargetRow(combined, "a", "normal");
    const rowSeq = addCandyTargetRow(sequential, "a", "normal");
    const prev = individualOf(combined, "a");

    const [direct] = combined.rowsAfterIndividualChange(combined.rows.value, row.id, prev, {
      ...prev,
      level: 15,
      expRemaining: expToNextLevel(15, 600),
      nature: "up",
      sleepHours: 30,
    });

    sequential.setSrcLevel(rowSeq.id, 15);
    sequential.setNature(rowSeq.id, "up");
    sequential.setRowSleepHours(rowSeq.id, 30);

    expect(strip([direct!])).toEqual(strip(sequential.rows.value));
  });
});

describe("syncRowsWithIndividuals", () => {
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

  it("ボックス側の編集は、表示中スロットの行へすぐ届く。計算機側の編集と同じ結果になる", () => {
    const fromBox = makeStore();
    const fromCalc = makeStore();
    const rowBox = addCandyTargetRow(fromBox);
    const rowCalc = addCandyTargetRow(fromCalc);

    fakeIndividualsOf(fromBox).updateIndividual("a", { level: 14, nature: "up", sleepHours: 20 }, { label: "box edit" });
    fromCalc.setSrcLevel(rowCalc.id, 14);
    fromCalc.setNature(rowCalc.id, "up");
    fromCalc.setRowSleepHours(rowCalc.id, 20);

    expect(rowBox.id).not.toBe(rowCalc.id);
    expect(strip(fromBox.rows.value)).toEqual(strip(fromCalc.rows.value));
    expect(fromBox.rows.value[0]!.candyTarget).toBeUndefined();
  });

  it("同期は履歴に記録しない（記録するのは正本を書き換えた側）", () => {
    const store = createCalcStore({ locale: ref("ja"), t });
    addBoxRow(store, { boxId: "a", pokedexId: 25, srcLevel: 10, dstLevelDefault: 40, expType: 600, nature: "normal" });

    // 個体を直接書き換える（履歴なし）→ 行は揃うが、Undo は積まれない
    fakeIndividualsOf(store).set("a", { level: 20 });
    expect(store.rows.value[0]!.srcLevel).toBe(20);
    // 戻せるのは行の追加だけ（個体の直接の書き換えは積まれていない）
    store.undo();
    expect(store.rows.value).toHaveLength(0);
    expect(store.canUndo.value).toBe(false);
  });

  it("在庫による最小化がある同種族の複数行は、まとめて同期しても1行ずつ編集したときと一致する", () => {
    const setup = () => {
      const store = makeStore();
      store.setMinimizeBoost(true);
      store.updateSpeciesCandy(25, 400);
      for (const boxId of ["a", "b", "c"]) {
        addBoxRow(store, { boxId, pokedexId: 25, srcLevel: 10, dstLevelDefault: 40, expType: 600, nature: "normal" });
      }
      return store;
    };
    const levels = { a: 14, b: 18, c: 22 };

    // 1行ずつ編集（そのたびに同期）
    const oneByOne = setup();
    for (const [boxId, level] of Object.entries(levels)) fakeIndividualsOf(oneByOne).set(boxId, { level });

    // 裏のスロットで3体とも変わり、開いたときに1回で同期する
    const batch = setup();
    batch.switchToSlot(1);
    for (const [boxId, level] of Object.entries(levels)) fakeIndividualsOf(batch).set(boxId, { level });
    expect(batch.slots.value[0]!.rows.map((row) => row.srcLevel)).toEqual([10, 10, 10]);
    batch.switchToSlot(0);

    expect(strip(batch.rows.value)).toEqual(strip(oneByOne.rows.value));
    expect(batch.rowsView.value.map((row) => row.ui.boostCandyInput))
      .toEqual(oneByOne.rowsView.value.map((row) => row.ui.boostCandyInput));
    // 最小化が効いている（OFFにすると配分が変わる）
    const withMinimize = batch.rowsView.value.map((row) => row.ui.boostCandyInput);
    batch.setMinimizeBoost(false);
    expect(batch.rowsView.value.map((row) => row.ui.boostCandyInput)).not.toEqual(withMinimize);
  });

  it("裏のスロットの個数指定は、開く前に Lv が元に戻っていれば残り、戻っていなければ解除される", () => {
    const store = makeStore();
    addCandyTargetRow(store);
    store.switchToSlot(1);

    fakeIndividualsOf(store).set("a", { level: 12 });
    fakeIndividualsOf(store).set("a", { level: 10 });
    store.switchToSlot(0);
    expect(store.rows.value[0]!.candyTarget).toBe(150);

    store.switchToSlot(1);
    fakeIndividualsOf(store).set("a", { level: 12 });
    store.switchToSlot(0);
    expect(store.rows.value[0]).toMatchObject({ srcLevel: 12, candyTarget: undefined });
  });

  it("貼り付けたスロットも、貼り付けた時点の個体の値へ揃う", async () => {
    const store = makeStore();
    addCandyTargetRow(store);
    await nextTick();
    store.copySlot();
    store.switchToSlot(1);
    fakeIndividualsOf(store).set("a", { level: 16 });
    store.pasteSlot();

    expect(store.rows.value[0]).toMatchObject({ boxId: "a", srcLevel: 16, candyTarget: undefined });
  });
});

describe("リンク切れの行", () => {
  beforeEach(() => {
    cancelPersist();
    installLocalStorageMock();
  });
  afterEach(() => {
    cancelPersist();
  });

  it("linkBroken は個体の有無から求める。個体が戻れば自動でつながった表示に戻る", () => {
    const store = makeStore();
    addBoxRow(store, { boxId: "a", pokedexId: 25, srcLevel: 10, expType: 600, nature: "normal", title: "ピカ" });
    expect(store.rowsView.value[0]!.linkBroken).toBe(false);

    const kept = individualOf(store, "a");
    fakeIndividualsOf(store).remove("a");
    expect(store.rowsView.value[0]!.linkBroken).toBe(true);
    // 計算は行に残っている値（基準値）で続ける。行は消えない・保存しない
    expect(store.rowsView.value[0]!.title).toBe("ピカ");
    expect(store.rows.value[0]).not.toHaveProperty("linkBroken");

    fakeIndividualsOf(store).set("a", kept);
    expect(store.rowsView.value[0]!.linkBroken).toBe(false);
  });

  it("boxId の無い行もリンク切れ。同期の対象外で、個体属性の編集は例外にする", () => {
    const store = makeStore();
    addBoxRow(store, { boxId: "a", pokedexId: 25, srcLevel: 10, expType: 600, nature: "normal" });
    store.rows.value = [...store.rows.value, { ...store.rows.value[0]!, id: "legacy", boxId: undefined, title: "旧データ" }];
    expect(store.rowsView.value.map((row) => row.linkBroken)).toEqual([false, true]);

    fakeIndividualsOf(store).set("a", { level: 20, nature: "up" });
    expect(store.rows.value[0]).toMatchObject({ srcLevel: 20, nature: "up" });
    expect(store.rows.value[1]).toMatchObject({ srcLevel: 10, nature: "normal" });

    expect(() => store.setSrcLevel("legacy", 30)).toThrow();
    expect(() => store.setNature("legacy", "down")).toThrow();
  });

  it("参照先の個体が無い行は同期の対象外で、個体を作り直すと揃い直す", () => {
    const store = makeStore();
    addBoxRow(store, { boxId: "a", pokedexId: 25, srcLevel: 10, expType: 600, nature: "normal" });
    addBoxRow(store, { boxId: "b", pokedexId: 25, srcLevel: 10, expType: 600, nature: "normal" });
    fakeIndividualsOf(store).remove("a");
    const brokenBefore = JSON.parse(JSON.stringify(store.rows.value[0]));

    fakeIndividualsOf(store).set("b", { level: 25 });
    expect(JSON.parse(JSON.stringify(store.rows.value[0]))).toEqual(brokenBefore);
    expect(store.rows.value[1]!.srcLevel).toBe(25);
    expect(() => store.setSrcLevel(store.rows.value[0]!.id, 30)).toThrow();

    fakeIndividualsOf(store).set("a", { level: 40, label: "戻った" });
    expect(store.rows.value[0]).toMatchObject({ srcLevel: 40, title: "戻った" });
    expect(store.rowsView.value[0]!.linkBroken).toBe(false);
  });
});

describe("addRow / addRows", () => {
  beforeEach(() => {
    cancelPersist();
    installLocalStorageMock();
  });
  afterEach(() => {
    cancelPersist();
  });

  it("個体の値を行へコピーし、同じスロットの同じ boxId は追加しない。別スロットには追加できる", () => {
    const store = makeStore();
    setBoxIndividual(store, {
      boxId: "a", pokedexId: 149, pokemonType: "Dragon", srcLevel: 33, expType: 900, nature: "up",
      expRemaining: 500, sleepHours: 12, title: "ピカ",
    });

    store.addRow("a", { dstLevelDefault: 50 });
    store.addRow("a");
    store.addRows(["a"]);

    expect(store.rows.value).toHaveLength(1);
    expect(store.rows.value[0]).toMatchObject({
      boxId: "a", title: "ピカ", srcLevel: 33, dstLevel: 50, expType: 900, nature: "up",
      expRemaining: 500, sleepHours: 12, pokedexId: 149, pokemonType: "Dragon",
    });

    store.switchToSlot(1);
    store.addRow("a");
    expect(store.rows.value).toHaveLength(1);
  });

  describe("1スロットの行数上限", () => {
    const MAX = MAX_CALC_ROWS_PER_SLOT;
    const setMany = (store: CalcStore, count: number) => {
      const ids = Array.from({ length: count }, (_, i) => `b${i}`);
      for (const id of ids) setBoxIndividual(store, { boxId: id, pokedexId: 25, srcLevel: 10, expType: 600, nature: "normal" });
      return ids;
    };

    it("addRows は上限まで追加し、超過分は断る", () => {
      const store = makeStore();
      const ids = setMany(store, MAX + 1);
      expect(store.addRows(ids)).toBe(MAX);
      expect(store.rows.value).toHaveLength(MAX);
      expect(store.rows.value.some((x) => x.boxId === ids[MAX])).toBe(false);
      expect(store.addRows([ids[MAX]!])).toBe(0);
      expect(store.rows.value).toHaveLength(MAX);
    });

    it("addRow は上限に達していたら追加しない", () => {
      const store = makeStore();
      const ids = setMany(store, MAX + 1);
      store.addRows(ids.slice(0, MAX));
      store.addRow(ids[MAX]!);
      expect(store.rows.value).toHaveLength(MAX);
    });
  });

  it("存在しない個体の追加は例外にする", () => {
    const store = makeStore();
    expect(() => store.addRow("missing")).toThrow();
  });
});
