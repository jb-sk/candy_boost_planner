import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LevelPlannerInput, LevelPlannerResult } from "../domain/level-planner/types";
import type { PlannerWorkerRequest, PlannerWorkerResponse } from "./levelPlanner.worker";
import { createPlannerRunner } from "./plannerRunner";

const input = { tag: "input" } as unknown as LevelPlannerInput;
const resultOf = (tag: string) => ({ tag }) as unknown as LevelPlannerResult;

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<PlannerWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  requests: PlannerWorkerRequest[] = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: PlannerWorkerRequest) {
    this.requests.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(response: PlannerWorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<PlannerWorkerResponse>);
  }
  replyResult(tag: string, durationMs = 5) {
    this.reply({ kind: "result", requestId: this.requests[this.requests.length - 1]!.requestId, result: resultOf(tag), durationMs });
  }
}

describe("createPlannerRunner（Worker あり）", () => {
  const previousWorker = globalThis.Worker;

  beforeEach(() => {
    FakeWorker.instances = [];
    Object.defineProperty(globalThis, "Worker", { value: FakeWorker, configurable: true, writable: true });
  });
  afterEach(() => {
    Object.defineProperty(globalThis, "Worker", { value: previousWorker, configurable: true, writable: true });
  });

  it("続けて2回頼むと最後の結果だけ届き、実行中の頼み直しだけがワーカーを破棄する", () => {
    const runner = createPlannerRunner();
    const results: string[] = [];
    const onResult = (output: { result: LevelPlannerResult }) => results.push((output.result as unknown as { tag: string }).tag);
    runner.run(input, onResult, vi.fn());
    const first = FakeWorker.instances[0]!;
    runner.run(input, onResult, vi.fn());
    expect(first.terminated).toBe(true);
    expect(FakeWorker.instances).toHaveLength(2);
    // 破棄したワーカーからの遅れた応答は捨てる
    first.replyResult("old");
    FakeWorker.instances[1]!.replyResult("new");
    expect(results).toEqual(["new"]);
  });

  it("空いているワーカーは2回目の依頼でも同じものを使い、破棄しない", () => {
    const runner = createPlannerRunner();
    const onResult = vi.fn();
    runner.run(input, onResult, vi.fn());
    FakeWorker.instances[0]!.replyResult("a", 12);
    runner.run(input, onResult, vi.fn());
    FakeWorker.instances[0]!.replyResult("b");
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0]!.terminated).toBe(false);
    expect(onResult).toHaveBeenCalledTimes(2);
    expect(onResult.mock.calls[0]![0]).toEqual({ result: resultOf("a"), durationMs: 12 });
  });

  it("cancel は空いているワーカーを残し、実行中のワーカーは破棄して結果を届けない", () => {
    const runner = createPlannerRunner();
    const onResult = vi.fn();
    runner.run(input, onResult, vi.fn());
    FakeWorker.instances[0]!.replyResult("a");
    runner.cancel();
    expect(FakeWorker.instances[0]!.terminated).toBe(false);

    runner.run(input, onResult, vi.fn());
    onResult.mockClear();
    runner.cancel();
    expect(FakeWorker.instances[0]!.terminated).toBe(true);
    FakeWorker.instances[0]!.replyResult("late");
    expect(onResult).not.toHaveBeenCalled();
  });

  it("dispose 後は結果が届かず、以後の依頼も受けない", () => {
    const runner = createPlannerRunner();
    const onResult = vi.fn();
    runner.run(input, onResult, vi.fn());
    runner.dispose();
    expect(FakeWorker.instances[0]!.terminated).toBe(true);
    FakeWorker.instances[0]!.replyResult("late");
    runner.run(input, onResult, vi.fn());
    expect(FakeWorker.instances).toHaveLength(1);
    expect(onResult).not.toHaveBeenCalled();
  });

  it("ワーカーの失敗は onError に届く（応答の error と onerror）", () => {
    const runner = createPlannerRunner();
    const onError = vi.fn();
    runner.run(input, vi.fn(), onError);
    FakeWorker.instances[0]!.reply({ kind: "error", requestId: FakeWorker.instances[0]!.requests[0]!.requestId, error: "boom" });
    expect(onError).toHaveBeenCalledWith("boom");

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    runner.run(input, vi.fn(), onError);
    FakeWorker.instances[0]!.onerror?.({ message: "crash" } as ErrorEvent);
    expect(onError).toHaveBeenLastCalledWith("crash");
    expect(FakeWorker.instances[0]!.terminated).toBe(true);
    errorSpy.mockRestore();
  });

  it("破棄したワーカーの遅れた onerror は、新しいワーカーと今の依頼に触らない", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const runner = createPlannerRunner();
    const onResult = vi.fn();
    const onError = vi.fn();
    runner.run(input, vi.fn(), vi.fn());
    const first = FakeWorker.instances[0]!;
    runner.run(input, onResult, onError);
    const second = FakeWorker.instances[1]!;
    first.onerror?.({ message: "late crash" } as ErrorEvent);
    expect(onError).not.toHaveBeenCalled();
    expect(second.terminated).toBe(false);
    second.replyResult("new");
    expect(onResult).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});

describe("createPlannerRunner（Worker なし）", () => {
  const previousWorker = globalThis.Worker;

  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, "Worker", { value: undefined, configurable: true, writable: true });
  });
  afterEach(() => {
    vi.doUnmock("../domain/level-planner/core/solveLevelPlan");
    Object.defineProperty(globalThis, "Worker", { value: previousWorker, configurable: true, writable: true });
  });

  it("ソルバーは初めて頼まれたときに動的 import し、メインスレッドで計算して durationMs を返す", async () => {
    let loaded = 0;
    const solveLevelPlan = vi.fn(() => resultOf("main"));
    vi.doMock("../domain/level-planner/core/solveLevelPlan", () => {
      loaded++;
      return { solveLevelPlan };
    });
    const { createPlannerRunner: create } = await import("./plannerRunner");
    const runner = create();
    expect(loaded).toBe(0);

    const output = await new Promise<{ result: LevelPlannerResult; durationMs: number }>((resolve, reject) => {
      runner.run(input, resolve, reject);
    });
    expect(loaded).toBe(1);
    expect(solveLevelPlan).toHaveBeenCalledWith(input);
    expect(output.result).toEqual(resultOf("main"));
    expect(output.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("続けて2回頼むと最後の結果だけ届く", async () => {
    vi.doMock("../domain/level-planner/core/solveLevelPlan", () => ({
      solveLevelPlan: (i: { tag: string }) => resultOf(i.tag),
    }));
    const { createPlannerRunner: create } = await import("./plannerRunner");
    const runner = create();
    const onResult = vi.fn();
    runner.run({ tag: "first" } as unknown as LevelPlannerInput, onResult, vi.fn());
    await new Promise<void>((resolve) => {
      runner.run({ tag: "second" } as unknown as LevelPlannerInput, (output) => {
        onResult(output);
        resolve();
      }, vi.fn());
    });
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]![0].result).toEqual(resultOf("second"));
  });
});
