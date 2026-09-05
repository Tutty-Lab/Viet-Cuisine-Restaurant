// ============================================================================
// Deutsche Monatsnamen und kleine Formatierhilfen.
// ============================================================================

// Deutsche Monatsnamen – nur für das offizielle Dokument (Stundenaufzeichnung).
export const MONTH_NAMES_DE = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

// Vietnamesische Monatsnamen – für die App-Oberfläche.
export const MONTH_NAMES_VI = [
  "Tháng 1",
  "Tháng 2",
  "Tháng 3",
  "Tháng 4",
  "Tháng 5",
  "Tháng 6",
  "Tháng 7",
  "Tháng 8",
  "Tháng 9",
  "Tháng 10",
  "Tháng 11",
  "Tháng 12",
];

/** Vorzeichenbehaftete Differenz in Stunden, z.B. -120 -> "-2,00". */
export function signedHours(minutes: number): string {
  const sign = minutes > 0 ? "+" : "";
  const hours = minutes / 60;
  return `${sign}${hours.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
