// ============================================================================
// Beispieldaten: die heutige Besetzung von VietHaus, Summe = 606 bezahlte Stunden.
// ============================================================================

import type { Employee, Schedule } from "../types";
import { DEFAULT_WORK_HOURS } from "./workHours";
import { COMPANY_ADDRESS, COMPANY_NAME } from "./company";

export function makeEmployee(
  id: string,
  name: string,
  employmentType: Employee["employmentType"],
  targetHours: number,
): Employee {
  return { id, name, employmentType, targetMinutes: targetHours * 60 };
}

/** Mitarbeiter mit WOCHENvertrag (Viet Cuisine rechnet in Wochenstunden). */
export function makeWeekly(
  id: string,
  name: string,
  employmentType: Employee["employmentType"],
  weeklyHours: number,
): Employee {
  return { id, name, employmentType, targetMinutes: 0, weeklyHours };
}

/**
 * Belegschaft laut Angabe des Betriebs (Viet Cuisine GmbH), 12 Personen, alle
 * mit WOCHENstunden. Vollzeit = 39 h/Woche.
 *
 * ANNAHMEN, die der Betrieb bestätigen sollte:
 *   - Anstellungsart aus den Wochenstunden abgeleitet: 39–40 h = Vollzeit,
 *     33/35/36 h = Teilzeit, 10 h = Minijob.
 *   - Die Kraft "chỉ làm ca 6:30–14:30" ist NICHT fest einer Person zugeordnet;
 *     im Betrieb hakt man die feste Frühschicht bei der richtigen Person an
 *     (Tab Nhân viên). Hier steht sie deshalb noch bei niemandem.
 *   - Mitten im Monat startende/wechselnde Verträge (Bùi ab 7.9., Bảo ab 10.9.,
 *     Nguyệt/Đạt ab Oktober 39 h) sind hier mit ihrem SEPTEMBER-Wert erfasst;
 *     der Teilmonat wird über Urlaubstage vor dem Start abgebildet.
 */
export const SAMPLE_EMPLOYEES: Employee[] = [
  makeWeekly("ma-1", "Nguyễn Kiều Hồng Nhung", "VOLLZEIT", 39),
  makeWeekly("ma-2", "Nguyễn Tuấn Anh", "TEILZEIT", 33),
  makeWeekly("ma-3", "Nguyễn Việt Văn", "VOLLZEIT", 40),
  makeWeekly("ma-4", "Nguyễn Thị Tân", "VOLLZEIT", 40),
  makeWeekly("ma-5", "Trịnh Xuân Thành", "VOLLZEIT", 40),
  makeWeekly("ma-6", "Đào Thị Hào", "TEILZEIT", 36),
  makeWeekly("ma-7", "Nguyễn Đức Đông", "VOLLZEIT", 39),
  makeWeekly("ma-8", "Nguyễn Thị Khánh Huyền", "VOLLZEIT", 39),
  makeWeekly("ma-9", "Nguyễn Thị Nguyệt", "MINIJOB", 10),
  makeWeekly("ma-10", "Đoàn Thành Đạt", "MINIJOB", 10),
  makeWeekly("ma-11", "Bùi Văn Vũ", "VOLLZEIT", 39),
  makeWeekly("ma-12", "Nguyễn Hữu Bảo", "TEILZEIT", 35),
];

export function createSampleSchedule(): Schedule {
  return {
    companyName: COMPANY_NAME,
    address: COMPANY_ADDRESS,
    year: 2026,
    month: 8, // August
    workHours: structuredClone(DEFAULT_WORK_HOURS),
    dateOverrides: [],
    employees: SAMPLE_EMPLOYEES.map((e) => ({ ...e })),
    shifts: [],
  };
}
