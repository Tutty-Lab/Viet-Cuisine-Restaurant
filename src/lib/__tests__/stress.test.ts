import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { maxConsecutiveRun } from "../consecutive";
import { calculatePause } from "../time";
import { DEFAULT_WORK_HOURS, resolveDay, type OverrideMap } from "../workHours";
import { publicHolidays } from "../holidays";
import { datesOfMonth } from "../demand";
import { monthlyTargetMinutesFor } from "../contract";
import { splitTargetHours } from "../splitTargetHours";
import type { Employee, Shift } from "../../types";
import { vietCuisineEmployees } from "../sampleData";

const mk = (id: string, type: Employee["employmentType"], weeklyHours: number): Employee => ({
  id,
  name: id,
  employmentType: type,
  targetMinutes: 0,
  weeklyHours,
});

const openDatesOf = (year: number, month: number, overrides: OverrideMap = {}): string[] => {
  const holidays = publicHolidays(year);
  return datesOfMonth(year, month).filter((d) => !resolveDay(DEFAULT_WORK_HOURS, d, holidays, overrides).closed);
};

/** Prüft alle harten Regeln, die der Scheduler zusichert. */
function audit(
  shifts: Shift[],
  employees: Employee[],
  year: number,
  month: number,
  overrides: OverrideMap = {},
  /** true = ein FEHLBETRAG ist erlaubt (der Monat gibt das Soll nicht her). */
  fehlbetragErlaubt = false,
) {
  const problems: string[] = [];
  const holidays = publicHolidays(year);
  const openDates = openDatesOf(year, month, overrides);

  // 1. Monats-Soll im 30-Minuten-Raster getroffen (Randwochen: < 30 min Abweichung).
  for (const e of employees) {
    const sum = shifts.filter((s) => s.employeeId === e.id).reduce((a, s) => a + s.paidMinutes, 0);
    const soll = monthlyTargetMinutesFor(e, openDates);
    if (sum - soll >= 30) {
      problems.push(`${e.id}: xếp quá ${sum / 60}h / ${soll / 60}h`);
    } else if (soll - sum >= 30 && !fehlbetragErlaubt) {
      problems.push(`${e.id}: ${sum / 60}h thay vì ${soll / 60}h`);
    }
  }

  // 2. Mehrere Dienste an einem Tag sind erlaubt – aber nicht überschneidend.
  for (const e of employees) {
    const meine = shifts.filter((s) => s.employeeId === e.id);
    for (const a of meine) {
      for (const b of meine) {
        if (a === b || a.date !== b.date) continue;
        if (a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes) {
          problems.push(`${e.id} ${a.date}: hai ca chồng giờ`);
        }
      }
    }
  }

  // 3. Höchstens 6 aufeinanderfolgende Arbeitstage
  for (const e of employees) {
    const dates = shifts.filter((s) => s.employeeId === e.id).map((s) => s.date);
    const run = maxConsecutiveRun(dates);
    if (run > 6) problems.push(`${e.id}: ${run} ngày liên tiếp`);
  }

  // 4. Schicht liegt komplett in einem Öffnungsblock und nicht an geschlossenen Tagen
  for (const s of shifts) {
    const day = resolveDay(DEFAULT_WORK_HOURS, s.date, holidays, overrides);
    if (day.closed) {
      problems.push(`${s.date}: có ca dù đóng cửa`);
      continue;
    }
    if (!day.blocks.some((b) => s.startMinutes >= b.startMinutes && s.endMinutes <= b.endMinutes)) {
      problems.push(`${s.date}: ca ${s.startMinutes}-${s.endMinutes} ngoài khung`);
    }
  }

  // 5. Pausenregel + Rechenweg stimmen, höchstens 9 h bezahlt je Tag
  for (const s of shifts) {
    if (s.pauseMinutes !== calculatePause(s.paidMinutes)) {
      problems.push(`${s.date}/${s.employeeId}: nghỉ ${s.pauseMinutes}p cho ca ${s.paidMinutes / 60}h`);
    }
    if (s.endMinutes - s.startMinutes - s.pauseMinutes !== s.paidMinutes) {
      problems.push(`${s.date}/${s.employeeId}: giờ công không khớp`);
    }
  }
  for (const e of employees) {
    const perDay = new Map<string, number>();
    for (const s of shifts.filter((x) => x.employeeId === e.id)) perDay.set(s.date, (perDay.get(s.date) ?? 0) + s.paidMinutes);
    for (const [date, paid] of perDay) if (paid > 9 * 60) problems.push(`${e.id} ${date}: ${paid / 60}h > 9h`);
  }

  return problems;
}

describe("splitTargetHours: định mức nào chia được", () => {
  it("chấp nhận mọi số giờ chia được thành ca 4..8h", () => {
    for (let h = 4; h <= 200; h++) {
      expect(() => splitTargetHours(h, "VOLLZEIT")).not.toThrow();
    }
  });

  it("từ chối số giờ quá nhỏ (1, 2)", () => {
    for (const h of [1, 2]) {
      expect(() => splitTargetHours(h, "VOLLZEIT")).toThrow();
    }
    // 3h giờ là hợp lệ (một ca 3h).
    expect(() => splitTargetHours(3, "VOLLZEIT")).not.toThrow();
  });
});

describe("Scheduler: chạy thử 12 tháng liên tiếp", () => {
  // Startbelegschaft von Viet Cuisine (ohne Eintrittsdatum: ganzes Jahr).
  const employees = vietCuisineEmployees().map(({ startDate: _start, ...e }) => e);

  for (let month = 1; month <= 12; month++) {
    it(`tháng ${month}/2026 giữ đủ mọi quy tắc cứng`, () => {
      const shifts = generateSchedule({ year: 2026, month, workHours: DEFAULT_WORK_HOURS, employees });
      expect(audit(shifts, employees, 2026, month)).toEqual([]);
    });
  }
});

describe("Scheduler: hợp đồng tuần cao hơn sức chứa", () => {
  // 6 ngày × 9h = 54h là trần của một tuần; 60h không thể xếp đủ.
  const cases: Array<{ ten: string; emps: Employee[]; year: number; month: number }> = [
    { ten: "1 người 60h/tuần / tháng 2", emps: [mk("A", "VOLLZEIT", 60)], year: 2026, month: 2 },
    { ten: "2 người 60h/tuần / tháng 4", emps: [mk("A", "VOLLZEIT", 60), mk("B", "VOLLZEIT", 60)], year: 2026, month: 4 },
  ];

  for (const c of cases) {
    it(c.ten, () => {
      const shifts = generateSchedule({ year: c.year, month: c.month, workHours: DEFAULT_WORK_HOURS, employees: c.emps });
      expect(audit(shifts, c.emps, c.year, c.month, {}, true)).toEqual([]);
      expect(shifts.length).toBeGreaterThan(0);
    });

    it(`${c.ten} – Fehlbetrag wird als Warnung gemeldet`, () => {
      const shifts = generateSchedule({ year: c.year, month: c.month, workHours: DEFAULT_WORK_HOURS, employees: c.emps });
      const openDates = openDatesOf(c.year, c.month);
      const result = validateSchedule(c.emps, shifts, c.year, openDates);
      for (const e of c.emps) {
        const warnung = result.errors.find((x) => x.employeeId === e.id && x.severity === "warning");
        expect(warnung?.message).toContain("mới xếp được");
      }
      expect(result.valid).toBe(true);
    });
  }
});

describe("Scheduler: có ngày đóng cửa", () => {
  it("không xếp ca vào ngày đóng cửa và giữ quy tắc cứng", () => {
    const employees = [mk("VZ1", "VOLLZEIT", 39), mk("TZ1", "TEILZEIT", 20)];
    const overrides: OverrideMap = {};
    for (const d of ["2026-03-03", "2026-03-10", "2026-03-17", "2026-03-24", "2026-03-31"]) {
      overrides[d] = { date: d, closed: true };
    }
    const shifts = generateSchedule({ year: 2026, month: 3, workHours: DEFAULT_WORK_HOURS, employees, overrides });
    expect(audit(shifts, employees, 2026, 3, overrides)).toEqual([]);
  });
});
