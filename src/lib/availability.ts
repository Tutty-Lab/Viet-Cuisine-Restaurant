// ============================================================================
// Wann darf eine Person überhaupt eingeplant werden?
//
// Bei Kylan ist das der Urlaub: eingetragene Tage werden beim Planen
// ausgespart. Die Tage kommen IMMER vom Nutzer – wer wann frei nimmt, ist eine
// Absprache im Betrieb und nichts, was ein Automat verteilen darf.
//
// Alles steht hier an EINER Stelle, weil der Scheduler an mehreren Stellen
// Termine vergibt: beim ersten Verteilen, beim Verschieben, beim Tauschen und
// in den Reparaturläufen. Bei einer anderen Filiale standen Sonderregeln nur
// im ersten Schritt – die Läufe danach haben sie klaglos wieder kaputtgemacht.
// ============================================================================

import type { Employee } from "../types";
import { URLAUB_DAYS_PER_YEAR } from "../types";

/** Urlaubstage dieser Person, als Set für schnelles Nachschlagen. */
export function vacationSet(employee: Employee): Set<string> {
  return new Set(employee.vacationDates ?? []);
}

/** Ist die Person an diesem Tag im Urlaub? */
export function onVacation(employee: Employee, isoDate: string): boolean {
  return (employee.vacationDates ?? []).includes(isoDate);
}

/**
 * Die eine Frage, die jeder Planungsschritt stellen muss: darf diese Person an
 * diesem Datum arbeiten?
 */
export function mayWorkOn(employee: Employee, isoDate: string): boolean {
  return !onVacation(employee, isoDate);
}

/** Wie viele Urlaubstage hat die Person in diesem Jahr eingetragen? */
export function vacationDaysInYear(employee: Employee, year: number): number {
  const praefix = `${year}-`;
  return (employee.vacationDates ?? []).filter((d) => d.startsWith(praefix)).length;
}

/** Jahresanspruch dieser Person in Arbeitstagen. */
export function vacationEntitlement(employee: Employee): number {
  return URLAUB_DAYS_PER_YEAR[employee.employmentType];
}

/** Urlaubstage im geplanten Monat, aufsteigend sortiert. */
export function vacationDatesInMonth(
  employee: Employee,
  year: number,
  month: number,
): string[] {
  const praefix = `${year}-${String(month).padStart(2, "0")}-`;
  return (employee.vacationDates ?? []).filter((d) => d.startsWith(praefix)).sort();
}
