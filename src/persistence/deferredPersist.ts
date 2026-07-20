import { perfInfo } from "../utils/perf";

export type PersistKey = "box" | "calcSlots" | "candy";

type PersistJob = {
  run: () => void;
  scheduledAt: number;
};

type ScheduledHandle =
  | { kind: "idle"; id: number }
  | { kind: "timeout"; id: ReturnType<typeof setTimeout> };

const IDLE_TIMEOUT_MS = 500;
const FALLBACK_DELAY_MS = 200;
const pending = new Map<PersistKey, PersistJob>();
let scheduledHandle: ScheduledHandle | null = null;
let activeHandlerCleanup: (() => void) | null = null;
let deferralCount = 0;

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function cancelScheduledRun(): void {
  const handle = scheduledHandle;
  scheduledHandle = null;
  if (!handle) return;
  if (handle.kind === "idle" && typeof globalThis.cancelIdleCallback === "function") {
    globalThis.cancelIdleCallback(handle.id);
    return;
  }
  if (handle.kind === "timeout") clearTimeout(handle.id);
}

function runJob(key: PersistKey, job: PersistJob): void {
  perfInfo("persist.queue", {
    key,
    waitedMs: Math.round((now() - job.scheduledAt) * 100) / 100,
  });
  try {
    job.run();
  } catch {
    // One failed storage key must not prevent the remaining keys from flushing.
  }
}

function runPendingOnce(): void {
  scheduledHandle = null;
  if (deferralCount > 0) return;
  const jobs = [...pending.entries()];
  pending.clear();
  for (const [key, job] of jobs) runJob(key, job);
  if (pending.size > 0) ensureScheduledRun();
}

function ensureScheduledRun(): void {
  if (scheduledHandle || pending.size === 0 || deferralCount > 0) return;
  if (
    typeof globalThis.requestIdleCallback === "function"
    && typeof globalThis.cancelIdleCallback === "function"
  ) {
    const id = globalThis.requestIdleCallback(runPendingOnce, { timeout: IDLE_TIMEOUT_MS });
    scheduledHandle = { kind: "idle", id };
    return;
  }
  const id = setTimeout(runPendingOnce, FALLBACK_DELAY_MS);
  scheduledHandle = { kind: "timeout", id };
}

export function schedulePersist(key: PersistKey, persistLatest: () => void): void {
  pending.set(key, { run: persistLatest, scheduledAt: now() });
  ensureScheduledRun();
}

/**
 * Defers ordinary idle persistence while CPU-critical background work is active.
 * Explicit flushes (pagehide / hidden included) remain synchronous and bypass this gate.
 */
export function deferPersistUntilReleased(): () => void {
  deferralCount++;
  cancelScheduledRun();
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    deferralCount = Math.max(0, deferralCount - 1);
    if (deferralCount === 0) ensureScheduledRun();
  };
}

export function flushPersist(key?: PersistKey): void {
  if (key) {
    while (pending.has(key)) {
      const job = pending.get(key);
      pending.delete(key);
      if (job) runJob(key, job);
    }
    if (pending.size === 0) cancelScheduledRun();
    else ensureScheduledRun();
    return;
  }

  cancelScheduledRun();
  while (pending.size > 0) {
    const jobs = [...pending.entries()];
    pending.clear();
    for (const [jobKey, job] of jobs) runJob(jobKey, job);
  }
  cancelScheduledRun();
}

export function cancelPersist(key?: PersistKey): void {
  if (key) pending.delete(key);
  else pending.clear();
  if (pending.size === 0) cancelScheduledRun();
}

export function installPersistFlushHandlers(): () => void {
  if (activeHandlerCleanup) return activeHandlerCleanup;

  const onPageHide = () => flushPersist();
  const onVisibilityChange = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") flushPersist();
  };

  if (typeof window !== "undefined") window.addEventListener("pagehide", onPageHide);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibilityChange);

  let installed = true;
  const cleanup = () => {
    if (!installed) return;
    installed = false;
    if (typeof window !== "undefined") window.removeEventListener("pagehide", onPageHide);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibilityChange);
    if (activeHandlerCleanup === cleanup) activeHandlerCleanup = null;
  };
  activeHandlerCleanup = cleanup;
  return cleanup;
}
