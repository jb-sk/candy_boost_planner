import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import {
  mergeSegments,
  parseBonusList,
  parseBonusTable,
  parseColumnHeaderRanges,
  parseDateRange,
  parseHistoryTable,
  parseMultiplier,
  parseBoostFromSummary,
  parseBoostKindsFromSummary,
  parseSleepExpFromSummary,
} from '../../scripts/event-bonus-parser.mjs';
import { deriveWikiKnownThrough, parseEventList } from '../../scripts/generate-events.mjs';

/** HTML断片は実際のWikiページから採ったもの */
function loadTable(html: string) {
  const $ = cheerio.load(`<table>${html}</table>`);
  return { $, table: $('table').get(0) };
}

describe('parseDateRange', () => {
  it('「4:00 ～ 翌3:59」の終端をゲーム日の前日へ寄せる', () => {
    // ゲーム内日は04:00切り替え。8/24 3:59 終了はゲーム日 8/23 の終わり
    expect(parseDateRange('開催期間：2026年8/17(月) 4:00 ～ 8/24(月) 3:59')).toMatchObject({
      from: '2026-08-17',
      to: '2026-08-23',
    });
  });

  it('漢字表記・スラッシュ表記・時刻なしを同じ形に読む', () => {
    expect(parseDateRange('2025年5月19日(月)4:00～5月26日(月)3:59')).toMatchObject({
      from: '2025-05-19',
      to: '2025-05-25',
    });
    expect(parseDateRange('2025/7/14 4:00～2025/7/21 3:59')).toMatchObject({
      from: '2025-07-14',
      to: '2025-07-20',
    });
    // 一覧ページは時刻を書かないので、終端をずらしてはいけない
    expect(parseDateRange('2026年8月17日(月)～8月23日(日)')).toMatchObject({
      from: '2026-08-17',
      to: '2026-08-23',
    });
  });

  it('年の記載がなければ fallbackYear を使い、月が戻れば年跨ぎとみなす', () => {
    expect(parseDateRange('1/1(月) 4:00 ～ 1/8(月) 3:59', 2024)).toMatchObject({
      from: '2024-01-01',
      to: '2024-01-07',
    });
    expect(parseDateRange('12/29(日) 4:00 ～ 1/5(日) 3:59', 2024)).toMatchObject({
      from: '2024-12-29',
      to: '2025-01-04',
    });
    // 年が分からないまま埋めない
    expect(parseDateRange('1/1(月) 4:00 ～ 1/8(月) 3:59')).toBeNull();
  });

  it('日付にならない文字列は null', () => {
    expect(parseDateRange('「🌕満月の日」とその前後の計３日間')).toBeNull();
  });
});

describe('parseMultiplier / parseSleepExpFromSummary', () => {
  it('倍率を読む。「-」はボーナス無し', () => {
    expect(parseMultiplier('睡眠EXP 1.25倍')).toBe(1.25);
    expect(parseMultiplier('睡眠EXP1.5倍')).toBe(1.5);
    expect(parseMultiplier('3倍')).toBe(3);
    expect(parseMultiplier('-')).toBeNull();
    expect(parseMultiplier('出現確率UP')).toBeNull();
  });

  it('一覧の要約列から睡眠EXPだけを抜く', () => {
    expect(parseSleepExpFromSummary('睡眠EXP1.5倍アメ獲得量1.5倍')).toBe(1.5);
    // リサーチEXP を睡眠EXP と取り違えない
    expect(parseSleepExpFromSummary('リサーチEXP1.5倍ゆめのかけら1.5倍')).toBeNull();
    // 倍率が書かれていなければ推測しない
    expect(parseSleepExpFromSummary('ねむけパワー増加睡眠EXP増加ピッピ系統ピックアップ')).toBeNull();
  });
});

describe('parseBoostFromSummary', () => {
  it('title属性に隠れたミニアメブーストを優先して読む', () => {
    expect(parseBoostFromSummary('<span title="アメブースト">ミニアメブースト</span>')).toBe('mini');
    expect(parseBoostKindsFromSummary('<span title="アメブースト">ミニアメブースト</span>')).toEqual({ mini: true, full: false });
    expect(parseBoostKindsFromSummary('ミニアメブーストとアメブースト')).toEqual({ mini: true, full: true });
  });

  it('通常のアメブーストと未使用時の説明文を区別する', () => {
    expect(parseBoostFromSummary('アメブースト')).toBe('full');
    expect(parseBoostFromSummary('その日のアメブーストが未使用の場合に追加')).toBeNull();
    expect(parseBoostFromSummary('出現確率アップ')).toBeNull();
  });
});

describe('parseEventList', () => {
  it('warns for named rows whose period has no readable date, except explicit ignore entries', () => {
    const result = parseEventList(`
      <table>
        <tr><th>名称</th><th>開催期間</th><th>主なイベントボーナス</th></tr>
        <tr><td><a href="/poke_sleep/イベント/読めるイベント">読めるイベント</a></td><td>2026年1月1日～1月7日</td><td>-</td></tr>
        <tr><td><a href="/poke_sleep/イベント/未定イベント">未定イベント</a></td><td>開催予定</td><td>-</td></tr>
        <tr><td><a href="/poke_sleep/イベント/壊れたイベント">壊れたイベント</a></td><td>期間調整中</td><td>-</td></tr>
        <tr><td><a href="/poke_sleep/イベント/グッドスリープデー">グッドスリープデー</a></td><td>満月の日とその前後</td><td>-</td></tr>
      </table>
    `, { ignoredPages: new Set(['グッドスリープデー']) });

    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0]).toMatchObject({ name: '読めるイベント', from: '2026-01-01', to: '2026-01-07' });
    expect(result.unreadable).toEqual([
      '未定イベント: 開催期間を日付へ変換できない',
      '壊れたイベント: 開催期間を日付へ変換できない',
    ]);
  });

  it('lets a later event without Sleep EXP advance wikiKnownThrough', () => {
    expect(deriveWikiKnownThrough([
      { from: '2026-08-17', to: '2026-08-23' },
      { from: '2026-08-31', to: '2026-09-06' },
    ])).toBe('2026-09-06');
  });
});

describe('parseColumnHeaderRanges', () => {
  const period = { from: '2026-08-17', to: '2026-08-23' };

  it('「全日程」は期間全体', () => {
    expect(parseColumnHeaderRanges('全日程', period)?.ranges).toEqual([{ from: '2026-08-17', to: '2026-08-23' }]);
  });

  it('「金土日(8/21~23)」のような範囲を日付に落とす', () => {
    expect(parseColumnHeaderRanges('金土日(8/21~23)', period)?.ranges).toEqual([
      { from: '2026-08-21', to: '2026-08-23' },
    ]);
    expect(parseColumnHeaderRanges('それ以外の日(8/17~20)', period)?.ranges).toEqual([
      { from: '2026-08-17', to: '2026-08-20' },
    ]);
  });

  it('「元日(1/1)、最終日(1/7)」のような単日の列挙を分けて返す', () => {
    expect(parseColumnHeaderRanges('元日(1/1)、最終日(1/7)', { from: '2024-01-01', to: '2024-01-07' })?.ranges).toEqual([
      { from: '2024-01-01', to: '2024-01-01' },
      { from: '2024-01-07', to: '2024-01-07' },
    ]);
  });

  it('日付に落とせない列ヘッダは null（推測で埋めない）', () => {
    // グッドスリープデーは月齢依存なので、日付の書かれた列がない
    expect(parseColumnHeaderRanges('🌕 満月の日', period)).toBeNull();
    expect(parseColumnHeaderRanges('それ以外の日（満月の日の前後）', period)).toBeNull();
  });
});

describe('parseBonusTable', () => {
  it('値セルに倍率が入る形式を colspan ごと読む（アニポケコラボウィーク）', () => {
    const { $, table } = loadTable(`
      <tr><th>ボーナス項目</th><th>金土日<br>(8/21~23)</th><th>それ以外の日<br>(8/17~20)</th></tr>
      <tr><td>ねむけパワー</td><td>1.3倍</td><td>-</td></tr>
      <tr><td rowspan="2">おてつだいポケモン</td><td colspan="2">メインスキル発生確率 1.25倍</td></tr>
      <tr><td colspan="2">睡眠EXP 1.25倍</td></tr>
    `);
    const parsed = parseBonusTable($, table, { from: '2026-08-17', to: '2026-08-23' });
    // colspan=2 なので期間全体。ねむけパワーの1.3倍を拾ってはいけない
    expect(parsed?.segments).toEqual([{ from: '2026-08-17', to: '2026-08-23', multiplier: 1.25 }]);
    expect(parsed?.warnings).toEqual([]);
  });

  it('項目セルが「睡眠EXP」で値が列ごとに分かれる形式を読む（ニューイヤー2024）', () => {
    const { $, table } = loadTable(`
      <tr><th>ボーナス項目</th><th>元日(1/1)、最終日(1/7)</th><th>それ以外の日 (1/2~1/6)</th></tr>
      <tr><td>ポケモンの睡眠EXP</td><td>1.5倍</td><td>1.5倍</td></tr>
      <tr><td>ボーナススリープポイント</td><td>+512pt</td><td>+200pt</td></tr>
    `);
    const parsed = parseBonusTable($, table, { from: '2024-01-01', to: '2024-01-07' });
    // 全日1.5倍なので1区間に畳まれる
    expect(parsed?.segments).toEqual([{ from: '2024-01-01', to: '2024-01-07', multiplier: 1.5 }]);
  });

  it('週によってボーナスが変わる表を週ごとに分ける（3周年記念フェスティバル）', () => {
    const { $, table } = loadTable(`
      <tr><th>ボーナス項目</th><th>1週目 (7/13~7/19)</th><th>2週目 (7/20~7/26)</th></tr>
      <tr><td rowspan="2">おてつだいポケモン</td><td>メインスキル発生確率1.5倍</td><td>-</td></tr>
      <tr><td>睡眠EXP1.5倍</td><td>-</td></tr>
      <tr><td>料理の最終エナジー</td><td>-</td><td>1.5倍 (大成功：3倍)</td></tr>
    `);
    const parsed = parseBonusTable($, table, { from: '2026-07-13', to: '2026-07-26' });
    // 2週目は「-」なので睡眠EXPボーナスは無い
    expect(parsed?.segments).toEqual([{ from: '2026-07-13', to: '2026-07-19', multiplier: 1.5 }]);
  });

  it('アイテム効果の表は拾わない（あおいタネの睡眠EXP3倍）', () => {
    const { $, table } = loadTable(`
      <tr><th>タネの種類</th><th>効果</th></tr>
      <tr><td>あおいタネ</td><td>おてつだいポケモンが獲得する睡眠EXP3倍</td></tr>
    `);
    // 1列目が「ボーナス項目」でない表は対象外
    expect(parseBonusTable($, table, { from: '2026-07-13', to: '2026-07-26' })).toBeNull();
  });

  it('列ヘッダを日付に落とせなければ倍率を捨てて警告する（グッドスリープデー）', () => {
    const { $, table } = loadTable(`
      <tr><th>ボーナス項目</th><th>🌕 満月の日</th><th>🌖 それ以外の日（満月の日の前後）</th></tr>
      <tr><td>ポケモンの睡眠EXP</td><td>3倍</td><td>2倍</td></tr>
    `);
    const parsed = parseBonusTable($, table, { from: '2026-08-27', to: '2026-08-29' });
    expect(parsed?.segments).toEqual([]);
    expect(parsed?.warnings.length).toBeGreaterThan(0);
  });
});

describe('parseBonusList', () => {
  it('箇条書きの倍率をイベント全体に当てる（ポケモンすくすくウィーク）', () => {
    const $ = cheerio.load(`<div id="body"><ul>
      <li>おてつだいポケモンの睡眠EXP1.5倍</li>
      <li>睡眠リサーチでのアメ獲得量1.5倍</li>
    </ul></div>`);
    const parsed = parseBonusList($, $('#body').get(0), { from: '2025-05-19', to: '2025-05-25' });
    expect(parsed?.segments).toEqual([{ from: '2025-05-19', to: '2025-05-25', multiplier: 1.5 }]);
  });

  it('説明文中の言及は拾わない', () => {
    const $ = cheerio.load(`<div id="body"><ul>
      <li>1週間続くこのキャンペーンは、睡眠EXP や アメ獲得量 が増える特別な期間です。詳しくは以下のボーナス効果を参照してください。</li>
    </ul></div>`);
    expect(parseBonusList($, $('#body').get(0), { from: '2025-05-19', to: '2025-05-25' })).toBeNull();
  });
});

describe('mergeSegments', () => {
  it('同じ倍率の隣接区間を畳む', () => {
    expect(
      mergeSegments([
        { from: '2024-01-01', to: '2024-01-01', multiplier: 1.5 },
        { from: '2024-01-02', to: '2024-01-06', multiplier: 1.5 },
        { from: '2024-01-07', to: '2024-01-07', multiplier: 1.5 },
      ]),
    ).toEqual([{ from: '2024-01-01', to: '2024-01-07', multiplier: 1.5 }]);
  });

  it('離れた区間は畳まない', () => {
    expect(
      mergeSegments([
        { from: '2024-01-01', to: '2024-01-02', multiplier: 1.5 },
        { from: '2024-01-05', to: '2024-01-06', multiplier: 1.5 },
      ]),
    ).toHaveLength(2);
  });

  it('同じ日に別の倍率が重なったら壊れているので落とす', () => {
    expect(() =>
      mergeSegments([
        { from: '2024-01-01', to: '2024-01-03', multiplier: 1.5 },
        { from: '2024-01-02', to: '2024-01-04', multiplier: 2 },
      ]),
    ).toThrow('同じ日に異なる睡眠EXP倍率がある');
  });
});

describe('parseHistoryTable', () => {
  it('開催履歴表から複数回の期間を取る', () => {
    const { $, table } = loadTable(`
      <tr><th>#</th><th>画像</th><th>開催期間</th><th>期間限定パック</th></tr>
      <tr><td>1</td><td></td><td>2024年7月1日(月)～7月7日(日)</td><td>vol.1</td></tr>
      <tr><td>2</td><td></td><td>2024年8月5日(月)～8月11日(日)</td><td>vol.2</td></tr>
    `);
    expect(parseHistoryTable($, table)).toEqual([
      { from: '2024-07-01', to: '2024-07-07' },
      { from: '2024-08-05', to: '2024-08-11' },
    ]);
  });

  it('開催期間の列がない表は対象外', () => {
    const { $, table } = loadTable(`<tr><th>名前</th><th>内容</th></tr><tr><td>a</td><td>b</td></tr>`);
    expect(parseHistoryTable($, table)).toBeNull();
  });
});
