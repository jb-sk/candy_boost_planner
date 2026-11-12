<template>
  <!-- 何も選んでいないとき: 設定欄（下書き。OK で計算機の設定・在庫へ入る）。
       2段を同じ2列の格子にして枠の端をそろえる。1段目に既定のアメブ目標Lvと最小限のアメブ（アメブのあるスロットだけ）、
       2段目にかけら在庫と万能アメ在庫（S・M・L を1つの枠にまとめる） -->
  <div class="fineTuneEditor__line">
    <div v-if="hasBoost" class="fineTuneEditor__settingsRow" data-testid="fine-tune-editor-settings-boost">
      <!-- 変えると、自動の行（アメブ個数もアメブ目標Lvも選んでいない行）をすぐ新しい既定で配り直す。
           目標Lvに届く最小限のアメブ個数がオンの間は、在庫が足りない行・最小限にできない行（個数指定・睡眠目標モード）と
           追加したときにだけ使う控えの値なので、破線で控えめに出す（使われるので押せなくはしない） -->
      <FineTuneLevelField
        kind="defaultBoostLevel"
        :class="{ 'fineTuneEditor__fallbackLevel': settings.value.minimizeBoost }"
        :data-fallback="settings.value.minimizeBoost ? 'true' : undefined"
        :label="t('settings.defaultBoostReachLevelLabel')"
        :value="settings.value.defaultBoostReachLevel"
        :base="settings.base.defaultBoostReachLevel"
        :min="1"
        :max="MAX_LEVEL"
        :placeholder="t('settings.defaultBoostReachLevelPlaceholder')"
        :disabled="busy"
        @set="(level, coalesce) => emit('op', { kind: 'defaultBoostLevelSet', level }, coalesce)"
        @clear="emit('op', { kind: 'defaultBoostLevelSet', level: null })"
      />
      <!-- 最小限のアメブ: ほかの欄と同じ枠に、名前とスイッチ -->
      <button
        class="fineTuneEditor__switchBox"
        :class="{ 'fineTuneEditor__switchBox--changed': settings.value.minimizeBoost !== settings.base.minimizeBoost }"
        type="button"
        role="switch"
        data-testid="fine-tune-editor-settings-minimize"
        :aria-checked="settings.value.minimizeBoost"
        :disabled="busy"
        @click="emit('op', { kind: 'minimizeBoostSet', on: !settings.value.minimizeBoost })"
      >
        <span class="fineTuneEditor__switchLabel"><FineTuneStackedLabel :text="t('calc.fineTune.settingsMinimize')" /></span>
        <span class="fineTuneEditor__switch" :class="{ 'fineTuneEditor__switch--on': settings.value.minimizeBoost }" aria-hidden="true"></span>
      </button>
    </div>
  </div>
  <div class="fineTuneEditor__line">
    <div class="fineTuneEditor__settingsRow" data-testid="fine-tune-editor-idle">
      <label
        v-for="prop in shardsProps"
        :key="prop.key"
        class="fineTuneEditor__prop"
        :class="{ 'fineTuneEditor__prop--changed': prop.value !== prop.base }"
      >
        <span class="fineTuneEditor__propLabel">{{ prop.label }}</span>
        <FineTuneNumberInput
          class="fineTuneEditor__propInput"
          data-testid="fine-tune-editor-setting"
          :data-setting="prop.key"
          :value="prop.value"
          :input-label="prop.inputLabel"
          :max-length="prop.maxLength"
          :grouping="prop.grouping"
          :disabled="busy"
          :fmt="fmt"
          @commit="(value) => emit('op', prop.op(value))"
        />
      </label>
      <!-- 万能アメ: 1つの枠の中を S・M・L に区切る（名前を3回繰り返さない） -->
      <div
        class="fineTuneEditor__prop fineTuneEditor__universal"
        :class="{ 'fineTuneEditor__prop--changed': universalProps.some((prop) => prop.value !== prop.base) }"
        role="group"
        :aria-label="t('calc.candy.universalLabel')"
      >
        <span class="fineTuneEditor__propLabel">{{ t("calc.fineTune.settingsUniversalGroup") }}</span>
        <div class="fineTuneEditor__universalItems">
          <label
            v-for="prop in universalProps"
            :key="prop.key"
            class="fineTuneEditor__universalItem"
            :class="{ 'fineTuneEditor__universalItem--changed': prop.value !== prop.base }"
          >
            <span class="fineTuneEditor__universalSize" aria-hidden="true">{{ prop.short }}</span>
            <FineTuneNumberInput
              class="fineTuneEditor__propInput"
              data-testid="fine-tune-editor-setting"
              :data-setting="prop.key"
              :value="prop.value"
              :input-label="prop.inputLabel"
              :max-length="prop.maxLength"
              :disabled="busy"
              :fmt="fmt"
              @commit="(value) => emit('op', prop.op(value))"
            />
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { SHARDS_MAX, UNIVERSAL_CANDY_MAX, type FineTuneOp, type UniversalCandySize } from "../domain/fine-tune/draft";
import type { CalcSettingsSnapshot } from "../composables/useCalcStore";
import type { HistoryRecordOptions } from "../composables/useHistory";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";
import FineTuneLevelField from "./FineTuneLevelField.vue";
import FineTuneNumberInput from "./FineTuneNumberInput.vue";
import FineTuneStackedLabel from "./FineTuneStackedLabel.vue";

/**
 * 調整バーの操作の2段のうち、何も選んでいないときの設定欄（既定のアメブ目標Lv・最小限のアメブ・かけら・万能アメ）。
 * 値は親が持つ下書きの設定で、変更は op で返す。
 */
const props = defineProps<{
  /** 下書きで効いている値と開いた時点の値 */
  settings: { value: CalcSettingsSnapshot; base: CalcSettingsSnapshot };
  /** アメブのあるスロット（既定のアメブ目標Lv・最小限のアメブを出す） */
  hasBoost: boolean;
  busy: boolean;
  fmt: (n: number) => string;
}>();

const emit = defineEmits<{
  /** `coalesce` は Lv の欄のスライダーの1回のドラッグの目印（元に戻すの1件にまとめる） */
  (e: "op", op: FineTuneOp, coalesce?: HistoryRecordOptions): void;
}>();

const { t } = useI18n();

// ===== 設定欄（かけら・万能アメ）。欄は FineTuneNumberInput =====
type SettingPropKey = "shards" | UniversalCandySize;

interface SettingProp {
  key: SettingPropKey;
  label: string;
  inputLabel: string;
  value: number;
  base: number;
  /** テンキーで打てる桁数 */
  maxLength: number;
  /** 3桁ごとに区切って出す（かけら） */
  grouping?: boolean;
  /** 枠の中で区切って並べるときの短い名前（万能アメの S・M・L） */
  short?: string;
  op: (value: number) => FineTuneOp;
}

/** かけら在庫・万能アメ在庫 S・M・L */
const settingProps = computed<SettingProp[]>(() => {
  const { settings } = props;
  const shardsLabel = t("calc.maxShardsLabel");
  const universal = (size: UniversalCandySize): SettingProp => {
    const short = t(`calc.candy.universal${size.toUpperCase()}`);
    const label = t("calc.fineTune.settingsUniversal", { size: short });
    return {
      key: size,
      label,
      inputLabel: label,
      short,
      value: settings.value.universalCandy[size],
      base: settings.base.universalCandy[size],
      maxLength: String(UNIVERSAL_CANDY_MAX).length,
      op: (count) => ({ kind: "universalCandySet", size, count }),
    };
  };
  return [
    {
      key: "shards",
      label: shardsLabel,
      inputLabel: shardsLabel,
      value: settings.value.totalShards,
      base: settings.base.totalShards,
      maxLength: String(SHARDS_MAX).length,
      grouping: true,
      op: (count) => ({ kind: "shardsSet", count }),
    },
    universal("s"),
    universal("m"),
    universal("l"),
  ];
});
/** 2段目: かけら（1つの枠）と万能アメ（S・M・L を1つの枠に） */
const shardsProps = computed(() => settingProps.value.filter((prop) => prop.key === "shards"));
const universalProps = computed(() => settingProps.value.filter((prop) => prop.key !== "shards"));
</script>
