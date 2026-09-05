// ============================================================================
// Zerlegt die monatlichen Sollstunden eines Mitarbeiters in Schichtlängen.
// Reine Funktion, deterministisch, über eine kleine DP realisiert.
//
// Erlaubte Längen: 3..9 h (siehe SHIFT_LENGTHS).
// Die Summe der zurückgegebenen Längen ergibt exakt targetHours.
//
// Vollzeit: bevorzugt die längsten Schichten (9 h), minimiert die Anzahl der
//           Schichten, kürzere Längen nur um das exakte Soll zu treffen.
// Teilzeit: bevorzugt 4/5/6 h (Schwerpunkt 5), 7/8/9 h nur im Notfall,
//           vermeidet unnötig viele Arbeitstage.
// ============================================================================

import type { EmploymentType } from "../types";
import { SHIFT_LENGTHS } from "./shifts";

/** Kosten je Schicht. Die DP minimiert die Gesamtkosten. */
function shiftCost(length: number, type: EmploymentType): number {
  if (type === "VOLLZEIT") {
    // Quadratischer Bonus für lange Schichten => wenige Schichten, viele 8er,
    // Rest mit möglichst großen Blöcken.
    return 100 - length * length;
  }
  // TEILZEIT und MINIJOB: fixe Basis je Schicht + Längen-Präferenz.
  // Jede Länge aus SHIFT_LENGTHS braucht einen Eintrag – fehlt einer, wird die
  // Kosten-Summe NaN und die Länge fällt lautlos aus der DP heraus.
  const base = 3;
  const preference: Record<number, number> = {
    5: 0,
    6: 1,
    4: 2,
    3: 3,
    7: 100,
    8: 100,
    9: 100,
  };
  return base + preference[length];
}

/**
 * @throws Error wenn targetHours keine gültige Kombination erlaubt (z.B. 1-3 h).
 */
export function splitTargetHours(
  targetHours: number,
  employmentType: EmploymentType,
): number[] {
  if (!Number.isInteger(targetHours) || targetHours < 0) {
    throw new Error(`Giờ định mức phải là số nguyên không âm: ${targetHours}`);
  }
  if (targetHours === 0) return [];

  const INF = Number.POSITIVE_INFINITY;
  const dpCost = new Array<number>(targetHours + 1).fill(INF);
  const dpChoice = new Array<number>(targetHours + 1).fill(0);
  dpCost[0] = 0;

  for (let total = 1; total <= targetHours; total++) {
    for (const length of SHIFT_LENGTHS) {
      if (length > total) continue;
      const prev = dpCost[total - length];
      if (prev === INF) continue;
      const cost = prev + shiftCost(length, employmentType);
      if (cost < dpCost[total]) {
        dpCost[total] = cost;
        dpChoice[total] = length;
      }
    }
  }

  if (dpCost[targetHours] === INF) {
    throw new Error(
      `Không thể tạo tổ hợp ca hợp lệ cho ${targetHours} h (ca phải từ 3–9 giờ).`,
    );
  }

  const result: number[] = [];
  let remaining = targetHours;
  while (remaining > 0) {
    const length = dpChoice[remaining];
    result.push(length);
    remaining -= length;
  }
  // Absteigend: größere Schichten zuerst (stabile Verarbeitung im Scheduler).
  result.sort((a, b) => b - a);
  return result;
}

/** Bequemer Wrapper: liefert die Schichtlängen in Minuten. */
export function splitTargetMinutes(
  targetMinutes: number,
  employmentType: EmploymentType,
): number[] {
  if (targetMinutes % 60 !== 0) {
    throw new Error(`Giờ định mức hiện chỉ hỗ trợ số giờ nguyên: ${targetMinutes}`);
  }
  return splitTargetHours(targetMinutes / 60, employmentType).map((h) => h * 60);
}
