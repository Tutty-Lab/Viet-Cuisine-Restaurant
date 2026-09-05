// ============================================================================
// Gesetzliche Feiertage in BAYERN – der Laden liegt in Berg bei Neumarkt in der
// Oberpfalz (92348). Bewegliche Feiertage über die Osterformel (Gauß/Computus).
//
// Bayern ist katholisch geprägt und hat mehr Feiertage als die meisten Länder:
// Heilige Drei Könige (6.1.), Fronleichnam (Ostern+60) und Allerheiligen
// (1.11.). Mariä Himmelfahrt (15.8.) gilt in Bayern nur in überwiegend
// katholischen Gemeinden – die Oberpfalz/Neumarkt ist katholisch, deshalb hier
// dabei. KEIN Feiertag ist der Reformationstag (nur evangelische Länder) und
// der Buß- und Bettag (nur Sachsen).
// ============================================================================
import { addDays, format } from "date-fns";

/** Ostersonntag eines Jahres (Gauß'sche Osterformel, gregorianisch). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = März, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function iso(date: Date): string {
  return format(date, "yyyy-MM-dd");
}


/** Datum -> Name aller gesetzlichen Feiertage in Bayern eines Jahres. */
export function publicHolidayNames(year: number): Map<string, string> {
  const easter = easterSunday(year);
  const map = new Map<string, string>();
  map.set(iso(new Date(year, 0, 1)), "Neujahr");
  map.set(iso(new Date(year, 0, 6)), "Heilige Drei Könige"); // Bayern, 6.1.
  map.set(iso(addDays(easter, -2)), "Karfreitag");
  map.set(iso(addDays(easter, 1)), "Ostermontag");
  map.set(iso(new Date(year, 4, 1)), "Tag der Arbeit");
  map.set(iso(addDays(easter, 39)), "Christi Himmelfahrt");
  map.set(iso(addDays(easter, 50)), "Pfingstmontag");
  map.set(iso(addDays(easter, 60)), "Fronleichnam"); // Bayern, Ostern+60
  map.set(iso(new Date(year, 7, 15)), "Mariä Himmelfahrt"); // Bayern (kath. Gemeinden), 15.8.
  map.set(iso(new Date(year, 9, 3)), "Tag der Deutschen Einheit");
  map.set(iso(new Date(year, 10, 1)), "Allerheiligen"); // Bayern, 1.11.
  map.set(iso(new Date(year, 11, 25)), "1. Weihnachtstag");
  map.set(iso(new Date(year, 11, 26)), "2. Weihnachtstag");
  return map;
}

/**
 * Alle gesetzlichen Feiertage in Bayern eines Jahres als ISO-Set
 * "yyyy-MM-dd". Leitet sich aus publicHolidayNames ab, damit Set und Namen
 * niemals auseinanderlaufen können.
 */
export function publicHolidays(year: number): Set<string> {
  return new Set(publicHolidayNames(year).keys());
}
