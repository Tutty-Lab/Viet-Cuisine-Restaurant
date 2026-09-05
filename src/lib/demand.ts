// ============================================================================
// Kundennachfrage-Konzept: Tagesgewichte + gewünschte Spätschicht-Anteile.
// ============================================================================

import { eachDayOfInterval, endOfMonth, format, getDay, startOfMonth } from "date-fns";

export type WeekdayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

/**
 * Nachfrage-Gewichte je Wochentag (keine Mitarbeiterzahlen!).
 *
 * Angabe des Betriebs: am stärksten sind Freitag, Samstag und Sonntag –
 * "cao gấp rưỡi" (rund das Anderthalbfache eines normalen Tages). Deshalb
 * stehen Fr/Sa/So auf 1,5 und die übrigen offenen Tage (Di–Do) auf 1,0.
 * Montag ist geschlossen.
 */
export const DAY_WEIGHTS: Record<WeekdayKey, number> = {
  monday: 1.0, // geschlossen (Gewicht nur relevant, falls doch geöffnet)
  tuesday: 1.0,
  wednesday: 1.0,
  thursday: 1.0,
  friday: 1.5,
  saturday: 1.5,
  sunday: 1.5,
};

/**
 * Gewünschter Anteil an Spätschicht-Stunden je Wochentag.
 *
 * Viet Cuisine ist ein Restaurant mit Abendgeschäft; die Stoßzeit liegt 18:00–
 * 20:00. Di–Sa gibt es eine Mittagsschließung (14:30–16:30), der Nachmittag/
 * Abend (16:30–22:30) ist der stärkere Block – deshalb ÜBER der Hälfte. Am
 * Sonntag ist zusätzlich der Mittag stark ("buổi trưa chủ nhật đông"), deshalb
 * dort ausgeglichener.
 */
export const LATE_SHIFT_RATIOS: Record<WeekdayKey, number> = {
  monday: 0.6,
  tuesday: 0.6,
  wednesday: 0.6,
  thursday: 0.6,
  friday: 0.65,
  saturday: 0.65,
  sunday: 0.5,
};

/** date-fns getDay(): 0=So ... 6=Sa  ->  WeekdayKey. */
const WEEKDAY_BY_GETDAY: Record<number, WeekdayKey> = {
  0: "sunday",
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday",
};

export const WEEKDAY_LABELS_DE: Record<WeekdayKey, string> = {
  monday: "Montag",
  tuesday: "Dienstag",
  wednesday: "Mittwoch",
  thursday: "Donnerstag",
  friday: "Freitag",
  saturday: "Samstag",
  sunday: "Sonntag",
};

export const WEEKDAY_SHORT_DE: Record<WeekdayKey, string> = {
  monday: "Mo",
  tuesday: "Di",
  wednesday: "Mi",
  thursday: "Do",
  friday: "Fr",
  saturday: "Sa",
  sunday: "So",
};

// Vietnamesische Wochentage – für die App-Oberfläche.
export const WEEKDAY_LABELS_VI: Record<WeekdayKey, string> = {
  monday: "Thứ Hai",
  tuesday: "Thứ Ba",
  wednesday: "Thứ Tư",
  thursday: "Thứ Năm",
  friday: "Thứ Sáu",
  saturday: "Thứ Bảy",
  sunday: "Chủ Nhật",
};

export const WEEKDAY_SHORT_VI: Record<WeekdayKey, string> = {
  monday: "T2",
  tuesday: "T3",
  wednesday: "T4",
  thursday: "T5",
  friday: "T6",
  saturday: "T7",
  sunday: "CN",
};

export function weekdayKeyOf(date: Date): WeekdayKey {
  return WEEKDAY_BY_GETDAY[getDay(date)];
}

/** Alle Kalendertage eines Monats als ISO-Strings "yyyy-MM-dd". month ist 1-basiert. */
export function datesOfMonth(year: number, month: number): string[] {
  const first = startOfMonth(new Date(year, month - 1, 1));
  const last = endOfMonth(first);
  return eachDayOfInterval({ start: first, end: last }).map((d) => format(d, "yyyy-MM-dd"));
}

export function dayWeightOf(isoDate: string): number {
  return DAY_WEIGHTS[weekdayKeyOf(parseIsoDate(isoDate))];
}

export function lateRatioOf(isoDate: string): number {
  return LATE_SHIFT_RATIOS[weekdayKeyOf(parseIsoDate(isoDate))];
}

/** ISO "yyyy-MM-dd" -> lokales Date (ohne Zeitzonen-Verschiebung). */
export function parseIsoDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d);
}
