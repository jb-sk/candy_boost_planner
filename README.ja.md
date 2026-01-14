# CandyBoost Planner

[English README](README.md)

CandyBoost Planner は **Pokémon Sleep** のアメブースト配分を計画するための小さなWebツールです。

## 公開ページ

- `https://jb-sk.github.io/candy_boost_planner/`

## 主な機能

- 複数ポケモンのアメブ配分（かけら上限チェック付き）
- ポケモンボックス（フィルタ/計算機への反映）
- にとよん形式エクスポートのインポート互換（非公式）
- JP / EN 切替
- 支援リンク（OFUSE / Buy Me a Coffee）

## 開発

```bash
npm install
npm run dev
```

ビルド:

```bash
npm run build
```

## データ更新（運用者向け）

MasterDB（統一入口・推奨）:

```bash
npm run generate:master
```

その他:

```bash
npm run generate:tables
npm run generate:terms
npm run generate:pokemon-en-names
```

イベント倍率（`src/domain/pokesleep/boost-config.ts` を書き換えます）:

```bash
npm run set:boost -- --mini-exp 2 --mini-shards 4 --full-exp 2 --full-shards 5
```

## 設定（任意）

Viteの環境変数（ビルド時に埋め込み）です。GitHub Pagesの場合は **Repository variables** に登録してください。

- `VITE_OFUSE_URL`
- `VITE_BMAC_URL`
- `VITE_CF_WEB_ANALYTICS_TOKEN`

## 参照元 / クレジット

- ポケモン一覧・一部用語: [WikiWiki](https://wikiwiki.jp/poke_sleep/)
- 英名: [PokeAPI](https://pokeapi.co/)
- 経験値テーブル: [RaenonX](https://pks.raenonx.cc/)
- にとよん形式: [にとよんさんのツール](https://nitoyon.github.io/pokesleep-tool/iv/)互換（MIT / 非公式連携）

## 免責

本プロジェクトは **非公式**であり、任天堂 / The Pokémon Company / Pokémon Sleep とは関係ありません。

## ライセンス

MIT。
