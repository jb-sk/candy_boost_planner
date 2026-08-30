import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import type { Composer } from "vue-i18n";
import { useBoxStore } from "./useBoxStore";
import { calcExp } from "../domain/pokesleep/exp";
import { cancelPersist, flushPersist } from "../persistence/deferredPersist";

function installLocalStorageMock() {
  const store = new Map<string, string>();
  const localStorageMock = {
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
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    configurable: true,
    writable: true,
  });
}

describe("useBoxStore", () => {
  beforeEach(() => {
    cancelPersist();
    installLocalStorageMock();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    cancelPersist();
    vi.restoreAllMocks();
  });

  it("keeps sleepHours=0 when creating a manual entry", () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useBoxStore({ locale: ref("ja"), t });

    store.addLabel.value = "test";
    store.addSleepHours.value = "0";

    store.onCreateManual({ mode: "toBox" });

    expect(store.boxEntries.value).toHaveLength(1);
    expect(store.boxEntries.value[0]?.planner?.sleepHours).toBe(0);
  });

  it("defers Box persistence until the queue is flushed", async () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useBoxStore({ locale: ref("ja"), t });

    store.addLabel.value = "deferred";
    store.onCreateManual({ mode: "toBox" });
    await nextTick();

    expect(localStorage.getItem("candy-boost-planner:box:v1")).toBeNull();
    flushPersist("box");
    const saved = JSON.parse(localStorage.getItem("candy-boost-planner:box:v1") ?? "null");
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0]?.label).toBe("deferred");
  });

  it("persists immutable entry edits with the shallow Box watcher", async () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useBoxStore({ locale: ref("ja"), t });

    store.addLabel.value = "before";
    store.addFavorite.value = false;
    store.onCreateManual({ mode: "toBox" });
    store.selectedBoxId.value = store.boxEntries.value[0]?.id ?? null;
    store.onEditSelectedLabel("after");
    store.toggleSelectedFavorite();
    await nextTick();

    flushPersist("box");
    const saved = JSON.parse(localStorage.getItem("candy-boost-planner:box:v1") ?? "null");
    expect(saved.entries[0]?.label).toBe("after");
    expect(saved.entries[0]?.favorite).toBe(true);
  });

  it("persists delete and undo array replacements", async () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useBoxStore({ locale: ref("ja"), t });

    store.addLabel.value = "undo-target";
    store.onCreateManual({ mode: "toBox" });
    const entryId = store.boxEntries.value[0]?.id;
    store.selectedBoxId.value = entryId ?? null;
    store.onDeleteSelected();
    expect(store.boxEntries.value).toEqual([]);

    store.onUndo();
    await nextTick();
    flushPersist("box");

    const saved = JSON.parse(localStorage.getItem("candy-boost-planner:box:v1") ?? "null");
    expect(saved.entries.map((entry: { id: string }) => entry.id)).toEqual([entryId]);
  });

  it("restores a multi-entry import through repeated undo and redo", () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useBoxStore({ locale: ref("ja"), t });
    store.importText.value = "MQwAjwQeBy0Q\n0TRAEBRERw1p@100ウッウ（油）";

    expect(store.onImport()).toBe(2);
    const imported = JSON.parse(JSON.stringify(store.boxEntries.value));
    expect(imported).toHaveLength(2);

    for (let cycle = 0; cycle < 2; cycle++) {
      store.onUndo();
      expect(store.boxEntries.value).toEqual([]);
      store.onRedo();
      expect(store.boxEntries.value).toEqual(imported);
    }
  });

  it("restores a manual add through repeated undo and redo", () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useBoxStore({ locale: ref("ja"), t });
    store.addLabel.value = "manual-entry";
    store.onCreateManual({ mode: "toBox" });
    const added = JSON.parse(JSON.stringify(store.boxEntries.value));

    for (let cycle = 0; cycle < 2; cycle++) {
      store.onUndo();
      expect(store.boxEntries.value).toEqual([]);
      store.onRedo();
      expect(store.boxEntries.value).toEqual(added);
    }
  });

  it("keeps import, delete, and clear consistent across the full undo and redo stack", () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useBoxStore({ locale: ref("ja"), t });
    store.importText.value = "MQwAjwQeBy0Q\n0TRAEBRERw1p@100ウッウ（油）";
    expect(store.onImport()).toBe(2);
    const afterImport = JSON.parse(JSON.stringify(store.boxEntries.value));

    store.selectedBoxId.value = store.boxEntries.value[0]!.id;
    store.onDeleteSelected();
    const afterDelete = JSON.parse(JSON.stringify(store.boxEntries.value));
    expect(afterDelete).toHaveLength(1);

    store.onClearBox();
    expect(store.boxEntries.value).toEqual([]);

    store.onUndo();
    expect(store.boxEntries.value).toEqual(afterDelete);
    store.onUndo();
    expect(store.boxEntries.value).toEqual(afterImport);
    store.onUndo();
    expect(store.boxEntries.value).toEqual([]);

    store.onRedo();
    expect(store.boxEntries.value).toEqual(afterImport);
    store.onRedo();
    expect(store.boxEntries.value).toEqual(afterDelete);
    store.onRedo();
    expect(store.boxEntries.value).toEqual([]);
  });

  describe("box sort", () => {
    const t = ((key: string) => key) as unknown as Composer["t"];

    function createStoreWithEntries(
      rows: Array<{ label: string; level: number; sleepHours: string; favorite?: boolean }>
    ) {
      const store = useBoxStore({ locale: ref("ja"), t });
      for (const row of rows) {
        store.addLabel.value = row.label;
        store.addLevel.value = row.level;
        store.addSleepHours.value = row.sleepHours;
        store.addFavorite.value = !!row.favorite;
        store.onCreateManual({ mode: "toBox" });
      }
      return store;
    }

    const labels = (store: ReturnType<typeof useBoxStore>) =>
      store.sortedBoxEntries.value.map((e) => e.label);

    it("sorts by sleep hours in both directions, treating unset as 0h", () => {
      const store = createStoreWithEntries([
        { label: "b-mid", level: 10, sleepHours: "500" },
        { label: "a-none", level: 10, sleepHours: "" },
        { label: "c-top", level: 10, sleepHours: "2000" },
      ]);

      store.boxSortKey.value = "sleep";
      store.applySort("asc");
      expect(labels(store)).toEqual(["a-none", "b-mid", "c-top"]);

      store.applySort("desc");
      expect(labels(store)).toEqual(["c-top", "b-mid", "a-none"]);
    });

    it("keeps favorites on top regardless of direction for the Fav variant", () => {
      const store = createStoreWithEntries([
        { label: "plain-high", level: 10, sleepHours: "2000" },
        { label: "fav-low", level: 10, sleepHours: "10", favorite: true },
      ]);

      store.boxSortKey.value = "sleepFav";
      store.applySort("asc");
      expect(labels(store)).toEqual(["fav-low", "plain-high"]);

      store.applySort("desc");
      expect(labels(store)).toEqual(["fav-low", "plain-high"]);
    });

    it("falls back to the display title when the primary key ties", () => {
      const store = createStoreWithEntries([
        { label: "zzz", level: 20, sleepHours: "100" },
        { label: "aaa", level: 20, sleepHours: "100" },
      ]);

      store.boxSortKey.value = "sleep";
      store.applySort("asc");
      expect(labels(store)).toEqual(["aaa", "zzz"]);

      store.boxSortKey.value = "level";
      store.applySort("asc");
      expect(labels(store)).toEqual(["aaa", "zzz"]);
    });

    it("sorts by pokedex id", () => {
      const store = useBoxStore({ locale: ref("ja"), t });
      // イーブイ=133 / ピカチュウ=25 / フシギダネ=1。名前一致で derived.pokedexId が入る
      for (const species of ["イーブイ", "ピカチュウ", "フシギダネ"]) {
        store.addName.value = species;
        store.addLabel.value = species;
        store.onCreateManual({ mode: "toBox" });
      }
      expect(store.boxEntries.value.map((e) => e.derived?.pokedexId).sort((a, b) => a! - b!))
        .toEqual([1, 25, 133]);

      store.boxSortKey.value = "dex";
      store.applySort("asc");
      expect(labels(store)).toEqual(["フシギダネ", "ピカチュウ", "イーブイ"]);

      store.applySort("desc");
      expect(labels(store)).toEqual(["イーブイ", "ピカチュウ", "フシギダネ"]);
    });

    it("restores a persisted sort key and ignores an unknown one", () => {
      localStorage.setItem("candy-boost-planner:box-sort", JSON.stringify({ key: "sleepFav", dir: "desc" }));
      expect(useBoxStore({ locale: ref("ja"), t }).boxSortKey.value).toBe("sleepFav");

      localStorage.setItem("candy-boost-planner:box-sort", JSON.stringify({ key: "bogus", dir: "asc" }));
      expect(useBoxStore({ locale: ref("ja"), t }).boxSortKey.value).toBe("labelFav");
    });
  });

  describe("expRemaining clamp", () => {
    const t = ((key: string) => key) as unknown as Composer["t"];

    function createStoreWithEntry(level: number, expRemainingInput: string) {
      const store = useBoxStore({ locale: ref("ja"), t });
      store.addLabel.value = "exp-clamp";
      store.addLevel.value = level;
      store.addExpRemaining.value = expRemainingInput;
      store.onCreateManual({ mode: "toBox" });
      store.selectedBoxId.value = store.boxEntries.value[0]?.id ?? null;
      return store;
    }

    it("clamps expRemaining to the EXP needed for the next level on create", () => {
      const toNext = calcExp(15, 16, 600);
      const store = createStoreWithEntry(15, String(toNext + 5000));

      expect(store.boxEntries.value[0]?.planner?.expRemaining).toBe(toNext);
    });

    it("keeps a value inside the range untouched on create", () => {
      const store = createStoreWithEntry(15, "100");

      expect(store.boxEntries.value[0]?.planner?.expRemaining).toBe(100);
    });

    it("clamps on commit and accepts 0 as the whole next level", () => {
      const toNext = calcExp(15, 16, 600);
      const store = createStoreWithEntry(15, "");

      store.onEditSelectedExpRemaining(String(toNext + 1));
      expect(store.boxEntries.value[0]?.planner?.expRemaining).toBe(toNext);

      // 0 は「Lvが上がった直後」を表す正当な入力。計算パネル（下限1）と違って弾かない
      store.onEditSelectedExpRemaining("0");
      expect(store.boxEntries.value[0]?.planner?.expRemaining).toBe(0);
    });

    it("treats an empty input as unset", () => {
      const store = createStoreWithEntry(15, "100");

      store.onEditSelectedExpRemaining("");
      expect(store.boxEntries.value[0]?.planner?.expRemaining).toBeUndefined();
    });

    it("shows a stored value above the new cap as the cap after the level changes", () => {
      const toNextAtLv30 = calcExp(30, 31, 600);
      const store = createStoreWithEntry(30, String(toNextAtLv30));

      store.onEditSelectedLevel("5");

      // 保存値は据え置きでも、表示は新しい上限へ丸める
      expect(store.selectedDetail.value?.expRemaining).toBe(calcExp(5, 6, 600));
    });

    it("normalizes the add form input on commit", () => {
      const store = useBoxStore({ locale: ref("ja"), t });
      const toNext = calcExp(20, 21, 600);

      store.addLevel.value = 20;
      store.addExpRemaining.value = String(toNext + 1);
      store.onAddExpRemainingCommit();
      expect(store.addExpRemaining.value).toBe(String(toNext));

      // 空欄は未入力のまま（0 扱い）で、勝手に埋めない
      store.addExpRemaining.value = "";
      store.onAddExpRemainingCommit();
      expect(store.addExpRemaining.value).toBe("");
    });
  });
});
