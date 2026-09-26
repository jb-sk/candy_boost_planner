/**
 * スクロールさせずにフォーカスを入れる。
 *
 * `focus({ preventScroll: true })` は iOS 15・Chrome 64 から。古い iOS は指定を無視して、フォーカスした欄が
 * 見えるようページや入れ子のスクロール領域を動かす。効かない端末では、フォーカスの前の位置へ戻す。
 * iOS はフォーカスの後の描画でもう一度動かすことがあるので、次の描画の前にも戻す。
 */

/**
 * preventScroll を読みに来るかで対応を確かめる（対応しない端末は指定を読まない）。
 * 読み込み時に1回だけ確かめる（欄を押したときの focus の呼び出しに混ぜない）。
 */
function detectPreventScroll(): boolean {
  let supported = false;
  try {
    document.createElement("div").focus({
      get preventScroll() {
        supported = true;
        return true;
      },
    });
  } catch {
    // 引数を受け付けない端末は非対応のまま。
  }
  return supported;
}

const preventScrollSupported = typeof document !== "undefined" && detectPreventScroll();

type ScrollPosition = { element: Element | null; left: number; top: number };

/** ページと、欄を囲むスクロール領域の位置。 */
function captureScrollPositions(element: Element): ScrollPosition[] {
  const positions: ScrollPosition[] = [{ element: null, left: window.pageXOffset, top: window.pageYOffset }];
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const scrollable = parent.scrollHeight > parent.clientHeight || parent.scrollWidth > parent.clientWidth;
    if (parent.scrollTop !== 0 || parent.scrollLeft !== 0 || scrollable) {
      positions.push({ element: parent, left: parent.scrollLeft, top: parent.scrollTop });
    }
  }
  return positions;
}

function restoreScrollPositions(positions: readonly ScrollPosition[]): void {
  for (const position of positions) {
    if (!position.element) {
      if (window.pageXOffset !== position.left || window.pageYOffset !== position.top) window.scrollTo(position.left, position.top);
      continue;
    }
    if (position.element.scrollTop !== position.top) position.element.scrollTop = position.top;
    if (position.element.scrollLeft !== position.left) position.element.scrollLeft = position.left;
  }
}

export function focusWithoutScroll(element: HTMLElement): void {
  if (preventScrollSupported) {
    element.focus({ preventScroll: true });
    return;
  }
  const positions = captureScrollPositions(element);
  element.focus();
  restoreScrollPositions(positions);
  requestAnimationFrame(() => restoreScrollPositions(positions));
}
