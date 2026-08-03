/**
 * `process.env.CI` の文字列値を CI 実行フラグとして解釈する。
 *
 * 未設定・空文字・`0`・`false` は明示的な無効化として扱う。
 *
 * **なぜ値まで見るのか**: `process.env.CI` は文字列なので、`CI=false` や `CI=0` でも
 * `process.env.CI ? …` は truthy になる。そのまま書くと、CI を明示的に無効化した
 * ローカル環境で次の実害が出る。
 *
 * - `perfBudget.ts`: 性能予算が黙って4倍に緩み、性能退行を取り逃がす
 * - `playwright.config.ts`: 直列実行・retries 2・dev サーバ再利用なしへ勝手に切り替わる
 * - `playwright.perf.config.ts`: ローカル専用ランナーが起動を拒否する
 *
 * **判定はこの1箇所だけに置くこと。** 同じ判定が2箇所に増えた時点で、片方だけ直る
 * 事故が起きる（このリポジトリでは実際に4箇所＋1箇所へ散っていた）。
 */
export function isCI(): boolean {
  const value = (process.env.CI ?? '').trim().toLowerCase();
  return value !== '' && value !== '0' && value !== 'false';
}
