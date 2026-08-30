import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { readOverrides } from "../../scripts/generate-events.mjs";
import {
  listPendingEventNameKeys,
  matchEventNames,
  parseBulbapediaEventArchive,
  parseEnglishEventArchive,
  renderOutput,
} from "../../scripts/generate-event-names-en.mjs";

const html = readFileSync(new URL("../fixtures/event-name-en-archive.html", import.meta.url), "utf8");
const parsed = parseEnglishEventArchive(html);
const bulbapediaHtml = readFileSync(new URL("../fixtures/event-name-en-bulbapedia.html", import.meta.url), "utf8");
const bulbapediaParsed = parseBulbapediaEventArchive(bulbapediaHtml);

describe("English event archive parser and period matching", () => {
  it("normalizes 03:59 end timestamps to the preceding game date", () => {
    expect(parsed.warnings).toEqual([]);
    expect(parsed.events[0]).toMatchObject({
      enName: "Exact Event",
      from: "2026-01-01",
      to: "2026-01-07",
    });
  });

  it("parses Bulbapedia event names and start dates, and warns for unreadable headings", () => {
    expect(bulbapediaParsed.events).toEqual([
      { enName: "Buncha Berries Week Part 2", from: "2026-05-11", source: "https://example.test/buncha-2" },
      { enName: "Holiday Event", from: "2025-12-29", source: "https://example.test/holiday" },
    ]);
    expect(bulbapediaParsed.warnings).toHaveLength(2);
    expect(bulbapediaParsed.warnings).toContainEqual(expect.stringContaining("June 99 - 100, 2026"));
    expect(bulbapediaParsed.warnings).toContainEqual(expect.stringContaining("June 8 - 21, 2026"));
  });

  it("matches exact periods and warns for unmatched periods", () => {
    const result = matchEventNames([
      { name: "一致", from: "2026-01-01", to: "2026-01-07" },
      { name: "不一致", from: "2026-04-01", to: "2026-04-07" },
    ], parsed.events);

    expect(result.periodMapping).toEqual({ "一致@2026-01-01": "Exact Event" });
    expect(result.nameMapping).toEqual({ "一致": "Exact Event" });
    expect(result.warnings).toContainEqual(expect.stringContaining("不一致"));
  });

  it("does not guess when multiple English events have the same period", () => {
    const result = matchEventNames([
      { name: "曖昧", from: "2026-02-01", to: "2026-02-07" },
    ], parsed.events);

    expect(result.periodMapping).toEqual({});
    expect(result.nameMapping).toEqual({});
    expect(result.stats.ambiguousOccurrences).toBe(1);
    expect(result.warnings[0]).toContain("Ambiguous A / Ambiguous B");
  });

  it("keeps differing English names by period and excludes the ambiguous name-only key", () => {
    const result = matchEventNames([
      { name: "同名", from: "2026-03-01", to: "2026-03-07" },
      { name: "同名", from: "2025-03-01", to: "2025-03-07" },
    ], parsed.events);

    expect(result.periodMapping).toEqual({
      "同名@2026-03-01": "Repeat New",
      "同名@2025-03-01": "Repeat Old",
    });
    expect(result.nameMapping).toEqual({});
    expect(result.warnings[0]).toContain("期間キーだけを生成");
  });

  it("keeps a name-only key when every occurrence has the same English name", () => {
    const result = matchEventNames([
      { name: "同一名", from: "2026-05-01", to: "2026-05-07" },
      { name: "同一名", from: "2025-05-01", to: "2025-05-07" },
    ], [
      { enName: "Stable Name", from: "2026-05-01", to: "2026-05-07" },
      { enName: "Stable Name", from: "2025-05-01", to: "2025-05-07" },
    ]);

    expect(result.nameMapping).toEqual({ "同一名": "Stable Name" });
  });

  it("uses a manual name override to fill an unresolved unambiguous occurrence", () => {
    const result = matchEventNames(
      [{ name: "手動補完", from: "2026-06-01", to: "2026-06-07" }],
      [],
      [{ name: "手動補完", en: "Manual Name" }],
    );
    expect(result.periodMapping).toEqual({ "手動補完@2026-06-01": "Manual Name" });
    expect(result.nameMapping).toEqual({ "手動補完": "Manual Name" });
  });

  it("rejects a name override that would collapse differing period names", () => {
    expect(() => matchEventNames(
      [
        { name: "同名", from: "2026-03-01", to: "2026-03-07" },
        { name: "同名", from: "2025-03-01", to: "2025-03-07" },
      ],
      parsed.events,
      [{ name: "同名", en: "Collapsed Name" }],
    )).toThrow("開催回ごとに異なる自動取得名を一つへ潰す");
  });

  it("prefers an exact Super Wiki period over a Bulbapedia start-date match", () => {
    const result = matchEventNames(
      [{ name: "優先", from: "2026-01-01", to: "2026-01-07" }],
      [{ enName: "Super Name", from: "2026-01-01", to: "2026-01-07", source: "https://super.test/event" }],
      [],
      [{ enName: "Bulba Name", from: "2026-01-01", source: "https://bulba.test/event" }],
    );
    expect(result.periodMapping).toEqual({ "優先@2026-01-01": "Super Name" });
    expect(result.stats.sources.superWiki).toBe(1);
    expect(result.warnings).toContainEqual(expect.stringContaining("ソース間で不一致"));
  });

  it("stops warning about a source disagreement once a period override adjudicates it", () => {
    const result = matchEventNames(
      [{ name: "裁定済み", from: "2026-01-01", to: "2026-01-07" }],
      [{ enName: "Super Name", from: "2026-01-01", to: "2026-01-07" }],
      [{ name: "裁定済み", from: "2026-01-01", en: "Official Name", source: "https://official.test/news" }],
      [{ enName: "Bulba Name", from: "2026-01-01" }],
    );
    // 採用されるのは override なので、「Super Wiki を採用」と書く警告は嘘になる。
    expect(result.periodMapping).toEqual({ "裁定済み@2026-01-01": "Official Name" });
    expect(result.stats.sources.override).toBe(1);
    expect(result.warnings).not.toContainEqual(expect.stringContaining("ソース間で不一致"));
  });

  it("does not warn when the two sources differ only by dash style or spacing", () => {
    const result = matchEventNames(
      [{ name: "記号ゆれ", from: "2025-12-22", to: "2025-12-28" }],
      [{ enName: "Holiday 2025 — Double Dream Shard Research", from: "2025-12-22", to: "2025-12-28" }],
      [],
      [{ enName: "Holiday 2025 -  Double Dream Shard Research", from: "2025-12-22" }],
    );
    // 採る値は正規化しない。Super Wiki の表記をそのまま出す。
    expect(result.periodMapping).toEqual({ "記号ゆれ@2025-12-22": "Holiday 2025 — Double Dream Shard Research" });
    expect(result.warnings).not.toContainEqual(expect.stringContaining("ソース間で不一致"));
  });

  it("uses a Bulbapedia start-date match when the Super Wiki period does not match", () => {
    const result = matchEventNames(
      [{ name: "終了日揺れ", from: "2026-05-11", to: "2026-05-17" }],
      [{ enName: "Wrong-period Super", from: "2026-05-11", to: "2026-05-27" }],
      [],
      [{ enName: "Buncha Berries Week Part 2", from: "2026-05-11" }],
    );
    expect(result.periodMapping).toEqual({ "終了日揺れ@2026-05-11": "Buncha Berries Week Part 2" });
    expect(result.stats.sources.bulbapedia).toBe(1);
  });

  it("does not use Bulbapedia when multiple candidates share a start date", () => {
    const result = matchEventNames(
      [{ name: "開始日曖昧", from: "2026-07-01", to: "2026-07-07" }],
      [],
      [],
      [
        { enName: "Candidate A", from: "2026-07-01" },
        { enName: "Candidate B", from: "2026-07-01" },
      ],
    );
    expect(result.periodMapping).toEqual({});
    expect(result.warnings).toContainEqual(expect.stringContaining("Candidate A / Candidate B"));
  });

  it("applies a from-specific override only to the targeted occurrence", () => {
    const result = matchEventNames(
      [
        { name: "同名", from: "2026-08-01", to: "2026-08-07" },
        { name: "同名", from: "2025-08-01", to: "2025-08-07" },
      ],
      [
        { enName: "Automatic New", from: "2026-08-01", to: "2026-08-07" },
        { enName: "Automatic Old", from: "2025-08-01", to: "2025-08-07" },
      ],
      [{ name: "同名", from: "2026-08-01", en: "Manual New", source: "https://override.test/new" }],
    );
    expect(result.periodMapping).toEqual({
      "同名@2026-08-01": "Manual New",
      "同名@2025-08-01": "Automatic Old",
    });
    expect(result.nameMapping).toEqual({});
  });

  it("rejects a from-specific override for a nonexistent occurrence", () => {
    expect(() => matchEventNames(
      [{ name: "実在", from: "2026-09-01", to: "2026-09-07" }],
      [],
      [{ name: "実在", from: "2026-09-08", en: "Wrong Date" }],
    )).toThrow("eventHistory の開催回に当たらない");
  });

  it("validates from-specific override dates and allows separate occurrences of one name", () => {
    const directory = mkdtempSync(join(tmpdir(), "event-name-overrides-"));
    const file = join(directory, "overrides.json");
    try {
      writeFileSync(file, JSON.stringify({ nameEn: [
        { name: "同名", from: "2026-01-01", en: "Part 2", reason: "test", source: "https://example.test/2" },
        { name: "同名", from: "2025-01-01", en: "Part 1", reason: "test", source: "https://example.test/1" },
      ] }));
      expect(readOverrides(file).nameEn).toHaveLength(2);

      writeFileSync(file, JSON.stringify({ nameEn: [
        { name: "同名", from: "2026-02-30", en: "Invalid", reason: "test", source: "https://example.test/invalid" },
      ] }));
      expect(() => readOverrides(file)).toThrow("nameEn の from が不正");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("generated file round trip", () => {
  // 書く側（renderOutput）と読む側（listPendingEventNameKeys）は別の関数だが、
  // **同じ書式を前提にしている**。片方だけ整形を変えるとCIの未解決判定が黙って狂う
  // （辞書に名前があるのに「未解決」と読まれ、毎日フェッチし続ける）。
  // 中身の実装ではなく「書いたものが読み返せる」ことだけを固定するので、リファクタに強い。
  const eventDataSource = `
    export const sleepExpEventSegments = [
      { name: "区間名", from: "2026-01-01", to: "2026-01-07", multiplier: 1.5, source: "wiki" },
    ] as const;
    export const eventHistory = [{"name":"履歴名","from":"2026-01-01","to":"2026-01-07","sleepExp":{"multiplier":1.5,"from":"2026-01-01","to":"2026-01-07"}}] as const;
  `;

  it("reads back every key it wrote", () => {
    const rendered = renderOutput(
      { "履歴名@2026-01-01": "History Name", "区間名@2026-01-01": "Segment Name" },
      { "履歴名": "History Name" },
    );
    expect(listPendingEventNameKeys(eventDataSource, rendered)).toEqual([]);
  });

  it("reads back keys containing quotes, backslashes and non-ASCII text", () => {
    // 生成物はイベント名をそのままキーにする。引用符やダッシュを含む名前で
    // 書式が破綻すると、その回だけ永久に未解決になる。
    const trickyName = '引用"符\\と—ダッシュ';
    const rendered = renderOutput({
      [`${trickyName}@2026-01-01`]: 'Name "quoted" — dashed',
      "区間名@2026-01-01": "Segment Name",
    }, {});
    const source = `
      export const sleepExpEventSegments = [
        { name: "区間名", from: "2026-01-01", to: "2026-01-07", multiplier: 1.5, source: "wiki" },
      ] as const;
      export const eventHistory = ${JSON.stringify([
    { name: trickyName, from: "2026-01-01", to: "2026-01-07" },
  ])} as const;
    `;
    expect(listPendingEventNameKeys(source, rendered)).toEqual([]);
  });

  it("reports a key as pending when it is absent from the rendered file", () => {
    const rendered = renderOutput({ "履歴名@2026-01-01": "History Name" }, {});
    expect(listPendingEventNameKeys(eventDataSource, rendered)).toEqual(["区間名@2026-01-01"]);
  });
});

describe("pending English event-name check", () => {
  const eventDataSource = `
    export const sleepExpEventSegments = [
      { name: "区間名", from: "2026-01-01", to: "2026-01-07", multiplier: 1.5, source: "wiki" },
    ] as const;
    export const eventHistory = [{"name":"履歴名","from":"2026-01-01","to":"2026-01-07","sleepExp":{"multiplier":1.5,"from":"2026-01-01","to":"2026-01-07"}}] as const;
  `;

  it("returns no pending keys when both generated names are resolved", () => {
    const eventNameSource = `export const eventNameJaToEnByPeriod = {
      "履歴名@2026-01-01": "English Name",
      "区間名@2026-01-01": "English Name",
    };`;
    expect(listPendingEventNameKeys(eventDataSource, eventNameSource)).toEqual([]);
  });

  it("lists unresolved history and segment keys", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const eventNameSource = "export const eventNameJaToEnByPeriod = {};";
    try {
      expect(listPendingEventNameKeys(eventDataSource, eventNameSource)).toEqual([
        "区間名@2026-01-01",
        "履歴名@2026-01-01",
      ]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
