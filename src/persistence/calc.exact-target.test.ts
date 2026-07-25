import { beforeEach, describe, expect, it } from 'vitest';
import { calcExp } from '../domain/pokesleep/exp';
import { maxLevel as MAX_LEVEL } from '../domain/pokesleep/tables';
import {
  CALC_SLOTS_STORAGE_KEY,
  loadCalcSlots,
} from './calc';

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

function rawSlot(row: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    slots: [{
      slotId: 'slot-1',
      savedAt: '2026-01-01T00:00:00.000Z',
      rows: [{
        id: 'row-1',
        title: 'Pikachu',
        srcLevel: 10,
        dstLevel: 20,
        expRemaining: 100,
        expType: 600,
        nature: 'normal',
        boostReachLevel: 20,
        ...row,
      }],
      activeRowId: 'row-1',
      boostKind: 'full',
    }, null, null],
  };
}

describe('calc persistence: exact target invariants', () => {
  beforeEach(() => installLocalStorageMock());

  it('dstExpInLevel をそのレベル内へ正規化し、n を candyTarget の内数へクランプする', () => {
    const toNext = calcExp(20, 21, 600);
    localStorage.setItem(CALC_SLOTS_STORAGE_KEY, JSON.stringify(rawSlot({
      dstExpInLevel: toNext + 999,
      candyTarget: 12,
      boostOrExpAdjustment: 99,
      boostReachLevel: 30,
    })));

    const row = loadCalcSlots()[0]!.rows[0]!;
    expect(row.dstExpInLevel).toBe(toNext - 1);
    expect(row.candyTarget).toBe(12);
    expect(row.boostOrExpAdjustment).toBe(12);
    // 目標Lvより先のアメブ到達Lvも正当な状態として保持できる。
    expect(row.boostReachLevel).toBe(30);
  });

  it('sleepTargetHours 単独の旧V3保存値を0個指定へ正規化する', () => {
    localStorage.setItem(CALC_SLOTS_STORAGE_KEY, JSON.stringify(rawSlot({
      candyTarget: undefined,
      sleepTargetHours: 200,
      boostOrExpAdjustment: 5,
    })));

    const row = loadCalcSlots()[0]!.rows[0]!;
    expect(row.candyTarget).toBe(0);
    expect(row.sleepTargetHours).toBe(200);
    expect(row.boostOrExpAdjustment).toBe(0);
  });

  it('旧データの dstExpInLevel 未設定を維持し、store 側が従来の個数到達点から移行できるようにする', () => {
    localStorage.setItem(CALC_SLOTS_STORAGE_KEY, JSON.stringify(rawSlot({
      candyTarget: 30,
      boostOrExpAdjustment: 10,
    })));

    const row = loadCalcSlots()[0]!.rows[0]!;
    expect(row.dstExpInLevel).toBeUndefined();
  });

  it('LvMAX の dstExpInLevel は常に 0 になる', () => {
    localStorage.setItem(CALC_SLOTS_STORAGE_KEY, JSON.stringify(rawSlot({
      dstLevel: MAX_LEVEL,
      dstExpInLevel: 123,
      boostReachLevel: MAX_LEVEL,
    })));

    expect(loadCalcSlots()[0]!.rows[0]!.dstExpInLevel).toBe(0);
  });
});
