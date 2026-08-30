<template>
  <div class="modal-overlay settings-overlay" data-testid="settings-overlay" @click.self="requestClose">
    <div class="modal" role="dialog" aria-modal="true" :aria-label="t('common.settings')" data-testid="settings-modal">
      <header class="modal__header">
        <div class="modalTabs" role="tablist" :aria-label="t('common.settings')" data-testid="settings-tabs">
          <button
            class="modalTab"
            :class="{ 'modalTab--active': activeTab === 'inventory' }"
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
            class="modalTab"
            :class="{ 'modalTab--active': activeTab === 'backup' }"
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
        <button ref="closeButtonRef" class="modal__close" data-testid="settings-modal-close" type="button" @click="requestClose" :aria-label="t('common.close')">×</button>
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
                <span class="settingsField__unit" data-testid="settings-sleep-exp-bonus-unit">{{ t("calc.sleep.sleepExpBonusUnit") }}</span>
              </label>
            </div>
            <div class="settingsRow">
              <div class="settingsField settingsField--inline settingsField--aligned">
                <span class="settingsField__labelWithHint">
                  <label class="settingsField__label" for="settings-growth-incense-normal">{{ t("calc.sleep.growthIncenseNormalLabel") }}</label>
                  <button v-bind="hintButton('growthIncenseNormal')">?</button>
                </span>
                <!--
                  単位は `<label>` の外なので、読み上げでは `aria-describedby` で結ばないと
                  「7」だけになって「個/週」が落ちる（`<label>` で行ごと包んでいた頃は名前に入っていた）。
                -->
                <select
                  id="settings-growth-incense-normal"
                  class="field__input field__input--xs"
                  data-testid="settings-growth-incense-normal-select"
                  aria-describedby="settings-growth-incense-normal-unit"
                  :value="calc.sleepSettings.value.growthIncenseNormalPerWeek"
                  @change="onGrowthIncenseNormalChange"
                >
                  <option v-for="n in 8" :key="n - 1" :value="n - 1">{{ n - 1 }}</option>
                </select>
                <span id="settings-growth-incense-normal-unit" class="settingsField__unit" data-testid="settings-growth-incense-normal-unit">{{ t("calc.sleep.growthIncenseNormalUnit") }}</span>
              </div>
              <label class="settingsField settingsField--inline settingsField--checkbox settingsField--aligned">
                <span class="settingsField__label">{{ t("calc.sleep.includeGSDLabel") }}</span>
                <input
                  type="checkbox"
                  data-testid="settings-include-gsd-checkbox"
                  :checked="calc.sleepSettings.value.includeGSD"
                  @change="calc.updateSleepSettings({ includeGSD: ($event.target as HTMLInputElement).checked })"
                />
              </label>
              <span
                v-if="calc.lunarCalendarStatus.value === 'error'"
                class="field__error settingsLunarCalendarWarning"
                data-testid="settings-lunar-calendar-warning"
                role="alert"
              >
                {{ t("calc.sleep.lunarCalendarUnavailable") }}
              </span>
              <div class="settingsField settingsField--inline settingsField--aligned">
                <span class="settingsField__labelWithHint">
                  <span class="settingsField__label">{{ t("calc.sleep.growthIncenseGsdLabel") }}</span>
                  <button v-bind="hintButton('growthIncenseGsd')">?</button>
                </span>
                <div
                  class="settingsGsdDays"
                  role="group"
                  :aria-label="t('calc.sleep.growthIncenseGsdLabel')"
                >
                  <label v-for="day in growthIncenseGsdDayOptions" :key="day.key" class="settingsGsdDay">
                    <input
                      type="checkbox"
                      :data-testid="`settings-growth-incense-gsd-${day.key}`"
                      :checked="calc.sleepSettings.value.growthIncenseGsdDays[day.key]"
                      :disabled="!calc.sleepSettings.value.includeGSD"
                      @change="onGrowthIncenseGsdDayChange(day.key, ($event.target as HTMLInputElement).checked)"
                    />
                    <span>{{ t(day.label) }}</span>
                  </label>
                </div>
              </div>
              <!--
                説明は「?」のヒントチップへ出す（`SETTINGS_HINTS` の6項目）。行は `<label>` で
                包まず `for`/`id` で結ぶこと ── `<label>` の中にボタンを置くと、? を押しただけで
                チェックが切り替わったりセレクトが開いたりする。
                ラベル列の幅は他の行と共通（settingsField__labelWithHint が列を持つ）。
              -->
              <div class="settingsFieldGroup">
                <div class="settingsField settingsField--inline settingsField--aligned">
                  <span class="settingsField__labelWithHint">
                    <label class="settingsField__label" for="settings-blue-seed-weekday">{{ t("calc.sleep.blueSeedLabel") }}</label>
                    <button v-bind="hintButton('blueSeed')">?</button>
                  </span>
                  <select
                    id="settings-blue-seed-weekday"
                    class="field__input field__input--xs"
                    data-testid="blue-seed-weekday"
                    :value="calc.sleepSettings.value.blueSeedPlantWeekday === null ? 'none' : calc.sleepSettings.value.blueSeedPlantWeekday"
                    @change="onBlueSeedPlantWeekdayChange"
                  >
                    <option v-for="day in blueSeedWeekdayOptions" :key="day.value" :value="day.value">{{ t(day.label) }}</option>
                  </select>
                </div>
                <div class="settingsField settingsField--inline settingsField--aligned">
                  <span class="settingsField__labelWithHint">
                    <label class="settingsField__label" for="settings-blue-seed-incense-days">{{ t("calc.sleep.blueSeedIncenseLabel") }}</label>
                    <button v-bind="hintButton('blueSeedIncense')">?</button>
                  </span>
                  <select
                    id="settings-blue-seed-incense-days"
                    class="field__input field__input--xs"
                    data-testid="blue-seed-incense-days"
                    :aria-describedby="blueSeedIncenseUnitId"
                    :value="calc.sleepSettings.value.blueSeedIncenseDays"
                    @change="onBlueSeedIncenseDaysChange"
                  >
                    <option value="auto">{{ t("calc.sleep.blueSeedIncenseAuto") }}</option>
                    <option v-for="n in 8" :key="n - 1" :value="n - 1">{{ n - 1 }}</option>
                  </select>
                  <!--
                    単位は選択肢の文字列へ埋め込まず、他の行（個/週・個）と同じ別要素で出す。
                    埋め込むと英語が `1 days` になり、複数形の仕組みが要る。
                    **「自動」のときは出さないこと**（`自動 日` / `Auto days` になる）。
                    単位は `<label>` の外なので `aria-describedby` で結ぶ。出していない
                    「自動」のときは属性ごと外す（消えた要素を指すと読み上げが空になる）。
                  -->
                  <span
                    v-if="blueSeedIncenseUnitId !== undefined"
                    :id="BLUE_SEED_INCENSE_UNIT_ID"
                    class="settingsField__unit"
                    data-testid="settings-blue-seed-incense-days-unit"
                  >{{ t("calc.sleep.blueSeedIncenseUnit") }}</span>
                </div>
              </div>
              <div class="settingsField settingsField--inline settingsField--aligned">
                <span class="settingsField__labelWithHint">
                  <label class="settingsField__label" for="settings-growth-incense-stock">{{ t("calc.sleep.growthIncenseStockLabel") }}</label>
                  <button v-bind="hintButton('growthIncenseStock')">?</button>
                </span>
                <input
                  id="settings-growth-incense-stock"
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  class="field__input field__input--xs"
                  data-testid="settings-growth-incense-stock-input"
                  aria-describedby="settings-growth-incense-stock-unit"
                  :placeholder="t('calc.sleep.growthIncenseStockPlaceholder')"
                  :value="growthIncenseStockValue"
                  @input="onGrowthIncenseStockInput(($event.target as HTMLInputElement).value)"
                  @blur="onGrowthIncenseStockBlur"
                />
                <span id="settings-growth-incense-stock-unit" class="settingsField__unit" data-testid="settings-growth-incense-stock-unit">{{ t("calc.sleep.growthIncenseStockUnit") }}</span>
              </div>
              <div class="settingsFieldGroup" data-testid="settings-event-projection-fields">
                <div class="settingsField settingsField--inline settingsField--checkbox settingsField--aligned">
                  <span class="settingsField__labelWithHint">
                    <label class="settingsField__label" for="settings-use-projected-events">{{ t("calc.sleep.projectedEventsLabel") }}</label>
                    <button v-bind="hintButton('projectedEvents')">?</button>
                  </span>
                  <input
                    id="settings-use-projected-events"
                    type="checkbox"
                    data-testid="settings-use-projected-events"
                    :checked="calc.sleepSettings.value.useProjectedEvents"
                    @change="calc.updateSleepSettings({ useProjectedEvents: ($event.target as HTMLInputElement).checked })"
                  />
                </div>
              </div>
              <div class="settingsField settingsManualEvents">
                <span class="settingsField__label">{{ t("calc.sleep.manualEventBonusesLabel") }}</span>
                <div class="settingsManualEventList">
                  <!-- 見出しは1回だけ。行ごとに繰り返すと縦に伸びて他の設定と揃わない。 -->
                  <div v-if="manualEventDrafts.length > 0" class="settingsManualEventHead" aria-hidden="true">
                    <span>{{ t("calc.sleep.manualEventFromLabel") }}</span>
                    <span>{{ t("calc.sleep.manualEventDaysLabel") }}</span>
                    <!--
                      倍率の列は行側に「×」が入るぶん入力欄が右へずれる。
                      見出しにも同じ字送りの透明な「×」を置いて左端を揃える
                      （padding で寄せると字送りが変わったときに崩れる）。
                    -->
                    <span class="settingsManualEventMultiplier">
                      <span class="settingsManualEventTimes" aria-hidden="true">×</span>
                      <span>{{ t("calc.sleep.manualEventMultiplierLabel") }}</span>
                    </span>
                    <span></span>
                  </div>
                  <div
                    v-for="(row, index) in manualEventDrafts"
                    :key="row.id"
                    class="settingsManualEventRow"
                    data-testid="settings-manual-event-row"
                  >
                    <input
                      type="text"
                      inputmode="numeric"
                      autocomplete="off"
                      placeholder="YYYYMMDD"
                      maxlength="10"
                      class="field__input settingsManualEventDateInput"
                      :class="{ 'field__input--error': manualEventDateHasError(row) }"
                      :aria-invalid="manualEventDateHasError(row) || undefined"
                      :aria-label="t('calc.sleep.manualEventFromLabel')"
                      data-testid="settings-manual-event-from"
                      :value="row.from"
                      @input="onManualEventInput(index, 'from', ($event.target as HTMLInputElement).value)"
                      @blur="onManualEventBlur(index)"
                      @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
                    />
                    <span class="settingsManualEventDays">
                      <input
                        type="number"
                        min="1"
                        max="365"
                        step="1"
                        class="field__input settingsManualEventDaysInput"
                        :class="{ 'field__input--error': row.error === 'days' }"
                        :aria-invalid="row.error === 'days' || undefined"
                        :aria-label="t('calc.sleep.manualEventDaysLabel')"
                        data-testid="settings-manual-event-days"
                        :value="row.days"
                        @input="onManualEventInput(index, 'days', ($event.target as HTMLInputElement).value)"
                        @blur="onManualEventBlur(index)"
                        @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
                      />
                      <span class="settingsManualEventDaysUnit">{{ t("calc.sleep.manualEventDaysUnit") }}</span>
                    </span>
                    <span class="settingsManualEventMultiplier">
                      <span class="settingsManualEventTimes" aria-hidden="true">×</span>
                      <!-- field__input--xs は 680px 以上で 130px になり列からはみ出すので使わない -->
                      <input
                        type="number"
                        min="0"
                        max="10"
                        step="any"
                        class="field__input settingsManualEventMultiplierInput"
                        :class="{ 'field__input--error': row.error === 'multiplier' }"
                        :aria-invalid="row.error === 'multiplier' || undefined"
                        :aria-label="t('calc.sleep.manualEventMultiplierLabel')"
                        data-testid="settings-manual-event-multiplier"
                        :value="row.multiplier"
                        @input="onManualEventInput(index, 'multiplier', ($event.target as HTMLInputElement).value)"
                        @blur="onManualEventBlur(index)"
                        @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
                      />
                    </span>
                    <button
                      type="button"
                      class="settingsManualEventRemove"
                      data-testid="settings-manual-event-remove"
                      :aria-label="t('calc.sleep.manualEventRemoveLabel')"
                      @click="removeManualEventRow(index)"
                    >×</button>
                    <span
                      v-if="row.error"
                      class="field__error settingsManualEventError"
                      role="alert"
                      data-testid="settings-manual-event-error"
                    >{{ manualEventErrorMessage(row.error) }}</span>
                  </div>
                  <button
                    type="button"
                    class="linkBtn settingsManualEventAdd"
                    data-testid="settings-manual-event-add"
                    :disabled="manualEventDrafts.length >= 10"
                    @click="addManualEventRow"
                  >{{ t("calc.sleep.manualEventAddLabel") }}</button>
                </div>
              </div>
              <div class="settingsFieldGroup">
                <label class="settingsField settingsField--inline settingsField--aligned">
                  <span class="settingsField__label">{{ t("calc.sleep.timeZoneLabel") }}</span>
                  <input
                    data-testid="settings-time-zone-input"
                    type="text"
                    autocomplete="off"
                    spellcheck="false"
                    class="field__input field__input--sm settingsTimeZoneInput"
                    :class="{ 'field__input--error': timeZoneError }"
                    :aria-invalid="timeZoneError || undefined"
                    :aria-describedby="timeZoneError ? 'settings-time-zone-error' : undefined"
                    :value="timeZoneInputValue"
                    @focus="onTimeZoneFocus"
                    @input="onTimeZoneInput(($event.target as HTMLInputElement).value)"
                    @blur="onTimeZoneBlur"
                    @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
                  />
                </label>
                <span v-if="timeZoneError" id="settings-time-zone-error" role="alert" class="field__error settingsTimeZoneError" data-testid="settings-time-zone-error">
                  {{ t("calc.sleep.timeZoneInvalid") }}
                </span>
                <span class="settingsField__hint" data-testid="settings-current-game-date">
                  {{ t("calc.sleep.currentGameDateLabel") }}: {{ calc.currentGameDate.value }}
                </span>
              </div>
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

          <section class="section" data-testid="settings-reset-section">
            <div class="settingsRow">
              <div v-show="!resetConfirmRef?.isOpen" class="settingsField">
                <button
                  type="button"
                  class="btn btn--danger btn--sm settingsResetButton"
                  data-testid="settings-reset-button"
                  :disabled="calc.isSettingsDefault.value"
                  @click="resetConfirmRef?.open($event.currentTarget)"
                >{{ t("settings.resetButton") }}</button>
                <span class="settingsField__hint">{{ t("settings.resetHint") }}</span>
              </div>
              <InlineConfirm
                ref="resetConfirmRef"
                id-prefix="settings-reset-confirm"
                :question="t('confirm.resetSettings')"
                :note="t('confirm.resetSettingsNote')"
                :confirm-label="t('settings.resetConfirmAction')"
                :cancel-label="t('common.cancel')"
                test-id="settings-reset-confirm"
                confirm-test-id="settings-reset-confirm-yes"
                cancel-test-id="settings-reset-confirm-no"
                :disabled="calc.isSettingsDefault.value"
                :confirm-focus-target="closeButtonRef"
                @confirm="calc.resetSettings"
              />
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

    <!--
      ヒントチップ。`Teleport to body` にはしない ── モーダル（.modal-overlay）と
      .hintPopover はどちらも z-index 1000 なので、body へ出すと DOM 順まかせの
      綱引きになる。モーダルの中に置けば .modal の上に必ず来る。
      透明な .hintOverlay は「どこかを押せば閉じる」受け口。.modal-overlay の
      @click.self より内側なので、これを押しても設定は閉じない。
    -->
    <template v-if="hintState.visible">
      <div class="hintOverlay" data-testid="settings-hint-overlay" @click.stop="closeHint"></div>
      <div
        ref="hintPopoverRef"
        :id="HINT_POPOVER_ID"
        class="hintPopover"
        role="tooltip"
        data-testid="settings-hint-popover"
        :style="{ left: hintState.left + 'px', top: hintState.top + 'px' }"
        @click.stop
      ><p class="hintPopover__note">{{ t(SETTINGS_HINTS[hintState.kind].text) }}</p></div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { CalcStore } from "../composables/useCalcStore";
import type { BoxStore } from "../composables/useBoxStore";
import type { ItemCompareMode } from "../domain/level-planner/types";
import type { BlueSeedIncenseDays, BlueSeedPlantWeekday, GrowthIncenseGsdDays, GrowthIncenseNormalPerWeek, ManualEventBonus } from "../domain/types";
import { normalizeGrowthIncenseStock } from "../domain/pokesleep/growth-incense";
import { addGameDays, normalizeGameDate, normalizeTimeZone, parseGameDate } from "../domain/pokesleep/game-date";
import { useCandyStore } from "../composables/useCandyStore";
import { useDraftField } from "../composables/useDraftField";
import { PokemonTypes, getTypeName } from "../domain/pokesleep/pokemon-types";
import DataBackupSection from "./DataBackupSection.vue";
import InlineConfirm from "./InlineConfirm.vue";

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

const closeButtonRef = ref<HTMLButtonElement | null>(null);
const resetConfirmRef = ref<InstanceType<typeof InlineConfirm> | null>(null);

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
const timeZoneDraft = ref<string | null>(null);
const timeZoneError = ref(false);
const timeZoneInputValue = computed(() => timeZoneDraft.value ?? calc.sleepSettings.value.timeZone);
const growthIncenseStockDraft = ref<string | null>(null);
// 無制限（null）は空欄。0 は「1個も使わない」なので必ず 0 と出す。
const growthIncenseStockValue = computed(() => (
  growthIncenseStockDraft.value
  ?? (calc.sleepSettings.value.growthIncenseStock === null
    ? ""
    : String(calc.sleepSettings.value.growthIncenseStock))
));
type ManualEventError = "date" | "days" | "multiplier";
type ManualEventDraft = {
  id: number;
  from: string;
  /** 開始日を1日目に数えた日数。終了日を打つより短いので入力はこちらで受ける。 */
  days: string;
  multiplier: string;
  error: ManualEventError | null;
};

/** 日数の上限。イベントは長くても2週間程度だが、長期キャンペーンの余地を残す。 */
const MANUAL_EVENT_MAX_DAYS = 365;

/**
 * 入力欄は区切りなしの YYYYMMDD で扱う（打ちやすさ優先）。
 * 保存する値は今までどおりゲーム日 YYYY-MM-DD なので、表示と保存で形が違う。
 */
function manualEventDateToInput(gameDate: string): string {
  return gameDate.replace(/-/g, "");
}

/** YYYYMMDD をゲーム日の形へ戻す。ハイフン付きで貼られても受け付ける。 */
function manualEventInputToGameDate(value: string): string {
  const trimmed = value.trim();
  if (!/^\d{8}$/.test(trimmed)) return trimmed;
  return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
}

/** 保存値（from/to の閉区間）から入力欄の日数へ。開始日と終了日が同じなら1。 */
function manualEventDayCount(from: string, to: string): number {
  const start = parseGameDate(from);
  const end = parseGameDate(to);
  if (!start || !end) return 1;
  const diffMs = Date.UTC(end.year, end.month - 1, end.day)
    - Date.UTC(start.year, start.month - 1, start.day);
  return Math.round(diffMs / 86_400_000) + 1;
}

let nextManualEventDraftId = 1;
function manualEventDraftsFromSettings(bonuses: readonly ManualEventBonus[]): ManualEventDraft[] {
  return bonuses.map(bonus => ({
    id: nextManualEventDraftId++,
    from: manualEventDateToInput(bonus.from),
    days: String(manualEventDayCount(bonus.from, bonus.to)),
    multiplier: String(bonus.multiplier),
    error: null,
  }));
}

const manualEventDrafts = ref<ManualEventDraft[]>(
  manualEventDraftsFromSettings(calc.sleepSettings.value.manualEventBonuses),
);
function manualEventBonusesKey(bonuses: readonly ManualEventBonus[]): string {
  return JSON.stringify(bonuses);
}
let locallyCommittedManualEventBonusesKey: string | null = null;

/**
 * モーダルを開いたままリセット・undo・redoなどで確定値が変わった場合だけ表示を同期する。
 * sleepSettings 全体を監視すると、無関係な設定変更でも入力途中やエラー中のドラフトを
 * 確定値へ巻き戻すため、イベント配列の内容を表すキーだけを追う。入力欄自身からの
 * 確定は直後の別フィールド入力と競合しないよう、watch側の再構築を省く。
 */
watch(
  () => manualEventBonusesKey(calc.sleepSettings.value.manualEventBonuses),
  (key) => {
    if (key === locallyCommittedManualEventBonusesKey) {
      locallyCommittedManualEventBonusesKey = null;
      return;
    }
    locallyCommittedManualEventBonusesKey = null;
    manualEventDrafts.value = manualEventDraftsFromSettings(
      calc.sleepSettings.value.manualEventBonuses,
    );
  },
);
const growthIncenseGsdDayOptions = [
  { key: "beforeFullMoon", label: "calc.sleep.incenseDay1" },
  { key: "fullMoon", label: "calc.sleep.incenseDay2" },
  { key: "afterFullMoon", label: "calc.sleep.incenseDay3" },
] as const;
const blueSeedWeekdayOptions = [
  { value: "1", label: "calc.sleep.weekdayMon" },
  { value: "2", label: "calc.sleep.weekdayTue" },
  { value: "3", label: "calc.sleep.weekdayWed" },
  { value: "4", label: "calc.sleep.weekdayThu" },
  { value: "5", label: "calc.sleep.weekdayFri" },
  { value: "none", label: "calc.sleep.weekdayNone" },
] as const;

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

function onTimeZoneFocus() {
  if (timeZoneDraft.value === null) timeZoneDraft.value = calc.sleepSettings.value.timeZone;
}

function onTimeZoneInput(value: string) {
  timeZoneDraft.value = value;
  timeZoneError.value = false;
}

function onTimeZoneBlur() {
  const draft = timeZoneDraft.value;
  if (draft === null) return;
  const timeZone = normalizeTimeZone(draft);
  if (!timeZone) {
    timeZoneError.value = true;
    return;
  }
  timeZoneDraft.value = null;
  timeZoneError.value = false;
  calc.updateSleepSettings({ timeZone });
}

function onGrowthIncenseGsdDayChange(day: keyof GrowthIncenseGsdDays, checked: boolean) {
  calc.updateSleepSettings({
    growthIncenseGsdDays: { ...calc.sleepSettings.value.growthIncenseGsdDays, [day]: checked },
  });
}

function onGrowthIncenseNormalChange(event: Event) {
  const value = Number((event.target as HTMLSelectElement).value);
  if (Number.isInteger(value) && value >= 0 && value <= 7) {
    calc.updateSleepSettings({ growthIncenseNormalPerWeek: value as GrowthIncenseNormalPerWeek });
  }
}

function onBlueSeedPlantWeekdayChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  const weekday: BlueSeedPlantWeekday = value === "none"
    ? null
    : Number(value) as BlueSeedPlantWeekday;
  if (weekday === null || (weekday >= 1 && weekday <= 5)) {
    calc.updateSleepSettings({ blueSeedPlantWeekday: weekday });
  }
}

/**
 * 「?」で開く説明。作法は `CalcPanel.vue` の `showHint` と同じ
 * （下へ仮置き → 実測して収まらなければ上へフリップ）。
 *
 * 項目名と本文は表へ集約する。テンプレートへ `v-if` で並べると、i18n キーの追加漏れが
 * 「ボタンは出るが中身が空」という形でしか出ず、照合で拾えない。
 * **項目名もここに要る** ── ボタンの読み上げ名を「?」や「説明を開く」で揃えると、
 * どの項目の説明なのか音声では区別が付かない。
 *
 * お香の2項目はもともと `title` 属性だった。スマホでは読めないのでこちらへ移し、
 * GSDのお香にも同じ説明導線を追加した（`title` を残すと素の tooltip とチップが二重に出る）。
 */
const SETTINGS_HINTS = {
  growthIncenseNormal: { label: "calc.sleep.growthIncenseNormalLabel", text: "calc.sleep.growthIncenseNormalHint" },
  growthIncenseGsd: { label: "calc.sleep.growthIncenseGsdLabel", text: "calc.sleep.growthIncenseGsdHint" },
  growthIncenseStock: { label: "calc.sleep.growthIncenseStockLabel", text: "calc.sleep.growthIncenseStockHint" },
  projectedEvents: { label: "calc.sleep.projectedEventsLabel", text: "calc.sleep.projectedEventsHint" },
  blueSeed: { label: "calc.sleep.blueSeedLabel", text: "calc.sleep.blueSeedHint" },
  blueSeedIncense: { label: "calc.sleep.blueSeedIncenseLabel", text: "calc.sleep.blueSeedIncenseHint" },
} as const;

type SettingsHintKind = keyof typeof SETTINGS_HINTS;

const HINT_POPOVER_ID = "settings-hint-popover";

const hintState = ref<{ visible: boolean; left: number; top: number; kind: SettingsHintKind }>({
  visible: false,
  left: 0,
  top: 0,
  kind: "projectedEvents",
});
const hintPopoverRef = ref<HTMLElement | null>(null);

/**
 * 「?」ボタンの属性一式。6つ並んでいるので、**種類だけを引数に取る1か所**から作る
 * （個々に書き下すと `aria-*` や testid が少しずつ食い違っていく）。
 */
function hintButton(kind: SettingsHintKind) {
  const open = hintState.value.visible && hintState.value.kind === kind;
  return {
    type: "button" as const,
    class: "hintIcon",
    "data-testid": `settings-hint-btn-${kind}`,
    // 「?」だけでは何の説明か読み上げられないので、項目名を名前に含める。
    "aria-label": t("calc.sleep.hintOpen", { label: t(SETTINGS_HINTS[kind].label) }),
    "aria-expanded": open,
    // 閉じている間はチップの要素が無い。宙に浮いた idref を残さないよう、開いている間だけ結ぶ。
    "aria-controls": open ? HINT_POPOVER_ID : undefined,
    "aria-describedby": open ? HINT_POPOVER_ID : undefined,
    onClick: (event: MouseEvent) => {
      event.stopPropagation();
      void showHint(event, kind);
    },
  };
}

async function showHint(event: MouseEvent, kind: SettingsHintKind): Promise<void> {
  // 同じ「?」をもう一度押したら閉じる（トグル）。
  if (hintState.value.visible && hintState.value.kind === kind) {
    closeHint();
    return;
  }
  // クリック位置ではなくボタンの箱を基準にする（キーボード操作でも同じ位置に出る）。
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const gap = 4;
  const popoverWidth = 240; // CSS max-width(220) + 枠と余白

  let left = rect.left;
  if (left + popoverWidth > window.innerWidth) left = window.innerWidth - popoverWidth - 8;
  if (left < 8) left = 8;

  hintState.value = { visible: true, left, top: rect.bottom + gap, kind };

  await nextTick();
  const popover = hintPopoverRef.value;
  if (!popover) return;
  const popoverHeight = popover.offsetHeight;
  if (rect.bottom + gap + popoverHeight > window.innerHeight && rect.top - gap - popoverHeight > 0) {
    hintState.value.top = rect.top - gap - popoverHeight;
  }
}

function closeHint(): void {
  hintState.value.visible = false;
}

const BLUE_SEED_INCENSE_UNIT_ID = "settings-blue-seed-incense-days-unit";

/**
 * 「＋お香併用」の単位を読み上げへ結ぶための id。
 * 「自動」のときは単位そのものを出さないので `undefined`（無い要素を指す
 * `aria-describedby` は説明が空になるだけで害しかない）。
 */
const blueSeedIncenseUnitId = computed<string | undefined>(() =>
  calc.sleepSettings.value.blueSeedIncenseDays === "auto" ? undefined : BLUE_SEED_INCENSE_UNIT_ID,
);

function onBlueSeedIncenseDaysChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  const days: BlueSeedIncenseDays = value === "auto" ? "auto" : Number(value) as BlueSeedIncenseDays;
  if (days === "auto" || (Number.isInteger(days) && days >= 0 && days <= 7)) {
    calc.updateSleepSettings({ blueSeedIncenseDays: days });
  }
}

/**
 * 手持ちのお香。空欄は「無制限」という有効な状態なので、入力中の文字列は
 * ドラフトで持ち、確定できた時だけ設定へ書く（不正入力のまま設定を壊さない）。
 */
function onGrowthIncenseStockInput(raw: string) {
  growthIncenseStockDraft.value = raw;
  const trimmed = raw.trim();
  // 空欄は「無制限」。それ以外は保存の読み込みと同じ規則で受け付ける。
  const stock = trimmed === "" ? null : normalizeGrowthIncenseStock(Number(trimmed));
  if (stock === undefined) return;
  calc.updateSleepSettings({ growthIncenseStock: stock });
}

/** 入力途中の文字列（"01" や不正値）を捨てて、確定した設定値の表示へ戻す。 */
function onGrowthIncenseStockBlur() {
  growthIncenseStockDraft.value = null;
}

function parseManualEventDraft(row: ManualEventDraft): ManualEventBonus | ManualEventError {
  const from = normalizeGameDate(manualEventInputToGameDate(row.from));
  if (!from) return "date";
  const days = Number(row.days);
  if (
    !row.days.trim()
    || !Number.isInteger(days)
    || days < 1
    || days > MANUAL_EVENT_MAX_DAYS
  ) return "days";
  // 開始日を1日目に数えるので、終了日は days - 1 を足した日。
  const to = addGameDays(from, days - 1);
  const multiplier = Number(row.multiplier);
  if (!row.multiplier.trim() || !Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 10) {
    return "multiplier";
  }
  return { from, to, multiplier };
}

function commitManualEventDrafts(): boolean {
  const parsed = manualEventDrafts.value.map(parseManualEventDraft);
  if (parsed.some(value => typeof value === "string")) return false;
  const bonuses = parsed as ManualEventBonus[];
  const key = manualEventBonusesKey(bonuses);
  if (key !== manualEventBonusesKey(calc.sleepSettings.value.manualEventBonuses)) {
    locallyCommittedManualEventBonusesKey = key;
  }
  calc.updateSleepSettings({ manualEventBonuses: bonuses });
  return true;
}

function validateManualEventRow(index: number): boolean {
  const row = manualEventDrafts.value[index];
  if (!row) return false;
  const parsed = parseManualEventDraft(row);
  if (typeof parsed === "string") {
    row.error = parsed;
    return false;
  }
  row.from = manualEventDateToInput(parsed.from);
  row.days = String(manualEventDayCount(parsed.from, parsed.to));
  row.multiplier = String(parsed.multiplier);
  row.error = null;
  return true;
}

function onManualEventInput(index: number, field: "from" | "days" | "multiplier", value: string) {
  const row = manualEventDrafts.value[index];
  if (!row) return;
  row[field] = value;
  row.error = null;
}

function onManualEventBlur(index: number) {
  if (validateManualEventRow(index)) commitManualEventDrafts();
}

function addManualEventRow() {
  if (manualEventDrafts.value.length >= 10) return;
  manualEventDrafts.value.push({
    id: nextManualEventDraftId++,
    from: "",
    days: "",
    multiplier: "",
    error: null,
  });
}

function removeManualEventRow(index: number) {
  manualEventDrafts.value.splice(index, 1);
  commitManualEventDrafts();
}

function manualEventDateHasError(row: ManualEventDraft): boolean {
  return row.error === "date";
}

function manualEventErrorMessage(error: ManualEventError): string {
  if (error === "date") return t("calc.sleep.manualEventDateInvalid");
  if (error === "days") return t("calc.sleep.manualEventDaysInvalid");
  return t("calc.sleep.manualEventMultiplierInvalid");
}

function validateAllManualEventRows(): boolean {
  let valid = true;
  for (let index = 0; index < manualEventDrafts.value.length; index++) {
    if (!validateManualEventRow(index)) valid = false;
  }
  return valid;
}

// ESCキーで閉じる
const emit = defineEmits<{ (e: "close"): void }>();
/**
 * 「＋行を追加」を押しただけで何も入力していない行は、まだデータではないので閉じるときに捨てる。
 * これが無いと、行を足して気が変わっただけで設定モーダルを閉じられなくなる。
 * 一文字でも入っている行は捨てずに検証エラーにする（入力を黙って破棄しない）。
 */
function dropUntouchedManualEventRows() {
  manualEventDrafts.value = manualEventDrafts.value.filter(
    row => row.from.trim() !== "" || row.days.trim() !== "" || row.multiplier.trim() !== "",
  );
}

function requestClose() {
  dropUntouchedManualEventRows();
  if (!validateAllManualEventRows()) return;
  commitManualEventDrafts();
  emit("close");
}
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key !== "Escape") return;
  // ヒントが開いているときは、まずヒントだけ閉じる（設定ごと閉じると入力途中が飛ぶ）。
  if (hintState.value.visible) {
    closeHint();
    return;
  }
  requestClose();
};

onMounted(() => window.addEventListener("keydown", handleKeydown));
onUnmounted(() => window.removeEventListener("keydown", handleKeydown));
</script>
