import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextTick, ref } from "vue";
import type { Composer } from "vue-i18n";
import { useBoxStore } from "./useBoxStore";
import { useCalcStore } from "./useCalcStore";
import { HISTORY_LIMIT, INDIVIDUAL_ADD_SCOPES, stepHistoryWithToast, useHistory, type HistoryControls } from "./useHistory";
import { useToast } from "./useToast";
import { useCandyStore } from "./useCandyStore";
import { cancelPersist } from "../persistence/deferredPersist";
import { addBoxRow, createCalcStore } from "../../tests/helpers/fakeIndividuals";

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

const t = ((key: string) => key) as unknown as Composer["t"];

/** 計算機とボックスが1本の履歴を共有する、アプリと同じ組み立て（計算機はボックスストアを個体ポートにする）。 */
function makeStores() {
  const history = useHistory();
  const box = useBoxStore({ locale: ref("ja"), t, history });
  const calc = useCalcStore({ locale: ref("ja"), t, history, individuals: box });
  return { history, calc, box };
}

type Calc = ReturnType<typeof makeStores>["calc"];
type Box = ReturnType<typeof makeStores>["box"];

/** 計算機だけの組み立て（個体は偽ポート）。 */
function makeCalcOnly() {
  return { calc: createCalcStore({ locale: ref("ja"), t }) };
}

function addRow(calc: Calc, boxId: string) {
  addBoxRow(calc, { boxId, srcLevel: 10, expType: 600, nature: "normal" });
}

function addBoxEntry(box: Box, label: string) {
  box.addLabel.value = label;
  box.onCreateManual({ mode: "toBox" });
  return box.boxEntries.value[0]!.id;
}

const boxIdsOf = (calc: Calc) => calc.rows.value.map((row) => row.boxId);

describe("共通履歴: 計算機のスロット", () => {
  beforeEach(() => {
    cancelPersist();
    installLocalStorageMock();
  });

  afterEach(() => {
    cancelPersist();
  });

  it("スロットを切り替えても履歴は消えない", async () => {
    const { calc } = makeCalcOnly();
    addRow(calc, "a");
    await nextTick();

    calc.switchToSlot(1);

    expect(calc.canUndo.value).toBe(true);
  });

  it("別スロットの操作は、記録したスロットへ切り替えてから戻る。Redo で同じスロットの状態が戻る", async () => {
    const { calc } = makeCalcOnly();
    addRow(calc, "a");
    await nextTick();
    calc.switchToSlot(1);
    addRow(calc, "b");
    await nextTick();
    calc.switchToSlot(0);

    calc.undo();
    expect(calc.activeSlotTab.value).toBe(1);
    expect(boxIdsOf(calc)).toEqual([]);

    // Undo の後に別のスロットへ移っても、Redo は記録したスロットへ戻って b を戻す
    calc.switchToSlot(0);
    calc.redo();
    expect(calc.activeSlotTab.value).toBe(1);
    expect(boxIdsOf(calc)).toEqual(["b"]);

    calc.switchToSlot(0);
    expect(boxIdsOf(calc)).toEqual(["a"]);
  });

  it("rows を含まないスロット固有の操作（アメブ残数）の Undo は、別スロットへ戻らない", async () => {
    const { calc } = makeCalcOnly();
    calc.onBoostCandyRemainingInput("50");
    calc.switchToSlot(1);
    calc.onBoostCandyRemainingInput("100");
    calc.switchToSlot(0);

    calc.undo();

    expect(calc.activeSlotTab.value).toBe(1);
    expect(calc.boostCandyRemaining.value).toBeNull();
    calc.switchToSlot(0);
    expect(calc.boostCandyRemaining.value).toBe(50);

    // Redo も記録したスロットの値を戻し、いまのスロットの値は触らない
    calc.redo();
    expect(calc.activeSlotTab.value).toBe(1);
    expect(calc.boostCandyRemaining.value).toBe(100);
    calc.switchToSlot(0);
    expect(calc.boostCandyRemaining.value).toBe(50);
  });

  it("タブの入れ替えを別スロットへ移ってから Undo すると、表示中の行と slots が一致する", async () => {
    const { calc } = makeCalcOnly();
    addRow(calc, "a");
    await nextTick();
    calc.switchToSlot(1);
    addRow(calc, "b");
    await nextTick();

    calc.swapSlots(1, 0);
    calc.switchToSlot(1);
    calc.undo();

    expect(calc.slots.value.map((slot) => slot?.rows[0]?.boxId)).toEqual(["a", "b", undefined]);
    expect(calc.activeSlotTab.value).toBe(1);
    expect(boxIdsOf(calc)).toEqual(["b"]);
    expect(boxIdsOf(calc)).toEqual(calc.slots.value[calc.activeSlotTab.value]?.rows.map((row) => row.boxId));
  });

  it("タブの入れ替え → Undo → Redo で、入れ替え直後と同じスロットが表示される", async () => {
    const { calc } = makeCalcOnly();
    addRow(calc, "a");
    await nextTick();
    calc.switchToSlot(1);
    addRow(calc, "b");
    await nextTick();

    calc.swapSlots(1, 0);
    const activeAfterSwap = calc.activeSlotTab.value;
    expect(activeAfterSwap).toBe(0);
    expect(boxIdsOf(calc)).toEqual(["b"]);

    calc.undo();
    expect(calc.activeSlotTab.value).toBe(1);
    expect(boxIdsOf(calc)).toEqual(["b"]);

    calc.redo();
    expect(calc.activeSlotTab.value).toBe(activeAfterSwap);
    expect(boxIdsOf(calc)).toEqual(["b"]);
    expect(calc.slots.value.map((slot) => slot?.rows[0]?.boxId)).toEqual(["b", "a", undefined]);
  });

  it("行の削除の Undo で行が戻る", async () => {
    const { calc } = makeCalcOnly();
    addRow(calc, "a");
    addRow(calc, "b");
    await nextTick();

    calc.removeRowById(calc.rows.value[0]!.id);
    expect(boxIdsOf(calc)).toEqual(["b"]);
    calc.undo();

    expect(boxIdsOf(calc)).toEqual(["a", "b"]);
  });
});

describe("共通履歴: ボックス", () => {
  beforeEach(() => {
    cancelPersist();
    installLocalStorageMock();
  });

  afterEach(() => {
    cancelPersist();
  });

  it("上限は3件ではなく30件", () => {
    const { box, calc } = makeStores();
    const total = HISTORY_LIMIT + 5;
    for (let i = 0; i < total; i += 1) addBoxEntry(box, `p${i}`);
    expect(box.boxEntries.value).toHaveLength(total);

    let undone = 0;
    while (box.canUndo.value) {
      box.onUndo();
      undone += 1;
    }

    expect(undone).toBe(HISTORY_LIMIT);
    expect(box.boxEntries.value).toHaveLength(total - HISTORY_LIMIT);
    expect(calc.canUndo.value).toBe(false);
  });

  it("個体属性・お気に入り・個体へのタグ付け・再リンクもすべて記録され、1件ずつ戻る", () => {
    const { box } = makeStores();
    const id = addBoxEntry(box, "対象");
    const tagId = box.addCustomTag("タグ")!;
    box.selectedBoxId.value = id;
    const entry = () => box.boxEntries.value.find((x) => x.id === id)!;

    const favorite0 = !!entry().favorite;
    box.setBoxLevel(20);
    box.onEditSelectedNature("up");
    box.toggleFavoriteById(id);
    box.toggleSelectedCustomTag(tagId);
    expect(entry().planner?.level).toBe(20);
    expect(entry().planner?.expGainNature).toBe("up");
    expect(!!entry().favorite).toBe(!favorite0);
    expect(entry().tagIds).toEqual([tagId]);

    // 後から行った操作を戻さない限り、前の操作は戻らない
    box.onUndo();
    expect(entry().tagIds).toBeUndefined();
    expect(!!entry().favorite).toBe(!favorite0);
    box.onUndo();
    expect(!!entry().favorite).toBe(favorite0);
    expect(entry().planner?.expGainNature).toBe("up");
    box.onUndo();
    expect(entry().planner?.expGainNature).not.toBe("up");
    expect(entry().planner?.level).toBe(20);
    box.onUndo();
    expect(entry().planner?.level).not.toBe(20);
    expect(box.customTags.value.map((tag) => tag.id)).toEqual([tagId]);

    box.onRedo();
    box.onRedo();
    box.onRedo();
    box.onRedo();
    expect(entry().planner?.level).toBe(20);
    expect(entry().planner?.expGainNature).toBe("up");
    expect(!!entry().favorite).toBe(!favorite0);
    expect(entry().tagIds).toEqual([tagId]);
  });

  it("値が変わらない編集は履歴に積まない", () => {
    const { box } = makeStores();
    const id = addBoxEntry(box, "対象");
    box.selectedBoxId.value = id;
    box.onEditSelectedLabel("対象");
    box.onUndo();
    expect(box.boxEntries.value).toHaveLength(0);
    expect(box.canUndo.value).toBe(false);
  });

  it("同じ欄への連続編集は coalesceKey で1件にまとめ、別の欄はまとめない", () => {
    const { box } = makeStores();
    const id = addBoxEntry(box, "対象");
    box.selectedBoxId.value = id;
    const entry = () => box.boxEntries.value.find((x) => x.id === id)!;

    box.setBoxSleepHours("1");
    box.setBoxSleepHours("12");
    box.setBoxSleepHours("123");
    box.setBoxLevel(30);
    expect(entry().planner?.sleepHours).toBe(123);

    box.onUndo();
    expect(entry().planner?.level).not.toBe(30);
    expect(entry().planner?.sleepHours).toBe(123);
    box.onUndo();
    expect(entry().planner?.sleepHours).toBeUndefined();
  });

  it("Undo の直後に同じ欄を編集しても、その編集だけを Undo できる", () => {
    const { box } = makeStores();
    const id = addBoxEntry(box, "対象");
    box.selectedBoxId.value = id;
    const entry = () => box.boxEntries.value.find((x) => x.id === id)!;

    box.setBoxSleepHours("10");
    box.onUndo();
    box.onRedo();
    box.setBoxSleepHours("20");
    box.onUndo();

    expect(entry().planner?.sleepHours).toBe(10);
  });

  it("削除の Undo で個体と選択が戻る", () => {
    const { box } = makeStores();
    const id = addBoxEntry(box, "対象");
    box.selectedBoxId.value = id;

    box.onDeleteSelected();
    expect(box.boxEntries.value).toHaveLength(0);
    expect(box.selectedBoxId.value).toBeNull();

    box.onUndo();
    expect(box.boxEntries.value.map((x) => x.id)).toEqual([id]);
    expect(box.selectedBoxId.value).toBe(id);
  });

  it("記録は参照を保存するだけで、戻した後の配列は記録時の配列そのもの", () => {
    const { box } = makeStores();
    addBoxEntry(box, "A");
    const before = box.boxEntries.value;
    const beforeEntry = before[0];

    addBoxEntry(box, "B");
    box.onUndo();

    expect(box.boxEntries.value[0]).toBe(beforeEntry);
  });
});

describe("共通履歴: パネルをまたぐ Undo", () => {
  beforeEach(() => {
    cancelPersist();
    installLocalStorageMock();
  });

  afterEach(() => {
    cancelPersist();
  });

  it("計算機とボックスは1本の履歴を共有し、どちらのパネルからも後から行った操作の順に戻る", async () => {
    const { calc, box } = makeStores();
    const id = addBoxEntry(box, "対象");
    calc.addRow(id);
    await nextTick();
    box.selectedBoxId.value = id;
    box.setBoxLevel(40);

    expect(box.canUndo.value).toBe(true);
    expect(calc.canUndo.value).toBe(true);

    // ボックスの編集 → 計算機の追加 → ボックスの追加 の順に、計算機のボタンからも戻せる
    calc.undo();
    expect(box.boxEntries.value[0]?.planner?.level).not.toBe(40);
    expect(boxIdsOf(calc)).toEqual([id]);

    box.onUndo();
    expect(boxIdsOf(calc)).toEqual([]);
    expect(box.boxEntries.value).toHaveLength(1);

    calc.undo();
    expect(box.boxEntries.value).toHaveLength(0);
    expect(calc.canUndo.value).toBe(false);
    expect(box.canUndo.value).toBe(false);

    box.onRedo();
    calc.redo();
    calc.redo();
    expect(box.boxEntries.value[0]?.planner?.level).toBe(40);
    expect(boxIdsOf(calc)).toEqual([id]);
  });

  it("次の Undo / Redo で戻る操作のラベルを、どちらのストアの記録でも返す", async () => {
    const { history, calc, box } = makeStores();
    expect(history.undoLabel.value).toBeNull();
    expect(history.redoLabel.value).toBeNull();

    const id = addBoxEntry(box, "対象");
    const boxLabel = history.undoLabel.value;
    expect(boxLabel).not.toBeNull();
    calc.addRow(id);
    await nextTick();
    const calcLabel = history.undoLabel.value;
    expect(calcLabel).not.toBeNull();

    calc.undo();
    expect(history.undoLabel.value).toBe(boxLabel);
    expect(history.redoLabel.value).toBe(calcLabel);

    calc.undo();
    expect(history.undoLabel.value).toBeNull();
    expect(history.redoLabel.value).toBe(boxLabel);
  });
});

describe("共通履歴: ポケモンの追加をまとめる（recordAsOne）", () => {
  beforeEach(() => {
    cancelPersist();
    installLocalStorageMock();
  });

  afterEach(() => {
    cancelPersist();
  });

  it("ボックスへの追加・種族アメの在庫・計算機への追加を1件に記録し、1回で戻してやり直せる", async () => {
    const candyStore = useCandyStore();
    const originalInventory = candyStore.getInventory();
    candyStore.resetInventory();
    try {
      const { history, calc, box } = makeStores();
      const id = history.recordAsOne(INDIVIDUAL_ADD_SCOPES, () => {
        const created = addBoxEntry(box, "対象");
        calc.updateSpeciesCandy(25, 31);
        calc.addRow(created);
        return created;
      });
      await nextTick();
      const label = history.undoLabel.value;
      expect(boxIdsOf(calc)).toEqual([id]);
      expect(candyStore.getSpeciesCandyFor(25)).toBe(31);

      calc.undo();
      expect(box.boxEntries.value).toHaveLength(0);
      expect(boxIdsOf(calc)).toEqual([]);
      expect(candyStore.getSpeciesCandyFor(25)).not.toBe(31);
      expect(history.canUndo.value).toBe(false);

      calc.redo();
      expect(box.boxEntries.value.map((entry) => entry.id)).toEqual([id]);
      expect(boxIdsOf(calc)).toEqual([id]);
      expect(candyStore.getSpeciesCandyFor(25)).toBe(31);
      // ラベルは最初の記録（ボックスへの追加）のもの
      expect(history.redoLabel.value).toBeNull();
      expect(history.undoLabel.value).toBe(label);
    } finally {
      candyStore.restoreInventory(originalInventory);
    }
  });

  it("まとめた1件は、直後の同じキーの記録とも合体しない。何も記録しなければ履歴は増えない", () => {
    const { history } = makeStores();
    expect(history.recordAsOne(INDIVIDUAL_ADD_SCOPES, () => "結果")).toBe("結果");
    expect(history.canUndo.value).toBe(false);

    history.recordAsOne(INDIVIDUAL_ADD_SCOPES, () => {
      history.record("1件目", ["rows"], { coalesceKey: "同じキー" });
      history.record("2件目", ["rows"], { coalesceKey: "同じキー" });
    });
    expect(history.undoLabel.value).toBe("1件目");

    // 合体すると、新しい記録が積まれずにラベルが「1件目」のまま残る
    history.record("あと", ["rows"], { coalesceKey: "同じキー" });
    expect(history.undoLabel.value).toBe("あと");
  });
});

describe("共通履歴: 個体の編集・削除と計算機の行", () => {
  beforeEach(() => {
    cancelPersist();
    installLocalStorageMock();
  });

  afterEach(() => {
    cancelPersist();
  });

  it("ボックスでの Lv の編集は、個体と計算機の行を組で1件に記録し、どちらのパネルからも一緒に戻る", async () => {
    const { calc, box } = makeStores();
    const id = addBoxEntry(box, "対象");
    calc.addRow(id);
    await nextTick();
    const level0 = calc.rows.value[0]!.srcLevel;
    box.selectedBoxId.value = id;

    box.setBoxLevel(40);
    expect(calc.rows.value[0]!.srcLevel).toBe(40);

    calc.undo();
    expect(box.individualById.value.get(id)!.level).toBe(level0);
    expect(calc.rows.value[0]!.srcLevel).toBe(level0);

    box.onRedo();
    expect(box.individualById.value.get(id)!.level).toBe(40);
    expect(calc.rows.value[0]!.srcLevel).toBe(40);
  });

  it("計算機での Lv・性格の編集は正本へ書かれ、1件ずつ個体と行が一緒に戻る", async () => {
    const { calc, box } = makeStores();
    const id = addBoxEntry(box, "対象");
    calc.addRow(id);
    await nextTick();
    const row = calc.rows.value[0]!;
    const level0 = row.srcLevel;
    const entry = () => box.boxEntries.value.find((x) => x.id === id)!;

    calc.setSrcLevel(row.id, 30);
    calc.setNature(row.id, "up");
    expect(entry().planner?.level).toBe(30);
    expect(entry().planner?.expGainNature).toBe("up");
    expect(calc.rows.value[0]).toMatchObject({ srcLevel: 30, nature: "up" });

    box.onUndo();
    expect(entry().planner?.expGainNature).not.toBe("up");
    expect(calc.rows.value[0]).toMatchObject({ srcLevel: 30, nature: "normal" });
    box.onUndo();
    expect(box.individualById.value.get(id)!.level).toBe(level0);
    expect(calc.rows.value[0]!.srcLevel).toBe(level0);
  });

  it("個体の削除と全スロットの連動行の削除は1件にまとまり、削除の Undo で個体も行も戻る", async () => {
    const { calc, box } = makeStores();
    const id = addBoxEntry(box, "対象");
    calc.addRow(id);
    await nextTick();
    calc.switchToSlot(1);
    calc.addRow(id);
    await nextTick();
    calc.switchToSlot(0);
    box.selectedBoxId.value = id;

    // BoxPanel の削除と同じ順（個体の削除 → 連動行の削除）
    box.onDeleteSelected();
    expect(calc.removeRowsByBoxIds([id])).toBe(2);
    await nextTick();
    expect(box.boxEntries.value).toHaveLength(0);
    expect(boxIdsOf(calc)).toEqual([]);

    box.onUndo();
    expect(box.boxEntries.value.map((x) => x.id)).toEqual([id]);
    expect(boxIdsOf(calc)).toEqual([id]);
    expect(calc.rowsView.value[0]!.linkBroken).toBe(false);
    calc.switchToSlot(1);
    expect(boxIdsOf(calc)).toEqual([id]);
    expect(calc.rowsView.value[0]!.linkBroken).toBe(false);

    // 1回戻せば足りる（削除が行の削除と別の履歴になっていない）。次に戻るのは、その前の操作
    calc.undo();
    expect(boxIdsOf(calc)).toEqual([]);
    expect(box.boxEntries.value.map((x) => x.id)).toEqual([id]);
  });

  it("全消去と連動行の削除も1件にまとまり、Undo で戻る", async () => {
    const { calc, box } = makeStores();
    const first = addBoxEntry(box, "A");
    const second = addBoxEntry(box, "B");
    calc.addRow(first);
    calc.addRow(second);
    await nextTick();

    const ids = box.boxEntries.value.map((x) => x.id);
    box.onClearBox();
    calc.removeRowsByBoxIds(ids);
    await nextTick();
    expect(boxIdsOf(calc)).toEqual([]);

    calc.undo();
    expect(box.boxEntries.value).toHaveLength(2);
    expect(boxIdsOf(calc)).toEqual([first, second]);
  });

  it("再リンクも個体と行を組で記録する", async () => {
    const { calc, box } = makeStores();
    const id = addBoxEntry(box, "対象");
    calc.addRow(id);
    await nextTick();
    box.selectedBoxId.value = id;
    const pokedexId0 = calc.rows.value[0]!.pokedexId;

    box.relinkName.value = "ピカチュウ";
    box.onRelinkApply();
    expect(calc.rows.value[0]!.pokedexId).toBe(25);

    calc.undo();
    expect(calc.rows.value[0]!.pokedexId).toBe(pokedexId0);
    expect(box.individualById.value.get(id)!.pokedexId).toBe(pokedexId0);
  });
});

describe("stepHistoryWithToast（HistoryControls）", () => {
  const { toasts } = useToast();

  function controls(label: string | null): HistoryControls {
    return {
      canUndo: ref(true),
      canRedo: ref(true),
      undoLabel: ref(label),
      redoLabel: ref(label),
      undo: () => label,
      redo: () => label,
    };
  }

  it("ラベルを返す履歴ではトーストを出す", () => {
    const before = toasts.value.length;
    stepHistoryWithToast(controls("行の順番"), "undo", t);
    expect(toasts.value.length).toBe(before + 1);
  });

  it("ラベルが常に null の履歴（やりくりモーダル）ではトーストを出さない", () => {
    const before = toasts.value.length;
    stepHistoryWithToast(controls(null), "undo", t);
    stepHistoryWithToast(controls(null), "redo", t);
    expect(toasts.value.length).toBe(before);
  });

  it("計算機の useHistory() の戻り値をそのまま渡せる", () => {
    const history: HistoryControls = useHistory();
    expect(history.canUndo.value).toBe(false);
  });
});
