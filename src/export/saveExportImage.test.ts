import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dataUrlToBlob,
  saveExportImage,
  type ExportCanvasLike,
  type SaveImageAdapter,
} from "./saveExportImage";

// 1x1 の有効な PNG data URL（atob で復号可能）
const VALID_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const OPTS = { filename: "CandyBoost-Planner_2026-07-19-00-00-00.png", shareTitle: "test" };

type CanvasCfg = {
  toBlob: "resolve" | "null" | "throw" | "hang";
  blob?: Blob;
  toDataURL?: "ok" | "throw";
  dataUrl?: string;
};

function makeCanvas(cfg: CanvasCfg) {
  const calls = { toBlob: 0, toDataURL: 0 };
  const canvas: ExportCanvasLike = {
    width: 1024,
    height: 768,
    toBlob(cb) {
      calls.toBlob++;
      switch (cfg.toBlob) {
        case "resolve":
          cb(cfg.blob ?? new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
          break;
        case "null":
          cb(null);
          break;
        case "throw":
          throw new Error("toBlob failed");
        case "hang":
          break; // callback を呼ばない
      }
    },
    toDataURL() {
      calls.toDataURL++;
      if (cfg.toDataURL === "throw") throw new Error("toDataURL failed");
      return cfg.dataUrl ?? VALID_PNG_DATA_URL;
    },
  };
  return { canvas, calls };
}

type AdapterCfg = {
  isLikelyIOS?: boolean;
  share?: (d: { files: File[]; title: string }) => Promise<void>;
  canShare?: (d: { files: File[] }) => boolean;
};

function makeAdapter(cfg: AdapterCfg = {}) {
  const log = {
    createdUrls: [] as string[],
    revoked: [] as string[],
    downloads: [] as Array<{ url: string; filename: string }>,
    files: [] as Array<{ name: string; type: string }>,
    pageHideHandlers: [] as Array<() => void>,
    pageHideActive: 0,
    visibleHandlers: [] as Array<() => void>,
    visibleActive: 0,
    shareCalls: 0,
  };
  let urlSeq = 0;
  let sharePending = false;

  const adapter: SaveImageAdapter = {
    isLikelyIOS: cfg.isLikelyIOS ?? false,
    share: cfg.share
      ? (d) => {
          log.shareCalls++;
          sharePending = true;
          const p = cfg.share!(d);
          const clear = () => {
            sharePending = false;
          };
          p.then(clear, clear);
          return p;
        }
      : undefined,
    isSharePending: () => sharePending,
    canShare: cfg.canShare,
    createFile: (_parts, name, type) => {
      log.files.push({ name, type });
      return { name, type } as unknown as File;
    },
    createObjectURL: () => {
      const u = `blob:test/${urlSeq++}`;
      log.createdUrls.push(u);
      return u;
    },
    revokeObjectURL: (u) => {
      log.revoked.push(u);
    },
    triggerDownload: (url, filename) => {
      log.downloads.push({ url, filename });
    },
    setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimer: (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
    onPageHide: (fn) => {
      log.pageHideHandlers.push(fn);
      log.pageHideActive++;
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        log.pageHideActive--;
      };
    },
    onVisibleAgain: (fn) => {
      log.visibleHandlers.push(fn);
      log.visibleActive++;
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        log.visibleActive--;
      };
    },
  };
  return { adapter, log };
}

function firePageHide(log: ReturnType<typeof makeAdapter>["log"]) {
  for (const h of [...log.pageHideHandlers]) h();
}

function fireVisibleAgain(log: ReturnType<typeof makeAdapter>["log"]) {
  for (const h of [...log.visibleHandlers]) h();
}

/** shareViaSheet が onVisibleAgain を登録するまで microtask を進める（fake timer 下でも安全） */
async function waitVisibleRegistered(log: ReturnType<typeof makeAdapter>["log"]) {
  for (let i = 0; i < 50 && log.visibleHandlers.length === 0; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("dataUrlToBlob", () => {
  it("base64 data URL を Blob へ変換する", () => {
    const blob = dataUrlToBlob(VALID_PNG_DATA_URL);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("data URL でない場合は throw する", () => {
    expect(() => dataUrlToBlob("notadataurl")).toThrow();
  });
});

describe("saveExportImage — 非iOS download", () => {
  it("toBlob 成功で downloaded、URL生成→triggerDownload、canvas解放", async () => {
    const { canvas } = makeCanvas({ toBlob: "resolve" });
    const { adapter, log } = makeAdapter({ isLikelyIOS: false });

    const res = await saveExportImage(canvas, OPTS, adapter);

    expect(res).toEqual({ kind: "downloaded" });
    expect(log.createdUrls).toHaveLength(1);
    expect(log.downloads).toHaveLength(1);
    expect(log.downloads[0].filename).toBe(OPTS.filename);
    // canvas は解放される
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it("60秒後に Object URL を revoke する", async () => {
    const { canvas } = makeCanvas({ toBlob: "resolve" });
    const { adapter, log } = makeAdapter();
    await saveExportImage(canvas, OPTS, adapter);

    expect(log.revoked).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(log.revoked).toEqual(log.createdUrls);
    // timer 解放後は pagehide listener も残らない
    expect(log.pageHideActive).toBe(0);
  });

  it("pagehide でも revoke し、冪等（timer と二重にrevokeしない）", async () => {
    const { canvas } = makeCanvas({ toBlob: "resolve" });
    const { adapter, log } = makeAdapter();
    await saveExportImage(canvas, OPTS, adapter);

    firePageHide(log);
    expect(log.revoked).toHaveLength(1);
    expect(log.pageHideActive).toBe(0);

    // その後 60 秒経過しても二重 revoke しない
    await vi.advanceTimersByTimeAsync(60000);
    expect(log.revoked).toHaveLength(1);
  });
});

describe("saveExportImage — toBlob fallback", () => {
  it("toBlob が null なら toDataURL fallback を 1 回だけ使い downloaded", async () => {
    const { canvas, calls } = makeCanvas({ toBlob: "null" });
    const { adapter } = makeAdapter();
    const res = await saveExportImage(canvas, OPTS, adapter);
    expect(res).toEqual({ kind: "downloaded" });
    expect(calls.toDataURL).toBe(1);
  });

  it("toBlob が throw でも fallback で downloaded", async () => {
    const { canvas, calls } = makeCanvas({ toBlob: "throw" });
    const { adapter } = makeAdapter();
    const res = await saveExportImage(canvas, OPTS, adapter);
    expect(res).toEqual({ kind: "downloaded" });
    expect(calls.toDataURL).toBe(1);
  });

  it("toBlob callback が返らない → timeout後に fallback で downloaded", async () => {
    const { canvas, calls } = makeCanvas({ toBlob: "hang" });
    const { adapter } = makeAdapter();
    const p = saveExportImage(canvas, OPTS, adapter);
    await vi.advanceTimersByTimeAsync(8000);
    const res = await p;
    expect(res).toEqual({ kind: "downloaded" });
    expect(calls.toDataURL).toBe(1);
  });

  it("toBlob も toDataURL も失敗 → error blob-failed、canvas は解放", async () => {
    const { canvas } = makeCanvas({ toBlob: "null", toDataURL: "throw" });
    const { adapter, log } = makeAdapter();
    const res = await saveExportImage(canvas, OPTS, adapter);
    expect(res).toEqual({ kind: "error", reason: "blob-failed" });
    expect(log.downloads).toHaveLength(0);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });
});

describe("saveExportImage — iOS share", () => {
  it("canShare=true + share 成功 → shared、Object URL 未生成", async () => {
    const { canvas } = makeCanvas({ toBlob: "resolve" });
    const { adapter, log } = makeAdapter({
      isLikelyIOS: true,
      share: () => Promise.resolve(),
      canShare: () => true,
    });
    const res = await saveExportImage(canvas, OPTS, adapter);
    expect(res).toEqual({ kind: "shared" });
    expect(log.shareCalls).toBe(1);
    expect(log.createdUrls).toHaveLength(0); // share は Object URL を作らない
    expect(canvas.width).toBe(0);
  });

  it("share が AbortError → cancelled（fallback しない）、canvas 解放", async () => {
    const abort = Object.assign(new Error("cancel"), { name: "AbortError" });
    const { canvas } = makeCanvas({ toBlob: "resolve" });
    const { adapter, log } = makeAdapter({
      isLikelyIOS: true,
      share: () => Promise.reject(abort),
      canShare: () => true,
    });
    const res = await saveExportImage(canvas, OPTS, adapter);
    expect(res).toEqual({ kind: "cancelled" });
    expect(log.createdUrls).toHaveLength(0);
    expect(canvas.width).toBe(0);
  });

  it("share 一般失敗（非 AbortError）→ manual-save（成功扱いにしない）", async () => {
    const { canvas } = makeCanvas({ toBlob: "resolve" });
    const { adapter, log } = makeAdapter({
      isLikelyIOS: true,
      share: () => Promise.reject(new Error("share failed")),
      canShare: () => true,
    });
    const res = await saveExportImage(canvas, OPTS, adapter);
    expect(res).toEqual({ kind: "manual-save", url: log.createdUrls[0] });
    expect(log.createdUrls).toHaveLength(1);
  });

  it("share が resolve しない → timeout で dismissed", async () => {
    const { canvas } = makeCanvas({ toBlob: "resolve" });
    const { adapter, log } = makeAdapter({
      isLikelyIOS: true,
      share: () => new Promise<void>(() => {}), // hang
      canShare: () => true,
    });
    const p = saveExportImage(canvas, OPTS, adapter);
    await vi.advanceTimersByTimeAsync(3000);
    const res = await p;
    expect(res).toEqual({ kind: "dismissed" });
    expect(log.createdUrls).toHaveLength(0);
  });

  it("share が resolve しない + シート閉鎖(visibilitychange) → timeout 前に dismissed で即復帰", async () => {
    const { canvas } = makeCanvas({ toBlob: "resolve" });
    const { adapter, log } = makeAdapter({
      isLikelyIOS: true,
      share: () => new Promise<void>(() => {}), // hang
      canShare: () => true,
    });
    const p = saveExportImage(canvas, OPTS, adapter);
    await waitVisibleRegistered(log);
    fireVisibleAgain(log); // 共有シートが閉じてページ復帰
    const res = await p;
    expect(res).toEqual({ kind: "dismissed" });
    // listener は解除される（連続保存で蓄積しない）
    expect(log.visibleActive).toBe(0);
  });

  it("share が同期 throw（InvalidStateError＝共有中）→ manual-save（長押し保存へ）", async () => {
    const { canvas } = makeCanvas({ toBlob: "resolve" });
    const { adapter, log } = makeAdapter({
      isLikelyIOS: true,
      share: () => {
        throw Object.assign(new Error("share in progress"), { name: "InvalidStateError" });
      },
      canShare: () => true,
    });
    const res = await saveExportImage(canvas, OPTS, adapter);
    expect(res).toEqual({ kind: "manual-save", url: log.createdUrls[0] });
    expect(log.createdUrls).toHaveLength(1); // ビューア表示用の Object URL を生成
  });

  it("share が InvalidStateError で reject → manual-save（長押し保存へ）", async () => {
    const err = Object.assign(new Error("in progress"), { name: "InvalidStateError" });
    const { canvas } = makeCanvas({ toBlob: "resolve" });
    const { adapter, log } = makeAdapter({
      isLikelyIOS: true,
      share: () => Promise.reject(err),
      canShare: () => true,
    });
    const res = await saveExportImage(canvas, OPTS, adapter);
    expect(res).toEqual({ kind: "manual-save", url: log.createdUrls[0] });
    expect(log.createdUrls).toHaveLength(1);
  });

  it("canShare=false（file share 不可）→ manual-save", async () => {
    const { canvas } = makeCanvas({ toBlob: "resolve" });
    const { adapter, log } = makeAdapter({
      isLikelyIOS: true,
      share: () => Promise.resolve(),
      canShare: () => false,
    });
    const res = await saveExportImage(canvas, OPTS, adapter);
    expect(res).toEqual({ kind: "manual-save", url: log.createdUrls[0] });
    expect(log.shareCalls).toBe(0);
    expect(log.createdUrls).toHaveLength(1);
  });

  it("iOS だが share API 無し → manual-save", async () => {
    const { canvas } = makeCanvas({ toBlob: "resolve" });
    const { adapter, log } = makeAdapter({ isLikelyIOS: true }); // share undefined
    const res = await saveExportImage(canvas, OPTS, adapter);
    expect(res).toEqual({ kind: "manual-save", url: log.createdUrls[0] });
    expect(log.createdUrls).toHaveLength(1);
  });

  it("直前の share が未settle（古いiOSの共有中）→ 2回目は share を呼ばず manual-save", async () => {
    const { adapter, log } = makeAdapter({
      isLikelyIOS: true,
      share: () => new Promise<void>(() => {}), // hang（resolve/reject しない）
      canShare: () => true,
    });
    // 1回目: hang → timeout で dismissed。sharePending は立ったまま。
    const p1 = saveExportImage(makeCanvas({ toBlob: "resolve" }).canvas, OPTS, adapter);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await p1).toEqual({ kind: "dismissed" });
    expect(log.shareCalls).toBe(1);

    // 2回目: 前回が未settle → share を呼ばず長押し保存へ（誤トーストにしない）
    const res2 = await saveExportImage(makeCanvas({ toBlob: "resolve" }).canvas, OPTS, adapter);
    expect(res2.kind).toBe("manual-save");
    expect(log.shareCalls).toBe(1); // 2回目は share を呼ばない
  });
});

describe("saveExportImage — 蓄積しない", () => {
  it("連続2回 save で URL/timer/listener が蓄積しない", async () => {
    const { adapter, log } = makeAdapter();

    await saveExportImage(makeCanvas({ toBlob: "resolve" }).canvas, OPTS, adapter);
    await saveExportImage(makeCanvas({ toBlob: "resolve" }).canvas, OPTS, adapter);

    expect(log.createdUrls).toHaveLength(2);
    // どちらも 60 秒後に解放され、pagehide listener も残らない
    await vi.advanceTimersByTimeAsync(60000);
    expect(log.revoked).toHaveLength(2);
    expect(log.pageHideActive).toBe(0);
  });
});
