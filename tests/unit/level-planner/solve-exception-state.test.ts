import { describe, expect, it } from 'vitest';
import { __levelPlannerTestHooks, solveLevelPlan } from '../../../src/domain/level-planner/core/solveLevelPlan';
import type { LevelPlannerInput } from '../../../src/domain/level-planner/types';

describe('solveLevelPlan の例外時の状態（設計書 §15.3）', () => {
  it('計算の途中で例外が出ても、モジュールの activeLossLedger を残さない', () => {
    expect(__levelPlannerTestHooks.hasActiveLossLedger()).toBe(false);
    // activeLossLedger を立てたあとの normalizeInput で例外になる入力
    const broken = { boost: { kind: 'none' }, pokemonList: null } as unknown as LevelPlannerInput;
    expect(() => solveLevelPlan(broken)).toThrow();
    expect(__levelPlannerTestHooks.hasActiveLossLedger()).toBe(false);
  });
});
