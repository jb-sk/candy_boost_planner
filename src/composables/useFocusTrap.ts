import { onBeforeUnmount, onMounted, watch, type Ref } from "vue";
import { focusWithoutScroll } from "../utils/focusWithoutScroll";

/**
 * モーダルの中にフォーカスを閉じ込める。
 *
 * - 開いたとき、器（`tabindex="-1"` を付けた要素）にフォーカスする。入力欄にはフォーカスしない
 *   （スマホでキーボードが出て画面がずれる）。入力欄などへ入れたいモーダルは `initialFocus` で先を渡す。
 * - Tab / Shift+Tab は、中のフォーカスできる要素を端から端へ回す。
 * - `document` の `focusin` で、外へ出たフォーカスを器へ戻す（Tab 以外の経路の備え）。
 * - 閉じたとき、開く前にフォーカスがあった要素へ戻す。その要素が消えていれば何もしない。
 *
 * 背景に `inert` は使わない（Chrome 64・Safari 11.1 では効かない）。
 *
 * body 直下へ Teleport される部品（テンキー・並べ替えの浮かぶ一覧・選択肢の一覧など）は、モーダルより後ろの
 * body 直下に置かれる。そこへ入るフォーカスは外とみなさず、戻さない。背景は #app など、モーダルより前の部分。
 *
 * `rootRef` が要素になったときに始まり、null になる（v-if で消える）か unmount で終わる。
 * 重ねて開いたときは、あとから開いたものだけが働く。
 */
export type FocusTrapOptions = {
  /** 開いたときにフォーカスする要素。null を返すか省略すると器にフォーカスする。 */
  initialFocus?: () => HTMLElement | null | undefined;
};

type Trap = { root: HTMLElement };

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=\"hidden\"])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

/** 開いている順。最後のものだけが働く。 */
const traps: Trap[] = [];

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => el.getClientRects().length > 0);
}

/** body 直下の祖先（body 自身なら null）。 */
function bodyChildOf(node: Node): Node | null {
  let current: Node | null = node;
  while (current && current.parentNode !== document.body) current = current.parentNode;
  return current;
}

/** モーダルより後ろの body 直下に Teleport された部品の中か。 */
function isFloatingAbove(root: HTMLElement, target: Node): boolean {
  const rootTop = bodyChildOf(root);
  const targetTop = bodyChildOf(target);
  if (!rootTop || !targetTop || rootTop === targetTop) return false;
  return (rootTop.compareDocumentPosition(targetTop) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

export function useFocusTrap(rootRef: Ref<HTMLElement | null>, options: FocusTrapOptions = {}): void {
  let trap: Trap | null = null;
  let previouslyFocused: HTMLElement | null = null;

  function isOutside(root: HTMLElement, target: EventTarget | null): boolean {
    if (!(target instanceof Node)) return false;
    return !root.contains(target) && !isFloatingAbove(root, target);
  }

  function onFocusin(e: FocusEvent): void {
    if (!trap || traps[traps.length - 1] !== trap) return;
    if (isOutside(trap.root, e.target)) focusWithoutScroll(trap.root);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== "Tab" || !trap || traps[traps.length - 1] !== trap) return;
    const root = trap.root;
    const active = document.activeElement;
    // Teleport された部品の中の Tab は、その部品に任せる。
    if (active && isFloatingAbove(root, active)) return;
    const items = focusableElements(root);
    if (items.length === 0) {
      e.preventDefault();
      focusWithoutScroll(root);
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey) {
      if (active === first || active === root || !active || !root.contains(active)) {
        e.preventDefault();
        focusWithoutScroll(last);
      }
    } else if (active === last || !active || !root.contains(active)) {
      e.preventDefault();
      focusWithoutScroll(first);
    }
  }

  function activate(root: HTMLElement): void {
    if (trap) return;
    trap = { root };
    traps.push(trap);
    const active = document.activeElement;
    previouslyFocused = active instanceof HTMLElement && active !== document.body ? active : null;
    document.addEventListener("focusin", onFocusin);
    document.addEventListener("keydown", onKeydown);
    focusWithoutScroll(options.initialFocus?.() ?? root);
  }

  function deactivate(): void {
    if (!trap) return;
    const index = traps.indexOf(trap);
    if (index >= 0) traps.splice(index, 1);
    trap = null;
    document.removeEventListener("focusin", onFocusin);
    document.removeEventListener("keydown", onKeydown);
    const target = previouslyFocused;
    previouslyFocused = null;
    if (target && document.contains(target)) focusWithoutScroll(target);
  }

  onMounted(() => {
    if (rootRef.value) activate(rootRef.value);
  });
  watch(rootRef, (el) => {
    if (el) activate(el);
    else deactivate();
  }, { flush: "post" });
  onBeforeUnmount(deactivate);
}
