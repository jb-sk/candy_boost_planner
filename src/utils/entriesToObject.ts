/**
 * [キー, 値] の組からオブジェクトを作る。Object.fromEntries（iOS 12.2・Chrome 73 から）は古い端末で使えないので使わない。
 */
export function entriesToObject<V>(entries: Iterable<readonly [string, V]>): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [key, value] of entries) out[key] = value;
  return out;
}
