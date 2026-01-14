<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal">
      <header class="modal__header">
        <h2 class="modal__title">{{ t("help.title") }}</h2>
        <button class="modal__close" type="button" @click="$emit('close')" :aria-label="t('common.close')">×</button>
      </header>
      <div class="modal__body">

        <section class="section">
          <h3>{{ t("help.basic.title") }}</h3>
          <ul>
            <li>
              <strong>{{ t("help.basic.addTitle") }}</strong>:
              {{ t("help.basic.addDesc") }}
            </li>
            <li>
              <strong>{{ t("help.basic.stockTitle") }}</strong>:
              {{ t("help.basic.stockDesc") }}
            </li>
            <li>
              <strong>{{ t("help.basic.sleepTitle") }}</strong>:
              {{ t("help.basic.sleepDesc") }}
            </li>
            <li>
              <strong>{{ t("help.basic.tabSettingsTitle") }}</strong>:
              {{ t("help.basic.tabSettingsDesc") }}
            </li>
            <li>
              <strong>{{ t("help.basic.orderTitle") }}</strong>:
              {{ t("help.basic.orderDesc") }}
            </li>
            <li>
              <strong>{{ t("help.basic.usageTitle") }}</strong>:
              {{ t("help.basic.usageDesc") }}
            </li>
            <li>
              <strong>{{ t("help.basic.resultTitle") }}</strong>:
              {{ t("help.basic.resultDesc") }}
            </li>
            <li>
              <strong>{{ t("help.basic.summaryTitle") }}</strong>:
              {{ t("help.basic.summaryDesc") }}
            </li>
            <li>
              <strong>{{ t("help.basic.exportTitle") }}</strong>:
              {{ t("help.basic.exportDesc") }}
            </li>
            <li>
              <strong>{{ t("help.basic.dataTitle") }}</strong>:
              {{ t("help.basic.dataDesc") }}
            </li>
          </ul>
        </section>

        <section class="section">
          <h3>{{ t("help.purpose.title") }}</h3>
          <ul>
            <li>
              <strong>{{ t("help.purpose.targetTitle") }}</strong>:
              {{ t("help.purpose.targetDesc") }}
            </li>
            <li>
              <strong>{{ t("help.purpose.currentTitle") }}</strong>:
              {{ t("help.purpose.currentDesc") }}
            </li>
            <li>
              <strong>{{ t("help.purpose.simulateTitle") }}</strong>:
              {{ t("help.purpose.simulateDesc") }}
            </li>
            <li>
              <strong>{{ t("help.purpose.sleepTitle") }}</strong>:
              {{ t("help.purpose.sleepDesc") }}
            </li>
          </ul>
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
          <p>{{ t("help.sleepFormula.desc") }}</p>
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
          <p>{{ t("help.credits.desc") }}</p>
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

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: color-mix(in oklab, var(--ink) 40%, transparent);
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 20px;
  backdrop-filter: blur(2px);
  animation: fadeIn 0.2s ease-out;
}
.modal {
  background: var(--paper);
  width: min(720px, 100%);
  max-height: min(800px, 90vh);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  box-shadow: 0 12px 48px -12px color-mix(in oklab, var(--ink) 20%, transparent);
  animation: slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.modal__header {
  padding: 16px 20px;
  border-bottom: 1px solid color-mix(in oklab, var(--ink) 8%, transparent);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.modal__title {
  margin: 0;
  font-family: var(--font-heading);
  font-size: 20px;
  font-weight: 700;
}
.modal__close {
  appearance: none;
  background: transparent;
  border: 0;
  font-size: 24px;
  line-height: 1;
  padding: 4px 8px;
  cursor: pointer;
  color: var(--muted);
}
.modal__body {
  padding: 24px 32px;
  overflow-y: auto;
  line-height: 1.7;
}

.section {
  margin-bottom: 32px;
}
.section:last-child {
  margin-bottom: 0;
}
.section h3 {
  font-family: var(--font-heading);
  font-size: 16px;
  margin: 0 0 12px;
  padding-bottom: 6px;
  border-bottom: 2px solid color-mix(in oklab, var(--accent) 20%, transparent);
}
.section ul {
  margin: 0;
  padding-left: 1.5em;
}
.section li {
  margin-bottom: 8px;
}
strong {
  color: var(--accent);
}

.credits__list {
  list-style: none;
  padding: 0;
  margin: 12px 0 0;
}
.credits__list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 12px;
}
.credits__list a {
  font-size: 14px;
  font-weight: 700;
  color: var(--accent);
  text-decoration: none;
}
.credits__list a:hover {
  text-decoration: underline;
}
.credits__note {
  font-size: 12px;
  color: var(--muted);
}

.candy__note {
  font-size: 0.95em;
  color: var(--muted);
}

.formula__list {
  list-style: none;
  padding: 0;
  margin: 12px 0 0;
}
.formula__list li {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 16px;
  padding: 10px 12px;
  background: color-mix(in oklab, var(--ink) 4%, transparent);
  border-radius: 8px;
}
.formula__list strong {
  font-size: 14px;
  margin-bottom: 2px;
}
.formula__list code {
  font-family: "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 14px;
  background: color-mix(in oklab, var(--ink) 8%, transparent);
  padding: 4px 8px;
  border-radius: 4px;
  color: var(--ink);
}
.formula__note {
  font-size: 13px;
  color: var(--muted);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes slideIn {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 560px) {
  .overlay {
    padding: 0;
  }
  .modal {
    width: 100%;
    max-height: 100vh;
    border-radius: 0;
  }
  .modal__body {
    padding: 16px 20px;
  }
}
</style>
