# アメブプランナー

[English README](README.md)

CandyBoost Planner は **Pokémon Sleep** のアメブースト配分を計画するための小さなWebツールです。

## 公開ページ

- `https://jb-sk.github.io/candy_boost_planner/`

## 主な機能

- 複数ポケモンのアメブ配分（かけら上限チェック付き）
- 睡眠EXPの計算（GSD・イベント補正・成長のお香の配置を含む長期計画）
- ポケモンボックス（フィルタ/計算機への反映）
- にとよん形式エクスポートのインポート互換（非公式）
- JP / EN 切替

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
pnpm run update:all
```

`update:all` はローカルの `pokesleep-tool` クローンを `git pull --ff-only` で最新化し、MasterDBの対話更新、フォーム突合、正規化した対応表からのMasterDB・英名の再生成、食材ラベルの検査、ビルドまで順に実行します。最初の生成処理で入力を求める場合があるため、TTYで実行してください。クローンは既定で `../../External/pokesleep-tool` を参照し、別の場所にある場合は `--pokesleep-tool <path>` または `POKESLEEP_TOOL_PATH` で指定できます。イベントと満月の生成物は別系統で、イベントは `auto-update-events.yml`、満月は通常CIが検証します。

その他:

```bash
npm run generate:tables
npm run generate:terms
npm run generate:pokemon-en-names
```

アメブーストの倍率（`src/domain/pokesleep/boost-config.ts` を書き換えます）:

```bash
npm run set:boost -- --mini-exp 2 --mini-shards 4 --full-exp 2 --full-shards 5
```

イベントの睡眠EXPボーナス（Wikiから期間と倍率を取得して `src/domain/pokesleep/_generated/sleep-exp-events.ts` を生成）:

```bash
npm run generate:events            # 生成
npm run generate:events -- --dry-run  # 書き込まずに結果だけ見る
npm run verify:events              # 生成物が最新かを検査
```

- 毎日 GitHub Actions（`auto-update-events.yml`）が実行し、差分があればPRを作ります
- 機械的に読めなかったものは「要確認」として出るので、`scripts/events-overrides.json` に人手で確定値を書きます
- グッドスリープデーは月齢から求まるため対象外です（`lunar-calendar.ts` が扱います）

## 設定（任意）

Viteの環境変数（ビルド時に埋め込み）です。GitHub Pagesの場合は **Repository variables** に登録してください。

- `VITE_CF_WEB_ANALYTICS_TOKEN`

## 参照元 / クレジット

ヘルプ画面には主な参照元（にとよん・RaenonX・攻略Wiki）だけを載せています。実際に使っている参照元は下記が全てです。

### データ出典（サイト）

| 参照元 | 使っているデータ | 生成物 |
|---|---|---|
| [ポケモンスリープ攻略・検証Wiki（WikiWiki）](https://wikiwiki.jp/poke_sleep/) | ポケモン一覧・きのみ・多言語の名詞/用語・育成/レベル・イベント一覧 | `pokemon-db`, `pokemon-master`, `terms`, `tables`, `sleep-exp-events` |
| [RaenonX](https://pks.raenonx.cc/) | 経験値テーブル（[経験値表](https://pks.raenonx.cc/ja/xp/table)） | `tables` |
| [個体値計算機（pokesleep-tool）](https://nitoyon.github.io/pokesleep-tool/iv/) | ポケモンデータ・エクスポート/インポート形式（MIT / 非公式連携）。生成時はローカルクローン [nitoyon/pokesleep-tool](https://github.com/nitoyon/pokesleep-tool) を突合に使う | `pokemon-names`, `candy-family`, フォーム対応表 |
| [PokeAPI](https://pokeapi.co/) | ポケモンの英名 | `pokemon-name-en` |
| [PokéSleep Super Wiki](https://wiki.pokesleep.com/en/events) | イベントの英語名 | `event-name-en` |
| [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/List_of_events_in_Pok%C3%A9mon_Sleep) | イベントの英語名（Super Wiki で埋まらない分） | `event-name-en` |
| [ポケモンスリープ公式サイト](https://www.pokemonsleep.net/) ／ [公式ニュース](https://www.pokemonsleep.net/news/) | イベント倍率・開催期間の裏取り（`scripts/events-overrides.json` に個別URLを記録） | `sleep-exp-events` |

### 計算・生成に使うライブラリ

| ライブラリ | 用途 |
|---|---|
| [Astronomy Engine](https://github.com/cosinekitty/astronomy)（MIT） | 満月日（グッドスリープデー判定）の算出。**ビルド時のみ**使い、実行時は生成済みテーブル `_generated/full-moon-dates.ts`（2023-01-01〜2046-12-31）だけを読む（混入は `verify:runtime-bundle` で検査） |
| [cheerio](https://cheerio.js.org/) | 生成スクリプトの HTML 解析 |
| [Vue](https://vuejs.org/) / [Vue I18n](https://vue-i18n.intlify.dev/) | アプリ本体・多言語化 |

### その他の外部依存

- [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/): `VITE_CF_WEB_ANALYTICS_TOKEN` を設定したときだけビーコンを読み込みます（任意）

## 免責

本プロジェクトは **非公式**であり、任天堂 / The Pokémon Company / Pokémon Sleep とは関係ありません。
公式の情報は [ポケモンスリープ公式サイト](https://www.pokemonsleep.net/) を参照してください。

## ライセンス

MIT。
