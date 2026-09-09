import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { maxConsecutiveRun } from "../consecutive";
import { SAMPLE_EMPLOYEES } from "../sampleData";
import { DEFAULT_WORK_HOURS } from "../workHours";
import { calculatePause } from "../time";
import { datesOfMonth } from "../demand";
import { resolveDay } from "../workHours";
import { publicHolidays } from "../holidays";
import { contractOpenDays, monthlyTargetMinutes } from "../contract";
import { weekStartOf } from "../weeks";

const openDaysOf = (year: number, month: number): number => {
  const hol = publicHolidays(year);
  const openDates = datesOfMonth(year, month).filter(
    (d) => !resolveDay(DEFAULT_WORK_HOURS, d, hol, {}).closed,
  );
  const byWeek = new Map<string, number>();
  for (const date of openDates) {
    const week = weekStartOf(date);
    byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
  }
  return contractOpenDays([...byWeek.values()]);
};

describe("Scheduler – August 2026 Beispieldaten", () => {
  const shifts = generateSchedule({
    year: 2026,
    month: 8,
    workHours: DEFAULT_WORK_HOURS,
    employees: SAMPLE_EMPLOYEES,
  });

  const openDays = openDaysOf(2026, 8);

  it("verteilt die Summe der Wochenstunden innerhalb des 30-Minuten-Rasters", () => {
    const soll = SAMPLE_EMPLOYEES.reduce((sum, e) => sum + monthlyTargetMinutes(e, openDays), 0);
    const totalMinutes = shifts.reduce((s, x) => s + x.paidMinutes, 0);
    expect(Math.abs(totalMinutes - soll)).toBeLessThanOrEqual(SAMPLE_EMPLOYEES.length * 15);
  });

  it("trifft jedes Mitarbeiter-Soll bis auf die Randwochen-Rundung", () => {
    for (const emp of SAMPLE_EMPLOYEES) {
      const assigned = shifts
        .filter((s) => s.employeeId === emp.id)
        .reduce((sum, s) => sum + s.paidMinutes, 0);
      expect(Math.abs(assigned - monthlyTargetMinutes(emp, openDays))).toBeLessThanOrEqual(15);
    }
  });

  it("hält alle harten Regeln ein (Validierung grün)", () => {
    const result = validateSchedule(SAMPLE_EMPLOYEES, shifts, 2026, openDays);
    expect(result.errors.filter((e) => e.severity !== "warning")).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("kein Mitarbeiter steht zweimal gleichzeitig im Laden", () => {
    // Zwei Dienste an einem Tag sind erlaubt (mittags und abends), solange sie
    // sich nicht überschneiden.
    const ueberlappungen: string[] = [];
    for (const a of shifts) {
      for (const b of shifts) {
        if (a === b || a.employeeId !== b.employeeId || a.date !== b.date) continue;
        if (a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes) {
          ueberlappungen.push(`${a.employeeId} ${a.date}`);
        }
      }
    }
    expect(ueberlappungen).toEqual([]);
  });

  it("nie mehr als 6 aufeinanderfolgende Arbeitstage", () => {
    for (const emp of SAMPLE_EMPLOYEES) {
      const dates = shifts.filter((s) => s.employeeId === emp.id).map((s) => s.date);
      expect(maxConsecutiveRun(dates)).toBeLessThanOrEqual(6);
    }
  });

  it("jede Schicht: paid <= 9 h und korrekte Pause", () => {
    for (const s of shifts) {
      expect(s.paidMinutes).toBeLessThanOrEqual(9 * 60);
      expect(s.pauseMinutes).toBe(calculatePause(s.paidMinutes));
      expect(s.endMinutes - s.startMinutes - s.pauseMinutes).toBe(s.paidMinutes);
      expect(s.startMinutes % 30).toBe(0);
      expect(s.endMinutes % 30).toBe(0);
    }
  });

  it("ist deterministisch (gleiche Eingabe => gleiche Ausgabe)", () => {
    const again = generateSchedule({
      year: 2026,
      month: 8,
      workHours: DEFAULT_WORK_HOURS,
      employees: SAMPLE_EMPLOYEES,
    });
    expect(again.map((s) => `${s.date}|${s.employeeId}|${s.paidMinutes}|${s.shiftType}`)).toEqual(
      shifts.map((s) => `${s.date}|${s.employeeId}|${s.paidMinutes}|${s.shiftType}`),
    );
  });

  it("keeps individual contracts while allocating aggregate hours by demand", () => {
    const week = shifts.filter((shift) => shift.employeeId === "ma-1" && weekStartOf(shift.date) === "2026-08-03");
    expect(week.reduce((sum, shift) => sum + shift.paidMinutes, 0)).toBe(39 * 60);
    const all = shifts.filter((shift) => weekStartOf(shift.date) === "2026-08-03");
    const busy = all.filter((shift) => [0, 5, 6].includes(new Date(`${shift.date}T12:00:00`).getDay()))
      .reduce((sum, shift) => sum + shift.paidMinutes, 0);
    const normal = all.reduce((sum, shift) => sum + shift.paidMinutes, 0) - busy;
    expect(busy / normal).toBeGreaterThanOrEqual(1.47);
    expect(busy / normal).toBeLessThanOrEqual(1.53);
  });
});

describe("Scheduler – weitere Monate robust", () => {
  it("erzeugt gültige Pläne für Februar (28 Tage)", () => {
    const shifts = generateSchedule({
      year: 2026,
      month: 2,
      workHours: DEFAULT_WORK_HOURS,
      employees: SAMPLE_EMPLOYEES,
    });
    const result = validateSchedule(SAMPLE_EMPLOYEES, shifts, 2026, openDaysOf(2026, 2));
    expect(result.valid).toBe(true);
  });
});
