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
    /** 睡眠時間の累計（時間単位） */
    sleepHours?: number;
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
  lv: 10 | 25 | 50 | 70 | 80;
  nameEn: string;
};

export type ExpType = 600 | 900 | 1080 | 1320;

/** アメブ種別（通常アメ/ミニブ/アメブ） */
export type BoostEvent = "none" | "mini" | "full";

/** 性格による「経験値獲得量」補正（nitoyon式のCandy EXP計算に合わせる） */
export type ExpGainNature = "down" | "normal" | "up";

export type GrowthIncenseGsdDays = {
  beforeFullMoon: boolean;
  fullMoon: boolean;
  afterFullMoon: boolean;
};
export type GrowthIncenseNormalPerWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * あおいタネ区間で併用する成長のお香の日数。`"auto"` は週の割当へ任せる（既定）。
 *
 * 範囲がたまたま `GrowthIncenseNormalPerWeek` と同じでも**借りないこと**。
 * あちらは「1週間に何個使うか」、こちらは「区間の先頭から何日使うか」で意味が違い、
 * 片方の上限を変えたときにもう片方まで動く。
 */
export type BlueSeedIncenseDays = "auto" | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** 手持ちの成長のお香の個数。`null` は無制限（未記入）。 */
export type GrowthIncenseStock = number | null;
/** 手持ちの成長のお香として入力できる上限。 */
export const MAX_GROWTH_INCENSE_STOCK = 999;

/** 睡眠目標時間ドロップダウンの選択肢（アチーブメント区切り。任意値は設けない）。 */
export const SLEEP_TARGET_HOURS_OPTIONS = [200, 500, 1000, 2000] as const;
/** 設定可能な1日の睡眠時間下限（1時間）。 */
export const MIN_DAILY_SLEEP_MINUTES = 60;

/**
 * 1晩に睡眠EXPを得られるポケモンの数。ゲーム内の睡眠チームの上限。
 * これを超える睡眠計画は**同時には実行できない**ので、画面で注意を出す。
 */
export const MAX_SLEEP_TEAM_SIZE = 5;
/** 最大睡眠目標を最小日次時間で進める場合の日数上限。 */
export const MAX_SLEEP_PLANNING_DAYS = Math.ceil(
  SLEEP_TARGET_HOURS_OPTIONS[SLEEP_TARGET_HOURS_OPTIONS.length - 1] * 60
  / MIN_DAILY_SLEEP_MINUTES,
);

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
  /** 現地AM4:00のゲーム内日付境界に使うIANAタイムゾーン。満月日付はJST基準。 */
  timeZone: string;
  /** GSDの1日目・満月日・3日目に成長のお香を使うか。 */
  growthIncenseGsdDays: GrowthIncenseGsdDays;
  /** 平常日に成長のお香を使う回数（ISO暦週ごと）。 */
  growthIncenseNormalPerWeek: GrowthIncenseNormalPerWeek;
  /**
   * 手持ちの成長のお香の個数。`null` は無制限（未記入）、`0` は1個も使えない。
   *
   * お香は行の持ち物ではなく夜の属性なので、行へ配らず**候補の夜を時系列に消費して
   * 打ち切る**だけにする（行ごとに配ると同じ夜を二重計上する）。
   */
  growthIncenseStock: GrowthIncenseStock;
  /** 手入力のイベント倍率区間。自動取得で拾えない実イベントを補う（周年の花は `growth-flower.ts` が生成する）。 */
  manualEventBonuses: ManualEventBonus[];
  /** 過去1年のイベントを将来へ写して計算へ入れるか（仮イベント）。 */
  useProjectedEvents: boolean;
  /** おいわいフラワーで「あおいタネ」を植える曜日。null は使わない。 */
  blueSeedPlantWeekday: BlueSeedPlantWeekday;
  /** あおいタネ区間で成長のお香を併用する日数。auto は週の割当規則に任せる。 */
  blueSeedIncenseDays: BlueSeedIncenseDays;
};

export type BlueSeedPlantWeekday = 1 | 2 | 3 | 4 | 5 | null;

/** 保存値の型が壊れていても、設定全体を無効にせず個別に既定値へ戻す。 */
export function normalizeUseProjectedEvents(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** `null` は「使わない」として有効。undefined は不正値を表す。 */
export function normalizeBlueSeedPlantWeekday(value: unknown): BlueSeedPlantWeekday | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5
    ? value as 1 | 2 | 3 | 4 | 5
    : undefined;
}

/** `"auto"` と 0〜7 の整数だけが有効。undefined は不正値を表す。 */
export function normalizeBlueSeedIncenseDays(value: unknown): BlueSeedIncenseDays | undefined {
  if (value === "auto") return "auto";
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 7
    ? value as BlueSeedIncenseDays
    : undefined;
}

export type ManualEventBonus = {
  /** 開始ゲーム日 (YYYY-MM-DD, 両端含む) */
  from: string;
  /** 終了ゲーム日 (YYYY-MM-DD, 両端含む) */
  to: string;
  /** 睡眠EXPにかかる倍率 */
  multiplier: number;
};
