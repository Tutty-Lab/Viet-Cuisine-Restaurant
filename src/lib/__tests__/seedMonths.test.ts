// ============================================================================
// Der Scheduler gegen drei Monate mit UNTERSCHIEDLICHEN Belegschaften.
//
// Viet Cuisine rechnet in WOCHENstunden (weeklyHours); das Monats-Soll wird je
// Monat aus den offenen Tagen abgeleitet (contract.ts). Deshalb kommt hier
// überall openDays des jeweiligen Monats ins Spiel.
// ============================================================================

import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { analyzeSchedule } from "../analyze";
import { validateSchedule } from "../validation";
import { maxConsecutiveRun } from "../consecutive";
import { SEED_MONTHS, totalTargetHours } from "../seedData";
import { DEFAULT_WORK_HOURS } from "../workHours";
import { calculatePause } from "../time";
import { PEAK_WINDOWS_BY_WEEKDAY } from "../scheduler";
import { publicHolidays } from "../holidays";
import { datesOfMonth } from "../demand";
import { contractOpenDays, monthlyTargetMinutes } from "../contract";
import { effectiveWeekdayKey, resolveDay } from "../workHours";
import { weekStartOf } from "../weeks";

const runs = SEED_MONTHS.map((seed) => {
  const holidays = publicHolidays(seed.year);
  const openDates = datesOfMonth(seed.year, seed.month).filter(
    (d) => !resolveDay(DEFAULT_WORK_HOURS, d, holidays, {}).closed,
  );
  const byWeek = new Map<string, number>();
  for (const date of openDates) {
    const week = weekStartOf(date);
    byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
  }
  const openDays = contractOpenDays([...byWeek.values()]);
  const shifts = generateSchedule({
    year: seed.year,
    month: seed.month,
    workHours: DEFAULT_WORK_HOURS,
    employees: seed.employees,
  });
  const analysis = analyzeSchedule({
    year: seed.year,
    month: seed.month,
    workHours: DEFAULT_WORK_HOURS,
    employees: seed.employees,
    shifts,
  });
  return { seed, openDays, shifts, analysis };
});

describe.each(runs)("Seed-Monat: $seed.label", ({ seed, openDays, shifts, analysis }) => {
  it("trifft die Summe der Sollstunden exakt", () => {
    expect(analysis.totalPaidHours).toBe(totalTargetHours(seed, openDays));
  });

  it("trifft jedes einzelne Mitarbeiter-Soll exakt", () => {
    for (const emp of seed.employees) {
      expect(analysis.hoursByEmployee.get(emp.id)).toBe(monthlyTargetMinutes(emp, openDays) / 60);
    }
  });

  it("besteht die Validierung ohne harte Fehler", () => {
    const result = validateSchedule(seed.employees, shifts, seed.year, openDays);
    expect(result.errors.filter((e) => e.severity !== "warning")).toEqual([]);
  });

  it("hält höchstens 6 aufeinanderfolgende Arbeitstage ein", () => {
    for (const emp of seed.employees) {
      const dates = shifts.filter((s) => s.employeeId === emp.id).map((s) => s.date);
      expect(maxConsecutiveRun(dates)).toBeLessThanOrEqual(6);
    }
  });

  it("regulaere Schichten sind 3..9 h lang; kleine Randwochen bleiben anteilig", () => {
    for (const s of shifts) {
      const weekDays = openDatesInWeek(s.date);
      const employee = seed.employees.find((e) => e.id === s.employeeId)!;
      const quota = employee.weeklyHours! * 60 * weekDays / 6;
      expect(s.paidMinutes).toBeGreaterThanOrEqual(Math.min(weekDays < 6 ? 2 * 60 : 3 * 60, quota));
      expect(s.paidMinutes).toBeLessThanOrEqual(9 * 60);
      expect(s.pauseMinutes).toBe(calculatePause(s.paidMinutes));
      expect(s.endMinutes - s.startMinutes - s.pauseMinutes).toBe(s.paidMinutes);
    }
  });

  function openDatesInWeek(date: string): number {
    const holidays = publicHolidays(seed.year);
    return datesOfMonth(seed.year, seed.month).filter((candidate) =>
      weekStartOf(candidate) === weekStartOf(date) && !resolveDay(DEFAULT_WORK_HOURS, candidate, holidays).closed,
    ).length;
  }

  it("legt jede Schicht KOMPLETT in einen Öffnungsblock", () => {
    // Di–Sa hat der Tag ZWEI Blöcke (10:30–14:30 und 16:30–22:30). Es reicht
    // deshalb nicht, Anfang und Ende gegen den Tagesrahmen zu prüfen – eine
    // Schicht darf nicht über die Mittagsschließung ragen.
    const holidays = publicHolidays(seed.year);
    const draussen = shifts.filter((s) => {
      const day = resolveDay(DEFAULT_WORK_HOURS, s.date, holidays, {});
      return !day.blocks.some(
        (b) => s.startMinutes >= b.startMinutes && s.endMinutes <= b.endMinutes,
      );
    });
    expect(draussen.map((s) => `${s.date} ${s.startMinutes}-${s.endMinutes}`)).toEqual([]);
  });

  it("plant keine Schicht außerhalb des Arbeitszeit-Fensters (10:30–22:30)", () => {
    for (const s of shifts) {
      expect(s.startMinutes).toBeGreaterThanOrEqual(10 * 60 + 30);
      expect(s.endMinutes).toBeLessThanOrEqual(22 * 60 + 30);
    }
  });

  it("kein Ladendienst am Montag (Laden ist montags zu)", () => {
    const holidays = publicHolidays(seed.year);
    for (const s of shifts) {
      expect(resolveDay(DEFAULT_WORK_HOURS, s.date, holidays, {}).closed).toBe(false);
    }
  });

  it("hält in der Stoßzeit die erlaubte Personenzahl ein", () => {
    expect(analysis.peakViolations.length).toBeLessThanOrEqual(seed.maxPeakGaps ?? 0);
  });

  it("Gegenprobe Minute für Minute: Stoßzeit im erlaubten Rahmen", () => {
    const byDate = new Map<string, typeof shifts>();
    for (const s of shifts) {
      const list = byDate.get(s.date);
      if (list) list.push(s);
      else byDate.set(s.date, [s]);
    }
    const holidays = publicHolidays(seed.year);
    const bad: string[] = [];
    for (const [date, onDay] of byDate) {
      const day = resolveDay(DEFAULT_WORK_HOURS, date, holidays, {});
      if (day.closed) continue;
      for (const peak of PEAK_WINDOWS_BY_WEEKDAY[effectiveWeekdayKey(date, holidays)]) {
        const from = Math.max(peak.startMinutes, day.window.startMinutes);
        const to = Math.min(peak.endMinutes, day.window.endMinutes);
        for (let t = from; t < to; t++) {
          const staff = onDay.filter((s) => s.startMinutes <= t && s.endMinutes > t).length;
          if (staff < peak.minStaff || staff > peak.maxStaff) {
            bad.push(`${date} ${peak.label}`);
            break;
          }
        }
      }
    }
    expect(new Set(bad.map((b) => b.slice(0, 10))).size).toBeLessThanOrEqual(seed.maxPeakGaps ?? 0);
  });
});

describe("Report", () => {
  it("schreibt die Auswertung auf die Konsole", () => {
    const lines: string[] = [];
    for (const { seed, openDays, shifts, analysis } of runs) {
      lines.push("");
      lines.push(`=== ${seed.label} ===`);
      lines.push(
        `Mitarbeiter: ${seed.employees.length} · Sollstunden gesamt: ${totalTargetHours(seed, openDays)} h · ` +
          `offene Tage: ${analysis.openDays} · Schichten: ${shifts.length}`,
      );
      const hist = [...analysis.lengthHistogram.entries()].sort((a, b) => a[0] - b[0]);
      lines.push("  " + hist.map(([h, n]) => `${h}h×${n}`).join("  "));
      lines.push(`Stoßzeiten außerhalb der erlaubten Personenzahl: ${analysis.peakViolations.length} Tage`);
    }
    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));
    expect(runs.length).toBe(3);
  });
});
