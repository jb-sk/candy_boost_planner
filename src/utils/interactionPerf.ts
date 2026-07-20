import { isPerfEnabled, perfInfo } from "./perf";

function selectorFor(target: EventTarget | null): string {
  if (!(target instanceof Element)) return "(unknown)";
  const tag = target.tagName.toLowerCase();
  const id = target.id ? `#${target.id}` : "";
  const className = [...target.classList].slice(0, 3).map(value => `.${value}`).join("");
  const label = target.getAttribute("aria-label") || target.getAttribute("title") || target.textContent?.trim().slice(0, 40);
  return `${tag}${id}${className}${label ? ` "${label}"` : ""}`;
}

export function installInteractionObserver(): void {
  if (!isPerfEnabled()) return;
  if (typeof PerformanceObserver === "undefined") return;
  if (!PerformanceObserver.supportedEntryTypes?.includes("event")) return;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const eventEntry = entry as PerformanceEventTiming;
        const processing = eventEntry.processingEnd - eventEntry.processingStart;
        const inputDelay = eventEntry.processingStart - eventEntry.startTime;
        const presentation = eventEntry.duration - inputDelay - processing;
        perfInfo("interaction", {
          name: eventEntry.name,
          target: selectorFor(eventEntry.target),
          durationMs: Math.round(eventEntry.duration * 100) / 100,
          inputDelayMs: Math.round(inputDelay * 100) / 100,
          processingMs: Math.round(processing * 100) / 100,
          presentationMs: Math.round(presentation * 100) / 100,
        });
      }
    });
    observer.observe({ type: "event", durationThreshold: 100 } as PerformanceObserverInit & { durationThreshold: number });
  } catch {
    // Safari and older Chromium variants may reject event timing options.
  }
}
