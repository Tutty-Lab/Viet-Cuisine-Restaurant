// ============================================================================
// Wochen eines Monats. Grundlage für den Wochen-Ausdruck des Dienstplans.
//
// Eine Woche läuft Montag bis Sonntag (deutsche/ISO-Zählung). Die erste und
// letzte Woche eines Monats ragen meist in den Nachbarmonat hinein; gedruckt
// werden trotzdem nur die Tage, die IN diesem Monat liegen – der Plan gilt
// immer für genau einen Monat.
// ============================================================================

import { format, startOfWeek } from "date-fns";
import { datesOfMonth, parseIsoDate } from "./demand";

export type MonthWeek = {
  /** ISO-Datum des Montags dieser Woche (kann im Vormonat liegen). */
  weekStart: string;
  /** Tage dieser Woche, die im Monat liegen – aufsteigend. */
  dates: string[];
  /** Kurzbeschriftung, z.B. „01.06.–07.06." */
  label: string;
};

/** Montag der Woche, in der `isoDate` liegt. */
export function weekStartOf(isoDate: string): string {
  return format(startOfWeek(parseIsoDate(isoDate), { weekStartsOn: 1 }), "yyyy-MM-dd");
}

function shortDe(isoDate: string): string {
  const [, m, d] = isoDate.split("-");
  return `${d}.${m}.`;
}

/**
 * Alle Wochen, die Tage dieses Monats enthalten – in Reihenfolge.
 * month ist 1-basiert.
 */
export function weeksOfMonth(year: number, month: number): MonthWeek[] {
  const byStart = new Map<string, string[]>();

  for (const iso of datesOfMonth(year, month)) {
    const start = weekStartOf(iso);
    const list = byStart.get(start);
    if (list) list.push(iso);
    else byStart.set(start, [iso]);
  }

  return [...byStart.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, dates]) => ({
      weekStart,
      dates,
      label: `${shortDe(dates[0])}–${shortDe(dates[dates.length - 1])}`,
    }));
}
