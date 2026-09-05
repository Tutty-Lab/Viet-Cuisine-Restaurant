// ============================================================================
// Zwei Fälle, die der Chef durch eigene Eingaben auslösen kann:
//  - ein Soll, das kleiner ist als die kürzeste Schicht,
//  - ein Tag mit mehr Leuten in der Stoßzeit, als dort stehen dürfen.
// Beides muss sichtbar werden statt still zu passieren.
// ============================================================================

import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { analyzeSchedule } from "../analyze";
import { DEFAULT_WORK_HOURS } from "../workHours";
import type { Employee, Shift } from "../../types";

const emp = (id: string, type: Employee["employmentType"], hours: number): Employee => ({
  id,
  name: id,
  employmentType: type,
  targetMinutes: hours * 60,
});

const generate = (employees: Employee[]) =>
  generateSchedule({ year: 2026, month: 8, workHours: DEFAULT_WORK_HOURS, employees });

describe("Soll kleiner als die kürzeste Schicht", () => {
  it("nennt den wahren Grund statt der Kapazitätsdecke", () => {
    // Früher kam hier ein Vortrag über die 6-Tage-Regel und eine Decke von
    // über 200 h – für jemanden, der 2 h eingetragen hat, völlig nutzlos.
    let message = "";
    try {
      generate([emp("a", "VOLLZEIT", 2)]);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("Định mức quá nhỏ");
    expect(message).toContain("3h");
    expect(message).not.toContain("6 ngày");
  });

  it("3 h ist die Untergrenze und geht durch", () => {
    const shifts = generate([emp("a", "TEILZEIT", 3)]);
    expect(shifts).toHaveLength(1);
    expect(shifts[0].paidMinutes).toBe(180);
  });
});

describe("Zu wenige Leute in der Stoßzeit", () => {
  // Viet Cuisine verlangt in der Abendspitze (18–20) mindestens ZWEI Personen;
  // eine Obergrenze gibt es nicht. Was auffallen muss, ist die Unterbesetzung –
  // egal ob sie vom Scheduler kommt oder von einer Änderung im Plan von Hand.
  //
  // 2026-08-01 ist ein Samstag: offen 10:30–14:30 und 16:30–22:30, Abendspitze
  // 18:00–20:00. Hier steht nur EINE Person im Abendblock.
  const employees = ["a"].map((id) => emp(id, "TEILZEIT", 30));
  const shifts: Shift[] = [
    {
      id: "s0",
      employeeId: "a",
      date: "2026-08-01",
      startMinutes: 16 * 60 + 30,
      endMinutes: 22 * 60 + 30,
      pauseMinutes: 30,
      paidMinutes: 5 * 60 + 30,
      shiftType: "LATE",
      generated: true,
    },
  ];

  const analysis = analyzeSchedule({
    year: 2026,
    month: 8,
    workHours: DEFAULT_WORK_HOURS,
    employees,
    shifts,
  });

  it("meldet den unterbesetzten Tag, statt ihn zu verschweigen", () => {
    const tag = analysis.peakViolations.find((d) => d.date === "2026-08-01");
    expect(tag).toBeDefined();
    expect(tag!.peaks.some((p) => !p.ok)).toBe(true);
  });

  it("nennt die tatsächliche Personenzahl und die geforderte", () => {
    const abend = analysis.peakViolations
      .find((d) => d.date === "2026-08-01")!
      .peaks.find((p) => !p.ok)!;
    expect(abend.minStaff).toBe(1); // so viele stehen wirklich da
    expect(abend.required).toBe(2); // so viele müssen es mindestens sein
  });

  it("lässt zwei Personen im Abendfenster in Ruhe", () => {
    const zwei = analyzeSchedule({
      year: 2026,
      month: 8,
      workHours: DEFAULT_WORK_HOURS,
      employees: [emp("a", "TEILZEIT", 30), emp("b", "TEILZEIT", 30)],
      shifts: [
        shifts[0],
        { ...shifts[0], id: "s1", employeeId: "b" },
      ],
    });
    const tag = zwei.peakViolations.find((d) => d.date === "2026-08-01");
    // Am 1.8. ist die Abendspitze jetzt voll; ein etwaiger Verstoß an dem Tag
    // käme nur noch von der Mittagsspitze am Sonntag – die gibt es hier nicht.
    expect(tag?.peaks.find((p) => p.label === "Tối")?.ok ?? true).toBe(true);
  });
});