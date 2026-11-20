// Unified generator entry for MasterDB + indices + candy families.
//
// Goal:
// - Provide ONE operational entrypoint for "MasterDB creation".
// - Generate and verify all outputs (including pre/post form & disappearance checks
//   when --pokesleep-tool or POKESLEEP_TOOL_PATH is supplied) in a temporary staging
//   directory first — even in --dry-run — so pre-verify auto-fixes flow into downstream
//   master/index/candy-family/post-verify stages identically to normal execution.
// - On non-dry-run, hold an exclusive lockfile for the publish target from baseline read
//   through atomic 2-phase publish/rollback completion, and verify baseline contents
//   before committing so concurrent runs or external edits never interleave or clobber
//   each other.
//
// Usage:
// - npm run generate:master
// - npm run generate:master -- --non-interactive
// - npm run generate:master -- --interactive
// - npm run generate:master -- --dry-run
// - npm run generate:master -- --db <path-to-pokemon-db.json>
// - npm run generate:master -- --pokesleep-tool <path> [--allow-removed-dex <ids>]
//
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderPokemonDbTs } from "./generate-pokemon-db.mjs";
import { normalizePokemonDbPayloadForPublish } from "./pokemon-db-validation.mjs";
import { acquirePublishLocks, resolveFileLockPath } from "./publish-lock.mjs";

export { acquirePublishLocks, resolveFileLockPath };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

export const PUBLIC_FILES = {
  dbTs: path.join(ROOT, "src/domain/pokesleep/pokemon-db.ts"),
  dbJson: path.join(ROOT, "src/domain/pokesleep/_generated/pokemon-db.json"),
  master: path.join(ROOT, "src/domain/pokesleep/pokemon-master.ts"),
  index: path.join(ROOT, "src/domain/pokesleep/pokemon-names.ts"),
  formLabelTs: path.join(ROOT, "src/domain/pokesleep/_generated/form-label-ja-to-en.ts"),
  candyFamily: path.join(ROOT, "src/domain/pokesleep/_generated/candy-family.ts"),
  known: path.join(__dirname, "exp-type-known.json"),
  overrides: path.join(__dirname, "exp-type-overrides.json"),
  ingCNullKnown: path.join(__dirname, "ing-c-null-known.json"),
  formJaToNumber: path.join(__dirname, "form-ja-to-number.json"),
  formLabelJaToEn: path.join(__dirname, "form-label-ja-to-en.json"),
  formAliases: path.join(__dirname, "form-aliases.json"),
  testConfig: path.join(ROOT, "tests/fixtures/test-config.json"),
};

function hasArg(argv, name) {
  return argv.includes(name);
}

function getArgValue(argv, name) {
  const idx = argv.indexOf(name);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith("--")) {
    return argv[idx + 1];
  }
  return null;
}

/**
 * --pokesleep-tool 引数、POKESLEEP_TOOL_PATH 環境変数の順でツールパスを解決する。
 * @param {string | null | undefined} cliValue
 * @param {Record<string, string | undefined>} [env]
 */
export function resolvePokesleepToolPath(cliValue, env = process.env) {
  const fromCli = typeof cliValue === "string" ? cliValue.trim() : "";
  if (fromCli) return fromCli;
  const fromEnv = typeof env?.POKESLEEP_TOOL_PATH === "string" ? env.POKESLEEP_TOOL_PATH.trim() : "";
  return fromEnv || null;
}

class StepExitError extends Error {
  /** @param {number} exitCode */
  constructor(exitCode) {
    super(`Step exited with code ${exitCode}`);
    this.exitCode = exitCode;
  }
}

function run(cmd, args, env = process.env) {
  try {
    execFileSync(cmd, args, { stdio: "inherit", env });
  } catch (err) {
    const code = typeof err?.status === "number" ? err.status : 1;
    throw new StepExitError(code);
  }
}

function copyIfExists(srcPath, destPath) {
  if (!fs.existsSync(srcPath)) return;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
}

/**
 * ベースライン（期待内容マップ）と現在の公開先ディスク内容を照合し、外部変更があれば中断する。
 * @param {Map<string, string | null> | undefined} expectedBaseline
 * @param {string} phaseLabel
 */
function assertBaselineUnchanged(expectedBaseline, phaseLabel) {
  if (!expectedBaseline) return;
  for (const [destPath, expectedContent] of expectedBaseline.entries()) {
    const currentContent = fs.existsSync(destPath) ? fs.readFileSync(destPath, "utf8") : null;
    if (currentContent !== expectedContent) {
      throw new Error(
        `${phaseLabel}に公開対象ファイルが外部変更されたため中断しました: ${destPath}`,
      );
    }
  }
}

/**
 * 全公開対象ペアと現行公開ファイルを比較し、変更が生じる項目一覧を返す。
 * @param {Array<{ src: string, dest: string }>} filePairs
 */
export function collectPendingPublishItems(filePairs) {
  /** @type {Array<{ dest: string, nextContent: string, existed: boolean, prevContent: string | null, stagedTmpPath: string | null, backupPath: string | null }>} */
  const pending = [];
  const seenDests = new Set();

  for (const { src, dest } of filePairs) {
    const resolvedDest = path.resolve(dest);
    if (seenDests.has(resolvedDest)) {
      throw new Error(`publishFilesWithRollback: duplicate destination ${dest}`);
    }
    seenDests.add(resolvedDest);

    if (!fs.existsSync(src)) continue;
    const nextContent = fs.readFileSync(src, "utf8");
    const existed = fs.existsSync(dest);
    const prevContent = existed ? fs.readFileSync(dest, "utf8") : null;
    if (
      prevContent !== null &&
      prevContent.replace(/\r\n/g, "\n") === nextContent.replace(/\r\n/g, "\n")
    ) {
      continue;
    }
    pending.push({
      dest,
      nextContent,
      existed,
      prevContent,
      stagedTmpPath: null,
      backupPath: null,
    });
  }

  return pending;
}

/**
 * ステージング済みファイル群を公開先へ反映する（排他ロック＋ベースライン検証＋2相コミット）。
 * 1) 呼び出し側で排他ロックを保持していない場合は、公開先共通の排他ロックファイルを取得し、
 *    現行ファイル読み込みから公開・復元の完了まで他更新の割り込みを防ぐ。
 * 2) expectedBaseline が渡された場合は、公開直前に現行ファイルが外部変更されていないことを検証する。
 * 3) 公開先に1件も触れる前に、同一ファイルシステム上へ全一時ファイルと既存ファイルの復元用バックアップを事前作成する。
 * 4) 準備完了後、rename のみで順次置換する。途中で失敗した場合は確保済みバックアップの rename のみで
 *    書き込みを伴わず復元し、復元自体に失敗したバックアップは手動復旧用に残す。
 * @param {Array<{ src: string, dest: string }>} filePairs
 * @param {{
 *   writeFile?: (p: string, data: string) => void,
 *   renameFile?: (src: string, dest: string) => void,
 *   rollbackRenameFile?: (src: string, dest: string) => void,
 *   lockPath?: string,
 *   lockHeld?: boolean,
 *   expectedBaseline?: Map<string, string | null>,
 * }} [deps]
 * @returns {string[]} 実際に更新した公開先パス一覧
 */
export function publishFilesWithRollback(filePairs, deps = {}) {
  const writeFile = deps.writeFile ?? ((p, data) => fs.writeFileSync(p, data, "utf8"));
  const renameFile = deps.renameFile ?? ((src, dest) => fs.renameSync(src, dest));
  const rollbackRenameFile = deps.rollbackRenameFile ?? ((src, dest) => fs.renameSync(src, dest));

  const releaseLock = deps.lockHeld
    ? () => {}
    : acquirePublishLocks(filePairs.map((p) => p.dest));

  try {
    // 比較元（ベースライン）が外部変更されていないかを準備前に検証
    assertBaselineUnchanged(deps.expectedBaseline, "実行中");

    const pending = collectPendingPublishItems(filePairs);
    if (pending.length === 0) return [];

    const runTag = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Phase A: 公開先を一切書き換える前に、全ファイルの更新用一時ファイルと復元用バックアップを同一FSへ事前確保
    /** @type {string[]} */
    const createdPaths = [];
    const cleanupCreatedPaths = () => {
      for (const p of createdPaths) {
        try {
          if (fs.existsSync(p)) fs.rmSync(p, { force: true });
        } catch {
          // ignore cleanup error
        }
      }
    };
    try {
      for (let idx = 0; idx < pending.length; idx++) {
        const item = pending[idx];
        const dir = path.dirname(item.dest);
        const base = path.basename(item.dest);
        fs.mkdirSync(dir, { recursive: true });

        const stagedTmpPath = path.join(dir, `.${base}.tmp-${runTag}-${idx}`);
        item.stagedTmpPath = stagedTmpPath;
        createdPaths.push(stagedTmpPath);
        writeFile(stagedTmpPath, item.nextContent);

        if (item.existed && item.prevContent !== null) {
          const backupPath = path.join(dir, `.${base}.bak-${runTag}-${idx}`);
          item.backupPath = backupPath;
          createdPaths.push(backupPath);
          writeFile(backupPath, item.prevContent);
        }
      }

      // 全ファイルの準備を終えた後、最初の置換直前にもベースラインと各公開先の未変更を再確認する
      // （ロックを使わない手動編集等との競合を上書き前に検出）
      assertBaselineUnchanged(deps.expectedBaseline, "公開準備中");
      for (const item of pending) {
        const currentExisted = fs.existsSync(item.dest);
        const currentContent = currentExisted ? fs.readFileSync(item.dest, "utf8") : null;
        if (currentExisted !== item.existed || currentContent !== item.prevContent) {
          throw new Error(
            `公開準備中に公開対象ファイルが外部変更されたため中断しました: ${item.dest}`,
          );
        }
      }
    } catch (prepareErr) {
      cleanupCreatedPaths();
      throw prepareErr;
    }

    // Phase B: rename のみで原子置換（途中失敗時は確保済みバックアップの rename のみで新規書き込みなし復元）
    /** @type {typeof pending} */
    const attempted = [];
    try {
      for (const item of pending) {
        attempted.push(item);
        renameFile(/** @type {string} */ (item.stagedTmpPath), item.dest);
      }
    } catch (commitErr) {
      /** @type {Set<string>} */
      const preservedBackups = new Set();
      for (let i = attempted.length - 1; i >= 0; i--) {
        const item = attempted[i];
        try {
          if (item.existed && item.backupPath) {
            if (fs.existsSync(item.backupPath)) {
              rollbackRenameFile(item.backupPath, item.dest);
            }
          } else if (fs.existsSync(item.dest)) {
            fs.rmSync(item.dest, { force: true });
          }
        } catch (rollbackErr) {
          if (item.backupPath && fs.existsSync(item.backupPath)) {
            preservedBackups.add(item.backupPath);
            console.error(
              `[generate-master] rollback failed for ${item.dest} (backup preserved at ${item.backupPath}): ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
            );
          } else {
            console.error(
              `[generate-master] rollback failed for ${item.dest}: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
            );
          }
        }
      }

      for (const item of pending) {
        if (item.stagedTmpPath) {
          try {
            if (fs.existsSync(item.stagedTmpPath)) fs.rmSync(item.stagedTmpPath, { force: true });
          } catch {
            // ignore cleanup error
          }
        }
        if (item.backupPath && !preservedBackups.has(item.backupPath)) {
          try {
            if (fs.existsSync(item.backupPath)) fs.rmSync(item.backupPath, { force: true });
          } catch {
            // ignore cleanup error
          }
        }
      }
      throw commitErr;
    }

    // Phase C: 全置換成功後に不要になったバックアップを削除
    for (const item of pending) {
      if (item.backupPath) {
        try {
          if (fs.existsSync(item.backupPath)) fs.rmSync(item.backupPath, { force: true });
        } catch (cleanupErr) {
          console.warn(
            `[generate-master] backup cleanup failed for ${item.backupPath}: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
          );
        }
      }
    }

    return attempted.map((w) => w.dest);
  } finally {
    releaseLock();
  }
}

/**
 * --db で指定された Wiki DB JSON を PokemonDbEntry 準拠スキーマで検証・正規化し、
 * 同一の正規化済みデータから同期公開用の staged.dbJson / staged.dbTs を生成する。
 * @param {string} explicitDbPath
 * @param {string} stagedDbJsonPath
 * @param {string} stagedDbTsPath
 */
export function stageExplicitDbSnapshot(explicitDbPath, stagedDbJsonPath, stagedDbTsPath) {
  const resolvedDbPath = path.resolve(explicitDbPath);
  const rawText = fs.readFileSync(resolvedDbPath, "utf8");
  const rawJson = JSON.parse(rawText);
  const normalized = normalizePokemonDbPayloadForPublish(rawJson, resolvedDbPath);
  fs.mkdirSync(path.dirname(stagedDbJsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(stagedDbTsPath), { recursive: true });
  fs.writeFileSync(stagedDbJsonPath, JSON.stringify(normalized, null, 2), "utf8");
  fs.writeFileSync(
    stagedDbTsPath,
    renderPokemonDbTs({
      source: normalized.source,
      headers: normalized.headers,
      items: normalized.items,
    }),
    "utf8",
  );
}

/**
 * マスター生成・検証・公開パイプラインを実行する。
 * - dryRun 時も通常実行と同一のステージング経路（事前検証の反映→マスター生成→アメ系統→生成後厳格検証）を通し、
 *   全公開対象ファイル（pokemon-db.ts / pokemon-db.json を含む）の最終差分を報告する。
 * - 通常実行時は現行ファイルの読み込みから公開・復元の完了まで排他ロックを保持し、
 *   さらに公開直前にベースライン未変更を確認してから2相コミットする。
 * @param {{
 *   interactive?: boolean,
 *   dryRun?: boolean,
 *   pokesleepTool?: string | null,
 *   explicitDbPath?: string | null,
 *   allowRemovedDex?: string | null,
 *   publicFiles?: typeof PUBLIC_FILES,
 *   env?: Record<string, string | undefined>,
 *   removeTmpDir?: (dir: string) => void,
 * }} [options]
 * @returns {{ exitCode: number, hasChanges: boolean, changedFiles: string[] }}
 */
export function runMasterPipeline(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const interactive = dryRun ? false : Boolean(options.interactive);
  const env = options.env ?? process.env;
  const pokesleepTool = resolvePokesleepToolPath(options.pokesleepTool, env);
  const explicitDbPath = options.explicitDbPath ?? null;
  const allowRemovedDex = options.allowRemovedDex ?? null;
  const publicFiles = options.publicFiles ?? PUBLIC_FILES;
  const removeTmpDir = options.removeTmpDir ?? ((dir) => fs.rmSync(dir, { recursive: true, force: true }));

  let exitCode = 0;
  /** @type {string[]} */
  let changedFiles = [];
  let releaseLock = () => {};
  /** @type {string | null} */
  let tmpDir = null;

  const scriptPath = (name) => path.join(__dirname, name);

  try {
    // 通常実行時は現行ファイルの読み込みから公開・復元完了まで全公開先ファイルを排他ロックする
    if (!dryRun) {
      releaseLock = acquirePublishLocks(Object.values(publicFiles));
    }

    try {
      // 公開直前の外部変更検知用ベースラインを記録
    /** @type {Map<string, string | null>} */
    const baselineByDest = new Map();
    for (const destPath of Object.values(publicFiles)) {
      baselineByDest.set(destPath, fs.existsSync(destPath) ? fs.readFileSync(destPath, "utf8") : null);
    }

    tmpDir = fs.mkdtempSync(path.join(tmpdir(), "pokemon-master-stage-"));
      const staged = {
        dbTs: path.join(tmpDir, "pokemon-db.ts"),
        dbJson: path.join(tmpDir, "pokemon-db.json"),
        baselineMaster: path.join(tmpDir, "baseline-pokemon-master.ts"),
        master: path.join(tmpDir, "pokemon-master.ts"),
        index: path.join(tmpDir, "pokemon-names.ts"),
        formLabelTs: path.join(tmpDir, "form-label-ja-to-en.ts"),
        candyFamily: path.join(tmpDir, "candy-family.ts"),
        known: path.join(tmpDir, "exp-type-known.json"),
        overrides: path.join(tmpDir, "exp-type-overrides.json"),
        ingCNullKnown: path.join(tmpDir, "ing-c-null-known.json"),
        formJaToNumber: path.join(tmpDir, "form-ja-to-number.json"),
        formLabelJaToEn: path.join(tmpDir, "form-label-ja-to-en.json"),
        formAliases: path.join(tmpDir, "form-aliases.json"),
        testConfig: path.join(tmpDir, "test-config.json"),
      };

      // 現行の公開ファイルをステージング領域へコピーし、差分比較と更新をすべて一時領域内で完結させる
      copyIfExists(publicFiles.master, staged.baselineMaster);
      for (const key of [
      "master",
      "index",
      "formLabelTs",
      "candyFamily",
      "known",
      "overrides",
      "ingCNullKnown",
      "formJaToNumber",
      "formLabelJaToEn",
      "formAliases",
      "testConfig",
    ]) {
      copyIfExists(publicFiles[key], staged[key]);
    }

    // Step 1: Wiki スナップショットをステージングへ準備（dry-run でも一時領域内のみへ生成）
    if (explicitDbPath) {
      stageExplicitDbSnapshot(explicitDbPath, staged.dbJson, staged.dbTs);
    } else {
      run(
        process.execPath,
        [
          scriptPath("generate-pokemon-db.mjs"),
          "--out-file",
          staged.dbTs,
          "--out-json",
          staged.dbJson,
        ],
        env,
      );
    }

    // Step 1.5: pokesleep-tool 指定時（CLI 引数または POKESLEEP_TOOL_PATH）は、
    // 公開前の旧マスターを比較元にして同一 Wiki スナップショットで事前フォーム突合・既存種消失検査を行う。
    // dry-run でもステージング内の対応表へ自動修正を反映し、後続の生成・検証へ渡す（公開先は無傷）。
    if (pokesleepTool) {
      const preVerifyArgs = [
        scriptPath("verify-form-mapping.mjs"),
        "--pokesleep-tool",
        pokesleepTool,
        "--db",
        staged.dbJson,
        "--master",
        staged.baselineMaster,
        "--names",
        staged.index,
        "--form-ja-to-number",
        staged.formJaToNumber,
        "--form-label-ja-to-en",
        staged.formLabelJaToEn,
        "--form-aliases",
        staged.formAliases,
      ];
      if (allowRemovedDex) preVerifyArgs.push("--allow-removed-dex", allowRemovedDex);
      run(process.execPath, preVerifyArgs, env);
    }

    // Step 2: intermediate -> staged master + indices（未知フォーム・未知食材・重複矛盾・旧エイリアスで中断）
    const masterArgs = [
      scriptPath("generate-pokemon-master.mjs"),
      interactive ? "--interactive" : "--non-interactive",
      "--db",
      staged.dbJson,
      "--out-master",
      staged.master,
      "--out-index",
      staged.index,
      "--out-form-label-ts",
      staged.formLabelTs,
      "--known",
      staged.known,
      "--overrides",
      staged.overrides,
      "--ing-c-null-known",
      staged.ingCNullKnown,
      "--form-ja-to-number",
      staged.formJaToNumber,
      "--form-label-ja-to-en",
      staged.formLabelJaToEn,
      "--form-aliases",
      staged.formAliases,
      "--test-config",
      staged.testConfig,
    ];
    run(process.execPath, masterArgs, env);

    // Step 3: staged master -> staged candy family map（失敗時は公開先へ一切触れない）
    const familyArgs = [
      scriptPath("generate-candy-families.mjs"),
      "--master",
      staged.master,
      "--output",
      staged.candyFamily,
    ];
    if (pokesleepTool) familyArgs.push("--pokesleep-tool", pokesleepTool);
    run(process.execPath, familyArgs, env);

    // Step 3.5: pokesleep-tool 指定時は dry-run を含め公開前にステージング上の新索引を厳格検証
    if (pokesleepTool) {
      const postVerifyArgs = [
        scriptPath("verify-form-mapping.mjs"),
        "--pokesleep-tool",
        pokesleepTool,
        "--db",
        staged.dbJson,
        "--master",
        staged.baselineMaster,
        "--names",
        staged.index,
        "--form-ja-to-number",
        staged.formJaToNumber,
        "--form-label-ja-to-en",
        staged.formLabelJaToEn,
        "--form-aliases",
        staged.formAliases,
        "--verify-generated",
      ];
      if (allowRemovedDex) postVerifyArgs.push("--allow-removed-dex", allowRemovedDex);
      run(process.execPath, postVerifyArgs, env);
    }

    // Step 4: 全公開対象ファイル（pokemon-db.ts / pokemon-db.json 含む）の最終差分を集計・報告し、通常実行のみ反映
    const pairs = [
      { src: staged.dbTs, dest: publicFiles.dbTs },
      { src: staged.dbJson, dest: publicFiles.dbJson },
      { src: staged.master, dest: publicFiles.master },
      { src: staged.index, dest: publicFiles.index },
      { src: staged.formLabelTs, dest: publicFiles.formLabelTs },
      { src: staged.candyFamily, dest: publicFiles.candyFamily },
      { src: staged.known, dest: publicFiles.known },
      { src: staged.overrides, dest: publicFiles.overrides },
      { src: staged.ingCNullKnown, dest: publicFiles.ingCNullKnown },
      { src: staged.formJaToNumber, dest: publicFiles.formJaToNumber },
      { src: staged.formLabelJaToEn, dest: publicFiles.formLabelJaToEn },
      { src: staged.formAliases, dest: publicFiles.formAliases },
      { src: staged.testConfig, dest: publicFiles.testConfig },
    ];
    changedFiles = collectPendingPublishItems(pairs).map((p) => p.dest);
    console.log(
      `[generate-master] [SUMMARY] has_changes=${changedFiles.length > 0} changed_files=${changedFiles.length}`,
    );
    for (const p of changedFiles) {
      const rel = path.relative(ROOT, p);
      const label = rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : p;
      console.log(`  ~ ${label}`);
    }

    if (dryRun) {
      console.log("[generate-master] dry-run: all staged outputs verified; public files untouched");
    } else {
      const updated = publishFilesWithRollback(pairs, {
        lockHeld: true,
        expectedBaseline: baselineByDest,
      });
      for (const p of updated) {
        console.log(`[generate-master] published ${p}`);
      }
    }
    } catch (err) {
      if (err instanceof StepExitError) {
        exitCode = err.exitCode;
      } else {
        console.error(err instanceof Error ? err.message : String(err));
        exitCode = 1;
      }
    } finally {
      // 一時ディレクトリの削除失敗（EBUSY 等）で元の終了理由やロック解放を潰さない
      if (tmpDir) {
        try {
          removeTmpDir(tmpDir);
        } catch (rmErr) {
          console.warn(
            `[generate-master] failed to clean up staging dir ${tmpDir}: ${rmErr instanceof Error ? rmErr.message : String(rmErr)}`,
          );
        }
      }
    }
  } catch (lockErr) {
    console.error(lockErr instanceof Error ? lockErr.message : String(lockErr));
    exitCode = 1;
  } finally {
    releaseLock();
  }

  return {
    exitCode,
    hasChanges: changedFiles.length > 0,
    changedFiles,
  };
}

function main() {
  const argv = process.argv;
  const forceInteractive = hasArg(argv, "--interactive");
  const forceNonInteractive = hasArg(argv, "--non-interactive");
  const dryRun = hasArg(argv, "--dry-run");
  const pokesleepTool = resolvePokesleepToolPath(getArgValue(argv, "--pokesleep-tool"), process.env);
  const explicitDbPath = getArgValue(argv, "--db");
  const allowRemovedDex = getArgValue(argv, "--allow-removed-dex");

  const interactive = forceNonInteractive ? false : forceInteractive ? true : Boolean(process.stdin.isTTY);

  const result = runMasterPipeline({
    interactive,
    dryRun,
    pokesleepTool,
    explicitDbPath,
    allowRemovedDex,
  });

  if (result.exitCode !== 0) {
    process.exit(result.exitCode);
  }
}

const isEntrypoint =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isEntrypoint) {
  main();
}
