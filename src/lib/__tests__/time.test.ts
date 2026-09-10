import { describe, expect, it } from "vitest";
import {
  calculatePaidMinutes,
  calculatePause,
  minutesToDecimalHours,
  minutesToTime,
  presenceFromPaid,
  timeToMinutes,
} from "../time";

describe("timeToMinutes / minutesToTime", () => {
  it("konvertiert Uhrzeiten in Minuten", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("13:30")).toBe(810);
    expect(timeToMinutes("22:00")).toBe(1320);
  });

  it("ist invers zu minutesToTime", () => {
    for (const t of ["10:00", "13:30", "17:45", "22:00"]) {
      expect(minutesToTime(timeToMinutes(t))).toBe(t);
    }
  });

  it("wirft bei ungültigem Format", () => {
    expect(() => timeToMinutes("25:00")).toThrow();
    expect(() => timeToMinutes("abc")).toThrow();
  });
});

describe("calculatePause", () => {
  it("Staffel: über 6 h 30 min, über 8 h 60 min", () => {
    expect(calculatePause(3 * 60)).toBe(0);
    expect(calculatePause(6 * 60)).toBe(0); // genau 6 h: noch keine Pause
    expect(calculatePause(6 * 60 + 1)).toBe(30);
    expect(calculatePause(8 * 60)).toBe(30); // genau 8 h: 30 min
    expect(calculatePause(8 * 60 + 1)).toBe(60); // über 8 h: 60 min
    expect(calculatePause(9 * 60)).toBe(60);
    expect(calculatePause(10 * 60)).toBe(60);
  });

  it("liegt nie unter dem gesetzlichen Minimum", () => {
    for (let m = 60; m <= 10 * 60; m += 30) {
      const minimum = m > 9 * 60 ? 45 : m > 6 * 60 ? 30 : 0;
      expect(calculatePause(m)).toBeGreaterThanOrEqual(minimum);
    }
  });
});

describe("calculatePaidMinutes / presenceFromPaid", () => {
  it("berechnet bezahlte Minuten aus Beginn/Ende/Pause", () => {
    // 12:00-20:00, keine Pause => 8 h
    expect(calculatePaidMinutes(720, 1200, 0)).toBe(480);
    // 16:00-20:00, keine Pause => 4 h
    expect(calculatePaidMinutes(960, 1200, 0)).toBe(240);
    // 11:30-20:30 ohne Pause => 9 h bezahlt
    expect(calculatePaidMinutes(690, 1230, 0)).toBe(540);
  });
  it("presence = paid + Pause", () => {
    expect(presenceFromPaid(180)).toBe(180); // 3 h, keine Pause
    expect(presenceFromPaid(240)).toBe(240); // 4 h, keine Pause
    expect(presenceFromPaid(300)).toBe(300); // 5 h
    expect(presenceFromPaid(360)).toBe(360); // 6 h – genau an der Grenze
    expect(presenceFromPaid(420)).toBe(450); // 7 h + 30 min
    expect(presenceFromPaid(480)).toBe(510); // 8 h + 30 min
    expect(presenceFromPaid(540)).toBe(600); // 9 h + 60 min
    expect(presenceFromPaid(600)).toBe(660); // 10 h + 60 min
  });
});

describe("minutesToDecimalHours", () => {
  it("formatiert deutsch mit Komma", () => {
    expect(minutesToDecimalHours(480)).toBe("8,00");
    expect(minutesToDecimalHours(450)).toBe("7,50");
  });
});
