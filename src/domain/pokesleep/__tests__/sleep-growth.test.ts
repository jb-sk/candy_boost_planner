/**
 * 睡眠育成機能のテスト
 *
 * @see .agent/sessions/残EXP睡眠時間の端数表示設計.md
 */

import { describe, expect, it } from 'vitest';
import type { BoostEvent, ExpGainNature } from '../../types';
import { calcExp, calcLevelByCandy } from '../exp';
import {
  calcApproximateGsdExtra,
  calcCandyTargetFromSleepExp,
  calcGsdExtraPerCycle,
  calcScoreFromMinutes,
  calcSleepExp,
  calcSleepExpForDays,
  calcSleepTimeForExp,
  markForSleep,
} from '../sleep-growth';
import {
  formatSleepTimeResult,
  type SleepTimeFormatTokens,
} from '../sleep-growth-format';

const jaTokens: SleepTimeFormatTokens = {
  hourUnit: '時間',
  minuteUnit: '分',
  dayUnit: '日',
  hourMinuteSeparator: '',
  rangeSeparator: ' ～ ',
  approximatePrefix: '約',
  estimateOpen: '（',
  estimateClose: '）',
};

const enTokens: SleepTimeFormatTokens = {
  hourUnit: 'h',
  minuteUnit: 'm',
  dayUnit: 'd',
  hourMinuteSeparator: ' ',
  rangeSeparator: '–',
  approximatePrefix: 'about ',
  estimateOpen: ' (',
  estimateClose: ')',
};

describe('睡眠EXP共通計算', () => {
  it('119分は不足、120～124分はスコア24、125分で増加する', () => {
    expect(calcScoreFromMinutes(119)).toBe(23);
    for (let minutes = 120; minutes <= 124; minutes++) {
      expect(calcScoreFromMinutes(minutes)).toBe(24);
      expect(calcSleepExp({
        sleepMinutes: minutes,
        sleepExpBonus: 1,
        nature: 'normal',
      })).toBe(24);
    }
    expect(calcScoreFromMinutes(125)).toBe(25);
  });

  it('GSD追加EXPは通常EXP 100で400、82で328になる', () => {
    expect(calcGsdExtraPerCycle({
      dailySleepMinutes: 510,
      sleepExpBonus: 1,
      nature: 'normal',
    })).toBe(400);
    expect(calcGsdExtraPerCycle({
      dailySleepMinutes: 420,
      sleepExpBonus: 1,
      nature: 'normal',
    })).toBe(328);
  });

  it('GSDの×1／×2／×3それぞれでボーナスと性格の丸め順を維持する', () => {
    expect(calcGsdExtraPerCycle({
      dailySleepMinutes: 510,
      sleepExpBonus: 1.14,
      nature: 'up',
    })).toBe(539);
    expect(calcGsdExtraPerCycle({
      dailySleepMinutes: 510,
      sleepExpBonus: 1,
      nature: 'down',
    })).toBe(328);
  });

  it('GSD概算は29.53日周期を使用する', () => {
    expect(calcApproximateGsdExtra({
      sessionDays: 29,
      dailySleepMinutes: 510,
      sleepExpBonus: 1,
      nature: 'normal',
    })).toBe(0);
    expect(calcApproximateGsdExtra({
      sessionDays: 30,
      dailySleepMinutes: 510,
      sleepExpBonus: 1,
      nature: 'normal',
    })).toBe(400);
  });
});

/**
 * ゲーム内実測との突き合わせ（外部妥当性）。
 *
 * 他のテストはコードの現在の挙動を固定しているだけなので、仕様の取り違えを検出できない。
 * ここだけは「ゲームでこう出た」という実測値を直接置く。
 *
 * 実測値の出どころは .agent/sessions/残EXP睡眠時間の端数表示設計.md §3.1 に記録している。
 */
describe('睡眠EXP: ゲーム内実測との一致', () => {
  /** スコアから逆算した睡眠分数（score = min(100, floor(分 / 5.1 + 0.5))） */
  function minutesForScore(score: number): number {
    for (let m = 0; m <= 780; m++) if (calcScoreFromMinutes(m) === score) return m;
    throw new Error(`no minutes for score ${score}`);
  }

  // 睡眠EXPボーナス×1（1.14）＋リサーチボーナス2倍。表示は「ボーナス x2.28」だが、
  // 2.28 を一括で掛けるのではなく 1.14 で四捨五入してから 2 倍する（式2）。
  // 一括だと 80→182.4、20→45.6、19→43.32 となり、実測の 46 / 44 を再現できない。
  it.each([
    { score: 80, exp: 182 },
    { score: 20, exp: 46 },
    { score: 19, exp: 44 },
  ])('スコア$score・ボーナス1.14×2倍で $exp EXP になる', ({ score, exp }) => {
    expect(calcSleepExp({
      sleepMinutes: minutesForScore(score),
      sleepExpBonus: 1 + 0.14,
      nature: 'normal',
      eventBonus: 2,
    })).toBe(exp);
  });

  // 性格補正は乗じた後に切り捨てる（182×0.82=149.24→149、182×1.18=214.76→214）。
  it.each([
    { score: 80, down: 149, up: 214 },
    { score: 20, down: 37, up: 54 },
    { score: 19, down: 36, up: 51 },
  ])('スコア$scoreの性格補正後は ▼▼$down / ▲▲$up になる', ({ score, down, up }) => {
    const shared = { sleepMinutes: minutesForScore(score), sleepExpBonus: 1 + 0.14, eventBonus: 2 };
    expect(calcSleepExp({ ...shared, nature: 'down' })).toBe(down);
    expect(calcSleepExp({ ...shared, nature: 'up' })).toBe(up);
  });

  // 成長のお香（EXP2倍）は四捨五入の「内側」に入る。イベント / リサーチとは段が違う。
  //
  //   1. score × 睡眠EXPボーナス(1.14…) × おこう2  → 四捨五入   ← おこうはここ
  //   2. × イベント / リサーチ（整数倍率）
  //   3. × 性格(82 or 118)/100                      → 切り捨て
  //
  // 2026-07-26 分（スコア95・x6.84 ＝ 1.14 × おこう2 × イベント3）と
  // 2026-07-27 分（スコア88・x2.28 ＝ 1.14 × おこう2、イベントなし）のゲーム内実測で確定した。
  // 7/27 分は整数倍率が ×2 ひとつしかないため、おこうを外側へ出す説（201 でなく 200 になる）を
  // 単独で否定できる。詳細は .agent/sessions/残EXP睡眠時間の端数表示設計.md §3.1。
  //
  // `incenseMultiplier` はまだ実装していない。ここでは「内側の倍率は sleepExpBonus と同じ段」
  // という構造だけを固定するため 1.14 × 2 を sleepExpBonus として渡す。新設したら
  // その引数へ書き換えること。eventBonus へ合流させると 651 / 201 の両方が落ちる。
  it.each([
    { day: '2026-07-26', score: 95, eventBonus: 3, exp: 651, down: 533 },
    { day: '2026-07-27', score: 88, eventBonus: 1, exp: 201, down: 164 },
  ])('$day 実測: スコア$score・おこう2で $exp EXP（▼▼ $down）になる', (
    { score, eventBonus, exp, down },
  ) => {
    const shared = { sleepMinutes: minutesForScore(score), sleepExpBonus: (1 + 0.14) * 2, eventBonus };
    expect(calcSleepExp({ ...shared, nature: 'normal' })).toBe(exp);
    expect(calcSleepExp({ ...shared, nature: 'down' })).toBe(down);
    // おこうを外側（eventBonus 側）へ移すと実測を再現できない
    expect(calcSleepExp({
      sleepMinutes: minutesForScore(score),
      sleepExpBonus: 1 + 0.14,
      nature: 'normal',
      eventBonus: eventBonus * 2,
    })).not.toBe(exp);
  });

  // スコア1の睡眠は 1 EXP。EXP▼▼ では floor(1 × 0.82) = 0 となり、あとEXPが動かない。
  it('スコア1の睡眠は EXP▼▼ では 0 EXP になる', () => {
    const sleepMinutes = minutesForScore(1);
    expect(calcSleepExp({ sleepMinutes, sleepExpBonus: 1, nature: 'normal' })).toBe(1);
    expect(calcSleepExp({ sleepMinutes, sleepExpBonus: 1, nature: 'down' })).toBe(0);
  });

  // 性格補正を 0.82 / 1.18 として直接乗算すると、浮動小数の誤差で 1 少なくなる値がある
  //（例: 300 × 0.82 → 245.999... → 245）。百分率の整数で計算していることを固定する。
  it('性格補正は百分率の整数で計算する（直接乗算だと切り捨てが1ずれる）', () => {
    const atScore100 = (nature: 'down' | 'up', eventBonus: number) =>
      calcSleepExp({ sleepMinutes: minutesForScore(100), sleepExpBonus: 1, nature, eventBonus });
    // 素の値 300（スコア100 × イベント3倍）は直接乗算だと 245 になる
    expect(atScore100('down', 3)).toBe(246);
    expect(Math.floor(300 * 0.82)).toBe(245);
  });

  // 四捨五入の段（スコア × 睡眠EXPボーナス）でも、浮動小数が .5 を下振れさせないことを
  // 入力の全域（ボーナス個数 0〜5 × スコア 0〜100）で確認する。
  it('スコア×ボーナスの四捨五入が全入力で整数計算と一致する', () => {
    for (let count = 0; count <= 5; count++) {
      for (let score = 0; score <= 100; score++) {
        expect(Math.round(score * (1 + 0.14 * count)), `bonusCount=${count} score=${score}`)
          .toBe(Math.round((score * (100 + 14 * count)) / 100));
      }
    }
  });
});

describe('markForSleep の内訳（?perf=1 の検算用）', () => {
  const cases = [
    { label: '13h / down / GSDあり', hours: 500, nature: 'down' as const, dailySleepHours: 13, sleepExpBonus: 1, includeGSD: true },
    { label: '8.5h / normal / GSDなし', hours: 1000, nature: 'normal' as const, dailySleepHours: 8.5, sleepExpBonus: 1, includeGSD: false },
    { label: '6h / up / ボーナスあり', hours: 200, nature: 'up' as const, dailySleepHours: 6, sleepExpBonus: 1.28, includeGSD: true },
    { label: '0h', hours: 0, nature: 'normal' as const, dailySleepHours: 8.5, sleepExpBonus: 1, includeGSD: true },
  ];

  it.each(cases)('$label: 内訳の合計が睡眠EXPと一致する（1日EXP × 日数 + GSD）', (c) => {
    const r = markForSleep({ targetSleepHours: c.hours, nature: c.nature, dailySleepHours: c.dailySleepHours, sleepExpBonus: c.sleepExpBonus, includeGSD: c.includeGSD });
    expect(r.breakdown.dailyExp * r.requiredDays + r.breakdown.gsdExtra).toBe(r.sleepExp);
  });

  it('性格補正が1日の睡眠EXPへ現れる（13h設定・スコア100）', () => {
    const at = (nature: 'up' | 'normal' | 'down') =>
      markForSleep({ targetSleepHours: 500, nature, dailySleepHours: 13, sleepExpBonus: 1, includeGSD: true });

    // 8.5hでスコア100に達するため、13h設定でもスコアは100で頭打ち
    expect(at('normal').breakdown.dailyScore).toBe(100);
    expect(at('normal').breakdown.dailyExp).toBe(100);
    expect(at('down').breakdown.dailyExp).toBe(82);
    expect(at('up').breakdown.dailyExp).toBe(118);

    // 500h ÷ 13h = 38.46日 → 39日へ切り上げ
    expect(at('down').requiredDays).toBe(39);
    expect(at('down').breakdown.gsdExtra).toBe(328);
    expect(at('down').sleepExp).toBe(82 * 39 + 328);
  });

  it('GSDをオフにすると加算が消え、切り分けに使える', () => {
    const params = { targetSleepHours: 500, nature: 'down' as const, dailySleepHours: 13, sleepExpBonus: 1 };
    expect(markForSleep({ ...params, includeGSD: false }).breakdown.gsdExtra).toBe(0);
    expect(markForSleep({ ...params, includeGSD: false }).sleepExp).toBe(82 * 39);
  });
});

describe('markForSleep', () => {
  it('0hなら0日・0EXP', () => {
    expect(markForSleep({
      targetSleepHours: 0,
      nature: 'normal',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      includeGSD: true,
    })).toMatchObject({
      sleepExp: 0,
      requiredDays: 0,
    });
  });

  it.each([
    { hours: 1000, requiredDays: 118, offExp: 11800, onExp: 13000 },
    { hours: 2000, requiredDays: 236, offExp: 23600, onExp: 26400 },
  ])('$hours hを8.5h単位の整数日へ切り上げる', ({ hours, requiredDays, offExp, onExp }) => {
    const base = {
      targetSleepHours: hours,
      nature: 'normal' as const,
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
    };
    const off = markForSleep({ ...base, includeGSD: false });
    const on = markForSleep({ ...base, includeGSD: true });

    expect(off).toMatchObject({ requiredDays, sleepExp: offExp });
    expect(on.sleepExp).toBe(onExp);
  });

  it.each([
    { hours: 5 },
    { hours: 1 },
  ])('残り$hours hも設定睡眠時間1日へ切り上げる', ({ hours }) => {
    const result = markForSleep({
      targetSleepHours: hours,
      nature: 'normal',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      includeGSD: false,
    });
    expect(result).toMatchObject({ requiredDays: 1, sleepExp: 100 });
  });

  it.each([
    { dailySleepHours: 13, targetHours: 1000, requiredDays: 77, totalHours: 1001 },
    { dailySleepHours: 13, targetHours: 2000, requiredDays: 154, totalHours: 2002 },
    { dailySleepHours: 8.5, targetHours: 1000, requiredDays: 118, totalHours: 1003 },
    { dailySleepHours: 7, targetHours: 1000, requiredDays: 143, totalHours: 1001 },
  ])(
    '$targetHours hを$dailySleepHours h設定で切り上げても余分な1日を追加しない',
    ({ dailySleepHours, targetHours, requiredDays, totalHours }) => {
      const result = markForSleep({
        targetSleepHours: targetHours,
        nature: 'normal',
        dailySleepHours,
        sleepExpBonus: 1,
        includeGSD: true,
      });
      expect(result.requiredDays).toBe(requiredDays);
      expect(result.requiredDays * dailySleepHours).toBe(totalHours);
    }
  );

  it('GSDと性格補正も切り上げた日数の共通計算を使用する', () => {
    const result = markForSleep({
      targetSleepHours: 1000,
      nature: 'down',
      dailySleepHours: 13,
      sleepExpBonus: 1,
      includeGSD: true,
    });
    expect(result).toMatchObject({
      requiredDays: 77,
      sleepExp: 6970,
    });
  });

  it('整数日境界では日単位概算と一致する', () => {
    const days = 60;
    const mark = markForSleep({
      targetSleepHours: days * 8.5,
      nature: 'up',
      dailySleepHours: 8.5,
      sleepExpBonus: 1.28,
      includeGSD: true,
    });
    const daily = calcSleepExpForDays({
      days,
      dailySleepMinutes: 510,
      nature: 'up',
      sleepExpBonus: 1.28,
      includeGSD: true,
    });
    expect(mark.requiredDays).toBe(days);
    expect(mark.sleepExp).toBe(daily);
  });
});

describe('calcSleepTimeForExp', () => {
  it('残EXP 24は120～124分の1回睡眠結果になる（GSDは不使用）', () => {
    const result = calcSleepTimeForExp({
      expToTarget: 24,
      nature: 'normal',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      includeGSD: true,
    });
    expect(result).toEqual({
      kind: 'within-one-sleep',
      requiredScore: 24,
      minutesMin: 120,
      minutesMax: 124,
    });
  });

  it('通常1日EXPと同値は1回睡眠、1超過は長期概算になる', () => {
    expect(calcSleepTimeForExp({
      expToTarget: 100,
      nature: 'normal',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      includeGSD: false,
    })).toMatchObject({ kind: 'within-one-sleep', minutesMin: 508, minutesMax: 510 });
    expect(calcSleepTimeForExp({
      expToTarget: 101,
      nature: 'normal',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      includeGSD: false,
    })).toEqual({ kind: 'long-term-estimate', requiredDays: 2, totalMinutes: 1020 });
  });

  it('13hではスコア100の上限を設定睡眠時間まで伸ばす', () => {
    expect(calcSleepTimeForExp({
      expToTarget: 100,
      nature: 'normal',
      dailySleepHours: 13,
      sleepExpBonus: 1,
      includeGSD: true,
    })).toMatchObject({ kind: 'within-one-sleep', minutesMin: 508, minutesMax: 780 });
  });

  it('EXP性格と睡眠EXPボーナスを時間幅へ反映する', () => {
    expect(calcSleepTimeForExp({
      expToTarget: 24,
      nature: 'down',
      dailySleepHours: 7,
      sleepExpBonus: 1,
      includeGSD: false,
    })).toMatchObject({ kind: 'within-one-sleep', minutesMin: 151, minutesMax: 155 });
    expect(calcSleepTimeForExp({
      expToTarget: 24,
      nature: 'normal',
      dailySleepHours: 7,
      sleepExpBonus: 1.14,
      includeGSD: false,
    })).toMatchObject({ kind: 'within-one-sleep', minutesMin: 105, minutesMax: 109 });
  });

  it.each([
    { dailySleepHours: 13, requiredDays: 114, totalMinutes: 114 * 780 },
    { dailySleepHours: 8.5, requiredDays: 114, totalMinutes: 114 * 510 },
    { dailySleepHours: 7, requiredDays: 137, totalMinutes: 137 * 420 },
  ])('残EXP 12,514・$dailySleepHours hの長期概算', ({ dailySleepHours, requiredDays, totalMinutes }) => {
    expect(calcSleepTimeForExp({
      expToTarget: 12514,
      nature: 'normal',
      dailySleepHours,
      sleepExpBonus: 1,
      includeGSD: true,
    })).toEqual({ kind: 'long-term-estimate', requiredDays, totalMinutes });
  });

  it('GSDオフでは長期概算へGSDを加えない', () => {
    expect(calcSleepTimeForExp({
      expToTarget: 12514,
      nature: 'normal',
      dailySleepHours: 7,
      sleepExpBonus: 1,
      includeGSD: false,
    })).toMatchObject({ kind: 'long-term-estimate', requiredDays: 153 });
  });

  it('残EXPなしと計算不能を判別し、非有限値を返さない', () => {
    expect(calcSleepTimeForExp({
      expToTarget: 0,
      nature: 'normal',
    })).toEqual({ kind: 'none' });
    for (const params of [
      { expToTarget: Number.NaN, dailySleepHours: 8.5, sleepExpBonus: 1 },
      { expToTarget: Number.POSITIVE_INFINITY, dailySleepHours: 8.5, sleepExpBonus: 1 },
      { expToTarget: 100, dailySleepHours: 0, sleepExpBonus: 1 },
      { expToTarget: 100, dailySleepHours: 8.5, sleepExpBonus: 0 },
    ]) {
      expect(calcSleepTimeForExp({
        ...params,
        nature: 'normal',
      })).toEqual({ kind: 'unavailable' });
    }
  });
});

describe('睡眠時間表示', () => {
  it.each([
    { min: 120, max: 124, ja: '2時間0分 ～ 4分', en: '2h 0m–4m' },
    { min: 59, max: 63, ja: '59分 ～ 1時間3分', en: '59m–1h 3m' },
    { min: 176, max: 181, ja: '2時間56分 ～ 3時間1分', en: '2h 56m–3h 1m' },
    { min: 59, max: 59, ja: '59分', en: '59m' },
  ])('$ja / $en', ({ min, max, ja, en }) => {
    const result = {
      kind: 'within-one-sleep' as const,
      requiredScore: 1,
      minutesMin: min,
      minutesMax: max,
    };
    expect(formatSleepTimeResult(result, jaTokens)).toBe(ja);
    expect(formatSleepTimeResult(result, enTokens)).toBe(en);
  });

  it('長期概算は先頭だけ概算表記を付け、0分を省略する', () => {
    expect(formatSleepTimeResult({
      kind: 'long-term-estimate',
      requiredDays: 114,
      totalMinutes: 969 * 60,
    }, jaTokens)).toBe('約114日（969時間）');
    expect(formatSleepTimeResult({
      kind: 'long-term-estimate',
      requiredDays: 115,
      totalMinutes: 977 * 60 + 30,
    }, jaTokens)).toBe('約115日（977時間30分）');
    expect(formatSleepTimeResult({
      kind: 'long-term-estimate',
      requiredDays: 114,
      totalMinutes: 969 * 60,
    }, enTokens)).toBe('about 114d (969h)');
  });
});

describe('calcCandyTargetFromSleepExp', () => {
  const base = {
    srcLevel: 1,
    dstLevel: 20,
    expType: 600 as const,
    nature: 'normal' as const,
    boostKind: 'none' as const,
    targetBoostCandy: 0,
    targetNormalCandy: 1000,
    expGot: 0,
    dstExpInLevel: 0,
  };

  function remainingAfterCandy(params: {
    candy: number;
    srcLevel?: number;
    dstLevel?: number;
    nature?: ExpGainNature;
    boost?: BoostEvent;
  }): number {
    const srcLevel = params.srcLevel ?? base.srcLevel;
    const dstLevel = params.dstLevel ?? base.dstLevel;
    const nature = params.nature ?? base.nature;
    const boost = params.boost ?? 'none';
    return calcLevelByCandy({
      srcLevel,
      dstLevel,
      expType: 600,
      nature,
      boost,
      candy: params.candy,
    }).expLeft;
  }

  function remainingAfterMixedCandy(params: {
    candy: number;
    boostCandy: number;
    srcLevel?: number;
    dstLevel?: number;
    dstExpInLevel?: number;
    expGot?: number;
    nature?: ExpGainNature;
    boost?: Exclude<BoostEvent, 'none'>;
  }): number {
    const srcLevel = params.srcLevel ?? base.srcLevel;
    const dstLevel = params.dstLevel ?? base.dstLevel;
    const dstExpInLevel = params.dstExpInLevel ?? 0;
    const expGot = params.expGot ?? 0;
    const nature = params.nature ?? base.nature;
    const boost = params.boost ?? 'full';
    const boostToUse = Math.min(params.boostCandy, params.candy);
    const afterBoost = calcLevelByCandy({
      srcLevel,
      dstLevel,
      dstExpInLevel,
      expType: 600,
      nature,
      boost,
      candy: boostToUse,
      expGot,
    });
    if (boostToUse === params.candy) return afterBoost.expLeft;

    return calcLevelByCandy({
      srcLevel: afterBoost.level,
      dstLevel,
      dstExpInLevel,
      expType: 600,
      nature,
      boost: 'none',
      candy: params.candy - boostToUse,
      expGot: afterBoost.expGot,
    }).expLeft;
  }

  it('切り上げ日数ぶんの睡眠EXPで届く最小アメ数を選ぶ', () => {
    const candy = 10;
    const targetSleepExp = remainingAfterCandy({ candy });
    const selected = calcCandyTargetFromSleepExp({
      ...base,
      sleepExp: targetSleepExp,
    });
    expect(selected).toBe(candy);
    expect(remainingAfterCandy({ candy: selected })).toBeLessThanOrEqual(targetSleepExp);
    expect(remainingAfterCandy({ candy: selected - 1 })).toBeGreaterThan(targetSleepExp);
  });

  it('切り上げ日数ぶんの睡眠EXPだけで届く場合は0個を返す', () => {
    const expNeed = calcExp(base.srcLevel, base.dstLevel, base.expType);
    expect(calcCandyTargetFromSleepExp({
      ...base,
      sleepExp: expNeed,
    })).toBe(0);
  });

  it.each([
    { nature: 'up' as const, boost: 'none' as const },
    { nature: 'down' as const, boost: 'mini' as const },
    { nature: 'normal' as const, boost: 'full' as const },
  ])('レベル跨ぎ・性格$nature・$boostでも単調境界を選ぶ', ({ nature, boost }) => {
    const srcLevel = 24;
    const dstLevel = 35;
    const candy = 20;
    const sleepExp = remainingAfterCandy({
      candy,
      srcLevel,
      dstLevel,
      nature,
      boost,
    });
    const selected = calcCandyTargetFromSleepExp({
      srcLevel,
      dstLevel,
      expType: 600,
      nature,
      boostKind: boost,
      targetBoostCandy: boost === 'none' ? 0 : 1000,
      targetNormalCandy: boost === 'none' ? 1000 : 0,
      sleepExp,
    });
    expect(selected).toBe(candy);
    expect(remainingAfterCandy({
      candy: selected,
      srcLevel,
      dstLevel,
      nature,
      boost,
    })).toBeLessThanOrEqual(sleepExp);
    expect(remainingAfterCandy({
      candy: selected - 1,
      srcLevel,
      dstLevel,
      nature,
      boost,
    })).toBeGreaterThan(sleepExp);
  });

  it('アメブ上限の次の1個を通常アメとして選べる', () => {
    const boostCandy = 5;
    const expectedCandy = boostCandy + 1;
    const sleepExp = remainingAfterMixedCandy({
      candy: expectedCandy,
      boostCandy,
      srcLevel: 24,
      dstLevel: 35,
      nature: 'normal',
      boost: 'full',
    });
    const selected = calcCandyTargetFromSleepExp({
      srcLevel: 24,
      dstLevel: 35,
      expType: 600,
      nature: 'normal',
      boostKind: 'full',
      targetBoostCandy: boostCandy,
      targetNormalCandy: 1000,
      sleepExp,
    });

    expect(selected).toBe(expectedCandy);
    expect(Math.min(boostCandy, selected)).toBe(5);
    expect(selected - Math.min(boostCandy, selected)).toBe(1);
    expect(remainingAfterMixedCandy({
      candy: selected - 1,
      boostCandy,
      srcLevel: 24,
      dstLevel: 35,
      nature: 'normal',
      boost: 'full',
    })).toBeGreaterThan(sleepExp);
  });

  it('現在EXP・目標Lv内EXP・アメブと通常アメの混在でも最小境界を保つ', () => {
    const params = {
      boostCandy: 7,
      srcLevel: 29,
      dstLevel: 35,
      dstExpInLevel: 321,
      expGot: 87,
      nature: 'down' as const,
      boost: 'mini' as const,
    };
    const expectedCandy = 18;
    const sleepExp = remainingAfterMixedCandy({
      ...params,
      candy: expectedCandy,
    });
    const selected = calcCandyTargetFromSleepExp({
      srcLevel: params.srcLevel,
      dstLevel: params.dstLevel,
      dstExpInLevel: params.dstExpInLevel,
      expType: 600,
      nature: params.nature,
      boostKind: params.boost,
      targetBoostCandy: params.boostCandy,
      targetNormalCandy: 1000,
      sleepExp,
      expGot: params.expGot,
    });

    expect(selected).toBe(expectedCandy);
    expect(remainingAfterMixedCandy({ ...params, candy: selected })).toBeLessThanOrEqual(sleepExp);
    expect(remainingAfterMixedCandy({ ...params, candy: selected - 1 })).toBeGreaterThan(sleepExp);
  });
});
