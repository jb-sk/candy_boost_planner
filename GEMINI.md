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

## 📝 プロンプト作成ルール（引き継ぎ・要約時）

次セッションへの引き継ぎプロンプトや要約を作成する際は、IDEの自動リンク機能による表示崩れを防ぐため、以下のルールを厳守すること。

### 1. プレーンテキスト運用の徹底
- プロンプト部分は **Markdown装飾（太字、斜体、リンク、バッククォート）を使用せず、プレーンテキスト形式** で出力すること。
- コードブロック ` ```text ` を使用してプロンプト全体を囲むこと。

### 2. ファイルパス表記（厳禁事項）
- **絶対パス禁止**: プロジェクトルートからの相対パスのみ使用する。
- **バッククォート禁止**: パスをバッククォートで囲んではならない（逆にリンク化されるリスクがあるため）。
- **Markdownリンク禁止**: `[file](path)` の形式は絶対に使用しない。

### 3. 出力例（正解）

```text
# 次のタスク
src/main.ts のリファクタリング

## 参照ファイル
src/main.ts
docs/README.md
```

### 4. 通常会話時のファイルパス（例外）
- プロンプト出力**以外**の通常の会話や説明においては、従来通りバッククォート (`) で囲んで可読性を確保してもよい。ただし絶対パスは極力避けること。

## 🎨 画像生成・保存ルール

画像生成を行う際は、以下のルールに従って自動的に保存すること：

1.  **保存先**: `_local/img/YYYY/MM/`
    *   年/月フォルダが存在しない場合は自動的に作成すること。
2.  **ファイル名規則**: `YYYYMMDD_Description.EXT`
    *   **重要**: ツールから出力されたファイルの中身（マジックナンバー）を確認し、正しい拡張子（`.jpg` または `.png`）を付与すること。ツールが誤った拡張子で出力する場合があるため、拡張子を鵜呑みにしないこと。
    *   例: `20260131_hero_banner.jpg` (中身がJPEGの場合)
3.  **確認**: 生成後はファイルが保存されたことをユーザーに報告すること。

## 🎨 好みの画像スタイル（Design Preference）

ユーザーは以下のスタイルを好みます。画像生成のプロンプトを作成する際は、これらのキーワードやトーンを優先してください。

### 1. キャラクターアイコン (Icon)
*   **Style**: Anime style, Vibrant colors, Clean background
*   **Mood**: Energetic, Happy, Cute, Adorable
*   **Example**: `cute_cinderace_icon` (Step 492) のような、明るくかわいらしい表情。

### 2. アイキャッチ / 背景 (Eyecatch)
*   **Style**: Simple and deformed art style, Flat colors, Clean lines, No detailed textures
*   **Ref**: Similar to "Pokemon Sleep" style
*   **Mood**: Relaxing, Peaceful, Minimalist
*   **Example**: `snorlax_sleeping_field_simple` (Step 513) のような、描き込みすぎないシンプルなデフォルメ調。

## 🔧 gemini-delegation 使用ルール

以下のタスクは gemini-delegation MCP を使用してサブエージェントに委譲できます：

- **テスト実行**: `npx playwright test` / `npx vitest run`
- **ファイル調査**: エラーコンテキスト（error-context.md）の読み取りと分析
- **デバッグ**: 失敗原因の調査
- **Lint**: ESLint/Prettier実行
- **Audit**: 依存関係の脆弱性チェック

```
mcp_gemini-delegation_delegate_to_agent
  agent_type: "test" または "debug" または "lint" または "audit"
  task: "タスクの説明"
  workdir: "d:\\Dev\\Projects\\candy_boost_planner"
```
