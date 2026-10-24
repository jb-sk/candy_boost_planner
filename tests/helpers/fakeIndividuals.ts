import { ref } from "vue";
import { clampExpRemaining, expToNextLevel, type Individual } from "../../src/domain/individual";
import { maxLevel as MAX_LEVEL } from "../../src/domain/pokesleep/tables";
import type { ExpGainNature, ExpType } from "../../src/domain/types";
import { useCalcStore, type CalcStore, type IndividualsPort } from "../../src/composables/useCalcStore";
import { INDIVIDUAL_EDIT_SCOPES, useHistory, type History } from "../../src/composables/useHistory";

/** メモリ上の Map を正本にする偽の個体ポート。ボックスストアの代わりに計算機ストアへ注入する。 */
export type FakeIndividuals = IndividualsPort & {
  /** ボックス側で個体を作る・書き換える（履歴には記録しない）。同期の watch が走る。 */
  set: (boxId: string, patch: Partial<Individual>) => void;
  /** ボックス側で個体を消す（履歴には記録しない）。行はリンク切れになる。 */
  remove: (boxId: string) => void;
};

/** 行の既定値（Lv 10・EXPタイプ 600・性格 normal）で個体を作る。 */
function individualWith(patch: Partial<Individual>, base?: Individual): Individual {
  const level = patch.level ?? base?.level ?? 10;
  const expType: ExpType = patch.expType ?? base?.expType ?? 600;
  const toNext = expToNextLevel(level, expType);
  const rawExp = patch.expRemaining ?? (patch.level !== undefined ? undefined : base?.expRemaining);
  return {
    level,
    expType,
    expRemaining: rawExp !== undefined && rawExp > 0 ? Math.min(rawExp, toNext) : toNext,
    sleepHours: patch.sleepHours ?? base?.sleepHours ?? 0,
    nature: patch.nature ?? base?.nature ?? "normal",
    label: patch.label ?? base?.label ?? "",
    pokedexId: "pokedexId" in patch ? patch.pokedexId : base?.pokedexId,
    pokemonType: "pokemonType" in patch ? patch.pokemonType : base?.pokemonType,
  };
}

/**
 * 偽ポートを作り、共通履歴の `box` 提供者として登録する（`updateIndividual` は本物と同じく
 * `INDIVIDUAL_EDIT_SCOPES` で記録し、Undo / Redo では Map ごと戻す）。
 */
export function createFakeIndividuals(history: History): FakeIndividuals {
  const individualById = ref<ReadonlyMap<string, Individual>>(new Map());
  const replace = (next: Map<string, Individual>) => {
    individualById.value = next;
  };

  history.registerProvider<ReadonlyMap<string, Individual>>("box", {
    prepare() {},
    capture: () => individualById.value,
    restore: (snapshot) => replace(new Map(snapshot)),
  });

  return {
    individualById,
    set(boxId, patch) {
      const next = new Map(individualById.value);
      next.set(boxId, individualWith(patch, individualById.value.get(boxId)));
      replace(next);
    },
    remove(boxId) {
      const next = new Map(individualById.value);
      next.delete(boxId);
      replace(next);
    },
    updateIndividual(boxId, patch, opts) {
      const current = individualById.value.get(boxId);
      if (!current) throw new Error(`updateIndividual: unknown boxId ${boxId}`);
      const level = patch.level === undefined ? current.level : Math.max(1, Math.min(MAX_LEVEL, Math.floor(patch.level)));
      const expType = patch.expType ?? current.expType;
      const rawExp = "expRemaining" in patch ? patch.expRemaining : level !== current.level ? undefined : current.expRemaining;
      const expRemaining = rawExp === undefined || Number.isNaN(rawExp) ? 0 : clampExpRemaining(rawExp, level, expType);
      const next = individualWith(
        {
          level,
          expType,
          expRemaining,
          nature: patch.nature as ExpGainNature | undefined,
          sleepHours: patch.sleepHours,
          label: patch.label,
        },
        { ...current, expRemaining: 0 },
      );
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      history.record(opts.label, INDIVIDUAL_EDIT_SCOPES, opts.coalesceKey === undefined ? {} : { coalesceKey: opts.coalesceKey });
      const map = new Map(individualById.value);
      map.set(boxId, next);
      replace(map);
    },
  };
}

type CalcStoreOptions = Parameters<typeof useCalcStore>[0];

const fakeByStore = new WeakMap<CalcStore, FakeIndividuals>();

/** 偽ポートを注入した計算機ストア。履歴を渡さなければ専用の履歴を作る。 */
export function createCalcStore(opts: Omit<CalcStoreOptions, "individuals">): CalcStore {
  const history = opts.history ?? useHistory();
  const individuals = createFakeIndividuals(history);
  const store = useCalcStore({ ...opts, history, individuals });
  fakeByStore.set(store, individuals);
  return store;
}

/** `createCalcStore` で作ったストアの偽ポート。ボックス側の編集を模すときに使う。 */
export function fakeIndividualsOf(store: CalcStore): FakeIndividuals {
  const fake = fakeByStore.get(store);
  if (!fake) throw new Error("store was not created by createCalcStore");
  return fake;
}

/** 個体の入力（旧 `upsertFromBox` の引数と同じ形）。 */
export type BoxRowInput = {
  boxId: string;
  srcLevel: number;
  expType: ExpType;
  nature: ExpGainNature;
  expRemaining?: number;
  sleepHours?: number;
  title?: string;
  dstLevelDefault?: number;
  pokedexId?: number;
  pokemonType?: string;
};

/** 個体をボックス（偽ポート）に作る。既にあるときは値を書き換える（ボックス側の編集）。行は追加しない。 */
export function setBoxIndividual(store: CalcStore, input: BoxRowInput): void {
  const { boxId, dstLevelDefault: _dstLevelDefault, srcLevel, title, ...rest } = input;
  fakeIndividualsOf(store).set(boxId, {
    ...rest,
    level: srcLevel,
    label: title ?? "",
    pokemonType: rest.pokemonType as Individual["pokemonType"],
  });
}

/**
 * 個体をボックス（偽ポート）に作り、計算機（表示中スロット）へ行を追加する。
 * 個体が既にあるときは値を書き換える。行が既にあれば追加しない。
 */
export function addBoxRow(store: CalcStore, input: BoxRowInput): void {
  setBoxIndividual(store, input);
  store.addRow(input.boxId, { dstLevelDefault: input.dstLevelDefault });
}
