import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ref } from 'vue';
import type { Composer } from 'vue-i18n';
import { deriveCandyEndpoint } from '../domain/level-planner/deriveCandyEndpoint';
import { calcExp, calcLevelByCandy } from '../domain/pokesleep';
import { markForSleep } from '../domain/pokesleep/sleep-growth';
import { maxLevel as MAX_LEVEL } from '../domain/pokesleep/tables';
import { cancelPersist } from '../persistence/deferredPersist';
import { useCalcStore, type CalcRow } from './useExactTargetCalcStore';

function installLocalStorageMock() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  });
}

function createStore() {
  const t = ((key: string) => key) as unknown as Composer['t'];
  return useCalcStore({ locale: ref('ja'), t });
}

function currentExp(row: CalcRow): number {
  const toNext = calcExp(row.srcLevel, row.srcLevel + 1, row.expType);
  return row.expRemaining > 0 ? Math.max(0, toNext - row.expRemaining) : 0;
}

function sleepExp(store: ReturnType<typeof createStore>, row: CalcRow): number {
  if (row.sleepTargetHours === undefined || row.candyTarget === undefined) return 0;
  const remaining = Math.max(0, row.sleepTargetHours - (row.sleepHours ?? 0));
  if (remaining <= 0) return 0;
  const settings = store.sleepSettings.value;
  return markForSleep({
    targetSleepHours: remaining,
    nature: row.nature,
    dailySleepHours: settings.dailySleepHours,
    sleepExpBonus: 1 + 0.14 * settings.sleepExpBonusCount,
    includeGSD: settings.includeGSD,
  }).sleepExp;
}

function expectedEndpoint(store: ReturnType<typeof createStore>, row: CalcRow) {
  return deriveCandyEndpoint({
    srcLevel: row.srcLevel,
    expGot: currentExp(row),
    candyTarget: row.candyTarget ?? 0,
    boostCandy: row.boostOrExpAdjustment ?? 0,
    expType: row.expType,
    nature: row.nature,
    boostKind: store.boostKind.value,
    sleepExp: sleepExp(store, row),
  });
}

function addRow(store: ReturnType<typeof createStore>, boxId = 'box-1', nature: CalcRow['nature'] = 'normal') {
  store.upsertFromBox({ boxId, srcLevel: 10, dstLevelDefault: 30, expType: 600, nature });
  return store.rows.value.find((row) => row.boxId === boxId)!;
}

describe('useExactTargetCalcStore', () => {
  beforeEach(() => {
    cancelPersist();
    installLocalStorageMock();
  });

  afterEach(() => cancelPersist());

  it('candyTarget を減らしたとき n <= m と boostReachLevel を同時に修復する', () => {
    const store = createStore();
    const row = addRow(store);
    store.onRowCandyTarget(row.id, '100');
    store.onRowBoostCandy(row.id, '80');
    store.onRowCandyTarget(row.id, '10');

    const updated = store.rows.value[0]!;
    expect(updated.candyTarget).toBe(10);
    expect(updated.boostOrExpAdjustment).toBeLessThanOrEqual(10);
    const expectedReach = calcLevelByCandy({
      srcLevel: updated.srcLevel,
      dstLevel: MAX_LEVEL,
      expType: updated.expType,
      nature: updated.nature,
      boost: store.boostKind.value,
      candy: updated.boostOrExpAdjustment ?? 0,
      expGot: currentExp(updated),
    }).level;
    expect(updated.boostReachLevel).toBe(expectedReach);
    expect({ level: updated.dstLevel, expInLevel: updated.dstExpInLevel }).toEqual(expectedEndpoint(store, updated));
  });

  it('睡眠設定を変更しても唯一の最終目標を固定し、m と n だけを再計算する', () => {
    const store = createStore();
    const row = addRow(store);
    store.onRowCandyTarget(row.id, '120');
    store.setRowSleepTargetHours(row.id, 200);
    const before = store.rows.value[0]!;
    const target = { level: before.dstLevel, expInLevel: before.dstExpInLevel };

    store.updateSleepSettings({ dailySleepHours: 6, sleepExpBonusCount: 3, includeGSD: false });
    const after = store.rows.value[0]!;

    expect({ level: after.dstLevel, expInLevel: after.dstExpInLevel }).toEqual(target);
    expect(after.sleepTargetHours).toBe(200);
    expect(after.candyTarget).toBeDefined();
    expect(after.boostOrExpAdjustment ?? 0).toBeLessThanOrEqual(after.candyTarget ?? 0);
  });

  it('睡眠目標を解除したら、残した個数指定のアメだけを駆動側にして正確な到達点を保存する', () => {
    const store = createStore();
    const row = addRow(store);
    store.onRowCandyTarget(row.id, '120');
    store.setRowSleepTargetHours(row.id, 200);
    store.setRowSleepTargetHours(row.id, undefined);

    const after = store.rows.value[0]!;
    expect(after.sleepTargetHours).toBeUndefined();
    expect(after.candyTarget).toBeDefined();
    expect({ level: after.dstLevel, expInLevel: after.dstExpInLevel }).toEqual(expectedEndpoint(store, after));
  });

  it('個数指定中の性格変更は同じ m と新しい n から正確な最終目標を同期する', () => {
    const store = createStore();
    const row = addRow(store);
    store.onRowCandyTarget(row.id, '75');
    store.onRowBoostCandy(row.id, '20');
    store.onRowNature(row.id, 'up');

    const after = store.rows.value[0]!;
    expect(after.nature).toBe('up');
    expect({ level: after.dstLevel, expInLevel: after.dstExpInLevel }).toEqual(expectedEndpoint(store, after));
    expect(after.boostOrExpAdjustment ?? 0).toBeLessThanOrEqual(after.candyTarget ?? 0);
  });

  it('同じ元Lvのボックス再同期で性格・残EXPが変わっても睡眠中の最終目標を保持する', () => {
    const store = createStore();
    const row = addRow(store, 'sync-row');
    store.onRowCandyTarget(row.id, '100');
    store.setRowSleepTargetHours(row.id, 200);
    const target = {
      level: store.rows.value[0]!.dstLevel,
      expInLevel: store.rows.value[0]!.dstExpInLevel,
    };

    store.upsertFromBox({
      boxId: 'sync-row',
      srcLevel: 10,
      dstLevelDefault: 50,
      expType: 600,
      nature: 'down',
      expRemaining: 42,
    });
    const after = store.rows.value[0]!;

    expect(after.nature).toBe('down');
    expect(after.expRemaining).toBe(42);
    expect({ level: after.dstLevel, expInLevel: after.dstExpInLevel }).toEqual(target);
    expect(after.boostOrExpAdjustment ?? 0).toBeLessThanOrEqual(after.candyTarget ?? 0);
  });

  it('アメブ種別・上限の変更後も全行で n <= m と正確な目標同期を保つ', () => {
    const store = createStore();
    const first = addRow(store, 'cap-1');
    const second = addRow(store, 'cap-2');
    store.onRowCandyTarget(first.id, '100');
    store.onRowCandyTarget(second.id, '100');
    store.setSlotBoostKind('full');
    store.onBoostCandyRemainingInput('3');

    const rows = store.rows.value;
    expect(rows.reduce((sum, row) => sum + (row.boostOrExpAdjustment ?? 0), 0)).toBeLessThanOrEqual(3);
    for (const row of rows) {
      expect(row.boostOrExpAdjustment ?? 0).toBeLessThanOrEqual(row.candyTarget ?? Number.MAX_SAFE_INTEGER);
      expect(row.dstExpInLevel).toBeDefined();
      if (row.sleepTargetHours === undefined && row.candyTarget !== undefined) {
        expect({ level: row.dstLevel, expInLevel: row.dstExpInLevel }).toEqual(expectedEndpoint(store, row));
      }
    }
  });
});
