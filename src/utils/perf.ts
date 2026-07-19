const PERF_QUERY_KEY = 'perf';

function isUrlPerfEnabled(): boolean {
  if (typeof location === 'undefined') return false;
  try {
    return new URLSearchParams(location.search).get(PERF_QUERY_KEY) === '1';
  } catch {
    return false;
  }
}

let perfEnabled = import.meta.env.VITE_PERF === '1' || isUrlPerfEnabled();

export function isPerfEnabled(): boolean {
  return perfEnabled;
}

/** Workerへページ側のruntime設定を引き渡す場合にも使用する。 */
export function setPerfEnabled(enabled: boolean): void {
  perfEnabled = enabled;
}

const PERF_PREFIX = '[perf]';

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function perfMark(name: string): void {
  if (!isPerfEnabled() || typeof performance === 'undefined' || typeof performance.mark !== 'function') return;
  performance.mark(name);
}

export function perfMeasure(name: string, start: string, end?: string): void {
  if (!isPerfEnabled() || typeof performance === 'undefined' || typeof performance.measure !== 'function') return;
  try {
    if (end) performance.measure(name, start, end);
    else performance.measure(name, start);
  } catch {
    // Invalid or missing marks should not affect app behavior.
  }
}

export function perfSpan<T>(name: string, fn: () => T): T {
  if (!isPerfEnabled()) return fn();
  const start = now();
  try {
    return fn();
  } finally {
    const duration = now() - start;
    console.info(`${PERF_PREFIX} ${name}`, { durationMs: Math.round(duration * 100) / 100 });
  }
}

export function perfInfo(name: string, detail: Record<string, unknown>): void {
  if (!isPerfEnabled()) return;
  console.info(`${PERF_PREFIX} ${name}`, detail);
}
