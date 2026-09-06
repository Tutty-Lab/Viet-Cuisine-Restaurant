// ============================================================================
// Urlaub. Die Tage kommen vom Nutzer, nicht vom Automaten – geprüft wird das
// ENDERGEBNIS, nicht der einzelne Schritt.
//
// Der Scheduler vergibt an mehreren Stellen Termine: beim ersten Verteilen,
// beim Verschieben, beim Tauschen und in den Reparaturläufen. Bei einer
// anderen Filiale stand eine solche Sonderregel nur im ersten Schritt, und die
// Läufe danach haben sie klaglos wieder aufgehoben.
// ============================================================================

import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { DEFAULT_WORK_HOURS } from "../workHours";
import type { Employee } from "../../types";

const YEAR = 2026;

const emp = (
  id: string,
  type: Employee["employmentType"],
  hours: number,
  extra: Partial<Employee> = {},
): Employee => ({ id, name: id, employmentType: type, targetMinutes: hours * 60, ...extra });

/** Die echte Besetzung, damit die Zahlen etwas bedeuten. */
const belegschaft = (extra: Partial<Employee> = {}): Employee[] => [
  { ...emp("a", "TEILZEIT", 85), ...extra },
  emp("b", "TEILZEIT", 85),
  emp("c", "TEILZEIT", 150),
  emp("d", "VOLLZEIT", 170),
  emp("e", "MINIJOB", 42),
  emp("f", "TEILZEIT", 86),
  emp("g", "VOLLZEIT", 170, { isOwner: true }),
];

describe("Urlaub", () => {
  for (const month of [8, 9, 10]) {
    it(`tháng ${month}: không xếp ca vào ngày đã nghỉ phép`, () => {
      const frei = [`${YEAR}-${String(month).padStart(2, "0")}-10`,
                    `${YEAR}-${String(month).padStart(2, "0")}-11`,
                    `${YEAR}-${String(month).padStart(2, "0")}-12`];
      const team = belegschaft({ vacationDates: frei });
      const shifts = generateSchedule({
        year: YEAR,
        month,
        workHours: DEFAULT_WORK_HOURS,
        employees: team,
      });

      const trotzdem = shifts
        .filter((s) => s.employeeId === "a")
        .filter((s) => frei.includes(s.date));
      expect(trotzdem.map((s) => s.date)).toEqual([]);
      // Sie arbeitet aber sehr wohl – der Urlaub darf sie nicht ganz aus dem
      // Plan werfen.
      expect(shifts.filter((s) => s.employeeId === "a").length).toBeGreaterThan(0);
    });
  }

  it("cũng áp cho chủ quán", () => {
    const frei = [`${YEAR}-08-04`, `${YEAR}-08-05`, `${YEAR}-08-06`];
    const team = belegschaft().map((e) =>
      e.id === "g" ? { ...e, vacationDates: frei } : e,
    );
    const shifts = generateSchedule({
      year: YEAR,
      month: 8,
      workHours: DEFAULT_WORK_HOURS,
      employees: team,
    });
    const trotzdem = shifts
      .filter((s) => s.employeeId === "g")
      .filter((s) => frei.includes(s.date));
    expect(trotzdem.map((s) => s.date)).toEqual([]);
  });

  // Viet Cuisine verwaltet keinen Urlaub mehr – es gibt deshalb auch keine
  // Urlaubs-Warnung. Eingetragene Tage werden vom Scheduler weiterhin
  // ausgespart (siehe oben), aber nicht mehr gegen einen Jahresanspruch geprüft.
});
