/**
 * 計算機のサマリーは、内容に応じた自然な高さのまま計算結果で変わる（固定高や空行の予約はしない）。
 * 結果が届いたときは、下の領域・計算行・サマリー項目を旧位置から transform で動かし（FLIP）、
 * 瞬間移動（レイアウトシフト）として見せない。
 *
 * - 動かすのは計算結果が届いたときだけ。結果はデバウンスや Worker を経て、操作とは別のタイミングで届く。
 *   行を全部消して結果が無くなるときだけは操作の中で同期的に変わるので、操作の対象を動かさないよう動かさない
 *   （入力直後の変化は CLS にも数えられない）。指で押している最中・スクロール中も動かさない。
 * - 拡縮は文字が伸び縮みして見えるので使わず、位置だけを戻す。
 * - サマリー項目は同じ行の中では横に滑らせ、別の行へ移る項目は他の項目を斜めに横切らないよう、
 *   移動の前半を透明にして着地点の近くで現れるようにする。
 * - サマリーが上に貼り付いているときは、ページのスクロールで高さの変化を打ち消し、中身を動かさない。
 *   ただし計算機の横にボックスが並ぶ PC 2列では、ボックスまで動くのでスクロールさせない。
 * - 動いている途中に次の結果が来ても、見えている位置と透明度から次の移動を始める。
 */
import { nextTick, onUnmounted, watch, type Ref, type WatchSource } from "vue";
import { flushFlexGapPolyfill } from "../utils/flexGapPolyfill";

/** 減速カーブで動かし、着地の直前に勢いが残らないようにする。 */
const FLIP_MS = 200;
const FLIP_EASING = "cubic-bezier(0.2, 0, 0, 1)";
/** 透明から現れる項目を見せ始める時刻。この時点で移動はおおむね終わっている。 */
const FADE_DELAY_MS = 90;
const FADE_MS = 120;
/** スクロール直後の更新は動かさず、スクロールでの補正もしない（指の慣性スクロールと競合する）。 */
const SCROLL_SETTLE_MS = 180;

const ROW_SELECTOR = '[data-testid="calc-row"]';
const RESULT_SELECTOR = '[data-testid="resultRowReachable"]';
/** Teleport されたポップオーバーは transform に追従しないので、開いている間は動かさない。 */
const POPOVER_SELECTOR = '.levelPick__popover, .numKeypad, [data-testid="calc-hint-popover"], [data-testid="sleep-hint-popover"]';

type Snapshot = {
  followingTop: number;
  rows: Map<HTMLElement, DOMRect>;
  results: Map<HTMLElement, DOMRect>;
  summaryTop: number;
  /** 見た目の矩形。移動はここから始める。 */
  items: Map<HTMLElement, DOMRect>;
  /** FLIP の transform を除いた top。どの行にあるかの判定に使う。 */
  itemLineTops: Map<HTMLElement, number>;
  /** フェードの途中だった項目の透明度。 */
  opacities: Map<HTMLElement, number>;
};

function measureRects(elements: Iterable<Element>): Map<HTMLElement, DOMRect> {
  const rects = new Map<HTMLElement, DOMRect>();
  for (const element of Array.from(elements)) {
    if (element instanceof HTMLElement) rects.set(element, element.getBoundingClientRect());
  }
  return rects;
}

/** translate だけを当てるので、computed の行列から縦の移動量を取り出す。 */
function translateYOf(element: HTMLElement): number {
  const match = /^matrix\(([^)]+)\)$/.exec(getComputedStyle(element).transform);
  return match ? Number.parseFloat(match[1].split(",")[5] ?? "0") || 0 : 0;
}

/** パネルの横に別のパネルが並んでいるか（PC 2列）。 */
function hasSideBySidePanel(panel: HTMLElement): boolean {
  const rect = panel.getBoundingClientRect();
  return Array.from(panel.parentElement?.children ?? []).some((sibling) => {
    if (sibling === panel) return false;
    const siblingRect = sibling.getBoundingClientRect();
    return siblingRect.height > 0 && siblingRect.top < rect.bottom && siblingRect.bottom > rect.top;
  });
}

export function useSummaryFlip(options: {
  /** サマリーより下の領域。パネルの最後の子であること（margin-bottom でパネルの下端も一緒に動かす）。 */
  following: Ref<HTMLElement | null>;
  summaryBody: Ref<HTMLElement | null>;
  /** 計算結果。これが届くたびに FLIP する（無くなったときは動かさない）。 */
  result: WatchSource<unknown>;
}): void {
  const { following, summaryBody } = options;
  /** inline style を書いた要素と、フェードする要素（値: 移動の前半を待ってから現れるか）。 */
  const animated = new Set<HTMLElement>();
  const fading = new Map<HTMLElement, boolean>();
  let marginElement: HTMLElement | null = null;
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  /** DOM 更新前に測り、まだ FLIP に使われていないもの。 */
  let pending: Snapshot | null = null;

  let pointerPressed = false;
  let lastScrollAt = Number.NEGATIVE_INFINITY;

  function clear(): void {
    cancelAnimationFrame(frame);
    if (timer) clearTimeout(timer);
    frame = 0;
    timer = null;
    // inline の transition を外すだけでは、実行中のトランジションが直後の測定に残る（Chrome）。
    // transition: none でスタイルを一度確定させ、途中の値を確実に打ち切ってから外す。
    for (const element of animated) {
      element.style.transition = "none";
      element.style.transform = "";
      element.style.opacity = "";
    }
    if (marginElement) marginElement.style.marginBottom = "";
    for (const element of animated) void getComputedStyle(element).transform;
    for (const element of animated) element.style.transition = "";
    animated.clear();
    fading.clear();
    marginElement = null;
  }

  /** 更新前の見た目を測る。前回の FLIP の途中なら、スタイルを外さずに測ることで見えている位置から続けられる。 */
  function measure(followingElement: HTMLElement): Snapshot {
    const body = summaryBody.value;
    const items = body ? measureRects(body.children) : new Map<HTMLElement, DOMRect>();
    const itemLineTops = new Map<HTMLElement, number>();
    for (const [item, rect] of items) itemLineTops.set(item, rect.top - (animated.has(item) ? translateYOf(item) : 0));
    const opacities = new Map<HTMLElement, number>();
    for (const item of fading.keys()) opacities.set(item, Number.parseFloat(getComputedStyle(item).opacity));
    return {
      followingTop: followingElement.getBoundingClientRect().top,
      rows: measureRects(followingElement.querySelectorAll(ROW_SELECTOR)),
      results: measureRects(followingElement.querySelectorAll(RESULT_SELECTOR)),
      summaryTop: body?.getBoundingClientRect().top ?? 0,
      items,
      itemLineTops,
      opacities,
    };
  }

  function move(element: HTMLElement, x: number, y: number): void {
    if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) return;
    element.style.transition = "none";
    element.style.transform = `translate(${x}px, ${y}px)`;
    animated.add(element);
  }

  function fadeIn(element: HTMLElement, fromOpacity: number): void {
    element.style.transition = "none";
    element.style.opacity = String(fromOpacity);
    animated.add(element);
    // 透明から現れるものは他の項目が退くのを待つ。現れかけていたものはそのまま続ける。
    fading.set(element, fromOpacity === 0);
  }

  watch(options.result, async (result) => {
    const followingElement = following.value;
    if (!followingElement || followingElement.getClientRects().length === 0) return;
    const current = ++generation;
    // 同じ描画の前に更新が重なったときは、最初に測った位置（画面に出ている位置）を使い続ける。
    const before = pending ?? measure(followingElement);
    pending = before;
    await nextTick();
    if (current !== generation) return;
    pending = null;
    clear();
    // 古い端末の gap の補正は次の描画で margin を付け直す。付け直す前の位置を測らないよう先に済ませる。
    flushFlexGapPolyfill();

    const target = following.value;
    if (!target || target.getClientRects().length === 0) return;
    if (document.querySelector(POPOVER_SELECTOR)) return;
    if (result == null || pointerPressed || performance.now() - lastScrollAt < SCROLL_SETTLE_MS) return;

    const sticky = summaryBody.value?.closest<HTMLElement>(".calcSticky");
    const panel = target.closest<HTMLElement>(".panel");
    const delta = target.getBoundingClientRect().top - before.followingTop;
    const isStuck = !!sticky && window.scrollY > 0
      && Math.abs(sticky.getBoundingClientRect().top - (Number.parseFloat(getComputedStyle(sticky).top) || 0)) < 1.5;
    if (isStuck && Math.abs(delta) >= 0.5 && !(panel && hasSideBySidePanel(panel))) window.scrollBy(0, delta);

    // 逆変換を1つ当てると子孫の矩形もずれる。移動後の矩形は、何も当てないうちにすべて測っておく。
    const followingY = before.followingTop - target.getBoundingClientRect().top;
    const rowsAfter = measureRects(target.querySelectorAll(ROW_SELECTOR));
    const resultsAfter = measureRects(target.querySelectorAll(RESULT_SELECTOR));
    const body = summaryBody.value;
    const summaryTop = body?.getBoundingClientRect().top ?? 0;
    const itemsAfter = body ? measureRects(body.children) : new Map<HTMLElement, DOMRect>();

    move(target, 0, followingY);
    if (animated.has(target)) {
      // パネルの下端も同じだけ旧位置に残し、中身と一緒に動かす。下端だけ先に動くと、
      // 一番下の「ポケモンを追加」の下の余白が伸び縮みして見える。
      const baseMarginBottom = Number.parseFloat(getComputedStyle(target).marginBottom) || 0;
      target.style.marginBottom = `${baseMarginBottom + followingY}px`;
      marginElement = target;
    }
    const rowOffsets = new Map<HTMLElement, { x: number; y: number }>();
    for (const [row, after] of rowsAfter) {
      const rowBefore = before.rows.get(row);
      if (!rowBefore) continue;
      const offset = { x: rowBefore.left - after.left, y: rowBefore.top - after.top - followingY };
      rowOffsets.set(row, offset);
      move(row, offset.x, offset.y);
    }
    for (const [result, after] of resultsAfter) {
      const resultBefore = before.results.get(result);
      if (!resultBefore) continue;
      const row = result.closest<HTMLElement>(ROW_SELECTOR);
      const rowOffset = (row && rowOffsets.get(row)) || { x: 0, y: 0 };
      move(result, resultBefore.left - after.left - rowOffset.x, resultBefore.top - after.top - followingY - rowOffset.y);
    }
    // サマリー項目は v-if で増減するので、順番ではなく要素そのもので前後を対応させる。
    for (const [item, after] of itemsAfter) {
      const itemBefore = before.items.get(item);
      if (itemBefore) move(item, itemBefore.left - after.left, itemBefore.top - after.top);
      const lineTop = before.itemLineTops.get(item);
      const lineChanged = lineTop === undefined || Math.abs((lineTop - before.summaryTop) - (after.top - summaryTop)) >= 1;
      const fromOpacity = lineChanged ? 0 : before.opacities.get(item);
      if (fromOpacity !== undefined && fromOpacity < 1) fadeIn(item, fromOpacity);
    }
    if (animated.size === 0) return;

    // 強制レイアウトで逆変換を確定してから、次の描画で最終位置へ動かす。
    void target.offsetHeight;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const moveMs = reduceMotion ? 1 : FLIP_MS;
    frame = requestAnimationFrame(() => {
      frame = 0;
      for (const element of animated) {
        const delayed = fading.get(element);
        const transitions = [`transform ${moveMs}ms ${FLIP_EASING}`];
        if (element === marginElement) transitions.push(`margin-bottom ${moveMs}ms ${FLIP_EASING}`);
        if (delayed !== undefined) {
          transitions.push(reduceMotion ? "opacity 1ms linear" : `opacity ${FADE_MS}ms ease-out ${delayed ? FADE_DELAY_MS : 0}ms`);
        }
        element.style.transition = transitions.join(", ");
        element.style.transform = "none";
        if (element === marginElement) element.style.marginBottom = "";
        if (delayed !== undefined) element.style.opacity = "1";
      }
      timer = setTimeout(() => {
        timer = null;
        if (current === generation) clear();
      }, reduceMotion ? 50 : Math.max(FLIP_MS, FADE_DELAY_MS + FADE_MS) + 40);
    });
  }, { flush: "pre" });

  // stopPropagation する処理もあるので capture で受ける。
  const onPress = (): void => {
    pointerPressed = true;
  };
  const onRelease = (): void => {
    pointerPressed = false;
  };
  const onScroll = (): void => {
    lastScrollAt = performance.now();
  };
  const listeners: Array<[string, () => void]> = [
    ["pointerdown", onPress], ["mousedown", onPress], ["touchstart", onPress],
    ["pointerup", onRelease], ["pointercancel", onRelease], ["mouseup", onRelease], ["touchend", onRelease], ["touchcancel", onRelease],
    ["wheel", onScroll], ["scroll", onScroll], ["touchmove", onScroll],
  ];
  const listenerOptions = { capture: true, passive: true };
  if (typeof window !== "undefined") {
    for (const [type, listener] of listeners) window.addEventListener(type, listener, listenerOptions);
  }
  onUnmounted(() => {
    clear();
    if (typeof window === "undefined") return;
    for (const [type, listener] of listeners) window.removeEventListener(type, listener, listenerOptions);
  });
}
