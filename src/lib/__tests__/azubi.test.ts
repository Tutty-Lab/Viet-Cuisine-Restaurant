import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { DEFAULT_WORK_HOURS } from "../workHours";
import {
  AZUBI_EVENING_END,
  AZUBI_EVENING_START,
  AZUBI_MAX_MONTHLY_HOURS,
  type Employee,
} from "../../types";

/**
 * Der Azubi darf Mo–Fr nur abends 18:00–22:00, am Wochenende zu jeder
 * Öffnungszeit. Das steht an vielen Stellen im Scheduler auf dem Spiel: beim
 * Anlegen, beim Umdrehen Früh/Spät und in jedem Umräum-Pass. Ein einziger
 * ungeprüfter Pfad genügte, und er stand wieder mittags im Laden.
 */
const belegschaft = (azubiStunden: number): Employee[] => [
  { id: "a", name: "A", employmentType: "TEILZEIT", targetMinutes: 85 * 60 },
  { id: "b", name: "B", employmentType: "TEILZEIT", targetMinutes: 85 * 60 },
  { id: "c", name: "C", employmentType: "TEILZEIT", targetMinutes: 150 * 60 },
  { id: "d", name: "D", employmentType: "VOLLZEIT", targetMinutes: 170 * 60 },
  { id: "e", name: "E", employmentType: "MINIJOB", targetMinutes: 42 * 60 },
  { id: "f", name: "F", employmentType: "TEILZEIT", targetMinutes: 86 * 60 },
  { id: "g", name: "G", employmentType: "VOLLZEIT", targetMinutes: 170 * 60, isOwner: true },
  { id: "z", name: "Azubi", employmentType: "AZUBI", targetMinutes: azubiStunden * 60 },
];

const istWochenende = (isoDate: string): boolean => {
  const wd = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return wd === 0 || wd === 6;
};

describe("Azubi", () => {
  for (const month of [8, 9, 10, 11, 12]) {
    it(`tháng ${month}/2026: chỉ xếp ca tối trong tuần, cuối tuần tự do`, () => {
      const employees = belegschaft(AZUBI_MAX_MONTHLY_HOURS);
      const shifts = generateSchedule({
        year: 2026,
        month,
        workHours: DEFAULT_WORK_HOURS,
        employees,
      });
      const seine = shifts.filter((s) => s.employeeId === "z");
      expect(seine.length).toBeGreaterThan(0);

      for (const s of seine) {
        if (istWochenende(s.date)) continue;
        expect(s.startMinutes, `${s.date} bắt đầu quá sớm`).toBeGreaterThanOrEqual(
          AZUBI_EVENING_START,
        );
        expect(s.endMinutes, `${s.date} kết thúc quá muộn`).toBeLessThanOrEqual(
          AZUBI_EVENING_END,
        );
      }

      // Das Soll gilt für ihn wie für alle anderen.
      const summe = seine.reduce((a, s) => a + s.paidMinutes, 0);
      expect(summe).toBe(AZUBI_MAX_MONTHLY_HOURS * 60);

      const v = validateSchedule(employees, shifts);
      expect(v.errors.filter((e) => e.severity !== "warning")).toEqual([]);
    });
  }

  it("über 43 h gibt eine Warnung, keinen Fehler", () => {
    const employees = belegschaft(60);
    const v = validateSchedule(employees, []);
    const warnung = v.errors.find((e) => e.employeeId === "z" && e.severity === "warning");
    expect(warnung?.message).toContain(String(AZUBI_MAX_MONTHLY_HOURS));
  });

  it("genau 43 h warnt nicht", () => {
    const employees = belegschaft(AZUBI_MAX_MONTHLY_HOURS);
    const v = validateSchedule(employees, []);
    expect(
      v.errors.filter((e) => e.employeeId === "z" && e.message.includes("học nghề")),
    ).toEqual([]);
  });
});
