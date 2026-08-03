import { describe, expect, it } from "vitest";
import { isPerfWallClockEnabled } from "../../helpers/isPerfWallClockEnabled";
import { perfBudgetMs } from "./perfBudget";
import { solveFeasibilityForFixedRows } from "../../../src/domain/level-planner/core/feasibilityWitness";
import {
  __levelPlannerTestHooks,
  solveLevelPlanWithBudget,
} from "../../../src/domain/level-planner/core/solveLevelPlan";
import type {
  CandyInventory,
  FeasibilityDemandRow,
  LevelPlannerInput,
  SolverItemCompareMode,
} from "../../../src/domain/level-planner/types";

const inventory: CandyInventory = {
  species: { "133": 1000 },
  typeCandy: {
    Fairy: { s: 0, m: 10 },
    Fire: { s: 0, m: 0 },
  },
  universal: { s: 432, m: 102, l: 9 },
};

const rows: FeasibilityDemandRow[] = [
  {
    pokemonId: "sylveon",
    pokedexId: 700,
    candyFamilyKey: "133",
    type: "Fairy",
    totalCandy: 1504,
    boostCandy: 350,
    normalCandy: 1154,
    shards: 1_990_565,
    reachedLv: 70,
    expInLevel: 0,
    candyDemandMet: true,
    preferZeroSurplus: true,
  },
  {
    pokemonId: "flareon",
    pokedexId: 136,
    candyFamilyKey: "133",
    type: "Fire",
    totalCandy: 860,
    boostCandy: 0,
    normalCandy: 860,
    shards: 371_734,
    reachedLv: 60,
    expInLevel: 0,
    candyDemandMet: true,
    preferZeroSurplus: false,
  },
];

const modes = [
  "surplusFirst",
  "surplusGateFirst",
  "legacyImproved",
] satisfies SolverItemCompareMode[];

function reportedInput(mode: SolverItemCompareMode): LevelPlannerInput {
  return {
    pokemonList: [
      {
        pokemonId: "sylveon",
        pokedexId: 700,
        candyFamilyKey: "133",
        name: "70仮ニンフィア",
        type: "Fairy",
        currentLevel: 56,
        currentExpInLevel: 2144,
        targetLevel: 70,
        targetExpInLevel: 0,
        expType: 600,
        nature: "down",
        requestedBoostCandy: 350,
        boostAllowed: true,
        priorityIndex: 0,
      },
      {
        pokemonId: "flareon",
        pokedexId: 136,
        candyFamilyKey: "133",
        name: "ブースター",
        type: "Fire",
        currentLevel: 50,
        currentExpInLevel: 0,
        targetLevel: 60,
        targetExpInLevel: 0,
        expType: 600,
        nature: "normal",
        requestedBoostCandy: 350,
        boostAllowed: true,
        priorityIndex: 1,
      },
    ],
    dreamShards: 10_000_000,
    boost: { kind: "mini", limit: 350 },
    candyInventory: inventory,
    options: { itemCompareMode: mode },
  };
}

describe("reported two-row Eevee family performance", () => {
  it.each(modes)("solves fixed demand exactly: %s", mode => {
    const result = solveFeasibilityForFixedRows(rows, inventory, {
      boostKind: "mini",
      boostLimit: 350,
      dreamShards: 10_000_000,
      itemCompareMode: mode,
      deadlineMs: 5_000,
    });
    console.info("[reported-eevee-family]", mode, result.status, result.stats);
    expect(result.status).toBe("feasible");
    expect(Math.max(...result.stats.rowOptionCounts)).toBeLessThanOrEqual(1_000);
    expect(Math.max(...result.stats.typeBlockFrontierCounts)).toBeLessThanOrEqual(750);
    expect(result.stats.globalKeyCount).toBeLessThanOrEqual(750);
    expect(result.stats.transitions).toBeLessThanOrEqual(80_000);
    if (isPerfWallClockEnabled()) {
      expect(result.stats.durationMs).toBeLessThan(perfBudgetMs(1_000));
    }
  }, 60_000);

  it.each(modes)("solves the full reported plan exactly and quickly: %s", mode => {
    __levelPlannerTestHooks.clearCandidateCache();
    const startedAt = performance.now();
    const outcome = solveLevelPlanWithBudget(reportedInput(mode), {
      calculationMode: "exact",
      deadlineMs: 2_000,
    });
    const durationMs = performance.now() - startedAt;
    expect(outcome.kind).toBe("result");
    if (outcome.kind !== "result") return;
    const result = outcome.result;
    const lines = result.pokemonResults.map(row => row.reachableLine);

    expect(lines).toHaveLength(2);
    expect(lines.every(line => line.candyDemandMet)).toBe(true);
    expect(lines[0]).toMatchObject({
      level: 70,
      expInLevel: 0,
      boostedCandyUnits: 350,
      totalCandyUnitsUsed: 1504,
    });
    expect(lines[1]).toMatchObject({
      level: 60,
      expInLevel: 0,
      boostedCandyUnits: 0,
      totalCandyUnitsUsed: 860,
    });
    expect(lines.map(line => line.candySupply.species)).toEqual([1000, 0]);
    expect(result.lossLedger.hasLoss).toBe(false);
    if (isPerfWallClockEnabled()) {
      expect(result.performance?.feasibilityMs).toBeLessThan(perfBudgetMs(1_000));
      expect(durationMs).toBeLessThan(perfBudgetMs(2_000));
    }
    console.info("[reported-eevee-family-full-plan]", mode, {
      durationMs,
      feasibilityMs: result.performance?.feasibilityMs,
      refineMs: result.performance?.refineMs,
      refineStatus: result.performance?.refineStatus,
    });
  }, 60_000);
});
