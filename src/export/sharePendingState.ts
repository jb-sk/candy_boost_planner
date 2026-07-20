/**
 * 古い iOS で navigator.share の Promise が resolve/reject せず「共有中」のまま
 * 詰まる状態を、保存操作・オーバーレイ再オープンをまたいでページ単位で保持する。
 *
 * この状態が true の間に share を再度呼んでもシートが出ず、iOS が誤って成功/黙殺を
 * 返すため、呼び出し側は share を呼ばず長押し保存へフォールバックする。
 * ページをリロードすると iOS 側の状態ごとリセットされる。
 */
let sharePending = false;

export function setSharePending(value: boolean): void {
  sharePending = value;
}

export function isSharePending(): boolean {
  return sharePending;
}
