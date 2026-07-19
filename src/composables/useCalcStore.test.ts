import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextTick, ref } from "vue";
import type { Composer } from "vue-i18n";
import { useCalcStore } from "./useCalcStore";
import { solveLevelPlanWithBudget } from "../domain/level-planner/core/solveLevelPlan";
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

  it("builds debug TSV from the reactive candy inventory without DataCloneError", () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useCalcStore({ locale: ref("ja"), t });

    expect(() => store.buildDebugExportTsv()).not.toThrow();
    expect(store.buildDebugExportTsv()).toMatch(/^index\tid\tname\t/);
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
