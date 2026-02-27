<template>
  <div class="modal-overlay settings-overlay" data-testid="settings-overlay" @click.self="$emit('close')">
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
            <div class="settingsField settingsField--inline settingsField--aligned">
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
