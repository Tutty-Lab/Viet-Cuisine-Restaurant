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
export const CLOSING_MIN = 5;
export const CLOSING_MAX = 6;

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
    add(block.startMinutes < 16 * 60 ? "Mở cửa" : "Đầu ca tối", block.startMinutes, block.startMinutes + 60, 2);
    if (block.endMinutes < 18 * 60) add("Cuối ca trưa", block.endMinutes - 30, block.endMinutes, 2);
  }
  // Evening rush uses four people on normal days; busy days multiply that by 1.5.
  const peakMin = Math.ceil(4 * DAY_WEIGHTS[weekday]);
  add("Tối", 18 * 60, 20 * 60, peakMin);
  if (weekday === "sunday") add("Trưa CN", 12 * 60, 14 * 60, peakMin);
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

/** Relative workload within a day; only Sunday/holidays have a lunch rush. */
export function workloadAt(minute: number, weekday: WeekdayKey): number {
  if (minute >= 1080 && minute < 1200) return 2;
  if (weekday === "sunday" && minute >= 720 && minute < 840) return 1.8;
  if (minute < 870) return 0.65;
  if (minute < 990) return 0.5;
  return 1;
}
