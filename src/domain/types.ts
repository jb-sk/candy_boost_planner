export type AppDataV1 = {
  version: 1;
  /** ユーザーが登録したポケモン計画の一覧 */
  pokemons: PokemonPlanV1[];
  /** 手持ちの総ゆめのかけら（上限チェック用） */
  totalShards: number;
};

export type ExpType = 600 | 900 | 1080 | 1320;

/** アメブ種別（通常アメ/ミニブ/アメブ） */
export type BoostEvent = "none" | "mini" | "full";

/** 性格による「経験値獲得量」補正（nitoyon式のCandy EXP計算に合わせる） */
export type ExpGainNature = "down" | "normal" | "up";

export type PokemonPlanV1 = {
  id: string;
  /** 種族（表示用・将来の計算拡張用）。現時点は自由入力/選択想定 */
  species: string;
  /** 現在レベル */
  level: number;
  /** 目標レベル（任意） */
  targetLevel?: number;
  /** 投入するアメの総数（イベント枠の配分） */
  candyPlanned: number;
  /** 経験値タイプ（600/900/1080/1320） */
  expType: ExpType;
  /** 性格による経験値補正 */
  expGainNature: ExpGainNature;
  /** ブースト種別（none/mini/full） */
  boost: BoostEvent;
  /** 現在レベル内で既に得ている経験値（任意、未入力なら0） */
  expGot?: number;
};
