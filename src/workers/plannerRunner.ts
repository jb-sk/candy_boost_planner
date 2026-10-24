import type { LevelPlannerInput, LevelPlannerResult } from '../domain/level-planner/types';
import { isPerfEnabled } from '../utils/perf';
import type { PlannerWorkerRequest, PlannerWorkerResponse } from './levelPlanner.worker';

export interface PlannerRunner {
  /** input を計算する。実行中の依頼があればそれを捨てる。最後に頼んだ分の結果だけ届く。 */
  run(input: LevelPlannerInput, onResult: (output: { result: LevelPlannerResult; durationMs: number }) => void, onError: (error: unknown) => void): void;
  /** 実行中の依頼を捨てる。実行中ならワーカーを破棄する。空いているワーカーは残す。 */
  cancel(): void;
  /** ワーカーを破棄する。以後は結果を届けない。 */
  dispose(): void;
}

const PLANNER_RUNNER_PERF_ENABLED = isPerfEnabled();

let plannerFallbackModulePromise: Promise<typeof import('../domain/level-planner/core/solveLevelPlan')> | null = null;

/**
 * ソルバーを初期読み込みに入れないため、Worker がない環境で初めて呼ばれたときに読む。
 * 種族不明の行をその行だけで解くとき（`useCalcStore`）も同じ読み込みを使う。
 */
export function loadPlannerFallbackModule() {
  plannerFallbackModulePromise ??= import('../domain/level-planner/core/solveLevelPlan');
  return plannerFallbackModulePromise;
}

/**
 * ワーカーの寿命と使い回し、最後の依頼だけを返すこと、Worker がない環境の代わりの経路だけを持つ。
 * 待ち時間・結果のキャッシュ・保存の先送りは呼び出し側が持つ。
 */
export function createPlannerRunner(): PlannerRunner {
  let worker: Worker | null = null;
  let busy = false;
  let disposed = false;
  let requestId = 0;
  let active: { requestId: number; onResult: Parameters<PlannerRunner['run']>[1]; onError: (error: unknown) => void } | null = null;

  function destroyWorker(): void {
    worker?.terminate();
    worker = null;
    busy = false;
  }

  function ensureWorker(): Worker {
    if (worker) return worker;
    const created = new Worker(new URL('./levelPlanner.worker.ts', import.meta.url), { type: 'module' });
    worker = created;
    created.onmessage = (event: MessageEvent<PlannerWorkerResponse>) => {
      const response = event.data;
      if (!active || response.requestId !== active.requestId) return;
      const { onResult, onError } = active;
      active = null;
      busy = false;
      if (response.kind === 'error') onError(response.error);
      else onResult({ result: response.result, durationMs: response.durationMs });
    };
    created.onerror = (event) => {
      console.error('[level-planner] worker error:', event.message);
      // 破棄したワーカーの遅れて届いた失敗で、新しいワーカーと今の依頼を巻き込まない
      if (worker !== created) return;
      const failed = active;
      active = null;
      destroyWorker();
      failed?.onError(event.message);
    };
    return created;
  }

  function cancel(): void {
    active = null;
    requestId++;
    if (busy) destroyWorker();
  }

  return {
    run(input, onResult, onError) {
      if (disposed) return;
      cancel();
      const id = ++requestId;
      active = { requestId: id, onResult, onError };
      if (typeof Worker === 'undefined') {
        // Worker が使えない環境の代わりの経路。メインスレッドで同じ計算を呼ぶ。
        void loadPlannerFallbackModule()
          .then(({ solveLevelPlan }) => {
            if (!active || active.requestId !== id) return;
            const started = performance.now();
            const result = solveLevelPlan(input);
            const durationMs = Math.max(0, performance.now() - started);
            active = null;
            onResult({ result, durationMs });
          })
          .catch((error: unknown) => {
            if (!active || active.requestId !== id) return;
            active = null;
            onError(error);
          });
        return;
      }
      busy = true;
      ensureWorker().postMessage({ requestId: id, input, perfEnabled: PLANNER_RUNNER_PERF_ENABLED } satisfies PlannerWorkerRequest);
    },
    cancel,
    dispose() {
      disposed = true;
      active = null;
      requestId++;
      destroyWorker();
    },
  };
}
