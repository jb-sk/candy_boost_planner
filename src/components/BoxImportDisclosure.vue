<template>
  <details class="boxDisclosure">
    <summary class="boxDisclosure__summary">
      <span class="boxDisclosure__title">{{ t("box.import.title") }}</span>
      <span class="boxDisclosure__hint">{{ t("box.import.hint") }}</span>
    </summary>
    <div class="boxCard boxCard--inner">
      <p class="boxCard__desc">
        {{ t("box.import.desc") }}
      </p>
      <textarea
        :value="importText"
        class="boxTextarea"
        rows="7"
        :placeholder="t('box.import.ph')"
        @input="emit('update:importText', ($event.target as HTMLTextAreaElement).value)"
      ></textarea>
      <div class="boxCard__actions">
        <button class="btn btn--ghost" type="button" @click="onPasteImport">
          {{ t("box.import.paste") }}
        </button>
        <span class="boxCard__status" aria-hidden="true">{{ t("box.import.pasteHelp") }}</span>
        <button class="btn btn--primary" type="button" @click="emit('import')">
          {{ t("box.import.run") }}
        </button>
        <button class="btn btn--ghost" type="button" @click="emit('update:importText', '')">
          {{ t("common.clear") }}
        </button>
        <span class="boxCard__status" v-if="importStatus">{{ importStatus }}</span>
      </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

defineProps<{
  importText: string;
  importStatus: string;
}>();

const emit = defineEmits<{
  (e: "update:importText", v: string): void;
  (e: "update:importStatus", v: string): void;
  (e: "import"): void;
}>();

const { t } = useI18n();

async function onPasteImport() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav: any = navigator as any;
    if (nav?.clipboard?.readText) {
      const t0 = await nav.clipboard.readText();
      if (typeof t0 === "string" && t0.length) {
        emit("update:importText", t0);
        emit("update:importStatus", t("status.pasted"));
        return;
      }
    }
    emit("update:importStatus", t("status.pasteNotAvailable"));
  } catch {
    emit("update:importStatus", t("status.pasteNotAvailable"));
  }
}
</script>
