import { beforeEach, describe, expect, it } from "vitest";
import { BOX_STORAGE_KEY, loadBoxData } from "./box";
import { CALC_SLOTS_STORAGE_KEY } from "./calc";
import { applyIndividualMigration, migrateLegacyIndividuals, migrateStoredIndividuals } from "./legacyIndividuals";

const OLD = "2026-01-01T00:00:00.000Z";
const MID = "2026-02-01T00:00:00.000Z";
const NEW = "2026-03-01T00:00:00.000Z";

type Json = Record<string, unknown>;

/** ボックスの生データ1体。Lv 10・あとEXP 20・睡眠 0h・性格 normal（EXPタイプ 600）。 */
function boxEntry(id: string, over: Json = {}): Json {
  return {
    id,
    source: "manual",
    rawText: "",
    label: id,
    favorite: false,
    derived: { pokedexId: 25, form: 0, level: 10, expType: 600, expGainNature: "normal", natureName: "" },
    planner: { level: 10, expRemaining: 20, sleepHours: 0, expType: 600, expGainNature: "normal" },
    createdAt: OLD,
    updatedAt: MID,
    ...over,
  };
}

/** 計算機の生の行。ボックスと食い違う値（Lv 20・あとEXP 50・睡眠 8h・性格 up）を持つ。 */
function calcRow(id: string, boxId: string | undefined, over: Json = {}): Json {
  return {
    id,
    boxId,
    title: id,
    srcLevel: 20,
    dstLevel: 30,
    expRemaining: 50,
    expType: 600,
    nature: "up",
    boostReachLevel: 30,
    sleepHours: 8,
    ...over,
  };
}

function rawSlot(rows: Json[], savedAt: string | undefined): Json {
  const slot: Json = { slotId: `slot-${rows[0]?.id}`, rows, activeRowId: null, boostKind: "full" };
  if (savedAt !== undefined) slot.savedAt = savedAt;
  return slot;
}

const slotsStore = (slots: Array<Json | null>, schemaVersion = 2): Json => ({ schemaVersion, slots });
const boxStore = (entries: Json[]): Json => ({ schemaVersion: 2, entries, tags: [] });

const FROM_ROW = { level: 20, expRemaining: 50, sleepHours: 8, expType: 600, expGainNature: "up" };

describe("migrateLegacyIndividuals", () => {
  it("ボックスより新しいスロットの行の値を採る", () => {
    const patches = migrateLegacyIndividuals(
      boxStore([boxEntry("b1", { updatedAt: MID })]),
      slotsStore([rawSlot([calcRow("r1", "b1")], NEW), null, null]),
      0,
    );
    expect(patches.get("b1")).toEqual(FROM_ROW);
  });

  it("スロットより新しいボックスの値を採る（patch を作らない）", () => {
    const patches = migrateLegacyIndividuals(
      boxStore([boxEntry("b1", { updatedAt: NEW })]),
      slotsStore([rawSlot([calcRow("r1", "b1")], MID), null, null]),
      0,
    );
    expect(patches.size).toBe(0);
  });

  it("表示中でないスロットでも、最も新しければその行の値を採る", () => {
    const patches = migrateLegacyIndividuals(
      boxStore([boxEntry("b1", { updatedAt: MID })]),
      slotsStore([
        rawSlot([calcRow("r0", "b1", { srcLevel: 11, dstLevel: 30 })], OLD),
        null,
        rawSlot([calcRow("r2", "b1")], NEW),
      ]),
      0,
    );
    expect(patches.get("b1")).toEqual(FROM_ROW);
  });

  it("同時刻なら 表示中スロット → ボックス → ほかのスロット の順に採る", () => {
    const slots = slotsStore([
      rawSlot([calcRow("r0", "b1", { srcLevel: 11, dstLevel: 30 })], MID),
      rawSlot([calcRow("r1", "b1", { srcLevel: 12, dstLevel: 30 })], MID),
      null,
    ]);
    const box = boxStore([boxEntry("b1", { updatedAt: MID })]);
    expect(migrateLegacyIndividuals(box, slots, 1).get("b1")?.level).toBe(12);
    expect(migrateLegacyIndividuals(box, slots, 0).get("b1")?.level).toBe(11);
    // 表示中スロットに無い個体は、ボックスがほかのスロットに勝つ
    expect(migrateLegacyIndividuals(box, slots, 2).size).toBe(0);
  });

  it("スロットの savedAt が無ければ時刻で比べず、ボックスが新しくても表示中スロットの行を採る", () => {
    const patches = migrateLegacyIndividuals(
      boxStore([boxEntry("b1", { updatedAt: NEW })]),
      slotsStore([rawSlot([calcRow("r1", "b1")], undefined), null, null]),
      0,
    );
    expect(patches.get("b1")).toEqual(FROM_ROW);
  });

  it("ボックスの updatedAt が無ければ時刻で比べず、表示中スロットの行を採る（古いスロットでも）", () => {
    const entry = boxEntry("b1");
    delete entry.updatedAt;
    const patches = migrateLegacyIndividuals(
      boxStore([entry]),
      slotsStore([rawSlot([calcRow("r1", "b1")], OLD), null, null]),
      0,
    );
    expect(patches.get("b1")).toEqual(FROM_ROW);
  });

  it("時刻で比べられず、表示中スロットに個体が無ければボックスの値を採る", () => {
    const entry = boxEntry("b1");
    delete entry.updatedAt;
    const patches = migrateLegacyIndividuals(
      boxStore([entry]),
      slotsStore([null, rawSlot([calcRow("r1", "b1")], NEW), null]),
      0,
    );
    expect(patches.size).toBe(0);
  });

  it("時刻を持つ個体と持たない個体を、個体ごとに判定する", () => {
    const noTime = boxEntry("b2");
    delete noTime.updatedAt;
    const patches = migrateLegacyIndividuals(
      boxStore([boxEntry("b1", { updatedAt: NEW }), noTime]),
      slotsStore([rawSlot([calcRow("r1", "b1"), calcRow("r2", "b2")], MID), null, null]),
      0,
    );
    expect([...patches.keys()]).toEqual(["b2"]);
  });

  it("リンク切れの行（boxId なし・参照先なし）は扱わない", () => {
    const patches = migrateLegacyIndividuals(
      boxStore([boxEntry("b1", { updatedAt: OLD })]),
      slotsStore([rawSlot([calcRow("r1", undefined), calcRow("r2", "missing")], NEW), null, null]),
      0,
    );
    expect(patches.size).toBe(0);
  });

  it("値が同じなら patch を作らない（あとEXP 0 は次Lvまで全部と同じ解釈）", () => {
    const entry = boxEntry("b1", { updatedAt: OLD, planner: { level: 10, sleepHours: 0, expType: 600, expGainNature: "normal" } });
    const patches = migrateLegacyIndividuals(
      boxStore([entry]),
      slotsStore([rawSlot([calcRow("r1", "b1", { srcLevel: 10, expRemaining: 0, nature: "normal", sleepHours: undefined })], NEW), null, null]),
      0,
    );
    expect(patches.size).toBe(0);
  });

  it("行のあとEXP 0 は「次Lvまで全部」（未設定）として移す", () => {
    const patches = migrateLegacyIndividuals(
      boxStore([boxEntry("b1", { updatedAt: OLD })]),
      slotsStore([rawSlot([calcRow("r1", "b1", { expRemaining: 0 })], NEW), null, null]),
      0,
    );
    expect(patches.get("b1")).toEqual({ ...FROM_ROW, expRemaining: undefined });
  });

  it("配列そのものの旧い保存形式も読める", () => {
    const patches = migrateLegacyIndividuals(
      [boxEntry("b1", { updatedAt: OLD })],
      [rawSlot([calcRow("r1", "b1")], NEW), null, null],
      0,
    );
    expect(patches.get("b1")).toEqual(FROM_ROW);
  });
});

describe("applyIndividualMigration", () => {
  it("patch がある個体だけ planner と updatedAt を書き換える", () => {
    const a = { id: "a", planner: { level: 5, specialty: "Berries" as const }, updatedAt: OLD };
    const b = { id: "b", updatedAt: OLD };
    const now = new Date(NEW);
    const out = applyIndividualMigration([a, b], new Map([["a", {
      level: 20, expRemaining: undefined, sleepHours: 8, expType: 600, expGainNature: "up",
    }]]), now);
    expect(out[0]).toEqual({
      id: "a",
      planner: { level: 20, expRemaining: undefined, sleepHours: 8, expType: 600, expGainNature: "up", specialty: "Berries" },
      updatedAt: NEW,
    });
    expect(out[1]).toBe(b);
  });
});

describe("migrateStoredIndividuals（起動時の移行）", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
        setItem: (key: string, value: string) => { store.set(key, value); },
        removeItem: (key: string) => { store.delete(key); },
        clear: () => { store.clear(); },
      },
      configurable: true,
      writable: true,
    });
  });

  const put = (key: string, value: unknown) => store.set(key, JSON.stringify(value));
  const boxLevel = () => loadBoxData().entries[0]?.planner?.level;
  const slotsVersion = () => JSON.parse(store.get(CALC_SLOTS_STORAGE_KEY)!).schemaVersion;

  it("schema 2 のスロットは、ボックスへ値を移し、schema 3 で保存し直す", () => {
    put(BOX_STORAGE_KEY, boxStore([boxEntry("b1", { updatedAt: MID })]));
    put(CALC_SLOTS_STORAGE_KEY, slotsStore([rawSlot([calcRow("r1", "b1")], NEW), null, null]));

    migrateStoredIndividuals(new Date(NEW));

    const moved = loadBoxData().entries[0];
    expect(moved?.planner).toMatchObject({ level: 20, expRemaining: 50, sleepHours: 8, expGainNature: "up" });
    expect(moved?.updatedAt).toBe(NEW);
    expect(slotsVersion()).toBe(3);
    // 行は書き換えない（移行の後は通常の同期が揃える）
    expect(JSON.parse(store.get(CALC_SLOTS_STORAGE_KEY)!).slots[0].rows[0]).toMatchObject({ srcLevel: 20, expRemaining: 50 });
  });

  it("起動時に読んだ生データの時刻で比べる（時刻の無いスロットを現在時刻で埋めて勝たせない）", () => {
    put(BOX_STORAGE_KEY, boxStore([boxEntry("b1", { updatedAt: MID })]));
    // 表示中スロットに無い個体で、savedAt が無い。時刻で比べられないのでボックスが勝つ
    put(CALC_SLOTS_STORAGE_KEY, slotsStore([null, rawSlot([calcRow("r1", "b1")], undefined), null]));

    migrateStoredIndividuals(new Date(NEW));

    expect(boxLevel()).toBe(10);
    expect(slotsVersion()).toBe(3);
  });

  it("1回だけ走る（schema 3 になった後は、行がボックスと違っても何もしない）", () => {
    put(BOX_STORAGE_KEY, boxStore([boxEntry("b1", { updatedAt: OLD })]));
    put(CALC_SLOTS_STORAGE_KEY, slotsStore([rawSlot([calcRow("r1", "b1")], NEW), null, null]));
    migrateStoredIndividuals(new Date(NEW));
    expect(boxLevel()).toBe(20);

    // 裏のスロットの古い値や、後からボックスで変えた値を、2回目の起動で上書きしない
    put(BOX_STORAGE_KEY, boxStore([boxEntry("b1", { updatedAt: OLD })]));
    const before = store.get(BOX_STORAGE_KEY);
    migrateStoredIndividuals(new Date(NEW));
    expect(store.get(BOX_STORAGE_KEY)).toBe(before);
    expect(boxLevel()).toBe(10);
  });

  it("schema 3 のスロットでは走らない", () => {
    put(BOX_STORAGE_KEY, boxStore([boxEntry("b1", { updatedAt: OLD })]));
    put(CALC_SLOTS_STORAGE_KEY, slotsStore([rawSlot([calcRow("r1", "b1")], NEW), null, null], 3));
    const before = store.get(BOX_STORAGE_KEY);
    const slotsBefore = store.get(CALC_SLOTS_STORAGE_KEY);

    migrateStoredIndividuals(new Date(NEW));

    expect(store.get(BOX_STORAGE_KEY)).toBe(before);
    expect(store.get(CALC_SLOTS_STORAGE_KEY)).toBe(slotsBefore);
  });

  it("スロットの保存データが無ければ何もしない", () => {
    put(BOX_STORAGE_KEY, boxStore([boxEntry("b1")]));
    const before = store.get(BOX_STORAGE_KEY);
    migrateStoredIndividuals(new Date(NEW));
    expect(store.get(BOX_STORAGE_KEY)).toBe(before);
    expect(store.has(CALC_SLOTS_STORAGE_KEY)).toBe(false);
  });
});
