/**
 * 実時間ベースの性能アサーション用の予算。
 *
 * CI（GitHub Actions）は他ジョブとCPUを共有するため、同じコードでも実測が数倍ぶれる。
 * 実際に `feasibilityMs` が 1,022ms となり 1,000ms の閾値をわずか 2.26% 超えて落ちた事例がある
 * （再実行では通った）。アルゴリズムの退行ではなく環境ノイズなので、CI では倍率を掛ける。
 *
 * 実時間アサーションは環境ノイズを受けるため、`PERF_WALL_CLOCK=1` の明示時だけ有効にする。
 * 既定の性能退行ゲートには `transitions` / `globalKeyCount` / `rowOptionCounts` /
 * `typeBlockFrontierCounts` のような決定的な指標を使う（環境に左右されない）。
 * この関数は opt-in 実行時のローカル・CI 間の予算差だけを扱う。
 */
import { isCI } from '../../helpers/isCI';

const PERF_SCALE = isCI() ? 4 : 1;

/** 実時間の上限（ms）。CI では自動的に緩める。 */
export function perfBudgetMs(localLimitMs: number): number {
  return localLimitMs * PERF_SCALE;
}
