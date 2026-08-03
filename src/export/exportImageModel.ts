/**
 * exportImageModel — 育成プラン画像に描画する情報を固定する純データモデル。
 *
 * このモジュールは Vue ref/computed・DOM・Canvas・global i18n・現在時刻を一切読まない。
 * `buildExportImageModel(source, presentation)` は現行 props と同型の source DTO と、
 * 呼び出し側で用意した locale / now / 翻訳関数だけからモデルを構築する。
 * 数値は Intl.NumberFormat(locale)、年月は Intl.DateTimeFormat(locale) でここで文字列化し、
 * renderer 側は翻訳・数値整形を一切行わない。
 */

// ── source DTO（ExportOverlay.vue の props と共有する型）──────────────

export type ExportImageRow = {
  id: string;
  title: string;
  natureLabel?: string;
  srcLevel: number;
  dstLevel: number;
  boostCandy: number;
  normalCandy: number;
  totalCandy: number;
  shards: number;
  /** アメ補填（画像の育成リストには専用列を作らない。CSV とランキングで維持する） */
  candySupply?: string;
};

export type ExportImageTotals = {
  boostCandy: number;
  normalCandy: number;
  totalCandy: number;
  shards: number;
};

export type ExportImageRankingItem = {
  id: string;
  pokemonName: string;
  universalValue: number;
  usagePct: number;
  uniSUsed: number;
  uniMUsed: number;
  uniLUsed: number;
  typeSUsed: number;
  typeMUsed: number;
};

export type ExportImageBoostKind = "full" | "mini" | "none";

/** buildExportImageModel が必要とする現行 props 相当の source。 */
export type ExportImageSource = {
  rows: ExportImageRow[];
  totals: ExportImageTotals;

  boostUnused: number;
  shardsUsed: number;
  shardsCap: number;

  boostUsagePct: number;
  boostCap: number;
  boostFillPct: number;

  shardsUsagePct: number;
  shardsFillPct: number;

  universalCandyRanking: ExportImageRankingItem[];
  universalCandyUsedTotal: { s: number; m: number; l: number };

  boostKind: ExportImageBoostKind;

  /**
   * アメ在庫が1つでも設定されているか。「在庫を設定してください」の表示条件。
   * 実使用アメが 0 かどうかで判定してはいけない（元Lv＝目標Lvの行や、
   * 睡眠だけで目標に届く行は在庫があっても 0 になる）。
   */
  hasCandyStock: boolean;
};

/** 翻訳関数（vue-i18n の t 相当）。params は数値・文字列の穴埋め。 */
export type ExportImageTranslate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

export type ExportImagePresentation = {
  locale: string;
  /** 操作開始時に 1 度だけ取得した時刻。月表示・filename とここで共有する。 */
  now: Date;
  t: ExportImageTranslate;
};

// ── ExportImageModel ─────────────────────────────────────────────────

export type ExportStatCardVariant = "accent" | "primary" | "danger" | "plain";

export type ExportStatCard = {
  key: "boost" | "unused" | "normal" | "shards";
  label: string;
  value: string;
  variant: ExportStatCardVariant;
};

export type ExportBar = {
  key: "boost" | "shards";
  usageLabel: string;
  capLabel: string;
  /** 0..100 に丸めた塗り幅（% の生値ではなく描画用の割合） */
  fillPct: number;
};

export type ExportColumn = {
  key: "name" | "lv" | "boost" | "normal" | "total" | "shards";
  label: string;
  align: "left" | "center" | "right";
};

export type ExportModelRow = {
  id: string;
  name: string;
  natureLabel?: string;
  srcLevel: string;
  dstLevel: string;
  boostCandy?: string;
  normalCandy?: string;
  totalCandy: string;
  shards: string;
};

export type ExportModelTotalRow = {
  boostCandy?: string;
  normalCandy?: string;
  totalCandy: string;
  shards: string;
};

export type ExportPieSlice = {
  id: string;
  name: string;
  /** 表示 %（Math.round。合計が必ず 100 になる補正はしない） */
  displayPct: number;
  startAngle: number;
  endAngle: number;
  colorIndex: number;
  /** 万能アメ内訳（例: "万能 S475 / M3"）。無ければ undefined */
  universalDetail?: string;
  /** タイプアメ内訳（例: "タイプ M3"）。無ければ undefined */
  typeDetail?: string;
};

export type ExportPie = {
  title: string;
  totalLabels: string[];
  slices: ExportPieSlice[];
};

export type ExportImageModel = {
  brandLabel: string;
  monthLabel: string;
  sectionLabels: { resources: string; list: string; ranking: string };
  noStockWarning?: string;
  statCards: ExportStatCard[];
  bars: ExportBar[];
  columns: ExportColumn[];
  rows: ExportModelRow[];
  totalRow: ExportModelTotalRow;
  pie?: ExportPie;
};

const TAU = Math.PI * 2;

function buildStatCards(
  source: ExportImageSource,
  isBoostMode: boolean,
  fmt: (n: number) => string,
  t: ExportImageTranslate,
): ExportStatCard[] {
  const cards: ExportStatCard[] = [];

  if (isBoostMode) {
    cards.push({
      key: "boost",
      label: t("calc.export.sumBoostTotal"),
      value: fmt(source.totals.boostCandy),
      variant: "accent",
    });
    if (source.boostUnused > 0) {
      cards.push({
        key: "unused",
        label: t("calc.export.sumBoostUnused"),
        value: fmt(source.boostUnused),
        variant: "danger",
      });
    }
  }

  cards.push({
    key: "normal",
    label: t("calc.export.sumNormalTotal"),
    value: fmt(source.totals.normalCandy),
    variant: "plain",
  });

  cards.push({
    key: "shards",
    label: t("calc.export.sumShardsTotal"),
    value: fmt(source.shardsUsed),
    variant: "primary",
  });

  return cards;
}

function buildBars(
  source: ExportImageSource,
  isBoostMode: boolean,
  fmt: (n: number) => string,
  t: ExportImageTranslate,
): ExportBar[] {
  const bars: ExportBar[] = [];

  if (isBoostMode) {
    bars.push({
      key: "boost",
      usageLabel: t("calc.boostCandyUsage", { pct: source.boostUsagePct }),
      capLabel: t("calc.cap", { cap: fmt(source.boostCap) }),
      fillPct: clampPct(source.boostFillPct),
    });
  }

  const shardsHasCap = source.shardsCap > 0;
  bars.push({
    key: "shards",
    usageLabel: shardsHasCap
      ? t("calc.shardsUsage", { pct: source.shardsUsagePct })
      : t("calc.shardsUsageDash"),
    capLabel: shardsHasCap
      ? t("calc.cap", { cap: fmt(source.shardsCap) })
      : t("calc.capUnset"),
    fillPct: clampPct(source.shardsFillPct),
  });

  return bars;
}

function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

function buildColumns(isBoostMode: boolean, t: ExportImageTranslate): ExportColumn[] {
  const cols: ExportColumn[] = [
    { key: "name", label: t("calc.export.colPokemon"), align: "left" },
    { key: "lv", label: t("calc.export.colLv"), align: "center" },
  ];
  if (isBoostMode) {
    cols.push({ key: "boost", label: t("calc.export.colBoost"), align: "right" });
    cols.push({ key: "normal", label: t("calc.export.colNormal"), align: "right" });
  }
  cols.push({ key: "total", label: t("calc.export.colTotal"), align: "right" });
  cols.push({ key: "shards", label: t("calc.export.colShards"), align: "right" });
  return cols;
}

function buildRows(
  source: ExportImageSource,
  isBoostMode: boolean,
  fmt: (n: number) => string,
): ExportModelRow[] {
  return source.rows.map((r) => ({
    id: r.id,
    name: r.title,
    natureLabel: r.natureLabel,
    srcLevel: String(r.srcLevel),
    dstLevel: String(r.dstLevel),
    boostCandy: isBoostMode ? fmt(r.boostCandy) : undefined,
    normalCandy: isBoostMode ? fmt(r.normalCandy) : undefined,
    totalCandy: fmt(r.totalCandy),
    shards: fmt(r.shards),
  }));
}

function buildTotalRow(
  source: ExportImageSource,
  isBoostMode: boolean,
  fmt: (n: number) => string,
): ExportModelTotalRow {
  return {
    boostCandy: isBoostMode ? fmt(source.totals.boostCandy) : undefined,
    normalCandy: isBoostMode ? fmt(source.totals.normalCandy) : undefined,
    totalCandy: fmt(source.totals.totalCandy),
    shards: fmt(source.totals.shards),
  };
}

/** 万能/タイプ内訳の生数値文字列（現行 legend と同じく locale 整形しない） */
function joinDetail(
  prefix: string,
  entries: Array<[letter: string, value: number]>,
): string | undefined {
  const parts: string[] = [];
  for (const [letter, value] of entries) {
    if (value > 0) parts.push(`${letter}${value}`);
  }
  if (parts.length === 0) return undefined;
  return `${prefix} ${parts.join(" / ")}`;
}

function buildPie(
  source: ExportImageSource,
  fmt: (n: number) => string,
  t: ExportImageTranslate,
): ExportPie | undefined {
  const items = source.universalCandyRanking;
  if (items.length === 0) return undefined;

  const total = items.reduce((s, i) => s + i.universalValue, 0);
  if (total <= 0) return undefined;

  const uniLabel = t("calc.export.labelUni");
  const typeLabel = t("calc.export.labelType");

  const toSlice = (
    item: ExportImageRankingItem,
    displayPct: number,
    startAngle: number,
    endAngle: number,
    colorIndex: number,
  ): ExportPieSlice => ({
    id: item.id,
    name: item.pokemonName,
    displayPct,
    startAngle,
    endAngle,
    colorIndex,
    universalDetail: joinDetail(uniLabel, [
      ["S", item.uniSUsed],
      ["M", item.uniMUsed],
      ["L", item.uniLUsed],
    ]),
    typeDetail: joinDetail(typeLabel, [
      ["S", item.typeSUsed],
      ["M", item.typeMUsed],
    ]),
  });

  let slices: ExportPieSlice[];
  if (items.length === 1) {
    slices = [toSlice(items[0], 100, 0, TAU, 0)];
  } else {
    slices = [];
    let angle = 0;
    const last = items.length - 1;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const fraction = it.universalValue / total;
      const startAngle = angle;
      const endAngle = i === last ? TAU : angle + fraction * TAU;
      slices.push(toSlice(it, Math.round(fraction * 100), startAngle, endAngle, i % 8));
      angle = endAngle;
    }
  }

  const totalLabels: string[] = [];
  const used = source.universalCandyUsedTotal;
  if (used.s > 0) totalLabels.push(`${t("calc.export.totalUniversalS")} ${fmt(used.s)}`);
  if (used.m > 0) totalLabels.push(`${t("calc.export.totalUniversalM")} ${fmt(used.m)}`);
  if (used.l > 0) totalLabels.push(`${t("calc.export.totalUniversalL")} ${fmt(used.l)}`);

  return {
    title: t("calc.export.rankingTotal"),
    totalLabels,
    slices,
  };
}

function buildBrandLabel(kind: ExportImageBoostKind, t: ExportImageTranslate): string {
  if (kind === "full") return t("calc.export.brandBoost");
  if (kind === "mini") return t("calc.export.brandMini");
  return t("calc.export.brand");
}

export function buildExportImageModel(
  source: ExportImageSource,
  presentation: ExportImagePresentation,
): ExportImageModel {
  const { locale, now, t } = presentation;
  const numberFormat = new Intl.NumberFormat(locale);
  const fmt = (n: number): string => numberFormat.format(n);
  const isBoostMode = source.boostKind !== "none";

  const monthLabel = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
  }).format(now);

  return {
    brandLabel: buildBrandLabel(source.boostKind, t),
    monthLabel,
    sectionLabels: {
      resources: t("calc.export.sectionResources"),
      list: t("calc.export.sectionList"),
      ranking: t("calc.export.universalRankingTitle"),
    },
    noStockWarning: source.hasCandyStock ? undefined : t("calc.export.noStockWarning"),
    statCards: buildStatCards(source, isBoostMode, fmt, t),
    bars: buildBars(source, isBoostMode, fmt, t),
    columns: buildColumns(isBoostMode, t),
    rows: buildRows(source, isBoostMode, fmt),
    totalRow: buildTotalRow(source, isBoostMode, fmt),
    pie: buildPie(source, fmt, t),
  };
}
