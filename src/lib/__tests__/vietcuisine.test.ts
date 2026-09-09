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
import { contractOpenDays, monthlyTargetMinutes, OPEN_DAYS_PER_WEEK, weeklyTargetMinutes } from "../contract";
import type { Employee, Shift } from "../../types";
import { weekStartOf } from "../weeks";
import { SAMPLE_EMPLOYEES } from "../sampleData";
import { CLOSING_MAX, CLOSING_MIN, CLOSING_START, workingAt } from "../staffing";

const openDaysOf = (year: number, month: number): number => {
  const hol = publicHolidays(year);
  const openDates = datesOfMonth(year, month).filter(
    (d) => !resolveDay(DEFAULT_WORK_HOURS, d, hol, {}).closed,
  );
  const byWeek = new Map<string, number>();
  for (const date of openDates) {
    const week = weekStartOf(date);
    byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
  }
  return contractOpenDays([...byWeek.values()]);
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

  it("verteilt Rundungsreste über Randwochen ohne krumme Uhrzeiten", () => {
    const target = 40 * 60 * 25 / 6;
    const weekly = weeklyTargetMinutes(target, [
      { weekStart: "2026-07-27", openDays: 2 },
      { weekStart: "2026-08-03", openDays: 6 },
      { weekStart: "2026-08-10", openDays: 5 },
      { weekStart: "2026-08-17", openDays: 6 },
      { weekStart: "2026-08-24", openDays: 6 },
    ], 40 * 60);
    const values = [...weekly.values()];
    expect(values.every((minutes) => minutes % 30 === 0)).toBe(true);
    expect(values[1]).toBe(40 * 60);
    expect(values[3]).toBe(40 * 60);
    expect(values[4]).toBe(40 * 60);
    expect(Math.abs(values.reduce((sum, minutes) => sum + minutes, 0) - target)).toBeLessThanOrEqual(15);
  });

  it("requires an explicit pause interval for weekly shifts", () => {
    const employee = wk("pause", "VOLLZEIT", 39);
    const shift: Shift = {
      id: "missing-pause-time",
      employeeId: employee.id,
      date: "2026-09-01",
      startMinutes: 10 * 60 + 30,
      endMinutes: 17 * 60 + 30,
      pauseMinutes: 30,
      paidMinutes: 390,
      shiftType: "CUSTOM",
      generated: false,
    };
    const result = validateSchedule([employee], [shift], 2026, openDaysOf(2026, 9));
    expect(result.errors.some((error) => error.message.includes("Chưa xếp giờ bắt đầu nghỉ"))).toBe(true);
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
    it(`tháng ${month}: mỗi người sát định mức trong lưới 30 phút`, () => {
      const openDays = openDaysOf(2026, month);
      const shifts = generateSchedule({ year: 2026, month, workHours: DEFAULT_WORK_HOURS, employees: team() });
      for (const e of team()) {
        const got = shifts.filter((s) => s.employeeId === e.id).reduce((a, s) => a + s.paidMinutes, 0);
        expect(Math.abs(got - monthlyTargetMinutes(e, openDays))).toBeLessThanOrEqual(15);
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

describe("Wochenplan: feste Wochenstruktur", () => {
  it("hält Vollzeit je voller Woche bei 39 h und sechs Arbeitstagen", () => {
    const employee = wk("full", "VOLLZEIT", 39);
    const shifts = generateSchedule({ year: 2026, month: 9, workHours: DEFAULT_WORK_HOURS, employees: [employee] });
    const byWeek = new Map<string, { hours: number; days: Set<string> }>();
    for (const shift of shifts) {
      const week = weekStartOf(shift.date);
      const current = byWeek.get(week) ?? { hours: 0, days: new Set<string>() };
      current.hours += shift.paidMinutes / 60;
      current.days.add(shift.date);
      byWeek.set(week, current);
    }
    for (const current of byWeek.values()) {
      expect(current.hours).toBeLessThanOrEqual(39);
      expect(current.days.size).toBeLessThanOrEqual(6);
    }
    expect([...byWeek.values()].filter((x) => x.days.size === 6).every((x) => x.hours === 39)).toBe(true);
  });

  it("does not exceed daily limits when a small team cannot meet staffing targets", () => {
    const employees = [wk("a", "VOLLZEIT", 39), wk("b", "VOLLZEIT", 39), wk("c", "TEILZEIT", 33)];
    const shifts = generateSchedule({ year: 2026, month: 9, workHours: DEFAULT_WORK_HOURS, employees });
    for (const employee of employees) for (const date of datesOfMonth(2026, 9)) {
      const paid = shifts.filter((s) => s.employeeId === employee.id && s.date === date).reduce((sum, s) => sum + s.paidMinutes, 0);
      expect(paid).toBeLessThanOrEqual(540);
    }
  });

  it("besetzt beide Öffnungsblöcke mit mindestens zwei Personen", () => {
    const shifts = generateSchedule({ year: 2026, month: 9, workHours: DEFAULT_WORK_HOURS, employees: SAMPLE_EMPLOYEES });
    const holidays = publicHolidays(2026);
    for (const date of datesOfMonth(2026, 9)) {
      const day = resolveDay(DEFAULT_WORK_HOURS, date, holidays, {});
      if (day.closed) continue;
      for (const block of day.blocks) {
        const atOpening = shifts.filter((shift) => shift.date === date && shift.startMinutes <= block.startMinutes && shift.endMinutes > block.startMinutes);
        expect(atOpening.length, `${date} ${block.startMinutes}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("keeps at least two people throughout every open block", () => {
    const shifts = generateSchedule({ year: 2026, month: 9, workHours: DEFAULT_WORK_HOURS, employees: SAMPLE_EMPLOYEES });
    const holidays = publicHolidays(2026);
    for (const date of datesOfMonth(2026, 9)) {
      const day = resolveDay(DEFAULT_WORK_HOURS, date, holidays, {});
      for (const block of day.blocks) for (let minute = block.startMinutes; minute < block.endMinutes; minute++) {
        const staff = new Set(shifts.filter((shift) => shift.date === date && workingAt(shift, minute)).map((shift) => shift.employeeId)).size;
        expect(staff, `${date} ${minute}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("keeps three to four people through closing", () => {
    const shifts = generateSchedule({ year: 2026, month: 9, workHours: DEFAULT_WORK_HOURS, employees: SAMPLE_EMPLOYEES });
    const holidays = publicHolidays(2026);
    for (const date of datesOfMonth(2026, 9)) {
      if (resolveDay(DEFAULT_WORK_HOURS, date, holidays, {}).closed) continue;
      const day = resolveDay(DEFAULT_WORK_HOURS, date, holidays, {});
      for (let minute = CLOSING_START; minute < day.window.endMinutes; minute++) {
        const staff = new Set(shifts.filter((shift) => shift.date === date && workingAt(shift, minute)).map((shift) => shift.employeeId)).size;
        expect(staff, `${date} ${minute}`).toBeGreaterThanOrEqual(CLOSING_MIN);
        expect(staff, `${date} ${minute}`).toBeLessThanOrEqual(CLOSING_MAX);
      }
    }
  });

  it("staffs Fri-Sun rushes at 1.5 times the normal-day floor", () => {
    const shifts = generateSchedule({ year: 2026, month: 9, workHours: DEFAULT_WORK_HOURS, employees: SAMPLE_EMPLOYEES });
    const holidays = publicHolidays(2026);
    for (const date of datesOfMonth(2026, 9)) {
      const day = resolveDay(DEFAULT_WORK_HOURS, date, holidays, {});
      if (day.closed) continue;
      const weekday = new Date(`${date}T12:00:00`).getDay();
      const required = [0, 5, 6].includes(weekday) ? 6 : 4;
      for (let minute = 18 * 60; minute < 20 * 60; minute++) {
        const staff = new Set(shifts.filter((shift) => shift.date === date && workingAt(shift, minute)).map((shift) => shift.employeeId)).size;
        expect(staff, `${date} ${minute}`).toBeGreaterThanOrEqual(required);
      }
    }
  });

  it("hält Wochenstunden und die feste Vollzeitstruktur über mehrere volle Wochen", () => {
    const employees = SAMPLE_EMPLOYEES.filter((employee) => employee.employmentType === "VOLLZEIT");
    const shifts = generateSchedule({ year: 2026, month: 9, workHours: DEFAULT_WORK_HOURS, employees });
    for (const employee of employees) {
      for (const week of ["2026-09-07", "2026-09-14"]) {
        const own = shifts.filter((shift) => shift.employeeId === employee.id && weekStartOf(shift.date) === week);
        expect(new Set(own.map((shift) => shift.date)).size).toBe(6);
        expect(own.reduce((sum, shift) => sum + shift.paidMinutes, 0)).toBe(employee.weeklyHours! * 60);
        const daily = new Map<string, number>();
        for (const shift of own) daily.set(shift.date, (daily.get(shift.date) ?? 0) + shift.paidMinutes);
        expect([...daily.values()].every((minutes) => minutes > 0 && minutes <= 540)).toBe(true);
      }
      const pattern = (week: string) => shifts.filter((s) => s.employeeId === employee.id && weekStartOf(s.date) === week)
        .map((s) => [new Date(`${s.date}T12:00:00`).getDay(), s.startMinutes, s.endMinutes, s.paidMinutes, s.pauseStartMinutes]);
      expect(pattern("2026-09-07")).toEqual(pattern("2026-09-14"));
    }
  });

  it("allocates busy-day paid hours at 1.5 times normal days within each full week", () => {
    const shifts = generateSchedule({ year: 2026, month: 9, workHours: DEFAULT_WORK_HOURS, employees: SAMPLE_EMPLOYEES });
    for (const week of ["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"]) {
      const own = shifts.filter((shift) => weekStartOf(shift.date) === week);
      const busy = own.filter((shift) => [0, 5, 6].includes(new Date(`${shift.date}T12:00:00`).getDay()));
      const busyMinutes = busy.reduce((sum, shift) => sum + shift.paidMinutes, 0);
      const normalMinutes = own.reduce((sum, shift) => sum + shift.paidMinutes, 0) - busyMinutes;
      expect(busyMinutes / normalMinutes).toBeGreaterThanOrEqual(1.47);
      expect(busyMinutes / normalMinutes).toBeLessThanOrEqual(1.53);
    }
  });
});
