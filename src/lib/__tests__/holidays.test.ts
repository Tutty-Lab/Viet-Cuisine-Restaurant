import { describe, expect, it } from "vitest";
import { easterSunday, publicHolidays, publicHolidayNames } from "../holidays";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { datesOfMonth } from "../demand";
import { resolveDay } from "../workHours";
import { DEFAULT_WORK_HOURS } from "../workHours";
import { SAMPLE_EMPLOYEES } from "../sampleData";
import { format } from "date-fns";

describe("Feiertage (Bayern)", () => {
  it("berechnet Ostersonntag korrekt", () => {
    expect(format(easterSunday(2026), "yyyy-MM-dd")).toBe("2026-04-05");
    expect(format(easterSunday(2024), "yyyy-MM-dd")).toBe("2024-03-31");
  });

  it("enthält die festen und beweglichen Bayern-Feiertage 2026", () => {
    const h = publicHolidays(2026);
    expect(h.has("2026-01-01")).toBe(true); // Neujahr
    expect(h.has("2026-01-06")).toBe(true); // Heilige Drei Könige (Bayern)
    expect(h.has("2026-04-03")).toBe(true); // Karfreitag
    expect(h.has("2026-04-06")).toBe(true); // Ostermontag
    expect(h.has("2026-05-01")).toBe(true); // Tag der Arbeit
    expect(h.has("2026-05-14")).toBe(true); // Christi Himmelfahrt
    expect(h.has("2026-05-25")).toBe(true); // Pfingstmontag
    expect(h.has("2026-06-04")).toBe(true); // Fronleichnam (Bayern, Ostern+60)
    expect(h.has("2026-08-15")).toBe(true); // Mariä Himmelfahrt (Bayern, kath.)
    expect(h.has("2026-10-03")).toBe(true); // Deutsche Einheit
    expect(h.has("2026-11-01")).toBe(true); // Allerheiligen (Bayern)
    expect(h.has("2026-12-25")).toBe(true);
    expect(h.has("2026-12-26")).toBe(true);
    expect(h.size).toBe(13);
  });

  it("enthält KEINE Feiertage anderer Bundesländer", () => {
    const h = publicHolidays(2026);
    expect(h.has("2026-04-05")).toBe(false); // Ostersonntag – nur Brandenburg
    expect(h.has("2026-05-24")).toBe(false); // Pfingstsonntag – nur Brandenburg
    expect(h.has("2026-10-31")).toBe(false); // Reformationstag – nicht in Bayern
    expect(h.has("2026-11-18")).toBe(false); // Buß- und Bettag – nur Sachsen
  });



  it("Set und Namen bleiben deckungsgleich", () => {
    for (const year of [2024, 2026, 2027]) {
      expect(publicHolidays(year).size).toBe(publicHolidayNames(year).size);
    }
  });
});

describe("Scheduler mit Feiertagen (Dezember 2026)", () => {
  const holidays = publicHolidays(2026);
  const openDays = datesOfMonth(2026, 12).filter(
    (d) => !resolveDay(DEFAULT_WORK_HOURS, d, holidays, {}).closed,
  ).length;
  const shifts = generateSchedule({
    year: 2026,
    month: 12, // enthält 1. und 2. Weihnachtstag
    workHours: DEFAULT_WORK_HOURS,
    employees: SAMPLE_EMPLOYEES,
  });

  it("bleibt gültig (harte Fehler = 0)", () => {
    const result = validateSchedule(SAMPLE_EMPLOYEES, shifts, 2026, openDays);
    expect(result.errors.filter((e) => e.severity !== "warning")).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("plant Schichten an Feiertagen im 10:30–22:00-Fenster (offen wie Sonntag)", () => {
    // 25.12. ist Feiertag -> offen wie Sonntag, durchgehend 10:30–22:00.
    const xmas = shifts.filter((s) => s.date === "2026-12-25");
    expect(xmas.length).toBeGreaterThan(0);
    for (const s of xmas) {
      expect(s.startMinutes).toBeGreaterThanOrEqual(10 * 60 + 30);
      expect(s.endMinutes).toBeLessThanOrEqual(22 * 60);
    }
  });
});
