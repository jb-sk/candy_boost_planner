import { calcExp } from "./pokesleep/exp";
import { getPokemonType, type PokemonType } from "./pokesleep/pokemon-names";
import type { DeepReadonly } from "vue";
import type { ExpGainNature, ExpType, PokemonBoxEntryV1 } from "./types";

/** Lv が未設定のときの既定値。保存データの読み込み（persistence/box.ts）と揃える。 */
export const DEFAULT_INDIVIDUAL_LEVEL = 1;

/**
 * 個体の属性。ボックスの個体（`planner.* ?? derived.*`）を解決した値で、アプリ全体で共通。
 * `expRemaining` は実際の数値で、0 / 未設定は「次Lvまで全部」に解決済み。
 */
export type Individual = {
  level: number;
  /** あとEXP（次Lvまで）。最大Lvでは 0 */
  expRemaining: number;
  /** 累計睡眠時間（時間） */
  sleepHours: number;
  expType: ExpType;
  nature: ExpGainNature;
  /**
   * 表示名。`resolveIndividual` と `updateIndividual` の `patch.label` は生の名前（空なら種族名表示に任せる）。
   * ボックスストアの `individualById` だけは言語別の表示名（`displayBoxTitle`）で、計算機の行の `title` になる。
   */
  label: string;
  pokedexId: number | undefined;
  pokemonType: PokemonType | undefined;
};

/** 現在Lvから次Lvまでに必要なEXP（あとEXPの上限）。最大Lvでは 0。 */
export function expToNextLevel(level: number, expType: ExpType): number {
  return Math.max(0, calcExp(level, level + 1, expType));
}

/** あとEXPを 0〜次Lvまでの必要EXP にクランプする。 */
export function clampExpRemaining(raw: number, level: number, expType: ExpType): number {
  return Math.min(Math.max(0, Math.floor(raw)), expToNextLevel(level, expType));
}

/**
 * ボックスの個体から、個体属性を解決する。
 * 既定値（Lv 1・EXPタイプ 600・性格 normal・睡眠 0h）と、あとEXP の解釈
 * （0 / 未設定 = 次Lvまで全部）はここだけで決める。
 */
export function resolveIndividual(entry: DeepReadonly<PokemonBoxEntryV1>): Individual {
  const level = entry.planner?.level ?? entry.derived?.level ?? DEFAULT_INDIVIDUAL_LEVEL;
  const expType = entry.planner?.expType ?? entry.derived?.expType ?? 600;
  const toNext = expToNextLevel(level, expType);
  const stored = entry.planner?.expRemaining;
  const pokedexId = entry.derived?.pokedexId;
  return {
    level,
    expRemaining: stored !== undefined && stored > 0 ? Math.min(stored, toNext) : toNext,
    sleepHours: entry.planner?.sleepHours ?? 0,
    expType,
    nature: entry.planner?.expGainNature ?? entry.derived?.expGainNature ?? "normal",
    label: entry.label,
    pokedexId,
    pokemonType: pokedexId ? getPokemonType(pokedexId) : undefined,
  };
}

/** 個体属性の更新。キーが無い項目は変えない。`expRemaining` は `undefined` を明示すると「次Lvまで全部」へ戻す。 */
export type IndividualPatch = Partial<Pick<Individual, "level" | "sleepHours" | "expType" | "nature" | "label">> & {
  expRemaining?: number | undefined;
};
