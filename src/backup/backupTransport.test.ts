import { describe, expect, it, vi } from "vitest";
import {
  BACKUP_URL_REVOKE_DELAY_MS,
  backupFilename,
  copyBackupText,
  downloadBackupText,
  readBackupClipboard,
  readBackupFile,
} from "./backupTransport";
import { BACKUP_MAX_BYTES } from "./types";

describe("backup transport", () => {
  it("uses the exact same supplied codec text for clipboard and file output", async () => {
    const text = "{\"same\":true}";
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await copyBackupText(text, { writeText })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(text);

    const click = vi.fn();
    const remove = vi.fn();
    const appendChild = vi.fn();
    const revokeObjectURL = vi.fn();
    const createObjectURL = vi.fn().mockReturnValue("blob:test");
    const blobParts: unknown[] = [];
    class FakeBlob { constructor(parts: unknown[]) { blobParts.push(...parts); } }
    const anchor = { href: "", download: "", style: { display: "" }, click, remove };
    const fakeDocument = { createElement: () => anchor, body: { appendChild } } as unknown as Document;
    let scheduledRevoke: (() => void) | undefined;
    const scheduleRevoke = vi.fn((callback: () => void) => { scheduledRevoke = callback; });
    downloadBackupText(
      text,
      "backup.json",
      { URL: { createObjectURL, revokeObjectURL } as unknown as typeof URL, Blob: FakeBlob as unknown as typeof Blob },
      fakeDocument,
      scheduleRevoke,
    );
    expect(blobParts).toEqual([text]);
    expect(anchor.download).toBe("backup.json");
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(scheduleRevoke).toHaveBeenCalledWith(expect.any(Function), BACKUP_URL_REVOKE_DELAY_MS);
    scheduledRevoke?.();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });

  it("only requests manual copy when Clipboard writing is unavailable or rejected", async () => {
    expect(await copyBackupText("x", undefined)).toBe("manual");
    expect(await copyBackupText("x", { writeText: vi.fn().mockRejectedValue(new Error("denied")) })).toBe("manual");
  });

  it("reads clipboard and file content within the size limit without parsing it", async () => {
    expect(await readBackupClipboard({ readText: vi.fn().mockResolvedValue("clipboard") })).toBe("clipboard");
    expect(await readBackupFile({ size: 4, text: vi.fn().mockResolvedValue("file") })).toBe("file");
  });

  it("rejects oversized clipboard and file text before it reaches the UI state", async () => {
    const oversized = "x".repeat(BACKUP_MAX_BYTES + 1);
    await expect(readBackupClipboard({ readText: vi.fn().mockResolvedValue(oversized) })).rejects.toThrow("maximum size");
    await expect(readBackupFile({ size: 1, text: vi.fn().mockResolvedValue(oversized) })).rejects.toThrow("maximum size");
  });

  it("creates the required filename", () => {
    expect(backupFilename(new Date(2026, 6, 22, 12, 34, 56))).toBe("candy-boost-planner-backup-20260722-123456.json");
  });
});
