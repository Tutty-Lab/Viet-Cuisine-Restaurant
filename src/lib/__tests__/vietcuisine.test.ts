// ============================================================================
// Die zwei Besonderheiten von Viet Cuisine:
//   - Wochenverträge (weeklyHours) -> Monats-Soll über die offenen Tage.
//   - Eine feste Frühschicht (6:30–14:30), die immer in genau diesem Fenster
//     liegt und best effort das Soll trifft (Warnung, wenn nicht ganz).
// ============================================================================

import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { DEFAULT_WORK_HOURS, resolveDay } from "../workHours";
import { publicHolidays } from "../holidays";
import { datesOfMonth } from "../demand";
import { monthlyTargetMinutes, OPEN_DAYS_PER_WEEK } from "../contract";
import type { Employee, Shift } from "../../types";

const openDaysOf = (year: number, month: number): number => {
  const hol = publicHolidays(year);
  return datesOfMonth(year, month).filter(
    (d) => !resolveDay(DEFAULT_WORK_HOURS, d, hol, {}).closed,
  ).length;
};

const wk = (id: string, t: Employee["employmentType"], h: number, x: Partial<Employee> = {}): Employee => ({
  id,
  name: id,
  employmentType: t,
  targetMinutes: 0,
  weeklyHours: h,
  ...x,
});

describe("Wochenvertrag -> Monats-Soll", () => {
  it("rechnet 39 h/Woche über die offenen Tage um", () => {
    const openDays = 26;
    // 39 × 26 / 6 = 169 h.
    expect(monthlyTargetMinutes(wk("a", "VOLLZEIT", 39), openDays)).toBe(169 * 60);
    expect(OPEN_DAYS_PER_WEEK).toBe(6);
  });

  it("ohne weeklyHours gilt targetMinutes direkt", () => {
    const emp: Employee = { id: "a", name: "a", employmentType: "TEILZEIT", targetMinutes: 100 * 60 };
    expect(monthlyTargetMinutes(emp, 26)).toBe(100 * 60);
  });

  const team = (): Employee[] => [
    wk("1", "VOLLZEIT", 39),
    wk("2", "TEILZEIT", 33),
    wk("3", "VOLLZEIT", 40),
    wk("4", "VOLLZEIT", 40),
    wk("5", "TEILZEIT", 36),
    wk("6", "MINIJOB", 10),
  ];

  for (const month of [9, 10, 11]) {
    it(`tháng ${month}: mỗi người đủ đúng định mức quy đổi từ tuần`, () => {
      const openDays = openDaysOf(2026, month);
      const shifts = generateSchedule({ year: 2026, month, workHours: DEFAULT_WORK_HOURS, employees: team() });
      for (const e of team()) {
        const got = shifts.filter((s) => s.employeeId === e.id).reduce((a, s) => a + s.paidMinutes, 0);
        expect(got).toBe(monthlyTargetMinutes(e, openDays));
      }
      const v = validateSchedule(team(), shifts, 2026, openDays);
      expect(v.errors.filter((x) => x.severity !== "warning")).toEqual([]);
    });
  }
});

describe("Feste Frühschicht 6:30–14:30", () => {
  const fixedWin = { startMinutes: 6 * 60 + 30, endMinutes: 14 * 60 + 30 };
  const team = (): Employee[] => [
    wk("1", "VOLLZEIT", 39),
    wk("2", "VOLLZEIT", 40),
    wk("3", "TEILZEIT", 33),
    wk("fx", "VOLLZEIT", 39, { fixedShift: fixedWin }),
  ];

  for (const month of [9, 10, 11]) {
    const shifts = generateSchedule({ year: 2026, month, workHours: DEFAULT_WORK_HOURS, employees: team() });
    const fx = shifts.filter((s: Shift) => s.employeeId === "fx");

    it(`tháng ${month}: mọi ca của người ca cố định đúng 6:30–14:30`, () => {
      expect(fx.length).toBeGreaterThan(0);
      for (const s of fx) {
        expect(s.startMinutes).toBe(fixedWin.startMinutes);
        expect(s.endMinutes).toBe(fixedWin.endMinutes);
      }
    });

    it(`tháng ${month}: không xếp 2 ca cùng ngày cho người ca cố định`, () => {
      const byDate = new Set<string>();
      for (const s of fx) {
        expect(byDate.has(s.date)).toBe(false);
        byDate.add(s.date);
      }
    });

    it(`tháng ${month}: giờ ca cố định KHÔNG vượt định mức (thiếu thì cảnh báo)`, () => {
      const openDays = openDaysOf(2026, month);
      const soll = monthlyTargetMinutes(team().find((e) => e.id === "fx")!, openDays);
      const got = fx.reduce((a, s) => a + s.paidMinutes, 0);
      expect(got).toBeLessThanOrEqual(soll);
      if (got < soll) {
        const v = validateSchedule(team(), shifts, 2026, openDays);
        expect(v.errors.some((e) => e.employeeId === "fx" && e.severity === "warning")).toBe(true);
      }
    });
  }
});
