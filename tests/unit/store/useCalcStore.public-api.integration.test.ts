import { effectScope, ref } from "vue";
import type { Composer } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCalcStore } from "../../../src/composables/useCalcStore";

const t = ((key: string) => key) as unknown as Composer["t"];

function installLocalStorageMock(): Map<string, string> {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  });
  return values;
}

describe("useCalcStore public API integration", () => {
  let persisted: Map<string, string>;

  beforeEach(() => {
    persisted = installLocalStorageMock();
  });

  it("keeps add → sleep/settings → result → undo/redo → persistence/restore as one public flow", async () => {
    const firstScope = effectScope();
    const store = firstScope.run(() => useCalcStore({
      locale: ref("ja"),
      t,
      currentGameDate: "2026-08-24",
    }))!;

    store.setSlotBoostKind("full");
    store.onBoostCandyRemainingInput("80");
    store.onTotalShardsInput("750000");
    store.upsertFromBox({
      boxId: "public-flow-box",
      title: "Public flow Pikachu",
      pokedexId: 25,
      pokemonType: "Electric",
      srcLevel: 20,
      dstLevelDefault: 50,
      expRemaining: 200,
      expType: 600,
      nature: "normal",
    });
    const rowId = store.rows.value[0]!.id;
    store.updateSpeciesCandy(25, 120);
    store.setRowSleepTargetHours(rowId, 1000);
    store.updateSleepSettings({
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: true, fullMoon: true, afterFullMoon: false },
      growthIncenseNormalPerWeek: 2,
      growthIncenseStock: 20,
      timeZone: "America/New_York",
    });

    await vi.waitFor(() => {
      expect(store.planResultPending.value).toBe(false);
      expect(store.planResult.value?.pokemonResults).toHaveLength(1);
    }, { timeout: 10_000 });

    const result = store.getPokemonResult(rowId)!;
    expect({
      sleepExp: store.rowSleepExpFor(rowId),
      incense: store.rowGrowthIncenseCountFor(rowId),
      shardsUsed: store.totalShardsUsed.value,
      boostUsed: store.totalBoostCandyUsed.value,
      universalCandyUsed: store.universalCandyUsedTotal.value,
      role: result.role,
      reachedLevel: result.reachableLine.level,
      reachedCandy: result.reachableLine.totalCandyUnitsUsed,
      reachedShards: result.reachableLine.dreamShardsUsed,
      shortageCandy: result.shortage.candyToTarget,
      shortageExp: result.shortage.expToTarget,
      limitingFactor: result.constraintDiagnosis.limitingFactor,
    }).toEqual({
      sleepExp: 16500,
      incense: 20,
      shardsUsed: 44251,
      boostUsed: 80,
      universalCandyUsed: { s: 0, m: 0, l: 0 },
      role: "boundary",
      reachedLevel: 31,
      reachedCandy: 120,
      reachedShards: 44251,
      shortageCandy: 17,
      shortageExp: 16909,
      limitingFactor: "candy",
    });

    expect(store.canUndo.value).toBe(true);
    store.undo();
    expect(store.sleepSettings.value.timeZone).not.toBe("America/New_York");
    expect(store.canRedo.value).toBe(true);
    store.redo();
    expect(store.sleepSettings.value).toMatchObject({
      includeGSD: true,
      growthIncenseNormalPerWeek: 2,
      growthIncenseStock: 20,
      timeZone: "America/New_York",
    });

    await vi.waitFor(() => {
      expect([...persisted.values()].some(value => value.includes("Public flow Pikachu"))).toBe(true);
    }, { timeout: 2_000 });
    const expectedAfterRestore = {
      sleepExp: store.rowSleepExpFor(rowId),
      incense: store.rowGrowthIncenseCountFor(rowId),
      shardsUsed: store.totalShardsUsed.value,
      boostUsed: store.totalBoostCandyUsed.value,
      universalCandyUsed: store.universalCandyUsedTotal.value,
    };
    firstScope.stop();

    const restoredScope = effectScope();
    const restored = restoredScope.run(() => useCalcStore({
      locale: ref("ja"),
      t,
      currentGameDate: "2026-08-24",
    }))!;
    await vi.waitFor(() => {
      expect(restored.planResultPending.value).toBe(false);
      expect(restored.planResult.value?.pokemonResults).toHaveLength(1);
    }, { timeout: 10_000 });

    const restoredId = restored.rows.value[0]!.id;
    expect(restored.rows.value[0]).toMatchObject({
      title: "Public flow Pikachu",
      boxId: "public-flow-box",
      sleepTargetHours: 1000,
    });
    expect(restored.sleepSettings.value).toMatchObject({
      includeGSD: true,
      growthIncenseNormalPerWeek: 2,
      growthIncenseStock: 20,
      timeZone: "America/New_York",
    });
    expect({
      sleepExp: restored.rowSleepExpFor(restoredId),
      incense: restored.rowGrowthIncenseCountFor(restoredId),
      shardsUsed: restored.totalShardsUsed.value,
      boostUsed: restored.totalBoostCandyUsed.value,
      universalCandyUsed: restored.universalCandyUsedTotal.value,
    }).toEqual(expectedAfterRestore);
    restoredScope.stop();
  });
});
