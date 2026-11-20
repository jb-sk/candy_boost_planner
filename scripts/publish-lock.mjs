import fs from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * 単一公開先ファイルに対応する排他ロックファイルパスを返す。
 * @param {string} destPath
 */
export function resolveFileLockPath(destPath) {
  const resolved = path.resolve(destPath);
  return path.join(path.dirname(resolved), `.${path.basename(resolved)}.publish.lock`);
}

/**
 * 複数公開先に対する排他ロックを正規化パスの昇順で一括取得し、解放関数を返す。
 * - ディレクトリ作成からロック作成・メタデータ書き込みまでを同一の失敗処理で扱う。
 * - openSync("wx") 成功直後に解放対象へ登録するため、直後の書き込みで ENOSPC 等が起きても空ロックを残さない。
 * - 既にロックが存在する (EEXIST) 場合は他プロセスのロックを消さずに取得済み分だけ解放して例外を送出する。
 * @param {string[]} destPaths
 * @param {{
 *   mkdirSync?: (dir: string) => void,
 *   openSync?: (p: string, flags: string) => number,
 *   writeSync?: (fd: number, data: string) => void,
 *   closeSync?: (fd: number) => void,
 *   rmSync?: (p: string) => void,
 * }} [deps]
 */
export function acquirePublishLocks(destPaths, deps = {}) {
  const mkdirSync = deps.mkdirSync ?? ((dir) => fs.mkdirSync(dir, { recursive: true }));
  const openSync = deps.openSync ?? ((p, flags) => fs.openSync(p, flags));
  const writeSync = deps.writeSync ?? ((fd, data) => fs.writeFileSync(fd, data, "utf8"));
  const closeSync = deps.closeSync ?? ((fd) => fs.closeSync(fd));
  const rmSync = deps.rmSync ?? ((p) => fs.rmSync(p, { force: true }));

  const uniqueLockPaths = [
    ...new Set(destPaths.map((p) => resolveFileLockPath(p))),
  ].sort();

  /** @type {Array<{ lockPath: string, fd: number | null }>} */
  const acquired = [];
  const releaseAcquired = () => {
    for (let i = acquired.length - 1; i >= 0; i--) {
      const entry = acquired[i];
      if (entry.fd !== null) {
        try {
          closeSync(entry.fd);
        } catch {
          // ignore close error
        }
        entry.fd = null;
      }
      try {
        if (fs.existsSync(entry.lockPath)) rmSync(entry.lockPath);
      } catch (unlockErr) {
        console.warn(
          `[publish-lock] lock cleanup failed for ${entry.lockPath}: ${unlockErr instanceof Error ? unlockErr.message : String(unlockErr)}`,
        );
      }
    }
    acquired.length = 0;
  };

  for (const lockPath of uniqueLockPaths) {
    try {
      mkdirSync(path.dirname(lockPath));
      const fd = openSync(lockPath, "wx");
      // ロック作成直後に解放対象へ登録し、メタデータ書き込み失敗時にも残存ロックを必ず回収する
      acquired.push({ lockPath, fd });
      writeSync(
        fd,
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n",
      );
    } catch (err) {
      releaseAcquired();
      if (/** @type {{ code?: string }} */ (err)?.code === "EEXIST") {
        let holder = "";
        try {
          holder = fs.readFileSync(lockPath, "utf8").trim();
        } catch {
          // ignore read error
        }
        throw new Error(
          `公開ロック取得に失敗しました（別の更新が実行中か異常終了の残存ロックです）: ${lockPath}${holder ? ` (${holder})` : ""}`,
          { cause: err },
        );
      }
      throw err;
    }
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseAcquired();
  };
}
