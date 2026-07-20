/// <reference lib="webworker" />

import { solveLevelPlanWithBudget } from '../domain/level-planner/core/solveLevelPlan';
import type {
  CalculationMode,
  DeadlineExceededMeta,
  LevelPlannerInput,
  LevelPlannerResult,
  MixedCalculationMeta,
  PlannerTuning,
} from '../domain/level-planner/types';
import { setPerfEnabled } from '../utils/perf';

export type PlannerWorkerRequest = {
  slotId: string;
  requestId: number;
  lane: 'auto' | 'manualExact';
  inputSignature: string;
  input: LevelPlannerInput;
  calculationMode: CalculationMode;
  tuning?: Partial<PlannerTuning>;
  deadlineMs?: number;
  abortAfterExpansions?: number;
  mixedPrefixCount?: number;
  perfEnabled: boolean;
};

export type PlannerWorkerResponse =
  | {
      kind: 'result';
      slotId: string;
      requestId: number;
      lane: 'auto' | 'manualExact';
      inputSignature: string;
      calculationMode: CalculationMode;
      result: LevelPlannerResult;
      durationMs: number;
      mixedMeta?: MixedCalculationMeta;
    }
  | {
      kind: 'deadlineExceeded';
      slotId: string;
      requestId: number;
      lane: 'auto' | 'manualExact';
      inputSignature: string;
      calculationMode: 'exact';
      meta: DeadlineExceededMeta;
      mixedResult: LevelPlannerResult;
      durationMs: number;
      mixedMeta: MixedCalculationMeta;
    }
  | {
      kind: 'error';
      slotId: string;
      requestId: number;
      lane: 'auto' | 'manualExact';
      inputSignature: string;
      error: string;
    };

const ctx = self as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<PlannerWorkerRequest>) => {
  const request = event.data;
  setPerfEnabled(request.perfEnabled);
  const started = performance.now();
  try {
    const outcome = solveLevelPlanWithBudget(request.input, {
      calculationMode: request.calculationMode,
      tuning: request.tuning,
      deadlineMs: request.deadlineMs,
      abortAfterExpansions: request.abortAfterExpansions,
      mixedPrefixCount: request.mixedPrefixCount,
    });
    if (outcome.kind === 'deadlineExceeded') {
      ctx.postMessage({
        kind: 'deadlineExceeded',
        slotId: request.slotId,
        requestId: request.requestId,
        lane: request.lane,
        inputSignature: request.inputSignature,
        calculationMode: 'exact',
        meta: outcome.meta,
        mixedResult: outcome.mixedResult,
        durationMs: outcome.durationMs,
        mixedMeta: outcome.mixedMeta,
      } satisfies PlannerWorkerResponse);
      return;
    }
    const durationMs = request.perfEnabled ? outcome.durationMs : Math.max(0, performance.now() - started);
    if (request.perfEnabled) {
      console.info('[perf] levelPlanner.worker.solveLevelPlan', {
        lane: request.lane,
        calculationMode: request.calculationMode,
        durationMs: Math.round(durationMs * 100) / 100,
      });
    }
    ctx.postMessage({
      kind: 'result',
      slotId: request.slotId,
      requestId: request.requestId,
      lane: request.lane,
      inputSignature: request.inputSignature,
      calculationMode: request.calculationMode,
      result: outcome.result,
      durationMs,
      mixedMeta: outcome.mixedMeta,
    } satisfies PlannerWorkerResponse);
  } catch (error) {
    ctx.postMessage({
      kind: 'error',
      slotId: request.slotId,
      requestId: request.requestId,
      lane: request.lane,
      inputSignature: request.inputSignature,
      error: error instanceof Error ? error.message : String(error),
    } satisfies PlannerWorkerResponse);
  }
};

export {};
