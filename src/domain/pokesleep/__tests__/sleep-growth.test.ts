/**
 * 睡眠育成機能のテスト
 *
 * @see .agent/DESIGN_SLEEP_GROWTH.md
 *
 * テスト方針:
 * - Test1-5: markForSleep 単体テスト
 * - Test6-7: calcSleepTimeForExp 単体テスト
 * - Test8-12: 睡眠育成ボタン E2E テスト（UIフロー → planLevelUp → 結果検証）
 */

import { describe, it, expect } from 'vitest';
import { markForSleep, calcSleepTimeForExp, calcCandyTargetFromSleepExp } from '../sleep-growth';
import { calcExp, calcExpAndCandyMixed } from '../exp';
import { planLevelUp } from '../../level-planner/core/plan';
import type { PokemonLevelUpRequest, CandyInventory, PlanConfig } from '../../level-planner/types';
import type { ExpType, ExpGainNature, BoostEvent } from '../../types';

describe('睡眠育成機能', () => {
  describe('markForSleep', () => {
    it('Test1: 2000h、8.5h/日、性格normal、GSDオン', () => {
      const result = markForSleep({
        targetSleepHours: 2000,
        nature: 'normal',
        dailySleepHours: 8.5,
        sleepExpBonus: 1.0,
        includeGSD: true,
      });

      // requiredDays = ceil(2000 / 8.5) = 236
      expect(result.requiredDays).toBe(236);

      // dailyExp = 100 (8.5h, nature normal, bonus 1.0)
      // gsdCycles = floor(236 / 29.53) = 7
      // gsdBonus = 7 * 400 = 2800
      // sleepExp = 100 * 236 + 2800 = 26400
      expect(result.sleepExp).toBe(26400);
    });

    it('Test2: 1000h、8.5h/日、性格normal、GSDオン', () => {
      const result = markForSleep({
        targetSleepHours: 1000,
        nature: 'normal',
        dailySleepHours: 8.5,
        sleepExpBonus: 1.0,
        includeGSD: true,
      });

      // requiredDays = ceil(1000 / 8.5) = 118
      expect(result.requiredDays).toBe(118);

      // gsdCycles = floor(118 / 29.53) = 3
      // gsdBonus = 3 * 400 = 1200
      // sleepExp = 100 * 118 + 1200 = 13000
      expect(result.sleepExp).toBe(13000);
    });

    it('Test3: 性格upで睡眠EXPが増加', () => {
      const result = markForSleep({
        targetSleepHours: 2000,
        nature: 'up',
        dailySleepHours: 8.5,
        sleepExpBonus: 1.0,
        includeGSD: true,
      });

      // dailyExp = floor(100 * 1.18) = 118
      // sleepExp = 118 * 236 + 2800 = 30648
      expect(result.sleepExp).toBe(30648);
    });

    it('Test4: 性格downで睡眠EXPが減少', () => {
      const result = markForSleep({
        targetSleepHours: 2000,
        nature: 'down',
        dailySleepHours: 8.5,
        sleepExpBonus: 1.0,
        includeGSD: true,
      });

      // dailyExp = floor(100 * 0.82) = 82
      // sleepExp = 82 * 236 + 2800 = 22152
      expect(result.sleepExp).toBe(22152);
    });

    it('Test5: GSDオフでGSDボーナスなし', () => {
      const result = markForSleep({
        targetSleepHours: 2000,
        nature: 'normal',
        dailySleepHours: 8.5,
        sleepExpBonus: 1.0,
        includeGSD: false,
      });

      // sleepExp = 100 * 236 + 0 = 23600
      expect(result.sleepExp).toBe(23600);
    });
  });

  describe('calcSleepTimeForExp', () => {
    it('Test6: 残EXP 26400を8.5h/日でカバー → 236日必要', () => {
      const result = calcSleepTimeForExp({
        expToTarget: 26400,
        nature: 'normal',
        dailySleepHours: 8.5,
        sleepExpBonus: 1.0,
        includeGSD: true,
      });

      expect(result.requiredDays).toBe(236);
      expect(result.requiredHours).toBe(236 * 8.5);
    });

    it('Test7: 残EXP 0 → 0日必要', () => {
      const result = calcSleepTimeForExp({
        expToTarget: 0,
        nature: 'normal',
        dailySleepHours: 8.5,
        sleepExpBonus: 1.0,
        includeGSD: true,
      });

      expect(result.requiredDays).toBe(0);
      expect(result.requiredHours).toBe(0);
    });
  });

  // ============================================================
  // E2Eテスト: UIフロー → planLevelUp → 結果検証
  // ============================================================

  describe('睡眠育成ボタン E2E', () => {
    /**
     * 睡眠育成ボタンのUIフローをシミュレート
     *
     * 1. markForSleep で sleepExp を計算
     * 2. calcCandyTargetFromSleepExp で candyTarget を計算
     * 3. planLevelUp で計画を実行
     * 4. 結果を検証
     */
    function simulateSleepGrowthButton(params: {
      // ポケモン情報
      srcLevel: number;
      dstLevel: number;
      expType: ExpType;
      nature: ExpGainNature;
      expRemaining: number;  // 次Lvまでの残EXP
      // アメブースト設定
      boostKind: BoostEvent;
      boostCandy: number;  // 目標まで行のアメブ個数
      // 睡眠設定
      targetSleepHours: number;
      dailySleepHours: number;
      sleepExpBonus: number;
      includeGSD: boolean;
    }) {
      const {
        srcLevel, dstLevel, expType, nature, expRemaining,
        boostKind, boostCandy,
        targetSleepHours, dailySleepHours, sleepExpBonus, includeGSD,
      } = params;

      // 1. expGot を計算（UIと同じ）
      const toNextLevel = calcExp(srcLevel, srcLevel + 1, expType);
      const expGot = Math.max(0, toNextLevel - expRemaining);

      // 2. 目標まで行のアメ数を計算（UIと同じ）
      const mixedResult = calcExpAndCandyMixed({
        srcLevel,
        dstLevel,
        expType,
        nature,
        boost: boostKind,
        boostCandy,
        expGot,
      });
      const targetBoostCandy = boostCandy;
      const targetNormalCandy = mixedResult.normalCandy;

      // 3. markForSleep で sleepExp を計算
      const sleepResult = markForSleep({
        targetSleepHours,
        nature,
        dailySleepHours,
        sleepExpBonus,
        includeGSD,
      });

      // 4. calcCandyTargetFromSleepExp で candyTarget を計算
      const candyTarget = calcCandyTargetFromSleepExp({
        srcLevel,
        dstLevel,
        dstExpInLevel: 0,
        expType,
        nature,
        boostKind,
        targetBoostCandy,
        targetNormalCandy,
        sleepExp: sleepResult.sleepExp,
        expGot,
      });

      // 5. planLevelUp でリクエストを作成
      const request: PokemonLevelUpRequest = {
        id: 'test-pokemon',
        pokedexId: 518,  // ムシャーナ
        pokemonName: 'ムシャーナ',
        type: 'psychic',
        srcLevel,
        dstLevel,
        dstExpInLevel: 0,
        expType,
        nature,
        expGot,
        candyNeed: targetBoostCandy + targetNormalCandy,
        expNeed: mixedResult.exp,
        boostOrExpAdjustment: targetBoostCandy + targetNormalCandy,
        candyTarget,
      };

      const inventory: CandyInventory = {
        species: {},
        typeCandy: { psychic: { s: 1000, m: 100 } },
        universal: { s: 1000, m: 100, l: 10 },
      };

      const config: PlanConfig = {
        boostKind,
        globalBoostLimit: 350,  // ミニブースト上限
        globalShardsLimit: Infinity,
      };

      const result = planLevelUp([request], inventory, config);

      return {
        sleepResult,
        candyTarget,
        planResult: result,
        pokemon: result.pokemons[0],
        targetBoostCandy,
        targetNormalCandy,
      };
    }

    it('Test8: ムシャーナ Lv13→50、ミニブ350、2000hボタン', () => {
      // 実際のUIシナリオ:
      // - ムシャーナ Lv13 → 目標Lv50
      // - ExpType: 600
      // - 性格: normal
      // - あとEXP: 53（次Lvまで）
      // - ミニブースト、アメブ350個（100%）
      // - 2000hボタンを押す

      const result = simulateSleepGrowthButton({
        srcLevel: 13,
        dstLevel: 50,
        expType: 600,
        nature: 'normal',
        expRemaining: 53,
        boostKind: 'mini',
        boostCandy: 350,
        targetSleepHours: 2000,
        dailySleepHours: 8.5,
        sleepExpBonus: 1.0,
        includeGSD: true,
      });

      // 検証1: sleepExp が正しく計算されている
      expect(result.sleepResult.sleepExp).toBe(26400);
      expect(result.sleepResult.requiredDays).toBe(236);

      // 検証2: candyTarget が妥当な値
      expect(result.candyTarget).toBeGreaterThan(0);
      expect(result.candyTarget).toBeLessThan(result.targetBoostCandy + result.targetNormalCandy);

      // 検証3: planLevelUp が正常に実行された
      expect(result.pokemon).toBeDefined();
      expect(result.pokemon.candyTarget).toBe(result.candyTarget);

      // 検証4: 到達可能行のアメ数が candyTarget 以下
      const usedCandy = result.pokemon.reachableItems.boostCount + result.pokemon.reachableItems.normalCount;
      expect(usedCandy).toBeLessThanOrEqual(result.candyTarget);

      // 検証5: 残EXP (expToTarget) が sleepExp 以下（睡眠でカバー可能）
      expect(result.pokemon.expToTarget).toBeLessThanOrEqual(result.sleepResult.sleepExp);
    });

    it('Test9: 通常モード Lv30→50、1000hボタン', () => {
      // 通常モード（boostKind = none）でのテスト

      const result = simulateSleepGrowthButton({
        srcLevel: 30,
        dstLevel: 50,
        expType: 600,
        nature: 'normal',
        expRemaining: 100,
        boostKind: 'none',
        boostCandy: 0,  // 通常モードなのでアメブなし
        targetSleepHours: 1000,
        dailySleepHours: 8.5,
        sleepExpBonus: 1.0,
        includeGSD: true,
      });

      // 検証1: sleepExp が正しく計算されている
      expect(result.sleepResult.sleepExp).toBe(13000);

      // 検証2: 通常モードなのでアメブ使用なし
      expect(result.pokemon.reachableItems.boostCount).toBe(0);

      // 検証3: 残EXP が sleepExp 以下（失敗時に詳細出力）
      if (result.pokemon.expToTarget > result.sleepResult.sleepExp) {
        throw new Error(`expToTarget(${result.pokemon.expToTarget}) > sleepExp(${result.sleepResult.sleepExp})` +
          ` | candyTarget=${result.candyTarget}` +
          ` | reachedLevel=${result.pokemon.reachedLevel}` +
          ` | dstLevel=${result.pokemon.dstLevel}` +
          ` | targetNormalCandy=${result.targetNormalCandy}` +
          ` | usedCandy=${result.pokemon.reachableItems.normalCount}`);
      }
    });

    it('Test10: 睡眠EXPが十分な場合 candyTarget=0', () => {
      // 小さな目標で睡眠EXPが十分な場合

      const result = simulateSleepGrowthButton({
        srcLevel: 10,
        dstLevel: 12,  // 少ない目標
        expType: 600,
        nature: 'normal',
        expRemaining: 50,
        boostKind: 'none',
        boostCandy: 0,
        targetSleepHours: 2000,  // 十分な睡眠時間
        dailySleepHours: 8.5,
        sleepExpBonus: 1.0,
        includeGSD: true,
      });

      // 少ない目標なので candyTarget = 0
      expect(result.candyTarget).toBe(0);

      // 残EXP が sleepExp 以下
      expect(result.pokemon.expToTarget).toBeLessThanOrEqual(result.sleepResult.sleepExp);
    });

    it('Test11: 性格upで必要アメ数が減少', () => {
      // 性格upだと睡眠EXPが増えるため、必要アメ数が減る

      const normalResult = simulateSleepGrowthButton({
        srcLevel: 20,
        dstLevel: 40,
        expType: 600,
        nature: 'normal',
        expRemaining: 100,
        boostKind: 'mini',
        boostCandy: 200,
        targetSleepHours: 2000,
        dailySleepHours: 8.5,
        sleepExpBonus: 1.0,
        includeGSD: true,
      });

      const upResult = simulateSleepGrowthButton({
        srcLevel: 20,
        dstLevel: 40,
        expType: 600,
        nature: 'up',
        expRemaining: 100,
        boostKind: 'mini',
        boostCandy: 200,
        targetSleepHours: 2000,
        dailySleepHours: 8.5,
        sleepExpBonus: 1.0,
        includeGSD: true,
      });

      // 性格upでsleepExpが増加
      expect(upResult.sleepResult.sleepExp).toBeGreaterThan(normalResult.sleepResult.sleepExp);

      // 性格upでcandyTargetが減少（またはゼロ）
      expect(upResult.candyTarget).toBeLessThanOrEqual(normalResult.candyTarget);
    });

    it('Test12: 睡眠EXPボーナス5体で必要アメ数が減少', () => {
      // 睡眠EXPボーナス持ち5体（1.7倍）で必要アメ数が減る

      const noBonus = simulateSleepGrowthButton({
        srcLevel: 20,
        dstLevel: 40,
        expType: 600,
        nature: 'normal',
        expRemaining: 100,
        boostKind: 'mini',
        boostCandy: 200,
        targetSleepHours: 1000,
        dailySleepHours: 8.5,
        sleepExpBonus: 1.0,  // ボーナスなし
        includeGSD: true,
      });

      const maxBonus = simulateSleepGrowthButton({
        srcLevel: 20,
        dstLevel: 40,
        expType: 600,
        nature: 'normal',
        expRemaining: 100,
        boostKind: 'mini',
        boostCandy: 200,
        targetSleepHours: 1000,
        dailySleepHours: 8.5,
        sleepExpBonus: 1.7,  // 5体分（+70%）
        includeGSD: true,
      });

      // ボーナス5体でsleepExpが増加
      expect(maxBonus.sleepResult.sleepExp).toBeGreaterThan(noBonus.sleepResult.sleepExp);

      // ボーナス5体でcandyTargetが減少
      expect(maxBonus.candyTarget).toBeLessThanOrEqual(noBonus.candyTarget);
    });
  });
});
