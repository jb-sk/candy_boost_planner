<template>
  <div class="modal-overlay help-overlay" @click.self="$emit('close')">
    <div class="modal">
      <header class="modal__header">
        <h2 class="modal__title">{{ t("help.title") }}</h2>
        <button class="modal__close" type="button" @click="$emit('close')" :aria-label="t('common.close')">×</button>
      </header>
      <div class="modal__body">

        <section class="section section--basic">
          <h3>{{ t("help.basic.title") }}</h3>
          <dl class="helpDl helpDl--stacked">
            <dt>{{ t("help.basic.addTitle") }}</dt>
            <dd>{{ t("help.basic.addDesc") }}</dd>
            <dt>{{ t("help.basic.usageTitle") }}</dt>
            <dd>{{ t("help.basic.usageDesc") }}</dd>
            <dt>{{ t("help.basic.stockTitle") }}</dt>
            <dd>{{ t("help.basic.stockDesc") }}</dd>
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
            <dt>{{ t("help.basic.themeTitle") }}</dt>
            <dd>{{ t("help.basic.themeDesc") }}</dd>
          </dl>
        </section>

        <section class="section section--purpose">
          <h3>{{ t("help.purpose.title") }}</h3>
          <dl class="helpDl helpDl--stacked">
            <dt>{{ t("help.purpose.targetTitle") }}</dt>
            <dd>{{ t("help.purpose.targetDesc") }}</dd>
            <dt>{{ t("help.purpose.currentTitle") }}</dt>
            <dd>{{ t("help.purpose.currentDesc") }}</dd>
            <dt>{{ t("help.purpose.simulateTitle") }}</dt>
            <dd>{{ t("help.purpose.simulateDesc") }}</dd>
            <dt>{{ t("help.purpose.sleepTitle") }}</dt>
            <dd>{{ t("help.purpose.sleepDesc") }}</dd>
          </dl>
        </section>

        <section class="section">
          <h3>{{ t("help.candy.title") }}</h3>
          <ul>
            <li>{{ t("help.candy.item1") }}</li>
            <li>{{ t("help.candy.item2") }}</li>
            <li>{{ t("help.candy.item3") }}</li>
            <li class="candy__note">{{ t("help.candy.note1") }}</li>
            <li class="candy__note">{{ t("help.candy.note2") }}</li>
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
              <strong>{{ t("help.sleepFormula.gsdTitle") }}</strong>
              <code>{{ t("help.sleepFormula.gsdFormula") }}</code>
              <span class="formula__note">{{ t("help.sleepFormula.gsdNote") }}</span>
              <span class="formula__note">{{ t("help.sleepFormula.gsdNote2") }}</span>
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
          </ul>
        </section>

      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
const { t } = useI18n();

// ESCキーで閉じる
const emit = defineEmits<{ (e: "close"): void }>();
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape") emit("close");
};

onMounted(() => window.addEventListener("keydown", handleKeydown));
onUnmounted(() => window.removeEventListener("keydown", handleKeydown));
</script>
