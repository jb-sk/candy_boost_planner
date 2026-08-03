<template>
  <div class="exportOverlay" data-testid="export-overlay" @click.self="emit('close')" role="dialog" :aria-label="t('calc.export.open')">
    <div class="exportSheetWrap" @click.self="emit('close')">
      <div
        ref="exportSheetEl"
        class="exportSheet"
        data-testid="export-sheet"
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
                <span v-if="row.candySupply" class="exportList__supplyInline">{{ row.candySupply }}</span>
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
                <span class="exportList__num" data-testid="export-total-row-total-candy">{{ fmtNum(totals.totalCandy) }}</span>
              </div>
              <div class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colShards") }}</span>
                <span class="exportList__num" data-testid="export-total-row-shards">{{ fmtNum(totals.shards) }}</span>
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
    <!-- 共有が使えない端末向け: 画像を長押しして写真に保存させるフォールバック -->
    <div
      v-if="fallbackImageUrl"
      class="exportSaveViewer"
      data-testid="export-save-viewer"
      role="dialog"
      :aria-label="t('calc.export.longPressToSave')"
      @click.self="closeFallback"
    >
      <div class="exportSaveViewer__inner">
        <p class="exportSaveViewer__hint">{{ t("calc.export.longPressToSave") }}</p>
        <img class="exportSaveViewer__img" :src="fallbackImageUrl" alt="" />
        <p class="exportSaveViewer__sub">{{ t("calc.export.saveViewerReloadHint") }}</p>
        <button class="btn btn--primary exportSaveViewer__close" type="button" @click="closeFallback">
          {{ t("common.close") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  buildExportImageModel,
  type ExportImageBoostKind,
  type ExportImageRankingItem,
  type ExportImageRow,
  type ExportImageSource,
  type ExportImageTotals,
  type ExportImageTranslate,
} from "../export/exportImageModel";
import { createExportImageCanvas, ExportImageError } from "../export/renderExportImage";
import { saveExportImage, type SaveImageAdapter } from "../export/saveExportImage";
import { isSharePending, setSharePending } from "../export/sharePendingState";
import { showToast } from "../composables/useToast";

const props = defineProps<{
  rows: ExportImageRow[];
  totals: ExportImageTotals;

  boostUsed: number;
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
  /** アメ在庫が1つでも設定されているか（在庫未設定警告の表示条件） */
  hasCandyStock: boolean;
}>();

const emit = defineEmits<{ close: []; "open-settings": [] }>();
const { t, locale } = useI18n();

const exportSheetEl = ref<HTMLElement | null>(null);
const exportBusy = ref(false);
const exportStatus = ref("");
const exportCsvMenuOpen = ref(false);

// 共有が使えない時のフォールバック: 画像を表示し「長押しで写真に保存」させる（url は object URL）
const fallbackImageUrl = ref("");
function closeFallback() {
  if (!fallbackImageUrl.value) return;
  try {
    URL.revokeObjectURL(fallbackImageUrl.value);
  } catch {
    /* ignore */
  }
  fallbackImageUrl.value = "";
}

onUnmounted(() => {
  closeFallback();
});

function fmtNum(n: number): string {
  return new Intl.NumberFormat(locale.value).format(n);
}

const isBoostMode = computed(() => props.boostKind !== "none");

/** 在庫未設定警告: アメ在庫が空のときだけ出す（実使用アメ 0 で判定しない） */
const showNoStockWarning = computed(() => !props.hasCandyStock);

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

  // 列順：Pokemon, EXP補正, 現在Lv, 目標Lv, (Boost, Normal), Total, Shards, Items
  const headCols = [
    t("calc.export.colPokemon"),
    t("calc.export.colExpAdj"),
    t("calc.row.srcLevel"),
    t("calc.row.dstLevel"),
    ...(isNormal ? [] : [t("calc.export.colBoost"), t("calc.export.colNormal")]),
    t("calc.export.colTotal"),
    t("calc.export.colShards"),
    t("calc.row.candySupply"),
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
      r.candySupply || "",
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
    "",
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

// ── 画像保存（Canvas 2D 直接描画）──────────────────────────────────

/** vue-i18n の t を ExportImageTranslate 形へ橋渡しする（model は global i18n を読まない）。 */
const translate: ExportImageTranslate = (key, params) => (params ? t(key, params) : t(key));

/** 現行 props をそのまま source DTO へ渡す（solver は再実行しない）。 */
function buildExportSource(): ExportImageSource {
  return {
    rows: props.rows,
    totals: props.totals,
    boostUnused: props.boostUnused,
    shardsUsed: props.shardsUsed,
    shardsCap: props.shardsCap,
    boostUsagePct: props.boostUsagePct,
    boostCap: props.boostCap,
    boostFillPct: props.boostFillPct,
    shardsUsagePct: props.shardsUsagePct,
    shardsFillPct: props.shardsFillPct,
    universalCandyRanking: props.universalCandyRanking,
    universalCandyUsedTotal: props.universalCandyUsedTotal,
    boostKind: props.boostKind,
    hasCandyStock: props.hasCandyStock,
  };
}

/** filename 用時刻。model の now と同じ操作開始時刻から生成する。 */
function formatFileTimestamp(now: Date): string {
  return now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

/**
 * webfont 読込前の初回保存で崩れないよう document.fonts.ready を短い上限付きで待つ。
 * 待機失敗は保存全体の失敗にはせず、解決済み system fallback で描画する。
 */
async function waitFontsReady(timeoutMs: number): Promise<void> {
  try {
    const fontsReady = document.fonts?.ready;
    if (fontsReady && typeof fontsReady.then === "function") {
      await Promise.race([
        fontsReady,
        new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
      ]);
    }
  } catch {
    // フォント待機失敗は無視して fallback フォントで続行する
  }
}

function detectLikelyIOS(): boolean {
  const ua = navigator.userAgent || "";
  return (
    /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** saveExportImage に渡す browser adapter を組み立てる。 */
function createSaveAdapter(): SaveImageAdapter {
  const nav = navigator as Navigator & {
    share?: (data: unknown) => Promise<void>;
    canShare?: (data: unknown) => boolean;
  };
  return {
    isLikelyIOS: detectLikelyIOS(),
    // share 呼び出し中は sharePending を立て、settle で下ろす。古い iOS では 1 回目が
    // 永遠に settle せず「共有中」のまま残るため、2 回目以降は isSharePending で検知して
    // share を呼ばず長押し保存へ回す（誤った成功トーストを避ける）。
    share:
      typeof nav.share === "function"
        ? (data) => {
            const p = nav.share!(data);
            setSharePending(true);
            const clear = () => setSharePending(false);
            p.then(clear, clear);
            return p;
          }
        : undefined,
    isSharePending,
    canShare: typeof nav.canShare === "function" ? (data) => nav.canShare!(data) : undefined,
    createFile: (parts, name, type) => new File(parts, name, { type }),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    triggerDownload: (url, filename) => {
      const a = document.createElement("a");
      a.download = filename;
      a.href = url;
      a.click();
    },
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => window.clearTimeout(id),
    onPageHide: (fn) => {
      window.addEventListener("pagehide", fn);
      return () => window.removeEventListener("pagehide", fn);
    },
    // 共有シートが閉じてページに戻った瞬間を検知（hidden→visible / blur→focus）。
    // 一度 hidden/blur した後の復帰のみ発火し、シート提示前の誤発火を避ける。
    onVisibleAgain: (fn) => {
      let left = false;
      const onLeave = () => { left = true; };
      const onReturn = () => { if (left) fn(); };
      const onVis = () => {
        if (document.visibilityState === "hidden") onLeave();
        else onReturn();
      };
      document.addEventListener("visibilitychange", onVis);
      window.addEventListener("blur", onLeave);
      window.addEventListener("focus", onReturn);
      return () => {
        document.removeEventListener("visibilitychange", onVis);
        window.removeEventListener("blur", onLeave);
        window.removeEventListener("focus", onReturn);
      };
    },
  };
}

/**
 * 現行 props から ExportImageModel を構築し、Canvas 2D へ直接描画して保存する。
 * .exportSheet の clone・移動・reflow・reload はしない。style は読取のみ。
 * heavy solver を再実行せず、既に渡された props だけを使う。
 */
async function downloadCalcExportPng() {
  const el = exportSheetEl.value;
  if (!el) return;
  exportBusy.value = true;
  exportStatus.value = "";
  exportCsvMenuOpen.value = false;

  try {
    // webfont 待機（上限付き・非致命）
    await waitFontsReady(600);

    // 操作開始時刻を 1 度だけ取得し、月表示と filename で共有する
    const now = new Date();
    const model = buildExportImageModel(buildExportSource(), {
      locale: locale.value,
      now,
      t: translate,
    });

    // style 読取（読取のみ）→ Canvas 生成・描画
    const canvas = createExportImageCanvas(model, el);
    const filename = `CandyBoost-Planner_${formatFileTimestamp(now)}.png`;

    const outcome = await saveExportImage(
      canvas,
      { filename, shareTitle: t("app.title") },
      createSaveAdapter(),
    );

    if (outcome.kind === "error") {
      exportStatus.value = t("status.exportFailed");
    } else if (outcome.kind === "manual-save") {
      // 共有が使えない（古いiOSで共有中のまま / 非セキュア等）→ アプリ内で長押し保存させる。
      // 未保存なので成功トーストは出さない。
      closeFallback();
      fallbackImageUrl.value = outcome.url;
    } else if (
      outcome.kind === "shared" ||
      outcome.kind === "downloaded" ||
      outcome.kind === "dismissed"
    ) {
      // shared: 共有成功 / downloaded: PC保存 / dismissed: 共有シートを閉じた（保存想定）
      // → 保存完了トーストを表示。cancelled は出さない。
      showToast(t("status.imageSaved"), { testId: "export-toast" });
    }
  } catch (e) {
    if (e instanceof ExportImageError && e.reason === "image_too_large") {
      exportStatus.value = t("status.imageTooLarge");
    } else {
      exportStatus.value = `${t("status.exportFailed")} [${e instanceof Error ? e.message : "unknown"}]`;
    }
  } finally {
    exportBusy.value = false;
  }
}
</script>
