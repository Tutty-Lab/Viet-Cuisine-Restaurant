// ============================================================================
// Operationen für manuelles Bearbeiten von Schichten (immer neue Objekte,
// nie Mutation der Eingabe). Bezahlte Minuten werden automatisch neu berechnet.
// ============================================================================

import type { Shift } from "../types";
import { format } from "date-fns";
import { MONTH_NAMES_VI } from "./dateFormat";

let manualCounter = 0;
export function nextManualShiftId(): string {
  manualCounter += 1;
  return `manual-${Date.now()}-${manualCounter}`;
}

export function paidFromTimes(
  startMinutes: number,
  endMinutes: number,
  pauseMinutes: number,
): number {
  return endMinutes - startMinutes - pauseMinutes;
}

/** Neue, manuell angelegte Schicht. */
export function createManualShift(
  employeeId: string,
  date: string,
  startMinutes: number,
  endMinutes: number,
  pauseMinutes: number,
): Shift {
  return {
    id: nextManualShiftId(),
    employeeId,
    date,
    startMinutes,
    endMinutes,
    pauseMinutes,
    paidMinutes: paidFromTimes(startMinutes, endMinutes, pauseMinutes),
    shiftType: "CUSTOM",
    generated: false,
  };
}

/** Ändert Zeiten/Pause einer Schicht und berechnet bezahlte Minuten neu. */
export function updateShiftTimes(
  shift: Shift,
  changes: Partial<Pick<Shift, "startMinutes" | "endMinutes" | "pauseMinutes">>,
): Shift {
  const startMinutes = changes.startMinutes ?? shift.startMinutes;
  const endMinutes = changes.endMinutes ?? shift.endMinutes;
  const pauseMinutes = changes.pauseMinutes ?? shift.pauseMinutes;
  return {
    ...shift,
    startMinutes,
    endMinutes,
    pauseMinutes,
    paidMinutes: paidFromTimes(startMinutes, endMinutes, pauseMinutes),
    shiftType: "CUSTOM",
    generated: false,
  };
}

/** App-Oberfläche: vietnamesisch, z.B. "Tháng 8 2026". */
export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES_VI[month - 1]} / ${year}`;
}

export function isoLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return format(new Date(y, m - 1, d), "dd.MM.yyyy");
}
