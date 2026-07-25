import { CANDY_VALUES } from './constants';
import { validateFeasibilityWitness } from './core/feasibilityWitness';
import { getCandyFamilyKey } from '../pokesleep/candy-family';
import type {
  BoostKind,
  CalculationMode,
  CalculationPolicy,
  CandyInventory,
  CandySupplyBreakdown,
  FeasibilityDemandRow,
  FeasibilitySolverOptions,
  FeasibilityWitness,
  ItemCompareMode,
  LevelPlannerResult,
  MixedCalculationMeta,
  PokemonPlanLine,
  PokemonPlanResult,
  StructuralProbeStatus,
} from './types';

export type DebugExportRow = {
  id: string;
  name: string;
  pokedexId?: number;
  candyFamilyKey?: string;
  type: string;
  nature: string;
  currentLevel: number;
  currentExpInLevel: number;
  expRemaining: number;
  targetLevel: number;
  targetExpInLevel?: number;
  candyTarget?: number;
  plan: PokemonPlanResult | null;
};

export type DebugExportDisplayedResult = {
  result: LevelPlannerResult;
  calculationMode: CalculationMode;
  loss: boolean;
  durationMs: number;
  mixedPrefixCount?: number;
  mixedSource?: MixedCalculationMeta['source'];
};

export type DebugExportPerformanceProfile = {
  policy: CalculationPolicy;
  structuralProbeStatus: StructuralProbeStatus;
  lastDeadlineMs?: number;
  mixedPrefixCount?: number;
};

/** Immutable snapshots only. Vue refs/views and solver callbacks must not enter this DTO. */
export type DebugExportContext = {
  result: LevelPlannerResult | null;
  rows: DebugExportRow[];
  itemCompareMode: ItemCompareMode;
  inventorySnapshot: CandyInventory;
  boost: { kind: BoostKind; limit: number };
  dreamShards: number;
  displayed: DebugExportDisplayedResult | null;
  performanceProfile: DebugExportPerformanceProfile;
  /** Documents that exact supply information came from the normal calculation path. */
  verificationMode: 'normalPathSnapshot';
};

export function tsvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

function supplyItemValue(supply: CandySupplyBreakdown | undefined): number {
  if (!supply) return 0;
  return supply.species
    + supply.type.s * CANDY_VALUES.type.s
    + supply.type.m * CANDY_VALUES.type.m
    + supply.universal.s * CANDY_VALUES.universal.s
    + supply.universal.m * CANDY_VALUES.universal.m
    + supply.universal.l * CANDY_VALUES.universal.l;
}

function lineItemValue(line: PokemonPlanLine | undefined): number {
  return supplyItemValue(line?.candySupply);
}

function lineNonSpeciesItemValue(line: PokemonPlanLine | undefined): number {
  return Math.max(0, lineItemValue(line) - (line?.candySupply.species ?? 0));
}

function lineSurplus(line: PokemonPlanLine | undefined): number {
  if (!line) return 0;
  return Math.max(0, line.surplusCandyValue, lineItemValue(line) - line.totalCandyUnitsUsed);
}

function debugOptionFromLine(line: PokemonPlanLine) {
  return {
    species: line.candySupply.species,
    typeS: line.candySupply.type.s,
    typeM: line.candySupply.type.m,
    universalS: line.candySupply.universal.s,
    universalM: line.candySupply.universal.m,
    universalL: line.candySupply.universal.l,
    supply: lineItemValue(line),
    surplus: lineSurplus(line),
  };
}

function mixedPrefixCount(context: DebugExportContext): number {
  const rowCount = context.rows.length;
  const displayed = context.displayed;
  if (displayed?.calculationMode !== 'prefixLocalMixed') return rowCount;
  if (displayed.mixedSource === 'feasibility') return 0;
  return Math.max(0, Math.min(
    rowCount,
    displayed.mixedPrefixCount ?? context.performanceProfile.mixedPrefixCount ?? 0,
  ));
}

function mixedLocalSuffixCount(context: DebugExportContext): number {
  const displayed = context.displayed;
  if (displayed?.calculationMode !== 'prefixLocalMixed') return 0;
  if (displayed.mixedSource === 'feasibility') return 0;
  return context.rows.length - mixedPrefixCount(context);
}

function calculationScopeForRow(context: DebugExportContext, index: number): string {
  const displayed = context.displayed;
  if (!displayed) return '';
  if (displayed.calculationMode === 'exact') return 'exact';
  if (displayed.mixedSource === 'feasibility') return 'feasibilityWitness';
  return index < mixedPrefixCount(context) ? 'exactPrefix' : 'localSuffix';
}

function planRows(context: DebugExportContext): Array<DebugExportRow & { plan: PokemonPlanResult }> {
  return context.rows.filter((row): row is DebugExportRow & { plan: PokemonPlanResult } => row.plan !== null);
}

function appendSupplyRows(
  lines: string[],
  label: 'selected' | 'best',
  rows: Array<DebugExportRow & { plan: PokemonPlanResult }>,
): void {
  lines.push(`${label}Rows\tindex\tname\tcandyFamilyKey\tspecies\ttypeS\ttypeM\tuniversalS\tuniversalM\tuniversalL\tsupply\tsurplus`);
  rows.forEach((row, index) => {
    const option = debugOptionFromLine(row.plan.reachableLine);
    lines.push([
      label,
      index + 1,
      row.name,
      row.candyFamilyKey ?? getCandyFamilyKey(row.plan.pokedexId),
      option.species,
      option.typeS,
      option.typeM,
      option.universalS,
      option.universalM,
      option.universalL,
      option.supply,
      option.surplus,
    ].map(tsvCell).join('\t'));
  });
}

function buildExactVerificationTsv(context: DebugExportContext): string[] {
  if (!context.result) return ['EXACT_VERIFICATION', 'status\tno_plan'];
  const rows = planRows(context);
  if (rows.length !== context.rows.length) return ['EXACT_VERIFICATION', 'status\tplan_pending'];

  const prefixCount = context.displayed?.calculationMode === 'prefixLocalMixed'
    ? mixedPrefixCount(context)
    : rows.length;
  const localSuffixCount = context.displayed?.calculationMode === 'prefixLocalMixed'
    ? mixedLocalSuffixCount(context)
    : 0;
  const refineStatus = context.result.performance?.refineStatus ?? 'not_available';
  const refineReason = context.result.performance?.refineReason ?? '';
  const selectedIsExactBest = refineStatus === 'ok' && !refineReason;
  const hasShortage = rows.some(row => (
    row.plan.shortage.candyToTarget > 0
    || row.plan.shortage.boostCandyUnavailable > 0
    || row.plan.shortage.dreamShardShortage > 0
  ));
  const note = [
    'normal-path fixed-demand refine snapshot; export solver disabled',
    hasShortage ? 'shortage present; not full-plan oracle' : '',
    refineReason,
  ].filter(Boolean).join('; ');

  const lines = [
    'EXACT_VERIFICATION',
    'status\tselectedIsExactBest\tmode\trows\tlocalCandidateCounts\tdpFinalStates\tscope\texactPrefixCount\tlocalSuffixCount\tnote',
    [
      refineStatus,
      selectedIsExactBest ? true : '',
      context.itemCompareMode,
      rows.length,
      '',
      '',
      context.verificationMode,
      prefixCount,
      localSuffixCount,
      note,
    ].map(tsvCell).join('\t'),
  ];
  appendSupplyRows(lines, 'selected', rows);
  if (selectedIsExactBest) appendSupplyRows(lines, 'best', rows);
  return lines;
}

function feasibilitySupply(line: PokemonPlanLine): FeasibilityWitness['rows'][number]['supply'] {
  return {
    species: line.candySupply.species,
    typeS: line.candySupply.type.s,
    typeM: line.candySupply.type.m,
    universalS: line.candySupply.universal.s,
    universalM: line.candySupply.universal.m,
    universalL: line.candySupply.universal.l,
  };
}

function feasibilityDemandRow(row: DebugExportRow & { plan: PokemonPlanResult }): FeasibilityDemandRow {
  const line = row.plan.reachableLine;
  return {
    pokemonId: row.plan.pokemonId,
    pokedexId: row.plan.pokedexId,
    candyFamilyKey: row.candyFamilyKey ?? getCandyFamilyKey(row.plan.pokedexId),
    type: row.type,
    totalCandy: line.totalCandyUnitsUsed,
    boostCandy: line.boostedCandyUnits,
    normalCandy: line.nonBoostCandyUnits,
    shards: line.dreamShardsUsed,
    reachedLv: line.level,
    expInLevel: line.expInLevel,
    targetReached: line.targetReached,
  };
}

function subtractRemaining(
  rows: FeasibilityWitness['rows'],
  inventory: CandyInventory,
  options: FeasibilitySolverOptions,
): FeasibilityWitness['remaining'] {
  const species = { ...inventory.species };
  const typeCandy = Object.fromEntries(
    Object.entries(inventory.typeCandy).map(([type, stock]) => [type, { ...stock }]),
  );
  const universal = { ...inventory.universal };
  let boostCandy = options.boostLimit ?? Number.POSITIVE_INFINITY;
  let dreamShards = options.dreamShards ?? Number.POSITIVE_INFINITY;

  for (const row of rows) {
    const speciesKey = row.candyFamilyKey;
    species[speciesKey] = (species[speciesKey] ?? 0) - row.supply.species;
    const stock = typeCandy[row.type] ?? { s: 0, m: 0 };
    typeCandy[row.type] = { s: stock.s - row.supply.typeS, m: stock.m - row.supply.typeM };
    universal.s -= row.supply.universalS;
    universal.m -= row.supply.universalM;
    universal.l -= row.supply.universalL;
    boostCandy -= row.boostCandy;
    dreamShards -= row.shards;
  }
  return { species, typeCandy, universal, boostCandy, dreamShards };
}

function buildFeasibilityTsv(context: DebugExportContext): string[] {
  if (!context.result) return ['FBL01D_FEASIBILITY', 'status\tno_plan'];
  const rows = planRows(context);
  if (rows.length !== context.rows.length) return ['FBL01D_FEASIBILITY', 'status\tplan_pending'];
  const options: FeasibilitySolverOptions = {
    boostKind: context.boost.kind,
    boostLimit: context.boost.limit,
    dreamShards: context.dreamShards,
    itemCompareMode: context.itemCompareMode,
  };
  const demandRows = rows.map(feasibilityDemandRow);
  const witnessRows = rows.map((row, index) => ({
    ...demandRows[index],
    supply: feasibilitySupply(row.plan.reachableLine),
  }));
  const boundaryIndex = demandRows.findIndex(row => !row.targetReached);
  const witness: FeasibilityWitness = {
    reachedCount: boundaryIndex === -1 ? demandRows.length : boundaryIndex,
    boundaryIndex: boundaryIndex === -1 ? null : boundaryIndex,
    boundaryLevel: boundaryIndex === -1 ? 0 : demandRows[boundaryIndex].reachedLv,
    boundaryExpInLevel: boundaryIndex === -1 ? 0 : demandRows[boundaryIndex].expInLevel,
    rows: witnessRows,
    remaining: subtractRemaining(witnessRows, context.inventorySnapshot, options),
  };
  const validation = validateFeasibilityWitness(witness, demandRows, context.inventorySnapshot, options);
  const lines = [
    'FBL01D_FEASIBILITY',
    'status\tselectedValid\tsolverStatus\trefineStatus\trows\treachedCount\tboundaryIndex\tboundaryLv\tboundaryExp\tdurationMs\tglobalKeyCount\ttransitions\twitnessRestoreMs\treason',
    [
      'ok',
      validation.valid,
      'skipped_export_safety',
      'skipped_export_safety',
      demandRows.length,
      witness.reachedCount,
      witness.boundaryIndex ?? '',
      witness.boundaryLevel,
      witness.boundaryExpInLevel,
      '', '', '', '',
      validation.valid ? 'heavy_solver_disabled_in_tsv_export' : validation.errors.join(','),
    ].map(tsvCell).join('\t'),
  ];
  if (!validation.valid) {
    lines.push('selectedValidation\terrors');
    lines.push(['invalid', validation.errors.join(',')].map(tsvCell).join('\t'));
  }
  lines.push('selectedRows\tindex\tname\tcandyFamilyKey\ttotalCandy\tboostCandy\tnormalCandy\tshards\treachedLv\texpInLevel\ttargetReached\tspecies\ttypeS\ttypeM\tuniversalS\tuniversalM\tuniversalL\tsupply\tsurplus');
  witness.rows.forEach((row, index) => {
    const supply = row.supply.species
      + row.supply.typeS * CANDY_VALUES.type.s
      + row.supply.typeM * CANDY_VALUES.type.m
      + row.supply.universalS * CANDY_VALUES.universal.s
      + row.supply.universalM * CANDY_VALUES.universal.m
      + row.supply.universalL * CANDY_VALUES.universal.l;
    lines.push([
      'selected', index + 1, rows[index].name, row.candyFamilyKey, row.totalCandy, row.boostCandy,
      row.normalCandy, row.shards, row.reachedLv, row.expInLevel, row.targetReached,
      row.supply.species, row.supply.typeS, row.supply.typeM, row.supply.universalS,
      row.supply.universalM, row.supply.universalL, supply, supply - row.totalCandy,
    ].map(tsvCell).join('\t'));
  });
  lines.push('remaining\tuniversalS\tuniversalM\tuniversalL\tboostCandy\tdreamShards');
  lines.push([
    'selected', witness.remaining.universal.s, witness.remaining.universal.m,
    witness.remaining.universal.l, witness.remaining.boostCandy, witness.remaining.dreamShards,
  ].map(tsvCell).join('\t'));
  return lines;
}

function buildLossLedgerTsv(context: DebugExportContext): string[] {
  if (!context.result) return ['LOSS_LEDGER', 'status\tno_plan'];
  const ledger = context.result.lossLedger;
  const lines = [
    'LOSS_LEDGER',
    'status\thasLoss\tsupplyCandidateCuts\tfrontierCuts\tstateCaps\texpansionCapReductions',
    ['ok', ledger.hasLoss, ledger.supplyCandidateCuts.length, ledger.frontierCuts.length, ledger.stateCaps.length, ledger.expansionCapReductions.length].map(tsvCell).join('\t'),
  ];
  if (ledger.supplyCandidateCuts.length) {
    lines.push('supplyCandidateCuts\tpokemonId\tname\tpokedexId\tcandyFamilyKey\ttotalCandyUnits\tlimit\tkept\tselectedBeforeTrim\tstoppedAtSurplus\tmaxSurplus\tsharedSpecies\titemCompareMode');
    for (const cut of ledger.supplyCandidateCuts) {
      lines.push(['supply', cut.pokemonId, cut.name, cut.pokedexId, getCandyFamilyKey(cut.pokedexId), cut.totalCandyUnits, cut.limit, cut.kept, cut.selectedBeforeTrim, cut.stoppedAtSurplus, cut.maxSurplus, cut.sharedSpecies, cut.itemCompareMode].map(tsvCell).join('\t'));
    }
  }
  if (ledger.frontierCuts.length) {
    lines.push('frontierCuts\tindex\tbefore\tafter\tlimit\tsignatureMergedStates');
    for (const cut of ledger.frontierCuts) lines.push(['frontier', cut.index, cut.before, cut.after, cut.limit, cut.signatureMergedStates].map(tsvCell).join('\t'));
  }
  if (ledger.stateCaps.length) {
    lines.push('stateCaps\tindex\tcap\treason');
    for (const cap of ledger.stateCaps) lines.push(['stateCap', cap.index, cap.cap, cap.reason].map(tsvCell).join('\t'));
  }
  if (ledger.expansionCapReductions.length) {
    lines.push('expansionCapReductions\tindex\texpansions\tcap');
    for (const reduction of ledger.expansionCapReductions) lines.push(['expansionCap', reduction.index, reduction.expansions, reduction.cap].map(tsvCell).join('\t'));
  }
  return lines;
}

function displayCalculationMode(displayed: DebugExportDisplayedResult | null): string {
  if (!displayed) return 'none';
  if (displayed.calculationMode === 'prefixLocalMixed' && displayed.mixedSource === 'feasibility') return 'feasibilityWitness';
  return displayed.calculationMode;
}

function displayCalculationPolicy(policy: CalculationPolicy): string {
  return policy === 'autoMixed' ? 'autoWitness' : policy;
}

function buildCalculationPolicyTsv(context: DebugExportContext): string[] {
  const displayed = context.displayed;
  const rowCount = context.rows.length;
  const prefix = displayed?.calculationMode === 'prefixLocalMixed' ? mixedPrefixCount(context) : null;
  const prefixCount = prefix ?? (displayed?.calculationMode === 'exact' ? rowCount : '');
  const localCount = prefix === null ? '' : mixedLocalSuffixCount(context);
  const localStartIndex = prefix === null || localCount === 0 ? '' : prefix + 1;
  return [
    'CALCULATION_POLICY',
    'mode\tpolicy\tstructuralProbeStatus\tdeadlineMs\tactualDurationMs\tfeasibilityMs\trefineMs\trefineStatus\trefineReason\tloss\tsource\texactPrefixCount\tlocalStartIndex\tlocalSuffixCount',
    [
      displayCalculationMode(displayed),
      displayCalculationPolicy(context.performanceProfile.policy),
      context.performanceProfile.structuralProbeStatus,
      context.performanceProfile.lastDeadlineMs ?? '',
      displayed?.durationMs ?? '',
      displayed?.result.performance?.feasibilityMs ?? '',
      displayed?.result.performance?.refineMs ?? '',
      displayed?.result.performance?.refineStatus ?? '',
      displayed?.result.performance?.refineReason ?? '',
      displayed?.loss ?? '',
      displayed?.mixedSource ?? '',
      prefixCount,
      localStartIndex,
      localCount,
    ].map(tsvCell).join('\t'),
  ];
}

function buildBoundarySearchTsv(context: DebugExportContext): string[] {
  const summary = context.displayed?.result.performance?.boundarySearch;
  if (!summary) return ['BOUNDARY_SEARCH', 'status\tnone'];
  const lines = [
    'BOUNDARY_SEARCH',
    'status\tmode\tboundaryIndex\ttargetTotalCandy\tmaxFeasibleTotalCandy\tmaxFeasibleScope\tselectedTotalCandy\tcheckedLowerTotals\tfeasibleLowerTotals\trejectedLowerTotals\tinconclusiveLowerTotals\trowSurplusGateSkippedTotals\tdecisionRejectedLowerTotals\tfirstZeroRawSurplusTotalCandy\tselectedRawSurplus\tselectedNormalizedSurplus\tselectedBoundaryLv\tselectedBoundaryExp\tstoppedReason\trawSurplusTrend\tsamplesTruncated',
    ['ok', summary.mode, summary.boundaryIndex + 1, summary.targetTotalCandy, summary.maxFeasibleTotalCandy, summary.maxFeasibleScope, summary.selectedTotalCandy, summary.checkedLowerTotals, summary.feasibleLowerTotals, summary.rejectedLowerTotals, summary.inconclusiveLowerTotals, summary.rowSurplusGateSkippedTotals, summary.decisionRejectedLowerTotals, summary.firstZeroRawSurplusTotalCandy ?? '', summary.selectedRawSurplus, summary.selectedNormalizedSurplus, summary.selectedBoundaryLevel, summary.selectedBoundaryExpInLevel, summary.stoppedReason, summary.rawSurplusTrend, summary.samplesTruncated].map(tsvCell).join('\t'),
  ];
  if (summary.samples.length) {
    lines.push('boundarySamples\ttotalCandy\tstatus\trawSurplus\tnormalizedSurplus\tboundaryLv\tboundaryExp');
    for (const sample of summary.samples) lines.push(['sample', sample.totalCandy, sample.status, sample.rawSurplus ?? '', sample.normalizedSurplus ?? '', sample.boundaryLevel ?? '', sample.boundaryExpInLevel ?? ''].map(tsvCell).join('\t'));
  }
  return lines;
}

export function buildDebugExportTsv(context: DebugExportContext): string {
  const headers = [
    'index', 'id', 'name', 'pokedexId', 'candyFamilyKey', 'type', 'nature',
    'currentLv', 'currentExpInLevel', 'expRemaining', 'targetLv', 'targetExpInLevel', 'candyTarget',
    'boostKind', 'itemCompareMode', 'calculationScope', 'reachedLv', 'targetReached', 'role', 'expToNext', 'expToTarget',
    'shortageCandy', 'shortageBoost', 'shortageShards', 'limitingFactor', 'initialSpeciesStock',
    'reachableBoost', 'reachableNormal', 'reachableTotalCandy', 'reachableShards',
    'reachableSpecies', 'reachableTypeS', 'reachableTypeM', 'reachableUniversalS', 'reachableUniversalM', 'reachableUniversalL',
    'reachableTotalSupply', 'reachableItemValue', 'reachableNonSpeciesItemValue', 'reachableSurplus',
    'targetBoost', 'targetNormal', 'targetTotalCandy', 'targetShards',
    'targetSpecies', 'targetTypeS', 'targetTypeM', 'targetUniversalS', 'targetUniversalM', 'targetUniversalL',
    'targetTotalSupply', 'targetItemValue', 'targetNonSpeciesItemValue', 'targetSurplus',
    // targetLv/targetExpInLevel は睡眠後の最終目標。アメを使い終えた地点は別列で出す（設計書§6.4）。
    'plannedCandyEndLevel', 'plannedCandyEndExpInLevel',
    'reachableCandyEndLevel', 'reachableCandyEndExpInLevel',
  ];
  const lines = [headers.join('\t')];
  if (!context.result) return lines.join('\n');

  context.rows.forEach((row, index) => {
    const plan = row.plan;
    if (!plan) {
      lines.push([index + 1, row.id, row.name, row.pokedexId ?? '', row.candyFamilyKey ?? (row.pokedexId ? getCandyFamilyKey(row.pokedexId) : ''), row.type, row.nature, row.currentLevel, row.currentExpInLevel, row.expRemaining, row.targetLevel, row.targetExpInLevel ?? '', row.candyTarget ?? '', context.boost.kind, context.itemCompareMode, calculationScopeForRow(context, index)].map(tsvCell).join('\t'));
      return;
    }
    const reachable = plan.reachableLine;
    const target = plan.targetLine;
    const targetTotal = target.boostedCandyUnits + target.nonBoostCandyUnits;
    lines.push([
      index + 1, row.id, row.name, plan.pokedexId, row.candyFamilyKey ?? getCandyFamilyKey(plan.pokedexId), row.type, row.nature,
      row.currentLevel, row.currentExpInLevel, row.expRemaining, row.targetLevel, plan.targetExpInLevel, row.candyTarget ?? '',
      context.boost.kind, context.itemCompareMode, calculationScopeForRow(context, index), reachable.level, reachable.targetReached, plan.role,
      reachable.expToNextLevel, plan.shortage.expToTarget, plan.shortage.candyToTarget, plan.shortage.boostCandyUnavailable,
      plan.shortage.dreamShardShortage, plan.constraintDiagnosis.limitingFactor ?? '', context.inventorySnapshot.species[row.candyFamilyKey ?? getCandyFamilyKey(plan.pokedexId)] ?? 0,
      reachable.boostedCandyUnits, reachable.nonBoostCandyUnits, reachable.totalCandyUnitsUsed, reachable.dreamShardsUsed,
      reachable.candySupply.species, reachable.candySupply.type.s, reachable.candySupply.type.m, reachable.candySupply.universal.s, reachable.candySupply.universal.m, reachable.candySupply.universal.l,
      lineItemValue(reachable), lineItemValue(reachable), lineNonSpeciesItemValue(reachable), lineSurplus(reachable),
      target.boostedCandyUnits, target.nonBoostCandyUnits, targetTotal, target.dreamShardsUsed,
      target.candySupply.species, target.candySupply.type.s, target.candySupply.type.m, target.candySupply.universal.s, target.candySupply.universal.m, target.candySupply.universal.l,
      lineItemValue(target), lineItemValue(target), lineNonSpeciesItemValue(target), lineSurplus(target),
      target.level, target.expInLevel,
      reachable.level, reachable.expInLevel,
    ].map(tsvCell).join('\t'));
  });

  lines.push('', ...buildCalculationPolicyTsv(context));
  lines.push('', ...buildBoundarySearchTsv(context));
  lines.push('', ...buildLossLedgerTsv(context));
  lines.push('', ...buildExactVerificationTsv(context));
  lines.push('', ...buildFeasibilityTsv(context));
  return lines.join('\n');
}
