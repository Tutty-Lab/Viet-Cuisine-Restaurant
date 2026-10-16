// ============================================================================
// Beispieldaten von Viet Cuisine (Berg). Alle mit WOCHENstunden.
// ============================================================================

import type { Employee, Schedule } from "../types";
import { DEFAULT_WORK_HOURS } from "./workHours";

export function makeEmployee(
  id: string,
  name: string,
  employmentType: Employee["employmentType"],
  targetHours: number,
): Employee {
  return { id, name, employmentType, targetMinutes: Math.round(targetHours * 60) };
}

/** Mitarbeiter mit WOCHENvertrag (hier nicht im Einsatz, bleibt für die Oberfläche). */
export function makeWeekly(
  id: string,
  name: string,
  employmentType: Employee["employmentType"],
  weeklyHours: number,
): Employee {
  return { id, name, employmentType, targetMinutes: 0, weeklyHours };
}

/**
 * Kunden-Demo („Demo Restaurant"): 10 erfundene Personen – 5 Vollzeit, 3 Teilzeit,
 * 2 Minijob, 6 Bồi und 4 Bếp (1.196 h im Monat).
 */
/**
 * Belegschaft laut Angabe des Betriebs (Viet Cuisine GmbH), 12 Personen, alle
 * mit WOCHENstunden (39–40 h Vollzeit, 33–36 h Teilzeit, 10 h Minijob).
 * Bùi Văn Vũ ab 7.9.2026, Nguyễn Hữu Bảo ab 10.9.2026 (Eintrittsdatum).
 */
export function vietCuisineEmployees(): Employee[] {
  return [
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
    { ...makeWeekly("ma-11", "Bùi Văn Vũ", "VOLLZEIT", 39), startDate: "2026-09-07" },
    { ...makeWeekly("ma-12", "Nguyễn Hữu Bảo", "TEILZEIT", 35), startDate: "2026-09-10" },
  ];
}

/** Belegschaft der Standard-Filiale – für Tests und Altaufrufe. */
export const SAMPLE_EMPLOYEES: Employee[] = vietCuisineEmployees();

export function createSampleSchedule(): Schedule {
  return {
    companyName: "Viet Cuisine GmbH",
    address: "Haupt Straße 11, 92348 Berg",
    year: 2026,
    month: 8, // August
    workHours: structuredClone(DEFAULT_WORK_HOURS),
    dateOverrides: [],
    employees: vietCuisineEmployees(),
    shifts: [],
  };
}
