// ============================================================================
// Vordefinierte Schicht-Vorlagen. Für den Standard-Shop 10:00-22:00 werden die
// exakt in der Spezifikation genannten Vorlagen verwendet. Bei abweichenden
// Öffnungszeiten werden Vorlagen generisch abgeleitet (Früh am Öffnen verankert,
// Spät am Schließen verankert).
// ============================================================================

import { calculatePause, presenceFromPaid } from "./time";

export type TemplateType = "EARLY" | "LATE";

export type ShiftTemplate = {
  paidMinutes: number;
  pauseMinutes: number;
  startMinutes: number;
  endMinutes: number;
  type: TemplateType;
};

/** Erlaubte Schichtlängen in Stunden (VietHaus: 3 h bis 9 h bezahlt). */
// Bleibt bei 9: diese Liste treibt die Anzeige "wie viele Ca" und die
// Zerlegung eines Solls. Die 10-Stunden-Schicht des Chefs ist eine Ausnahme
// im Scheduler (SHIFT_HOURS_DESC), keine Länge, die allen offensteht.
export const SHIFT_LENGTHS = [3, 4, 5, 6, 7, 8, 9] as const;

const DEFAULT_OPEN = 10 * 60; // 10:00
const DEFAULT_CLOSE = 22 * 60; // 22:00

// Exakte Vorlagen laut Spezifikation für 10:00-22:00 (Zeiten in Minuten).
const SPEC_EARLY: Record<number, [number, number]> = {
  4: [12 * 60, 16 * 60], // 12:00-16:00
  5: [11 * 60, 16 * 60], // 11:00-16:00
  6: [10 * 60, 16 * 60], // 10:00-16:00
  7: [10 * 60, 17 * 60 + 30], // 10:00-17:30
  8: [10 * 60, 18 * 60 + 30], // 10:00-18:30
};
const SPEC_LATE: Record<number, [number, number]> = {
  4: [18 * 60, 22 * 60], // 18:00-22:00
  5: [17 * 60, 22 * 60], // 17:00-22:00
  6: [16 * 60, 22 * 60], // 16:00-22:00
  7: [14 * 60 + 30, 22 * 60], // 14:30-22:00
  8: [13 * 60 + 30, 22 * 60], // 13:30-22:00
};

function isDefaultHours(openMinutes: number, closeMinutes: number): boolean {
  return openMinutes === DEFAULT_OPEN && closeMinutes === DEFAULT_CLOSE;
}

/**
 * Liefert die Vorlage für eine bezahlte Stundenzahl und Früh/Spät.
 * @param paidHours 3..9
 */
export function getShiftTemplate(
  paidHours: number,
  type: TemplateType,
  openMinutes: number = DEFAULT_OPEN,
  closeMinutes: number = DEFAULT_CLOSE,
): ShiftTemplate {
  const paidMinutes = paidHours * 60;
  const pauseMinutes = calculatePause(paidMinutes);
  const presence = presenceFromPaid(paidMinutes);

  let startMinutes: number;
  let endMinutes: number;

  // Die SPEC-Tabellen stammen aus der pausenlosen Fassung: dort galt
  // presence = paid, die Endzeiten sind entsprechend gerechnet. Seit 8-/9-h-
  // Schichten 60 min Pause haben, würden sie für diese Längen eine falsche
  // Anwesenheit liefern (Validierung: paid != end - start - pause). Deshalb
  // gelten sie nur noch für pausenfreie Längen; alles andere geht generisch.
  if (pauseMinutes === 0 && isDefaultHours(openMinutes, closeMinutes) && SPEC_EARLY[paidHours]) {
    const spec = type === "EARLY" ? SPEC_EARLY[paidHours] : SPEC_LATE[paidHours];
    [startMinutes, endMinutes] = spec;
  } else if (type === "EARLY") {
    startMinutes = openMinutes;
    endMinutes = openMinutes + presence;
  } else {
    endMinutes = closeMinutes;
    startMinutes = closeMinutes - presence;
  }

  return { paidMinutes, pauseMinutes, startMinutes, endMinutes, type };
}
