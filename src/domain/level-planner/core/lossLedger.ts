import type { PlannerLossLedger } from '../types';

export type InternalPlannerLossLedger = PlannerLossLedger & {
  seenSupplyCutKeys: Set<string>;
};

export function createPlannerLossLedger(): InternalPlannerLossLedger {
  return {
    hasLoss: false,
    supplyCandidateCuts: [],
    frontierCuts: [],
    stateCaps: [],
    expansionCapReductions: [],
    seenSupplyCutKeys: new Set<string>(),
  };
}

export function toPublicPlannerLossLedger(
  ledger: InternalPlannerLossLedger,
): PlannerLossLedger {
  return {
    hasLoss: ledger.hasLoss,
    supplyCandidateCuts: ledger.supplyCandidateCuts,
    frontierCuts: ledger.frontierCuts,
    stateCaps: ledger.stateCaps,
    expansionCapReductions: ledger.expansionCapReductions,
  };
}
