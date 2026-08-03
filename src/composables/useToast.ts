import { readonly, ref } from "vue";

export type ToastItem = {
  id: number;
  message: string;
  /** 付けた通知だけが E2E から名指しで取れる（画像保存の完了通知に使う）。 */
  testId?: string;
};

const DEFAULT_DURATION_MS = 2_000;

/**
 * 表示中の通知。**古い順**（新しいものほど後ろ＝画面では下）。
 *
 * 「上書き」ではなく「積み上げ」なので、連続した操作の履歴がそのまま見える。
 * **同時に何件見せるかはここで決めない**（`AppToast.css` が古いものを隠す）。
 * ここで古い順に捨てると、捨てた通知が退場フェードで**上限＋1件目として見えてしまう**。
 */
const toasts = ref<ToastItem[]>([]);
let nextToastId = 0;

export function showToast(
  message: string,
  options: { durationMs?: number; testId?: string } = {},
): void {
  const id = nextToastId++;
  toasts.value = [...toasts.value, { id, message, testId: options.testId }];
  setTimeout(() => {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }, options.durationMs ?? DEFAULT_DURATION_MS);
}

export function useToast() {
  return {
    toasts: readonly(toasts),
    showToast,
  };
}
