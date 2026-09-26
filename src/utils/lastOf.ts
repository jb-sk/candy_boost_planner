/**
 * 配列の最後の要素。Array.prototype.at（iOS 15.4・Chrome 92 から）は古い端末で使えないので使わない。
 */
export function lastOf<T>(items: readonly T[]): T | undefined {
  return items.length > 0 ? items[items.length - 1] : undefined;
}
