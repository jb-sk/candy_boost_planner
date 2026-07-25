import { watch } from 'vue';
import type { BoostEvent, ExpGainNature } from '../domain/types';
import { calcExp, calcExpAndCandy, calcExpAndCandyMixed, calcLevelByCandy } from '../domain/pokesleep';
import { minBoostForTarget } from '../domain/pokesleep/minBoostForTarget';
import { calcCandyTargetFromSleepExp, markForSleep } from '../domain/pokesleep/sleep-growth';
import { maxLevel as MAX_LEVEL } from '../domain/pokesleep/tables';
import { deriveCandyEndpoint } from '../domain/level-planner/deriveCandyEndpoint';
import {
  pruneExactLevelTargets,
  setExactLevelTarget,
  type ExactLevelTarget,
} from '../domain/level-planner/exactTargetRegistry';
import {
  useCalcStore as useBaseCalcStore,
  type CalcRow,
  type CalcStore,
} from './useCalcStore';

export type { CalcRow, CalcRowView, CalcStore } from './useCalcStore';

type StoreOptions = Parameters<typeof useBaseCalcStore>[0];
type Point = { level: number; expInLevel: number };
type TargetSnapshot = { row: CalcRow; target: Point };

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  const n = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * 既存の大きな store の公開 API を保ったまま、正確な最終目標の不変条件を一か所で補強する。
 * 最終目標は CalcRowV1.dstLevel + dstExpInLevel が唯一の保存値であり、planner には
 * exactTargetRegistry を介して同じ地点を渡す。
 */
export function useCalcStore(opts: StoreOptions): CalcStore {
  const calc = useBaseCalcStore(opts);

  const base = {
    updateSleepSettings: calc.updateSleepSettings,
    setSlotBoostKind: calc.setSlotBoostKind,
    onBoostCandyRemainingInput: calc.onBoostCandyRemainingInput,
    resetBoostCandyRemaining: calc.resetBoostCandyRemaining,
    setDstLevel: calc.setDstLevel,
    setSrcLevel: calc.setSrcLevel,
    setBoostLevel: calc.setBoostLevel,
    onRowExpRemaining: calc.onRowExpRemaining,
    onRowNature: calc.onRowNature,
    onRowCandyTarget: calc.onRowCandyTarget,
    onRowBoostCandy: calc.onRowBoostCandy,
    resetRowBoostCandy: calc.resetRowBoostCandy,
    setRowSleepTargetHours: calc.setRowSleepTargetHours,
    setRowSleepHours: calc.setRowSleepHours,
    upsertFromBox: calc.upsertFromBox,
    undo: calc.undo,
    redo: calc.redo,
    switchToSlot: calc.switchToSlot,
    pasteSlot: calc.pasteSlot,
  };

  function rowExpGot(row: Pick<CalcRow, 'srcLevel' | 'expType' | 'expRemaining'>): number {
    const toNext = Math.max(0, calcExp(row.srcLevel, row.srcLevel + 1, row.expType));
    return row.expRemaining !== undefined && row.expRemaining > 0
      ? Math.max(0, toNext - row.expRemaining)
      : 0;
  }

  function rowBoostCandy(row: CalcRow): number {
    if (calc.boostKind.value === 'none') return 0;
    return Math.max(0, Math.floor(row.boostOrExpAdjustment ?? 0));
  }

  function rowSleepExp(row: CalcRow): number {
    if (row.sleepTargetHours === undefined || row.candyTarget === undefined) return 0;
    const remainingHours = Math.max(0, row.sleepTargetHours - (row.sleepHours ?? 0));
    if (remainingHours <= 0) return 0;
    const settings = calc.sleepSettings.value;
    return markForSleep({
      targetSleepHours: remainingHours,
      nature: row.nature,
      dailySleepHours: settings.dailySleepHours,
      sleepExpBonus: 1 + 0.14 * settings.sleepExpBonusCount,
      includeGSD: settings.includeGSD,
    }).sleepExp;
  }

  function normalizePoint(row: CalcRow, point: Point): Point {
    const level = clampInt(point.level, row.srcLevel, MAX_LEVEL, row.dstLevel);
    if (level >= MAX_LEVEL) return { level, expInLevel: 0 };
    const toNext = Math.max(0, calcExp(level, level + 1, row.expType));
    return {
      level,
      expInLevel: clampInt(point.expInLevel, 0, Math.max(0, toNext - 1), 0),
    };
  }

  function candyEndpoint(row: CalcRow, candyTarget = row.candyTarget ?? 0, boostCandy = rowBoostCandy(row)): Point {
    return normalizePoint(row, deriveCandyEndpoint({
      srcLevel: row.srcLevel,
      expGot: rowExpGot(row),
      candyTarget,
      boostCandy,
      expType: row.expType,
      nature: row.nature,
      boostKind: calc.boostKind.value,
      sleepExp: rowSleepExp(row),
    }));
  }

  function exactPoint(row: CalcRow): Point {
    if (row.dstExpInLevel === undefined) {
      return row.candyTarget === undefined
        ? normalizePoint(row, { level: row.dstLevel, expInLevel: 0 })
        : candyEndpoint(row);
    }
    return normalizePoint(row, { level: row.dstLevel, expInLevel: row.dstExpInLevel });
  }

  function maxBoostCandyFor(row: CalcRow): number {
    if (calc.boostKind.value === 'none' || row.srcLevel >= MAX_LEVEL) return 0;
    return calcExpAndCandy({
      srcLevel: row.srcLevel,
      dstLevel: MAX_LEVEL,
      dstExpInLevel: 0,
      expType: row.expType,
      nature: row.nature,
      boost: calc.boostKind.value,
      expGot: rowExpGot(row),
    }).candy;
  }

  function boostReachLevelFor(row: CalcRow, boostCandy: number): number {
    if (calc.boostKind.value === 'none' || boostCandy <= 0) return row.srcLevel;
    const simulated = calcLevelByCandy({
      srcLevel: row.srcLevel,
      dstLevel: MAX_LEVEL,
      expType: row.expType,
      nature: row.nature,
      boost: calc.boostKind.value,
      candy: Math.max(0, Math.floor(boostCandy)),
      expGot: rowExpGot(row),
    });
    return Math.max(row.srcLevel, Math.min(MAX_LEVEL, simulated.level));
  }

  /** LvMAX から睡眠EXPを差し引いた、アメが担当できる最大地点。 */
  function maxCandyPoint(row: CalcRow): Point | null {
    const expGot = rowExpGot(row);
    const expForCandy = Math.max(0, calcExp(row.srcLevel, MAX_LEVEL, row.expType) - expGot) - rowSleepExp(row);
    if (expForCandy <= 0) return null;
    let level = row.srcLevel;
    let expInLevel = expGot + expForCandy;
    while (level < MAX_LEVEL) {
      const needed = calcExp(level, level + 1, row.expType);
      if (expInLevel < needed) break;
      expInLevel -= needed;
      level++;
    }
    return { level, expInLevel: level >= MAX_LEVEL ? 0 : expInLevel };
  }

  /**
   * 個数指定上限。アメブ入力は、同じ地点まで全てアメブで進むのに必要な個数までに
   * クランプしてから mixed 計算へ渡す。余剰アメブによる過大計上を防ぐ。
   */
  function maxCandyTargetFor(row: CalcRow): number {
    const point = maxCandyPoint(row);
    if (point === null) return 0;
    const expGot = rowExpGot(row);
    const fullBoost = calc.boostKind.value === 'none'
      ? 0
      : calcExpAndCandy({
        srcLevel: row.srcLevel,
        dstLevel: point.level,
        dstExpInLevel: point.expInLevel,
        expType: row.expType,
        nature: row.nature,
        boost: calc.boostKind.value,
        expGot,
      }).candy;
    const mixed = calcExpAndCandyMixed({
      srcLevel: row.srcLevel,
      dstLevel: point.level,
      dstExpInLevel: point.expInLevel,
      expType: row.expType,
      nature: row.nature,
      boost: calc.boostKind.value,
      boostCandy: Math.min(rowBoostCandy(row), fullBoost),
      expGot,
    });
    return mixed.boostCandy + mixed.normalCandy;
  }

  function clampCountAndBoost(row: CalcRow, candyTarget: number, preferredBoost = rowBoostCandy(row)): { candy: number; boost: number } {
    const candy = Math.min(
      Math.max(0, Math.floor(candyTarget)),
      maxCandyTargetFor(row),
    );
    const boost = Math.min(
      Math.max(0, Math.floor(preferredBoost)),
      candy,
      maxBoostCandyFor(row),
    );
    return { candy, boost };
  }

  function fixedTargetPatch(row: CalcRow, target: Point, preferredBoost = rowBoostCandy(row)): Partial<CalcRow> {
    const fixed = normalizePoint(row, target);
    let boost = Math.min(Math.max(0, Math.floor(preferredBoost)), maxBoostCandyFor(row));

    const candyForBoost = (boostCandy: number): number => {
      const working = {
        ...row,
        dstLevel: fixed.level,
        dstExpInLevel: fixed.expInLevel,
        boostOrExpAdjustment: boostCandy,
      };
      const maxCandy = maxCandyTargetFor(working);
      const calculated = calcCandyTargetFromSleepExp({
        srcLevel: working.srcLevel,
        dstLevel: fixed.level,
        dstExpInLevel: fixed.expInLevel,
        expType: working.expType,
        nature: working.nature,
        boostKind: calc.boostKind.value,
        targetBoostCandy: boostCandy,
        targetNormalCandy: maxCandy,
        sleepExp: rowSleepExp(working),
        expGot: rowExpGot(working),
      });
      return Math.min(Math.max(0, Math.floor(calculated)), maxCandy);
    };

    let candy = candyForBoost(boost);
    // n が m を超えて縮んだ場合、混合比が変わるので安定するまで逆算を繰り返す。
    for (let i = 0; i < 8; i++) {
      const nextBoost = Math.min(boost, candy, maxBoostCandyFor(row));
      if (nextBoost === boost) break;
      boost = nextBoost;
      candy = candyForBoost(boost);
    }
    boost = Math.min(boost, candy, maxBoostCandyFor(row));

    return {
      dstLevel: fixed.level,
      dstExpInLevel: fixed.expInLevel,
      candyTarget: candy,
      boostOrExpAdjustment: boost,
      boostReachLevel: boostReachLevelFor(row, boost),
    };
  }

  function countDrivenPatch(row: CalcRow, candyTarget = row.candyTarget ?? 0, preferredBoost = rowBoostCandy(row)): Partial<CalcRow> {
    const { candy, boost } = clampCountAndBoost(row, candyTarget, preferredBoost);
    const working: CalcRow = {
      ...row,
      candyTarget: candy,
      boostOrExpAdjustment: boost,
    };
    const point = candyEndpoint(working, candy, boost);
    return {
      candyTarget: candy,
      boostOrExpAdjustment: boost,
      boostReachLevel: boostReachLevelFor(working, boost),
      dstLevel: point.level,
      dstExpInLevel: point.expInLevel,
    };
  }

  function fixedNoCountPatch(row: CalcRow, target: Point, preferredBoost = rowBoostCandy(row)): Partial<CalcRow> {
    const fixed = normalizePoint(row, target);
    const boost = Math.min(Math.max(0, Math.floor(preferredBoost)), maxBoostCandyFor(row));
    return {
      dstLevel: fixed.level,
      dstExpInLevel: fixed.expInLevel,
      candyTarget: undefined,
      sleepTargetHours: undefined,
      boostOrExpAdjustment: boost,
      boostReachLevel: boostReachLevelFor(row, boost),
    };
  }

  function applyPatch(row: CalcRow, patch: Partial<CalcRow>): CalcRow {
    return { ...row, ...patch };
  }

  function commitRows(rows: CalcRow[]): void {
    calc.rows.value = rows;
    syncRegistry(rows);
  }

  function updateOne(id: string, updater: (row: CalcRow) => CalcRow): void {
    let changed = false;
    const next = calc.rows.value.map((row) => {
      if (row.id !== id) return row;
      changed = true;
      return updater(row);
    });
    if (changed) commitRows(next);
  }

  function snapshotTargets(): Map<string, TargetSnapshot> {
    return new Map(calc.rows.value.map((row) => [row.id, { row: { ...row }, target: exactPoint(row) }] as const));
  }

  function syncRegistry(rows = calc.rows.value): void {
    const validIds = new Set<string>();
    for (const row of rows) {
      validIds.add(row.id);
      const point = exactPoint(row);
      setExactLevelTarget(row.id, point);
    }
    pruneExactLevelTargets(validIds);
  }

  function migrateRestoredRows(): void {
    const migrated = calc.rows.value.map((original) => {
      let row: CalcRow = { ...original };
      if (row.sleepTargetHours !== undefined && row.candyTarget === undefined) {
        row.sleepTargetHours = undefined;
      }
      if (row.candyTarget !== undefined) {
        row.candyTarget = Math.max(0, Math.floor(row.candyTarget));
      }
      const rawBoost = rowBoostCandy(row);
      const count = row.candyTarget;
      const boost = Math.min(rawBoost, maxBoostCandyFor(row), count ?? Number.MAX_SAFE_INTEGER);
      if (boost !== rawBoost) {
        row.boostOrExpAdjustment = boost;
        row.boostReachLevel = boostReachLevelFor(row, boost);
      }

      if (row.dstExpInLevel === undefined) {
        const point = row.candyTarget === undefined
          ? normalizePoint(row, { level: row.dstLevel, expInLevel: 0 })
          : candyEndpoint(row, row.candyTarget, boost);
        row.dstLevel = point.level;
        row.dstExpInLevel = point.expInLevel;
      } else {
        const point = exactPoint(row);
        row.dstLevel = point.level;
        row.dstExpInLevel = point.expInLevel;
      }

      // 保存済みの睡眠目標は正確な最終目標を固定する。n のクランプが必要だった場合は
      // その混合比で m を再計算する。
      if (row.sleepTargetHours !== undefined && row.candyTarget !== undefined && boost !== rawBoost) {
        row = applyPatch(row, fixedTargetPatch(row, exactPoint(row), boost));
      } else if (row.sleepTargetHours === undefined && row.candyTarget !== undefined && boost !== rawBoost) {
        row = applyPatch(row, countDrivenPatch(row, row.candyTarget, boost));
      }
      return row;
    });
    commitRows(migrated);
  }

  function desiredBoostForTarget(row: CalcRow, target: Point, maxBoost: number): number {
    if (calc.boostKind.value === 'none') return 0;
    return minBoostForTarget({
      srcLevel: row.srcLevel,
      targetLevel: target.level,
      targetExpInLevel: target.expInLevel,
      expType: row.expType,
      nature: row.nature,
      boostKind: calc.boostKind.value,
      maxBoost,
      expGot: rowExpGot(row),
      ...(row.candyTarget === undefined ? {} : { fixedTotalCandy: row.candyTarget }),
    });
  }

  /** アメブ種別・上限・性格・ボックス同期後の top-down 再配分。 */
  function reallocateBoost(snapshot: Map<string, TargetSnapshot>): void {
    let remaining = calc.boostKind.value === 'none'
      ? 0
      : Math.max(0, Math.floor(calc.boostCandyRemaining.value ?? calc.boostCandyDefaultCap.value));

    const nextRows = calc.rows.value.map((row) => {
      const previous = snapshot.get(row.id);
      const target = previous?.target ?? exactPoint(row);
      let boost = desiredBoostForTarget(row, target, remaining);
      if (row.candyTarget !== undefined) boost = Math.min(boost, row.candyTarget);
      boost = Math.min(boost, maxBoostCandyFor(row));

      let next: CalcRow;
      if (previous?.row.sleepTargetHours !== undefined && row.sleepTargetHours !== undefined && row.candyTarget !== undefined) {
        next = applyPatch(row, fixedTargetPatch(row, target, boost));
      } else if (row.candyTarget !== undefined) {
        next = applyPatch(row, countDrivenPatch(row, row.candyTarget, boost));
      } else {
        next = applyPatch(row, fixedNoCountPatch(row, target, boost));
      }
      remaining = Math.max(0, remaining - rowBoostCandy(next));
      return next;
    });
    commitRows(nextRows);
  }

  calc.updateSleepSettings = (patch) => {
    const snapshot = snapshotTargets();
    base.updateSleepSettings(patch);
    const next = calc.rows.value.map((row) => {
      const previous = snapshot.get(row.id);
      if (!previous || row.sleepTargetHours === undefined || row.candyTarget === undefined) return row;
      return applyPatch(row, fixedTargetPatch(row, previous.target));
    });
    commitRows(next);
  };

  calc.setSlotBoostKind = (kind: BoostEvent) => {
    const snapshot = snapshotTargets();
    base.setSlotBoostKind(kind);
    reallocateBoost(snapshot);
  };

  calc.onBoostCandyRemainingInput = (value: string) => {
    const snapshot = snapshotTargets();
    base.onBoostCandyRemainingInput(value);
    reallocateBoost(snapshot);
  };

  calc.resetBoostCandyRemaining = () => {
    const snapshot = snapshotTargets();
    base.resetBoostCandyRemaining();
    reallocateBoost(snapshot);
  };

  calc.setDstLevel = (id, value) => {
    base.setDstLevel(id, value);
    updateOne(id, (row) => {
      const target = normalizePoint(row, { level: row.dstLevel, expInLevel: 0 });
      return row.sleepTargetHours !== undefined && row.candyTarget !== undefined
        ? applyPatch(row, fixedTargetPatch(row, target))
        : applyPatch(row, { dstLevel: target.level, dstExpInLevel: 0 });
    });
  };

  calc.setSrcLevel = (id, value) => {
    base.setSrcLevel(id, value);
    updateOne(id, (row) => applyPatch(row, {
      dstExpInLevel: 0,
      candyTarget: undefined,
      sleepTargetHours: undefined,
    }));
  };

  calc.nudgeDstLevel = (id, delta) => {
    const row = calc.rows.value.find((item) => item.id === id);
    if (row) calc.setDstLevel(id, row.dstLevel + delta);
  };

  calc.nudgeSrcLevel = (id, delta) => {
    const row = calc.rows.value.find((item) => item.id === id);
    if (row) calc.setSrcLevel(id, row.srcLevel + delta);
  };

  calc.setBoostLevel = (id, value) => {
    const before = calc.rows.value.find((row) => row.id === id);
    const targetBefore = before ? exactPoint(before) : null;
    const requested = before ? clampInt(value, before.srcLevel, MAX_LEVEL, before.srcLevel) : 0;
    base.setBoostLevel(id, value);
    updateOne(id, (row) => {
      if (before?.sleepTargetHours !== undefined && requested > targetBefore!.level && row.sleepTargetHours !== undefined && row.candyTarget !== undefined) {
        return applyPatch(row, fixedTargetPatch(row, { level: row.dstLevel, expInLevel: 0 }));
      }
      if (row.candyTarget !== undefined) return applyPatch(row, countDrivenPatch(row));
      const target = targetBefore && requested <= targetBefore.level
        ? targetBefore
        : { level: row.dstLevel, expInLevel: 0 };
      return applyPatch(row, { dstLevel: target.level, dstExpInLevel: target.expInLevel });
    });
  };

  calc.nudgeBoostLevel = (id, delta) => {
    const row = calc.rows.value.find((item) => item.id === id);
    if (row) calc.setBoostLevel(id, (row.boostReachLevel ?? row.srcLevel) + delta);
  };

  calc.onRowBoostLevel = (id, value) => {
    calc.setBoostLevel(id, value);
  };

  calc.onRowExpRemaining = (id, value) => {
    const before = calc.rows.value.find((row) => row.id === id);
    const target = before ? exactPoint(before) : null;
    base.onRowExpRemaining(id, value);
    if (!target) return;
    updateOne(id, (row) => {
      if (row.sleepTargetHours !== undefined && row.candyTarget !== undefined) {
        return applyPatch(row, fixedTargetPatch(row, target));
      }
      if (row.candyTarget !== undefined) return applyPatch(row, countDrivenPatch(row));
      return applyPatch(row, { dstLevel: target.level, dstExpInLevel: target.expInLevel });
    });
  };

  calc.onRowNature = (id, value: string) => {
    const snapshot = snapshotTargets();
    base.onRowNature(id, value);
    reallocateBoost(snapshot);
  };

  calc.onRowCandyTarget = (id, value) => {
    base.onRowCandyTarget(id, value);
    updateOne(id, (row) => {
      if (value.trim() === '' || row.candyTarget === undefined) {
        return applyPatch(row, { dstExpInLevel: 0, sleepTargetHours: undefined });
      }
      return applyPatch(row, countDrivenPatch(row));
    });
  };

  calc.setRowSleepTargetHours = (id, hours) => {
    const before = calc.rows.value.find((row) => row.id === id);
    const target = before ? exactPoint(before) : null;
    base.setRowSleepTargetHours(id, hours);
    if (!target) return;
    updateOne(id, (row) => {
      if (hours === undefined || row.sleepTargetHours === undefined) {
        return row.candyTarget === undefined
          ? applyPatch(row, { dstLevel: target.level, dstExpInLevel: target.expInLevel })
          : applyPatch(row, countDrivenPatch(row));
      }
      return applyPatch(row, fixedTargetPatch(row, target));
    });
  };

  calc.setRowSleepHours = (id, hours) => {
    const before = calc.rows.value.find((row) => row.id === id);
    const target = before ? exactPoint(before) : null;
    base.setRowSleepHours(id, hours);
    if (!target) return;
    updateOne(id, (row) => row.sleepTargetHours !== undefined && row.candyTarget !== undefined
      ? applyPatch(row, fixedTargetPatch(row, target))
      : applyPatch(row, { dstLevel: target.level, dstExpInLevel: target.expInLevel }));
  };

  calc.onRowBoostCandy = (id, value) => {
    const before = calc.rows.value.find((row) => row.id === id);
    const target = before ? exactPoint(before) : null;
    base.onRowBoostCandy(id, value);
    updateOne(id, (row) => row.candyTarget !== undefined
      ? applyPatch(row, countDrivenPatch(row))
      : target
        ? applyPatch(row, { dstLevel: target.level, dstExpInLevel: target.expInLevel })
        : row);
  };

  calc.resetRowBoostCandy = (id) => {
    const before = calc.rows.value.find((row) => row.id === id);
    const target = before ? exactPoint(before) : null;
    base.resetRowBoostCandy(id);
    if (!target) return;
    updateOne(id, (row) => {
      if (row.sleepTargetHours !== undefined && row.candyTarget !== undefined) {
        return applyPatch(row, fixedTargetPatch(row, target));
      }
      if (row.candyTarget !== undefined) return applyPatch(row, countDrivenPatch(row));
      return applyPatch(row, { dstLevel: target.level, dstExpInLevel: target.expInLevel });
    });
  };

  calc.upsertFromBox = (params) => {
    const snapshot = snapshotTargets();
    const existing = calc.rows.value.find((row) => row.boxId === params.boxId);
    base.upsertFromBox(params);
    if (existing) {
      const current = calc.rows.value.find((row) => row.boxId === params.boxId);
      if (current && current.srcLevel !== existing.srcLevel) snapshot.delete(current.id);
    }
    reallocateBoost(snapshot);
  };

  const restoreAndMigrate = (action: () => void) => {
    action();
    migrateRestoredRows();
  };
  calc.undo = () => restoreAndMigrate(base.undo);
  calc.redo = () => restoreAndMigrate(base.redo);
  calc.switchToSlot = (slotIndex) => restoreAndMigrate(() => base.switchToSlot(slotIndex));
  calc.pasteSlot = () => restoreAndMigrate(base.pasteSlot);

  migrateRestoredRows();
  watch(calc.rows, (rows) => syncRegistry(rows), { deep: true, immediate: true });

  return calc;
}
