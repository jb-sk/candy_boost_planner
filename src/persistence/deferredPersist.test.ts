import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelPersist,
  deferPersistUntilReleased,
  flushPersist,
  installPersistFlushHandlers,
  schedulePersist,
} from "./deferredPersist";

describe("deferredPersist", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cancelPersist();
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.stubGlobal("cancelIdleCallback", undefined);
  });

  afterEach(() => {
    cancelPersist();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("coalesces the same key to its latest job", () => {
    const writes: string[] = [];
    schedulePersist("box", () => writes.push("old"));
    schedulePersist("box", () => writes.push("latest"));

    vi.advanceTimersByTime(199);
    expect(writes).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(writes).toEqual(["latest"]);
  });

  it("keeps jobs for different keys", () => {
    const writes: string[] = [];
    schedulePersist("box", () => writes.push("box"));
    schedulePersist("candy", () => writes.push("candy"));

    flushPersist();

    expect(writes).toEqual(["box", "candy"]);
  });

  it("does not run ordinary persistence until critical work is released", () => {
    const write = vi.fn();
    const release = deferPersistUntilReleased();
    schedulePersist("calcSlots", write);

    vi.advanceTimersByTime(1_000);
    expect(write).not.toHaveBeenCalled();

    release();
    release();
    vi.advanceTimersByTime(199);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledOnce();
  });

  it("keeps persistence deferred until every critical section is released", () => {
    const write = vi.fn();
    const releaseFirst = deferPersistUntilReleased();
    const releaseSecond = deferPersistUntilReleased();
    schedulePersist("box", write);

    releaseFirst();
    vi.advanceTimersByTime(1_000);
    expect(write).not.toHaveBeenCalled();

    releaseSecond();
    vi.advanceTimersByTime(200);
    expect(write).toHaveBeenCalledOnce();
  });

  it("allows an explicit flush while persistence is deferred", () => {
    const write = vi.fn();
    const release = deferPersistUntilReleased();
    schedulePersist("candy", write);

    flushPersist();
    expect(write).toHaveBeenCalledOnce();

    release();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses requestIdleCallback with a bounded timeout when available", () => {
    let idleCallback: IdleRequestCallback | undefined;
    const idle = vi.fn((callback: IdleRequestCallback, _options?: IdleRequestOptions) => {
      idleCallback = callback;
      return 42;
    });
    const cancelIdle = vi.fn();
    const write = vi.fn();
    vi.stubGlobal("requestIdleCallback", idle);
    vi.stubGlobal("cancelIdleCallback", cancelIdle);

    schedulePersist("calcSlots", write);

    expect(idle).toHaveBeenCalledOnce();
    expect(idle.mock.calls[0]?.[1]).toEqual({ timeout: 500 });
    idleCallback?.({ didTimeout: false, timeRemaining: () => 10 });
    expect(write).toHaveBeenCalledOnce();

    schedulePersist("calcSlots", vi.fn());
    cancelPersist();
    expect(cancelIdle).toHaveBeenCalledWith(42);
  });

  it("flushes a job rescheduled while flushing", () => {
    const writes: string[] = [];
    schedulePersist("box", () => {
      writes.push("first");
      schedulePersist("box", () => writes.push("second"));
    });

    flushPersist();

    expect(writes).toEqual(["first", "second"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("continues flushing after one job throws", () => {
    const writeCandy = vi.fn();
    schedulePersist("box", () => {
      throw new Error("blocked storage");
    });
    schedulePersist("candy", writeCandy);

    expect(() => flushPersist()).not.toThrow();
    expect(writeCandy).toHaveBeenCalledOnce();
  });

  it("flushes only the requested key and leaves the rest scheduled", () => {
    const writes: string[] = [];
    schedulePersist("box", () => writes.push("box"));
    schedulePersist("candy", () => writes.push("candy"));

    flushPersist("box");
    expect(writes).toEqual(["box"]);

    vi.advanceTimersByTime(200);
    expect(writes).toEqual(["box", "candy"]);
  });

  it("flushes on pagehide and hidden visibility, then removes handlers", () => {
    const windowTarget = new EventTarget();
    const documentTarget = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
    documentTarget.visibilityState = "visible";
    vi.stubGlobal("window", windowTarget);
    vi.stubGlobal("document", documentTarget);
    const writes: string[] = [];
    const cleanup = installPersistFlushHandlers();
    expect(installPersistFlushHandlers()).toBe(cleanup);

    schedulePersist("box", () => writes.push("pagehide"));
    windowTarget.dispatchEvent(new Event("pagehide"));
    schedulePersist("candy", () => writes.push("visible"));
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));

    expect(writes).toEqual(["pagehide", "visible"]);
    cleanup();
    cleanup();
    schedulePersist("box", () => writes.push("after-cleanup"));
    windowTarget.dispatchEvent(new Event("pagehide"));
    expect(writes).toEqual(["pagehide", "visible"]);
  });
});
