/**
 * ポケモンスリープ攻略Wikiのイベントページから、睡眠EXPボーナスの
 * 「期間」と「倍率」を機械的に取り出すパーサ。
 *
 * fetch を持たない純粋関数だけを置く（テスト可能にするため）。
 * 取得と生成は scripts/generate-events.mjs 側。
 *
 * 読めなかったものは null / 例外で返し、呼び出し側が警告する。
 * 推測で埋めない（誤った倍率が黙って本番に出るのが最悪のため）。
 */

/** 全角チルダ・波ダッシュ・ハイフンを ~ に寄せ、空白を潰す */
export function normalizeText(value) {
  return String(value ?? "")
    .replace(/ /g, " ")
    .replace(/\*\d+/g, "") // WikiWiki脚注マーカー
    .replace(/[～〜]/g, "~")
    .replace(/[ \t\r\n]+/g, " ")
    .trim();
}

/**
 * rowspan/colspan を仮想グリッドへ展開する。
 * scripts/generate-terms.mjs の buildGrid と同じ方式。
 */
export function buildGrid($, tableEl) {
  const rows = $(tableEl).find("tr").toArray();
  const grid = [];
  for (let r = 0; r < rows.length; r++) {
    if (!grid[r]) grid[r] = [];
    let col = 0;
    for (const cell of $(rows[r]).find("th,td").toArray()) {
      while (grid[r][col] !== undefined) col++;
      const rowSpan = Number.parseInt($(cell).attr("rowspan") || "1", 10) || 1;
      const colSpan = Number.parseInt($(cell).attr("colspan") || "1", 10) || 1;
      for (let dr = 0; dr < rowSpan; dr++) {
        for (let dc = 0; dc < colSpan; dc++) {
          if (!grid[r + dr]) grid[r + dr] = [];
          grid[r + dr][col + dc] = cell;
        }
      }
      col += colSpan;
    }
  }
  return grid;
}

/* ------------------------------------------------------------------ *
 * 日付
 * ------------------------------------------------------------------ */

const MS_PER_DAY = 86_400_000;

function pad(value, width) {
  return String(value).padStart(width, "0");
}

/** {year, month, day} -> "YYYY-MM-DD"（GameDate と同じ表記） */
export function toGameDate(parts) {
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
}

export function parseGameDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** 暦日を加算する（"YYYY-MM-DD" -> "YYYY-MM-DD"） */
export function addDays(gameDate, delta) {
  const parts = parseGameDate(gameDate);
  if (!parts) throw new RangeError(`Invalid date: ${gameDate}`);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + delta * MS_PER_DAY);
  return toGameDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

export function compareDates(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 「4:00 ～ 翌3:59」形式の終端をゲーム日へ直す。
 *
 * ゲーム内日は 04:00 に切り替わるので、`8/24(月) 3:59` 終了は
 * ゲーム日 8/23 の終わりを指す。時刻が 4:00 未満なら前日に寄せる。
 */
export function endDateFromClock(endDate, hour, minute) {
  if (hour === null || hour === undefined) return endDate;
  const isBeforeDayBoundary = hour < 4 || (hour === 4 && minute === 0);
  return isBeforeDayBoundary ? addDays(endDate, -1) : endDate;
}

const DATE_TOKEN = String.raw`(?:(\d{4})\s*[年/]\s*)?(\d{1,2})\s*[月/]\s*(\d{1,2})\s*日?`;
const CLOCK_TOKEN = String.raw`(?:\s*\(.\))?\s*(?:(\d{1,2})\s*:\s*(\d{2}))?`;
const RANGE_RE = new RegExp(`${DATE_TOKEN}${CLOCK_TOKEN}\\s*~\\s*${DATE_TOKEN}${CLOCK_TOKEN}`);

/**
 * 「2026年8/17(月) 4:00 ~ 8/24(月) 3:59」のような開催期間を
 * ゲーム日の [from, to]（両端含む）へ直す。
 *
 * @param {unknown} text 期間を含む文字列
 * @param {number | null} [fallbackYear=null] 年の記載がないときに使う年（null なら年なしは失敗）
 */
export function parseDateRange(text, fallbackYear = null) {
  const normalized = normalizeText(text);
  const m = RANGE_RE.exec(normalized);
  if (!m) return null;

  const [, y1, mo1, d1, h1, , y2, mo2, d2, h2, mi2] = m;
  const startYear = y1 ? Number(y1) : fallbackYear;
  if (startYear === null || !Number.isInteger(startYear)) return null;

  const from = toGameDate({ year: startYear, month: Number(mo1), day: Number(d1) });
  if (!parseGameDate(from)) return null;

  // 終端に年がなく、月が戻っていれば年跨ぎ（12月 -> 1月）
  const endYear = y2
    ? Number(y2)
    : Number(mo2) < Number(mo1)
      ? startYear + 1
      : startYear;
  const rawTo = toGameDate({ year: endYear, month: Number(mo2), day: Number(d2) });
  if (!parseGameDate(rawTo)) return null;

  const to = endDateFromClock(rawTo, h2 === undefined ? null : Number(h2), mi2 === undefined ? 0 : Number(mi2));
  if (compareDates(from, to) > 0) return null;
  return { from, to, hadEndClock: h2 !== undefined, startHour: h1 === undefined ? null : Number(h1) };
}

/**
 * ページ本文から「開催期間：〜」を全部拾う（1週目/2週目のように複数ある）。
 * @param {unknown} text
 * @param {number | null} [fallbackYear=null]
 */
export function parsePeriods(text, fallbackYear = null) {
  const normalized = normalizeText(text);
  const results = [];
  const re = new RegExp(RANGE_RE.source, "g");
  let match;
  while ((match = re.exec(normalized)) !== null) {
    const range = parseDateRange(match[0], fallbackYear);
    if (range) results.push(range);
  }
  return results;
}

/* ------------------------------------------------------------------ *
 * 倍率
 * ------------------------------------------------------------------ */

/** 「睡眠EXP 1.25倍」「1.5倍」→ 1.25 / 1.5。「-」「なし」→ null */
export function parseMultiplier(text) {
  const normalized = normalizeText(text);
  if (!normalized || normalized === "-" || normalized === "ー") return null;
  const m = /(\d+(?:\.\d+)?)\s*倍/.exec(normalized);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** 睡眠EXPの記述か（「リサーチEXP」等は弾く） */
export function isSleepExpLabel(text) {
  const normalized = normalizeText(text);
  return /睡眠EXP/.test(normalized) && !/リサーチEXP/.test(normalized);
}

/**
 * 一覧ページの「主なイベントボーナス」列から睡眠EXP倍率だけを抜く。
 * 例: 「睡眠EXP1.5倍アメ獲得量1.5倍」-> 1.5
 *     「リサーチEXP1.5倍ゆめのかけら1.5倍」-> null（睡眠EXPではない）
 *     「ねむけパワー増加睡眠EXP増加」-> null（倍率が書かれていない）
 *
 * 列は要約なので、載っていない＝ボーナス無し とは限らない点に注意。
 * 「載っていれば採用、無ければ判断しない」という使い方だけをする。
 */
export function parseSleepExpFromSummary(text) {
  const normalized = normalizeText(text);
  const m = /(?<!リサーチ)睡眠EXP\s*(\d+(?:\.\d+)?)\s*倍/.exec(normalized);
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function boostKindsFromSummary(text) {
  // Wikiのミニアメブーストリンクは title="アメブースト" を持つため、属性を
  // 先に落とす。そうしないとミニをフルとして二重判定してしまう。
  const withoutTitle = String(text ?? "").replace(/\s+title\s*=\s*(['"]).*?\1/gi, " ");
  const normalized = normalizeText(withoutTitle);
  const mini = /ミニアメブースト/.test(normalized);
  // ミニ表記自体に「アメブースト」が含まれるので、先にその語を取り除く。
  // 攻略文の「その日のアメブーストが未使用の場合」のような言及は、
  // 一覧のボーナス名ではないので拾わない。
  const withoutMini = normalized.replace(/ミニアメブースト/g, " ");
  const full = /アメブースト/.test(withoutMini)
    && !/その日のアメブーストが未使用の場合/.test(withoutMini);
  return { mini, full };
}

/** 一覧の要約列からミニ/フルのアメブースト種別を読む。ミニを優先する。 */
export function parseBoostFromSummary(text) {
  const kinds = boostKindsFromSummary(text);
  if (kinds.mini) return "mini";
  if (kinds.full) return "full";
  return null;
}

/** ミニとフルの同時記載を生成側で警告するための低レベル結果。 */
export function parseBoostKindsFromSummary(text) {
  return boostKindsFromSummary(text);
}

/* ------------------------------------------------------------------ *
 * 列ヘッダ -> 日付範囲
 * ------------------------------------------------------------------ */

const WHOLE_PERIOD_RE = /全日程|全期間|期間中/;

/**
 * ボーナス表の列ヘッダを、イベント全体期間の部分区間へ写す。
 *
 * 例:
 *   「全日程」              -> 全体
 *   「金土日(8/21~23)」      -> 8/21..8/23
 *   「1週目 (7/13~7/19)」    -> 7/13..7/19
 *   「元日(1/1)、最終日(1/7)」 -> 1/1..1/1, 1/7..1/7
 *   「満月の日」             -> null（月齢依存。日付に落とせない）
 *
 * @returns {{ranges: Array<{from,to}>}|null} 読めなければ null
 */
export function parseColumnHeaderRanges(header, period) {
  const normalized = normalizeText(header);
  if (!normalized) return null;
  if (WHOLE_PERIOD_RE.test(normalized)) return { ranges: [{ from: period.from, to: period.to }] };

  const ranges = [];
  // 「(8/21~23)」「(7/13~7/19)」のような範囲を先に食う
  const rangeRe = /(\d{1,2})\s*\/\s*(\d{1,2})\s*~\s*(?:(\d{1,2})\s*\/\s*)?(\d{1,2})/g;
  const consumed = [];
  let m;
  while ((m = rangeRe.exec(normalized)) !== null) {
    const startMonth = Number(m[1]);
    const startDay = Number(m[2]);
    const endMonth = m[3] === undefined ? startMonth : Number(m[3]);
    const endDay = Number(m[4]);
    const from = resolveWithinPeriod(startMonth, startDay, period);
    const to = resolveWithinPeriod(endMonth, endDay, period);
    if (!from || !to) return null;
    ranges.push({ from, to });
    consumed.push([m.index, m.index + m[0].length]);
  }

  // 残りの単日「(1/1)」「(1/7)」
  const singleRe = /(\d{1,2})\s*\/\s*(\d{1,2})/g;
  while ((m = singleRe.exec(normalized)) !== null) {
    const start = m.index;
    if (consumed.some(([s, e]) => start >= s && start < e)) continue;
    const day = resolveWithinPeriod(Number(m[1]), Number(m[2]), period);
    if (!day) return null;
    ranges.push({ from: day, to: day });
  }

  if (ranges.length === 0) return null;
  ranges.sort((a, b) => compareDates(a.from, b.from));
  return { ranges };
}

/**
 * 月日だけの表記に、イベント期間から年を補う。
 * 年跨ぎイベント（12/29~1/4 など）でも from/to の両端を試して当てる。
 */
function resolveWithinPeriod(month, day, period) {
  const fromParts = parseGameDate(period.from);
  const toParts = parseGameDate(period.to);
  if (!fromParts || !toParts) return null;
  const candidates = new Set([fromParts.year, toParts.year]);
  for (const year of candidates) {
    const candidate = toGameDate({ year, month, day });
    if (!parseGameDate(candidate)) continue;
    if (compareDates(candidate, period.from) >= 0 && compareDates(candidate, period.to) <= 0) return candidate;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * ボーナス表 / 箇条書き
 * ------------------------------------------------------------------ */

const BONUS_TABLE_HEADER_RE = /ボーナス項目|ボーナス内容|項目/;

/**
 * 「ボーナス項目 | 列A | 列B」形式の表から睡眠EXPの倍率を取る。
 *
 * 睡眠EXPの書かれ方は2通りある。
 *   形式A: 項目セルが「ポケモンの睡眠EXP」、各列セルが「3倍」「2倍」
 *   形式B: 項目セルは分類名（「おてつだいポケモン」）、値セルが「睡眠EXP 1.25倍」
 *
 * @returns {{segments: Array<{from,to,multiplier}>, warnings: string[]}|null}
 *          睡眠EXPを含む表でなければ null
 */
export function parseBonusTable($, tableEl, period) {
  const grid = buildGrid($, tableEl);
  if (grid.length < 2) return null;

  const cellText = (cell) => (cell ? normalizeText($(cell).text()) : "");
  const headerRow = grid[0] ?? [];
  const headers = headerRow.map(cellText);
  if (!headers.length || !BONUS_TABLE_HEADER_RE.test(headers[0] ?? "")) return null;
  if (!grid.some((row) => row.some((cell) => isSleepExpLabel(cellText(cell))))) return null;

  const warnings = [];
  const segments = [];

  // 列インデックス -> 日付範囲。列ヘッダが読めない列は null にして警告する。
  const columnRanges = new Map();
  for (let col = 1; col < headers.length; col++) {
    const parsed = parseColumnHeaderRanges(headers[col], period);
    columnRanges.set(col, parsed ? parsed.ranges : null);
    if (!parsed) warnings.push(`列ヘッダを日付に落とせない: "${headers[col]}"`);
  }
  if (headers.length === 1) {
    // 列が項目だけの表は扱えない
    return null;
  }

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const labelIsSleepExp = isSleepExpLabel(cellText(row[0]));

    for (let col = 1; col < headers.length; col++) {
      const cell = row[col];
      if (!cell) continue;
      const text = cellText(cell);
      // 形式Bは値セル自体に「睡眠EXP」が入る。形式Aは項目セル側。
      if (!labelIsSleepExp && !isSleepExpLabel(text)) continue;
      if (labelIsSleepExp && isSleepExpLabel(text) === false && /睡眠EXP/.test(text)) continue;

      const multiplier = parseMultiplier(text);
      if (multiplier === null) continue; // 「-」= その列にボーナスなし

      const ranges = columnRanges.get(col);
      if (!ranges) {
        warnings.push(`睡眠EXP ${multiplier}倍 を列 "${headers[col]}" に紐づけられない`);
        continue;
      }
      // colspan で同じセルが複数列に展開されるので重複を許して後で畳む
      for (const range of ranges) segments.push({ ...range, multiplier });
    }
  }

  if (segments.length === 0 && warnings.length === 0) return null;
  return { segments: mergeSegments(segments), warnings };
}

/**
 * 箇条書き（「おてつだいポケモンの睡眠EXP1.5倍」）から倍率を取る。
 * 期間の内訳は書かれないので、イベント全体期間に一律で当てる。
 */
export function parseBonusList($, scopeEl, period) {
  const found = [];
  $(scopeEl)
    .find("li")
    .each((i, el) => {
      if ($(el).find("li").length > 0) return; // 親li は子を含むので飛ばす
      const text = normalizeText($(el).text());
      if (!isSleepExpLabel(text)) return;
      if (text.length > 120) return; // 説明文の中の言及は拾わない
      const multiplier = parseMultiplier(text);
      if (multiplier === null) return;
      found.push({ text, multiplier });
    });
  if (found.length === 0) return null;

  const multipliers = [...new Set(found.map((f) => f.multiplier))];
  const warnings = multipliers.length > 1
    ? [`箇条書きに複数の睡眠EXP倍率がある: ${found.map((f) => f.text).join(" / ")}`]
    : [];
  return {
    segments: [{ from: period.from, to: period.to, multiplier: multipliers[0] }],
    warnings,
  };
}

/**
 * 同じ倍率で隣接・重複する区間を畳む。
 * 異なる倍率が同じ日に重なったら壊れているので例外にする。
 */
export function mergeSegments(segments) {
  const sorted = [...segments].sort(
    (a, b) => compareDates(a.from, b.from) || compareDates(a.to, b.to) || a.multiplier - b.multiplier,
  );
  const merged = [];
  for (const segment of sorted) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...segment });
      continue;
    }
    const overlaps = compareDates(segment.from, addDays(last.to, 1)) <= 0;
    if (!overlaps) {
      merged.push({ ...segment });
      continue;
    }
    if (last.multiplier !== segment.multiplier) {
      throw new Error(
        `同じ日に異なる睡眠EXP倍率がある: ${last.from}..${last.to} x${last.multiplier} と ${segment.from}..${segment.to} x${segment.multiplier}`,
      );
    }
    if (compareDates(segment.to, last.to) > 0) last.to = segment.to;
  }
  return merged;
}

/** 開催履歴表（#|画像|開催期間|…）から複数回の開催期間を取る */
export function parseHistoryTable($, tableEl) {
  const grid = buildGrid($, tableEl);
  if (grid.length < 2) return null;
  const cellText = (cell) => (cell ? normalizeText($(cell).text()) : "");
  const headers = (grid[0] ?? []).map(cellText);
  const periodCol = headers.findIndex((h) => /開催期間/.test(h));
  if (periodCol < 0) return null;

  const periods = [];
  for (let r = 1; r < grid.length; r++) {
    const text = cellText((grid[r] ?? [])[periodCol]);
    if (!text) continue;
    const range = parseDateRange(text);
    if (range) periods.push({ from: range.from, to: range.to });
  }
  return periods.length > 0 ? periods : null;
}
