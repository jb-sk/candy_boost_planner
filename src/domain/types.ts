export type AppDataV1 = {
  version: 1;
  /** ユーザーが登録したポケモン計画の一覧 */
  pokemons: PokemonPlanV1[];
  /** 手持ちの総ゆめのかけら（上限チェック用） */
  totalShards: number;
  /** 睡眠育成設定（アプリ全体で共通） */
  sleepSettings?: SleepSettings;
};

export type BoxEntrySource = "nitoyon" | "manual";

/**
 * ポケモンボックスの1件。
 * - にとよん形式（PokemonIv.serialize() + optional @nickname）は rawText として“そのまま保持”する
 * - Planner側で必要な追加情報（あとEXPなど）は planner に保存する
 */
export type PokemonBoxEntryV1 = {
  id: string;
  source: BoxEntrySource;
  /** にとよんエクスポート1行（iv or iv@nickname）。manualの場合は空でもよい */
  rawText: string;
  /** 表示名（nickname or 手入力名など） */
  label: string;
  /** お気に入り（★） */
  favorite?: boolean;
  /** にとよんrawから最小限デコードできた情報（表示・初期値用） */
  derived?: {
    pokedexId: number;
    form: number;
    level: number;
    expType: ExpType;
    expGainNature: ExpGainNature;
    natureName: string;
  };
  /** Planner用の上書き保存（rawは変更しない） */
  planner?: {
    level?: number;
    expRemaining?: number; // ゲーム画面の「あとEXP（次Lvまで）」
    expType?: ExpType;
    expGainNature?: ExpGainNature;
    /** 手入力/上書き用：とくい（不明も許容） */
    specialty?: PokemonSpecialty;
    /** 手入力個体向け：食材タイプ（AAA/AAB...） */
    ingredientType?: IngredientType;
    /** 手入力個体向け：サブスキル（英名で保存。表示は変換する） */
    subSkills?: BoxSubSkillSlotV1[];
  };
  createdAt: string;
  updatedAt: string;
};

export type PokemonSpecialty = "Berries" | "Ingredients" | "Skills" | "All" | "unknown";
export type IngredientType = "AAA" | "AAB" | "AAC" | "ABA" | "ABB" | "ABC";
export type BoxSubSkillSlotV1 = {
  lv: 10 | 25 | 50 | 75 | 100;
  nameEn: string;
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

/**
 * 睡眠育成設定（アプリ全体で共通）
 */
export type SleepSettings = {
  /** 1日の睡眠時間（時間単位、デフォルト: 8.5） */
  dailySleepHours: number;
  /** 睡眠EXPボーナス持ちポケモン数（0-5） */
  sleepExpBonusCount: number;
  /** GSD考慮（デフォルト: true） */
  includeGSD: boolean;
};
