import type { Employee, Shift } from "../types";
import { MAX_PAID_MINUTES_PER_DAY } from "./contract";
import { mayWorkOn } from "./availability";

export function cleaningTargetMinutes(employee: Employee): number {
  const hours = employee.cleaningHoursPerMonth;
  return employee.cleaningEnabled && hours != null && Number.isFinite(hours)
    ? Math.max(0, Math.round(hours * 2) * 30) : 0;
}

/** Extra work on existing workdays only; anchor at 10:00 and preserve service shifts. */
export function addCleaningShifts(employees: Employee[], serviceShifts: Shift[]): Shift[] {
  const result = [...serviceShifts];
  for (const employee of employees) {
    let remaining = cleaningTargetMinutes(employee);
    const dates = [...new Set(serviceShifts.filter(s => s.employeeId === employee.id).map(s => s.date))].sort();
    for (const date of dates) {
      if (remaining <= 0) break;
      if (!mayWorkOn(employee, date)) continue;
      const own = result.filter(s => s.employeeId === employee.id && s.date === date);
      const capacity = MAX_PAID_MINUTES_PER_DAY - own.reduce((n, s) => n + s.paidMinutes, 0);
      let duration = Math.min(180, remaining, Math.floor(capacity / 30) * 30);
      // Try longest available contiguous slot, latest first (2 h => 08:00–10:00).
      let added = false;
      while (duration >= 30 && !added) {
        for (let end = 600; end - duration >= 420; end -= 30) {
          const start = end - duration;
          if (result.some(s => s.date === date && (s.employeeId === employee.id || s.task === "CLEANING") && s.startMinutes < end && start < s.endMinutes)) continue;
          result.push({ id: `cleaning-${employee.id}-${date}-${start}`, employeeId: employee.id, date,
            startMinutes: start, endMinutes: end, pauseMinutes: 0, paidMinutes: duration,
            shiftType: "CUSTOM", generated: true, task: "CLEANING" });
          remaining -= duration;
          added = true;
          break;
        }
        duration -= 30;
      }
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes || a.employeeId.localeCompare(b.employeeId));
}
