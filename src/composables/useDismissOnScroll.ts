import { onUnmounted, watch } from "vue";
import { suppressNextClick } from "../utils/suppressNextClick";

/**
 * スクロールしようとしたら浮き要素を閉じる（テンキーと同じく、スクロールで消える）。
 * 計算機・設定・ボックスのヒントと、性格補正のドロップダウン（NatureSelect.vue）で共用する。
 *
 * scroll イベントは待たない。指が動いてからブラウザがスクロールを始めて通知するまで間があり
 * （iOS は通知もまばら）、触れた瞬間に閉じるテンキーより目に見えて遅い。
 * 指が DRAG_THRESHOLD_PX 動いた時点、ホイールなら回した時点で閉じる。
 * scroll を見ないので、サマリーの高さ補正などアプリ側のスクロールでは閉じない。
 *
 * 触れた瞬間（touchstart）には閉じない。計算機では受け口が先に消えると、そのタップが下のボタンに届く
 * （設定は受け口を置かず、外側に触れた瞬間に閉じる。SettingsOverlay.vue の onPressWhileHintOpen）。
 * 指で閉じたときも、わずかな移動ならブラウザがタップとみなして click を出すことがあるので、
 * 直後の click を1回だけ捨てる（suppressNextClick）。
 *
 * スライダー（input[type="range"]）の上で始まった指の動きは見ない。つまみを動かしてもページはスクロールせず、
 * 閉じると浮き要素の中のスライダー（計算機のヒント内のレベルピッカーなど）を動かせなくなる。
 *
 * 浮き要素の中で始まった動きを見ないようにもできる（`isInside`）。中に縦スクロールする一覧がある浮き要素
 * （睡眠目標のドロップダウン）で、一覧の中のスクロールが閉じる合図になってしまうのを防ぐ。
 * 外側でのスクロール操作では、これまでどおり閉じる。
 *
 * @param isOpen 開いているか（開いている間だけ監視する）
 * @param close 閉じる
 * @param isInside 触れた・ホイールを回した位置が浮き要素の中なら true を返す。省略時はどこでも閉じる合図にする
 */
export function useDismissOnScroll(
  isOpen: () => boolean,
  close: () => void,
  isInside: (target: EventTarget | null) => boolean = () => false,
): void {
  const DRAG_THRESHOLD_PX = 10;
  let touchStartPoint: { x: number; y: number } | null = null;

  function onTouchStart(ev: TouchEvent): void {
    const touch = ev.touches[0];
    const onSlider = ev.target instanceof Element && ev.target.closest('input[type="range"]') !== null;
    touchStartPoint = touch && !onSlider && !isInside(ev.target) ? { x: touch.clientX, y: touch.clientY } : null;
  }

  function onTouchMove(ev: TouchEvent): void {
    const touch = ev.touches[0];
    if (!touch || !touchStartPoint) return;
    const moved = Math.hypot(touch.clientX - touchStartPoint.x, touch.clientY - touchStartPoint.y);
    if (moved < DRAG_THRESHOLD_PX) return;
    touchStartPoint = null;
    suppressNextClick();
    close();
  }

  function onWheel(ev: WheelEvent): void {
    if (isInside(ev.target)) return;
    close();
  }

  function listen(open: boolean): void {
    if (open) {
      window.addEventListener("touchstart", onTouchStart, { passive: true });
      window.addEventListener("touchmove", onTouchMove, { passive: true });
      window.addEventListener("wheel", onWheel, { passive: true });
    } else {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("wheel", onWheel);
      touchStartPoint = null;
    }
  }

  watch(isOpen, listen);
  onUnmounted(() => listen(false));
}
