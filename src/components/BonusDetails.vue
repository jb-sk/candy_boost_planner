<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { BonusPanelView } from "../utils/bonusPanelView";

/**
 * 展開したボーナス明細（内訳の表とイベント）。表は3晩以内なら日別、4晩以上なら種類別。
 *
 * **ここは描くだけ。** 表示文も出し分けも `panel`（`CalcPanel` の `rowBonusPanelMap`）で
 * 決まっている。テンプレートに条件を書くと、行ではなく計画で決まる判断が
 * セルの数だけ評価されて読みにくくなる。
 *
 * 呼び出し側は**「到達可能」行の内側へ置くこと。** 外へ出すと結果欄を畳んだときに
 * 明細だけが取り残される（実績あり）。
 *
 * 例外は1列 / 2列の切り替えだけ（下の `measure`）。**これは CSS では書けない。**
 * 詳しくは `.calcRow__bonusLayout` の CSS 注記を参照。
 */
const props = defineProps<{ panel: BonusPanelView }>();

const { t } = useI18n();

const slotEl = ref<HTMLElement | null>(null);
const layoutEl = ref<HTMLElement | null>(null);

/** 内訳表の右にイベント一覧を置けるか。false なら縦積み。 */
const twoColumns = ref(false);

/**
 * **いったん2列に組んでみて、はみ出さなければ2列のまま。**
 *
 * 幅を足し算で見積もらない。列の間隔も箱の余白も枠線も、はみ出したかどうかに
 * すべて含まれている。見積もると CSS 側の値を JS に写す羽目になり、必ずずれる。
 *
 * **見るのは箱ではなくその内側の `.calcRow__bonusLayout`。** 箱の `scrollWidth` は
 * 右パディングを含まないので、パディングぶん（8px）だけ甘く判定してしまう。
 * パディングを持たないこの要素なら、`clientWidth` が使える幅そのものになる。
 *
 * 途中の2列状態は**描画されない**（同じフレーム内で戻すので paint が挟まらない）。
 * 属性を直接書くのは、`twoColumns` を通すと再描画を待つことになり測れないため。
 * 最後に `twoColumns` へ入れるので、Vue が次に描くときも同じ値になる。
 */
function measure(): void {
  const layout = layoutEl.value;
  if (!layout) return;

  // イベント一覧が無い行は並べる相手がいない。
  if (!props.panel.events) {
    twoColumns.value = false;
    return;
  }

  // 畳まれている・まだ描かれていない。次の通知で測り直す（0 で判定すると必ず縦積みになる）。
  if (layout.clientWidth <= 0) return;

  layout.dataset.columns = "2";
  const fits = layout.scrollWidth <= layout.clientWidth;
  layout.dataset.columns = fits ? "2" : "1";
  twoColumns.value = fits;
}

let frame = 0;

/** 計測はレイアウトを強制するので、同じフレームの通知は1回にまとめる。 */
function schedule(): void {
  if (typeof requestAnimationFrame !== "function") {
    measure();
    return;
  }
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    measure();
  });
}

let observer: ResizeObserver | null = null;

onMounted(() => {
  // ここは描画前なので、同期で測れば「1列で出てから2列へ跳ねる」ちらつきが出ない。
  measure();

  if (typeof ResizeObserver === "undefined" || !slotEl.value) return;
  observer = new ResizeObserver(schedule);
  observer.observe(slotEl.value);
});

onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  observer?.disconnect();
  observer = null;
});

// 中身が変われば必要な幅も変わる（言語切替・行の内容・イベント件数）。
watch(() => props.panel, schedule, { flush: "post" });

// Web フォントが後から効くと文字幅が変わる。読み込み済みなら即 resolve するだけ。
if (typeof document !== "undefined" && document.fonts) {
  void document.fonts.ready.then(schedule);
}
</script>

<template>
  <!--
    明細の置き場所。**幅の基準はここ**。
    明細の箱そのものは中身ぶんの幅（`fit-content`）なので、箱を基準にすると
    「箱の幅で列数が決まり、列数で箱の幅が決まる」という循環になる。
  -->
  <div ref="slotEl" class="calcRow__bonusDetailsSlot">
  <div class="calcRow__bonusDetails" data-testid="result-bonus-details">
    <div
      ref="layoutEl"
      class="calcRow__bonusLayout"
      :data-columns="twoColumns ? '2' : '1'"
    >
      <!--
        左は内訳の表（あおいタネ注記を含む）。右（横に収まるとき）はイベント。
        **DOM順が狭幅での並び順**（表 → イベント）。
      -->
      <div class="calcRow__bonusMain" data-testid="bonus-breakdown">
        <div v-if="panel.table">
          <!--
            表の軸は計画の長さで変わる（`rows` と `nights` は排他。判断は panel 側）。
            **列数と並びは同じ**（名前 → 倍率 → 量 → EXP。中身は1列目が種類/日付、3列目が日数/睡眠時間）
            なので、どちらも同じグリッドの行として描く。

            **行と列の関係は role で持たせる。** 見た目はグリッドなので DOM は平坦にせざるを得ず、
            素の div/span のままだと「同じ晩の4セル」「合計行」という関係が支援技術へ伝わらない
            （WCAG 1.3.1）。行の入れ物は `display: contents` でレイアウトへ影響させない。
            **1列目は `rowheader`**（その行が何の行かを示す見出し。日付 / 種類 / 合計）。
            列見出しは置かない ── 軸で意味が変わるうえ、各セルが自己記述的
            （`8/23` / `×1.25` / 「睡眠時間8時間30分」/「素EXP93、ボーナス23、合計116EXP」）なため。
          -->
          <div class="calcRow__bonusTable" role="table" :aria-label="t('calc.row.sleepBonusesLabel')">
          <div v-for="(bonus, idx) in panel.table.rows" :key="`k${idx}`" class="calcRow__bonusTableRow" role="row">
            <span class="calcRow__bonusName" role="rowheader">{{ bonus.name }}<span
              v-if="bonus.withIncense"
              class="calcRow__bonusIncenseTag"
            >{{ t("calc.row.bonusWithIncense") }}</span></span>
            <span class="calcRow__bonusMult" role="cell">
              <span v-if="bonus.multiplier" class="calcRow__bonusMultChip">{{ bonus.multiplier }}</span>
            </span>
            <span class="calcRow__bonusAmount" role="cell">{{ bonus.amount }}</span>
            <span class="calcRow__bonusExp" role="cell" :class="{ 'calcRow__bonusExp--base': bonus.isBase }">{{ bonus.exp }}</span>
          </div>
          <div v-for="(night, idx) in panel.table.nights" :key="`n${idx}`" class="calcRow__bonusTableRow" role="row">
            <span class="calcRow__bonusNightDate" role="rowheader">{{ night.date }}<span
              v-if="night.subLabel"
              class="calcRow__bonusSubLabel"
            >{{ night.subLabel }}</span><span
              v-if="night.withIncense"
              class="calcRow__bonusIncenseTag"
            >{{ t("calc.row.bonusWithIncense") }}</span></span>
            <span class="calcRow__bonusNightMult" role="cell">
              <span v-if="night.multiplier" class="calcRow__bonusMultChip">{{ night.multiplier }}</span>
            </span>
            <span class="calcRow__bonusNightTime" role="cell">
              <!-- generic な span の aria-label は支援技術で無視され得るため、読み上げ文を実テキストで持つ。 -->
              <span aria-hidden="true">{{ night.time }}</span>
              <span class="calcRow__visuallyHidden">{{ night.timeAriaLabel }}</span>
            </span>
            <span class="calcRow__bonusNightExp" role="cell">
              <span aria-hidden="true">{{ night.exp }}</span>
              <span class="calcRow__visuallyHidden">{{ night.expAriaLabel }}</span>
            </span>
          </div>
          <!--
            合計。この計画を寝きるともらえる睡眠EXP（残EXPをわずかに上回る）。
            区切り線はセルごとの border ではなく全列をまたぐ1本にする。
            セルに引くと、空の日数セルだけベースラインが揃わず線がずれる。
            `aria-hidden` なので role=table の直下にあってもアクセシビリティツリーには出ない。
          -->
          <span class="calcRow__bonusRule" aria-hidden="true"></span>
          <div class="calcRow__bonusTableRow" role="row">
            <span class="calcRow__bonusName calcRow__bonusTotal" role="rowheader">{{ t("calc.row.bonusTotal") }}</span>
            <span class="calcRow__bonusMult calcRow__bonusTotal" role="cell"></span>
            <!-- 日数も睡眠時間も行どうしで足せないので、合計行の第3列は空にする。 -->
            <span class="calcRow__bonusAmount calcRow__bonusTotal" role="cell"></span>
            <span class="calcRow__bonusExp calcRow__bonusTotal" role="cell">{{ panel.table.total }}</span>
          </div>
          </div>
          <!-- あおいタネのずらし通知は表の直後（グリッドの外）。 -->
          <div v-if="panel.notes" class="calcRow__blueSeedNotes" data-testid="blue-seed-shift-note">
            <div v-for="(note, idx) in panel.notes" :key="idx">{{ note }}</div>
          </div>
        </div>
      </div>
      <div v-if="panel.events" class="calcRow__bonusChips" data-testid="event-chips">
        <div class="calcRow__bonusChipsHeading">{{ t("calc.row.eventListLabel") }}</div>
        <!--
          件をまたいで倍率の桁を揃えるためのグリッド（1列目: 名前 / 2列目: 倍率）。
          件の入れ物は display: contents で中身を直接この2列へ乗せる。
          見出しと「※〜」は外に置く（中に入れると2つの幅まで列の幅計算に混ざる）。
          並びは実イベント → 仮イベント（buildEventChipList が正本）。
        -->
        <div class="calcRow__bonusChipGrid">
          <div
            v-for="(chip, idx) in panel.events.chips"
            :key="idx"
            class="calcRow__bonusChip"
            :data-testid="chip.projected ? 'projected-chip' : 'real-chip'"
          >
            <span class="calcRow__bonusChipLabel">{{ chip.label }}<span
              v-if="chip.projected"
              class="calcRow__bonusChipTag"
            >{{ t("calc.row.projectedEventTag") }}</span></span>
            <span class="calcRow__bonusChipName">{{ chip.name }}</span>
            <span class="calcRow__bonusMultChip">×{{ chip.multiplier }}</span>
            <template v-if="chip.flower">
              <span class="calcRow__bonusChipNote">{{ chip.flower.label }}</span>
              <span class="calcRow__bonusMultChip">×{{ chip.flower.multiplier }}</span>
            </template>
          </div>
        </div>
        <!--
          「※〜」の断り書きは一覧の後ろに置く（先頭に出すと一覧の見出しに見える）。
          仮イベントが1件も無い一覧では出さない（断る対象が無い）。
        -->
        <div v-if="panel.events.hasProjected" class="calcRow__bonusChipsNote">{{ t("calc.row.projectedEventsNote") }}</div>
      </div>
    </div>
  </div>
  </div>
</template>
