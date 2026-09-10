import type { Shift } from "../types";
import { DAY_WEIGHTS, type WeekdayKey } from "./demand";
import type { DayBlocks } from "./workHours";

export type StaffingWindow = {
  label: string;
  startMinutes: number;
  endMinutes: number;
  minStaff: number;
  maxStaff: number;
};

export const CLOSING_START = 21 * 60 + 30;
export const CLOSING_MIN = 3;
export const CLOSING_MAX = 4;

export function staffingWindows(blocks: DayBlocks, weekday: WeekdayKey): StaffingWindow[] {
  const windows: StaffingWindow[] = [];
  const add = (label: string, from: number, to: number, minStaff: number, maxStaff = Infinity) => {
    for (const block of blocks) {
      const startMinutes = Math.max(from, block.startMinutes);
      const endMinutes = Math.min(to, block.endMinutes);
      if (endMinutes > startMinutes) windows.push({ label, startMinutes, endMinutes, minStaff, maxStaff });
    }
  };
  for (const block of blocks) {
    windows.push({
      label: "Trong giờ mở cửa",
      startMinutes: block.startMinutes,
      endMinutes: block.endMinutes,
      minStaff: 2,
      maxStaff: Infinity,
    });
  }
  for (const block of blocks) {
    add(block.startMinutes < 16 * 60 ? "Mở cửa" : "Đầu ca tối", block.startMinutes, block.startMinutes + 60, 2);
    if (block.endMinutes < 18 * 60) add("Cuối ca trưa", block.endMinutes - 30, block.endMinutes, 2);
  }
  // Evening rush: a floor AND a ceiling. The ceiling matters most – without it
  // the optimizer piles everyone into 18–20 h and the morning falls to its
  // minimum (the old 2-vs-8 split). Busy days (Fr–So) run a bit higher, but the
  // step is gentle so the evening peak stays ~1.5× the morning, not 4×.
  // Stoßtage (Fr–So, DAY_WEIGHTS 1,5) tragen das 1,5-Fache eines Normaltags:
  // Abendspitze 4–6 an Normaltagen, 6–9 an Stoßtagen. Die Obergrenze verhindert,
  // dass sich der ganze Betrieb in 18–20 h staut und der Vormittag leerläuft.
  const peakMin = Math.ceil(4 * DAY_WEIGHTS[weekday]);
  const peakMax = Math.ceil(6 * DAY_WEIGHTS[weekday]);
  add("Tối", 18 * 60, 20 * 60, peakMin, peakMax);
  if (weekday === "sunday") add("Trưa CN", 12 * 60, 14 * 60, peakMin, peakMax);
  add("Đóng cửa", CLOSING_START, 22 * 60 + 30, CLOSING_MIN, CLOSING_MAX);
  return windows;
}

export function validPause(shift: Shift): boolean {
  const start = shift.pauseStartMinutes;
  return start != null && shift.pauseMinutes > 0 && start > shift.startMinutes &&
    start + shift.pauseMinutes < shift.endMinutes && start - shift.startMinutes <= 360 &&
    shift.endMinutes - start - shift.pauseMinutes <= 360;
}

export function workingAt(shift: Shift, minute: number): boolean {
  return shift.startMinutes <= minute && shift.endMinutes > minute &&
    !(validPause(shift) && minute >= shift.pauseStartMinutes! && minute < shift.pauseStartMinutes! + shift.pauseMinutes);
}

export function coveragePoints(shifts: Shift[], from: number, to: number): number[] {
  return [...new Set([from, to, ...shifts.flatMap((s) => [s.startMinutes, s.endMinutes,
    ...(validPause(s) ? [s.pauseStartMinutes!, s.pauseStartMinutes! + s.pauseMinutes] : []),
  ]).filter((t) => t > from && t < to)])].sort((a, b) => a - b);
}

/** Daily paid-hour targets are normalized inside each ISO week, never across weeks. */
export function weightedDailyTargets(dates: string[], total: number, weekdayOf: (date: string) => WeekdayKey): Map<string, number> {
  const sum = dates.reduce((acc, date) => acc + DAY_WEIGHTS[weekdayOf(date)], 0);
  return new Map(dates.map((date) => [date, sum > 0 ? total * DAY_WEIGHTS[weekdayOf(date)] / sum : 0]));
}

/**
 * Relative workload within a day; only Sunday/holidays have a lunch rush.
 *
 * Bewusst FLACH gehalten (Verhältnis Abend:Vormittag ≈ 1,5), damit die
 * Besetzung nicht vormittags auf das Minimum fällt und sich abends staut. Bei
 * ~10 Kräften ergibt das grob 4 vormittags zu 6 in der Abendspitze statt 2:8.
 */
export function workloadAt(minute: number, weekday: WeekdayKey): number {
  if (minute >= 1080 && minute < 1200) return 1.5; // 18:00–20:00 Abendspitze
  if (weekday === "sunday" && minute >= 720 && minute < 840) return 1.4; // So-Mittag
  if (minute < 870) return 0.8; // vor 14:30 (Vormittag/Mittag)
  if (minute < 990) return 0.6; // 14:30–16:30 Flaute
  return 1; // 16:30–18:00 und 20:00–22:30
}
