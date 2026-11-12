/**
 * 各行余り0〜2（配分方針 §6 のハード制約）の比べ方。`normalizedSurplus` は余り0〜2を超えた分の合計で、0 なら満たす。
 * 満たす方が良い。どちらも満たさなければ、超えた分の少ない方が良い。a が良ければ正、悪ければ負、同じなら 0。
 * 解の比べ方（`solveLevelPlan`）・代表の比べ方（`feasibilityWitness`）・供給の詰め直し（`exactSupplyRefine`）で同じ順に使う。
 */
export function compareRowSurplusGate(a: number, b: number): number {
  const acceptableA = a === 0;
  const acceptableB = b === 0;
  if (acceptableA !== acceptableB) return acceptableA ? 1 : -1;
  if (!acceptableA && a !== b) return a < b ? 1 : -1;
  return 0;
}
