/**
 * 実時間ベースの性能アサーションを明示的に有効化する。
 *
 * `process.env` の値は文字列なので、`0` や `false` を truthy として扱わない。
 * 実行条件の判定をテストごとに書き散らさないため、この関数だけが環境変数を読む。
 */
export function isPerfWallClockEnabled(): boolean {
  return (process.env.PERF_WALL_CLOCK ?? '').trim() === '1';
}
