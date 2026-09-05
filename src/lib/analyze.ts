// ============================================================================
// Auswertung eines fertigen Dienstplans. Rein lesend – verändert nichts.
//
// Beantwortet die Fragen, die man dem Plan von außen ansieht:
//  - Sind die Stoßzeiten (12–13, 17–19 Uhr) durchgehend doppelt besetzt?
//  - Folgt die Stundenverteilung wirklich den Tagesgewichten?
//  - Wie sehen die Schichtlängen aus?
// ============================================================================

import type { Employee, Shift } from "../types";
import {
  DAY_WEIGHTS,
  datesOfMonth,
  parseIsoDate,
  weekdayKeyOf,
  type WeekdayKey,
} from "./demand";
import { PEAK_WINDOWS_BY_WEEKDAY, maxCoverageOver, minCoverageOver } from "./scheduler";
import { publicHolidays } from "./holidays";
import {
  effectiveWeekdayKey,
  resolveDay,
  type OverrideMap,
  type WorkHoursConfig,
} from "./workHours";

export type PeakCoverage = {
  label: string;
  /** Kleinste Besetzung über die ganze Spanne. */
  minStaff: number;
  /** Größte Besetzung über die Spanne – für die Obergrenze. */
  maxStaff: number;
  required: number;
  /** So viele dürfen höchstens da sein. */
  allowed: number;
  ok: boolean;
};

export type DayReport = {
  date: string;
  weekday: WeekdayKey;
  closed: boolean;
  shiftCount: number;
  paidHours: number;
  /** Rechnerisches Tages-Soll: Gesamtstunden × Tagesgewicht / Summe Gewichte. */
  targetHours: number;
  peaks: PeakCoverage[];
};

export type WeekdayFit = {
  weekday: WeekdayKey;
  days: number;
  avgHours: number;
  /** Durchschnittliches Tages-Soll dieses Wochentags (aus dem Gewicht). */
  avgTargetHours: number;
  /** avgHours / avgTargetHours - 1, also die relative Abweichung. */
  deviation: number;
};

export type ScheduleAnalysis = {
  days: DayReport[];
  openDays: number;
  totalPaidHours: number;
  /** Tage, an denen mindestens eine Stoßzeit unterbesetzt ist. */
  peakViolations: DayReport[];
  weekdayFit: WeekdayFit[];
  /** Mittlere absolute Abweichung vom Tages-Soll, in Stunden je offenem Tag. */
  meanAbsDeviationHours: number;
  /** Dieselbe Abweichung relativ zum durchschnittlichen Tages-Soll. */
  meanAbsDeviationPercent: number;
  /** Größte Einzelabweichung eines Tages, in Stunden. */
  maxAbsDeviationHours: number;
  /** Schichtlänge (Stunden) -> Anzahl. */
  lengthHistogram: Map<number, number>;
  /** Mitarbeiter-Id -> zugewiesene Stunden. */
  hoursByEmployee: Map<string, number>;
};

export type AnalyzeInput = {
  year: number;
  month: number;
  workHours: WorkHoursConfig;
  overrides?: OverrideMap;
  employees: Employee[];
  shifts: Shift[];
  holidays?: Set<string>;
};

export function analyzeSchedule(input: AnalyzeInput): ScheduleAnalysis {
  const holidays = input.holidays ?? publicHolidays(input.year);
  const overrides = input.overrides ?? {};
  const dates = datesOfMonth(input.year, input.month);

  const byDate = new Map<string, Shift[]>();
  for (const s of input.shifts) {
    const list = byDate.get(s.date);
    if (list) list.push(s);
    else byDate.set(s.date, [s]);
  }

  // Tages-Soll genauso herleiten wie der Scheduler: geschlossene Tage tragen 0.
  const totalPaidMinutes = input.shifts.reduce((sum, s) => sum + s.paidMinutes, 0);
  const weightOf = (date: string): number =>
    resolveDay(input.workHours, date, holidays, overrides).closed
      ? 0
      : DAY_WEIGHTS[effectiveWeekdayKey(date, holidays)];
  const totalWeight = dates.reduce((sum, d) => sum + weightOf(d), 0);

  const days: DayReport[] = [];
  for (const date of dates) {
    const day = resolveDay(input.workHours, date, holidays, overrides);
    const onDay = byDate.get(date) ?? [];

    const peaks: PeakCoverage[] = [];
    if (!day.closed) {
      for (const peak of PEAK_WINDOWS_BY_WEEKDAY[effectiveWeekdayKey(date, holidays)]) {
        const from = Math.max(peak.startMinutes, day.window.startMinutes);
        const to = Math.min(peak.endMinutes, day.window.endMinutes);
        if (to <= from) continue; // Spitze liegt außerhalb der Arbeitszeit
        const minStaff = minCoverageOver(onDay, from, to);
        const maxStaff = maxCoverageOver(onDay, from, to);
        peaks.push({
          label: peak.label,
          minStaff,
          maxStaff,
          required: peak.minStaff,
          allowed: peak.maxStaff,
          ok: minStaff >= peak.minStaff && maxStaff <= peak.maxStaff,
        });
      }
    }

    days.push({
      date,
      weekday: weekdayKeyOf(parseIsoDate(date)),
      closed: day.closed,
      shiftCount: onDay.length,
      paidHours: onDay.reduce((sum, s) => sum + s.paidMinutes, 0) / 60,
      targetHours: totalWeight > 0 ? (totalPaidMinutes * weightOf(date)) / totalWeight / 60 : 0,
      peaks,
    });
  }

  const openDayReports = days.filter((d) => !d.closed);
  const deviations = openDayReports.map((d) => Math.abs(d.paidHours - d.targetHours));
  const meanAbsDeviationHours =
    deviations.length > 0 ? deviations.reduce((a, b) => a + b, 0) / deviations.length : 0;
  const avgTargetHours =
    openDayReports.length > 0
      ? openDayReports.reduce((sum, d) => sum + d.targetHours, 0) / openDayReports.length
      : 0;

  // ── Gewichtstreue je Wochentag ────────────────────────────────────────────
  // Verglichen wird Ist gegen das eigene Tages-Soll. Ein Vergleich gegen den
  // Montag als Anker wäre irreführend: liegt der Montag selbst daneben, sähen
  // alle anderen Wochentage falsch aus.
  const sumByWeekday = new Map<WeekdayKey, { hours: number; target: number; days: number }>();
  for (const d of days) {
    if (d.closed) continue;
    const acc = sumByWeekday.get(d.weekday) ?? { hours: 0, target: 0, days: 0 };
    acc.hours += d.paidHours;
    acc.target += d.targetHours;
    acc.days += 1;
    sumByWeekday.set(d.weekday, acc);
  }

  const weekdayFit: WeekdayFit[] = [];
  for (const [weekday, acc] of sumByWeekday) {
    const avgHours = acc.hours / acc.days;
    const avgTargetHours = acc.target / acc.days;
    weekdayFit.push({
      weekday,
      days: acc.days,
      avgHours,
      avgTargetHours,
      deviation: avgTargetHours > 0 ? avgHours / avgTargetHours - 1 : 0,
    });
  }
  weekdayFit.sort((a, b) => DAY_WEIGHTS[a.weekday] - DAY_WEIGHTS[b.weekday]);

  const lengthHistogram = new Map<number, number>();
  for (const s of input.shifts) {
    const hours = s.paidMinutes / 60;
    lengthHistogram.set(hours, (lengthHistogram.get(hours) ?? 0) + 1);
  }

  const hoursByEmployee = new Map<string, number>();
  for (const e of input.employees) hoursByEmployee.set(e.id, 0);
  for (const s of input.shifts) {
    hoursByEmployee.set(s.employeeId, (hoursByEmployee.get(s.employeeId) ?? 0) + s.paidMinutes / 60);
  }

  return {
    days,
    openDays: days.filter((d) => !d.closed).length,
    totalPaidHours: input.shifts.reduce((sum, s) => sum + s.paidMinutes, 0) / 60,
    peakViolations: days.filter((d) => d.peaks.some((p) => !p.ok)),
    weekdayFit,
    meanAbsDeviationHours,
    meanAbsDeviationPercent: avgTargetHours > 0 ? (meanAbsDeviationHours / avgTargetHours) * 100 : 0,
    maxAbsDeviationHours: deviations.length > 0 ? Math.max(...deviations) : 0,
    lengthHistogram,
    hoursByEmployee,
  };
}
