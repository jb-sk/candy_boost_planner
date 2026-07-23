import type { SleepTimeResult } from './sleep-growth';

export type SleepTimeFormatTokens = {
  hourUnit: string;
  minuteUnit: string;
  dayUnit: string;
  hourMinuteSeparator: string;
  rangeSeparator: string;
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
  if (result.minutesMin === result.minutesMax) return left;

  const leftHours = Math.floor(result.minutesMin / 60);
  const rightHours = Math.floor(result.minutesMax / 60);
  const right = leftHours === rightHours
    ? `${result.minutesMax % 60}${tokens.minuteUnit}`
    : formatFullDuration(result.minutesMax, tokens, false);
  return `${left}${tokens.rangeSeparator}${right}`;
}
