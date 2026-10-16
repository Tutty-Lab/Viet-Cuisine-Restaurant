// Viet Cuisine: Öffnungszeiten, Ruhetag, Eintritt und Urlaub im Planer.
import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { storeById } from "../stores";
import { datesOfMonth, parseIsoDate, weekdayKeyOf } from "../demand";
import { DEFAULT_WORK_HOURS, resolveDay } from "../workHours";
import { publicHolidays } from "../holidays";
import { monthlyTargetMinutesFor } from "../contract";
import type { Employee } from "../../types";

const store = storeById("vietcuisine");
const plan = (employees: Employee[], month = 9) =>
  generateSchedule({
    year: 2026, month, workHours: DEFAULT_WORK_HOURS, employees,
    rules: store.staffingRules, weights: store.dayWeights, storeTag: store.id,
  });
const openDates = datesOfMonth(2026, 9).filter((d) => !resolveDay(DEFAULT_WORK_HOURS, d, publicHolidays(2026), {}).closed);

describe("Viet Cuisine", () => {
  const employees = store.sampleEmployees();
  const shifts = plan(employees);

  it("Startbelegschaft: 12 Leute mit Wochenverträgen", () => {
    expect(employees).toHaveLength(12);
    expect(employees.every((e) => e.weeklyHours != null)).toBe(true);
  });

  it("plant montags nie, und jeder Dienst liegt in einem Öffnungsblock", () => {
    for (const s of shifts) {
      const day = weekdayKeyOf(parseIsoDate(s.date));
      expect(day).not.toBe("monday");
      expect(s.startMinutes).toBeGreaterThanOrEqual(10 * 60 + 30);
      expect(s.endMinutes).toBeLessThanOrEqual(day === "sunday" ? 22 * 60 : 22 * 60 + 30);
    }
  });

  it("Eintritt: Bùi Văn Vũ arbeitet erst ab 7.9., Nguyễn Hữu Bảo ab 10.9.", () => {
    expect(shifts.filter((s) => s.employeeId === "ma-11").every((s) => s.date >= "2026-09-07")).toBe(true);
    expect(shifts.filter((s) => s.employeeId === "ma-12").every((s) => s.date >= "2026-09-10")).toBe(true);
  });

  it("Urlaub: an Urlaubstagen kein Dienst, das Soll bleibt erreicht", () => {
    const vacation = ["2026-09-16"];
    const team = employees.map((e) => (e.id === "ma-1" ? { ...e, vacationDates: vacation } : e));
    const own = plan(team).filter((s) => s.employeeId === "ma-1");
    expect(own.some((s) => vacation.includes(s.date))).toBe(false);
    const soll = monthlyTargetMinutesFor(team[0], openDates);
    expect(soll - own.reduce((t, s) => t + s.paidMinutes, 0)).toBeLessThan(30);
  });
});
