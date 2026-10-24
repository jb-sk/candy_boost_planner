import { onBeforeUnmount, onMounted } from "vue";

export type HistoryDirection = "undo" | "redo";

function isApplePlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

/** ボタンの説明に添えるショートカット。Mac は ⌘Z / ⇧⌘Z、それ以外は Ctrl+Z / Ctrl+Y */
export function historyShortcutLabel(direction: HistoryDirection): string {
  if (isApplePlatform()) return direction === "undo" ? "⌘Z" : "⇧⌘Z";
  return direction === "undo" ? "Ctrl+Z" : "Ctrl+Y";
}

/** 文字の取り消しをブラウザに任せる入力欄の type。チェックボックスなどは文字を持たないので含めない */
const TEXT_INPUT_TYPES = new Set(["", "text", "search", "number", "tel", "url", "email", "password"]);

/** 要素の種類はタグ名で見る（instanceof だと DOM の無い単体テストで判定できない） */
function isTextEditable(target: EventTarget | null): boolean {
  const element = target as Partial<HTMLInputElement> | null;
  if (!element) return false;
  if (element.isContentEditable === true || element.tagName === "TEXTAREA") return true;
  return element.tagName === "INPUT" && TEXT_INPUT_TYPES.has(element.type ?? "");
}

/**
 * キー操作が元に戻す・やり直すなら、その向きを返す。
 * Ctrl（Mac は ⌘）+Z で元に戻す、Shift を足すか Ctrl+Y でやり直す。
 * 入力欄の中では、ブラウザ本来の文字の取り消しを優先して null を返す。
 */
export function historyShortcutDirection(event: KeyboardEvent): HistoryDirection | null {
  if (event.defaultPrevented || event.isComposing || event.altKey) return null;
  if (!(event.ctrlKey || event.metaKey)) return null;
  if (isTextEditable(event.target)) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  // ⌘Y は Safari の履歴なので、Ctrl+Y だけをやり直すにする
  if (key === "y" && event.ctrlKey && !event.metaKey && !event.shiftKey) return "redo";
  return null;
}

/**
 * 画面全体で元に戻す・やり直すのショートカットを受ける。
 * `isBlocked` が true の間（モーダル表示中など、背面の画面が見えていないとき）は何もしない。
 */
export function useHistoryShortcuts(options: {
  isBlocked: () => boolean;
  step: (direction: HistoryDirection) => void;
}) {
  function onKeydown(event: KeyboardEvent) {
    const direction = historyShortcutDirection(event);
    if (direction === null || options.isBlocked()) return;
    event.preventDefault();
    options.step(direction);
  }

  onMounted(() => window.addEventListener("keydown", onKeydown));
  onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
}
