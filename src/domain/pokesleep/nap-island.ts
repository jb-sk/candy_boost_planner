import type { ExpGainNature } from "../types";

/**
 * おひるね島（ポケモンを預けてEXPを得る）の所要時間。
 *
 * 浮動小数を使わず、整数の不等式だけで書く（境界の正しさを式の上で示せるように）。
 * 「3.5日分」のような閾値は書かない。境界は下の式から自動で出る。
 *
 * ```text
 * P = 150 × (チケット ? 4 : 1) × 性格百分率       … 1日のEXP×100
 * raw(M)    = floor(P × M ÷ 144000)                … 144000 = 100 × 1440
 * gained(M) = M < 10080 ? ceil(raw(M) ÷ 2) : raw(M)  … 7日未満の引き取りは半減（端数切り上げ。実測）
 * ```
 */
export const NAP_ISLAND_BASE_EXP_PER_DAY = 150;
/** チケットあり: 通常150 ＋ 追加450 = 600 */
export const NAP_ISLAND_TICKET_MULTIPLIER = 4;
/** これ未満の引き取りは獲得EXPが半分になる（7日 = 10080分） */
export const NAP_ISLAND_FULL_MINUTES = 7 * 24 * 60;
/** チケット1枚の有効時間（168時間）。預けていない間は減らない */
export const NAP_ISLAND_TICKET_MINUTES = 168 * 60;

/** `P` を 100 倍の整数で持つための分母（百分率 × 1日の分数） */
const DENOMINATOR = 100 * 24 * 60;

/**
 * おひるね島の性格補正（百分率）。EXP↓は無視される。
 * 睡眠用の `getNaturePercent`（EXP↓ = 82）とは別物なので使い回さない。
 */
const NAP_ISLAND_NATURE_PERCENT: Record<ExpGainNature, number> = { up: 118, normal: 100, down: 100 };

export type NapIslandInput = {
  /** 残EXP（整数、0以上） */
  expToTarget: number;
  nature: ExpGainNature;
  /** 「おひるね島＋チケ」なら true（性質表の `napTicket`） */
  ticket: boolean;
};

export type NapIslandResult = {
  /** 必要な預け時間（分）。expToTarget<=0 なら 0 */
  minutes: number;
  /** その時間で島が出すEXP（半減込み・Lv70上限で切る前）。>= expToTarget。画面には出さない */
  napGainedExp: number;
  /** チケットを使わない答えなら 0。使うなら ceil(minutes / 10080) */
  ticketCount: number;
  /** 最後の1枚で使う時間（分）。チケットなしなら 0。1〜10080 */
  lastTicketMinutes: number;
};

function ceilDiv(a: number, b: number): number {
  return Math.floor((a + b - 1) / b);
}

/** 1日のEXP × 100 */
function dailyExpTimes100(nature: ExpGainNature, ticket: boolean): number {
  return NAP_ISLAND_BASE_EXP_PER_DAY * (ticket ? NAP_ISLAND_TICKET_MULTIPLIER : 1) * NAP_ISLAND_NATURE_PERCENT[nature];
}

/** 半減前の獲得EXP。ゲームは1分ごとに floor で加算する */
function rawGainedExp(minutes: number, nature: ExpGainNature, ticket: boolean): number {
  return Math.floor((dailyExpTimes100(nature, ticket) * minutes) / DENOMINATOR);
}

/** 預けた時間（分）で受け取るEXP。7日未満は半減（端数切り上げ） */
export function napIslandGainedExp(minutes: number, nature: ExpGainNature, ticket: boolean): number {
  const raw = rawGainedExp(minutes, nature, ticket);
  return minutes < NAP_ISLAND_FULL_MINUTES ? Math.floor((raw + 1) / 2) : raw;
}

/** 半減前の獲得EXP（実測の再現テスト用。画面や計算では使わない） */
export function napIslandRawExp(minutes: number, nature: ExpGainNature, ticket: boolean): number {
  return rawGainedExp(minutes, nature, ticket);
}

/** 残EXPを島で埋める最短の預け時間 */
export function calcNapIslandTime(input: NapIslandInput): NapIslandResult {
  const { nature, ticket } = input;
  const req = Math.floor(input.expToTarget);
  if (!(req > 0)) return { minutes: 0, napGainedExp: 0, ticketCount: 0, lastTicketMinutes: 0 };

  const p = dailyExpTimes100(nature, ticket);
  // 1. 半減のまま届くか: ceil(raw/2) >= req ⇔ raw >= 2req − 1 ⇔ P×M >= (2req − 1)×144000
  const minutesHalf = ceilDiv((2 * req - 1) * DENOMINATOR, p);
  let minutes: number;
  if (minutesHalf < NAP_ISLAND_FULL_MINUTES) {
    minutes = minutesHalf;
  } else if (napIslandGainedExp(NAP_ISLAND_FULL_MINUTES, nature, ticket) >= req) {
    // 2. 7日ちょうどで届く
    minutes = NAP_ISLAND_FULL_MINUTES;
  } else {
    // 3. 通常速度
    minutes = ceilDiv(req * DENOMINATOR, p);
  }

  const ticketCount = ticket ? ceilDiv(minutes, NAP_ISLAND_TICKET_MINUTES) : 0;
  const lastTicketMinutes = ticket ? minutes - (ticketCount - 1) * NAP_ISLAND_TICKET_MINUTES : 0;
  return { minutes, napGainedExp: napIslandGainedExp(minutes, nature, ticket), ticketCount, lastTicketMinutes };
}
