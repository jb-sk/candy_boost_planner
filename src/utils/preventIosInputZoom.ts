/**
 * iOS の Safari が、文字の大きさ 16px 未満の入力欄・選択欄（テーマ・スロットタブの select など）に
 * フォーカスしたとき画面を拡大するのを止める。
 *
 * viewport に maximum-scale=1 を足す。iOS 10 以降の Safari はこの指定があっても指での拡大（ピンチ）は止めず、
 * フォーカス時の自動拡大だけが止まる。Android の Chrome ではピンチまで止めてしまうので iOS に限る。
 * iPadOS 13 以降は Mac と同じ UA を名乗るので、タッチ点の数で見分ける。
 */
export function preventIosInputZoom(): void {
  if (typeof navigator === "undefined" || typeof document === "undefined") return;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIos) return;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta || /maximum-scale/.test(meta.content)) return;
  meta.content = `${meta.content}, maximum-scale=1`;
}
