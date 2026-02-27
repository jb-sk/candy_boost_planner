<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal addModal" role="dialog" :aria-label="t('addModal.title')" @keydown.esc="$emit('close')">
      <div class="addModal__head">
        <h2 class="addModal__title">{{ t("addModal.title") }}</h2>
        <button class="btn btn--ghost btn--xs" type="button" @click="$emit('close')">{{ t("common.close") }}</button>
      </div>

      <div class="addModal__body">
        <!-- ポケモン名 -->
        <label class="field">
          <span class="field__label">
            {{ t("box.add.nameDex") }}
            <span style="color: var(--danger)">{{ t("common.required") }}</span>
          </span>
          <div class="suggest">
            <input
              ref="nameInputRef"
              v-model="addName"
              class="field__input"
              data-testid="add-modal-name-input"
              :placeholder="t('box.add.nameDexPh')"
              @focus="box.onAddNameFocus"
              @blur="box.onAddNameBlur"
              @input="box.onAddNameInput"
              @keydown.esc.prevent="box.closeAddNameSuggest"
              @compositionstart="isComposing = true"
              @compositionend="isComposing = false"
            />
            <div v-if="showAddNameSuggest" class="suggest__panel" role="listbox">
              <button
                v-for="n in addNameSuggestList"
                :key="n.nameJa"
                type="button"
                class="suggest__item"
                role="option"
                @mousedown.prevent="box.pickAddName(n.nameJa)"
              >
                {{ n.display }}
              </button>
            </div>
          </div>
          <span class="field__sub" v-if="addLookup">
            {{ t("box.add.detected", {
              name: getPokemonNameLocalized(addLookup.pokedexId, addLookup.form, locale),
              id: addLookup.pokedexId,
              expType: addLookup.expType,
            }) }}
          </span>
          <span class="field__sub" v-else-if="addName.trim()">{{ t("box.add.noMatch") }}</span>
        </label>

        <!-- ラベル -->
        <label class="field field--wide">
          <span class="field__label">{{ t("box.add.labelOpt") }}</span>
          <input v-model="addLabel" class="field__input" :placeholder="t('box.add.labelOptPh')" />
        </label>

        <!-- 現在レベル + 残りEXP -->
        <div class="addModal__levelRow">
          <div class="field">
            <span class="field__label">{{ t("calc.row.srcLevel") }}</span>
            <LevelPicker v-model="srcLevel" :label="t('calc.row.srcLevel')" :max="MAX_LEVEL" />
          </div>
          <label class="field">
            <span class="field__label">{{ t("calc.row.expRemaining") }}</span>
            <input
              v-model="expRemainingInput"
              type="number"
              min="1"
              class="field__input"
              data-testid="add-modal-exp-remaining"
              :placeholder="t('calc.row.expRemainingPh')"
            />
          </label>
        </div>

        <!-- 目標レベル -->
        <div class="field">
          <span class="field__label">{{ t("calc.row.dstLevel") }}</span>
          <LevelPicker v-model="dstLevel" :min="srcLevel" :max="MAX_LEVEL" :label="t('calc.row.dstLevel')" />
        </div>

        <!-- 性格 -->
        <label class="field">
          <span class="field__label">{{ t("box.add.nature") }}</span>
          <NatureSelect
            v-model="addNature"
            :label="t('box.add.nature')"
            :label-normal="t('calc.row.natureNormal')"
            :label-up="t('calc.row.natureUp')"
            :label-down="t('calc.row.natureDown')"
          />
        </label>

        <!-- お気に入り -->
        <label class="addModal__favCheck">
          <input type="checkbox" v-model="addFavorite" />
          {{ t("box.add.addFavorite") }}
        </label>
      </div>

      <div class="addModal__footer">
        <button
          class="btn btn--primary addModal__submit"
          type="button"
          data-testid="add-modal-submit"
          :disabled="!canSubmit"
          @click="onSubmit"
        >
          {{ t("addModal.submit") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import LevelPicker from "./LevelPicker.vue";
import NatureSelect from "./NatureSelect.vue";
import { getPokemonNameLocalized } from "../domain/pokesleep/pokemon-name-localize";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";
import type { useBoxStore } from "../composables/useBoxStore";

const emit = defineEmits<{
  (e: "close"): void;
  (e: "added", ev?: MouseEvent): void;
}>();

const props = defineProps<{
  box: ReturnType<typeof useBoxStore>;
}>();

const box = props.box;
const { t, locale } = useI18n();

// ── Refs bridging to useBoxStore ──
const addName = box.addName;
const addLabel = box.addLabel;
const addNature = box.addNature;
const addFavorite = box.addFavorite;
const addLookup = box.addLookup;
const addNameSuggestList = box.addNameSuggestList;
const showAddNameSuggest = box.showAddNameSuggest;
const isComposing = box.isComposing;

// ── Local form state (not shared with BoxPanel's add form) ──
const srcLevel = ref(1);
const dstLevel = ref(60);
const expRemainingInput = ref<string>("");

const nameInputRef = ref<HTMLInputElement | null>(null);

// Sync srcLevel → box.addLevel so onCreateManual uses it
watch(srcLevel, (v) => { box.addLevel.value = v; });

// Keep dstLevel >= srcLevel
watch(srcLevel, (src) => {
  if (dstLevel.value < src) dstLevel.value = src;
});

// Auto-set default dstLevel when srcLevel changes
watch(srcLevel, (src) => {
  if (src < 60) dstLevel.value = 60;
  else dstLevel.value = MAX_LEVEL;
}, { immediate: true });

// ── Validation ──
const canSubmit = computed(() => {
  return !!(addLookup.value || addLabel.value.trim());
});

// ── Submit ──
function onSubmit(ev?: MouseEvent) {
  if (!canSubmit.value) return;

  // Sync level to box store before creating
  box.addLevel.value = srcLevel.value;

  // Parse expRemaining: empty or 0 → undefined
  const rawExp = expRemainingInput.value.trim();
  const parsedExp = rawExp === "" ? undefined : Math.max(0, Math.floor(Number(rawExp) || 0));
  const expRemaining = (parsedExp === 0) ? undefined : parsedExp;

  // Create box entry via store
  box.onCreateManual({ mode: "toCalc" });

  // If expRemaining was set, patch the planner on the newly created entry
  if (expRemaining !== undefined) {
    const entry = box.selectedBox.value;
    if (entry) {
      box.boxEntries.value = box.boxEntries.value.map((x) => {
        if (x.id !== entry.id) return x;
        return {
          ...x,
          planner: { ...(x.planner ?? {}), expRemaining },
          updatedAt: new Date().toISOString(),
        };
      });
    }
  }

  // Emit to parent so it can bridge to CalcStore (with expRemaining)
  emit("added", ev);

  // Reset local form for next add
  resetForm();
}

function resetForm() {
  addName.value = "";
  addLabel.value = "";
  srcLevel.value = 1;
  dstLevel.value = 60;
  expRemainingInput.value = "";
  addNature.value = "normal";
  addFavorite.value = true;

  // Focus name input for quick consecutive adds
  nextTick(() => {
    nameInputRef.value?.focus();
  });
}

// Focus name input on mount
onMounted(() => {
  nextTick(() => {
    nameInputRef.value?.focus();
  });
  // Reset form fields on open
  resetForm();
});
</script>
