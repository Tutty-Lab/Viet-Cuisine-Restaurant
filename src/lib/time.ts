// ============================================================================
// Reine Zeit-Hilfsfunktionen. Alles in Minuten seit Mitternacht (Integer).
// ============================================================================

/** "13:30" -> 810. Wirft bei ungültigem Format. */
export function timeToMinutes(time: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) {
    throw new Error(`Ungültiges Zeitformat: "${time}" (erwartet HH:mm)`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Ungültige Uhrzeit: "${time}"`);
  }
  return hours * 60 + minutes;
}

/** 810 -> "13:30". Immer zweistellig, 24h-Format. */
export function minutesToTime(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Pausenregel nach dem Gesetz (§ 4 ArbZG): über 6 Stunden 30 Minuten, über
 * 9 Stunden 45 Minuten.
 *
 * Das ArbZG ist BUNDESRECHT und gilt in Hamburg wie überall – eine eigene
 * Regelung je Bundesland gibt es nicht. Andere Filialen geben MEHR (VietHaus
 * 60 min ab 8 h); mehr ist erlaubt, weniger nicht.
 *
 * Die Pause zählt NICHT zum Soll, verlängert aber die Anwesenheit:
 * presence = paid + pause.
 *
 * FOLGE für den Chef: sein 10-Stunden-Tag geht damit nicht mehr auf.
 * 10 h + 45 min sind 10,75 h Anwesenheit, der Rahmen Di–Fr ist aber nur
 * 11:30–22:00, also 10,5 h. Die längste Schicht ist damit 9 h.
 */
export function calculatePause(paidMinutes: number): number {
  if (paidMinutes > 9 * 60) return 45;
  if (paidMinutes > 6 * 60) return 30;
  return 0;
}

/**
 * Bezahlte Minuten aus Anwesenheit und Pause.
 * paidMinutes = presenceMinutes - pauseMinutes
 */
export function calculatePaidMinutes(
  startMinutes: number,
  endMinutes: number,
  pauseMinutes: number,
): number {
  return endMinutes - startMinutes - pauseMinutes;
}

/** Anwesenheit (inkl. Pause) aus bezahlter Zeit. */
export function presenceFromPaid(paidMinutes: number): number {
  return paidMinutes + calculatePause(paidMinutes);
}

/** Minuten -> Stunden als deutsche Dezimalzahl, z.B. 450 -> "7,50". */
export function minutesToDecimalHours(totalMinutes: number, fractionDigits = 2): string {
  const hours = totalMinutes / 60;
  return hours.toLocaleString("de-DE", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** Minuten -> kompakte Stundenangabe, z.B. 480 -> "8h", 450 -> "7,5h". */
export function minutesToShortHours(totalMinutes: number): string {
  const hours = totalMinutes / 60;
  const text = Number.isInteger(hours)
    ? String(hours)
    : hours.toLocaleString("de-DE", { maximumFractionDigits: 2 });
  return `${text}h`;
}
