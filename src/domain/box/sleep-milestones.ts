export const SLEEP_MILESTONE_TARGETS = [200, 500, 1000, 2000] as const;

export type SleepMilestoneResult = {
  hours: number;
  index: number;
  achieved: boolean;
  remainingDays?: number;
  estimatedDate?: string;
};

/**
 * 文字列の睡眠時間入力を正規化する。
 * v-model.number ではなく生文字列を受け取る前提（空→undefined, 負/NaN→undefined, 小数→floor）。
 */
export function normalizeSleepHoursInput(v: string): number | undefined {
  // 呼び出し元が null/undefined を渡すケースへの防御的変換
  const raw = String(v ?? "").trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

export function normalizeSleepHoursValue(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
}

export function normalizeDailySleepInput(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v < 1 || v > 13) return null;
  return v;
}

/* ---------- 日付フォーマット (YYYY/MM/DD 固定) ---------- */
function formatDateYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

export function calcSleepMilestones(params: {
  currentSleepHours: number;
  dailySleepHours: number;
  now?: Date;
}): SleepMilestoneResult[] {
  const { currentSleepHours, dailySleepHours, now } = params;
  const current = normalizeSleepHoursValue(currentSleepHours);
  const safeDaily = normalizeDailySleepInput(dailySleepHours) ?? 8.5;

  return SLEEP_MILESTONE_TARGETS.map((target, i) => {
    if (current >= target) {
      return { hours: target, index: i + 1, achieved: true };
    }
    const remainingHours = target - current;
    const remainingDays = Math.ceil(remainingHours / safeDaily);
    const estimatedDate = new Date(now ?? Date.now());
    estimatedDate.setDate(estimatedDate.getDate() + remainingDays);
    return {
      hours: target,
      index: i + 1,
      achieved: false,
      remainingDays,
      estimatedDate: formatDateYMD(estimatedDate),
    };
  });
}
