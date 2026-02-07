<template>
  <div class="overlay" data-testid="settings-overlay" @click.self="$emit('close')">
    <div class="modal" data-testid="settings-modal">
      <header class="modal__header">
        <h2 class="modal__title" data-testid="settings-modal-title">{{ t("common.settings") }}</h2>
        <button class="modal__close" data-testid="settings-modal-close" type="button" @click="$emit('close')" :aria-label="t('common.close')">×</button>
      </header>
      <div class="modal__body">

        <!-- グローバル設定 -->
        <section class="section" data-testid="settings-global-section">
          <h3>{{ t("settings.globalTitle") }}</h3>
          <div class="settingsRow">
            <label class="settingsField settingsField--inline settingsField--aligned">
              <span class="settingsField__label">{{ t("calc.boostRemainingLabel") }}</span>
              <input
                data-testid="settings-boost-remaining-input"
                :value="calc.boostCandyRemainingText.value"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                class="field__input field__input--sm"
                :placeholder="t('calc.boostRemainingPlaceholder', { cap: calc.fmtNum(calc.boostCandyDefaultCap.value) })"
                :title="t('calc.boostRemainingHelp')"
                @input="calc.onBoostCandyRemainingInput(($event.target as HTMLInputElement).value)"
                :disabled="calc.boostKind.value === 'none'"
              />
            </label>
          </div>
          <div class="settingsRow">
            <label class="settingsField settingsField--inline settingsField--aligned">
              <span class="settingsField__label">{{ t("calc.maxShardsLabel") }}</span>
              <input
                data-testid="settings-total-shards-input"
                :value="calc.totalShardsText.value"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                class="field__input field__input--sm"
                @input="calc.onTotalShardsInput(($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
          <div class="settingsRow settingsRow--handy">
            <div class="settingsField settingsField--inline">
              <span class="settingsField__label">{{ t("calc.candy.universalLabel") }}</span>
              <div class="candyInputs">
                <label class="candyInput">
                  <span class="candyInput__label">{{ t("calc.candy.universalS") }}</span>
                  <input
                    data-testid="settings-universal-candy-s-input"
                    type="number"
                    min="0"
                    class="field__input field__input--xs"
                    :value="candyStore.universalCandy.value.s"
                    @input="candyStore.updateUniversalCandy({ s: parseInt(($event.target as HTMLInputElement).value) || 0 })"
                  />
                </label>
                <label class="candyInput">
                  <span class="candyInput__label">{{ t("calc.candy.universalM") }}</span>
                  <input
                    data-testid="settings-universal-candy-m-input"
                    type="number"
                    min="0"
                    class="field__input field__input--xs"
                    :value="candyStore.universalCandy.value.m"
                    @input="candyStore.updateUniversalCandy({ m: parseInt(($event.target as HTMLInputElement).value) || 0 })"
                  />
                </label>
                <label class="candyInput">
                  <span class="candyInput__label">{{ t("calc.candy.universalL") }}</span>
                  <input
                    data-testid="settings-universal-candy-l-input"
                    type="number"
                    min="0"
                    class="field__input field__input--xs"
                    :value="candyStore.universalCandy.value.l"
                    @input="candyStore.updateUniversalCandy({ l: parseInt(($event.target as HTMLInputElement).value) || 0 })"
                  />
                </label>
              </div>
            </div>
          </div>
        </section>

        <!-- 睡眠設定 -->
        <section class="section" data-testid="settings-sleep-section">
          <h3>{{ t("settings.sleepTitle") }}</h3>
          <div class="settingsRow">
            <label class="settingsField settingsField--inline settingsField--aligned">
              <span class="settingsField__label">{{ t("calc.sleep.dailySleepLabel") }}</span>
              <input
                data-testid="settings-daily-sleep-hours-input"
                type="number"
                min="1"
                max="13"
                step="0.5"
                class="field__input field__input--xs"
                :value="calc.sleepSettings.value.dailySleepHours"
                @input="calc.updateSleepSettings({ dailySleepHours: Math.max(1, Math.min(13, parseFloat(($event.target as HTMLInputElement).value) || 8.5)) })"
              />
            </label>
            <label class="settingsField settingsField--inline settingsField--aligned">
              <span class="settingsField__label">{{ t("calc.sleep.sleepExpBonusLabel") }}</span>
              <select
                class="field__input field__input--xs"
                data-testid="settings-sleep-exp-bonus-select"
                :value="calc.sleepSettings.value.sleepExpBonusCount"
                @change="calc.updateSleepSettings({ sleepExpBonusCount: parseInt(($event.target as HTMLSelectElement).value) || 0 })"
              >
                <option v-for="n in 6" :key="n - 1" :value="n - 1">{{ n - 1 }}</option>
              </select>
            </label>
            <label class="settingsField settingsField--inline settingsField--checkbox settingsField--aligned" :title="t('calc.sleep.includeGSDTitle')">
              <span class="settingsField__label">{{ t("calc.sleep.includeGSDLabel") }}</span>
              <input
                type="checkbox"
                data-testid="settings-include-gsd-checkbox"
                :checked="calc.sleepSettings.value.includeGSD"
                @change="calc.updateSleepSettings({ includeGSD: ($event.target as HTMLInputElement).checked })"
              />
            </label>
          </div>
        </section>

        <!-- タイプアメ設定 -->
        <section class="section" data-testid="settings-type-candy-section">
          <h3>{{ t("settings.typeCandyTitle") }}</h3>
          <div class="typeCandyGrid" data-testid="settings-type-candy-grid">
            <div v-for="typeName in pokemonTypes" :key="typeName" class="typeRow" :data-testid="'settings-type-row-' + typeName">
              <span class="typeRow__name">{{ getTypeName(typeName, locale) }}</span>
              <label class="candyInput">
                <span class="candyInput__label">{{ t("calc.candy.typeS") }}</span>
                <input
                  :data-testid="'settings-type-candy-' + typeName + '-s-input'"
                  type="number"
                  min="0"
                  class="field__input field__input--xs field__input--compact"
                  :value="candyStore.getTypeCandyFor(typeName).s"
                  @input="candyStore.updateTypeCandy(typeName, { s: parseInt(($event.target as HTMLInputElement).value) || 0 })"
                />
              </label>
              <label class="candyInput">
                <span class="candyInput__label">{{ t("calc.candy.typeM") }}</span>
                <input
                  :data-testid="'settings-type-candy-' + typeName + '-m-input'"
                  type="number"
                  min="0"
                  class="field__input field__input--xs field__input--compact"
                  :value="candyStore.getTypeCandyFor(typeName).m"
                  @input="candyStore.updateTypeCandy(typeName, { m: parseInt(($event.target as HTMLInputElement).value) || 0 })"
                />
              </label>
            </div>
          </div>
        </section>

      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import type { CalcStore } from "../composables/useCalcStore";
import { useCandyStore } from "../composables/useCandyStore";
import { PokemonTypes, getTypeName } from "../domain/pokesleep/pokemon-types";

const props = defineProps<{
  calc: CalcStore;
}>();

const { t, locale } = useI18n();
const candyStore = useCandyStore();
const pokemonTypes = PokemonTypes;
const calc = props.calc;

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
  margin: 0 0 16px;
  padding-bottom: 6px;
  border-bottom: 2px solid color-mix(in oklab, var(--accent) 20%, transparent);
}

/* 設定行（横並び） */
.settingsRow {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 24px;
  margin-bottom: 12px;
}
.settingsRow:last-child {
  margin-bottom: 0;
}

/* 設定フィールド（インライン） */
.settingsField--inline {
  display: flex;
  align-items: center;
  gap: 8px;
}
.settingsField--checkbox {
  cursor: pointer;
}
.settingsField__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  white-space: nowrap;
}
.settingsField__unit {
  font-size: 13px;
  color: var(--muted);
}

/* 万能アメ入力 */
.candyInputs {
  display: flex;
  gap: 12px;
}
.candyInput {
  display: flex;
  align-items: center;
  gap: 4px;
}
.candyInput__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  min-width: 18px;
}

/* タイプアメグリッド */
.typeCandyGrid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px 24px;
}
.typeRow {
  display: flex;
  align-items: center;
  gap: 8px;
}
.typeRow__name {
  font-size: 14px;
  font-weight: 600;
  min-width: 60px;
}

/* 入力欄の共通スタイル */
.field__input {
  padding: 4px 8px;
  border: 1px solid color-mix(in oklab, var(--ink) 15%, transparent);
  border-radius: 6px;
  font-size: 14px;
  background: var(--paper);
  transition: border-color 0.15s;
}
.field__input:focus {
  outline: none;
  border-color: var(--accent);
}
.field__input--sm {
  width: 100px;
  text-align: right;
}
.field__input--xs {
  width: 58px;
  text-align: center;
  text-align-last: center;
}
.field__input--compact {
  width: 58px;
  text-align: center;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes slideIn {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

/* モバイル: 全画面表示 */
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
  .settingsRow {
    flex-direction: column;
    gap: 12px;
  }
  .settingsField--inline {
    justify-content: space-between;
    width: 100%;
  }
  .candyInputs {
    flex-wrap: wrap;
  }
  .typeCandyGrid {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .typeRow {
    justify-content: center; /* Gather to center */
    display: grid;
    grid-template-columns: 120px 100px 78px; /* Label / Input(Fixed) / M-size */
    gap: 8px 12px;
  }
  .settingsField--aligned {
    display: grid;
    grid-template-columns: 120px 100px 78px;
    gap: 8px 12px;
    justify-content: center;
  }
  .settingsField--aligned .settingsField__label {
    /* Align label text to end (closer to input) or start?
       User said "Gather to center".
       Let's keep start for now but close gap. */
    justify-self: start;
    text-align: left;
    width: 100%;
  }
  .settingsField--aligned > input,
  .settingsField--aligned > select {
    justify-self: start;
  }
  .settingsField--aligned.settingsField--checkbox > input {
    justify-self: start;
    width: auto;
  }
  .settingsField--aligned::after {
    content: "";
    display: block;
    grid-column: 3;
    /* Spacer takes up the 3rd column */
  }
  /* Center the inputs in typeRow as well */
  .typeRow .candyInput:nth-of-type(1) {
    justify-self: center;
  }
  .typeRow .candyInput:nth-of-type(2) {
    justify-self: center;
  }

  /* Handy Candy Row Grid Layout */
  .settingsRow--handy {
    display: grid;
    grid-template-columns: 120px 100px 78px;
    justify-content: center;
    gap: 8px 12px;
  }
  .settingsRow--handy .settingsField,
  .settingsRow--handy .candyInputs {
    display: contents; /* Flatten structure */
  }
  .settingsRow--handy .settingsField__label {
    grid-column: 1;
    grid-row: 1 / span 3;
    justify-self: start;
    align-self: center; /* Center relative to the 3 rows block */
    /* Or maybe top? 'align-self: start' plus margin-top to match row 1 */
    align-self: start;
    margin-top: 10px; /* Fine-tune to align with first input text baseline */
    text-align: left;
    width: 100%;
  }

  /* S Candy */
  .settingsRow--handy .candyInput:nth-of-type(1) {
    grid-column: 2; /* Center column */
    grid-row: 1;
    justify-self: center;
  }
  /* M Candy */
  .settingsRow--handy .candyInput:nth-of-type(2) {
    grid-column: 2; /* Center column */
    grid-row: 2;
    justify-self: center;
  }
  /* L Candy */
  .settingsRow--handy .candyInput:nth-of-type(3) {
    grid-column: 2; /* Center column */
    grid-row: 3;
    justify-self: center;
  }
}
</style>
