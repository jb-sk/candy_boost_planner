import { describe, expect, it } from "vitest";
import type { BoostEvent, ExpGainNature, ExpType } from "../../types";
import { calcExp, calcExpAndCandy, calcLevelByCandy } from "../exp";
import { minBoostWithinBudget } from "../minBoostWithinBudget";

const EXP_TYPES: ExpType[] = [600, 900, 1080, 1320];
const NATURES: ExpGainNature[] = ["up", "normal", "down"];
const BOOST_KINDS: Exclude<BoostEvent, "none">[] = ["mini", "full"];

function atLeast(point: { level: number; expInLevel: number }, level: number, exp: number): boolean {
  return point.level > level || (point.level === level && point.expInLevel >= exp);
}

function reachesWithBudget(
  srcLevel: number,
  targetLevel: number,
  targetExpInLevel: number,
  expType: ExpType,
  nature: ExpGainNature,
  boostKind: Exclude<BoostEvent, "none">,
  expGot: number,
  boostCandy: number,
  budget: number,
): boolean {
  if (boostCandy > budget) return false;
  const afterBoost = calcLevelByCandy({
    srcLevel, dstLevel: 70, expType, nature, boost: boostKind, candy: boostCandy, expGot,
  });
  const afterNormal = calcLevelByCandy({
    srcLevel: afterBoost.level,
    dstLevel: 70,
    expType,
    nature,
    boost: "none",
    candy: budget - boostCandy,
    expGot: afterBoost.expGot,
  });
  return atLeast({ level: afterNormal.level, expInLevel: afterNormal.expGot }, targetLevel, targetExpInLevel);
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("minBoostWithinBudget", () => {
  it("returns the feasible boundary: n reaches and n-1 does not", () => {
    const budget = calcExpAndCandy({ srcLevel: 40, dstLevel: 50, expType: 600, nature: "normal", boost: "full" }).candy;
    const params = {
      srcLevel: 40,
      targetLevel: 50,
      expType: 600 as const,
      nature: "normal" as const,
      boostKind: "full" as const,
      budget,
    };
    const n = minBoostWithinBudget(params);
    expect(n).toBeDefined();
    expect(reachesWithBudget(40, 50, 0, 600, "normal", "full", 0, n!, budget)).toBe(true);
    if (n! > 0) {
      expect(reachesWithBudget(40, 50, 0, 600, "normal", "full", 0, n! - 1, budget)).toBe(false);
    }
  });

  it("returns zero when normal candies fit the budget", () => {
    const budget = calcExpAndCandy({ srcLevel: 30, dstLevel: 34, expType: 900, nature: "normal", boost: "none" }).candy;
    expect(minBoostWithinBudget({
      srcLevel: 30,
      targetLevel: 34,
      expType: 900,
      nature: "normal",
      boostKind: "mini",
      budget,
    })).toBe(0);
  });

  it("returns undefined when even the full-boost bound cannot reach", () => {
    expect(minBoostWithinBudget({
      srcLevel: 1,
      targetLevel: 70,
      expType: 600,
      nature: "normal",
      boostKind: "full",
      budget: 1,
    })).toBeUndefined();
  });

  it.each([
    ["full", "up"],
    ["full", "down"],
    ["mini", "up"],
    ["mini", "down"],
  ] as const)("handles %s with %s nature", (boostKind, nature) => {
    const budget = calcExpAndCandy({ srcLevel: 28, dstLevel: 36, expType: 1080, nature, boost: boostKind }).candy;
    const params = { srcLevel: 28, targetLevel: 36, expType: 1080 as const, nature, boostKind, budget };
    const n = minBoostWithinBudget(params);
    expect(n).toBeDefined();
    expect(reachesWithBudget(28, 36, 0, 1080, nature, boostKind, 0, n!, budget)).toBe(true);
  });

  it("includes EXP already gained in the current level", () => {
    const expType = 900;
    const expGot = Math.floor(calcExp(29, 30, expType) / 2);
    const budget = calcExpAndCandy({ srcLevel: 29, dstLevel: 32, expType, nature: "normal", boost: "none", expGot }).candy;
    expect(minBoostWithinBudget({
      srcLevel: 29,
      targetLevel: 32,
      expType,
      nature: "normal",
      boostKind: "full",
      budget,
      expGot,
    })).toBe(0);
  });

  it("matches brute force over all boost counts for randomized inputs", () => {
    const rand = mulberry32(20260924);
    let checked = 0;
    for (let i = 0; i < 350; i++) {
      const srcLevel = 1 + Math.floor(rand() * 45);
      const targetLevel = srcLevel + 1 + Math.floor(rand() * Math.min(20, 69 - srcLevel));
      const expType = EXP_TYPES[Math.floor(rand() * EXP_TYPES.length)]!;
      const nature = NATURES[Math.floor(rand() * NATURES.length)]!;
      const boostKind = BOOST_KINDS[Math.floor(rand() * BOOST_KINDS.length)]!;
      const targetExpInLevel = rand() < 0.4 ? 0 : Math.floor(rand() * Math.max(1, calcExp(targetLevel, targetLevel + 1, expType)));
      const expGot = Math.floor(rand() * calcExp(srcLevel, srcLevel + 1, expType));
      const budget = Math.floor(rand() * 180);
      const maxBoost = calcExpAndCandy({
        srcLevel,
        dstLevel: targetLevel,
        dstExpInLevel: targetExpInLevel,
        expType,
        nature,
        boost: boostKind,
        expGot,
      }).candy;
      const brute = Array.from({ length: Math.min(budget, maxBoost) + 1 }, (_, n) => n)
        .find((n) => reachesWithBudget(
          srcLevel, targetLevel, targetExpInLevel, expType, nature, boostKind, expGot, n, budget,
        ));
      const actual = minBoostWithinBudget({
        srcLevel,
        targetLevel,
        targetExpInLevel,
        expType,
        nature,
        boostKind,
        budget,
        expGot,
      });
      expect(actual, `case ${i}`).toBe(brute);
      checked++;
    }
    expect(checked).toBe(350);
  });
});
