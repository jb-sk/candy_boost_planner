/**
 * アメ在庫管理の Composable
 */
import { ref, computed, watch } from "vue";
import {
  loadCandyInventory,
  saveCandyInventory,
  getSpeciesCandy,
  setSpeciesCandy,
  getTypeCandy,
  setTypeCandy,
  getUniversalCandy,
  setUniversalCandy,
  type CandyInventoryV1,
  type TypeCandyInventory,
  type UniversalCandyInventory,
} from "../persistence/candy";
import { schedulePersist } from "../persistence/deferredPersist";

// シングルトンで管理
const inventory = ref<CandyInventoryV1>(loadCandyInventory());

function cloneInventory(): CandyInventoryV1 {
  return JSON.parse(JSON.stringify(inventory.value));
}

// 変更を監視し、操作タスク外で最新の在庫全体を保存する
watch(
  inventory,
  () => {
    schedulePersist("candy", () => saveCandyInventory(inventory.value));
  },
  { deep: true }
);

export function useCandyStore() {
  const inventorySnapshot = computed(() => inventory.value);

  // --- 万能アメ ---
  const universalCandy = computed(() => getUniversalCandy(inventory.value));

  function updateUniversalCandy(candy: Partial<UniversalCandyInventory>) {
    const current = inventory.value.universal;
    const next = cloneInventory();
    setUniversalCandy(next, {
      s: candy.s ?? current.s,
      m: candy.m ?? current.m,
      l: candy.l ?? current.l,
    });
    inventory.value = next;
  }

  // --- タイプアメ ---
  function getTypeCandyFor(typeName: string): TypeCandyInventory {
    return getTypeCandy(inventory.value, typeName);
  }

  function updateTypeCandy(typeName: string, candy: Partial<TypeCandyInventory>) {
    const current = getTypeCandy(inventory.value, typeName);
    const next = cloneInventory();
    setTypeCandy(next, typeName, {
      s: candy.s ?? current.s,
      m: candy.m ?? current.m,
    });
    inventory.value = next;
  }

  // 使用中のタイプ一覧（在庫があるもの）
  const activeTypes = computed(() => {
    const types: string[] = [];
    for (const [type, inv] of Object.entries(inventory.value.typeCandy)) {
      if (inv.s > 0 || inv.m > 0) {
        types.push(type);
      }
    }
    return types.sort();
  });

  // --- ポケモンのアメ ---
  function getSpeciesCandyFor(pokedexId: number): number {
    return getSpeciesCandy(inventory.value, pokedexId);
  }

  function updateSpeciesCandy(pokedexId: number, count: number) {
    const next = cloneInventory();
    setSpeciesCandy(next, pokedexId, count);
    inventory.value = next;
  }

  // --- インベントリ全体 ---
  function getInventory(): CandyInventoryV1 {
    return JSON.parse(JSON.stringify(inventory.value));
  }

  function resetInventory() {
    inventory.value = {
      schemaVersion: 1,
      universal: { s: 0, m: 0, l: 0 },
      typeCandy: {},
      species: {},
    };
  }

  return {
    // 万能アメ
    universalCandy,
    updateUniversalCandy,

    // タイプアメ
    getTypeCandyFor,
    updateTypeCandy,
    activeTypes,

    // ポケモンのアメ
    getSpeciesCandyFor,
    updateSpeciesCandy,

    // 全体
    inventorySnapshot,
    getInventory,
    resetInventory,
  };
}
