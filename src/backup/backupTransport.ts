import { BACKUP_MAX_BYTES, BackupValidationError } from "./types";

export const BACKUP_URL_REVOKE_DELAY_MS = 60_000;

export function backupFilename(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `candy-boost-planner-backup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.json`;
}

export async function copyBackupText(text: string, clipboard: Pick<Clipboard, "writeText"> | undefined = navigator.clipboard): Promise<"copied" | "manual"> {
  if (!clipboard?.writeText) return "manual";
  try {
    await clipboard.writeText(text);
    return "copied";
  } catch {
    return "manual";
  }
}

export async function readBackupClipboard(clipboard: Pick<Clipboard, "readText"> | undefined = navigator.clipboard): Promise<string> {
  if (!clipboard?.readText) throw new Error("clipboard-unavailable");
  return ensureBackupTextSize(await clipboard.readText());
}

export async function readBackupFile(file: Pick<File, "size" | "text">): Promise<string> {
  if (file.size > BACKUP_MAX_BYTES) throw new BackupValidationError("$", `maximum size is ${BACKUP_MAX_BYTES} bytes`);
  return ensureBackupTextSize(await file.text());
}

export function ensureBackupTextSize(text: string): string {
  if (new TextEncoder().encode(text).byteLength > BACKUP_MAX_BYTES) {
    throw new BackupValidationError("$", `maximum size is ${BACKUP_MAX_BYTES} bytes`);
  }
  return text;
}

export function downloadBackupText(
  text: string,
  filename = backupFilename(),
  env: Pick<typeof globalThis, "URL" | "Blob"> = globalThis,
  documentObject: Document = document,
  scheduleRevoke: (callback: () => void, delayMs: number) => void = (callback, delayMs) => {
    setTimeout(callback, delayMs);
  },
): void {
  const url = env.URL.createObjectURL(new env.Blob([text], { type: "application/json" }));
  try {
    const anchor = documentObject.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    documentObject.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Safari may consume the Object URL after the click task. Immediate revoke can
    // invalidate the download before the browser has opened it.
    scheduleRevoke(() => env.URL.revokeObjectURL(url), BACKUP_URL_REVOKE_DELAY_MS);
  }
}
