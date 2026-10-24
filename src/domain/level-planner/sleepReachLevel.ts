import type { ExpType } from '../types';
import { maxLevel as MAX_LEVEL } from '../pokesleep/tables';
import { addExpToLevel, calcExp } from '../pokesleep/exp';

export type SleepReachLevelParams = {
  /**
   * アメを使い終えた地点（`PokemonPlanResult.reachableLine`）。**睡眠前**である。
   * 睡眠を設定した行では最終目標より手前で終わる。
   */
  reachedLevel: number;
  reachedExpInLevel: number;
  /** その計画で実際に見込む睡眠EXP（`rowSleepExpFor`）。0 なら表示しない。 */
  sleepExp: number;
  /**
   * 睡眠後の最終目標（`PokemonPlanResult.targetLevel` / `targetExpInLevel`）。
   * `reachableLine.level` ではない。
   */
  targetLevel: number;
  targetExpInLevel: number;
  expType: ExpType;
};

export type SleepReachLevelOutcome =
  | {
    shown: true;
    /** 着地Lv（整数部）。 */
    level: number;
    /** 小数第1位（0〜9）。Lv70 では「次Lvまでの全EXP」が無いので null。 */
    tenths: number | null;
    /** Lv内EXP ÷ 次Lvまでの全EXP。Lv70 では分母が無いので null。 */
    ratio: number | null;
  }
  | {
    shown: false;
    /** 表示しないと判断した正本の条件。 */
    reason: 'noSleepExp' | 'notExceedingTarget' | 'displayEqualsTargetLevel';
  };

/**
 * 睡眠込みの着地点「睡眠到達Lv」を求める（設計書『睡眠育成の拡張』§3）。
 * 表示可否と、表示しない場合の理由を判別可能な結果で返す。
 *
 * **anchor を問わない。** 個数指定がある・アメブ個数を明示入力した・どちらも無い、の
 * 区別を持たず、与えられた `reachableLine` と最終目標だけから導く。
 * **保存値へ一切書き戻さない表示専用の導出値**なので、`T → n → T'` の循環（§11.4）には関与しない。
 *
 * `PokemonPlanLine` を上書きしないこと。あちらは「アメ使用後・睡眠前」が正本の意味論で、
 * 過去の事故は睡眠後Lvと睡眠前EXPの合成だった（`個数指定と目標Lvの一本化_設計書.md` §7）。
 */
export function calcSleepReachLevel(params: SleepReachLevelParams): SleepReachLevelOutcome {
  const landing = calcSleepLandingLevel(params);
  if (!landing.shown) return landing;

  // 条件1: 着地点が最終目標を**超えて余る**こと（§3.1 / §3.6）。
  // 届かない行は既存の「残EXP → 約◯日」がすでに『何日寝ればいいか』に答えているので二重に出さない。
  // 在庫不足の行は着地点が目標より下にあり、表示値だけを見ると通ってしまう。
  const exceedsTarget = landing.level > params.targetLevel
    || (landing.level === params.targetLevel && landing.expInLevel > params.targetExpInLevel);
  if (!exceedsTarget) return { shown: false, reason: 'notExceedingTarget' };

  // 条件2: **表示値**が目標Lvより高いこと（§3.3）。
  // アメ＋睡眠でちょうど目標へ届く行には必ず ceil の余剰EXP（〜100EXP＝0.03Lv）が乗るため、
  // これが無いと睡眠目標のあるほぼ全部の行に「約60.0」が出る。
  if (landing.level === params.targetLevel && (landing.tenths ?? 0) === 0) {
    return { shown: false, reason: 'displayEqualsTargetLevel' };
  }

  return { shown: true, level: landing.level, tenths: landing.tenths, ratio: landing.ratio };
}

/**
 * 睡眠（・おひるね島）のあとの着地点。`calcSleepReachLevel` の**表示条件（目標を超えるか）を掛けない**版。
 * 睡眠EXPが 0 のときだけ出さない。
 *
 * 使うのは、目標に届かない行でも着地点を見せたい所だけ:
 * - 計算画面で、アメ不足・かけら不足がある行（睡眠のあとどこまで届くかを見せる。2026-10-13 ユーザー指示）
 * - 育成プランの CSV / TSV（データなので、目標ちょうどの行も埋める。同上）
 */
export function calcSleepLandingLevel(
  params: Omit<SleepReachLevelParams, 'targetLevel' | 'targetExpInLevel'>,
): (Extract<SleepReachLevelOutcome, { shown: true }> & { expInLevel: number }) | { shown: false; reason: 'noSleepExp' } {
  const sleepExp = Math.max(0, Math.floor(params.sleepExp));
  if (sleepExp <= 0) return { shown: false, reason: 'noSleepExp' };

  // アメが先、睡眠が後（`targetFromCandy` と同じ正本ヘルパー）。
  const landed = addExpToLevel(params.reachedLevel, params.reachedExpInLevel, sleepExp, params.expType);

  // 小数は「そのLv内で得ているEXP ÷ 次Lvまでの全EXP」。**切り捨て**（§3.5）。
  // 四捨五入すると 60.96 が 61.0 になり「Lv61 に到達した」と読める。
  const expToNextLevel = landed.level >= MAX_LEVEL
    ? null
    : calcExp(landed.level, landed.level + 1, params.expType);
  const ratio = expToNextLevel === null ? null : landed.expInLevel / expToNextLevel;
  const tenths = expToNextLevel === null ? null : Math.floor((landed.expInLevel * 10) / expToNextLevel);
  return { shown: true, level: landed.level, expInLevel: landed.expInLevel, tenths, ratio };
}
