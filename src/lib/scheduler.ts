// ============================================================================
// Einstieg in die Dienstplan-Erstellung. Geplant wird ausschließlich über
// Wochenverträge – die eigentliche Logik steht in weeklyScheduler.ts. Dieser
// Wrapper hält die Signatur für den Hook und die Tests stabil.
// ============================================================================

import type { Employee, Shift } from "../types";
import type { OverrideMap, WorkHoursConfig } from "./workHours";
import type { StaffingRule } from "./staffing";
import type { WeekdayKey } from "./demand";
import { generateWeeklySchedule } from "./weeklyScheduler";

export type GenerateInput = {
  year: number;
  month: number; // 1-basiert
  /** Arbeitszeit-Fenster je Wochentag + Feiertag. */
  workHours: WorkHoursConfig;
  /** Ausnahmen für einzelne Daten (geschlossen / abweichende Zeiten). */
  overrides?: OverrideMap;
  employees: Employee[];
  /** Feiertage als ISO-Set; Standard: Feiertage in Bayern des Jahres. */
  holidays?: Set<string>;
  /** Nicht verwendet (der Wochenplaner ist deterministisch); bleibt für die Signatur. */
  seed?: string;
  /** Besetzungsregeln dieser Filiale. */
  rules?: readonly StaffingRule[];
  /** Tagesgewichte dieser Filiale. */
  weights?: Record<WeekdayKey, number>;
  /** Tage, an denen jemand schon im anderen Laden arbeitet. */
  blockedDays?: Record<string, readonly string[]>;
  /** Kennung der Filiale (interner Cache). */
  storeTag?: string;
};

export function generateSchedule(input: GenerateInput): Shift[] {
  return generateWeeklySchedule(input);
}
