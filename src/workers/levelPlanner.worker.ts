/// <reference lib="webworker" />

import { solveLevelPlan } from '../domain/level-planner/core/solveLevelPlan';
import type { LevelPlannerInput, LevelPlannerResult } from '../domain/level-planner/types';
import { setPerfEnabled } from '../utils/perf';

export type PlannerWorkerRequest = {
  slotId: string;
  requestId: number;
  inputSignature: string;
  input: LevelPlannerInput;
  perfEnabled: boolean;
};

export type PlannerWorkerResponse =
  | {
      kind: 'result';
      slotId: string;
      requestId: number;
      inputSignature: string;
      result: LevelPlannerResult;
      durationMs: number;
    }
  | {
      kind: 'error';
      slotId: string;
      requestId: number;
      inputSignature: string;
      error: string;
    };

const ctx = self as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<PlannerWorkerRequest>) => {
  const request = event.data;
  setPerfEnabled(request.perfEnabled);
  const started = performance.now();
  try {
    const result = solveLevelPlan(request.input);
    const durationMs = Math.max(0, performance.now() - started);
    if (request.perfEnabled) {
      console.info('[perf] levelPlanner.worker.solveLevelPlan', {
        durationMs: Math.round(durationMs * 100) / 100,
      });
    }
    ctx.postMessage({
      kind: 'result',
      slotId: request.slotId,
      requestId: request.requestId,
      inputSignature: request.inputSignature,
      result,
      durationMs,
    } satisfies PlannerWorkerResponse);
  } catch (error) {
    ctx.postMessage({
      kind: 'error',
      slotId: request.slotId,
      requestId: request.requestId,
      inputSignature: request.inputSignature,
      error: error instanceof Error ? error.message : String(error),
    } satisfies PlannerWorkerResponse);
  }
};

export {};
