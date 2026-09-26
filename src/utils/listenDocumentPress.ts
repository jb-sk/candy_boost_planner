/**
 * 画面のどこかを押したこと（指で触れた・マウスのボタンを押し下げた）を、ほかより先に document で受ける。
 * 外側を押したら閉じる浮き要素（テンキー・設定のヒント・性格補正のドロップダウン）で使う。
 *
 * touchstart（タッチ）と mousedown（マウス）で受ける。Pointer Events（iOS 13 から）は使わない。
 * タッチでは後から互換の mousedown も来るが、そのときはもう閉じているので handler は何もしない前提。
 * touchstart は passive なので、handler でスクロールを止めることはできない。
 *
 * @param handler 付けるときと外すときで同じ関数を渡す
 * @param on true で受け始め、false でやめる
 */
export function listenDocumentPress(handler: (ev: Event) => void, on: boolean): void {
  if (on) {
    document.addEventListener("touchstart", handler, { capture: true, passive: true });
    document.addEventListener("mousedown", handler, true);
  } else {
    document.removeEventListener("touchstart", handler, { capture: true });
    document.removeEventListener("mousedown", handler, true);
  }
}
