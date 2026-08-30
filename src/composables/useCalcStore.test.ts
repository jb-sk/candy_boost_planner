import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { nextTick, ref, type Ref } from "vue";
import type { Composer } from "vue-i18n";
import { useCalcStore, type CalcRow } from "./useCalcStore";
import { buildGeneratedProjectedSleepExpEvents, buildPlannerEventSegments, buildRealEventOccurrences, buildSleepScheduleCacheKey } from "../domain/pokesleep/sleep-planning";
import { buildEventChipList } from "../utils/bonusPanelView";
import { useCandyStore } from "./useCandyStore";
import { useToast } from "./useToast";
import { solveLevelPlanWithBudget } from "../domain/level-planner/core/solveLevelPlan";
import { targetFromCandy } from "../domain/level-planner/deriveTarget";
import { minCandyForTarget } from "../domain/pokesleep/minCandyForTarget";
import { calcExp, calcExpAndCandy, calcLevelByCandy } from "../domain/pokesleep/exp";
import { minBoostForTarget } from "../domain/pokesleep/minBoostForTarget";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";
import { detectTimeZone, normalizeTimeZone, type GameDate } from "../domain/pokesleep/game-date";
import { projectPastYearEvents } from "../domain/pokesleep/projected-events";
import { sleepExpEventAnchors, sleepExpEventSegments, wikiKnownThrough } from "../domain/pokesleep/_generated/sleep-exp-events";
import { resolveEventMultiplier } from "../domain/pokesleep/sleep-schedule";
import type { LevelPlannerInput, LevelPlannerResult } from "../domain/level-planner/types";
import { buildPlannerInput as buildLevelPlannerInput } from "../domain/level-planner/buildPlannerInput";
import { cancelPersist, flushPersist } from "../persistence/deferredPersist";
import { defaultSleepSettings } from "../persistence/calc";

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

  it("自動取得と手入力のイベント区間を結合し、重複日は最大倍率を採る", () => {
    const segments = buildPlannerEventSegments([
      { from: "2026-08-20", to: "2026-08-20", multiplier: 3 },
      { from: "2026-09-01", to: "2026-09-07", multiplier: 1.5 },
    ]);

    expect(resolveEventMultiplier("2026-08-20", segments)).toBe(3);
    expect(resolveEventMultiplier("2026-08-21", segments)).toBe(1.25);
    expect(resolveEventMultiplier("2026-09-03", segments)).toBe(1.5);
    expect(resolveEventMultiplier("2026-09-08", segments)).toBe(1);
  });

  it("仮イベントは現在ゲーム日を窓の左端、wikiKnownThroughを右端に使う", () => {
    const currentGameDate = "2026-08-29" as const;
    const until = "2032-01-01" as const;
    expect(buildGeneratedProjectedSleepExpEvents(currentGameDate, until)).toEqual(projectPastYearEvents({
      segments: sleepExpEventSegments,
      currentGameDate,
      knownThrough: wikiKnownThrough as typeof currentGameDate,
      realEvents: sleepExpEventSegments,
      realSleepExpSegments: sleepExpEventSegments,
      anchors: sleepExpEventAnchors,
      until,
    }));
  });

  it("計算ストアはeventHistoryを計算依存へ取り込まない", () => {
    const source = readFileSync(new URL("./useCalcStore.ts", import.meta.url), "utf8");
    expect(source).not.toContain("eventHistory");
  });

  it("仮イベントの設定をオフにすると区間ゼロ、オンにすると生成区間が使われる", () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useCalcStore({ locale: ref("ja"), t });

    // 既定オン。オフへ倒したときだけ区間が消える。
    expect(store.projectedOccurrences.value.length).toBeGreaterThan(0);
    store.updateSleepSettings({ useProjectedEvents: false });
    expect(store.projectedOccurrences.value).toEqual([]);
    store.updateSleepSettings({ useProjectedEvents: true });
    expect(store.projectedOccurrences.value.length).toBeGreaterThan(0);
  });

  it("仮イベントのオン/オフで花区間の出自が実だけ→実と仮の両方になる", () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    // 実の周年（2026-07-13〜07-19）の開催中。2週目の花は計画期間の内側に入る。
    const store = useCalcStore({ locale: ref("ja"), t, currentGameDate: "2026-07-13" });
    const sources = () => new Set(store.blueSeedSegments.value.map(segment => segment.source));

    // 花は仮イベント設定に連動しない。オフでも実の周年には生える。
    store.updateSleepSettings({ useProjectedEvents: false });
    expect(sources()).toEqual(new Set(["flower"]));

    // オンにすると、写した将来の周年から生えた花が `projectedFlower` として増える。
    // 内訳はこの出自で「イベント」と「仮イベント」へ振り分かれる（sleep-growth 側で固定）。
    store.updateSleepSettings({ useProjectedEvents: true });
    expect(sources()).toEqual(new Set(["flower", "projectedFlower"]));
  });

  it("固定イベント入力はneeded期間を共有し、GSDに負けても仮イベントをチップ対象に残す", async () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const projectedEvent = {
      name: "fixture projected anniversary",
      sourceFrom: "2026-07-18" as const,
      from: "2027-07-18" as const,
      to: "2027-07-18" as const,
      multiplier: 1.5,
      month: 7,
      weekOfMonth: 3,
    };
    const store = useCalcStore({
      locale: ref("ja"),
      t,
      currentGameDate: "2027-07-18",
      sleepEventFixture: {
        projectedOccurrences: [projectedEvent],
        blueSeedSegments: [],
        blueSeedShifts: [],
      },
    });
    store.upsertFromBox({
      boxId: "projected-fixture",
      pokedexId: 25,
      srcLevel: 10,
      dstLevelDefault: 40,
      expType: 600,
      nature: "normal",
    });
    const id = store.rows.value[0]!.id;
    store.setRowSleepTarget(id, "all");
    await vi.waitFor(() => {
      expect(store.planResult.value?.pokemonResults).toHaveLength(1);
    }, { timeout: 10_000 });

    store.updateSleepSettings({ useProjectedEvents: false });
    expect(store.projectedOccurrences.value).toEqual([]);
    store.updateSleepSettings({ useProjectedEvents: true });

    // 一覧は内訳と同じ needed 期間で切る。GSDに負けて内訳へ出ない仮イベントも一覧には残す。
    const breakdown = store.rowSleepBonusBreakdownFor(id);
    expect(breakdown.neededFrom).toBe("2027-07-18");
    expect(breakdown.neededTo).toBeTruthy();
    expect(breakdown.contributions.some(contribution => contribution.kind === "gsd")).toBe(true);
    expect(breakdown.contributions.some(contribution => contribution.kind === "projectedEvent")).toBe(false);

    const list = buildEventChipList({
      realEvents: [],
      projectedEvents: store.projectedOccurrences.value,
      neededFrom: breakdown.neededFrom!,
      neededTo: breakdown.neededTo!,
      flowers: [],
      flowerSegments: [],
      t: (key: string) => key,
      locale: "ja",
    });
    expect(list.chips.map(chip => chip.name)).toEqual([projectedEvent.name]);
    expect(list.hasProjected).toBe(true);
  });

  it("一覧用の実イベントは自動取得と手入力を開始日順に並べ、手入力は名前を持たない", () => {
    const occurrences = buildRealEventOccurrences([
      { from: "2026-09-10", to: "2026-09-16", multiplier: 2 },
      { from: "1999-01-01", to: "1998-12-31", multiplier: 2 },
    ]);

    // 日付が読めない（from > to）区間は落とし、残りは開始日の昇順。
    expect(occurrences).toHaveLength(sleepExpEventSegments.length + 1);
    expect(occurrences.map(event => event.from)).toEqual([...occurrences.map(event => event.from)].sort());
    expect(occurrences.find(event => event.from === "2026-09-10")).toEqual({
      name: "",
      from: "2026-09-10",
      to: "2026-09-16",
      multiplier: 2,
      month: 9,
      weekOfMonth: 2,
    });
  });

  it("睡眠スケジュールのキャッシュキーに設定・仮区間・花区間の署名を含める", () => {
    const base: Parameters<typeof buildSleepScheduleCacheKey>[0] = {
      currentGameDate: "2026-01-01",
      timeZone: "UTC",
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: true, afterFullMoon: true },
      growthIncenseNormalPerWeek: 1,
      growthIncenseStock: null,
      manualEventBonuses: [],
      useProjectedEvents: false,
      blueSeedPlantWeekday: 1,
      blueSeedIncenseDays: "auto",
      projectedOccurrences: [],
      blueSeedSegments: [],
    };
    const key = buildSleepScheduleCacheKey(base);
    expect(buildSleepScheduleCacheKey({ ...base, useProjectedEvents: true })).not.toBe(key);
    expect(buildSleepScheduleCacheKey({ ...base, blueSeedPlantWeekday: 2 })).not.toBe(key);
    expect(buildSleepScheduleCacheKey({ ...base, blueSeedIncenseDays: 3 })).not.toBe(key);
    expect(buildSleepScheduleCacheKey({
      ...base,
      projectedOccurrences: [{ name: "projected", sourceFrom: "2026-07-13", from: "2027-07-12", to: "2027-07-18", multiplier: 1.5, month: 7, weekOfMonth: 2 }],
    })).not.toBe(key);
    expect(buildSleepScheduleCacheKey({
      ...base,
      blueSeedSegments: [{ from: "2027-07-19", to: "2027-07-25", multiplier: 3, source: "flower" }],
    })).not.toBe(key);
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

    store.setNature(firstId!, "up");
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
    store.setNature(rowId!, "down");
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

  /**
   * 「すべて睡眠 / アメ在庫＋睡眠」は残EXPから必要日数を逆算する行で、計画睡眠EXPを持たない。
   * それでも日別スケジュールを検算できないと最終日が何の日かを追えないため、SLEEP_EXP 節へ出す。
   */
  it("puts sleep-target-mode rows into the SLEEP_EXP section with the reversed derivation source", async () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useCalcStore({ locale: ref("ja"), t });
    // 月齢エンジンの読み込み状態に左右されないよう、GSDは外して日別スケジュールだけ見る。
    store.updateSleepSettings({ includeGSD: false });
    store.upsertFromBox({ boxId: "sleep-mode", pokedexId: 25, srcLevel: 10, dstLevelDefault: 40, expType: 600, nature: "normal" });
    const id = store.rows.value[0]!.id;
    store.setRowSleepTarget(id, "all");
    await vi.waitFor(() => {
      expect(store.planResult.value?.pokemonResults).toHaveLength(1);
    }, { timeout: 10_000 });

    const tsv = await store.buildDebugExportTsv();
    const sleepSection = tsv.split("\n\n").find(section => section.startsWith("SLEEP_EXP"))!;
    const lines = sleepSection.split("\n");
    const headers = lines[3]!.split("\t");
    const cells = Object.fromEntries(
      lines[4]!.split("\t").map((value, index) => [headers[index], value]),
    );

    expect(cells.sleepTargetMode).toBe("all");
    expect(cells.sleepSource).toBe("expToTarget");
    // 睡眠目標時間の無い経路なので空。0 と混ぜない。
    expect(cells.sleepTargetHours).toBe("");
    expect(Number(cells.requiredDays)).toBeGreaterThan(0);
    expect(cells.schedulePreview).not.toBe("");
    expect(tsv).not.toContain("ALL_SLEEP");
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

    const boostValues = store.rowsView.value.map(row => row.ui.boostCandyInput);
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

    const boostValues = store.rowsView.value.map(row => row.ui.boostCandyInput);
    expect(boostValues.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(500);
    expect(boostValues[0]).toBe(500);
    expect(boostValues[1]).toBe(0);
  });

  it("keeps automatic calculation exact after fbl01c replaces deadline fallback", async () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const previousWorker = globalThis.Worker;
    const requests: Array<{ worker: FakeWorker; message: Record<string, unknown> }> = [];
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      postMessage(message: unknown) {
        requests.push({ worker: this, message: message as Record<string, unknown> });
      }
      terminate() {}
    }

    Object.defineProperty(globalThis, "Worker", { value: FakeWorker, configurable: true, writable: true });
    try {
      const store = useCalcStore({ locale: ref("ja"), t });
      store.upsertFromBox({ boxId: "worker-1", pokedexId: 25, srcLevel: 10, dstLevelDefault: 30, expType: 600, nature: "normal" });
      store.upsertFromBox({ boxId: "worker-2", pokedexId: 26, srcLevel: 10, dstLevelDefault: 30, expType: 600, nature: "normal" });
      await new Promise(resolve => setTimeout(resolve, 20));

      // 前のテストで破棄待ちだったストアのtimerがFakeWorkerへ到達しても、このストアの入力だけを見る。
      const rowIds = new Set(store.rows.value.map(row => row.id));
      const ownRequests = requests.filter(({ message }) => {
        const input = message.input as LevelPlannerInput;
        return input.pokemonList.length === rowIds.size
          && input.pokemonList.every(row => rowIds.has(row.pokemonId));
      });
      expect(ownRequests).toHaveLength(1);
      const { message: request, worker } = ownRequests[0]!;
      const outcome = solveLevelPlanWithBudget(request.input as LevelPlannerInput, { deadlineMs: 60_000, abortAfterExpansions: 1 });
      expect(outcome.kind).toBe("result");
      if (outcome.kind !== "result") return;

      worker.onmessage?.({ data: {
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

  /** ストアと独立に (m, n) の到達点Lvを求める（保存された目標Lvがそれと一致することの検証用）。 */
  const expectedTargetLevel = (store: ReturnType<typeof useCalcStore>, r: CalcRow) => {
    const toNext = calcExp(r.srcLevel, r.srcLevel + 1, r.expType);
    return targetFromCandy({
      srcLevel: r.srcLevel,
      expGot: r.expRemaining > 0 ? Math.max(0, toNext - r.expRemaining) : 0,
      candyTarget: r.candyTarget ?? 0,
      boostCandy: store.rowsView.value.find((row) => row.id === r.id)?.ui.boostCandyInput ?? 0,
      expType: r.expType,
      nature: r.nature,
      boostKind: store.boostKind.value,
    }).level;
  };

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
    const beforeReach = before.boostReachLevel;
    const beyond = store.rowsView.value.find((row) => row.id === id)!.ui.boostCandyInput + 300;

    store.onRowBoostCandy(id, String(beyond));
    const after = rowOf(store, id);
    expect(after.boostOrExpAdjustment).toBe(beyond);
    expect(after.candyTarget).toBeUndefined();
    expect(after.dstLevel).toBeGreaterThan(before.dstLevel);
    expect(after.boostReachLevel).toBe(beforeReach);
  });

  it("アメブ目標Lvは置換が効くLvでも1段ずつ上がる（表示をアメブ個数から逆算しない）", () => {
    const { store, id } = makeStore();
    store.setDstLevel(id, 60);
    store.setSrcLevel(id, 50);
    store.setDstLevel(id, 51);
    store.setBoostLevel(id, 51);

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
        boost: store.boostKind.value,
        candy: store.rowsView.value.find((row) => row.id === r.id)?.ui.boostCandyInput ?? 0,
        expGot: r.expRemaining > 0 ? Math.max(0, toNext - r.expRemaining) : 0,
      }).level;
    };

    // 目標Lv60 に対しアメブ目標Lv55（その先は通常アメ）→ 置換なしで 55 へ届く
    store.setDstLevel(id, 60);
    store.setBoostLevel(id, 55);
    const partial = rowOf(store, id);
    expect(partial.boostReachLevel).toBe(55);
    expect(reachedByBoost(partial)).toBe(55);
    const partialBoost = store.rowsView.value.find((row) => row.id === id)!.ui.boostCandyInput;

    // 目標Lvを 55 まで下げるとアメブが目標全体を賄うので、置換が効いて1個減る
    store.setDstLevel(id, 55);
    const wholeBoost = store.rowsView.value.find((row) => row.id === id)!.ui.boostCandyInput;
    expect(wholeBoost).toBeLessThanOrEqual(partialBoost);

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
      return store.rowsView.value.find((row) => row.id === id)!.ui.boostCandyInput;
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

  it("アメブが目標の一部しか賄わない行では、目標Lvを変えても手入力したアメブ個数を保つ", () => {
    const { store, id } = makeStore();
    store.setDstLevel(id, 60);
    store.setSrcLevel(id, 28);
    store.setDstLevel(id, 60);
    // 目標全体は賄えない量。この行では「アメブ1個→通常アメ1個」置換は関与しない
    store.onRowBoostCandy(id, "400");
    const entered = rowOf(store, id);
    expect(entered.boostOrExpAdjustment).toBe(400);
    expect(entered.boostReachLevel!).toBeLessThan(60);
    const reach = entered.boostReachLevel!;

    // 目標Lvを上げ下げしても、引き直しで「そのLvへの最小数」へ丸められない
    store.setDstLevel(id, 61);
    expect(rowOf(store, id).boostOrExpAdjustment).toBe(400);
    expect(rowOf(store, id).boostReachLevel).toBe(reach);

    store.setDstLevel(id, 60);
    expect(rowOf(store, id).boostOrExpAdjustment).toBe(400);
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
    expect(r.boostOrExpAdjustment).toBeUndefined();
    expect(store.rowsView.value.find((row) => row.id === id)!.ui.boostCandyInput).toBe(expected);
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
    expect(rowOf(store, id).boostOrExpAdjustment).toBeUndefined();

    // **表示個数もグローバル上限で切り詰めない。** 黙って残枠へ収めると、合計が上限を
    // 超えていても警告が出ず、アメブ目標Lvの表示と実際の投入数が食い違う（§11.8-b）。
    // 超過はそのまま出して赤枠で知らせる。
    const ui = store.rowsView.value.find((row) => row.id === id)!.ui;
    expect(ui.boostCandyInput).toBeGreaterThan(350);
    expect(ui.boostQuotaViolation).not.toBeNull();
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
    expect(after.boostOrExpAdjustment).toBeUndefined();
  });

  it("アメブを導出値より積むと個数指定を立てず、目標をラチェットで押し上げる", () => {
    const { store, id } = makeStore();
    const before = rowOf(store, id);

    // 自動最大化値そのままなら「個数指定なし・Lvちょうど」（ceilの余剰を目標へ混ぜない。§3.8-d）
    expect(before.candyTarget).toBeUndefined();
    expect(before.dstExpInLevel ?? 0).toBe(0);

    // 1個積むと個数指定あり（＝アメブ個数そのもの）へ遷移し、その到達点まで目標が伸びる
    const raised = store.rowsView.value.find((row) => row.id === id)!.ui.boostCandyInput + 1;
    store.onRowBoostCandy(id, String(raised));
    const after = rowOf(store, id);
    expect(after.candyTarget).toBeUndefined();
    expect(after.dstLevel > before.dstLevel
      || (after.dstLevel === before.dstLevel && (after.dstExpInLevel ?? 0) > (before.dstExpInLevel ?? 0))).toBe(true);
    expect(after.dstExpInLevel ?? 0).toBeGreaterThan(0);
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

  it("睡眠目標を設定しても candyTarget は空のまま、目標Lvは不変でLv内EXPは0になる", () => {
    const { store, id } = makeStore();
    const before = { ...rowOf(store, id) };
    store.setRowSleepTargetHours(id, 1000);
    const r = rowOf(store, id);
    expect(r.sleepTargetHours).toBe(1000);
    expect(r.candyTarget).toBeUndefined();
    expect(r.dstLevel).toBe(before.dstLevel);
    expect(r.dstExpInLevel ?? 0).toBe(0);
  });

  it("個数指定ありの行に睡眠目標を設定すると個数指定をリセットし、Lv内EXPを0へ戻す", () => {
    const { store, id } = makeStore();
    store.onRowCandyTarget(id, "40");
    const before = { ...rowOf(store, id) };
    expect(before.dstExpInLevel ?? 0).toBeGreaterThan(0);

    store.setRowSleepTargetHours(id, 1000);
    const r = rowOf(store, id);
    expect(r.sleepTargetHours).toBe(1000);
    expect(r.candyTarget).toBeUndefined();
    expect(r.dstLevel).toBe(before.dstLevel);
    expect(r.dstExpInLevel ?? 0).toBe(0);
  });

  it("睡眠目標時間を変更しても candyTarget は空のまま目標Lvを維持する", () => {
    const { store, id } = makeStore();
    store.setRowSleepTargetHours(id, 1000);
    const first = { ...rowOf(store, id) };
    store.setRowSleepTargetHours(id, 2000);
    const second = rowOf(store, id);
    expect(second.sleepTargetHours).toBe(2000);
    expect(second.candyTarget).toBeUndefined();
    expect(second.dstLevel).toBe(first.dstLevel);
    expect(second.dstExpInLevel ?? 0).toBe(0);
  });

  it("睡眠目標時間があっても目標Lvピッカーは個数指定を空にし、睡眠設定を維持する", () => {
    const { store, id } = makeStore();
    store.setRowSleepTargetHours(id, 1000);
    store.onRowCandyTarget(id, "40");

    store.setDstLevel(id, 40);
    const r = rowOf(store, id);
    expect(r.sleepTargetHours).toBe(1000);
    expect(r.candyTarget).toBeUndefined();
    expect(r.dstLevel).toBe(40);
    expect(r.dstExpInLevel ?? 0).toBe(0);
  });

  it("睡眠目標時間を解除すると candyTarget は残り、目標はアメだけの到達点へ戻る", () => {
    const { store, id } = makeStore();
    store.setRowSleepTargetHours(id, 1000);
    store.onRowCandyTarget(id, "40");
    const withSleep = { ...rowOf(store, id) };

    store.setRowSleepTargetHours(id, undefined);
    const r = rowOf(store, id);
    expect(r.sleepTargetHours).toBeUndefined();
    // 「そのアメ数を使う」という意図は生きているので個数指定は残す
    expect(r.candyTarget).toBe(withSleep.candyTarget);
    // 睡眠EXPが乗らなくなったぶん、到達点＝目標は手前へ戻る
    expect(r.dstLevel).toBeLessThan(withSleep.dstLevel);
    expect(r.dstLevel).toBe(expectedTargetLevel(store, r));
  });

  it("あとEXPの出どころ: 個数指定も睡眠目標もない行だけ実到達点、それ以外は保存目標", () => {
    const { store, id } = makeStore();
    const view = () => store.rowsView.value.find((r) => r.id === id)!;
    const fullLevelExp = (lv: number) => calcExp(lv, lv + 1, view().expType);

    // ① 目標Lvのみ → 最小アメ投入時の実到達点。ceil の余剰EXPぶん満EXPより小さい（§4.5）
    const plain = view();
    const plainExp = plain.targetExpToNextLevel;
    expect(plainExp).toBeGreaterThan(0);
    expect(plainExp).toBeLessThan(fullLevelExp(plain.dstLevel));

    // ③ 睡眠目標あり（個数指定なし）→ 保存目標から。Lv ちょうどなので満EXP
    store.setRowSleepTargetHours(id, 1000);
    const withSleep = view();
    expect(withSleep.candyTarget).toBeUndefined();
    expect(withSleep.targetExpToNextLevel).toBe(fullLevelExp(withSleep.dstLevel));

    // ④ すべて睡眠 → 保存目標から。Lv ちょうどなので満EXP
    store.setRowSleepTarget(id, "all");
    const allSleep = view();
    expect(allSleep.candyTarget).toBeUndefined();
    expect(allSleep.targetExpToNextLevel).toBe(fullLevelExp(allSleep.dstLevel));

    // ⑤ アメ在庫＋睡眠 → 保存目標から。Lv ちょうどなので満EXP
    store.setRowSleepTarget(id, "stock");
    const stockSleep = view();
    expect(stockSleep.candyTarget).toBeUndefined();
    expect(stockSleep.targetExpToNextLevel).toBe(fullLevelExp(stockSleep.dstLevel));

    // 解除すると①へ戻り、出どころも値も戻る（睡眠操作はアメブ個数に触れない）
    store.setRowSleepTarget(id, undefined);
    expect(view().targetExpToNextLevel).toBe(plainExp);

    // ② 個数指定あり → 保存目標から。Lv内EXPが付くので満EXPより小さい
    store.onRowCandyTarget(id, "40");
    const withTarget = view();
    expect(withTarget.targetExpToNextLevel)
      .toBe(fullLevelExp(withTarget.dstLevel) - (withTarget.dstExpInLevel ?? 0));
  });

  it("あとEXPは planner の結果を待たずに確定する（表示が2段階にならない）", () => {
    const { store, id } = makeStore();
    const view = () => store.rowsView.value.find((r) => r.id === id)!;
    // planResult は debounce + Worker で後から入る。この時点では null
    expect(store.planResult.value).toBeNull();
    expect(view().targetExpToNextLevel).toBeGreaterThan(0);

    store.setRowSleepTargetHours(id, 1000);
    expect(view().targetExpToNextLevel).toBeGreaterThan(0);
    store.setRowSleepTargetHours(id, undefined);
    expect(view().targetExpToNextLevel).toBeGreaterThan(0);
  });

  it("個数指定なしの行では睡眠目標を解除しても目標Lvが動かない", () => {
    const { store, id } = makeStore();
    store.setRowSleepTargetHours(id, 1000);
    const withSleep = { ...rowOf(store, id) };
    expect(withSleep.candyTarget).toBeUndefined();

    store.setRowSleepTargetHours(id, undefined);
    const r = rowOf(store, id);
    expect(r.candyTarget).toBeUndefined();
    expect(r.dstLevel).toBe(withSleep.dstLevel);
    expect(r.dstExpInLevel ?? 0).toBe(0);
  });

  it("累計睡眠時間を変更すると個数指定を保ったまま保存目標が追従する", () => {
    const { store, id } = makeStore();
    store.setRowSleepTargetHours(id, 1000);
    store.onRowCandyTarget(id, "40");
    const before = { ...rowOf(store, id) };

    store.setRowSleepHours(id, 900);
    const after = rowOf(store, id);
    expect(after.sleepHours).toBe(900);
    expect(after.candyTarget).toBe(before.candyTarget);
    expect(after.dstLevel < before.dstLevel
      || (after.dstLevel === before.dstLevel && (after.dstExpInLevel ?? 0) < (before.dstExpInLevel ?? 0))).toBe(true);
  });

  it("現在Lvを変更すると個数指定は解除されるが、睡眠目標は維持される（§10.11）", () => {
    const { store, id } = makeStore();
    // 睡眠目標を先に設定する。逆順だと setRowSleepTargetHours が candyTarget を消すため、
    // 「setSrcLevel が個数指定を消した」ことを確かめられない（素通りする）。
    store.setRowSleepTargetHours(id, 1000);
    store.onRowCandyTarget(id, "30");
    const before = rowOf(store, id);
    expect(before.candyTarget).toBe(30);
    expect(before.sleepTargetHours).toBe(1000);

    store.setSrcLevel(id, 15);
    const r = rowOf(store, id);
    expect(r.srcLevel).toBe(15);
    expect(r.candyTarget).toBeUndefined();
    // 睡眠EXPは元Lvに依存しないので、「累計1000h寝かせる」宣言は残る
    expect(r.sleepTargetHours).toBe(1000);
    // 個数指定なしの行は目標が Lv ちょうど
    expect(r.dstExpInLevel).toBeUndefined();
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

  it("ボックス同期で元Lvが変わると個数指定は解除されるが、睡眠目標は維持される（§10.11）", () => {
    const { store, id } = makeStore();
    // 睡眠目標が先。逆順だと setRowSleepTargetHours が candyTarget を消してしまう
    store.setRowSleepTargetHours(id, 1000);
    store.onRowCandyTarget(id, "30");
    const before = rowOf(store, id);
    expect(before.candyTarget).toBe(30);
    expect(before.sleepTargetHours).toBe(1000);

    store.upsertFromBox({ boxId: "box-1", pokedexId: 25, srcLevel: 20, dstLevelDefault: 60, expType: 600, nature: "normal" });
    const r = rowOf(store, id);
    expect(r.srcLevel).toBe(20);
    expect(r.candyTarget).toBeUndefined();
    expect(r.sleepTargetHours).toBe(1000);
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
    // 「目標まで」行と同じ必要総アメ数
    const toNext = calcExp(before.srcLevel, before.srcLevel + 1, before.expType);
    const needed = minCandyForTarget({
      srcLevel: before.srcLevel,
      expGot: before.expRemaining > 0 ? Math.max(0, toNext - before.expRemaining) : 0,
      targetLevel: before.dstLevel,
      boostCandy: store.rowsView.value.find((row) => row.id === id)!.ui.boostCandyInput,
      expType: before.expType,
      nature: before.nature,
      boostKind: store.boostKind.value,
    });

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
    const before = store.rowsView.value.find((row) => row.id === id)!.ui.boostCandyInput;
    expect(before).toBeGreaterThan(1);

    // UI は Enter / フォーカスアウトで確定してから onRowCandyTarget を呼ぶ。
    // 仮に途中の桁が渡ってもアメブは内数クランプされるが、確定値で呼び直せば復元する。
    store.onRowCandyTarget(id, "1");
    expect(rowOf(store, id).boostOrExpAdjustment).toBeUndefined();
    expect(store.rowsView.value.find((row) => row.id === id)!.ui.boostCandyInput).toBeLessThanOrEqual(1);

    store.onRowCandyTarget(id, "");
    store.onRowCandyTarget(id, String(before));
    expect(rowOf(store, id).candyTarget).toBe(before);
  });

  it("個数指定を下げると明示アメブ個数だけを内数へクランプし、目標Lv意図は保存する", () => {
    const { store, id } = makeStore();
    store.setBoostLevel(id, 25);
    store.onRowBoostCandy(id, "50");
    const before = rowOf(store, id);
    expect(before.boostReachLevel).toBe(25);

    store.onRowCandyTarget(id, "5");
    const after = rowOf(store, id);
    expect(after.candyTarget).toBe(5);
    expect(after.boostOrExpAdjustment).toBe(5);
    expect(after.boostReachLevel).toBe(25);
    expect(store.rowsView.value.find((row) => row.id === id)!.ui.boostReachLevel).toBeLessThan(25);
  });

  it("睡眠行で個数指定を入力すると目標がアメ到達点＋睡眠EXPへ動く", () => {
    const { store, id } = makeStore();
    store.setRowSleepTargetHours(id, 1000);
    store.onRowCandyTarget(id, "40");
    const withSleep = { ...rowOf(store, id) };

    const { store: noSleepStore, id: noSleepId } = makeStore();
    noSleepStore.onRowCandyTarget(noSleepId, "40");
    const withoutSleep = rowOf(noSleepStore, noSleepId);

    expect(withSleep.candyTarget).toBe(40);
    expect(withSleep.dstLevel > withoutSleep.dstLevel
      || (withSleep.dstLevel === withoutSleep.dstLevel
        && (withSleep.dstExpInLevel ?? 0) > (withoutSleep.dstExpInLevel ?? 0))).toBe(true);
  });

  it("睡眠目標ありでも個数指定後のアメブ個数を反復せず直接入力できる", () => {
    const store = useCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind("full");
    store.onBoostCandyRemainingInput("500");
    store.upsertFromBox({
      boxId: "latias-sleep-candy",
      title: "70ラティアス",
      pokedexId: 380,
      pokemonType: "Psychic",
      srcLevel: 61,
      dstLevelDefault: 70,
      expRemaining: 3164,
      sleepHours: 1387,
      expType: 1080,
      nature: "normal",
    });
    const id = store.rows.value[0]!.id;

    store.setRowSleepTargetHours(id, 2000);
    store.onRowCandyTarget(id, "50");
    expect(rowOf(store, id).candyTarget).toBe(50);
    expect(store.rowsView.value[0]!.ui.boostCandyInputMax).toBeGreaterThanOrEqual(50);

    store.onRowBoostCandy(id, "50");
    const afterBoost = rowOf(store, id);
    expect(afterBoost.boostOrExpAdjustment).toBe(50);
    expect(store.rowsView.value[0]!.ui.boostCandyInput).toBe(50);
  });

  it("個数指定ありで性格を変えると最終目標が追従する", () => {
    const { store, id } = makeStore();
    store.onRowCandyTarget(id, "40");
    const before = { ...rowOf(store, id) };

    store.setNature(id, "up");
    const after = rowOf(store, id);
    // 同じ40個でも性格補正でEXPが増えるので、到達点＝目標が先へ進む
    expect(after.candyTarget).toBe(40);
    expect(after.dstLevel > before.dstLevel
      || (after.dstLevel === before.dstLevel && (after.dstExpInLevel ?? 0) > (before.dstExpInLevel ?? 0))).toBe(true);
  });

  const natureRelevantState = (row: CalcRow) => ({
    dstLevel: row.dstLevel,
    dstExpInLevel: row.dstExpInLevel,
    candyTarget: row.candyTarget,
    boostOrExpAdjustment: row.boostOrExpAdjustment,
    boostReachLevel: row.boostReachLevel,
    sleepTargetHours: row.sleepTargetHours,
  });

  function expectNatureRoundTrip(store: ReturnType<typeof useCalcStore>, id: string) {
    const initial = natureRelevantState(rowOf(store, id));
    for (const sequence of [
      ["up", "down", "normal"],
      ["down", "up", "normal"],
    ] as const) {
      for (const nature of sequence) store.setNature(id, nature);
      expect(natureRelevantState(rowOf(store, id))).toEqual(initial);
    }
  }

  it("EXP性格補正を ▲▲ ⇄ ▼▼ ⇄ - と往復しても導出モードの保存値を完全に復元する", () => {
    const { store, id } = makeStore();
    store.setDstLevel(id, 60);
    store.setRowSleepTargetHours(id, 200);
    const before = rowOf(store, id);
    expect(before.candyTarget).toBeUndefined();
    expect(before.boostOrExpAdjustment).toBeUndefined();

    expectNatureRoundTrip(store, id);
  });

  it("EXP性格補正を ▲▲ ⇄ ▼▼ ⇄ - と往復しても個数指定があるときの保存値を完全に復元する", () => {
    const { store, id } = makeStore();
    store.setDstLevel(id, 60);
    store.setRowSleepTargetHours(id, 200);
    store.onRowCandyTarget(id, "200");
    expect(rowOf(store, id).candyTarget).toBe(200);

    expectNatureRoundTrip(store, id);
  });

  it("EXP性格補正を ▲▲ ⇄ ▼▼ ⇄ - と往復しても、目標全体を賄うアメブ個数行を完全に復元する", () => {
    const { store, id } = makeStore();
    store.setSlotBoostKind("full");
    store.setDstLevel(id, 20);
    store.onRowBoostCandy(id, "100");
    const before = rowOf(store, id);
    expect(before.candyTarget).toBeUndefined();
    expect(before.boostOrExpAdjustment).toBe(100);
    // 明示アメブ100個の到達点が保存目標そのものになる構成。
    const reached = targetFromCandy({
      srcLevel: before.srcLevel,
      expGot: 0,
      candyTarget: 100,
      boostCandy: 100,
      expType: before.expType,
      nature: before.nature,
      boostKind: store.boostKind.value,
    });
    expect([before.dstLevel, before.dstExpInLevel ?? 0]).toEqual([reached.level, reached.expInLevel]);

    expectNatureRoundTrip(store, id);
  });

  it("アメブ個数が目標の一部しか賄わない行は、性格を変えても目標を動かさない", () => {
    const { store, id } = makeStore();
    store.setSlotBoostKind("full");
    store.setDstLevel(id, 40);
    store.onRowBoostCandy(id, "100");
    const before = rowOf(store, id);
    expect(before.boostOrExpAdjustment).toBe(100);
    const targetBefore = [before.dstLevel, before.dstExpInLevel];

    store.setNature(id, "up");
    expect([rowOf(store, id).dstLevel, rowOf(store, id).dstExpInLevel]).toEqual(targetBefore);
  });

  it("性格を変えても個数指定・アメブ個数・睡眠目標・アメブ目標Lvを残す", () => {
    const { store, id } = makeStore();
    store.setSlotBoostKind("full");
    store.setDstLevel(id, 60);
    store.setRowSleepTargetHours(id, 200);
    store.setBoostLevel(id, 30);
    store.onRowBoostCandy(id, "50");
    store.onRowCandyTarget(id, "200");
    const before = rowOf(store, id);
    const preserved = {
      candyTarget: before.candyTarget,
      boostOrExpAdjustment: before.boostOrExpAdjustment,
      sleepTargetHours: before.sleepTargetHours,
      boostReachLevel: before.boostReachLevel,
    };
    expect(Object.values(preserved).every((value) => value !== undefined)).toBe(true);

    store.setNature(id, "down");
    expect(rowOf(store, id)).toMatchObject(preserved);
  });

  it("導出モードの性格変更は新しい必要数でアメブ枠を割り当て直す", () => {
    const { store, id } = makeStore();
    store.setSlotBoostKind("full");
    const normalNeed = store.rowsView.value.find((row) => row.id === id)!.ui.boostCandyInput;
    expect(normalNeed).toBeGreaterThan(0);
    store.onBoostCandyRemainingInput(String(normalNeed));
    expect(rowOf(store, id).boostOrExpAdjustment).toBeUndefined();

    store.setNature(id, "down");
    expect(rowOf(store, id).boostOrExpAdjustment).toBe(normalNeed);
  });

  it("性格変更は連続2回なら undo も2回に分かれる", () => {
    const { store, id } = makeStore();
    store.setNature(id, "up");
    store.setNature(id, "down");
    expect(rowOf(store, id).nature).toBe("down");

    store.undo();
    expect(rowOf(store, id).nature).toBe("up");
    store.undo();
    expect(rowOf(store, id).nature).toBe("normal");
  });

  it("個数指定ありでアメブ種別を変えても目標と保存値が乖離しない", () => {
    const { store, id } = makeStore();
    // スロット未保存だと setSlotBoostKind が空スロット作成で早期 return するため、先に確定させる
    store.setSlotBoostKind("full");
    store.onRowCandyTarget(id, "40");

    store.setSlotBoostKind("none");
    const none = rowOf(store, id);
    expect(none.candyTarget).toBe(40);
    expect(none.dstLevel).toBe(expectedTargetLevel(store, none));

    store.setSlotBoostKind("full");
    const full = rowOf(store, id);
    expect(full.candyTarget).toBe(40);
    expect(full.dstLevel).toBe(expectedTargetLevel(store, full));
    // アメブが使えるぶん同じ40個でも先へ届く
    expect(full.dstLevel).toBeGreaterThanOrEqual(none.dstLevel);
  });

  it("個数指定ありでアメブ上限を変えても保存状態を書き換えない", () => {
    const { store, id } = makeStore();
    store.onRowCandyTarget(id, "40");

    const before = { ...rowOf(store, id) };
    const uiBefore = store.rowsView.value.find((row) => row.id === id)!.ui.boostCandyInput;
    store.onBoostCandyRemainingInput("5");
    const limited = rowOf(store, id);
    expect(limited).toEqual(before);

    // 表示個数も動かない。上限を下げて変わるのは「超過しているか」だけ
    const ui = store.rowsView.value.find((row) => row.id === id)!.ui;
    expect(ui.boostCandyInput).toBe(uiBefore);
    expect(ui.boostQuotaViolation).not.toBeNull();
  });

  it("元Lvが同じボックス同期であとEXPが変わると目標が追従する", () => {
    const { store, id } = makeStore();
    store.onRowCandyTarget(id, "40");
    const before = { ...rowOf(store, id) };

    // あとEXPを小さくする＝現在Lv内で既に多く稼いでいる → 同じ40個でも先へ届く
    store.upsertFromBox({ boxId: "box-1", pokedexId: 25, srcLevel: 10, expRemaining: 1, expType: 600, nature: "normal" });
    const after = rowOf(store, id);
    expect(after.candyTarget).toBe(40);
    expect(after.dstLevel).toBe(expectedTargetLevel(store, after));
    expect(after.dstLevel > before.dstLevel
      || (after.dstLevel === before.dstLevel && (after.dstExpInLevel ?? 0) > (before.dstExpInLevel ?? 0))).toBe(true);
  });

  it("睡眠設定中のボックス同期で累計睡眠時間が変わっても、個数指定なしの目標Lvは動かない", () => {
    const { store, id } = makeStore();
    store.setRowSleepTargetHours(id, 1000);
    const before = { ...rowOf(store, id) };

    store.upsertFromBox({ boxId: "box-1", pokedexId: 25, srcLevel: 10, sleepHours: 900, expType: 600, nature: "normal" });
    const after = rowOf(store, id);
    expect(after.sleepHours).toBe(900);
    expect(after.dstLevel).toBe(before.dstLevel);
    expect(after.dstExpInLevel ?? 0).toBe(before.dstExpInLevel ?? 0);
    expect(after.candyTarget).toBeUndefined();
  });

  it("グローバル睡眠設定を変えても行データは書き換わらない", () => {
    const { store, id } = makeStore();
    store.setDstLevel(id, 60);
    store.setRowSleepTargetHours(id, 200);
    const before = { ...rowOf(store, id) };

    store.updateSleepSettings({ sleepExpBonusCount: 5 });
    const after = rowOf(store, id);
    expect(after).toEqual(before);
  });

  it("睡眠行で性格やあとEXPを変えても、個数指定が空なら目標Lvは動かない", () => {
    const { store, id } = makeStore();
    store.setRowSleepTargetHours(id, 1000);
    const base = { ...rowOf(store, id) };

    store.setNature(id, "up");
    const afterNature = rowOf(store, id);
    expect(afterNature.candyTarget).toBeUndefined();
    expect(afterNature.dstLevel).toBe(base.dstLevel);

    store.onRowExpRemaining(id, "1");
    const afterExp = rowOf(store, id);
    expect(afterExp.candyTarget).toBeUndefined();
    expect(afterExp.dstLevel).toBe(base.dstLevel);
  });

  /**
   * §11.1 の再現条件を作る（元Lv50 / 目標Lv65 / full / 睡眠1000h）。
   *
   * **アメブ目標Lvを明示的に戻すのが要点。** `setSrcLevel` は boostReachLevel を元Lvまで
   * 切り下げるため、そのままだと導出アメブが 0 になり「同値を打ち直すと目標Lvが跳ぶ」という
   * 症状そのものを再現できない（0 を打ち直しているだけのテストになる）。
   * 目標Lv65 なら睡眠1000h でも T' が Lv60 に残るので、アメブ入力が頭打ちにならない。
   */
  function makeSleepRowWithBoostIntent() {
    const { store, id } = makeStore();
    store.updateSleepSettings({
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
    });
    store.setSlotBoostKind("full");
    store.setDstLevel(id, 60);
    store.setSrcLevel(id, 50);
    store.setDstLevel(id, 65);
    store.setBoostLevel(id, 60);
    store.setRowSleepTargetHours(id, 1000);
    return { store, id };
  }

  it("睡眠1000hの行で導出値を同値入力しても個数指定を立てず、目標を動かさない（§11.1）", () => {
    const { store, id } = makeSleepRowWithBoostIntent();
    const before = { ...rowOf(store, id) };
    const effective = store.rowsView.value.find((row) => row.id === id)!.ui.boostCandyInput;
    // 導出値が 0 だと同値入力が空打ちと変わらず、§11.1 を検出できない。
    expect(effective).toBeGreaterThan(0);

    store.onRowBoostCandy(id, String(effective));
    const after = rowOf(store, id);
    expect(after.candyTarget).toBeUndefined();
    expect(after.dstLevel).toBe(before.dstLevel);
    expect(after.dstExpInLevel ?? 0).toBe(before.dstExpInLevel ?? 0);
  });

  it("アメブ目標Lvを睡眠上限内で下げても最終目標を押し上げない（§11.1）", () => {
    const { store, id } = makeSleepRowWithBoostIntent();
    const before = { ...rowOf(store, id) };
    expect(before.boostReachLevel).toBe(60);

    store.setBoostLevel(id, 58);
    const after = rowOf(store, id);
    expect(after.boostReachLevel).toBe(58);
    expect(after.dstLevel).toBe(before.dstLevel);
    expect(after.dstExpInLevel ?? 0).toBe(before.dstExpInLevel ?? 0);
    expect(after.candyTarget).toBeUndefined();
  });

  it("睡眠EXPだけで目標に届く行はアメブ個数の入力を受け付けず、解除で導出値が戻る", () => {
    const { store, id } = makeStore();
    store.setSlotBoostKind("full");
    store.setDstLevel(id, 60);
    store.setSrcLevel(id, 50);
    store.setDstLevel(id, 55);
    store.setBoostLevel(id, 55);
    const derivedBefore = store.rowsView.value.find((row) => row.id === id)!.ui.boostCandyInput;
    expect(derivedBefore).toBeGreaterThan(0);

    store.setRowSleepTargetHours(id, 2000);
    const capped = store.rowsView.value.find((row) => row.id === id)!.ui;
    expect(capped.boostSleepCapped).toBe(true);
    expect(capped.boostInputDisabled).toBe(true);
    expect(capped.boostCandyInputMax).toBe(0);

    // 上限0の欄で入力を受け取ると「明示的に0個」が確定し、睡眠を解除しても戻らなくなる。
    store.onRowBoostCandy(id, "500");
    expect(rowOf(store, id).boostOrExpAdjustment).toBeUndefined();

    store.setRowSleepTargetHours(id, undefined);
    expect(rowOf(store, id).boostOrExpAdjustment).toBeUndefined();
    expect(store.rowsView.value.find((row) => row.id === id)!.ui.boostCandyInput).toBe(derivedBefore);
  });

  it("アメブなしでは個数を入力しても明示的な0を保存しない", () => {
    const { store, id } = makeStore();
    store.setSlotBoostKind("none");

    store.onRowBoostCandy(id, "500");

    expect(rowOf(store, id).boostOrExpAdjustment).toBeUndefined();
  });

  it("Lv70では個数を入力しても明示的な0を保存しない", () => {
    const { store, id } = makeStore();
    store.setSlotBoostKind("full");
    store.setDstLevel(id, MAX_LEVEL);
    store.setSrcLevel(id, MAX_LEVEL);
    expect(store.rowsView.value.find((row) => row.id === id)!.ui.boostCandyInputMax).toBe(0);

    store.onRowBoostCandy(id, "500");

    expect(rowOf(store, id).boostOrExpAdjustment).toBeUndefined();
  });

  it("上限が1以上ならアメブ個数を保存し、超過分は上限へクランプする", () => {
    const { store, id } = makeStore();
    store.setSlotBoostKind("full");
    const inputMax = store.rowsView.value.find((row) => row.id === id)!.ui.boostCandyInputMax;
    expect(inputMax).toBeGreaterThan(0);

    store.onRowBoostCandy(id, "1");
    expect(rowOf(store, id).boostOrExpAdjustment).toBe(1);

    store.onRowBoostCandy(id, String(inputMax + 100));
    expect(rowOf(store, id).boostOrExpAdjustment).toBe(inputMax);
  });

  it("睡眠EXPだけで目標に届く行はアメブ目標Lvの操作を受け付けず、保存された意図が残る", () => {
    const { store, id } = makeStore();
    store.setSlotBoostKind("full");
    store.setDstLevel(id, 60);
    store.setSrcLevel(id, 50);
    store.setDstLevel(id, 55);
    store.setBoostLevel(id, 55);
    const derivedBefore = store.rowsView.value.find((row) => row.id === id)!.ui.boostCandyInput;

    store.setRowSleepTargetHours(id, 1000);
    expect(store.rowsView.value.find((row) => row.id === id)!.ui.boostInputDisabled).toBe(true);

    // T' でクランプして保存すると、選んでいない Lv50 が意図として残る（§11.4-B と同型）。
    store.setBoostLevel(id, 54);
    expect(rowOf(store, id).boostReachLevel).toBe(55);
    // 頭打ちの案内は保存値を見て出すので、操作しても消えない。
    expect(store.rowsView.value.find((row) => row.id === id)!.ui.boostSleepCapped).toBe(true);

    store.setRowSleepTargetHours(id, undefined);
    expect(rowOf(store, id).boostReachLevel).toBe(55);
    expect(store.rowsView.value.find((row) => row.id === id)!.ui.boostCandyInput).toBe(derivedBefore);
  });

  it("押し下げられた範囲だけが動かせず、T' 以下のアメブ目標Lvは上げ下げできる", () => {
    const { store, id } = makeStore();
    store.updateSleepSettings({
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
    });
    store.setSlotBoostKind("full");
    store.setDstLevel(id, 60);
    store.setSrcLevel(id, 50);
    store.setDstLevel(id, 65);
    store.setBoostLevel(id, 65);
    store.setRowSleepTargetHours(id, 1000);

    const ui = store.rowsView.value.find((row) => row.id === id)!.ui;
    // アメブ区間は残っているので入力欄は生きている。押し下げの案内だけ出す。
    expect(ui.boostSleepCapped).toBe(true);
    expect(ui.boostInputDisabled).toBe(false);
    expect(ui.boostReachLevelMax).toBe(60);

    // 睡眠EXPが賄う範囲（T'=Lv60 超）は受け取らない。クランプすると 65 の意図が 60 に化ける。
    store.setBoostLevel(id, 63);
    expect(rowOf(store, id).boostReachLevel).toBe(65);

    // T' 以下は睡眠なしと同じく自由に動かせる。
    store.setBoostLevel(id, 58);
    expect(rowOf(store, id).boostReachLevel).toBe(58);
    store.setBoostLevel(id, 60);
    expect(rowOf(store, id).boostReachLevel).toBe(60);
  });

  it("押し下げられた行でも T' へ届く範囲ならアメブ個数を入力できる", () => {
    const { store, id } = makeStore();
    store.setSlotBoostKind("full");
    store.setDstLevel(id, 60);
    store.setSrcLevel(id, 50);
    store.setDstLevel(id, 65);
    store.setBoostLevel(id, 65);
    store.setRowSleepTargetHours(id, 1000);
    const inputMax = store.rowsView.value.find((row) => row.id === id)!.ui.boostCandyInputMax;
    expect(inputMax).toBeGreaterThan(0);

    // 上限超は上限へクランプする（2026-08-25 ユーザー規則）。
    // かつては捨てていた（§11.11）が、拒否された入力は導出値（多くは0）で再描画されるため、
    // ユーザーには「大きい数を入れたら0になった」としか見えなかった。
    store.onRowBoostCandy(id, String(inputMax + 100));
    expect(rowOf(store, id).boostOrExpAdjustment).toBe(inputMax);

    store.onRowBoostCandy(id, String(inputMax));
    expect(rowOf(store, id).boostOrExpAdjustment).toBe(inputMax);
  });

  it("睡眠があっても頭打ちでなければアメブ個数・目標Lvを操作できる（対照）", () => {
    const { store, id } = makeSleepRowWithBoostIntent();
    const ui = store.rowsView.value.find((row) => row.id === id)!.ui;
    expect(ui.boostSleepCapped).toBe(false);
    expect(ui.boostCandyInputMax).toBeGreaterThan(0);

    store.onRowBoostCandy(id, "120");
    expect(rowOf(store, id).boostOrExpAdjustment).toBe(120);

    store.setBoostLevel(id, 57);
    expect(rowOf(store, id).boostReachLevel).toBe(57);
    expect(rowOf(store, id).boostOrExpAdjustment).toBeUndefined();
  });

  /** 睡眠2000h・元Lv28・目標Lv70 の行。アメブの上限（T'）が目標Lvより手前へ下がる。 */
  function makeSleepCappedRows(count: number) {
    const store = useCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind("full");
    for (let n = 1; n <= count; n++) {
      store.upsertFromBox({ boxId: `cap-${n}`, pokedexId: 24 + n, srcLevel: 28, dstLevelDefault: 70, expType: 600, nature: "normal" });
    }
    for (const rowId of store.rows.value.map((row) => row.id)) {
      store.setRowSleepTargetHours(rowId, 2000);
    }
    return store;
  }

  it("上限に余裕があるアメブ目標Lvには睡眠の頭打ち案内を出さない（2026-07-29）", () => {
    const store = makeSleepCappedRows(3);
    // ミニブは枠が 350 しかないので、下位の行はアメブ目標Lvが元Lvまで下がる
    store.setSlotBoostKind("mini");

    const last = store.rowsView.value[2]!;
    expect(last.ui.boostReachLevel).toBe(28);
    // まだ 30Lv 以上ぶん上げられる。ここで「目標Lvを上げるか睡眠目標を解除してください」を
    // 出すと、操作できるのにできないと読ませることになる
    expect(last.ui.boostReachLevelMax).toBeGreaterThan(40);
    expect(last.ui.boostCapActive).toBe(false);
    expect(last.ui.boostSleepCapped).toBe(false);
    // 保存値も元Lvへ戻っている（案内が出るのは「古い目標Lvが残っているから」ではない）
    expect(store.rows.value[2]!.boostReachLevel).toBe(28);
  });

  it("アメブ目標Lvが睡眠の上限へ届いた時点で案内を出す（対照）", () => {
    const store = makeSleepCappedRows(1);
    const id = store.rows.value[0]!.id;
    const max = store.rowsView.value[0]!.ui.boostReachLevelMax;
    expect(max).toBeLessThan(MAX_LEVEL);

    store.setBoostLevel(id, max - 1);
    expect(store.rowsView.value[0]!.ui.boostCapActive).toBe(false);

    store.setBoostLevel(id, max);
    expect(store.rowsView.value[0]!.ui.boostCapActive).toBe(true);
    // 上限ちょうどは押し下げられていないので破線は出ない（案内だけ出す）
    expect(store.rowsView.value[0]!.ui.boostSleepCapped).toBe(false);
  });

  it("押し下げられている行は破線と案内が同時に出る（案内 ⊇ 破線）", () => {
    const { store, id } = makeStore();
    store.setSlotBoostKind("full");
    store.setDstLevel(id, 60);
    store.setSrcLevel(id, 50);
    store.setDstLevel(id, 65);
    store.setBoostLevel(id, 65);
    store.setRowSleepTargetHours(id, 1000);

    const ui = store.rowsView.value.find((row) => row.id === id)!.ui;
    expect(ui.boostSleepCapped).toBe(true);
    // 表示値は上限へクランプされるので、押し下げ行は必ず案内側にも入る
    expect(ui.boostReachLevel).toBe(ui.boostReachLevelMax);
    expect(ui.boostCapActive).toBe(true);
  });

  it("睡眠EXPだけで目標に届く行も案内を出す（アメブ区間が消えた行）", () => {
    const { store, id } = makeStore();
    store.setSlotBoostKind("full");
    store.setDstLevel(id, 60);
    store.setSrcLevel(id, 50);
    store.setDstLevel(id, 55);
    store.setBoostLevel(id, 55);
    store.setRowSleepTargetHours(id, 2000);

    const ui = store.rowsView.value.find((row) => row.id === id)!.ui;
    expect(ui.boostInputDisabled).toBe(true);
    expect(ui.boostCapActive).toBe(true);
  });

  it("睡眠目標がある行もアメブは Lv ちょうどまで、端数は通常アメが賄う（2026-08-15）", async () => {
    const previousWorker = globalThis.Worker;
    const requests: Array<Record<string, unknown>> = [];
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      postMessage(message: unknown) { requests.push(message as Record<string, unknown>); }
      terminate() {}
    }
    Object.defineProperty(globalThis, "Worker", { value: FakeWorker, configurable: true, writable: true });
    try {
      const store = useCalcStore({ locale: ref("ja"), t });
      store.setSlotBoostKind("full");
      store.upsertFromBox({ boxId: "sleep-mix", pokedexId: 381, srcLevel: 50, dstLevelDefault: 70, expType: 1080, nature: "normal" });
      const id = store.rows.value[0]!.id;
      store.setRowSleepTargetHours(id, 2000);
      await new Promise((resolve) => setTimeout(resolve, 30));

      // アメが担当する終端 T' は Lv の途中（端数EXP付き）。**アメブが賄うのは Lv ちょうどまで**で、
      // 端数は通常アメの担当（2026-08-15 に端数賄いを廃止）。入力欄の上限は端数込みのままなので、
      // 導出値はそれより小さくなる。**睡眠がある行では「アメブ1個 → 通常アメ1個」置換はしない**
      // （2026-07-30）ので、導出値は Lv ちょうどまでの必要数ぴったりになる。
      const ui = store.rowsView.value[0]!.ui;
      expect(ui.boostReachLevelMax).toBeLessThan(MAX_LEVEL);
      expect(ui.boostCandyInput).toBe(
        calcExpAndCandy({
          srcLevel: 50, dstLevel: ui.boostReachLevelMax, dstExpInLevel: 0,
          expType: 1080, nature: "normal", boost: "full", expGot: 0,
        }).candy,
      );
      expect(ui.boostCandyInputMax).toBeGreaterThan(ui.boostCandyInput);

      const request = requests[requests.length - 1]!;
      const outcome = solveLevelPlanWithBudget(request.input as LevelPlannerInput, { deadlineMs: 60_000 });
      expect(outcome.kind).toBe("result");
      if (outcome.kind !== "result") return;
      // 実配分の内訳は UI の導出値と一致する。端数ぶんだけ通常アメが乗る
      const line = outcome.result.pokemonResults[0]!.targetLine;
      expect(line.boostedCandyUnits).toBe(ui.boostCandyInput);
      expect(line.nonBoostCandyUnits).toBeGreaterThan(0);
    } finally {
      Object.defineProperty(globalThis, "Worker", { value: previousWorker, configurable: true, writable: true });
    }
  });

  it("アメブ目標Lvを担当範囲より下げた行は、その先を通常アメで続ける（対照）", () => {
    const store = useCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind("full");
    store.upsertFromBox({ boxId: "sleep-partial", pokedexId: 381, srcLevel: 50, dstLevelDefault: 70, expType: 1080, nature: "normal" });
    const id = store.rows.value[0]!.id;
    store.setRowSleepTargetHours(id, 2000);
    const capLevel = store.rowsView.value[0]!.ui.boostReachLevelMax;

    // 上限より下を選んだのはユーザーの意図なので、端数まで賄わせてはいけない
    store.setBoostLevel(id, capLevel - 3);
    const ui = store.rowsView.value[0]!.ui;
    expect(ui.boostReachLevel).toBe(capLevel - 3);
    expect(ui.boostCandyInput).toBe(
      calcExpAndCandy({
        srcLevel: 50, dstLevel: capLevel - 3, dstExpInLevel: 0,
        expType: 1080, nature: "normal", boost: "full", expGot: 0,
      }).candy,
    );
    expect(ui.boostCandyInput).toBeLessThan(ui.boostCandyInputMax);
  });

  /**
   * §15.7 の「個数指定があるとき」。睡眠目標があると、必要数をそのまま個数指定へ入れたときに
   * 同じアメ数なのに内訳と到達点が変わっていた。
   *
   * 端数賄い（旧 `coverTargetExp`）は廃止したので、**アメブ／通常アメの内訳は導出モードでも
   * 個数指定モードでも同じ規則で決まる**（アメブは Lv ちょうどまで）。ここで見るのはその一致性で、
   * 「通常アメが 0 個か」ではない。
   */
  it("睡眠目標があるとき、必要数をそのまま個数指定へ入れても内訳と到達点が一致する（2026-07-30）", async () => {
    const previousWorker = globalThis.Worker;
    const requests: Array<Record<string, unknown>> = [];
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      postMessage(message: unknown) { requests.push(message as Record<string, unknown>); }
      terminate() {}
    }
    Object.defineProperty(globalThis, "Worker", { value: FakeWorker, configurable: true, writable: true });
    try {
      // 行ごとに別ストアで測る（同一ストアの連続操作では debounce の再計算待ちが読めない）
      const measure = async (candyTarget?: number) => {
        requests.length = 0;
        const store = useCalcStore({ locale: ref("ja"), t });
        store.setSlotBoostKind("full");
        store.upsertFromBox({
          boxId: `sleep-eq-${candyTarget ?? "auto"}`, pokedexId: 381,
          srcLevel: 50, dstLevelDefault: 70, expType: 1080, nature: "normal",
        });
        const id = store.rows.value[0]!.id;
        store.setRowSleepTargetHours(id, 2000);
        if (candyTarget !== undefined) store.onRowCandyTarget(id, String(candyTarget));
        let seen = -1;
        for (let i = 0; i < 40 && seen !== requests.length; i++) {
          seen = requests.length;
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
        const request = requests[requests.length - 1]!;
        const outcome = solveLevelPlanWithBudget(request.input as LevelPlannerInput, { deadlineMs: 60_000 });
        if (outcome.kind !== "result") throw new Error(`solver: ${outcome.kind}`);
        const p = outcome.result.pokemonResults[0]!;
        return {
          boost: p.targetLine.boostedCandyUnits,
          normal: p.targetLine.nonBoostCandyUnits,
          shards: p.targetLine.dreamShardsUsed,
          targetLevel: p.targetLevel,
          dstLevel: store.rows.value[0]!.dstLevel,
        };
      };

      const auto = await measure();
      // 端数は通常アメの担当（2026-08-15）。0 個ではなく、目標到達は変わらないことを見る
      expect(auto.normal).toBeGreaterThan(0);
      expect(auto.targetLevel).toBe(MAX_LEVEL);
      // 同じ需要を個数指定で表現しただけなので、内訳・かけら・到達点まで完全に一致する
      expect(await measure(auto.boost + auto.normal)).toEqual(auto);
    } finally {
      Object.defineProperty(globalThis, "Worker", { value: previousWorker, configurable: true, writable: true });
    }
  }, 60_000);

  /**
   * 端数賄い（旧 `coverTargetExp`）の回帰。目標Lv = 現在Lv の行（アメブの担当範囲が幅ゼロ）に
   * 個数指定だけを入れると、m から作った目標の端数EXPを賄うアメブが勝手に湧いていた
   * （実測: バリヤード Lv60 / m=75 で アメブ37 + 通常38、到達点が目標を Lv1 ぶん超過）。
   */
  it("目標Lv = 現在Lv の行に個数指定だけを入れてもアメブは湧かない（2026-08-15）", () => {
    const { store, id } = makeStore();
    store.setSlotBoostKind("mini");
    store.setDstLevel(id, 10); // 目標Lv = 現在Lv。アメブの担当範囲は幅ゼロ
    store.onRowCandyTarget(id, "75");

    const r = rowOf(store, id);
    const ui = store.rowsView.value.find((row) => row.id === id)!.ui;
    // アメブ目標Lvが現在Lvと同じ＝賄う範囲が無いので、導出値は 0 個
    expect(ui.boostCandyInput).toBe(0);
    // 保存された目標は「通常アメ75個の到達点」。表示値で引き直しても同じ地点になる
    const expected = targetFromCandy({
      srcLevel: r.srcLevel, expGot: 0, candyTarget: 75, boostCandy: ui.boostCandyInput,
      expType: r.expType, nature: r.nature, boostKind: store.boostKind.value,
    });
    expect(r.dstLevel).toBe(expected.level);
    expect(r.dstExpInLevel).toBe(expected.expInLevel);
  });

  /**
   * §15.11 の回帰。**`T` は `(m, n)` の出力**なので、`T` を作るときに使ったアメブ個数 `n` と、
   * 表示・ソルバーが使う `n` は必ず一致しなければならない。食い違うと、保存された目標へ
   * その `m` 個では届かなくなる（実測: Lv10→20 / expType 600 / full / m=50 で、
   * 保存 `Lv19+178` に対し実配分は アメブ48 + 通常2 の `Lv19+98`）。
   *
   * 表示経路が `reachLevel` を `T` 由来の値（`dstLevel` / `T'`）で抑えていたのが原因。
   * 端数賄い（旧 `coverTargetExp`）がその食い違いを覆い隠していたので §15.10 で表面化した。
   * 掃引で確認: 修正前は 2520 件中 1233 件、§15.10 以前でも 558 件がずれていた。
   */
  it("個数指定のある行は、保存された目標に個数指定ぶんで到達できる（2026-08-15）", () => {
    const mismatches: string[] = [];
    let cases = 0;
    for (const kind of ["full", "mini"] as const) {
      for (const expType of [600, 900, 1080] as const) {
        for (const src of [1, 10, 35, 60]) {
          for (const dstDelta of [0, 1, 5, 10, 20]) {
            for (const m of [1, 10, 40, 50, 100, 200, 999]) {
              // アメブ目標Lv: 既定のまま / 目標Lvちょうど / 目標Lvより下（その先は通常アメ）
              for (const reachDelta of [undefined, 0, -3]) {
                const dst = Math.min(MAX_LEVEL, src + dstDelta);
                const store = useCalcStore({ locale: ref("ja"), t });
                store.setSlotBoostKind(kind);
                store.upsertFromBox({
                  boxId: `probe-${cases}`, pokedexId: 25,
                  srcLevel: src, dstLevelDefault: dst, expType, nature: "normal",
                });
                const id = store.rows.value[0]!.id;
                store.setDstLevel(id, dst);
                if (reachDelta !== undefined) {
                  store.setBoostLevel(id, Math.max(src, Math.min(MAX_LEVEL, dst + reachDelta)));
                }
                store.onRowCandyTarget(id, String(m));

                const r = rowOf(store, id);
                const ui = store.rowsView.value.find((row) => row.id === id)!.ui;
                // 表示されているアメブ個数で「個数指定ぶんを使い切った到達点」を引き直す
                const redrawn = targetFromCandy({
                  srcLevel: r.srcLevel, expGot: 0, candyTarget: r.candyTarget ?? 0,
                  boostCandy: ui.boostCandyInput,
                  expType: r.expType, nature: r.nature, boostKind: store.boostKind.value,
                });
                cases++;
                if (r.dstLevel !== redrawn.level || r.dstExpInLevel !== redrawn.expInLevel) {
                  mismatches.push(
                    `${kind}/exp${expType}/src${src}/dst${dst}/reach${r.boostReachLevel}/m${r.candyTarget}`
                    + ` boost=${ui.boostCandyInput} 保存=${r.dstLevel}+${r.dstExpInLevel}`
                    + ` 引き直し=${redrawn.level}+${redrawn.expInLevel}`,
                  );
                }
              }
            }
          }
        }
      }
    }
    expect(cases).toBe(2520);
    expect(mismatches.slice(0, 10)).toEqual([]);
  });

  it("睡眠目標が無いときは「アメブ1個 → 通常アメ1個」置換を維持する（対照）", () => {
    const store = useCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind("full");
    store.upsertFromBox({ boxId: "no-sleep-swap", pokedexId: 381, srcLevel: 50, dstLevelDefault: 70, expType: 1080, nature: "normal" });
    // 置換が効く行では実効アメブが上限より1個少ない。睡眠ありと違って余剰EXPは捨てられる
    const ui = store.rowsView.value[0]!.ui;
    expect(ui.boostCandyInputMax - ui.boostCandyInput).toBe(1);
  });

  it("アメブ上限 3500→0→3500 で個数指定の有無にかかわらず状態・導出値が完全復元する（§11.4-A）", () => {
    const { store, id } = makeStore();
    store.setSlotBoostKind("full");
    store.setDstLevel(id, 40);
    store.onRowCandyTarget(id, "300");
    store.upsertFromBox({ boxId: "box-control", pokedexId: 26, srcLevel: 10, dstLevelDefault: 40, expType: 600, nature: "normal" });
    const controlId = store.rows.value[1]!.id;
    const stateBefore = store.rows.value.map((row) => ({ ...row }));
    const viewBefore = store.rowsView.value.map((row) => row.ui.boostCandyInput);

    store.onBoostCandyRemainingInput("0");
    expect(store.rows.value).toEqual(stateBefore);
    // **上限を下げても表示個数は動かない**（黙って残枠へ切り詰めない。§11.8-b）。
    // 変わるのは「超過しているか」だけで、そこは赤枠で伝える。
    expect(store.rowsView.value.map((row) => row.ui.boostCandyInput)).toEqual(viewBefore);
    expect(store.rowsView.value.map((row) => row.ui.boostQuotaViolation !== null)).toEqual([true, true]);

    store.onBoostCandyRemainingInput("3500");
    expect(store.rows.value).toEqual(stateBefore);
    expect(store.rowsView.value.map((row) => row.ui.boostCandyInput)).toEqual(viewBefore);
    expect(store.rowsView.value.map((row) => row.ui.boostQuotaViolation !== null)).toEqual([false, false]);
    expect(rowOf(store, id).candyTarget).toBe(300);
    expect(rowOf(store, controlId).candyTarget).toBeUndefined();
  });

  /** アメブ上限 500・元Lv10→目標Lv40 の3行。上から配ると2行目が「アメブ境界」になる。 */
  function makeQuotaStore(cap = "500") {
    const store = useCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind("full");
    store.onBoostCandyRemainingInput(cap);
    for (const n of [1, 2, 3]) {
      store.upsertFromBox({ boxId: `quota-${n}`, pokedexId: 24 + n, srcLevel: 10, dstLevelDefault: 40, expType: 600, nature: "normal" });
    }
    return store;
  }

  it("アメブ枠は上から配り、足りなくなった行（アメブ境界）だけ個数を確定させる", () => {
    const store = makeQuotaStore();
    const [first, boundary, below] = store.rows.value;
    const need = store.rowsView.value[0]!.ui.boostCandyInput;

    // 前提: 1行ぶんの必要数が上限500の内側で、2行ぶんには足りないこと
    expect(need).toBeGreaterThan(0);
    expect(need).toBeLessThan(500);
    expect(500 - need).toBeLessThan(need);

    // 満額もらえる行は導出のまま（意図を保存しない）
    expect(first!.boostOrExpAdjustment).toBeUndefined();
    // 境界の行は残枠を個数として確定させる
    expect(boundary!.boostOrExpAdjustment).toBe(500 - need);
    // それ以降は 0。「アメブが回らない」が一目で分かる
    expect(below!.boostOrExpAdjustment).toBe(0);

    expect(store.rowsView.value.map((row) => row.ui.boostCandyInput)).toEqual([need, 500 - need, 0]);
    // 割り当て直後はどの行も超過していない
    expect(store.rowsView.value.map((row) => row.ui.boostQuotaViolation !== null)).toEqual([false, false, false]);
  });

  it("上位のアメブを減らしても下位は自動で増えない（保存された意図を保つ）", () => {
    const store = makeQuotaStore();
    const boundaryBefore = store.rows.value[1]!.boostOrExpAdjustment;

    store.onRowBoostCandy(store.rows.value[0]!.id, "0");

    // 枠が空いても、確定済みの意図は勝手に書き換わらない。増やしたいならリセットを押す
    expect(store.rows.value[1]!.boostOrExpAdjustment).toBe(boundaryBefore);
    expect(store.rows.value[2]!.boostOrExpAdjustment).toBe(0);

    // リセットすると空いた枠から配り直す
    store.resetRowBoostCandy(store.rows.value[1]!.id);
    expect(store.rows.value[1]!.boostOrExpAdjustment).toBeUndefined();
    expect(store.rowsView.value[1]!.ui.boostCandyInput).toBeGreaterThan(boundaryBefore!);
  });

  it("全体リセットは全行のアメブ個数を破棄して配り直す", () => {
    const store = makeQuotaStore();
    store.onRowBoostCandy(store.rows.value[0]!.id, "10");
    store.onRowBoostCandy(store.rows.value[2]!.id, "7");

    store.resetAllBoostCandy();

    const need = store.rowsView.value[0]!.ui.boostCandyInput;
    expect(store.rows.value[0]!.boostOrExpAdjustment).toBeUndefined();
    expect(store.rows.value[1]!.boostOrExpAdjustment).toBe(500 - need);
    expect(store.rows.value[2]!.boostOrExpAdjustment).toBe(0);
  });

  it("上限を下げると導出モードの行が枠超過になる（保存値は触らない）", () => {
    // 枠が潤沢なうちは全行が導出モード
    const store = makeQuotaStore("5000");
    expect(store.rows.value.every((r) => r.boostOrExpAdjustment === undefined)).toBe(true);
    expect(store.rowsView.value.some((v) => v.ui.boostQuotaViolation !== null)).toBe(false);

    store.onBoostCandyRemainingInput("10");

    // 上限を戻せば復元できるよう、保存値は書き換えない（§11.4）。
    // 超過は表示側の同期判定で出す。個数が未入力なので、赤くするのはアメブ目標Lv側。
    expect(store.rows.value.every((r) => r.boostOrExpAdjustment === undefined)).toBe(true);
    expect(store.rowsView.value[0]!.ui.boostQuotaViolation).toBe("reach");
  });

  it("全体リセットは undo で元に戻せる", () => {
    const store = makeQuotaStore();
    store.onRowBoostCandy(store.rows.value[0]!.id, "10");
    store.onRowBoostCandy(store.rows.value[2]!.id, "7");
    const before = store.rows.value.map((r) => r.boostOrExpAdjustment);

    store.resetAllBoostCandy();
    expect(store.rows.value.map((r) => r.boostOrExpAdjustment)).not.toEqual(before);

    // 全行の手入力を捨てる操作なので、beginUndo を通っていないと戻せない
    store.undo();
    expect(store.rows.value.map((r) => r.boostOrExpAdjustment)).toEqual(before);
  });

  it("全体リセットの undo は、あとから変えたアメブ上限を巻き戻さない", () => {
    const store = makeQuotaStore();
    store.onRowBoostCandy(store.rows.value[0]!.id, "7");

    store.resetAllBoostCandy();
    // scope の回帰検証なので、別履歴を積まずに無関係な値だけを動かす。
    store.boostCandyRemaining.value = 1234;

    store.undo();

    // 行だけが戻り、上限は触られていない
    expect(store.rows.value[0]!.boostOrExpAdjustment).toBe(7);
    expect(store.boostCandyRemaining.value).toBe(1234);
  });

  it("設定リセットは対象だけを既定値へ戻し、undo / redo できる", () => {
    const candyStore = useCandyStore();
    const originalInventory = candyStore.getInventory();
    candyStore.resetInventory();
    const store = useCalcStore({ locale: ref("ja"), t });

    try {
      store.upsertFromBox({ boxId: "settings-reset", pokedexId: 25, srcLevel: 10, dstLevelDefault: 40, expType: 600, nature: "normal" });
      const rowId = store.rows.value[0]!.id;
      store.onRowCandyTarget(rowId, "100");
      store.updateSleepSettings({
        dailySleepHours: 6,
        sleepExpBonusCount: 5,
        includeGSD: false,
        timeZone: "America/New_York",
        growthIncenseStock: 12,
        growthIncenseNormalPerWeek: 4,
        useProjectedEvents: false,
      });
      store.setDefaultBoostReachLevel(25);
      store.setItemCompareMode("legacyImproved");
      store.onTotalShardsInput("123456");
      store.onBoostCandyRemainingInput("321");
      store.updateUniversalCandy({ s: 11, m: 12, l: 13 });
      store.updateTypeCandy("Electric", { s: 21, m: 22 });
      store.updateSpeciesCandy(25, 31);

      const beforeSettings = JSON.parse(JSON.stringify(store.sleepSettings.value));
      const beforeRows = JSON.parse(JSON.stringify(store.rows.value));
      const beforeInventory = candyStore.getInventory();

      store.resetSettings();

      const expectedSettings = { ...defaultSleepSettings(), timeZone: detectTimeZone() };
      expect(store.sleepSettings.value).toEqual(expectedSettings);
      expect(store.sleepSettings.value.growthIncenseStock).toBeNull();
      expect(store.defaultBoostReachLevel.value).toBeNull();
      expect(store.itemCompareMode.value).toBe("surplusFirst");
      expect(store.totalShards.value).toBe(123456);
      expect(store.boostCandyRemaining.value).toBe(321);
      expect(candyStore.getInventory()).toEqual(beforeInventory);
      expect(store.rows.value).toHaveLength(1);

      const resetRows = JSON.parse(JSON.stringify(store.rows.value));
      store.undo();
      expect(store.sleepSettings.value).toEqual(beforeSettings);
      expect(store.defaultBoostReachLevel.value).toBe(25);
      expect(store.itemCompareMode.value).toBe("legacyImproved");
      expect(store.rows.value).toEqual(beforeRows);
      expect(store.totalShards.value).toBe(123456);
      expect(store.boostCandyRemaining.value).toBe(321);
      expect(candyStore.getInventory()).toEqual(beforeInventory);

      store.redo();
      expect(store.sleepSettings.value).toEqual(expectedSettings);
      expect(store.defaultBoostReachLevel.value).toBeNull();
      expect(store.itemCompareMode.value).toBe("surplusFirst");
      expect(store.rows.value).toEqual(resetRows);
      expect(store.totalShards.value).toBe(123456);
      expect(store.boostCandyRemaining.value).toBe(321);
      expect(candyStore.getInventory()).toEqual(beforeInventory);
    } finally {
      candyStore.restoreInventory(originalInventory);
    }
  });

  it("既定値での設定リセットは空の undo を積まず、既存の redo を消さない", () => {
    const store = useCalcStore({ locale: ref("ja"), t });
    store.setItemCompareMode("legacyImproved");
    store.undo();
    expect(store.isSettingsDefault.value).toBe(true);
    expect(store.canUndo.value).toBe(false);
    expect(store.canRedo.value).toBe(true);

    store.resetSettings();

    expect(store.canUndo.value).toBe(false);
    expect(store.canRedo.value).toBe(true);
    store.redo();
    expect(store.itemCompareMode.value).toBe("legacyImproved");
  });

  it("再割当後の目標Lv変更は最新の1操作として undo し、再割当結果まで巻き戻さない", () => {
    const store = makeQuotaStore();
    const rowId = store.rows.value[0]!.id;
    store.onRowBoostCandy(rowId, "7");

    store.resetAllBoostCandy();
    const boostAfterReset = store.rows.value.map((row) => row.boostOrExpAdjustment);
    const dstBeforeEdit = rowOf(store, rowId).dstLevel;
    store.setDstLevel(rowId, dstBeforeEdit + 1);

    store.undo();

    expect(rowOf(store, rowId).dstLevel).toBe(dstBeforeEdit);
    expect(store.rows.value.map((row) => row.boostOrExpAdjustment)).toEqual(boostAfterReset);
  });

  it("行が無いときの全体リセットは undo を積まない", () => {
    const store = useCalcStore({ locale: ref("ja"), t });

    store.resetAllBoostCandy();

    expect(store.canUndo.value).toBe(false);
  });

  it("アメブ上限の連続打鍵 3500 は undo 1回で元の値へ戻る", () => {
    const store = useCalcStore({ locale: ref("ja"), t });

    store.onBoostCandyRemainingInput("3");
    store.onBoostCandyRemainingInput("35");
    store.onBoostCandyRemainingInput("350");
    store.onBoostCandyRemainingInput("3500");
    expect(store.boostCandyRemaining.value).toBe(3500);

    store.undo();

    expect(store.boostCandyRemaining.value).toBeNull();
    expect(store.canUndo.value).toBe(false);
  });

  it("行のアメブ個数の連続打鍵 3500 は undo 1回で元の値へ戻る", () => {
    const store = makeQuotaStore("5000");
    const row = store.rows.value[0]!;
    const before = row.boostOrExpAdjustment;

    store.onRowBoostCandy(row.id, "3");
    store.onRowBoostCandy(row.id, "35");
    store.onRowBoostCandy(row.id, "350");
    store.onRowBoostCandy(row.id, "3500");
    expect(rowOf(store, row.id).boostOrExpAdjustment).not.toBe(before);

    store.undo();

    expect(rowOf(store, row.id).boostOrExpAdjustment).toBe(before);
  });

  it("かけら在庫の undo は無関係な睡眠設定を動かさない", () => {
    const store = useCalcStore({ locale: ref("ja"), t });
    const before = store.totalShards.value;

    store.onTotalShardsInput(String(before + 123));
    store.sleepSettings.value = { ...store.sleepSettings.value, dailySleepHours: 9 };
    store.undo();

    expect(store.totalShards.value).toBe(before);
    expect(store.sleepSettings.value.dailySleepHours).toBe(9);
  });

  it("睡眠設定の undo は行を戻し、無関係な配分方針を動かさない", () => {
    const { store, id } = makeStore();
    store.onRowCandyTarget(id, "20");
    const beforeSettings = { ...store.sleepSettings.value };
    const beforeRow = JSON.parse(JSON.stringify(rowOf(store, id))) as CalcRow;

    store.updateSleepSettings({ dailySleepHours: 10 });
    store.itemCompareMode.value = "legacyImproved";
    store.undo();

    expect(store.sleepSettings.value).toEqual(beforeSettings);
    expect(rowOf(store, id)).toEqual(beforeRow);
    expect(store.itemCompareMode.value).toBe("legacyImproved");
  });

  it("月齢・成長のお香設定を正規化して更新し、まとめて undo できる", () => {
    const { store } = makeStore();
    const before = { ...store.sleepSettings.value };

    store.updateSleepSettings({
      timeZone: "america/new_york",
      growthIncenseGsdDays: { beforeFullMoon: true, fullMoon: false, afterFullMoon: true },
      growthIncenseNormalPerWeek: 4,
    });
    expect(store.sleepSettings.value).toMatchObject({
      timeZone: "America/New_York",
      growthIncenseGsdDays: { beforeFullMoon: true, fullMoon: false, afterFullMoon: true },
      growthIncenseNormalPerWeek: 4,
    });
    expect(store.currentGameDate.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    store.undo();
    expect(store.sleepSettings.value).toEqual(before);
  });

  it("固定UTCオフセットをタイムゾーン設定として保存しない", () => {
    const { store } = makeStore();
    const before = { ...store.sleepSettings.value };
    store.updateSleepSettings({ timeZone: "UTC+09:00" });
    expect(store.sleepSettings.value).toEqual(before);
  });

  it("不正なタイムゾーンと同時に渡した他の睡眠設定は更新する", () => {
    const { store } = makeStore();
    const beforeTimeZone = store.sleepSettings.value.timeZone;

    store.updateSleepSettings({ timeZone: "UTC+09:00", dailySleepHours: 9 });

    expect(store.sleepSettings.value.dailySleepHours).toBe(9);
    expect(store.sleepSettings.value.timeZone).toBe(beforeTimeZone);
  });

  it("既存タイムゾーンだけが壊れていても他の睡眠設定を更新して自己修復する", () => {
    const { store } = makeStore();
    store.sleepSettings.value = { ...store.sleepSettings.value, timeZone: "Not/A_Zone" };

    store.updateSleepSettings({ dailySleepHours: 9 });

    expect(store.sleepSettings.value.dailySleepHours).toBe(9);
    expect(store.sleepSettings.value.timeZone).not.toBe("Not/A_Zone");
    expect(normalizeTimeZone(store.sleepSettings.value.timeZone)).not.toBeNull();
  });

  it("公開refへ不正なタイムゾーンを直接入れても日付更新時に自己修復する", async () => {
    const { store } = makeStore();
    store.sleepSettings.value = { ...store.sleepSettings.value, timeZone: "Not/A_Zone" };

    await nextTick();

    expect(normalizeTimeZone(store.sleepSettings.value.timeZone)).not.toBeNull();
    expect(store.currentGameDate.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(() => store.rowsView.value).not.toThrow();
  });

  it("月齢カレンダー状態はGSDを使う行があるときだけreadyになる", () => {
    const { store } = makeStore();
    expect(store.lunarCalendarStatus.value).toBe("ready");

    store.updateSleepSettings({ includeGSD: false });

    expect(store.lunarCalendarStatus.value).toBe("idle");
  });

  it("仮イベント既定オンで花が月齢範囲外でも未処理例外にせずエラー状態へ合流する", async () => {
    const store = useCalcStore({ locale: ref("ja"), t, currentGameDate: "2046-12-31" });
    expect(store.sleepSettings.value.useProjectedEvents).toBe(true);
    expect(() => store.blueSeedSegments.value).not.toThrow();

    store.upsertFromBox({ boxId: "range-error", pokedexId: 25, srcLevel: 10, dstLevelDefault: 30, expType: 600, nature: "normal" });
    const id = store.rows.value[0]!.id;
    store.setRowSleepTargetHours(id, 1000);

    // 範囲外を通常日扱いせず、睡眠計算自体を利用不可にする。
    expect(store.rowSleepExpFor(id)).toBe(0);
    await vi.waitFor(() => expect(store.lunarCalendarStatus.value).toBe("error"));
  });

  it("範囲外エラーの記録前に設定が変わったら古いmicrotaskを破棄する", async () => {
    const store = useCalcStore({ locale: ref("ja"), t, currentGameDate: "2046-12-31" });
    store.upsertFromBox({ boxId: "stale-range-error", pokedexId: 25, srcLevel: 10, dstLevelDefault: 30, expType: 600, nature: "normal" });
    const id = store.rows.value[0]!.id;
    store.setRowSleepTargetHours(id, 1000);

    expect(store.rowSleepExpFor(id)).toBe(0);
    // updateSleepSettingsのエラー消去へ依存せず、microtaskより先に入力スナップショットだけを変える。
    store.sleepSettings.value = { ...store.sleepSettings.value, includeGSD: false };
    await nextTick();
    store.sleepSettings.value = { ...store.sleepSettings.value, includeGSD: true };

    expect(store.lunarCalendarStatus.value).toBe("ready");
  });

  it("rowSleepExpFor は残る睡眠EXPだけを既存計算から公開する", () => {
    const { store, id } = makeStore();
    expect(store.rowSleepExpFor(id)).toBe(0);

    store.setRowSleepTargetHours(id, 1000);
    expect(store.rowSleepExpFor(id)).toBeGreaterThan(0);

    store.setRowSleepHours(id, 1000);
    expect(store.rowSleepExpFor(id)).toBe(0);
  });

  it("rowSleepRemainingHoursFor は睡眠目標から累計を引き、0で下限を固定する", () => {
    const { store, id } = makeStore();
    expect(store.rowSleepRemainingHoursFor(id)).toBe(0);

    store.setRowSleepTargetHours(id, 2000);
    store.setRowSleepHours(id, 500);
    expect(store.rowSleepRemainingHoursFor(id)).toBe(1500);

    store.setRowSleepHours(id, 2500);
    expect(store.rowSleepRemainingHoursFor(id)).toBe(0);
  });

  /**
   * 成長のお香は1回の睡眠につき1個なので、**使用日数がそのまま個数**。
   *
   * 数えるのは「**目標へ届くまでに寝る日数**」で、睡眠目標時間を寝きる日数ではない。
   * 実測したバグ（2026-08-20）: Lv69 → Lv70（あと98EXP）の行に睡眠目標2000h（残358h）を
   * 設定すると、358hぶんの28日を数えてお香2個と出ていた。Lv70 は硬上限なので8時間半で終わる。
   */
  it("rowExceedsSleepTeamLimit は睡眠目標のある6匹目以降だけ true にする", () => {
    const store = useCalcStore({ locale: ref("ja"), t });
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      store.upsertFromBox({ boxId: `team-${i}`, pokedexId: 25, srcLevel: 10, dstLevelDefault: 70, expType: 600, nature: "normal" });
      ids.push(store.rows.value[store.rows.value.length - 1]!.id);
    }

    // 睡眠目標が無いうちは何匹並べても対象外
    expect(ids.every(id => store.rowExceedsSleepTeamLimit(id) === false)).toBe(true);

    // 睡眠目標を付けた順に数える。6匹目以降だけ true
    ids.forEach(id => store.setRowSleepTargetHours(id, 1000));
    expect(ids.map(id => store.rowExceedsSleepTeamLimit(id)))
      .toEqual([false, false, false, false, false, true, true]);

    // 睡眠目標を外した行は数えないので、後ろの行が枠に入る
    store.setRowSleepTargetHours(ids[0]!, undefined);
    expect(store.rowExceedsSleepTeamLimit(ids[5]!)).toBe(false);
    expect(store.rowExceedsSleepTeamLimit(ids[6]!)).toBe(true);
  });

  it("rowGrowthIncenseCountFor は目標へ届くまでの日数で数える（睡眠目標を寝きる日数ではない）", () => {
    const store = useCalcStore({ locale: ref("ja"), t });
    store.upsertFromBox({ boxId: "incense-cap", pokedexId: 25, srcLevel: 69, dstLevelDefault: 70, expType: 600, nature: "normal" });
    const id = store.rows.value[0]!.id;
    store.onRowExpRemaining(id, "1");
    // 毎日お香を使う設定にする。**寝る日数がそのまま個数になる**ので、日数の取り違えが必ず表に出る。
    store.updateSleepSettings({
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: true, fullMoon: true, afterFullMoon: true },
      growthIncenseNormalPerWeek: 7,
    });

    // 睡眠目標が無い行は 0（そもそも睡眠を計画に入れない）
    expect(store.rowGrowthIncenseCountFor(id)).toBe(0);

    store.setRowSleepTargetHours(id, 2000);
    // plan が無いうちは 0（画面も plan が無ければ結果行ごと出さない）
    expect(store.rowGrowthIncenseCountFor(id)).toBe(0);

    applyPlanSynchronously(store);
    // 睡眠EXPは目標（あと1EXP）を桁違いに超える。**その差がバグの温床だった。**
    expect(store.rowSleepExpFor(id)).toBeGreaterThan(1_000);
    // 残り1EXPは1晩で終わる。2000hを寝きる日数を数えてはいけない。
    // **お香なしで届くので0個**（最終日のお香は使わずに済むなら使わない）。
    // 日数を取り違えていれば毎日お香の設定なので大きな数になり、必ず表に出る。
    expect(store.rowGrowthIncenseCountFor(id)).toBe(0);

    // 数値目標を寝きった後は、アメ不足が残っていても追加の睡眠を計画しない。
    store.setRowSleepHours(id, 2000);
    applyPlanSynchronously(store);
    expect(store.rowSleepExpFor(id)).toBe(0);
    expect(store.rowGrowthIncenseCountFor(id)).toBe(0);

    // 1個も使わない設定なら 0
    store.updateSleepSettings({
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
      growthIncenseNormalPerWeek: 0,
    });
    expect(store.rowGrowthIncenseCountFor(id)).toBe(0);
  });

  it("rowGrowthIncenseCountFor は数値目標の予定睡眠を超えてアメ不足分を数えない", () => {
    const store = useCalcStore({ locale: ref("ja"), t });
    store.upsertFromBox({ boxId: "incense-shortage", pokedexId: 25, srcLevel: 10, dstLevelDefault: 70, expType: 600, nature: "normal" });
    const id = store.rows.value[0]!.id;
    store.updateSleepSettings({
      includeGSD: false,
      dailySleepHours: 8.5,
      growthIncenseNormalPerWeek: 7,
    });
    store.setRowSleepTargetHours(id, 200);

    applyPlanSynchronously(store);
    // 在庫0なので目標までの残EXPは予定睡眠EXPより大きいが、お香は200hぶんの24晩まで。
    expect(store.rowGrowthIncenseCountFor(id)).toBe(Math.ceil(200 / 8.5));
  });

  /** plan は debounce 越しに入るので、テストでは同じ入力から解いた結果を直接流し込む。 */
  function applyPlanSynchronously(store: ReturnType<typeof useCalcStore>): void {
    const input = buildLevelPlannerInput(store.rowsView.value.map((row) => ({
      id: row.id,
      pokedexId: row.pokedexId,
      title: row.title,
      pokemonType: row.pokemonType,
      srcLevel: row.srcLevel,
      dstLevel: row.dstLevel,
      dstExpInLevel: row.dstExpInLevel,
      expRemaining: row.expRemaining,
      expType: row.expType,
      nature: row.nature,
      boostReachLevel: row.boostReachLevel,
      candyTarget: row.candyTarget,
      boostCandyInput: row.ui.boostCandyInput,
      sleepExp: store.rowSleepExpFor(row.id),
      sleepTargetMode: row.sleepTargetMode,
    })), {
      candyInventory: { species: {}, typeCandy: {}, universal: { s: 0, m: 0, l: 0 } },
      dreamShards: 0,
      boost: { kind: store.boostKind.value, limit: 0 },
      itemCompareMode: "surplusFirst",
    })!;
    const outcome = solveLevelPlanWithBudget(input, { deadlineMs: 60_000 });
    if (outcome.kind !== "result") throw new Error("planner did not return a result");
    (store.planResult as unknown as Ref<LevelPlannerResult | null>).value = outcome.result;
  }

  /**
   * 「すべて睡眠」は睡眠EXPを導出しない（設計書§11）ので `markForSleep` を通らない。
   * 個数は「残EXPから逆算した必要日数」の経路（`calcSleepTimeForExp`）から取る。
   * その経路が個数を返すこと自体は `sleep-growth.test.ts` が固定している。
   * ここでは **plan が無いうちは 0** を固定する（画面も plan が無ければ結果行ごと出さない）。
   */
  it("rowGrowthIncenseCountFor は plan の無い「すべて睡眠」の行では 0 を返す", () => {
    const { store, id } = makeStore();
    store.setDstLevel(id, 30);
    store.setRowSleepTarget(id, "all");
    store.updateSleepSettings({
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: true, fullMoon: true, afterFullMoon: true },
      growthIncenseNormalPerWeek: 7,
    });
    expect(store.rowGrowthIncenseCountFor(id)).toBe(0);
  });

  it("既定アメブ目標Lvの undo は無関係なかけら在庫を動かさない", () => {
    const store = useCalcStore({ locale: ref("ja"), t });
    const before = store.defaultBoostReachLevel.value;

    store.setDefaultBoostReachLevel(25);
    store.totalShards.value = 9876;
    store.undo();

    expect(store.defaultBoostReachLevel.value).toBe(before);
    expect(store.totalShards.value).toBe(9876);
  });

  it("アメ在庫の各更新は undo でき、無関係な計算設定を動かさない", () => {
    const candyStore = useCandyStore();
    const original = candyStore.getInventory();
    candyStore.resetInventory();
    const store = useCalcStore({ locale: ref("ja"), t });

    try {
      store.updateUniversalCandy({ s: 12 });
      store.itemCompareMode.value = "legacyImproved";
      store.undo();
      expect(candyStore.universalCandy.value.s).toBe(0);
      expect(store.itemCompareMode.value).toBe("legacyImproved");

      store.updateTypeCandy("electric", { m: 7 });
      store.undo();
      expect(candyStore.getTypeCandyFor("electric").m).toBe(0);

      store.updateSpeciesCandy(25, 44);
      store.undo();
      expect(candyStore.getSpeciesCandyFor(25)).toBe(0);
    } finally {
      candyStore.restoreInventory(original);
    }
  });

  it("activeRowId は行編集の undo で戻さない", () => {
    const store = useCalcStore({ locale: ref("ja"), t });
    store.upsertFromBox({ boxId: "active-1", title: "一匹目", srcLevel: 10, dstLevelDefault: 30, expType: 600, nature: "normal" });
    store.upsertFromBox({ boxId: "active-2", title: "二匹目", srcLevel: 10, dstLevelDefault: 30, expType: 600, nature: "normal" });
    const [first, second] = store.rows.value;

    store.setDstLevel(first!.id, 31);
    store.activeRowId.value = second!.id;
    store.undo();

    expect(store.activeRowId.value).toBe(second!.id);
    expect(rowOf(store, first!.id).dstLevel).toBe(30);
  });

  it("undo/redo のトーストにポケモン名と操作名を出す", () => {
    const translated = ((key: string, params?: Record<string, unknown>) => {
      if (key === "calc.row.dstLevel") return "目標Lv";
      if (key === "calc.undoLabel.rowField") return `${params?.name}の${params?.field}`;
      if (key === "status.undoWithLabel") return `${params?.label}を元に戻しました`;
      if (key === "status.redoWithLabel") return `${params?.label}をやり直しました`;
      return key;
    }) as unknown as Composer["t"];
    const store = useCalcStore({ locale: ref("ja"), t: translated });
    store.upsertFromBox({ boxId: "toast-row", title: "ピカチュウ", srcLevel: 10, dstLevelDefault: 30, expType: 600, nature: "normal" });
    const id = store.rows.value[0]!.id;
    store.setDstLevel(id, 31);

    // 通知は積み上がるので、最新は末尾
    store.undo();
    expect(useToast().toasts.value.at(-1)?.message).toBe("ピカチュウの目標Lvを元に戻しました");

    store.redo();
    expect(useToast().toasts.value.at(-1)?.message).toBe("ピカチュウの目標Lvをやり直しました");
  });

  it("行の各確定 API は1操作ずつ undo できる", () => {
    const { store, id } = makeStore();
    const expectRowUndo = (edit: () => void) => {
      const before = JSON.parse(JSON.stringify(rowOf(store, id))) as CalcRow;
      edit();
      expect(rowOf(store, id)).not.toEqual(before);
      store.undo();
      expect(rowOf(store, id)).toEqual(before);
    };

    expectRowUndo(() => store.nudgeDstLevel(id, 1));
    expectRowUndo(() => store.setSrcLevel(id, 11));
    expectRowUndo(() => store.setBoostLevel(id, 20));
    expectRowUndo(() => store.onRowExpRemaining(id, "1"));
    expectRowUndo(() => store.setNature(id, "up"));
    expectRowUndo(() => store.onRowCandyTarget(id, "5"));
    expectRowUndo(() => store.onRowBoostCandy(id, "5"));
    expectRowUndo(() => store.setRowSleepTargetHours(id, 200));
    expectRowUndo(() => store.setRowSleepHours(id, 50));

    store.onRowBoostCandy(id, "5");
    const beforeReset = JSON.parse(JSON.stringify(rowOf(store, id))) as CalcRow;
    store.resetRowBoostCandy(id);
    expect(rowOf(store, id)).not.toEqual(beforeReset);
    store.undo();
    expect(rowOf(store, id)).toEqual(beforeReset);
  });

  it("行追加・ボックス再反映・並べ替えはそれぞれ undo できる", () => {
    const { store, id } = makeStore();

    store.upsertFromBox({ boxId: "box-2", title: "二匹目", pokedexId: 26, srcLevel: 10, dstLevelDefault: 30, expType: 600, nature: "normal" });
    store.undo();
    expect(store.rows.value.map((row) => row.id)).toEqual([id]);

    store.upsertFromBox({ boxId: "box-2", title: "二匹目", pokedexId: 26, srcLevel: 10, dstLevelDefault: 30, expType: 600, nature: "normal" });
    const readdedSecondId = store.rows.value[1]!.id;
    store.moveRowDown(id);
    expect(store.rows.value.map((row) => row.id)).toEqual([readdedSecondId, id]);
    store.undo();
    expect(store.rows.value.map((row) => row.id)).toEqual([id, readdedSecondId]);

    store.upsertFromBox({ boxId: "box-1", title: "一匹目更新", pokedexId: 25, srcLevel: 10, dstLevelDefault: 30, expType: 600, nature: "down" });
    expect(rowOf(store, id).nature).toBe("down");
    store.undo();
    expect(rowOf(store, id).nature).toBe("normal");
  });

  /** 3行のストアと、並べ替え対象（先頭行）を返す。 */
  function makeOrderStore() {
    const store = useCalcStore({ locale: ref("ja"), t });
    for (const n of [1, 2, 3]) {
      store.upsertFromBox({ boxId: `order-${n}`, pokedexId: 24 + n, srcLevel: 10, dstLevelDefault: 30, expType: 600, nature: "normal" });
    }
    const ids = store.rows.value.map((row) => row.id);
    return { store, ids, target: ids[0]! };
  }

  it("並べ替えドラッグ中の連続入れ替えは、間が空いても1本の履歴にまとめる", () => {
    const { store, ids, target } = makeOrderStore();

    // CalcPanel の onRowPointerDown / onRowDocPointerMove と同じ順序。
    // PC では 25px ごとに moveRow が走るため、1回のドラッグで複数回入れ替わる。
    vi.useFakeTimers();
    try {
      store.dragRowId.value = target;
      store.moveRowDown(target);
      // ゆっくり動かしても割れないこと（時間ではなくドラッグで区切る）
      vi.advanceTimersByTime(5_000);
      store.moveRowDown(target);
      store.dragRowId.value = null;
    } finally {
      vi.useRealTimers();
    }
    expect(store.rows.value.map((row) => row.id)).toEqual([ids[1], ids[2], target]);

    store.undo();

    expect(store.rows.value.map((row) => row.id)).toEqual(ids);
    // 次の undo が行追加まで戻る＝ドラッグぶんの履歴はちょうど1本だった
    store.undo();
    expect(store.rows.value.map((row) => row.id)).toEqual(ids.slice(0, 2));
  });

  it("ドラッグを2回続けたら履歴も2本になる", () => {
    const { store, ids, target } = makeOrderStore();

    store.dragRowId.value = target;
    store.moveRowDown(target);
    store.dragRowId.value = null;
    store.dragRowId.value = target;
    store.moveRowDown(target);
    store.dragRowId.value = null;

    store.undo();

    expect(store.rows.value.map((row) => row.id)).toEqual([ids[1], target, ids[2]]);
  });

  it("↑↓ボタンの並べ替えは1クリックずつ undo できる", () => {
    const { store, ids, target } = makeOrderStore();

    // ドラッグ中ではないので、連続クリックでもまとめない
    store.moveRowDown(target);
    store.moveRowDown(target);

    store.undo();

    expect(store.rows.value.map((row) => row.id)).toEqual([ids[1], target, ids[2]]);
  });

  it("undo/redo の直後に同じ欄を触っても、その編集だけを undo できる", () => {
    const store = useCalcStore({ locale: ref("ja"), t });

    store.onBoostCandyRemainingInput("100");
    store.undo();
    store.redo();
    expect(store.boostCandyRemaining.value).toBe(100);

    // redo で積み直したエントリへ吸われると、この undo が 100 ではなく null まで戻る
    store.onBoostCandyRemainingInput("200");
    store.undo();

    expect(store.boostCandyRemaining.value).toBe(100);
  });

  it("アメブ種別の undo は種別・上限・再計算行をまとめて戻す", () => {
    const { store } = makeStore();
    store.boostCandyRemaining.value = 321;
    const beforeKind = store.boostKind.value;
    const beforeRows = JSON.parse(JSON.stringify(store.rows.value)) as CalcRow[];
    const nextKind = beforeKind === "mini" ? "full" : "mini";

    store.setSlotBoostKind(nextKind);
    expect(store.boostKind.value).toBe(nextKind);
    store.undo();

    expect(store.boostKind.value).toBe(beforeKind);
    expect(store.boostCandyRemaining.value).toBe(321);
    expect(store.rows.value).toEqual(beforeRows);
  });

  it("配分方針の undo は無関係なかけら在庫を動かさない", () => {
    const store = useCalcStore({ locale: ref("ja"), t });
    const before = store.itemCompareMode.value;
    const next = before === "legacyImproved" ? "surplusFirst" : "legacyImproved";

    store.setItemCompareMode(next);
    store.totalShards.value = 4567;
    store.undo();

    expect(store.itemCompareMode.value).toBe(before);
    expect(store.totalShards.value).toBe(4567);
  });

  it("スロット並べ替えは選択中スロットと一緒に undo できる", async () => {
    const store = useCalcStore({ locale: ref("ja"), t });
    store.upsertFromBox({ boxId: "slot-a", srcLevel: 10, expType: 600, nature: "normal" });
    store.switchToSlot(1);
    store.upsertFromBox({ boxId: "slot-b", srcLevel: 10, expType: 600, nature: "normal" });
    await nextTick();
    const beforeSlots = store.slots.value.map((slot) => slot?.rows[0]?.boxId);
    const beforeActive = store.activeSlotTab.value;

    store.swapSlots(1, 0);
    store.undo();

    expect(store.slots.value.map((slot) => slot?.rows[0]?.boxId)).toEqual(beforeSlots);
    expect(store.activeSlotTab.value).toBe(beforeActive);
    expect(store.rows.value[0]?.boxId).toBe("slot-b");
  });

  it("undo は3回より多く遡れる", () => {
    const store = makeQuotaStore("5000");
    for (const n of [4, 5, 6]) {
      store.upsertFromBox({ boxId: `quota-${n}`, pokedexId: 24 + n, srcLevel: 10, dstLevelDefault: 40, expType: 600, nature: "normal" });
    }
    expect(store.rows.value.length).toBe(6);

    // 1行ずつ消す。削除は1回ごとに undo を積む
    while (store.rows.value.length > 0) store.removeRowById(store.rows.value[0]!.id);
    expect(store.rows.value.length).toBe(0);

    // 上限が3のままなら、古い3件が押し出されて3行しか戻らない
    for (let i = 0; i < 6; i++) store.undo();
    expect(store.rows.value.length).toBe(6);
  });

  it("既定アメブ目標Lvは行追加とリセットの初期値になり、目標Lvを超えない", () => {
    // 枠が潤沢な状態で見る（枠が足りない行は下の「境界」テストのとおり実投入数へ下がる）
    const store = makeQuotaStore("5000");
    store.setDefaultBoostReachLevel(35);

    store.upsertFromBox({ boxId: "quota-4", pokedexId: 30, srcLevel: 10, dstLevelDefault: 40, expType: 600, nature: "normal" });
    expect(store.rows.value[3]!.boostReachLevel).toBe(35);

    // 目標Lvが既定値より低い行では目標Lvへ収める
    store.upsertFromBox({ boxId: "quota-5", pokedexId: 31, srcLevel: 10, dstLevelDefault: 20, expType: 600, nature: "normal" });
    expect(store.rows.value[4]!.boostReachLevel).toBe(20);

    // 既存行はリセットを通したときだけ効く
    store.resetRowBoostCandy(store.rows.value[0]!.id);
    expect(store.rows.value[0]!.boostReachLevel).toBe(35);
  });

  /**
   * 個数指定があると目標Lvは `(m, n)` の出力なので、**保存値は収めない**（§15.9）。
   * 過大に見えないのは表示側が `min(保存値, 目標Lv, T')` を通すからで、
   * そのクランプを外すと「目標Lv40 の行にアメブ目標Lv60」が出る（2026-07-31 に一度壊した）。
   */
  it("個数指定があってもリセットの既定アメブ目標Lvは目標Lvを超えて見えない", () => {
    const store = useCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind("full");
    store.onBoostCandyRemainingInput("5000");
    store.setDefaultBoostReachLevel(60);
    store.upsertFromBox({ boxId: "reset-with-target", pokedexId: 25, srcLevel: 10, dstLevelDefault: 40, expType: 600, nature: "normal" });
    const id = store.rows.value[0]!.id;
    store.setBoostLevel(id, 30);
    store.onRowCandyTarget(id, "300");

    for (const reset of [() => store.resetRowBoostCandy(id), () => store.resetAllBoostCandy()]) {
      reset();
      const row = store.rows.value.find((r) => r.id === id)!;
      const view = store.rowsView.value.find((r) => r.id === id)!;
      expect(row.candyTarget).toBe(300);
      // **見るのは表示値。** 保存値は意図として収めない（§10.18 / §15.9）ので 60 のまま残る
      expect(view.ui.boostReachLevel).toBeLessThanOrEqual(row.dstLevel);
      expect(view.ui.boostReachLevel).toBeLessThan(60);
    }
  });

  it("アメブ種別を「なし」にした時点でもアメブ目標Lvは既定値へ戻る（§4.9）", () => {
    const store = useCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind("full");
    store.onBoostCandyRemainingInput("5000");
    store.setDefaultBoostReachLevel(60);
    store.upsertFromBox({ boxId: "none-reset", pokedexId: 25, srcLevel: 10, dstLevelDefault: 70, expType: 600, nature: "normal" });
    const id = store.rows.value[0]!.id;
    store.setBoostLevel(id, 30);
    expect(rowOf(store, id).boostReachLevel).toBe(30);

    // 「なし」でもアメブ目標Lvの欄が消えるだけで、保存値は既定値へ戻っている
    store.setSlotBoostKind("none");
    expect(rowOf(store, id).boostReachLevel).toBe(60);
    expect(rowOf(store, id).boostOrExpAdjustment).toBeUndefined();
  });

  it("既定アメブ目標Lvは MAX_LEVEL で頭打ちにし、Lvとして無効な入力は未設定へ倒す", () => {
    const store = makeQuotaStore("5000");

    store.setDefaultBoostReachLevel(999);
    expect(store.defaultBoostReachLevel.value).toBe(MAX_LEVEL);

    // Lv0 は Lv として意味を持たない。空欄と同じ「目標Lvと同じ」へ倒す
    store.setDefaultBoostReachLevel(0);
    expect(store.defaultBoostReachLevel.value).toBeNull();

    store.setDefaultBoostReachLevel(35);
    store.setDefaultBoostReachLevel(null);
    expect(store.defaultBoostReachLevel.value).toBeNull();
  });

  it("元Lvの変更ではアメブ目標Lvを既定値へ戻さない", () => {
    // 元Lv変更は「条件が変わったので個数だけ引き直す」場面。
    // アメブ目標Lvはユーザーの意図なので、リセット操作でないかぎり触らない。
    const store = makeQuotaStore("5000");
    const id = store.rows.value[0]!.id;
    store.setDefaultBoostReachLevel(35);
    store.setBoostLevel(id, 30);
    expect(store.rows.value[0]!.boostReachLevel).toBe(30);

    store.setSrcLevel(id, 12);

    expect(store.rows.value[0]!.boostReachLevel).toBe(30);
  });

  it("アメブ境界の行は個数だけでなくアメブ目標Lvも実投入数の到達点まで下げる", () => {
    // 保存値を目標Lv60のまま残すと、あとで個数が捨てられたとき（元Lv変更など）に
    // 60から導出し直して枠を大きく超える値が復活する。保存値と表示を一致させる。
    const store = makeQuotaStore();
    const [first, boundary, below] = store.rows.value;

    expect(first!.boostReachLevel).toBe(40);
    expect(boundary!.boostReachLevel).toBeGreaterThan(10);
    expect(boundary!.boostReachLevel).toBeLessThan(40);
    expect(below!.boostReachLevel).toBe(10);

    // 表示（個数から逆算）と保存値が一致する
    expect(store.rowsView.value.map((row) => row.ui.boostReachLevel))
      .toEqual(store.rows.value.map((row) => row.boostReachLevel));

    // 個数を捨てる操作（元Lv変更）をしても、枠を超える値は復活しない
    store.setSrcLevel(boundary!.id, 12);
    expect(store.rowsView.value[1]!.ui.boostQuotaViolation).toBeNull();
  });

  it("睡眠目標の設定はアメブ個数をリセットせず、押し下げるだけ", () => {
    const store = makeQuotaStore();
    const id = store.rows.value[1]!.id;
    const before = store.rows.value[1]!.boostOrExpAdjustment;
    expect(before).toBeGreaterThan(0);

    store.setRowSleepTargetHours(id, 1000);

    // 保存値は残る（アメブ目標Lvと同じ扱い。押し下げは実効値で起きる）
    expect(store.rows.value[1]!.boostOrExpAdjustment).toBe(before);
    // 個数指定だけは外れる（前の目標の ceil 余剰EXPを持ち越さないため）
    expect(store.rows.value[1]!.candyTarget).toBeUndefined();
    // 操作していないのに超過扱いにならない
    expect(store.rowsView.value[1]!.ui.boostQuotaViolation).toBeNull();
    expect(store.rowsView.value[1]!.ui.boostCandyInput).toBeLessThanOrEqual(before!);
  });

  it("アメブなしの種別では明示的な0を焼き付けない", () => {
    const store = makeQuotaStore();
    expect(store.rows.value[2]!.boostOrExpAdjustment).toBe(0);

    store.setSlotBoostKind("none");
    expect(store.rows.value.map((row) => row.boostOrExpAdjustment)).toEqual([undefined, undefined, undefined]);

    // full へ戻すと配り直される。種別変更でアメブ上限も既定（3500）へ戻るため全行が満額もらえる
    store.setSlotBoostKind("full");
    expect(store.boostCandyRemaining.value).toBeNull();
    expect(store.rows.value.map((row) => row.boostOrExpAdjustment)).toEqual([undefined, undefined, undefined]);

    // 上限を絞って配り直せば、また境界より下に 0 が入る
    store.onBoostCandyRemainingInput("500");
    store.resetAllBoostCandy();
    expect(store.rows.value[0]!.boostOrExpAdjustment).toBeUndefined();
    expect(store.rows.value[2]!.boostOrExpAdjustment).toBe(0);
  });

  /**
   * §11.4-B。元の不具合は「往復のたびに値が変わり続ける（収束しない）」ことだった。
   *
   * **アメブ種別が変われば 1個あたりのEXPが変わるので、アメブは既定値で計算し直す**
   * （§4.11 / 2026-07-31 ユーザー規則）。持ち越すのは個数指定だけで、アメブ目標Lvと
   * アメブ個数は戻らない。**固定するのは「1往復で収束し、以後は動かない」こと。**
   */
  it("アメブ種別 full→none→full ではアメブを既定値で計算し直し、以後は動かない（§11.4-B）", () => {
    const { store, id } = makeStore();
    store.setSlotBoostKind("full");
    store.setDstLevel(id, 40);
    store.onRowCandyTarget(id, "300");

    store.setSlotBoostKind("none");
    store.setSlotBoostKind("full");
    const first = { ...rowOf(store, id) };

    // 個数指定は持ち越す。アメブ個数は導出へ戻る
    expect(first.candyTarget).toBe(300);
    expect(first.boostOrExpAdjustment).toBeUndefined();

    // 2往復目以降は1ミリも動かない（発散しない）
    for (let i = 0; i < 3; i++) {
      store.setSlotBoostKind("none");
      store.setSlotBoostKind("full");
      expect(rowOf(store, id)).toEqual(first);
    }
    // mini 経由でも同じ地点へ収束する（種別ごとに別の値が焼き付かない）
    store.setSlotBoostKind("mini");
    store.setSlotBoostKind("full");
    expect(rowOf(store, id)).toEqual(first);
  });

  it("上位行の明示アメブ変更後に同じ上限を再確定しても下位行を壊さない（§11.4-C）", () => {
    const { store, id } = makeStore();
    store.onBoostCandyRemainingInput("400");
    store.upsertFromBox({ boxId: "box-lower", pokedexId: 26, srcLevel: 10, dstLevelDefault: 40, expType: 600, nature: "normal" });
    const lowerId = store.rows.value[1]!.id;
    store.onRowCandyTarget(lowerId, "300");
    store.onRowBoostCandy(id, "390");
    const lowerBefore = { ...rowOf(store, lowerId) };

    store.onBoostCandyRemainingInput("400");

    expect(rowOf(store, lowerId)).toEqual(lowerBefore);
  });

  it("アメブ上限を途中桁で渡しても最終700の状態は直接入力と一致する（§11.5）", () => {
    const direct = makeStore();
    direct.store.onBoostCandyRemainingInput("700");

    const typed = makeStore();
    typed.store.onBoostCandyRemainingInput("7");
    typed.store.onBoostCandyRemainingInput("70");
    typed.store.onBoostCandyRemainingInput("700");

    expect(typed.store.rows.value.map(({ id: _id, ...row }) => row))
      .toEqual(direct.store.rows.value.map(({ id: _id, ...row }) => row));
    expect(typed.store.rowsView.value.map((row) => row.ui.boostCandyInput))
      .toEqual(direct.store.rowsView.value.map((row) => row.ui.boostCandyInput));
  });

  it("目標Lv 59→60→59 の往復で明示アメブ400を削らない（§11.8-d）", () => {
    const { store, id } = makeStore();
    store.setSlotBoostKind("full");
    store.setDstLevel(id, 59);
    store.onRowBoostCandy(id, "400");
    expect(rowOf(store, id).boostOrExpAdjustment).toBe(400);

    store.setDstLevel(id, 60);
    store.setDstLevel(id, 59);

    expect(rowOf(store, id).boostOrExpAdjustment).toBe(400);
  });

  it("グローバル睡眠設定の変更でも個数指定があるときの最終目標が追従する（§11.10）", () => {
    const { store, id } = makeStore();
    store.setRowSleepTargetHours(id, 1000);
    store.onRowCandyTarget(id, "300");
    const before = { ...rowOf(store, id) };

    store.updateSleepSettings({ sleepExpBonusCount: 5 });
    const after = rowOf(store, id);

    expect(after.candyTarget).toBe(300);
    expect(after.dstLevel > before.dstLevel
      || (after.dstLevel === before.dstLevel && (after.dstExpInLevel ?? 0) > (before.dstExpInLevel ?? 0))).toBe(true);
  });

  it("個数指定なし→必要数→空欄で目標Lv・あとEXP・アメ合計が変わらない（§10.1）", () => {
    const { store, id } = makeStore();
    const beforeRow = { ...rowOf(store, id) };
    const beforeView = store.rowsView.value.find((row) => row.id === id)!;
    const needed = minCandyForTarget({
      srcLevel: beforeRow.srcLevel,
      targetLevel: beforeRow.dstLevel,
      targetExpInLevel: beforeRow.dstExpInLevel,
      expType: beforeRow.expType,
      nature: beforeRow.nature,
      boostKind: store.boostKind.value,
      boostCandy: beforeView.ui.boostCandyInput,
      expGot: 0,
    });
    const snap = () => {
      const row = rowOf(store, id);
      const view = store.rowsView.value.find((item) => item.id === id)!;
      return {
        dstLevel: row.dstLevel,
        targetExpToNextLevel: view.targetExpToNextLevel,
        totalCandy: minCandyForTarget({
          srcLevel: row.srcLevel,
          targetLevel: row.dstLevel,
          targetExpInLevel: row.dstExpInLevel,
          expType: row.expType,
          nature: row.nature,
          boostKind: store.boostKind.value,
          boostCandy: view.ui.boostCandyInput,
          expGot: 0,
        }),
      };
    };
    const baseline = snap();

    store.onRowCandyTarget(id, String(needed));
    expect(snap()).toEqual(baseline);
    store.onRowCandyTarget(id, "");
    expect(snap()).toEqual(baseline);
  });

});

describe("useCalcStore: すべて睡眠", () => {
  beforeEach(() => {
    cancelPersist();
    installLocalStorageMock();
  });

  afterEach(() => {
    cancelPersist();
  });

  const t = ((key: string) => key) as unknown as Composer["t"];

  function addRows(count = 3) {
    const store = useCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind("full");
    store.onBoostCandyRemainingInput("500");
    for (let index = 0; index < count; index++) {
      store.upsertFromBox({
        boxId: `all-sleep-${index}`,
        pokedexId: [25, 133, 152][index]!,
        srcLevel: 10,
        dstLevelDefault: 40,
        expType: 600,
        nature: "normal",
      });
    }
    return store;
  }

  function plannerInputFor(store: ReturnType<typeof useCalcStore>, plentiful: boolean) {
    return buildLevelPlannerInput(store.rowsView.value.map((row) => ({
      id: row.id,
      pokedexId: row.pokedexId,
      title: row.title,
      pokemonType: row.pokemonType,
      srcLevel: row.srcLevel,
      dstLevel: row.dstLevel,
      dstExpInLevel: row.dstExpInLevel,
      expRemaining: row.expRemaining,
      expType: row.expType,
      nature: row.nature,
      boostReachLevel: row.boostReachLevel,
      candyTarget: row.candyTarget,
      boostCandyInput: row.ui.boostCandyInput,
      sleepExp: 0,
      sleepTargetMode: row.sleepTargetMode,
    })), {
      candyInventory: {
        species: plentiful ? { "25": 10_000, "133": 10_000, "152": 10_000 } : {},
        typeCandy: {},
        universal: { s: 0, m: 0, l: 0 },
      },
      dreamShards: plentiful ? 10_000_000 : 0,
      boost: { kind: store.boostKind.value, limit: 500 },
      itemCompareMode: "surplusFirst",
    })!;
  }

  it.each([
    { modeIndex: 0, plentiful: true },
    { modeIndex: 1, plentiful: true },
    { modeIndex: 0, plentiful: false },
    { modeIndex: 1, plentiful: false },
  ])("§13-1A: 休眠アメブ値が planner 結果と下位行の枠を変えない ($modeIndex, plentiful=$plentiful)", ({ modeIndex, plentiful }) => {
    const store = addRows();
    const modeId = store.rows.value[modeIndex]!.id;
    store.setRowSleepTarget(modeId, "all");
    store.resetAllBoostCandy();
    const stableRows = JSON.parse(JSON.stringify(store.rows.value)) as CalcRow[];
    const results = [undefined, 0, 10_000].map((dormant) => {
      store.rows.value = stableRows.map((row) => row.id === modeId
        ? { ...row, boostOrExpAdjustment: dormant }
        : { ...row });
      const views = store.rowsView.value;
      expect(views[modeIndex]!.ui.boostCandyInput).toBe(0);
      const input = plannerInputFor(store, plentiful);
      expect(input.pokemonList[modeIndex]).toMatchObject({
        requestedBoostCandy: 0,
        candyTarget: { totalCandyUnits: 0, boostedCandyUnits: 0 },
      });
      const outcome = solveLevelPlanWithBudget(input, { deadlineMs: 60_000 });
      expect(outcome.kind).toBe("result");
      if (outcome.kind !== "result") throw new Error("planner did not finish");
      return {
        lowerBoost: views.slice(modeIndex + 1).map(row => row.ui.boostCandyInput),
        result: { ...outcome.result, performance: undefined },
      };
    });
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  function makeAllocationPair() {
    const withMode = addRows(3);
    const modeId = withMode.rows.value[0]!.id;
    withMode.setRowSleepTarget(modeId, "all");
    withMode.resetAllBoostCandy();

    const control = useCalcStore({ locale: ref("ja"), t });
    control.setSlotBoostKind("full");
    control.onBoostCandyRemainingInput("500");
    for (let index = 1; index < 3; index++) {
      control.upsertFromBox({
        boxId: `control-${index}`,
        pokedexId: [25, 133, 152][index]!,
        srcLevel: 10,
        dstLevelDefault: 40,
        expType: 600,
        nature: "normal",
      });
    }
    control.resetAllBoostCandy();
    return { withMode, control, modeId };
  }

  function expectModeConsumesNoQuota(
    withMode: ReturnType<typeof useCalcStore>,
    control: ReturnType<typeof useCalcStore>,
    modeId: string,
  ) {
    expect(withMode.rows.value[0]!.sleepTargetMode).toBe("all");
    expect(withMode.rowsView.value[0]!.ui.boostCandyInput).toBe(0);
    expect(withMode.rowsView.value.slice(1).map(row => row.ui.boostCandyInput))
      .toEqual(control.rowsView.value.map(row => row.ui.boostCandyInput));
    expect(plannerInputFor(withMode, true).pokemonList.find(row => row.pokemonId === modeId)?.requestedBoostCandy).toBe(0);
  }

  it("§13-1c: 全体リセットとアメブ種別変更でモード行へ付与せず、下段へ対照と同数を配る", () => {
    const { withMode, control, modeId } = makeAllocationPair();
    withMode.rows.value[0] = {
      ...withMode.rows.value[0]!,
      boostOrExpAdjustment: 347,
      boostReachLevel: 20,
    };
    withMode.resetAllBoostCandy();
    control.resetAllBoostCandy();
    expect(withMode.rows.value[0]!.boostOrExpAdjustment).toBeUndefined();
    expect(withMode.rows.value[0]!.boostReachLevel).toBe(40);
    expectModeConsumesNoQuota(withMode, control, modeId);

    for (const kind of ["mini", "none", "full"] as const) {
      withMode.setSlotBoostKind(kind);
      control.setSlotBoostKind(kind);
      expect(withMode.rows.value[0]!.boostOrExpAdjustment).toBeUndefined();
      expect(withMode.rows.value[0]!.boostReachLevel).toBe(40);
      expectModeConsumesNoQuota(withMode, control, modeId);
    }
  });

  it("§13-1c: 現在Lv変更とボックス同期ではモードを保ち、アメブ目標Lvを維持して下段枠を奪わない", () => {
    const currentLevelPair = makeAllocationPair();
    currentLevelPair.withMode.rows.value[0] = {
      ...currentLevelPair.withMode.rows.value[0]!,
      boostOrExpAdjustment: 347,
      boostReachLevel: 35,
    };
    currentLevelPair.withMode.setSrcLevel(currentLevelPair.modeId, 15);
    expect(currentLevelPair.withMode.rows.value[0]!.boostOrExpAdjustment).toBeUndefined();
    expect(currentLevelPair.withMode.rows.value[0]!.boostReachLevel).toBe(35);
    expectModeConsumesNoQuota(currentLevelPair.withMode, currentLevelPair.control, currentLevelPair.modeId);

    const syncPair = makeAllocationPair();
    syncPair.withMode.rows.value[0] = {
      ...syncPair.withMode.rows.value[0]!,
      boostOrExpAdjustment: 347,
      boostReachLevel: 35,
    };
    syncPair.withMode.upsertFromBox({
      boxId: "all-sleep-0",
      pokedexId: 25,
      srcLevel: 15,
      dstLevelDefault: 40,
      expType: 600,
      nature: "normal",
    });
    expect(syncPair.withMode.rows.value[0]!.boostOrExpAdjustment).toBeUndefined();
    expect(syncPair.withMode.rows.value[0]!.boostReachLevel).toBe(35);
    expectModeConsumesNoQuota(syncPair.withMode, syncPair.control, syncPair.modeId);
  });

  it("§13-2: モード中は休眠値を保持し、OFF時の遅延リセットで目標Lvを再上昇させない", () => {
    const store = addRows(1);
    const id = store.rows.value[0]!.id;
    store.setDstLevel(id, 60);
    store.setBoostLevel(id, 60);
    const row = store.rows.value[0]!;
    const boostCount = minBoostForTarget({
      srcLevel: row.srcLevel,
      targetLevel: 60,
      targetExpInLevel: 0,
      expType: row.expType,
      nature: row.nature,
      boostKind: store.boostKind.value,
      maxBoost: Number.MAX_SAFE_INTEGER,
      expGot: 0,
    });
    store.onRowBoostCandy(id, String(boostCount));
    const dormant = {
      boostReachLevel: store.rows.value[0]!.boostReachLevel,
      boostOrExpAdjustment: store.rows.value[0]!.boostOrExpAdjustment,
    };

    store.setRowSleepTarget(id, "all");
    store.setDstLevel(id, 55);
    expect(store.rows.value[0]).toMatchObject({
      sleepTargetMode: "all",
      dstLevel: 55,
      ...dormant,
    });

    store.setRowSleepTarget(id, undefined);
    expect(store.rows.value[0]!.sleepTargetMode).toBeUndefined();
    expect(store.rows.value[0]!.dstLevel).toBe(55);
    expect(store.rows.value[0]!.boostReachLevel).toBe(55);
    expect(store.rows.value[0]!.boostOrExpAdjustment).toBeUndefined();
  });

  it("§2.10: モード中はストアAPIからアメ3入力と行リセットを変更できない", () => {
    const store = addRows(1);
    const id = store.rows.value[0]!.id;
    store.onRowBoostCandy(id, "25");
    store.setRowSleepTarget(id, "all");
    const before = JSON.parse(JSON.stringify(store.rows.value[0])) as CalcRow;

    store.onRowCandyTarget(id, "100");
    store.onRowBoostCandy(id, "50");
    store.setBoostLevel(id, 30);
    store.resetRowBoostCandy(id);

    expect(store.rows.value[0]).toEqual(before);
  });

  it("アメ在庫＋睡眠: 4状態として排他になり、個数指定だけが失効してアメブは残る", () => {
    const store = addRows(1);
    const id = store.rows.value[0]!.id;
    store.updateSpeciesCandy(25, 100);
    store.onRowBoostCandy(id, "25");
    const dormant = store.rows.value[0]!.boostOrExpAdjustment;
    store.onRowCandyTarget(id, "40");
    expect(store.rows.value[0]!.candyTarget).toBe(40);

    store.setRowSleepTarget(id, "stock");
    expect(store.rows.value[0]).toMatchObject({
      sleepTargetMode: "stock",
      sleepTargetHours: undefined,
      // 個数指定は在庫が決めるので失効する（操作仕様§4.7）
      candyTarget: undefined,
      // stock も Lv ちょうど宣言なので、Lv内EXPは正規形の未設定へ戻す
      dstExpInLevel: undefined,
      // アメブは使えるので保存値も残る
      boostOrExpAdjustment: dormant,
    });

    // 個数指定はストアAPIからも受け付けない
    store.onRowCandyTarget(id, "100");
    expect(store.rows.value[0]!.candyTarget).toBeUndefined();

    // アメブは操作できる（睡眠EXPが 0 なので睡眠側の上限はかからない）。
    // ただし使えるアメは在庫までなので、在庫を入れてから操作する（在庫0の行は下のテストを参照）。
    store.onRowBoostCandy(id, "30");
    expect(store.rows.value[0]!.boostOrExpAdjustment).toBe(30);

    store.setRowSleepTarget(id, 1000);
    expect(store.rows.value[0]!.sleepTargetMode).toBeUndefined();
    expect(store.rows.value[0]!.sleepTargetHours).toBe(1000);
    store.setRowSleepTarget(id, "stock");
    expect(store.rows.value[0]!.sleepTargetHours).toBeUndefined();
    store.undo();
    expect(store.rows.value[0]!.sleepTargetHours).toBe(1000);
    store.redo();
    expect(store.rows.value[0]!.sleepTargetMode).toBe("stock");
  });

  it("アメ在庫＋睡眠: 正規化の防御層が個数指定とLv内EXPを破棄する", () => {
    const store = addRows(1);
    const id = store.rows.value[0]!.id;
    store.setRowSleepTarget(id, "stock");

    // 永続化データや将来の呼び出しから不正なanchorが入った状態を再現する。
    Object.assign(store.rows.value[0]!, { candyTarget: 40, dstExpInLevel: 123 });
    store.setNature(id, "up");

    expect(store.rows.value[0]!.candyTarget).toBeUndefined();
    expect(store.rows.value[0]!.dstExpInLevel).toBeUndefined();
  });

  it("アメ在庫＋睡眠: 使うアメ数は min(在庫, 目標に要る数) で、同系統は上の行から順に取る", () => {
    const candyStore = useCandyStore();
    const original = candyStore.getInventory();
    candyStore.resetInventory();
    try {
      const store = useCalcStore({ locale: ref("ja"), t });
      store.setSlotBoostKind("none");
      // 26 は 25 と同じ系統なので、種族アメ在庫を取り合う。
      store.upsertFromBox({ boxId: "upper", pokedexId: 25, srcLevel: 10, dstLevelDefault: 30, expType: 600, nature: "normal" });
      store.upsertFromBox({ boxId: "lower", pokedexId: 26, srcLevel: 10, dstLevelDefault: 30, expType: 600, nature: "normal" });
      const [upper, lower] = store.rows.value.map((row) => row.id);
      store.setRowSleepTarget(upper!, "stock");
      store.setRowSleepTarget(lower!, "stock");

      // 在庫が足りないときは上の行が取り切り、下の行へは回らない
      store.updateSpeciesCandy(25, 20);
      expect(store.rowStockCandyTargetFor(upper!)).toBe(20);
      expect(store.rowStockCandyTargetFor(lower!)).toBe(0);

      // 在庫が余るときは使い切らない。上が必要ぶんだけ取るので、下にも同じだけ回る
      store.updateSpeciesCandy(25, 100_000);
      const need = store.rowStockCandyTargetFor(upper!)!;
      expect(need).toBeGreaterThan(0);
      expect(need).toBeLessThan(100_000);
      expect(store.rowStockCandyTargetFor(lower!)).toBe(need);

      // 「アメ在庫＋睡眠」でない行は対象外
      store.setRowSleepTarget(lower!, undefined);
      expect(store.rowStockCandyTargetFor(lower!)).toBeUndefined();
    } finally {
      candyStore.restoreInventory(original);
    }
  });

  /**
   * 「アメ在庫＋睡眠」の行が使えるアメは在庫まで。アメブはその内数（`n ≤ m`）なので、
   * **入力欄の上限も在庫で止める**（2026-08-25 ユーザー指摘）。
   *
   * 以前は MAX_LEVEL 基準の上限しか見ていなかったため、在庫256の行に400と入力でき、
   * 欄は400のまま結果だけ256になった（`resolveEffectiveBoostCandy` が実効値だけを絞るため）。
   */
  it("アメ在庫＋睡眠: 在庫減少は保存値を変えず、実効値・max・警告だけを半ロックする", () => {
    const candyStore = useCandyStore();
    const original = candyStore.getInventory();
    candyStore.resetInventory();
    try {
      const store = useCalcStore({ locale: ref("ja"), t });
      store.setSlotBoostKind("full");
      store.onBoostCandyRemainingInput("500");
      store.upsertFromBox({ boxId: "stock-cap", pokedexId: 25, srcLevel: 10, dstLevelDefault: 40, expType: 600, nature: "normal" });
      const id = store.rows.value[0]!.id;
      store.setDstLevel(id, 70);
      store.updateSpeciesCandy(25, 350);
      store.setRowSleepTarget(id, "stock");
      const ui = () => store.rowsView.value.find((row) => row.id === id)!.ui;
      store.onRowBoostCandy(id, "300");
      expect(store.rows.value[0]!.boostOrExpAdjustment).toBe(300);

      store.updateSpeciesCandy(25, 250);
      expect(store.rows.value[0]!.boostOrExpAdjustment).toBe(300);
      expect(ui().boostCandyInput).toBe(250);
      expect(ui().boostCandyInputMax).toBe(250);
      expect(ui().boostCapActive).toBe(true);
      expect(ui().boostCapKind).toBe("stock");
      expect(ui().boostSleepCapped).toBe(false);
      expect(ui().boostInputDisabled).toBe(false);

      // アメブ目標Lvは個数と同じ在庫上限を使うが、個数と違って超過値をクランプせず拒否する。
      const savedReachLevel = store.rows.value[0]!.boostReachLevel;
      store.setBoostLevel(id, ui().boostReachLevelMax + 1);
      expect(store.rows.value[0]!.boostReachLevel).toBe(savedReachLevel);

      // 上限超過中の下方向スピン相当も、大きい直接入力も在庫上限へ収束する。
      store.onRowBoostCandy(id, "299");
      expect(store.rows.value[0]!.boostOrExpAdjustment).toBe(250);
      store.onRowBoostCandy(id, "999");
      expect(store.rows.value[0]!.boostOrExpAdjustment).toBe(250);
    } finally {
      candyStore.restoreInventory(original);
    }
  });

  it("アメ在庫＋睡眠: 在庫が潤沢なら警告せず、アメブ目標Lvから目標Lvも上げられる", () => {
    const candyStore = useCandyStore();
    const original = candyStore.getInventory();
    candyStore.resetInventory();
    try {
      const store = useCalcStore({ locale: ref("ja"), t });
      store.setSlotBoostKind("full");
      store.onBoostCandyRemainingInput("500");
      store.upsertFromBox({ boxId: "stock-plenty", pokedexId: 25, srcLevel: 10, dstLevelDefault: 30, expType: 600, nature: "normal" });
      const id = store.rows.value[0]!.id;
      store.updateSpeciesCandy(25, 100_000);
      store.setRowSleepTarget(id, "stock");

      expect(store.rowStockCandyTargetFor(id)).toBeLessThan(100_000);
      expect(store.rowStockCandyAvailableFor(id)).toBe(100_000);
      expect(store.rowsView.value[0]!.ui.boostReachLevelMax).toBe(MAX_LEVEL);
      expect(store.rowsView.value[0]!.ui.boostCapActive).toBe(false);
      expect(store.rowsView.value[0]!.ui.boostCapKind).toBeNull();

      store.setBoostLevel(id, 45);
      expect(store.rows.value[0]!.boostReachLevel).toBe(45);
      expect(store.rows.value[0]!.dstLevel).toBe(45);
    } finally {
      candyStore.restoreInventory(original);
    }
  });

  it("アメ在庫＋睡眠: 利用可能在庫が需要ちょうどなら上限が効く", () => {
    const candyStore = useCandyStore();
    const original = candyStore.getInventory();
    candyStore.resetInventory();
    try {
      const store = useCalcStore({ locale: ref("ja"), t });
      store.setSlotBoostKind("full");
      store.onBoostCandyRemainingInput("500");
      store.upsertFromBox({ boxId: "stock-exact", pokedexId: 25, srcLevel: 10, dstLevelDefault: 30, expType: 600, nature: "normal" });
      const id = store.rows.value[0]!.id;
      store.updateSpeciesCandy(25, 100_000);
      store.setRowSleepTarget(id, "stock");
      const exactNeed = store.rowStockCandyTargetFor(id)!;

      store.updateSpeciesCandy(25, exactNeed);
      const ui = store.rowsView.value[0]!.ui;
      expect(store.rowStockCandyAvailableFor(id)).toBe(exactNeed);
      expect(ui.boostCapActive).toBe(true);
      expect(ui.boostCapKind).toBe("stock");
      const before = { ...store.rows.value[0]! };
      store.setBoostLevel(id, ui.boostReachLevelMax + 1);
      expect(store.rows.value[0]!.boostReachLevel).toBe(before.boostReachLevel);
      expect(store.rows.value[0]!.dstLevel).toBe(before.dstLevel);
    } finally {
      candyStore.restoreInventory(original);
    }
  });

  it("アメ在庫＋睡眠: 在庫0でも欄を無効化せず、入力は明示0へクランプする", () => {
    const candyStore = useCandyStore();
    const original = candyStore.getInventory();
    candyStore.resetInventory();
    try {
      const store = useCalcStore({ locale: ref("ja"), t });
      store.setSlotBoostKind("full");
      store.onBoostCandyRemainingInput("500");
      store.upsertFromBox({ boxId: "stock-zero", pokedexId: 25, srcLevel: 10, dstLevelDefault: 40, expType: 600, nature: "normal" });
      const id = store.rows.value[0]!.id;
      store.updateSpeciesCandy(25, 0);
      store.setRowSleepTarget(id, "stock");
      expect(store.rowsView.value[0]!.ui.boostInputDisabled).toBe(false);
      expect(store.rowsView.value[0]!.ui.boostCandyInputMax).toBe(0);

      store.onRowBoostCandy(id, "10");
      expect(store.rows.value[0]!.boostOrExpAdjustment).toBe(0);
      store.setRowSleepTarget(id, undefined);
      expect(store.rows.value[0]!.boostOrExpAdjustment).toBe(0);
    } finally {
      candyStore.restoreInventory(original);
    }
  });

  it("アメ在庫＋睡眠: m を解決できない行を在庫0扱いせず、上限も警告も付けない", () => {
    const candyStore = useCandyStore();
    const original = candyStore.getInventory();
    candyStore.resetInventory();
    try {
      const store = useCalcStore({ locale: ref("ja"), t });
      store.setSlotBoostKind("full");
      store.onBoostCandyRemainingInput("500");
      store.upsertFromBox({ boxId: "dangling-stock", srcLevel: 10, dstLevelDefault: 40, expType: 600, nature: "normal" });
      const id = store.rows.value[0]!.id;
      store.onRowBoostCandy(id, "10");
      store.setRowSleepTarget(id, "stock");

      expect(store.rowStockCandyTargetFor(id)).toBeUndefined();
      expect(store.rows.value[0]!.boostOrExpAdjustment).toBe(10);
      expect(store.rowsView.value[0]!.ui.boostCandyInput).toBe(10);
      expect(store.rowsView.value[0]!.ui.boostCandyInputMax).toBeGreaterThan(0);
      expect(store.rowsView.value[0]!.ui.boostInputDisabled).toBe(false);
      expect(store.rowsView.value[0]!.ui.boostCapActive).toBe(false);
      expect(store.rowsView.value[0]!.ui.boostCapKind).toBeNull();
    } finally {
      candyStore.restoreInventory(original);
    }
  });

  it("アメ在庫＋睡眠: 在庫変更の undo は在庫だけを戻し、保存したアメブ個数には触れない", () => {
    const candyStore = useCandyStore();
    const original = candyStore.getInventory();
    candyStore.resetInventory();
    try {
      const store = useCalcStore({ locale: ref("ja"), t });
      store.setSlotBoostKind("full");
      store.onBoostCandyRemainingInput("500");
      store.upsertFromBox({ boxId: "stock-undo", pokedexId: 25, srcLevel: 10, dstLevelDefault: 40, expType: 600, nature: "normal" });
      const id = store.rows.value[0]!.id;
      store.setDstLevel(id, 70);
      store.updateSpeciesCandy(25, 350);
      store.setRowSleepTarget(id, "stock");
      store.onRowBoostCandy(id, "300");

      store.updateSpeciesCandy(25, 250);
      expect(store.rows.value[0]!.boostOrExpAdjustment).toBe(300);
      expect(store.rowsView.value[0]!.ui.boostCandyInput).toBe(250);

      store.undo();
      expect(candyStore.getSpeciesCandyFor(25)).toBe(350);
      expect(store.rows.value[0]!.boostOrExpAdjustment).toBe(300);
    } finally {
      candyStore.restoreInventory(original);
    }

  });

  it("アメ在庫＋睡眠: 実効アメブ個数は在庫から回るアメ数を超えない", () => {
    const store = addRows(1);
    const id = store.rows.value[0]!.id;
    const pokedexId = store.rows.value[0]!.pokedexId!;
    store.updateSpeciesCandy(pokedexId, 12);

    // 睡眠目標なしの行では、目標Lv40 まで賄うぶんのアメブが導出される（在庫では抑えない）。
    const withoutMode = store.rowsView.value[0]!.ui.boostCandyInput;
    expect(withoutMode).toBeGreaterThan(12);

    store.setRowSleepTarget(id, "stock");
    // アメブは総アメ数の内数。使えるアメが12個なら、アメブも12個を超えない。
    expect(store.rowsView.value[0]!.ui.boostCandyInput).toBe(12);

    store.updateSpeciesCandy(pokedexId, 0);
    expect(store.rowsView.value[0]!.ui.boostCandyInput).toBe(0);
  });

  it("アメ在庫＋睡眠: すべて睡眠から切り替えるとアメブ目標Lvが目標Lv以下へ戻る", () => {
    const store = addRows(1);
    const id = store.rows.value[0]!.id;
    store.setDstLevel(id, 60);
    store.setBoostLevel(id, 60);
    store.setRowSleepTarget(id, "all");
    store.setDstLevel(id, 40);
    // すべて睡眠の間はアメブ目標Lvを目標Lv変更で動かさない（操作仕様§4.7）
    expect(store.rows.value[0]!.boostReachLevel).toBe(60);

    store.setRowSleepTarget(id, "stock");
    expect(store.rows.value[0]!.sleepTargetMode).toBe("stock");
    expect(store.rows.value[0]!.boostReachLevel).toBe(40);
  });

  it("§13-2/3: 3状態の切替・undo/redo・スロットコピーで排他と休眠値を保つ", () => {
    const store = addRows(1);
    const id = store.rows.value[0]!.id;
    store.onRowBoostCandy(id, "25");
    const dormant = store.rows.value[0]!.boostOrExpAdjustment;

    store.setRowSleepTarget(id, "all");
    expect(store.rows.value[0]).toMatchObject({
      sleepTargetMode: "all",
      sleepTargetHours: undefined,
      candyTarget: undefined,
      boostOrExpAdjustment: dormant,
    });
    store.undo();
    expect(store.rows.value[0]!.sleepTargetMode).toBeUndefined();
    store.redo();
    expect(store.rows.value[0]!.sleepTargetMode).toBe("all");
    expect(store.rows.value[0]!.boostOrExpAdjustment).toBe(dormant);

    store.setRowSleepTarget(id, 1000);
    expect(store.rows.value[0]!.sleepTargetMode).toBeUndefined();
    expect(store.rows.value[0]!.sleepTargetHours).toBe(1000);
    store.setRowSleepTarget(id, "all");
    expect(store.rows.value[0]!.sleepTargetHours).toBeUndefined();

    store.copySlot();
    store.switchToSlot(1);
    store.pasteSlot();
    expect(store.rows.value[0]).toMatchObject({
      sleepTargetMode: "all",
      boostOrExpAdjustment: dormant,
    });
    expect(store.rows.value[0]!.sleepTargetHours).toBeUndefined();
  });


});

describe("useCalcStore: ボーナス内訳の日数・睡眠スコア", () => {
  beforeEach(() => {
    cancelPersist();
    installLocalStorageMock();
  });

  afterEach(() => {
    cancelPersist();
  });

  const t = ((key: string) => key) as unknown as Composer["t"];

  // planResult は debounce + Worker で後から入る。入るまでは内訳も空なので待つ。
  async function makeSleepRow(opts: {
    dstLevelDefault: number;
    expRemaining?: number;
    currentGameDate?: GameDate;
  }) {
    const store = useCalcStore({
      locale: ref("ja"),
      t,
      currentGameDate: opts.currentGameDate,
    });
    store.upsertFromBox({
      boxId: "bonus-days",
      pokedexId: 25,
      srcLevel: 10,
      dstLevelDefault: opts.dstLevelDefault,
      expType: 600,
      nature: "normal",
      expRemaining: opts.expRemaining,
    });
    const id = store.rows.value[0]!.id;
    store.setRowSleepTarget(id, "all");
    await vi.waitFor(() => {
      expect(store.planResult.value?.pokemonResults).toHaveLength(1);
    }, { timeout: 10_000 });
    return { store, id };
  }

  it("1回の睡眠は日別だけを返す（種類別は作らない）", async () => {
    const { store, id } = await makeSleepRow({ dstLevelDefault: 11, expRemaining: 50 });
    const breakdown = store.rowSleepBonusBreakdownFor(id);

    expect(breakdown.contributions).toEqual([]);
    expect(breakdown.nights).toHaveLength(1);
    expect(breakdown.nights[0]!.minutes).toBeGreaterThan(0);
    // 素EXPと総額の両方を持つ（画面では「114＋28EXP」と分けて出す）。
    expect(breakdown.nights[0]!.baseExp).toBeGreaterThan(0);
    expect(breakdown.nights[0]!.exp).toBeGreaterThanOrEqual(breakdown.nights[0]!.baseExp);
  });

  it("4晩以上かかる長期計画は種類別だけを返す", async () => {
    const { store, id } = await makeSleepRow({ dstLevelDefault: 40 });
    const breakdown = store.rowSleepBonusBreakdownFor(id);

    expect(breakdown.contributions.length).toBeGreaterThan(0);
    // 先頭は素EXPの行。全睡眠日が対象なので必ず2日以上になる
    expect(breakdown.contributions[0]!.days).toBeGreaterThan(1);
    expect(breakdown.nights).toEqual([]);
  });

  it("2～3晩の正確計画は日付順の日別だけを返す", async () => {
    const { store, id } = await makeSleepRow({
      dstLevelDefault: 11,
      expRemaining: 250,
      // GSD・イベントの無い平常日に固定し、実時刻の満月×3で1晩へ縮まないようにする。
      currentGameDate: "2026-09-29" as GameDate,
    });
    const breakdown = store.rowSleepBonusBreakdownFor(id);

    expect(breakdown.contributions).toEqual([]);
    expect(breakdown.nights).toHaveLength(3);
    expect(breakdown.nights.map((night) => night.date)).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
    ]);
    expect(breakdown.nights.reduce((sum, night) => sum + night.score, 0)).toBe(250);
    // 先行の晩は設定どおりの睡眠時間、最後の晩だけ短い。
    expect(breakdown.nights.map((night) => night.minutes)).toEqual([510, 510, 253]);
  });

  it("睡眠計画の無い行は空で返す", () => {
    const store = useCalcStore({ locale: ref("ja"), t });
    store.upsertFromBox({
      boxId: "bonus-days-none",
      pokedexId: 25,
      srcLevel: 10,
      dstLevelDefault: 40,
      expType: 600,
      nature: "normal",
    });
    const id = store.rows.value[0]!.id;

    expect(store.rowSleepBonusBreakdownFor(id)).toEqual({
      contributions: [],
      nights: [],
    });
  });

});
