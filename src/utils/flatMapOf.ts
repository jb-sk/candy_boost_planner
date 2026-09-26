/**
 * 各要素を配列に写して1段つなげる。Array.prototype.flatMap（iOS 12・Chrome 69 から）は古い端末で使えないので使わない。
 */
export function flatMapOf<T, U>(items: readonly T[], map: (item: T, index: number) => readonly U[]): U[] {
  const out: U[] = [];
  items.forEach((item, index) => {
    for (const value of map(item, index)) out.push(value);
  });
  return out;
}
