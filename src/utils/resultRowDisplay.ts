import { CANDY_VALUES } from "../domain/level-planner/constants";
import type { CandySupplyBreakdown, PokemonPlanLine } from "../domain/level-planner/types";

export function supplyValue(supply: CandySupplyBreakdown): number {
  return supply.species
    + supply.type.s * CANDY_VALUES.type.s
    + supply.type.m * CANDY_VALUES.type.m
    + supply.universal.s * CANDY_VALUES.universal.s
    + supply.universal.m * CANDY_VALUES.universal.m
    + supply.universal.l * CANDY_VALUES.universal.l;
}

export function lineSurplus(line: PokemonPlanLine): number {
  return Math.max(0, line.surplusCandyValue, supplyValue(line.candySupply) - line.totalCandyUnitsUsed);
}

/**
 * 「目標まで」行と「到達可能」行の表示値が完全一致するか。
 * 原因ではなく、画面に表示する値だけを比較する。species は表示しないため比較しない。
 */
export function isSameDisplayedLine(a: PokemonPlanLine, b: PokemonPlanLine): boolean {
  return a.boostedCandyUnits === b.boostedCandyUnits
    && a.nonBoostCandyUnits === b.nonBoostCandyUnits
    && a.totalCandyUnitsUsed === b.totalCandyUnitsUsed
    && a.dreamShardsUsed === b.dreamShardsUsed
    && a.candySupply.type.s === b.candySupply.type.s
    && a.candySupply.type.m === b.candySupply.type.m
    && a.candySupply.universal.s === b.candySupply.universal.s
    && a.candySupply.universal.m === b.candySupply.universal.m
    && a.candySupply.universal.l === b.candySupply.universal.l
    && lineSurplus(a) === lineSurplus(b);
}

export function fmtNumOrDash(
  value: number | undefined | null,
  fmt: (value: number) => string,
): string {
  return value == null ? "-" : fmt(value);
}
