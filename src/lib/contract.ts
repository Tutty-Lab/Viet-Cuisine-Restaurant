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

/**
 * Monats-Soll dieser Person in Minuten.
 *
 * Ist weeklyHours gesetzt, ist das die Quelle:
 *   Monatsstunden = Wochenstunden × offene Tage des Monats ÷ 6
 * auf ganze Stunden gerundet (der Plan besteht aus Diensten in ganzen Stunden).
 * Ohne weeklyHours gilt das direkt eingetragene targetMinutes.
 */
export function monthlyTargetMinutes(emp: Employee, openDaysInMonth: number): number {
  if (emp.weeklyHours != null && emp.weeklyHours > 0) {
    const stunden = Math.round((emp.weeklyHours * openDaysInMonth) / OPEN_DAYS_PER_WEEK);
    return stunden * 60;
  }
  return emp.targetMinutes;
}
