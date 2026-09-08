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

/** Kürzeste planbare Schicht in Stunden – darunter lohnt sich keine Wochenquote. */
const MIN_SHIFT_HOURS_FOR_WEEK = 3;

/**
 * Verteilt das MONATS-Soll (in Minuten) auf die einzelnen ISO-Wochen des Monats
 * – so plant der Betrieb bei Viet Cuisine: „diese Woche 39 h" statt „im Monat
 * 169 h, egal wie verteilt". Vorher lag das Soll nur als Monatszahl vor, und der
 * Scheduler durfte eine Woche mit 42 h und die nächste mit 36 h füllen, solange
 * die Summe stimmte.
 *
 * Gewichtet wird nach den OFFENEN Tagen je Woche: eine volle Woche (6 offene
 * Tage) bekommt genau die Wochenstunden, eine angebrochene Rand-Woche
 * anteilig. Gerechnet wird in GANZEN Stunden (der Plan besteht aus
 * Stunden-Schichten) mit Rest-Ausgleich (largest remainder), damit die Summe
 * der Wochen EXAKT das Monats-Soll ergibt – das Monatsergebnis ändert sich also
 * nicht, nur seine Verteilung.
 *
 * Winzige Rand-Wochen (unter einer Mindestschicht, z. B. ein Minijob mit einem
 * einzigen offenen Tag am Monatsanfang) lassen sich nicht sinnvoll als eigene
 * Woche planen; ihre Stunden wandern in die nächste Woche. So bleibt jede
 * Wochenquote entweder 0 oder mindestens eine Schicht lang und damit planbar.
 *
 * Rückgabe: weekStart (ISO-Montag) -> Soll-Minuten der Woche.
 */
export function weeklyTargetMinutes(
  monthlyMin: number,
  openDaysByWeek: readonly { weekStart: string; openDays: number }[],
): Map<string, number> {
  const result = new Map<string, number>();
  const totalOpen = openDaysByWeek.reduce((a, w) => a + w.openDays, 0);
  const monthlyHours = Math.round(monthlyMin / 60);
  if (totalOpen <= 0 || monthlyHours <= 0) {
    for (const w of openDaysByWeek) result.set(w.weekStart, 0);
    return result;
  }

  // 1. Ganze Stunden je Woche mit Rest-Ausgleich, Summe = monthlyHours.
  const raw = openDaysByWeek.map((w) => (monthlyHours * w.openDays) / totalOpen);
  const floors = raw.map((x) => Math.floor(x));
  let rest = monthlyHours - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  const hours = [...floors];
  for (let k = 0; k < order.length && rest > 0; k++, rest--) hours[order[k].i] += 1;

  // 2. Zu kleine Wochen (unter einer Mindestschicht) in die nächste Woche mit
  //    Stunden schieben, damit jede verbleibende Quote planbar bleibt.
  for (let i = 0; i < hours.length; i++) {
    if (hours[i] > 0 && hours[i] < MIN_SHIFT_HOURS_FOR_WEEK) {
      let j = i + 1;
      while (j < hours.length && hours[j] === 0) j++;
      if (j >= hours.length) {
        j = i - 1;
        while (j >= 0 && hours[j] === 0) j--;
      }
      if (j >= 0 && j < hours.length) {
        hours[j] += hours[i];
        hours[i] = 0;
      }
    }
  }

  openDaysByWeek.forEach((w, i) => result.set(w.weekStart, hours[i] * 60));
  return result;
}
