/**
 * 睡眠育成機能のテスト
 *
 * @see .agent/sessions/残EXP睡眠時間の端数表示設計.md
 */

import { describe, expect, it } from 'vitest';
import type { BoostEvent, ExpGainNature } from '../../types';
import { calcExp, calcLevelByCandy } from '../exp';
import {
  attributeSleepBonusExpByNight,
  attributeSleepBonusExpForDays,
  calcCandyTargetFromSleepExp,
  calcScoreFromMinutes,
  calcSleepExp,
  calcSleepExpBreakdownForDays,
  calcSleepExpForDays,
  calcSleepTimeForExp,
  MAX_SLEEP_PLANNING_DAYS,
  markForSleep,
} from '../sleep-growth';
import { addGameDays, type GameDate } from '../game-date';
import type { SleepSchedule, SleepScheduleDay } from '../sleep-schedule';
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
  exactDayJoiner: 'と',
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
  exactDayJoiner: ' + ',
  approximatePrefix: 'about ',
  estimateOpen: ' (',
  estimateClose: ')',
};

function makeSchedule(
  includeGSD: boolean,
  incenseDays: ReadonlySet<number> = new Set(),
  eventMultipliers: ReadonlyMap<number, number> = new Map(),
  explicitGsdMultipliers: ReadonlyMap<number, 1 | 2 | 3> = new Map(),
): SleepSchedule {
  const startGameDate = '2026-01-01' as GameDate;

  function dayAt(index: number): SleepScheduleDay {
    const fullMoon = includeGSD && index >= 29 && (index - 29) % 30 === 0;
    const flank = includeGSD && (
      (index >= 28 && (index - 28) % 30 === 0)
      || (index >= 30 && (index - 30) % 30 === 0)
    );
    const scheduledGsdMultiplier = fullMoon ? 3 : flank ? 2 : 1;
    const gsdMultiplier = explicitGsdMultipliers.get(index) ?? scheduledGsdMultiplier;
    const dayKind = gsdMultiplier === 3 ? 'fullMoon' : gsdMultiplier === 2 ? 'flank' : 'normal';
    const useIncense = incenseDays.has(index);
    const eventMultiplier = eventMultipliers.get(index) ?? 1;
    return {
      index,
      date: addGameDays(startGameDate, index),
      dayKind,
      useIncense,
      incenseOutOfStock: false,
      gsdMultiplier,
      eventMultiplier,
      eventBonus: Math.max(gsdMultiplier, eventMultiplier),
      incenseMultiplier: useIncense ? 2 : 1,
    };
  }

  return {
    startGameDate,
    timeZone: 'Asia/Tokyo',
    includeGSD,
    growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
    growthIncenseNormalPerWeek: 0,
    growthIncenseStock: null,
    dayAt,
    days: count => Array.from({ length: Math.max(0, Math.floor(count)) }, (_, index) => dayAt(index)),
    intersectingFullMoonDates: count => Array.from(
      { length: Math.max(0, Math.floor((count + 1) / 30)) },
      (_, index) => addGameDays(startGameDate, 29 + index * 30),
    ).filter(date => date <= addGameDays(startGameDate, count)),
  };
}

const normalSchedule = makeSchedule(false);
const gsdSchedule = makeSchedule(true);

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

  it('満月前後3日を日別に加算し、性格補正後の内訳と合計を保つ', () => {
    const normal = calcSleepExpBreakdownForDays({
      days: 31,
      dailySleepMinutes: 510,
      sleepExpBonus: 1,
      nature: 'normal',
      schedule: gsdSchedule,
    });
    expect(normal).toMatchObject({
      baseExp: 3100,
      outerBonusExtra: 400,
      incenseExtra: 0,
      normalDays: 28,
      flankDays: 2,
      fullMoonDays: 1,
      sleepExp: 3500,
    });

    const down = calcSleepExpBreakdownForDays({
      days: 31,
      dailySleepMinutes: 510,
      sleepExpBonus: 1,
      nature: 'down',
      schedule: gsdSchedule,
    });
    expect(down.outerBonusExtra).toBe(328);
    expect(down.sleepExp).toBe(82 * 31 + 328);
  });

  it('成長のお香の追加EXPと使用日種別を内訳へ分離する', () => {
    const result = calcSleepExpBreakdownForDays({
      days: 31,
      dailySleepMinutes: 510,
      sleepExpBonus: 1,
      nature: 'normal',
      schedule: makeSchedule(true, new Set([29])),
    });
    expect(result).toMatchObject({
      baseExp: 3100,
      outerBonusExtra: 400,
      incenseExtra: 300,
      fullMoonIncenseDays: 1,
      sleepExp: 3800,
    });
  });

  // outerBonusExtra は「外側の倍率ぶん」であって「GSDぶん」ではない。
  // 旧名 gsdExtra のままだと、イベント倍率しかない日の追加EXPが GSD の寄与に見えてしまう。
  it('GSDが無くてもイベント倍率ぶんは outerBonusExtra に入る', () => {
    const result = calcSleepExpBreakdownForDays({
      days: 10,
      dailySleepMinutes: 510,
      sleepExpBonus: 1,
      nature: 'normal',
      // GSDなし。3日目・4日目だけイベント1.5倍
      schedule: makeSchedule(false, new Set(), new Map([[2, 1.5], [3, 1.5]])),
    });
    expect(result).toMatchObject({
      baseExp: 1000,
      // floor(100 × 1.5) - 100 = 50 が2日ぶん
      outerBonusExtra: 100,
      incenseExtra: 0,
      normalDays: 10,
      flankDays: 0,
      fullMoonDays: 0,
      sleepExp: 1100,
    });
  });

  // GSDとイベントが重なる日は max。二重加算されない。
  it('GSD前後日(×2)とイベント(×1.5)が重なる日は大きい方だけが効く', () => {
    const overlapped = calcSleepExpBreakdownForDays({
      days: 31,
      dailySleepMinutes: 510,
      sleepExpBonus: 1,
      nature: 'normal',
      // index 28 は flank(×2)。そこへイベント1.5倍を重ねる
      schedule: makeSchedule(true, new Set(), new Map([[28, 1.5]])),
    });
    const gsdOnly = calcSleepExpBreakdownForDays({
      days: 31,
      dailySleepMinutes: 510,
      sleepExpBonus: 1,
      nature: 'normal',
      schedule: gsdSchedule,
    });
    expect(overlapped.outerBonusExtra).toBe(gsdOnly.outerBonusExtra);
  });

  it('公開prefix APIも仕様から導いた最大日数を超える入力を拒否する', () => {
    expect(() => calcSleepExpForDays({
      days: Number.MAX_SAFE_INTEGER,
      dailySleepMinutes: 60,
      sleepExpBonus: 1,
      nature: 'down',
      schedule: normalSchedule,
    })).toThrow(/sleep day count/);
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
  // 2026-07-26（満月3倍）・07-27（イベントなし）・07-28（GSD前後2倍）の
  // ゲーム内実測で確定した。
  // 7/27 分は整数倍率が ×2 ひとつしかないため、おこうを外側へ出す説（201 でなく 200 になる）を
  // 単独で否定できる。詳細は .agent/sessions/残EXP睡眠時間の端数表示設計.md §3.1。
  //
  it.each([
    { day: '2026-07-26', score: 95, eventBonus: 3, exp: 651, down: 533 },
    { day: '2026-07-27', score: 88, eventBonus: 1, exp: 201, down: 164 },
    { day: '2026-07-28', score: 95, eventBonus: 2, exp: 434, down: 355 },
  ])('$day 実測: スコア$score・おこう2で $exp EXP（▼▼ $down）になる', (
    { score, eventBonus, exp, down },
  ) => {
    const shared = { sleepMinutes: minutesForScore(score), sleepExpBonus: 1 + 0.14, incenseMultiplier: 2, eventBonus };
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

  // 2026-08-20 実測: イベント「アニポケコラボウィーク」の睡眠EXP ×1.25（非整数の外側倍率）。
  // スコア84・おこう2・表示 x2.85 で素EXP 240、▼▼ 196 だった。
  //
  //   round(84 × 1.14 × 2) = 192 → × 1.25 = 240        （外側。実測と一致）
  //   round(84 × 1.14 × 2 × 1.25) = round(239.4) = 239 （内側。実測と不一致）
  //
  // これで「イベント倍率は四捨五入の外側」が非整数倍でも確かめられた。
  //
  // ⚠ このケースは外側の丸め方（round / floor）は区別しない。192 × 1.25 = 240 が整数なので
  //   どちらでも 240 になる。丸め方は翌日（2026-08-21）の実測で確定した。次のテストを参照。
  it('2026-08-20 実測: スコア84・おこう2・イベント1.25倍で 240 EXP（▼▼ 196）になる', () => {
    const shared = {
      sleepMinutes: minutesForScore(84),
      sleepExpBonus: 1 + 0.14,
      incenseMultiplier: 2,
      eventBonus: 1.25,
    } as const;
    expect(calcSleepExp({ ...shared, nature: 'normal' })).toBe(240);
    expect(calcSleepExp({ ...shared, nature: 'down' })).toBe(196);
    // イベント倍率を内側（おこうと同じ段）へ移すと実測を再現できない
    expect(calcSleepExp({
      sleepMinutes: minutesForScore(84),
      sleepExpBonus: 1 + 0.14,
      nature: 'normal',
      incenseMultiplier: 2 * 1.25,
    })).not.toBe(240);
  });

  // 2026-08-21 実測: 外側の倍率は掛けたあと「切り捨て」。四捨五入ではない。
  // スコア92・おこう2・イベント1.25倍・表示 x2.85 で素EXP 262、▼▼ 214 だった。
  //
  //   round(92 × 1.14 × 2) = round(209.76) = 210 → × 1.25 = 262.5
  //     切り捨て: 262（実測と一致）        四捨五入: 263（不一致）
  //
  // ▼▼ でも裏が取れている: floor(262 × 82 / 100) = 214。四捨五入なら floor(263 × 0.82) = 215。
  //
  // ⚠ 端数を丸めずに性格補正へ持ち越すと ▼▼ が floor(262.5 × 0.82) = 215 になり実測と合わない。
  //   「差は ±1 だから」で丸めを省くと ▲▲/▼▼ 個体でずれる。
  it('2026-08-21 実測: スコア92・おこう2・イベント1.25倍で 262 EXP（▼▼ 214）になる', () => {
    const shared = {
      sleepMinutes: minutesForScore(92),
      sleepExpBonus: 1 + 0.14,
      incenseMultiplier: 2,
      eventBonus: 1.25,
    } as const;
    expect(calcSleepExp({ ...shared, nature: 'normal' })).toBe(262);
    expect(calcSleepExp({ ...shared, nature: 'down' })).toBe(214);
  });

  // 2026-08-28 実測: GSD満月日の ×3 も四捨五入の「外側」。前後日 ×2 と同じ段だった。
  // スコア91・おこう2・表示 x6.84 で素EXP 621、▼▼ 509 だった。
  //
  //   round(91 × 1.14 × 2) = round(207.48) = 207 → × 3 = 621   （外側。実測と一致）
  //   round(91 × 1.14 × 2 × 3) = round(622.44)   = 622          （内側。実測と不一致）
  //
  // ▼▼ でも裏が取れている: floor(621 × 82 / 100) = 509。内側なら floor(622 × 0.82) = 510。
  it('2026-08-28 実測: スコア91・おこう2・GSD満月3倍で 621 EXP（▼▼ 509）になる', () => {
    const shared = {
      sleepMinutes: minutesForScore(91),
      sleepExpBonus: 1 + 0.14,
      incenseMultiplier: 2,
      eventBonus: 3,
    } as const;
    expect(calcSleepExp({ ...shared, nature: 'normal' })).toBe(621);
    expect(calcSleepExp({ ...shared, nature: 'down' })).toBe(509);
    // 満月の ×3 を内側（おこうと同じ段）へ移すと実測を再現できない
    expect(calcSleepExp({
      sleepMinutes: minutesForScore(91),
      sleepExpBonus: 1 + 0.14,
      nature: 'normal',
      incenseMultiplier: 2 * 3,
    })).not.toBe(621);
  });

  // 外側の丸めは「切り捨て」であって四捨五入ではない、を単独で固定する。
  // 210 × 1.25 = 262.5 は .5 ちょうどなので、round なら 263 へ上がってしまう。
  it('外側の倍率の端数は切り捨てる（.5 でも切り上げない）', () => {
    const exp = calcSleepExp({
      sleepMinutes: minutesForScore(92),
      sleepExpBonus: 1 + 0.14,
      incenseMultiplier: 2,
      eventBonus: 1.25,
      nature: 'normal',
    });
    expect(exp).toBe(Math.floor(210 * 1.25));
    expect(exp).not.toBe(Math.round(210 * 1.25));
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
    { label: '13h / down / GSDあり', hours: 500, nature: 'down' as const, dailySleepHours: 13, sleepExpBonus: 1, schedule: gsdSchedule },
    { label: '8.5h / normal / GSDなし', hours: 1000, nature: 'normal' as const, dailySleepHours: 8.5, sleepExpBonus: 1, schedule: normalSchedule },
    { label: '6h / up / ボーナスあり', hours: 200, nature: 'up' as const, dailySleepHours: 6, sleepExpBonus: 1.28, schedule: gsdSchedule },
    { label: '0h', hours: 0, nature: 'normal' as const, dailySleepHours: 8.5, sleepExpBonus: 1, schedule: gsdSchedule },
  ];

  it.each(cases)('$label: 内訳の合計が睡眠EXPと一致する（1日EXP × 日数 + GSD）', (c) => {
    const r = markForSleep({ targetSleepHours: c.hours, nature: c.nature, dailySleepHours: c.dailySleepHours, sleepExpBonus: c.sleepExpBonus, schedule: c.schedule });
    expect(r.breakdown.dailyExp * r.requiredDays + r.breakdown.outerBonusExtra).toBe(r.sleepExp);
  });

  it('性格補正が1日の睡眠EXPへ現れる（13h設定・スコア100）', () => {
    const at = (nature: 'up' | 'normal' | 'down') =>
      markForSleep({ targetSleepHours: 500, nature, dailySleepHours: 13, sleepExpBonus: 1, schedule: gsdSchedule });

    // 8.5hでスコア100に達するため、13h設定でもスコアは100で頭打ち
    expect(at('normal').breakdown.dailyScore).toBe(100);
    expect(at('normal').breakdown.dailyExp).toBe(100);
    expect(at('down').breakdown.dailyExp).toBe(82);
    expect(at('up').breakdown.dailyExp).toBe(118);

    // 500h ÷ 13h = 38.46日 → 39日へ切り上げ
    expect(at('down').requiredDays).toBe(39);
    expect(at('down').breakdown.outerBonusExtra).toBe(328);
    expect(at('down').sleepExp).toBe(82 * 39 + 328);
  });

  it('GSDをオフにすると加算が消え、切り分けに使える', () => {
    const params = { targetSleepHours: 500, nature: 'down' as const, dailySleepHours: 13, sleepExpBonus: 1 };
    expect(markForSleep({ ...params, schedule: normalSchedule }).breakdown.outerBonusExtra).toBe(0);
    expect(markForSleep({ ...params, schedule: normalSchedule }).sleepExp).toBe(82 * 39);
  });
});

describe('markForSleep', () => {
  it('0hなら0日・0EXP', () => {
    expect(markForSleep({
      targetSleepHours: 0,
      nature: 'normal',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      schedule: gsdSchedule,
    })).toMatchObject({
      sleepExp: 0,
      requiredDays: 0,
    });
  });

  it.each([
    { targetSleepHours: 2001, dailySleepHours: 8.5, sleepExpBonus: 1 },
    { targetSleepHours: Number.MAX_SAFE_INTEGER, dailySleepHours: 8.5, sleepExpBonus: 1 },
    { targetSleepHours: 200, dailySleepHours: 0.5, sleepExpBonus: 1 },
    { targetSleepHours: 200, dailySleepHours: 8.5, sleepExpBonus: 1.71 },
  ])('保存・設定範囲外の入力では巨大な日別配列を作らない', (params) => {
    expect(markForSleep({
      ...params,
      nature: 'normal',
      schedule: normalSchedule,
    })).toMatchObject({ requiredDays: 0, sleepExp: 0 });
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
    const off = markForSleep({ ...base, schedule: normalSchedule });
    const on = markForSleep({ ...base, schedule: gsdSchedule });

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
      schedule: normalSchedule,
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
        schedule: gsdSchedule,
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
      schedule: gsdSchedule,
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
      schedule: gsdSchedule,
    });
    const daily = calcSleepExpForDays({
      days,
      dailySleepMinutes: 510,
      nature: 'up',
      sleepExpBonus: 1.28,
      schedule: gsdSchedule,
    });
    expect(mark.requiredDays).toBe(days);
    expect(mark.sleepExp).toBe(daily);
  });
});

describe('calcSleepTimeForExp', () => {
  it('1回睡眠の到達判定にも初日のお香を反映する', () => {
    expect(calcSleepTimeForExp({
      expToTarget: 150,
      nature: 'normal',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      schedule: makeSchedule(false, new Set([0])),
    })).toMatchObject({ kind: 'exact-nights', requiredScore: 75 });
    expect(calcSleepTimeForExp({
      expToTarget: 150,
      nature: 'normal',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      schedule: normalSchedule,
    })).toMatchObject({ kind: 'exact-nights', requiredDays: 2 });
  });
  it('残EXP 24は120～124分の1回睡眠結果になる（GSDは不使用）', () => {
    const result = calcSleepTimeForExp({
      expToTarget: 24,
      nature: 'normal',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      schedule: gsdSchedule,
    });
    expect(result).toEqual({
      kind: 'exact-nights',
      requiredDays: 1,
      totalMinutes: 120,
      requiredScore: 24,
      minutesMin: 120,
      minutesMax: 124,
      growthIncenseCount: 0,
      // お香の無い日なので「外した」ではない。
      skipsLastDayIncense: false,
    });
  });

  it('通常1日EXPと同値は1晩、1超過は2晩目の端数を正確に返す', () => {
    expect(calcSleepTimeForExp({
      expToTarget: 100,
      nature: 'normal',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      schedule: normalSchedule,
    })).toMatchObject({ kind: 'exact-nights', minutesMin: 508, minutesMax: 510 });
    expect(calcSleepTimeForExp({
      expToTarget: 101,
      nature: 'normal',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      schedule: normalSchedule,
    })).toEqual({
      kind: 'exact-nights', requiredDays: 2, totalMinutes: 513,
      requiredScore: 1, minutesMin: 3, minutesMax: 7,
      growthIncenseCount: 0, skipsLastDayIncense: false,
    });
  });

  it('3晩までは端数を正確に返し、4晩から長期概算にする', () => {
    expect(calcSleepTimeForExp({
      expToTarget: 201,
      nature: 'normal',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      schedule: normalSchedule,
    })).toMatchObject({
      kind: 'exact-nights', requiredDays: 3, totalMinutes: 1023,
      requiredScore: 1, minutesMin: 3, minutesMax: 7,
    });
    expect(calcSleepTimeForExp({
      expToTarget: 301,
      nature: 'normal',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      schedule: normalSchedule,
    })).toMatchObject({ kind: 'long-term-estimate', requiredDays: 4, totalMinutes: 2040 });
  });

  it('整数日ぶんのEXP境界でも睡眠スコアが同じ時間幅を正確に返す', () => {
    const result = calcSleepTimeForExp({
      expToTarget: 200,
      nature: 'normal',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      schedule: normalSchedule,
    });
    expect(result).toEqual({
      kind: 'exact-nights', requiredDays: 2, totalMinutes: 1018,
      requiredScore: 100, minutesMin: 508, minutesMax: 510,
      growthIncenseCount: 0, skipsLastDayIncense: false,
    });
    expect(formatSleepTimeResult(result, jaTokens)).toBe('1日（8時間30分）と8時間28分 ～ 30分');
  });

  it('2晩目の日別イベント倍率を最後の時間幅へ反映する', () => {
    const normal = calcSleepTimeForExp({
      expToTarget: 150,
      nature: 'normal',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      schedule: normalSchedule,
    });
    const eventOnSecondNight = calcSleepTimeForExp({
      expToTarget: 150,
      nature: 'normal',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      schedule: makeSchedule(false, new Set(), new Map([[1, 2]])),
    });
    expect(normal).toMatchObject({ kind: 'exact-nights', requiredDays: 2 });
    expect(eventOnSecondNight).toMatchObject({ kind: 'exact-nights', requiredDays: 2 });
    if (normal.kind !== 'exact-nights' || eventOnSecondNight.kind !== 'exact-nights') return;
    expect(eventOnSecondNight.minutesMin).toBeLessThan(normal.minutesMin);
  });

  it('2晩目のGSD倍率を最後の時間幅へ反映する', () => {
    const normal = calcSleepTimeForExp({
      expToTarget: 150, nature: 'normal', dailySleepHours: 8.5, sleepExpBonus: 1,
      schedule: normalSchedule,
    });
    const fullMoonOnSecondNight = calcSleepTimeForExp({
      expToTarget: 150, nature: 'normal', dailySleepHours: 8.5, sleepExpBonus: 1,
      schedule: makeSchedule(true, new Set(), new Map(), new Map([[1, 3]])),
    });
    expect(normal).toMatchObject({ kind: 'exact-nights', requiredDays: 2 });
    expect(fullMoonOnSecondNight).toMatchObject({ kind: 'exact-nights', requiredDays: 2 });
    if (normal.kind !== 'exact-nights' || fullMoonOnSecondNight.kind !== 'exact-nights') return;
    expect(fullMoonOnSecondNight.minutesMin).toBeLessThan(normal.minutesMin);
  });

  it('性格down・睡眠EXPボーナスありの2晩目でも最小分数の境界を保つ', () => {
    const result = calcSleepTimeForExp({
      expToTarget: 150,
      nature: 'down',
      dailySleepHours: 8.5,
      sleepExpBonus: 1.14,
      schedule: normalSchedule,
    });
    expect(result).toMatchObject({ kind: 'exact-nights', requiredDays: 2 });
    if (result.kind !== 'exact-nights') return;
    const firstNightExp = calcSleepExpForDays({
      days: 1,
      dailySleepMinutes: 510,
      sleepExpBonus: 1.14,
      nature: 'down',
      schedule: normalSchedule,
    });
    const lastNightExp = (minutes: number) => calcSleepExp({
      sleepMinutes: minutes,
      sleepExpBonus: 1.14,
      nature: 'down',
    });
    expect(firstNightExp + lastNightExp(result.minutesMin)).toBeGreaterThanOrEqual(150);
    expect(firstNightExp + lastNightExp(result.minutesMin - 1)).toBeLessThan(150);
  });

  it('2晩目のお香は、なしで届くと外し、必要なら使う', () => {
    const secondNightIncense = makeSchedule(false, new Set([1]));
    expect(calcSleepTimeForExp({
      expToTarget: 150,
      nature: 'normal',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      schedule: secondNightIncense,
    })).toMatchObject({
      kind: 'exact-nights', requiredDays: 2,
      growthIncenseCount: 0, skipsLastDayIncense: true,
    });
    expect(calcSleepTimeForExp({
      expToTarget: 250,
      nature: 'normal',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      schedule: secondNightIncense,
    })).toMatchObject({
      kind: 'exact-nights', requiredDays: 2,
      growthIncenseCount: 1, skipsLastDayIncense: false,
    });
  });

  it('3晩の正確計画と4晩の長期概算で最終晩のお香省略規則を揃える', () => {
    const incenseOnLastCandidates = makeSchedule(false, new Set([2, 3]));
    expect(calcSleepTimeForExp({
      expToTarget: 250, nature: 'normal', dailySleepHours: 8.5, sleepExpBonus: 1,
      schedule: incenseOnLastCandidates,
    })).toMatchObject({
      kind: 'exact-nights', requiredDays: 3,
      growthIncenseCount: 0, skipsLastDayIncense: true,
    });
    expect(calcSleepTimeForExp({
      expToTarget: 450, nature: 'normal', dailySleepHours: 8.5, sleepExpBonus: 1,
      schedule: incenseOnLastCandidates,
    })).toMatchObject({
      kind: 'long-term-estimate', requiredDays: 4,
      growthIncenseCount: 1, skipsLastDayIncense: true,
    });
  });

  it('13hではスコア100の上限を設定睡眠時間まで伸ばす', () => {
    expect(calcSleepTimeForExp({
      expToTarget: 100,
      nature: 'normal',
      dailySleepHours: 13,
      sleepExpBonus: 1,
      schedule: gsdSchedule,
    })).toMatchObject({ kind: 'exact-nights', minutesMin: 508, minutesMax: 780 });
  });

  it('EXP性格と睡眠EXPボーナスを時間幅へ反映する', () => {
    expect(calcSleepTimeForExp({
      expToTarget: 24,
      nature: 'down',
      dailySleepHours: 7,
      sleepExpBonus: 1,
      schedule: normalSchedule,
    })).toMatchObject({ kind: 'exact-nights', minutesMin: 151, minutesMax: 155 });
    expect(calcSleepTimeForExp({
      expToTarget: 24,
      nature: 'normal',
      dailySleepHours: 7,
      sleepExpBonus: 1.14,
      schedule: normalSchedule,
    })).toMatchObject({ kind: 'exact-nights', minutesMin: 105, minutesMax: 109 });
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
      schedule: gsdSchedule,
    })).toEqual({
      kind: 'long-term-estimate', requiredDays, totalMinutes,
      growthIncenseCount: 0, skipsLastDayIncense: false,
    });
  });

  /**
   * 「すべて睡眠」の行は `markForSleep` を通らない（睡眠EXPを導出しない。設計書§11）ので、
   * 成長のお香の個数の出どころはこの経路だけになる。個数＝お香を使う睡眠日数。
   */
  it('成長のお香の個数を返す（1回睡眠でも長期概算でも）', () => {
    const noIncense = makeSchedule(false);
    const everyDayIncense = makeSchedule(false, new Set(Array.from({ length: 200 }, (_, i) => i)));
    const firstDayOnly = makeSchedule(false, new Set([0]));

    // 1回睡眠。**お香なしで届くなら使わない**（scheduleが初日をお香日にしていても0個）。
    // 24EXP は8.5時間・お香なしの100EXPで足りる。
    expect(calcSleepTimeForExp({
      expToTarget: 24, nature: 'normal', dailySleepHours: 8.5, sleepExpBonus: 1,
      schedule: noIncense,
    })).toMatchObject({ kind: 'exact-nights', growthIncenseCount: 0 });
    expect(calcSleepTimeForExp({
      expToTarget: 24, nature: 'normal', dailySleepHours: 8.5, sleepExpBonus: 1,
      schedule: firstDayOnly,
    })).toMatchObject({ kind: 'exact-nights', growthIncenseCount: 0 });

    // お香なしでは1回で届かない量なら使う（150EXP > お香なしの上限100EXP）。
    // お香ありなら200EXPまで届くので、1回睡眠のまま1個使う。
    expect(calcSleepTimeForExp({
      expToTarget: 150, nature: 'normal', dailySleepHours: 8.5, sleepExpBonus: 1,
      schedule: firstDayOnly,
    })).toMatchObject({ kind: 'exact-nights', growthIncenseCount: 1 });

    // 長期概算。毎日使えば必要日数と同数になる（最終日はお香を外せる場合だけ1個減る）
    const everyDay = calcSleepTimeForExp({
      expToTarget: 12514, nature: 'normal', dailySleepHours: 8.5, sleepExpBonus: 1,
      schedule: everyDayIncense,
    });
    expect(everyDay.kind).toBe('long-term-estimate');
    if (everyDay.kind !== 'long-term-estimate') return;
    expect(everyDay.growthIncenseCount)
      .toBe(everyDay.requiredDays - (everyDay.skipsLastDayIncense ? 1 : 0));
    // お香でEXPが2倍になるぶん、使わないときより必要日数は短い
    expect(calcSleepTimeForExp({
      expToTarget: 12514, nature: 'normal', dailySleepHours: 8.5, sleepExpBonus: 1,
      schedule: noIncense,
    })).toMatchObject({ kind: 'long-term-estimate', growthIncenseCount: 0 });
    expect(everyDay.requiredDays).toBeLessThan(123);
  });

  /**
   * 「お香の無い日」と「お香を外した日」は別物。個数が 0 でも、もともとお香の無い日なら
   * 外したことにはならない（混ぜると検算で最終日の扱いを読み違える）。
   */
  it('1回睡眠の skipsLastDayIncense はお香日を外したときだけ true', () => {
    const params = { nature: 'normal' as const, dailySleepHours: 8.5, sleepExpBonus: 1 };
    const firstDayOnly = makeSchedule(false, new Set([0]));

    // お香の無い日。使う予定が無いので「外した」ではない。
    expect(calcSleepTimeForExp({ ...params, expToTarget: 24, schedule: makeSchedule(false) }))
      .toMatchObject({ growthIncenseCount: 0, skipsLastDayIncense: false });
    // お香日だが、お香なしでも届くので外す。
    expect(calcSleepTimeForExp({ ...params, expToTarget: 24, schedule: firstDayOnly }))
      .toMatchObject({ growthIncenseCount: 0, skipsLastDayIncense: true });
    // お香が無いと届かないので使う。
    expect(calcSleepTimeForExp({ ...params, expToTarget: 150, schedule: firstDayOnly }))
      .toMatchObject({ growthIncenseCount: 1, skipsLastDayIncense: false });
  });

  it('GSDオフでは長期概算へGSDを加えない', () => {
    expect(calcSleepTimeForExp({
      expToTarget: 12514,
      nature: 'normal',
      dailySleepHours: 7,
      sleepExpBonus: 1,
      schedule: normalSchedule,
    })).toMatchObject({ kind: 'long-term-estimate', requiredDays: 153 });
  });

  it('最大EXPでも機能上限2000日を超えて同期scheduleを生成しない', () => {
    let maxIndex = -1;
    const boundedSchedule: SleepSchedule = {
      ...normalSchedule,
      dayAt(index) {
        maxIndex = Math.max(maxIndex, index);
        return normalSchedule.dayAt(index);
      },
    };
    expect(calcSleepTimeForExp({
      expToTarget: calcExp(1, 70, 1320),
      nature: 'down',
      dailySleepHours: 1,
      sleepExpBonus: 1,
      schedule: boundedSchedule,
    })).toEqual({ kind: 'unavailable' });
    expect(MAX_SLEEP_PLANNING_DAYS).toBe(2000);
    expect(maxIndex).toBeLessThan(MAX_SLEEP_PLANNING_DAYS);
  });

  it('残EXPなしと計算不能を判別し、非有限値を返さない', () => {
    expect(calcSleepTimeForExp({
      expToTarget: 0,
      nature: 'normal',
      schedule: normalSchedule,
    })).toEqual({ kind: 'none' });
    for (const params of [
      { expToTarget: Number.NaN, dailySleepHours: 8.5, sleepExpBonus: 1 },
      { expToTarget: Number.POSITIVE_INFINITY, dailySleepHours: 8.5, sleepExpBonus: 1 },
      { expToTarget: 100, dailySleepHours: 0, sleepExpBonus: 1 },
      { expToTarget: 100, dailySleepHours: 0.5, sleepExpBonus: 1 },
      { expToTarget: 100, dailySleepHours: 8.5, sleepExpBonus: 0 },
      { expToTarget: 100, dailySleepHours: 8.5, sleepExpBonus: 1.71 },
      { expToTarget: calcExp(1, 70, 1320) + 1, dailySleepHours: 8.5, sleepExpBonus: 1 },
    ]) {
      expect(calcSleepTimeForExp({
        ...params,
        nature: 'normal',
        schedule: normalSchedule,
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
      kind: 'exact-nights' as const,
      requiredDays: 1,
      totalMinutes: min,
      requiredScore: 1,
      minutesMin: min,
      minutesMax: max,
      growthIncenseCount: 0,
      skipsLastDayIncense: false,
    };
    expect(formatSleepTimeResult(result, jaTokens)).toBe(ja);
    expect(formatSleepTimeResult(result, enTokens)).toBe(en);
  });

  it('長期概算は先頭だけ概算表記を付け、0分を省略する', () => {
    expect(formatSleepTimeResult({
      kind: 'long-term-estimate',
      requiredDays: 114,
      totalMinutes: 969 * 60,
      growthIncenseCount: 0,
      skipsLastDayIncense: false,
    }, jaTokens)).toBe('約114日（969時間）');
    expect(formatSleepTimeResult({
      kind: 'long-term-estimate',
      requiredDays: 115,
      totalMinutes: 977 * 60 + 30,
      growthIncenseCount: 0,
      skipsLastDayIncense: false,
    }, jaTokens)).toBe('約115日（977時間30分）');
    expect(formatSleepTimeResult({
      kind: 'long-term-estimate',
      requiredDays: 114,
      totalMinutes: 969 * 60,
      growthIncenseCount: 0,
      skipsLastDayIncense: false,
    }, enTokens)).toBe('about 114d (969h)');
  });

  it('2～3晩は完了した日数と最終晩の正確な時間幅を表示する', () => {
    const base = {
      kind: 'exact-nights' as const,
      requiredScore: 1,
      minutesMin: 120,
      minutesMax: 124,
      growthIncenseCount: 0,
      skipsLastDayIncense: false,
    };
    expect(formatSleepTimeResult({ ...base, requiredDays: 2, totalMinutes: 630 }, jaTokens))
      .toBe('1日（8時間30分）と2時間0分 ～ 4分');
    expect(formatSleepTimeResult({ ...base, requiredDays: 3, totalMinutes: 1140 }, jaTokens))
      .toBe('2日（17時間）と2時間0分 ～ 4分');
    expect(formatSleepTimeResult({ ...base, requiredDays: 3, totalMinutes: 1140 }, enTokens))
      .toBe('2d (17h) + 2h 0m–4m');
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

describe('晩別ボーナス内訳（attributeSleepBonusExpByNight）', () => {
  const baseParams = {
    dailySleepMinutes: 510,
    sleepExpBonus: 1,
    nature: 'normal' as const,
  };

  it('日付順に各晩のスコアと総EXPを返し、種類別内訳の合計と一致する', () => {
    const schedule = makeSchedule(
      false,
      new Set([1, 2]),
      new Map([[0, 1.25], [1, 1.5]]),
      new Map([[1, 2]]),
    );
    const params = { ...baseParams, days: 3, schedule, lastDaySleepMinutes: 401 };
    const rows = attributeSleepBonusExpByNight(params);

    expect(rows).toEqual([
      { date: '2026-01-01', kind: 'event', multiplier: 1.25, withIncense: false, minutes: 510, score: 100, exp: 125, baseExp: 100 },
      { date: '2026-01-02', kind: 'gsd', multiplier: 2, withIncense: true, minutes: 510, score: 100, exp: 400, baseExp: 100 },
      { date: '2026-01-03', kind: 'incense', multiplier: null, withIncense: true, minutes: 401, score: 79, exp: 158, baseExp: 79 },
    ]);
    expect(rows.reduce((sum, row) => sum + row.exp, 0)).toBe(
      attributeSleepBonusExpForDays(params).reduce((sum, row) => sum + row.exp, 0),
    );
  });

  it('最終晩のお香を外す計画と0分の最終晩をそのまま反映する', () => {
    const schedule = makeSchedule(false, new Set([0, 1]));
    expect(attributeSleepBonusExpByNight({
      ...baseParams,
      days: 2,
      schedule,
      skipLastDayIncense: true,
    })).toMatchObject([
      { withIncense: true, kind: 'incense' },
      { withIncense: false, kind: null, multiplier: null },
    ]);
    expect(attributeSleepBonusExpByNight({
      ...baseParams,
      days: 2,
      schedule,
      lastDaySleepMinutes: 0,
    })).toHaveLength(1);
  });

  it('GSDとイベントの同値はGSD、イベントが上回ればイベントへ帰属する', () => {
    const schedule = makeSchedule(
      false,
      new Set(),
      new Map([[0, 2], [1, 3]]),
      new Map([[0, 2], [1, 2]]),
    );
    expect(attributeSleepBonusExpByNight({ ...baseParams, days: 2, schedule }).map(row => row.kind))
      .toEqual(['gsd', 'event']);
  });

  it('3晩を超える日数と無効な睡眠時間を拒否する', () => {
    expect(attributeSleepBonusExpByNight({ ...baseParams, days: 4, schedule: normalSchedule })).toEqual([]);
    expect(attributeSleepBonusExpByNight({
      ...baseParams,
      days: 2,
      dailySleepMinutes: 0,
      schedule: normalSchedule,
    })).toEqual([]);
  });
});

describe('ボーナス内訳の帰属（attributeSleepBonusExpForDays）', () => {
  // スコア100・性格normal・お香なし・外側の倍率なしなら素EXPは100。
  const baseParams = {
    dailySleepMinutes: 510,
    sleepExpBonus: 1,
    nature: 'normal' as const,
  };

  /** 画面の「素EXP」の行（kind: base）。素EXPなので全睡眠日が対象。 */
  function baseRow(days: number, exp: number, score = days * 100) {
    return { kind: 'base', multiplier: 1, withIncense: false, days, score, exp };
  }

  /** 追加ぶんだけの合計（`base` は素EXPなので除く）。 */
  function bonusTotal(rows: readonly { kind: string; exp: number }[]): number {
    return rows.filter(r => r.kind !== 'base').reduce((sum, r) => sum + r.exp, 0);
  }

  it('イベントが効いた日をまとめ、日付は持たない', () => {
    const schedule = makeSchedule(false, new Set(), new Map([[2, 1.5], [3, 1.5], [4, 1.5]]));
    const result = attributeSleepBonusExpForDays({ ...baseParams, days: 7, schedule });
    expect(result).toEqual([
      baseRow(7, 700),
      { kind: 'event', multiplier: 1.5, withIncense: false, days: 3, score: 300, exp: 150 },
    ]);
    // GSDなしのscheduleでは、内訳の外側倍率と帰属合計が一致する。素EXPは baseExp と一致する。
    const breakdown = calcSleepExpBreakdownForDays({ ...baseParams, days: 7, schedule });
    expect(bonusTotal(result)).toBe(breakdown.outerBonusExtra);
    expect(result[0]!.exp).toBe(breakdown.baseExp);
    expect(result.reduce((sum, c) => sum + c.exp, 0)).toBe(breakdown.sleepExp);
  });

  it('GSDとイベントが重なった日はGSD側だけに数える（二重計上しない）', () => {
    // 前後日(×2)・満月(×3)に ×2 のイベントを重ねる。実効値はGSDと同じなのでGSD扱い。
    const schedule = makeSchedule(true, new Set(), new Map([[28, 2], [29, 2], [30, 2]]));
    const result = attributeSleepBonusExpForDays({ ...baseParams, days: 31, schedule });
    expect(result).toEqual([
      baseRow(31, 3100),
      { kind: 'gsd', multiplier: 3, withIncense: false, days: 1, score: 100, exp: 200 },
      { kind: 'gsd', multiplier: 2, withIncense: false, days: 2, score: 200, exp: 200 },
    ]);
    const breakdown = calcSleepExpBreakdownForDays({ ...baseParams, days: 31, schedule });
    expect(bonusTotal(result)).toBe(breakdown.outerBonusExtra);
  });

  it('GSDより強いイベントはイベント側へ数える', () => {
    const schedule = makeSchedule(true, new Set(), new Map([[29, 4]]));
    const result = attributeSleepBonusExpForDays({ ...baseParams, days: 30, schedule });
    // 満月日(×3)を ×4 のイベントが上回るので、その日はイベント。前後日(28日目)はGSD。
    expect(result).toEqual([
      baseRow(30, 3000),
      { kind: 'gsd', multiplier: 2, withIncense: false, days: 1, score: 100, exp: 100 },
      { kind: 'event', multiplier: 4, withIncense: false, days: 1, score: 100, exp: 300 },
    ]);
  });

  it('外側のボーナスと同じ日のお香は同じ行へまとめる', () => {
    // 0日目: イベント×1.5 とお香。1日目: お香だけ。
    const schedule = makeSchedule(false, new Set([0, 1]), new Map([[0, 1.5]]));
    const result = attributeSleepBonusExpForDays({ ...baseParams, days: 2, schedule });
    // お香ありの素EXPは200。×1.5で300なので、素100との差は+200（外側+50、お香+150）。
    expect(result).toEqual([
      baseRow(2, 200),
      { kind: 'event', multiplier: 1.5, withIncense: true, days: 1, score: 100, exp: 200 },
      { kind: 'incense', multiplier: null, withIncense: true, days: 1, score: 100, exp: 100 },
    ]);
    const breakdown = calcSleepExpBreakdownForDays({ ...baseParams, days: 2, schedule });
    expect(bonusTotal(result)).toBe(breakdown.outerBonusExtra + breakdown.incenseExtra);
    expect(result.reduce((sum, c) => sum + c.exp, 0)).toBe(breakdown.sleepExp);
  });

  // 同じ倍率ならお香ありのほうが必ず稼ぎが大きい。強い行を上に置く（並び順の意図）。
  it('お香の有無で行を分け、同じ倍率ならお香ありを先に置く', () => {
    const schedule = makeSchedule(false, new Set([0]), new Map([[0, 1.5], [1, 1.5]]));
    const result = attributeSleepBonusExpForDays({ ...baseParams, days: 2, schedule });
    expect(result.map(c => `${c.kind}/${c.withIncense}/${c.days}`))
      .toEqual(['base/false/2', 'event/true/1', 'event/false/1']);
    // 並びと大小が食い違わないことまで固定する（お香ありが下へ落ちたら気付ける）
    const [, withIncense, withoutIncense] = result;
    expect(withIncense.exp).toBeGreaterThan(withoutIncense.exp);
  });

  it('倍率もお香も無ければ「素EXP」の行だけになる', () => {
    const schedule = makeSchedule(false);
    expect(attributeSleepBonusExpForDays({ ...baseParams, days: 7, schedule }))
      .toEqual([baseRow(7, 700)]);
  });

  it('睡眠EXPボーナス（スキル）の倍率を「素EXP」の行へ添える', () => {
    const schedule = makeSchedule(false);
    const result = attributeSleepBonusExpForDays({
      ...baseParams,
      // 1 + 0.14 * 5 は 1.7000000000000002。表示用に丸めてから返す。
      sleepExpBonus: 1 + 0.14 * 5,
      days: 3,
      schedule,
    });
    expect(result).toEqual([
      { kind: 'base', multiplier: 1.7, withIncense: false, days: 3, score: 300, exp: 510 },
    ]);
  });

  it('性格補正と睡眠時間は「素EXP」へ畳み込まれる', () => {
    const schedule = makeSchedule(false);
    // ▼▼（82%）・6時間（360分＝スコア71）→ floor(71 × 0.82) = 58
    const result = attributeSleepBonusExpForDays({
      ...baseParams,
      dailySleepMinutes: 360,
      nature: 'down',
      days: 2,
      schedule,
    });
    expect(result).toEqual([
      { kind: 'base', multiplier: 1, withIncense: false, days: 2, score: 142, exp: 116 },
    ]);
  });

  it('最終日が1日分に満たない行は、その日の実際の睡眠時間で寄与を出す', () => {
    // パーモット相当（残EXP 98 を 6時間41分 = 401分で賄う）。
    // score 401分 → 79。×1.25 で 98、素は 79 なので寄与は +19（1日分なら +25）。
    const schedule = makeSchedule(false, new Set(), new Map([[0, 1.25]]));
    const result = attributeSleepBonusExpForDays({
      ...baseParams,
      days: 1,
      schedule,
      lastDaySleepMinutes: 401,
    });
    expect(result).toEqual([
      baseRow(1, 79, 79),
      { kind: 'event', multiplier: 1.25, withIncense: false, days: 1, score: 79, exp: 19 },
    ]);
  });

  it('最終日を寝ない指定（0分）ならその日は数えない', () => {
    const schedule = makeSchedule(false, new Set(), new Map([[0, 1.5], [1, 1.5]]));
    const result = attributeSleepBonusExpForDays({
      ...baseParams,
      days: 2,
      schedule,
      lastDaySleepMinutes: 0,
    });
    expect(result).toEqual([
      baseRow(1, 100),
      { kind: 'event', multiplier: 1.5, withIncense: false, days: 1, score: 100, exp: 50 },
    ]);
  });

  it('最終日の端数で残EXPを少し超えても揃えにいかない（実値をそのまま出す）', () => {
    // スコアは5.1分刻みなので、最終日は残EXPちょうどでは止まれない。
    // 402分で 98EXP に届くとき、必要が 97EXP でも 98 のまま出す（目標を超えて到達するのが実態）。
    const schedule = makeSchedule(false, new Set(), new Map([[0, 1.25]]));
    const result = attributeSleepBonusExpForDays({
      ...baseParams,
      days: 1,
      schedule,
      lastDaySleepMinutes: 401,
    });
    expect(result.reduce((sum, c) => sum + c.exp, 0)).toBe(98);
  });

  it('最終日のお香を外す計画なら、その日はお香なしとして数える', () => {
    // 2日ともお香日。最終日のお香を外すと、お香行は1日ぶんだけになる。
    const schedule = makeSchedule(false, new Set([0, 1]));
    expect(attributeSleepBonusExpForDays({ ...baseParams, days: 2, schedule })).toEqual([
      baseRow(2, 200),
      { kind: 'incense', multiplier: null, withIncense: true, days: 2, score: 200, exp: 200 },
    ]);
    expect(attributeSleepBonusExpForDays({
      ...baseParams,
      days: 2,
      schedule,
      skipLastDayIncense: true,
    })).toEqual([
      baseRow(2, 200),
      { kind: 'incense', multiplier: null, withIncense: true, days: 1, score: 100, exp: 100 },
    ]);
  });

  it('日数0や無効な設定では空配列を返す', () => {
    const schedule = makeSchedule(false);
    expect(attributeSleepBonusExpForDays({ ...baseParams, days: 0, schedule })).toEqual([]);
    expect(attributeSleepBonusExpForDays({
      ...baseParams,
      dailySleepMinutes: 0,
      days: 5,
      schedule,
    })).toEqual([]);
  });
});
