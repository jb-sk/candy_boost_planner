<template>
  <div class="dataBackup" data-testid="data-backup-section">
    <p class="dataBackup__description">{{ t("backup.description") }}</p>

    <div class="dataBackup__grid">
      <section class="dataBackup__panel dataBackup__panel--export">
        <h4 class="dataBackup__panelTitle">{{ t("backup.exportTitle") }}</h4>
        <div class="dataBackup__actions">
          <button class="btn btn--primary" type="button" data-testid="data-backup-copy" :disabled="busy" @click="onCopy">
            {{ t("backup.copy") }}
          </button>
          <button class="btn btn--ghost" type="button" data-testid="data-backup-download" :disabled="busy" @click="onDownload">
            {{ t("backup.download") }}
          </button>
        </div>
        <label v-if="manualCopyText" class="dataBackup__manual">
          <span>{{ t("backup.manualCopy") }}</span>
          <textarea ref="manualCopyTextarea" :value="manualCopyText" readonly rows="5" data-testid="data-backup-manual-copy"></textarea>
        </label>
      </section>

      <section class="dataBackup__panel dataBackup__panel--import">
        <h4 class="dataBackup__panelTitle">{{ t("backup.importTitle") }}</h4>
        <textarea
          v-model="inputText"
          class="dataBackup__input"
          rows="5"
          data-testid="data-backup-input"
          :placeholder="t('backup.inputPlaceholder')"
          @input="onInputChanged"
        ></textarea>
        <div class="dataBackup__importActions">
          <div class="dataBackup__sourceActions">
            <button class="btn btn--ghost" type="button" data-testid="data-backup-paste" :disabled="busy" @click="onPaste">
              {{ t("backup.paste") }}
            </button>
            <label class="btn btn--ghost dataBackup__fileLabel" :class="{ 'is-disabled': busy }">
              {{ t("backup.fileSelect") }}
              <input type="file" accept=".json,application/json" data-testid="data-backup-file" :disabled="busy" @change="onFileSelect" />
            </label>
          </div>
          <button class="btn btn--primary dataBackup__importButton" type="button" data-testid="data-backup-import" :disabled="busy || !inputText" @click="onValidate">
            {{ t("backup.import") }}
          </button>
        </div>
      </section>
    </div>

    <p v-if="status" class="dataBackup__status" role="status" data-testid="data-backup-status">{{ status }}</p>

    <div
      v-if="preview"
      class="dataBackup__preview"
      role="region"
      aria-labelledby="data-backup-preview-title"
      data-testid="data-backup-preview"
    >
      <h4 id="data-backup-preview-title">{{ t("backup.previewTitle") }}</h4>
      <dl>
        <div><dt>{{ t("backup.exportedAt") }}</dt><dd>{{ preview.backup.exportedAt }}</dd></div>
        <div><dt>{{ t("backup.boxCount") }}</dt><dd>{{ preview.backup.data.box.entries.length }}</dd></div>
        <div><dt>{{ t("backup.slotCounts") }}</dt><dd>{{ slotCounts }}</dd></div>
        <div><dt>{{ t("backup.targets") }}</dt><dd>{{ t("backup.targetList") }}</dd></div>
      </dl>
      <p class="dataBackup__replaceWarning">{{ t("backup.replaceWarning") }}</p>
      <div v-if="preview.warnings.length" class="dataBackup__warnings" data-testid="data-backup-warnings">
        {{ t("backup.warningCount", { count: preview.warnings.length }) }}
        <ul><li v-for="warning in preview.warnings" :key="warning.path + warning.code">{{ warning.path }}: {{ t(`backup.warning.${warning.code}`) }}</li></ul>
      </div>
      <div class="dataBackup__actions">
        <button class="btn btn--ghost" type="button" data-testid="data-backup-export-current" :disabled="busy" @click="onDownload">
          {{ t("backup.exportCurrent") }}
        </button>
        <button class="btn btn--ghost" type="button" data-testid="data-backup-cancel" :disabled="busy" @click="onCancelPreview">
          {{ t("backup.cancel") }}
        </button>
        <button class="btn btn--primary" type="button" data-testid="data-backup-restore" :disabled="busy" @click="onRestore">
          {{ t("backup.restore") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { BoxStore } from "../composables/useBoxStore";
import type { CalcStore } from "../composables/useCalcStore";
import { useCandyStore } from "../composables/useCandyStore";
import { applyBackup } from "../backup/applyBackup";
import { parseBackup, stringifyBackup } from "../backup/backupCodec";
import { createBackup } from "../backup/createBackup";
import { copyBackupText, downloadBackupText, ensureBackupTextSize, readBackupClipboard, readBackupFile } from "../backup/backupTransport";
import type { ValidatedBackup } from "../backup/types";

const props = defineProps<{ calc: CalcStore; box: BoxStore }>();
const { t } = useI18n();
const candyStore = useCandyStore();
const inputText = ref("");
const manualCopyText = ref("");
const manualCopyTextarea = ref<HTMLTextAreaElement | null>(null);
const status = ref("");
const busy = ref(false);
const preview = ref<ValidatedBackup | null>(null);
const slotCounts = computed(() => preview.value?.backup.data.calculator.slots.map((slot) => slot?.rows.length ?? 0).join(" / ") ?? "");

async function buildCurrentBackupText(): Promise<string> {
  await nextTick();
  const backup = createBackup({
    boxEntries: props.box.boxEntries.value,
    totalShards: props.calc.totalShards.value,
    sleepSettings: props.calc.sleepSettings.value,
    candyInventory: candyStore.getInventory(),
    defaultBoostReachLevel: props.calc.defaultBoostReachLevel.value,
    calculator: props.calc.getBackupSnapshot(),
  });
  const text = stringifyBackup(backup);
  try {
    return ensureBackupTextSize(text);
  } catch {
    throw new Error(t("backup.tooLarge"));
  }
}

async function runBusy(action: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  status.value = "";
  try {
    await action();
  } catch (error) {
    status.value = error instanceof Error ? error.message : t("backup.error");
  } finally {
    busy.value = false;
  }
}

function onCopy() {
  void runBusy(async () => {
    const text = await buildCurrentBackupText();
    const result = await copyBackupText(text);
    manualCopyText.value = result === "manual" ? text : "";
    status.value = result === "copied" ? t("backup.copySuccess") : "";
    if (result === "manual") {
      await nextTick();
      manualCopyTextarea.value?.focus();
      manualCopyTextarea.value?.select();
    }
  });
}

function onDownload() {
  void runBusy(async () => {
    downloadBackupText(await buildCurrentBackupText());
    status.value = t("backup.downloadSuccess");
  });
}

function onPaste() {
  void runBusy(async () => {
    inputText.value = await readBackupClipboard();
    preview.value = null;
    status.value = t("backup.pasteSuccess");
  });
}

function onFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  void runBusy(async () => {
    inputText.value = await readBackupFile(file);
    preview.value = null;
    status.value = t("backup.fileSuccess", { name: file.name });
  });
}

function onValidate() {
  void runBusy(async () => {
    preview.value = parseBackup(inputText.value);
  });
}

function onInputChanged() {
  preview.value = null;
  status.value = "";
}

function onRestore() {
  const validated = preview.value;
  if (!validated) return;
  void runBusy(async () => {
    applyBackup(validated.backup);
  });
}

function onCancelPreview() {
  preview.value = null;
  status.value = "";
}
</script>
