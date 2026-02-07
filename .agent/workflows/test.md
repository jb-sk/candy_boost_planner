---
description: テストの実行と結果確認
---

## テスト実行手順

// turbo
1. テストを実行する
```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; npx vitest run
```

2. 結果ファイルを確認する（view_file ツールで読み取る）
```
d:\Dev\Projects\candy_boost_planner\test-results.json
```

3. 確認ポイント
   - `numPassedTests`: パスしたテスト数
   - `numFailedTests`: 失敗したテスト数
   - `testResults[].assertionResults` で失敗詳細を確認

**注意:** PowerShell のコンソール出力は信頼しないこと（途切れ・重なりが発生するため）
