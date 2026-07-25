import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import type { Composer } from "vue-i18n";
import { useCalcStore, type CalcRow } from "./useCalcStore";
import { solveLevelPlanWithBudget } from "../domain/level-planner/core/solveLevelPlan";
import { deriveTarget } from "../domain/level-planner/deriveTarget";
import { calcExp, calcExpAndCandy, calcLevelByCandy } from "../domain/pokesleep/exp";
import { minBoostForTarget } from "../domain/pokesleep/minBoostForTarget";
import type { LevelPlannerInput } from "../domain/level-planner/types";
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

describe("useCalcStore", () => {
  beforeEach(() => {
    cancelPersist();
    installLocalStorageMock();
  });

  afterEach(() => {
    cancelPersist();
  });

  it("preserves sleepHours=0 when importing from box", () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useCalcStore({ locale: ref("ja"), t });

    store.upsertFromBox({
      boxId: "box-1",
      srcLevel: 10,
      expType: 600,
      nature: "normal",
      sleepHours: 0,
    });

    expect(store.rows.value).toHaveLength(1);
    expect(store.rows.value[0]?.sleepHours).toBe(0);
  });

  it("updates the active slot immediately but defers slots persistence", async () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useCalcStore({ locale: ref("ja"), t });

    store.upsertFromBox({
      boxId: "deferred-calc",
      srcLevel: 10,
      expType: 600,
      nature: "normal",
    });
    await nextTick();

    expect(store.slots.value[0]?.rows).toHaveLength(1);
    expect(localStorage.getItem("candy-boost-planner:calc:slots:v1")).toBeNull();
    flushPersist("calcSlots");
    const saved = JSON.parse(localStorage.getItem("candy-boost-planner:calc:slots:v1") ?? "null");
    expect(saved.slots[0]?.rows[0]?.boxId).toBe("deferred-calc");
  });

  it("keeps field edits and row order in the active slot before persistence", async () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useCalcStore({ locale: ref("ja"), t });

    store.upsertFromBox({ boxId: "calc-a", srcLevel: 10, expType: 600, nature: "normal" });
    store.upsertFromBox({ boxId: "calc-b", srcLevel: 12, expType: 900, nature: "normal" });
    const firstId = store.rows.value[0]?.id;
    expect(firstId).toBeTruthy();

    store.onRowNature(firstId!, "up");
    store.moveRowDown(firstId!);
    await nextTick();

    expect(store.slots.value[0]?.rows.map(row => row.boxId)).toEqual(["calc-b", "calc-a"]);
    expect(store.slots.value[0]?.rows[1]?.nature).toBe("up");
    expect(localStorage.getItem("candy-boost-planner:calc:slots:v1")).toBeNull();
  });

  it("returns a read-only backup snapshot with unflushed active-slot settings", async () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useCalcStore({ locale: ref("ja"), t });
    store.upsertFromBox({ boxId: "live-row", srcLevel: 10, expType: 600, nature: "normal" });
    store.onBoostCandyRemainingInput("321");
    store.setItemCompareMode("legacyImproved");
    await nextTick();

    const snapshot = store.getBackupSnapshot();
    expect(snapshot.activeSlotIndex).toBe(0);
    expect(snapshot.slots[0]?.rows[0]?.boxId).toBe("live-row");
    expect(snapshot.slots[0]?.activeRowId).toBe(store.activeRowId.value);
    expect(snapshot.slots[0]?.boostCandyRemaining).toBe(321);
    expect(snapshot.slots[0]?.itemCompareMode).toBe("legacyImproved");
    snapshot.slots[0]!.rows[0]!.title = "changed-copy";
    expect(store.rows.value[0]?.title).not.toBe("changed-copy");
  });

  it("preserves the synchronized slot across a switch before the deferred flush", async () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useCalcStore({ locale: ref("ja"), t });

    store.upsertFromBox({ boxId: "slot-zero", srcLevel: 10, expType: 600, nature: "normal" });
    const rowId = store.rows.value[0]?.id;
    store.onRowNature(rowId!, "down");
    await nextTick();

    store.switchToSlot(1);
    expect(store.rows.value).toEqual([]);
    store.switchToSlot(0);

    expect(store.rows.value[0]?.boxId).toBe("slot-zero");
    expect(store.rows.value[0]?.nature).toBe("down");
  });

  it("repairs an active row only when the row ID structure changes", async () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useCalcStore({ locale: ref("ja"), t });

    store.upsertFromBox({ boxId: "active-a", srcLevel: 10, expType: 600, nature: "normal" });
    store.upsertFromBox({ boxId: "active-b", srcLevel: 10, expType: 600, nature: "normal" });
    const removedId = store.activeRowId.value;
    store.rows.value = store.rows.value.filter(row => row.id !== removedId);
    await nextTick();

    expect(store.activeRowId.value).toBe(store.rows.value[0]?.id);
    expect(store.slots.value[0]?.activeRowId).toBe(store.rows.value[0]?.id);
  });

  it("builds debug TSV from the reactive candy inventory without DataCloneError", async () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useCalcStore({ locale: ref("ja"), t });

    await expect(store.buildDebugExportTsv()).resolves.toMatch(/^index\tid\tname\t/);
  });

  it("loads the exact planner only when the Worker fallback is required", async () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const previousWorker = globalThis.Worker;
    Object.defineProperty(globalThis, "Worker", { value: undefined, configurable: true, writable: true });
    try {
      const store = useCalcStore({ locale: ref("ja"), t });
      store.upsertFromBox({ boxId: "fallback-1", pokedexId: 25, srcLevel: 10, dstLevelDefault: 11, expType: 600, nature: "normal" });

      await vi.waitFor(() => {
        expect(store.planResult.value?.pokemonResults).toHaveLength(1);
      }, { timeout: 10_000 });
      expect(store.calculationPerformanceProfile.value.lastCalculationMode).toBe("prefixLocalMixed");
    } finally {
      Object.defineProperty(globalThis, "Worker", { value: previousWorker, configurable: true, writable: true });
    }
  });

  it("preserves sleepHours=0 in planner patch after row edit", () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useCalcStore({ locale: ref("ja"), t });

    store.upsertFromBox({
      boxId: "box-1",
      srcLevel: 10,
      expType: 600,
      nature: "normal",
      sleepHours: 12,
    });

    const rowId = store.rows.value[0]?.id;
    expect(rowId).toBeTruthy();

    store.setRowSleepHours(rowId!, 0);

    const patch = store.buildPlannerPatchFromRow(rowId);
    expect(patch).not.toBeNull();
    expect(patch?.sleepHours).toBe(0);
  });

  it("clamps automatically assigned mini boost candy by current upper rows before planner result is available", () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useCalcStore({ locale: ref("ja"), t });

    store.upsertFromBox({
      boxId: "mini-1",
      srcLevel: 10,
      dstLevelDefault: 70,
      expType: 1320,
      nature: "down",
    });
    store.upsertFromBox({
      boxId: "mini-2",
      srcLevel: 10,
      dstLevelDefault: 70,
      expType: 1320,
      nature: "down",
    });

    const boostValues = store.rows.value.map(row => row.boostOrExpAdjustment ?? 0);
    expect(boostValues.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(350);
    expect(boostValues[0]).toBe(350);
    expect(boostValues[1]).toBe(0);
  });

  it("clamps automatically assigned full boost candy by user configured cap before planner result is available", () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useCalcStore({ locale: ref("ja"), t });

    store.setSlotBoostKind("full");
    store.onBoostCandyRemainingInput("500");
    store.upsertFromBox({
      boxId: "full-1",
      srcLevel: 10,
      dstLevelDefault: 70,
      expType: 1320,
      nature: "down",
    });
    store.upsertFromBox({
      boxId: "full-2",
      srcLevel: 10,
      dstLevelDefault: 70,
      expType: 1320,
      nature: "down",
    });

    const boostValues = store.rows.value.map(row => row.boostOrExpAdjustment ?? 0);
    expect(boostValues.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(500);
    expect(boostValues[0]).toBe(500);
    expect(boostValues[1]).toBe(0);
  });

  it("keeps automatic calculation exact after fbl01c replaces deadline fallback", async () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const previousWorker = globalThis.Worker;
    const workers: Array<{ onmessage: ((event: MessageEvent) => void) | null; postMessage: (message: unknown) => void; terminate: () => void }> = [];
    const requests: Array<Record<string, unknown>> = [];
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor() {
        workers.push(this);
      }
      postMessage(message: unknown) {
        requests.push(message as Record<string, unknown>);
      }
      terminate() {}
    }

    Object.defineProperty(globalThis, "Worker", { value: FakeWorker, configurable: true, writable: true });
    try {
      const store = useCalcStore({ locale: ref("ja"), t });
      store.upsertFromBox({ boxId: "worker-1", pokedexId: 25, srcLevel: 10, dstLevelDefault: 30, expType: 600, nature: "normal" });
      store.upsertFromBox({ boxId: "worker-2", pokedexId: 26, srcLevel: 10, dstLevelDefault: 30, expType: 600, nature: "normal" });
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(requests).toHaveLength(1);
      const request = requests[0];
      const outcome = solveLevelPlanWithBudget(request.input as LevelPlannerInput, { deadlineMs: 60_000, abortAfterExpansions: 1 });
      expect(outcome.kind).toBe("result");
      if (outcome.kind !== "result") return;

      workers[0]?.onmessage?.({ data: {
        kind: "result",
        slotId: request.slotId,
        requestId: request.requestId,
        lane: "auto",
        inputSignature: request.inputSignature,
        calculationMode: "exact",
        result: outcome.result,
        durationMs: outcome.durationMs,
      } } as MessageEvent);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(store.calculationPerformanceProfile.value.lastCalculationMode).toBe("exact");
      expect(store.calculationPerformanceProfile.value.mixedPrefixCount).toBeUndefined();
      expect(store.showManualExactVerification.value).toBe(false);
      expect(workers).toHaveLength(1);
    } finally {
      Object.defineProperty(globalThis, "Worker", { value: previousWorker, configurable: true, writable: true });
    }
  });
});

/**
 * 個数指定と目標Lvの一本化（設計書 §4.3 / §5.3）の状態遷移。
 */
describe("useCalcStore: 個数指定と目標Lvの連動", () => {
  beforeEach(() => {
    cancelPersist();
    installLocalStorageMock();
  });

  afterEach(() => {
    cancelPersist();
  });

  const t = ((key: string) => key) as unknown as Composer["t"];

  function makeStore() {
    const store = useCalcStore({ locale: ref("ja"), t });
    store.upsertFromBox({ boxId: "box-1", pokedexId: 25, srcLevel: 10, dstLevelDefault: 30, expType: 600, nature: "normal" });
    const id = store.rows.value[0]!.id;
    return { store, id };
  }

  const rowOf = (store: ReturnType<typeof useCalcStore>, id: string) => store.rows.value.find((r) => r.id === id)!;

  it("個数指定を入力すると dstLevel が実効目標のLvへ同期される", () => {
    const { store, id } = makeStore();
    store.onRowCandyTarget(id, "40");
    const r = rowOf(store, id);
    expect(r.candyTarget).toBe(40);
    // dstLevel は「40個を使い切った到達点のLv」と一致する（保存値と表示値が乖離しない）
    expect(r.dstLevel).toBeLessThanOrEqual(30);
    expect(r.dstLevel).toBeGreaterThanOrEqual(r.srcLevel);
  });

  it("個数指定を空欄にすると個数指定なしへ戻り、dstLevel は据え置かれる", () => {
    const { store, id } = makeStore();
    store.onRowCandyTarget(id, "40");
    const dstAfterTarget = rowOf(store, id).dstLevel;

    store.onRowCandyTarget(id, "");
    const r = rowOf(store, id);
    expect(r.candyTarget).toBeUndefined();
    expect(r.sleepTargetHours).toBeUndefined();
    expect(r.dstLevel).toBe(dstAfterTarget);
  });

  it("個数指定を下げるとアメブ個数がクランプされる（個数指定が駆動側）", () => {
    const { store, id } = makeStore();
    store.onRowBoostCandy(id, "300");
    store.onRowCandyTarget(id, "10");
    const r = rowOf(store, id);
    expect(r.candyTarget).toBe(10);
    expect(r.boostOrExpAdjustment).toBe(10);
  });

  it("アメブ個数を上げると個数指定が引き上がる（アメブが駆動側）", () => {
    const { store, id } = makeStore();
    store.onRowCandyTarget(id, "10");
    store.onRowBoostCandy(id, "300");
    const r = rowOf(store, id);
    expect(r.boostOrExpAdjustment).toBe(300);
    expect(r.candyTarget).toBe(300);
  });

  it("アメブ個数を目標Lv超えまで増やすと、目標Lvが連動して上がる", () => {
    const { store, id } = makeStore();
    const before = rowOf(store, id);
    const beyond = (before.boostOrExpAdjustment ?? 0) + 300;

    store.onRowBoostCandy(id, String(beyond));
    const after = rowOf(store, id);
    expect(after.boostOrExpAdjustment).toBe(beyond);
    expect(after.candyTarget).toBe(beyond);
    expect(after.dstLevel).toBeGreaterThan(before.dstLevel);
    expect(after.boostReachLevel).toBe(after.dstLevel);
  });

  it("アメブ目標Lvは置換が効くLvでも1段ずつ上がる（表示をアメブ個数から逆算しない）", () => {
    const { store, id } = makeStore();
    store.setDstLevel(id, 60);
    store.setSrcLevel(id, 50);
    store.setDstLevel(id, 51);

    const uiReach = () => store.rowsView.value.find((x) => x.id === id)!.ui.boostReachLevel;

    // 置換が効いていても、表示は「アメブでどこまで賄うか」の指定値のまま
    for (let lv = 52; lv <= 58; lv++) {
      store.setBoostLevel(id, uiReach() + 1);
      expect(uiReach(), `boostReachLevel after stepping to Lv${lv}`).toBe(lv);
      expect(rowOf(store, id).dstLevel, `dstLevel after stepping to Lv${lv}`).toBe(lv);
    }
  });

  it("アメブ目標Lvが目標Lvより下なら置換せず、アメブだけでそのLvへ実際に到達する", () => {
    const { store, id } = makeStore();
    store.setDstLevel(id, 60);
    store.setSrcLevel(id, 50);

    const reachedByBoost = (r: CalcRow) => {
      const toNext = calcExp(r.srcLevel, r.srcLevel + 1, r.expType);
      return calcLevelByCandy({
        srcLevel: r.srcLevel, dstLevel: 70, expType: r.expType, nature: r.nature,
        boost: store.boostKind.value, candy: r.boostOrExpAdjustment ?? 0,
        expGot: r.expRemaining > 0 ? Math.max(0, toNext - r.expRemaining) : 0,
      }).level;
    };

    // 目標Lv60 に対しアメブ目標Lv55（その先は通常アメ）→ 置換なしで 55 へ届く
    store.setDstLevel(id, 60);
    store.setBoostLevel(id, 55);
    const partial = rowOf(store, id);
    expect(partial.boostReachLevel).toBe(55);
    expect(reachedByBoost(partial)).toBe(55);

    // 目標Lvを 55 まで下げるとアメブが目標全体を賄うので、置換が効いて1個減る
    store.setDstLevel(id, 55);
    const whole = rowOf(store, id);
    expect(whole.boostOrExpAdjustment!).toBeLessThanOrEqual(partial.boostOrExpAdjustment!);

    // 目標Lvを再び上げたら、削った1個を戻してアメブ目標Lvへ届く状態に復元する
    store.setDstLevel(id, 60);
    const restored = rowOf(store, id);
    expect(restored.boostReachLevel).toBe(55);
    expect(reachedByBoost(restored)).toBe(55);
  });

  it("目標Lvを行き来しても置換の当否が入れ替わり、状態が残らない", () => {
    const { store, id } = makeStore();
    store.setDstLevel(id, 60);
    store.setSrcLevel(id, 50);
    store.setDstLevel(id, 51);
    store.setBoostLevel(id, 51);

    const boostAt = (dst: number) => {
      store.setDstLevel(id, dst);
      return rowOf(store, id).boostOrExpAdjustment!;
    };

    // アメブが目標全体を賄う目標Lv51 では置換が効き、上の目標Lvでは戻る
    const patched = boostAt(51);
    const unpatched = boostAt(52);
    expect(unpatched).toBe(patched + 1);

    // 何度行き来しても同じ値に落ち着く（前の状態が残らない）
    expect(boostAt(51)).toBe(patched);
    expect(boostAt(55)).toBe(unpatched);
    expect(boostAt(51)).toBe(patched);
    expect(rowOf(store, id).boostReachLevel).toBe(51);
  });

  it("アメブ目標Lvの指定では「アメブ1個→通常アメ1個」置換を効かせてかけらを節約する", () => {
    const { store, id } = makeStore();
    store.setDstLevel(id, 60);
    store.setSrcLevel(id, 50);
    store.setDstLevel(id, 51);
    store.setBoostLevel(id, 55);

    const r = rowOf(store, id);
    const toNext = calcExp(r.srcLevel, r.srcLevel + 1, r.expType);
    const shared = {
      srcLevel: r.srcLevel, expType: r.expType, nature: r.nature,
      expGot: r.expRemaining > 0 ? Math.max(0, toNext - r.expRemaining) : 0,
    };
    const expected = minBoostForTarget({
      ...shared, targetLevel: 55, targetExpInLevel: 0,
      boostKind: store.boostKind.value, maxBoost: Number.MAX_SAFE_INTEGER,
    });
    const full = calcExpAndCandy({ ...shared, dstLevel: 55, dstExpInLevel: 0, boost: store.boostKind.value }).candy;

    expect(r.boostReachLevel).toBe(55);
    expect(r.boostOrExpAdjustment).toBe(expected);
    expect(expected).toBeLessThanOrEqual(full);
  });

  it("アメブ目標Lvはグローバル上限に頭打ちされず、指定したLvまで上がりきる", () => {
    const { store, id } = makeStore();
    // ミニブのグローバル上限(350)を大きく超えるアメブ数が要るLvを指定する
    for (const lv of [58, 62, 66, 70]) {
      store.setBoostLevel(id, lv);
      const r = rowOf(store, id);
      expect(r.boostReachLevel, `boostReachLevel at Lv${lv}`).toBe(lv);
      expect(r.dstLevel, `dstLevel at Lv${lv}`).toBe(lv);
    }
    expect(rowOf(store, id).boostOrExpAdjustment!).toBeGreaterThan(350);
  });

  it("アメブ目標Lvを目標Lv超へ上げると、目標Lvが上がりアメブ個数・個数指定がリセットされる", () => {
    const { store, id } = makeStore();
    store.onRowCandyTarget(id, "40");
    const before = rowOf(store, id);
    const beyond = before.dstLevel + 5;

    store.setBoostLevel(id, beyond);
    const after = rowOf(store, id);
    expect(after.dstLevel).toBe(beyond);
    // 個数指定はリセット（新しい目標に対する自動最大化からやり直す）
    expect(after.candyTarget).toBeUndefined();
    expect(after.boostOrExpAdjustment!).toBeGreaterThan(before.boostOrExpAdjustment!);
  });

  it("アメブを最小数より積むと個数指定が自動で立ち、目標のLv内EXPが伸びる", () => {
    const { store, id } = makeStore();
    const before = rowOf(store, id);
    const targetOf = (r: typeof before) => {
      const toNext = calcExp(r.srcLevel, r.srcLevel + 1, r.expType);
      return deriveTarget({
        srcLevel: r.srcLevel,
        expGot: r.expRemaining > 0 ? Math.max(0, toNext - r.expRemaining) : 0,
        dstLevel: r.dstLevel,
        candyTarget: r.candyTarget,
        boostCandy: r.boostOrExpAdjustment ?? 0,
        expType: r.expType,
        nature: r.nature,
        boostKind: store.boostKind.value,
      });
    };

    // 自動最大化値そのままなら「個数指定なし・Lvちょうど」（ceilの余剰を目標へ混ぜない。§3.8-d）
    expect(before.candyTarget).toBeUndefined();
    expect(targetOf(before).targetExpInLevel).toBe(0);

    // 1個積むと個数指定あり（＝アメブ個数そのもの）へ遷移し、その到達点まで目標が伸びる
    const raised = (before.boostOrExpAdjustment ?? 0) + 1;
    store.onRowBoostCandy(id, String(raised));
    const after = rowOf(store, id);
    expect(after.candyTarget).toBe(raised);
    expect(targetOf(after).targetExpInLevel).toBeGreaterThan(0);
  });

  it("個数指定なしの行では、アメブ個数を下げても目標Lvが動かない", () => {
    const { store, id } = makeStore();
    const before = rowOf(store, id).dstLevel;
    store.onRowBoostCandy(id, "1");
    const r = rowOf(store, id);
    expect(r.candyTarget).toBeUndefined();
    expect(r.dstLevel).toBe(before);
  });

  it("個数指定ありの行でアメブを下げると、個数指定は据え置きで目標Lvが下がる", () => {
    const { store, id } = makeStore();
    store.onRowCandyTarget(id, "40");
    const before = rowOf(store, id);
    const beforeDst = before.dstLevel;

    store.onRowBoostCandy(id, "0");
    const after = rowOf(store, id);
    expect(after.candyTarget).toBe(40);
    expect(after.dstLevel).toBeLessThanOrEqual(beforeDst);
  });

  it("目標Lvピッカー操作で個数指定がクリアされる（睡眠目標なしの場合）", () => {
    const { store, id } = makeStore();
    store.onRowCandyTarget(id, "40");
    expect(rowOf(store, id).candyTarget).toBe(40);

    store.setDstLevel(id, 35);
    const r = rowOf(store, id);
    expect(r.candyTarget).toBeUndefined();
    expect(r.dstLevel).toBe(35);
  });

  it("睡眠目標時間を設定すると candyTarget が保存され、不変条件が保たれる", () => {
    const { store, id } = makeStore();
    store.setRowSleepTargetHours(id, 1000);
    const r = rowOf(store, id);
    expect(r.sleepTargetHours).toBe(1000);
    // 不変条件: sleepTargetHours !== undefined ⇒ candyTarget !== undefined
    expect(r.candyTarget).not.toBeUndefined();
  });

  it("睡眠目標時間を上げると個数指定が減る（目標Lvは維持）", () => {
    const { store, id } = makeStore();
    store.setRowSleepTargetHours(id, 200);
    const small = rowOf(store, id);
    store.setRowSleepTargetHours(id, 2000);
    const large = rowOf(store, id);
    expect(large.candyTarget!).toBeLessThanOrEqual(small.candyTarget!);
  });

  it("同じ睡眠目標時間を選び直しても結果が変わらない（冪等）", () => {
    const { store, id } = makeStore();
    store.setRowSleepTargetHours(id, 1000);
    const first = { ...rowOf(store, id) };
    store.setRowSleepTargetHours(id, 1000);
    const second = rowOf(store, id);
    expect(second.candyTarget).toBe(first.candyTarget);
    expect(second.dstLevel).toBe(first.dstLevel);
  });

  it("睡眠目標時間があるときは、目標Lvを変更しても睡眠設定が維持され個数指定が再計算される", () => {
    const { store, id } = makeStore();
    store.setRowSleepTargetHours(id, 1000);
    const before = rowOf(store, id).candyTarget;

    store.setDstLevel(id, 40);
    const r = rowOf(store, id);
    expect(r.sleepTargetHours).toBe(1000);
    expect(r.candyTarget).not.toBeUndefined();
    expect(r.dstLevel).toBe(40);
    // 目標が上がったので、アメで賄う分も増える
    expect(r.candyTarget!).toBeGreaterThanOrEqual(before!);
  });

  it("睡眠目標時間を解除しても candyTarget は通常の個数指定として残る", () => {
    const { store, id } = makeStore();
    store.setRowSleepTargetHours(id, 1000);
    const saved = rowOf(store, id).candyTarget;

    store.setRowSleepTargetHours(id, undefined);
    const r = rowOf(store, id);
    expect(r.sleepTargetHours).toBeUndefined();
    expect(r.candyTarget).toBe(saved);
  });

  it("累計睡眠時間を変更すると個数指定が追従する", () => {
    const { store, id } = makeStore();
    store.setRowSleepTargetHours(id, 1000);
    const before = rowOf(store, id).candyTarget!;

    // 既に 900h 寝ている → これから寝る時間が減る → アメで賄う分が増える
    store.setRowSleepHours(id, 900);
    const after = rowOf(store, id).candyTarget!;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("現在Lvを変更すると個数指定・睡眠目標が解除される（ボックス同期と同じ規則）", () => {
    const { store, id } = makeStore();
    store.setRowSleepTargetHours(id, 1000);
    expect(rowOf(store, id).candyTarget).not.toBeUndefined();

    store.setSrcLevel(id, 15);
    const r = rowOf(store, id);
    expect(r.candyTarget).toBeUndefined();
    expect(r.sleepTargetHours).toBeUndefined();
  });

  it("ボックス同期は元Lvが変わらなければ個数指定・睡眠目標を維持し、dstLevel も戻さない", () => {
    const { store, id } = makeStore();
    store.setDstLevel(id, 45);
    store.onRowCandyTarget(id, "30");
    const beforeDst = rowOf(store, id).dstLevel;

    // 同じ元Lvで再同期
    store.upsertFromBox({ boxId: "box-1", pokedexId: 25, srcLevel: 10, dstLevelDefault: 60, expType: 600, nature: "normal" });
    const r = rowOf(store, id);
    expect(r.candyTarget).toBe(30);
    expect(r.dstLevel).toBe(beforeDst);
  });

  it("ボックス同期で元Lvが変わると個数指定・睡眠目標が解除される", () => {
    const { store, id } = makeStore();
    store.onRowCandyTarget(id, "30");
    store.setRowSleepTargetHours(id, 1000);

    store.upsertFromBox({ boxId: "box-1", pokedexId: 25, srcLevel: 20, dstLevelDefault: 60, expType: 600, nature: "normal" });
    const r = rowOf(store, id);
    expect(r.srcLevel).toBe(20);
    expect(r.candyTarget).toBeUndefined();
    expect(r.sleepTargetHours).toBeUndefined();
  });

  it("個数指定 → アメブ変更を往復しても値が振動しない", () => {
    const { store, id } = makeStore();
    store.onRowCandyTarget(id, "40");
    store.onRowBoostCandy(id, "10");
    const first = { ...rowOf(store, id) };

    store.onRowBoostCandy(id, "10");
    store.onRowBoostCandy(id, "10");
    const stable = rowOf(store, id);
    expect(stable.dstLevel).toBe(first.dstLevel);
    expect(stable.candyTarget).toBe(first.candyTarget);
    expect(stable.boostOrExpAdjustment).toBe(first.boostOrExpAdjustment);
  });

  it("目標到達に必要な数をそのまま個数指定に入れて外しても、目標Lv・アメブ個数が変わらない", () => {
    const { store, id } = makeStore();
    const before = { ...rowOf(store, id) };
    // 「目標まで」行と同じ必要総アメ数（アプリと同じ deriveTarget で求める）
    const toNext = calcExp(before.srcLevel, before.srcLevel + 1, before.expType);
    const needed = deriveTarget({
      srcLevel: before.srcLevel,
      expGot: before.expRemaining > 0 ? Math.max(0, toNext - before.expRemaining) : 0,
      dstLevel: before.dstLevel,
      boostCandy: before.boostOrExpAdjustment ?? 0,
      expType: before.expType,
      nature: before.nature,
      boostKind: store.boostKind.value,
    }).requiredCandy;

    store.onRowCandyTarget(id, String(needed));
    const withTarget = rowOf(store, id);
    expect(withTarget.candyTarget).toBe(needed);
    expect(withTarget.dstLevel).toBe(before.dstLevel);
    expect(withTarget.boostOrExpAdjustment).toBe(before.boostOrExpAdjustment);

    store.onRowCandyTarget(id, "");
    const cleared = rowOf(store, id);
    expect(cleared.candyTarget).toBeUndefined();
    expect(cleared.dstLevel).toBe(before.dstLevel);
    expect(cleared.boostOrExpAdjustment).toBe(before.boostOrExpAdjustment);
  });

  it("個数指定の確定値だけを受け取る（入力途中の桁でアメブ個数を潰さない）", () => {
    const { store, id } = makeStore();
    const before = rowOf(store, id).boostOrExpAdjustment;
    expect(before).toBeGreaterThan(1);

    // UI は Enter / フォーカスアウトで確定してから onRowCandyTarget を呼ぶ。
    // 仮に途中の桁が渡ってもアメブは内数クランプされるが、確定値で呼び直せば復元する。
    store.onRowCandyTarget(id, "1");
    expect(rowOf(store, id).boostOrExpAdjustment).toBe(1);

    store.onRowCandyTarget(id, "");
    store.onRowCandyTarget(id, String(before));
    expect(rowOf(store, id).candyTarget).toBe(before);
  });
});
