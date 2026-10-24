import type { SleepTimeResult } from './sleep-growth';

export type SleepTimeFormatTokens = {
  hourUnit: string;
  minuteUnit: string;
  dayUnit: string;
  hourMinuteSeparator: string;
  rangeSeparator: string;
  exactDayJoiner: string;
  approximatePrefix: string;
  estimateOpen: string;
  estimateClose: string;
};

function formatFullDuration(
  totalMinutes: number,
  tokens: SleepTimeFormatTokens,
  omitZeroMinutes: boolean
): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourText = hours > 0 ? `${hours}${tokens.hourUnit}` : '';
  const minuteText = !omitZeroMinutes || minutes > 0 ? `${minutes}${tokens.minuteUnit}` : '';
  if (!hourText) return minuteText;
  if (!minuteText) return hourText;
  return `${hourText}${tokens.hourMinuteSeparator}${minuteText}`;
}

export function formatSleepTimeResult(
  result: SleepTimeResult,
  tokens: SleepTimeFormatTokens
): string | null {
  if (result.kind === 'none' || result.kind === 'unavailable') return null;

  if (result.kind === 'long-term-estimate') {
    const duration = formatFullDuration(result.totalMinutes, tokens, true);
    return `${tokens.approximatePrefix}${result.requiredDays}${tokens.dayUnit}`
      + `${tokens.estimateOpen}${duration}${tokens.estimateClose}`;
  }

  const left = formatFullDuration(result.minutesMin, tokens, false);
  let lastNight = left;
  if (result.minutesMin !== result.minutesMax) {
    const leftHours = Math.floor(result.minutesMin / 60);
    const rightHours = Math.floor(result.minutesMax / 60);
    const right = leftHours === rightHours
      ? `${result.minutesMax % 60}${tokens.minuteUnit}`
      : formatFullDuration(result.minutesMax, tokens, false);
    lastNight = `${left}${tokens.rangeSeparator}${right}`;
  }

  if (result.requiredDays === 1) return lastNight;

  const completedDays = result.requiredDays - 1;
  const completedDuration = formatFullDuration(result.totalMinutes - result.minutesMin, tokens, true);
  return `${completedDays}${tokens.dayUnit}`
    + `${tokens.estimateOpen}${completedDuration}${tokens.estimateClose}`
    + `${tokens.exactDayJoiner}${lastNight}`;
}

export type NapIslandDurationTokens = Pick<SleepTimeFormatTokens, 'dayUnit' | 'hourUnit' | 'minuteUnit'>;

/**
 * おひるね島の預け時間を「〇日〇時間〇分」で書く。
 * - `full`: 結果行の所要時間。0 の単位も省かない（`7日0時間0分` / `0日0時間3分`）
 * - `compact`: チケットの「N枚目は…」。先頭の 0 の単位だけ省く（`3分` / `4時間0分` / `2日0時間0分`）
 */
export function formatNapIslandDuration(
  minutes: number,
  tokens: NapIslandDurationTokens,
  style: 'full' | 'compact',
): string {
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const mins = minutes % 60;
  const day = `${days}${tokens.dayUnit}`;
  const hour = `${hours}${tokens.hourUnit}`;
  const minute = `${mins}${tokens.minuteUnit}`;
  if (style === 'full') return `${day}${hour}${minute}`;
  if (days > 0) return `${day}${hour}${minute}`;
  if (hours > 0) return `${hour}${minute}`;
  return minute;
}

export type NapTicketCountTexts = {
  /** `calc.row.napTicketCount`（{count}） */
  count: (count: number) => string;
  /** `calc.row.napTicketCountWithLast`（{count} と {duration}） */
  countWithLast: (count: number, duration: string) => string;
};

/**
 * アイテム欄に出すチケット枚数の完成文字列。
 * - 1枚 → `1枚`（使う時間は隣の「おひるね島 〇日〇時間〇分」と同じなので添えない）
 * - 2枚以上で最後の1枚が途中まで → `N枚（N枚目は{使う時間}）`
 * - 2枚以上で最後の1枚も使い切る → `N枚`
 */
export function formatNapTicketCount(
  ticketCount: number,
  lastTicketMinutes: number,
  fullTicketMinutes: number,
  tokens: NapIslandDurationTokens,
  texts: NapTicketCountTexts,
): string {
  if (ticketCount <= 1 || lastTicketMinutes >= fullTicketMinutes) return texts.count(ticketCount);
  return texts.countWithLast(ticketCount, formatNapIslandDuration(lastTicketMinutes, tokens, 'compact'));
}
