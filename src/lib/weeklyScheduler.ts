import type { Employee, Shift } from "../types";
import { AZUBI_EVENING_START, AZUBI_EVENING_END, OWNER_DAYS_PER_WEEK, OWNER_FREE_WEEKDAY } from "../types";
import { datesOfMonth, parseIsoDate, weekdayKeyOf, type WeekdayKey } from "./demand";
import { contractOpenDays, monthlyTargetMinutes, weeklyTargetMinutes } from "./contract";
import { calculatePause } from "./time";
import { mayWorkOn } from "./availability";
import { consecutiveRunLengthWith } from "./consecutive";
import { effectiveWeekdayKey, resolveDay, type DayBlocks, type DayWindow, type OverrideMap, type WorkHoursConfig } from "./workHours";
import { publicHolidays } from "./holidays";
import { weekStartOf } from "./weeks";

type WeeklyInput = {
  year: number;
  month: number;
  workHours: WorkHoursConfig;
  overrides?: OverrideMap;
  employees: Employee[];
  holidays?: Set<string>;
};
type Option = { shifts: Shift[]; styleCost: number };
type Choice = { date: string; paid: number; option: Option };
type Allocation = { paid: number; cost: number; mask: number; choices: Choice[] };
type Day = ReturnType<typeof resolveDay>;

const SLOT = 30;
const MIN_SHIFT = 180;
const TAPER_END = 21 * 60 + 30;
const WEEKDAYS: WeekdayKey[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function hash(value: string): number {
  let result = 0;
  for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0;
  return result;
}

function dayOf(date: string): WeekdayKey {
  return weekdayKeyOf(parseIsoDate(date));
}

function fixedPaid(window: DayWindow): number {
  const presence = window.endMinutes - window.startMinutes;
  for (const pause of [0, 30, 45]) {
    const paid = presence - pause;
    if (paid > 0 && calculatePause(paid) === pause) return paid;
  }
  return 0;
}

function makeShift(employeeId: string, date: string, startMinutes: number, paidMinutes: number, shiftType: "EARLY" | "LATE"): Shift {
  const pauseMinutes = calculatePause(paidMinutes);
  return {
    id: `weekly-${employeeId}-${date}-${startMinutes}-${paidMinutes}`,
    employeeId, date, startMinutes,
    endMinutes: startMinutes + paidMinutes + pauseMinutes,
    pauseMinutes, paidMinutes, shiftType, generated: true,
  };
}

function employeeBlocks(employee: Employee, date: string, blocks: DayBlocks): DayBlocks {
  if (employee.employmentType !== "AZUBI" || ["saturday", "sunday"].includes(dayOf(date))) return blocks;
  return blocks.map((block) => ({
    startMinutes: Math.max(block.startMinutes, AZUBI_EVENING_START),
    endMinutes: Math.min(block.endMinutes, AZUBI_EVENING_END),
  })).filter((block) => block.endMinutes > block.startMinutes);
}

function optionsFor(employee: Employee, date: string, paid: number, blocks: DayBlocks, partialWeek = false): Option[] {
  if (paid <= 0 || paid > (employee.isOwner ? 600 : 540)) return [];
  if (employee.fixedShift) {
    return fixedPaid(employee.fixedShift) === paid
      ? [{ shifts: [makeShift(employee.id, date, employee.fixedShift.startMinutes, paid, "EARLY")], styleCost: 0 }]
      : [];
  }
  const allowed = employeeBlocks(employee, date, blocks);
  const options: Option[] = [];
  const seen = new Set<string>();
  const preferredEnd = hash(employee.id) % 2 === 0 ? 21 * 60 : TAPER_END;
  const add = (shifts: Shift[]) => {
    const key = shifts.map((shift) => `${shift.startMinutes}-${shift.endMinutes}`).join(",");
    if (seen.has(key)) return;
    seen.add(key);
    const styleCost = (shifts.length - 1) * 8 + shifts.reduce((cost, shift) => {
      if (shift.endMinutes > TAPER_END) return cost + 35;
      if (shift.endMinutes === preferredEnd) return cost;
      if (shift.endMinutes === 21 * 60 || shift.endMinutes === TAPER_END) return cost + 1;
      return cost + (shift.shiftType === "LATE" ? 15 : 2);
    }, 0);
    options.push({ shifts, styleCost });
  };
  const placements = (block: DayWindow, duration: number, early: boolean): Shift[] => {
    const presence = duration + calculatePause(duration);
    const starts = [block.startMinutes, ...[21 * 60, TAPER_END, block.endMinutes].map((end) => end - presence)];
    return [...new Set(starts)]
      .filter((start) => start >= block.startMinutes && start + presence <= block.endMinutes)
      .map((start) => makeShift(employee.id, date, start, duration, early ? "EARLY" : "LATE"));
  };

  allowed.forEach((block, index) => {
    for (const shift of placements(block, paid, index === 0 && block.startMinutes < 16 * 60)) add([shift]);
  });
  // Both segments stay inside their opening blocks; the lunch closure is unpaid.
  const minimumEvening = partialWeek ? 120 : MIN_SHIFT;
  if (paid >= MIN_SHIFT + minimumEvening && allowed.length >= 2) {
    const first = allowed[0];
    const last = allowed[allowed.length - 1];
    for (let morning = MIN_SHIFT; morning <= Math.min(paid - minimumEvening, first.endMinutes - first.startMinutes); morning += SLOT) {
      const early = makeShift(employee.id, date, first.startMinutes, morning, "EARLY");
      if (early.endMinutes > first.endMinutes) continue;
      for (const late of placements(last, paid - morning, false)) {
        if (early.endMinutes <= late.startMinutes) add([early, late]);
      }
    }
  }
  return options;
}

function intervalCost(shifts: Shift[], from: number, to: number, min: number, max = Infinity): number {
  if (to <= from) return 0;
  const points = [...new Set([from, to, ...shifts.flatMap((shift) => [shift.startMinutes, shift.endMinutes])
    .filter((time) => time > from && time < to)])].sort((a, b) => a - b);
  let cost = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const staff = shifts.filter((shift) => shift.startMinutes <= points[i] && shift.endMinutes > points[i]).length;
    cost += (Math.max(0, min - staff) + Math.max(0, staff - max)) * (points[i + 1] - points[i]);
  }
  return cost;
}

function dayCost(shifts: Shift[], blocks: DayBlocks, sunday: boolean): number {
  if (blocks.length === 0) return 0;
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  let cost = intervalCost(shifts, first.startMinutes, Math.min(first.endMinutes, first.startMinutes + 90), 2) * 3;
  for (const block of blocks.slice(1)) {
    cost += intervalCost(shifts, block.startMinutes, Math.min(block.endMinutes, block.startMinutes + 60), 2) * 3;
  }
  for (const block of blocks) {
    cost += intervalCost(shifts, Math.max(block.startMinutes, 18 * 60), Math.min(block.endMinutes, 20 * 60), 2);
    if (sunday) cost += intervalCost(shifts, Math.max(block.startMinutes, 12 * 60), Math.min(block.endMinutes, 14 * 60), 2);
  }
  cost += intervalCost(shifts, Math.max(last.startMinutes, TAPER_END), last.endMinutes, 1, 1);
  return cost * 100;
}

function dayLimit(employee: Employee): number {
  return Math.min(6, employee.maxDaysPerWeek ?? 6, employee.isOwner ? OWNER_DAYS_PER_WEEK : 6);
}

function weekdayRank(employee: Employee, date: string): number {
  const index = WEEKDAYS.indexOf(dayOf(date));
  return (index - hash(employee.id) % 7 + 7) % 7 - (index >= 4 ? 2 : 0);
}

function chooseWeek(
  employee: Employee,
  dates: string[],
  target: number,
  existing: Shift[],
  days: Map<string, Day>,
  holidays: Set<string>,
): Choice[] {
  const eligible = dates.filter((date) => mayWorkOn(employee, date) && !(employee.isOwner && dayOf(date) === OWNER_FREE_WEEKDAY));
  const limit = Math.min(dayLimit(employee), eligible.length);
  if (target <= 0 || limit <= 0) return [];
  const fixed = employee.fixedShift ? fixedPaid(employee.fixedShift) : 0;
  if (employee.fixedShift && fixed === 0) return [];
  const preferredCount = fixed
    ? Math.min(limit, Math.floor(target / fixed))
    : Math.min(limit, Math.max(1, Math.floor(target / MIN_SHIFT)), employee.employmentType === "VOLLZEIT" ? 6 : Math.max(1, Math.round(target / 390)));
  const ideal = target / Math.max(1, preferredCount);
  const durations = new Set<number>();
  if (fixed) durations.add(fixed);
  else if (target < MIN_SHIFT) durations.add(target);
  else {
    for (let duration = MIN_SHIFT; duration <= Math.min(target, employee.isOwner ? 600 : 540); duration += SLOT) {
      durations.add(duration);
      if (target % SLOT !== 0 && duration + target % SLOT <= target) durations.add(duration + target % SLOT);
    }
  }

  const worked = new Set(existing.filter((shift) => shift.employeeId === employee.id).map((shift) => shift.date));
  const validMasks = new Map<number, boolean>();
  const valid = (mask: number) => {
    const cached = validMasks.get(mask);
    if (cached != null) return cached;
    const set = new Set(worked);
    let ok = true;
    eligible.forEach((date, index) => {
      if ((mask & (1 << index)) === 0) return;
      if (consecutiveRunLengthWith(set, date) > 6) ok = false;
      set.add(date);
    });
    validMasks.set(mask, ok);
    return ok;
  };

  let states = new Map<number, Allocation>([[0, { paid: 0, cost: 0, mask: 0, choices: [] }]]);
  for (let index = 0; index < eligible.length; index++) {
    const date = eligible[index];
    const day = days.get(date)!;
    const occupied = existing.filter((shift) => shift.date === date);
    const sunday = effectiveWeekdayKey(date, holidays) === "sunday";
    const before = dayCost(occupied, day.blocks, sunday);
    const candidates: { choice: Choice; cost: number }[] = [];
    for (const paid of durations) {
      let best: Option | undefined;
      let score = Infinity;
      for (const option of optionsFor(employee, date, paid, day.blocks, dates.length < 6)) {
        const cost = dayCost([...occupied, ...option.shifts], day.blocks, sunday) - before + option.styleCost;
        if (cost < score) { best = option; score = cost; }
      }
      if (best) candidates.push({
        choice: { date, paid, option: best },
        cost: score + ((paid - ideal) / SLOT) ** 2 * 100_000 + weekdayRank(employee, date) * 4,
      });
    }
    const next = new Map(states);
    for (const state of states.values()) {
      if (state.choices.length >= limit) continue;
      const mask = state.mask | (1 << index);
      if (!valid(mask)) continue;
      for (const candidate of candidates) {
        const paid = state.paid + candidate.choice.paid;
        if (paid > target) continue;
        const key = paid * 128 + mask;
        const cost = state.cost + candidate.cost;
        if (cost >= (next.get(key)?.cost ?? Infinity)) continue;
        next.set(key, { paid, cost, mask, choices: [...state.choices, candidate.choice] });
      }
    }
    states = next;
  }
  // Exact weekly minutes take priority. An impossible quota stays short and
  // is reported by validation, never transferred to another week.
  let best: Allocation | undefined;
  let bestCost = Infinity;
  for (const state of states.values()) {
    const cost = state.cost + (state.choices.length - preferredCount) ** 2 * 500;
    if (!best || state.paid > best.paid || (state.paid === best.paid && cost < bestCost)) {
      best = state;
      bestCost = cost;
    }
  }
  return best?.choices ?? [];
}

function improveCoverage(result: Shift[], employees: Employee[], days: Map<string, Day>, holidays: Set<string>): Shift[] {
  const output: Shift[] = [];
  for (const [date, day] of days) {
    let onDay = result.filter((shift) => shift.date === date);
    const sunday = effectiveWeekdayKey(date, holidays) === "sunday";
    const partialWeek = [...days].filter(([otherDate, otherDay]) => !otherDay.closed && weekStartOf(otherDate) === weekStartOf(date)).length < 6;
    for (let pass = 0; pass < 3; pass++) {
      if (dayCost(onDay, day.blocks, sunday) === 0) break;
      let changed = false;
      for (const employee of employees) {
        const own = onDay.filter((shift) => shift.employeeId === employee.id);
        if (own.length === 0) continue;
        const paid = own.reduce((sum, shift) => sum + shift.paidMinutes, 0);
        const others = onDay.filter((shift) => shift.employeeId !== employee.id);
        let bestCost = dayCost(onDay, day.blocks, sunday);
        let best: Shift[] | undefined;
        for (const option of optionsFor(employee, date, paid, day.blocks, partialWeek)) {
          const cost = dayCost([...others, ...option.shifts], day.blocks, sunday);
          if (cost < bestCost) { best = option.shifts; bestCost = cost; }
        }
        if (best) { onDay = [...others, ...best]; changed = true; }
      }
      if (!changed) break;
    }
    output.push(...onDay);
  }
  return output;
}

export function generateWeeklySchedule(input: WeeklyInput, existing: Shift[] = []): Shift[] {
  const holidays = input.holidays ?? publicHolidays(input.year);
  const days = new Map(datesOfMonth(input.year, input.month).map((date) => [
    date, resolveDay(input.workHours, date, holidays, input.overrides ?? {}),
  ]));
  const openDates = [...days].filter(([, day]) => !day.closed).map(([date]) => date);
  const byWeek = new Map<string, string[]>();
  for (const date of openDates) {
    const week = weekStartOf(date);
    byWeek.set(week, [...(byWeek.get(week) ?? []), date]);
  }
  const weekInfo = [...byWeek].map(([weekStart, weekDates]) => ({ weekStart, openDays: weekDates.length }));
  const contractDays = contractOpenDays(weekInfo.map((week) => week.openDays));
  const weeks = [...byWeek].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const typeRank = (employee: Employee) => employee.employmentType === "VOLLZEIT" ? 0 : employee.employmentType === "TEILZEIT" ? 1 : 2;
  const employees = [...input.employees].sort((a, b) =>
    Number(Boolean(b.fixedShift)) - Number(Boolean(a.fixedShift)) || typeRank(a) - typeRank(b) || a.id.localeCompare(b.id),
  );
  const result = [...existing];
  for (const employee of employees) {
    const target = monthlyTargetMinutes(employee, contractDays);
    const weekly = weeklyTargetMinutes(target, weekInfo, Math.round((employee.weeklyHours ?? 0) * 60));
    for (const [weekStart, weekDates] of weeks) {
      const choices = chooseWeek(employee, weekDates, weekly.get(weekStart) ?? 0, result, days, holidays);
      result.push(...choices.flatMap((choice) => choice.option.shifts));
    }
  }
  return improveCoverage(result, employees, days, holidays)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes || a.employeeId.localeCompare(b.employeeId));
}
