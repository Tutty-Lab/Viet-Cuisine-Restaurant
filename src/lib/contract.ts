// ============================================================================
// Wochenvertrag -> Monatssoll.
//
// Viet Cuisine gibt Verträge in WOCHENstunden an (39 h/Woche = Vollzeit). Der
// Scheduler plant aber einen Monat und rechnet in Monats-Sollminuten. Diese
// Umrechnung steht hier an EINER Stelle, damit Scheduler, Prüfung und Anzeige
// dieselbe Zahl verwenden.
//
// Umgerechnet wird über die tatsächlich OFFENEN Tage des Monats, nicht über
// einen festen Faktor: der Laden hat sechs offene Tage die Woche (Di–So,
// montags zu). Ein Monat mit mehr offenen Tagen trägt entsprechend mehr
// Stunden. Feiertage sind offen (wie Sonntag) und zählen mit.
// ============================================================================

import type { Employee } from "../types";

/** Offene Tage je Woche: Di–So, der Montag ist zu. */
export const OPEN_DAYS_PER_WEEK = 6;

/** Extra opening days in a calendar week do not increase a weekly contract. */
export function contractOpenDays(openDaysByWeek: readonly number[]): number {
  return openDaysByWeek.reduce((sum, openDays) => sum + Math.min(openDays, OPEN_DAYS_PER_WEEK), 0);
}

/**
 * Monats-Soll dieser Person in Minuten.
 *
 * Ist weeklyHours gesetzt, ist das die Quelle:
 *   Monatsstunden = Wochenstunden × offene Tage des Monats ÷ 6
 * auf Minuten gerundet; halbe Stunden bleiben erhalten.
 * Ohne weeklyHours gilt das direkt eingetragene targetMinutes.
 */
export function monthlyTargetMinutes(emp: Employee, openDaysInMonth: number): number {
  if (emp.weeklyHours != null) {
    return Math.max(0, Math.round((emp.weeklyHours * 60 * openDaysInMonth) / OPEN_DAYS_PER_WEEK));
  }
  return emp.targetMinutes;
}

/**
 * Verteilt das MONATS-Soll (in Minuten) auf die einzelnen ISO-Wochen des Monats
 * – so plant der Betrieb bei Viet Cuisine: „diese Woche 39 h" statt „im Monat
 * 169 h, egal wie verteilt". Vorher lag das Soll nur als Monatszahl vor, und der
 * Scheduler durfte eine Woche mit 42 h und die nächste mit 36 h füllen, solange
 * die Summe stimmte.
 *
 * Eine volle Woche (6 offene Tage) bekommt genau die Wochenstunden, eine
 * angebrochene Rand-Woche anteilig. Zusätzliche Öffnungstage in einer Woche
 * erhöhen das Wochen-Soll nicht.
 *
 * Rückgabe: weekStart (ISO-Montag) -> Soll-Minuten der Woche.
 */
export function weeklyTargetMinutes(
  monthlyMin: number,
  openDaysByWeek: readonly { weekStart: string; openDays: number }[],
  contractedWeeklyMinutes?: number,
): Map<string, number> {
  const result = new Map<string, number>();
  const totalOpen = openDaysByWeek.reduce((a, w) => a + w.openDays, 0);
  if (totalOpen <= 0 || monthlyMin <= 0) {
    for (const w of openDaysByWeek) result.set(w.weekStart, 0);
    return result;
  }

  // A weekly contract never borrows minutes from another week, even for a
  // short month boundary or an extra opening day.
  if (contractedWeeklyMinutes != null) {
    for (const week of openDaysByWeek) {
      result.set(week.weekStart, Math.round(contractedWeeklyMinutes * Math.min(week.openDays, OPEN_DAYS_PER_WEEK) / OPEN_DAYS_PER_WEEK));
    }
    return result;
  }

  const raw = openDaysByWeek.map((w) => (monthlyMin * w.openDays) / totalOpen);
  const floors = raw.map((x) => Math.floor(x));
  let rest = Math.round(monthlyMin) - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  const minutes = [...floors];
  for (let k = 0; k < order.length && rest > 0; k++, rest--) minutes[order[k].i] += 1;
  openDaysByWeek.forEach((w, i) => result.set(w.weekStart, minutes[i]));
  return result;
}
