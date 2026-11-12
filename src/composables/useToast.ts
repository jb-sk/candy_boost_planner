import { readonly, ref } from "vue";
import { listenDocumentPress } from "../utils/listenDocumentPress";

export type ToastItem = {
  id: number;
  message: string;
  /** 付けた通知だけが E2E から名指しで取れる（画像保存の完了通知に使う）。 */
  testId?: string;
  /** 長い文を折り返して出す（理由の説明など）。ふつうは1行。 */
  wrap?: boolean;
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

/**
 * 通知を出す。`dismissOnPress` は、画面のどこかを押したらすぐ消す（長めに出す説明を、読んだら閉じられるように）。
 * 出したきっかけの押下では消さないよう、次の押下から受ける。
 */
export function showToast(
  message: string,
  options: { durationMs?: number; testId?: string; dismissOnPress?: boolean; wrap?: boolean } = {},
): void {
  const id = nextToastId++;
  toasts.value = [...toasts.value, { id, message, testId: options.testId, wrap: options.wrap }];
  let onPress: (() => void) | null = null;
  const remove = () => {
    clearTimeout(timer);
    if (onPress !== null) listenDocumentPress(onPress, false);
    onPress = null;
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  };
  const timer = setTimeout(remove, options.durationMs ?? DEFAULT_DURATION_MS);
  if (options.dismissOnPress && typeof document !== "undefined") {
    setTimeout(() => {
      if (!toasts.value.some((toast) => toast.id === id)) return;
      onPress = remove;
      listenDocumentPress(onPress, true);
    }, 0);
  }
}

export function useToast() {
  return {
    toasts: readonly(toasts),
    showToast,
  };
}
