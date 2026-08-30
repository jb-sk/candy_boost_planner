<template>
  <div class="modal-overlay help-overlay" @click.self="$emit('close')">
    <div class="modal" role="dialog" aria-modal="true" :aria-label="t('help.title')">
      <header class="modal__header">
        <h2 class="modal__title">{{ t("help.title") }}</h2>
        <button class="modal__close" type="button" @click="$emit('close')" :aria-label="t('common.close')">×</button>
      </header>
      <div class="modal__body" data-testid="help-panel-usage">
        <section class="section section--basic">
          <h3>{{ t("help.basic.title") }}</h3>
          <dl class="helpDl helpDl--table">
            <dt>{{ t("help.basic.addTitle") }}</dt>
            <dd>{{ t("help.basic.addDesc") }}</dd>
            <dt>{{ t("help.basic.usageTitle") }}</dt>
            <dd>{{ t("help.basic.usageDesc") }}</dd>
            <dt>{{ t("help.basic.stockTitle") }}</dt>
            <dd>{{ t("help.basic.stockDesc") }}</dd>
            <dt>{{ t("settings.defaultBoostReachLevelLabel") }}</dt>
            <dd>{{ t("settings.defaultBoostReachLevelHelp") }}</dd>
            <dt>{{ t("help.basic.sleepTitle") }}</dt>
            <dd>{{ t("help.basic.sleepDesc") }}</dd>
            <dt>{{ t("help.basic.tabSettingsTitle") }}</dt>
            <dd>{{ t("help.basic.tabSettingsDesc") }}</dd>
            <dt>{{ t("help.basic.orderTitle") }}</dt>
            <dd>{{ t("help.basic.orderDesc") }}</dd>
            <dt>{{ t("help.basic.resultTitle") }}</dt>
            <dd>{{ t("help.basic.resultDesc") }}</dd>
            <dt>{{ t("help.basic.summaryTitle") }}</dt>
            <dd>{{ t("help.basic.summaryDesc") }}</dd>
            <dt>{{ t("help.basic.exportTitle") }}</dt>
            <dd>{{ t("help.basic.exportDesc") }}</dd>
            <dt>{{ t("help.basic.dataTitle") }}</dt>
            <dd>{{ t("help.basic.dataDesc") }}</dd>
            <dt>{{ t("help.basic.backupTitle") }}</dt>
            <dd>{{ t("help.basic.backupDesc") }}</dd>
            <dt>{{ t("help.basic.themeTitle") }}</dt>
            <dd>{{ t("help.basic.themeDesc") }}</dd>
          </dl>
        </section>

        <section class="section section--purpose">
          <h3>{{ t("help.purpose.title") }}</h3>
          <dl class="helpDl helpDl--stacked">
            <dt>{{ t("help.purpose.targetTitle") }}</dt>
            <dd>{{ t("help.purpose.targetDesc") }}</dd>
            <dt>{{ t("help.purpose.simulateTitle") }}</dt>
            <dd>{{ t("help.purpose.simulateDesc") }}</dd>
            <dt>{{ t("help.purpose.sleepTitle") }}</dt>
            <dd>{{ t("help.purpose.sleepDesc") }}</dd>
          </dl>
        </section>

        <!-- モード名と各説明は settings.* を参照する。設定のツールチップと同じ文言を出すため、
             ここで help.* に写しを作らない。 -->
        <section class="section section--allocation">
          <h3>{{ t("help.allocation.title") }}</h3>
          <dl class="helpDl helpDl--table">
            <dt>{{ t("settings.itemCompareModeSurplusFirst") }}</dt>
            <dd>{{ t("settings.itemCompareModeSurplusFirstHelp") }}</dd>
            <dt>{{ t("settings.itemCompareModeSurplusGateFirst") }}</dt>
            <dd>{{ t("settings.itemCompareModeSurplusGateFirstHelp") }}</dd>
            <dt>{{ t("settings.itemCompareModeLegacyImproved") }}</dt>
            <dd>{{ t("settings.itemCompareModeLegacyImprovedHelp") }}</dd>
          </dl>
          <p class="section__note">{{ t("help.allocation.bagNote") }}</p>
        </section>

        <section class="section">
          <h3>{{ t("help.itemPriority.title") }}</h3>
          <ul>
            <li>{{ t("help.itemPriority.item1") }}</li>
            <li>{{ t("help.itemPriority.item2") }}</li>
            <li>{{ t("help.itemPriority.item3") }}</li>
            <li class="itemPriority__note">{{ t("help.itemPriority.note1") }}</li>
            <li class="itemPriority__note">{{ t("help.itemPriority.note2") }}</li>
          </ul>
        </section>

        <section class="section">
          <h3>{{ t("help.sleepFormula.title") }}</h3>
          <p class="section__desc">{{ t("help.sleepFormula.desc") }}</p>
          <ul class="formula__list">
            <li>
              <strong>{{ t("help.sleepFormula.scoreTitle") }}</strong>
              <code>{{ t("help.sleepFormula.scoreFormula") }}</code>
              <span class="formula__note">{{ t("help.sleepFormula.scoreNote") }}</span>
            </li>
            <li>
              <strong>{{ t("help.sleepFormula.expTitle") }}</strong>
              <code>{{ t("help.sleepFormula.expFormula") }}</code>
              <span class="formula__note">{{ t("help.sleepFormula.bonusNote") }}</span>
              <span class="formula__note">{{ t("help.sleepFormula.natureNote") }}</span>
            </li>
            <li>
              <strong>{{ t("help.sleepFormula.outerTitle") }}</strong>
              <code>{{ t("help.sleepFormula.outerFormula") }}</code>
              <span class="formula__note">{{ t("help.sleepFormula.gsdFormula") }}</span>
              <span class="formula__note">{{ t("help.sleepFormula.outerNote") }}</span>
            </li>
            <li>
              <strong>{{ t("help.sleepFormula.incenseTitle") }}</strong>
              <code>{{ t("help.sleepFormula.incenseFormula") }}</code>
              <span class="formula__note">{{ t("help.sleepFormula.incenseNote1") }}</span>
              <span class="formula__note">{{ t("help.sleepFormula.incenseNote2") }}</span>
              <span class="formula__note">{{ t("help.sleepFormula.incenseNote3") }}</span>
              <span class="formula__note">{{ t("help.sleepFormula.incenseNote4") }}</span>
            </li>
          </ul>
        </section>

        <section class="section">
          <h3>{{ t("help.credits.title") }}</h3>
          <p class="section__desc">{{ t("help.credits.desc") }}</p>
          <ul class="credits__list">
            <li>
              <a href="https://nitoyon.github.io/pokesleep-tool/iv/" target="_blank" rel="noopener noreferrer">{{ t("help.credits.nitoyon") }}</a>
              <span class="credits__note">{{ t("help.credits.pokemonData") }}</span>
            </li>
            <li>
              <a href="https://pks.raenonx.cc/" target="_blank" rel="noopener noreferrer">{{ t("help.credits.raenonx") }}</a>
              <span class="credits__note">{{ t("help.credits.expTable") }}</span>
            </li>
            <li>
              <a href="https://wikiwiki.jp/poke_sleep/" target="_blank" rel="noopener noreferrer">{{ t("help.credits.pokeSleepWiki") }}</a>
              <span class="credits__note">{{ t("help.credits.pokeSleepWikiNote") }}</span>
            </li>
            <li>
              <a :href="readmeUrl" target="_blank" rel="noopener noreferrer">{{ t("help.credits.readme") }}</a>
              <span class="credits__note">{{ t("help.credits.readmeNote") }}</span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
const { t, locale } = useI18n();

// 参照元の全一覧はREADMEにしかない。日本語UIでは日本語版READMEへ送る。
const readmeUrl = computed(() => (
  locale.value === "ja"
    ? "https://github.com/jb-sk/candy_boost_planner/blob/main/README.ja.md"
    : "https://github.com/jb-sk/candy_boost_planner/blob/main/README.md"
));

// ESCキーで閉じる
const emit = defineEmits<{ (e: "close"): void }>();
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape") emit("close");
};

onMounted(() => window.addEventListener("keydown", handleKeydown));
onUnmounted(() => window.removeEventListener("keydown", handleKeydown));
</script>
