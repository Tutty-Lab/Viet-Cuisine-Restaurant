// ACHTUNG – Abweichung von der Vertragsangabe:
// Die Chefin nennt fuer die Vollzeitkraft 172 h im Monat. Erreichbar ist das
// bei diesen Oeffnungszeiten NICHT: Di-Fr ist der laengste zusammenhaengende
// Block 17:00-22:00, also 5 h; nur Sa/So erlauben 9 h. Macht ueber den Monat
// rund 157-170 h Obergrenze, je nach Monat. Solange eine Person nur EINE
// Schicht pro Tag bekommt, geht 172 h nicht auf.
// Der Chef kommt sogar nur auf rund 120 h: er arbeitet fuenf Tage die Woche
// und samstags gar nicht – und Samstag ist einer der beiden langen Tage.
// Hier stehen deshalb 120 h, damit die Testmonate durchlaufen. Sobald geteilte
// Dienste erlaubt sind (Mittagsblock UND Abendblock am selben Tag), gehoert
// hier wieder 172 h hin.
// ============================================================================
// Test-Belegschaften für drei Monate.
//
// Angaben der Chefin (Kylan Restaurant):
//   - 3 Vollzeit: eine mit 200 h/Monat, zwei mit je 160 h/Monat
//   - 2 Minijob: je 43 h/Monat (rund 10 h/Woche)
//   - keine festen Schichten für die Vollzeit-Kräfte, kein fester Ruhetag:
//     die App verteilt frei im Fenster 11:30-22:00, sieben Tage die Woche
//
// Der Laden hat KEINEN Ruhetag. Bei 30 offenen Tagen und einem 10,5-h-Fenster
// kostet die Grundabdeckung (durchgehend 1 Person, abends 2) rund 405 h im
// Monat - die 606 h der Stammbesetzung reichen dafür mit Reserve.
//
// Hinweis zum Datenmodell: Schedule hält immer GENAU EINEN Monat. Diese drei
// Monate existieren nebeneinander nur hier als Fixture.
// ============================================================================

import type { Employee, Schedule } from "../types";
import { COMPANY_ADDRESS, COMPANY_NAME } from "./company";
import { makeWeekly } from "./sampleData";
import { monthlyTargetMinutes } from "./contract";
import { DEFAULT_WORK_HOURS } from "./workHours";

export type SeedMonth = {
  year: number;
  month: number; // 1-basiert
  label: string;
  employees: Employee[];
  /**
   * Wie viele Tage dürfen die Stoßzeit verfehlen? Normalfall 0.
   *
   * Bewusst hier sichtbar statt in der Prüfung versteckt: der Scheduler ist
   * eine Heuristik, keine vollständige Suche. Ein Wert > 0 heißt, dass die
   * Stundensumme rechnerisch reichen würde, der greedy Lauf die Verteilung
   * aber nicht findet - eine bekannte Schwäche, kein akzeptierter Zustand.
   */
  maxPeakGaps?: number;
};

/**
 * Belegschaft für die Testmonate (Wochenverträge). Bewusst OHNE feste
 * Frühschicht und OHNE Chef/Azubi – die Seed-Monate prüfen die normale
 * Blocklogik; die feste Schicht hat einen eigenen Test.
 */
const VOLL: Employee[] = [
  makeWeekly("ma-1", "Nhân viên 1", "VOLLZEIT", 39),
  makeWeekly("ma-2", "Nhân viên 2", "TEILZEIT", 33),
  makeWeekly("ma-3", "Nhân viên 3", "VOLLZEIT", 40),
  makeWeekly("ma-4", "Nhân viên 4", "VOLLZEIT", 40),
  makeWeekly("ma-5", "Nhân viên 5", "VOLLZEIT", 40),
  makeWeekly("ma-6", "Nhân viên 6", "TEILZEIT", 36),
  makeWeekly("ma-7", "Nhân viên 7", "VOLLZEIT", 39),
  makeWeekly("ma-8", "Nhân viên 8", "VOLLZEIT", 39),
  makeWeekly("ma-9", "Nhân viên 9", "MINIJOB", 10),
  makeWeekly("ma-10", "Nhân viên 10", "MINIJOB", 10),
  makeWeekly("ma-11", "Nhân viên 11", "VOLLZEIT", 39),
  makeWeekly("ma-12", "Nhân viên 12", "TEILZEIT", 35),
];

/** Juli 2026 – zwei Teilzeitkräfte weniger. */
const JULI: Employee[] = VOLL.filter((e) => e.id !== "ma-2" && e.id !== "ma-6");

/** August 2026 – eine Minijob-Kraft weniger. */
const AUGUST: Employee[] = VOLL.filter((e) => e.id !== "ma-10");

export const SEED_MONTHS: SeedMonth[] = [
  { year: 2026, month: 6, label: "Juni 2026", employees: VOLL.map((e) => ({ ...e })) },
  { year: 2026, month: 7, label: "Juli 2026", employees: JULI.map((e) => ({ ...e })) },
  { year: 2026, month: 8, label: "August 2026", employees: AUGUST.map((e) => ({ ...e })) },
];


/** Baut einen leeren Schedule (ohne Schichten) für einen Seed-Monat. */
export function scheduleForSeed(seed: SeedMonth): Schedule {
  return {
    companyName: COMPANY_NAME,
    address: COMPANY_ADDRESS,
    year: seed.year,
    month: seed.month,
    workHours: structuredClone(DEFAULT_WORK_HOURS),
    dateOverrides: [],
    employees: seed.employees.map((e) => ({ ...e })),
    shifts: [],
  };
}

/** Summe der Sollstunden eines Seed-Monats (für Kapazitäts-Checks). */
export function totalTargetHours(seed: SeedMonth, openDays: number): number {
  return seed.employees.reduce((sum, e) => sum + monthlyTargetMinutes(e, openDays), 0) / 60;
}
