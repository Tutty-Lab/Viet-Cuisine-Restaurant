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
import { monthlyTargetMinutes } from "../contract";

const openDaysOf = (year: number, month: number): number => {
  const hol = publicHolidays(year);
  return datesOfMonth(year, month).filter(
    (d) => !resolveDay(DEFAULT_WORK_HOURS, d, hol, {}).closed,
  ).length;
};

describe("Scheduler – August 2026 Beispieldaten", () => {
  const shifts = generateSchedule({
    year: 2026,
    month: 8,
    workHours: DEFAULT_WORK_HOURS,
    employees: SAMPLE_EMPLOYEES,
  });

  const openDays = openDaysOf(2026, 8);

  it("verteilt insgesamt die Summe der (Wochen-)Sollstunden", () => {
    const soll = SAMPLE_EMPLOYEES.reduce((sum, e) => sum + monthlyTargetMinutes(e, openDays), 0);
    const totalMinutes = shifts.reduce((s, x) => s + x.paidMinutes, 0);
    expect(totalMinutes).toBe(soll);
  });

  it("trifft jedes einzelne Mitarbeiter-Soll exakt", () => {
    for (const emp of SAMPLE_EMPLOYEES) {
      const assigned = shifts
        .filter((s) => s.employeeId === emp.id)
        .reduce((sum, s) => sum + s.paidMinutes, 0);
      expect(assigned).toBe(monthlyTargetMinutes(emp, openDays));
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

  it("plant mehr Stunden am Samstag als am Montag", () => {
    const byDate = new Map<string, number>();
    for (const s of shifts) {
      byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.paidMinutes);
    }
    // 2026-08-01 ist Samstag (Gewicht 1,5), 2026-08-04 ein Dienstag (1,0).
    // Der Montag ist geschlossen, deshalb der Vergleich gegen einen Werktag.
    const sat = byDate.get("2026-08-01") ?? 0;
    const tue = byDate.get("2026-08-04") ?? 0;
    expect(sat).toBeGreaterThan(tue);
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
