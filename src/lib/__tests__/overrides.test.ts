import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { DEFAULT_WORK_HOURS, resolveDay, type OverrideMap } from "../workHours";
import { SAMPLE_EMPLOYEES } from "../sampleData";
import { datesOfMonth } from "../demand";
import { publicHolidays } from "../holidays";
import { contractOpenDays, monthlyTargetMinutes } from "../contract";
import { weekStartOf } from "../weeks";

const openDaysWith = (year: number, month: number, overrides: OverrideMap): number => {
  const hol = publicHolidays(year);
  const openDates = datesOfMonth(year, month).filter(
    (d) => !resolveDay(DEFAULT_WORK_HOURS, d, hol, overrides).closed,
  );
  const byWeek = new Map<string, number>();
  for (const date of openDates) {
    const week = weekStartOf(date);
    byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
  }
  return contractOpenDays([...byWeek.values()]);
};

const sollTotal = (openDays: number): number =>
  SAMPLE_EMPLOYEES.reduce((sum, e) => sum + monthlyTargetMinutes(e, openDays), 0);

describe("Ausnahmen je Datum (Overrides)", () => {
  it("plant an geschlossenen Tagen keine Schicht – Soll bleibt im 30-Minuten-Raster", () => {
    const overrides: OverrideMap = {
      "2026-08-08": { date: "2026-08-08", closed: true, note: "Betriebsruhe" },
    };
    const shifts = generateSchedule({
      year: 2026,
      month: 8,
      workHours: DEFAULT_WORK_HOURS,
      overrides,
      employees: SAMPLE_EMPLOYEES,
    });
    expect(shifts.filter((s) => s.date === "2026-08-08")).toHaveLength(0);

    const openDays = openDaysWith(2026, 8, overrides);
    const result = validateSchedule(SAMPLE_EMPLOYEES, shifts, 2026, openDays);
    expect(result.errors.filter((e) => e.severity !== "warning")).toEqual([]);
    expect(Math.abs(shifts.reduce((a, s) => a + s.paidMinutes, 0) - sollTotal(openDays))).toBeLessThanOrEqual(SAMPLE_EMPLOYEES.length * 15);
  });

  it("halber Tag: Mitarbeiter arbeiten KÜRZERE Schichten (nicht frei), Soll im 30-Minuten-Raster", () => {
    // 10:30–16:00 = 330 Min Fenster. Mit Pause tragen 330 Minuten eine
    // 5-Stunden-Schicht (300 Min, noch pausenfrei), aber keine längere.
    const overrides: OverrideMap = {
      "2026-08-10": {
        date: "2026-08-10",
        closed: false,
        window: { startMinutes: 10 * 60 + 30, endMinutes: 16 * 60 },
        note: "halber Tag",
      },
    };
    const shifts = generateSchedule({
      year: 2026,
      month: 8,
      workHours: DEFAULT_WORK_HOURS,
      overrides,
      employees: SAMPLE_EMPLOYEES,
    });
    const onHalfDay = shifts.filter((x) => x.date === "2026-08-10");
    expect(onHalfDay.length).toBeGreaterThan(0);
    for (const s of onHalfDay) {
      expect(s.endMinutes - s.startMinutes).toBeLessThanOrEqual(330);
      expect(s.paidMinutes).toBeLessThanOrEqual(5.5 * 60);
      expect(s.startMinutes).toBeGreaterThanOrEqual(10 * 60 + 30);
      expect(s.endMinutes).toBeLessThanOrEqual(16 * 60);
    }
    const openDays = openDaysWith(2026, 8, overrides);
    const result = validateSchedule(SAMPLE_EMPLOYEES, shifts, 2026, openDays);
    expect(result.errors.filter((e) => e.severity !== "warning")).toEqual([]);
    expect(Math.abs(shifts.reduce((a, s) => a + s.paidMinutes, 0) - sollTotal(openDays))).toBeLessThanOrEqual(SAMPLE_EMPLOYEES.length * 15);
  });
});
