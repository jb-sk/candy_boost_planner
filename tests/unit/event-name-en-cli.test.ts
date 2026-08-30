import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `--list-pending` の**標準出力そのものが CI の契約**（設計書 §21.7）。
 * `auto-update-events.yml` は次の2つを stdout から読んでいる。
 *
 *   PENDING=$(echo "$OUTPUT" | sed -n 's/^\[SUMMARY\] pending=//p' | tail -1)
 *   echo "$OUTPUT" | grep -E '^\[check-event-names-en\]|^  \? '
 *
 * 関数を直接呼ぶテストでは、**ログの書式を変えた瞬間に CI が黙って壊れる**のを落とせない
 * （`pending=` が読めないと `has_pending=true` に倒れ、毎日フェッチし続ける）。
 * ここでは実際にCLIを起動して、書式と終了コードだけを固定する。
 * 内部の関数名・分割の仕方には一切触れないので、リファクタでは壊れない。
 */
const SCRIPT = fileURLToPath(new URL("../../scripts/generate-event-names-en.mjs", import.meta.url));
const BLOCK_FETCH = pathToFileURL(fileURLToPath(new URL("../fixtures/block-fetch.mjs", import.meta.url))).href;

function runListPending(extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [SCRIPT, "--list-pending"], {
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
}

describe("generate-event-names-en --list-pending CLI contract", () => {
  it("prints the pending count in the exact shape the workflow parses", () => {
    const result = runListPending();

    expect(result.status).toBe(0);
    // ワークフローの sed が読む行。桁数や前後の空白を変えると CI の分岐が壊れる。
    const summary = result.stdout.split(/\r?\n/).filter(line => line.startsWith("[SUMMARY] pending="));
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatch(/^\[SUMMARY\] pending=(\d+|unknown)$/);
    // ワークフローの grep が拾う見出し行。
    expect(result.stdout).toMatch(/^\[check-event-names-en\] /m);
  });

  it("never exits non-zero, so the workflow can branch instead of failing", () => {
    // 未解決は「失敗」ではなく分岐材料。ここを exit 1 にすると
    // 英語名が埋まるまで毎日ジョブが赤くなる。
    expect(runListPending().status).toBe(0);
  });

  it("makes no network request at all, even when --refresh is passed", () => {
    // robots.txt を含め1本でも投げると `--import` のスタブが例外を投げ、
    // CLI は 判定不能 → pending=unknown へ倒れる。そうならないことを見る。
    const result = spawnSync(process.execPath, [SCRIPT, "--list-pending", "--refresh"], {
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: `--import ${BLOCK_FETCH}` },
    });

    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toContain("NETWORK_ACCESS_NOT_ALLOWED");
    expect(result.stdout).toContain("[SUMMARY] pending=");
    expect(result.stdout).not.toContain("pending=unknown");
    // 取得系のログが出ていないこと（robots.txt の確認ログもここでは出てはいけない）。
    expect(result.stdout).not.toContain("robots.txt");
    expect(result.stdout).not.toContain("キャッシュ読み込み");
  });
});
