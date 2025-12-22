<template>
  <details class="boxDisclosure">
    <summary class="boxDisclosure__summary">
      <span class="boxDisclosure__title">{{ t("box.import.title") }}</span>
    </summary>
    <div class="boxCard boxCard--inner">
      <p class="boxCard__desc">
        {{ t("box.import.desc") }}
      </p>
      <textarea
        ref="textareaRef"
        :value="importText"
        class="boxTextarea"
        rows="7"
        :placeholder="t('box.import.ph')"
        @input="emit('update:importText', ($event.target as HTMLTextAreaElement).value)"
        @paste="onPasteEvent"
      ></textarea>
      <label class="boxImport__favCheck">
        <input type="checkbox" v-model="importFavorite" />
        {{ t("box.import.addAllFavorite") }}
      </label>
      <div class="boxCard__actions boxCard__actions--row">
        <button class="btn btn--primary" type="button" @click="emit('import', importFavorite)">
          {{ t("box.import.run") }}
        </button>
        <button class="btn btn--ghost" type="button" @click="onPasteImport">
          {{ t("box.import.paste") }}
        </button>
        <label class="btn btn--ghost boxImport__fileLabel">
          {{ t("box.import.fileSelect") }}
          <input
            type="file"
            accept=".txt,text/plain"
            class="boxImport__fileInput"
            @change="onFileSelect"
          />
        </label>
        <button class="btn btn--ghost" type="button" @click="emit('update:importText', '')">
          {{ t("common.clear") }}
        </button>
      </div>
      <div class="boxCard__hints">
        <span class="boxCard__status boxCard__status--hint" aria-hidden="true">{{ t("box.import.pasteHelp") }}</span>
        <span class="boxCard__status" v-if="importStatus">{{ importStatus }}</span>
      </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";

defineProps<{
  importText: string;
  importStatus: string;
}>();

const emit = defineEmits<{
  (e: "update:importText", v: string): void;
  (e: "update:importStatus", v: string): void;
  (e: "import", markFavorite: boolean): void;
}>();

const { t } = useI18n();
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const importFavorite = ref(false);

// 案1: ファイル選択による読み込み
function onFileSelect(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result;
    if (typeof text === "string" && text.length) {
      emit("update:importText", text);
      emit("update:importStatus", t("status.fileLoaded", { name: file.name }));
    } else {
      emit("update:importStatus", t("status.fileEmpty"));
    }
  };
  reader.onerror = () => {
    emit("update:importStatus", t("status.fileReadError"));
  };
  reader.readAsText(file, "UTF-8");

  // 同じファイルを再選択できるようにリセット
  input.value = "";
}

// 案2: ネイティブペーストイベントをキャッチ（Clipboard API不要）
function onPasteEvent(ev: ClipboardEvent) {
  const text = ev.clipboardData?.getData("text/plain");
  if (typeof text === "string" && text.length) {
    ev.preventDefault();
    emit("update:importText", text);
    emit("update:importStatus", t("status.pasted"));
  }
}

// 既存の貼り付けボタン（Clipboard API使用、セキュアコンテキストでのみ動作）
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

<style scoped>
.boxImport__fileLabel {
  position: relative;
  cursor: pointer;
}
.boxImport__fileInput {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
}
.boxCard__actions--wrap {
  flex-wrap: wrap;
}
.boxCard__status--hint {
  flex-basis: 100%;
  margin-top: 4px;
}
</style>
