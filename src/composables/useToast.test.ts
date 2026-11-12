import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showToast, useToast } from "./useToast";

describe("useToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // 残った通知を全部消してからテストを抜ける（モジュール単位の状態なので持ち越す）
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("連続表示は積み上がり、古いものから順に消える", () => {
    const { toasts } = useToast();

    showToast("first", { durationMs: 100 });
    vi.advanceTimersByTime(50);
    showToast("second", { durationMs: 100 });

    // 新しいものほど後ろ（画面では下）
    expect(toasts.value.map((toast) => toast.message)).toEqual(["first", "second"]);

    // 古い方だけが先に消える。後勝ちで上書きされない
    vi.advanceTimersByTime(50);
    expect(toasts.value.map((toast) => toast.message)).toEqual(["second"]);

    vi.advanceTimersByTime(50);
    expect(toasts.value).toEqual([]);
  });

  it("何件見せるかはここで決めない（上限で古い通知を捨てない）", () => {
    const { toasts } = useToast();

    for (const n of [1, 2, 3, 4]) showToast(`toast-${n}`, { durationMs: 1_000 });

    // ここで捨てると、捨てた通知が退場フェードで4件目として見えてしまう。
    // 表示件数は AppToast.css が絞る
    expect(toasts.value.map((toast) => toast.message))
      .toEqual(["toast-1", "toast-2", "toast-3", "toast-4"]);

    vi.advanceTimersByTime(1_000);
    expect(toasts.value).toEqual([]);
  });

  it("testId は指定した通知にだけ付く", () => {
    const { toasts } = useToast();

    showToast("plain", { durationMs: 100 });
    showToast("saved", { durationMs: 100, testId: "export-toast" });

    expect(toasts.value.map((toast) => toast.testId)).toEqual([undefined, "export-toast"]);
  });

  it("dismissOnPress は、出した後に画面のどこかを押すとすぐ消える（出したきっかけの押下では消えない）", () => {
    const listeners = new Map<string, Set<EventListener>>();
    const fakeDocument = {
      addEventListener: (type: string, fn: EventListener) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: EventListener) => listeners.get(type)?.delete(fn),
    };
    vi.stubGlobal("document", fakeDocument);
    try {
      const { toasts } = useToast();
      showToast("reason", { durationMs: 6000, dismissOnPress: true, wrap: true });
      expect(toasts.value.map((toast) => [toast.message, toast.wrap])).toEqual([["reason", true]]);
      // まだ受けていない（次の押下から）
      expect(listeners.get("mousedown")?.size ?? 0).toBe(0);
      vi.advanceTimersByTime(0);
      expect(listeners.get("mousedown")?.size).toBe(1);
      listeners.get("mousedown")!.forEach((fn) => fn(new Event("mousedown")));
      expect(toasts.value).toEqual([]);
      // 消したら受けるのもやめる
      expect(listeners.get("mousedown")?.size).toBe(0);
      expect(listeners.get("touchstart")?.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
