<template>
  <div class="exportOverlay" data-testid="export-overlay" @click.self="emit('close')" role="dialog" :aria-label="t('calc.export.open')">
    <div class="exportSheetWrap" @click.self="emit('close')">
      <div
        ref="exportSheetEl"
        class="exportSheet"
        data-testid="export-sheet"
        :style="{ transform: `scale(${scale})` }"
        @click="exportCsvMenuOpen = false"
      >
        <div class="exportHead">
          <div class="exportHead__top">
            <div class="exportBrand" data-testid="brandLabel"><span class="exportBrand__icon">🍬 </span>{{ boostKind === 'full' ? t("calc.export.brandBoost") : boostKind === 'mini' ? t("calc.export.brandMini") : t("calc.export.brand") }}</div>
          </div>

          <div class="exportMeta">
            <div class="exportMonth" aria-label="month" data-testid="monthLabel">{{ exportMonthLabel }}</div>

            <div class="exportActions" @click.stop>
              <button class="linkBtn" type="button" @click="downloadCalcExportPng" :disabled="exportBusy" data-testid="saveImageButton">
                {{ t("calc.export.saveImage") }}
              </button>
              <div class="exportCsvMenuTrigger">
                <button
                  class="linkBtn"
                  type="button"
                  @click.stop="exportCsvMenuOpen = !exportCsvMenuOpen"
                  :disabled="exportBusy"
                  :aria-expanded="exportCsvMenuOpen"
                  aria-haspopup="menu"
                  data-testid="csvMenuButton"
                >
                  {{ t("calc.export.csv") }} ▾
                </button>
                <div v-if="exportCsvMenuOpen" class="exportCsvMenu" data-testid="export-csv-menu" role="menu" :aria-label="t('calc.export.csv')">
                  <button class="exportCsvMenu__item" type="button" @click="downloadCalcExportCsv" :disabled="exportBusy" data-testid="csvDownloadButton">
                    {{ t("calc.export.csvDownload") }}
                  </button>
                  <button class="exportCsvMenu__item" type="button" @click="copyCalcExportCsv" :disabled="exportBusy" data-testid="csvCopyButton">
                    {{ t("calc.export.csvCopy") }}
                  </button>
                </div>
              </div>
              <button class="linkBtn linkBtn--basic" type="button" @click="emit('close')" :disabled="exportBusy" data-testid="closeButton">{{ t("calc.export.close") }}</button>
            </div>
          </div>
        </div>

        <div v-if="exportStatus" class="exportStatus" data-testid="export-status" role="status">{{ exportStatus }}</div>

        <div class="exportCalc">
          <div class="exportSectionTitle">{{ t("calc.export.sectionResources") }}</div>
          <button v-if="showNoStockWarning" type="button" class="exportNoStock" @click="emit('open-settings')">{{ t("calc.export.noStockWarning") }}</button>
          <div class="exportCalcTop">
            <div class="exportStats" :class="{ 'exportStats--normal': !isBoostMode }">
              <div
                v-for="card in statCards"
                :key="card.key"
                class="statCard"
                :class="{
                  [`statCard--${card.variant}`]: card.variant,
                  'statCard--danger': card.variant === 'danger',
                  'statCard--wide': card.key === 'shards',
                }"
                data-testid="statCard"
              >
                <div class="statCard__label">{{ card.label }}</div>
                <div class="statCard__value" :class="{ 'statCard__value--danger': card.isDanger }">
                  {{ fmtNum(card.value) }}
                </div>
              </div>
            </div>

            <div class="exportBars" :class="{ 'exportBars--muted': shardsCap <= 0 }">
              <div v-if="isBoostMode" class="exportBarBlock">
                <div class="exportBarHead">
                  <div class="exportBarK">
                    {{ t("calc.boostCandyUsage", { pct: boostUsagePct }) }}
                  </div>
                  <div class="exportBarK exportBarK--right">{{ t("calc.cap", { cap: fmtNum(boostCap) }) }}</div>
                </div>
                <div
                  class="exportBar"
                  role="progressbar"
                  :aria-valuenow="Math.max(0, boostUsed)"
                  aria-valuemin="0"
                  :aria-valuemax="Math.max(1, boostCap)"
                  :aria-label="t('calc.boostCandyUsageAria', { pct: boostUsagePct, cap: fmtNum(boostCap) })"
                  data-testid="boostBar"
                >
                  <div class="exportBar__track">
                    <div class="exportBar__fill" :style="{ width: `${boostFillPct}%` }"></div>
                  </div>
                </div>
              </div>

              <div class="exportBarBlock">
                <div class="exportBarHead">
                  <div class="exportBarK">
                    {{ shardsCap > 0 ? t("calc.shardsUsage", { pct: shardsUsagePct }) : t("calc.shardsUsageDash") }}
                  </div>
                  <div class="exportBarK exportBarK--right">
                    {{ shardsCap > 0 ? t("calc.cap", { cap: fmtNum(shardsCap) }) : t("calc.capUnset") }}
                  </div>
                </div>
                <div
                  class="exportBar"
                  role="progressbar"
                  :aria-valuenow="Math.max(0, shardsUsed)"
                  aria-valuemin="0"
                  :aria-valuemax="Math.max(1, shardsCap)"
                  :aria-label="
                    shardsCap > 0
                      ? t('calc.shardsUsageAria', { pct: shardsUsagePct, cap: fmtNum(shardsCap) })
                      : t('calc.shardsCapUnsetAria')
                  "
                  data-testid="shardsBar"
                >
                  <div class="exportBar__track">
                    <div class="exportBar__fill" :style="{ width: `${shardsFillPct}%` }"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="exportSectionTitle">{{ t("calc.export.sectionList") }}</div>
          <div class="exportList" :class="{ 'exportList--normal': !isBoostMode }">
            <div class="exportList__head" data-testid="listHead">
              <div class="exportList__col">{{ t("calc.export.colPokemon") }}</div>
              <div class="exportList__col exportList__lvHead">{{ t("calc.export.colLv") }}</div>
              <div v-if="isBoostMode" class="exportList__col u-align-right">{{ t("calc.export.colBoost") }}</div>
              <div v-if="isBoostMode" class="exportList__col u-align-right">{{ t("calc.export.colNormal") }}</div>
              <div class="exportList__col u-align-right">{{ t("calc.export.colTotal") }}</div>
              <div class="exportList__col u-align-right">{{ t("calc.export.colShards") }}</div>
            </div>

            <div v-for="row in rows" :key="row.id" class="exportList__row" data-testid="listRow">
              <div class="exportList__col exportList__nameCol">
                <span class="exportList__lvInline">Lv{{ row.srcLevel }}→{{ row.dstLevel }}</span>
                <span class="exportList__name">{{ row.title }}</span>
                <span v-if="row.natureLabel" class="exportList__badge">{{ row.natureLabel }}</span>
              </div>
              <div class="exportList__col u-align-center exportList__lvCol">
                <div class="exportList__lvWrap">
                  <span class="exportList__lvVal">{{ row.srcLevel }}</span>
                  <span class="exportList__arrow">→</span>
                  <span class="exportList__lvVal">{{ row.dstLevel }}</span>
                </div>
              </div>
              <div v-if="isBoostMode" class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colBoost") }}</span>
                <span class="exportList__num">{{ fmtNum(row.boostCandy) }}</span>
              </div>
              <div v-if="isBoostMode" class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colNormal") }}</span>
                <span class="exportList__num">{{ fmtNum(row.normalCandy) }}</span>
              </div>
              <div class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colTotal") }}</span>
                <span class="exportList__num">{{ fmtNum(row.totalCandy) }}</span>
              </div>
              <div class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colShards") }}</span>
                <span class="exportList__num">{{ fmtNum(row.shards) }}</span>
              </div>
            </div>

            <div class="exportList__row exportList__row--total" aria-label="total" data-testid="totalRow">
              <div class="exportList__col exportList__nameCol">
                <span class="exportList__name" aria-hidden="true"></span>
              </div>
              <div class="exportList__col u-align-center exportList__lvCol"></div>
              <div v-if="isBoostMode" class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colBoost") }}</span>
                <span class="exportList__num">{{ fmtNum(totals.boostCandy) }}</span>
              </div>
              <div v-if="isBoostMode" class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colNormal") }}</span>
                <span class="exportList__num">{{ fmtNum(totals.normalCandy) }}</span>
              </div>
              <div class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colTotal") }}</span>
                <span class="exportList__num">{{ fmtNum(totals.totalCandy) }}</span>
              </div>
              <div class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colShards") }}</span>
                <span class="exportList__num">{{ fmtNum(totals.shards) }}</span>
              </div>
            </div>
          </div>

          <!-- 万能アメ使用割合（円グラフ） -->
          <div v-if="pieSlices.length > 0" class="exportSectionTitle" data-testid="export-ranking-title">{{ t("calc.export.universalRankingTitle") }}</div>
          <div v-if="pieSlices.length > 0" class="exportRanking" data-testid="rankingSection">
            <div class="exportRanking__total" data-testid="export-ranking-total">
              <span>{{ t("calc.export.rankingTotal") }}</span>
              <span v-if="universalCandyUsedTotal.s > 0">{{ t("calc.export.totalUniversalS") }} {{ fmtNum(universalCandyUsedTotal.s) }}</span>
              <span v-if="universalCandyUsedTotal.m > 0">{{ t("calc.export.totalUniversalM") }} {{ fmtNum(universalCandyUsedTotal.m) }}</span>
              <span v-if="universalCandyUsedTotal.l > 0">{{ t("calc.export.totalUniversalL") }} {{ fmtNum(universalCandyUsedTotal.l) }}</span>
            </div>

            <div class="exportPie">
              <!-- SVG Pie Chart -->
              <svg class="exportPie__svg" viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg">
                <path
                  v-for="slice in pieSlices"
                  :key="slice.id"
                  :d="slice.path"
                  :fill="slice.fillColor"
                  :stroke="slice.strokeColor"
                  stroke-width="1"
                  :class="`exportPie__slice exportPie__slice--${slice.colorIdx}`"
                />
              </svg>

              <!-- Legend -->
              <div :class="['exportPie__legend', pieSlices.length >= 3 && 'exportPie__legend--compact']">
                <div v-for="slice in pieSlices" :key="slice.id" class="exportPie__legendItem" data-testid="rankingItem">
                  <span :class="`exportPie__swatch exportPie__swatch--${slice.colorIdx}`" :style="{ background: slice.fillColor }"></span>
                  <span class="exportPie__legendName">{{ slice.pokemonName }}</span>
                  <span class="exportPie__legendPct">{{ slice.pct }}%</span>
                  <span class="exportPie__legendDetail">
                    <span v-if="slice.uniSUsed > 0 || slice.uniMUsed > 0 || slice.uniLUsed > 0" class="exportRanking__itemGroup">
                      <span class="exportRanking__itemLabel">{{ t("calc.export.labelUni") }}</span>
                      <span v-if="slice.uniSUsed > 0">S{{ slice.uniSUsed }}</span>
                      <span v-if="slice.uniSUsed > 0 && (slice.uniMUsed > 0 || slice.uniLUsed > 0)"> / </span>
                      <span v-if="slice.uniMUsed > 0">M{{ slice.uniMUsed }}</span>
                      <span v-if="slice.uniMUsed > 0 && slice.uniLUsed > 0"> / </span>
                      <span v-if="slice.uniLUsed > 0">L{{ slice.uniLUsed }}</span>
                    </span>
                    <span v-if="slice.typeSUsed > 0 || slice.typeMUsed > 0" class="exportRanking__itemGroup">
                      <span class="exportRanking__itemLabel">{{ t("calc.export.labelType") }}</span>
                      <span v-if="slice.typeSUsed > 0">S{{ slice.typeSUsed }}</span>
                      <span v-if="slice.typeSUsed > 0 && slice.typeMUsed > 0"> / </span>
                      <span v-if="slice.typeMUsed > 0">M{{ slice.typeMUsed }}</span>
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import html2canvas from "html2canvas-pro";
import { useI18n } from "vue-i18n";

type ExportRow = {
  id: string;
  title: string;
  natureLabel?: string;
  srcLevel: number;
  dstLevel: number;
  boostCandy: number;
  normalCandy: number;
  totalCandy: number;
  shards: number;
  candySupply?: string; // アメ補填
};

type ExportTotals = {
  boostCandy: number;
  normalCandy: number;
  totalCandy: number;
  shards: number;
};

const props = defineProps<{
  scale: number;
  rows: ExportRow[];
  totals: ExportTotals;

  boostUsed: number;
  boostUnused: number;
  shardsUsed: number;

  shardsCap: number;

  boostUsagePct: number;
  boostCap: number;
  boostFillPct: number;

  shardsUsagePct: number;
  shardsFillPct: number;

  universalCandyRanking: Array<{
    id: string;
    pokemonName: string;
    universalValue: number;
    usagePct: number;
    uniSUsed: number;
    uniMUsed: number;
    uniLUsed: number;
    typeSUsed: number;
    typeMUsed: number;
  }>;
  universalCandyUsedTotal: { s: number; m: number; l: number };
  boostKind: "full" | "mini" | "none";
}>();

const emit = defineEmits<{ close: []; "open-settings": [] }>();
const { t, locale } = useI18n();

const exportSheetEl = ref<HTMLElement | null>(null);
const exportBusy = ref(false);
const exportStatus = ref("");
const exportCsvMenuOpen = ref(false);

function fmtNum(n: number): string {
  return new Intl.NumberFormat(locale.value).format(n);
}

const isBoostMode = computed(() => props.boostKind !== "none");

/** 在庫未設定警告: 実使用のアメ・かけらが両方0 */
const showNoStockWarning = computed(() => {
  const t = props.totals;
  return t.boostCandy + t.normalCandy === 0 && t.shards === 0;
});

type StatCardDef = {
  key: string;
  icon: string;
  label: string;
  value: number;
  variant?: "accent" | "primary" | "danger";
  isDanger?: boolean;
  show: boolean;
};

const statCards = computed<StatCardDef[]>(() => {
  const cards: StatCardDef[] = [];

  if (isBoostMode.value) {
    cards.push({
      key: "boost",
      icon: "🍬",
      label: t("calc.export.sumBoostTotal"),
      value: props.totals.boostCandy,
      variant: "accent",
      isDanger: false,
      show: true,
    });

    if (props.boostUnused > 0) {
      cards.push({
        key: "unused",
        icon: "⚠️",
        label: t("calc.export.sumBoostUnused"),
        value: props.boostUnused,
        variant: "danger",
        isDanger: props.boostUnused >= 1,
        show: true,
      });
    }
  }

  cards.push({
    key: "normal",
    icon: "⚪",
    label: t("calc.export.sumNormalTotal"),
    value: props.totals.normalCandy,
    show: true,
  });

  cards.push({
    key: "shards",
    icon: "💎",
    label: t("calc.export.sumShardsTotal"),
    value: props.shardsUsed,
    variant: "primary",
    show: true,
  });

  return cards;
});

const exportMonthLabel = computed(() => {
  return new Intl.DateTimeFormat(locale.value, { year: "numeric", month: "short" }).format(new Date());
});

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCalcExportCsv(): string {
  const isNormal = props.boostKind === "none";

  // 列順：Pokemon, EXP補正, 現在Lv, 目標Lv, (Boost, Normal), Total, Shards
  const headCols = [
    t("calc.export.colPokemon"),
    t("calc.export.colExpAdj"),
    t("calc.row.srcLevel"),
    t("calc.row.dstLevel"),
    ...(isNormal ? [] : [t("calc.export.colBoost"), t("calc.export.colNormal")]),
    t("calc.export.colTotal"),
    t("calc.export.colShards"),
  ];
  const head = headCols.map(csvCell).join(",");

  const body = props.rows.map((r) => {
    const cols = [
      r.title,
      r.natureLabel || "",
      r.srcLevel,
      r.dstLevel,
      ...(isNormal ? [] : [r.boostCandy, r.normalCandy]),
      r.totalCandy,
      r.shards,
    ];
    return cols.map(csvCell).join(",");
  });

  const totalCols = [
    "",
    "",
    "",
    "",
    ...(isNormal ? [] : [props.totals.boostCandy, props.totals.normalCandy]),
    props.totals.totalCandy,
    props.totals.shards,
  ];
  const total = totalCols.map(csvCell).join(",");

  return [head, ...body, total].join("\r\n") + "\r\n";
}

function downloadCalcExportCsv() {
  exportCsvMenuOpen.value = false;
  exportStatus.value = "";
  try {
    const csv = buildCalcExportCsv();
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `CandyBoost-Planner_${ts}.csv`;
    // Excel on Windows often expects BOM for UTF-8 CSV.
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.download = filename;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
    exportStatus.value = t("status.csvDownloaded");
  } catch {
    exportStatus.value = t("status.csvDownloadFailed");
  }
}

async function copyCalcExportCsv() {
  exportCsvMenuOpen.value = false;
  exportStatus.value = "";
  const csv = buildCalcExportCsv();
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(csv);
      exportStatus.value = t("status.csvCopied");
      return;
    }
  } catch {
    // fall through to legacy copy
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = csv;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    exportStatus.value = ok ? t("status.csvCopied") : t("status.csvCopyFailed");
  } catch {
    exportStatus.value = t("status.csvCopyFailed");
  }
}

// ── Pie chart for universal candy ranking ──
const PIE_R = 80;
const PIE_CX = 90;
const PIE_CY = 90;

type PieSlice = {
  id: string;
  pokemonName: string;
  pct: number;
  path: string;
  colorIdx: number;
  fillColor: string;
  strokeColor: string;
  uniSUsed: number;
  uniMUsed: number;
  uniLUsed: number;
  typeSUsed: number;
  typeMUsed: number;
};

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  // Angles in radians, 0 = 12 o'clock, clockwise
  const s = startAngle - Math.PI / 2;
  const e = endAngle - Math.PI / 2;
  const x1 = cx + r * Math.cos(s);
  const y1 = cy + r * Math.sin(s);
  const x2 = cx + r * Math.cos(e);
  const y2 = cy + r * Math.sin(e);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} Z`;
}

/** Resolve --pie-N and --paper CSS custom properties from the current theme */
function resolvePieColors(): { fills: string[]; stroke: string } {
  const el = exportSheetEl.value ?? document.documentElement;
  const cs = getComputedStyle(el);
  const fills: string[] = [];
  for (let i = 0; i < 8; i++) {
    fills.push(cs.getPropertyValue(`--pie-${i}`).trim() || "#888");
  }
  const stroke = cs.getPropertyValue("--paper").trim() || "#ffffff";
  return { fills, stroke };
}

const pieSlices = computed<PieSlice[]>(() => {
  const items = props.universalCandyRanking;
  if (items.length === 0) return [];

  const total = items.reduce((s, i) => s + i.universalValue, 0);
  if (total <= 0) return [];

  const { fills: pieColors, stroke: pieStroke } = resolvePieColors();

  // Single item → full circle
  if (items.length === 1) {
    const it = items[0];
    return [{
      id: it.id,
      pokemonName: it.pokemonName,
      pct: 100,
      // Full circle: two semicircles to avoid SVG arc rendering issues
      path: `M${PIE_CX},${PIE_CY - PIE_R} A${PIE_R},${PIE_R} 0 1 1 ${PIE_CX},${PIE_CY + PIE_R} A${PIE_R},${PIE_R} 0 1 1 ${PIE_CX},${PIE_CY - PIE_R} Z`,
      colorIdx: 0,
      fillColor: pieColors[0],
      strokeColor: pieStroke,
      uniSUsed: it.uniSUsed, uniMUsed: it.uniMUsed, uniLUsed: it.uniLUsed,
      typeSUsed: it.typeSUsed, typeMUsed: it.typeMUsed,
    }];
  }

  const slices: PieSlice[] = [];
  let angle = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const pct = it.universalValue / total;
    const sweep = pct * Math.PI * 2;
    const idx = i % 8;
    slices.push({
      id: it.id,
      pokemonName: it.pokemonName,
      pct: Math.round(pct * 100),
      path: describeArc(PIE_CX, PIE_CY, PIE_R, angle, angle + sweep),
      colorIdx: idx,
      fillColor: pieColors[idx],
      strokeColor: pieStroke,
      uniSUsed: it.uniSUsed, uniMUsed: it.uniMUsed, uniLUsed: it.uniLUsed,
      typeSUsed: it.typeSUsed, typeMUsed: it.typeMUsed,
    });
    angle += sweep;
  }
  return slices;
});

/**
 * html2canvas をタイムアウト付きで実行する。
 * 古い iOS Safari では html2canvas が resolve も reject もせずハングすることが
 * あるため、指定時間で reject して exportBusy を確実に解除する。
 */
function html2canvasWithTimeout(
  el: HTMLElement,
  opts: Parameters<typeof html2canvas>[1],
  timeoutMs: number,
): Promise<HTMLCanvasElement> {
  return new Promise<HTMLCanvasElement>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("html2canvas timeout")), timeoutMs);
    html2canvas(el, opts).then(
      (canvas) => { clearTimeout(timer); resolve(canvas); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * キャプチャした canvas が CSS 適用済みの有効な画像かどうかを判定する。
 * CSS 未適用のテキスト画像は背景色（白）がほぼ全面を占めるため、
 * サンプリングで非白ピクセルの比率が極端に低ければ無効と判断する。
 */
function looksLikeValidCapture(canvas: HTMLCanvasElement, bgHex: string): boolean {
  try {
    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return false;

    const ctx = canvas.getContext("2d");
    if (!ctx) return true; // 取得できなければ検証スキップ

    // 正常な画像には CSS 由来の色付きピクセル（アクセントカラー、プログレスバー、
    // 円グラフ等）が含まれる。CSS 未適用の画像は黒テキスト＋白背景のみで
    // 彩度のあるピクセルがほぼゼロになる。
    //
    // 判定方法:
    // 1. 彩度検出 — R,G,B の max-min 差が閾値以上なら「色付き」
    // 2. テーマ背景色検出 — テーマの --paper 色に近いピクセルの存在
    //    CSS 未適用画像は backgroundColor (#ffffff 固定) のまま描画されるが、
    //    正常画像はテーマの paper 色で描画される。paper が白でないテーマ
    //    (booklet: #fdf6ed 等) では paper 色ピクセルの存在が CSS 適用の証拠になる。

    // bgHex から背景色 RGB を抽出
    const bgR = parseInt(bgHex.slice(1, 3), 16);
    const bgG = parseInt(bgHex.slice(3, 5), 16);
    const bgB = parseInt(bgHex.slice(5, 7), 16);
    // paper 色が白でないテーマかどうか判定（白: #ffffff との差が10以上）
    const paperIsNonWhite = Math.abs(bgR - 255) + Math.abs(bgG - 255) + Math.abs(bgB - 255) > 10;

    // サンプリング領域: 上部 (y=5%付近) と中央
    const sampleW = Math.min(200, w);
    const sampleH = Math.min(200, h);
    const regions = [
      { x: Math.floor((w - sampleW) / 2), y: Math.floor(h * 0.05) },  // 上部
      { x: Math.floor((w - sampleW) / 2), y: Math.floor((h - sampleH) / 2) },  // 中央
    ];

    let totalPixels = 0;
    let chromatic = 0; // 彩度のあるピクセル（黒/白/灰色でないもの）
    let paperLike = 0; // テーマ背景色に近いピクセル

    for (const { x, y } of regions) {
      const sx = Math.max(0, Math.min(x, w - sampleW));
      const sy = Math.max(0, Math.min(y, h - sampleH));
      const data = ctx.getImageData(sx, sy, sampleW, sampleH).data;
      const count = sampleW * sampleH;
      totalPixels += count;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        // 彩度判定: R,G,B の最大値と最小値の差が閾値以上なら「色付き」
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        if (maxC - minC > 20) {
          chromatic++;
        }
        // テーマ背景色判定: paper 色と各チャンネルの差が5以内
        if (paperIsNonWhite &&
            Math.abs(r - bgR) <= 5 && Math.abs(g - bgG) <= 5 && Math.abs(b - bgB) <= 5) {
          paperLike++;
        }
      }
    }

    // 判定: 以下のいずれかを満たせば有効
    // 1. 彩度のあるピクセルが 0.5% 以上（アクセント色・バー・グラフ等が描画されている）
    // 2. テーマ背景色（非白）のピクセルが 10% 以上（CSS で背景色が適用されている）
    if (chromatic / totalPixels >= 0.005) return true;
    if (paperIsNonWhite && paperLike / totalPixels >= 0.10) return true;

    return false;
  } catch {
    return true; // セキュリティ制限等で getImageData に失敗した場合は検証スキップ
  }
}

/**
 * iOS Safari の Canvas ピクセル上限に収まる scale を計算する。
 * iOS 15 以下: 16,777,216 px (16 MP)
 * 安全マージン 5% を取って 16,000,000 px を上限とする。
 */
function clampScaleForCanvas(w: number, h: number, idealScale: number): number {
  const MAX_CANVAS_PIXELS = 16_000_000; // iOS 15 Safari の安全上限
  const pixels = w * idealScale * h * idealScale;
  if (pixels <= MAX_CANVAS_PIXELS) return idealScale;
  const maxScale = Math.sqrt(MAX_CANVAS_PIXELS / (w * h));
  // 最低 1 は確保する
  return Math.max(1, Math.floor(maxScale * 100) / 100);
}

/**
 * iOS 15 Safari で DOM 移動後にレイアウトが壊れる問題に対処する。
 * overflow / display / -webkit-overflow-scrolling を切り替えて強制リフローを起こす。
 */
async function forceIOSReflow(overlay: HTMLElement | null) {
  if (!overlay) return;
  overlay.style.overflow = "hidden";
  void overlay.offsetHeight;
  overlay.style.overflow = "";
  void overlay.offsetHeight;
  overlay.style.setProperty("-webkit-overflow-scrolling", "auto");
  void overlay.offsetHeight;
  overlay.style.setProperty("-webkit-overflow-scrolling", "touch");
  void overlay.offsetHeight;
  overlay.style.display = "none";
  void overlay.offsetHeight;
  overlay.style.display = "";
  void overlay.offsetHeight;
  await nextTick();
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
}

/**
 * html2canvas が残した iframe を強制クリーンアップする。
 * 通常は html2canvas 内部で削除されるが、iOS 15 Safari では
 * タイミングによって残留し、position:fixed な iframe が
 * タッチイベントをブロックする場合がある。
 */
function cleanupHtml2canvasIframes() {
  // 公式クラス付き iframe
  document.querySelectorAll("iframe.html2canvas-container").forEach((f) => {
    f.parentNode?.removeChild(f);
  });
  // クラスなしだが html2canvas の特徴（body 直下 + position:fixed + 極端な位置）を持つ iframe
  document.querySelectorAll<HTMLIFrameElement>("body > iframe").forEach((f) => {
    const s = f.style;
    if (s.position === "fixed" && (parseInt(s.left) < -1000 || parseInt(s.top) < -1000)) {
      f.parentNode?.removeChild(f);
    }
  });
}

async function downloadCalcExportPng() {
  const el = exportSheetEl.value;
  if (!el) return;
  exportBusy.value = true;
  exportStatus.value = "";
  exportCsvMenuOpen.value = false;

  // DOM 移動方式の復元用
  let captureWrapper: HTMLDivElement | null = null;
  const originalParent = el.parentElement;
  const originalNextSibling = el.nextSibling;
  let visualClone: HTMLElement | null = null; // 黒画面・レイアウト崩れ防止用

  // オーバーレイの復元用
  const overlay = el.closest(".exportOverlay") as HTMLElement | null;
  let savedScroll = 0;

  const ua = navigator.userAgent || "";
  const isLikelyIOS =
    /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  try {
    // Webフォントが読み込まれる前にキャプチャすると崩れるので待つ
    const fontsReady = document.fonts?.ready;
    if (fontsReady && typeof fontsReady.then === "function") await fontsReady;
    await nextTick();
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    // --- ダミークローン + DOM 移動方式（全環境共通） ---
    // html2canvas-pro は渡された要素の ownerDocument 全体を iframe にクローンする。
    // iOS 15 では overlay (position:fixed; overflow:auto) が祖先にあると
    // iframe 内で getBoundingClientRect() がクリップされた値を返し途切れる。
    // PC でも同じ方式を使い、ラッパーに元の幅を指定して正しいレイアウトを維持する。
    //
    // 1. el の見た目用クローンを元位置に残す（黒画面防止 + 親要素の高さ維持）
    // 2. el を body 直下のラッパーに一時移動してから html2canvas-pro に渡す
    // 3. 復帰時に replaceChild でクローンと実 DOM を入れ替え

    // 1. スクロール位置保存 & リセット
    savedScroll = overlay ? overlay.scrollTop : 0;
    if (overlay) overlay.scrollTop = 0;

     // 移動前に元の幅を取得し、最低 760px（デスクトップ幅）を保証する。
     // モバイルでもデスクトップレイアウトで画像保存するため。
     // el 自体の width は変更しない（iOS 15 のスタイル解決を壊すため）。
     // ラッパーの幅で制御し、CSS の .exportSheet--capture で子要素を
     // デスクトップレイアウトに切り替える。
     const DESKTOP_MIN_WIDTH = 760;
    const originalWidth = Math.max(el.offsetWidth, DESKTOP_MIN_WIDTH);

    // 2. ダミークローンを作成して元位置に配置
    //    - ユーザーにはクローンが見え続けるので黒画面にならない
    //    - 親要素 exportSheetWrap の高さが維持され、iOS 15 のスクロール境界バグを防止
    visualClone = el.cloneNode(true) as HTMLElement;
    visualClone.style.pointerEvents = "none"; // クローンは操作不可
    visualClone.setAttribute("aria-hidden", "true");
    if (originalParent) {
      if (originalNextSibling) {
        originalParent.insertBefore(visualClone, originalNextSibling);
      } else {
        originalParent.appendChild(visualClone);
      }
    }

    // 3. キャプチャ用クラスを付与
    el.classList.add("exportSheet--capture");

    await nextTick();

    // 4. el を body 直下のラッパーに移動
    //    ラッパーに最低 760px の幅を指定し、モバイルでもデスクトップレイアウトを維持する
    captureWrapper = document.createElement("div");
    captureWrapper.style.cssText =
      `position:fixed;left:-9999px;top:0;width:${originalWidth}px;overflow:visible;pointer-events:none;`;
    document.body.appendChild(captureWrapper);
    captureWrapper.appendChild(el);

    await nextTick();
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    // iOS Safari では DOM 移動直後にスタイル解決が完了していないことがある。
    // 追加の待機で iframe クローン時の CSS 適用を安定させる。
    await new Promise<void>((r) => setTimeout(r, 100));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    // 5. 移動後のサイズ取得（body 直下なのでクリッピングされない）
    const elWidth = el.scrollWidth;
    const elHeight = el.scrollHeight;

    // iOS Safari は Canvas サイズに上限がある (iOS 15: 16MP)。
    const scale = isLikelyIOS
      ? clampScaleForCanvas(elWidth, elHeight, 2)
      : 2;

    // テーマの --paper 色を canvas 背景に使用する。
    // CSS 未適用時（html2canvas の iframe 内でスタイル欠落）は白になるため、
    // looksLikeValidCapture でテーマ背景色の有無を CSS 適用の証拠として使える。
    const paperColor = getComputedStyle(el).getPropertyValue("--paper").trim() || "#ffffff";
    // CSS変数は "#fdf6ed" 等の hex か "rgb(...)" のどちらかで返る。
    // html2canvas の backgroundColor は hex/rgb 両対応なのでそのまま渡す。
    const bgHex = paperColor.startsWith("#") ? paperColor
      : (() => {
          const m = paperColor.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
          if (!m) return "#ffffff";
          return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
        })();

    const h2cOpts = {
      scale,
      backgroundColor: bgHex,
      useCORS: true,
      logging: false,
      width: elWidth,
      height: elHeight,
      windowWidth: elWidth,
      windowHeight: elHeight,
      scrollX: 0,
      scrollY: 0,
    };

    // html2canvas-pro は iOS Safari で稀に CSS 未適用のテキスト画像を生成する。
    // canvas のピクセルを検証し、色付きピクセルが不足（CSS 未適用の兆候）なら再試行する。
    let canvas: HTMLCanvasElement | null = null;
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // iframe 残骸が前回の試行から残っている場合に備えて掃除し、
      // iOS WebKit のスタイル解決を待つために十分な時間を確保する
      if (attempt > 1) {
        cleanupHtml2canvasIframes();
        await new Promise<void>((r) => setTimeout(r, 300));
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
      }
      canvas = await html2canvasWithTimeout(el, h2cOpts, 15000);
      if (looksLikeValidCapture(canvas, bgHex)) break;
      // 最終試行でも失敗した場合はそのまま使う（白画像でも保存は可能）
    }

    const dataUrl = canvas!.toDataURL("image/png");

    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `CandyBoost-Planner_${ts}.png`;

    if (isLikelyIOS && navigator.share) {
      try {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], filename, { type: "image/png" });
        const canShareFiles = typeof navigator.canShare !== "function" || navigator.canShare({ files: [file] });
        if (canShareFiles) {
          // Share API にタイムアウトを設ける。iOS 15 では resolve/reject
          // せずハングする場合がある。30秒でタイムアウトして先に進む。
          await Promise.race([
            navigator.share({ files: [file], title: t("app.title") }),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error("share timeout")), 30000)),
          ]);
          return;
        }
      } catch {
        // Share API 失敗・タイムアウト・ユーザーキャンセル → fallback
      }
      try {
        window.open(dataUrl, "_blank", "noopener,noreferrer");
        return;
      } catch {
        // fall through to download
      }
    }

    const a = document.createElement("a");
    a.download = filename;
    a.href = dataUrl;
    a.click();
  } catch (e) {
    exportStatus.value = `${t("status.exportFailed")} [${e instanceof Error ? e.message : "unknown"}]`;
  } finally {
    // --- DOM 復帰 ---
    el.classList.remove("exportSheet--capture");

    // クローンと実 DOM を replaceChild で入れ替え（insertBefore より確実）
    if (visualClone && visualClone.parentNode) {
      visualClone.parentNode.replaceChild(el, visualClone);
    } else if (originalParent) {
      // フォールバック: クローンが既に除去されていた場合
      if (originalNextSibling) {
        originalParent.insertBefore(el, originalNextSibling);
      } else {
        originalParent.appendChild(el);
      }
    }

    captureWrapper?.remove();

    // オーバーレイを復元
    if (overlay) {
      overlay.scrollTop = savedScroll;
    }

    exportBusy.value = false;

    // iframe 掃除（1回目 — reflow 前）
    cleanupHtml2canvasIframes();

    // 実 DOM 自身に display トグルで強制リフロー
    // iOS 15 WebKit でレイヤー崩れが起きた場合に復元する
    el.style.display = "none";
    void el.offsetHeight;
    el.style.display = "";

    // オーバーレイ全体のリフロー
    await forceIOSReflow(overlay);

    // iframe 掃除（2回目 — reflow 後に遅延生成された残骸を除去）
    cleanupHtml2canvasIframes();

    // DOM 復帰の検証: 要素が正しく表示されているか確認
    // 失敗していたら location.reload() で強制復旧
    // （画像保存は完了済みなので UX 上許容範囲）
    await nextTick();
    const restored = el.getBoundingClientRect().height > 0;
    if (!restored) {
      location.reload();
    }
  }
}
</script>
