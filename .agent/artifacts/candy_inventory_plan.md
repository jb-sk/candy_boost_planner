# アメ在庫管理機能 実装計画

## 概要

ユーザーのアメ所持数（種族アメ・タイプアメ・万能アメ）を管理し、計算時に自動配分する機能を追加する。

---

## 1. データ構造

### 1.1 新規ファイル: `persistence/candy.ts`

```typescript
const STORAGE_KEY = "candy-boost-planner:candy-inventory:v1";

type CandyInventoryV1 = {
  schemaVersion: 1;

  // 万能アメ（グローバル）
  universal: {
    s: number;  // 1個 = アメ3個分
    m: number;  // 1個 = アメ20個分
    l: number;  // 1個 = アメ100個分
  };

  // タイプアメ（タイプ名ごと）
  typeCandy: Record<string, {
    s: number;  // 1個 = アメ4個分
    m: number;  // 1個 = アメ25個分
  }>;

  // ポケモンのアメ（pokedexIdごと）
  species: Record<string, number>;
};
```

### 1.2 アメ換算値

| 種類 | S | M | L |
|------|---|---|---|
| ポケモンのアメ | 1 | - | - |
| タイプアメ | 4 | 25 | 未実装 |
| 万能アメ | 3 | 20 | 100 |

---

## 2. アメ配分アルゴリズム

### 2.1 優先順位

1. ポケモンのアメ（種族固有）
2. タイプアメS → タイプアメM
3. 万能アメS → 万能アメM → 万能アメL

### 2.2 配分ルール

| サイズ | ルール |
|--------|--------|
| ポケモンのアメ | 各ポケモンに1:1で適用 |
| S（タイプ・万能） | 複数ポケモンに分散使用OK |
| M/L | **分割不可**。必要量が大きいポケモンに優先割当 |

### 2.3 アルゴリズム

```typescript
function allocateCandy(pokemons: PokemonNeed[], inventory: CandyInventory): AllocationResult {
  // Phase 1: 種族アメを適用
  for (const p of pokemons) {
    const speciesCandy = inventory.species[p.pokedexId] ?? 0;
    const used = Math.min(p.need, speciesCandy);
    p.remaining = p.need - used;
    p.speciesCandyUsed = used;
  }

  // Phase 2: タイプアメを適用
  // 2a. タイプアメS（分割OK）
  for (const p of pokemons) {
    const typeInv = inventory.typeCandy[p.type] ?? { s: 0, m: 0 };
    const sNeeded = Math.floor(p.remaining / 4);
    const sUsed = Math.min(sNeeded, typeInv.s);
    typeInv.s -= sUsed;
    p.remaining -= sUsed * 4;
    p.typeSUsed = sUsed;
  }

  // 2b. タイプアメM（分割不可、必要量降順で割当）
  const byType = groupBy(pokemons, p => p.type);
  for (const [type, group] of byType) {
    group.sort((a, b) => b.remaining - a.remaining);
    for (const p of group) {
      const typeInv = inventory.typeCandy[type];
      while (p.remaining > 0 && typeInv.m > 0) {
        typeInv.m--;
        p.remaining = Math.max(0, p.remaining - 25);
        p.typeMUsed = (p.typeMUsed ?? 0) + 1;
      }
    }
  }

  // Phase 3: 万能アメを適用
  // 3a. 万能アメS（分割OK）
  for (const p of pokemons) {
    const sNeeded = Math.floor(p.remaining / 3);
    const sUsed = Math.min(sNeeded, inventory.universal.s);
    inventory.universal.s -= sUsed;
    p.remaining -= sUsed * 3;
    p.uniSUsed = sUsed;
  }

  // 3b. 万能アメM（分割不可、必要量降順で割当）
  pokemons.sort((a, b) => b.remaining - a.remaining);
  for (const p of pokemons) {
    while (p.remaining > 0 && inventory.universal.m > 0) {
      inventory.universal.m--;
      p.remaining = Math.max(0, p.remaining - 20);
      p.uniMUsed = (p.uniMUsed ?? 0) + 1;
    }
  }

  // 3c. 万能アメL（分割不可、必要量降順で割当）
  for (const p of pokemons) {
    while (p.remaining > 0 && inventory.universal.l > 0) {
      inventory.universal.l--;
      p.remaining = Math.max(0, p.remaining - 100);
      p.uniLUsed = (p.uniLUsed ?? 0) + 1;
    }
  }

  // 不足があればshortageに記録
  const shortage = pokemons.filter(p => p.remaining > 0);

  return { pokemons, shortage };
}
```

---

## 3. UI変更

### 3.1 計算機 (CalcRow)

**変更内容:**
- EXPタイプ欄を削除（自動計算・編集不可のため重要度低）
- 種族アメ入力欄を追加

**表示項目:**
| 項目 | 説明 |
|------|------|
| 種族アメ | そのポケモンの種族アメ所持数（入力可） |

### 3.2 リソース表示セクション

**現在:**
- かけら使用率

**追加:**
```
【アメ使用状況】
万能アメ: S 12/20 | M 2/3 | L 0/1
タイプアメ: でんき S 5/10 M 1/2
           ノーマル S 3/8 M 0/1
```

**モバイル向けコンパクト表示:**
```
万能: S12 M2 L0 / タイプ: 計15個
```

### 3.3 新規追加フォーム (BoxPanel)

**追加項目:**
- 種族アメ所持数（オプション入力）
- タイプは自動表示（pokedexIdから取得）

### 3.4 ボックス詳細

**追加項目:**
- 種族アメ所持数（編集可能）
- タイプ表示（参照のみ）

### 3.5 設定/入力エリア

**万能アメ・タイプアメの入力フォーム:**
- かけら入力と同じ場所に配置
- 万能アメ S/M/L
- タイプアメ（タイプ選択 + S/M）

---

## 4. 実装フェーズ

| Phase | タスク | ファイル |
|-------|--------|----------|
| A | データ永続化層 | `persistence/candy.ts` 新規作成 |
| B | 型定義追加 | `domain/types.ts` |
| C | アメ配分ロジック | `domain/candy-allocator.ts` 新規作成 |
| D | Composable拡張 | `composables/useCandyStore.ts` 新規作成 |
| E | 計算機UI変更 | `CalcRow`関連、EXPタイプ削除→種族アメ追加 |
| F | リソース表示拡張 | かけらセクションに万能アメ・タイプアメ追加 |
| G | 新規追加フォーム | 種族アメ入力欄追加 |
| H | ボックス詳細 | 種族アメ表示・編集 |
| I | 万能アメ入力UI | かけら入力の隣に配置 |
| J | タイプアメ入力UI | タイプ選択式の入力フォーム |

---

## 5. 注意事項

### 5.1 タイプ情報の取得

- `pokemon-master.ts` の `type` / `typeJa` から取得
- ポケモンスリープでは複合タイプなし（1ポケモン=1タイプ）

### 5.2 無駄の表示

- 万能アメSの1～2個程度の端数無駄は非表示
- M/L使用時の大きな無駄は表示（例：「L使用で50個分余剰」）

### 5.3 M/L割当先の表示

```
万能アメM: 2個使用 → ピカチュウ, カビゴン
万能アメL: 1個使用 → リザードン
```

---

## 6. 将来の拡張

- タイプアメL（未実装だが追加される可能性）
- アメ使用履歴
- イベント終了後の在庫自動更新
