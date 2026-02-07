<template>
  <div class="exportOverlay" data-testid="export-overlay" @click.self="emit('close')" role="dialog" :aria-label="t('calc.export.open')">
    <div class="exportSheetWrap">
      <div
        ref="exportSheetEl"
        class="exportSheet"
        data-testid="export-sheet"
        :class="{ 'exportSheet--capture': exportBusy }"
        :style="{ transform: exportBusy ? 'none' : `scale(${scale})` }"
        @click="exportCsvMenuOpen = false"
      >
        <div class="exportHead">
          <div class="exportHead__top">
            <div class="exportBrand" data-testid="brandLabel">🍬 {{ boostKind === 'full' ? t("calc.export.brandBoost") : boostKind === 'mini' ? t("calc.export.brandMini") : t("calc.export.brand") }}</div>
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
          <div class="exportCalcTop">
            <div class="exportStats" :class="{ 'exportStats--hasShortage': totals.shortage > 0, 'exportStats--normal': !isBoostMode }">
              <div
                v-for="card in statCards"
                :key="card.key"
                class="statCard"
                :class="{
                  [`statCard--${card.variant}`]: card.variant,
                  'statCard--danger': card.variant === 'danger',
                }"
                data-testid="statCard"
              >
                <div class="statCard__icon">{{ card.icon }}</div>
                <div class="statCard__content">
                  <div class="statCard__label">{{ card.label }}</div>
                  <div class="statCard__value" :class="{ 'statCard__value--danger': card.isDanger }">
                    {{ fmtNum(card.value) }}
                  </div>
                </div>
              </div>
            </div>

            <div class="exportBars" :class="{ 'exportBars--muted': shardsCap <= 0, 'exportBars--danger': shardsOver > 0 || boostOver > 0 }">
              <div v-if="isBoostMode" class="exportBarBlock" :class="{ 'exportBarBlock--danger': boostOver > 0 }">
                <div class="exportBarHead">
                  <div class="exportBarK">
                    {{ t("calc.boostCandyUsage", { pct: boostUsagePct }) }}
                    <span v-if="showBoostFire" aria-hidden="true"> 🔥</span>
                    <span v-if="boostOver > 0" class="exportBarOverVal"> (+{{ fmtNum(boostOver) }})</span>
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
                    <div v-if="boostOver > 0 && boostCap > 0" class="exportBar__over" :style="{ width: `${boostOverPct}%` }"></div>
                  </div>
                </div>
              </div>

              <div class="exportBarBlock">
                <div class="exportBarHead">
                  <div class="exportBarK">
                    {{ shardsCap > 0 ? t("calc.shardsUsage", { pct: shardsUsagePct }) : t("calc.shardsUsageDash") }}
                    <span v-if="showShardsFire" aria-hidden="true"> 🔥</span>
                    <span v-if="shardsOver > 0" class="exportBarOverVal"> (+{{ fmtNum(shardsOver) }})</span>
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
                    <div v-if="shardsOver > 0 && shardsCap > 0" class="exportBar__over" :style="{ width: `${shardsOverPct}%` }"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="exportList" :class="{ 'exportList--normal': !isBoostMode, 'exportList--hasShortage': totals.shortage > 0 }">
            <div class="exportList__head" data-testid="listHead">
              <div class="exportList__col">{{ t("calc.export.colPokemon") }}</div>
              <div class="exportList__col u-align-center">{{ t("calc.row.srcLevel") }} → {{ t("calc.row.dstLevel") }}</div>
              <div v-if="isBoostMode" class="exportList__col u-align-right">{{ t("calc.export.colBoost") }}</div>
              <div v-if="isBoostMode" class="exportList__col u-align-right">{{ t("calc.export.colNormal") }}</div>
              <div class="exportList__col u-align-right">{{ t("calc.export.colTotal") }}</div>
              <div class="exportList__col u-align-right">{{ t("calc.export.colShards") }}</div>
              <div v-if="totals.shortage > 0" class="exportList__col u-align-right">{{ t("calc.export.colShortage") }}</div>
            </div>

            <div v-for="row in rows" :key="row.id" class="exportList__row" data-testid="listRow">
              <div class="exportList__col exportList__nameCol">
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
              <div v-if="totals.shortage > 0" class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colShortage") }}</span>
                <span class="exportList__num" :class="{ 'exportList__num--danger': (row.shortage ?? 0) > 0 }">{{ (row.shortage ?? 0) > 0 ? fmtNum(row.shortage ?? 0) : '-' }}</span>
              </div>
            </div>

            <div class="exportList__row exportList__row--total" aria-label="total" data-testid="totalRow">
              <div class="exportList__col exportList__nameCol">
                <span class="exportList__name" aria-hidden="true"></span>
              </div>
              <div class="exportList__col u-align-center exportList__lvCol"></div>
              <div v-if="isBoostMode" class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colBoost") }}</span>
                <span class="exportList__num" :class="{ 'exportList__num--danger': totals.boostCandy > boostCap }">{{ fmtNum(totals.boostCandy) }}</span>
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
                <span class="exportList__num" :class="{ 'exportList__num--danger': shardsCap > 0 && shardsOver > 0 }">{{ fmtNum(totals.shards) }}</span>
              </div>
              <div v-if="totals.shortage > 0" class="exportList__col u-align-right exportList__numCol">
                <span class="u-mobile-label">{{ t("calc.export.colShortage") }}</span>
                <span class="exportList__num exportList__num--danger">{{ fmtNum(totals.shortage) }}</span>
              </div>
            </div>
          </div>

          <!-- 万能アメ使用ランキング -->
          <div v-if="universalCandyRanking.length > 0" class="exportRanking" data-testid="rankingSection">
            <div class="exportRanking__title" data-testid="export-ranking-title">{{ t("calc.export.universalRankingTitle") }}</div>
            <div class="exportRanking__total" data-testid="export-ranking-total">
              <span>{{ t("calc.export.rankingTotal") }}</span>
              <span v-if="universalCandyUsedTotal.s > 0">{{ t("calc.export.totalUniversalS") }} {{ fmtNum(universalCandyUsedTotal.s) }}</span>
              <span v-if="universalCandyUsedTotal.m > 0">{{ t("calc.export.totalUniversalM") }} {{ fmtNum(universalCandyUsedTotal.m) }}</span>
              <span v-if="universalCandyUsedTotal.l > 0">{{ t("calc.export.totalUniversalL") }} {{ fmtNum(universalCandyUsedTotal.l) }}</span>
            </div>
            <div class="exportRanking__list">
              <div v-for="item in universalCandyRanking" :key="item.id" class="exportRanking__item" data-testid="rankingItem">
                <div class="exportRanking__name">{{ item.pokemonName }}</div>
                <div class="exportRanking__pct">{{ item.usagePct }}%</div>
                <div class="exportRanking__barWrap">
                  <div class="exportRanking__bar" :style="{ width: `${item.usagePct}%` }"></div>
                </div>
                <div class="exportRanking__items">
                  <span v-if="item.uniSUsed > 0 || item.uniMUsed > 0 || item.uniLUsed > 0" class="exportRanking__itemGroup">
                    <span class="exportRanking__itemLabel">{{ t("calc.export.labelUni") }}</span>
                    <span v-if="item.uniSUsed > 0">S{{ item.uniSUsed }}</span>
                    <span v-if="item.uniSUsed > 0 && (item.uniMUsed > 0 || item.uniLUsed > 0)"> / </span>
                    <span v-if="item.uniMUsed > 0">M{{ item.uniMUsed }}</span>
                    <span v-if="item.uniMUsed > 0 && item.uniLUsed > 0"> / </span>
                    <span v-if="item.uniLUsed > 0">L{{ item.uniLUsed }}</span>
                  </span>
                  <span v-if="item.typeSUsed > 0 || item.typeMUsed > 0" class="exportRanking__itemGroup">
                    <span class="exportRanking__itemLabel">{{ t("calc.export.labelType") }}</span>
                    <span v-if="item.typeSUsed > 0">S{{ item.typeSUsed }}</span>
                    <span v-if="item.typeSUsed > 0 && item.typeMUsed > 0"> / </span>
                    <span v-if="item.typeMUsed > 0">M{{ item.typeMUsed }}</span>
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
import { toPng } from "html-to-image";
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
  shortage?: number;
};

type ExportTotals = {
  boostCandy: number;
  normalCandy: number;
  totalCandy: number;
  shards: number;
  shortage: number;
};

const props = defineProps<{
  scale: number;
  rows: ExportRow[];
  totals: ExportTotals;

  boostUsed: number;
  boostUnused: number;
  shardsUsed: number;

  boostOver: number;
  shardsOver: number;
  shardsCap: number;

  boostUsagePct: number;
  boostCap: number;
  boostFillPct: number;
  boostOverPct: number;

  shardsUsagePct: number;
  shardsFillPct: number;
  shardsOverPct: number;

  showBoostFire: boolean;
  showShardsFire: boolean;

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

const emit = defineEmits<{ close: [] }>();
const { t, locale } = useI18n();

const exportSheetEl = ref<HTMLElement | null>(null);
const exportBusy = ref(false);
const exportStatus = ref("");
const exportCsvMenuOpen = ref(false);

function fmtNum(n: number): string {
  return new Intl.NumberFormat(locale.value as any).format(n);
}

const isBoostMode = computed(() => props.boostKind !== "none");

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
      // 個数指定を反映した合計がキャップを超えているか判定
      isDanger: props.totals.boostCandy > props.boostCap,
      show: true,
    });
  }

  cards.push({
    key: "normal",
    icon: "⚪",
    label: t("calc.export.sumNormalTotal"),
    value: props.totals.normalCandy,
    show: true,
  });

  if (isBoostMode.value) {
    cards.push({
      key: "unused",
      icon: "⚠️",
      label: t("calc.export.sumBoostUnused"),
      value: props.boostUnused,
      isDanger: props.boostUnused >= 1,
      show: true,
    });
  }

  cards.push({
    key: "shards",
    icon: "💎",
    label: t("calc.export.sumShardsTotal"),
    value: props.shardsUsed,
    variant: "primary",
    isDanger: props.shardsCap > 0 && props.shardsOver > 0,
    show: true,
  });

  if (props.totals.shortage > 0) {
    cards.push({
      key: "shortage",
      icon: "🔥",
      label: t("calc.export.sumShortage"),
      value: props.totals.shortage,
      variant: "danger",
      isDanger: true,
      show: true,
    });
  }

  return cards;
});

const exportMonthLabel = computed(() => {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  // 日は不要。要望通り「YYYY年M月」で固定。
  return `${y}年${m}月`;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav: any = navigator as any;
  try {
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(csv);
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

async function downloadCalcExportPng() {
  const el = exportSheetEl.value;
  if (!el) return;
  exportBusy.value = true;
  exportStatus.value = "";
  exportCsvMenuOpen.value = false;
  try {
    const ua = navigator.userAgent || "";
    // iPadOS sometimes reports MacIntel; treat it as iOS if it has touch.
    const isLikelyIOS =
      /iPad|iPhone|iPod/i.test(ua) ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((navigator as any).platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);

    // Webフォントが読み込まれる前にキャプチャすると崩れるので待つ
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fontsReady = (document as any)?.fonts?.ready;
    if (fontsReady && typeof fontsReady.then === "function") await fontsReady;
    await nextTick();
    // layout確定をもう1拍待つ（モバイルでの「引きずり」/崩れ対策）
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const w = Math.max(el.scrollWidth, el.clientWidth, 1);
    const h = Math.max(el.scrollHeight, el.clientHeight, 1);
    // iOS / 大きいデータで pixelRatio を上げすぎると描画が乱れやすいので控えめに
    const area = w * h;
    const pixelRatio = isLikelyIOS ? 1.5 : h > 6500 || area > 11_000_000 ? 1.25 : h > 5000 || area > 8_000_000 ? 1.5 : 2;
    const dataUrl = await toPng(el, {
      cacheBust: true,
      pixelRatio,
      backgroundColor: "#ffffff",
      width: w,
      height: h,
      style: { transform: "none", transformOrigin: "top left" },
    });
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `CandyBoost-Planner_${ts}.png`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav: any = navigator as any;
    if (isLikelyIOS && nav?.share) {
      try {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], filename, { type: "image/png" });
        const canShareFiles = typeof nav.canShare !== "function" || nav.canShare({ files: [file] });
        if (canShareFiles) {
          await nav.share({ files: [file], title: t("app.title") });
          exportStatus.value = "";
          return;
        }
      } catch {
        // fall through to fallback
      }
      try {
        window.open(dataUrl, "_blank", "noopener,noreferrer");
        exportStatus.value = "";
        return;
      } catch {
        // fall through to download
      }
    }

    const a = document.createElement("a");
    a.download = filename;
    a.href = dataUrl;
    a.click();
    exportStatus.value = "";
  } catch {
    exportStatus.value = t("status.exportFailed");
  } finally {
    exportBusy.value = false;
  }
}
</script>

<style scoped src="./ExportOverlay.css"></style>
