<template>
  <!-- 常に出す。何も選んでいないときは押せない刻みのボタンだけ（見出しは空のまま）。
       見出し・詳細・操作の2段の高さを決めてあり、どの欄を選んでも高さが変わらない（モーダルの高さも変わらない） -->
  <section
    class="fineTuneEditor"
    :class="{ 'fineTuneEditor--idle': row === null }"
    data-testid="fine-tune-editor"
    :data-field="row === null ? undefined : field ?? undefined"
    :data-row-id="row?.id"
    :aria-label="row?.title ?? t('calc.fineTune.hint')"
  >
    <div class="fineTuneEditor__head">
      <template v-if="row !== null">
        <span class="fineTuneEditor__name" data-testid="fine-tune-editor-name">{{ row.title }}</span>
        <!-- EXP補正（性格）。表の名前の横と同じ印 -->
        <span
          v-if="natureMark !== null"
          class="fineTuneEditor__nature fineTuneRow__nature"
          :class="`fineTuneRow__nature--${row.nature}`"
          data-testid="fine-tune-editor-nature"
        >{{ natureMark }}</span>
        <span v-if="fieldLabel !== null" class="fineTuneEditor__field">{{ fieldLabel }}</span>
        <span v-if="changeText !== null" class="fineTuneEditor__change" data-testid="fine-tune-editor-change">{{ changeText }}</span>
      </template>
      <!-- 何も選んでいないとき: 設定欄。行を選んだときの名前と同じ形の見出し -->
      <span v-else-if="settings !== null" class="fineTuneEditor__name" data-testid="fine-tune-editor-settings-label">{{ t("calc.fineTune.field.settings") }}</span>
      <template v-if="row !== null || settings !== null">
        <span class="fineTuneEditor__spacer"></span>
        <!-- 選んだポケモンを、開いた時点の状態へまるごと戻す（どの欄で押しても同じ。選んだまま続けて動かせる）。
             何も選んでいないときは、設定を開いた時点の値へ戻す -->
        <button
          class="fineTuneEditor__resetEdit"
          type="button"
          data-testid="fine-tune-editor-reset"
          :title="t(row !== null ? 'calc.fineTune.resetEditTitle' : 'calc.fineTune.resetSettingsTitle')"
          :disabled="busy || !canReset"
          @click="emit('reset')"
        >
          <svg class="fineTuneEditor__resetIcon" aria-hidden="true" viewBox="0 0 16 16" width="13" height="13"><path d="M3.2 6.2A5 5 0 1 1 3 9.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M2.6 2.8v3.6h3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>{{ t("calc.fineTune.resetEdit") }}</span>
        </button>
      </template>
    </div>

    <p class="fineTuneEditor__info" data-testid="fine-tune-editor-info">
      <span v-for="(item, i) in infoItems" :key="i" :class="`fineTuneEditor__info--${item.tone}`">{{ item.text }}</span>
    </p>

    <!-- 操作は2段。どの欄でも同じ高さの段に置く -->
    <div class="fineTuneEditor__body">
      <!-- 睡眠: 1段目に 200h〜2000h・全て・おひるね島、2段目にチケット・アメ在庫（全て・おひるね島のときだけ） -->
      <template v-if="sleepEditor !== null">
        <div class="fineTuneEditor__line">
          <div class="fineTuneEditor__options" data-testid="fine-tune-editor-sleep" role="group" :aria-label="t('calc.fineTune.field.sleep')">
            <button
              v-for="option in sleepEditor.options"
              :key="option.key"
              class="fineTuneEditor__option"
              :class="{ 'fineTuneEditor__option--on': option.selected, 'fineTuneEditor__option--wide': option.key === 'nap' }"
              type="button"
              data-testid="fine-tune-editor-sleep-option"
              :data-option="option.key"
              :aria-pressed="option.selected"
              :disabled="busy"
              @click="chooseSleep(option.choice)"
            >
              <template v-if="option.short !== option.label">
                <span class="fineTuneEditor__optionLabel fineTuneEditor__optionLabel--full">{{ option.label }}</span>
                <span class="fineTuneEditor__optionLabel fineTuneEditor__optionLabel--short">{{ option.short }}</span>
              </template>
              <template v-else>{{ option.label }}</template>
            </button>
          </div>
        </div>
        <div class="fineTuneEditor__line">
          <div class="fineTuneEditor__checks">
            <button
              class="fineTuneEditor__toggle"
              :class="{ 'fineTuneEditor__toggle--on': sleepEditor.ticket }"
              type="button"
              data-testid="fine-tune-editor-sleep-ticket"
              :aria-pressed="sleepEditor.ticket"
              :disabled="busy || !sleepEditor.canTicket"
              @click="toggleSleep('ticket')"
            ><span class="fineTuneEditor__toggleIcon" aria-hidden="true">{{ SLEEP_TICKET_EMOJI }}</span>{{ t("calc.fineTune.sleepOption.ticket") }}</button>
            <button
              class="fineTuneEditor__toggle"
              :class="{ 'fineTuneEditor__toggle--on': sleepEditor.stock }"
              type="button"
              data-testid="fine-tune-editor-sleep-stock"
              :aria-pressed="sleepEditor.stock"
              :disabled="busy || !sleepEditor.canStock"
              @click="toggleSleep('stock')"
            ><span class="fineTuneEditor__toggleIcon" aria-hidden="true">{{ SLEEP_STOCK_EMOJI }}</span>{{ t("calc.fineTune.sleepOption.stock") }}</button>
          </div>
        </div>
      </template>

      <!-- 目標Lv: 1段目に Lv の欄だけ（アメブ目標Lv・現在Lvと同じ形・同じ幅。直接打つか ▾ の Lvピッカー）。2段目は空ける -->
      <template v-else-if="stepper !== null && field === 'target'">
        <div class="fineTuneEditor__line">
          <div class="fineTuneEditor__levelRow" data-testid="fine-tune-editor-level">
            <FineTuneLevelField
              class="fineTuneEditor__levelField"
              kind="target"
              :label="stepper.label"
              :value="stepper.value"
              :base="stepper.base"
              :min="stepper.min"
              :max="stepper.max"
              :from="row!.individual.srcLevel.value"
              :disabled="busy"
              @set="setLevel"
            />
          </div>
        </div>
        <div class="fineTuneEditor__line"></div>
      </template>

      <!-- アメブ・アメ: 1段目に最小アメブ・再計算と「〇〇のLvを上げる」（アメブのとき）、2段目に刻みのボタンと個数欄 -->
      <template v-else-if="stepper !== null">
        <div class="fineTuneEditor__line">
          <div v-if="boostTools !== null" class="fineTuneEditor__tools">
            <!-- アメブ目標Lv（計算機のアメブ目標Lvと同じ。選ぶと個数は自動へ戻り、そのLvまでをアメブで賄う）。
                 現在Lv・目標Lvと同じ形の Lv の欄（目標Lvと同じ幅） -->
            <FineTuneLevelField
              v-if="boostTools.level !== null"
              class="fineTuneEditor__levelField"
              kind="boostLevel"
              :label="t('calc.row.boostReachLevel')"
              :value="boostTools.level.value"
              :base="boostTools.level.base"
              :min="boostTools.level.range.min"
              :max="boostTools.level.range.max"
              :from="row!.individual.srcLevel.value"
              :disabled="busy || boostTools.level.disabled"
              @set="(level, coalesce) => emit('op', { kind: 'boostLevelSet', rowId: row!.id, level }, coalesce)"
            />
            <!-- 最小アメブ（手持ちのアメから最小限のアメブを自動で決める）と再計算（計算機の ↺ と同じ。自動の値へ戻す） -->
            <!-- 入れられないとき（アメが足りない・設定で全員が最小アメブ・在庫の種族が無い）は押せない見た目にし、押すと理由を出す -->
            <button
              class="fineTuneEditor__tool"
              :class="{ 'fineTuneEditor__tool--on': boostTools.minimized, 'fineTuneEditor__tool--off': boostTools.blocked }"
              type="button"
              data-testid="fine-tune-editor-minimize"
              :aria-pressed="boostTools.minimized"
              :aria-disabled="boostTools.blocked ? 'true' : undefined"
              :title="boostTools.minimizeTitle"
              :disabled="busy"
              @click="toggleMinimize"
            >{{ t("calc.fineTune.boostMinimize") }}</button>
            <button
              class="fineTuneEditor__tool"
              type="button"
              data-testid="fine-tune-editor-boost-reset"
              :title="t('calc.fineTune.boostResetTitle')"
              :disabled="busy || !boostTools.manual"
              @click="emit('op', { kind: 'boostReset', rowId: row!.id })"
            >{{ t("calc.fineTune.boostReset") }}</button>
            <button
              v-if="recommendation !== null"
              class="fineTuneEditor__recommend fineTuneEditor__recommend--inline"
              type="button"
              data-testid="fine-tune-editor-recommend"
              :title="recommendTitle"
              :aria-label="recommendTitle"
              :disabled="pending || busy"
              @click="emit('op', { kind: 'set', rowId: row!.id, boost: recommendation.boost })"
            >
              <!-- アメブ目標Lv・最小アメブ・再計算と同じ段なので、入らないものから丸ごと省く（途中で切らない）。
                   省く順は名前 →「アメブ」で、増減の数は残す。そのため右から 数・アメブ・名前 の順に並べる（全文は title） -->
              <span class="fineTuneEditor__recommendAmount" data-testid="fine-tune-editor-recommend-delta">{{ recommendDelta }}</span>
              <span class="fineTuneEditor__recommendField">{{ t("calc.fineTune.field.boost") }}</span>
              <span class="fineTuneEditor__recommendLabel">{{ recommendLabel }}</span>
            </button>
          </div>
        </div>
        <div class="fineTuneEditor__line">
          <div class="fineTuneEditor__stepper" :class="`fineTuneEditor__stepper--${stepper.steps.length}`">
            <button
              v-for="amount in stepper.steps"
              :key="`down-${amount}`"
              class="fineTuneEditor__step"
              type="button"
              data-testid="fine-tune-editor-step"
              :data-delta="-amount"
              :aria-label="t('calc.fineTune.stepAria', { field: stepper.label, delta: `−${amount}` })"
              :disabled="busy || stepper.value <= stepper.min"
              @click="stepBy(-amount)"
            >−{{ amount }}</button>
            <input
              ref="inputRef"
              v-keypad="stepper.inputLabel"
              class="field__input fineTuneEditor__input"
              data-testid="fine-tune-editor-input"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              :aria-label="stepper.inputLabel"
              :disabled="busy"
              :value="draft ?? String(stepper.value)"
              @focus="draft = String(stepper.value)"
              @input="onInput(($event.target as HTMLInputElement).value)"
              @blur="onBlur"
              @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
            />
            <button
              v-for="amount in [...stepper.steps].reverse()"
              :key="`up-${amount}`"
              class="fineTuneEditor__step"
              type="button"
              data-testid="fine-tune-editor-step"
              :data-delta="amount"
              :aria-label="t('calc.fineTune.stepAria', { field: stepper.label, delta: `+${amount}` })"
              :disabled="busy || stepper.value >= stepper.max"
              @click="stepBy(amount)"
            >+{{ amount }}</button>
          </div>
        </div>
      </template>

      <!-- 行の詳細（名前を押したとき）: 1段目に現在Lv（目標Lv・アメブ目標Lvと同じ形の Lv の欄）・あとEXP・アメ在庫の欄
           （直接打つ。タッチ端末はテンキー）、2段目に動かせない理由か「〇〇のLvを上げる」 -->
      <template v-else-if="rowProps !== null">
        <div class="fineTuneEditor__line">
          <div class="fineTuneEditor__props">
            <FineTuneLevelField
              kind="srcLevel"
              :label="t('calc.row.srcLevel')"
              :value="row!.individual.srcLevel.value"
              :base="row!.individual.srcLevel.base"
              :min="row!.individual.srcLevel.min"
              :max="row!.individual.srcLevel.max"
              :disabled="busy || !row!.individual.editable"
              @set="(level, coalesce) => emit('op', { kind: 'srcLevelSet', rowId: row!.id, level }, coalesce)"
            />
            <label
              v-for="prop in rowProps"
              :key="prop.key"
              class="fineTuneEditor__prop"
              :class="{ 'fineTuneEditor__prop--changed': prop.value !== prop.base, 'fineTuneEditor__prop--disabled': prop.disabled }"
            >
              <span class="fineTuneEditor__propLabel">{{ prop.label }}</span>
              <input
                v-keypad="{ label: prop.inputLabel, maxLength: prop.maxLength }"
                class="fineTuneEditor__propInput"
                data-testid="fine-tune-editor-prop"
                :data-prop="prop.key"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                :maxlength="prop.maxLength"
                :aria-label="prop.inputLabel"
                :disabled="busy || prop.disabled"
                :value="propDraft?.key === prop.key ? propDraft.text : propText(prop)"
                @focus="onPropFocus(prop, $event.target as HTMLInputElement)"
                @input="onPropInput(prop.key, ($event.target as HTMLInputElement).value)"
                @blur="onPropBlur(prop.key, $event.target as HTMLInputElement)"
                @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
              />
            </label>
          </div>
        </div>
        <div class="fineTuneEditor__line">
          <p v-if="noteText !== null" class="fineTuneEditor__note" data-testid="fine-tune-editor-note">{{ noteText }}</p>
          <button
            v-else-if="recommendation !== null"
            class="fineTuneEditor__recommend"
            type="button"
            data-testid="fine-tune-editor-recommend"
            :title="recommendTitle"
            :disabled="pending || busy"
            @click="emit('op', { kind: 'set', rowId: row!.id, boost: recommendation.boost })"
          >
            <span class="fineTuneEditor__recommendLabel">{{ recommendLabel }}</span>
            <span class="fineTuneEditor__recommendDelta" data-testid="fine-tune-editor-recommend-delta">{{ t("calc.fineTune.field.boost") }}{{ recommendDelta }}</span>
            <span v-if="recommendation.insufficient" class="fineTuneEditor__recommendNote">{{ t("calc.fineTune.recommendInsufficient") }}</span>
          </button>
        </div>
      </template>

      <!-- 何も選んでいないとき: 設定欄（下書き。OK で計算機の設定・在庫へ入る）。
           2段を同じ2列の格子にして枠の端をそろえる。1段目に既定のアメブ目標Lvと最小限のアメブ（アメブのあるスロットだけ）、
           2段目にかけら在庫と万能アメ在庫（S・M・L を1つの枠にまとめる） -->
      <template v-else-if="row === null && settings !== null">
        <div class="fineTuneEditor__line">
          <div v-if="hasBoost" class="fineTuneEditor__settingsRow" data-testid="fine-tune-editor-settings-boost">
            <!-- 変えると、自動の行（アメブ個数もアメブ目標Lvも選んでいない行）をすぐ新しい既定で配り直す -->
            <FineTuneLevelField
              kind="defaultBoostLevel"
              :label="t('settings.defaultBoostReachLevelLabel')"
              :value="settings.value.defaultBoostReachLevel"
              :base="settings.base.defaultBoostReachLevel"
              :min="1"
              :max="MAX_LEVEL"
              :placeholder="t('settings.defaultBoostReachLevelPlaceholder')"
              :disabled="busy"
              :title="t('settings.defaultBoostReachLevelHelp')"
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
              :title="t('settings.minimizeBoostLabel')"
              :disabled="busy"
              @click="emit('op', { kind: 'minimizeBoostSet', on: !settings.value.minimizeBoost })"
            >
              <span class="fineTuneEditor__switchLabel">{{ t("calc.fineTune.settingsMinimize") }}</span>
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
              <input
                v-keypad="{ label: prop.inputLabel, maxLength: prop.maxLength, grouping: prop.grouping }"
                class="fineTuneEditor__propInput"
                data-testid="fine-tune-editor-setting"
                :data-setting="prop.key"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                :maxlength="prop.maxLength"
                :aria-label="prop.inputLabel"
                :disabled="busy"
                :value="propDraft?.key === prop.key ? propDraft.text : propText(prop)"
                @focus="onPropFocus(prop, $event.target as HTMLInputElement)"
                @input="onPropInput(prop.key, ($event.target as HTMLInputElement).value)"
                @blur="onPropBlur(prop.key, $event.target as HTMLInputElement)"
                @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
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
                  <input
                    v-keypad="{ label: prop.inputLabel, maxLength: prop.maxLength }"
                    class="fineTuneEditor__propInput"
                    data-testid="fine-tune-editor-setting"
                    :data-setting="prop.key"
                    type="text"
                    inputmode="numeric"
                    autocomplete="off"
                    :maxlength="prop.maxLength"
                    :aria-label="prop.inputLabel"
                    :disabled="busy"
                    :value="propDraft?.key === prop.key ? propDraft.text : propText(prop)"
                    @focus="onPropFocus(prop, $event.target as HTMLInputElement)"
                    @input="onPropInput(prop.key, ($event.target as HTMLInputElement).value)"
                    @blur="onPropBlur(prop.key, $event.target as HTMLInputElement)"
                    @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- 選んだ欄が動かせなくなったとき: 2段とも空ける（高さはそのまま） -->
      <template v-else>
        <div class="fineTuneEditor__line"></div>
        <div class="fineTuneEditor__line"></div>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import { SHARDS_MAX, UNIVERSAL_CANDY_MAX, type FineTuneOp, type RowExclusion, type UniversalCandySize } from "../domain/fine-tune/draft";
import type { CalcSettingsSnapshot } from "../composables/useCalcStore";
import type { FineTuneRowView } from "../domain/fine-tune/rowView";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";
import { vKeypad } from "../composables/useNumericKeypad";
import type { HistoryRecordOptions } from "../composables/useHistory";
import FineTuneLevelField from "./FineTuneLevelField.vue";
import { showToast } from "../composables/useToast";
import {
  FINE_TUNE_REASON_TOAST,
  FINE_TUNE_STEPS,
  SLEEP_STOCK_EMOJI,
  SLEEP_TICKET_EMOJI,
  sleepReachText,
  sleepTargetText,
  type FineTuneField,
} from "../utils/fineTuneView";
import { SLEEP_TARGET_HOURS_OPTIONS } from "../domain/types";
import { sleepTargetOfChoice, type SleepTargetChoice } from "../domain/sleep-target";

/**
 * シンプルの調整バー。表で押した欄（目標Lv・アメブ・アメ）を刻みのボタンと個数欄で、睡眠を選択肢で動かす。
 * 現在Lv・目標Lv・アメブ目標Lvは同じ形の Lv の欄（`FineTuneLevelField`。直接打つか、計算機と同じ Lvピッカー）。
 * 目標Lvは Lv の欄だけ（スライダー・Lv の丸いボタンは ▾ の Lvピッカーの中）。アメブにはアメブ目標Lv・最小アメブ・再計算も置く（2段に収める）。
 * 見出しのリセットは、選んだポケモンをモーダルを開いた時点の状態へまるごと戻す（戻すのは親。`canReset` と `reset`）。
 * 行の詳細（名前を押したとき）では、現在Lv・あとEXP（個体）とアメ在庫（その行の進化系）を直接打って変えられる。
 * 到達・睡眠のあと・足りないもの・動かせない理由と「〇〇のLvを上げる」もここに出す。見出しの名前の横に EXP補正（▲▲▼▼）を出す。
 * 見出し・詳細・操作の2段はどの欄でも同じ高さ（選ぶ欄を変えても、調整バーとモーダルの高さが変わらない）。
 * 値と範囲は `FineTuneRowView` に入っているものを使い、op を投げるだけ（範囲に収めるのは reducer）。
 */
const props = defineProps<{
  /** 選んだ行。何も選んでいなければ null（押せない刻みのボタンだけを出す） */
  row: FineTuneRowView | null;
  field: FineTuneField | null;
  /** 最新の結果が今の下書きの結果でない。結果に頼る操作（おすすめ）を押せなくする */
  pending: boolean;
  /** 「全体のLvを伸ばす」を求めている間。どの操作も押せなくする */
  busy: boolean;
  /** 設定で全員に最小アメブを使っている（行ごとの最小アメブは切り替えられない） */
  globalMinimize: boolean;
  /** 選んだポケモン（何も選んでいないときは設定）が開いた時点から変わっている（リセットで開いた時点へ戻せる） */
  canReset: boolean;
  /** 設定欄（何も選んでいないときに出す）の、下書きで効いている値と開いた時点の値 */
  settings: { value: CalcSettingsSnapshot; base: CalcSettingsSnapshot } | null;
  /** アメブのあるスロット（設定欄に既定のアメブ目標Lv・最小限のアメブを出す） */
  hasBoost: boolean;
  fmt: (n: number) => string;
  titleOf: (rowId: string) => string;
}>();

const emit = defineEmits<{
  /** `coalesce` は Lv の欄のスライダーの1回のドラッグの目印（元に戻すの1件にまとめる） */
  (e: "op", op: FineTuneOp, coalesce?: HistoryRecordOptions): void;
  /** リセット（選んだポケモンを開いた時点の状態へ戻す。何も選んでいないときは設定を戻す。選択はそのまま） */
  (e: "reset"): void;
}>();

const { t } = useI18n();

const EXCLUSION_TEXT: Readonly<Record<RowExclusion, string>> = {
  candyTarget: "calc.fineTune.exclusion.candyTarget",
  noCandy: "calc.fineTune.exclusion.noCandy",
  sleepOnly: "calc.fineTune.exclusion.sleepOnly",
  maxLevel: "calc.fineTune.exclusion.maxLevel",
  unknownPokemon: "calc.fineTune.exclusion.unknownPokemon",
};

const FACTOR_TEXT = {
  candy: "calc.fineTune.factor.candy",
  shards: "calc.fineTune.factor.shards",
  boost: "calc.fineTune.factor.boost",
} as const;

interface Stepper {
  label: string;
  inputLabel: string;
  value: number;
  base: number;
  min: number;
  max: number;
  steps: readonly number[];
  stepOp: (by: number) => FineTuneOp;
  setOp: (value: number) => FineTuneOp;
}

/** 選んだ欄の刻み・範囲・op。動かせない欄（行の詳細）は null */
const stepper = computed<Stepper | null>(() => {
  const { row, field } = props;
  if (row === null) return null;
  const rowId = row.id;
  const labelOf = (key: "target" | "boost" | "candy") => t(`calc.fineTune.field.${key}`);
  const inputLabelOf = (label: string) => t("calc.fineTune.inputAria", { field: label, name: row.title });
  // アメブを動かせない行（睡眠だけで届く・アメを使わない睡眠目標・個数指定）も、目標Lvは計算機と同じく動かせる
  if (field === "target" && row.targetAdjustable) {
    const label = labelOf("target");
    return {
      label,
      inputLabel: inputLabelOf(label),
      value: row.targetLevel.value,
      base: row.targetLevel.base,
      min: row.targetLevel.range.min,
      max: row.targetLevel.range.max,
      // 目標Lvは刻みのボタンでなく、Lv の欄（直接打つか Lvピッカー）で動かす
      steps: [],
      stepOp: (by) => ({ kind: "targetStep", rowId, by }),
      setOp: (level) => ({ kind: "targetSet", rowId, level }),
    };
  }
  if (field === "boost" && row.levelAdjustable && row.boost !== null) {
    const label = labelOf("boost");
    return {
      label,
      inputLabel: inputLabelOf(label),
      value: row.boost.value,
      base: row.boost.base,
      min: row.boost.range.min,
      max: row.boost.range.max,
      steps: FINE_TUNE_STEPS.boost,
      stepOp: (by) => ({ kind: "step", rowId, by }),
      setOp: (boost) => ({ kind: "set", rowId, boost }),
    };
  }
  if (field === "candy" && row.candyEdit !== null) {
    const label = labelOf("candy");
    return {
      label,
      inputLabel: inputLabelOf(label),
      value: row.candyEdit.value,
      base: row.candyEdit.base,
      min: row.candyEdit.min,
      max: row.candyEdit.max,
      steps: FINE_TUNE_STEPS.candy,
      stepOp: (by) => ({ kind: "candyStep", rowId, by }),
      setOp: (candy) => ({ kind: "candySet", rowId, candy }),
    };
  }
  return null;
});

/** 見出しの欄の名前（行の詳細・何も選んでいないときは出さない） */
const fieldLabel = computed(() => {
  if (props.row === null) return null;
  if (stepper.value !== null) return stepper.value.label;
  return props.field === "sleep" ? t("calc.fineTune.field.sleep") : null;
});

/** 基準からの変化（変わっていなければ null）。睡眠は目標の名前で出す */
const changeText = computed(() => {
  const { row, field } = props;
  if (row !== null && field === "sleep") {
    if (!row.sleepTarget.changed) return null;
    const label = (choice: SleepTargetChoice) => {
      const text = sleepTargetText(t, choice);
      return `${choice.base === "none" ? t("calc.fineTune.sleepOption.none") : text.name}${text.icons}`;
    };
    return `${label(row.sleepTarget.base)} → ${label(row.sleepTarget.choice)}`;
  }
  const s = stepper.value;
  if (s === null || s.value === s.base) return null;
  return `${props.fmt(s.base)} → ${props.fmt(s.value)}`;
});

/** EXP補正（性格）の印。補正なしは null */
const natureMark = computed(() => {
  const nature = props.row?.nature;
  if (nature === "up") return t("calc.row.natureUp");
  if (nature === "down") return t("calc.row.natureDown");
  return null;
});

// ===== 行の詳細 =====
/** 詳細の1つ。`danger` は足りないもの、`note` は睡眠の欄で出す動かせない理由 */
type InfoTone = "normal" | "danger" | "note";

const infoItems = computed(() => {
  const { row } = props;
  const items: Array<{ text: string; tone: InfoTone }> = [];
  // 設定欄は、何の設定かを1行で添える（空いた段を残さない）
  if (row === null) return props.settings === null ? items : [{ text: t("calc.fineTune.settingsNote"), tone: "note" }];
  const level = row.reachLevel.value;
  if (level !== null) {
    const exp = row.expToNext.value;
    // 計算機の行と同じ「到達Lv 63（あとEXP 358）」。あとEXP は次のLvまでのEXP
    const left = level < MAX_LEVEL && exp !== null && exp > 0 ? t("calc.fineTune.expLeft", { exp: props.fmt(exp) }) : "";
    items.push({ text: `${t("calc.fineTune.reach", { level })}${left}`, tone: "normal" });
  }
  if (row.sleepReach !== null) {
    const key = row.sleepReach.kind === "napIsland" ? "calc.fineTune.napReach" : "calc.fineTune.sleepReach";
    items.push({ text: t(key, { level: sleepReachText(row.sleepReach) }), tone: "normal" });
  }
  if (row.limitingFactor !== null) {
    items.push({ text: t("calc.fineTune.short", { factor: t(FACTOR_TEXT[row.limitingFactor]) }), tone: "danger" });
  }
  const cappedTo = row.boost?.cappedTo ?? null;
  if (props.field === "boost" && cappedTo !== null) {
    items.push({ text: t("calc.fineTune.boostCapped", { count: props.fmt(cappedTo) }), tone: "normal" });
  }
  // 睡眠の欄は操作の2段を選択肢で使うので、睡眠に関わる理由（アメを使わない・睡眠だけで届く など）はここに添える。
  // 個数指定（アメブを動かせない）は睡眠の操作に関わらないので出さない
  if (props.field === "sleep" && row.exclusion !== null && row.exclusion !== "candyTarget") {
    items.push({ text: t(EXCLUSION_TEXT[row.exclusion]), tone: "note" });
  }
  return items;
});

/** アメブを動かせない理由（行の詳細で出す。睡眠の欄は詳細の行に添える） */
const noteText = computed(() => {
  const { row, field } = props;
  if (row === null || field !== "row") return null;
  if (row.candyEdited) return t("calc.fineTune.candyEdited");
  return row.exclusion === null ? null : t(EXCLUSION_TEXT[row.exclusion]);
});

// ===== 「〇〇のLvを上げる」（行の詳細とアメブで出す） =====
const recommendation = computed(() => {
  if (props.row === null || (props.field !== "row" && props.field !== "boost")) return null;
  if (!props.row.levelAdjustable) return null;
  return props.row.advice?.recommendation ?? null;
});

const recommendLabel = computed(() => {
  const rec = recommendation.value;
  if (rec === null) return "";
  return t(rec.andOthers ? "calc.fineTune.recommendMany" : "calc.fineTune.recommend", { name: props.titleOf(rec.targetRowId) });
});

/** 「〇〇のLvを上げる」の全文（狭い幅では名前を省くので、ホバーで全文を出す） */
const recommendTitle = computed(() => {
  const rec = recommendation.value;
  if (rec === null) return undefined;
  const text = `${recommendLabel.value} ${t("calc.fineTune.field.boost")}${recommendDelta.value}`;
  return rec.insufficient ? `${text}（${t("calc.fineTune.recommendInsufficient")}）` : text;
});

const recommendDelta = computed(() => {
  const rec = recommendation.value;
  const current = props.row?.boost?.value;
  if (rec === null || current === undefined) return "";
  const delta = rec.boost - current;
  return `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${props.fmt(Math.abs(delta))}`;
});

// ===== アメブの最小アメブ・リセット =====
const boostTools = computed(() => {
  const { row, field } = props;
  if (row === null || field !== "boost" || !row.levelAdjustable || row.boost === null) return null;
  const { minimized, canMinimize, shortCandy, neededCandy, manual } = row.boost;
  // 入れられない理由（入っていれば外せるので null）。アメが足りず最小アメブにしても届かない行は、入れても既定のアメブへ戻るだけ
  const blockedReason = minimized ? null
    : props.globalMinimize ? t("calc.fineTune.boostMinimizeGlobal")
      : !canMinimize ? t("calc.fineTune.boostMinimizeUnavailable")
        : shortCandy
          ? neededCandy === null
            ? t("calc.fineTune.boostMinimizeShortCandy")
            // 計算機のヒントと同じ「〇個以上のアメが必要です。現在は既定のアメブ目標Lvを使用しています。」
            : t("calc.row.boostMinimizeFallbackHint", { count: props.fmt(neededCandy) })
          : null;
  return {
    level: row.boost.level,
    minimized,
    manual,
    blocked: blockedReason !== null,
    blockedReason,
    minimizeTitle: blockedReason ?? t("calc.fineTune.boostMinimizeTitle"),
  };
});

/** 最小アメブを切り替える。入れられないときは理由だけを出す */
function toggleMinimize(): void {
  const tools = boostTools.value;
  if (tools === null || props.row === null) return;
  if (tools.blockedReason !== null) {
    showToast(tools.blockedReason, FINE_TUNE_REASON_TOAST);
    return;
  }
  emit("op", { kind: "boostMinimize", rowId: props.row.id, on: !tools.minimized });
}

// ===== 睡眠目標 =====
const sleepEditor = computed(() => {
  const { row, field } = props;
  if (row === null || field !== "sleep") return null;
  const current = row.sleepTarget.choice;
  const stock = (current.base === "sleep" || current.base === "napIsland") && current.stock;
  const ticket = current.base === "napIsland" && current.ticket;
  const none = t("calc.fineTune.sleepOption.none");
  const all = t("calc.fineTune.sleepOption.all");
  // おひるね島だけ、とても狭い幅では「島」と縮める（表の睡眠の欄と同じ）
  const options: Array<{ key: string; label: string; short: string; choice: SleepTargetChoice; selected: boolean }> = [
    { key: "none", label: none, short: none, choice: { base: "none" }, selected: current.base === "none" },
    ...SLEEP_TARGET_HOURS_OPTIONS.map((hours) => {
      const name = sleepTargetText(t, { base: "hours", hours }).name;
      return {
        key: `h${hours}`,
        label: name,
        short: name,
        choice: { base: "hours", hours } as SleepTargetChoice,
        selected: current.base === "hours" && current.hours === hours,
      };
    }),
    // 全て・おひるね島へ移るときは、アメ在庫の印を持ち越す（チケットはおひるね島どうしだけ）
    { key: "sleep", label: all, short: all, choice: { base: "sleep", stock }, selected: current.base === "sleep" },
    {
      key: "nap",
      label: t("calc.fineTune.sleepOption.nap"),
      short: t("calc.fineTune.sleepOption.napShort"),
      choice: { base: "napIsland", stock, ticket },
      selected: current.base === "napIsland",
    },
  ];
  return {
    options,
    stock,
    ticket,
    canStock: current.base === "sleep" || current.base === "napIsland",
    canTicket: current.base === "napIsland",
  };
});

function chooseSleep(choice: SleepTargetChoice): void {
  if (props.row === null) return;
  emit("op", { kind: "sleepSet", rowId: props.row.id, target: sleepTargetOfChoice(choice) });
}

function toggleSleep(which: "stock" | "ticket"): void {
  const current = props.row?.sleepTarget.choice;
  if (current === undefined) return;
  if (current.base === "sleep" && which === "stock") chooseSleep({ ...current, stock: !current.stock });
  if (current.base === "napIsland") chooseSleep({ ...current, [which]: !current[which] });
}

// ===== 行の詳細の欄（あとEXP・アメ在庫）と設定欄（かけら・万能アメ）。確定は blur。テンキーは ui_spec §8 =====
/** 現在Lvは Lv の欄（`FineTuneLevelField`）で動かすので、ここには入れない */
type RowPropKey = "exp" | "stock" | "shards" | UniversalCandySize;

interface RowProp {
  key: RowPropKey;
  label: string;
  inputLabel: string;
  /** 今の値（種族不明の行の在庫は null） */
  value: number | null;
  base: number | null;
  disabled: boolean;
  /** テンキーで打てる桁数 */
  maxLength: number;
  /** 3桁ごとに区切って出す（かけら） */
  grouping?: boolean;
  /** 枠の中で区切って並べるときの短い名前（万能アメの S・M・L） */
  short?: string;
  op: (value: number) => FineTuneOp;
}

/** 欄に出す文字（打っていない間）。区切る欄は 3桁ごとに区切る */
function propText(prop: RowProp): string {
  if (prop.value === null) return "";
  return prop.grouping ? props.fmt(prop.value) : String(prop.value);
}

/** 設定欄: かけら在庫・万能アメ在庫 S・M・L */
const settingProps = computed<RowProp[] | null>(() => {
  const { row, settings } = props;
  if (row !== null || settings === null) return null;
  const shardsLabel = t("calc.maxShardsLabel");
  const universal = (size: UniversalCandySize): RowProp => {
    const short = t(`calc.candy.universal${size.toUpperCase()}`);
    const label = t("calc.fineTune.settingsUniversal", { size: short });
    return {
      key: size,
      label,
      inputLabel: label,
      short,
      value: settings.value.universalCandy[size],
      base: settings.base.universalCandy[size],
      disabled: false,
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
      disabled: false,
      maxLength: String(SHARDS_MAX).length,
      grouping: true,
      op: (count) => ({ kind: "shardsSet", count }),
    },
    universal("s"),
    universal("m"),
    universal("l"),
  ];
});
/** 設定欄の2段目: かけら（1つの枠）と万能アメ（S・M・L を1つの枠に） */
const shardsProps = computed(() => settingProps.value?.filter((prop) => prop.key === "shards") ?? []);
const universalProps = computed(() => settingProps.value?.filter((prop) => prop.key !== "shards") ?? []);

const rowProps = computed<RowProp[] | null>(() => {
  const { row, field } = props;
  if (row === null || field !== "row") return null;
  const rowId = row.id;
  const { expRemaining, editable } = row.individual;
  const inputLabelOf = (label: string) => t("calc.fineTune.inputAria", { field: label, name: row.title });
  const expLabel = t("calc.row.expRemaining");
  const stockLabel = t("calc.row.speciesCandy");
  return [
    {
      key: "exp",
      label: expLabel,
      inputLabel: inputLabelOf(expLabel),
      value: expRemaining.value,
      base: expRemaining.base,
      // Lv70 は次のLvが無い
      disabled: !editable || expRemaining.max <= 0,
      maxLength: 6,
      op: (exp) => ({ kind: "expRemainingSet", rowId, exp }),
    },
    {
      key: "stock",
      label: stockLabel,
      inputLabel: inputLabelOf(stockLabel),
      value: row.stock?.value ?? null,
      base: row.stock?.base ?? null,
      disabled: row.stock === null,
      maxLength: 7,
      op: (count) => ({ kind: "stockSet", rowId, count }),
    },
  ];
});

/** 打ちかけの欄と文字（フォーカスしている間だけ） */
const propDraft = ref<{ key: RowPropKey; text: string } | null>(null);

/** 打ち始め。区切った表示（1,450,000）は、その場で数字だけに戻す（描き直しを待つと、打ち始めた文字の前に元の表示が残る） */
function onPropFocus(prop: RowProp, el: HTMLInputElement): void {
  const text = prop.value === null ? "" : String(prop.value);
  propDraft.value = { key: prop.key, text };
  if (el.value === text) return;
  // 表示を変えるとカーソルが末尾へ移るので、全体を選び直す（打つと置き換わる）
  el.value = text;
  el.select();
  void nextTick(() => {
    if (document.activeElement === el) el.select();
  });
}

function onPropInput(key: RowPropKey, raw: string): void {
  propDraft.value = { key, text: raw.replace(/[^0-9]/g, "") };
}

function onPropBlur(key: RowPropKey, el: HTMLInputElement): void {
  const draftText = propDraft.value?.key === key ? propDraft.value.text : null;
  propDraft.value = null;
  const findProp = () => [...(rowProps.value ?? []), ...(settingProps.value ?? [])].find((p) => p.key === key);
  const prop = findProp();
  if (prop !== undefined && draftText !== null && draftText !== "" && Number(draftText) !== prop.value) {
    emit("op", prop.op(Number(draftText)));
  }
  // 範囲に収めた結果が元の値と同じときも、欄に打ちかけの文字を残さない
  void nextTick(() => {
    const now = findProp();
    if (now !== undefined) el.value = propText(now);
  });
}

// ===== 刻みのボタンと個数欄・目標Lvの欄（確定は blur。テンキーは ui_spec §8） =====
function stepBy(by: number): void {
  const s = stepper.value;
  if (s !== null) emit("op", s.stepOp(by));
}

/** 目標Lvの Lv の欄（直接打つ・Lvピッカー）で選んだ Lv */
function setLevel(level: number, coalesce?: HistoryRecordOptions): void {
  const s = stepper.value;
  if (s !== null && Number.isFinite(level) && level !== s.value) emit("op", s.setOp(level), coalesce);
}

const inputRef = ref<HTMLInputElement | null>(null);
const draft = ref<string | null>(null);

function onInput(raw: string): void {
  draft.value = raw.replace(/[^0-9]/g, "");
}

function onBlur(): void {
  const value = draft.value;
  draft.value = null;
  const s = stepper.value;
  if (s !== null && value !== null && value !== "" && Number(value) !== s.value) emit("op", s.setOp(Number(value)));
  // 範囲の端に合わせた結果が元の値と同じときも、欄に打ちかけの文字を残さない
  void nextTick(() => {
    const el = inputRef.value;
    if (el && stepper.value !== null) el.value = String(stepper.value.value);
  });
}
</script>
