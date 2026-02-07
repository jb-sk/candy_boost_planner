---
description: マージ/リベース作業の準備(Pre)と仕上げ(Post)を行う安全なワークフロー
---

# 安全なGitマージ/リベース支援ワークフロー

このワークフローは、複雑なコンフリクトや "Git Ghost"（Untracked Filesによる誤検知）を防ぎつつ、ユーザーが「一部の修正を先行してMainにマージする」などの作業を安全に行えるように支援するものです。
**「Pre（準備）」** と **「Post（仕上げ）」** の2段階に分かれています。

---

## 🚀 1. /rebase-pre （作業準備）

エージェントへの指示: 「`/rebase-pre` を実行して」
目的: **安全でクリーンな作業用ブランチ（Mainベース）を用意する。**

### 手順

1.  **対象の特定と確認**
    *   **作業対象ブランチ**: 現在チェックアウトしているブランチ（例: `quality-improvements`）。
    *   **取り込みたいコミット**: 先行してマージしたいバグ修正などのコミット。
        *   ※範囲が曖昧な場合は、必ずユーザーに確認すること。

2.  **作業環境の完全退避（Safety First）**
    *   現在の作業ディレクトリの変更（Untracked含む）を全て退避する。
    *   **重要**: これを行わないと、リベース時に亡霊コンフリクトが発生する。
    ```powershell
    git add .
    git commit -m "WIP: save before rebase" # 必要なら
    git stash --include-untracked
    ```

3.  **作業用クリーンブランチの作成**
    *   `main` を最新化し、そこから一時的な作業ブランチを作成する。
    *   ブランチ名例: `temp/merge-work-YYYYMMDD`
    ```powershell
    git checkout main
    git pull origin main
    git checkout -b temp/merge-work-YYYYMMDD
    ```

4.  **Cherry-pickによるコミットの移植**
    *   必要なコミットだけを `temp` ブランチに Cherry-pick する。
    ```powershell
    git cherry-pick <commit-hash>
    ```

5.  **ユーザーへのパス**
    *   「作業用ブランチ `temp/merge-work-...` を用意しました。このブランチを使ってMainへのマージ作業を行ってください」と報告して終了。
    *   **ここからのマージ作業（PR作成やマージ実行）はユーザーが行う。**

---

## ✅ 2. /rebase-post （仕上げ・再同期）

エージェントへの指示: 「マージ終わったから `/rebase-post` を実行して」
目的: **更新されたMainの上に、元の作業ブランチをリベース（積み直し）して環境を復元する。**

### 手順

1.  **Mainの最新化**
    *   ユーザーのマージ作業によって `remote/main` が進んでいるはずなので、同期する。
    ```powershell
    git checkout main
    git pull origin main
    ```

2.  **作業ブランチのリベース（積み直し）**
    *   元の作業ブランチ（例: `quality-improvements`）に戻り、最新の `main` の上にリベースする。
    *   ※これで「Mainに取り込まれた先行コミット」は吸収され、「まだのマージの機能」だけがMainの上に乗る形になる。
    ```powershell
    git checkout <original-feature-branch>
    git rebase main
    ```

3.  **作業環境の復元**
    *   Preで退避したスタッシュを戻す。
    *   ※リベース完了後なので、Untrackedファイルが戻っても安全。
    ```powershell
    git stash pop
    ```

4.  **後始末**
    *   一時ブランチを削除する。
    ```powershell
    git branch -D temp/merge-work-YYYYMMDD
    ```
    *   「対象ブランチを最新のMain上にリベースし、作業環境を復元しました」と報告して終了。
