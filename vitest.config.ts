import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // テスト環境
    environment: 'node',

    // テストファイルのパターン
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],

    // グローバルなテスト関数を使用可能に
    globals: true,

    // タイムアウト（ミリ秒）
    testTimeout: 10000,

    // レポーター設定
    // - 'dot': コンソールには最小限（・で進捗表示）
    // - 'json': 詳細はファイルに出力
    reporters: ['dot', 'json'],

    // JSON結果をファイルに出力
    outputFile: {
      json: './test-results.json',
    },
  },
});
