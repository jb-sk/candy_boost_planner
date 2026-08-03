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
});
