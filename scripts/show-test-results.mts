/**
 * テスト結果を整形して表示するスクリプト
 *
 * 使用方法:
 *   npx vitest run
 *   npx tsx scripts/show-test-results.mts
 */

import { readFileSync, existsSync } from 'fs';

type AssertionResult = {
  status: string;
  title: string;
  failureMessages: string[];
};

type TestResults = {
  numPassedTests: number;
  numFailedTests: number;
  numTotalTests: number;
  testResults: Array<{
    name: string;
    assertionResults: AssertionResult[];
  }>;
};

const resultsPath = './test-results.json';

if (!existsSync(resultsPath)) {
  console.log('❌ test-results.json が見つかりません。');
  console.log('   まず npx vitest run を実行してください。');
  process.exit(1);
}

const data = JSON.parse(readFileSync(resultsPath, 'utf-8')) as TestResults;

console.log('');
console.log('━'.repeat(60));
console.log('テスト結果サマリー');
console.log('━'.repeat(60));
console.log(`  ✅ パス: ${data.numPassedTests}`);
console.log(`  ❌ 失敗: ${data.numFailedTests}`);
console.log(`  📊 合計: ${data.numTotalTests}`);
console.log('━'.repeat(60));

if (data.numFailedTests > 0) {
  console.log('\n失敗したテスト:\n');

  for (const suite of data.testResults) {
    const failed = suite.assertionResults.filter(result => result.status === 'failed');
    if (failed.length === 0) continue;

    // ファイル名を短くする
    const fileName = suite.name.split('/').slice(-2).join('/');
    console.log(`📁 ${fileName}`);

    for (const test of failed) {
      console.log(`   ❌ ${test.title}`);
      // エラーメッセージの最初の行だけ表示
      const msg = test.failureMessages[0]?.split('\n')[0] ?? '';
      console.log(`      ${msg.slice(0, 80)}`);
    }
    console.log('');
  }
}

console.log('詳細は test-results.json を view_file で確認してください。');
