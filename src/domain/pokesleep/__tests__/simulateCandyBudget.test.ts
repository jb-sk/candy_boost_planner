import { describe, expect, it } from "vitest";
import { calcExp } from "../exp";
import { simulateCandyBudget } from "../simulateCandyBudget";
import { dreamShardsPerCandy } from "../tables";

/**
 * かけら不足でアメブ→通常アメへ振り替えないこと（設計書 §10.16 / 配分ポリシー仕様 §4）。
 *
 * かつて `fixedBoost = false` の呼び出しでは、アメブがかけら不足で使えなくなると
 * そのまま通常アメへ落ちていた。ユーザーが選んでいない内訳が黙って作られるため廃止した。
 * アメブを減らしてよいのはグローバル残数超過のときだけで、その切り詰めは
 * 呼び出し側が `boostBudget` に反映してから渡す。
 */
describe("simulateCandyBudget: かけら不足でアメブを通常アメへ振り替えない", () => {
  const subject = { currentLevel: 10, currentExpInLevel: 0, expType: 600 as const, nature: "normal" as const };

  it("かけらが尽きた時点で止まり、残りを通常アメで埋めない", () => {
    const boostBudget = 50;
    const totalBudget = 50;

    const unlimited = simulateCandyBudget(subject, boostBudget, totalBudget, Infinity, "full");
    // 前提: かけら無制限ならアメブだけで予算を使い切ること（崩れると以下の検証は無意味）
    expect(unlimited.boostUsed).toBe(totalBudget);
    expect(unlimited.normalUsed).toBe(0);
    expect(unlimited.shards).toBeGreaterThan(0);

    const limited = simulateCandyBudget(subject, boostBudget, totalBudget, Math.floor(unlimited.shards / 2), "full");

    // 振り替えが復活すると、止まらずに通常アメで残りを消費する
    expect(limited.boostUsed).toBeLessThan(unlimited.boostUsed);
    expect(limited.normalUsed).toBe(0);
    expect(limited.boostUsed + limited.normalUsed).toBeLessThan(totalBudget);
  });

  it("アメブなしの種別では、アメブ予算を渡されても boostUsed に数えない", () => {
    // kind: "none" は倍率もかけら消費も通常アメと同じ。予算だけ残すと、通常アメを
    // 消費しながらアメブとして数える不可能な結果になる
    const r = simulateCandyBudget(subject, 10, 40, Infinity, "none");

    expect(r.boostUsed).toBe(0);
    expect(r.normalUsed).toBe(40);
  });

  it("アメブ予算を配り終えたあとは通常アメへ進む（止まるのはアメブが使えないときだけ）", () => {
    const boostBudget = 10;
    const totalBudget = 40;

    const r = simulateCandyBudget(subject, boostBudget, totalBudget, Infinity, "full");

    expect(r.boostUsed).toBe(boostBudget);
    expect(r.normalUsed).toBe(totalBudget - boostBudget);
  });

  it("到達先Lvのかけら単価を使い、上限ちょうどの1個は消費できる", () => {
    const exactShardLimit = dreamShardsPerCandy[subject.currentLevel + 1];
    const r = simulateCandyBudget(subject, 0, 1, exactShardLimit, "none");

    expect(r.normalUsed).toBe(1);
    expect(r.shards).toBe(exactShardLimit);
  });

  it("Lv70へ到達した結果のLv内EXPは0に正規化する", () => {
    const atLevel69 = {
      ...subject,
      currentLevel: 69,
      currentExpInLevel: calcExp(69, 70, subject.expType) - 1,
    };
    const r = simulateCandyBudget(atLevel69, 0, 1, Infinity, "none");

    expect(r.level).toBe(70);
    expect(r.expInLevel).toBe(0);
  });
});
