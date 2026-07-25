import { describe, expect, it } from 'vitest';
import { calcExp } from '../domain/pokesleep/exp';
import { parseBackup } from './backupCodec';

function row(patch: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    title: 'Pikachu',
    srcLevel: 10,
    dstLevel: 20,
    dstExpInLevel: 123,
    expRemaining: 100,
    expType: 600,
    nature: 'normal',
    boostReachLevel: 20,
    boostOrExpAdjustment: 5,
    candyTarget: 10,
    ...patch,
  };
}

function backup(rowPatch: Record<string, unknown> = {}) {
  return JSON.stringify({
    format: 'candy-boost-planner-backup',
    schemaVersion: 3,
    exportedAt: '2026-01-01T00:00:00.000Z',
    data: {
      box: { entries: [] },
      globalSettings: {
        totalShards: 0,
        sleepSettings: { dailySleepHours: 8.5, sleepExpBonusCount: 0, includeGSD: true },
        candyInventory: {
          schemaVersion: 2,
          universal: { s: 0, m: 0, l: 0 },
          typeCandy: {},
          species: {},
        },
      },
      calculator: {
        activeSlotIndex: 0,
        slots: [{
          slotId: 'slot-1',
          savedAt: '2026-01-01T00:00:00.000Z',
          rows: [row(rowPatch)],
          activeRowId: 'row-1',
          boostKind: 'full',
          itemCompareMode: 'surplusFirst',
        }, null, null],
      },
    },
  });
}

describe('backupCodec: exact target invariants', () => {
  it('dstExpInLevel を保持し、n > m は m の内数へ正規化する', () => {
    const parsed = parseBackup(backup({
      dstExpInLevel: 321,
      candyTarget: 8,
      boostOrExpAdjustment: 99,
      boostReachLevel: 30,
    }));
    const saved = parsed.backup.data.calculator.slots[0]!.rows[0]!;
    expect(saved.dstExpInLevel).toBe(321);
    expect(saved.boostOrExpAdjustment).toBe(8);
    expect(saved.boostReachLevel).toBe(30);
  });

  it('sleepTargetHours 単独の旧V3バックアップを0個指定へ正規化する', () => {
    const parsed = parseBackup(backup({
      candyTarget: undefined,
      sleepTargetHours: 200,
      boostOrExpAdjustment: 5,
    }));
    const saved = parsed.backup.data.calculator.slots[0]!.rows[0]!;
    expect(saved.sleepTargetHours).toBe(200);
    expect(saved.candyTarget).toBe(0);
    expect(saved.boostOrExpAdjustment).toBe(0);
  });

  it('dstExpInLevel がそのレベルの範囲外なら拒否する', () => {
    const toNext = calcExp(20, 21, 600);
    expect(() => parseBackup(backup({ dstExpInLevel: toNext })))
      .toThrow('dstExpInLevel');
  });

  it('旧バックアップの dstExpInLevel 未設定を許容する', () => {
    const parsed = parseBackup(backup({ dstExpInLevel: undefined }));
    expect(parsed.backup.data.calculator.slots[0]!.rows[0]!.dstExpInLevel).toBeUndefined();
  });
});
