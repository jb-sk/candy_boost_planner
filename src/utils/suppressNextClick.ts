/**
 * 指を離したときの click が、閉じた浮き要素（ヒント・テンキー）の後ろのボタンへ届かないようにする。
 *
 * 捨てるのはこの操作から出る click だけ。スクロールになれば click は来ないので、
 * 次の操作の始まり（`releaseOn`）で解除し、次のタップまで捨てない。
 *
 * - touchmove など、その指の touchstart より後で呼ぶときは `touchstart`（既定）
 * - 外側を押したことを touchstart / mousedown で受けて、その中で呼ぶときは、そのイベントの種類を渡す。
 *   dispatch 中に足したリスナは同じイベントでは呼ばれないので、その touchstart / mousedown 自身では解除されない
 *
 * Pointer Events（iOS 13 から）は使わない。古い端末でも効くよう touch / mouse だけで組む。
 */
export function suppressNextClick(releaseOn: "touchstart" | "mousedown" = "touchstart"): void {
  const swallow = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
  };
  const release = () => {
    document.removeEventListener("click", swallow, { capture: true });
    document.removeEventListener(releaseOn, release, { capture: true });
  };
  document.addEventListener("click", swallow, { capture: true, once: true });
  document.addEventListener(releaseOn, release, { capture: true, once: true, passive: true });
}
