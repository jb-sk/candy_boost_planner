import {
  addGameDays,
  compareGameDates,
  normalizeGameDate,
  parseGameDate,
  type GameDate,
} from "./game-date";
import type { GsdDayKind } from "./lunar-calendar";
import type { EventMultiplierSegment, EventSource } from "./sleep-schedule";
import type { ProjectedEventOccurrence } from "./projected-events";
import type { BlueSeedPlantWeekday } from "../types";

export type BlueSeedShift = {
  readonly year: number;
  readonly from: GameDate;
  readonly to: GameDate;
};

type NamedSegment = {
  readonly name: string;
  readonly from: string;
  readonly to: string;
};

/** 花区間が採る出自。元の周年が実か仮かで決まる。 */
export type FlowerSource = Extract<EventSource, "flower" | "projectedFlower">;

function resolveFlowerDefinition(name: string, flowers: readonly { match: string; days: number }[]) {
  return flowers.find(flower => name.includes(flower.match));
}

/**
 * 周年イベントの2週目へ、設定された曜日のあおいタネによる睡眠EXP3倍を加える。
 * 花区間はイベント倍率と同じ max の枠へ渡すため、ここでは一切の行表示情報を持たない。
 *
 * 唯一の例外が `source`。**花は元の周年の確度をそのまま引き継ぐ**
 * （実イベントの周年なら `flower`、仮イベントの周年なら `projectedFlower`）。
 * これが内訳の行を「イベント」と「仮イベント」へ振り分ける。
 */
export function resolveBlueSeedSegments(params: {
  realSegments: readonly NamedSegment[];
  projectedOccurrences: readonly ProjectedEventOccurrence[];
  flowers: readonly { match: string; days: number }[];
  weekday: BlueSeedPlantWeekday;
  includeGSD: boolean;
  dayKind: (date: GameDate) => GsdDayKind;
  until: GameDate;
}): {
  segments: EventMultiplierSegment[];
  shifts: readonly BlueSeedShift[];
} {
  if (params.weekday === null) return { segments: [], shifts: [] };

  const namedSegments: (NamedSegment & { source: FlowerSource })[] = [
    ...params.realSegments.map(segment => ({ ...segment, source: "flower" as const })),
    ...params.projectedOccurrences.map(occurrence => ({ ...occurrence, source: "projectedFlower" as const })),
  ];
  const segments: EventMultiplierSegment[] = [];
  const shifts: BlueSeedShift[] = [];

  for (const event of namedSegments) {
    const flower = resolveFlowerDefinition(event.name, params.flowers);
    if (!flower) continue;
    const eventTo = normalizeGameDate(event.to);
    if (!eventTo) continue;
    const firstFlowerDate = addGameDays(eventTo, 1);
    const flowerTo = addGameDays(eventTo, flower.days);
    if (compareGameDates(firstFlowerDate, params.until) > 0) continue;

    let plantDate = addGameDays(eventTo, params.weekday);
    // GSDを使う場合だけ、満月日の3倍と花の3倍が重なる無駄を1日後ろへ送る。
    // includeGSD を先に判定し、GSDオフでは dayKind を呼ばない。
    // 金曜は後ろへ送ると花期間が2日しか残らないため、満月でもずらさない。
    const shifted = params.includeGSD && params.weekday < 5 && params.dayKind(plantDate) === "fullMoon";
    if (shifted) {
      plantDate = addGameDays(plantDate, 1);
    }
    if (compareGameDates(plantDate, flowerTo) > 0 || compareGameDates(plantDate, params.until) > 0) continue;
    if (shifted) {
      shifts.push({
        year: parseGameDate(plantDate)!.year,
        from: plantDate,
        to: flowerTo,
      });
    }
    segments.push({ from: plantDate, to: flowerTo, multiplier: 3, source: event.source });
  }

  return { segments, shifts };
}
