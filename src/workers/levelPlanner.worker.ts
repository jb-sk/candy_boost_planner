/// <reference lib="webworker" />

import { solveLevelPlan } from '../domain/level-planner/core/solveLevelPlan';
import type { LevelPlannerInput, LevelPlannerResult } from '../domain/level-planner/types';
import { setPerfEnabled } from '../utils/perf';

export type PlannerWorkerRequest = {
  requestId: number;
  input: LevelPlannerInput;
  perfEnabled: boolean;
};

export type PlannerWorkerResponse =
  | {
      kind: 'result';
      requestId: number;
      result: LevelPlannerResult;
      durationMs: number;
    }
  | {
      kind: 'error';
      requestId: number;
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
      requestId: request.requestId,
      result,
      durationMs,
    } satisfies PlannerWorkerResponse);
  } catch (error) {
    ctx.postMessage({
      kind: 'error',
      requestId: request.requestId,
      error: error instanceof Error ? error.message : String(error),
    } satisfies PlannerWorkerResponse);
  }
};

export {};
