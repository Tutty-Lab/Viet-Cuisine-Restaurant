// ============================================================================
// Zentrale Datentypen. Intern wird IMMER in Minuten (Integer) gerechnet,
// niemals mit Fließkomma-Stunden.
// ============================================================================

import type { WeekdayKey } from "./lib/demand";
import type { DateOverride, DayWindow, WorkHoursConfig } from "./lib/workHours";

/**
 * Anstellungsart. MINIJOB ist arbeitsrechtlich eine Form der Teilzeit und wird
 * bei der Schichtplanung auch genauso behandelt – die Trennung dient der
 * Obergrenze und der Belegschaftsstruktur, nicht der Planung selbst.
 */
export type EmploymentType = "VOLLZEIT" | "TEILZEIT" | "MINIJOB" | "AZUBI";

/**
 * Jahresurlaub in ARBEITSTAGEN, nicht in Stunden.
 *
 * So rechnet das Bundesurlaubsgesetz (§ 3 BUrlG): der Anspruch hängt daran, an
 * wie vielen Tagen die Woche jemand arbeitet, nicht wie lange. Wer nur eine
 * Stunde kommt, hat trotzdem einen ganzen Arbeitstag verbraucht. Bei fünf
 * Tagen die Woche sind es 20 Tage im Jahr, bei sechs Tagen 24.
 *
 * Kylan hat Montag zu und öffnet sechs Tage; eine Vollzeitkraft arbeitet
 * sechs Tage die Woche und hat deshalb 24 Tage. Teilzeit, Minijob und Azubi
 * arbeiten an weniger Tagen der Woche, und weil der Anspruch an den Arbeitstagen
 * je Woche hängt, ist er entsprechend kleiner: Teilzeit rechnet mit vier Tagen
 * die Woche (24 × 4/6 = 16).
 *
 * Wird das überschritten, WARNT die App – sie hindert aber niemanden: mehr
 * Urlaub als der gesetzliche Mindestanspruch ist erlaubt, er kann vertraglich
 * vereinbart oder aus dem Vorjahr übertragen sein.
 */
export const URLAUB_DAYS_PER_YEAR: Record<EmploymentType, number> = {
  VOLLZEIT: 24,
  // Teilzeit: vier Arbeitstage die Woche => 24 × 4/6.
  TEILZEIT: 16,
  MINIJOB: 8,
  // Der Azubi kommt unter der Woche nur abends und sonst am Wochenende.
  AZUBI: 8,
};

/**
 * Für Kylan gibt es BEWUSST keine Zahlengrenzen bei der Belegschaft:
 * weder eine Obergrenze für die Anzahl der Beschäftigten noch eine eigene
 * Stundendecke für Minijobs.
 *
 * Andere Filialen haben so etwas, weil der Betrieb es ausdrücklich gesagt hat
 * ("höchstens 3 Stammkräfte und 5 Minijobs"). Hier wurde nur die heutige
 * Besetzung genannt. Die vertraglichen 43 h einer Minijob-Kraft stehen ohnehin
 * als deren Monats-Soll in der Mitarbeiterliste – eine zusätzliche Prüfung
 * dagegen wäre doppelt gemoppelt und würde beim Einstellen einer weiteren
 * Kraft grundlos meckern.
 *
 * MINIJOB bleibt als Anstellungsart erhalten: sie steht auf dem Stundenzettel
 * und in der Lohnabrechnung, nur eben ohne eigene Grenze.
 */

export type ShiftType = "EARLY" | "LATE" | "CUSTOM";

export type Employee = {
  id: string;
  name: string;
  employmentType: EmploymentType;
  /**
   * Ist diese Person der Chef?
   *
   * Der Chef arbeitet mit und zaehlt bei der Besetzung ganz normal mit – auch
   * bei der Obergrenze der Stosszeit. Fuer ihn gelten aber zwei eigene Regeln:
   * fuenf Arbeitstage je Woche, und samstags ist er nicht im Laden.
   */
  isOwner?: boolean;
  /**
   * Monatliches Soll in Minuten (Integer). 176 h => 10560.
   *
   * Bei Viet Cuisine wird der Vertrag in WOCHENstunden angegeben (39 h/Woche
   * = Vollzeit). Ist weeklyHours gesetzt, ist DAS die Quelle und targetMinutes
   * wird je Monat daraus berechnet (siehe monatsSollMinuten). targetMinutes
   * bleibt trotzdem befüllt, damit ältere Codepfade und die Anzeige einen Wert
   * haben.
   */
  targetMinutes: number;
  /**
   * Vertragliche WOCHENstunden. Gesetzt => targetMinutes wird je Monat daraus
   * abgeleitet: Wochenstunden × (offene Tage des Monats ÷ 6 offene Tage/Woche).
   * Sechs offene Tage, weil der Laden montags zu ist (Di–So).
   */
  weeklyHours?: number;
  /**
   * Feste Schicht: diese Person arbeitet an ihren Arbeitstagen IMMER in genau
   * diesem Zeitfenster (Viet Cuisine: eine Kraft nur 6:30–14:30, Vorbereitung
   * ab vor Ladenöffnung). Gesetzt => der Scheduler legt für sie nur Dienste in
   * diesem Fenster an, unabhängig von den Öffnungsblöcken.
   */
  fixedShift?: DayWindow;
  /**
   * Urlaubstage als ISO-Daten "yyyy-MM-dd", über das GANZE Jahr.
   *
   * Bewusst das ganze Jahr und nicht nur der geplante Monat: der Anspruch ist
   * ein Jahresanspruch, und ob jemand seine Tage überschreitet, lässt sich nur
   * am Jahr ablesen. Der Scheduler nimmt sich daraus die Tage des Monats, den
   * er gerade plant.
   *
   * Die Tage trägt IMMER der Nutzer ein. Der Automat darf keinen Urlaub
   * verteilen – wer wann frei nimmt, ist eine Absprache im Betrieb.
   */
  vacationDates?: string[];
  /**
   * Wochentage, an denen diese Person überhaupt eingeplant werden darf.
   * Fehlt/leer = jeder Tag ist möglich (keine Einschränkung).
   */
  availableWeekdays?: WeekdayKey[];
  /**
   * Höchstzahl der Arbeitstage je Woche. Fehlt = nur die gesetzliche
   * Sechs-Tage-Regel begrenzt.
   */
  maxDaysPerWeek?: number;
};

export type Shift = {
  id: string;
  employeeId: string;
  /** ISO-Datum "yyyy-MM-dd". */
  date: string;
  startMinutes: number;
  endMinutes: number;
  pauseMinutes: number;
  /** Bezahlte Arbeitszeit in Minuten = presence - pause. */
  paidMinutes: number;
  shiftType: ShiftType;
  /** true = automatisch generiert, false = manuell hinzugefügt/geändert. */
  generated: boolean;
};

export type Schedule = {
  companyName: string;
  /** Anschrift des Betriebs (erscheint auf dem Stundenzettel). */
  address: string;
  year: number;
  /** 1-basiert: 1 = Januar ... 12 = Dezember. */
  month: number;
  /** Arbeitszeit-Fenster (giờ làm) je Wochentag + Feiertag. */
  workHours: WorkHoursConfig;
  /** Ausnahmen für einzelne Daten (geschlossen / abweichende Zeiten). */
  dateOverrides: DateOverride[];
  employees: Employee[];
  shifts: Shift[];
  /**
   * Zeitpunkt der ersten Wochen-Ausgabe (ISO). Gesetzt = der Monat ist
   * gesperrt und darf nicht mehr geändert werden.
   *
   * Hintergrund: sobald eine Woche ausgedruckt im Laden hängt, muss der Stand
   * im System exakt dem Papier entsprechen – bei einer Kontrolle wird genau
   * das verglichen. Entsperren geht nur bewusst über die Oberfläche.
   */
  lockedAt?: string;
  /** Bereits gedruckte Wochen, als ISO-Datum des jeweiligen Montags. */
  printedWeeks?: string[];
};

/** Ein einzelnes zu verplanendes Schicht-Token (Ergebnis von splitTargetHours). */
export type ShiftToken = {
  employeeId: string;
  paidMinutes: number;
};

/**
 * Auszubildende: höchstens 43 Stunden im Monat. Wird das überschritten, warnt
 * die App – gesperrt wird nichts, denn ob mehr erlaubt ist, steht im
 * Ausbildungsvertrag und nicht in diesem Programm.
 */
export const AZUBI_MAX_MONTHLY_HOURS = 43;

/**
 * Zeitfenster, in dem ein Azubi an einem WOCHENTAG arbeiten darf: 18–22 Uhr.
 *
 * Vorgabe des Betriebs: der Azubi kommt unter der Woche nur abends, dazu am
 * Wochenende. Am Samstag und Sonntag gilt die Einschränkung NICHT – dort darf
 * er über den ganzen Tag eingeteilt werden.
 */
export const AZUBI_EVENING_START = 18 * 60;
export const AZUBI_EVENING_END = 22 * 60;

/** So viele Tage je Woche arbeitet der Chef. */
export const OWNER_DAYS_PER_WEEK = 5;

/**
 * Obergrenze für die Schichtlänge des Chefs.
 *
 * Er ist der Einzige, dessen Dienst über die MITTAGSSCHLIESSUNG hinweg läuft:
 * Di–Fr ist von 15:00 bis 17:00 zu, für ihn zählt trotzdem der ganze Rahmen
 * 11:30–22:00 als ein Stück.
 *
 * Der Wert steht auf 10, praktisch erreicht er das aber nicht mehr: seit die
 * gesetzliche Pause gilt, braucht eine 10-Stunden-Schicht 45 Minuten Pause und
 * damit 10,75 h Anwesenheit – der Rahmen bietet nur 10,5 h. Übrig bleiben
 * 9 h + 30 min = 9,5 h. Die 10 bleibt hier stehen, damit die Grenze nicht
 * doppelt gepflegt werden muss; wer das Fenster später verlängert, bekommt die
 * zehnte Stunde automatisch zurück.
 */
export const OWNER_MAX_SHIFT_HOURS = 10;

/** An diesem Wochentag ist der Chef nicht im Laden. */
export const OWNER_FREE_WEEKDAY = "saturday" as const;
