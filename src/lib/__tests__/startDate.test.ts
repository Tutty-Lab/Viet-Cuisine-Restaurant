// ============================================================================
// Eintritt mitten im Monat (startDate):
//   - Tage vor dem Startdatum werden nicht verplant.
//   - Sie zählen nicht ins Monats-Soll -> keine falsche „zu wenig geplant"-Warnung.
// ============================================================================

import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { DEFAULT_WORK_HOURS, resolveDay } from "../workHours";
import { publicHolidays } from "../holidays";
import { datesOfMonth } from "../demand";
import { monthlyTargetMinutesFor } from "../contract";
import { createInitialSchedule } from "../sampleData";
import type { Employee } from "../../types";

const openDatesOf = (year: number, month: number): string[] => {
  const hol = publicHolidays(year);
  return datesOfMonth(year, month).filter((d) => !resolveDay(DEFAULT_WORK_HOURS, d, hol, {}).closed);
};

const wk = (id: string, h: number, x: Partial<Employee> = {}): Employee => ({
  id, name: id, employmentType: "VOLLZEIT", targetMinutes: 0, weeklyHours: h, ...x,
});

describe("Eintritt mitten im Monat (startDate)", () => {
  it("kürzt das Monats-Soll um die Tage vor dem Startdatum", () => {
    const openDates = openDatesOf(2026, 9);
    const full = wk("full", 39);
    const late = wk("late", 39, { startDate: "2026-09-07" });
    // Ohne Startdatum das volle Soll (Sept 2026: 39 × 26 / 6 = 169 h),
    // mit Startdatum weniger.
    expect(monthlyTargetMinutesFor(full, openDates)).toBe(169 * 60);
    expect(monthlyTargetMinutesFor(late, openDates)).toBeLessThan(monthlyTargetMinutesFor(full, openDates));
    // Die erste (gesperrte) Woche fehlt komplett: rund eine 39-h-Woche weniger.
    const diff = (monthlyTargetMinutesFor(full, openDates) - monthlyTargetMinutesFor(late, openDates)) / 60;
    expect(diff).toBeGreaterThan(30);
    expect(diff).toBeLessThanOrEqual(39);
  });

  it("verplant keine Tage vor dem Startdatum und meldet keine Fehlstunden-Warnung", () => {
    const seed = createInitialSchedule(); // Sept 2026, Vũ ab 7.9., Bảo ab 10.9.
    const openDates = openDatesOf(seed.year, seed.month);
    const shifts = generateSchedule({
      year: seed.year, month: seed.month, workHours: seed.workHours, employees: seed.employees,
    });

    for (const emp of seed.employees) {
      if (emp.startDate == null) continue;
      const early = shifts.filter((s) => s.employeeId === emp.id && s.date < emp.startDate!);
      expect(early, `${emp.name} darf vor ${emp.startDate} nicht arbeiten`).toEqual([]);
    }

    const v = validateSchedule(seed.employees, shifts, seed.year, openDates);
    const under = v.errors.filter((e) => e.message.includes("mới xếp được"));
    expect(under, `keine Fehlstunden-Warnung mehr:\n${under.map((e) => e.message).join("\n")}`).toEqual([]);
    // Jede geplante Person trifft ihr (personenbezogenes) Soll im 30-min-Raster.
    for (const emp of seed.employees) {
      const got = shifts.filter((s) => s.employeeId === emp.id).reduce((a, s) => a + s.paidMinutes, 0);
      expect(Math.abs(got - monthlyTargetMinutesFor(emp, openDates))).toBeLessThanOrEqual(30);
    }
  });
});
