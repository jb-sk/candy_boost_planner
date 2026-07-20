/**
 * fbl03: Canvas を PNG Blob 化し、share / download / 新規tab で保存する。
 *
 * 非決定的な browser API はすべて {@link SaveImageAdapter} 越しに扱い、
 * node 環境の vitest で全失敗経路を単体テストできるようにする。
 * この関数は `new Date()` を呼ばず、filename / shareTitle は呼び出し側から受ける。
 */

/** テスト用に最小化した canvas インターフェース（HTMLCanvasElement が満たす） */
export type ExportCanvasLike = {
  toBlob(cb: (blob: Blob | null) => void, type?: string): void;
  toDataURL(type?: string): string;
  width: number;
  height: number;
};

export type SaveExportImageOutcome =
  | { kind: "shared" }
  | { kind: "downloaded" }
  | { kind: "cancelled" } // share の AbortError（ユーザーキャンセル）
  | { kind: "dismissed" } // share 提示後の timeout / 画面復帰（共有シート側で完結扱い・fallbackしない）
  | { kind: "manual-save"; url: string } // 共有不可 → アプリ内で長押し保存させる（url は呼び出し側が解放）
  | { kind: "error"; reason: "blob-failed" | "unknown" };

/** 非決定的な browser API を抽象化。テストでは fake を注入する。 */
export type SaveImageAdapter = {
  isLikelyIOS: boolean;
  /** navigator.share 相当。未対応なら undefined。 */
  share?: (data: { files: File[]; title: string }) => Promise<void>;
  /** navigator.canShare 相当。未対応（undefined）は判定不能として share 可能側に倒す。 */
  canShare?: (data: { files: File[] }) => boolean;
  createFile: (parts: BlobPart[], name: string, type: string) => File;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  /** a[download] 生成→click 相当。 */
  triggerDownload: (url: string, filename: string) => void;
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
  /** pagehide 登録。解除関数を返す。 */
  onPageHide: (fn: () => void) => () => void;
  /** 共有シートが閉じてページが再表示された時に発火（visibilitychange/focus）。解除関数を返す。
   *  未対応(undefined)なら share の settle / timeout のみで決着する。 */
  onVisibleAgain?: (fn: () => void) => () => void;
  /** 直前の navigator.share がまだ settle していない（古い iOS で共有が「共有中」のまま詰まった状態）か。
   *  true の間は share を再度呼んでもシートが出ず失敗するため、長押し保存へフォールバックする。 */
  isSharePending?: () => boolean;
};

const PNG = "image/png";
/** toBlob callback が返らない環境向けの上限。 */
const TOBLOB_TIMEOUT_MS = 8000;
/** iOS で share promise が resolve/reject しない場合に busy を解除する上限。
 *  共有シートは提示済みのため、超過しても window.open へは fallback しない（静かに終了）。
 *  保存自体は共有シート側で完結し File は canvas/busy から独立しているため、短くても保存は壊れない。 */
const SHARE_TIMEOUT_MS = 3000;
/** tab/download 用 Object URL の遅延解放。即時 revoke は保存前破棄を招くため避ける。 */
const URL_REVOKE_DELAY_MS = 60000;

/**
 * data URL を Blob へ変換する純関数（`fetch` を使わずテストで決定的にする）。
 * base64 / URL エンコードの両方を扱う。
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("invalid data url");
  const meta = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mimeMatch = meta.match(/^data:([^;,]+)/i);
  const mime = mimeMatch ? mimeMatch[1] : PNG;
  const isBase64 = /;base64/i.test(meta);
  const binary = isBase64 ? atob(body) : decodeURIComponent(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * toBlob を優先し、timeout / null / throw のときだけ toDataURL fallback を 1 回だけ使う。
 * それも失敗したら null。
 */
async function canvasToPngBlob(
  canvas: ExportCanvasLike,
  adapter: SaveImageAdapter,
): Promise<Blob | null> {
  const blob = await new Promise<Blob | null>((resolve) => {
    let settled = false;
    let timer = 0;
    const done = (b: Blob | null) => {
      if (settled) return;
      settled = true;
      adapter.clearTimer(timer);
      resolve(b);
    };
    try {
      timer = adapter.setTimer(() => done(null), TOBLOB_TIMEOUT_MS);
      canvas.toBlob((b) => done(b), PNG);
    } catch {
      done(null);
    }
  });

  if (blob) return blob;

  // fallback は 1 回だけ
  try {
    const dataUrl = canvas.toDataURL(PNG);
    return dataUrlToBlob(dataUrl);
  } catch {
    return null;
  }
}

function isAbortError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { name?: unknown }).name === "AbortError"
  );
}

/**
 * tab/download 用 Object URL の解放を 60 秒後と pagehide で予約する。
 * 冪等: どちらが先に発火しても 1 回だけ revoke し、timer と listener を確実に解除して
 * 連続保存でも蓄積させない。
 */
function scheduleRevoke(url: string, adapter: SaveImageAdapter): void {
  let done = false;
  let timer = 0;
  let offPageHide: () => void = () => {};
  const cleanup = () => {
    if (done) return;
    done = true;
    try {
      adapter.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
    adapter.clearTimer(timer);
    offPageHide();
  };
  timer = adapter.setTimer(cleanup, URL_REVOKE_DELAY_MS);
  offPageHide = adapter.onPageHide(cleanup);
}

function revokeQuietly(url: string, adapter: SaveImageAdapter): void {
  try {
    adapter.revokeObjectURL(url);
  } catch {
    /* ignore */
  }
}

/**
 * 共有が使えない時のフォールバック。window.open（ポップアップ）ではなく、
 * blob の Object URL を返して呼び出し側でアプリ内表示させ「長押しで写真に保存」させる。
 * 全 iOS で確実に保存でき、ポップアップブロックの影響も受けない。
 * URL の解放（revoke）は呼び出し側（ビューアを閉じる時）が行う。
 */
function manualSave(blob: Blob, adapter: SaveImageAdapter): SaveExportImageOutcome {
  const url = adapter.createObjectURL(blob);
  return { kind: "manual-save", url };
}

function downloadBlob(
  blob: Blob,
  filename: string,
  adapter: SaveImageAdapter,
): SaveExportImageOutcome {
  let url: string | null = null;
  try {
    url = adapter.createObjectURL(blob);
    adapter.triggerDownload(url, filename);
    scheduleRevoke(url, adapter);
    return { kind: "downloaded" };
  } catch {
    // triggerDownload が throw した場合、生成済み URL を解放する（scheduleRevoke 未到達）
    if (url) revokeQuietly(url, adapter);
    return { kind: "error", reason: "unknown" };
  }
}

/** shareViaSheet の内部判定。needs-manual は「保存完了を確認できない」。 */
type ShareRaceResult = "shared" | "cancelled" | "dismissed" | "needs-manual";

/**
 * iOS の共有シート経路。保存/キャンセルは共有シート側で完結するため、
 * 「share の settle」「シート閉鎖(visibilitychange/focus)」「安全タイムアウト」の
 * 最速で決着し、window.open へは fallback しない（ポップアップ誤表示を避ける）。
 * 古い iOS で share promise が resolve/reject しなくても、シート閉鎖検知で速やかに復帰する。
 *
 * 同期 throw / AbortError以外のrejectは保存完了を確認できないため "needs-manual" とし、
 * 誤って「保存済み(dismissed)」にせず、呼び出し側で長押し保存ビューアへフォールバックする。
 */
async function shareViaSheet(
  file: File,
  blob: Blob,
  opts: { shareTitle: string },
  adapter: SaveImageAdapter,
): Promise<SaveExportImageOutcome> {
  let sharePromise: Promise<void>;
  try {
    sharePromise = adapter.share!({ files: [file], title: opts.shareTitle });
  } catch {
    // navigator.share の同期 throw（例: InvalidStateError）→ シート未提示・未保存。
    return manualSave(blob, adapter);
  }
  // race が別要因で決着した後に share が遅れて reject/resolve しても unhandled にしない
  sharePromise.catch(() => {});

  let shareTimer = 0;
  let offVisible = () => {};
  try {
    const result = await Promise.race<ShareRaceResult>([
      sharePromise.then<ShareRaceResult, ShareRaceResult>(
        () => "shared",
        (e) => isAbortError(e) ? "cancelled" : "needs-manual",
      ),
      new Promise<ShareRaceResult>((resolve) => {
        offVisible = adapter.onVisibleAgain
          ? adapter.onVisibleAgain(() => resolve("dismissed"))
          : () => {};
      }),
      new Promise<ShareRaceResult>((resolve) => {
        shareTimer = adapter.setTimer(() => resolve("dismissed"), SHARE_TIMEOUT_MS);
      }),
    ]);
    // シートが出ない、または保存完了を確認できない reject → 長押し保存へ
    if (result === "needs-manual") return manualSave(blob, adapter);
    return { kind: result };
  } finally {
    adapter.clearTimer(shareTimer);
    offVisible();
  }
}

async function dispatch(
  blob: Blob,
  opts: { filename: string; shareTitle: string },
  adapter: SaveImageAdapter,
): Promise<SaveExportImageOutcome> {
  // iOS 系: share を優先し、Object URL を作らない。
  if (adapter.isLikelyIOS && adapter.share) {
    // 直前の共有がまだ settle していない（古い iOS の「共有中」詰まり）→
    // share を再度呼んでもシートが出ず、iOS が誤って成功/黙殺を返すため、
    // 呼ばずに長押し保存ビューアへ回す（誤った成功トーストを避ける）。
    if (adapter.isSharePending?.()) {
      return manualSave(blob, adapter);
    }
    const file = adapter.createFile([blob], opts.filename, PNG);
    const canShareFiles =
      typeof adapter.canShare !== "function" || adapter.canShare({ files: [file] });
    if (canShareFiles) {
      return shareViaSheet(file, blob, opts, adapter);
    }
    // file share 不可 → 長押し保存ビューア
    return manualSave(blob, adapter);
  }

  // iOS だが share API 無し（非セキュアコンテキスト等）→ 長押し保存ビューア
  if (adapter.isLikelyIOS) {
    return manualSave(blob, adapter);
  }

  // その他 → download
  return downloadBlob(blob, opts.filename, adapter);
}

/**
 * Canvas を PNG として保存する。canvas は成否にかかわらず 1 回だけ解放する。
 */
export async function saveExportImage(
  canvas: ExportCanvasLike,
  opts: { filename: string; shareTitle: string },
  adapter: SaveImageAdapter,
): Promise<SaveExportImageOutcome> {
  let released = false;
  const releaseCanvas = () => {
    if (released) return;
    released = true;
    try {
      canvas.width = 0;
      canvas.height = 0;
    } catch {
      /* ignore */
    }
  };

  try {
    const blob = await canvasToPngBlob(canvas, adapter);
    if (!blob) return { kind: "error", reason: "blob-failed" };
    return await dispatch(blob, opts, adapter);
  } finally {
    releaseCanvas();
  }
}
