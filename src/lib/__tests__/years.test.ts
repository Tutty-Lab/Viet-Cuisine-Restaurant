import { describe, expect, it } from "vitest";
import { clampScheduleYear, isScheduleYearAllowed, SCHEDULE_YEARS, SCHEDULE_YEAR_RANGE_LABEL } from "../years";

describe("Năm được phép xếp/in lịch (checklist G: 2026–2030)", () => {
  it("chỉ gồm 2026 đến 2030", () => {
    expect(SCHEDULE_YEARS).toEqual([2026, 2027, 2028, 2029, 2030]);
    expect(SCHEDULE_YEAR_RANGE_LABEL).toBe("2026–2030");
  });

  it("chặn năm ngoài khoảng", () => {
    expect(isScheduleYearAllowed(2026)).toBe(true);
    expect(isScheduleYearAllowed(2030)).toBe(true);
    expect(isScheduleYearAllowed(2025)).toBe(false);
    expect(isScheduleYearAllowed(2031)).toBe(false);
    expect(isScheduleYearAllowed(2027.5)).toBe(false);
  });

  it("đưa năm về khoảng cho phép", () => {
    expect(clampScheduleYear(2024)).toBe(2026);
    expect(clampScheduleYear(2028)).toBe(2028);
    expect(clampScheduleYear(2035)).toBe(2030);
    expect(clampScheduleYear(Number.NaN)).toBe(2026);
  });
});
