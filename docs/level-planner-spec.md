# レベルプランナー仕様書

## 概要

レベルプランナーは、ポケモンスリープのアメ配分を計算するコアロジックです。
複数のポケモンに対して、制限（アメブ上限、かけら上限、在庫）を考慮しながら最適なアイテム配分を計算します。

## エントリポイント

```typescript
import { planLevelUp } from '@/domain/level-planner/core';

const result = planLevelUp(pokemons, inventory, config);
```

---

## 入力

### PokemonLevelUpRequest

| フィールド | 型 | 説明 |
|-----------|------|------|
| `id` | string | 一意識別子 |
| `pokedexId` | number | 図鑑番号 |
| `pokemonName` | string | ポケモン名 |
| `type` | PokemonType | タイプ（water, fire等） |
| `srcLevel` | number | 現在レベル |
| `dstLevel` | number | 目標レベル |
| `expType` | ExpType | EXPタイプ（600/900/1080/1320） |
| `nature` | ExpGainNature | 性格補正（up/normal/down） |
| `expGot` | number | 獲得済みEXP |
| `candyNeed` | number | 必要アメ数 |
| `boostOrExpAdjustment` | number | アメブ上限 or EXP補正 |
| `candyTarget?` | number | 個数指定（オプション） |
| `form?` | string | フォーム（オプション） |

### CandyInventory

```typescript
{
  species: Record<string, number>;      // 種族アメ（pokedexId → 個数）
  typeCandy: Record<string, TypeCandyStock>;  // タイプアメ
  universal: UniversalCandyStock;       // 万能アメ
}
```

### LevelUpPlanConfig

| フィールド | 型 | 説明 |
|-----------|------|------|
| `boostKind` | 'full' \| 'mini' \| 'none' | アメブースト種別 |
| `globalBoostLimit` | number | グローバルアメブ上限 |
| `globalShardsLimit` | number | グローバルかけら上限 |

---

## 出力

### LevelUpPlanResult

```typescript
{
  pokemons: PokemonLevelUpResult[];  // 各ポケモンの結果
  universalUsed: UniversalCandyStock;     // 万能アメ使用量
  universalRemaining: UniversalCandyStock; // 万能アメ残量
  typeCandyUsed: Record<string, TypeCandyStock>;  // タイプアメ使用量
  speciesCandyUsed: Record<string, number>;       // 種族アメ使用量
  totalBoostUsed: number;    // 全ポケモンのアメブ合計
  totalShardsUsed: number;   // 全ポケモンのかけら合計
}
```

### PokemonLevelUpResult

#### 到達情報

| フィールド | 型 | 説明 |
|-----------|------|------|
| `reachedLevel` | number | 到達レベル |
| `expToNextLevel` | number | あとEXP（次レベルまで） |
| `expToTarget` | number | 残EXP（目標レベルまで） |

#### 到達可能行用

| フィールド | 型 | 説明 |
|-----------|------|------|
| `reachableItems` | ItemUsage | 実際の配分結果 |

#### 目標まで行用

| フィールド | 型 | 説明 |
|-----------|------|------|
| `targetBoost` | number | 必要アメブ個数 |
| `targetNormal` | number | 必要通常アメ個数 |
| `targetShards` | number | 必要かけら |
| `targetItems` | ItemUsage | 必要アイテム詳細 |

#### 個数指定行用（candyTargetがある場合のみ）

| フィールド | 型 | 説明 |
|-----------|------|------|
| `candyTargetBoost?` | number | 必要アメブ個数 |
| `candyTargetNormal?` | number | 必要通常アメ個数 |
| `candyTargetShards?` | number | 必要かけら |
| `candyTargetItems?` | ItemUsage | 必要アイテム詳細 |

#### 不足情報

| フィールド | 型 | 説明 |
|-----------|------|------|
| `shortage.candy` | number | アメ不足量 |
| `shortage.boost` | number | アメブ不足量 |
| `shortage.shards` | number | かけら不足量 |

#### 診断情報

| フィールド | 型 | 説明 |
|-----------|------|------|
| `diagnosis.limitingFactor` | LimitingFactor | 主要制限要因 |
| `resourceSnapshot.availableShards` | number | 配分時点のかけら残数 |
| `resourceSnapshot.availableBoost` | number | 配分時点のアメブ残数 |
| `resourceSnapshot.availableInventoryValue` | number | 配分時点の在庫価値 |

### ItemUsage

| フィールド | 型 | 説明 |
|-----------|------|------|
| `speciesCandy` | number | 種族アメ使用量 |
| `typeS` | number | タイプS使用量 |
| `typeM` | number | タイプM使用量 |
| `universalS` | number | 万能S使用量 |
| `universalM` | number | 万能M使用量 |
| `universalL` | number | 万能L使用量 |
| `totalSupply` | number | アイテム価値合計 |
| `boostCount` | number | アメブ個数 |
| `normalCount` | number | 通常アメ個数 |
| `totalCandyCount` | number | アメ合計個数 |
| `shardsCount` | number | かけら個数 |
| `surplus` | number | 余り（0-2が理想） |

---

## 3フェーズ構成

### Phase 1: 到達可能行の配分

**役割**: 実際に配分可能なアイテムを計算

1. 各ポケモンに対して優先順位順に処理
2. 制約を考慮して到達可能レベルを計算
   - グローバルアメブ残量
   - グローバルかけら残量
   - 個別アメブ上限（boostOrExpAdjustment）
   - 個数指定（candyTarget）
   - アイテム在庫
3. 最適なアイテム配分を計算
4. 在庫から消費
5. 不足情報（shortage）を計算
6. 診断情報（diagnosis）を生成

### Phase 2: M/L→S スワップ最適化

**役割**: 余りを減らすためのアイテム交換

1. 下位ポケモンの余り（surplus ≥ 3）を検出
2. 上位ポケモンからS candy を借りてM/Lを返却
3. 両ポケモンの余りが2以下になるまで繰り返し

### Phase 3: 理論値行の生成

**役割**: 目標まで行と個数指定行の計算

1. 目標まで行（targetItems）
   - 在庫を無視して必要アイテムを計算
   - 不足分は万能Sで補填
2. 個数指定行（candyTargetItems）
   - candyTargetがある場合のみ
   - 指定個数に対する必要アイテムを計算

---

## 制限要因の優先順位

| 優先度 | 制限要因 | 説明 |
|--------|----------|------|
| 1 | `shards` | かけら制限で到達できない |
| 2 | `boost` | アメブ制限で到達できない |
| 3 | `candy` | アイテム在庫不足 |
| 4 | `null` | 制限なし（目標到達） |

---

## アメブースト種別

| 種別 | 説明 |
|------|------|
| `full` | アメブ100%（通常アメ使用なし） |
| `mini` | ミニブースト（通常アメとの混合） |
| `none` | アメブなし（通常アメのみ） |

---

## 余りルール

配分時のアイテム価値は、必要アメ価値より少し多くなる場合があります。
これは万能Sの最小単位（価値3）によるもので、**余り2以下**を許容しています。

```
余り = アイテム価値合計 - 必要アメ価値
```

---

## ファイル構成

```
src/domain/level-planner/
├── core.ts           # エントリポイント（planLevelUp）
├── plan.ts           # 3フェーズパイプライン
├── types.ts          # 型定義
├── context.ts        # 配分コンテキスト
├── phases/
│   ├── phase1-allocate.ts  # Phase 1
│   ├── phase2-swap.ts      # Phase 2
│   └── phase3-finalize.ts  # Phase 3
└── __tests__/        # テスト（70件）
```

---

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2026-01-06 | 初版作成（3フェーズ構成） |
