# Candy Boost Planner - プロジェクトルール

このファイルはAntigravity（Gemini Code Assist）によって読み込まれるプロジェクト固有のルールです。

## 💬 言語設定

**すべての会話・応答は日本語で行うこと。**

## 🧪 テスト実行ルール

### Vitest実行コマンド
PowerShellでの文字化けを防ぎ、JSON出力を生成するための正式コマンド：

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; npx vitest run
```

### 結果確認手順
1. 上記コマンドを実行
2. 標準出力の結果は信頼しない（文字化けや省略の可能性があるため）
3. 生成された `test-results.json` を `view_file` で読み込んで結果を確認すること

## 🎨 画像生成・保存ルール

画像生成を行う際は、以下のルールに従って保存すること。

### 保存先・ファイル名

*   **保存先**: `_local/img/YYYY/MM/`（自動作成される）
*   **ファイル名規則**: `YYYYMMDD_Description_NN`（拡張子はツールが自動判定）
    *   例: `20260224_cinderace_silhouette_01`

### 保存手順（必須 — image-saver MCP を使うこと）

`run_shell_command` による画像コピーは**ハングするため禁止**。
必ず `image-saver` MCP ツールを使用すること。

#### Step 1: 画像を生成する

通常通り画像生成を行う。生成された画像は `brain/<session-id>/` に保存される。

#### Step 2: 生成ファイルを確認する

```
mcp_image-saver_list_brain_images
  session_id: (省略で最新セッションを自動選択)
```

#### Step 3: 画像を保存する

```
mcp_image-saver_save_images
  session_id: "<session-id>"
  yyyy: "2026"
  mm: "02"
  files:
    - src: "cinderace_silhouette_1_1771900720100.png"
      dest: "20260224_cinderace_silhouette_01"
    - src: "cinderace_silhouette_2_1771900740962.png"
      dest: "20260224_cinderace_silhouette_02"
```

拡張子はツールがファイルのマジックナンバーから自動判定する。`dest` には拡張子を含めないこと。

#### Step 4: 保存結果を確認する

```
mcp_image-saver_list_saved_images
  yyyy: "2026"
  mm: "02"
```

## ⚠️ run_shell_command 制約事項

`run_shell_command` は同期実行であり、完了を返さないとセッション全体がハングする。以下を厳守すること：

1.  **`Start-Sleep` 禁止** — pwsh プロセスがゾンビ化する。待機が必要な場合はユーザーに報告し、次のターンで続行すること。
2.  **ファイルコピー・移動の禁止** — `Copy-Item` / `Move-Item` は `run_shell_command` で実行しない。画像保存には `image-saver` MCP を使うこと。
3.  **長時間実行コマンド禁止** — 完了まで数十秒以上かかるコマンドは避けること。
4.  **`[System.IO.File]::ReadAllBytes()` 禁止** — ファイルロックによるハングの原因となる。
5.  **`.ps1` スクリプトの実行禁止** — `run_shell_command` で `.ps1` を実行してもハングする。
