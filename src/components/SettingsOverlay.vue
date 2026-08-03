<template>
  <div class="modal-overlay settings-overlay" data-testid="settings-overlay" @click.self="$emit('close')">
    <div class="modal" role="dialog" aria-modal="true" :aria-label="t('common.settings')" data-testid="settings-modal">
      <header class="modal__header">
        <div class="settingsTabs" role="tablist" :aria-label="t('common.settings')" data-testid="settings-tabs">
          <button
            class="settingsTab"
            :class="{ 'settingsTab--active': activeTab === 'inventory' }"
            id="settings-tab-inventory"
            role="tab"
            :aria-selected="activeTab === 'inventory'"
            aria-controls="settings-panel-inventory"
            :tabindex="activeTab === 'inventory' ? 0 : -1"
            ref="inventoryTabRef"
            data-testid="settings-tab-inventory"
            type="button"
            @click="activeTab = 'inventory'"
            @keydown="onTabKeydown"
          >{{ t("common.settings") }}</button>
          <button
            class="settingsTab"
            :class="{ 'settingsTab--active': activeTab === 'backup' }"
            id="settings-tab-backup"
            role="tab"
            :aria-selected="activeTab === 'backup'"
            aria-controls="settings-panel-backup"
            :tabindex="activeTab === 'backup' ? 0 : -1"
            ref="backupTabRef"
            data-testid="settings-tab-backup"
            type="button"
            @click="activeTab = 'backup'"
            @keydown="onTabKeydown"
          >{{ t("backup.title") }}</button>
        </div>
        <button class="modal__close" data-testid="settings-modal-close" type="button" @click="$emit('close')" :aria-label="t('common.close')">×</button>
      </header>

      <div class="modal__body">

        <div
          v-show="activeTab === 'inventory'"
          id="settings-panel-inventory"
          role="tabpanel"
          aria-labelledby="settings-tab-inventory"
          data-testid="settings-panel-inventory"
        >
          <!-- グローバル設定 -->
          <section class="section" data-testid="settings-global-section">
            <h3>{{ t("settings.globalTitle") }}</h3>
            <div class="settingsRow">
              <label class="settingsField settingsField--inline settingsField--aligned">
                <span class="settingsField__label">{{ t("calc.boostRemainingLabel") }}</span>
                <input
                  data-testid="settings-boost-remaining-input"
                  :value="boostRemainingInputValue"
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  class="field__input field__input--sm"
                  :placeholder="t('calc.boostRemainingPlaceholder', { cap: calc.fmtNum(calc.boostCandyDefaultCap.value) })"
                  :title="t('calc.boostRemainingHelp')"
                  @focus="onBoostRemainingFocus"
                  @input="onBoostRemainingInput(($event.target as HTMLInputElement).value)"
                  @blur="onBoostRemainingBlur"
                  @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
                  :disabled="calc.boostKind.value === 'none'"
                />
              </label>
            </div>
            <!-- 行を追加したときのアメブ目標Lvの既定値。既存の行は書き換えない。
                 空欄＝「目標Lvと同じ」を placeholder で示す。
                 **アプリ全体の設定なので、選択中スロットの種別では無効化しない。**
                 上のアメブ上限はスロットごとの値なので `boostKind` で無効化してよいが、
                 こちらは他のスロットや後の種別変更にも効く。通常アメのスロットを開いている
                 というだけで編集できなくなるのは誤り。 -->
            <div class="settingsRow">
              <label class="settingsField settingsField--inline settingsField--aligned">
                <span class="settingsField__label">{{ t("settings.defaultBoostReachLevelLabel") }}</span>
                <input
                  data-testid="settings-default-boost-reach-input"
                  :value="defaultBoostReachInputValue"
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  class="field__input field__input--sm"
                  :placeholder="t('settings.defaultBoostReachLevelPlaceholder')"
                  :title="t('settings.defaultBoostReachLevelHelp')"
                  @focus="onDefaultBoostReachFocus"
                  @input="onDefaultBoostReachInput(($event.target as HTMLInputElement).value)"
                  @blur="onDefaultBoostReachBlur"
                  @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
                />
              </label>
            </div>
            <!-- 各項目の説明文はヘルプへ移した（設定は入力欄だけにして見通しを保つ）。
                 ここでは title 属性で同じ文言を出す。 -->
            <div class="settingsRow">
              <label class="settingsField settingsField--inline settingsField--aligned">
                <span class="settingsField__label">{{ t("settings.itemCompareModeLabel") }}</span>
                <select
                  class="field__input field__input--sm"
                  data-testid="settings-item-compare-mode-select"
                  :value="calc.itemCompareMode.value"
                  :title="itemCompareModeHelp"
                  @change="setItemCompareModeFromEvent($event)"
                >
                  <option value="surplusFirst">{{ t("settings.itemCompareModeSurplusFirst") }}</option>
                  <option value="surplusGateFirst">{{ t("settings.itemCompareModeSurplusGateFirst") }}</option>
                  <option value="legacyImproved">{{ t("settings.itemCompareModeLegacyImproved") }}</option>
                </select>
              </label>
            </div>
            <div class="settingsRow">
              <label class="settingsField settingsField--inline settingsField--aligned">
                <span class="settingsField__label">{{ t("calc.maxShardsLabel") }}</span>
                <input
                  data-testid="settings-total-shards-input"
                  :value="totalShardsInputValue"
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  class="field__input field__input--sm"
                  @focus="onTotalShardsFocus"
                  @input="onTotalShardsDraftInput(($event.target as HTMLInputElement).value)"
                  @blur="onTotalShardsBlur"
                  @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
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
                      :value="universalCandyInputValue('s')"
                      @focus="onUniversalCandyFocus('s')"
                      @input="onUniversalCandyInput('s', ($event.target as HTMLInputElement).value)"
                      @blur="onUniversalCandyBlur('s')"
                      @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
                    />
                  </label>
                  <label class="candyInput">
                    <span class="candyInput__label">{{ t("calc.candy.universalM") }}</span>
                    <input
                      data-testid="settings-universal-candy-m-input"
                      type="number"
                      min="0"
                      class="field__input field__input--xs"
                      :value="universalCandyInputValue('m')"
                      @focus="onUniversalCandyFocus('m')"
                      @input="onUniversalCandyInput('m', ($event.target as HTMLInputElement).value)"
                      @blur="onUniversalCandyBlur('m')"
                      @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
                    />
                  </label>
                  <label class="candyInput">
                    <span class="candyInput__label">{{ t("calc.candy.universalL") }}</span>
                    <input
                      data-testid="settings-universal-candy-l-input"
                      type="number"
                      min="0"
                      class="field__input field__input--xs"
                      :value="universalCandyInputValue('l')"
                      @focus="onUniversalCandyFocus('l')"
                      @input="onUniversalCandyInput('l', ($event.target as HTMLInputElement).value)"
                      @blur="onUniversalCandyBlur('l')"
                      @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
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
                  :value="dailySleepHoursInputValue"
                  @focus="onDailySleepHoursFocus"
                  @input="onDailySleepHoursInput(($event.target as HTMLInputElement).value)"
                  @blur="onDailySleepHoursBlur"
                  @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
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
                <span class="typeRow__name">{{ getTypeName(typeName, locale.value) }}</span>
                <label class="candyInput">
                  <span class="candyInput__label">{{ t("calc.candy.typeS") }}</span>
                  <input
                    :data-testid="'settings-type-candy-' + typeName + '-s-input'"
                    type="number"
                    min="0"
                    class="field__input field__input--xs field__input--compact"
                    :value="typeCandyInputValue(typeName, 's')"
                    @focus="onTypeCandyFocus(typeName, 's')"
                    @input="onTypeCandyInput(typeName, 's', ($event.target as HTMLInputElement).value)"
                    @blur="onTypeCandyBlur(typeName, 's')"
                    @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
                  />
                </label>
                <label class="candyInput">
                  <span class="candyInput__label">{{ t("calc.candy.typeM") }}</span>
                  <input
                    :data-testid="'settings-type-candy-' + typeName + '-m-input'"
                    type="number"
                    min="0"
                    class="field__input field__input--xs field__input--compact"
                    :value="typeCandyInputValue(typeName, 'm')"
                    @focus="onTypeCandyFocus(typeName, 'm')"
                    @input="onTypeCandyInput(typeName, 'm', ($event.target as HTMLInputElement).value)"
                    @blur="onTypeCandyBlur(typeName, 'm')"
                    @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
                  />
                </label>
              </div>
            </div>
          </section>
        </div>

        <div
          v-show="activeTab === 'backup'"
          id="settings-panel-backup"
          role="tabpanel"
          aria-labelledby="settings-tab-backup"
          data-testid="settings-panel-backup"
        >
          <DataBackupSection :calc="calc" :box="box" />
        </div>

      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { CalcStore } from "../composables/useCalcStore";
import type { BoxStore } from "../composables/useBoxStore";
import type { ItemCompareMode } from "../domain/level-planner/types";
import { useCandyStore } from "../composables/useCandyStore";
import { useDraftField } from "../composables/useDraftField";
import { PokemonTypes, getTypeName } from "../domain/pokesleep/pokemon-types";
import DataBackupSection from "./DataBackupSection.vue";

const props = defineProps<{
  calc: CalcStore;
  box: BoxStore;
}>();

const { t, locale } = useI18n();
const candyStore = useCandyStore();
const pokemonTypes = PokemonTypes;
const calc = props.calc;

const activeTab = ref<"inventory" | "backup">("inventory");
const inventoryTabRef = ref<HTMLButtonElement | null>(null);
const backupTabRef = ref<HTMLButtonElement | null>(null);

const {
  text: boostRemainingInputValue,
  focus: onBoostRemainingFocus,
  input: onBoostRemainingInput,
  blur: onBoostRemainingBlur,
} = useDraftField(() => calc.boostCandyRemainingText.value, (v) => calc.onBoostCandyRemainingInput(v));

const {
  text: totalShardsInputValue,
  focus: onTotalShardsFocus,
  input: onTotalShardsDraftInput,
  blur: onTotalShardsBlur,
} = useDraftField(() => calc.totalShardsText.value, (v) => calc.onTotalShardsInput(v));

// 既定のアメブ目標Lv。空欄は「目標Lvと同じ」（null）を意味する。
const {
  text: defaultBoostReachInputValue,
  focus: onDefaultBoostReachFocus,
  input: onDefaultBoostReachInput,
  blur: onDefaultBoostReachBlur,
} = useDraftField(
  () => (calc.defaultBoostReachLevel.value === null ? "" : String(calc.defaultBoostReachLevel.value)),
  // 生の入力文字列をそのまま渡す。空欄・数値でない入力・範囲外の正規化はストアが担当する。
  (v) => calc.setDefaultBoostReachLevel(v),
);

type UniversalCandySize = "s" | "m" | "l";
type TypeCandySize = "s" | "m";
const universalCandyDraft = reactive<Partial<Record<UniversalCandySize, string>>>({});
const typeCandyDraft = reactive<Record<string, string>>({});

function normalizedStockInput(value: string): number {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function universalCandyInputValue(size: UniversalCandySize): string {
  return universalCandyDraft[size] ?? String(candyStore.universalCandy.value[size]);
}

function onUniversalCandyFocus(size: UniversalCandySize) {
  universalCandyDraft[size] = String(candyStore.universalCandy.value[size]);
}

function onUniversalCandyInput(size: UniversalCandySize, value: string) {
  universalCandyDraft[size] = value;
}

function onUniversalCandyBlur(size: UniversalCandySize) {
  const draft = universalCandyDraft[size];
  if (draft === undefined) return;
  delete universalCandyDraft[size];
  const value = normalizedStockInput(draft);
  if (value !== candyStore.universalCandy.value[size]) {
    calc.updateUniversalCandy({ [size]: value });
  }
}

function typeCandyDraftKey(typeName: string, size: TypeCandySize): string {
  return `${typeName}:${size}`;
}

function typeCandyInputValue(typeName: string, size: TypeCandySize): string {
  return typeCandyDraft[typeCandyDraftKey(typeName, size)]
    ?? String(candyStore.getTypeCandyFor(typeName)[size]);
}

function onTypeCandyFocus(typeName: string, size: TypeCandySize) {
  typeCandyDraft[typeCandyDraftKey(typeName, size)] = String(candyStore.getTypeCandyFor(typeName)[size]);
}

function onTypeCandyInput(typeName: string, size: TypeCandySize, value: string) {
  typeCandyDraft[typeCandyDraftKey(typeName, size)] = value;
}

function onTypeCandyBlur(typeName: string, size: TypeCandySize) {
  const key = typeCandyDraftKey(typeName, size);
  const draft = typeCandyDraft[key];
  if (draft === undefined) return;
  delete typeCandyDraft[key];
  const value = normalizedStockInput(draft);
  if (value !== candyStore.getTypeCandyFor(typeName)[size]) {
    calc.updateTypeCandy(typeName, { [size]: value });
  }
}

function onTabKeydown(event: KeyboardEvent) {
  let next: "inventory" | "backup" | null = null;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    next = activeTab.value === "inventory" ? "backup" : "inventory";
  } else if (event.key === "Home") {
    next = "inventory";
  } else if (event.key === "End") {
    next = "backup";
  }
  if (!next) return;
  event.preventDefault();
  activeTab.value = next;
  void nextTick(() => {
    (next === "inventory" ? inventoryTabRef.value : backupTabRef.value)?.focus();
  });
}

const dailySleepHoursDraft = ref<string | null>(null);
const dailySleepHoursInputValue = computed(() => dailySleepHoursDraft.value ?? String(calc.sleepSettings.value.dailySleepHours));

function isItemCompareMode(value: string): value is ItemCompareMode {
  return value === "surplusFirst" || value === "surplusGateFirst" || value === "legacyImproved";
}

/** 選択中モードの説明。本文はヘルプにあるので、ここは title 属性用。 */
const itemCompareModeHelp = computed(() => {
  const mode = calc.itemCompareMode.value;
  if (mode === "surplusFirst") return t("settings.itemCompareModeSurplusFirstHelp");
  if (mode === "surplusGateFirst") return t("settings.itemCompareModeSurplusGateFirstHelp");
  return t("settings.itemCompareModeLegacyImprovedHelp");
});

function setItemCompareModeFromEvent(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  calc.setItemCompareMode(isItemCompareMode(value) ? value : "surplusFirst");
}

function onDailySleepHoursFocus() {
  dailySleepHoursDraft.value = String(calc.sleepSettings.value.dailySleepHours);
}

function onDailySleepHoursInput(value: string) {
  dailySleepHoursDraft.value = value;
}

function onDailySleepHoursBlur() {
  const draft = dailySleepHoursDraft.value;
  if (draft == null) return;
  dailySleepHoursDraft.value = null;

  const parsed = parseFloat(draft);
  const dailySleepHours = Number.isFinite(parsed) ? Math.max(1, Math.min(13, parsed)) : 8.5;
  calc.updateSleepSettings({ dailySleepHours });
}

// ESCキーで閉じる
const emit = defineEmits<{ (e: "close"): void }>();
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape") emit("close");
};

onMounted(() => window.addEventListener("keydown", handleKeydown));
onUnmounted(() => window.removeEventListener("keydown", handleKeydown));
</script>
