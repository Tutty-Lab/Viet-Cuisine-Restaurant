// ============================================================================
// Unterbesetzung muss sichtbar werden statt still zu passieren.
//
// Viet Cuisine: Di–Sa 10:30–14:30 und 16:30–22:30, So/Feiertag 10:30–22:00.
// Immer mindestens 2 Leute; abends 18–20 Uhr 4 (Fr–So 6); ab 21:30 3.
// ============================================================================

import { describe, expect, it } from "vitest";
import { analyzeSchedule } from "../analyze";
import { DEFAULT_WORK_HOURS } from "../workHours";
import type { Employee, Shift } from "../../types";

const emp = (id: string): Employee => ({ id, name: id, employmentType: "TEILZEIT", targetMinutes: 60 * 60 });

const dienst = (id: string, date: string, from: number, to: number): Shift => ({
  id: `shift-${id}-${date}-${from}`,
  employeeId: id,
  date,
  startMinutes: from,
  endMinutes: to,
  pauseMinutes: 0,
  paidMinutes: to - from,
  shiftType: from >= 16 * 60 ? "LATE" : "EARLY",
  generated: true,
});

const peaksOf = (employees: Employee[], shifts: Shift[], date: string) =>
  analyzeSchedule({ year: 2026, month: 8, workHours: DEFAULT_WORK_HOURS, employees, shifts })
    .peakViolations.find((d) => d.date === date)?.peaks ?? [];

// 2026-08-04 ist ein Dienstag, 2026-08-07 ein Freitag.
const abend = (ids: string[], date: string) => ids.map((id) => dienst(id, date, 16 * 60 + 30, 22 * 60 + 30));
const mittag = (ids: string[], date: string) => ids.map((id) => dienst(id, date, 10 * 60 + 30, 14 * 60 + 30));

describe("Viet Cuisine – Besetzung", () => {
  it("Dienstagabend mit 4 Leuten bis zum Schluss ist in Ordnung", () => {
    const ids = ["a", "b", "c", "d"];
    const shifts = [...mittag(["e", "f"], "2026-08-04"), ...abend(ids, "2026-08-04")];
    expect(peaksOf([...ids, "e", "f"].map(emp), shifts, "2026-08-04").filter((p) => !p.ok)).toEqual([]);
  });

  it("Freitagabend braucht 6 – mit 4 wird es gemeldet", () => {
    const ids = ["a", "b", "c", "d"];
    const shifts = [...mittag(["e", "f"], "2026-08-07"), ...abend(ids, "2026-08-07")];
    const tot = peaksOf([...ids, "e", "f"].map(emp), shifts, "2026-08-07").find((p) => !p.ok && p.label === "Tối");
    expect(tot?.minStaff).toBe(4);
    expect(tot?.required).toBe(6);
  });

  it("meldet einen Mittag mit nur einer Person (mindestens 2)", () => {
    const shifts = [...mittag(["e"], "2026-08-04"), ...abend(["a", "b", "c", "d"], "2026-08-04")];
    expect(peaksOf(["a", "b", "c", "d", "e"].map(emp), shifts, "2026-08-04").some((p) => !p.ok && p.label === "Trong giờ mở cửa")).toBe(true);
  });
});
